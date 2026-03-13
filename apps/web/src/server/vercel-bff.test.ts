// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createGitHubBffMock, execFileMock } = vi.hoisted(() => ({
  createGitHubBffMock: vi.fn(() => ({ kind: "bff" })),
  execFileMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock
}));

vi.mock("node:util", () => ({
  promisify: () => execFileMock
}));

vi.mock("./github-bff", () => ({
  createGitHubBff: createGitHubBffMock
}));

import { createBffFromEnv, parseJsonBody, sendJson } from "./vercel-bff";

type CapturedBffOptions = {
  allowDevCliAuth: boolean;
  clientId: string;
  cookieSecret: string;
  execCommand(command: string, args: string[]): Promise<{
    ok: boolean;
    stderr?: string;
    stdout: string;
  }>;
  scope: string;
  secureCookies: boolean;
};

describe("vercel-bff", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ENABLE_GH_CLI_AUTH;
    delete process.env.GITHUB_DEVICE_CLIENT_ID;
    delete process.env.GITHUB_DEVICE_SCOPE;
    delete process.env.GITHUB_SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    delete process.env.VERCEL_ENV;
    createGitHubBffMock.mockClear();
    execFileMock.mockReset();
  });

  it("creates a dev bff, parses bodies, and sends json", async () => {
    const request = {
      body: "{\"hello\":\"world\"}",
      headers: {}
    };

    const bff = createBffFromEnv(request as never);
    expect(bff).toEqual({ kind: "bff" });

    const options = (createGitHubBffMock.mock.lastCall as unknown[] | undefined)?.[0] as CapturedBffOptions;
    expect(options).toMatchObject({
      allowDevCliAuth: true,
      clientId: "Iv23lij7SqVj1Eb2YRdd",
      cookieSecret: "dev-session-secret-change-me",
      scope: "read:user",
      secureCookies: false
    });

    execFileMock.mockResolvedValueOnce({
      stdout: "gho_ok\n"
    });
    await expect(options.execCommand("gh", ["auth", "token"])).resolves.toEqual({
      ok: true,
      stdout: "gho_ok\n"
    });

    execFileMock.mockRejectedValueOnce({
      stderr: "boom",
      stdout: "partial"
    });
    await expect(options.execCommand("gh", ["auth", "token"])).resolves.toEqual({
      ok: false,
      stderr: "boom",
      stdout: "partial"
    });

    execFileMock.mockRejectedValueOnce({
      stderr: "boom"
    });
    await expect(options.execCommand("gh", ["auth", "token"])).resolves.toEqual({
      ok: false,
      stderr: "boom",
      stdout: ""
    });

    expect(parseJsonBody<{ hello: string }>(request as never)).toEqual({
      hello: "world"
    });
    expect(
      parseJsonBody<{ ok?: boolean }>({
        body: {
          ok: true
        }
      } as never)
    ).toEqual({
      ok: true
    });
    expect(
      parseJsonBody<Record<string, never>>({
        body: null
      } as never)
    ).toEqual({});

    const withCookie = {
      json: vi.fn(),
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis()
    };
    sendJson(withCookie as never, 200, { ok: true }, ["a=1", "b=2"]);
    expect(withCookie.setHeader).toHaveBeenCalledWith("set-cookie", ["a=1", "b=2"]);
    expect(withCookie.status).toHaveBeenCalledWith(200);
    expect(withCookie.json).toHaveBeenCalledWith({
      ok: true
    });

    const withoutCookie = {
      json: vi.fn(),
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis()
    };
    sendJson(withoutCookie as never, 204, {});
    expect(withoutCookie.setHeader).not.toHaveBeenCalled();
    expect(withoutCookie.status).toHaveBeenCalledWith(204);
  });

  it("creates a prod bff and rejects missing prod secrets", () => {
    process.env.VERCEL_ENV = "production";
    process.env.SESSION_SECRET = "prod-secret";
    process.env.GITHUB_DEVICE_CLIENT_ID = "client-1";
    process.env.GITHUB_DEVICE_SCOPE = "read:user repo";
    process.env.ENABLE_GH_CLI_AUTH = "1";

    createBffFromEnv({
      headers: {
        "x-forwarded-proto": "https"
      }
    } as never);

    expect(createGitHubBffMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        allowDevCliAuth: true,
        clientId: "client-1",
        cookieSecret: "prod-secret",
        scope: "read:user repo",
        secureCookies: true
      })
    );

    delete process.env.SESSION_SECRET;
    expect(() =>
      createBffFromEnv({
        headers: {}
      } as never)
    ).toThrow("session_secret_missing");
  });
});
