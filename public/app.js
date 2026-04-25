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
  { provider: "siliconflow", model: "Pro/moonshotai/Kimi-K2.6", label: "Kimi-K2.6", vendor: "SiliconFlow" },
  { provider: "siliconflow", model: "Pro/zai-org/GLM-5.1", label: "GLM-5.1", vendor: "SiliconFlow" },
  { provider: "siliconflow", model: "Pro/MiniMaxAI/MiniMax-M2.5", label: "MiniMax-M2.5", vendor: "SiliconFlow" },
  { provider: "siliconflow", model: "Pro/deepseek-ai/DeepSeek-V3.2", label: "DeepSeek-V3.2", vendor: "SiliconFlow" },
  { provider: "deepseek", model: "deepseek-v4-flash", label: "DeepSeek v4 Flash", vendor: "DeepSeek" },
  { provider: "deepseek", model: "deepseek-v4-pro", label: "DeepSeek v4 Pro", vendor: "DeepSeek" },
  { provider: "openrouter", model: "openai/gpt-5.5", label: "GPT-5.5", vendor: "OpenRouter" },
  { provider: "openrouter", model: "anthropic/claude-opus-4.7", label: "Claude Opus 4.7", vendor: "OpenRouter" },
  { provider: "openrouter", model: "qwen/qwen3.6-plus", label: "Qwen3.6 Plus", vendor: "OpenRouter" }
];

const dom = {
  messages: document.querySelector("#messages"),
  form: document.querySelector("#composer"),
  prompt: document.querySelector("#prompt"),
  clear: document.querySelector("#clear"),
  newChat: document.querySelector("#new-chat"),
  toggleHistory: document.querySelector("#toggle-history"),
  workspace: document.querySelector(".workspace"),
  historyPanel: document.querySelector(".history-panel"),
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

const contextMenu = document.createElement("div");
contextMenu.className = "context-menu hidden";
document.body.appendChild(contextMenu);

const stateKeyPrefix = "mirror.room.state.v2";
let currentStateKey = `${stateKeyPrefix}:anon`;
let supabase = null;
let session = null;
let appState = loadState(currentStateKey);

renderAll();
boot();

async function boot() {
  try {
    const config = await fetchJson("/api/config");
    const settings = getActiveSettings();
    if (config.model && modelOptions.some(item => item.model === config.model) && !settings.model) {
      applySetting("model", config.model, false);
    }

    if (!config.hasSupabase) {
      setAuthLabel("Supabase 未配置");
      lockChat(true);
      return;
    }

    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data } = await supabase.auth.getSession();
    session = data.session;
    await switchUserState(session?.user || null);
    await ensureCurrentUserProfile();
    updateAuthState();

    supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      session = nextSession;
      await switchUserState(session?.user || null);
      await ensureCurrentUserProfile();
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

document.addEventListener("click", () => hideContextMenu());
document.addEventListener("scroll", () => hideContextMenu(), true);

dom.newChat.addEventListener("click", () => {
  const conversation = createConversation();
  appState.activeConversationId = conversation.id;
  persistAndRender();
});

dom.toggleHistory.addEventListener("click", () => {
  appState.historyCollapsed = !appState.historyCollapsed;
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
  conversation.messages.push(createMessage("user", content));
  if (conversation.title === "新的镜室对话") {
    conversation.title = content.slice(0, 18);
  }
  const thinking = createMessage("assistant", "我想一下。", { pending: true });
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
        ...getActiveSettings()
      })
    });

    const data = await parseResponse(response);
    if (!response.ok) throw new Error(formatError(data));

    thinking.pending = false;
    thinking.content = data.content || "我这边没拿到模型回复，可能是模型名或 API key 配置的问题。";
    thinking.createdAt = Date.now();
    conversation.updatedAt = Date.now();
    persistAndRender();
  } catch (error) {
    thinking.pending = false;
    thinking.content = `这下卡住了：${error.message}\n\n先检查 Netlify 环境变量、Supabase 登录状态和模型名。`;
    thinking.createdAt = Date.now();
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
  const settings = getActiveSettings();
  dom.modalBody.innerHTML = optionList(skillOptions, settings.skill);
  dom.modalBody.querySelectorAll("[data-option]").forEach(button => {
    button.addEventListener("click", () => {
      applySetting("skill", button.dataset.option);
      persistAndRender();
      closeModal();
    });
  });
}

function renderCounterpartModal() {
  setModalHead("relationship", "你是他的谁");
  const settings = getActiveSettings();
  dom.modalBody.innerHTML = `
    <label for="counterpart-input">关系 / 身份</label>
    <input id="counterpart-input" value="${escapeHtml(settings.counterpart)}" placeholder="比如：我本人、老师、学姐、女朋友、朋友" />
    <p class="field-help">这会影响 skill 的称呼、边界和说话方式。后续也可以在聊天里临时说明。</p>
    <button id="counterpart-save" class="modal-primary" type="button">保存</button>
  `;
  dom.modalBody.querySelector("#counterpart-save").addEventListener("click", () => {
    applySetting("counterpart", dom.modalBody.querySelector("#counterpart-input").value.trim());
    persistAndRender();
    closeModal();
  });
}

function renderSceneModal() {
  setModalHead("tone scene", "选择语气场景");
  const settings = getActiveSettings();
  dom.modalBody.innerHTML = optionList(sceneOptions, settings.scene);
  dom.modalBody.querySelectorAll("[data-option]").forEach(button => {
    button.addEventListener("click", () => {
      applySetting("scene", button.dataset.option);
      persistAndRender();
      closeModal();
    });
  });
}

function renderModelModal() {
  setModalHead("model", "选择一个模型");
  const settings = getActiveSettings();
  const grouped = groupModelsByVendor();
  dom.modalBody.innerHTML = `
    <div class="model-test-hint" id="model-test-hint">测试只发一条极短请求，用来确认 key、网络和模型名是否可用。</div>
    <div class="model-list">
      ${Object.entries(grouped).map(([vendor, models]) => `
        <section class="model-group">
          <h3>${escapeHtml(vendor)}</h3>
          ${models.map(item => `
            <div class="model-row ${item.model === settings.model && item.provider === settings.provider ? "selected" : ""}">
              <button class="model-pick" data-provider="${escapeHtml(item.provider)}" data-model="${escapeHtml(item.model)}" type="button">
                <strong>${escapeHtml(item.label)}</strong>
                <span>${escapeHtml(item.model)}</span>
              </button>
              <button class="model-test" data-provider="${escapeHtml(item.provider)}" data-model="${escapeHtml(item.model)}" type="button">测试</button>
            </div>
          `).join("")}
        </section>
      `).join("")}
    </div>
  `;
  dom.modalBody.querySelectorAll(".model-pick").forEach(button => {
    button.addEventListener("click", () => {
      applySetting("provider", button.dataset.provider);
      applySetting("model", button.dataset.model);
      persistAndRender();
      closeModal();
    });
  });
  dom.modalBody.querySelectorAll(".model-test").forEach(button => {
    button.addEventListener("click", () => testSelectedModel(button));
  });
}

function groupModelsByVendor() {
  return modelOptions.reduce((groups, item) => {
    groups[item.vendor] ||= [];
    groups[item.vendor].push(item);
    return groups;
  }, {});
}

function findModel(provider, model) {
  return modelOptions.find(item => item.provider === provider && item.model === model)
    || modelOptions.find(item => item.model === model)
    || null;
}

async function testSelectedModel(button) {
  const hint = dom.modalBody.querySelector("#model-test-hint");
  if (!session?.access_token) {
    hint.textContent = "先登录后才能测试模型，避免公开消耗 API。";
    return;
  }
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "测试中";
  hint.textContent = "正在测试模型连通性...";

  try {
    const response = await fetch("/api/test-model", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        provider: button.dataset.provider,
        model: button.dataset.model
      })
    });
    const data = await parseResponse(response);
    if (!response.ok || !data.ok) {
      throw new Error(formatError(data));
    }
    button.classList.remove("failed");
    button.classList.add("ok");
    button.textContent = "可用";
    hint.textContent = `可用，延迟约 ${data.latencyMs}ms。`;
  } catch (error) {
    button.classList.remove("ok");
    button.classList.add("failed");
    button.textContent = "失败";
    hint.textContent = `不可用：${error.message}`;
  } finally {
    button.disabled = false;
    if (!button.classList.contains("ok") && !button.classList.contains("failed")) {
      button.textContent = original;
    }
  }
}

function renderTemperatureModal() {
  setModalHead("temperature", "设置回复温度");
  const settings = getActiveSettings();
  dom.modalBody.innerHTML = `
    <div class="temperature-readout"><span id="temp-big">${settings.temperature.toFixed(1)}</span><small>越高越发散</small></div>
    <input id="temp-input" type="range" min="0" max="1.5" step="0.1" value="${settings.temperature}" />
    <button id="temp-save" class="modal-primary" type="button">保存</button>
  `;
  const input = dom.modalBody.querySelector("#temp-input");
  const readout = dom.modalBody.querySelector("#temp-big");
  input.addEventListener("input", () => {
    readout.textContent = Number(input.value).toFixed(1);
  });
  dom.modalBody.querySelector("#temp-save").addEventListener("click", () => {
    applySetting("temperature", Number(input.value));
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
      <label for="email">${isSignup ? "邮箱" : "邮箱 / 昵称"}</label>
      <input id="email" type="text" autocomplete="${isSignup ? "email" : "username"}" placeholder="${isSignup ? "you@example.com" : "you@example.com 或昵称"}" />
      <label for="password">密码</label>
      <input id="password" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" placeholder="大小写 + 数字 + 特殊符号" />
      ${isSignup ? '<label for="confirm-password">确认密码</label><input id="confirm-password" type="password" autocomplete="new-password" placeholder="再输入一次密码" />' : ""}
      ${isSignup ? '<label for="invite-code">邀请码</label><input id="invite-code" type="text" inputmode="numeric" placeholder="请输入邀请码" />' : ""}
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

  const identifier = dom.modalBody.querySelector("#email").value.trim();
  const password = dom.modalBody.querySelector("#password").value;

  if (mode === "login") {
    setFeedback("登录中...");
    const email = await resolveLoginEmail(identifier);
    if (!email) return;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setFeedback(error.message);
    else {
      session = data.session;
      await switchUserState(session?.user || null);
      await ensureCurrentUserProfile();
      updateAuthState();
      closeModal();
    }
    return;
  }

  const nickname = dom.modalBody.querySelector("#nickname").value.trim();
  const email = identifier;
  const confirmPassword = dom.modalBody.querySelector("#confirm-password").value;
  const inviteCode = dom.modalBody.querySelector("#invite-code").value.trim();
  const passwordError = validatePassword(password, confirmPassword);
  if (!nickname) return setFeedback("昵称不能为空。");
  if (!email) return setFeedback("邮箱不能为空。");
  if (!isEmail(email)) return setFeedback("注册时请输入有效邮箱。");
  if (passwordError) return setFeedback(passwordError);
  const inviteOk = await validateInviteCode(inviteCode);
  if (!inviteOk) return;

  const duplicate = await checkProfileDuplicate(nickname, email);
  if (duplicate) return;

  setFeedback("注册中，成功后会自动登录...");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { nickname }
    }
  });
  if (error) {
    setFeedback(explainSignupError(error.message));
  } else if (data.session) {
    session = data.session;
    await switchUserState(session?.user || null);
    await ensureCurrentUserProfile(nickname);
    updateAuthState();
    closeModal();
  } else {
    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) {
      setFeedback("注册成功，但没有自动登录。请确认 Supabase Auth 已关闭邮箱验证。");
      return;
    }
    session = loginData.session;
    await switchUserState(session?.user || null);
    await ensureCurrentUserProfile(nickname);
    updateAuthState();
    closeModal();
  }
}

async function validateInviteCode(inviteCode) {
  if (!inviteCode) {
    setFeedback("邀请码不能为空。");
    return false;
  }

  const response = await fetch("/api/validate-invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inviteCode })
  });
  const data = await parseResponse(response);
  if (!response.ok || !data.ok) {
    setFeedback(formatError(data));
    return false;
  }
  return true;
}

async function ensureCurrentUserProfile(preferredNickname = "") {
  if (!supabase || !session?.user) return;
  const user = session.user;
  const nickname = (preferredNickname || user.user_metadata?.nickname || "").trim();
  if (!nickname || !user.email) return;

  const profile = {
    id: user.id,
    email: user.email,
    nickname,
    nickname_key: normalizeNickname(nickname)
  };

  const { error } = await supabase
    .from("profiles")
    .upsert(profile, { onConflict: "id" });

  if (error) {
    console.warn("Failed to ensure profile", error);
  }
}

async function resolveLoginEmail(identifier) {
  if (!identifier) {
    setFeedback("邮箱或昵称不能为空。");
    return "";
  }
  if (isEmail(identifier)) return identifier;

  const { data, error } = await supabase
    .from("profiles")
    .select("email")
    .eq("nickname_key", normalizeNickname(identifier))
    .maybeSingle();

  if (error) {
    setFeedback(`昵称登录暂不可用：${error.message}`);
    return "";
  }
  if (!data?.email) {
    setFeedback("没有找到这个昵称。");
    return "";
  }
  return data.email;
}

async function checkProfileDuplicate(nickname, email) {
  const nicknameKey = normalizeNickname(nickname);
  const { data, error } = await supabase
    .from("profiles")
    .select("nickname_key,email")
    .or(`nickname_key.eq.${escapePostgrestValue(nicknameKey)},email.eq.${escapePostgrestValue(email)}`);

  if (error) {
    setFeedback(`无法检查昵称/邮箱是否重复：${error.message}`);
    return true;
  }

  if (data?.some(profile => profile.nickname_key === nicknameKey)) {
    setFeedback("这个昵称已经被注册了，换一个吧。");
    return true;
  }
  if (data?.some(profile => String(profile.email).toLowerCase() === email.toLowerCase())) {
    setFeedback("这个邮箱已经被注册了，直接登录就行。");
    return true;
  }
  return false;
}

function normalizeNickname(nickname) {
  return String(nickname || "").trim().toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapePostgrestValue(value) {
  return String(value).replace(/["'(),]/g, "");
}

function explainSignupError(message) {
  const lower = String(message || "").toLowerCase();
  if (lower.includes("duplicate") || lower.includes("unique") || lower.includes("database")) {
    return "注册失败：昵称或邮箱已经存在。";
  }
  return message;
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
  migrateConversationSettings();
  renderDock();
  renderHistory();
  renderMessages();
}

function renderDock() {
  const settings = getActiveSettings();
  const skill = skillOptions.find(item => item.id === settings.skill) || skillOptions[0];
  const scene = sceneOptions.find(item => item.id === settings.scene) || sceneOptions[0];
  const model = findModel(settings.provider, settings.model);
  dom.skillLabel.textContent = skill.name;
  dom.counterpartLabel.textContent = settings.counterpart || "未填写";
  dom.sceneLabel.textContent = scene.name;
  dom.modelLabel.textContent = model ? `${model.vendor} · ${model.label}` : settings.model;
  dom.temperatureLabel.textContent = settings.temperature.toFixed(1);
  dom.workspace.classList.toggle("history-collapsed", Boolean(appState.historyCollapsed));
  dom.historyPanel.classList.toggle("collapsed", Boolean(appState.historyCollapsed));
  dom.toggleHistory.textContent = appState.historyCollapsed ? "展开" : "折叠";
  updateAuthState();
}

function renderHistory() {
  const sorted = [...appState.conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  dom.conversationList.innerHTML = sorted.map(conversation => {
    const active = conversation.id === appState.activeConversationId ? "active" : "";
    const pinned = conversation.pinned ? "pinned" : "";
    const last = conversation.messages.at(-1)?.content || "空白对话";
    const scene = sceneOptions.find(item => item.id === conversation.settings?.scene)?.name || "真我复盘";
    return `
      <button class="conversation-item ${active} ${pinned}" data-id="${conversation.id}" type="button">
        <strong>${conversation.pinned ? "▲ " : ""}${escapeHtml(conversation.title || "新的镜室对话")}</strong>
        <em>${escapeHtml(scene)} · ${escapeHtml(conversation.settings?.counterpart || "未填写身份")}</em>
        <span>${escapeHtml(last.slice(0, 42))}</span>
      </button>
    `;
  }).join("");
  dom.conversationList.querySelectorAll("[data-id]").forEach(button => {
    button.addEventListener("click", () => {
      appState.activeConversationId = button.dataset.id;
      hydrateAppSettingsFromConversation();
      persistAndRender();
    });
    button.addEventListener("contextmenu", event => {
      event.preventDefault();
      showConversationMenu(button.dataset.id, event.clientX, event.clientY);
    });
  });
}

function renderMessages() {
  const conversation = getActiveConversation();
  dom.chatTitle.textContent = conversation.title || "新的镜室对话";
  dom.messages.innerHTML = "";
  conversation.messages.forEach((message, index) => {
    if (!message.id) message.id = crypto.randomUUID();
    if (!message.createdAt) message.createdAt = Date.now();
    const chunks = getDisplayChunks(message);
    chunks.forEach((chunk, chunkIndex) => {
      const node = dom.template.content.firstElementChild.cloneNode(true);
      node.classList.add(message.role);
      if (message.pending) node.classList.add("thinking");
      if (chunkIndex > 0) node.classList.add("continued");
      node.querySelector(".role").textContent = message.role === "user" ? "you" : "mirror";
      node.querySelector(".content").textContent = chunk;
      node.appendChild(renderMessageTools(message, index, chunk));
      dom.messages.appendChild(node);
    });
  });
  dom.messages.scrollTop = dom.messages.scrollHeight;
}

function renderMessageTools(message, index, visibleContent = message.content) {
  const tools = document.createElement("div");
  tools.className = "message-tools";

  if (message.role === "user") {
    tools.innerHTML = `
      <span>${formatTime(message.createdAt)}</span>
      <button type="button" data-action="copy">复制</button>
      <button type="button" data-action="edit">编辑</button>
    `;
  } else {
    tools.innerHTML = `
      <button type="button" data-action="copy">复制</button>
      <button type="button" data-action="like">赞</button>
      <button type="button" data-action="dislike">踩</button>
      ${message.feedbackComment ? `<span class="absorbed">已吸收</span>` : ""}
    `;
  }

  tools.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => handleMessageAction(message, index, button.dataset.action, visibleContent));
  });

  return tools;
}

function handleMessageAction(message, index, action, visibleContent = message.content) {
  if (action === "copy") {
    navigator.clipboard?.writeText(visibleContent);
    return;
  }

  if (action === "edit") {
    dom.prompt.value = message.content;
    dom.prompt.focus();
    return;
  }

  if (action === "like" || action === "dislike") {
    openFeedbackModal(message, index, action);
  }
}

function getDisplayChunks(message) {
  if (message.role !== "assistant" || message.pending) return [message.content];
  return splitAssistantReply(message.content);
}

function splitAssistantReply(content) {
  const text = String(content || "").trim();
  if (text.length <= 260) return [text || ""];

  const paragraphs = text
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean);
  const units = paragraphs.length > 1
    ? paragraphs
    : text.split(/(?<=[。！？!?；;])\s*/).map(part => part.trim()).filter(Boolean);

  const chunks = [];
  let current = "";
  for (const unit of units) {
    if (!current) {
      current = unit;
    } else if ((current + "\n" + unit).length <= 260) {
      current = `${current}\n${unit}`;
    } else {
      chunks.push(current);
      current = unit;
    }
  }
  if (current) chunks.push(current);

  return chunks.flatMap(chunk => {
    if (chunk.length <= 360) return [chunk];
    const result = [];
    for (let i = 0; i < chunk.length; i += 320) {
      result.push(chunk.slice(i, i + 320));
    }
    return result;
  });
}

function openFeedbackModal(message, index, feedback) {
  setModalHead(feedback === "like" ? "positive feedback" : "negative feedback", feedback === "like" ? "这句哪里好" : "这句哪里不像");
  dom.modalBody.innerHTML = `
    <label for="feedback-comment">评论</label>
    <textarea id="feedback-comment" rows="4" placeholder="写清楚你希望它吸收什么：语气、事实、边界、表达方式……"></textarea>
    <button id="feedback-save" class="modal-primary" type="button">评论并吸收进 skill</button>
  `;
  dom.modalBackdrop.classList.remove("hidden");
  dom.modalBackdrop.setAttribute("aria-hidden", "false");
  dom.modalBody.querySelector("#feedback-save").addEventListener("click", () => saveFeedback(message, index, feedback));
}

async function saveFeedback(message, index, feedback) {
  const textarea = dom.modalBody.querySelector("#feedback-comment");
  const comment = textarea.value.trim();
  if (!comment) {
    textarea.placeholder = "要写评论才会吸收进 skill。";
    textarea.focus();
    return;
  }

  const conversation = getActiveConversation();
  const previousUserMessage = findPreviousUserMessage(conversation.messages, index);

  const response = await fetch("/api/memory", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`
    },
    body: JSON.stringify({
      skill: getActiveSettings().skill,
      conversationId: conversation.id,
      messageId: message.id,
      feedback,
      comment,
      userMessage: previousUserMessage?.content || "",
      assistantMessage: message.content,
      settings: getActiveSettings()
    })
  });
  const data = await parseResponse(response);
  if (!response.ok || !data.ok) {
    textarea.value = "";
    textarea.placeholder = `吸收失败：${formatError(data)}`;
    return;
  }

  message.feedback = feedback;
  message.feedbackComment = comment;
  message.absorbedAt = Date.now();
  persistAndRender();
  closeModal();
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

async function switchUserState(user) {
  const nextKey = user?.id ? `${stateKeyPrefix}:user:${user.id}` : `${stateKeyPrefix}:anon`;
  if (nextKey === currentStateKey) return;
  saveState();
  currentStateKey = nextKey;
  appState = loadState(currentStateKey);
  renderAll();
}

function loadState(storageKey = currentStateKey) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (stored?.conversations?.length) return stored;
  } catch {
    // Ignore corrupted local state.
  }
  const firstConversation = createConversation(false, defaultSettings());
  return {
    skill: "shen.skill",
    counterpart: "",
    scene: "self",
    provider: "siliconflow",
    model: "Pro/moonshotai/Kimi-K2.6",
    temperature: 0.7,
    historyCollapsed: false,
    activeConversationId: firstConversation.id,
    conversations: [firstConversation]
  };
}

function saveState() {
  localStorage.setItem(currentStateKey, JSON.stringify(appState));
}

function ensureActiveConversation() {
  if (!appState.conversations.find(item => item.id === appState.activeConversationId)) {
    const conversation = createConversation(false);
    appState.conversations.unshift(conversation);
    appState.activeConversationId = conversation.id;
  }
}

function migrateConversationSettings() {
  for (const conversation of appState.conversations) {
    if (!conversation.settings) {
      conversation.settings = defaultSettings();
    }
  }
}

function createConversation(push = true, settings = null) {
  const conversation = {
    id: crypto.randomUUID(),
    title: "新的镜室对话",
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: { ...(settings || getCurrentGlobalSettings()) },
    messages: [welcomeMessage()]
  };
  if (push) appState.conversations.unshift(conversation);
  return conversation;
}

function getActiveConversation() {
  ensureActiveConversation();
  return appState.conversations.find(item => item.id === appState.activeConversationId);
}

function getActiveSettings() {
  const conversation = getActiveConversation();
  if (!conversation.settings) conversation.settings = defaultSettings();
  return conversation.settings;
}

function getCurrentGlobalSettings() {
  return {
    skill: appState?.skill || "shen.skill",
    counterpart: appState?.counterpart || "",
    scene: appState?.scene || "self",
    provider: appState?.provider || "siliconflow",
    model: appState?.model || "Pro/moonshotai/Kimi-K2.6",
    temperature: Number(appState?.temperature ?? 0.7)
  };
}

function defaultSettings() {
  return {
    skill: "shen.skill",
    counterpart: "",
    scene: "self",
    provider: "siliconflow",
    model: "Pro/moonshotai/Kimi-K2.6",
    temperature: 0.7
  };
}

function applySetting(key, value, markUpdated = true) {
  const conversation = getActiveConversation();
  if (!conversation.settings) conversation.settings = defaultSettings();
  conversation.settings[key] = value;
  appState[key] = value;
  if (markUpdated) conversation.updatedAt = Date.now();
}

function hydrateAppSettingsFromConversation() {
  const settings = getActiveSettings();
  appState.skill = settings.skill;
  appState.counterpart = settings.counterpart;
  appState.scene = settings.scene;
  appState.provider = settings.provider;
  appState.model = settings.model;
  appState.temperature = settings.temperature;
}

function welcomeMessage() {
  return createMessage("assistant", "先登录，然后告诉我：你是谁？如果你是本人，我会按真我复盘来，不装、不长篇，直接帮你拆清楚。");
}

function addSystemMessage(content) {
  const conversation = getActiveConversation();
  conversation.messages.push(createMessage("assistant", content));
  conversation.updatedAt = Date.now();
  persistAndRender();
}

function createMessage(role, content, extra = {}) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
    ...extra
  };
}

function formatTime(value) {
  return new Date(value || Date.now()).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function findPreviousUserMessage(messages, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return messages[i];
  }
  return null;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await parseResponse(response);
  if (!response.ok) throw new Error(formatError(data));
  return data;
}

async function parseResponse(response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (!text) return {};
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return {
        error: "Invalid JSON",
        detail: `服务器返回了损坏的 JSON：${text.slice(0, 180)}`
      };
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return {
      error: response.ok ? "Unexpected response" : `HTTP ${response.status}`,
      detail: `服务器返回了非 JSON 内容：${text.replace(/\s+/g, " ").slice(0, 220)}`
    };
  }
}

function showConversationMenu(conversationId, x, y) {
  const conversation = appState.conversations.find(item => item.id === conversationId);
  if (!conversation) return;

  contextMenu.innerHTML = `
    <button data-action="rename" type="button">重命名</button>
    <button data-action="pin" type="button">${conversation.pinned ? "取消置顶" : "置顶"}</button>
    <button data-action="delete" class="danger" type="button">删除</button>
  `;
  contextMenu.classList.remove("hidden");
  contextMenu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
  contextMenu.style.top = `${Math.min(y, window.innerHeight - 150)}px`;

  contextMenu.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      handleConversationAction(conversationId, button.dataset.action);
      hideContextMenu();
    });
  });
}

function hideContextMenu() {
  contextMenu.classList.add("hidden");
}

function handleConversationAction(conversationId, action) {
  const conversation = appState.conversations.find(item => item.id === conversationId);
  if (!conversation) return;

  if (action === "rename") {
    openRenameModal(conversation);
    return;
  }

  if (action === "pin") {
    conversation.pinned = !conversation.pinned;
    conversation.updatedAt = Date.now();
    persistAndRender();
    return;
  }

  if (action === "delete") {
    deleteConversation(conversationId);
  }
}

function openRenameModal(conversation) {
  setModalHead("rename", "重命名对话");
  dom.modalBody.innerHTML = `
    <label for="rename-input">对话名称</label>
    <input id="rename-input" value="${escapeHtml(conversation.title || "新的镜室对话")}" />
    <button id="rename-save" class="modal-primary" type="button">保存</button>
  `;
  dom.modalBackdrop.classList.remove("hidden");
  dom.modalBackdrop.setAttribute("aria-hidden", "false");
  const input = dom.modalBody.querySelector("#rename-input");
  input.focus();
  input.select();
  dom.modalBody.querySelector("#rename-save").addEventListener("click", () => {
    const title = input.value.trim();
    if (title) conversation.title = title;
    conversation.updatedAt = Date.now();
    persistAndRender();
    closeModal();
  });
}

function deleteConversation(conversationId) {
  const index = appState.conversations.findIndex(item => item.id === conversationId);
  if (index === -1) return;
  appState.conversations.splice(index, 1);
  if (!appState.conversations.length) {
    const conversation = createConversation(false, defaultSettings());
    appState.conversations.push(conversation);
    appState.activeConversationId = conversation.id;
  } else if (appState.activeConversationId === conversationId) {
    const next = appState.conversations[0];
    appState.activeConversationId = next.id;
    hydrateAppSettingsFromConversation();
  }
  persistAndRender();
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
