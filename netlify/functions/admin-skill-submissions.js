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
    return json({ error: "Forbidden", detail: `只有管理员 ${ADMIN_EMAIL} 可以查看提交。` }, 403);
  }

  const result = await listSubmissions(authResult.authorization);
  if (!result.ok) {
    return json({ error: "Submission query failed", detail: result.detail }, 500);
  }

  return json({ ok: true, submissions: result.data || [] });
};

export const config = {
  path: "/api/admin/skill-submissions",
  method: ["GET"]
};

async function listSubmissions(authorization) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  const query = new URLSearchParams({
    select: "id,user_id,submitter_email,name,repo_url,description,status,created_at",
    order: "created_at.desc"
  });

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/skill_submissions?${query}`, {
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": authorization,
        "Accept": "application/json"
      }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, detail: data?.message || "读取失败。请确认 Supabase 已执行最新 schema.sql。" };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, detail: `Supabase 读取失败：${error.message}` };
  }
}
