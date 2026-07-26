import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const code = String(body.code || "").trim().slice(0, 64);
  const expected = getEnv("INVITE_CODE").trim();

  if (!expected) {
    // 兼容模式：还没在环境变量里配置 INVITE_CODE 时暂时放行，避免注册中断。
    return json({ ok: true, mode: "open" });
  }

  if (!code) {
    return json({ ok: false, detail: "请输入邀请码。" }, 400);
  }

  if (code === expected) {
    return json({ ok: true });
  }

  return json({ ok: false, detail: "邀请码不正确。" }, 403);
};

export const config = {
  path: "/api/verify-invite",
  method: ["POST"]
};
