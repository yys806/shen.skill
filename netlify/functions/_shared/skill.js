import { readFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "./env.js";

const fallbackPrompt = [
  "# shen.skill fallback",
  "你是禹尧珅的综合人格镜像。默认先判断对方是谁，再选择语气。",
  "和用户本人对话时偏理性复盘；工作场景严谨；亲密关系可温柔；朋友场景可松弛。"
].join("\n");

export async function loadSkillPrompt(skill = "shen.skill") {
  const safeSkill = /^[a-zA-Z0-9._-]+$/.test(skill) ? skill : "shen.skill";
  const configuredPath = safeSkill === "shen.skill"
    ? getEnv("SHEN_SKILL_PATH", "skills/shen.skill/SKILL.md")
    : `skills/${safeSkill}/SKILL.md`;
  const skillPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(process.cwd(), configuredPath);

  try {
    return await readFile(skillPath, "utf8");
  } catch {
    return fallbackPrompt;
  }
}
