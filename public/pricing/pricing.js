let supabaseClient = null;
let session = null;
let billingState = null;
let selectedPlan = null;
let selectedMethod = null;
let selectedCycle = "monthly";

const PRICE_TABLE = {
  monthly: {
    plus: 19,
    pro: 49,
    upgrade_plus_to_pro: 30
  },
  yearly: {
    plus: 199,
    pro: 399
  }
};

const PLAN_CONFIG = {
  plus: { name: "Plus", monthlyQuota: 500 },
  pro: { name: "Pro", monthlyQuota: 2000 }
};

const METHOD_CONFIG = {
  wechat: { name: "微信支付", qr: "/pay-wechat.jpg" },
  alipay: { name: "支付宝", qr: "/pay-alipay.jpg" }
};

const checkoutButtons = [...document.querySelectorAll(".checkout-button")];
const cycleButtons = [...document.querySelectorAll("[data-cycle]")];
const statusPill = document.querySelector("#billing-status");
const feedback = document.querySelector("#billing-feedback");
const priceLines = {
  plus: document.querySelector('[data-price-line="plus"]'),
  pro: document.querySelector('[data-price-line="pro"]')
};
const paymentModal = document.querySelector("#payment-modal");
const paymentClose = document.querySelector("#payment-close");
const paymentTitle = document.querySelector("#payment-title");
const paymentCopy = document.querySelector("#payment-copy");
const paymentMethods = document.querySelector("#payment-methods");
const paymentQrStage = document.querySelector("#payment-qr-stage");
const paymentQr = document.querySelector("#payment-qr");
const paymentAmount = document.querySelector("#payment-amount");
const paymentMethodLabel = document.querySelector("#payment-method-label");
const paymentPaid = document.querySelector("#payment-paid");
const paymentForm = document.querySelector("#payment-confirm-form");
const payerName = document.querySelector("#payer-name");
const paymentFeedback = document.querySelector("#payment-feedback");

bootPricing();

checkoutButtons.forEach(button => {
  button.addEventListener("click", () => openPaymentFlow(button.dataset.plan || "pro"));
});

cycleButtons.forEach(button => {
  button.addEventListener("click", () => {
    selectedCycle = button.dataset.cycle === "yearly" ? "yearly" : "monthly";
    renderPricingState();
  });
});

paymentClose?.addEventListener("click", closePaymentFlow);
paymentModal?.addEventListener("click", event => {
  if (event.target === paymentModal) closePaymentFlow();
});

paymentMethods?.querySelectorAll("[data-pay-method]").forEach(button => {
  button.addEventListener("click", () => showPaymentQr(button.dataset.payMethod));
});

paymentPaid?.addEventListener("click", () => {
  paymentForm.classList.remove("hidden");
  payerName.focus();
  setPaymentFeedback("把你付款时显示的微信/支付宝用户名填一下，我会交给管理员核对。");
});

paymentForm?.addEventListener("submit", submitPaymentRequest);

async function bootPricing() {
  try {
    const config = await getJson("/api/config");
    if (!config.hasSupabase) {
      setFeedback("Supabase 还没配置好，暂时不能发起支付。", true);
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
    setFeedback("请先到 /chat 登录，再回来升级套餐。", true);
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
  priceLines.plus.textContent = selectedCycle === "yearly" ? "￥199 / 年" : "￥19 / 月";
  priceLines.pro.textContent = selectedCycle === "yearly" ? "￥399 / 年" : "￥49 / 月";

  const currentPlan = getCurrentPlan();
  const expiry = billingState?.entitlement?.current_period_ends_at;
  const expiryText = expiry ? `，到期 ${new Date(expiry).toLocaleDateString("zh-CN")}` : "";

  setButtonsDisabled(false);
  if (!session?.access_token) {
    checkoutButtons.forEach(button => {
      button.disabled = false;
      button.textContent = button.dataset.plan === "plus" ? "登录后升级 Plus" : "登录后升级 Pro";
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
    buttonFor("pro").textContent = "续费 Pro";
    setFeedback(formatUsageAndExpiry());
    return;
  }

  if (currentPlan === "plus") {
    buttonFor("plus").disabled = false;
    buttonFor("plus").textContent = "续费 Plus";
    buttonFor("pro").disabled = false;
    buttonFor("pro").textContent = selectedCycle === "monthly" ? "升级 Pro（补 30 元）" : "升级 Pro";
    setFeedback(formatUsageAndExpiry());
    return;
  }

  buttonFor("plus").disabled = false;
  buttonFor("plus").textContent = "升级 Plus";
  buttonFor("pro").disabled = false;
  buttonFor("pro").textContent = "升级 Pro";
  setFeedback("当前是 Free 状态，可以升级 Plus 或 Pro。支付申请提交后，管理员审核通过会自动开通。");
}

function openPaymentFlow(plan) {
  if (!session?.access_token) {
    window.location.href = "/chat";
    return;
  }

  if (plan === "plus" && getCurrentPlan() === "pro") return;
  selectedPlan = PLAN_CONFIG[plan] ? plan : "pro";
  selectedMethod = null;
  const amount = calculateAmount(selectedPlan);
  const config = PLAN_CONFIG[selectedPlan];
  paymentTitle.textContent = `${actionName(selectedPlan)} ${config.name}`;
  paymentCopy.textContent = `请选择支付方式，下一步会显示收款码。`;
  paymentMethods.classList.remove("hidden");
  paymentQrStage.classList.add("hidden");
  paymentForm.classList.add("hidden");
  payerName.value = "";
  setPaymentFeedback("");
  paymentAmount.textContent = `请支付 ${amount} 元`;
  paymentModal.classList.remove("hidden");
  paymentModal.setAttribute("aria-hidden", "false");
}

function closePaymentFlow() {
  paymentModal.classList.add("hidden");
  paymentModal.setAttribute("aria-hidden", "true");
}

function showPaymentQr(method) {
  selectedMethod = METHOD_CONFIG[method] ? method : "wechat";
  const amount = calculateAmount(selectedPlan);
  const payment = METHOD_CONFIG[selectedMethod];
  paymentQr.src = payment.qr;
  paymentQr.alt = `${payment.name}收款码`;
  paymentAmount.textContent = `请支付 ${amount} 元`;
  paymentMethodLabel.textContent = `${payment.name} · ${actionName(selectedPlan)} ${PLAN_CONFIG[selectedPlan].name} · ${cycleName(selectedCycle)}`;
  paymentQrStage.classList.remove("hidden");
  paymentForm.classList.add("hidden");
  setPaymentFeedback("支付完成后点“我已支付”，再提交你的付款用户名。");
}

async function submitPaymentRequest(event) {
  event.preventDefault();
  const name = payerName.value.trim();
  if (!name) {
    setPaymentFeedback("请填写付款时显示的微信/支付宝用户名。", true);
    return;
  }
  if (!selectedPlan || !selectedMethod) {
    setPaymentFeedback("请先选择套餐和支付方式。", true);
    return;
  }

  setPaymentFeedback("正在提交支付记录...");
  paymentForm.querySelector("button").disabled = true;
  try {
    const response = await fetch("/api/billing/payment-requests", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        plan: selectedPlan,
        billingCycle: selectedCycle,
        paymentMethod: selectedMethod,
        payerName: name
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || data.error || "提交失败。");
    setPaymentFeedback("已提交，等待管理员核对。通过后套餐和额度会自动生效。");
    setFeedback("支付记录已提交，管理员审核通过后会自动开通或续费。");
    await refreshBillingStatus();
    setTimeout(closePaymentFlow, 1200);
  } catch (error) {
    setPaymentFeedback(`提交失败：${error.message}`, true);
  } finally {
    paymentForm.querySelector("button").disabled = false;
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

function setPaymentFeedback(message, isError = false) {
  paymentFeedback.textContent = message;
  paymentFeedback.classList.toggle("is-error", Boolean(isError));
}

function buttonFor(plan) {
  return checkoutButtons.find(button => button.dataset.plan === plan);
}

function getCurrentPlan() {
  if (!billingState || !session?.access_token) return "free";
  if (billingState.isAdmin) return "admin";
  return String(billingState.entitlement?.plan || "free").toLowerCase();
}

function calculateAmount(plan) {
  if (selectedCycle === "monthly" && getCurrentPlan() === "plus" && plan === "pro") {
    return PRICE_TABLE.monthly.upgrade_plus_to_pro;
  }
  return PRICE_TABLE[selectedCycle][plan];
}

function actionName(plan) {
  const currentPlan = getCurrentPlan();
  if (currentPlan === plan) return "续费";
  if (currentPlan === "plus" && plan === "pro") return "升级";
  return "升级";
}

function cycleName(cycle) {
  return cycle === "yearly" ? "按年" : "按月";
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
