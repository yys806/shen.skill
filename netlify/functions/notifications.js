import { verifySupabaseUser } from "./_shared/auth.js";
import { json } from "./_shared/json.js";
import { supabaseAdminRequest } from "./_shared/supabase-admin.js";

export default async (req) => {
  if (!["GET", "PATCH"].includes(req.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  }

  if (req.method === "PATCH") return markNotificationsRead(req, authResult.user.id);
  return listNotifications(authResult.user);
};

export const config = {
  path: "/api/notifications",
  method: ["GET", "PATCH"]
};

async function listNotifications(user) {
  const [notificationsResult, readsResult, entitlementResult] = await Promise.all([
    supabaseAdminRequest(`/notifications?${new URLSearchParams({
      select: "*",
      order: "created_at.desc",
      limit: "80"
    })}`),
    supabaseAdminRequest(`/notification_reads?${new URLSearchParams({
      select: "notification_id,read_at",
      user_id: `eq.${user.id}`,
      limit: "500"
    })}`),
    supabaseAdminRequest(`/user_entitlements?${new URLSearchParams({
      select: "plan,status,current_period_ends_at",
      user_id: `eq.${user.id}`,
      limit: "1"
    })}`)
  ]);

  if (!notificationsResult.ok) return json({ error: "Notification query failed", detail: notificationsResult.detail }, notificationsResult.status || 500);
  if (!readsResult.ok) return json({ error: "Notification reads failed", detail: readsResult.detail }, readsResult.status || 500);

  const plan = resolvePlan(user, entitlementResult.data?.[0] || {});
  const email = String(user.email || "").toLowerCase();
  const readIds = new Set((readsResult.data || []).map(item => item.notification_id));
  const notifications = (notificationsResult.data || [])
    .filter(item => matchesAudience(item, user.id, email, plan))
    .slice(0, 40)
    .map(item => ({
      ...item,
      read: readIds.has(item.id)
    }));

  return json({
    ok: true,
    plan,
    unreadCount: notifications.filter(item => !item.read).length,
    notifications
  });
}

async function markNotificationsRead(req, userId) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(id => String(id || "").trim()).filter(Boolean) : [];
  if (!ids.length) return json({ ok: true, marked: 0 });

  const result = await supabaseAdminRequest("/notification_reads?on_conflict=notification_id,user_id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(ids.map(id => ({
      notification_id: id,
      user_id: userId,
      read_at: new Date().toISOString()
    })))
  });

  if (!result.ok) return json({ error: "Mark read failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, marked: result.data?.length || ids.length });
}

function matchesAudience(item, userId, email, plan) {
  if (item.audience === "all") return true;
  if (item.audience === "user") {
    return item.target_user_id === userId || String(item.target_email || "").toLowerCase() === email;
  }
  if (item.audience === "plan") return item.target_plan === plan;
  return false;
}

function resolvePlan(user, entitlement) {
  if (String(user.email || "").toLowerCase() === "3492675568@qq.com") return "admin";
  if (!["active", "trialing"].includes(entitlement.status)) return "free";
  if (entitlement.current_period_ends_at && new Date(entitlement.current_period_ends_at).getTime() <= Date.now()) return "free";
  return ["plus", "pro"].includes(entitlement.plan) ? entitlement.plan : "free";
}
