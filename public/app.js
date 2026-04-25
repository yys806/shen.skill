const messagesEl = document.querySelector("#messages");
const form = document.querySelector("#composer");
const promptEl = document.querySelector("#prompt");
const clearBtn = document.querySelector("#clear");
const counterpartEl = document.querySelector("#counterpart");
const sceneEl = document.querySelector("#scene");
const modelEl = document.querySelector("#model");
const temperatureEl = document.querySelector("#temperature");
const template = document.querySelector("#message-template");

const storageKey = "shen.skill.web.messages";
let messages = loadMessages();

if (!messages.length) {
  messages = [
    {
      role: "assistant",
      content:
        "先确认一下，你是谁？\n\n如果你是禹尧珅本人，我会按“真我复盘”来：不装、不长篇，帮你把动机、情绪和下一步拆清楚。"
    }
  ];
}

renderMessages();

form.addEventListener("submit", async event => {
  event.preventDefault();
  const content = promptEl.value.trim();
  if (!content) return;

  promptEl.value = "";
  addMessage("user", content);
  const thinking = addMessage("assistant", "我想一下。", true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages.filter(message => !message.pending),
        counterpart: counterpartEl.value,
        scene: sceneEl.value,
        model: modelEl.value,
        temperature: Number(temperatureEl.value || 0.7)
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(formatError(data));
    }

    thinking.pending = false;
    thinking.content = data.content || "我这边没拿到模型回复，可能是模型名或 API key 配置的问题。";
    saveMessages();
    renderMessages();
  } catch (error) {
    thinking.pending = false;
    thinking.content = `这下卡住了：${error.message}\n\n先检查后端 .env 里的 SILICONFLOW_API_KEY 和模型名。`;
    saveMessages();
    renderMessages();
  }
});

promptEl.addEventListener("keydown", event => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    form.requestSubmit();
  }
});

clearBtn.addEventListener("click", () => {
  messages = [
    {
      role: "assistant",
      content: "清空了。重新来，先告诉我：你是谁？"
    }
  ];
  saveMessages();
  renderMessages();
});

function addMessage(role, content, pending = false) {
  const message = { role, content, pending };
  messages.push(message);
  saveMessages();
  renderMessages();
  return message;
}

function renderMessages() {
  messagesEl.innerHTML = "";
  for (const message of messages) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.classList.add(message.role);
    if (message.pending) node.classList.add("thinking");
    node.querySelector(".role").textContent = message.role === "user" ? "you" : "shen.skill";
    node.querySelector(".content").textContent = message.content;
    messagesEl.appendChild(node);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function saveMessages() {
  const clean = messages
    .filter(message => !message.pending)
    .slice(-40)
    .map(({ role, content }) => ({ role, content }));
  localStorage.setItem(storageKey, JSON.stringify(clean));
}

function loadMessages() {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "[]");
  } catch {
    return [];
  }
}

function formatError(data) {
  if (!data) return "未知错误";
  if (typeof data.detail === "string") return data.detail;
  if (data.detail?.message) return data.detail.message;
  if (data.error) return data.error;
  return JSON.stringify(data);
}
