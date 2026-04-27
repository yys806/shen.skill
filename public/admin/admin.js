const ADMIN_EMAIL = "3492675568@qq.com";

let supabaseClient = null;
let currentSession = null;

const authBox = document.querySelector("#admin-auth");
const list = document.querySelector("#submission-list");

bootAdminPage();

async function bootAdminPage() {
  try {
    const config = await getJson("/api/config");
    if (!config.hasSupabase) {
      renderNotice("Supabase 未配置，后台暂不可用。");
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
    renderNotice(`后台初始化失败：${error.message}`);
  }
}

async function renderAuthState() {
  if (!currentSession?.user) {
    authBox.innerHTML = `
      <span>未登录</span>
      <strong>请先用管理员账号在 /chat 登录。</strong>
      <a href="/chat">去登录</a>
    `;
    renderNotice("等待管理员登录。");
    return;
  }

  authBox.innerHTML = `
    <span>当前账号</span>
    <strong>${escapeHtml(currentSession.user.email || "unknown")}</strong>
  `;

  if ((currentSession.user.email || "").toLowerCase() !== ADMIN_EMAIL) {
    renderNotice("当前账号不是管理员，无法查看提交。");
    return;
  }

  await loadSubmissions();
}

async function loadSubmissions() {
  renderNotice("正在读取提交列表...");
  const response = await fetch("/api/admin/skill-submissions", {
    headers: {
      "Authorization": `Bearer ${currentSession.access_token}`
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    renderNotice(data.detail || data.error || "读取失败。");
    return;
  }

  const submissions = data.submissions || [];
  if (!submissions.length) {
    renderNotice("目前还没有提交。");
    return;
  }

  list.innerHTML = submissions.map(item => `
    <article class="submission-item">
      <div>
        <span>${escapeHtml(item.status || "pending")}</span>
        <h2>${escapeHtml(item.name)}</h2>
        <p>${escapeHtml(item.description)}</p>
      </div>
      <aside>
        <a href="${escapeAttribute(item.repo_url)}" target="_blank" rel="noreferrer">打开 GitHub</a>
        <small>${escapeHtml(item.submitter_email || item.user_id || "unknown")}</small>
        <time>${new Date(item.created_at).toLocaleString("zh-CN")}</time>
      </aside>
    </article>
  `).join("");
}

function renderNotice(message) {
  list.innerHTML = `<article class="submission-empty">${escapeHtml(message)}</article>`;
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
