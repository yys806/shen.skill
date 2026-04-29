import { getEnv } from "./env.js";

export const modelCatalog = [
  { provider: "deepseek", model: "deepseek-v4-flash", label: "DeepSeek v4 Flash", envKey: "DEEPSEEK_API_KEY", baseUrl: "https://api.deepseek.com/chat/completions" },
  { provider: "deepseek", model: "deepseek-v4-pro", label: "DeepSeek v4 Pro", envKey: "DEEPSEEK_API_KEY", baseUrl: "https://api.deepseek.com/chat/completions" },
  { provider: "siliconflow", model: "Pro/moonshotai/Kimi-K2.6", label: "Kimi K2.6", envKey: "SILICONFLOW_API_KEY", baseUrl: "https://api.siliconflow.cn/v1/chat/completions" },
  { provider: "siliconflow", model: "Pro/zai-org/GLM-5.1", label: "GLM 5.1", envKey: "SILICONFLOW_API_KEY", baseUrl: "https://api.siliconflow.cn/v1/chat/completions" },
  { provider: "siliconflow", model: "Pro/MiniMaxAI/MiniMax-M2.5", label: "MiniMax M2.5", envKey: "SILICONFLOW_API_KEY", baseUrl: "https://api.siliconflow.cn/v1/chat/completions" },
  { provider: "siliconflow", model: "Pro/deepseek-ai/DeepSeek-V3.2", label: "DeepSeek V3.2", envKey: "SILICONFLOW_API_KEY", baseUrl: "https://api.siliconflow.cn/v1/chat/completions" },
  { provider: "openrouter", model: "qwen/qwen3.6-plus", label: "Qwen 3.6 Plus", envKey: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1/chat/completions" }
];

export function getProviderConfig(provider) {
  if (provider === "deepseek") {
    return {
      name: "DeepSeek",
      url: "https://api.deepseek.com/chat/completions",
      apiKey: getEnv("DEEPSEEK_API_KEY"),
      timeoutMs: 18_000,
      headers: {}
    };
  }

  if (provider === "siliconflow") {
    return {
      name: "SiliconFlow",
      url: "https://api.siliconflow.cn/v1/chat/completions",
      apiKey: getEnv("SILICONFLOW_API_KEY"),
      timeoutMs: 25_000,
      headers: {}
    };
  }

  if (provider === "openrouter") {
    return {
      name: "OpenRouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      apiKey: getEnv("OPENROUTER_API_KEY"),
      timeoutMs: 30_000,
      headers: {
        "HTTP-Referer": getEnv("SITE_URL", "https://skill-chat.cn"),
        "X-Title": "Mirror Room"
      }
    };
  }

  return getProviderConfig("deepseek");
}

export function normalizeProvider(provider) {
  return ["deepseek", "siliconflow", "openrouter", "custom"].includes(provider) ? provider : "deepseek";
}

export function modelExists(provider, model) {
  return modelCatalog.some(item => item.provider === provider && item.model === model);
}

export function providerName(provider) {
  if (provider === "siliconflow") return "SiliconFlow";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "custom") return "Custom API";
  return "DeepSeek";
}

export function routeToProviderConfig(route) {
  const provider = normalizeProvider(route?.provider);
  const fallback = getProviderConfig(provider);
  const apiKey = route?.api_key || (route?.api_key_env ? getEnv(route.api_key_env) : "") || fallback.apiKey;
  return {
    name: route?.name || fallback.name || providerName(provider),
    url: route?.api_base_url || fallback.url,
    apiKey,
    timeoutMs: Number(route?.timeout_ms || fallback.timeoutMs || 25_000),
    headers: provider === "openrouter" ? fallback.headers : {}
  };
}
