import { ADMIN_EMAIL, isAdmin, verifySupabaseUser } from "./_shared/auth.js";
import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";
import { supabaseAdminRequest } from "./_shared/supabase-admin.js";

const PLAN_LIMITS = {
  free: 50,
  plus: 500,
  pro: 2000,
  admin: null
};

export default async (req) => {
  if (!["GET", "PATCH", "DELETE"].includes(req.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  }

  if (!isAdmin(authResult.user)) {
    return json({ error: "Forbidden", detail: `只有管理员 ${ADMIN_EMAIL} 可以管理用户。` }, 403);
  }

  if (req.method === "GET") return listUsers();
  if (req.method === "PATCH") return updateUserPlan(req);
  return deleteUser(req);
};

export const config = {
  path: "/api/admin/users",
  method: ["GET", "PATCH", "DELETE"]
};

async function listUsers() {
  const [profiles, entitlements, usage] = await Promise.all([
    supabaseAdminRequest(`/profiles?${new URLSearchParams({
      select: "id,email,nickname,created_at,updated_at",
      order: "created_at.desc"
    })}`),
    supabaseAdminRequest(`/user_entitlements?${new URLSearchParams({
      select: "user_id,plan,status,current_period_ends_at,updated_at"
    })}`),
    supabaseAdminRequest(`/request_events?${new URLSearchParams({
      select: "user_id",
      event_type: "eq.chat",
      created_at: `gte.${currentMonthStart()}`,
      limit: "10000"
    })}`)
  ]);

  if (!profiles.ok) return json({ error: "User query failed", detail: profiles.detail }, profiles.status || 500);
  if (!entitlements.ok) return json({ error: "Entitlement query failed", detail: entitlements.detail }, entitlements.status || 500);

  const entitlementByUser = new Map((entitlements.data || []).map(item => [item.user_id, item]));
  const usageByUser = new Map();
  if (usage.ok) {
    for (const event of usage.data || []) {
      usageByUser.set(event.user_id, (usageByUser.get(event.user_id) || 0) + 1);
    }
  }

  const users = (profiles.data || []).map(profile => {
    const isAdminUser = String(profile.email || "").toLowerCase() === ADMIN_EMAIL;
    const entitlement = entitlementByUser.get(profile.id) || {};
    const plan = isAdminUser ? "admin" : normalizePlan(entitlement.plan);
    const limit = PLAN_LIMITS[plan];
    const used = usageByUser.get(profile.id) || 0;
    return {
      ...profile,
      plan,
      status: entitlement.status || (plan === "free" ? "inactive" : "active"),
      current_period_ends_at: entitlement.current_period_ends_at || null,
      usage: {
        used,
        limit,
        remaining: limit === null ? null : Math.max(0, limit - used),
        unlimited: limit === null,
        period: currentMonthStart()
      }
    };
  });

  return json({ ok: true, users });
}

async function updateUserPlan(req) {
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId || "").trim();
  const plan = normalizePlan(body.plan);
  const status = plan === "free" ? "inactive" : "active";

  if (!userId) return json({ error: "Missing userId", detail: "缺少用户 ID。" }, 400);

  const result = await supabaseAdminRequest("/user_entitlements?on_conflict=user_id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify({
      user_id: userId,
      plan,
      status,
      provider: "admin",
      updated_at: new Date().toISOString()
    })
  });

  if (!result.ok) return json({ error: "Plan update failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, entitlement: result.data?.[0] || null });
}

async function deleteUser(req) {
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId || "").trim();
  const email = String(body.email || "").toLowerCase();

  if (!userId) return json({ error: "Missing userId", detail: "缺少用户 ID。" }, 400);
  if (email === ADMIN_EMAIL) return json({ error: "Cannot delete admin", detail: "不能删除当前管理员账号。" }, 400);

  const result = await supabaseAuthAdminRequest(`/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE"
  });

  if (!result.ok) return json({ error: "Delete user failed", detail: result.detail }, result.status || 500);
  return json({ ok: true });
}

async function supabaseAuthAdminRequest(path, options = {}) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    return { ok: false, status: 500, detail: "请先在 Netlify 配置 SUPABASE_SERVICE_ROLE_KEY。" };
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1${path}`, {
      method: options.method || "GET",
      headers: {
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json"
      },
      body: options.body
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, detail: data?.message || response.statusText, data };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, status: 500, detail: error.message };
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
