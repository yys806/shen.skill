import { json } from "./_shared/json.js";
import { verifyPaddleSignature } from "./_shared/paddle.js";
import { supabaseAdminRequest } from "./_shared/supabase-admin.js";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const rawBody = await req.text();
  const signature = req.headers.get("Paddle-Signature") || req.headers.get("paddle-signature");
  const verification = verifyPaddleSignature(rawBody, signature);
  if (!verification.ok) {
    return json({ error: "Invalid signature", detail: verification.detail }, 401);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON", detail: "Webhook body 不是有效 JSON。" }, 400);
  }

  const eventId = event.event_id || event.id;
  if (!eventId || !event.event_type) {
    return json({ error: "Invalid event", detail: "Webhook 缺少 event_id 或 event_type。" }, 400);
  }

  await supabaseAdminRequest("/billing_events?on_conflict=id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "resolution=ignore-duplicates,return=minimal"
    },
    body: JSON.stringify({
      id: eventId,
      event_type: event.event_type,
      payload: event
    })
  });

  const handled = await processPaddleEvent(event);
  if (!handled.ok) {
    return json({ error: "Webhook processing failed", detail: handled.detail }, handled.status || 500);
  }

  return json({ ok: true, handled: handled.handled });
};

export const config = {
  path: "/api/webhooks/paddle",
  method: ["POST"]
};

async function processPaddleEvent(event) {
  const data = event.data || {};

  if (event.event_type === "transaction.completed") {
    const userId = data.custom_data?.user_id;
    if (!userId) return { ok: true, handled: false };

    return upsertEntitlement({
      user_id: userId,
      plan: data.custom_data?.plan || "pro",
      status: "active",
      provider: "paddle",
      provider_customer_id: data.customer_id || null,
      provider_subscription_id: data.subscription_id || null,
      provider_transaction_id: data.id || null,
      current_period_ends_at: pickPeriodEnd(data)
    });
  }

  if (event.event_type?.startsWith("subscription.")) {
    const userId = data.custom_data?.user_id;
    if (!userId) return { ok: true, handled: false };

    return upsertEntitlement({
      user_id: userId,
      plan: data.custom_data?.plan || "pro",
      status: normalizeSubscriptionStatus(data.status),
      provider: "paddle",
      provider_customer_id: data.customer_id || null,
      provider_subscription_id: data.id || null,
      provider_transaction_id: null,
      current_period_ends_at: pickPeriodEnd(data)
    });
  }

  return { ok: true, handled: false };
}

async function upsertEntitlement(payload) {
  const result = await supabaseAdminRequest("/user_entitlements?on_conflict=user_id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      ...payload,
      updated_at: new Date().toISOString()
    })
  });

  if (!result.ok) return result;
  return { ok: true, handled: true };
}

function normalizeSubscriptionStatus(status) {
  if (ACTIVE_STATUSES.has(status)) return status;
  return status || "inactive";
}

function pickPeriodEnd(data) {
  return data.current_billing_period?.ends_at
    || data.billing_period?.ends_at
    || data.next_billed_at
    || null;
}
