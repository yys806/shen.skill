import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env.js";

export function paddleApiBase() {
  return getEnv("PADDLE_ENV", "sandbox") === "live"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";
}

export async function paddleRequest(path, options = {}) {
  const apiKey = getEnv("PADDLE_API_KEY");
  if (!apiKey) {
    return { ok: false, status: 500, detail: "请先配置 PADDLE_API_KEY。" };
  }

  try {
    const response = await fetch(`${paddleApiBase()}${path}`, {
      method: options.method || "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, status: response.status, detail: data?.error?.detail || data?.message || response.statusText, data };
    }
    return { ok: true, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 500, detail: error.message };
  }
}

export function verifyPaddleSignature(rawBody, signatureHeader) {
  const secret = getEnv("PADDLE_WEBHOOK_SECRET");
  if (!secret) return { ok: false, detail: "请先配置 PADDLE_WEBHOOK_SECRET。" };
  if (!signatureHeader) return { ok: false, detail: "缺少 Paddle-Signature。" };

  const parts = Object.fromEntries(
    signatureHeader.split(";").map(part => {
      const [key, value] = part.split("=");
      return [key, value];
    })
  );
  const timestamp = parts.ts;
  const signatures = signatureHeader
    .split(";")
    .filter(part => part.startsWith("h1="))
    .map(part => part.slice(3));

  if (!timestamp || !signatures.length) return { ok: false, detail: "Paddle-Signature 格式不正确。" };
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return { ok: false, detail: "Webhook 签名时间戳已过期。" };

  const expected = createHmac("sha256", secret).update(`${timestamp}:${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const matched = signatures.some(signature => {
    const receivedBuffer = Buffer.from(signature, "hex");
    return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
  });

  return matched ? { ok: true } : { ok: false, detail: "Webhook 签名验证失败。" };
}
