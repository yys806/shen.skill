import { ADMIN_EMAIL, isAdmin, verifySupabaseUser } from "./_shared/auth.js";
import { json } from "./_shared/json.js";
import { supabaseAdminRequest } from "./_shared/supabase-admin.js";

const PLAN_AMOUNTS = {
  plus: 19,
  pro: 49
};

export default async (req) => {
  if (!["GET", "PATCH"].includes(req.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  }

  if (!isAdmin(authResult.user)) {
    return json({ error: "Forbidden", detail: `只有管理员 ${ADMIN_EMAIL} 可以审核支付记录。` }, 403);
  }

  if (req.method === "GET") return listPaymentRequests();
  return reviewPaymentRequest(req, authResult.user);
};

export const config = {
  path: "/api/admin/payment-requests",
  method: ["GET", "PATCH"]
};

async function listPaymentRequests() {
  const query = new URLSearchParams({
    select: "*",
    order: "created_at.desc"
  });
  const result = await supabaseAdminRequest(`/payment_requests?${query}`);
  if (!result.ok) return json({ error: "Payment query failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, payments: result.data || [] });
}

async function reviewPaymentRequest(req, adminUser) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const status = normalizeStatus(body.status);
  const reviewNote = String(body.reviewNote || "").trim();

  if (!id) return json({ error: "Missing id", detail: "缺少支付记录 ID。" }, 400);

  const existing = await supabaseAdminRequest(`/payment_requests?${new URLSearchParams({
    select: "*",
    id: `eq.${id}`,
    limit: "1"
  })}`);
  if (!existing.ok) return json({ error: "Payment query failed", detail: existing.detail }, existing.status || 500);

  const payment = existing.data?.[0];
  if (!payment) return json({ error: "Not found", detail: "没有找到这条支付记录。" }, 404);

  const now = new Date();
  const updatePayload = {
    status,
    review_note: reviewNote || null,
    reviewed_by_email: adminUser.email || ADMIN_EMAIL,
    reviewed_at: now.toISOString()
  };

  if (status === "approved") {
    updatePayload.starts_at = now.toISOString();
    updatePayload.ends_at = addOneMonth(now).toISOString();
  }

  const updateResult = await supabaseAdminRequest(`/payment_requests?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify(updatePayload)
  });
  if (!updateResult.ok) return json({ error: "Payment update failed", detail: updateResult.detail }, updateResult.status || 500);

  if (status === "approved") {
    const entitlementResult = await supabaseAdminRequest("/user_entitlements?on_conflict=user_id", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify({
        user_id: payment.user_id,
        plan: normalizePlan(payment.plan),
        status: "active",
        provider: `manual_${payment.payment_method}`,
        provider_transaction_id: payment.id,
        current_period_ends_at: updatePayload.ends_at,
        updated_at: now.toISOString()
      })
    });
    if (!entitlementResult.ok) {
      return json({ error: "Entitlement update failed", detail: entitlementResult.detail }, entitlementResult.status || 500);
    }
  }

  return json({ ok: true, payment: updateResult.data?.[0] || null });
}

function normalizeStatus(status) {
  return String(status || "").toLowerCase() === "rejected" ? "rejected" : "approved";
}

function normalizePlan(plan) {
  return PLAN_AMOUNTS[String(plan || "").toLowerCase()] ? String(plan).toLowerCase() : "pro";
}

function addOneMonth(date) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  return next;
}
