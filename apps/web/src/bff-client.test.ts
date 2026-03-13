import { describe, expect, it, vi } from "vitest";

import { createHttpBffClient } from "./bff-client";

describe("bff-client", () => {
  it("boots, starts device auth, polls, chats, logs out, and supports local cli auth", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth: {
              accountLabel: null,
              authenticated: false,
              provider: "github-models"
            },
            devCliAvailable: true,
            models: []
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            deviceCode: "device-1",
            expiresAt: "2026-03-13T18:00:00.000Z",
            intervalSeconds: 5,
            userCode: "ABCD-EFGH",
            verificationUri: "https://github.com/login/device"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            pollAfterSeconds: 5,
            status: "pending"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth: {
              accountLabel: "Dhruv2mars",
              authenticated: true,
              provider: "github-models",
              tokenHint: "gho_...7890"
            },
            devCliAvailable: true,
            models: [
              {
                id: "openai/gpt-4.1-mini",
                label: "OpenAI GPT-4.1 Mini"
              }
            ],
            status: "complete"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: {
              content: "hello test",
              id: "assistant-1",
              role: "assistant"
            },
            usage: {
              inputTokens: 13,
              outputTokens: 3
            }
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth: {
              accountLabel: null,
              authenticated: false,
              provider: "github-models"
            }
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth: {
              accountLabel: "Dhruv2mars",
              authenticated: true,
              provider: "github-models",
              tokenHint: "gho_...7890"
            },
            devCliAvailable: true,
            models: [
              {
                id: "openai/gpt-4.1-mini",
                label: "OpenAI GPT-4.1 Mini"
              }
            ]
          })
        )
      );

    const client = createHttpBffClient({
      baseUrl: "/api",
      fetchFn: fetchMock
    });

    await expect(client.bootstrap()).resolves.toMatchObject({
      auth: {
        authenticated: false
      },
      devCliAvailable: true
    });

    await expect(client.startDeviceAuth()).resolves.toMatchObject({
      deviceCode: "device-1",
      userCode: "ABCD-EFGH"
    });

    await expect(client.pollDeviceAuth({ deviceCode: "device-1" })).resolves.toEqual({
      pollAfterSeconds: 5,
      status: "pending"
    });

    await expect(client.pollDeviceAuth({ deviceCode: "device-1" })).resolves.toMatchObject({
      auth: {
        authenticated: true
      },
      models: [
        {
          id: "openai/gpt-4.1-mini",
          label: "OpenAI GPT-4.1 Mini"
        }
      ],
      status: "complete"
    });

    await expect(
      client.completeChat({
        messages: [
          {
            content: "hello",
            id: "user-1",
            role: "user"
          }
        ],
        modelId: "openai/gpt-4.1-mini",
        requestId: "req-1"
      })
    ).resolves.toMatchObject({
      message: {
        content: "hello test",
        role: "assistant"
      },
      usage: {
        outputTokens: 3
      }
    });

    await expect(client.logout()).resolves.toMatchObject({
      auth: {
        authenticated: false
      }
    });

    await expect(client.authWithCli()).resolves.toMatchObject({
      auth: {
        authenticated: true
      }
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/bootstrap", undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/device/start",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("uses global fetch and maps request failures", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "auth_required"
          }),
          {
            status: 401
          }
        )
      )
      .mockResolvedValueOnce(new Response("nope", { status: 500 })) as unknown as typeof fetch;

    const client = createHttpBffClient({
      baseUrl: "/api"
    });

    await expect(client.bootstrap()).rejects.toThrow("auth_required");
    await expect(client.logout()).rejects.toThrow("github_bff_request_failed");

    globalThis.fetch = originalFetch;
  });

  it("maps parsed errors without an explicit error field", async () => {
    const client = createHttpBffClient({
      baseUrl: "/api",
      fetchFn: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({}),
          {
            status: 500
          }
        )
      )
    });

    await expect(client.bootstrap()).rejects.toThrow("github_bff_request_failed");
  });
});
