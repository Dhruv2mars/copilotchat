import type { ChatMessage, ChatStreamRequest } from "@copilotchat/shared";

import type { StoredSession } from "./auth-session-manager";
import { normalizeUpstreamEvent } from "./stream-normalizer";

type BridgeFetch = (input: string, init?: RequestInit) => Promise<Response>;

const COPILOT_EDITOR_VERSION = "vscode/1.106.0";
const COPILOT_PLUGIN_VERSION = "copilot-chat/0.30.0";
const COPILOT_INTEGRATION_ID = "vscode-chat";

interface GitHubUser {
  login: string;
}

interface CopilotModelRecord {
  capabilities?: {
    family?: string;
    type?: string;
  };
  id: string;
  model_picker_enabled?: boolean;
  name?: string;
  preview?: boolean;
}

interface CatalogSourceModel {
  capabilities: string[];
  id: string;
  label: string;
  status: "available" | "maintenance" | "unavailable";
}

export class GitHubCopilotClient {
  private readonly apiBaseUrl: string;
  private readonly copilotBaseUrl: string;
  private readonly fetchFn: BridgeFetch;

  constructor(options?: {
    apiBaseUrl?: string;
    copilotBaseUrl?: string;
    fetchFn?: BridgeFetch;
    modelsBaseUrl?: string;
  }) {
    this.apiBaseUrl = options?.apiBaseUrl ?? "https://api.github.com";
    this.copilotBaseUrl =
      options?.copilotBaseUrl ?? options?.modelsBaseUrl ?? "https://api.githubcopilot.com";
    this.fetchFn = options?.fetchFn ?? fetch;
  }

  async connect(input: { organization?: string; token: string }): Promise<StoredSession> {
    const token = input.token.trim();
    const organization = normalizeOrganization(input.organization);

    await this.listModels({
      organization,
      token
    });

    const user = await this.requestJson<GitHubUser>(`${this.apiBaseUrl}/user`, {
      headers: githubHeaders(token)
    });

    return {
      accountLabel: user.login,
      organization,
      token,
      tokenHint: maskToken(token)
    };
  }

  async listModels(input: { organization?: string; token: string }): Promise<CatalogSourceModel[]> {
    const payload = await this.requestJson<unknown>(`${this.copilotBaseUrl}/models`, {
      headers: copilotHeaders(input.token)
    });

    const records = Array.isArray(payload)
      ? payload
      : typeof payload === "object" && payload && "data" in payload && Array.isArray(payload.data)
        ? payload.data
        : [];

    const preferredByFamily = new Map<string, CopilotModelRecord>();

    for (const model of records.filter(isCopilotModelRecord).filter(isChatCapable)) {
      const family = normalizeFamily(model);
      const current = preferredByFamily.get(family);
      if (!current || scoreModel(model) > scoreModel(current)) {
        preferredByFamily.set(family, model);
      }
    }

    return Array.from(preferredByFamily.values()).map((model) => ({
        capabilities: ["chat"],
        id: model.id,
        label: model.name ?? model.id,
        status: "available" as const
      }));
  }

  async *streamChat(input: {
    organization?: string;
    request: ChatStreamRequest;
    signal: AbortSignal;
    token: string;
  }) {
    const completionResponse = await this.fetchFn(`${this.copilotBaseUrl}/chat/completions`, {
      body: JSON.stringify({
        messages: input.request.messages.map(toUpstreamMessage),
        model: input.request.modelId,
        stream: true,
        stream_options: {
          include_usage: true
        }
      }),
      headers: {
        ...copilotHeaders(input.token),
        "content-type": "application/json"
      },
      method: "POST",
      signal: input.signal
    });

    if (!completionResponse.ok) {
      const error = await readError(completionResponse);
      if (error.code === "unsupported_api_for_model" || error.code === "model_not_supported") {
        yield* this.streamResponses(input);
        return;
      }

      throw new Error(error.message);
    }

    const reader = completionResponse.body?.getReader();
    if (!reader) {
      throw new Error("stream_missing");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }

      buffer += decoder.decode(chunk.value, {
        stream: true
      });

      const parsed = flushFrames(buffer);
      buffer = parsed.tail;

      for (const payload of parsed.events) {
        if (payload === "[DONE]") {
          continue;
        }

        const event = JSON.parse(payload) as {
          choices?: Array<{
            delta?: {
              content?: string | Array<{ text?: string; type?: string }>;
            };
          }>;
          usage?: {
            completion_tokens?: number;
            input_tokens?: number;
            output_tokens?: number;
            prompt_tokens?: number;
          };
        };

        inputTokens = event.usage?.prompt_tokens ?? event.usage?.input_tokens ?? inputTokens;
        outputTokens =
          event.usage?.completion_tokens ?? event.usage?.output_tokens ?? outputTokens;

        const delta = event.choices?.[0]?.delta?.content;
        const content =
          typeof delta === "string"
            ? delta
            : Array.isArray(delta)
              ? delta
                  .map((part) => (part.type === "text" || !part.type ? part.text ?? "" : ""))
                  .join("")
              : "";

        if (content) {
          yield normalizeUpstreamEvent({
            delta: content,
            type: "delta"
          });
        }
      }
    }

    yield normalizeUpstreamEvent({
      type: "done",
      usage: {
        inputTokens,
        outputTokens
      }
    });
  }

  private async *streamResponses(input: {
    request: ChatStreamRequest;
    signal: AbortSignal;
    token: string;
  }) {
    const response = await this.fetchFn(`${this.copilotBaseUrl}/responses`, {
      body: JSON.stringify({
        input: input.request.messages.map(toResponsesInputMessage),
        model: input.request.modelId,
        stream: true
      }),
      headers: {
        ...copilotHeaders(input.token),
        "content-type": "application/json"
      },
      method: "POST",
      signal: input.signal
    });

    if (!response.ok) {
      const error = await readError(response);
      throw new Error(error.message);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("stream_missing");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }

      buffer += decoder.decode(chunk.value, {
        stream: true
      });

      const parsed = flushFrames(buffer);
      buffer = parsed.tail;

      for (const payload of parsed.events) {
        const event = JSON.parse(payload) as {
          delta?: string;
          response?: {
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
            };
          };
          type?: string;
        };

        if (event.type === "response.output_text.delta" && event.delta) {
          yield normalizeUpstreamEvent({
            delta: event.delta,
            type: "delta"
          });
        }

        if (event.type === "response.completed") {
          inputTokens = event.response?.usage?.input_tokens ?? inputTokens;
          outputTokens = event.response?.usage?.output_tokens ?? outputTokens;
        }
      }
    }

    yield normalizeUpstreamEvent({
      type: "done",
      usage: {
        inputTokens,
        outputTokens
      }
    });
  }

  private async requestJson<T>(url: string, init?: RequestInit) {
    const response = await this.fetchFn(url, init);
    if (!response.ok) {
      const error = await readError(response);
      throw new Error(error.message);
    }

    return (await response.json()) as T;
  }
}

function flushFrames(buffer: string) {
  const frames = buffer.split("\n\n");
  const tail = frames.pop() as string;
  const events = frames
    .map((frame) =>
      frame
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n")
    )
    .filter(Boolean);

  return {
    events,
    tail
  };
}

function githubHeaders(token: string) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28"
  };
}

function copilotHeaders(token: string) {
  return {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "copilot-integration-id": COPILOT_INTEGRATION_ID,
    "editor-plugin-version": COPILOT_PLUGIN_VERSION,
    "editor-version": COPILOT_EDITOR_VERSION
  };
}

function isCopilotModelRecord(value: unknown): value is CopilotModelRecord {
  return Boolean(value && typeof value === "object" && "id" in value && typeof value.id === "string");
}

function isChatCapable(model: CopilotModelRecord) {
  return model.capabilities?.type === "chat";
}

function normalizeFamily(model: CopilotModelRecord) {
  const family = model.capabilities?.family?.trim();
  return family || model.id;
}

function scoreModel(model: CopilotModelRecord) {
  const family = normalizeFamily(model);
  let score = 0;

  if (model.id === family) {
    score += 4;
  }

  if (model.model_picker_enabled) {
    score += 2;
  }

  if (!looksVersioned(model.id)) {
    score += 1;
  }

  if (!model.preview) {
    score += 1;
  }

  return score;
}

function looksVersioned(value: string) {
  return /-\d{4}-\d{2}-\d{2}$/.test(value);
}

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as {
      error?: {
        code?: string;
        message?: string;
      };
      message?: string;
    };

    return {
      code: payload.error?.code,
      message:
        payload.error?.message ??
        payload.message ??
        "github_copilot_request_failed"
    };
  } catch {
    return {
      code: undefined,
      message: "github_copilot_request_failed"
    };
  }
}

function maskToken(token: string) {
  const trimmed = token.trim();
  return trimmed.length <= 8
    ? trimmed
    : `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function normalizeOrganization(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toUpstreamMessage(message: ChatMessage) {
  return {
    content: message.content,
    role: message.role
  };
}

function toResponsesInputMessage(message: ChatMessage) {
  return {
    content: [
      {
        text: message.content,
        type: message.role === "assistant" ? "output_text" : "input_text"
      }
    ],
    role: message.role
  };
}
