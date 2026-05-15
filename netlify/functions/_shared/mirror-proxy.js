import { json } from "./json.js";
import { getEnv } from "./env.js";

export async function proxyToMirror(req) {
  const base = getEnv("MIRROR_API_BASE", "http://[2607:f130:0000:0174:0000:0000:0ca5:58a6]").replace(/\/$/, "");
  const url = new URL(req.url);
  const target = `${base}${url.pathname}${url.search}`;
  const headers = {};
  for (const [key, value] of req.headers.entries()) {
    if (["host", "connection", "content-length"].includes(key.toLowerCase())) continue;
    headers[key] = value;
  }
  const response = await fetch(target, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.text()
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export function proxyError(error) {
  return json({ error: "Mirror API proxy failed", detail: error.message }, 502);
}
