import http from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 8787);
const SILICONFLOW_URL = "https://api.siliconflow.cn/v1/chat/completions";
const DEFAULT_SKILL_PATH = path.join(__dirname, "skills", "shen.skill", "SKILL.md");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/chat") {
      await handleChat(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        hasApiKey: Boolean(process.env.SILICONFLOW_API_KEY),
        model: process.env.SILICONFLOW_MODEL || "Qwen/Qwen2.5-72B-Instruct"
      });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(url.pathname, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Server error", detail: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`shen.skill web is running at http://localhost:${PORT}`);
});

async function handleChat(req, res) {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, {
      error: "Missing SILICONFLOW_API_KEY",
      detail: "Create .env from .env.example and fill your SiliconFlow API key."
    });
    return;
  }

  const body = await readJsonBody(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const counterpart = cleanText(body.counterpart || "");
  const scene = cleanText(body.scene || "self");
  const temperature = clamp(Number(body.temperature ?? 0.72), 0, 1.5);
  const model = cleanText(body.model || process.env.SILICONFLOW_MODEL || "Qwen/Qwen2.5-72B-Instruct");

  if (!messages.length) {
    sendJson(res, 400, { error: "messages is required" });
    return;
  }

  const skillPrompt = await loadSkillPrompt();
  const systemPrompt = [
    skillPrompt,
    "",
    "## 网页封装运行规则",
    "- 你正在作为 shen.skill 的网页聊天人格运行。",
    "- 回答要短，不要 AI 长篇；先像人一样接住，再给判断或建议。",
    "- 如果对方身份不明确，先问一句“你是谁/你现在希望我按谁的语气来回？”再深入。",
    "- 不要声称自己真的就是禹尧珅本人；你是基于 shen.skill 的人格镜像。",
    `- 当前前端选择的对话对象：${counterpart || "未填写"}`,
    `- 当前前端选择的场景：${scene}`,
    "- 如果用户在消息里显式改变身份或场景，以用户最新消息为准。"
  ].join("\n");

  const payload = {
    model,
    temperature,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.slice(-24).map(normalizeMessage)
    ]
  };

  const response = await fetch(SILICONFLOW_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    sendJson(res, response.status, {
      error: "SiliconFlow request failed",
      detail: data || response.statusText
    });
    return;
  }

  const content = data?.choices?.[0]?.message?.content || "";
  sendJson(res, 200, { content, raw: data });
}

async function loadSkillPrompt() {
  const configuredPath = process.env.SHEN_SKILL_PATH || DEFAULT_SKILL_PATH;
  const skillPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(__dirname, configuredPath);
  try {
    return await readFile(skillPath, "utf8");
  } catch {
    return [
      "# shen.skill fallback",
      "你是禹尧珅的综合人格镜像。默认先判断对方是谁，再选择语气。",
      "和用户本人对话时偏理性复盘；工作场景严谨；亲密关系可温柔；朋友场景可松弛。"
    ].join("\n");
  }
}

async function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  let filePath = path.normalize(path.join(publicDir, safePath));

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  if (existsSync(filePath) && !path.extname(filePath)) {
    filePath = path.join(filePath, "index.html");
  }

  if (!existsSync(filePath)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        req.destroy(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function normalizeMessage(message) {
  const role = ["user", "assistant"].includes(message.role) ? message.role : "user";
  return { role, content: String(message.content || "").slice(0, 12000) };
}

function cleanText(value) {
  return String(value || "").trim().slice(0, 200);
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function loadDotEnv(envPath) {
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
