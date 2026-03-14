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
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          capabilities: ["chat"],
          id: "gpt-4o",
          label: "GPT-4o",
          status: "available"
        },
        {
          capabilities: ["chat"],
          id: "gpt-5",
          label: "GPT-5",
          status: "unavailable"
        }
      ])
    );

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

  it("keeps opencode catalog models and marks dead entries unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              capabilities: {
                family: "gpt-5.2-codex",
                type: "chat"
              },
              id: "gpt-5.2-codex",
              model_picker_enabled: true,
              name: "GPT-5.2-Codex",
              policy: {
                state: "enabled"
              }
            },
            {
              capabilities: {
                family: "claude-sonnet-4.6",
                type: "chat"
              },
              id: "claude-sonnet-4.6",
              model_picker_enabled: false,
              name: "Claude Sonnet 4.6",
              policy: {
                state: "enabled"
              }
            },
            {
              capabilities: {
                family: "gpt-5.4",
                type: "chat"
              },
              id: "gpt-5.4",
              model_picker_enabled: false,
              name: "GPT-5.4",
              policy: {
                state: "enabled"
              }
            }
          ]
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
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          capabilities: ["chat"],
          id: "gpt-5.2-codex",
          label: "GPT-5.2-Codex",
          status: "available"
        },
        {
          capabilities: ["chat"],
          id: "claude-sonnet-4.6",
          label: "Claude Sonnet 4.6",
          status: "unavailable"
        },
        {
          capabilities: ["chat"],
          id: "gpt-5.4",
          label: "GPT-5.4",
          status: "unavailable"
        },
        {
          capabilities: ["chat"],
          id: "gpt-5",
          label: "GPT-5",
          status: "unavailable"
        }
      ])
    );
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
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          capabilities: ["chat"],
          id: "claude-sonnet-4-2025-02-01",
          label: "Claude Sonnet 4",
          status: "available"
        }
      ])
    );
  });

  it("falls back to catalog label when the live model name is absent", async () => {
    const client = new GitHubCopilotClient({
      fetchFn: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                capabilities: {
                  family: "gpt-5.1",
                  type: "chat"
                },
                id: "gpt-5.1"
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
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          capabilities: ["chat"],
          id: "gpt-5.1",
          label: "GPT-5.1",
          status: "available"
        }
      ])
    );
  });

  it("falls back to exact catalog id when the live family is absent", async () => {
    const client = new GitHubCopilotClient({
      fetchFn: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                capabilities: {
                  type: "chat"
                },
                id: "gpt-5.2",
                name: "GPT-5.2"
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
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          capabilities: ["chat"],
          id: "gpt-5.2",
          label: "GPT-5.2",
          status: "available"
        }
      ])
    );
  });

  it("skips picker-disabled family aliases when selecting models", async () => {
    const client = new GitHubCopilotClient({
      fetchFn: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                capabilities: {
                  family: "claude-sonnet-4.5",
                  type: "chat"
                },
                id: "claude-sonnet-4.5",
                model_picker_enabled: false,
                name: "Claude Sonnet 4.5"
              },
              {
                capabilities: {
                  family: "claude-sonnet-4.5",
                  type: "chat"
                },
                id: "claude-sonnet-4.5-2025-02-20",
                model_picker_enabled: true,
                name: "Claude Sonnet 4.5"
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
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          capabilities: ["chat"],
          id: "claude-sonnet-4.5",
          label: "Claude Sonnet 4.5",
          status: "available"
        }
      ])
    );
  });

  it("retries transient chat stream failures and falls back to non-stream completions", async () => {
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
                model_picker_enabled: true,
                name: "GPT-4o"
              }
            ]
          })
        )
      )
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403
        })
      )
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403
        })
      )
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "The capital city of India is New Delhi."
                }
              }
            ],
            usage: {
              completion_tokens: 10,
              prompt_tokens: 12
            }
          })
        )
      );

    const client = new GitHubCopilotClient({
      fetchFn: fetchMock,
      copilotBaseUrl: "https://api.githubcopilot.test"
    });

    await client.listModels({
      token: "ghp_1234567890"
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
        modelId: "gpt-4o",
        requestId: "req-chat-retry"
      },
      signal: new AbortController().signal,
      token: "ghp_1234567890"
    })) {
      events.push({
        type: event.type,
        value:
          event.type === "assistant_delta"
            ? event.data
            : event.type === "assistant_done"
              ? `${event.usage.inputTokens}/${event.usage.outputTokens}`
              : event.message
      });
    }

    expect(events).toEqual([
      {
        type: "assistant_delta",
        value: "The capital city of India is New Delhi."
      },
      {
        type: "assistant_done",
        value: "12/10"
      }
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "https://api.githubcopilot.test/chat/completions",
      expect.objectContaining({
        body: JSON.stringify({
          messages: [
            {
              content: "indian capital city?",
              role: "user"
            }
          ],
          model: "gpt-4o",
          stream: false
        })
      })
    );
  });

  it("uses responses-only models without hitting chat completions and falls back to non-stream responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                capabilities: {
                  family: "gpt-5.2-codex",
                  type: "chat"
                },
                id: "gpt-5.2-codex",
                model_picker_enabled: true,
                name: "GPT-5.2-Codex",
                supported_endpoints: ["/responses"]
              }
            ]
          })
        )
      )
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403
        })
      )
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403
        })
      )
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: "gpt-5.2-codex",
            output: [
              {
                content: [
                  {
                    text: "New Delhi",
                    type: "output_text"
                  }
                ],
                type: "message"
              }
            ],
            usage: {
              input_tokens: 4,
              output_tokens: 2
            }
          })
        )
      );

    const client = new GitHubCopilotClient({
      fetchFn: fetchMock,
      copilotBaseUrl: "https://api.githubcopilot.test"
    });

    await client.listModels({
      token: "ghp_1234567890"
    });

    const events: string[] = [];
    for await (const event of client.streamChat({
      request: {
        messages: [
          {
            content: "indian capital city?",
            id: "m1",
            role: "user"
          }
        ],
        modelId: "gpt-5.2-codex",
        requestId: "req-responses-non-stream"
      },
      signal: new AbortController().signal,
      token: "ghp_1234567890"
    })) {
      events.push(event.type === "assistant_delta" ? event.data : event.type);
    }

    expect(events).toEqual(["New Delhi", "assistant_done"]);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://api.githubcopilot.test/chat/completions",
      expect.anything()
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
                  text: "indian capital city?",
                  type: "input_text"
                }
              ],
              role: "user"
            }
          ],
          model: "gpt-5.2-codex",
          stream: true
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "https://api.githubcopilot.test/responses",
      expect.objectContaining({
        body: JSON.stringify({
          input: [
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
          model: "gpt-5.2-codex",
          stream: false
        })
      })
    );
  });

  it("falls back to non-stream responses when a responses-only stream returns model_not_supported", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                capabilities: {
                  family: "gpt-5.1-codex-mini",
                  type: "chat"
                },
                id: "gpt-5.1-codex-mini",
                model_picker_enabled: true,
                name: "GPT-5.1-Codex-Mini",
                supported_endpoints: ["/responses"]
              }
            ]
          })
        )
      )
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
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    text: "New Delhi",
                    type: "output_text"
                  }
                ]
              }
            ],
            usage: {
              input_tokens: 4,
              output_tokens: 2
            }
          })
        )
      );

    const client = new GitHubCopilotClient({
      fetchFn: fetchMock,
      copilotBaseUrl: "https://api.githubcopilot.test"
    });

    await client.listModels({
      token: "ghp_1234567890"
    });

    const events: string[] = [];
    for await (const event of client.streamChat({
      request: {
        messages: [
          {
            content: "indian capital city?",
            id: "m1",
            role: "user"
          }
        ],
        modelId: "gpt-5.1-codex-mini",
        requestId: "req-responses-model-not-supported"
      },
      signal: new AbortController().signal,
      token: "ghp_1234567890"
    })) {
      events.push(event.type === "assistant_delta" ? event.data : event.type);
    }

    expect(events).toEqual(["New Delhi", "assistant_done"]);
  });

  it("stops on responses endpoint unsupported_api errors", async () => {
    const client = new GitHubCopilotClient({
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: [
                {
                  capabilities: {
                    family: "gpt-5.2-codex",
                    type: "chat"
                  },
                  id: "gpt-5.2-codex",
                  model_picker_enabled: true,
                  name: "GPT-5.2-Codex",
                  supported_endpoints: ["/responses"]
                }
              ]
            })
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: "unsupported_api_for_model",
                message: "model gpt-5.2-codex does not support Responses API."
              }
            }),
            {
              status: 400
            }
          )
        )
    });

    await client.listModels({
      token: "ghp_1234567890"
    });

    await expect(
      client.streamChat({
        request: {
          messages: [],
          modelId: "gpt-5.2-codex",
          requestId: "req-responses-unsupported"
        },
        signal: new AbortController().signal,
        token: "ghp_1234567890"
      }).next()
    ).rejects.toThrow("model gpt-5.2-codex does not support Responses API.");
  });

  it("does not retry non-stream responses model_not_supported failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                capabilities: {
                  family: "gpt-5.1-codex-mini",
                  type: "chat"
                },
                id: "gpt-5.1-codex-mini",
                model_picker_enabled: true,
                name: "GPT-5.1-Codex-Mini",
                supported_endpoints: ["/responses"]
              }
            ]
          })
        )
      )
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403
        })
      )
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403
        })
      )
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403
        })
      )
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
      );

    const client = new GitHubCopilotClient({
      fetchFn: fetchMock,
      copilotBaseUrl: "https://api.githubcopilot.test"
    });

    await client.listModels({
      token: "ghp_1234567890"
    });

    await expect(
      client.streamChat({
        request: {
          messages: [],
          modelId: "gpt-5.1-codex-mini",
          requestId: "req-responses-no-retry"
        },
        signal: new AbortController().signal,
        token: "ghp_1234567890"
      }).next()
    ).rejects.toThrow("The requested model is not supported.");

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("parses array chat content in non-stream fallback", async () => {
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
                model_picker_enabled: true,
                name: "GPT-4o"
              }
            ]
          })
        )
      )
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403
        })
      )
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403
        })
      )
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [
                    {
                      text: "New ",
                      type: "text"
                    },
                    {
                      text: "Delhi"
                    },
                    {
                      text: "skip",
                      type: "image"
                    }
                  ]
                }
              }
            ],
            usage: {
              prompt_tokens: 4,
              completion_tokens: 2
            }
          })
        )
      );

    const client = new GitHubCopilotClient({
      fetchFn: fetchMock,
      copilotBaseUrl: "https://api.githubcopilot.test"
    });

    await client.listModels({
      token: "ghp_1234567890"
    });

    const events: string[] = [];
    for await (const event of client.streamChat({
      request: {
        messages: [
          {
            content: "indian capital city?",
            id: "m1",
            role: "user"
          }
        ],
        modelId: "gpt-4o",
        requestId: "req-chat-array-content"
      },
      signal: new AbortController().signal,
      token: "ghp_1234567890"
    })) {
      events.push(event.type === "assistant_delta" ? event.data : event.type);
    }

    expect(events).toEqual(["New Delhi", "assistant_done"]);
  });

  it("returns only done when non-stream chat content is absent", async () => {
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
                model_picker_enabled: true,
                name: "GPT-4o"
              }
            ]
          })
        )
      )
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403
        })
      )
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403
        })
      )
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {}
              }
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 0
            }
          })
        )
      );

    const client = new GitHubCopilotClient({
      fetchFn: fetchMock,
      copilotBaseUrl: "https://api.githubcopilot.test"
    });

    await client.listModels({
      token: "ghp_1234567890"
    });

    const events: string[] = [];
    for await (const event of client.streamChat({
      request: {
        messages: [],
        modelId: "gpt-4o",
        requestId: "req-chat-empty-content"
      },
      signal: new AbortController().signal,
      token: "ghp_1234567890"
    })) {
      events.push(event.type);
    }

    expect(events).toEqual(["assistant_done"]);
  });

  it("uses chat-only endpoint metadata without falling back to responses", async () => {
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
                model_picker_enabled: true,
                name: "GPT-4o",
                supported_endpoints: ["/chat/completions"]
              }
            ]
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":"New Delhi"}}],"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n'
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

    await client.listModels({
      token: "ghp_1234567890"
    });

    const events: string[] = [];
    for await (const event of client.streamChat({
      request: {
        messages: [],
        modelId: "gpt-4o",
        requestId: "req-chat-only"
      },
      signal: new AbortController().signal,
      token: "ghp_1234567890"
    })) {
      events.push(event.type === "assistant_delta" ? event.data : event.type);
    }

    expect(events).toEqual(["New Delhi", "assistant_done"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses cached dual-endpoint metadata to switch from chat to responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                capabilities: {
                  family: "gpt-5.4",
                  type: "chat"
                },
                id: "gpt-5.4",
                model_picker_enabled: true,
                name: "GPT-5.4",
                supported_endpoints: ["/chat/completions", "/responses"]
              }
            ]
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "unsupported_api_for_model",
              message: "model \\\"gpt-5.4\\\" is not accessible via the /chat/completions endpoint"
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
                  'data: {"type":"response.output_text.delta","delta":"New Delhi"}\n\n' +
                    'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":2}}}\n\n'
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

    await client.listModels({
      token: "ghp_1234567890"
    });

    const events: string[] = [];
    for await (const event of client.streamChat({
      request: {
        messages: [],
        modelId: "gpt-5.4",
        requestId: "req-dual-endpoint"
      },
      signal: new AbortController().signal,
      token: "ghp_1234567890"
    })) {
      events.push(event.type === "assistant_delta" ? event.data : event.type);
    }

    expect(events).toEqual(["New Delhi", "assistant_done"]);
  });

  it("maps non-error fetch failures into a generic upstream error", async () => {
    const client = new GitHubCopilotClient({
      fetchFn: vi.fn().mockRejectedValue("boom")
    });

    await expect(
      client.streamChat({
        request: {
          messages: [],
          modelId: "gpt-4o",
          requestId: "req-non-error"
        },
        signal: new AbortController().signal,
        token: "ghp_1234567890"
      }).next()
    ).rejects.toThrow("github_copilot_request_failed");
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
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          capabilities: ["chat"],
          id: "gpt-4o",
          label: "GPT-4o",
          status: "available"
        }
      ])
    );

    globalThis.fetch = originalFetch;
  });
});
