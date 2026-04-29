let supabaseClient = null;
let session = null;
let selectedPlan = null;
let selectedMethod = null;

const PLAN_CONFIG = {
  plus: { name: "Plus", amount: 19 },
  pro: { name: "Pro", amount: 49 }
};

const METHOD_CONFIG = {
  wechat: { name: "微信支付", qr: "/pay-wechat.jpg" },
  alipay: { name: "支付宝", qr: "/pay-alipay.jpg" }
};

const checkoutButtons = [...document.querySelectorAll(".checkout-button")];
const statusPill = document.querySelector("#billing-status");
const feedback = document.querySelector("#billing-feedback");
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

  setButtonsDisabled(false);
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
  if (data.isPaid || data.isAdmin) {
    setStatus(`${planName(entitlement.plan)} 已激活`, "active");
    setFeedback(data.isAdmin ? "管理员账号为无限额度。" : formatPeriod(entitlement.current_period_ends_at));
    return;
  }

  setStatus("Free", "inactive");
  setFeedback("当前是 Free 状态，可以升级 Plus 或 Pro。支付申请提交后，管理员审核通过会自动开通一个月。");
}

function openPaymentFlow(plan) {
  if (!session?.access_token) {
    window.location.href = "/chat";
    return;
  }

  selectedPlan = PLAN_CONFIG[plan] ? plan : "pro";
  selectedMethod = null;
  const config = PLAN_CONFIG[selectedPlan];
  paymentTitle.textContent = `升级 ${config.name}`;
  paymentCopy.textContent = `请选择支付方式，下一步会显示收款码。`;
  paymentMethods.classList.remove("hidden");
  paymentQrStage.classList.add("hidden");
  paymentForm.classList.add("hidden");
  payerName.value = "";
  setPaymentFeedback("");
  paymentModal.classList.remove("hidden");
  paymentModal.setAttribute("aria-hidden", "false");
}

function closePaymentFlow() {
  paymentModal.classList.add("hidden");
  paymentModal.setAttribute("aria-hidden", "true");
}

function showPaymentQr(method) {
  selectedMethod = METHOD_CONFIG[method] ? method : "wechat";
  const plan = PLAN_CONFIG[selectedPlan];
  const payment = METHOD_CONFIG[selectedMethod];
  paymentQr.src = payment.qr;
  paymentQr.alt = `${payment.name}收款码`;
  paymentAmount.textContent = `请支付 ${plan.amount} 元`;
  paymentMethodLabel.textContent = `${payment.name} · ${plan.name} 一个月`;
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
        paymentMethod: selectedMethod,
        payerName: name
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || data.error || "提交失败。");
    setPaymentFeedback("已提交，等待管理员核对。通过后你的套餐会自动生效。");
    setFeedback("支付记录已提交，管理员审核通过后会自动开通套餐。");
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

function setStatus(text, type) {
  statusPill.textContent = text;
  statusPill.dataset.status = type;
}

function setFeedback(message, isError = false) {
  feedback.textContent = message;
  feedback.classList.toggle("is-error", Boolean(isError));
}

function setPaymentFeedback(message, isError = false) {
  paymentFeedback.textContent = message;
  paymentFeedback.classList.toggle("is-error", Boolean(isError));
}

function formatPeriod(value) {
  if (!value) return "会员状态已同步。";
  return `会员有效期至 ${new Date(value).toLocaleString("zh-CN")}。`;
}

function planName(plan) {
  if (String(plan).toLowerCase() === "admin") return "管理员";
  return String(plan).toLowerCase() === "plus" ? "Plus" : "Pro";
}
