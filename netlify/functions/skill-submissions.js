import { verifySupabaseUser } from "./_shared/auth.js";
import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";
import { checkRateLimit } from "./_shared/rate-limit.js";

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  }

  const rateLimit = await checkRateLimit(req, authResult.user.id, "skill_submit", 5, 86_400_000);
  if (!rateLimit.ok) {
    return json({ error: "Rate limited", detail: rateLimit.detail }, 429);
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

  const validation = await validateGithubSkill(repoUrl);
  if (!validation.ok) {
    return json({ error: "Auto review failed", detail: validation.detail }, 400);
  }

  const payload = {
    user_id: authResult.user.id,
    submitter_email: authResult.user.email || "",
    name,
    repo_url: validation.repoUrl,
    description,
    status: "approved",
    review_note: [
      "自动审核通过：仓库可访问，根目录存在 SKILL.md，文件大小符合限制。",
      `SKILL.md: ${validation.size} bytes`
    ].join("\n")
  };

  const result = await insertSubmission(authResult.authorization, payload);
  if (!result.ok) {
    return json({ error: "Submission insert failed", detail: result.detail }, 500);
  }

  const submission = result.data?.[0] || null;
  const taskResult = submission?.id
    ? await queuePublishTask(authResult.authorization, submission.id)
    : { ok: false, detail: "没有拿到提交记录 ID。" };
  if (!taskResult.ok) {
    return json({
      error: "Publish task queue failed",
      detail: `skill 已自动审核通过，但发布任务生成失败：${taskResult.detail}`,
      submission
    }, 500);
  }

  return json({ ok: true, autoApproved: true, submission, publishTask: taskResult.data });
};

export const config = {
  path: "/api/skill-submissions",
  method: ["POST"]
};

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

async function queuePublishTask(authorization, submissionId) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/auto_queue_skill_publish_task`, {
      method: "POST",
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ submission_id_input: submissionId })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, detail: data?.message || "发布任务生成失败。请确认 Supabase 已执行最新 schema.sql。" };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, detail: `Supabase 发布任务生成失败：${error.message}` };
  }
}

async function validateGithubSkill(repoUrl) {
  const normalized = repoUrl.replace(/\.git$/, "").replace(/\/$/, "");
  const match = normalized.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)$/);
  if (!match) {
    return { ok: false, detail: "GitHub 仓库地址格式不正确。" };
  }

  const [, owner, repo] = match;
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/SKILL.md`;
  try {
    const response = await fetch(apiUrl, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "mirror-room-skill-reviewer"
      }
    });
    const data = await response.json().catch(() => null);
    if (response.status === 404) {
      return { ok: false, detail: "自动审核未通过：仓库根目录必须包含 SKILL.md。" };
    }
    if (!response.ok) {
      return { ok: false, detail: `自动审核暂时无法访问 GitHub：${data?.message || response.statusText}` };
    }
    if (data?.type !== "file") {
      return { ok: false, detail: "自动审核未通过：SKILL.md 必须是文件。" };
    }
    if (Number(data.size || 0) < 200) {
      return { ok: false, detail: "自动审核未通过：SKILL.md 太短，无法发布。" };
    }
    if (Number(data.size || 0) > 250_000) {
      return { ok: false, detail: "自动审核未通过：SKILL.md 超过 250KB，请先精简。" };
    }
    return {
      ok: true,
      repoUrl: `${normalized}.git`,
      size: Number(data.size || 0)
    };
  } catch (error) {
    return { ok: false, detail: `自动审核访问 GitHub 失败：${error.message}` };
  }
}

function cleanText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}
