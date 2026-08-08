import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(rootDir, ".publish-tmp");
const catalogPath = path.join(rootDir, "skills", "catalog.json");
const publicCatalogPath = path.join(rootDir, "public", "skills", "catalog.json");
const detailTemplatePath = path.join(rootDir, "public", "skills", "maoxuan-skill", "index.html");
const safeReferenceExts = new Set([".md", ".txt", ".json", ".csv"]);

loadEnv(path.join(rootDir, ".env"));

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

try {
  if (args.repo) {
    await processTask({
      id: `manual-${Date.now()}`,
      submission_id: "",
      repo_url: args.repo,
      skill_name: args.name || makeSkillId(args.repo, "community-skill"),
      created_by_email: "local-worker",
      description: args.description || ""
    });
  } else {
    globalThis.client = await connectWithRetry();
    const tasks = await loadPendingTasks();
    if (!tasks.length) {
      console.log("没有待发布任务。");
      process.exit(0);
    }

    for (const task of tasks) {
      await processTask(task);
    }
  }
} finally {
  await globalThis.client?.end().catch(() => {});
}

async function processTask(task) {
  const workspace = path.join(tempRoot, task.id);
  const repoDir = path.join(workspace, "repo");
  console.log(`开始处理：${task.skill_name} <${task.repo_url}>`);

  try {
    if (globalThis.client && !args.dryRun) await updateTaskStatus(task.id, "running");
    await rm(workspace, { recursive: true, force: true });
    await mkdir(workspace, { recursive: true });

    validateRepoUrl(task.repo_url);
    await cloneRepoWithRetry(task.repo_url, repoDir);
    await validateSkillRepo(repoDir);

    const slug = makeSkillId(task.repo_url, task.skill_name);
    await publishSkillFiles(repoDir, slug);
    await updateCatalog(slug, task, repoDir);
    await ensureDetailPage(slug);
    await refreshHomeSkillGrid();

    if (globalThis.client && !args.dryRun) {
      await updateTaskStatus(task.id, "done");
      await updateSubmissionStatus(task.submission_id, "published");
    }
    console.log(`已生成本地发布文件：${slug}`);
  } catch (error) {
    if (globalThis.client && !args.dryRun) await updateTaskStatus(task.id, "failed").catch(() => {});
    console.error(`发布失败：${task.skill_name} - ${error.message}`);
  } finally {
    if (!args.keepTemp) await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

async function loadPendingTasks() {
  const statuses = args.retryFailed ? ["pending", "failed"] : ["pending"];
  const where = [`t.status = any($1)`];
  const params = [statuses];
  if (args.taskId) {
    params.push(args.taskId);
    where.push(`t.id = $${params.length}`);
  }
  params.push(args.limit);
  const result = await globalThis.client.query(`
    select
      t.id,
      t.submission_id,
      t.repo_url,
      t.skill_name,
      t.created_by_email,
      s.description
    from public.skill_publish_tasks t
    left join public.skill_submissions s on s.id = t.submission_id
    where ${where.join(" and ")}
    order by t.created_at asc
    limit $${params.length}
  `, params);
  return result.rows;
}

async function connectWithRetry() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const nextClient = new Client(getDbConfig());
    try {
      await nextClient.connect();
      return nextClient;
    } catch (error) {
      lastError = error;
      await nextClient.end().catch(() => {});
      if (attempt < 3) {
        console.warn(`数据库连接失败，正在重试 ${attempt}/3：${error.message}`);
        await sleep(1200 * attempt);
      }
    }
  }
  throw lastError;
}

async function updateTaskStatus(id, status) {
  await globalThis.client.query(
    "update public.skill_publish_tasks set status = $1, updated_at = now() where id = $2",
    [status, id]
  );
}

async function updateSubmissionStatus(id, status) {
  await globalThis.client.query(
    "update public.skill_submissions set status = $1, updated_at = now() where id = $2",
    [status, id]
  );
}

function validateRepoUrl(repoUrl) {
  if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?\/?$/.test(repoUrl)) {
    throw new Error("只允许 https://github.com/owner/repo 格式的仓库。");
  }
}

async function validateSkillRepo(repoDir) {
  const skillPath = path.join(repoDir, "SKILL.md");
  if (!existsSync(skillPath)) {
    throw new Error("仓库根目录没有 SKILL.md。");
  }
  const info = await stat(skillPath);
  if (info.size < 200) throw new Error("SKILL.md 太短，无法发布。");
  if (info.size > 250_000) throw new Error("SKILL.md 超过 250KB，请先精简。");
}

async function publishSkillFiles(repoDir, slug) {
  const targetDir = path.join(rootDir, "skills", slug);
  if (existsSync(targetDir) && !args.overwrite) {
    throw new Error(`skills/${slug} 已存在。需要覆盖时加 --overwrite。`);
  }
  if (args.dryRun) return;

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await cp(path.join(repoDir, "SKILL.md"), path.join(targetDir, "SKILL.md"));
  await copyIfExists(path.join(repoDir, "README.md"), path.join(targetDir, "README.md"));
  await copyIfExists(path.join(repoDir, "LICENSE"), path.join(targetDir, "LICENSE"));
  await copySafeReferences(path.join(repoDir, "references"), path.join(targetDir, "references"));
}

async function copyIfExists(from, to) {
  if (!existsSync(from)) return;
  await cp(from, to);
}

async function copySafeReferences(fromDir, toDir) {
  if (!existsSync(fromDir)) return;
  await mkdir(toDir, { recursive: true });
  await copySafeTree(fromDir, toDir, 0);
}

async function copySafeTree(fromDir, toDir, depth) {
  if (depth > 4) return;
  const entries = await readdir(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(fromDir, entry.name);
    const to = path.join(toDir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true });
      await copySafeTree(from, to, depth + 1);
      continue;
    }
    if (!entry.isFile() || !safeReferenceExts.has(path.extname(entry.name).toLowerCase())) continue;
    const info = await stat(from);
    if (info.size <= 500_000) await cp(from, to);
  }
}

async function updateCatalog(slug, task, repoDir) {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const generated = await generateCatalogEntry(slug, task, repoDir);
  const entry = {
    id: slug,
    name: task.skill_name,
    description: generated.description,
    needsContext: false,
    label: generated.label,
    source: normalizeRepoUrl(task.repo_url),
    summary: generated.summary,
    bestFor: generated.bestFor,
    notes: generated.notes
  };
  const nextCatalog = catalog.filter(item => item.id !== slug).concat(entry);
  if (args.dryRun) return;
  const serialized = `${JSON.stringify(nextCatalog, null, 2)}\n`;
  await writeFile(catalogPath, serialized, "utf8");
  await writeFile(publicCatalogPath, serialized, "utf8");
}

async function generateCatalogEntry(slug, task, repoDir) {
  const skill = await readFile(path.join(repoDir, "SKILL.md"), "utf8");
  const readme = existsSync(path.join(repoDir, "README.md"))
    ? await readFile(path.join(repoDir, "README.md"), "utf8")
    : "";
  const frontmatter = parseFrontmatter(skill);
  const combined = `${readme}\n\n${skill}`;
  const inferred = inferCatalogFromText(combined);
  const description = cleanSummary(inferred.description || frontmatter.description || task.description || `${task.skill_name} skill。`);
  return {
    description,
    label: inferred.label || buildLabelFromSlug(slug),
    summary: cleanSummary(inferred.summary || description),
    bestFor: inferred.bestFor,
    notes: inferred.notes
  };
}

function parseFrontmatter(text) {
  const match = text.match(/^---\s*([\s\S]*?)\s*---/);
  if (!match) return {};
  const block = match[1];
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const lines = block.split(/\r?\n/);
  const descriptionStart = lines.findIndex(line => /^description:\s*\|/.test(line));
  const descriptionLines = [];
  if (descriptionStart !== -1) {
    for (const line of lines.slice(descriptionStart + 1)) {
      if (/^\S/.test(line)) break;
      const trimmed = line.trim();
      if (trimmed) descriptionLines.push(trimmed);
    }
  }
  const description = descriptionLines.join(" ");
  return { name, description };
}

function inferCatalogFromText(text) {
  const lower = text.toLowerCase();
  if (lower.includes("buffett") || text.includes("巴菲特") || lower.includes("economic moat")) {
    return {
      label: "公用",
      description: "巴菲特思维操作系统，基于股东信、股东大会、采访和传记提炼投资判断框架。",
      summary: "一个把 Warren Buffett 的核心心智模型、决策启发式和表达 DNA 封装起来的投资与决策视角。它适合用来审视企业、投资、合作伙伴和长期选择，而不是预测短期市场。",
      bestFor: ["判断企业是否有经济护城河", "检查自己是否在能力圈内决策", "用安全边际审视价格与价值", "评估管理层诚信和所有者思维", "把复杂机会放进「太难」篮子"],
      notes: ["先给结论，再用故事或类比解释", "语言朴素直接，避免华尔街术语", "对原则坚定，对预测谦逊", "常用护城河、棒球、农场、滚雪球等类比", "遇到不懂的问题会坦然说不知道"]
    };
  }

  if (text.includes("张雪峰") || lower.includes("zhangxuefeng")) {
    return {
      label: "公用",
      description: "张雪峰思维操作系统，聚焦教育选择、职业规划、普通家庭决策和阶层流动现实。",
      summary: "一个把张雪峰的教育选择框架、就业倒推法、阶层现实主义和东北大哥式表达封装起来的升学与职业决策视角。它适合帮普通家庭把专业、学校、行业和试错成本算清楚。",
      bestFor: ["高考志愿和专业选择", "考研院校与专业取舍", "用就业数据倒推今天的选择", "普通家庭的职业规划", "识别看起来体面但中位数很差的坑"],
      notes: ["先问家庭条件和分数背景", "说话直接、快节奏、段子化", "重视就业率、薪资中位数和真实去向", "不讲空泛理想，先算试错成本", "需要最新数据的问题应先查资料再判断"]
    };
  }

  return {
    label: extractHeading(text) || "community skill / reviewed submission",
    description: "",
    summary: extractParagraph(text),
    bestFor: extractListAfter(text, ["What's Included", "核心心智模型", "用途", "适合"]),
    notes: extractListAfter(text, ["表达DNA", "Expression DNA", "风格", "使用"])
  };
}

function extractHeading(text) {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0, 80) || "";
}

function extractParagraph(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => !/<[^>]+>/.test(line))
    .find(line => line.length > 40 && !line.startsWith("#") && !line.startsWith(">") && !line.startsWith("-"))
    ?.slice(0, 180) || "";
}

function extractListAfter(text, headings) {
  for (const heading of headings) {
    const index = text.toLowerCase().indexOf(heading.toLowerCase());
    if (index === -1) continue;
    const section = text.slice(index, index + 1800);
    const items = [...section.matchAll(/(?:^|\n)\s*(?:[-*]|\d+\.)\s+\*\*?([^*\n-][^*\n]*)\*\*?/g)]
      .map(match => match[1].replace(/\s+-\s+.*$/, "").trim())
      .filter(Boolean)
      .slice(0, 5);
    if (items.length >= 3) return items;
  }
  return ["围绕该 skill 的核心框架提问", "让它给出判断、拆解和反馈", "用对话测试这个视角是否适合当前问题"];
}

function cleanSummary(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function buildLabelFromSlug(slug) {
  return slug.replace(/[-_]+/g, " / ").slice(0, 80);
}

async function ensureDetailPage(slug) {
  if (args.dryRun) return;
  const targetDir = path.join(rootDir, "public", "skills", slug);
  await mkdir(targetDir, { recursive: true });
  const template = await readFile(detailTemplatePath, "utf8");
  await writeFile(path.join(targetDir, "index.html"), template, "utf8");
}

async function refreshHomeSkillGrid() {
  if (args.dryRun) return;
  const catalog = JSON.parse(await readFile(publicCatalogPath, "utf8"));
  const indexPath = path.join(rootDir, "public", "index.html");
  const html = await readFile(indexPath, "utf8");
  const cards = catalog.map(item => {
    const subtitle = item.description || item.summary || "社区 skill";
    return `          <a href="/skills/${escapeAttribute(item.id)}/"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(shorten(subtitle, 28))}</span><em>查看档案</em></a>`;
  }).join("\n");
  const nextGrid = [
    '<div class="home-skill-grid">',
    cards,
    '          <a class="submit-skill-card" href="/submit-skill/"><strong>提交你自己的 skill</strong><span>名称 / GitHub 仓库 / 简要说明</span><em>去提交</em></a>',
    "        </div>"
  ].join("\n");
  const nextHtml = html.replace(/<div class="home-skill-grid">[\s\S]*?        <\/div>/, nextGrid);
  await writeFile(indexPath, nextHtml, "utf8");
}

function runGit(argsList) {
  const result = spawnSync("git", ["-c", "http.sslBackend=openssl", "-c", "http.version=HTTP/1.1", ...argsList], { cwd: rootDir, stdio: "pipe", encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "git 执行失败").trim());
  }
}

async function cloneRepoWithRetry(repoUrl, repoDir) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await rm(repoDir, { recursive: true, force: true });
      runGit(["clone", "--depth", "1", repoUrl, repoDir]);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        console.warn(`git 操作失败，正在重试 ${attempt}/3：${error.message.split("\n").pop()}`);
        await sleep(1800 * attempt);
      }
    }
  }
  throw lastError;
}

function getDbConfig() {
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (connectionString) {
    return { connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000 };
  }
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    throw new Error("请先在 .env 设置 SUPABASE_DB_URL，或设置 SUPABASE_DB_PASSWORD。");
  }
  return {
    host: "aws-1-ap-southeast-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.gqhzwngzfoigzqndlbsq",
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000
  };
}

function makeSkillId(repoUrl, fallbackName) {
  const repoName = repoUrl.replace(/\/$/, "").split("/").pop().replace(/\.git$/i, "");
  const slug = slugify(repoName || fallbackName);
  if (!slug) throw new Error("无法从仓库名生成 skill id。");
  return slug;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.skill$/i, "-skill")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeRepoUrl(repoUrl) {
  const normalized = repoUrl.replace(/\/$/, "");
  return normalized.endsWith(".git") ? normalized : `${normalized}.git`;
}

function shorten(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
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

function parseArgs(argv) {
  const parsed = { limit: 1, keepTemp: false, overwrite: false, dryRun: false, retryFailed: false, help: false, taskId: "", repo: "", name: "", description: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--keep-temp") parsed.keepTemp = true;
    else if (arg === "--overwrite") parsed.overwrite = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--retry-failed") parsed.retryFailed = true;
    else if (arg === "--task") parsed.taskId = argv[++index] || "";
    else if (arg === "--limit") parsed.limit = Math.max(1, Number(argv[++index] || 1));
    else if (arg === "--repo") parsed.repo = argv[++index] || "";
    else if (arg === "--name") parsed.name = argv[++index] || "";
    else if (arg === "--description") parsed.description = argv[++index] || "";
  }
  return parsed;
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!process.env[key]) process.env[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
  }
}

function printHelp() {
  console.log(`
镜室本地 skill 发布 worker

用法：
  npm run publish:skills
  npm run publish:skills -- --limit 3
  npm run publish:skills -- --task <task-id>
  npm run publish:skills -- --repo https://github.com/owner/repo --name 名称

环境变量：
  SUPABASE_DB_PASSWORD=你的 Supabase 数据库密码
  或 SUPABASE_DB_URL=postgresql://...

选项：
  --limit <n>     一次处理几个 pending 发布任务，默认 1
  --task <id>     只处理指定任务
  --overwrite     允许覆盖本地已存在的同名 skill
  --keep-temp     保留 .publish-tmp 临时克隆目录，方便排查
  --dry-run       只克隆和校验，不写入本地文件、不改任务状态
  --retry-failed  同时重试 failed 状态的任务
  --repo <url>    不读取数据库，直接发布指定 GitHub 仓库到本地
  --name <name>   手动发布时使用的显示名称
`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
