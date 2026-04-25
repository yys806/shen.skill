import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const messagesEl = document.querySelector("#messages");
const form = document.querySelector("#composer");
const promptEl = document.querySelector("#prompt");
const clearBtn = document.querySelector("#clear");
const counterpartEl = document.querySelector("#counterpart");
const sceneEl = document.querySelector("#scene");
const modelEl = document.querySelector("#model");
const temperatureEl = document.querySelector("#temperature");
const template = document.querySelector("#message-template");
const authStateEl = document.querySelector("#auth-state");
const authFormEl = document.querySelector("#auth-form");
const authHintEl = document.querySelector("#auth-hint");
const emailEl = document.querySelector("#email");
const passwordEl = document.querySelector("#password");
const loginBtn = document.querySelector("#login");
const signupBtn = document.querySelector("#signup");
const logoutBtn = document.querySelector("#logout");

const storageKey = "shen.skill.web.messages";
let messages = loadMessages();
let supabase = null;
let session = null;

if (!messages.length) {
  messages = [
    {
      role: "assistant",
      content:
        "先登录。登录后我会先确认：你是谁？\n\n如果你是禹尧珅本人，我会按“真我复盘”来：不装、不长篇，帮你把动机、情绪和下一步拆清楚。"
    }
  ];
}

renderMessages();
boot();

async function boot() {
  try {
    const config = await fetchJson("/api/config");
    modelEl.value = config.model || modelEl.value;

    if (!config.hasSupabase) {
      setAuthMessage("Supabase 还没配好", "请在 Netlify 环境变量里设置 SUPABASE_ANON_KEY。");
      lockChat(true);
      return;
    }

    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data } = await supabase.auth.getSession();
    session = data.session;
    updateAuthUi();

    supabase.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      updateAuthUi();
    });
  } catch (error) {
    setAuthMessage("配置读取失败", error.message);
    lockChat(true);
  }
}

loginBtn.addEventListener("click", async () => {
  if (!supabase) return;
  setAuthMessage("登录中", "稍等一下。");
  const { error } = await supabase.auth.signInWithPassword({
    email: emailEl.value.trim(),
    password: passwordEl.value
  });
  if (error) setAuthMessage("登录失败", error.message);
});

signupBtn.addEventListener("click", async () => {
  if (!supabase) return;
  setAuthMessage("注册中", "如果 Supabase 开启了邮箱确认，你需要先去邮箱点确认链接。");
  const { error } = await supabase.auth.signUp({
    email: emailEl.value.trim(),
    password: passwordEl.value
  });
  if (error) {
    setAuthMessage("注册失败", error.message);
  } else {
    setAuthMessage("注册成功", "如果要求邮箱确认，确认后再回来登录。");
  }
});

logoutBtn.addEventListener("click", async () => {
  if (!supabase) return;
  await supabase.auth.signOut();
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  const content = promptEl.value.trim();
  if (!content) return;

  if (!session?.access_token) {
    addMessage("assistant", "先登录一下，不然我不能调用后端。");
    return;
  }

  promptEl.value = "";
  addMessage("user", content);
  const thinking = addMessage("assistant", "我想一下。", true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        messages: messages.filter(message => !message.pending),
        counterpart: counterpartEl.value,
        scene: sceneEl.value,
        model: modelEl.value,
        temperature: Number(temperatureEl.value || 0.7)
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(formatError(data));

    thinking.pending = false;
    thinking.content = data.content || "我这边没拿到模型回复，可能是模型名或 API key 配置的问题。";
    saveMessages();
    renderMessages();
  } catch (error) {
    thinking.pending = false;
    thinking.content = `这下卡住了：${error.message}\n\n先检查 Netlify 环境变量：SILICONFLOW_API_KEY、SUPABASE_ANON_KEY、模型名。`;
    saveMessages();
    renderMessages();
  }
});

promptEl.addEventListener("keydown", event => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    form.requestSubmit();
  }
});

clearBtn.addEventListener("click", () => {
  messages = [
    {
      role: "assistant",
      content: "清空了。重新来，先告诉我：你是谁？"
    }
  ];
  saveMessages();
  renderMessages();
});

function updateAuthUi() {
  if (session?.user) {
    authStateEl.textContent = `已登录：${session.user.email || session.user.id}`;
    authHintEl.textContent = "现在可以进入镜室聊天。";
    authFormEl.classList.add("signed-in");
    logoutBtn.classList.remove("hidden");
    lockChat(false);
  } else {
    authStateEl.textContent = "未登录";
    authHintEl.textContent = "注册登录由 Supabase 托管，聊天 API 只接受已登录用户。";
    authFormEl.classList.remove("signed-in");
    logoutBtn.classList.add("hidden");
    lockChat(true);
  }
}

function lockChat(locked) {
  promptEl.disabled = locked;
  form.querySelector("button").disabled = locked;
  promptEl.placeholder = locked
    ? "先登录，登录后才能和 shen.skill 对话。"
    : "先说一句：你是谁，或者直接把想复盘的事丢进来。";
}

function setAuthMessage(title, detail) {
  authStateEl.textContent = title;
  authHintEl.textContent = detail;
}

function addMessage(role, content, pending = false) {
  const message = { role, content, pending };
  messages.push(message);
  saveMessages();
  renderMessages();
  return message;
}

function renderMessages() {
  messagesEl.innerHTML = "";
  for (const message of messages) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.classList.add(message.role);
    if (message.pending) node.classList.add("thinking");
    node.querySelector(".role").textContent = message.role === "user" ? "you" : "shen.skill";
    node.querySelector(".content").textContent = message.content;
    messagesEl.appendChild(node);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function saveMessages() {
  const clean = messages
    .filter(message => !message.pending)
    .slice(-40)
    .map(({ role, content }) => ({ role, content }));
  localStorage.setItem(storageKey, JSON.stringify(clean));
}

function loadMessages() {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "[]");
  } catch {
    return [];
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(formatError(data));
  return data;
}

function formatError(data) {
  if (!data) return "未知错误";
  if (typeof data.detail === "string") return data.detail;
  if (data.detail?.message) return data.detail.message;
  if (data.error) return data.error;
  return JSON.stringify(data);
}
