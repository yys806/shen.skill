import { verifySupabaseUser } from "./_shared/auth.js";
import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";

const ADMIN_EMAIL = "3492675568@qq.com";
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
    select: "plan,status,provider,current_period_ends_at,updated_at",
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
  const isAdmin = String(authResult.user?.email || "").toLowerCase() === ADMIN_EMAIL;
  const plan = isAdmin ? "admin" : normalizePlan(entitlement.plan);
  const usage = await queryMonthlyUsage(authResult.authorization, authResult.user.id);
  const limit = PLAN_LIMITS[plan];

  return json({
    ok: true,
    entitlement: { ...entitlement, plan },
    usage: {
      used: usage.ok ? usage.count : 0,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - (usage.ok ? usage.count : 0)),
      unlimited: limit === null,
      period: currentMonthStart()
    },
    isPaid: ["plus", "pro"].includes(plan) && ["active", "trialing"].includes(entitlement.status),
    isPro: plan === "pro" && ["active", "trialing"].includes(entitlement.status),
    isAdmin
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

function currentMonthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
