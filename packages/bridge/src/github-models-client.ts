import type { AuthConnectRequest, ChatMessage, ChatStreamRequest } from "@copilotchat/shared";

import type { StoredSession } from "./auth-session-manager";
import { normalizeUpstreamEvent } from "./stream-normalizer";

type BridgeFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface GitHubUser {
  login: string;
}

interface CatalogModelRecord {
  capabilities?: string[];
  id: string;
  name?: string;
  supported_input_modalities?: string[];
  supported_output_modalities?: string[];
  task?: string;
}

interface CatalogSourceModel {
  capabilities: string[];
  id: string;
  label: string;
  status: "available" | "maintenance" | "unavailable";
}

export class GitHubModelsClient {
  private readonly apiBaseUrl: string;
  private readonly fetchFn: BridgeFetch;
  private readonly modelsBaseUrl: string;

  constructor(options?: {
    apiBaseUrl?: string;
    fetchFn?: BridgeFetch;
    modelsBaseUrl?: string;
  }) {
    this.apiBaseUrl = options?.apiBaseUrl ?? "https://api.github.com";
    this.fetchFn = options?.fetchFn ?? fetch;
    this.modelsBaseUrl = options?.modelsBaseUrl ?? "https://models.github.ai";
  }

  async connect(input: AuthConnectRequest): Promise<StoredSession> {
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
    const payload = await this.requestJson<unknown>(`${this.modelsBaseUrl}/catalog/models`, {
      headers: githubHeaders(input.token)
    });

    const records = Array.isArray(payload)
      ? payload
      : typeof payload === "object" && payload && "data" in payload && Array.isArray(payload.data)
        ? payload.data
        : [];

    return records
      .filter(isCatalogModelRecord)
      .filter((model) => isChatCapable(model))
      .map((model) => ({
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
    const endpoint = input.organization
      ? `${this.modelsBaseUrl}/orgs/${encodeURIComponent(input.organization)}/inference/chat/completions`
      : `${this.modelsBaseUrl}/inference/chat/completions`;
    const response = await this.fetchFn(endpoint, {
      body: JSON.stringify({
        messages: input.request.messages.map(toUpstreamMessage),
        model: input.request.modelId,
        stream: true,
        stream_options: {
          include_usage: true
        }
      }),
      headers: {
        ...githubHeaders(input.token),
        "content-type": "application/json"
      },
      method: "POST",
      signal: input.signal
    });

    if (!response.ok) {
      throw new Error(await readError(response));
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

  private async requestJson<T>(url: string, init?: RequestInit) {
    const response = await this.fetchFn(url, init);
    if (!response.ok) {
      throw new Error(await readError(response));
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

function isCatalogModelRecord(value: unknown): value is CatalogModelRecord {
  return Boolean(value && typeof value === "object" && "id" in value && typeof value.id === "string");
}

function isChatCapable(model: CatalogModelRecord) {
  if (model.capabilities?.includes("chat")) {
    return true;
  }

  if (model.task === "chat-completion") {
    return true;
  }

  const input = Array.isArray(model.supported_input_modalities) ? model.supported_input_modalities : [];
  const output = Array.isArray(model.supported_output_modalities) ? model.supported_output_modalities : [];
  return input.includes("text") && output.includes("text");
}

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as {
      error?: {
        message?: string;
      };
      message?: string;
    };
    if (payload.error?.message) {
      return payload.error.message;
    }

    if (payload.message) {
      return payload.message;
    }

    return "github_models_request_failed";
  } catch {
    return "github_models_request_failed";
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
