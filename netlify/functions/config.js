import { getEnv } from "./_shared/env.js";
import { json } from "./_shared/json.js";

export default async () => {
  const supabaseUrl = getEnv("SUPABASE_URL", "https://gqhzwngzfoigzqndlbsq.supabase.co");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");

  return json({
    supabaseUrl,
    supabaseAnonKey,
    hasSupabase: Boolean(supabaseUrl && supabaseAnonKey),
    model: getEnv("SILICONFLOW_MODEL", "Qwen/Qwen2.5-72B-Instruct")
  });
};

export const config = {
  path: "/api/config",
  method: ["GET"]
};
