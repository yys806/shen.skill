import { getEnv } from "./env.js";

// 管理员邮箱优先读环境变量 ADMIN_EMAILS（逗号分隔）；未配置时回退到默认邮箱保持兼容。
const DEFAULT_ADMIN_EMAILS = ["3492675568@qq.com"];

export function getAdminEmails() {
  const parsed = getEnv("ADMIN_EMAILS")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_ADMIN_EMAILS;
}

// 兼容旧引用：主管理员邮箱，用于提示文案和默认署名。
export const ADMIN_EMAIL = getAdminEmails()[0];

export function isAdminEmail(email) {
  return getAdminEmails().includes(String(email || "").trim().toLowerCase());
}

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
  return isAdminEmail(user?.email);
}
