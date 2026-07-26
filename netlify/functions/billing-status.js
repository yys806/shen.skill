import { isAdmin, verifySupabaseUser } from "./_shared/auth.js";
import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";

const PLAN_LIMITS = {
  free: 50,
  plus: 500,
  pro: 2000,
  admin: null
};

export default async (req) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  }

  const query = new URLSearchParams({
    select: "plan,status,provider,quota_bonus,current_period_ends_at,updated_at",
    user_id: `eq.${authResult.user.id}`,
    limit: "1"
  });
  const result = await queryOwnEntitlement(query, authResult.authorization);

  if (!result.ok) {
    return json({ error: "Billing status failed", detail: result.detail }, result.status || 500);
  }

  const entitlement = result.data?.[0] || {
    plan: "free",
    status: "inactive",
    provider: null,
    current_period_ends_at: null,
    updated_at: null
  };
  const adminUser = isAdmin(authResult.user);
  const activePaid = isEntitlementActive(entitlement);
  const plan = adminUser ? "admin" : (activePaid ? normalizePlan(entitlement.plan) : "free");
  const usage = await queryMonthlyUsage(authResult.authorization, authResult.user.id);
  const limit = PLAN_LIMITS[plan];
  const quotaBonus = Number(entitlement.quota_bonus || 0);
  const effectiveLimit = limit === null ? null : limit + quotaBonus;

  return json({
    ok: true,
    entitlement: { ...entitlement, plan },
    usage: {
      used: usage.ok ? usage.count : 0,
      limit: effectiveLimit,
      baseLimit: limit,
      quotaBonus,
      remaining: effectiveLimit === null ? null : Math.max(0, effectiveLimit - (usage.ok ? usage.count : 0)),
      unlimited: limit === null,
      period: currentMonthStart()
    },
    isPaid: ["plus", "pro"].includes(plan) && activePaid,
    isPro: plan === "pro" && activePaid,
    isAdmin: adminUser
  });
};

export const config = {
  path: "/api/billing/status",
  method: ["GET"]
};

async function queryOwnEntitlement(query, authorization) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/user_entitlements?${query}`, {
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": authorization,
        "Accept": "application/json"
      }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, detail: data?.message || response.statusText };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, status: 500, detail: error.message };
  }
}

async function queryMonthlyUsage(authorization, userId) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  const query = new URLSearchParams({
    select: "id",
    user_id: `eq.${userId}`,
    event_type: "eq.chat",
    created_at: `gte.${currentMonthStart()}`
  });

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/request_events?${query}`, {
      method: "HEAD",
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": authorization,
        "Accept": "application/json",
        "Prefer": "count=exact"
      }
    });
    if (!response.ok) return { ok: false, count: 0 };
    const range = response.headers.get("content-range") || "";
    const count = Number(range.split("/").pop());
    return { ok: true, count: Number.isFinite(count) ? count : 0 };
  } catch {
    return { ok: false, count: 0 };
  }
}

function normalizePlan(plan) {
  return ["free", "plus", "pro"].includes(String(plan || "").toLowerCase())
    ? String(plan).toLowerCase()
    : "free";
}

function isEntitlementActive(entitlement) {
  if (!["active", "trialing"].includes(entitlement.status)) return false;
  if (!entitlement.current_period_ends_at) return true;
  return new Date(entitlement.current_period_ends_at).getTime() > Date.now();
}

function currentMonthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
