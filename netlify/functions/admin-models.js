import { ADMIN_EMAIL, isAdmin, verifySupabaseUser } from "./_shared/auth.js";
import { json } from "./_shared/json.js";
import { defaultModelRoutes, loadModelRoutes, publicModelRoute, testModelRoute } from "./_shared/model-router.js";
import { supabaseAdminRequest } from "./_shared/supabase-admin.js";

export default async (req) => {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  if (!isAdmin(authResult.user)) {
    return json({ error: "Forbidden", detail: `只有管理员 ${ADMIN_EMAIL} 可以管理模型。` }, 403);
  }

  if (req.method === "GET") return listModels();
  if (req.method === "POST") return createModel(req);
  if (req.method === "PATCH") return updateModel(req);
  return deleteModel(req);
};

export const config = {
  path: "/api/admin/models",
  method: ["GET", "POST", "PATCH", "DELETE"]
};

async function listModels() {
  await ensureDefaultRoutes();
  const routes = await loadModelRoutes();
  return json({ ok: true, models: routes.map(publicModelRoute) });
}

async function createModel(req) {
  await ensureDefaultRoutes();
  const body = await req.json().catch(() => ({}));
  const row = sanitizeModelRoute(body);
  const result = await supabaseAdminRequest("/model_routes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify(row)
  });
  if (!result.ok) return json({ error: "Model create failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, model: publicModelRoute(result.data?.[0]) });
}

async function updateModel(req) {
  await ensureDefaultRoutes();
  const body = await req.json().catch(() => ({}));
  if (body.action === "test") return testExistingModel(body.id);
  if (["primary", "backup", "standby"].includes(String(body.role || ""))) {
    return updateModelRole(body);
  }
  const id = String(body.id || "").trim();
  if (!id) return json({ error: "Missing id", detail: "缺少模型配置 ID。" }, 400);

  const row = sanitizeModelRoute(body, { partial: true });
  const query = new URLSearchParams({ id: `eq.${id}` });
  const result = await supabaseAdminRequest(`/model_routes?${query}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify(row)
  });
  if (!result.ok) return json({ error: "Model update failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, model: publicModelRoute(result.data?.[0]) });
}

async function updateModelRole(body) {
  const id = String(body.id || "").trim();
  const role = String(body.role || "standby");
  if (!id) return json({ error: "Missing id", detail: "缺少模型配置 ID。" }, 400);
  const priority = role === "primary" ? 10 : (role === "backup" ? 20 : 100);
  if (role !== "standby") {
    const resetQuery = new URLSearchParams({ priority: `eq.${priority}` });
    await supabaseAdminRequest(`/model_routes?${resetQuery}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, priority: 100, updated_at: new Date().toISOString() })
    });
  }
  const query = new URLSearchParams({ id: `eq.${id}` });
  const result = await supabaseAdminRequest(`/model_routes?${query}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({
      enabled: role !== "standby",
      priority,
      audience: "all",
      target_plan: null,
      target_email: null,
      updated_at: new Date().toISOString()
    })
  });
  if (!result.ok) return json({ error: "Model role update failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, model: publicModelRoute(result.data?.[0]) });
}

async function deleteModel(req) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return json({ error: "Missing id", detail: "缺少模型配置 ID。" }, 400);
  const query = new URLSearchParams({ id: `eq.${id}` });
  const result = await supabaseAdminRequest(`/model_routes?${query}`, {
    method: "DELETE",
    headers: { "Prefer": "return=representation" }
  });
  if (!result.ok) return json({ error: "Model delete failed", detail: result.detail }, result.status || 500);
  return json({ ok: true });
}

async function testExistingModel(id) {
  const routeId = String(id || "").trim();
  if (!routeId) return json({ ok: false, error: "缺少模型配置 ID。" }, 400);
  const query = new URLSearchParams({
    select: "*",
    id: `eq.${routeId}`,
    limit: "1"
  });
  const result = await supabaseAdminRequest(`/model_routes?${query}`);
  if (!result.ok) return json({ ok: false, error: result.detail }, result.status || 500);
  const route = result.data?.[0];
  if (!route) return json({ ok: false, error: "模型配置不存在。" }, 404);
  const test = await testModelRoute(route);
  return json(test, test.ok ? 200 : 502);
}

async function ensureDefaultRoutes() {
  const rows = defaultModelRoutes.map(route => ({
    ...route,
    updated_at: new Date().toISOString()
  }));
  await supabaseAdminRequest("/model_routes?on_conflict=slug", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "resolution=ignore-duplicates"
    },
    body: JSON.stringify(rows)
  });
}

function sanitizeModelRoute(body, options = {}) {
  const row = {};
  const has = (...keys) => keys.some(key => Object.prototype.hasOwnProperty.call(body, key));
  const assign = (key, value, ...sourceKeys) => {
    if (!options.partial || has(...sourceKeys)) row[key] = value;
  };

  assign("name", clean(body.name, 120) || "自定义模型", "name");
  assign("provider", normalizeProvider(body.provider), "provider");
  assign("api_base_url", clean(body.apiBaseUrl || body.api_base_url, 300) || "https://api.deepseek.com/chat/completions", "apiBaseUrl", "api_base_url");
  if (typeof body.apiKey === "string" && body.apiKey.trim()) row.api_key = body.apiKey.trim();
  if (typeof body.api_key === "string" && body.api_key.trim()) row.api_key = body.api_key.trim();
  if (!options.partial || body.apiKeyEnv !== undefined || body.api_key_env !== undefined) {
    row.api_key_env = clean(body.apiKeyEnv || body.api_key_env || "", 80) || null;
  }
  assign("model", clean(body.model, 180) || "deepseek-v4-flash", "model");
  assign("temperature", clamp(Number(body.temperature ?? 0.7), 0, 1.5), "temperature");
  assign("enabled", Boolean(body.enabled), "enabled");
  assign("audience", "all", "audience", "role");
  assign("target_plan", null, "audience", "role");
  assign("target_email", null, "audience", "role");
  assign("priority", Number.isFinite(Number(body.priority)) ? Number(body.priority) : 100, "priority");
  row.updated_at = new Date().toISOString();
  if (!options.partial) {
    row.slug = clean(body.slug, 100) || `custom-${Date.now()}`;
  }
  return row;
}

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

function normalizeProvider(provider) {
  const value = clean(provider, 40).toLowerCase();
  return ["deepseek", "siliconflow", "openrouter", "custom"].includes(value) ? value : "custom";
}

function normalizeAudience(audience) {
  const value = clean(audience, 20).toLowerCase();
  return ["all", "plan", "user"].includes(value) ? value : "all";
}

function normalizePlan(plan) {
  const value = clean(plan, 20).toLowerCase();
  return ["free", "plus", "pro", "admin"].includes(value) ? value : "free";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
