// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createGitHubBff, sealSessionCookie } from "./github-bff";

describe("github-bff extra", () => {
  it("covers pending auth, cli failures, invalid auth starts, and chat edge cases", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "authorization_pending",
            interval: 7
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "slow_down",
            interval: 11
          })
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user_code: "ABCD-EFGH",
            verification_uri: "https://github.com/login/device"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: "device-1",
            user_code: "ABCD-EFGH",
            verification_uri: "https://github.com/login/device"
          }),
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: []
                }
              }
            ]
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {}
              }
            ]
          })
        )
      )
      .mockResolvedValueOnce(new Response("nope", { status: 500 }));

    const bff = createGitHubBff({
      allowDevCliAuth: true,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn().mockResolvedValue({
        ok: false,
        stdout: ""
      }),
      fetchFn
    });

    await expect(bff.pollDeviceAuth({ deviceCode: "device-1" })).resolves.toEqual({
      pollAfterSeconds: 7,
      status: "pending"
    });
    await expect(bff.pollDeviceAuth({ deviceCode: "device-1" })).resolves.toEqual({
      pollAfterSeconds: 11,
      status: "pending"
    });
    await expect(bff.pollDeviceAuth({ deviceCode: "device-1" })).rejects.toThrow("github_auth_failed");
    await expect(bff.startDeviceAuth()).rejects.toThrow("github_device_code_failed");
    await expect(bff.startDeviceAuth()).rejects.toThrow("github_device_code_failed");
    await expect(
      bff.completeChat({
        request: {
          messages: [],
          modelId: "openai/gpt-4.1-mini",
          requestId: "req-1"
        }
      })
    ).rejects.toThrow("auth_required");

    const cookie = sealSessionCookie({
      accountLabel: "Dhruv2mars",
      cookieSecret: "secret-secret-secret-secret",
      token: "gho_token_12345678"
    });
    await expect(
      bff.completeChat({
        cookieHeader: cookie,
        request: {
          messages: [],
          modelId: "openai/gpt-4.1-mini",
          requestId: "req-1"
        }
      })
    ).rejects.toThrow("chat_empty");
    await expect(
      bff.completeChat({
        cookieHeader: cookie,
        request: {
          messages: [],
          modelId: "openai/gpt-4.1-mini",
          requestId: "req-1"
        }
      })
    ).rejects.toThrow("chat_empty");
    await expect(
      bff.completeChat({
        cookieHeader: cookie,
        request: {
          messages: [],
          modelId: "openai/gpt-4.1-mini",
          requestId: "req-1"
        }
      })
    ).rejects.toThrow("github_models_request_failed");
    await expect(bff.authWithCli()).rejects.toThrow("dev_cli_auth_failed");
  });

  it("covers secure cookies, catalog variants, array content, and user failures", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                capabilities: ["chat"],
                id: "model-cap",
                name: "Cap model"
              },
              {
                id: "model-task",
                task: "chat-completion"
              },
              {
                id: "model-text",
                name: "Text model",
                supported_input_modalities: ["text"],
                supported_output_modalities: ["text"]
              },
              {
                id: "model-ignore",
                supported_input_modalities: ["image"],
                supported_output_modalities: ["text"]
              }
            ]
          })
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
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [{ text: "hello " }, { text: "world" }]
                }
              }
            ],
            usage: {
              input_tokens: 2,
              output_tokens: 1
            }
          })
        )
      );

    const bff = createGitHubBff({
      allowDevCliAuth: true,
      clientId: " client-1 ",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn().mockResolvedValue({
        ok: true,
        stdout: "gho_cli_12345678\n"
      }),
      fetchFn,
      scope: "  ",
      secureCookies: true
    });

    const bootstrap = await bff.authWithCli();
    expect(bootstrap).toMatchObject({
      auth: {
        accountLabel: "Dhruv2mars",
        authenticated: true
      },
      models: []
    });
    expect(bootstrap.setCookieHeader).toContain("Secure");

    await expect(
      bff.completeChat({
        cookieHeader: bootstrap.setCookieHeader,
        request: {
          messages: [
            {
              content: "hello",
              id: "user-1",
              role: "user"
            }
          ],
          modelId: "model-cap",
          requestId: "req-1"
        }
      })
    ).resolves.toMatchObject({
      message: {
        content: "hello world",
        role: "assistant"
      },
      usage: {
        inputTokens: 2,
        outputTokens: 1
      }
    });

    const failingUserBff = createGitHubBff({
      allowDevCliAuth: true,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn().mockResolvedValue({
        ok: true,
        stdout: "gho_cli_12345678\n"
      }),
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                id: "model-cap",
                supported_input_modalities: ["text"],
                supported_output_modalities: ["text"]
              }
            ])
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              message: "viewer_forbidden"
            }),
            { status: 403 }
          )
        )
    });

    await expect(failingUserBff.authWithCli()).resolves.toMatchObject({
      auth: {
        accountLabel: "GitHub Models",
        authenticated: true
      },
      models: []
    });
  });

  it("covers scope propagation, access denial, empty catalogs, and default fetch wiring", async () => {
    const scopedFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          device_code: "device-9",
          expires_in: 900,
          interval: 5,
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device"
        })
      )
    );

    const scopedBff = createGitHubBff({
      allowDevCliAuth: true,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn(),
      fetchFn: scopedFetch,
      scope: "read:user repo"
    });

    await expect(scopedBff.startDeviceAuth()).resolves.toMatchObject({
      deviceCode: "device-9"
    });
    expect((scopedFetch.mock.calls[0]?.[1]?.body as URLSearchParams).get("scope")).toBe("read:user repo");

    const deniedBff = createGitHubBff({
      allowDevCliAuth: true,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn(),
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: "access_denied"
            })
          )
        )
    });

    await expect(deniedBff.pollDeviceAuth({ deviceCode: "device-9" })).rejects.toThrow("access_denied");

    const emptyCatalogBff = createGitHubBff({
      allowDevCliAuth: true,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn().mockResolvedValue({
        ok: true,
        stdout: "gho_cli_12345678\n"
      }),
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({})))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              login: "Dhruv2mars"
            })
          )
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({})))
    });

    await expect(emptyCatalogBff.authWithCli()).resolves.toMatchObject({
      models: []
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const defaultFetchBff = createGitHubBff({
      allowDevCliAuth: false,
      clientId: "",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn()
    });

    await expect(defaultFetchBff.bootstrap()).resolves.toMatchObject({
      auth: {
        authenticated: false
      }
    });

    globalThis.fetch = originalFetch;
  });

  it("covers non-chat catalog records, short token hints, and array parts without text", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              capabilities: ["vision"],
              id: "model-cap"
            },
            {
              id: "model-input",
              supported_input_modalities: "text",
              supported_output_modalities: ["text"]
            },
            {
              id: "model-output",
              supported_input_modalities: ["text"],
              supported_output_modalities: "text"
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
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [{ text: "hello" }, { type: "output_text" }]
                }
              }
            ],
            usage: {
              completion_tokens: 1,
              prompt_tokens: 2
            }
          })
        )
      );

    const bff = createGitHubBff({
      allowDevCliAuth: true,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn().mockResolvedValue({
        ok: true,
        stdout: "short\n"
      }),
      fetchFn
    });

    const bootstrap = await bff.authWithCli();
    expect(bootstrap).toMatchObject({
      auth: {
        tokenHint: "short"
      },
      models: []
    });

    await expect(
      bff.completeChat({
        cookieHeader: bootstrap.setCookieHeader,
        request: {
          messages: [],
          modelId: "openai/gpt-5-mini",
          requestId: "req-1"
        }
      })
    ).resolves.toMatchObject({
      message: {
        content: "hello"
      }
    });
  });

  it("covers device-flow default intervals and missing-token fallback errors", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "authorization_pending"
          })
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({})))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: "device-10",
            user_code: "QRST-9876",
            verification_uri: "https://github.com/login/device"
          })
        )
      );

    const bff = createGitHubBff({
      allowDevCliAuth: true,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn(),
      fetchFn,
      now: () => new Date("2026-03-13T12:00:00.000Z")
    });

    await expect(bff.pollDeviceAuth({ deviceCode: "device-10" })).resolves.toEqual({
      pollAfterSeconds: 5,
      status: "pending"
    });
    await expect(bff.pollDeviceAuth({ deviceCode: "device-10" })).rejects.toThrow("github_auth_failed");
    await expect(bff.startDeviceAuth()).resolves.toMatchObject({
      deviceCode: "device-10",
      expiresAt: "2026-03-13T12:15:00.000Z",
      intervalSeconds: 5,
      userCode: "QRST-9876"
    });
  });

  it("defaults token usage counts to zero when upstream omits them", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "hello"
              }
            }
          ]
        })
      )
    );

    const bff = createGitHubBff({
      allowDevCliAuth: true,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn(),
      fetchFn
    });

    await expect(
      bff.completeChat({
        cookieHeader: sealSessionCookie({
          accountLabel: "Dhruv2mars",
          cookieSecret: "secret-secret-secret-secret",
          token: "gho_token_12345678"
        }),
        request: {
          messages: [],
          modelId: "openai/gpt-4.1-mini",
          requestId: "req-1"
        }
      })
    ).resolves.toMatchObject({
      usage: {
        inputTokens: 0,
        outputTokens: 0
      }
    });
  });

  it("maps missing models scopes to pat-required and rethrows unknown fetch failures", async () => {
    const scopedBff = createGitHubBff({
      allowDevCliAuth: true,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn(),
      fetchFn: vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "insufficient_scope"
            }
          }),
          {
            status: 403
          }
        )
      )
    });

    await expect(scopedBff.authWithPat({ token: "ghp_pat_12345678" })).rejects.toThrow("github_models_pat_required");

    const explodingBff = createGitHubBff({
      allowDevCliAuth: true,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn(),
      fetchFn: vi.fn().mockRejectedValue("boom")
    });

    await expect(explodingBff.authWithPat({ token: "ghp_pat_12345678" })).rejects.toEqual("boom");

    const anonymousViewerBff = createGitHubBff({
      allowDevCliAuth: true,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn(),
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                id: "openai/gpt-5-mini",
                supported_input_modalities: ["text"],
                supported_output_modalities: ["text"]
              }
            ])
          )
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({})))
    });

    await expect(anonymousViewerBff.authWithPat({ token: "ghp_pat_12345678" })).resolves.toMatchObject({
      auth: {
        accountLabel: "GitHub Models"
      }
    });
  });
});
