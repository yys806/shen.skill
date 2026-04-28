import { verifySupabaseUser } from "./_shared/auth.js";
import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";
import { checkRateLimit } from "./_shared/rate-limit.js";

export default async (req) => {
  if (!["GET", "POST"].includes(req.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  }

  if (req.method === "GET") {
    const result = await listOwnSubmissions(authResult.authorization, authResult.user.id);
    if (!result.ok) {
      return json({ error: "Submission query failed", detail: result.detail }, 500);
    }
    return json({ ok: true, submissions: result.data || [] });
  }

  const body = await req.json().catch(() => ({}));
  const name = cleanText(body.name, 80);
  const repoUrl = cleanText(body.repoUrl, 320);
  const description = cleanText(body.description, 1200);

  if (!name || !repoUrl || !description) {
    return json({ error: "Missing fields", detail: "名称、GitHub 仓库地址和简要说明都要填写。" }, 400);
  }

  if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/.test(repoUrl.replace(/\.git$/, ""))) {
    return json({ error: "Invalid GitHub URL", detail: "请提交有效的 GitHub 仓库地址。" }, 400);
  }

  const rateLimit = await checkRateLimit(req, authResult.user.id, "skill_submit", 5, 86_400_000);
  if (!rateLimit.ok) {
    return json({ error: "Rate limited", detail: rateLimit.detail }, 429);
  }

  const payload = {
    user_id: authResult.user.id,
    submitter_email: authResult.user.email || "",
    name,
    repo_url: normalizeRepoUrl(repoUrl),
    description,
    status: "pending"
  };

  const result = await insertSubmission(authResult.authorization, payload);
  if (!result.ok) {
    return json({ error: "Submission insert failed", detail: result.detail }, 500);
  }

  return json({ ok: true, submission: result.data?.[0] || null });
};

export const config = {
  path: "/api/skill-submissions",
  method: ["GET", "POST"]
};

async function listOwnSubmissions(authorization, userId) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  const query = new URLSearchParams({
    select: "id,name,repo_url,description,status,review_note,created_at,updated_at",
    user_id: `eq.${userId}`,
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

async function insertSubmission(authorization, payload) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/skill_submissions`, {
      method: "POST",
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": authorization,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, detail: data?.message || "写入失败。请确认 Supabase 已执行最新 schema.sql。" };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, detail: `Supabase 写入失败：${error.message}` };
  }
}

function cleanText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeRepoUrl(repoUrl) {
  const normalized = repoUrl.replace(/\/$/, "");
  return normalized.endsWith(".git") ? normalized : `${normalized}.git`;
}
