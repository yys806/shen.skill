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
DEEPSEEK_API_KEY=sk-your-deepseek-key
OPENROUTER_API_KEY=sk-your-openrouter-key
INVITE_CODE=08060910
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
DEEPSEEK_API_KEY
OPENROUTER_API_KEY
INVITE_CODE
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

## 本地 skill 发布 worker

管理员在后台把用户提交的 skill 审核通过后，可以点“生成发布任务”。本地 worker 会读取 Supabase 里的 pending 发布任务，把 GitHub 仓库克隆到 `.publish-tmp/`，校验根目录 `SKILL.md`，再把通过校验的内容发布到本地 `skills/` 和 `public/skills/`。

先在 `.env` 里补数据库连接信息，二选一：

```env
SUPABASE_DB_PASSWORD=your-database-password
# 或
SUPABASE_DB_URL=postgresql://...
```

然后运行：

```powershell
npm install
npm run publish:skills
```

常用参数：

```powershell
npm run publish:skills -- --limit 3
npm run publish:skills -- --task <task-id>
npm run publish:skills -- --dry-run --keep-temp
```

worker 只更新本地文件和 Supabase 任务状态，不会自动部署。确认生成结果没问题后，再正常提交代码并部署到 Netlify。

## 全自动审核发布

当前提交页已经接入自动审核：

- 用户提交 GitHub 仓库后，后端会检查仓库是否可访问。
- 仓库根目录必须存在 `SKILL.md`。
- `SKILL.md` 大小必须在 200 bytes 到 250KB 之间。
- 通过后 submission 会自动标记为 `approved`，并写入 `skill_publish_tasks`。
- GitHub Actions 每 10 分钟运行一次 `publish:skills`，自动拉取 pending 任务、生成本地 skill 文件、更新 catalog、提交到 GitHub。
- 如果 Netlify 已绑定 GitHub 自动部署，push 后会自动上线。

GitHub Actions 需要在仓库 Secrets 里配置：

```text
SUPABASE_DB_PASSWORD
```

## Paddle payment

当前支付闭环是：登录账号 -> 打开 `/pricing` -> 创建 Paddle checkout -> Paddle webhook 写入 Supabase 会员权益。这个版本先不默认限制聊天功能，等支付和权益同步跑稳后，再接入额度、会员模型或 Pro 功能。

Netlify 需要配置这些环境变量：

```text
SUPABASE_SERVICE_ROLE_KEY
PADDLE_ENV=sandbox
PADDLE_API_KEY
PADDLE_PRICE_ID
PADDLE_WEBHOOK_SECRET
```

Paddle webhook 地址：

```text
https://skill-chat.cn/api/webhooks/paddle
```

Supabase 需要执行最新的 `supabase/schema.sql`，新增 `user_entitlements`、`billing_events` 和 `checkout_sessions`。

如果需要立即发布，也可以在 GitHub Actions 里手动运行 `Publish approved skills`。
