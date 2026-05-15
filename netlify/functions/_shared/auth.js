import { getEnv } from "./env.js";

export const ADMIN_EMAIL = "3492675568@qq.com";

export async function verifySupabaseUser(req) {
  const mirrorResult = await verifyMirrorUser(req);
  if (mirrorResult.ok) return mirrorResult;

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
  return String(user?.email || "").toLowerCase() === ADMIN_EMAIL || user?.role === "admin";
}

async function verifyMirrorUser(req) {
  const base = getEnv("MIRROR_API_BASE", "http://[2607:f130:0000:0174:0000:0000:0ca5:58a6]").replace(/\/$/, "");
  const authorization = req.headers.get("authorization") || "";
  if (!authorization) return { ok: false, detail: "请先登录。" };
  try {
    const response = await fetch(`${base}/api/auth/session`, {
      headers: {
        "Authorization": authorization,
        "Accept": "application/json"
      }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.user) return { ok: false, detail: data?.detail || "登录状态无效，请重新登录。" };
    return { ok: true, user: data.user, authorization };
  } catch {
    return { ok: false, detail: "自托管认证服务暂不可用。" };
  }
}
