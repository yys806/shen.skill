let supabaseClient = null;
let session = null;
let notifications = [];
let unreadCount = 0;
let opened = false;
let bootPromise = null;
let booted = false;

const widget = document.createElement("section");
widget.className = "notification-widget";
widget.innerHTML = `
  <button class="notification-bell" type="button" aria-label="通知中心">
    <span class="bell-shape">通知</span>
    <i class="notification-dot hidden"></i>
    <b class="notification-count hidden">0</b>
  </button>
  <div class="notification-panel hidden">
    <div class="notification-head">
      <strong>通知中心</strong>
      <button class="notification-total" type="button">0 未读</button>
    </div>
    <div class="notification-list">
      <article class="notification-empty">正在读取通知...</article>
    </div>
  </div>
  <div class="notification-letter-backdrop hidden">
    <article class="notification-letter">
      <button class="notification-letter-close" type="button" aria-label="关闭">×</button>
      <p class="home-kicker">mirror notice</p>
      <h2></h2>
      <time></time>
      <p class="letter-body"></p>
      <button class="letter-claim hidden" type="button">领取额度</button>
      <p class="letter-feedback field-help"></p>
    </article>
  </div>
`;
document.body.appendChild(widget);

const bell = widget.querySelector(".notification-bell");
const dot = widget.querySelector(".notification-dot");
const countBadge = widget.querySelector(".notification-count");
const panel = widget.querySelector(".notification-panel");
const total = widget.querySelector(".notification-total");
const list = widget.querySelector(".notification-list");
const letterBackdrop = widget.querySelector(".notification-letter-backdrop");
const letter = widget.querySelector(".notification-letter");
const letterClose = widget.querySelector(".notification-letter-close");
const letterClaim = widget.querySelector(".letter-claim");
const letterFeedback = widget.querySelector(".letter-feedback");
let activeLetterId = "";

scheduleNotificationBoot();

bell.addEventListener("click", async () => {
  await ensureBooted();
  opened = !opened;
  panel.classList.toggle("hidden", !opened);
  if (opened) renderNotifications();
});

total.addEventListener("click", markVisibleRead);
letterClose.addEventListener("click", closeLetter);
letterBackdrop.addEventListener("click", event => {
  if (event.target === letterBackdrop) closeLetter();
});
letterClaim.addEventListener("click", claimActiveNotification);

document.addEventListener("click", event => {
  if (!opened || widget.contains(event.target)) return;
  opened = false;
  panel.classList.add("hidden");
});

async function bootNotifications() {
  try {
    const config = await getJson("/api/config");
    if (!config.hasSupabase) {
      renderLoggedOut();
      return;
    }
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data } = await supabaseClient.auth.getSession();
    session = data.session;
    await refreshNotifications();
    supabaseClient.auth.onAuthStateChange(async (_event, nextSession) => {
      session = nextSession;
      await refreshNotifications();
    });
    window.setInterval(refreshNotifications, 60_000);
    booted = true;
  } catch {
    renderLoggedOut();
  }
}

function scheduleNotificationBoot() {
  const start = () => ensureBooted();
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(start, { timeout: 2500 });
  } else {
    window.setTimeout(start, 1800);
  }
}

function ensureBooted() {
  if (booted) return Promise.resolve();
  if (!bootPromise) bootPromise = bootNotifications();
  return bootPromise;
}

async function refreshNotifications() {
  if (!session?.access_token) {
    notifications = [];
    unreadCount = 0;
    renderLoggedOut();
    updateBadge();
    return;
  }

  try {
    const response = await fetch("/api/notifications", {
      headers: { "Authorization": `Bearer ${session.access_token}` }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || data.error || "读取失败");
    notifications = data.notifications || [];
    unreadCount = data.unreadCount || 0;
    updateBadge();
    if (opened) renderNotifications();
  } catch {
    if (opened) renderError();
  }
}

async function markVisibleRead() {
  const unreadIds = notifications.filter(item => !item.read).map(item => item.id);
  if (!unreadIds.length || !session?.access_token) return;
  await fetch("/api/notifications", {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${session.access_token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ids: unreadIds })
  }).catch(() => null);
  notifications = notifications.map(item => ({ ...item, read: true }));
  unreadCount = 0;
  updateBadge();
  renderNotifications();
}

function updateBadge() {
  dot.classList.toggle("hidden", unreadCount <= 0);
  countBadge.classList.toggle("hidden", unreadCount <= 0);
  countBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
  total.textContent = `${unreadCount} 未读`;
}

function renderLoggedOut() {
  list.innerHTML = `<article class="notification-empty">登录后查看通知、充值结果和系统公告。</article>`;
  total.textContent = "未登录";
}

function renderError() {
  list.innerHTML = `<article class="notification-empty">通知读取失败，稍后再试。</article>`;
}

function renderNotifications() {
  if (!session?.access_token) return renderLoggedOut();
  if (!notifications.length) {
    list.innerHTML = `<article class="notification-empty">暂时没有通知。</article>`;
    return;
  }
  list.innerHTML = notifications.map(item => `
    <button class="notification-item ${item.read ? "" : "unread"}" data-notice-id="${escapeAttribute(item.id)}" type="button">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${typeLabel(item)} · ${formatDate(item.created_at)}</span>
      </div>
      <p>${escapeHtml(item.body)}</p>
    </button>
  `).join("");
  list.querySelectorAll("[data-notice-id]").forEach(button => {
    button.addEventListener("click", () => openLetter(button.dataset.noticeId));
  });
}

function openLetter(id) {
  const item = notifications.find(notification => notification.id === id);
  if (!item) return;
  activeLetterId = id;
  letter.querySelector("h2").textContent = item.title;
  letter.querySelector("time").textContent = `${typeLabel(item)} · ${new Date(item.created_at).toLocaleString("zh-CN")}`;
  letter.querySelector(".letter-body").textContent = item.body;
  letterClaim.classList.toggle("hidden", item.type !== "activity" || Number(item.quota_delta || 0) <= 0);
  letterClaim.disabled = Boolean(item.claimed);
  letterClaim.textContent = item.claimed ? "已领取" : `领取 ${item.quota_delta} 次额度`;
  letterFeedback.textContent = "";
  letterBackdrop.classList.remove("hidden");
}

function closeLetter() {
  activeLetterId = "";
  letterBackdrop.classList.add("hidden");
}

async function claimActiveNotification() {
  if (!activeLetterId || !session?.access_token) return;
  letterClaim.disabled = true;
  letterFeedback.textContent = "正在领取...";
  try {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "claim", id: activeLetterId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || data.error || "领取失败");
    notifications = notifications.map(item => item.id === activeLetterId ? { ...item, claimed: true } : item);
    letterClaim.textContent = "已领取";
    letterFeedback.textContent = `已领取 ${data.quotaDelta || 0} 次额度。`;
  } catch (error) {
    letterClaim.disabled = false;
    letterFeedback.textContent = error.message;
    letterFeedback.classList.add("is-error");
    if (error.message.includes("已经领取")) {
      letterClaim.disabled = true;
      letterClaim.textContent = "已领取";
      notifications = notifications.map(item => item.id === activeLetterId ? { ...item, claimed: true } : item);
    }
  }
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.error || "请求失败");
  return data;
}

function typeLabel(item) {
  return item.type === "activity" ? "活动" : "公告";
}

function formatDate(value) {
  return new Date(value || Date.now()).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
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
