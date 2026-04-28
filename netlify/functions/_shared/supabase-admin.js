import { getEnv } from "./env.js";

export function hasSupabaseAdmin() {
  return Boolean(getEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

export async function supabaseAdminRequest(path, options = {}) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    return { ok: false, status: 500, detail: "请先配置 SUPABASE_SERVICE_ROLE_KEY。" };
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1${path}`, {
      method: options.method || "GET",
      headers: {
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Accept": "application/json",
        ...(options.headers || {})
      },
      body: options.body
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, status: response.status, detail: data?.message || response.statusText, data };
    }
    return { ok: true, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 500, detail: error.message };
  }
}
