import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const feedback = body.feedback === "like" ? "like" : "dislike";
  const comment = String(body.comment || "").trim().slice(0, 2000);

  if (!comment) {
    return json({ error: "Comment required", detail: "需要填写评论，才会吸收进 skill。" }, 400);
  }

  const payload = {
    user_id: authResult.user.id,
    skill: String(body.skill || "shen.skill").slice(0, 120),
    conversation_id: String(body.conversationId || "").slice(0, 120),
    message_id: String(body.messageId || "").slice(0, 120),
    feedback,
    comment,
    user_message: String(body.userMessage || "").slice(0, 6000),
    assistant_message: String(body.assistantMessage || "").slice(0, 6000),
    settings: body.settings && typeof body.settings === "object" ? body.settings : {},
    absorbed: true
  };

  const result = await insertMemory(req, payload);
  if (!result.ok) {
    return json({ error: "Memory insert failed", detail: result.detail }, 500);
  }

  return json({ ok: true, memory: result.data });
};

export const config = {
  path: "/api/memory",
  method: ["POST"]
};

async function verifySupabaseUser(req) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!token) return { ok: false, detail: "请先登录。" };

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
    return { ok: true, user };
  } catch (error) {
    return { ok: false, detail: `Supabase 网络错误：${error.message}` };
  }
}

async function insertMemory(req, payload) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("authorization") || "";

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/skill_memories`, {
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
    if (!response.ok) return { ok: false, detail: data?.message || response.statusText };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, detail: error.message };
  }
}
