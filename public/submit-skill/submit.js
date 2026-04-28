let supabaseClient = null;
let currentSession = null;

const authBox = document.querySelector("#submit-auth");
const form = document.querySelector("#skill-submit-form");
const feedback = document.querySelector("#submit-feedback");

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

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      currentSession = session;
      renderAuthState();
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

  setFeedback("正在自动审核仓库，并生成发布任务...");
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
  setFeedback("提交成功，已自动审核通过并进入发布队列。发布 worker 会自动处理并上线。");
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
