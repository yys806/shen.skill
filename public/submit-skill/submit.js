let supabaseClient = null;
let currentSession = null;

const authBox = document.querySelector("#submit-auth");
const form = document.querySelector("#skill-submit-form");
const feedback = document.querySelector("#submit-feedback");
const mySubmissions = document.querySelector("#my-submissions");

const statusLabels = {
  pending: "待审核",
  approved: "已通过，等待发布",
  rejected: "已拒绝",
  published: "已发布"
};

bootSubmitPage();

async function bootSubmitPage() {
  try {
    const config = await getJson("/api/config");
    if (!config.hasSupabase) {
      setFeedback("Supabase 还没配置好，暂时不能提交。", true);
      form.classList.add("is-disabled");
      return;
    }

    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data } = await supabaseClient.auth.getSession();
    currentSession = data.session;
    renderAuthState();
    await loadMySubmissions();

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      currentSession = session;
      renderAuthState();
      await loadMySubmissions();
    });
  } catch (error) {
    setFeedback(`初始化失败：${error.message}`, true);
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentSession?.access_token) {
    setFeedback("提交必须先登录。你可以先去 /chat 登录，再回到这里提交。", true);
    return;
  }

  const payload = {
    name: form.name.value.trim(),
    repoUrl: form.repoUrl.value.trim(),
    description: form.description.value.trim()
  };

  if (!payload.name || !payload.repoUrl || !payload.description) {
    setFeedback("名称、GitHub 仓库地址和简要说明都要填写。", true);
    return;
  }

  setFeedback("正在提交审核...");
  const response = await fetch("/api/skill-submissions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${currentSession.access_token}`
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    setFeedback(data.detail || data.error || "提交失败，请稍后再试。", true);
    return;
  }

  form.reset();
  setFeedback("提交成功，等待管理员审核。你可以在下方查看状态和备注。");
  await loadMySubmissions();
});

function renderAuthState() {
  if (currentSession?.user) {
    authBox.innerHTML = `
      <span>已登录</span>
      <strong>${escapeHtml(currentSession.user.email || "当前用户")}</strong>
    `;
    form.classList.remove("is-disabled");
    return;
  }

  authBox.innerHTML = `
    <span>提交必须登录</span>
    <strong>请先到 /chat 登录或注册，再回来提交。</strong>
    <a href="/chat">去登录</a>
  `;
  form.classList.add("is-disabled");
}

async function loadMySubmissions() {
  if (!mySubmissions) return;
  if (!currentSession?.access_token) {
    mySubmissions.innerHTML = `<article class="submission-empty">登录后可以查看自己的提交状态。</article>`;
    return;
  }

  mySubmissions.innerHTML = `<article class="submission-empty">正在读取提交记录...</article>`;
  const response = await fetch("/api/skill-submissions", {
    headers: {
      "Authorization": `Bearer ${currentSession.access_token}`
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    mySubmissions.innerHTML = `<article class="submission-empty">${escapeHtml(data.detail || data.error || "读取失败。")}</article>`;
    return;
  }

  const submissions = data.submissions || [];
  if (!submissions.length) {
    mySubmissions.innerHTML = `<article class="submission-empty">还没有提交记录。</article>`;
    return;
  }

  mySubmissions.innerHTML = submissions.map(item => `
    <article class="submission-item compact">
      <div>
        <span class="status-pill status-${escapeAttribute(item.status || "pending")}">${escapeHtml(statusLabels[item.status] || item.status || "待审核")}</span>
        <h2>${escapeHtml(item.name)}</h2>
        <p>${escapeHtml(item.description || "")}</p>
        ${item.review_note ? `<p class="review-note-display"><strong>管理员备注：</strong>${escapeHtml(item.review_note)}</p>` : `<p class="review-note-display muted">暂无管理员备注。</p>`}
      </div>
      <aside>
        <a href="${escapeAttribute(item.repo_url)}" target="_blank" rel="noreferrer">GitHub</a>
        <time>${formatDate(item.created_at)}</time>
      </aside>
    </article>
  `).join("");
}

function setFeedback(message, isError = false) {
  feedback.textContent = message;
  feedback.classList.toggle("is-error", Boolean(isError));
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

function formatDate(value) {
  return new Date(value || Date.now()).toLocaleString("zh-CN");
}
