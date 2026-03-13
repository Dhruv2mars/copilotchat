import { describe, expect, it, vi } from "vitest";

import { createHttpBridgeClient } from "./bridge-client";

describe("bridge-client", () => {
  it("fetches health/models and parses streamed sse events", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth: {
              accountLabel: null,
              authenticated: false,
              provider: "github-copilot"
            },
            bridgeVersion: "1.0.0",
            protocolVersion: "2026-03-13",
            status: "ok"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "gpt-4.1",
              label: "GPT-4.1"
            }
          ])
        )
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'event: ping\n\ndata: {"type":"assistant_delta","data":"hi"}\n\ndata: {"type":"assistant_done","usage":{"inputTokens":1,"outputTokens":1}}\n\n'
                )
              );
              controller.close();
            }
          }),
          {
            headers: {
              "content-type": "text/event-stream"
            }
          }
        )
      );

    const client = createHttpBridgeClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: fetchMock
    });

    await expect(client.health()).resolves.toMatchObject({
      status: "ok"
    });

    await expect(client.listModels({
      origin: "https://copilotchat.vercel.app",
      token: "pair-token"
    })).resolves.toEqual([
      {
        id: "gpt-4.1",
        label: "GPT-4.1"
      }
    ]);

    const events: string[] = [];
    await client.streamChat(
      {
        origin: "https://copilotchat.vercel.app",
        request: {
          messages: [],
          modelId: "gpt-4.1",
          requestId: "req-1"
        },
        token: "pair-token"
      },
      (event) => {
        events.push(event.type);
      }
    );

    expect(events).toEqual(["assistant_delta", "assistant_done"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("covers pairing/auth helpers and request failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ pairedAt: "now", token: "pair-token" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ pairedAt: "now", token: "pair-token" })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accountLabel: "Local Copilot",
            authenticated: true,
            expiresAt: "2026-03-14T10:00:00.000Z",
            provider: "github-copilot"
          })
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ aborted: true })))
      .mockResolvedValueOnce(new Response("oops", { status: 500 }))
      .mockResolvedValueOnce(new Response(null))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "pairing_required" }), { status: 401 }));

    const client = createHttpBridgeClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: fetchMock
    });

    await expect(client.startPairing({ origin: "https://copilotchat.vercel.app" })).resolves.toEqual({
      pairedAt: "now",
      token: "pair-token"
    });
    await expect(
      client.confirmPairing({
        code: "ABC123",
        origin: "https://copilotchat.vercel.app",
        pairingId: "pair-1"
      })
    ).resolves.toEqual({
      pairedAt: "now",
      token: "pair-token"
    });
    await expect(client.connectAuth()).resolves.toMatchObject({
      authenticated: true
    });
    await expect(client.logout()).resolves.toMatchObject({
      authenticated: false
    });
    await expect(
      client.abortChat({
        origin: "https://copilotchat.vercel.app",
        requestId: "req-1",
        token: "pair-token"
      })
    ).resolves.toBeUndefined();

    await expect(client.health()).rejects.toThrow("bridge_request_failed");
    await expect(
      client.streamChat(
        {
          origin: "https://copilotchat.vercel.app",
          request: {
            messages: [],
            modelId: "gpt-4.1",
            requestId: "req-2"
          },
          token: "pair-token"
        },
        () => undefined
      )
    ).rejects.toThrow("stream_missing");
    await expect(
      client.listModels({
        origin: "https://copilotchat.vercel.app",
        token: "pair-token"
      })
    ).rejects.toThrow("pairing_required");
  });

  it("throws stream errors from non-ok stream responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "auth_required" }), {
        status: 401
      })
    );

    const client = createHttpBridgeClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchFn: fetchMock
    });

    await expect(
      client.streamChat(
        {
          origin: "https://copilotchat.vercel.app",
          request: {
            messages: [],
            modelId: "gpt-4.1",
            requestId: "req-3"
          },
          token: "pair-token"
        },
        () => undefined
      )
    ).rejects.toThrow("auth_required");
  });

  it("uses global fetch by default and falls back when error json has no message", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 500
      })
    ) as unknown as typeof fetch;

    const client = createHttpBridgeClient({
      baseUrl: "http://127.0.0.1:8787"
    });

    await expect(client.health()).rejects.toThrow("bridge_request_failed");

    globalThis.fetch = originalFetch;
  });
});
