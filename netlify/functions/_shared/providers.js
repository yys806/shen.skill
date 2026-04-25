import { getEnv } from "./env.js";

export const modelCatalog = [
  { provider: "siliconflow", model: "Pro/moonshotai/Kimi-K2.6", label: "Kimi-K2.6" },
  { provider: "siliconflow", model: "Pro/zai-org/GLM-5.1", label: "GLM-5.1" },
  { provider: "siliconflow", model: "Pro/MiniMaxAI/MiniMax-M2.5", label: "MiniMax-M2.5" },
  { provider: "siliconflow", model: "Pro/deepseek-ai/DeepSeek-V3.2", label: "DeepSeek-V3.2" },
  { provider: "deepseek", model: "deepseek-v4-flash", label: "DeepSeek v4 Flash" },
  { provider: "deepseek", model: "deepseek-v4-pro", label: "DeepSeek v4 Pro" },
  { provider: "openrouter", model: "openai/gpt-5.5", label: "GPT-5.5" },
  { provider: "openrouter", model: "anthropic/claude-opus-4.7", label: "Claude Opus 4.7" },
  { provider: "openrouter", model: "qwen/qwen3.6-plus", label: "Qwen3.6 Plus" }
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

  if (provider === "openrouter") {
    return {
      name: "OpenRouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      apiKey: getEnv("OPENROUTER_API_KEY"),
      timeoutMs: 22_000,
      headers: {
        "HTTP-Referer": "https://shen-skill.netlify.app",
        "X-Title": "shen.skill mirror"
      }
    };
  }

  return {
    name: "SiliconFlow",
    url: "https://api.siliconflow.cn/v1/chat/completions",
    apiKey: getEnv("SILICONFLOW_API_KEY"),
    timeoutMs: 24_000,
    headers: {}
  };
}

export function normalizeProvider(provider) {
  return ["siliconflow", "deepseek", "openrouter"].includes(provider)
    ? provider
    : "siliconflow";
}

export function modelExists(provider, model) {
  return modelCatalog.some(item => item.provider === provider && item.model === model);
}
