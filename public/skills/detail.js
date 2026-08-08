loadDetailPage();

async function loadDetailPage() {
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const skillId = pathParts[pathParts.length - 1] || "maoxuan-skill";
  const catalog = await loadCatalog();
  const detail = catalog.find(item => item.id === skillId);
  if (!detail) {
    renderUnavailableSkill();
    return;
  }

  document.title = `${detail.name} Skill | 镜室`;
  document.querySelector("[data-skill-name]").textContent = detail.name;
  document.querySelector("[data-skill-label]").textContent = detail.label || "community skill";
  document.querySelector("[data-skill-summary]").textContent = detail.summary || detail.description || "";
  document.querySelector("[data-skill-source]").href = detail.source || "#";
  document.querySelector("[data-skill-source]").textContent = (detail.source || "GitHub").replace("https://github.com/", "");
  document.querySelector("[data-chat-link]").href = `/chat?skill=${encodeURIComponent(detail.id)}`;

  renderList("[data-best-for]", detail.bestFor || ["进入对话后按该 skill 的方法处理问题"]);
  renderList("[data-notes]", detail.notes || ["由社区提交，经管理员审核后发布"]);
}

function renderUnavailableSkill() {
  document.title = "Skill unavailable | 镜室";
  document.querySelector("[data-skill-name]").textContent = "这个 Skill 暂未启用";
  document.querySelector("[data-skill-label]").textContent = "disabled / hidden";
  document.querySelector("[data-skill-summary]").textContent = "管理员暂时关闭了这个 Skill。它不会出现在公开首页、聊天选择和公开详情里。";
  document.querySelector("[data-chat-link]").remove();
  const source = document.querySelector("[data-skill-source]");
  source.href = "/";
  source.textContent = "返回首页";
  renderList("[data-best-for]", ["等待管理员启用后再使用"]);
  renderList("[data-notes]", ["如果你是管理员，可以去后台 Skill 管理里打开开关"]);
}

async function loadCatalog() {
  const fallback = [{
    id: "maoxuan-skill",
    name: "毛选",
    label: "公用",
    source: "https://github.com/leezythu/maoxuan-skill.git",
    summary: "把毛选方法论蒸馏成可对话的分析框架。",
    bestFor: ["复杂局势拆解"],
    notes: ["先问主要矛盾是什么"]
  }];
  try {
    const response = await fetch("/api/skills", { cache: "no-store" });
    const payload = await response.json();
    const catalog = payload.skills || [];
    return response.ok && Array.isArray(catalog) && catalog.length ? catalog : fallback;
  } catch {
    return fallback;
  }
}

function renderList(selector, items) {
  const target = document.querySelector(selector);
  target.innerHTML = items.map(item => `<li>${escapeHtml(item)}</li>`).join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
