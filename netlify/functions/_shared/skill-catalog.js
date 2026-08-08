import { readFile } from "node:fs/promises";
import path from "node:path";
import { supabaseAdminRequest } from "./supabase-admin.js";

const builtinPrivateSkills = [
  {
    id: "shen.skill",
    name: "禹尧珅",
    description: "禹尧珅的个人综合人格 skill，默认只在管理员启用后公开。",
    needsContext: true,
    label: "自用",
    source: "local://skills/shen.skill",
    summary: "用于复盘、理解本人语气和关系/工作场景的个人 skill。管理员可以决定是否公开启用。",
    bestFor: ["个人复盘", "工作协作语气", "关系语气理解"],
    notes: ["默认隐藏", "启用后才会进入公开 skill 列表", "管理员始终可见"]
  }
];

export async function loadSkillCatalog({ includeDisabled = false } = {}) {
  const catalog = await readBaseCatalog();
  const settings = await readSkillSettings();
  const merged = mergeCatalog(catalog, settings);
  return includeDisabled ? merged : merged.filter(item => item.enabled !== false);
}

export async function readSkillSettings() {
  const result = await supabaseAdminRequest("/skill_settings?select=id,enabled,display_order,admin_note,updated_at");
  if (!result.ok || !Array.isArray(result.data)) return new Map();
  return new Map(result.data.map(item => [item.id, item]));
}

async function readBaseCatalog() {
  const raw = await readFile(path.join(process.cwd(), "skills", "catalog.json"), "utf8");
  const catalog = JSON.parse(raw);
  const byId = new Map();
  for (const item of [...catalog, ...builtinPrivateSkills]) {
    if (item?.id && !byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

function mergeCatalog(catalog, settings) {
  return catalog.map((item, index) => {
    const setting = settings.get(item.id);
    const defaultEnabled = item.id === "shen.skill" ? false : true;
    return {
      ...item,
      enabled: setting ? Boolean(setting.enabled) : defaultEnabled,
      displayOrder: Number.isFinite(Number(setting?.display_order)) ? Number(setting.display_order) : index,
      adminNote: setting?.admin_note || ""
    };
  }).sort((a, b) => (a.displayOrder - b.displayOrder) || String(a.name).localeCompare(String(b.name), "zh-CN"));
}
