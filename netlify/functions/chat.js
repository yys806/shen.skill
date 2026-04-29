import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";
import { isAdmin, verifySupabaseUser } from "./_shared/auth.js";
import { checkRateLimit } from "./_shared/rate-limit.js";
import { loadSkillPrompt, normalizeSkillId } from "./_shared/skill.js";
import { getProviderConfig, modelExists, normalizeProvider } from "./_shared/providers.js";

const PLAN_LIMITS = {
  free: 50,
  plus: 500,
  pro: 2000,
  admin: null
};

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

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  }

  const quota = await checkMonthlyQuota(req, authResult.user);
  if (!quota.ok) {
    return json({ error: "Quota exceeded", detail: quota.detail }, 429);
  }

  const rateLimit = await checkRateLimit(req, authResult.user.id, "chat", 20, 60_000);
  if (!rateLimit.ok) {
    return json({ error: "Rate limited", detail: rateLimit.detail }, 429);
  }

  const body = await readRequestJson(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const counterpart = cleanText(body.counterpart || "");
  const scene = cleanText(body.scene || "self");
  const skill = await normalizeSkillId(cleanText(body.skill || "maoxuan-skill"), {
    includeDisabled: isAdmin(authResult.user)
  });
  const provider = normalizeProvider(body.provider || "deepseek");
  const temperature = clamp(Number(body.temperature ?? 0.72), 0, 1.5);
  const model = cleanText(body.model || getEnv("DEEPSEEK_MODEL", "deepseek-v4-flash"));
  const providerConfig = getProviderConfig(provider);

  if (!providerConfig.apiKey) {
    return json({
      error: `Missing ${providerConfig.name} API key`,
      detail: `请在 Netlify 环境变量里配置 ${provider.toUpperCase()}_API_KEY。`
    }, 500);
  }

  if (!modelExists(provider, model)) {
    return json({
      error: "Unknown model",
      detail: "当前提供商和模型不匹配，请在模型弹窗里重新选择。"
    }, 400);
  }

  if (!messages.length) {
    return json({ error: "messages is required" }, 400);
  }

  const skillPrompt = await loadSkillPrompt(skill, {
    includeDisabled: isAdmin(authResult.user)
  });
  const memories = await loadRecentMemories(req, authResult.user.id, skill);
  const needsSceneContext = false;
  const contextRules = needsSceneContext
    ? [
        `- 当前对话对象关系：${counterpart || "未填写；如身份影响很大，先问对方是谁。"}`,
        `- 当前语气场景：${scene}`,
        `- 场景执行说明：${sceneInstructions[scene] || sceneInstructions.self}`,
        "- 如果用户在消息里显式改变身份或场景，以用户最新消息为准，但回答时要说明你已按新场景切换。"
      ]
    : [
        "- 当前 skill 不使用“你是谁”和“语气场景”控制项；只按 skill 本身、模型和温度执行。",
        "- 不要追问用户身份，除非问题本身必须明确立场、角色或使用场景。"
      ];
  const systemPrompt = [
    skillPrompt,
    "",
    "## 已吸收的用户反馈记忆",
    memories.length
      ? memories.map((memory, index) => `${index + 1}. [${memory.feedback}] ${memory.comment}`).join("\n")
      : "- 暂无。",
    "",
    "## 网页封装运行规则",
    "- 你正在作为所选 skill 的网页聊天人格运行。",
    "- Dock 栏里的选择是强约束，不是装饰；必须按当前对话设置执行。",
    "- 回答要短，不要 AI 长篇；先像人一样接住，再给判断或建议。",
    "- 不要声称自己真的就是某个现实本人；你是基于 skill 的人格镜像。",
    `- 当前 skill：${skill}`,
    `- 当前模型提供商：${providerConfig.name}`,
    `- 当前模型：${model}`,
    `- 当前登录用户：${authResult.user?.email || authResult.user?.id || "unknown"}`,
    ...contextRules
  ].join("\n");

  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerConfig.timeoutMs);
  const requestBody = {
    model,
    temperature,
    max_tokens: 1200,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.slice(-24).map(normalizeMessage)
    ]
  };
  if (provider === "deepseek") {
    requestBody.thinking = { type: "disabled" };
  }

  try {
    response = await fetch(providerConfig.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${providerConfig.apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...providerConfig.headers
      },
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return json({
      error: aborted ? `${providerConfig.name} timeout` : `${providerConfig.name} network error`,
      detail: aborted
        ? `模型响应超过 ${Math.round(providerConfig.timeoutMs / 1000)} 秒，已主动中断。可以换一个更快的模型，或稍后重试。`
        : `无法连接 ${providerConfig.name}：${error.message}`
    }, 502);
  } finally {
    clearTimeout(timeout);
  }

  const data = await readResponseBody(response);
  if (!response.ok) {
    return json({
      error: `${providerConfig.name} request failed`,
      detail: formatUpstreamDetail(data, response.status)
    }, response.status >= 500 ? 502 : response.status);
  }

  const content = extractAssistantContent(data);
  if (!content) {
    return json({
      error: "Empty model response",
      detail: formatEmptyResponseDetail(providerConfig.name, data)
    }, 502);
  }

  return json({
    content,
    user: authResult.user?.email || authResult.user?.id || null
  });
}

async function loadRecentMemories(req, userId, skill) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("authorization") || "";
  const query = new URLSearchParams({
    select: "feedback,comment,created_at",
    user_id: `eq.${userId}`,
    skill: `eq.${skill}`,
    absorbed: "eq.true",
    order: "created_at.desc",
    limit: "8"
  });

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/skill_memories?${query}`, {
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": authorization,
        "Accept": "application/json"
      }
    });
    if (!response.ok) return [];
    const data = await response.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export const config = {
  path: "/api/chat",
  method: ["POST"]
};

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

function extractAssistantContent(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message || {};
  const parts = [
    message.content,
    message.text,
    choice?.text
  ];
  return parts.find(part => typeof part === "string" && part.trim())?.trim() || "";
}

function formatEmptyResponseDetail(providerName, data) {
  const choice = data?.choices?.[0];
  const message = choice?.message || {};
  const keys = Object.keys(message).join(", ") || "none";
  const finishReason = choice?.finish_reason || "unknown";
  const reasoning = typeof message.reasoning_content === "string"
    ? message.reasoning_content.replace(/\s+/g, " ").slice(0, 180)
    : "";
  return [
    `${providerName} 返回成功，但没有最终回答正文。`,
    `finish_reason=${finishReason}; message_keys=${keys}.`,
    reasoning ? `reasoning_content 预览：${reasoning}` : ""
  ].filter(Boolean).join(" ");
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

async function checkMonthlyQuota(req, user) {
  if (isAdmin(user)) return { ok: true };
  const entitlement = await queryEntitlement(req, user.id);
  const plan = entitlement.active ? normalizePlan(entitlement.plan) : "free";
  const baseLimit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const limit = baseLimit + Number(entitlement.quota_bonus || 0);
  const used = await queryMonthlyUsage(req, user.id);
  if (used >= limit) {
    return {
      ok: false,
      detail: `本月消息额度已用完：${used}/${limit}。可以到“定价说明”续费或升级。`
    };
  }
  return { ok: true };
}

async function queryEntitlement(req, userId) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  const query = new URLSearchParams({
    select: "plan,status,current_period_ends_at,quota_bonus",
    user_id: `eq.${userId}`,
    limit: "1"
  });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/user_entitlements?${query}`, {
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": req.headers.get("authorization") || "",
        "Accept": "application/json"
      }
    });
    const data = await response.json().catch(() => []);
    const row = Array.isArray(data) ? data[0] : null;
    return {
      ...(row || {}),
      active: isEntitlementActive(row)
    };
  } catch {
    return { plan: "free", quota_bonus: 0, active: false };
  }
}

async function queryMonthlyUsage(req, userId) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  const query = new URLSearchParams({
    select: "id",
    user_id: `eq.${userId}`,
    event_type: "eq.chat",
    created_at: `gte.${currentMonthStart()}`
  });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/request_events?${query}`, {
      method: "HEAD",
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": req.headers.get("authorization") || "",
        "Accept": "application/json",
        "Prefer": "count=exact"
      }
    });
    const range = response.headers.get("content-range") || "";
    const count = Number(range.split("/").pop());
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

function isEntitlementActive(entitlement) {
  if (!entitlement || !["active", "trialing"].includes(entitlement.status)) return false;
  if (!entitlement.current_period_ends_at) return true;
  return new Date(entitlement.current_period_ends_at).getTime() > Date.now();
}

function normalizePlan(plan) {
  return ["plus", "pro"].includes(String(plan || "").toLowerCase()) ? String(plan).toLowerCase() : "free";
}

function currentMonthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
