import { ADMIN_EMAIL, isAdmin, verifySupabaseUser } from "./_shared/auth.js";
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

  if (!isAdmin(authResult.user)) {
    return json({ error: "Forbidden", detail: `只有管理员 ${ADMIN_EMAIL} 可以查看用户。` }, 403);
  }

  const result = await listUsers(authResult.authorization);
  if (!result.ok) {
    return json({ error: "User query failed", detail: result.detail }, 500);
  }

  return json({ ok: true, users: result.data || [] });
};

export const config = {
  path: "/api/admin/users",
  method: ["GET"]
};

async function listUsers(authorization) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  const query = new URLSearchParams({
    select: "id,email,nickname,created_at,updated_at",
    order: "created_at.desc"
  });

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?${query}`, {
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": authorization,
        "Accept": "application/json"
      }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, detail: data?.message || "读取用户失败。" };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, detail: `Supabase 读取用户失败：${error.message}` };
  }
}
