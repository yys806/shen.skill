import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";
import { loadSkillPrompt } from "./_shared/skill.js";

const SILICONFLOW_URL = "https://api.siliconflow.cn/v1/chat/completions";

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const apiKey = getEnv("SILICONFLOW_API_KEY");
  if (!apiKey) {
    return json({
      error: "Missing SILICONFLOW_API_KEY",
      detail: "请在 Netlify 环境变量里配置 SILICONFLOW_API_KEY。"
    }, 500);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const counterpart = cleanText(body.counterpart || "");
  const scene = cleanText(body.scene || "self");
  const temperature = clamp(Number(body.temperature ?? 0.72), 0, 1.5);
  const model = cleanText(body.model || getEnv("SILICONFLOW_MODEL", "Qwen/Qwen2.5-72B-Instruct"));

  if (!messages.length) {
    return json({ error: "messages is required" }, 400);
  }

  const skillPrompt = await loadSkillPrompt();
  const systemPrompt = [
    skillPrompt,
    "",
    "## 网页封装运行规则",
    "- 你正在作为 shen.skill 的网页聊天人格运行。",
    "- 回答要短，不要 AI 长篇；先像人一样接住，再给判断或建议。",
    "- 如果对方身份不明确，先问一句“你是谁/你现在希望我按谁的语气来回？”再深入。",
    "- 不要声称自己真的就是禹尧珅本人；你是基于 shen.skill 的人格镜像。",
    `- 当前登录用户：${authResult.user?.email || authResult.user?.id || "unknown"}`,
    `- 当前前端选择的对话对象：${counterpart || "未填写"}`,
    `- 当前前端选择的场景：${scene}`,
    "- 如果用户在消息里显式改变身份或场景，以用户最新消息为准。"
  ].join("\n");

  const response = await fetch(SILICONFLOW_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.slice(-24).map(normalizeMessage)
      ]
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return json({
      error: "SiliconFlow request failed",
      detail: data || response.statusText
    }, response.status);
  }

  return json({
    content: data?.choices?.[0]?.message?.content || "",
    user: authResult.user?.email || authResult.user?.id || null
  });
};

export const config = {
  path: "/api/chat",
  method: ["POST"]
};

async function verifySupabaseUser(req) {
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

  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      "apikey": supabaseAnonKey,
      "Authorization": `Bearer ${token}`
    }
  });

  const user = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, detail: user?.msg || user?.message || "登录状态无效，请重新登录。" };
  }

  return { ok: true, user };
}

function normalizeMessage(message) {
  const role = ["user", "assistant"].includes(message.role) ? message.role : "user";
  return { role, content: String(message.content || "").slice(0, 12000) };
}

function cleanText(value) {
  return String(value || "").trim().slice(0, 200);
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}
