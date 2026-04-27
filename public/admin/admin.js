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

const authBox = document.querySelector("#admin-auth");
const submissionList = document.querySelector("#submission-list");
const userList = document.querySelector("#user-list");
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

async function renderAuthState() {
  if (!currentSession?.user) {
    authBox.innerHTML = `
      <span>未登录</span>
      <strong>请先用管理员账号在 /chat 登录。</strong>
      <a href="/chat">去登录</a>
    `;
    renderNotice(submissionList, "等待管理员登录。");
    renderNotice(userList, "等待管理员登录。");
    return;
  }

  authBox.innerHTML = `
    <span>当前账号</span>
    <strong>${escapeHtml(currentSession.user.email || "unknown")}</strong>
  `;

  if (!isAdminSession()) {
    renderNotice(submissionList, "当前账号不是管理员，无法查看后台。");
    renderNotice(userList, "当前账号不是管理员，无法查看后台。");
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
}

async function loadActiveTab() {
  renderTabs();
  if (activeTab === "users") {
    await loadUsers();
  } else {
    await loadSubmissions();
  }
}

async function loadSubmissions() {
  renderNotice(submissionList, "正在读取提交列表...");
  const response = await fetch("/api/admin/skill-submissions", {
    headers: authHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    renderNotice(submissionList, data.detail || data.error || "读取失败。");
    return;
  }

  const submissions = data.submissions || [];
  if (!submissions.length) {
    renderNotice(submissionList, "目前还没有提交。");
    return;
  }

  submissionList.innerHTML = submissions.map(item => `
    <article class="submission-item" data-submission-id="${escapeAttribute(item.id)}">
      <div>
        <span class="status-pill status-${escapeAttribute(item.status || "pending")}">${escapeHtml(statusLabels[item.status] || item.status || "待审核")}</span>
        <h2>${escapeHtml(item.name)}</h2>
        <p>${escapeHtml(item.description)}</p>
        <div class="review-actions">
          ${reviewButton(item, "approved", "通过")}
          ${reviewButton(item, "rejected", "拒绝")}
          ${reviewButton(item, "published", "标记已发布")}
          ${reviewButton(item, "pending", "退回待审")}
        </div>
      </div>
      <aside>
        <a href="${escapeAttribute(item.repo_url)}" target="_blank" rel="noreferrer">打开 GitHub</a>
        <small>${escapeHtml(item.submitter_email || item.user_id || "unknown")}</small>
        <time>${new Date(item.created_at).toLocaleString("zh-CN")}</time>
      </aside>
    </article>
  `).join("");

  submissionList.querySelectorAll("[data-review-status]").forEach(button => {
    button.addEventListener("click", () => updateSubmissionStatus(button.dataset.id, button.dataset.reviewStatus));
  });
}

async function updateSubmissionStatus(id, status) {
  const button = submissionList.querySelector(`[data-id="${CSS.escape(id)}"][data-review-status="${CSS.escape(status)}"]`);
  if (button) button.textContent = "处理中...";
  const response = await fetch("/api/admin/skill-submissions", {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ id, status })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    renderNotice(submissionList, data.detail || data.error || "更新失败。");
    return;
  }
  await loadSubmissions();
}

async function loadUsers() {
  renderNotice(userList, "正在读取用户列表...");
  const response = await fetch("/api/admin/users", {
    headers: authHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    renderNotice(userList, data.detail || data.error || "读取用户失败。");
    return;
  }

  const users = data.users || [];
  if (!users.length) {
    renderNotice(userList, "目前还没有用户。");
    return;
  }

  userList.innerHTML = users.map(user => `
    <article class="user-admin-item">
      <div>
        <span>${escapeHtml(user.nickname || "未设置昵称")}</span>
        <strong>${escapeHtml(user.email || "unknown")}</strong>
      </div>
      <time>注册：${new Date(user.created_at).toLocaleString("zh-CN")}</time>
    </article>
  `).join("");
}

function reviewButton(item, status, label) {
  const disabled = item.status === status ? "disabled" : "";
  return `<button ${disabled} data-id="${escapeAttribute(item.id)}" data-review-status="${status}" type="button">${label}</button>`;
}

function renderNotice(target, message) {
  target.innerHTML = `<article class="submission-empty">${escapeHtml(message)}</article>`;
}

function authHeaders() {
  return {
    "Authorization": `Bearer ${currentSession.access_token}`
  };
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
