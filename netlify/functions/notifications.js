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

  if (req.method === "PATCH") return handleNotificationPatch(req, authResult.user);
  return listNotifications(authResult.user);
};

export const config = {
  path: "/api/notifications",
  method: ["GET", "PATCH"]
};

async function listNotifications(user) {
  const [notificationsResult, readsResult, claimsResult, entitlementResult] = await Promise.all([
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
    supabaseAdminRequest(`/notification_claims?${new URLSearchParams({
      select: "notification_id,quota_delta,claimed_at",
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
  const claimIds = new Set((claimsResult.data || []).map(item => item.notification_id));
  const notifications = (notificationsResult.data || [])
    .filter(item => matchesAudience(item, user.id, email, plan))
    .slice(0, 40)
    .map(item => ({
      ...item,
      read: readIds.has(item.id),
      claimed: claimIds.has(item.id)
    }));

  return json({
    ok: true,
    plan,
    unreadCount: notifications.filter(item => !item.read).length,
    notifications
  });
}

async function handleNotificationPatch(req, user) {
  const body = await req.json().catch(() => ({}));
  if (body.action === "claim") return claimNotification(body.id, user);
  return markNotificationsRead(body, user.id);
}

async function markNotificationsRead(body, userId) {
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

async function claimNotification(idInput, user) {
  const id = String(idInput || "").trim();
  if (!id) return json({ error: "Missing id", detail: "缺少通知 ID。" }, 400);

  const notificationsResult = await supabaseAdminRequest(`/notifications?${new URLSearchParams({
    select: "*",
    id: `eq.${id}`,
    limit: "1"
  })}`);
  if (!notificationsResult.ok) return json({ error: "Notification query failed", detail: notificationsResult.detail }, notificationsResult.status || 500);
  const notification = notificationsResult.data?.[0];
  if (!notification) return json({ error: "Not found", detail: "通知不存在。" }, 404);

  const entitlementResult = await supabaseAdminRequest(`/user_entitlements?${new URLSearchParams({
    select: "plan,status,current_period_ends_at,quota_bonus",
    user_id: `eq.${user.id}`,
    limit: "1"
  })}`);
  const current = entitlementResult.data?.[0] || {};
  const plan = resolvePlan(user, current);
  if (!matchesAudience(notification, user.id, String(user.email || "").toLowerCase(), plan)) {
    return json({ error: "Forbidden", detail: "这条活动不属于当前账号。" }, 403);
  }
  if (notification.type !== "activity" || Number(notification.quota_delta || 0) <= 0) {
    return json({ error: "Not claimable", detail: "这条通知没有可领取额度。" }, 400);
  }

  const claimResult = await supabaseAdminRequest("/notification_claims?on_conflict=notification_id,user_id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "resolution=ignore-duplicates,return=representation"
    },
    body: JSON.stringify({
      notification_id: notification.id,
      user_id: user.id,
      quota_delta: Number(notification.quota_delta || 0)
    })
  });
  if (!claimResult.ok) return json({ error: "Claim failed", detail: claimResult.detail }, claimResult.status || 500);
  if (!claimResult.data?.length) return json({ error: "Already claimed", detail: "这条活动额度已经领取过了。" }, 409);

  const entitlementUpdate = await supabaseAdminRequest("/user_entitlements?on_conflict=user_id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify({
      user_id: user.id,
      plan: ["plus", "pro"].includes(current.plan) ? current.plan : "free",
      status: current.status || "inactive",
      quota_bonus: Math.max(0, Number(current.quota_bonus || 0) + Number(notification.quota_delta || 0)),
      updated_at: new Date().toISOString()
    })
  });
  if (!entitlementUpdate.ok) return json({ error: "Quota update failed", detail: entitlementUpdate.detail }, entitlementUpdate.status || 500);
  return json({ ok: true, quotaDelta: Number(notification.quota_delta || 0) });
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
