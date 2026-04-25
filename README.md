# shen.skill web

一个把本地 `shen.skill` 封装成网页聊天的轻量应用。前端负责聊天界面，后端读取本地 skill 并调用 SiliconFlow Chat Completions API。

## 使用

1. 复制环境变量文件：

```powershell
Copy-Item .env.example .env
```

2. 编辑 `.env`，填入你的 SiliconFlow API key：

```env
SILICONFLOW_API_KEY=sk-your-key-here
SILICONFLOW_MODEL=Qwen/Qwen2.5-72B-Instruct
PORT=8787
SHEN_SKILL_PATH=C:\Users\Lenovo\.codex\skills\dot-skill\skills\shen.skill\SKILL.md
```

3. 启动：

```powershell
npm start
```

4. 打开：

```text
http://localhost:8787
```

## 说明

- API key 只在后端 `.env` 中使用，不会发到浏览器。
- 如果你后续继续精修 `shen.skill/SKILL.md`，这个网页会在每次请求时重新读取最新内容。
- 如果 SiliconFlow 模型名变化，只需要改 `.env` 或网页左侧的模型输入框。
