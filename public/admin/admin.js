const ADMIN_EMAIL = "3492675568@qq.com";
const statusLabels = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  published: "已发布"
};
const paymentStatusLabels = {
  pending: "待核对",
  approved: "已通过",
  rejected: "已拒绝"
};

let supabaseClient = null;
let currentSession = null;
let activeTab = "submissions";
let allSubmissions = [];
let allUsers = [];
let allSkills = [];
let allPayments = [];
let allNotifications = [];
let allModels = [];
let noticeTargets = [];

const adminMain = document.querySelector("#admin-main");
const adminGate = document.querySelector("#admin-gate");
const loginButton = document.querySelector("#admin-login");
const loginFeedback = document.querySelector("#admin-login-feedback");
const authBox = document.querySelector("#admin-auth");
const submissionList = document.querySelector("#submission-list");
const skillList = document.querySelector("#skill-list");
const paymentList = document.querySelector("#payment-list");
const notificationList = document.querySelector("#notification-list");
const modelList = document.querySelector("#model-list");
const userList = document.querySelector("#user-list");
const statusFilter = document.querySelector("#status-filter");
const userSearch = document.querySelector("#user-search");
const submissionTools = document.querySelector("#submission-tools");
const userTools = document.querySelector("#user-tools");
const tabButtons = [...document.querySelectorAll("[data-admin-tab]")];

bootAdminPage();

async function bootAdminPage() {
  try {
    const config = await getJson("/api/config");
    if (!config.hasSupabase) {
      setLoginFeedback("Supabase 未配置，后台暂不可用。", true);
      return;
    }

    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data } = await supabaseClient.auth.getSession();
    currentSession = data.session;
    await renderAuthState();

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      currentSession = session;
      await renderAuthState();
    });
  } catch (error) {
    setLoginFeedback(`后台初始化失败：${error.message}`, true);
  }
}

loginButton.addEventListener("click", async () => {
  const email = document.querySelector("#admin-email").value.trim();
  const password = document.querySelector("#admin-password").value;
  setLoginFeedback("正在验证管理员身份...");
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return setLoginFeedback(error.message, true);
  currentSession = data.session;
  await renderAuthState();
});

tabButtons.forEach(button => {
  button.addEventListener("click", () => {
    activeTab = button.dataset.adminTab;
    renderTabs();
    if (isAdminSession()) loadActiveTab();
  });
});

statusFilter?.addEventListener("change", renderSubmissions);
userSearch.addEventListener("input", renderUsers);

async function renderAuthState() {
  if (!isAdminSession()) {
    document.body.classList.add("locked");
    adminGate.classList.remove("hidden");
    adminMain.classList.add("hidden");
    if (currentSession?.user) {
      setLoginFeedback("当前账号不是管理员，请换管理员账号登录。", true);
      await supabaseClient.auth.signOut({ scope: "local" });
      currentSession = null;
    }
    return;
  }

  document.body.classList.remove("locked");
  adminGate.classList.add("hidden");
  adminMain.classList.remove("hidden");
  authBox.innerHTML = `
    <span>管理员已登录</span>
    <strong>${escapeHtml(currentSession.user.email || "unknown")}</strong>
  `;
  await loadActiveTab();
}

function renderTabs() {
  tabButtons.forEach(button => {
    button.classList.toggle("active", button.dataset.adminTab === activeTab);
  });
  submissionList.classList.toggle("hidden", activeTab !== "submissions");
  skillList.classList.toggle("hidden", activeTab !== "skills");
  paymentList.classList.toggle("hidden", activeTab !== "payments");
  notificationList.classList.toggle("hidden", activeTab !== "notifications");
  modelList.classList.toggle("hidden", activeTab !== "models");
  userList.classList.toggle("hidden", activeTab !== "users");
  submissionTools.classList.add("hidden");
  userTools.classList.toggle("hidden", activeTab !== "users");
}

async function loadActiveTab() {
  renderTabs();
  if (activeTab === "skills") return loadSkills();
  if (activeTab === "payments") return loadPayments();
  if (activeTab === "notifications") return loadNotifications();
  if (activeTab === "models") return loadModels();
  if (activeTab === "users") return loadUsers();
  return loadSubmissions();
}

async function loadSubmissions() {
  renderNotice(submissionList, "正在读取提交列表...");
  const response = await fetch("/api/admin/skill-submissions", { headers: authHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(submissionList, data.detail || data.error || "读取失败。");
  allSubmissions = data.submissions || [];
  renderSubmissions();
}

function renderSubmissions() {
  const submissions = allSubmissions;

  if (!submissions.length) return renderNotice(submissionList, "当前没有提交。");

  submissionList.innerHTML = submissions.map(item => `
    <article class="submission-item" data-submission-id="${escapeAttribute(item.id)}">
      <div>
        <span class="status-pill status-${escapeAttribute(item.status || "pending")}">${escapeHtml(statusLabels[item.status] || item.status || "待审核")}</span>
        <h2>${escapeHtml(item.name)}</h2>
        <details>
          <summary>查看提交详情</summary>
          <p>${escapeHtml(item.description)}</p>
          <dl class="submission-meta">
            <dt>GitHub</dt><dd><a href="${escapeAttribute(item.repo_url)}" target="_blank" rel="noreferrer">${escapeHtml(item.repo_url)}</a></dd>
            <dt>提交者</dt><dd>${escapeHtml(item.submitter_email || item.user_id || "unknown")}</dd>
            <dt>提交时间</dt><dd>${formatDate(item.created_at)}</dd>
            <dt>更新时间</dt><dd>${formatDate(item.updated_at || item.created_at)}</dd>
          </dl>
        </details>
        <label class="review-note">
          <span>管理员备注</span>
          <textarea data-review-note="${escapeAttribute(item.id)}" rows="3" placeholder="记录审核理由或发布注意事项">${escapeHtml(item.review_note || "")}</textarea>
        </label>
        <div class="review-actions">
          ${saveNoteButton(item)}
          ${reviewButton(item, "approved", "通过")}
          ${reviewButton(item, "rejected", "拒绝")}
        </div>
      </div>
      <aside>
        <a href="${escapeAttribute(item.repo_url)}" target="_blank" rel="noreferrer">打开 GitHub</a>
        <small>${escapeHtml(item.submitter_email || item.user_id || "unknown")}</small>
        <time>${formatDate(item.created_at)}</time>
      </aside>
    </article>
  `).join("");

  submissionList.querySelectorAll("[data-review-status]").forEach(button => {
    button.addEventListener("click", () => updateSubmissionStatus(button.dataset.id, button.dataset.reviewStatus));
  });
}

async function updateSubmissionStatus(id, status) {
  const textarea = submissionList.querySelector(`[data-review-note="${CSS.escape(id)}"]`);
  const response = await fetch("/api/admin/skill-submissions", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, reviewNote: textarea?.value || "" })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(submissionList, data.detail || data.error || "更新失败。");
  await loadSubmissions();
}

async function loadSkills() {
  renderNotice(skillList, "正在读取 Skill 列表...");
  const response = await fetch("/api/admin/skills", { headers: authHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(skillList, data.detail || data.error || "读取 Skill 失败。");
  allSkills = data.skills || [];
  renderSkills();
}

function renderSkills() {
  if (!allSkills.length) return renderNotice(skillList, "当前没有 Skill。");
  skillList.innerHTML = allSkills.map(skill => `
    <article class="submission-item skill-admin-item" data-skill-id="${escapeAttribute(skill.id)}" draggable="true">
      <div>
        <span class="drag-handle" title="拖动排序">拖动排序</span>
        <h2>${escapeHtml(skill.name || skill.id)}</h2>
        <p>${escapeHtml(skill.description || skill.summary || "")}</p>
        <dl class="submission-meta">
          <dt>ID</dt><dd>${escapeHtml(skill.id)}</dd>
          <dt>GitHub</dt><dd>${skill.source?.startsWith("http") ? `<a href="${escapeAttribute(skill.source)}" target="_blank" rel="noreferrer">${escapeHtml(skill.source)}</a>` : escapeHtml(skill.source || "local")}</dd>
          <dt>可见性</dt><dd>${skill.enabled ? "普通用户可见并可对话" : "仅管理员可见，普通用户不可见也不可用"}</dd>
        </dl>
      </div>
      <aside>
        <button class="skill-switch ${skill.enabled ? "on" : ""}" data-skill-toggle="${escapeAttribute(skill.id)}" data-enabled="${skill.enabled ? "false" : "true"}" type="button" aria-pressed="${skill.enabled ? "true" : "false"}">
          <i></i><span>${skill.enabled ? "启用" : "禁用"}</span>
        </button>
      </aside>
    </article>
  `).join("");

  skillList.querySelectorAll("[data-skill-toggle]").forEach(button => {
    button.addEventListener("click", () => updateSkillEnabled(button.dataset.skillToggle, button.dataset.enabled === "true"));
  });
  bindSkillDragSorting();
}

async function updateSkillEnabled(id, enabled) {
  const response = await fetch("/api/admin/skills", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, enabled })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(skillList, data.detail || data.error || "更新 Skill 失败。");
  await loadSkills();
}

function bindSkillDragSorting() {
  let draggedId = "";
  skillList.querySelectorAll(".skill-admin-item").forEach(item => {
    item.addEventListener("dragstart", event => {
      draggedId = item.dataset.skillId;
      item.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedId);
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      draggedId = "";
      skillList.querySelectorAll(".drag-over").forEach(node => node.classList.remove("drag-over"));
    });
    item.addEventListener("dragover", event => {
      event.preventDefault();
      if (item.dataset.skillId !== draggedId) item.classList.add("drag-over");
    });
    item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
    item.addEventListener("drop", event => {
      event.preventDefault();
      item.classList.remove("drag-over");
      const sourceId = draggedId || event.dataTransfer.getData("text/plain");
      reorderSkill(sourceId, item.dataset.skillId);
    });
  });
}

async function reorderSkill(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const sourceIndex = allSkills.findIndex(item => item.id === sourceId);
  const targetIndex = allSkills.findIndex(item => item.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1) return;
  const [moved] = allSkills.splice(sourceIndex, 1);
  allSkills.splice(targetIndex, 0, moved);
  allSkills = allSkills.map((skill, index) => ({ ...skill, displayOrder: index }));
  renderSkills();
  await saveSkillOrder();
}

async function saveSkillOrder() {
  const response = await fetch("/api/admin/skills", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      skills: allSkills.map((skill, index) => ({
        id: skill.id,
        enabled: Boolean(skill.enabled),
        displayOrder: index
      }))
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(skillList, data.detail || data.error || "保存排序失败。");
  allSkills = allSkills.map((skill, index) => ({ ...skill, displayOrder: index }));
}

async function loadPayments() {
  renderNotice(paymentList, "正在读取支付记录...");
  const response = await fetch("/api/admin/payment-requests", { headers: authHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(paymentList, data.detail || data.error || "读取支付记录失败。");
  allPayments = data.payments || [];
  renderPayments();
}

function renderPayments() {
  if (!allPayments.length) return renderNotice(paymentList, "当前没有支付申请。");
  paymentList.innerHTML = allPayments.map(payment => `
    <article class="submission-item payment-admin-item compact-payment" data-payment-id="${escapeAttribute(payment.id)}">
      <div>
        <span class="status-pill status-${escapeAttribute(payment.status || "pending")}">${escapeHtml(paymentStatusLabels[payment.status] || payment.status || "待核对")}</span>
        <h2>${escapeHtml(planLabel(payment.plan))} · ￥${escapeHtml(payment.amount_cny)} · ${escapeHtml(cycleLabel(payment.billing_cycle))}</h2>
        <dl class="submission-meta">
          <dt>用户邮箱</dt><dd>${escapeHtml(payment.user_email || "unknown")}</dd>
          <dt>付款方式</dt><dd>${escapeHtml(paymentMethodLabel(payment.payment_method))}</dd>
          <dt>付款用户名</dt><dd>${escapeHtml(payment.payer_name || "")}</dd>
          <dt>动作</dt><dd>${escapeHtml(actionLabel(payment.action))}，追加额度 ${escapeHtml(payment.quota_delta || 0)} 次</dd>
          <dt>提交时间</dt><dd>${formatDate(payment.created_at)}</dd>
          <dt>有效期</dt><dd>${payment.ends_at ? formatDate(payment.ends_at) : "审核通过后生成一个月有效期"}</dd>
        </dl>
        <label class="review-note">
          <span>审核备注</span>
          <textarea data-payment-note="${escapeAttribute(payment.id)}" rows="2" placeholder="拒绝原因或核对说明">${escapeHtml(payment.review_note || "")}</textarea>
        </label>
      </div>
      <aside>
        <button class="approve" data-payment-id="${escapeAttribute(payment.id)}" data-payment-status="approved" ${payment.status === "approved" ? "disabled" : ""} type="button">通过</button>
        <button class="danger" data-payment-id="${escapeAttribute(payment.id)}" data-payment-status="rejected" ${payment.status === "rejected" ? "disabled" : ""} type="button">拒绝</button>
      </aside>
    </article>
  `).join("");

  paymentList.querySelectorAll("[data-payment-status]").forEach(button => {
    button.addEventListener("click", () => updatePaymentStatus(button.dataset.paymentId, button.dataset.paymentStatus));
  });
}

async function updatePaymentStatus(id, status) {
  const textarea = paymentList.querySelector(`[data-payment-note="${CSS.escape(id)}"]`);
  const response = await fetch("/api/admin/payment-requests", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, reviewNote: textarea?.value || "" })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(paymentList, data.detail || data.error || "支付审核失败。");
  await loadPayments();
  if (status === "approved") await loadUsers();
}

async function loadNotifications() {
  renderNotice(notificationList, "正在读取通知公告...");
  const [noticeResponse, usersResponse] = await Promise.all([
    fetch("/api/admin/notifications", { headers: authHeaders() }),
    allUsers.length ? Promise.resolve(null) : fetch("/api/admin/users", { headers: authHeaders() })
  ]);
  const data = await noticeResponse.json().catch(() => ({}));
  if (!noticeResponse.ok) return renderNotice(notificationList, data.detail || data.error || "读取通知失败。");
  if (usersResponse) {
    const userData = await usersResponse.json().catch(() => ({}));
    if (usersResponse.ok) allUsers = userData.users || [];
  }
  allNotifications = data.notifications || [];
  renderNotificationsAdmin();
}

function renderNotificationsAdmin() {
  notificationList.innerHTML = `
    <article class="submission-item notification-compose">
      <div>
        <span class="status-pill">发布通知</span>
        <h2>通知公告</h2>
        <div class="admin-notification-form">
          <select id="notice-type">
            <option value="announcement">公告</option>
            <option value="activity">活动</option>
          </select>
          <select id="notice-audience">
            <option value="all">所有人</option>
            <option value="user">指定用户</option>
          </select>
          <input id="notice-quota" type="number" min="0" step="1" placeholder="活动赠送额度" />
          <input id="notice-title" type="text" maxlength="80" placeholder="标题" />
          <div class="notice-user-picker hidden">
            <input id="notice-email" type="email" placeholder="搜索或输入用户邮箱" />
            <button id="notice-add-user" type="button">添加</button>
            <div id="notice-search-results" class="notice-search-results"></div>
            <div id="notice-targets" class="notice-targets"></div>
          </div>
          <textarea id="notice-body" rows="4" placeholder="公告内容"></textarea>
          <button id="notice-publish" class="modal-primary" type="button">发布公告</button>
        </div>
      </div>
    </article>
    ${allNotifications.length ? allNotifications.map(item => `
      <article class="submission-item compact-payment">
        <div>
          <span class="status-pill">${escapeHtml(audienceLabel(item))}</span>
          <input class="notice-edit-title" data-notice-title="${escapeAttribute(item.id)}" value="${escapeAttribute(item.title)}" />
          <textarea class="notice-edit-body" data-notice-body="${escapeAttribute(item.id)}" rows="3">${escapeHtml(item.body)}</textarea>
          <dl class="submission-meta">
            <dt>类型</dt><dd>${escapeHtml(typeLabel(item.type))}${item.type === "activity" ? ` · ${escapeHtml(item.quota_delta || 0)} 次额度` : ""}</dd>
            <dt>发布时间</dt><dd>${formatDate(item.created_at)}</dd>
            <dt>发布者</dt><dd>${escapeHtml(item.created_by_email || "system")}</dd>
          </dl>
        </div>
        <aside>
          <button data-notice-save="${escapeAttribute(item.id)}" type="button">保存</button>
          <button class="danger" data-notice-delete="${escapeAttribute(item.id)}" type="button">删除</button>
        </aside>
      </article>
    `).join("") : `<article class="submission-empty">还没有发布过通知。</article>`}
  `;
  notificationList.querySelector("#notice-publish")?.addEventListener("click", publishNotification);
  notificationList.querySelector("#notice-audience")?.addEventListener("change", renderNoticeTargetPicker);
  notificationList.querySelector("#notice-email")?.addEventListener("input", renderNoticeSearchResults);
  notificationList.querySelector("#notice-add-user")?.addEventListener("click", addNoticeTargetFromInput);
  notificationList.querySelectorAll("[data-notice-save]").forEach(button => {
    button.addEventListener("click", () => updateNotification(button.dataset.noticeSave));
  });
  notificationList.querySelectorAll("[data-notice-delete]").forEach(button => {
    button.addEventListener("click", () => deleteNotification(button.dataset.noticeDelete));
  });
  renderNoticeTargetPicker();
}

async function publishNotification() {
  const audience = notificationList.querySelector("#notice-audience").value;
  const type = notificationList.querySelector("#notice-type").value;
  const title = notificationList.querySelector("#notice-title").value.trim();
  const body = notificationList.querySelector("#notice-body").value.trim();
  const quotaDelta = Number(notificationList.querySelector("#notice-quota").value || 0);
  const response = await fetch("/api/admin/notifications", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ audience, type, quotaDelta, targetEmails: noticeTargets.map(user => user.email), title, body })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(notificationList, data.detail || data.error || "发布失败。");
  noticeTargets = [];
  await loadNotifications();
}

function renderNoticeTargetPicker() {
  const audience = notificationList.querySelector("#notice-audience")?.value || "all";
  const picker = notificationList.querySelector(".notice-user-picker");
  picker?.classList.toggle("hidden", audience !== "user");
  renderNoticeTargets();
}

function renderNoticeSearchResults() {
  const input = notificationList.querySelector("#notice-email");
  const results = notificationList.querySelector("#notice-search-results");
  const keyword = input.value.trim().toLowerCase();
  if (!keyword) {
    results.innerHTML = "";
    return;
  }
  const matches = allUsers
    .filter(user => `${user.email || ""} ${user.nickname || ""}`.toLowerCase().includes(keyword))
    .slice(0, 6);
  results.innerHTML = matches.map(user => `
    <button type="button" data-pick-user="${escapeAttribute(user.email || "")}">
      ${escapeHtml(user.nickname || "未设置昵称")} · ${escapeHtml(user.email || "")}
    </button>
  `).join("");
  results.querySelectorAll("[data-pick-user]").forEach(button => {
    button.addEventListener("click", () => addNoticeTarget(button.dataset.pickUser));
  });
}

function addNoticeTargetFromInput() {
  const input = notificationList.querySelector("#notice-email");
  addNoticeTarget(input.value.trim());
}

function addNoticeTarget(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || noticeTargets.some(user => user.email === normalized)) return;
  const user = allUsers.find(item => String(item.email || "").toLowerCase() === normalized) || { email: normalized, nickname: "" };
  noticeTargets.push({ email: normalized, nickname: user.nickname || "" });
  notificationList.querySelector("#notice-email").value = "";
  notificationList.querySelector("#notice-search-results").innerHTML = "";
  renderNoticeTargets();
}

function renderNoticeTargets() {
  const target = notificationList.querySelector("#notice-targets");
  if (!target) return;
  target.innerHTML = noticeTargets.map(user => `
    <span>${escapeHtml(user.nickname || user.email)}<button data-remove-target="${escapeAttribute(user.email)}" type="button">×</button></span>
  `).join("");
  target.querySelectorAll("[data-remove-target]").forEach(button => {
    button.addEventListener("click", () => {
      noticeTargets = noticeTargets.filter(user => user.email !== button.dataset.removeTarget);
      renderNoticeTargets();
    });
  });
}

async function updateNotification(id) {
  const title = notificationList.querySelector(`[data-notice-title="${CSS.escape(id)}"]`)?.value || "";
  const body = notificationList.querySelector(`[data-notice-body="${CSS.escape(id)}"]`)?.value || "";
  const current = allNotifications.find(item => item.id === id) || {};
  const response = await fetch("/api/admin/notifications", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, title, body, type: current.type, quotaDelta: current.quota_delta || 0 })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(notificationList, data.detail || data.error || "保存失败。");
  await loadNotifications();
}

async function deleteNotification(id) {
  if (!confirm("确认删除这条通知吗？")) return;
  const response = await fetch("/api/admin/notifications", {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(notificationList, data.detail || data.error || "删除失败。");
  await loadNotifications();
}

async function loadModels() {
  renderNotice(modelList, "正在读取模型配置...");
  const response = await fetch("/api/admin/models", { headers: authHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(modelList, data.detail || data.error || "读取模型配置失败。");
  allModels = data.models || [];
  renderModels();
}

function renderModels() {
  const groups = groupModelsByProvider();
  modelList.innerHTML = `
    <article class="model-console-note">
      <strong>模型路由</strong>
      <span>只需要选一个主用模型和一个备用模型。主用失败、超时或返回空内容时，会自动切换备用。</span>
    </article>
    ${Object.entries(groups).map(([provider, models]) => providerPanel(provider, models)).join("")}
  `;

  modelList.querySelectorAll("[data-model-role]").forEach(input => {
    input.addEventListener("change", () => setModelRole(input.dataset.modelRole, input.value));
  });
  modelList.querySelectorAll("[data-model-temperature]").forEach(input => {
    input.addEventListener("change", () => updateModel(input.dataset.modelTemperature));
  });
  modelList.querySelectorAll("[data-model-test]").forEach(button => {
    button.addEventListener("click", () => testModel(button.dataset.modelTest, button));
  });
  modelList.querySelectorAll("[data-model-delete]").forEach(button => {
    button.addEventListener("click", () => deleteModel(button.dataset.modelDelete));
  });
  modelList.querySelectorAll("[data-provider-add]").forEach(button => {
    button.addEventListener("click", () => toggleProviderAdd(button.dataset.providerAdd));
  });
  modelList.querySelectorAll("[data-model-create]").forEach(button => {
    button.addEventListener("click", () => createModel(button.dataset.modelCreate));
  });
}

function providerPanel(provider, models) {
  return `
    <details class="model-provider-panel" open>
      <summary>
        <strong>${escapeHtml(providerLabel(provider))}</strong>
        <span>${models.length} 个模型</span>
        <button data-provider-add="${escapeAttribute(provider)}" type="button">设置 / 增加</button>
      </summary>
      <div class="model-provider-add hidden" data-provider-form="${escapeAttribute(provider)}">
        <input data-new-field="name" placeholder="显示名称" />
        <input data-new-field="model" placeholder="模型名" />
        <input data-new-field="apiBaseUrl" value="${escapeAttribute(defaultBaseUrl(provider))}" placeholder="API 地址" />
        <input data-new-field="apiKeyEnv" value="${escapeAttribute(defaultEnvKey(provider))}" placeholder="环境变量名" />
        <input data-new-field="apiKey" type="password" placeholder="API key，可留空" />
        <button data-model-create="${escapeAttribute(provider)}" type="button">添加模型</button>
      </div>
      <div class="model-row-list">
        ${models.map(modelRow).join("") || `<div class="model-empty-row">这个提供商下面还没有模型。</div>`}
      </div>
    </details>
  `;
}

function modelRow(model) {
  const role = model.role || "standby";
  return `
    <div class="model-row ${role !== "standby" ? "is-selected" : ""}" data-model-id="${escapeAttribute(model.id)}">
      <select class="model-role-select" data-model-role="${escapeAttribute(model.id)}" aria-label="模型角色">
        <option value="standby" ${role === "standby" ? "selected" : ""}>备选</option>
        <option value="primary" ${role === "primary" ? "selected" : ""}>主用</option>
        <option value="backup" ${role === "backup" ? "selected" : ""}>备用</option>
      </select>
      <strong>${escapeHtml(model.name || model.model)}</strong>
      <small>${escapeHtml(model.model || "")}${model.has_api_key ? " · key 已配置" : ""}</small>
      <button data-model-test="${escapeAttribute(model.id)}" type="button">测试</button>
      <button class="danger subtle" data-model-delete="${escapeAttribute(model.id)}" type="button">删除</button>
      <label>温度 <input data-model-temperature="${escapeAttribute(model.id)}" data-model-field="temperature" type="number" min="0" max="1.5" step="0.1" value="${escapeAttribute(model.temperature ?? 0.7)}" /></label>
    </div>
  `;
}

async function createModel(provider) {
  const form = modelList.querySelector(`[data-provider-form="${CSS.escape(provider)}"]`);
  const payload = {
    provider,
    name: form.querySelector('[data-new-field="name"]').value,
    apiBaseUrl: form.querySelector('[data-new-field="apiBaseUrl"]').value,
    apiKey: form.querySelector('[data-new-field="apiKey"]').value,
    apiKeyEnv: form.querySelector('[data-new-field="apiKeyEnv"]').value,
    model: form.querySelector('[data-new-field="model"]').value,
    temperature: 0.7,
    priority: 100,
    enabled: false
  };
  const response = await fetch("/api/admin/models", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(modelList, data.detail || data.error || "新增模型失败。");
  await loadModels();
}

async function updateModel(id) {
  const item = modelList.querySelector(`[data-model-id="${CSS.escape(id)}"]`);
  const payload = { id };
  item.querySelectorAll("[data-model-field]").forEach(field => {
    if (field.type === "checkbox") {
      payload[field.dataset.modelField] = field.checked;
    } else if (field.dataset.modelField !== "apiKey" || field.value.trim()) {
      payload[field.dataset.modelField] = field.value;
    }
  });
  payload.temperature = Number(payload.temperature || 0.7);
  const response = await fetch("/api/admin/models", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(modelList, data.detail || data.error || "保存模型失败。");
  await loadModels();
}

async function setModelRole(id, role) {
  const priority = role === "primary" ? 10 : (role === "backup" ? 20 : 100);
  const response = await fetch("/api/admin/models", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, role, priority, enabled: role !== "standby" })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(modelList, data.detail || data.error || "切换模型失败。");
  await loadModels();
}

function toggleProviderAdd(provider) {
  modelList.querySelector(`[data-provider-form="${CSS.escape(provider)}"]`)?.classList.toggle("hidden");
}

async function testModel(id, button) {
  button.disabled = true;
  button.textContent = "测试中";
  const response = await fetch("/api/admin/models", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, action: "test" })
  });
  const data = await response.json().catch(() => ({}));
  button.disabled = false;
  button.textContent = data.ok ? `已接通 ${data.latencyMs || 0}ms` : "测试失败";
  button.classList.toggle("approve", Boolean(data.ok));
  if (!data.ok) alert(data.error || "测试失败。");
}

async function deleteModel(id) {
  if (!confirm("确认删除这个模型配置吗？")) return;
  const response = await fetch("/api/admin/models", {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(modelList, data.detail || data.error || "删除模型失败。");
  await loadModels();
}

async function loadUsers() {
  renderNotice(userList, "正在读取用户列表...");
  const response = await fetch("/api/admin/users", { headers: authHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(userList, data.detail || data.error || "读取用户失败。");
  allUsers = data.users || [];
  renderUsers();
}

function renderUsers() {
  const keyword = userSearch.value.trim().toLowerCase();
  const users = keyword
    ? allUsers.filter(user => `${user.email || ""} ${user.nickname || ""}`.toLowerCase().includes(keyword))
    : allUsers;

  if (!users.length) return renderNotice(userList, "当前搜索下没有用户。");

  userList.innerHTML = users.map(user => `
    <article class="user-admin-item rich-user" data-user-id="${escapeAttribute(user.id)}">
      <div>
        <span class="status-pill">${escapeHtml(planLabel(user.plan))}</span>
        <strong>${escapeHtml(user.nickname || "未设置昵称")}</strong>
        <p>${escapeHtml(user.email || "unknown")}</p>
        <small>额度：${formatUsage(user.usage)} · 注册：${formatDate(user.created_at)}${user.current_period_ends_at ? ` · 到期：${formatDate(user.current_period_ends_at)}` : ""}</small>
      </div>
      <div class="user-admin-actions">
        <select data-plan-select="${escapeAttribute(user.id)}" ${user.plan === "admin" ? "disabled" : ""}>
          <option value="free" ${user.plan === "free" ? "selected" : ""}>Free</option>
          <option value="plus" ${user.plan === "plus" ? "selected" : ""}>Plus</option>
          <option value="pro" ${user.plan === "pro" ? "selected" : ""}>Pro</option>
        </select>
        <input class="admin-mini-input" data-quota-bonus="${escapeAttribute(user.id)}" type="number" min="0" step="1" value="${escapeAttribute(user.usage?.quotaBonus || 0)}" ${user.plan === "admin" ? "disabled" : ""} title="额外额度" />
        <input class="admin-date-input" data-expiry="${escapeAttribute(user.id)}" type="datetime-local" value="${escapeAttribute(toDateTimeLocal(user.current_period_ends_at))}" ${user.plan === "admin" ? "disabled" : ""} title="到期时间" />
        <button data-save-plan="${escapeAttribute(user.id)}" ${user.plan === "admin" ? "disabled" : ""} type="button">保存套餐</button>
        <button class="danger" data-delete-user="${escapeAttribute(user.id)}" data-email="${escapeAttribute(user.email || "")}" ${user.plan === "admin" ? "disabled" : ""} type="button">删除用户</button>
      </div>
    </article>
  `).join("");

  userList.querySelectorAll("[data-save-plan]").forEach(button => {
    button.addEventListener("click", () => updatePlan(button.dataset.savePlan));
  });
  userList.querySelectorAll("[data-delete-user]").forEach(button => {
    button.addEventListener("click", () => deleteUser(button.dataset.deleteUser, button.dataset.email));
  });
}

async function updatePlan(userId) {
  const select = userList.querySelector(`[data-plan-select="${CSS.escape(userId)}"]`);
  const quotaInput = userList.querySelector(`[data-quota-bonus="${CSS.escape(userId)}"]`);
  const expiryInput = userList.querySelector(`[data-expiry="${CSS.escape(userId)}"]`);
  const response = await fetch("/api/admin/users", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      plan: select.value,
      quotaBonus: Number(quotaInput?.value || 0),
      currentPeriodEndsAt: expiryInput?.value ? new Date(expiryInput.value).toISOString() : null
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(userList, data.detail || data.error || "套餐更新失败。");
  await loadUsers();
}

async function deleteUser(userId, email) {
  if (!confirm(`确认删除用户 ${email || userId}？这个操作会删除账号和关联数据。`)) return;
  const response = await fetch("/api/admin/users", {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ userId, email })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return renderNotice(userList, data.detail || data.error || "删除失败。");
  await loadUsers();
}

function reviewButton(item, status, label) {
  const disabled = item.status === status ? "disabled" : "";
  return `<button ${disabled} data-id="${escapeAttribute(item.id)}" data-review-status="${status}" type="button">${label}</button>`;
}

function saveNoteButton(item) {
  return `<button data-id="${escapeAttribute(item.id)}" data-review-status="${escapeAttribute(item.status || "pending")}" type="button">保存备注</button>`;
}

function renderNotice(target, message) {
  target.innerHTML = `<article class="submission-empty">${escapeHtml(message)}</article>`;
}

function setLoginFeedback(message, isError = false) {
  loginFeedback.textContent = message;
  loginFeedback.classList.toggle("is-error", Boolean(isError));
}

function authHeaders() {
  return { "Authorization": `Bearer ${currentSession.access_token}` };
}

function isAdminSession() {
  return (currentSession?.user?.email || "").toLowerCase() === ADMIN_EMAIL;
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || data.error || "请求失败");
  return data;
}

function planLabel(plan) {
  if (plan === "admin") return "管理员";
  if (plan === "pro") return "Pro";
  if (plan === "plus") return "Plus";
  return "Free";
}

function paymentMethodLabel(method) {
  return method === "alipay" ? "支付宝" : "微信支付";
}

function cycleLabel(cycle) {
  return cycle === "yearly" ? "按年" : "按月";
}

function actionLabel(action) {
  if (action === "renew") return "续费";
  if (action === "upgrade") return "升级";
  return "开通";
}

function audienceLabel(item) {
  if (item.audience === "user") return `用户：${item.target_email || item.target_user_id || "unknown"}`;
  if (item.audience === "plan") return `套餐：${planLabel(item.target_plan)}`;
  return "所有人";
}

function audienceLabelForModel(audience) {
  if (audience === "user") return "指定用户";
  if (audience === "plan") return "某类套餐";
  return "所有用户";
}

function groupModelsByProvider() {
  const order = ["deepseek", "siliconflow", "openrouter", "custom"];
  return order.reduce((groups, provider) => {
    groups[provider] = allModels.filter(model => model.provider === provider);
    return groups;
  }, {});
}

function providerLabel(provider) {
  if (provider === "siliconflow") return "SiliconFlow";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "custom") return "自定义节点";
  return "DeepSeek";
}

function defaultBaseUrl(provider) {
  if (provider === "siliconflow") return "https://api.siliconflow.cn/v1/chat/completions";
  if (provider === "openrouter") return "https://openrouter.ai/api/v1/chat/completions";
  if (provider === "custom") return "";
  return "https://api.deepseek.com/chat/completions";
}

function defaultEnvKey(provider) {
  if (provider === "siliconflow") return "SILICONFLOW_API_KEY";
  if (provider === "openrouter") return "OPENROUTER_API_KEY";
  if (provider === "custom") return "";
  return "DEEPSEEK_API_KEY";
}

function typeLabel(type) {
  return type === "activity" ? "活动" : "公告";
}

function formatUsage(usage = {}) {
  if (usage.unlimited) return "无限";
  return `${usage.remaining ?? 0}/${usage.limit ?? 0} 剩余，本月已用 ${usage.used ?? 0}`;
}

function formatDate(value) {
  return new Date(value || Date.now()).toLocaleString("zh-CN");
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#039;");
}
