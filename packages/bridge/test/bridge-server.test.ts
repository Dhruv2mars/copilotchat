import { describe, expect, it } from "vitest";

import type { BridgeStreamEvent, ChatStreamRequest } from "@copilotchat/shared";

import { AuthSessionManager } from "../src/auth-session-manager";
import { createBridgeServer, type ChatGateway } from "../src/bridge-server";
import { ModelRegistry } from "../src/model-registry";
import { PairingService, type PairingClock } from "../src/pairing-service";

class MemoryStore {
  private readonly map = new Map<string, string>();

  async get(key: string) {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.map.set(key, value);
  }

  async delete(key: string) {
    this.map.delete(key);
  }
}

class FakeGateway implements ChatGateway {
  public abortedRequests: string[] = [];

  async *streamChat(request: ChatStreamRequest, signal: AbortSignal): AsyncGenerator<BridgeStreamEvent> {
    yield {
      data: `${request.modelId}: `,
      type: "assistant_delta"
    };

    await new Promise((resolve) => setTimeout(resolve, 10));

    if (signal.aborted) {
      this.abortedRequests.push(request.requestId);
      yield {
        message: "stream_aborted",
        type: "assistant_error"
      };
      return;
    }

    yield {
      data: request.messages.at(-1)?.content ?? "",
      type: "assistant_delta"
    };
    yield {
      type: "assistant_done",
      usage: {
        inputTokens: 12,
        outputTokens: 8
      }
    };
  }
}

describe("createBridgeServer", () => {
  const origin = "https://copilotchat.vercel.app";
  let now = new Date("2026-03-13T10:00:00.000Z");
  const clock: PairingClock = {
    now: () => now
  };

  function buildServer(gateway: ChatGateway = new FakeGateway()) {
    return {
      gateway,
      server: createBridgeServer({
        auth: new AuthSessionManager({
          store: new MemoryStore()
        }),
        bridgeVersion: "1.0.0",
        chatGateway: gateway,
        modelRegistry: new ModelRegistry({
          cacheTtlMs: 30_000,
          now: () => now.getTime(),
          source: {
            fetchModels: async () => [
              {
                id: "gpt-4.1",
                label: "GPT-4.1",
                capabilities: ["chat"],
                status: "available"
              }
            ]
          }
        }),
        pairing: new PairingService({
          allowedOrigins: [origin],
          challengeTtlMs: 60_000,
          tokenTtlMs: 300_000,
          clock
        })
      })
    };
  }

  async function pair(server: ReturnType<typeof createBridgeServer>) {
    const start = await server.handle(
      new Request("http://127.0.0.1/pair/start", {
        body: JSON.stringify({
          origin
        }),
        headers: {
          "content-type": "application/json",
          origin
        },
        method: "POST"
      })
    );
    const challenge = await start.json();

    const confirm = await server.handle(
      new Request("http://127.0.0.1/pair/confirm", {
        body: JSON.stringify({
          code: challenge.code,
          origin,
          pairingId: challenge.pairingId
        }),
        headers: {
          "content-type": "application/json",
          origin
        },
        method: "POST"
      })
    );

    return confirm.json() as Promise<{ token: string }>;
  }

  it("serves health plus auth connect/logout lifecycle", async () => {
    const { server } = buildServer();

    await expect(
      server.handle(new Request("http://127.0.0.1/health")).then((response) => response.json())
    ).resolves.toMatchObject({
      auth: {
        authenticated: false
      },
      bridgeVersion: "1.0.0",
      status: "ok"
    });

    const connect = await server.handle(
      new Request("http://127.0.0.1/auth/connect", {
        body: JSON.stringify({
          accessToken: "secret",
          accountLabel: "dhruv2mars",
          expiresAt: "2026-03-14T10:00:00.000Z",
          refreshToken: "refresh"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      })
    );

    expect(connect.status).toBe(200);
    await expect(
      server.handle(new Request("http://127.0.0.1/auth/session")).then((response) => response.json())
    ).resolves.toEqual({
      accountLabel: "dhruv2mars",
      authenticated: true,
      expiresAt: "2026-03-14T10:00:00.000Z",
      provider: "github-copilot"
    });

    const logout = await server.handle(
      new Request("http://127.0.0.1/auth/logout", {
        method: "POST"
      })
    );

    expect(logout.status).toBe(200);
    await expect(
      server.handle(new Request("http://127.0.0.1/auth/session")).then((response) => response.json())
    ).resolves.toEqual({
      accountLabel: null,
      authenticated: false,
      provider: "github-copilot"
    });
  });

  it("requires pairing for protected endpoints and streams chat over sse once paired", async () => {
    const { server } = buildServer();

    const unauthorizedModels = await server.handle(
      new Request("http://127.0.0.1/models", {
        headers: {
          origin
        }
      })
    );

    expect(unauthorizedModels.status).toBe(401);

    const pairing = await pair(server);

    await server.handle(
      new Request("http://127.0.0.1/auth/connect", {
        body: JSON.stringify({
          accessToken: "secret",
          accountLabel: "dhruv2mars",
          expiresAt: "2026-03-14T10:00:00.000Z",
          refreshToken: "refresh"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      })
    );

    const models = await server.handle(
      new Request("http://127.0.0.1/models", {
        headers: {
          "x-bridge-token": pairing.token,
          origin
        }
      })
    );

    await expect(models.json()).resolves.toEqual([
      {
        id: "gpt-4.1",
        label: "GPT-4.1"
      }
    ]);

    const stream = await server.handle(
      new Request("http://127.0.0.1/chat/stream", {
        body: JSON.stringify({
          messages: [
            {
              content: "hello",
              id: "m1",
              role: "user"
            }
          ],
          modelId: "gpt-4.1",
          requestId: "req-1"
        }),
        headers: {
          "content-type": "application/json",
          "x-bridge-token": pairing.token,
          origin
        },
        method: "POST"
      })
    );

    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    await expect(stream.text()).resolves.toContain('"type":"assistant_done"');
  });

  it("aborts active requests and rejects malformed routes", async () => {
    const gateway = new FakeGateway();
    const { server } = buildServer(gateway);
    const pairing = await pair(server);

    await server.handle(
      new Request("http://127.0.0.1/auth/connect", {
        body: JSON.stringify({
          accessToken: "secret",
          accountLabel: "dhruv2mars",
          expiresAt: "2026-03-14T10:00:00.000Z",
          refreshToken: "refresh"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      })
    );

    const pending = server.handle(
      new Request("http://127.0.0.1/chat/stream", {
        body: JSON.stringify({
          messages: [
            {
              content: "hello",
              id: "m1",
              role: "user"
            }
          ],
          modelId: "gpt-4.1",
          requestId: "req-2"
        }),
        headers: {
          "content-type": "application/json",
          "x-bridge-token": pairing.token,
          origin
        },
        method: "POST"
      })
    );

    const response = await pending;
    const textPromise = response.text();

    const abort = await server.handle(
      new Request("http://127.0.0.1/chat/abort", {
        body: JSON.stringify({
          requestId: "req-2"
        }),
        headers: {
          "content-type": "application/json",
          "x-bridge-token": pairing.token,
          origin
        },
        method: "POST"
      })
    );

    expect(abort.status).toBe(202);
    expect(await textPromise).toContain("assistant_error");

    const notFound = await server.handle(new Request("http://127.0.0.1/nope"));
    expect(notFound.status).toBe(404);
  });

  it("covers preflight and defensive error branches", async () => {
    const { server } = buildServer();
    const pairing = await pair(server);

    const optionsResponse = await server.handle(
      new Request("http://127.0.0.1/models", {
        headers: {
          origin
        },
        method: "OPTIONS"
      })
    );

    expect(optionsResponse.headers.get("access-control-allow-origin")).toBe(origin);

    const unauthenticatedStream = await server.handle(
      new Request("http://127.0.0.1/chat/stream", {
        body: JSON.stringify({
          messages: [],
          modelId: "gpt-4.1",
          requestId: "req-3"
        }),
        headers: {
          "content-type": "application/json",
          "x-bridge-token": pairing.token,
          origin
        },
        method: "POST"
      })
    );

    expect(unauthenticatedStream.status).toBe(401);
    await expect(unauthenticatedStream.json()).resolves.toEqual({
      error: "auth_required"
    });

    const unpairedStream = await server.handle(
      new Request("http://127.0.0.1/chat/stream", {
        body: JSON.stringify({
          messages: [],
          modelId: "gpt-4.1",
          requestId: "req-x"
        }),
        headers: {
          "content-type": "application/json",
          origin
        },
        method: "POST"
      })
    );

    expect(unpairedStream.status).toBe(401);

    const unpairedAbort = await server.handle(
      new Request("http://127.0.0.1/chat/abort", {
        body: JSON.stringify({
          requestId: "req-4"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      })
    );

    expect(unpairedAbort.status).toBe(401);

    const malformedJson = await server.handle(
      new Request("http://127.0.0.1/pair/start", {
        body: "{",
        headers: {
          "content-type": "application/json",
          origin
        },
        method: "POST"
      })
    );

    expect(malformedJson.status).toBe(400);

    const { server: throwingServer } = buildServer({
      async *streamChat() {
        throw new Error("boom");
      }
    });

    const throwingPairing = await pair(throwingServer);
    await throwingServer.handle(
      new Request("http://127.0.0.1/auth/connect", {
        body: JSON.stringify({
          accessToken: "secret",
          accountLabel: "dhruv2mars",
          expiresAt: "2026-03-14T10:00:00.000Z",
          refreshToken: "refresh"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      })
    );

    const failedStream = await throwingServer.handle(
      new Request("http://127.0.0.1/chat/stream", {
        body: JSON.stringify({
          messages: [],
          modelId: "gpt-4.1",
          requestId: "req-5"
        }),
        headers: {
          "content-type": "application/json",
          "x-bridge-token": throwingPairing.token,
          origin
        },
        method: "POST"
      })
    );

    expect(await failedStream.text()).toContain("stream_failed");

    const brokenServer = createBridgeServer({
      auth: new AuthSessionManager({
        store: new MemoryStore()
      }),
      bridgeVersion: "1.0.0",
      chatGateway: new FakeGateway(),
      modelRegistry: {
        list: async () => {
          throw "bad";
        }
      } as unknown as ModelRegistry,
      pairing: new PairingService({
        allowedOrigins: [origin],
        challengeTtlMs: 60_000,
        tokenTtlMs: 300_000,
        clock
      })
    });

    const brokenPairing = await pair(brokenServer);
    const brokenModels = await brokenServer.handle(
      new Request("http://127.0.0.1/models", {
        headers: {
          "x-bridge-token": brokenPairing.token,
          origin
        }
      })
    );

    expect(brokenModels.status).toBe(400);
    await expect(brokenModels.json()).resolves.toEqual({
      error: "bridge_error"
    });
  });
});
