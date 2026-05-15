import { randomBytes } from "node:crypto";
import { requireAdmin } from "./_shared/admin.js";
import { json } from "./_shared/json.js";
import { supabaseAdminRequest } from "./_shared/supabase-admin.js";
import { CODE_GROUPS, normalizeCode, normalizeGroup } from "./_shared/membership.js";

export default async (req) => {
  const authResult = await requireAdmin(req);
  if (!authResult.ok) {
    return json({ error: authResult.status === 401 ? "Unauthorized" : "Forbidden", detail: authResult.detail }, authResult.status);
  }

  if (req.method === "GET") return listCodes(req);
  if (req.method === "POST") return createCodes(req, authResult.user);
  if (req.method === "PATCH") return updateCode(req);
  return json({ error: "Method not allowed" }, 405);
};

export const config = {
  path: "/api/admin/membership-codes",
  method: ["GET", "POST", "PATCH"]
};

async function listCodes(req) {
  const url = new URL(req.url);
  const group = normalizeGroup(url.searchParams.get("group"));
  const status = normalizeStatus(url.searchParams.get("status"), true);
  const query = new URLSearchParams({
    select: "id,code,group_key,plan,billing_cycle,quota_delta,period_months,status,note,created_by_email,redeemed_by_email,redeemed_at,created_at,updated_at",
    order: "created_at.desc",
    limit: "300"
  });
  if (group) query.set("group_key", `eq.${group}`);
  if (status) query.set("status", `eq.${status}`);

  const result = await supabaseAdminRequest(`/membership_codes?${query}`);
  if (!result.ok) return json({ error: "Code query failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, groups: publicGroups(), codes: result.data || [] });
}

async function createCodes(req, user) {
  const body = await req.json().catch(() => ({}));
  const groupKey = normalizeGroup(body.groupKey);
  const count = Math.min(100, Math.max(1, Number(body.count || 1)));
  const note = String(body.note || "").trim();
  if (!groupKey) return json({ error: "Invalid group", detail: "请选择要生成的卡密组。" }, 400);

  const group = CODE_GROUPS[groupKey];
  const rows = Array.from({ length: count }, () => ({
    code: generateCode(groupKey),
    group_key: groupKey,
    plan: group.plan,
    billing_cycle: group.billingCycle,
    quota_delta: group.quotaDelta,
    period_months: group.periodMonths,
    status: "unused",
    note,
    created_by_email: user.email
  }));

  const result = await supabaseAdminRequest("/membership_codes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify(rows)
  });
  if (!result.ok) return json({ error: "Code create failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, groups: publicGroups(), codes: result.data || [] });
}

async function updateCode(req) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const status = normalizeStatus(body.status, false);
  const note = String(body.note || "").trim();
  if (!id) return json({ error: "Missing id", detail: "缺少卡密 ID。" }, 400);
  if (!status) return json({ error: "Invalid status", detail: "状态只能是 unused / disabled。" }, 400);

  const result = await supabaseAdminRequest(`/membership_codes?${new URLSearchParams({ id: `eq.${id}` })}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({ status, note })
  });
  if (!result.ok) return json({ error: "Code update failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, code: result.data?.[0] || null });
}

function generateCode(groupKey) {
  const prefix = {
    plus_monthly: "PM",
    plus_yearly: "PY",
    pro_monthly: "RM",
    pro_yearly: "RY"
  }[groupKey] || "MR";
  const chunks = [
    randomBytes(4).toString("hex"),
    randomBytes(4).toString("hex"),
    randomBytes(3).toString("hex")
  ].map(part => part.toUpperCase());
  return normalizeCode(`${prefix}-${chunks.join("-")}`);
}

function normalizeStatus(raw, allowEmpty) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value && allowEmpty) return "";
  return ["unused", "redeemed", "disabled"].includes(value) ? value : "";
}

function publicGroups() {
  return Object.entries(CODE_GROUPS).map(([key, value]) => ({ key, ...value }));
}
