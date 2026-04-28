import { verifySupabaseUser } from "./_shared/auth.js";
import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";
import { paddleRequest } from "./_shared/paddle.js";
import { supabaseAdminRequest } from "./_shared/supabase-admin.js";

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const plan = String(body.plan || "pro").toLowerCase() === "plus" ? "plus" : "pro";
  const priceId = plan === "plus"
    ? getEnv("PADDLE_PLUS_PRICE_ID", getEnv("PADDLE_PRICE_ID"))
    : getEnv("PADDLE_PRO_PRICE_ID", getEnv("PADDLE_PRICE_ID"));
  if (!priceId) {
    return json({ error: "Billing not configured", detail: `请先配置 ${plan === "plus" ? "PADDLE_PLUS_PRICE_ID" : "PADDLE_PRO_PRICE_ID"}。` }, 500);
  }

  const user = authResult.user;
  const transaction = await paddleRequest("/transactions", {
    method: "POST",
    body: {
      items: [{ price_id: priceId, quantity: 1 }],
      custom_data: {
        user_id: user.id,
        email: user.email || "",
        plan
      }
    }
  });

  if (!transaction.ok) {
    return json({
      error: "Paddle transaction failed",
      detail: transaction.detail,
      paddle: transaction.data
    }, transaction.status || 500);
  }

  const paddleTransaction = transaction.data?.data || {};
  const checkoutUrl = paddleTransaction.checkout?.url;
  if (!checkoutUrl) {
    return json({
      error: "Paddle checkout unavailable",
      detail: "Paddle 已创建交易，但没有返回 checkout.url。请确认 Paddle 默认支付链接已配置。",
      paddle: transaction.data
    }, 502);
  }

  await supabaseAdminRequest("/checkout_sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({
      user_id: user.id,
      provider: "paddle",
      provider_transaction_id: paddleTransaction.id,
      checkout_url: checkoutUrl,
      status: paddleTransaction.status || "created"
    })
  });

  return json({
    ok: true,
    checkoutUrl,
    transactionId: paddleTransaction.id
  });
};

export const config = {
  path: "/api/billing/checkout",
  method: ["POST"]
};
