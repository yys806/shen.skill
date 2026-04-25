import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const skillOptions = [
  { id: "shen.skill", name: "禹尧珅", description: "综合人格 skill，默认先识别对方是谁。" }
];

const sceneOptions = [
  { id: "self", name: "真我复盘", description: "理性、短句、拆动机，适合和本人对话。" },
  { id: "work", name: "工作科研", description: "严谨、清楚、可执行。" },
  { id: "friend", name: "朋友室友", description: "松弛、接梗、嘴碎一点。" },
  { id: "family", name: "家人", description: "简短、报备、让人放心。" },
  { id: "relationship", name: "亲密关系", description: "软一点，会哄人。" }
];

const modelOptions = [
  "Pro/moonshotai/Kimi-K2.6",
  "Pro/zai-org/GLM-5.1",
  "Pro/MiniMaxAI/MiniMax-M2.5",
  "Pro/deepseek-ai/DeepSeek-V3.2"
];

const dom = {
  messages: document.querySelector("#messages"),
  form: document.querySelector("#composer"),
  prompt: document.querySelector("#prompt"),
  clear: document.querySelector("#clear"),
  newChat: document.querySelector("#new-chat"),
  conversationList: document.querySelector("#conversation-list"),
  chatTitle: document.querySelector("#chat-title"),
  template: document.querySelector("#message-template"),
  skillLabel: document.querySelector("#skill-label"),
  counterpartLabel: document.querySelector("#counterpart-label"),
  sceneLabel: document.querySelector("#scene-label"),
  modelLabel: document.querySelector("#model-label"),
  temperatureLabel: document.querySelector("#temperature-label"),
  authLabel: document.querySelector("#auth-label"),
  modalBackdrop: document.querySelector("#modal-backdrop"),
  modalClose: document.querySelector("#modal-close"),
  modalKicker: document.querySelector("#modal-kicker"),
  modalTitle: document.querySelector("#modal-title"),
  modalBody: document.querySelector("#modal-body")
};

const stateKey = "mirror.room.state.v2";
let supabase = null;
let session = null;
let appState = loadState();

renderAll();
boot();

async function boot() {
  try {
    const config = await fetchJson("/api/config");
    if (config.model && modelOptions.includes(config.model)) {
      appState.model = config.model;
    }

    if (!config.hasSupabase) {
      setAuthLabel("Supabase 未配置");
      lockChat(true);
      return;
    }

    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data } = await supabase.auth.getSession();
    session = data.session;
    updateAuthState();

    supabase.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      updateAuthState();
    });
  } catch (error) {
    setAuthLabel("配置失败");
    addSystemMessage(`配置读取失败：${error.message}`);
    lockChat(true);
  }
}

document.querySelectorAll("[data-modal]").forEach(button => {
  button.addEventListener("click", () => openModal(button.dataset.modal));
});

dom.modalClose.addEventListener("click", closeModal);
dom.modalBackdrop.addEventListener("click", event => {
  if (event.target === dom.modalBackdrop) closeModal();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeModal();
});

dom.newChat.addEventListener("click", () => {
  const conversation = createConversation();
  appState.activeConversationId = conversation.id;
  persistAndRender();
});

dom.clear.addEventListener("click", () => {
  const conversation = getActiveConversation();
  conversation.messages = [welcomeMessage()];
  conversation.title = "新的镜室对话";
  persistAndRender();
});

dom.form.addEventListener("submit", async event => {
  event.preventDefault();
  const content = dom.prompt.value.trim();
  if (!content) return;

  if (!session?.access_token) {
    openModal("auth");
    addSystemMessage("先登录一下，不然我不能调用后端。");
    return;
  }

  const conversation = getActiveConversation();
  dom.prompt.value = "";
  conversation.messages.push({ role: "user", content });
  if (conversation.title === "新的镜室对话") {
    conversation.title = content.slice(0, 18);
  }
  const thinking = { role: "assistant", content: "我想一下。", pending: true };
  conversation.messages.push(thinking);
  persistAndRender();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        messages: conversation.messages.filter(message => !message.pending),
        counterpart: appState.counterpart,
        scene: appState.scene,
        model: appState.model,
        temperature: appState.temperature,
        skill: appState.skill
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(formatError(data));

    thinking.pending = false;
    thinking.content = data.content || "我这边没拿到模型回复，可能是模型名或 API key 配置的问题。";
    conversation.updatedAt = Date.now();
    persistAndRender();
  } catch (error) {
    thinking.pending = false;
    thinking.content = `这下卡住了：${error.message}\n\n先检查 Netlify 环境变量、Supabase 登录状态和模型名。`;
    conversation.updatedAt = Date.now();
    persistAndRender();
  }
});

dom.prompt.addEventListener("keydown", event => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    dom.form.requestSubmit();
  }
});

function openModal(type) {
  const builders = {
    skill: renderSkillModal,
    counterpart: renderCounterpartModal,
    scene: renderSceneModal,
    model: renderModelModal,
    temperature: renderTemperatureModal,
    auth: renderAuthModal
  };

  dom.modalBackdrop.classList.remove("hidden");
  dom.modalBackdrop.setAttribute("aria-hidden", "false");
  builders[type]?.();
}

function closeModal() {
  dom.modalBackdrop.classList.add("hidden");
  dom.modalBackdrop.setAttribute("aria-hidden", "true");
  dom.modalBody.innerHTML = "";
}

function renderSkillModal() {
  setModalHead("choose skill", "选择你要和谁对话");
  dom.modalBody.innerHTML = optionList(skillOptions, appState.skill);
  dom.modalBody.querySelectorAll("[data-option]").forEach(button => {
    button.addEventListener("click", () => {
      appState.skill = button.dataset.option;
      persistAndRender();
      closeModal();
    });
  });
}

function renderCounterpartModal() {
  setModalHead("relationship", "你是他的谁");
  dom.modalBody.innerHTML = `
    <label for="counterpart-input">关系 / 身份</label>
    <input id="counterpart-input" value="${escapeHtml(appState.counterpart)}" placeholder="比如：我本人、老师、学姐、女朋友、朋友" />
    <p class="field-help">这会影响 skill 的称呼、边界和说话方式。后续也可以在聊天里临时说明。</p>
    <button id="counterpart-save" class="modal-primary" type="button">保存</button>
  `;
  dom.modalBody.querySelector("#counterpart-save").addEventListener("click", () => {
    appState.counterpart = dom.modalBody.querySelector("#counterpart-input").value.trim();
    persistAndRender();
    closeModal();
  });
}

function renderSceneModal() {
  setModalHead("tone scene", "选择语气场景");
  dom.modalBody.innerHTML = optionList(sceneOptions, appState.scene);
  dom.modalBody.querySelectorAll("[data-option]").forEach(button => {
    button.addEventListener("click", () => {
      appState.scene = button.dataset.option;
      persistAndRender();
      closeModal();
    });
  });
}

function renderModelModal() {
  setModalHead("model", "选择一个模型");
  const options = modelOptions.map(value => ({
    id: value,
    name: value.replace(/^Pro\//, ""),
    description: value
  }));
  dom.modalBody.innerHTML = optionList(options, appState.model);
  dom.modalBody.querySelectorAll("[data-option]").forEach(button => {
    button.addEventListener("click", () => {
      appState.model = button.dataset.option;
      persistAndRender();
      closeModal();
    });
  });
}

function renderTemperatureModal() {
  setModalHead("temperature", "设置回复温度");
  dom.modalBody.innerHTML = `
    <div class="temperature-readout"><span id="temp-big">${appState.temperature.toFixed(1)}</span><small>越高越发散</small></div>
    <input id="temp-input" type="range" min="0" max="1.5" step="0.1" value="${appState.temperature}" />
    <button id="temp-save" class="modal-primary" type="button">保存</button>
  `;
  const input = dom.modalBody.querySelector("#temp-input");
  const readout = dom.modalBody.querySelector("#temp-big");
  input.addEventListener("input", () => {
    readout.textContent = Number(input.value).toFixed(1);
  });
  dom.modalBody.querySelector("#temp-save").addEventListener("click", () => {
    appState.temperature = Number(input.value);
    persistAndRender();
    closeModal();
  });
}

function renderAuthModal() {
  setModalHead("account", session ? "账户状态" : "登录 / 注册");
  if (session?.user) {
    const nickname = session.user.user_metadata?.nickname || "未设置昵称";
    dom.modalBody.innerHTML = `
      <div class="account-card">
        <strong>${escapeHtml(nickname)}</strong>
        <span>${escapeHtml(session.user.email || session.user.id)}</span>
      </div>
      <button id="logout-button" class="modal-primary danger" type="button">退出登录</button>
    `;
    dom.modalBody.querySelector("#logout-button").addEventListener("click", async () => {
      await supabase.auth.signOut();
      closeModal();
    });
    return;
  }

  dom.modalBody.innerHTML = `
    <div class="auth-tabs">
      <button id="auth-login-tab" class="tab active" type="button">登录</button>
      <button id="auth-signup-tab" class="tab" type="button">注册</button>
    </div>
    <div id="auth-fields" class="auth-fields"></div>
    <p id="auth-feedback" class="field-help">密码必须包含大小写字母、数字和特殊符号。</p>
  `;
  let mode = "login";
  const renderFields = () => {
    const isSignup = mode === "signup";
    dom.modalBody.querySelector("#auth-fields").innerHTML = `
      ${isSignup ? '<label for="nickname">昵称</label><input id="nickname" autocomplete="nickname" placeholder="你希望别人怎么叫你" />' : ""}
      <label for="email">邮箱</label>
      <input id="email" type="email" autocomplete="email" placeholder="you@example.com" />
      <label for="password">密码</label>
      <input id="password" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" placeholder="大小写 + 数字 + 特殊符号" />
      ${isSignup ? '<label for="confirm-password">确认密码</label><input id="confirm-password" type="password" autocomplete="new-password" placeholder="再输入一次密码" />' : ""}
      <button id="auth-submit" class="modal-primary" type="button">${isSignup ? "注册" : "登录"}</button>
    `;
    dom.modalBody.querySelector("#auth-submit").addEventListener("click", () => submitAuth(mode));
  };

  dom.modalBody.querySelector("#auth-login-tab").addEventListener("click", () => {
    mode = "login";
    switchAuthTab(mode);
    renderFields();
  });
  dom.modalBody.querySelector("#auth-signup-tab").addEventListener("click", () => {
    mode = "signup";
    switchAuthTab(mode);
    renderFields();
  });
  renderFields();
}

async function submitAuth(mode) {
  if (!supabase) {
    setFeedback("Supabase 还没配置好。");
    return;
  }

  const email = dom.modalBody.querySelector("#email").value.trim();
  const password = dom.modalBody.querySelector("#password").value;

  if (mode === "login") {
    setFeedback("登录中...");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setFeedback(error.message);
    else closeModal();
    return;
  }

  const nickname = dom.modalBody.querySelector("#nickname").value.trim();
  const confirmPassword = dom.modalBody.querySelector("#confirm-password").value;
  const passwordError = validatePassword(password, confirmPassword);
  if (!nickname) return setFeedback("昵称不能为空。");
  if (!email) return setFeedback("邮箱不能为空。");
  if (passwordError) return setFeedback(passwordError);

  setFeedback("注册中，成功后会自动登录...");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { nickname }
    }
  });
  if (error) {
    setFeedback(error.message);
  } else if (data.session) {
    session = data.session;
    updateAuthState();
    closeModal();
  } else {
    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) {
      setFeedback("注册成功，但没有自动登录。请确认 Supabase Auth 已关闭邮箱验证。");
      return;
    }
    session = loginData.session;
    updateAuthState();
    closeModal();
  }
}

function switchAuthTab(mode) {
  dom.modalBody.querySelector("#auth-login-tab").classList.toggle("active", mode === "login");
  dom.modalBody.querySelector("#auth-signup-tab").classList.toggle("active", mode === "signup");
}

function validatePassword(password, confirmPassword) {
  if (password.length < 8) return "密码至少 8 位。";
  if (!/[a-z]/.test(password)) return "密码必须包含小写字母。";
  if (!/[A-Z]/.test(password)) return "密码必须包含大写字母。";
  if (!/\d/.test(password)) return "密码必须包含数字。";
  if (!/[^A-Za-z0-9]/.test(password)) return "密码必须包含特殊符号。";
  if (password !== confirmPassword) return "两次输入的密码不一致。";
  return "";
}

function setFeedback(text) {
  dom.modalBody.querySelector("#auth-feedback").textContent = text;
}

function renderAll() {
  ensureActiveConversation();
  renderDock();
  renderHistory();
  renderMessages();
}

function renderDock() {
  const skill = skillOptions.find(item => item.id === appState.skill) || skillOptions[0];
  const scene = sceneOptions.find(item => item.id === appState.scene) || sceneOptions[0];
  dom.skillLabel.textContent = skill.name;
  dom.counterpartLabel.textContent = appState.counterpart || "未填写";
  dom.sceneLabel.textContent = scene.name;
  dom.modelLabel.textContent = appState.model.replace(/^Pro\/(?:moonshotai\/|zai-org\/|MiniMaxAI\/|deepseek-ai\/)/, "");
  dom.temperatureLabel.textContent = appState.temperature.toFixed(1);
  updateAuthState();
}

function renderHistory() {
  const sorted = [...appState.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  dom.conversationList.innerHTML = sorted.map(conversation => {
    const active = conversation.id === appState.activeConversationId ? "active" : "";
    const last = conversation.messages.at(-1)?.content || "空白对话";
    return `
      <button class="conversation-item ${active}" data-id="${conversation.id}" type="button">
        <strong>${escapeHtml(conversation.title || "新的镜室对话")}</strong>
        <span>${escapeHtml(last.slice(0, 42))}</span>
      </button>
    `;
  }).join("");
  dom.conversationList.querySelectorAll("[data-id]").forEach(button => {
    button.addEventListener("click", () => {
      appState.activeConversationId = button.dataset.id;
      persistAndRender();
    });
  });
}

function renderMessages() {
  const conversation = getActiveConversation();
  dom.chatTitle.textContent = conversation.title || "新的镜室对话";
  dom.messages.innerHTML = "";
  for (const message of conversation.messages) {
    const node = dom.template.content.firstElementChild.cloneNode(true);
    node.classList.add(message.role);
    if (message.pending) node.classList.add("thinking");
    node.querySelector(".role").textContent = message.role === "user" ? "you" : "mirror";
    node.querySelector(".content").textContent = message.content;
    dom.messages.appendChild(node);
  }
  dom.messages.scrollTop = dom.messages.scrollHeight;
}

function updateAuthState() {
  if (session?.user) {
    const nickname = session.user.user_metadata?.nickname || session.user.email || "已登录";
    setAuthLabel(nickname);
    lockChat(false);
  } else {
    setAuthLabel("登录 / 注册");
    lockChat(true);
  }
}

function setAuthLabel(text) {
  dom.authLabel.textContent = text;
}

function lockChat(locked) {
  dom.prompt.disabled = locked;
  dom.form.querySelector("button").disabled = locked;
  dom.prompt.placeholder = locked
    ? "先在右上角登录 / 注册。"
    : "输入消息，Ctrl + Enter 发送。";
}

function optionList(options, currentId) {
  return `
    <div class="option-list">
      ${options.map(option => `
        <button class="option-card ${option.id === currentId ? "selected" : ""}" data-option="${escapeHtml(option.id)}" type="button">
          <strong>${escapeHtml(option.name)}</strong>
          <span>${escapeHtml(option.description || "")}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function setModalHead(kicker, title) {
  dom.modalKicker.textContent = kicker;
  dom.modalTitle.textContent = title;
}

function persistAndRender() {
  saveState();
  renderAll();
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(stateKey) || "null");
    if (stored?.conversations?.length) return stored;
  } catch {
    // Ignore corrupted local state.
  }
  const firstConversation = createConversation(false);
  return {
    skill: "shen.skill",
    counterpart: "",
    scene: "self",
    model: "Pro/moonshotai/Kimi-K2.6",
    temperature: 0.7,
    activeConversationId: firstConversation.id,
    conversations: [firstConversation]
  };
}

function saveState() {
  localStorage.setItem(stateKey, JSON.stringify(appState));
}

function ensureActiveConversation() {
  if (!appState.conversations.find(item => item.id === appState.activeConversationId)) {
    const conversation = createConversation(false);
    appState.conversations.unshift(conversation);
    appState.activeConversationId = conversation.id;
  }
}

function createConversation(push = true) {
  const conversation = {
    id: crypto.randomUUID(),
    title: "新的镜室对话",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [welcomeMessage()]
  };
  if (push) appState.conversations.unshift(conversation);
  return conversation;
}

function getActiveConversation() {
  ensureActiveConversation();
  return appState.conversations.find(item => item.id === appState.activeConversationId);
}

function welcomeMessage() {
  return {
    role: "assistant",
    content: "先登录，然后告诉我：你是谁？如果你是本人，我会按真我复盘来，不装、不长篇，直接帮你拆清楚。"
  };
}

function addSystemMessage(content) {
  const conversation = getActiveConversation();
  conversation.messages.push({ role: "assistant", content });
  conversation.updatedAt = Date.now();
  persistAndRender();
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
