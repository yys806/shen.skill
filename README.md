# shen.skill web

一个把 `skills/` 目录里的 skill 封装成网页聊天的轻量应用。前端负责聊天界面，Netlify Functions 负责鉴权、读取本项目内的 `shen.skill` 并调用 SiliconFlow Chat Completions API。

## 使用

1. 复制环境变量文件：

```powershell
Copy-Item .env.example .env
```

2. 编辑 `.env`，填入你的 SiliconFlow API key：

```env
SILICONFLOW_API_KEY=sk-your-key-here
SILICONFLOW_MODEL=Qwen/Qwen2.5-72B-Instruct
SUPABASE_URL=https://gqhzwngzfoigzqndlbsq.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
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

- SiliconFlow API key 只在后端/Netlify 环境变量中使用，不会发到浏览器。
- Supabase anon key 是前端初始化登录所需的 public key，但仍建议通过 Netlify 环境变量注入，不要写死在代码里。
- 默认读取 `skills/shen.skill/SKILL.md`。如果你后续继续精修这份 skill，网页会在每次请求时重新读取最新内容。
- 后面要加新的 skill，可以继续放到 `skills/` 目录下；当前前端先使用 `shen.skill`。
- 如果 SiliconFlow 模型名变化，只需要改 `.env` 或网页左侧的模型输入框。

## Netlify 环境变量

部署到 Netlify 后，在 Site configuration -> Environment variables 里设置：

```text
SILICONFLOW_API_KEY
SILICONFLOW_MODEL
SUPABASE_URL
SUPABASE_ANON_KEY
SHEN_SKILL_PATH
```

`SUPABASE_URL` 当前使用：

```text
https://gqhzwngzfoigzqndlbsq.supabase.co
```

## Supabase 用户资料表

为了支持昵称唯一、邮箱唯一、昵称登录，需要在 Supabase SQL Editor 里执行：

```text
supabase/schema.sql
```

执行后：

- 注册时 `nickname` 会自动写入 `public.profiles`。
- `profiles.nickname_key` 唯一，避免昵称重复。
- `profiles.email` 唯一，避免邮箱重复。
- 登录框可以输入邮箱，也可以输入昵称。
