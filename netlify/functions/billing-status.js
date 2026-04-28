import { verifySupabaseUser } from "./_shared/auth.js";
import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";

export default async (req) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  }

  const query = new URLSearchParams({
    select: "plan,status,provider,current_period_ends_at,updated_at",
    user_id: `eq.${authResult.user.id}`,
    limit: "1"
  });
  const result = await queryOwnEntitlement(query, authResult.authorization);

  if (!result.ok) {
    return json({ error: "Billing status failed", detail: result.detail }, result.status || 500);
  }

  const entitlement = result.data?.[0] || {
    plan: "free",
    status: "inactive",
    provider: null,
    current_period_ends_at: null,
    updated_at: null
  };

  return json({
    ok: true,
    entitlement,
    isPro: entitlement.plan === "pro" && ["active", "trialing"].includes(entitlement.status)
  });
};

export const config = {
  path: "/api/billing/status",
  method: ["GET"]
};

async function queryOwnEntitlement(query, authorization) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/user_entitlements?${query}`, {
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": authorization,
        "Accept": "application/json"
      }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, detail: data?.message || response.statusText };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, status: 500, detail: error.message };
  }
}
