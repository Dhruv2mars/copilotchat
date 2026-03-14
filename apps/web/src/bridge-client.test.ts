import { describe, expect, it, vi } from "vitest";

import { createBridgeClient } from "./bridge-client";

describe("bridge-client", () => {
  it("boots through health, auto-pairs, loads models, starts device auth, polls auth, streams chat, and logs out", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth: {
              accountLabel: "dhruv2mars",
              authenticated: true,
              provider: "github-copilot",
              tokenHint: "ghu_...7890"
            },
            bridgeVersion: "2.0.0",
            protocolVersion: "2026-03-13",
            status: "ok"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "PAIR12",
            expiresAt: "2026-03-14T10:05:00.000Z",
            origin: "http://localhost:5173",
            pairingId: "pair-1"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            pairedAt: "2026-03-14T10:00:05.000Z",
            token: "bridge-token-1"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              availability: "available",
              id: "openai/gpt-5-mini",
              label: "OpenAI GPT-5 mini"
            }
          ])
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            deviceCode: "device-1",
            expiresAt: "2026-03-14T10:10:00.000Z",
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
            accountLabel: "dhruv2mars",
            authenticated: true,
            provider: "github-copilot",
            status: "complete",
            tokenHint: "ghu_...7890"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              availability: "available",
              id: "openai/gpt-5-mini",
              label: "OpenAI GPT-5 mini"
            },
            {
              availability: "available",
              id: "openai/gpt-4.1",
              label: "OpenAI GPT-4.1"
            }
          ])
        )
      )
      .mockResolvedValueOnce(
        new Response(
          'data: {"data":"hello ","type":"assistant_delta"}\n\n' +
            'data: {"data":"world","type":"assistant_delta"}\n\n' +
            'data: {"type":"assistant_done","usage":{"inputTokens":12,"outputTokens":8}}\n\n',
          {
            headers: {
              "content-type": "text/event-stream"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accountLabel: null,
            authenticated: false,
            provider: "github-copilot"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true
          })
        )
      );

    const client = createBridgeClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: fetchMock,
      origin: "http://localhost:5173",
      storage: sessionStorage
    });

    await expect(client.bootstrap()).resolves.toEqual({
      auth: {
        accountLabel: "dhruv2mars",
        authenticated: true,
        provider: "github-copilot",
        tokenHint: "ghu_...7890"
      },
      bridge: {
        bridgeVersion: "2.0.0",
        paired: true,
        protocolVersion: "2026-03-13",
        reachable: true
      },
      models: [
        {
          availability: "available",
          id: "openai/gpt-5-mini",
          label: "OpenAI GPT-5 mini"
        }
      ]
    });

    await expect(client.startDeviceAuth()).resolves.toMatchObject({
      deviceCode: "device-1",
      userCode: "ABCD-EFGH"
    });

    await expect(client.pollDeviceAuth({ deviceCode: "device-1" })).resolves.toEqual({
      pollAfterSeconds: 5,
      status: "pending"
    });

    await expect(client.pollDeviceAuth({ deviceCode: "device-1" })).resolves.toEqual({
      auth: {
        accountLabel: "dhruv2mars",
        authenticated: true,
        provider: "github-copilot",
        tokenHint: "ghu_...7890"
      },
      bridge: {
        paired: true,
        reachable: true
      },
      models: [
        {
          availability: "available",
          id: "openai/gpt-5-mini",
          label: "OpenAI GPT-5 mini"
        },
        {
          availability: "available",
          id: "openai/gpt-4.1",
          label: "OpenAI GPT-4.1"
        }
      ],
      status: "complete"
    });

    const events: string[] = [];
    await expect(
      client.streamChat({
        onEvent(event) {
          events.push(event.type === "assistant_delta" ? event.data : event.type);
        },
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
    ).resolves.toEqual({
      inputTokens: 12,
      outputTokens: 8
    });
    expect(events).toEqual(["hello ", "world", "assistant_done"]);

    await expect(client.logout()).resolves.toEqual({
      auth: {
        accountLabel: null,
        authenticated: false,
        provider: "github-copilot"
      },
      bridge: {
        paired: false,
        reachable: true
      },
      models: []
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:8787/health",
      expect.objectContaining({
        targetAddressSpace: "local"
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8787/pair/start",
      expect.objectContaining({
        body: JSON.stringify({
          origin: "http://localhost:5173"
        }),
        method: "POST"
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:8787/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-bridge-token": "bridge-token-1"
        })
      })
    );
  });

  it("returns an offline bootstrap when the bridge is unreachable", async () => {
    const client = createBridgeClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      isSecureContext: true,
      origin: "http://localhost:5173",
      permissions: {
        query: vi.fn().mockResolvedValue({
          state: "granted"
        })
      },
      storage: sessionStorage
    });

    await expect(client.bootstrap()).resolves.toEqual({
      auth: {
        accountLabel: null,
        authenticated: false,
        provider: "github-copilot"
      },
      bridge: {
        paired: false,
        reachable: false
      },
      models: []
    });
  });

  it("surfaces loopback permission before passive prod bootstrap", async () => {
    const fetchMock = vi.fn();
    const client = createBridgeClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: fetchMock,
      isSecureContext: true,
      origin: "https://copilotchat.vercel.app",
      permissions: {
        query: vi.fn().mockResolvedValue({
          state: "prompt"
        })
      },
      storage: sessionStorage
    });

    await expect(client.bootstrap()).resolves.toEqual({
      auth: {
        accountLabel: null,
        authenticated: false,
        provider: "github-copilot"
      },
      bridge: {
        paired: false,
        permission: "prompt",
        reachable: false
      },
      models: []
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests bridge access explicitly on hosted prod", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          auth: {
            accountLabel: null,
            authenticated: false,
            provider: "github-copilot"
          },
          bridgeVersion: "2.0.0",
          protocolVersion: "2026-03-13",
          status: "ok"
        })
      )
    );
    const client = createBridgeClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: fetchMock,
      isSecureContext: true,
      origin: "https://copilotchat.vercel.app",
      permissions: {
        query: vi.fn().mockResolvedValue({
          state: "prompt"
        })
      },
      storage: sessionStorage
    });

    await expect(client.requestBridgeAccess()).resolves.toEqual({
      auth: {
        accountLabel: null,
        authenticated: false,
        provider: "github-copilot"
      },
      bridge: {
        bridgeVersion: "2.0.0",
        paired: false,
        protocolVersion: "2026-03-13",
        reachable: true
      },
      models: []
    });
  });

  it("falls back when loopback permission names are unsupported", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = createBridgeClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: fetchMock,
      isSecureContext: true,
      origin: "https://copilotchat.vercel.app",
      permissions: {
        query: vi.fn().mockRejectedValue(new TypeError("unsupported_permission_name"))
      },
      storage: sessionStorage
    });

    await expect(client.bootstrap()).resolves.toEqual({
      auth: {
        accountLabel: null,
        authenticated: false,
        provider: "github-copilot"
      },
      bridge: {
        paired: false,
        reachable: false
      },
      models: []
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/health",
      expect.objectContaining({
        targetAddressSpace: "local"
      })
    );
  });

  it("falls back when the browser has no permissions api", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = createBridgeClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: fetchMock,
      isSecureContext: true,
      origin: "https://copilotchat.vercel.app",
      storage: sessionStorage
    });

    await expect(client.bootstrap()).resolves.toEqual({
      auth: {
        accountLabel: null,
        authenticated: false,
        provider: "github-copilot"
      },
      bridge: {
        paired: false,
        reachable: false
      },
      models: []
    });
  });

  it("does not attach loopback address space for non-loopback bridges", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          auth: {
            accountLabel: null,
            authenticated: false,
            provider: "github-copilot"
          },
          bridgeVersion: "2.0.0",
          protocolVersion: "2026-03-13",
          status: "ok"
        })
      )
    );
    const client = createBridgeClient({
      baseUrl: "https://bridge.example.com",
      fetchFn: fetchMock,
      isSecureContext: true,
      origin: "https://copilotchat.vercel.app",
      permissions: {
        query: vi.fn().mockResolvedValue({
          state: "granted"
        })
      },
      storage: sessionStorage
    });

    await expect(client.bootstrap()).resolves.toEqual({
      auth: {
        accountLabel: null,
        authenticated: false,
        provider: "github-copilot"
      },
      bridge: {
        bridgeVersion: "2.0.0",
        paired: false,
        protocolVersion: "2026-03-13",
        reachable: true
      },
      models: []
    });
    expect(fetchMock).toHaveBeenCalledWith("https://bridge.example.com/health", undefined);
  });

  it("maps structured and fallback request errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "PAIR12",
            expiresAt: "2026-03-14T10:05:00.000Z",
            origin: "http://localhost:5173",
            pairingId: "pair-1"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            pairedAt: "2026-03-14T10:00:05.000Z",
            token: "bridge-token-1"
          })
        )
      )
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
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth: {
              accountLabel: null,
              authenticated: false,
              provider: "github-copilot"
            },
            bridgeVersion: "2.0.0",
            protocolVersion: "2026-03-13",
            status: "ok"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response("broken", { status: 500 })
      )
      .mockResolvedValueOnce(new Response("broken", { status: 500 }));

    const client = createBridgeClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: fetchMock,
      origin: "http://localhost:5173",
      storage: sessionStorage
    });

    await expect(client.startDeviceAuth()).rejects.toThrow("auth_required");
    await expect(client.logout()).rejects.toThrow("bridge_request_failed");
  });

  it("reuses a stored pairing token, repairs stale pairing, and requires a done event", async () => {
    sessionStorage.setItem("copilotchat.bridge_pairing_token", "stale-token");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth: {
              accountLabel: "dhruv2mars",
              authenticated: true,
              provider: "github-copilot",
              tokenHint: "ghu_...7890"
            },
            bridgeVersion: "2.0.0",
            protocolVersion: "2026-03-13",
            status: "ok"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "pairing_required"
          }),
          {
            status: 401
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "PAIR12",
            expiresAt: "2026-03-14T10:05:00.000Z",
            origin: "http://localhost:5173",
            pairingId: "pair-1"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            pairedAt: "2026-03-14T10:00:05.000Z",
            token: "bridge-token-2"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              availability: "available",
              id: "openai/gpt-5-mini",
              label: "OpenAI GPT-5 mini"
            }
          ])
        )
      )
      .mockResolvedValueOnce(
        new Response(
          'data: {"data":"partial","type":"assistant_delta"}\n\n',
          {
            headers: {
              "content-type": "text/event-stream"
            }
          }
        )
      );

    const client = createBridgeClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: fetchMock,
      origin: "http://localhost:5173",
      storage: sessionStorage
    });

    await expect(client.bootstrap()).resolves.toEqual({
      auth: {
        accountLabel: "dhruv2mars",
        authenticated: true,
        provider: "github-copilot",
        tokenHint: "ghu_...7890"
      },
      bridge: {
        bridgeVersion: "2.0.0",
        paired: true,
        protocolVersion: "2026-03-13",
        reachable: true
      },
      models: [
        {
          availability: "available",
          id: "openai/gpt-5-mini",
          label: "OpenAI GPT-5 mini"
        }
      ]
    });
    expect(sessionStorage.getItem("copilotchat.bridge_pairing_token")).toBe("bridge-token-2");

    await expect(
      client.streamChat({
        onEvent: vi.fn(),
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
    ).rejects.toThrow("stream_missing_done");
  });

  it("rethrows non-pairing model errors and assistant stream errors", async () => {
    sessionStorage.setItem("copilotchat.bridge_pairing_token", "bridge-token-3");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth: {
              accountLabel: "dhruv2mars",
              authenticated: true,
              provider: "github-copilot",
              tokenHint: "ghu_...7890"
            },
            bridgeVersion: "2.0.0",
            protocolVersion: "2026-03-13",
            status: "ok"
          })
        )
      )
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
      .mockResolvedValueOnce(
        new Response(
          'data: {"message":"stream_failed","type":"assistant_error"}\n\n',
          {
            headers: {
              "content-type": "text/event-stream"
            }
          }
        )
      );

    const client = createBridgeClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: fetchMock,
      origin: "http://localhost:5173",
      storage: sessionStorage
    });

    await expect(client.bootstrap()).rejects.toThrow("auth_required");
    await expect(
      client.streamChat({
        onEvent: vi.fn(),
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
    ).rejects.toThrow("stream_failed");
  });

  it("returns offline logout when health is unavailable and rejects missing stream bodies", async () => {
    const offlineClient = createBridgeClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      origin: "http://localhost:5173",
      storage: sessionStorage
    });

    await expect(offlineClient.logout()).resolves.toEqual({
      auth: {
        accountLabel: null,
        authenticated: false,
        provider: "github-copilot"
      },
      bridge: {
        paired: false,
        reachable: false
      },
      models: []
    });

    sessionStorage.setItem("copilotchat.bridge_pairing_token", "bridge-token-4");
    const missingBodyClient = createBridgeClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: vi.fn().mockResolvedValue(new Response(null)),
      origin: "http://localhost:5173",
      storage: sessionStorage
    });

    await expect(
      missingBodyClient.streamChat({
        onEvent: vi.fn(),
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
    ).rejects.toThrow("stream_missing");
  });

  it("uses default browser globals, fills missing auth fields, and falls back on empty json errors", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth: {
              accountLabel: null,
              authenticated: false,
              provider: "github-copilot"
            },
            bridgeVersion: "2.0.0",
            protocolVersion: "2026-03-13",
            status: "ok"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "PAIR12",
            expiresAt: "2026-03-14T10:05:00.000Z",
            origin: window.location.origin,
            pairingId: "pair-1"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            pairedAt: "2026-03-14T10:00:05.000Z",
            token: "bridge-token-5"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "complete"
          })
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([])))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({}),
          {
            status: 500
          }
        )
      ) as unknown as typeof fetch;

    const client = createBridgeClient({
      baseUrl: "http://127.0.0.1:8787"
    });

    await expect(client.bootstrap()).resolves.toEqual({
      auth: {
        accountLabel: null,
        authenticated: false,
        provider: "github-copilot"
      },
      bridge: {
        bridgeVersion: "2.0.0",
        paired: true,
        protocolVersion: "2026-03-13",
        reachable: true
      },
      models: []
    });

    await expect(client.pollDeviceAuth({ deviceCode: "device-1" })).resolves.toEqual({
      auth: {
        accountLabel: null,
        authenticated: false,
        provider: "github-copilot",
        tokenHint: undefined
      },
      bridge: {
        paired: true,
        reachable: true
      },
      models: [],
      status: "complete"
    });

    sessionStorage.setItem("copilotchat.bridge_pairing_token", "bridge-token-5");
    await expect(client.startDeviceAuth()).rejects.toThrow("bridge_request_failed");

    globalThis.fetch = originalFetch;
  });
});
