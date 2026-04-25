import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";
import { loadSkillPrompt } from "./_shared/skill.js";

const SILICONFLOW_URL = "https://api.siliconflow.cn/v1/chat/completions";
const UPSTREAM_TIMEOUT_MS = 25_000;

const sceneInstructions = {
  self: "当前语气场景是真我复盘：默认理性、短句、拆动机、拆情绪触发点、拆下一步，不要亲密关系口吻。",
  work: "当前语气场景是工作科研：严谨、清楚、可执行，优先给结构化判断、风险、下一步。",
  friend: "当前语气场景是朋友室友：更松弛，可以接梗和吐槽，但不要失去解决问题的方向。",
  family: "当前语气场景是家人：简短、报备、让人放心，少讲大道理。",
  relationship: "当前语气场景是亲密关系：更软、更会哄人，但仍然尊重边界和真实情绪。"
};

export default async (req) => {
  try {
    return await handleChat(req);
  } catch (error) {
    console.error("Unhandled chat error", error);
    return json({
      error: "Chat function crashed",
      detail: error?.message || "未知服务器错误。"
    }, 500);
  }
};

async function handleChat(req) {
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

  const body = await readRequestJson(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const counterpart = cleanText(body.counterpart || "");
  const scene = cleanText(body.scene || "self");
  const skill = cleanText(body.skill || "shen.skill");
  const temperature = clamp(Number(body.temperature ?? 0.72), 0, 1.5);
  const model = cleanText(body.model || getEnv("SILICONFLOW_MODEL", "Pro/moonshotai/Kimi-K2.6"));

  if (!messages.length) {
    return json({ error: "messages is required" }, 400);
  }

  const skillPrompt = await loadSkillPrompt(skill);
  const systemPrompt = [
    skillPrompt,
    "",
    "## 网页封装运行规则",
    "- 你正在作为所选 skill 的网页聊天人格运行。",
    "- Dock 栏里的选择是强约束，不是装饰；必须按当前对话设置执行。",
    "- 回答要短，不要 AI 长篇；先像人一样接住，再给判断或建议。",
    "- 不要声称自己真的就是某个现实本人；你是基于 skill 的人格镜像。",
    `- 当前 skill：${skill}`,
    `- 当前登录用户：${authResult.user?.email || authResult.user?.id || "unknown"}`,
    `- 当前对话对象关系：${counterpart || "未填写；如身份影响很大，先问对方是谁。"}`,
    `- 当前语气场景：${scene}`,
    `- 场景执行说明：${sceneInstructions[scene] || sceneInstructions.self}`,
    "- 如果用户在消息里显式改变身份或场景，以用户最新消息为准，但回答时要说明你已按新场景切换。"
  ].join("\n");

  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    response = await fetch(SILICONFLOW_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
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
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return json({
      error: aborted ? "SiliconFlow timeout" : "SiliconFlow network error",
      detail: aborted
        ? "模型响应超过 25 秒，已主动中断。可以换一个更快的模型，或稍后重试。"
        : `无法连接 SiliconFlow：${error.message}`
    }, 502);
  } finally {
    clearTimeout(timeout);
  }

  const data = await readResponseBody(response);
  if (!response.ok) {
    return json({
      error: "SiliconFlow request failed",
      detail: formatUpstreamDetail(data, response.status)
    }, response.status >= 500 ? 502 : response.status);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    return json({
      error: "Empty model response",
      detail: "SiliconFlow 返回成功，但没有 choices[0].message.content。"
    }, 502);
  }

  return json({
    content,
    user: authResult.user?.email || authResult.user?.id || null
  });
}

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

  let response;
  try {
    response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json"
      }
    });
  } catch (error) {
    return { ok: false, detail: `Supabase 网络错误：${error.message}` };
  }

  const user = await readResponseBody(response);
  if (!response.ok) {
    return { ok: false, detail: user?.msg || user?.message || "登录状态无效，请重新登录。" };
  }

  return { ok: true, user };
}

async function readRequestJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function readResponseBody(response) {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text, parseError: "invalid json" };
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, contentType };
  }
}

function formatUpstreamDetail(data, status) {
  if (!data) return `上游返回 HTTP ${status}，但没有响应体。`;
  if (typeof data === "string") return data;
  if (data.error?.message) return data.error.message;
  if (typeof data.error === "string") return data.error;
  if (data.message) return data.message;
  if (data.raw) return `上游返回非 JSON 内容：${String(data.raw).replace(/\s+/g, " ").slice(0, 260)}`;
  return JSON.stringify(data).slice(0, 400);
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
