import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const skillOptions = await loadSkillOptions();

const sceneOptions = [
  { id: "self", name: "真我复盘", description: "理性、短句、拆动机，适合和本人对话。" },
  { id: "work", name: "工作科研", description: "严谨、清楚、可执行。" },
  { id: "friend", name: "朋友室友", description: "松弛、接梗、嘴碎一点。" },
  { id: "family", name: "家人", description: "简短、报备、让人放心。" },
  { id: "relationship", name: "亲密关系", description: "软一点，会哄人。" }
];

const modelOptions = [
  { provider: "deepseek", model: "deepseek-v4-flash", label: "DeepSeek v4 Flash", vendor: "DeepSeek" },
  { provider: "deepseek", model: "deepseek-v4-pro", label: "DeepSeek v4 Pro", vendor: "DeepSeek" }
];

let accountPlan = "free";

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
  counterpartDock: document.querySelector('[data-modal="counterpart"]'),
  counterpartLabel: document.querySelector("#counterpart-label"),
  sceneDock: document.querySelector('[data-modal="scene"]'),
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
let accountUsage = null;

applyInitialSkillFromUrl();
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
    await refreshAccountPlan();
    updateAuthState();

    supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      session = nextSession;
      await switchUserState(session?.user || null);
      await ensureCurrentUserProfile();
      await refreshAccountPlan();
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
  conversation.messages = [];
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
  if ((type === "counterpart" || type === "scene") && !activeSkillNeedsContext()) {
    return;
  }

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
  setModalHead("choose skill", "选择要启用的 skill");
  const settings = getActiveSettings();
  dom.modalBody.innerHTML = optionList(skillOptions, settings.skill);
  dom.modalBody.querySelectorAll("[data-option]").forEach(button => {
    button.addEventListener("click", () => {
      applySetting("skill", button.dataset.option);
      normalizeSettingsForSkill(getActiveSettings());
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
        <span class="account-plan ${escapeHtml(accountPlan)}">${escapeHtml(planBadge())}</span>
        <strong>${escapeHtml(nickname)}</strong>
        <span>${escapeHtml(session.user.email || session.user.id)}</span>
        <small>${escapeHtml(formatAccountUsage())}</small>
      </div>
      <div class="account-manage-grid">
        <label for="nickname-update">修改昵称</label>
        <input id="nickname-update" value="${escapeHtml(nickname)}" maxlength="40" />
        <button id="nickname-save" class="modal-primary" type="button">保存昵称</button>
      </div>
      <div class="account-manage-grid">
        <label for="old-password">修改密码</label>
        <input id="old-password" type="password" autocomplete="current-password" placeholder="原始密码" />
        <input id="new-password" type="password" autocomplete="new-password" placeholder="新密码：大小写 + 数字 + 特殊符号" />
        <input id="new-password-confirm" type="password" autocomplete="new-password" placeholder="再次输入新密码" />
        <button id="password-save" class="modal-primary" type="button">修改密码</button>
      </div>
      <p id="account-feedback" class="field-help"></p>
      <button id="logout-button" class="modal-primary danger" type="button">退出登录</button>
    `;
    dom.modalBody.querySelector("#nickname-save").addEventListener("click", saveNickname);
    dom.modalBody.querySelector("#password-save").addEventListener("click", savePassword);
    dom.modalBody.querySelector("#logout-button").addEventListener("click", async () => {
      await performLogout();
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
      ${isSignup ? '<label class="policy-check"><input id="policy-agree" type="checkbox" /> <span>我已阅读并同意 <a href="/privacy/" target="_blank" rel="noreferrer">隐私政策</a> 和 <a href="/terms/" target="_blank" rel="noreferrer">服务条款</a></span></label>' : ""}
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
    await refreshAccountPlan();
    updateAuthState();
    closeModal();
    }
    return;
  }

  const nickname = dom.modalBody.querySelector("#nickname").value.trim();
  const email = identifier;
  const confirmPassword = dom.modalBody.querySelector("#confirm-password").value;
  const agreedToPolicies = dom.modalBody.querySelector("#policy-agree")?.checked;
  const passwordError = validatePassword(password, confirmPassword);
  if (!nickname) return setFeedback("昵称不能为空。");
  if (!email) return setFeedback("邮箱不能为空。");
  if (!isEmail(email)) return setFeedback("注册时请输入有效邮箱。");
  if (passwordError) return setFeedback(passwordError);
  if (!agreedToPolicies) return setFeedback("注册前需要先阅读并同意隐私政策和服务条款。");

  const duplicate = await checkProfileDuplicate(nickname, email);
  if (duplicate) return;

  setFeedback("注册中。开启邮箱验证后，需要先去邮箱点击确认链接。");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/chat`,
      data: { nickname }
    }
  });
  if (error) {
    setFeedback(explainSignupError(error.message));
  } else if (data.session) {
    await supabase.auth.signOut({ scope: "local" });
    session = null;
    await switchUserState(null);
    await refreshAccountPlan();
    updateAuthState();
    setFeedback("注册已提交。请确认 Supabase 已开启邮箱验证；开启后用户需要先点邮箱确认链接再登录。");
  } else {
    setFeedback("注册成功。请去邮箱点击验证链接，验证后再回来登录。");
  }
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
  const needsContext = Boolean(skill.needsContext);
  dom.skillLabel.textContent = skill.name;
  dom.counterpartLabel.textContent = settings.counterpart || "未填写";
  dom.sceneLabel.textContent = scene.name;
  dom.counterpartDock.classList.toggle("hidden", !needsContext);
  dom.sceneDock.classList.toggle("hidden", !needsContext);
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
    const meta = conversationMeta(conversation);
    return `
      <button class="conversation-item ${active} ${pinned}" data-id="${conversation.id}" type="button">
        <strong>${conversation.pinned ? "▲ " : ""}${escapeHtml(conversation.title || "新的镜室对话")}</strong>
        <em>${escapeHtml(meta)}</em>
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
  if (!conversation.messages.length) {
    dom.messages.innerHTML = `
      <section class="empty-state" aria-label="镜室介绍">
        <h2>镜室</h2>
        <p>一个可扩展的 skill 对话台。先选择要启用的 skill，再选择模型与温度；</p>
      </section>
    `;
    return;
  }
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
      renderMessageContent(node.querySelector(".content"), message.role, chunk);
      node.appendChild(renderMessageTools(message, index, chunk));
      dom.messages.appendChild(node);
    });
  });
  dom.messages.scrollTop = dom.messages.scrollHeight;
}

function renderMessageContent(target, role, content) {
  if (role !== "assistant" || !window.marked || !window.DOMPurify) {
    target.textContent = content;
    return;
  }

  const rawHtml = window.marked.parse(content || "", {
    breaks: true,
    gfm: true
  });
  target.innerHTML = window.DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true }
  });
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
  return [message.content];
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

async function performLogout() {
  const button = dom.modalBody.querySelector("#logout-button");
  if (button) {
    button.disabled = true;
    button.textContent = "正在退出...";
  }

  session = null;
  await switchUserState(null);
  updateAuthState();
  closeModal();

  try {
    await supabase?.auth.signOut({ scope: "global" });
  } catch (error) {
    console.warn("Global signOut failed, falling back to local cleanup.", error);
  }

  try {
    await supabase?.auth.signOut({ scope: "local" });
  } catch (error) {
    console.warn("Local signOut failed, clearing auth storage directly.", error);
  }

  clearSupabaseAuthStorage();
}

function clearSupabaseAuthStorage() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && /^sb-.+-auth-token$/.test(key)) keys.push(key);
  }
  keys.forEach(key => localStorage.removeItem(key));
}

function updateAuthState() {
  if (session?.user) {
    const nickname = session.user.user_metadata?.nickname || session.user.email || "已登录";
    setAuthLabel(`${planBadge()} · ${nickname}`);
    lockChat(false);
  } else {
    setAuthLabel("登录 / 注册");
    lockChat(true);
  }
}

function setAuthLabel(text) {
  dom.authLabel.textContent = text;
}

async function refreshAccountPlan() {
  if (!session?.access_token) {
    accountPlan = "free";
    return;
  }

  if (String(session.user?.email || "").toLowerCase() === "3492675568@qq.com") {
    accountPlan = "admin";
    return;
  }

  try {
    const response = await fetch("/api/billing/status", {
      headers: { "Authorization": `Bearer ${session.access_token}` }
    });
    const data = await parseResponse(response);
    if (!response.ok) throw new Error(formatError(data));
    const plan = String(data.entitlement?.plan || "free").toLowerCase();
    const status = String(data.entitlement?.status || "inactive").toLowerCase();
    accountUsage = data.usage || null;
    accountPlan = ["plus", "pro"].includes(plan) && ["active", "trialing"].includes(status)
      ? plan
      : "free";
  } catch {
    accountPlan = "free";
  }
}

async function saveNickname() {
  const nickname = dom.modalBody.querySelector("#nickname-update").value.trim();
  if (!nickname) return setAccountFeedback("昵称不能为空。", true);
  if (nickname !== session.user.user_metadata?.nickname) {
    const duplicate = await checkNicknameDuplicateForAccount(nickname);
    if (duplicate) return;
  }

  setAccountFeedback("正在保存昵称...");
  const { error: metadataError } = await supabase.auth.updateUser({ data: { nickname } });
  if (metadataError) return setAccountFeedback(metadataError.message, true);

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ nickname, nickname_key: nickname.toLowerCase() })
    .eq("id", session.user.id);
  if (profileError) return setAccountFeedback(explainSignupError(profileError.message), true);

  const { data } = await supabase.auth.getSession();
  session = data.session;
  updateAuthState();
  setAccountFeedback("昵称已更新。");
}

async function savePassword() {
  const oldPassword = dom.modalBody.querySelector("#old-password").value;
  const newPassword = dom.modalBody.querySelector("#new-password").value;
  const confirmPassword = dom.modalBody.querySelector("#new-password-confirm").value;
  const passwordError = validatePassword(newPassword, confirmPassword);
  if (!oldPassword) return setAccountFeedback("请输入原始密码。", true);
  if (passwordError) return setAccountFeedback(passwordError, true);

  setAccountFeedback("正在验证原密码...");
  const email = session.user.email;
  const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: oldPassword });
  if (verifyError) return setAccountFeedback("原始密码不正确。", true);

  setAccountFeedback("正在修改密码...");
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return setAccountFeedback(error.message, true);
  setAccountFeedback("密码已修改，下次登录请使用新密码。");
  dom.modalBody.querySelector("#old-password").value = "";
  dom.modalBody.querySelector("#new-password").value = "";
  dom.modalBody.querySelector("#new-password-confirm").value = "";
}

function setAccountFeedback(message, isError = false) {
  const target = dom.modalBody.querySelector("#account-feedback");
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("is-error", Boolean(isError));
}

async function checkNicknameDuplicateForAccount(nickname) {
  const nicknameKey = normalizeNickname(nickname);
  const { data, error } = await supabase
    .from("profiles")
    .select("id,nickname_key")
    .eq("nickname_key", nicknameKey);

  if (error) {
    setAccountFeedback(`无法检查昵称是否重复：${error.message}`, true);
    return true;
  }

  if ((data || []).some(profile => profile.id !== session.user.id)) {
    setAccountFeedback("这个昵称已经被注册了，换一个吧。", true);
    return true;
  }
  return false;
}

function formatAccountUsage() {
  if (accountPlan === "admin") return "剩余额度：无限";
  if (!accountUsage) return "剩余额度：读取中";
  if (accountUsage.unlimited) return "剩余额度：无限";
  return `剩余额度：${accountUsage.remaining}/${accountUsage.limit}，本月已用 ${accountUsage.used}`;
}

function planBadge() {
  const labels = {
    admin: "管理员",
    pro: "Pro",
    plus: "Plus",
    free: "Free"
  };
  return labels[accountPlan] || "Free";
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
    skill: skillOptions[0].id,
    counterpart: "",
    scene: "self",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    temperature: 0.7,
    historyCollapsed: isMobileViewport(),
    activeConversationId: firstConversation.id,
    conversations: [firstConversation]
  };
}

function saveState() {
  localStorage.setItem(currentStateKey, JSON.stringify(appState));
}

function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 620px)").matches;
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
    normalizeSettingsForSkill(conversation.settings);
  }
}

function applyInitialSkillFromUrl() {
  const skillId = new URLSearchParams(window.location.search).get("skill");
  if (!skillId) return;
  const skill = findSkill(skillId);
  if (skill.id !== skillId) return;
  const conversation = createConversation(false, { ...defaultSettings(), skill: skill.id });
  appState.conversations.unshift(conversation);
  appState.activeConversationId = conversation.id;
  appState.skill = skill.id;
  window.history.replaceState(null, "", window.location.pathname);
}

function createConversation(push = true, settings = null) {
  const conversation = {
    id: crypto.randomUUID(),
    title: "新的镜室对话",
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: { ...(settings || getCurrentGlobalSettings()) },
    messages: []
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
    skill: appState?.skill || skillOptions[0].id,
    counterpart: appState?.counterpart || "",
    scene: appState?.scene || "self",
    provider: appState?.provider || "deepseek",
    model: appState?.model || "deepseek-v4-flash",
    temperature: Number(appState?.temperature ?? 0.7)
  };
}

function defaultSettings() {
  return {
    skill: skillOptions[0].id,
    counterpart: "",
    scene: "self",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    temperature: 0.7
  };
}

function findSkill(skillId) {
  return skillOptions.find(item => item.id === skillId) || skillOptions[0];
}

function activeSkillNeedsContext() {
  return Boolean(findSkill(getActiveSettings().skill).needsContext);
}

function normalizeSettingsForSkill(settings) {
  const skill = findSkill(settings.skill);
  if (settings.skill !== skill.id) {
    settings.skill = skill.id;
  }
  if (!skill.needsContext) {
    settings.counterpart = "";
    settings.scene = "self";
  }
  if (!findModel(settings.provider, settings.model)) {
    settings.provider = "deepseek";
    settings.model = "deepseek-v4-flash";
  }
  return settings;
}

function conversationMeta(conversation) {
  const settings = conversation.settings || defaultSettings();
  const skill = findSkill(settings.skill);
  if (!skill.needsContext) {
    return `${skill.name} · ${settings.model || "未选择模型"}`;
  }
  const scene = sceneOptions.find(item => item.id === settings.scene)?.name || "真我复盘";
  return `${scene} · ${settings.counterpart || "未填写身份"}`;
}

function applySetting(key, value, markUpdated = true) {
  const conversation = getActiveConversation();
  if (!conversation.settings) conversation.settings = defaultSettings();
  conversation.settings[key] = value;
  normalizeSettingsForSkill(conversation.settings);
  appState[key] = value;
  appState.counterpart = conversation.settings.counterpart;
  appState.scene = conversation.settings.scene;
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

async function loadSkillOptions() {
  const fallback = [
    { id: "maoxuan-skill", name: "毛选", description: "毛选思维框架 skill，专注问题分析与战略判断。", needsContext: false }
  ];
  try {
    const response = await fetch("/skills/catalog.json", { cache: "no-store" });
    const catalog = await response.json();
    if (!response.ok || !Array.isArray(catalog) || !catalog.length) return fallback;
    return catalog.map(item => ({
      id: item.id,
      name: item.name,
      description: item.description || item.summary || "",
      needsContext: Boolean(item.needsContext)
    })).filter(item => item.id && item.name);
  } catch {
    return fallback;
  }
}
