import { readFile } from "node:fs/promises";
import path from "node:path";

const fallbackSkillId = "maoxuan-skill";
const fallbackPrompt = [
  "# maoxuan-skill fallback",
  "你是一个基于毛选方法论的分析型 skill。优先识别主要矛盾、力量关系、阶段任务和可执行路线。",
  "不要复读语录；用清楚、短句、可执行的方式分析用户的问题。"
].join("\n");

let catalogCache = null;

export async function normalizeSkillId(skill = fallbackSkillId) {
  const safeSkill = /^[a-zA-Z0-9._-]+$/.test(skill) ? skill : fallbackSkillId;
  const allowedSkills = await loadAllowedSkills();
  return allowedSkills.has(safeSkill) ? safeSkill : fallbackSkillId;
}

export async function loadSkillPrompt(skill = fallbackSkillId) {
  const safeSkill = await normalizeSkillId(skill);
  const skillPath = path.join(process.cwd(), "skills", safeSkill, "SKILL.md");

  try {
    return await readFile(skillPath, "utf8");
  } catch {
    return fallbackPrompt;
  }
}

async function loadAllowedSkills() {
  if (catalogCache) return catalogCache;
  try {
    const raw = await readFile(path.join(process.cwd(), "skills", "catalog.json"), "utf8");
    const catalog = JSON.parse(raw);
    catalogCache = new Set(
      catalog
        .map(item => item?.id)
        .filter(id => typeof id === "string" && /^[a-zA-Z0-9._-]+$/.test(id))
    );
  } catch {
    catalogCache = new Set([fallbackSkillId]);
  }
  return catalogCache;
}
