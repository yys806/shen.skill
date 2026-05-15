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
    "/api/billing/status",
    "/api/billing/redeem-code",
    "/api/admin/users",
    "/api/admin/membership-codes"
  ],
  method: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
};
