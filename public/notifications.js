import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

let supabaseClient = null;
let session = null;
let notifications = [];
let unreadCount = 0;
let opened = false;

const widget = document.createElement("section");
widget.className = "notification-widget";
widget.innerHTML = `
  <button class="notification-bell" type="button" aria-label="通知中心">
    <span class="bell-shape">铃</span>
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
`;
document.body.appendChild(widget);

const bell = widget.querySelector(".notification-bell");
const dot = widget.querySelector(".notification-dot");
const countBadge = widget.querySelector(".notification-count");
const panel = widget.querySelector(".notification-panel");
const total = widget.querySelector(".notification-total");
const list = widget.querySelector(".notification-list");

bootNotifications();

bell.addEventListener("click", async () => {
  opened = !opened;
  panel.classList.toggle("hidden", !opened);
  if (opened) {
    renderNotifications();
  }
});

total.addEventListener("click", markVisibleRead);

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
    supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data } = await supabaseClient.auth.getSession();
    session = data.session;
    await refreshNotifications();
    supabaseClient.auth.onAuthStateChange(async (_event, nextSession) => {
      session = nextSession;
      await refreshNotifications();
    });
    window.setInterval(refreshNotifications, 60_000);
  } catch {
    renderLoggedOut();
  }
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
    <article class="notification-item ${item.read ? "" : "unread"}">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${formatDate(item.created_at)}</span>
      </div>
      <p>${escapeHtml(item.body)}</p>
    </article>
  `).join("");
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.error || "请求失败");
  return data;
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
