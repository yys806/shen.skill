let supabaseClient = null;
let session = null;

const checkoutButton = document.querySelector("#checkout-button");
const statusPill = document.querySelector("#billing-status");
const feedback = document.querySelector("#billing-feedback");

bootPricing();

checkoutButton.addEventListener("click", startCheckout);

async function bootPricing() {
  try {
    const config = await getJson("/api/config");
    if (!config.hasSupabase) {
      setFeedback("Supabase 还没配置好，暂时不能发起支付。", true);
      checkoutButton.disabled = true;
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
    setFeedback("请先到 /chat 登录，再回来升级 Pro。", true);
    checkoutButton.textContent = "先去登录";
    return;
  }

  checkoutButton.textContent = "升级 Pro";
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
  if (data.isPro) {
    setStatus("Pro 已激活", "active");
    checkoutButton.textContent = "已是 Pro";
    setFeedback(formatPeriod(entitlement.current_period_ends_at));
    return;
  }

  setStatus("Free", "inactive");
  setFeedback("当前是 Free 状态，可以升级 Pro。");
}

async function startCheckout() {
  if (!session?.access_token) {
    window.location.href = "/chat";
    return;
  }

  checkoutButton.disabled = true;
  setFeedback("正在创建 Paddle 收银台...");
  try {
    const response = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.access_token}`
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.checkoutUrl) {
      throw new Error(data.detail || data.error || "没有拿到 Paddle checkoutUrl。");
    }
    window.location.href = data.checkoutUrl;
  } catch (error) {
    checkoutButton.disabled = false;
    setFeedback(`创建支付失败：${error.message}`, true);
  }
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.error || "请求失败");
  return data;
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
