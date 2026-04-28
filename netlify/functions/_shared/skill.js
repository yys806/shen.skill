import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadSkillCatalog } from "./skill-catalog.js";

const fallbackSkillId = "maoxuan-skill";
const fallbackPrompt = [
  "# maoxuan-skill fallback",
  "你是一个基于毛选方法论的分析型 skill。优先识别主要矛盾、力量关系、阶段任务和可执行路线。",
  "不要复读语录；用清楚、短句、可执行的方式分析用户的问题。"
].join("\n");

const catalogCache = new Map();

export async function normalizeSkillId(skill = fallbackSkillId, options = {}) {
  const safeSkill = /^[a-zA-Z0-9._-]+$/.test(skill) ? skill : fallbackSkillId;
  const allowedSkills = await loadAllowedSkills(options);
  return allowedSkills.has(safeSkill) ? safeSkill : fallbackSkillId;
}

export async function loadSkillPrompt(skill = fallbackSkillId, options = {}) {
  const safeSkill = await normalizeSkillId(skill, options);
  const skillPath = path.join(process.cwd(), "skills", safeSkill, "SKILL.md");

  try {
    return await readFile(skillPath, "utf8");
  } catch {
    return fallbackPrompt;
  }
}

async function loadAllowedSkills({ includeDisabled = false } = {}) {
  const cacheKey = includeDisabled ? "all" : "enabled";
  if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);
  try {
    const catalog = await loadSkillCatalog({ includeDisabled });
    const allowed = new Set(
      catalog
        .map(item => item?.id)
        .filter(id => typeof id === "string" && /^[a-zA-Z0-9._-]+$/.test(id))
    );
    catalogCache.set(cacheKey, allowed);
    return allowed;
  } catch {
    const fallback = new Set([fallbackSkillId]);
    catalogCache.set(cacheKey, fallback);
    return fallback;
  }
}
