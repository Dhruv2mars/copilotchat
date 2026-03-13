import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { VercelRequest, VercelResponse } from "@vercel/node";

import { createGitHubBff } from "./github-bff";

const defaultGitHubDeviceClientId = "Iv23lij7SqVj1Eb2YRdd";
const execFileAsync = promisify(execFile);

export function createBffFromEnv(request: VercelRequest) {
  const secureCookies =
    request.headers["x-forwarded-proto"] === "https" || process.env.VERCEL_ENV === "production";

  return createGitHubBff({
    allowDevCliAuth: process.env.ENABLE_GH_CLI_AUTH === "1" || process.env.VERCEL_ENV !== "production",
    clientId: process.env.GITHUB_DEVICE_CLIENT_ID ?? defaultGitHubDeviceClientId,
    cookieSecret: readSessionSecret(),
    execCommand: async (command, args) => {
      try {
        const result = await execFileAsync(command, args, {
          encoding: "utf8"
        });
        return {
          ok: true,
          stdout: result.stdout
        };
      } catch (errorValue) {
        const error = errorValue as { stderr?: string; stdout?: string };
        return {
          ok: false,
          stderr: error.stderr,
          stdout: error.stdout ?? ""
        };
      }
    },
    scope: process.env.GITHUB_DEVICE_SCOPE ?? "read:user",
    secureCookies
  });
}

export function parseJsonBody<T>(request: VercelRequest) {
  if (typeof request.body === "string") {
    return JSON.parse(request.body) as T;
  }

  return (request.body ?? {}) as T;
}

export function sendJson(
  response: VercelResponse,
  statusCode: number,
  body: unknown,
  setCookieHeader?: string | string[]
) {
  if (setCookieHeader) {
    response.setHeader("set-cookie", setCookieHeader);
  }

  response.status(statusCode).json(body);
}

function readSessionSecret() {
  const secret = process.env.SESSION_SECRET ?? process.env.GITHUB_SESSION_SECRET ?? "";
  if (secret) {
    return secret;
  }

  if (process.env.VERCEL_ENV === "production") {
    throw new Error("session_secret_missing");
  }

  return "dev-session-secret-change-me";
}
