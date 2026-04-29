import { verifySupabaseUser } from "./_shared/auth.js";
import { json } from "./_shared/json.js";
import { supabaseAdminRequest } from "./_shared/supabase-admin.js";

const PLAN_AMOUNTS = {
  plus: 19,
  pro: 49
};

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const plan = normalizePlan(body.plan);
  const paymentMethod = normalizePaymentMethod(body.paymentMethod);
  const payerName = String(body.payerName || "").trim();

  if (!payerName) {
    return json({ error: "Missing payer name", detail: "请填写付款时显示的微信/支付宝用户名。" }, 400);
  }

  const insertResult = await supabaseAdminRequest("/payment_requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({
      user_id: authResult.user.id,
      user_email: authResult.user.email || "",
      plan,
      amount_cny: PLAN_AMOUNTS[plan],
      payment_method: paymentMethod,
      payer_name: payerName,
      status: "pending"
    })
  });

  if (!insertResult.ok) {
    return json({ error: "Payment request failed", detail: insertResult.detail }, insertResult.status || 500);
  }

  return json({ ok: true, paymentRequest: insertResult.data?.[0] || null });
};

export const config = {
  path: "/api/billing/payment-requests",
  method: ["POST"]
};

function normalizePlan(plan) {
  return String(plan || "").toLowerCase() === "plus" ? "plus" : "pro";
}

function normalizePaymentMethod(method) {
  return String(method || "").toLowerCase() === "alipay" ? "alipay" : "wechat";
}
