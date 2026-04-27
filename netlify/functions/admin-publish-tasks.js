import { ADMIN_EMAIL, isAdmin, verifySupabaseUser } from "./_shared/auth.js";
import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";

export default async (req) => {
  if (!["GET", "POST"].includes(req.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  }

  if (!isAdmin(authResult.user)) {
    return json({ error: "Forbidden", detail: `只有管理员 ${ADMIN_EMAIL} 可以管理发布任务。` }, 403);
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const submissionId = String(body.submissionId || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(submissionId)) {
      return json({ error: "Invalid submission id", detail: "提交记录 ID 不正确。" }, 400);
    }

    const submissionResult = await getSubmission(authResult.authorization, submissionId);
    if (!submissionResult.ok) {
      return json({ error: "Submission query failed", detail: submissionResult.detail }, 500);
    }
    const submission = submissionResult.data?.[0];
    if (!submission) {
      return json({ error: "Submission not found", detail: "没有找到这条 skill 提交。" }, 404);
    }
    if (!["approved", "published"].includes(submission.status)) {
      return json({ error: "Submission not approved", detail: "只有已通过的 skill 才能生成发布任务。" }, 400);
    }

    const result = await createTask(authResult.authorization, {
      submission_id: submission.id,
      repo_url: submission.repo_url,
      skill_name: submission.name,
      status: "pending",
      created_by_email: authResult.user.email || ""
    });
    if (!result.ok) {
      return json({ error: "Publish task insert failed", detail: result.detail }, 500);
    }
    return json({ ok: true, task: result.data?.[0] || null });
  }

  const result = await listTasks(authResult.authorization);
  if (!result.ok) {
    return json({ error: "Publish task query failed", detail: result.detail }, 500);
  }
  return json({ ok: true, tasks: result.data || [] });
};

export const config = {
  path: "/api/admin/publish-tasks",
  method: ["GET", "POST"]
};

async function getSubmission(authorization, id) {
  const supabaseUrl = getSupabaseUrl();
  const query = new URLSearchParams({
    select: "id,name,repo_url,status",
    id: `eq.${id}`
  });
  return restRequest(`${supabaseUrl}/rest/v1/skill_submissions?${query}`, authorization);
}

async function createTask(authorization, payload) {
  const supabaseUrl = getSupabaseUrl();
  return restRequest(`${supabaseUrl}/rest/v1/skill_publish_tasks`, authorization, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    }
  });
}

async function listTasks(authorization) {
  const supabaseUrl = getSupabaseUrl();
  const query = new URLSearchParams({
    select: "id,submission_id,repo_url,skill_name,status,created_by_email,created_at,updated_at",
    order: "created_at.desc"
  });
  return restRequest(`${supabaseUrl}/rest/v1/skill_publish_tasks?${query}`, authorization);
}

async function restRequest(url, authorization, options = {}) {
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": authorization,
        "Accept": "application/json",
        ...(options.headers || {})
      },
      body: options.body
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, detail: data?.message || response.statusText };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, detail: error.message };
  }
}

function getSupabaseUrl() {
  return getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
}
