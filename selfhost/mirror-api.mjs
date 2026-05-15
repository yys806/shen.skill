import http from "node:http";
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = process.env.MIRROR_DATA_DIR || path.join(rootDir, ".mirror-data");
const dbPath = process.env.MIRROR_DB_PATH || path.join(dataDir, "mirror.db");
const port = Number(process.env.PORT || process.env.MIRROR_PORT || 8787);
const adminEmail = (process.env.ADMIN_EMAIL || "3492675568@qq.com").toLowerCase();
const inviteCode = process.env.SIGNUP_INVITE_CODE || "08060910";
const jwtSecret = process.env.MIRROR_JWT_SECRET || "change-this-secret-before-production";

mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
initSchema();
ensureDefaultAdmin();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") return send(res, 204, "");

    const route = `${req.method} ${url.pathname}`;
    if (route === "GET /api/health") return json(res, { ok: true, provider: "mirror-api", db: dbPath });
    if (route === "GET /api/config") return json(res, { authProvider: "mirror", hasSupabase: false, hasMirrorAuth: true });

    if (route === "POST /api/auth/login") return login(req, res);
    if (route === "POST /api/auth/signup") return signup(req, res);
    if (route === "GET /api/auth/session") return session(req, res);
    if (route === "POST /api/auth/profile") return updateProfile(req, res);
    if (route === "POST /api/auth/password") return updatePassword(req, res);
    if (route === "GET /api/auth/resolve") return resolveIdentifier(req, res, url);
    if (route === "GET /api/auth/check-duplicate") return checkDuplicate(req, res, url);

    if (route === "GET /api/billing/status") return billingStatus(req, res);
    if (route === "POST /api/billing/redeem-code") return redeemCode(req, res);

    if (route === "GET /api/conversations") return listConversations(req, res);
    if (route === "POST /api/conversations") return saveConversations(req, res);
    if (route === "DELETE /api/conversations") return deleteConversation(req, res, url);

    if (route === "GET /api/skill-submissions") return listMySubmissions(req, res);
    if (route === "POST /api/skill-submissions") return createSkillSubmission(req, res);
    if (route === "GET /api/notifications") return listNotifications(req, res);
    if (route === "POST /api/notifications") return markNotifications(req, res);

    if (route === "GET /api/admin/users") return adminUsers(req, res);
    if (route === "PATCH /api/admin/users") return adminUpdateUser(req, res);
    if (route === "DELETE /api/admin/users") return adminDeleteUser(req, res);
    if (route === "GET /api/admin/membership-codes") return adminCodes(req, res, url);
    if (route === "POST /api/admin/membership-codes") return adminCreateCodes(req, res);
    if (route === "PATCH /api/admin/membership-codes") return adminPatchCode(req, res);

    return json(res, { error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return json(res, { error: "Server error", detail: error.message }, 500);
  }
});

server.listen(port, "::", () => {
  console.log(`mirror-api listening on [::]:${port}`);
});

function initSchema() {
  db.exec(`
    create table if not exists users (
      id text primary key,
      email text not null unique,
      email_key text not null unique,
      nickname text not null,
      nickname_key text not null unique,
      password_hash text not null,
      role text not null default 'user',
      plan text not null default 'free',
      status text not null default 'active',
      quota_bonus integer not null default 0,
      current_period_ends_at text,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    );
    create table if not exists request_events (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      event_type text not null,
      created_at text not null default current_timestamp
    );
    create table if not exists membership_codes (
      id text primary key,
      code text not null unique,
      group_key text not null,
      plan text not null,
      billing_cycle text not null,
      quota_delta integer not null default 0,
      period_months integer not null default 1,
      status text not null default 'unused',
      note text,
      created_by_email text,
      redeemed_by_user_id text references users(id) on delete set null,
      redeemed_by_email text,
      redeemed_at text,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    );
    create table if not exists conversations (
      id text not null,
      user_id text not null references users(id) on delete cascade,
      title text,
      pinned integer not null default 0,
      settings text,
      messages text,
      created_at_ms integer,
      updated_at_ms integer,
      primary key (id, user_id)
    );
    create table if not exists skill_submissions (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      user_email text,
      name text not null,
      repo_url text not null,
      description text not null,
      status text not null default 'pending',
      review_note text,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    );
    create table if not exists notifications (
      id text primary key,
      audience text not null default 'all',
      target_user_id text,
      target_email text,
      type text not null default 'announcement',
      title text not null,
      body text not null,
      quota_delta integer not null default 0,
      created_at text not null default current_timestamp
    );
    create table if not exists notification_reads (
      notification_id text not null,
      user_id text not null,
      read_at text not null default current_timestamp,
      primary key (notification_id, user_id)
    );
    create table if not exists notification_claims (
      notification_id text not null,
      user_id text not null,
      claimed_at text not null default current_timestamp,
      primary key (notification_id, user_id)
    );
    create index if not exists request_events_user_type_created_idx on request_events(user_id, event_type, created_at);
    create index if not exists membership_codes_group_status_idx on membership_codes(group_key, status, created_at);
    create index if not exists conversations_user_updated_idx on conversations(user_id, updated_at_ms desc);
    create index if not exists skill_submissions_user_created_idx on skill_submissions(user_id, created_at desc);
    create index if not exists notifications_created_idx on notifications(created_at desc);
  `);
}

function ensureDefaultAdmin() {
  const exists = db.prepare("select id from users where email_key = ?").get(adminEmail);
  if (exists) return;
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!password) return;
  const id = cryptoId();
  db.prepare(`
    insert into users (id, email, email_key, nickname, nickname_key, password_hash, role, plan)
    values (?, ?, ?, ?, ?, ?, 'admin', 'admin')
  `).run(id, adminEmail, adminEmail, "管理员", "管理员".toLowerCase(), hashPassword(password));
}

async function login(req, res) {
  const body = await readJson(req);
  const identifier = String(body.email || body.identifier || "").trim().toLowerCase();
  const user = db.prepare("select * from users where email_key = ? or nickname_key = ?").get(identifier, identifier);
  if (!user || !verifyPassword(body.password || "", user.password_hash)) {
    return json(res, { error: "Invalid login", detail: "邮箱/昵称或密码不正确。" }, 401);
  }
  return json(res, { session: makeSession(user), user: publicUser(user) });
}

async function signup(req, res) {
  const body = await readJson(req);
  const email = String(body.email || "").trim().toLowerCase();
  const nickname = String(body.nickname || "").trim();
  const password = String(body.password || "");
  if (String(body.inviteCode || "") !== inviteCode) return json(res, { error: "Invalid invite code", detail: "邀请码不正确。" }, 403);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, { error: "Invalid email", detail: "邮箱格式不正确。" }, 400);
  if (!nickname) return json(res, { error: "Missing nickname", detail: "昵称不能为空。" }, 400);
  if (password.length < 8) return json(res, { error: "Weak password", detail: "密码至少需要 8 位。" }, 400);
  const nicknameKey = nickname.toLowerCase();
  const duplicate = db.prepare("select email_key, nickname_key from users where email_key = ? or nickname_key = ?").get(email, nicknameKey);
  if (duplicate?.email_key === email) return json(res, { error: "Email exists", detail: "这个邮箱已经注册。" }, 409);
  if (duplicate?.nickname_key === nicknameKey) return json(res, { error: "Nickname exists", detail: "这个昵称已经注册。" }, 409);
  const id = cryptoId();
  db.prepare(`
    insert into users (id, email, email_key, nickname, nickname_key, password_hash, role, plan)
    values (?, ?, ?, ?, ?, ?, 'user', 'free')
  `).run(id, email, email, nickname, nicknameKey, hashPassword(password));
  const user = db.prepare("select * from users where id = ?").get(id);
  return json(res, { session: makeSession(user), user: publicUser(user) });
}

function session(req, res) {
  const auth = requireUser(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  return json(res, { session: makeSession(auth.user), user: publicUser(auth.user) });
}

async function updateProfile(req, res) {
  const auth = requireUser(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const body = await readJson(req);
  const nickname = String(body.nickname || "").trim();
  if (!nickname) return json(res, { error: "Missing nickname", detail: "昵称不能为空。" }, 400);
  const nicknameKey = nickname.toLowerCase();
  const duplicate = db.prepare("select id from users where nickname_key = ? and id <> ?").get(nicknameKey, auth.user.id);
  if (duplicate) return json(res, { error: "Nickname exists", detail: "这个昵称已经被注册。" }, 409);
  db.prepare("update users set nickname = ?, nickname_key = ?, updated_at = current_timestamp where id = ?").run(nickname, nicknameKey, auth.user.id);
  const user = db.prepare("select * from users where id = ?").get(auth.user.id);
  return json(res, { user: publicUser(user), session: makeSession(user) });
}

async function updatePassword(req, res) {
  const auth = requireUser(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const body = await readJson(req);
  if (body.oldPassword && !verifyPassword(body.oldPassword, auth.user.password_hash)) {
    return json(res, { error: "Invalid old password", detail: "原始密码不正确。" }, 403);
  }
  const password = String(body.password || body.newPassword || "");
  if (password.length < 8) return json(res, { error: "Weak password", detail: "密码至少需要 8 位。" }, 400);
  db.prepare("update users set password_hash = ?, updated_at = current_timestamp where id = ?").run(hashPassword(password), auth.user.id);
  return json(res, { ok: true });
}

function resolveIdentifier(_req, res, url) {
  const identifier = String(url.searchParams.get("identifier") || "").trim().toLowerCase();
  const user = db.prepare("select email from users where email_key = ? or nickname_key = ?").get(identifier, identifier);
  return json(res, { email: user?.email || "" });
}

function checkDuplicate(_req, res, url) {
  const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
  const nickname = String(url.searchParams.get("nickname") || "").trim().toLowerCase();
  const rows = db.prepare("select email_key, nickname_key from users where email_key = ? or nickname_key = ?").all(email, nickname);
  return json(res, {
    emailExists: rows.some(row => row.email_key === email),
    nicknameExists: rows.some(row => row.nickname_key === nickname)
  });
}

function billingStatus(req, res) {
  const auth = requireUser(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const usage = monthlyUsage(auth.user);
  const limit = planLimit(auth.user) + Number(auth.user.quota_bonus || 0);
  return json(res, {
    isAdmin: auth.user.role === "admin",
    entitlement: {
      plan: auth.user.plan,
      status: auth.user.status,
      quota_bonus: auth.user.quota_bonus,
      current_period_ends_at: auth.user.current_period_ends_at
    },
    usage: auth.user.role === "admin"
      ? { unlimited: true, used: usage, limit: null, remaining: null, quotaBonus: auth.user.quota_bonus }
      : { unlimited: false, used: usage, limit, remaining: Math.max(0, limit - usage), quotaBonus: auth.user.quota_bonus }
  });
}

async function redeemCode(req, res) {
  const auth = requireUser(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const body = await readJson(req);
  const code = normalizeCode(body.code);
  const tx = db.transaction(() => {
    const card = db.prepare("select * from membership_codes where code = ?").get(code);
    if (!card) return { status: 404, body: { error: "Code not found", detail: "卡密不存在。" } };
    if (card.status !== "unused") return { status: 409, body: { error: "Code unavailable", detail: "这张卡密已被使用或禁用。" } };
    const nextEndsAt = addMonths(new Date(activeUntil(auth.user.current_period_ends_at)), card.period_months).toISOString();
    db.prepare(`
      update membership_codes
      set status = 'redeemed', redeemed_by_user_id = ?, redeemed_by_email = ?, redeemed_at = current_timestamp, updated_at = current_timestamp
      where id = ? and status = 'unused'
    `).run(auth.user.id, auth.user.email, card.id);
    db.prepare(`
      update users
      set plan = ?, status = 'active', quota_bonus = quota_bonus + ?, current_period_ends_at = ?, updated_at = current_timestamp
      where id = ?
    `).run(card.plan, card.quota_delta, nextEndsAt, auth.user.id);
    return { status: 200, body: { ok: true, code: card, entitlement: { plan: card.plan, quota_bonus: auth.user.quota_bonus + card.quota_delta, current_period_ends_at: nextEndsAt } } };
  });
  const result = tx();
  return json(res, result.body, result.status);
}

function listConversations(req, res) {
  const auth = requireUser(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const rows = db.prepare("select * from conversations where user_id = ? order by updated_at_ms desc").all(auth.user.id);
  return json(res, { conversations: rows.map(fromConversationRow) });
}

async function saveConversations(req, res) {
  const auth = requireUser(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const body = await readJson(req);
  const rows = Array.isArray(body.conversations) ? body.conversations : [];
  const upsert = db.prepare(`
    insert into conversations (id, user_id, title, pinned, settings, messages, created_at_ms, updated_at_ms)
    values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id, user_id) do update set
      title = excluded.title,
      pinned = excluded.pinned,
      settings = excluded.settings,
      messages = excluded.messages,
      created_at_ms = excluded.created_at_ms,
      updated_at_ms = excluded.updated_at_ms
  `);
  const tx = db.transaction(() => {
    for (const item of rows) {
      upsert.run(item.id, auth.user.id, item.title || "新的镜室对话", item.pinned ? 1 : 0, JSON.stringify(item.settings || {}), JSON.stringify(item.messages || []), Number(item.created_at_ms || item.createdAt || Date.now()), Number(item.updated_at_ms || item.updatedAt || Date.now()));
    }
  });
  tx();
  return json(res, { ok: true });
}

function deleteConversation(req, res, url) {
  const auth = requireUser(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const id = url.searchParams.get("id");
  db.prepare("delete from conversations where id = ? and user_id = ?").run(id, auth.user.id);
  return json(res, { ok: true });
}

function listMySubmissions(req, res) {
  const auth = requireUser(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const rows = db.prepare("select * from skill_submissions where user_id = ? order by created_at desc").all(auth.user.id);
  return json(res, { submissions: rows });
}

async function createSkillSubmission(req, res) {
  const auth = requireUser(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const body = await readJson(req);
  const name = String(body.name || "").trim();
  const repoUrl = String(body.repoUrl || "").trim();
  const description = String(body.description || "").trim();
  if (!name || !repoUrl || !description) {
    return json(res, { error: "Invalid submission", detail: "名称、GitHub 仓库和说明都要填写。" }, 400);
  }
  db.prepare(`
    insert into skill_submissions (id, user_id, user_email, name, repo_url, description)
    values (?, ?, ?, ?, ?, ?)
  `).run(cryptoId(), auth.user.id, auth.user.email, name, repoUrl, description);
  return listMySubmissions(req, res);
}

function listNotifications(req, res) {
  const auth = requireUser(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const rows = db.prepare(`
    select n.*,
      case when r.notification_id is null then 0 else 1 end as read,
      case when c.notification_id is null then 0 else 1 end as claimed
    from notifications n
    left join notification_reads r on r.notification_id = n.id and r.user_id = ?
    left join notification_claims c on c.notification_id = n.id and c.user_id = ?
    where n.audience = 'all'
      or n.target_user_id = ?
      or lower(coalesce(n.target_email, '')) = ?
    order by n.created_at desc
    limit 80
  `).all(auth.user.id, auth.user.id, auth.user.id, auth.user.email_key);
  return json(res, { unreadCount: rows.filter(item => !item.read).length, notifications: rows.map(row => ({ ...row, read: Boolean(row.read), claimed: Boolean(row.claimed) })) });
}

async function markNotifications(req, res) {
  const auth = requireUser(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const body = await readJson(req);
  const ids = Array.isArray(body.ids) ? body.ids : [];
  const insert = db.prepare("insert or ignore into notification_reads (notification_id, user_id) values (?, ?)");
  const tx = db.transaction(() => {
    for (const id of ids) insert.run(String(id), auth.user.id);
  });
  tx();
  return json(res, { ok: true });
}

function adminUsers(req, res) {
  const auth = requireAdmin(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const rows = db.prepare("select * from users order by created_at desc").all();
  return json(res, { users: rows.map(user => ({ ...publicUser(user), usage: { used: monthlyUsage(user), limit: planLimit(user) + Number(user.quota_bonus || 0), quotaBonus: user.quota_bonus } })) });
}

async function adminUpdateUser(req, res) {
  const auth = requireAdmin(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const body = await readJson(req);
  db.prepare("update users set plan = ?, quota_bonus = ?, current_period_ends_at = ?, updated_at = current_timestamp where id = ? and role <> 'admin'")
    .run(normalizePlan(body.plan), Number(body.quotaBonus || 0), body.currentPeriodEndsAt || null, body.userId);
  return json(res, { ok: true });
}

async function adminDeleteUser(req, res) {
  const auth = requireAdmin(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const body = await readJson(req);
  db.prepare("delete from users where id = ? and role <> 'admin'").run(body.userId);
  return json(res, { ok: true });
}

function adminCodes(req, res, url) {
  const auth = requireAdmin(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const group = url.searchParams.get("group");
  const status = url.searchParams.get("status");
  let sql = "select * from membership_codes where 1=1";
  const params = [];
  if (group) { sql += " and group_key = ?"; params.push(group); }
  if (status) { sql += " and status = ?"; params.push(status); }
  sql += " order by created_at desc limit 300";
  return json(res, { groups: codeGroups(), codes: db.prepare(sql).all(...params) });
}

async function adminCreateCodes(req, res) {
  const auth = requireAdmin(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const body = await readJson(req);
  const groupKey = normalizeGroup(body.groupKey);
  if (!groupKey) return json(res, { error: "Invalid group", detail: "请选择卡密组。" }, 400);
  const group = CODE_GROUPS[groupKey];
  const count = Math.max(1, Math.min(200, Number(body.count || 1)));
  const insert = db.prepare(`
    insert into membership_codes (id, code, group_key, plan, billing_cycle, quota_delta, period_months, status, note, created_by_email)
    values (?, ?, ?, ?, ?, ?, ?, 'unused', ?, ?)
  `);
  const codes = [];
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i += 1) {
      const row = {
        id: cryptoId(),
        code: generateCode(groupKey),
        group_key: groupKey,
        plan: group.plan,
        billing_cycle: group.billingCycle,
        quota_delta: group.quotaDelta,
        period_months: group.periodMonths,
        status: "unused",
        note: String(body.note || "").slice(0, 300),
        created_by_email: auth.user.email
      };
      insert.run(row.id, row.code, row.group_key, row.plan, row.billing_cycle, row.quota_delta, row.period_months, row.note, row.created_by_email);
      codes.push(row);
    }
  });
  tx();
  return json(res, { ok: true, groups: codeGroups(), codes });
}

async function adminPatchCode(req, res) {
  const auth = requireAdmin(req);
  if (!auth.ok) return json(res, auth.body, auth.status);
  const body = await readJson(req);
  const status = ["unused", "disabled"].includes(body.status) ? body.status : "";
  if (!status) return json(res, { error: "Invalid status", detail: "状态只能是 unused / disabled。" }, 400);
  db.prepare("update membership_codes set status = ?, note = ?, updated_at = current_timestamp where id = ? and status <> 'redeemed'")
    .run(status, String(body.note || "").slice(0, 300), body.id);
  const code = db.prepare("select * from membership_codes where id = ?").get(body.id);
  return json(res, { ok: true, code });
}

function requireAdmin(req) {
  const auth = requireUser(req);
  if (!auth.ok) return auth;
  if (auth.user.role !== "admin" && auth.user.email_key !== adminEmail) {
    return { ok: false, status: 403, body: { error: "Forbidden", detail: "只有管理员可以操作。" } };
  }
  return auth;
}

function requireUser(req) {
  const authorization = req.headers.authorization || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const payload = verifyToken(token);
  if (!payload?.sub) return { ok: false, status: 401, body: { error: "Unauthorized", detail: "请先登录。" } };
  const user = db.prepare("select * from users where id = ?").get(payload.sub);
  if (!user) return { ok: false, status: 401, body: { error: "Unauthorized", detail: "登录状态无效。" } };
  return { ok: true, user };
}

function makeSession(user) {
  return {
    access_token: signToken({ sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14 }),
    token_type: "bearer",
    expires_in: 60 * 60 * 24 * 14,
    user: publicUser(user)
  };
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    plan: user.plan,
    current_period_ends_at: user.current_period_ends_at,
    created_at: user.created_at,
    user_metadata: { nickname: user.nickname },
    nickname: user.nickname
  };
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const actual = Buffer.from(scryptSync(String(password), salt, 32).toString("hex"));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function signToken(payload) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = base64url(createHmac("sha256", jwtSecret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  const [header, body, signature] = String(token || "").split(".");
  if (!header || !body || !signature) return null;
  const expected = base64url(createHmac("sha256", jwtSecret).update(`${header}.${body}`).digest());
  if (signature !== expected) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function base64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return buffer.toString("base64url");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; if (raw.length > 2_000_000) req.destroy(new Error("Body too large")); });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function json(res, data, status = 200) {
  return send(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function cryptoId() {
  return randomBytes(16).toString("hex");
}

function normalizeCode(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const CODE_GROUPS = {
  plus_monthly: { label: "Plus 月度", plan: "plus", billingCycle: "monthly", periodMonths: 1, quotaDelta: 500 },
  plus_yearly: { label: "Plus 年度", plan: "plus", billingCycle: "yearly", periodMonths: 12, quotaDelta: 6000 },
  pro_monthly: { label: "Pro 月度", plan: "pro", billingCycle: "monthly", periodMonths: 1, quotaDelta: 2000 },
  pro_yearly: { label: "Pro 年度", plan: "pro", billingCycle: "yearly", periodMonths: 12, quotaDelta: 24000 }
};

function codeGroups() {
  return Object.entries(CODE_GROUPS).map(([key, value]) => ({ key, ...value }));
}

function normalizeGroup(groupKey) {
  const key = String(groupKey || "").trim().toLowerCase();
  return CODE_GROUPS[key] ? key : "";
}

function generateCode(groupKey) {
  const prefix = { plus_monthly: "PM", plus_yearly: "PY", pro_monthly: "RM", pro_yearly: "RY" }[groupKey] || "MR";
  return `${prefix}${randomBytes(9).toString("hex").toUpperCase()}`;
}

function normalizePlan(plan) {
  return ["free", "plus", "pro"].includes(String(plan || "").toLowerCase()) ? String(plan).toLowerCase() : "free";
}

function planLimit(user) {
  if (user.role === "admin" || user.plan === "admin") return 0;
  return { free: 50, plus: 500, pro: 2000 }[normalizePlan(user.plan)] || 50;
}

function monthlyUsage(user) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return db.prepare("select count(*) as count from request_events where user_id = ? and event_type = 'chat' and created_at >= ?")
    .get(user.id, start.toISOString())?.count || 0;
}

function activeUntil(value) {
  const current = value ? new Date(value) : null;
  const now = new Date();
  return current && current.getTime() > now.getTime() ? current : now;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + Number(months || 1));
  return next;
}

function fromConversationRow(row) {
  return {
    id: row.id,
    title: row.title,
    pinned: Boolean(row.pinned),
    settings: parseJson(row.settings, {}),
    messages: parseJson(row.messages, []),
    created_at_ms: row.created_at_ms,
    updated_at_ms: row.updated_at_ms
  };
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ""); } catch { return fallback; }
}
