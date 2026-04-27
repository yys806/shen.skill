const skillDetails = {
  "maoxuan-skill": {
    name: "毛选",
    label: "contradiction / practice / strategy",
    source: "https://github.com/leezythu/maoxuan-skill.git",
    summary: "把《矛盾论》《实践论》《论持久战》等方法论蒸馏成可对话的分析框架。它不复读语录，而是帮你判断主要矛盾、力量关系、阶段任务和可执行策略。",
    bestFor: ["复杂局势拆解", "战略判断", "资源与敌友分析", "长期行动路线"],
    notes: ["先问主要矛盾是什么", "重视实践反馈", "把宏观判断落到行动次序"]
  },
  "bazi-skill": {
    name: "八字",
    label: "four pillars / wuxing / structured reading",
    source: "https://github.com/jinchenma94/bazi-skill.git",
    summary: "通过出生信息排出四柱八字，结合五行、十神、格局、大运流年做结构化推演。更适合当作一种传统模型视角，而不是确定性结论。",
    bestFor: ["四柱排盘", "五行结构观察", "大运流年解读", "性格与选择的象征分析"],
    notes: ["先补齐出生信息", "区分模型解释和现实决策", "适合做自我观察的另一种语言"]
  },
  "steve-jobs-skill": {
    name: "乔布斯",
    label: "taste / product / ruthless focus",
    source: "https://github.com/alchaincyf/steve-jobs-skill.git",
    summary: "Steve Jobs 的产品审美与决策框架：技术与人文交汇、极致取舍、端到端体验和强表达。适合逼你删掉平庸，把东西做得更锋利。",
    bestFor: ["产品方向", "审美判断", "演示表达", "从复杂里砍出简单"],
    notes: ["先问它是否足够好", "删除比添加更重要", "把体验当成完整系统"]
  },
  "elon-musk-skill": {
    name: "马斯克",
    label: "first principles / engineering pressure",
    source: "https://github.com/alchaincyf/elon-musk-skill.git",
    summary: "Elon Musk 的第一性原理、工程压强和目标拆解方式。适合把问题还原到物理约束、成本结构、迭代速度和高压执行。",
    bestFor: ["第一性原理拆解", "工程路线选择", "成本与约束分析", "把大目标拆成硬指标"],
    notes: ["先区分物理约束和人为惯例", "用快速迭代压缩学习周期", "目标要能被数字检验"]
  },
  "munger-skill": {
    name: "芒格",
    label: "mental models / inversion / rationality",
    source: "https://github.com/alchaincyf/munger-skill.git",
    summary: "Charlie Munger 的多元思维模型与反向思考。它不追求显得聪明，而是系统避开愚蠢：偏见、激励、机会成本和能力圈。",
    bestFor: ["投资与商业判断", "反向思考", "认知偏差检查", "跨学科模型组合"],
    notes: ["先问如何避免大错", "检查激励如何扭曲判断", "承认不知道是优势"]
  },
  "fengge-wangmingtianya-perspective": {
    name: "峰哥亡命天涯",
    label: "street realism / black humor / boundary",
    source: "https://github.com/rottenpen/fengge-wangmingtianya-perspective.git",
    summary: "一个带漂泊江湖感、现实主义去魅和黑色幽默的中文表达视角。适合把情绪翻译成边界、资源和下一步止损动作。",
    bestFor: ["关系去魅", "职场止损", "边界问题", "低谷里的现实建议"],
    notes: ["先下结论，再说大白话", "把坏事翻成止损信号", "最后给一个能立刻做的动作"]
  }
};

const pathParts = window.location.pathname.split("/").filter(Boolean);
const skillId = pathParts[pathParts.length - 1] || "maoxuan-skill";
const detail = skillDetails[skillId] || skillDetails["maoxuan-skill"];

document.title = `${detail.name} Skill | 镜室`;
document.querySelector("[data-skill-name]").textContent = detail.name;
document.querySelector("[data-skill-label]").textContent = detail.label;
document.querySelector("[data-skill-summary]").textContent = detail.summary;
document.querySelector("[data-skill-source]").href = detail.source;
document.querySelector("[data-skill-source]").textContent = detail.source.replace("https://github.com/", "");
document.querySelector("[data-chat-link]").href = `/chat?skill=${encodeURIComponent(skillId)}`;

renderList("[data-best-for]", detail.bestFor);
renderList("[data-notes]", detail.notes);

function renderList(selector, items) {
  const target = document.querySelector(selector);
  target.innerHTML = items.map(item => `<li>${escapeHtml(item)}</li>`).join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
