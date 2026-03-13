import type { VercelRequest, VercelResponse } from "@vercel/node";

import { createBffFromEnv, sendJson } from "../../../apps/web/src/server/vercel-bff";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    sendJson(response, 405, {
      error: "method_not_allowed"
    });
    return;
  }

  try {
    const result = await createBffFromEnv(request).authWithCli();
    sendJson(response, 200, result, "setCookieHeader" in result ? result.setCookieHeader : undefined);
  } catch (errorValue) {
    sendJson(response, 400, {
      error: errorValue instanceof Error ? errorValue.message : "github_bff_request_failed"
    });
  }
}
