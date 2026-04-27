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

const authBox = document.querySelector("#admin-auth");
const submissionList = document.querySelector("#submission-list");
const userList = document.querySelector("#user-list");
const publishList = document.querySelector("#publish-list");
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
      renderNotice(submissionList, "Supabase 未配置，后台暂不可用。");
      return;
    }

    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data } = await supabaseClient.auth.getSession();
    currentSession = data.session;
    renderAuthState();

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      currentSession = session;
      renderAuthState();
    });
  } catch (error) {
    renderNotice(submissionList, `后台初始化失败：${error.message}`);
  }
}

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
  if (!currentSession?.user) {
    authBox.innerHTML = `
      <span>未登录</span>
      <strong>请先用管理员账号在 /chat 登录。</strong>
      <a href="/chat">去登录</a>
    `;
    renderNotice(submissionList, "等待管理员登录。");
    renderNotice(userList, "等待管理员登录。");
    renderNotice(publishList, "等待管理员登录。");
    return;
  }

  authBox.innerHTML = `
    <span>当前账号</span>
    <strong>${escapeHtml(currentSession.user.email || "unknown")}</strong>
  `;

  if (!isAdminSession()) {
    renderNotice(submissionList, "当前账号不是管理员，无法查看后台。");
    renderNotice(userList, "当前账号不是管理员，无法查看后台。");
    renderNotice(publishList, "当前账号不是管理员，无法查看后台。");
    return;
  }

  await loadActiveTab();
}

function renderTabs() {
  tabButtons.forEach(button => {
    button.classList.toggle("active", button.dataset.adminTab === activeTab);
  });
  submissionList.classList.toggle("hidden", activeTab !== "submissions");
  userList.classList.toggle("hidden", activeTab !== "users");
  publishList.classList.toggle("hidden", activeTab !== "publish");
  submissionTools.classList.toggle("hidden", activeTab !== "submissions");
  userTools.classList.toggle("hidden", activeTab !== "users");
}

async function loadActiveTab() {
  renderTabs();
  if (activeTab === "users") return loadUsers();
  if (activeTab === "publish") return loadPublishTasks();
  return loadSubmissions();
}

async function loadSubmissions() {
  renderNotice(submissionList, "正在读取提交列表...");
  const response = await fetch("/api/admin/skill-submissions", { headers: authHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    renderNotice(submissionList, data.detail || data.error || "读取失败。");
    return;
  }

  allSubmissions = data.submissions || [];
  renderSubmissions();
}

function renderSubmissions() {
  const status = statusFilter.value;
  const submissions = status === "all"
    ? allSubmissions
    : allSubmissions.filter(item => item.status === status);

  if (!submissions.length) {
    renderNotice(submissionList, "当前筛选下没有提交。");
    return;
  }

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
          ${reviewButton(item, "published", "标记已发布")}
          ${reviewButton(item, "pending", "退回待审")}
          ${publishButton(item)}
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
  submissionList.querySelectorAll("[data-publish-submission]").forEach(button => {
    button.addEventListener("click", () => createPublishTask(button.dataset.publishSubmission));
  });
}

async function updateSubmissionStatus(id, status) {
  const textarea = submissionList.querySelector(`[data-review-note="${CSS.escape(id)}"]`);
  const reviewNote = textarea?.value || "";
  const response = await fetch("/api/admin/skill-submissions", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, reviewNote })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    renderNotice(submissionList, data.detail || data.error || "更新失败。");
    return;
  }
  await loadSubmissions();
}

async function createPublishTask(submissionId) {
  const response = await fetch("/api/admin/publish-tasks", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ submissionId })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    renderNotice(submissionList, data.detail || data.error || "生成发布任务失败。");
    return;
  }
  activeTab = "publish";
  await loadActiveTab();
}

async function loadUsers() {
  renderNotice(userList, "正在读取用户列表...");
  const response = await fetch("/api/admin/users", { headers: authHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    renderNotice(userList, data.detail || data.error || "读取用户失败。");
    return;
  }

  allUsers = data.users || [];
  renderUsers();
}

function renderUsers() {
  const keyword = userSearch.value.trim().toLowerCase();
  const users = keyword
    ? allUsers.filter(user => `${user.email || ""} ${user.nickname || ""}`.toLowerCase().includes(keyword))
    : allUsers;

  if (!users.length) {
    renderNotice(userList, "当前搜索下没有用户。");
    return;
  }

  userList.innerHTML = users.map(user => `
    <article class="user-admin-item">
      <div>
        <span>${escapeHtml(user.nickname || "未设置昵称")}</span>
        <strong>${escapeHtml(user.email || "unknown")}</strong>
      </div>
      <time>注册：${formatDate(user.created_at)}</time>
    </article>
  `).join("");
}

async function loadPublishTasks() {
  renderNotice(publishList, "正在读取发布任务...");
  const response = await fetch("/api/admin/publish-tasks", { headers: authHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    renderNotice(publishList, data.detail || data.error || "读取发布任务失败。");
    return;
  }

  const tasks = data.tasks || [];
  if (!tasks.length) {
    renderNotice(publishList, "目前还没有发布任务。通过审核后可在 Skill 审批里生成。");
    return;
  }

  publishList.innerHTML = tasks.map(task => `
    <article class="submission-item">
      <div>
        <span class="status-pill status-${escapeAttribute(task.status || "pending")}">${escapeHtml(task.status || "pending")}</span>
        <h2>${escapeHtml(task.skill_name)}</h2>
        <p>半自动发布任务已生成。后续发布 worker 会基于这条任务拉仓库、校验 skill、更新白名单并触发部署。</p>
      </div>
      <aside>
        <a href="${escapeAttribute(task.repo_url)}" target="_blank" rel="noreferrer">打开 GitHub</a>
        <small>${escapeHtml(task.created_by_email || "unknown")}</small>
        <time>${formatDate(task.created_at)}</time>
      </aside>
    </article>
  `).join("");
}

function reviewButton(item, status, label) {
  const disabled = item.status === status ? "disabled" : "";
  return `<button ${disabled} data-id="${escapeAttribute(item.id)}" data-review-status="${status}" type="button">${label}</button>`;
}

function saveNoteButton(item) {
  return `<button data-id="${escapeAttribute(item.id)}" data-review-status="${escapeAttribute(item.status || "pending")}" type="button">保存备注</button>`;
}

function publishButton(item) {
  if (!["approved", "published"].includes(item.status)) return "";
  return `<button data-publish-submission="${escapeAttribute(item.id)}" type="button">生成发布任务</button>`;
}

function renderNotice(target, message) {
  target.innerHTML = `<article class="submission-empty">${escapeHtml(message)}</article>`;
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
