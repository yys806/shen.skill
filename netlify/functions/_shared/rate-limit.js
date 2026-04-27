import { getEnv } from "./env.js";

export async function checkRateLimit(req, userId, eventType, limit, windowMs) {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co").replace(/\/$/, "");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("authorization") || "";
  const since = new Date(Date.now() - windowMs).toISOString();
  const query = new URLSearchParams({
    select: "id",
    user_id: `eq.${userId}`,
    event_type: `eq.${eventType}`,
    created_at: `gte.${since}`
  });

  try {
    const countResponse = await fetch(`${supabaseUrl}/rest/v1/request_events?${query}`, {
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": authorization,
        "Accept": "application/json"
      }
    });
    const events = await countResponse.json().catch(() => []);
    if (countResponse.ok && Array.isArray(events) && events.length >= limit) {
      return {
        ok: false,
        detail: `请求太频繁了。当前操作限制为 ${formatWindow(windowMs)}最多 ${limit} 次，请稍后再试。`
      };
    }

    await fetch(`${supabaseUrl}/rest/v1/request_events`, {
      method: "POST",
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ user_id: userId, event_type: eventType })
    });

    return { ok: true };
  } catch {
    // 限流失败时不阻断正常使用，避免数据库短暂抖动导致产品不可用。
    return { ok: true };
  }
}

function formatWindow(windowMs) {
  if (windowMs >= 86_400_000) return "每天";
  if (windowMs >= 60_000) return "每分钟";
  return "短时间内";
}
