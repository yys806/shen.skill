import { ADMIN_EMAIL, isAdmin, verifySupabaseUser } from "./_shared/auth.js";
import { json } from "./_shared/json.js";
import { supabaseAdminRequest } from "./_shared/supabase-admin.js";

const PLAN_AMOUNTS = { plus: 19, pro: 49 };

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

  let current = {};
  if (status === "approved") {
    const currentEntitlement = await queryEntitlement(payment.user_id);
    if (!currentEntitlement.ok) {
      return json({ error: "Entitlement query failed", detail: currentEntitlement.detail }, currentEntitlement.status || 500);
    }
    current = currentEntitlement.data?.[0] || {};
    updatePayload.starts_at = now.toISOString();
    updatePayload.ends_at = calculateNextEndsAt(payment, current, now).toISOString();
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
    const currentBonus = Number(current.quota_bonus || 0);
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
        quota_bonus: Math.max(0, currentBonus + Number(payment.quota_delta || 0)),
        current_period_ends_at: updatePayload.ends_at,
        updated_at: now.toISOString()
      })
    });
    if (!entitlementResult.ok) {
      return json({ error: "Entitlement update failed", detail: entitlementResult.detail }, entitlementResult.status || 500);
    }
    await createPaymentNotification(payment, "success", updatePayload.ends_at);
  } else if (status === "rejected") {
    await createPaymentNotification(payment, "failed", null, reviewNote);
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

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + Math.max(1, Number(months || 1)));
  return next;
}

function calculateNextEndsAt(payment, entitlement, now) {
  const currentEndsAt = entitlement.current_period_ends_at ? new Date(entitlement.current_period_ends_at) : null;
  const base = currentEndsAt && currentEndsAt.getTime() > now.getTime() ? currentEndsAt : now;
  if (payment.action === "upgrade" && Number(payment.period_months || 1) <= 1) return base;
  return addMonths(base, payment.period_months || 1);
}

async function queryEntitlement(userId) {
  const query = new URLSearchParams({
    select: "quota_bonus,current_period_ends_at",
    user_id: `eq.${userId}`,
    limit: "1"
  });
  return supabaseAdminRequest(`/user_entitlements?${query}`);
}

async function createPaymentNotification(payment, result, endsAt, reviewNote = "") {
  const success = result === "success";
  const title = success
    ? `${planLabel(payment.plan)} ${actionLabel(payment.action)}已通过`
    : `${planLabel(payment.plan)} ${actionLabel(payment.action)}未通过`;
  const body = success
    ? `你的 ${planLabel(payment.plan)} ${cycleLabel(payment.billing_cycle)}支付已核对成功，已追加 ${payment.quota_delta || 0} 次额度，订阅有效期至 ${new Date(endsAt).toLocaleString("zh-CN")}。`
    : `你的 ${planLabel(payment.plan)} 支付记录未通过审核。${reviewNote ? `原因：${reviewNote}` : "请检查付款信息后重新提交，或联系管理员处理退款。"} `;
  return supabaseAdminRequest("/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({
      audience: "user",
      target_user_id: payment.user_id,
      target_email: payment.user_email,
      type: success ? "payment_success" : "payment_failed",
      title,
      body,
      created_by_email: ADMIN_EMAIL
    })
  });
}

function planLabel(plan) {
  return plan === "plus" ? "Plus" : "Pro";
}

function actionLabel(action) {
  if (action === "renew") return "续费";
  if (action === "upgrade") return "升级";
  return "开通";
}

function cycleLabel(cycle) {
  return cycle === "yearly" ? "年付" : "月付";
}
