let supabaseClient = null;
let session = null;

const checkoutButtons = [...document.querySelectorAll(".checkout-button")];
const statusPill = document.querySelector("#billing-status");
const feedback = document.querySelector("#billing-feedback");

bootPricing();

checkoutButtons.forEach(button => {
  button.addEventListener("click", () => startCheckout(button));
});

async function bootPricing() {
  try {
    const config = await getJson("/api/config");
    if (!config.hasSupabase) {
      setFeedback("Supabase 还没配置好，暂时不能发起支付。", true);
      setButtonsDisabled(true);
      setStatus("未配置", "inactive");
      return;
    }

    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data } = await supabaseClient.auth.getSession();
    session = data.session;
    await refreshBillingStatus();

    supabaseClient.auth.onAuthStateChange(async (_event, nextSession) => {
      session = nextSession;
      await refreshBillingStatus();
    });
  } catch (error) {
    setFeedback(`初始化失败：${error.message}`, true);
    setStatus("读取失败", "inactive");
  }
}

async function refreshBillingStatus() {
  if (!session?.access_token) {
    setStatus("未登录", "inactive");
    setFeedback("请先到 /chat 登录，再回来升级套餐。", true);
    checkoutButtons.forEach(button => {
      button.textContent = button.dataset.plan === "plus" ? "登录后升级 Plus" : "登录后升级 Pro";
    });
    return;
  }

  setFeedback("正在读取你的会员状态...");
  const response = await fetch("/api/billing/status", {
    headers: { "Authorization": `Bearer ${session.access_token}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus("读取失败", "inactive");
    setFeedback(data.detail || data.error || "会员状态读取失败。", true);
    return;
  }

  const entitlement = data.entitlement || {};
  if (data.isPaid) {
    setStatus(`${planName(entitlement.plan)} 已激活`, "active");
    setFeedback(formatPeriod(entitlement.current_period_ends_at));
    return;
  }

  setStatus("Free", "inactive");
  setFeedback("当前是 Free 状态，可以升级 Plus 或 Pro。");
}

async function startCheckout(button) {
  if (!session?.access_token) {
    window.location.href = "/chat";
    return;
  }

  const plan = button.dataset.plan || "pro";
  setButtonsDisabled(true);
  setFeedback(`正在创建 ${planName(plan)} 的 Paddle 收银台...`);
  try {
    const response = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ plan })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.checkoutUrl) {
      throw new Error(data.detail || data.error || "没有拿到 Paddle checkoutUrl。");
    }
    window.location.href = data.checkoutUrl;
  } catch (error) {
    setButtonsDisabled(false);
    setFeedback(`创建支付失败：${error.message}`, true);
  }
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.error || "请求失败");
  return data;
}

function setButtonsDisabled(disabled) {
  checkoutButtons.forEach(button => {
    button.disabled = disabled;
  });
}

function setStatus(text, type) {
  statusPill.textContent = text;
  statusPill.dataset.status = type;
}

function setFeedback(message, isError = false) {
  feedback.textContent = message;
  feedback.classList.toggle("is-error", Boolean(isError));
}

function formatPeriod(value) {
  if (!value) return "会员状态已同步。";
  return `会员有效期至 ${new Date(value).toLocaleString("zh-CN")}。`;
}

function planName(plan) {
  return String(plan).toLowerCase() === "plus" ? "Plus" : "Pro";
}
