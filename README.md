# shen.skill web

一个把 `skills/` 目录里的 skill 封装成网页聊天的轻量应用。前端负责聊天界面，后端读取本项目内的 `shen.skill` 并调用 SiliconFlow Chat Completions API。

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
SHEN_SKILL_PATH=skills\shen.skill\SKILL.md
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
- 默认读取 `skills/shen.skill/SKILL.md`。如果你后续继续精修这份 skill，网页会在每次请求时重新读取最新内容。
- 后面要加新的 skill，可以继续放到 `skills/` 目录下；当前前端先使用 `shen.skill`。
- 如果 SiliconFlow 模型名变化，只需要改 `.env` 或网页左侧的模型输入框。
