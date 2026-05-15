let supabaseClient = null;
let session = null;
let billingState = null;
let selectedCycle = "monthly";

const SHOP_LINK = "https://pay.ldxp.cn/shop/S5I572HE";
const ITEM_LINKS = {
  plus: {
    monthly: "https://pay.ldxp.cn/item/pyfgmq",
    yearly: "https://pay.ldxp.cn/item/y1l5ld"
  },
  pro: {
    monthly: "https://pay.ldxp.cn/item/zr7qwp",
    yearly: "https://pay.ldxp.cn/item/ld0efd"
  }
};

const PRICE_TABLE = {
  monthly: { plus: 19, pro: 49 },
  yearly: { plus: 199, pro: 399 }
};

const checkoutButtons = [...document.querySelectorAll(".checkout-button")];
const cycleButtons = [...document.querySelectorAll("[data-cycle]")];
const statusPill = document.querySelector("#billing-status");
const feedback = document.querySelector("#billing-feedback");
const priceLines = {
  plus: document.querySelector('[data-price-line="plus"]'),
  pro: document.querySelector('[data-price-line="pro"]')
};
const shopLink = document.querySelector("#shop-link");
const redeemForm = document.querySelector("#redeem-form");
const redeemCode = document.querySelector("#redeem-code");
const redeemFeedback = document.querySelector("#redeem-feedback");

bootPricing();

checkoutButtons.forEach(button => {
  button.addEventListener("click", () => openShopItem(button.dataset.plan || "pro"));
});

cycleButtons.forEach(button => {
  button.addEventListener("click", () => {
    selectedCycle = button.dataset.cycle === "yearly" ? "yearly" : "monthly";
    renderPricingState();
  });
});

shopLink?.addEventListener("click", event => {
  event.preventDefault();
  window.open(SHOP_LINK, "_blank", "noopener,noreferrer");
});

redeemForm?.addEventListener("submit", redeemMembershipCode);

async function bootPricing() {
  try {
    const config = await getJson("/api/config");
    if (!config.hasMirrorAuth && !config.hasSupabase) {
      setFeedback("认证服务还没配置好，暂时不能读取会员状态。", true);
      setButtonsDisabled(true);
      setStatus("未配置");
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
    setStatus("读取失败");
  }
}

async function refreshBillingStatus() {
  if (!session?.access_token) {
    billingState = null;
    setStatus("未登录");
    setFeedback("请先到 /chat 登录，再回来购买或兑换卡密。", true);
    renderPricingState();
    return;
  }

  setFeedback("正在读取你的会员状态...");
  const response = await fetch("/api/billing/status", {
    headers: { "Authorization": `Bearer ${session.access_token}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    billingState = null;
    setStatus("读取失败");
    setFeedback(data.detail || data.error || "会员状态读取失败。", true);
    renderPricingState();
    return;
  }

  billingState = data;
  renderPricingState();
}

function renderPricingState() {
  cycleButtons.forEach(button => {
    button.classList.toggle("active", button.dataset.cycle === selectedCycle);
  });
  priceLines.plus.textContent = selectedCycle === "yearly" ? "¥199 / 年" : "¥19 / 月";
  priceLines.pro.textContent = selectedCycle === "yearly" ? "¥399 / 年" : "¥49 / 月";

  const currentPlan = getCurrentPlan();
  const expiry = billingState?.entitlement?.current_period_ends_at;
  const expiryText = expiry ? `，到期 ${new Date(expiry).toLocaleDateString("zh-CN")}` : "";

  setButtonsDisabled(false);
  if (!session?.access_token) {
    checkoutButtons.forEach(button => {
      button.disabled = false;
      button.textContent = button.dataset.plan === "plus" ? "购买 Plus 卡密" : "购买 Pro 卡密";
    });
    return;
  }

  setStatus(`${planName(currentPlan)}${expiryText}`);
  if (billingState?.isAdmin) {
    setFeedback("管理员账号为无限额度。");
    checkoutButtons.forEach(button => {
      button.disabled = true;
      button.textContent = "管理员无需订阅";
    });
    return;
  }

  if (currentPlan === "pro") {
    buttonFor("plus").disabled = true;
    buttonFor("plus").textContent = "您已是 Pro 会员";
    buttonFor("pro").disabled = false;
    buttonFor("pro").textContent = selectedCycle === "yearly" ? "购买 Pro 年卡" : "购买 Pro 月卡";
    setFeedback(formatUsageAndExpiry());
    return;
  }

  if (currentPlan === "plus") {
    buttonFor("plus").disabled = false;
    buttonFor("plus").textContent = selectedCycle === "yearly" ? "购买 Plus 年卡" : "购买 Plus 月卡";
    buttonFor("pro").disabled = false;
    buttonFor("pro").textContent = selectedCycle === "yearly" ? "购买 Pro 年卡" : "购买 Pro 月卡";
    setFeedback(formatUsageAndExpiry());
    return;
  }

  buttonFor("plus").disabled = false;
  buttonFor("plus").textContent = selectedCycle === "yearly" ? "购买 Plus 年卡" : "购买 Plus 月卡";
  buttonFor("pro").disabled = false;
  buttonFor("pro").textContent = selectedCycle === "yearly" ? "购买 Pro 年卡" : "购买 Pro 月卡";
  setFeedback("当前是 Free 状态。购买后在小店订单页复制卡密，回到这里兑换即可自动开通。");
}

function openShopItem(plan) {
  const target = ITEM_LINKS[plan]?.[selectedCycle] || SHOP_LINK;
  window.open(target, "_blank", "noopener,noreferrer");
}

async function redeemMembershipCode(event) {
  event.preventDefault();
  if (!session?.access_token) {
    window.location.href = "/chat";
    return;
  }
  const code = redeemCode.value.trim();
  if (!code) return setRedeemFeedback("请输入你在小店支付后看到的卡密。", true);

  setRedeemFeedback("正在兑换卡密...");
  redeemForm.querySelector("button").disabled = true;
  try {
    const response = await fetch("/api/billing/redeem-code", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ code })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || data.error || "兑换失败。");
    redeemCode.value = "";
    setRedeemFeedback("兑换成功，会员和额度已经自动生效。");
    await refreshBillingStatus();
  } catch (error) {
    setRedeemFeedback(error.message, true);
  } finally {
    redeemForm.querySelector("button").disabled = false;
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

function setStatus(text) {
  statusPill.textContent = text;
}

function setFeedback(message, isError = false) {
  feedback.textContent = message;
  feedback.classList.toggle("is-error", Boolean(isError));
}

function setRedeemFeedback(message, isError = false) {
  redeemFeedback.textContent = message;
  redeemFeedback.classList.toggle("is-error", Boolean(isError));
}

function buttonFor(plan) {
  return checkoutButtons.find(button => button.dataset.plan === plan);
}

function getCurrentPlan() {
  if (!billingState || !session?.access_token) return "free";
  if (billingState.isAdmin) return "admin";
  return String(billingState.entitlement?.plan || "free").toLowerCase();
}

function formatUsageAndExpiry() {
  const usage = billingState?.usage;
  const expiry = billingState?.entitlement?.current_period_ends_at;
  const usageText = usage?.unlimited ? "剩余额度：无限" : `剩余额度：${usage?.remaining ?? 0}/${usage?.limit ?? 0}`;
  const expiryText = expiry ? `订阅到期：${new Date(expiry).toLocaleString("zh-CN")}` : "订阅到期：未设置";
  return `${usageText}。${expiryText}。`;
}

function planName(plan) {
  if (plan === "admin") return "管理员";
  if (plan === "plus") return "Plus";
  if (plan === "pro") return "Pro";
  return "Free";
}
