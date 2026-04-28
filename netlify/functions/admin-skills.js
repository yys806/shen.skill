import { ADMIN_EMAIL, isAdmin, verifySupabaseUser } from "./_shared/auth.js";
import { json } from "./_shared/json.js";
import { loadSkillCatalog } from "./_shared/skill-catalog.js";
import { supabaseAdminRequest } from "./_shared/supabase-admin.js";

export default async (req) => {
  if (!["GET", "PATCH"].includes(req.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) return json({ error: "Unauthorized", detail: authResult.detail }, 401);
  if (!isAdmin(authResult.user)) {
    return json({ error: "Forbidden", detail: `只有管理员 ${ADMIN_EMAIL} 可以管理 Skill。` }, 403);
  }

  if (req.method === "GET") return listSkills();
  return updateSkills(req);
};

export const config = {
  path: "/api/admin/skills",
  method: ["GET", "PATCH"]
};

async function listSkills() {
  const skills = await loadSkillCatalog({ includeDisabled: true });
  return json({ ok: true, skills });
}

async function updateSkills(req) {
  const body = await req.json().catch(() => ({}));
  if (Array.isArray(body.skills)) return updateSkillOrder(body.skills);
  return updateSingleSkill(body);
}

async function updateSingleSkill(body) {
  const id = String(body.id || "").trim();
  const enabled = Boolean(body.enabled);

  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    return json({ error: "Invalid skill id", detail: "Skill id 不合法。" }, 400);
  }

  const result = await supabaseAdminRequest("/skill_settings?on_conflict=id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify({
      id,
      enabled,
      updated_at: new Date().toISOString()
    })
  });

  if (!result.ok) return json({ error: "Skill update failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, setting: result.data?.[0] || null });
}

async function updateSkillOrder(skills) {
  const now = new Date().toISOString();
  const rows = skills
    .map((item, index) => ({
      id: String(item.id || "").trim(),
      enabled: Boolean(item.enabled),
      display_order: Number.isFinite(Number(item.displayOrder)) ? Number(item.displayOrder) : index,
      updated_at: now
    }))
    .filter(item => /^[a-zA-Z0-9._-]+$/.test(item.id));

  if (!rows.length) return json({ error: "Empty skills", detail: "没有可保存的 Skill 顺序。" }, 400);

  const result = await supabaseAdminRequest("/skill_settings?on_conflict=id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(rows)
  });

  if (!result.ok) return json({ error: "Skill order update failed", detail: result.detail }, result.status || 500);
  return json({ ok: true, settings: result.data || [] });
}
