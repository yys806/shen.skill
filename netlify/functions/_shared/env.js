export function getEnv(name, fallback = "") {
  if (globalThis.Netlify?.env?.get) {
    return globalThis.Netlify.env.get(name) || fallback;
  }
  return process.env[name] || fallback;
}
