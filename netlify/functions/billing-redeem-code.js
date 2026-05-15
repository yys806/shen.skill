import { verifySupabaseUser } from "./_shared/auth.js";
import { json } from "./_shared/json.js";
import { supabaseAdminRequest } from "./_shared/supabase-admin.js";
import { calculateNextEndsAt, normalizeCode } from "./_shared/membership.js";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) return json({ error: "Unauthorized", detail: authResult.detail }, 401);

  const body = await req.json().catch(() => ({}));
  const code = normalizeCode(body.code);
  if (code.length < 8) {
    return json({ error: "Invalid code", detail: "请输入有效卡密。" }, 400);
  }

  const codeResult = await supabaseAdminRequest(`/membership_codes?${new URLSearchParams({
    select: "*",
    code: `eq.${code}`,
    limit: "1"
  })}`);
  if (!codeResult.ok) return json({ error: "Code query failed", detail: codeResult.detail }, codeResult.status || 500);

  const card = codeResult.data?.[0];
  if (!card) return json({ error: "Code not found", detail: "卡密不存在，请检查后重新输入。" }, 404);
  if (card.status !== "unused") {
    return json({
      error: "Code unavailable",
      detail: card.status === "redeemed" ? "这张卡密已经被兑换过。" : "这张卡密已被禁用。"
    }, 409);
  }

  const entitlement = await queryEntitlement(authResult.user.id);
  if (!entitlement.ok) {
    return json({ error: "Entitlement query failed", detail: entitlement.detail }, entitlement.status || 500);
  }
  const current = entitlement.data?.[0] || {};
  if (isUpgradeCode(card) && !isActivePlus(current)) {
    return json({
      error: "Upgrade code not allowed",
      detail: "这是一张 Plus 升 Pro 差价卡密，只有当前有效的 Plus 用户可以兑换。"
    }, 403);
  }

  const redeemResult = await markCodeRedeemed(card, authResult.user);
  if (!redeemResult.ok || !redeemResult.data?.length) {
    return json({
      error: "Code redeem race",
      detail: "卡密状态更新失败，可能刚刚已被使用。请刷新后再试。"
    }, 409);
  }

  const endsAt = calculateNextEndsAt({
    currentEndsAt: current.current_period_ends_at,
    periodMonths: card.period_months
  }).toISOString();
  const quotaBonus = Math.max(0, Number(current.quota_bonus || 0) + Number(card.quota_delta || 0));

  const updateEntitlement = await supabaseAdminRequest("/user_entitlements?on_conflict=user_id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify({
      user_id: authResult.user.id,
      plan: card.plan,
      status: "active",
      provider: "membership_code",
      provider_transaction_id: card.code,
      quota_bonus: quotaBonus,
      current_period_ends_at: endsAt,
      updated_at: new Date().toISOString()
    })
  });
  if (!updateEntitlement.ok) {
    await restoreCode(card.id);
    return json({
      error: "Entitlement update failed",
      detail: "会员权益更新失败，卡密已回滚为未使用，请稍后重试。"
    }, updateEntitlement.status || 500);
  }

  await createRedeemNotification(authResult.user, card, endsAt);

  return json({
    ok: true,
    entitlement: updateEntitlement.data?.[0] || null,
    code: {
      groupKey: card.group_key,
      plan: card.plan,
      billingCycle: card.billing_cycle,
      periodMonths: card.period_months,
      quotaDelta: card.quota_delta
    }
  });
};

export const config = {
  path: "/api/billing/redeem-code",
  method: ["POST"]
};

function markCodeRedeemed(card, user) {
  return supabaseAdminRequest(`/membership_codes?${new URLSearchParams({ id: `eq.${card.id}`, status: "eq.unused" })}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({
      status: "redeemed",
      redeemed_by_user_id: user.id,
      redeemed_by_email: user.email,
      redeemed_at: new Date().toISOString()
    })
  });
}

async function restoreCode(id) {
  await supabaseAdminRequest(`/membership_codes?${new URLSearchParams({ id: `eq.${id}` })}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "unused",
      redeemed_by_user_id: null,
      redeemed_by_email: null,
      redeemed_at: null
    })
  });
}

async function queryEntitlement(userId) {
  return supabaseAdminRequest(`/user_entitlements?${new URLSearchParams({
    select: "user_id,plan,status,quota_bonus,current_period_ends_at",
    user_id: `eq.${userId}`,
    limit: "1"
  })}`);
}

function isUpgradeCode(card) {
  return String(card.group_key || "").startsWith("plus_to_pro_");
}

function isActivePlus(entitlement) {
  const endsAt = entitlement.current_period_ends_at ? new Date(entitlement.current_period_ends_at) : null;
  return entitlement.plan === "plus"
    && entitlement.status === "active"
    && endsAt
    && endsAt.getTime() > Date.now();
}

async function createRedeemNotification(user, card, endsAt) {
  const title = `${planLabel(card.plan)} ${card.billing_cycle === "yearly" ? "年度" : "月度"}会员已开通`;
  const upgradeText = isUpgradeCode(card) ? "Plus 已升级为 Pro，" : "";
  const body = `卡密兑换成功，${upgradeText}已追加 ${card.quota_delta} 次额度，会员有效期至 ${new Date(endsAt).toLocaleString("zh-CN")}。`;
  await supabaseAdminRequest("/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audience: "user",
      target_user_id: user.id,
      target_email: user.email,
      type: "payment_success",
      title,
      body,
      created_by_email: "system"
    })
  });
}

function planLabel(plan) {
  return plan === "pro" ? "Pro" : "Plus";
}
