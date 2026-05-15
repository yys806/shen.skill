import { proxyError, proxyToMirror } from "./_shared/mirror-proxy.js";

export default async (req) => {
  try {
    return await proxyToMirror(req);
  } catch (error) {
    return proxyError(error);
  }
};

export const config = {
  path: [
    "/api/auth/login",
    "/api/auth/signup",
    "/api/auth/session",
    "/api/auth/profile",
    "/api/auth/password",
    "/api/auth/resolve",
    "/api/auth/check-duplicate",
    "/api/conversations",
    "/api/skill-submissions",
    "/api/notifications"
  ],
  method: ["GET", "POST", "DELETE", "OPTIONS"]
};
