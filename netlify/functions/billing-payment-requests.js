import { verifySupabaseUser } from "./_shared/auth.js";
import { json } from "./_shared/json.js";
import { supabaseAdminRequest } from "./_shared/supabase-admin.js";

const PLAN_AMOUNTS = {
  monthly: {
    plus: 19,
    pro: 49,
    upgrade_plus_to_pro: 30
  },
  yearly: {
    plus: 199,
    pro: 399
  }
};

const PLAN_QUOTA = {
  plus: 500,
  pro: 2000
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
  const billingCycle = String(body.billingCycle || "").toLowerCase() === "yearly" ? "yearly" : "monthly";
  const paymentMethod = normalizePaymentMethod(body.paymentMethod);
  const payerName = String(body.payerName || "").trim();

  if (!payerName) {
    return json({ error: "Missing payer name", detail: "请填写付款时显示的微信/支付宝用户名。" }, 400);
  }

  const entitlement = await queryEntitlement(authResult.user.id);
  if (!entitlement.ok) {
    return json({ error: "Entitlement query failed", detail: entitlement.detail }, entitlement.status || 500);
  }
  const current = entitlement.data?.[0] || {};
  const currentPlan = isEntitlementActive(current) ? normalizeCurrentPlan(current.plan) : "free";
  if (currentPlan === "pro" && plan === "plus") {
    return json({ error: "Already pro", detail: "你已经是 Pro 会员，不需要再购买 Plus。" }, 400);
  }
  const action = currentPlan === plan ? "renew" : (currentPlan === "plus" && plan === "pro" ? "upgrade" : "subscribe");
  const periodMonths = billingCycle === "yearly" ? 12 : 1;
  const quotaDelta = calculateQuotaDelta({ action, plan, billingCycle });
  const amount = calculateAmount({ action, plan, billingCycle });

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
      amount_cny: amount,
      billing_cycle: billingCycle,
      action,
      quota_delta: quotaDelta,
      period_months: periodMonths,
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

function normalizeCurrentPlan(plan) {
  return ["plus", "pro"].includes(String(plan || "").toLowerCase()) ? String(plan).toLowerCase() : "free";
}

function normalizePaymentMethod(method) {
  return String(method || "").toLowerCase() === "alipay" ? "alipay" : "wechat";
}

async function queryEntitlement(userId) {
  const query = new URLSearchParams({
    select: "plan,status,current_period_ends_at,quota_bonus",
    user_id: `eq.${userId}`,
    limit: "1"
  });
  return supabaseAdminRequest(`/user_entitlements?${query}`);
}

function isEntitlementActive(entitlement) {
  if (!entitlement || !["active", "trialing"].includes(entitlement.status)) return false;
  if (!entitlement.current_period_ends_at) return true;
  return new Date(entitlement.current_period_ends_at).getTime() > Date.now();
}

function calculateAmount({ action, plan, billingCycle }) {
  if (action === "upgrade" && billingCycle === "monthly") return PLAN_AMOUNTS.monthly.upgrade_plus_to_pro;
  return PLAN_AMOUNTS[billingCycle][plan];
}

function calculateQuotaDelta({ action, plan, billingCycle }) {
  if (action === "upgrade" && billingCycle === "monthly") return Math.max(0, PLAN_QUOTA.pro - PLAN_QUOTA.plus);
  return PLAN_QUOTA[plan] * (billingCycle === "yearly" ? 12 : 1);
}
