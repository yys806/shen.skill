import { getEnv } from "./env.js";
import { modelCatalog, providerName, routeToProviderConfig } from "./providers.js";
import { supabaseAdminRequest } from "./supabase-admin.js";

export const defaultModelRoutes = modelCatalog.map((item, index) => ({
  slug: `${item.provider}-${slugify(item.model)}`,
  name: `${providerName(item.provider)} · ${item.label}`,
  provider: item.provider,
  api_base_url: item.baseUrl,
  api_key: null,
  api_key_env: item.envKey,
  model: item.model,
  temperature: 0.7,
  enabled: index === 0,
  audience: "all",
  target_plan: null,
  target_email: null,
  priority: index === 0 ? 10 : 100 + index
}));

export async function resolveModelRoute(user) {
  const routes = await resolveModelRoutes(user);
  return routes[0] || decorateRoute(defaultModelRoutes[0]);
}

export async function resolveModelRoutes(user) {
  const routes = await loadModelRoutes();
  const matching = routes
    .filter(route => route.enabled !== false)
    .sort(compareRoutes);
  return (matching.length ? matching : [defaultModelRoutes[0]])
    .slice(0, 2)
    .map(decorateRoute);
}

function decorateRoute(route) {
  const providerConfig = routeToProviderConfig(route);
  return {
    ...route,
    providerConfig,
    temperature: clamp(Number(route.temperature ?? 0.7), 0, 1.5)
  };
}

export async function loadModelRoutes() {
  const query = new URLSearchParams({
    select: "id,slug,name,provider,api_base_url,api_key,api_key_env,model,temperature,enabled,audience,target_plan,target_email,priority,created_at,updated_at",
    order: "priority.asc,created_at.asc"
  });
  const result = await supabaseAdminRequest(`/model_routes?${query}`);
  if (!result.ok || !Array.isArray(result.data) || !result.data.length) {
    return defaultModelRoutes;
  }
  return result.data;
}

export function publicModelRoute(route) {
  return {
    id: route.id || null,
    slug: route.slug,
    name: route.name,
    provider: route.provider,
    api_base_url: route.api_base_url,
    api_key_env: route.api_key_env,
    has_api_key: Boolean(route.api_key || (route.api_key_env && getEnv(route.api_key_env))),
    model: route.model,
    temperature: Number(route.temperature ?? 0.7),
    enabled: route.enabled !== false,
    role: Number(route.priority ?? 100) === 10 ? "primary" : (Number(route.priority ?? 100) === 20 ? "backup" : "standby"),
    priority: Number(route.priority ?? 100),
    created_at: route.created_at || null,
    updated_at: route.updated_at || null
  };
}

export async function testModelRoute(route) {
  const providerConfig = routeToProviderConfig(route);
  if (!providerConfig.apiKey) {
    return { ok: false, error: `缺少 ${route.name || providerConfig.name} 的 API key。` };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const body = {
    model: route.model,
    temperature: 0,
    max_tokens: 24,
    stream: false,
    messages: [{ role: "user", content: "Reply OK." }]
  };
  if (route.provider === "deepseek") {
    body.thinking = { type: "disabled" };
  }

  try {
    const response = await fetch(providerConfig.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${providerConfig.apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...providerConfig.headers
      },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: data?.error?.message || data?.message || `HTTP ${response.status}`
      };
    }
    const sample = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.delta?.content || "";
    return {
      ok: Boolean(sample),
      latencyMs: Date.now() - startedAt,
      sample,
      error: sample ? null : "模型返回成功，但没有回答正文。"
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error?.name === "AbortError" ? "测试超过 15 秒，已中断。" : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

function compareRoutes(left, right) {
  return Number(left.priority || 100) - Number(right.priority || 100);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
