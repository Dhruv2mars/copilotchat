// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createGitHubBff,
  readCookie,
  sealSessionCookie,
  splitSetCookieHeader
} from "./github-bff";

describe("github-bff", () => {
  it("supports pat auth, device auth, bootstrap, chat, cli auth, and logout", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: "device-1",
            expires_in: 900,
            interval: 5,
            user_code: "ABCD-EFGH",
            verification_uri: "https://github.com/login/device"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "gho_token_12345678"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "openai/gpt-5-mini",
              name: "OpenAI GPT-5 mini",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["text"]
            }
          ])
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            login: "Dhruv2mars"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "openai/gpt-5-mini",
              name: "OpenAI GPT-5 mini",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["text"]
            }
          ])
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "hello test",
                  role: "assistant"
                }
              }
            ],
            usage: {
              completion_tokens: 3,
              prompt_tokens: 13
            }
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "openai/gpt-5-mini",
              name: "OpenAI GPT-5 mini",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["text"]
            }
          ])
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            login: "Dhruv2mars"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "openai/gpt-5-mini",
              name: "OpenAI GPT-5 mini",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["text"]
            }
          ])
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            login: "Dhruv2mars"
          })
        )
      );

    const bff = createGitHubBff({
      allowDevCliAuth: true,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn().mockResolvedValue({
        ok: true,
        stdout: "gho_cli_12345678\n"
      }),
      fetchFn,
      now: () => new Date("2026-03-13T12:00:00.000Z")
    });

    const challenge = await bff.startDeviceAuth();
    expect(challenge).toMatchObject({
      deviceCode: "device-1",
      userCode: "ABCD-EFGH"
    });

    const completed = await bff.pollDeviceAuth({
      deviceCode: "device-1"
    });
    expect(completed).toMatchObject({
      auth: {
        accountLabel: "Dhruv2mars",
        authenticated: true
      },
      status: "complete"
    });

    const authCookie = splitSetCookieHeader(completed.setCookieHeader ?? "")[0] ?? "";
    const bootstrap = await bff.bootstrap({
      cookieHeader: authCookie
    });
    expect(bootstrap).toMatchObject({
      auth: {
        authenticated: true
      },
      models: [
        {
          id: "openai/gpt-5-mini",
          label: "OpenAI GPT-5 mini"
        }
      ]
    });

    await expect(
      bff.completeChat({
        cookieHeader: authCookie,
        request: {
          messages: [
            {
              content: "Say hello",
              id: "user-1",
              role: "user"
            }
          ],
          modelId: "openai/gpt-5-mini",
          requestId: "req-1"
        }
      })
    ).resolves.toMatchObject({
      message: {
        content: "hello test",
        role: "assistant"
      },
      usage: {
        inputTokens: 13,
        outputTokens: 3
      }
    });

    await expect(bff.authWithCli()).resolves.toMatchObject({
      auth: {
        authenticated: true
      }
    });

    await expect(bff.authWithPat({ token: "ghp_pat_12345678" })).resolves.toMatchObject({
      auth: {
        authenticated: true
      },
      models: [
        {
          id: "openai/gpt-5-mini",
          label: "OpenAI GPT-5 mini"
        }
      ]
    });

    await expect(bff.logout()).resolves.toMatchObject({
      auth: {
        authenticated: false
      }
    });
  });

  it("covers cookie helpers and failure paths", async () => {
    const sealed = sealSessionCookie({
      accountLabel: "Dhruv2mars",
      cookieSecret: "secret-secret-secret-secret",
      token: "gho_token_12345678"
    });
    expect(readCookie("a=1; session=abc; b=2", "session")).toBe("abc");
    expect(readCookie("a=1", "session")).toBeNull();
    expect(sealed).toContain("HttpOnly");

    const failing = createGitHubBff({
      allowDevCliAuth: false,
      clientId: "",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn(),
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                message: "chat_forbidden"
              }
            }),
            {
              status: 403
            }
          )
        ),
      now: () => new Date("2026-03-13T12:00:00.000Z")
    });

    await expect(failing.startDeviceAuth()).rejects.toThrow("github_auth_not_configured");
    await expect(
      failing.bootstrap({
        cookieHeader: "copilotchat_session=broken"
      })
    ).resolves.toMatchObject({
      auth: {
        authenticated: false
      }
    });
    await expect(
      failing.bootstrap({
        cookieHeader: sealSessionCookie({
          accountLabel: "Dhruv2mars",
          cookieSecret: "secret-secret-secret-secret",
          token: "gho_token_12345678"
        })
      })
    ).resolves.toMatchObject({
      auth: {
        authenticated: false
      }
    });
    await expect(
      failing.completeChat({
        cookieHeader: sealSessionCookie({
          accountLabel: "Dhruv2mars",
          cookieSecret: "secret-secret-secret-secret",
          token: "gho_token_12345678"
        }),
        request: {
          messages: [],
          modelId: "openai/gpt-5-mini",
          requestId: "req-1"
        }
      })
    ).rejects.toThrow("chat_forbidden");
    await expect(failing.authWithPat({ token: "   " })).rejects.toThrow("pat_required");
    await expect(failing.authWithCli()).rejects.toThrow("dev_cli_auth_disabled");

    expect(splitSetCookieHeader("a=1; Path=/, b=2; Path=/")).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });
});
