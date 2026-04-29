import { ADMIN_EMAIL, isAdmin, verifySupabaseUser } from "./_shared/auth.js";
import { json } from "./_shared/json.js";
import { supabaseAdminRequest } from "./_shared/supabase-admin.js";

export default async (req) => {
  if (!["GET", "POST"].includes(req.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  }
  if (!isAdmin(authResult.user)) {
    return json({ error: "Forbidden", detail: `只有管理员 ${ADMIN_EMAIL} 可以发布公告。` }, 403);
  }

  if (req.method === "GET") return listAdminNotifications();
  return createAdminNotification(req, authResult.user);
};

export const config = {
  path: "/api/admin/notifications",
  method: ["GET", "POST"]
};

async function listAdminNotifications() {
  const result = await supabaseAdminRequest(`/notifications?${new URLSearchParams({
    select: "*",
    order: "created_at.desc",
    limit: "80"
  })}`);
  if (!result.ok) return json({ error: "Notification query failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, notifications: result.data || [] });
}

async function createAdminNotification(req, adminUser) {
  const body = await req.json().catch(() => ({}));
  const audience = normalizeAudience(body.audience);
  const title = cleanText(body.title, 80);
  const content = cleanText(body.body || body.content, 1200);
  const targetEmail = String(body.targetEmail || "").trim().toLowerCase();
  const targetPlan = normalizePlan(body.targetPlan);

  if (!title) return json({ error: "Missing title", detail: "请填写公告标题。" }, 400);
  if (!content) return json({ error: "Missing body", detail: "请填写公告内容。" }, 400);
  if (audience === "user" && !targetEmail) return json({ error: "Missing target", detail: "定向用户公告需要填写邮箱。" }, 400);

  const result = await supabaseAdminRequest("/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({
      audience,
      target_email: audience === "user" ? targetEmail : null,
      target_plan: audience === "plan" ? targetPlan : null,
      type: "announcement",
      title,
      body: content,
      created_by_email: adminUser.email || ADMIN_EMAIL
    })
  });

  if (!result.ok) return json({ error: "Notification create failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, notification: result.data?.[0] || null });
}

function normalizeAudience(value) {
  return ["all", "user", "plan"].includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "all";
}

function normalizePlan(value) {
  return ["free", "plus", "pro", "admin"].includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "free";
}

function cleanText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}
