import type { VercelRequest, VercelResponse } from "@vercel/node";

import { createBffFromEnv, sendJson } from "../apps/web/src/server/vercel-bff";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const result = await createBffFromEnv(request).bootstrap({
      cookieHeader: request.headers.cookie
    });
    sendJson(response, 200, result, "setCookieHeader" in result ? result.setCookieHeader : undefined);
  } catch (errorValue) {
    sendJson(response, 500, {
      error: errorValue instanceof Error ? errorValue.message : "github_bff_request_failed"
    });
  }
}
