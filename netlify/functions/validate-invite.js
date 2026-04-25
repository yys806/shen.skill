import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const body = await req.json().catch(() => ({}));
  const inviteCode = String(body.inviteCode || "").trim();
  const expected = getEnv("INVITE_CODE", "08060910");

  if (!inviteCode || inviteCode !== expected) {
    return json({ ok: false, error: "邀请码不正确。" }, 403);
  }

  return json({ ok: true });
};

export const config = {
  path: "/api/validate-invite",
  method: ["POST"]
};
