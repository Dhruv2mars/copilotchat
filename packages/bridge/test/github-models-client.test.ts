import { describe, expect, it, vi } from "vitest";

import { GitHubModelsClient } from "../src/github-models-client";

describe("GitHubModelsClient", () => {
  it("connects by validating model access and loading the viewer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "openai/gpt-4.1",
                name: "GPT-4.1",
                supported_input_modalities: ["text"],
                supported_output_modalities: ["text"]
              }
            ]
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            login: "dhruv2mars"
          })
        )
      );

    const client = new GitHubModelsClient({
      apiBaseUrl: "https://api.github.test",
      fetchFn: fetchMock,
      modelsBaseUrl: "https://models.github.test"
    });

    await expect(
      client.connect({
        organization: "acme",
        token: "ghp_1234567890"
      })
    ).resolves.toEqual({
      accountLabel: "dhruv2mars",
      organization: "acme",
      token: "ghp_1234567890",
      tokenHint: "ghp_...7890"
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://models.github.test/catalog/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer ghp_1234567890"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.test/user",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer ghp_1234567890"
        })
      })
    );
  });

  it("lists chat-capable models and streams openai-compatible sse frames", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              capabilities: ["chat"],
              id: "openai/gpt-4.1",
              name: "GPT-4.1"
            },
            {
              id: "no/chat/metadata"
            },
            {
              id: "openai/text-embeddings-3-small",
              name: "Embeddings",
              supported_input_modalities: ["text"],
              supported_output_modalities: ["vector"]
            },
            {
              id: "openai/gpt-4.5",
              name: "GPT-4.5",
              task: "chat-completion"
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
                  'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n' +
                    'data: {"choices":[{"delta":{"content":[{"type":"text","text":"world"},{"text":"!"}]}}],"usage":{"prompt_tokens":7,"completion_tokens":4}}\n\n' +
                    "data: [DONE]\n\n"
                )
              );
              controller.close();
            }
          })
        )
      );

    const client = new GitHubModelsClient({
      fetchFn: fetchMock,
      modelsBaseUrl: "https://models.github.test"
    });

    await expect(
      client.listModels({
        token: "ghp_1234567890"
      })
    ).resolves.toEqual([
      {
        capabilities: ["chat"],
        id: "openai/gpt-4.1",
        label: "GPT-4.1",
        status: "available"
      },
      {
        capabilities: ["chat"],
        id: "openai/gpt-4.5",
        label: "GPT-4.5",
        status: "available"
      }
    ]);

    const events: Array<{ type: string; value?: string }> = [];
    for await (const event of client.streamChat({
      request: {
        messages: [
          {
            content: "hi",
            id: "m1",
            role: "user"
          }
        ],
        modelId: "openai/gpt-4.1",
        requestId: "req-1"
      },
      signal: new AbortController().signal,
      token: "ghp_1234567890"
    })) {
      if (event.type === "assistant_delta") {
        events.push({
          type: event.type,
          value: event.data
        });
      } else {
        events.push({
          type: event.type,
          value:
            event.type === "assistant_done"
              ? `${event.usage.inputTokens}/${event.usage.outputTokens}`
              : event.message
        });
      }
    }

    expect(events).toEqual([
      {
        type: "assistant_delta",
        value: "Hello "
      },
      {
        type: "assistant_delta",
        value: "world!"
      },
      {
        type: "assistant_done",
        value: "7/4"
      }
    ]);
  });

  it("maps request failures and missing streams into bridge-safe errors", async () => {
    const failingClient = new GitHubModelsClient({
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              message: "viewer_forbidden"
            }),
            {
              status: 403
            }
          )
        )
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
        )
        .mockResolvedValueOnce(new Response(null))
    });

    await expect(
      failingClient.listModels({
        token: "ghp_1234567890"
      })
    ).rejects.toThrow("viewer_forbidden");

    await expect(
      failingClient.streamChat({
        organization: "acme",
        request: {
          messages: [],
          modelId: "openai/gpt-4.1",
          requestId: "req-2"
        },
        signal: new AbortController().signal,
        token: "ghp_1234567890"
      }).next()
    ).rejects.toThrow("chat_forbidden");

    await expect(
      failingClient.streamChat({
        request: {
          messages: [],
          modelId: "openai/gpt-4.1",
          requestId: "req-3"
        },
        signal: new AbortController().signal,
        token: "ghp_1234567890"
      }).next()
    ).rejects.toThrow("stream_missing");
  });

  it("keeps short token hints and falls back on non-json upstream errors", async () => {
    const connectClient = new GitHubModelsClient({
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                id: "openai/gpt-4.1",
                supported_input_modalities: ["text"],
                supported_output_modalities: ["text"]
              }
            ])
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              login: "dhruv2mars"
            })
          )
        )
    });

    await expect(
      connectClient.connect({
        token: "short123"
      })
    ).resolves.toMatchObject({
      tokenHint: "short123"
    });

    const fallbackClient = new GitHubModelsClient({
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(
          new Response("boom", {
            status: 500
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({}), {
            status: 500
          })
        )
    });

    await expect(
      fallbackClient.listModels({
        token: "ghp_1234567890"
      })
    ).rejects.toThrow("github_models_request_failed");
    await expect(
      fallbackClient.listModels({
        token: "ghp_1234567890"
      })
    ).rejects.toThrow("github_models_request_failed");
  });

  it("returns empty catalogs for unsupported payloads and ignores empty deltas", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ unexpected: true })))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'event: ping\n\ndata: {"choices":[{"delta":{"content":[{"type":"image","text":"skip"},{"type":"text"}]}}]}\n\n' +
                    'data: {"usage":{"input_tokens":2,"output_tokens":0}}\n\n'
                )
              );
              controller.close();
            }
          })
        )
      );

    const client = new GitHubModelsClient({
      fetchFn: fetchMock
    });

    await expect(
      client.listModels({
        token: "ghp_1234567890"
      })
    ).resolves.toEqual([]);

    const events: string[] = [];
    for await (const event of client.streamChat({
      request: {
        messages: [],
        modelId: "openai/gpt-4.1",
        requestId: "req-4"
      },
      signal: new AbortController().signal,
      token: "ghp_1234567890"
    })) {
      events.push(event.type);
    }

    expect(events).toEqual(["assistant_done"]);
  });

  it("uses global fetch when no fetch override is passed", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "openai/gpt-4.1",
            supported_input_modalities: ["text"],
            supported_output_modalities: ["text"]
          }
        ])
      )
    ) as unknown as typeof fetch;

    const client = new GitHubModelsClient();
    await expect(
      client.listModels({
        token: "ghp_1234567890"
      })
    ).resolves.toHaveLength(1);

    globalThis.fetch = originalFetch;
  });
});
