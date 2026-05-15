export const PLAN_QUOTA = {
  plus: 500,
  pro: 2000
};

export const CODE_GROUPS = {
  plus_monthly: { label: "Plus 月度", plan: "plus", billingCycle: "monthly", periodMonths: 1, quotaDelta: 500 },
  plus_yearly: { label: "Plus 年度", plan: "plus", billingCycle: "yearly", periodMonths: 12, quotaDelta: 6000 },
  pro_monthly: { label: "Pro 月度", plan: "pro", billingCycle: "monthly", periodMonths: 1, quotaDelta: 2000 },
  pro_yearly: { label: "Pro 年度", plan: "pro", billingCycle: "yearly", periodMonths: 12, quotaDelta: 24000 },
  plus_to_pro_monthly: { label: "Plus 升 Pro 月度差价", plan: "pro", billingCycle: "monthly", periodMonths: 0, quotaDelta: 1500, upgradeOnly: true },
  plus_to_pro_yearly: { label: "Plus 升 Pro 年度差价", plan: "pro", billingCycle: "yearly", periodMonths: 0, quotaDelta: 18000, upgradeOnly: true }
};

export function normalizeCode(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeGroup(groupKey) {
  const key = String(groupKey || "").trim().toLowerCase();
  return CODE_GROUPS[key] ? key : "";
}

export function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + Number(months || 1));
  return next;
}

export function calculateNextEndsAt({ currentEndsAt, periodMonths }) {
  const now = new Date();
  const current = currentEndsAt ? new Date(currentEndsAt) : null;
  const base = current && current.getTime() > now.getTime() ? current : now;
  if (Number(periodMonths) === 0) return base;
  return addMonths(base, periodMonths || 1);
}
