import { describe, expect, it, vi } from "vitest";

import { GitHubCopilotClient } from "../src/github-copilot-client";

describe("GitHubCopilotClient", () => {
  it("connects by validating copilot access and loading the viewer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                capabilities: {
                  family: "gpt-4o",
                  type: "chat"
                },
                id: "gpt-4o",
                name: "GPT-4o"
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

    const client = new GitHubCopilotClient({
      apiBaseUrl: "https://api.github.test",
      fetchFn: fetchMock,
      copilotBaseUrl: "https://api.githubcopilot.test"
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
      "https://api.githubcopilot.test/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer ghp_1234567890",
          "copilot-integration-id": "vscode-chat",
          "editor-plugin-version": "copilot-chat/0.30.0",
          "editor-version": "vscode/1.106.0"
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

  it("lists copilot chat models and streams chat completions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              capabilities: {
                family: "gpt-4o",
                type: "chat"
              },
              id: "gpt-4o-2024-11-20",
              name: "GPT-4o"
            },
            {
              capabilities: {
                family: "gpt-4o",
                type: "chat"
              },
              id: "gpt-4o",
              name: "GPT-4o"
            },
            {
              capabilities: {
                family: "text-embedding-3-small",
                type: "embeddings"
              },
              id: "text-embedding-3-small",
              name: "Embeddings"
            },
            {
              capabilities: {
                family: "gpt-4o-mini",
                type: "chat"
              },
              id: "gpt-4o-mini",
              name: "GPT-4o mini"
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
                  'data: {"choices":[]}\n\n' +
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

    const client = new GitHubCopilotClient({
      fetchFn: fetchMock,
      copilotBaseUrl: "https://api.githubcopilot.test"
    });

    await expect(
      client.listModels({
        token: "ghp_1234567890"
      })
    ).resolves.toEqual([
      {
        capabilities: ["chat"],
        id: "gpt-4o",
        label: "GPT-4o",
        status: "available"
      },
      {
        capabilities: ["chat"],
        id: "gpt-4o-mini",
        label: "GPT-4o mini",
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
        modelId: "gpt-4o",
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

  it("falls back to responses api for frontier models and preserves chat history", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "unsupported_api_for_model",
              message: "use_responses"
            }
          }),
          {
            status: 400
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  "event: response.created\n" +
                    'data: {"type":"response.created"}\n\n' +
                    "event: response.output_text.delta\n" +
                    'data: {"type":"response.output_text.delta","delta":"New "}\n\n' +
                    "event: response.output_text.delta\n" +
                    'data: {"type":"response.output_text.delta","delta":"Delhi"}\n\n' +
                    "event: response.completed\n" +
                    'data: {"type":"response.completed","response":{"usage":{"input_tokens":11,"output_tokens":2}}}\n\n'
                )
              );
              controller.close();
            }
          })
        )
      );

    const client = new GitHubCopilotClient({
      fetchFn: fetchMock,
      copilotBaseUrl: "https://api.githubcopilot.test"
    });

    const events: Array<{ type: string; value?: string }> = [];
    for await (const event of client.streamChat({
      request: {
        messages: [
          {
            content: "Hello",
            id: "m1",
            role: "user"
          },
          {
            content: "Hi",
            id: "m2",
            role: "assistant"
          },
          {
            content: "indian capital city?",
            id: "m3",
            role: "user"
          }
        ],
        modelId: "gpt-5.4",
        requestId: "req-responses"
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
        value: "New "
      },
      {
        type: "assistant_delta",
        value: "Delhi"
      },
      {
        type: "assistant_done",
        value: "11/2"
      }
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.githubcopilot.test/chat/completions",
      expect.objectContaining({
        body: JSON.stringify({
          messages: [
            {
              content: "Hello",
              role: "user"
            },
            {
              content: "Hi",
              role: "assistant"
            },
            {
              content: "indian capital city?",
              role: "user"
            }
          ],
          model: "gpt-5.4",
          stream: true,
          stream_options: {
            include_usage: true
          }
        })
      })
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.githubcopilot.test/responses",
      expect.objectContaining({
        body: JSON.stringify({
          input: [
            {
              content: [
                {
                  text: "Hello",
                  type: "input_text"
                }
              ],
              role: "user"
            },
            {
              content: [
                {
                  text: "Hi",
                  type: "output_text"
                }
              ],
              role: "assistant"
            },
            {
              content: [
                {
                  text: "indian capital city?",
                  type: "input_text"
                }
              ],
              role: "user"
            }
          ],
          model: "gpt-5.4",
          stream: true
        })
      })
    );
  });

  it("also falls back to responses when chat completions returns model_not_supported", async () => {
    const client = new GitHubCopilotClient({
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: "model_not_supported",
                message: "The requested model is not supported."
              }
            }),
            {
              status: 400
            }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    "event: response.output_text.delta\n" +
                      'data: {"type":"response.output_text.delta","delta":"ok"}\n\n' +
                      "event: response.completed\n" +
                      'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n'
                  )
                );
                controller.close();
              }
            })
          )
        )
    });

    const events: string[] = [];
    for await (const event of client.streamChat({
      request: {
        messages: [
          {
            content: "say ok",
            id: "m1",
            role: "user"
          }
        ],
        modelId: "gpt-5.4",
        requestId: "req-model-not-supported"
      },
      signal: new AbortController().signal,
      token: "ghp_1234567890"
    })) {
      events.push(event.type);
    }

    expect(events).toEqual(["assistant_delta", "assistant_done"]);
  });

  it("maps responses fallback failures and missing response streams", async () => {
    const failingClient = new GitHubCopilotClient({
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: "unsupported_api_for_model",
                message: "use_responses"
              }
            }),
            {
              status: 400
            }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                message: "responses_forbidden"
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
              error: {
                code: "unsupported_api_for_model",
                message: "use_responses"
              }
            }),
            {
              status: 400
            }
          )
        )
        .mockResolvedValueOnce(new Response(null))
    });

    await expect(
      failingClient.streamChat({
        request: {
          messages: [],
          modelId: "gpt-5.4",
          requestId: "req-responses-error"
        },
        signal: new AbortController().signal,
        token: "ghp_1234567890"
      }).next()
    ).rejects.toThrow("responses_forbidden");

    await expect(
      failingClient.streamChat({
        request: {
          messages: [],
          modelId: "gpt-5.4",
          requestId: "req-responses-missing"
        },
        signal: new AbortController().signal,
        token: "ghp_1234567890"
      }).next()
    ).rejects.toThrow("stream_missing");
  });

  it("handles responses completion events without usage payloads", async () => {
    const client = new GitHubCopilotClient({
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: "unsupported_api_for_model",
                message: "use_responses"
              }
            }),
            {
              status: 400
            }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    "event: response.completed\n" +
                      'data: {"type":"response.completed","response":{}}\n\n'
                  )
                );
                controller.close();
              }
            })
          )
        )
    });

    const events: Array<{ type: string; value?: string }> = [];
    for await (const event of client.streamChat({
      request: {
        messages: [
          {
            content: "indian capital city?",
            id: "m1",
            role: "user"
          }
        ],
        modelId: "gpt-5.4",
        requestId: "req-responses-empty-usage"
      },
      signal: new AbortController().signal,
      token: "ghp_1234567890"
    })) {
      events.push({
        type: event.type,
        value: event.type === "assistant_done" ? `${event.usage.inputTokens}/${event.usage.outputTokens}` : ""
      });
    }

    expect(events).toEqual([
      {
        type: "assistant_done",
        value: "0/0"
      }
    ]);
  });

  it("maps copilot request failures and missing streams into bridge-safe errors", async () => {
    const failingClient = new GitHubCopilotClient({
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
        request: {
          messages: [],
          modelId: "gpt-4o",
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
          modelId: "gpt-4o",
          requestId: "req-3"
        },
        signal: new AbortController().signal,
        token: "ghp_1234567890"
      }).next()
    ).rejects.toThrow("stream_missing");
  });

  it("keeps short token hints and falls back on non-json upstream errors", async () => {
    const connectClient = new GitHubCopilotClient({
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                capabilities: {
                  family: "gpt-4o",
                  type: "chat"
                },
                id: "gpt-4o",
                name: "GPT-4o"
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

    const fallbackClient = new GitHubCopilotClient({
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
    ).rejects.toThrow("github_copilot_request_failed");
    await expect(
      fallbackClient.listModels({
        token: "ghp_1234567890"
      })
    ).rejects.toThrow("github_copilot_request_failed");
  });

  it("returns empty model lists for unsupported payloads and ignores empty deltas", async () => {
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

    const client = new GitHubCopilotClient({
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
        modelId: "gpt-4o",
        requestId: "req-4"
      },
      signal: new AbortController().signal,
      token: "ghp_1234567890"
    })) {
      events.push(event.type);
    }

    expect(events).toEqual(["assistant_done"]);
  });

  it("prefers picker-enabled variants when no family alias exists", async () => {
    const client = new GitHubCopilotClient({
      fetchFn: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                capabilities: {
                  family: "claude-sonnet-4",
                  type: "chat"
                },
                id: "claude-sonnet-4-2025-01-01",
                name: "Claude Sonnet 4",
                preview: true
              },
              {
                capabilities: {
                  family: "claude-sonnet-4",
                  type: "chat"
                },
                id: "claude-sonnet-4-2025-02-01",
                model_picker_enabled: true,
                name: "Claude Sonnet 4",
                preview: true
              }
            ]
          })
        )
      )
    });

    await expect(
      client.listModels({
        token: "ghp_1234567890"
      })
    ).resolves.toEqual([
      {
        capabilities: ["chat"],
        id: "claude-sonnet-4-2025-02-01",
        label: "Claude Sonnet 4",
        status: "available"
      }
    ]);
  });

  it("falls back to model id when family and name are absent", async () => {
    const client = new GitHubCopilotClient({
      fetchFn: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                capabilities: {
                  family: " ",
                  type: "chat"
                },
                id: "custom-model"
              }
            ]
          })
        )
      )
    });

    await expect(
      client.listModels({
        token: "ghp_1234567890"
      })
    ).resolves.toEqual([
      {
        capabilities: ["chat"],
        id: "custom-model",
        label: "custom-model",
        status: "available"
      }
    ]);
  });

  it("uses global fetch when no fetch override is passed", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            capabilities: {
              family: "gpt-4o",
              type: "chat"
            },
            id: "gpt-4o",
            name: "GPT-4o"
          }
        ])
      )
    ) as unknown as typeof fetch;

    const client = new GitHubCopilotClient();
    await expect(
      client.listModels({
        token: "ghp_1234567890"
      })
    ).resolves.toHaveLength(1);

    globalThis.fetch = originalFetch;
  });
});
