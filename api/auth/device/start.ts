import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const { createBffFromEnv, sendJson } = await import("../../../apps/web/src/server/vercel-bff.js");
  if (request.method !== "POST") {
    sendJson(response, 405, {
      error: "method_not_allowed"
    });
    return;
  }

  try {
    const result = await createBffFromEnv(request).startDeviceAuth();
    sendJson(response, 200, result);
  } catch (errorValue) {
    sendJson(response, 400, {
      error: errorValue instanceof Error ? errorValue.message : "github_bff_request_failed"
    });
  }
}
