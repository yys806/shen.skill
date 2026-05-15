import { getEnv } from "./env.js";

export const ADMIN_EMAIL = "3492675568@qq.com";

export async function verifySupabaseUser(req) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return { ok: false, detail: "请先配置 SUPABASE_URL 和 SUPABASE_ANON_KEY。" };
  }

  if (!token) {
    return { ok: false, detail: "请先登录。" };
  }

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json"
      }
    });
    const user = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, detail: user?.message || "登录状态无效，请重新登录。" };
    return { ok: true, user, authorization };
  } catch (error) {
    return { ok: false, detail: `Supabase 网络错误：${error.message}` };
  }
}

export function isAdmin(user) {
  return String(user?.email || "").toLowerCase() === ADMIN_EMAIL;
}
