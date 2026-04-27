import { json } from "./_shared/json.js";
import { verifySupabaseUser } from "./_shared/auth.js";
import { checkRateLimit } from "./_shared/rate-limit.js";
import { getProviderConfig, modelExists, normalizeProvider } from "./_shared/providers.js";

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const body = await req.json().catch(() => ({}));
  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return json({ ok: false, error: authResult.detail }, 401);
  }

  const rateLimit = await checkRateLimit(req, authResult.user.id, "test_model", 10, 60_000);
  if (!rateLimit.ok) {
    return json({ ok: false, error: rateLimit.detail }, 429);
  }

  const provider = normalizeProvider(body.provider);
  const model = String(body.model || "").trim();

  if (!modelExists(provider, model)) {
    return json({ ok: false, error: "未知模型，请重新选择。" }, 400);
  }

  const result = await testModel(provider, model);
  return json(result, result.ok ? 200 : 502);
};

export const config = {
  path: "/api/test-model",
  method: ["POST"]
};

async function testModel(provider, model) {
  const config = getProviderConfig(provider);
  if (!config.apiKey) {
    return { ok: false, error: `缺少 ${config.name} API key。` };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 15_000));

  try {
    const requestBody = {
      model,
      temperature: 0,
      max_tokens: 24,
      stream: false,
      messages: [
        { role: "user", content: "Reply OK." }
      ]
    };
    if (provider === "deepseek") {
      requestBody.thinking = { type: "disabled" };
    }

    const response = await fetch(config.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...config.headers
      },
      body: JSON.stringify(requestBody)
    });

    const data = await readBody(response);
    if (!response.ok) {
      return {
        ok: false,
        provider,
        model,
        latencyMs: Date.now() - startedAt,
        error: formatUpstreamDetail(data, response.status)
      };
    }

    const sample = extractAssistantContent(data);
    if (!sample) {
      return {
        ok: false,
        provider,
        model,
        latencyMs: Date.now() - startedAt,
        error: formatEmptyResponseDetail(config.name, data)
      };
    }

    return {
      ok: true,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      sample
    };
  } catch (error) {
    return {
      ok: false,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      error: error?.name === "AbortError"
        ? "测试超过 15 秒，已中断。"
        : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readBody(response) {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function formatUpstreamDetail(data, status) {
  if (!data) return `上游返回 HTTP ${status}，但没有响应体。`;
  if (data.error?.message) return data.error.message;
  if (typeof data.error === "string") return data.error;
  if (data.message) return data.message;
  if (data.raw) return `上游返回非 JSON 内容：${String(data.raw).replace(/\s+/g, " ").slice(0, 220)}`;
  return JSON.stringify(data).slice(0, 300);
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
    ? message.reasoning_content.replace(/\s+/g, " ").slice(0, 140)
    : "";
  return [
    `${providerName} 返回成功，但没有最终回答正文。`,
    `finish_reason=${finishReason}; message_keys=${keys}.`,
    reasoning ? `reasoning_content 预览：${reasoning}` : ""
  ].filter(Boolean).join(" ");
}
