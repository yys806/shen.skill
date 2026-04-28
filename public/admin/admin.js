const ADMIN_EMAIL = "3492675568@qq.com";
const statusLabels = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  published: "已发布"
};

let supabaseClient = null;
let currentSession = null;
let activeTab = "submissions";
let allSubmissions = [];
let allUsers = [];
let allSkills = [];

const adminMain = document.querySelector("#admin-main");
const adminGate = document.querySelector("#admin-gate");
const loginButton = document.querySelector("#admin-login");
const loginFeedback = document.querySelector("#admin-login-feedback");
const authBox = document.querySelector("#admin-auth");
const submissionList = document.querySelector("#submission-list");
const skillList = document.querySelector("#skill-list");
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

statusFilter.addEventListener("change", renderSubmissions);
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
  skillList?.classList.toggle("hidden", activeTab !== "skills");
  userList.classList.toggle("hidden", activeTab !== "users");
  submissionTools.classList.toggle("hidden", activeTab !== "submissions");
  userTools.classList.toggle("hidden", activeTab !== "users");
}

async function loadActiveTab() {
  renderTabs();
  if (activeTab === "skills") return loadSkills();
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
  const status = statusFilter.value;
  const submissions = status === "all"
    ? allSubmissions
    : allSubmissions.filter(item => item.status === status);

  if (!submissions.length) return renderNotice(submissionList, "当前筛选下没有提交。");

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
        <small>额度：${formatUsage(user.usage)} · 注册：${formatDate(user.created_at)}</small>
      </div>
      <div class="user-admin-actions">
        <select data-plan-select="${escapeAttribute(user.id)}" ${user.plan === "admin" ? "disabled" : ""}>
          <option value="free" ${user.plan === "free" ? "selected" : ""}>Free</option>
          <option value="plus" ${user.plan === "plus" ? "selected" : ""}>Plus</option>
          <option value="pro" ${user.plan === "pro" ? "selected" : ""}>Pro</option>
        </select>
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
  const response = await fetch("/api/admin/users", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ userId, plan: select.value })
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

function formatUsage(usage = {}) {
  if (usage.unlimited) return "无限";
  return `${usage.remaining ?? 0}/${usage.limit ?? 0} 剩余，本月已用 ${usage.used ?? 0}`;
}

function formatDate(value) {
  return new Date(value || Date.now()).toLocaleString("zh-CN");
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
