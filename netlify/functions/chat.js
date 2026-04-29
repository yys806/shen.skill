import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";
import { isAdmin, verifySupabaseUser } from "./_shared/auth.js";
import { checkRateLimit } from "./_shared/rate-limit.js";
import { resolveModelRoutes } from "./_shared/model-router.js";
import { loadSkillPrompt, normalizeSkillId } from "./_shared/skill.js";

const PLAN_LIMITS = {
  free: 50,
  plus: 500,
  pro: 2000,
  admin: null
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

export const config = {
  path: "/api/chat",
  method: ["POST"]
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
  if (!messages.length) {
    return json({ error: "messages is required" }, 400);
  }

  const skill = await normalizeSkillId(cleanText(body.skill || "maoxuan-skill"), {
    includeDisabled: isAdmin(authResult.user)
  });
  const modelRoutes = await resolveModelRoutes(authResult.user);

  const skillPrompt = await loadSkillPrompt(skill, {
    includeDisabled: isAdmin(authResult.user)
  });
  const memories = await loadRecentMemories(req, authResult.user.id, skill);
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
    "- 前台只选择 skill；模型、温度和可用节点由管理员后台统一控制。",
    "- 回答要短，不要 AI 长篇；先像人一样接住，再给判断或建议。",
    "- 不要声称自己真的就是某个现实本人；你是基于 skill 的人格镜像。",
    `- 当前 skill：${skill}`,
    `- 当前模型由后台主用/备用路由控制。`,
    `- 当前登录用户：${authResult.user?.email || authResult.user?.id || "unknown"}`
  ].join("\n");

  const completion = await requestWithFallback(modelRoutes, systemPrompt, messages);
  if (!completion.ok) {
    return json({
      error: completion.error || "Model request failed",
      detail: completion.detail || "主用和备用模型都不可用，请到后台模型管理检查。"
    }, 502);
  }

  return json({
    content: completion.content,
    user: authResult.user?.email || authResult.user?.id || null,
    model: {
      name: completion.route.name,
      provider: completion.route.provider,
      model: completion.route.model,
      fallback: completion.fallback
    }
  });
}

async function requestWithFallback(routes, systemPrompt, messages) {
  const errors = [];
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    const result = await requestModel(route, systemPrompt, messages);
    if (result.ok) return { ...result, fallback: index > 0 };
    errors.push(`${route.name || route.model}: ${result.detail || result.error}`);
  }
  return {
    ok: false,
    error: "All model routes failed",
    detail: errors.join("；")
  };
}

async function requestModel(route, systemPrompt, messages) {
  const providerConfig = route.providerConfig;
  if (!providerConfig.apiKey) {
    return {
      ok: false,
      error: `Missing ${providerConfig.name} API key`,
      detail: `请在后台模型管理中配置 ${providerConfig.name} 的 API key 或环境变量。`
    };
  }

  const requestBody = {
    model: route.model,
    temperature: route.temperature,
    max_tokens: 1200,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.slice(-24).map(normalizeMessage)
    ]
  };
  if (route.provider === "deepseek") {
    requestBody.thinking = { type: "disabled" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerConfig.timeoutMs);
  let response;
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
    return {
      ok: false,
      error: aborted ? `${providerConfig.name} timeout` : `${providerConfig.name} network error`,
      detail: aborted
        ? `模型响应超过 ${Math.round(providerConfig.timeoutMs / 1000)} 秒，已主动中断。`
        : `无法连接 ${providerConfig.name}：${error.message}`
    };
  } finally {
    clearTimeout(timeout);
  }

  const data = await readResponseBody(response);
  if (!response.ok) {
    return {
      ok: false,
      error: `${providerConfig.name} request failed`,
      detail: formatUpstreamDetail(data, response.status)
    };
  }
  const content = extractAssistantContent(data);
  if (!content) {
    return {
      ok: false,
      error: "Empty model response",
      detail: formatEmptyResponseDetail(providerConfig.name, data)
    };
  }
  return { ok: true, content, route };
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
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, contentType: response.headers.get("content-type") || "" };
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
