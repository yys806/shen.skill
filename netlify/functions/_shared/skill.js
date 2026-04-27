import { readFile } from "node:fs/promises";
import path from "node:path";

const fallbackPrompt = [
  "# maoxuan-skill fallback",
  "你是一个基于毛选方法论的分析型 skill。优先识别主要矛盾、力量关系、阶段任务和可执行路线。",
  "不要复读语录；用清楚、短句、可执行的方式分析用户的问题。"
].join("\n");

const allowedSkills = new Set([
  "maoxuan-skill",
  "bazi-skill",
  "steve-jobs-skill",
  "elon-musk-skill",
  "munger-skill",
  "fengge-wangmingtianya-perspective"
]);

export function normalizeSkillId(skill = "maoxuan-skill") {
  const safeSkill = /^[a-zA-Z0-9._-]+$/.test(skill) ? skill : "maoxuan-skill";
  return allowedSkills.has(safeSkill) ? safeSkill : "maoxuan-skill";
}

export async function loadSkillPrompt(skill = "maoxuan-skill") {
  const safeSkill = normalizeSkillId(skill);
  const skillPath = path.join(process.cwd(), "skills", safeSkill, "SKILL.md");

  try {
    return await readFile(skillPath, "utf8");
  } catch {
    return fallbackPrompt;
  }
}
