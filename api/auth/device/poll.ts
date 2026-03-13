import type { VercelRequest, VercelResponse } from "@vercel/node";

import type { AuthDevicePollRequest } from "../../../packages/shared/src/protocol.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const { createBffFromEnv, parseJsonBody, sendJson } = await import("../../../apps/web/src/server/vercel-bff.js");
  if (request.method !== "POST") {
    sendJson(response, 405, {
      error: "method_not_allowed"
    });
    return;
  }

  try {
    const input = parseJsonBody<AuthDevicePollRequest>(request);
    const result = await createBffFromEnv(request).pollDeviceAuth({
      deviceCode: input.deviceCode
    });
    sendJson(response, 200, result, "setCookieHeader" in result ? result.setCookieHeader : undefined);
  } catch (errorValue) {
    sendJson(response, 400, {
      error: errorValue instanceof Error ? errorValue.message : "github_bff_request_failed"
    });
  }
}
