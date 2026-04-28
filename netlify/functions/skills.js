import { ADMIN_EMAIL, isAdmin, verifySupabaseUser } from "./_shared/auth.js";
import { json } from "./_shared/json.js";
import { loadSkillCatalog } from "./_shared/skill-catalog.js";

export default async (req) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await verifyOptionalUser(req);
  const admin = authResult.ok && isAdmin(authResult.user);
  const skills = await loadSkillCatalog({ includeDisabled: admin });

  return json({
    ok: true,
    admin,
    skills: skills.map(item => admin ? item : withoutAdminFields(item))
  });
};

export const config = {
  path: "/api/skills",
  method: ["GET"]
};

async function verifyOptionalUser(req) {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.trim()) return { ok: false };
  const result = await verifySupabaseUser(req);
  if (!result.ok) return { ok: false };
  return result;
}

function withoutAdminFields(item) {
  const { adminNote, ...publicItem } = item;
  return publicItem;
}
