import { getEnv } from "./env.js";

export const modelCatalog = [
  { provider: "deepseek", model: "deepseek-v4-flash", label: "DeepSeek v4 Flash" },
  { provider: "deepseek", model: "deepseek-v4-pro", label: "DeepSeek v4 Pro" }
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

  return getProviderConfig("deepseek");
}

export function normalizeProvider(provider) {
  return provider === "deepseek" ? provider : "deepseek";
}

export function modelExists(provider, model) {
  return modelCatalog.some(item => item.provider === provider && item.model === model);
}
