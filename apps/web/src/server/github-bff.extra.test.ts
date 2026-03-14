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
    const fetchFn = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/catalog/models")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                capabilities: ["chat"],
                id: "openai/gpt-5-mini",
                name: "OpenAI GPT-5 mini"
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
        );
      }

      if (url.endsWith("/user")) {
        return new Response(
          JSON.stringify({
            login: "Dhruv2mars"
          })
        );
      }

      if (url.endsWith("/inference/chat/completions")) {
        const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> };
        if (body.messages?.[0]?.content === "Reply with ok.") {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "ok"
                  }
                }
              ]
            })
          );
        }

        return new Response(
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
        );
      }

      return new Response("not found", { status: 404 });
    });

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
      models: [
        {
          id: "openai/gpt-5-mini",
          label: "OpenAI GPT-5 mini"
        }
      ]
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
          modelId: "openai/gpt-5-mini",
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
      fetchFn: vi.fn(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/catalog/models")) {
          return new Response(
            JSON.stringify([
              {
                id: "openai/gpt-5-mini",
                supported_input_modalities: ["text"],
                supported_output_modalities: ["text"]
              }
            ])
          );
        }

        if (url.endsWith("/inference/chat/completions")) {
          const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> };
          if (body.messages?.[0]?.content === "Reply with ok.") {
            return new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: "ok"
                    }
                  }
                ]
              })
            );
          }
        }

        if (url.endsWith("/user")) {
          return new Response(
            JSON.stringify({
              message: "viewer_forbidden"
            }),
            { status: 403 }
          );
        }

        return new Response("not found", { status: 404 });
      })
    });

    await expect(failingUserBff.authWithCli()).resolves.toMatchObject({
      auth: {
        accountLabel: "GitHub Models",
        authenticated: true
      },
      models: [
        {
          id: "openai/gpt-5-mini",
          label: "OpenAI GPT-5 mini"
        }
      ]
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

    await expect(emptyCatalogBff.authWithCli()).rejects.toThrow("no_inference_access");

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
    const fetchFn = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/catalog/models")) {
        return new Response(
          JSON.stringify([
            {
              capabilities: ["chat"],
              id: "openai/gpt-5-mini"
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
        );
      }

      if (url.endsWith("/user")) {
        return new Response(
          JSON.stringify({
            login: "Dhruv2mars"
          })
        );
      }

      if (url.endsWith("/inference/chat/completions")) {
        const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> };
        if (body.messages?.[0]?.content === "Reply with ok.") {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "ok"
                  }
                }
              ]
            })
          );
        }

        return new Response(
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
        );
      }

      return new Response("not found", { status: 404 });
    });

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
      models: [
        {
          id: "openai/gpt-5-mini",
          label: "OpenAI GPT-5 mini"
        }
      ]
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
      fetchFn: vi.fn(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/catalog/models")) {
          return new Response(
            JSON.stringify([
              {
                id: "openai/gpt-5-mini",
                supported_input_modalities: ["text"],
                supported_output_modalities: ["text"]
              }
            ])
          );
        }

        if (url.endsWith("/inference/chat/completions")) {
          const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> };
          if (body.messages?.[0]?.content === "Reply with ok.") {
            return new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: "ok"
                    }
                  }
                ]
              })
            );
          }
        }

        if (url.endsWith("/user")) {
          return new Response(JSON.stringify({}));
        }

        return new Response("not found", { status: 404 });
      })
    });

    await expect(anonymousViewerBff.authWithPat({ token: "ghp_pat_12345678" })).resolves.toMatchObject({
      auth: {
        accountLabel: "GitHub Models"
      }
    });
  });

  it("falls back to the next candidate model after no_access", async () => {
    const bff = createGitHubBff({
      allowDevCliAuth: true,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn(),
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: "no_access"
              }
            }),
            {
              status: 403
            }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "fallback ok"
                  }
                }
              ],
              usage: {
                completion_tokens: 2,
                prompt_tokens: 3
              }
            })
          )
        )
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
          modelId: "openai/gpt-4.1",
          requestId: "req-1"
        }
      })
    ).resolves.toMatchObject({
      message: {
        content: "fallback ok"
      },
      usedModel: {
        id: "openai/gpt-5-mini",
        label: "OpenAI GPT-5 mini"
      }
    });
  });

  it("throws no_access after every candidate fails", async () => {
    const fetchFn = vi.fn();
    for (let index = 0; index < 6; index += 1) {
      fetchFn.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "no_access"
            }
          }),
          {
            status: 403
          }
        )
      );
    }

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
          modelId: "openai/gpt-4.1",
          requestId: "req-1"
        }
      })
    ).rejects.toThrow("no_access");
  });

  it("keeps only models that pass a real inference probe", async () => {
    const fetchFn = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/catalog/models")) {
        return new Response(
          JSON.stringify([
            {
              id: "openai/gpt-5-mini",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["text"]
            },
            {
              id: "openai/gpt-4.1",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["text"]
            },
            {
              id: "openai/gpt-4o",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["text"]
            }
          ])
        );
      }

      if (url.endsWith("/user")) {
        return new Response(
          JSON.stringify({
            login: "Dhruv2mars"
          })
        );
      }

      if (url.endsWith("/inference/chat/completions")) {
        const body = JSON.parse(String(init?.body)) as { model?: string };
        if (body.model === "openai/gpt-4.1") {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "ok"
                  }
                }
              ]
            })
          );
        }

        return new Response(
          JSON.stringify({
            error: {
              code: "no_access"
            }
          }),
          {
            status: 403
          }
        );
      }

      return new Response("not found", {
        status: 404
      });
    });

    const bff = createGitHubBff({
      allowDevCliAuth: false,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn(),
      fetchFn
    });

    const auth = await bff.authWithPat({
      token: "ghp_pat_12345678"
    });

    expect(auth.models).toEqual([
      {
        id: "openai/gpt-4.1",
        label: "OpenAI GPT-4.1"
      }
    ]);

    const bootstrap = await bff.bootstrap({
      cookieHeader: auth.setCookieHeader
    });

    expect(bootstrap.models).toEqual([
      {
        id: "openai/gpt-4.1",
        label: "OpenAI GPT-4.1"
      }
    ]);
  });

  it("rejects auth when the token cannot infer on any included model", async () => {
    const fetchFn = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/catalog/models")) {
        return new Response(
          JSON.stringify([
            {
              id: "openai/gpt-5-mini",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["text"]
            },
            {
              id: "openai/gpt-4.1",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["text"]
            }
          ])
        );
      }

      if (url.endsWith("/user")) {
        return new Response(
          JSON.stringify({
            login: "Dhruv2mars"
          })
        );
      }

      if (url.endsWith("/inference/chat/completions")) {
        return new Response(
          JSON.stringify({
            error: {
              code: "no_access"
            }
          }),
          {
            status: 403
          }
        );
      }

      return new Response("not found", {
        status: 404
      });
    });

    const bff = createGitHubBff({
      allowDevCliAuth: false,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn(),
      fetchFn
    });

    await expect(
      bff.authWithPat({
        token: "ghp_pat_12345678"
      })
    ).rejects.toThrow("no_inference_access");
  });

  it("rethrows unexpected inference probe errors during auth", async () => {
    const fetchFn = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/catalog/models")) {
        return new Response(
          JSON.stringify([
            {
              id: "openai/gpt-5-mini",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["text"]
            }
          ])
        );
      }

      if (url.endsWith("/inference/chat/completions")) {
        return new Response(
          JSON.stringify({
            error: {
              code: "rate_limited"
            }
          }),
          {
            status: 429
          }
        );
      }

      return new Response("not found", {
        status: 404
      });
    });

    const bff = createGitHubBff({
      allowDevCliAuth: false,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn(),
      fetchFn
    });

    await expect(
      bff.authWithPat({
        token: "ghp_pat_12345678"
      })
    ).rejects.toThrow("rate_limited");
  });

  it("keeps probing other models when one probe returns a transient plain-text failure", async () => {
    const fetchFn = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/catalog/models")) {
        return new Response(
          JSON.stringify([
            {
              id: "openai/gpt-5-mini",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["text"]
            },
            {
              id: "openai/gpt-4.1",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["text"]
            }
          ])
        );
      }

      if (url.endsWith("/user")) {
        return new Response(
          JSON.stringify({
            login: "Dhruv2mars"
          })
        );
      }

      if (url.endsWith("/inference/chat/completions")) {
        const body = JSON.parse(String(init?.body)) as { model?: string };
        if (body.model === "openai/gpt-5-mini") {
          return new Response("Too many requests", {
            status: 429
          });
        }

        if (body.model === "openai/gpt-4.1") {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "ok"
                  }
                }
              ]
            })
          );
        }
      }

      return new Response("not found", {
        status: 404
      });
    });

    const bff = createGitHubBff({
      allowDevCliAuth: false,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn(),
      fetchFn
    });

    await expect(
      bff.authWithPat({
        token: "ghp_pat_12345678"
      })
    ).resolves.toMatchObject({
      auth: {
        accountLabel: "Dhruv2mars",
        authenticated: true
      },
      models: [
        {
          id: "openai/gpt-4.1",
          label: "OpenAI GPT-4.1"
        }
      ]
    });
  });

  it("keeps probing other models when one probe throws a non-error value", async () => {
    const fetchFn = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/catalog/models")) {
        return new Response(
          JSON.stringify([
            {
              id: "openai/gpt-5-mini",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["text"]
            },
            {
              id: "openai/gpt-4.1",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["text"]
            }
          ])
        );
      }

      if (url.endsWith("/user")) {
        return new Response(
          JSON.stringify({
            login: "Dhruv2mars"
          })
        );
      }

      if (url.endsWith("/inference/chat/completions")) {
        const body = JSON.parse(String(init?.body)) as { model?: string };
        if (body.model === "openai/gpt-5-mini") {
          throw "boom";
        }

        if (body.model === "openai/gpt-4.1") {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "ok"
                  }
                }
              ]
            })
          );
        }
      }

      return new Response("not found", {
        status: 404
      });
    });

    const bff = createGitHubBff({
      allowDevCliAuth: false,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn(),
      fetchFn
    });

    await expect(
      bff.authWithPat({
        token: "ghp_pat_12345678"
      })
    ).resolves.toMatchObject({
      models: [
        {
          id: "openai/gpt-4.1",
          label: "OpenAI GPT-4.1"
        }
      ]
    });
  });

  it("refreshes legacy session cookies that do not store validated models", async () => {
    const fetchFn = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/catalog/models")) {
        return new Response(
          JSON.stringify([
            {
              id: "openai/gpt-5-mini",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["text"]
            }
          ])
        );
      }

      if (url.endsWith("/inference/chat/completions")) {
        const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> };
        if (body.messages?.[0]?.content === "Reply with ok.") {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "ok"
                  }
                }
              ]
            })
          );
        }
      }

      if (url.endsWith("/user")) {
        return new Response(
          JSON.stringify({
            login: "Dhruv2mars"
          })
        );
      }

      return new Response("not found", {
        status: 404
      });
    });

    const bff = createGitHubBff({
      allowDevCliAuth: false,
      clientId: "client-1",
      cookieSecret: "secret-secret-secret-secret",
      execCommand: vi.fn(),
      fetchFn
    });

    const bootstrap = await bff.bootstrap({
      cookieHeader: sealSessionCookie({
        accountLabel: "Dhruv2mars",
        cookieSecret: "secret-secret-secret-secret",
        token: "gho_token_12345678"
      })
    });

    expect(bootstrap).toMatchObject({
      auth: {
        accountLabel: "Dhruv2mars",
        authenticated: true
      },
      models: [
        {
          id: "openai/gpt-5-mini",
          label: "OpenAI GPT-5 mini"
        }
      ]
    });
    expect("setCookieHeader" in bootstrap).toBe(true);
    expect("setCookieHeader" in bootstrap ? bootstrap.setCookieHeader : "").toContain("copilotchat_session=");
  });
});
