import { ADMIN_EMAIL, isAdmin, verifySupabaseUser } from "./_shared/auth.js";
import { json } from "./_shared/json.js";
import { supabaseAdminRequest } from "./_shared/supabase-admin.js";

export default async (req) => {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  }
  if (!isAdmin(authResult.user)) {
    return json({ error: "Forbidden", detail: `只有管理员 ${ADMIN_EMAIL} 可以管理通知。` }, 403);
  }

  if (req.method === "GET") return listAdminNotifications();
  if (req.method === "DELETE") return deleteAdminNotification(req);
  if (req.method === "PATCH") return updateAdminNotification(req);
  return createAdminNotification(req, authResult.user);
};

export const config = {
  path: "/api/admin/notifications",
  method: ["GET", "POST", "PATCH", "DELETE"]
};

async function listAdminNotifications() {
  const result = await supabaseAdminRequest(`/notifications?${new URLSearchParams({
    select: "*",
    order: "created_at.desc",
    limit: "120"
  })}`);
  if (!result.ok) return json({ error: "Notification query failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, notifications: result.data || [] });
}

async function createAdminNotification(req, adminUser) {
  const body = await req.json().catch(() => ({}));
  const items = normalizeNotificationPayload(body, adminUser.email || ADMIN_EMAIL);
  if (items.error) return json({ error: "Invalid notification", detail: items.error }, 400);

  const result = await supabaseAdminRequest("/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify(items.rows)
  });

  if (!result.ok) return json({ error: "Notification create failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, notifications: result.data || [] });
}

async function updateAdminNotification(req) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return json({ error: "Missing id", detail: "缺少通知 ID。" }, 400);
  const title = cleanText(body.title, 80);
  const content = cleanText(body.body || body.content, 1200);
  if (!title) return json({ error: "Missing title", detail: "请填写标题。" }, 400);
  if (!content) return json({ error: "Missing body", detail: "请填写内容。" }, 400);

  const result = await supabaseAdminRequest(`/notifications?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({
      type: normalizeType(body.type),
      title,
      body: content,
      quota_delta: Math.max(0, Number(body.quotaDelta || 0))
    })
  });
  if (!result.ok) return json({ error: "Notification update failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, notification: result.data?.[0] || null });
}

async function deleteAdminNotification(req) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return json({ error: "Missing id", detail: "缺少通知 ID。" }, 400);
  const result = await supabaseAdminRequest(`/notifications?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Prefer": "return=minimal" }
  });
  if (!result.ok) return json({ error: "Notification delete failed", detail: result.detail }, result.status || 500);
  return json({ ok: true });
}

function normalizeNotificationPayload(body, adminEmail) {
  const audience = normalizeAudience(body.audience);
  const type = normalizeType(body.type);
  const title = cleanText(body.title, 80);
  const content = cleanText(body.body || body.content, 1200);
  const quotaDelta = type === "activity" ? Math.max(0, Number(body.quotaDelta || 0)) : 0;
  const targetEmails = Array.isArray(body.targetEmails)
    ? body.targetEmails.map(email => String(email || "").trim().toLowerCase()).filter(Boolean)
    : [];

  if (!title) return { error: "请填写标题。" };
  if (!content) return { error: "请填写内容。" };
  if (type === "activity" && quotaDelta <= 0) return { error: "活动需要填写要赠送的额度。" };
  if (audience === "user" && !targetEmails.length) return { error: "指定用户通知需要至少添加一个邮箱。" };

  const base = {
    audience,
    target_plan: null,
    type,
    quota_delta: quotaDelta,
    title,
    body: content,
    created_by_email: adminEmail
  };

  if (audience === "user") {
    return {
      rows: [...new Set(targetEmails)].map(email => ({
        ...base,
        target_email: email
      }))
    };
  }

  return {
    rows: [{
      ...base,
      target_email: null
    }]
  };
}

function normalizeAudience(value) {
  return String(value || "").toLowerCase() === "user" ? "user" : "all";
}

function normalizeType(value) {
  return String(value || "").toLowerCase() === "activity" ? "activity" : "announcement";
}

function cleanText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}
