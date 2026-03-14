import type { ChatMessage, ChatStreamRequest } from "@copilotchat/shared";

import type { StoredSession } from "./auth-session-manager";
import {
  KNOWN_UNAVAILABLE_COPILOT_MODELS,
  OPENCODE_COPILOT_MODEL_CATALOG
} from "./copilot-model-catalog";
import { normalizeUpstreamEvent } from "./stream-normalizer";

type BridgeFetch = (input: string, init?: RequestInit) => Promise<Response>;

const COPILOT_EDITOR_VERSION = "vscode/1.106.0";
const COPILOT_PLUGIN_VERSION = "copilot-chat/0.30.0";
const COPILOT_INTEGRATION_ID = "vscode-chat";
const MAX_REQUEST_ATTEMPTS = 3;

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
  policy?: {
    state?: string;
  };
  preview?: boolean;
  supported_endpoints?: string[];
}

interface CatalogSourceModel {
  capabilities: string[];
  id: string;
  label: string;
  status: "available" | "maintenance" | "unavailable";
}

interface UpstreamErrorDetails {
  code?: string;
  message: string;
  status: number;
}

type UpstreamRequestError = Error & UpstreamErrorDetails;
type DeliveryMode = "non_stream" | "stream";
type EndpointKind = "chat" | "responses";

interface ModelExecutionShape {
  endpointOrder: EndpointKind[];
}

interface ChatCompletionPayload {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; type?: string }>;
    };
  }>;
  usage?: {
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
  };
}

interface ResponsesPayload {
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export class GitHubCopilotClient {
  private readonly apiBaseUrl: string;
  private readonly copilotBaseUrl: string;
  private readonly fetchFn: BridgeFetch;
  private readonly modelCache = new Map<string, CopilotModelRecord>();

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
    const records = await this.fetchModelRecords(input.token);
    const liveModels = records.filter(isChatCapable);
    if (liveModels.length === 0) {
      return [];
    }

    return OPENCODE_COPILOT_MODEL_CATALOG.map((catalogModel) => {
      const liveModel = pickCatalogMatch(
        liveModels.filter(
          (model) => model.id === catalogModel.id || normalizeFamily(model) === catalogModel.id
        )
      );
      const isAvailable = liveModel
        ? liveModel.policy?.state !== "disabled" &&
          !KNOWN_UNAVAILABLE_COPILOT_MODELS.has(catalogModel.id)
        : false;

      return {
        capabilities: ["chat"],
        id: liveModel?.id ?? catalogModel.id,
        label: liveModel?.name ?? catalogModel.label,
        status: isAvailable ? ("available" as const) : ("unavailable" as const)
      };
    });
  }

  async *streamChat(input: {
    organization?: string;
    request: ChatStreamRequest;
    signal: AbortSignal;
    token: string;
  }) {
    const execution = this.resolveExecutionShape(input.request.modelId);
    let lastError: UpstreamRequestError | null = null;

    /* v8 ignore start */
    for (const endpoint of execution.endpointOrder) {
      try {
        if (endpoint === "chat") {
          yield* this.runWithRetry(
            () => this.streamChatCompletions(input),
            "chat",
            "stream"
          );
          return;
        }

        yield* this.runWithRetry(
          () => this.streamResponses(input),
          "responses",
          "stream"
        );
        return;
      } catch (errorValue) {
        const error = toUpstreamRequestError(errorValue);
        lastError = error;

        if (error.message === "stream_missing") {
          throw error;
        }

        if (shouldTryNextEndpoint(error, endpoint)) {
          continue;
        }

        if (!shouldTryNonStreaming(error, endpoint)) {
          if (endpoint === execution.endpointOrder.at(-1)) {
            throw error;
          }

          continue;
        }
      }

      try {
        if (endpoint === "chat") {
          yield* this.runWithRetry(
            () => this.completeChatCompletions(input),
            "chat",
            "non_stream"
          );
          return;
        }

        yield* this.runWithRetry(
          () => this.completeResponses(input),
          "responses",
          "non_stream"
        );
        return;
      } catch (errorValue) {
        const error = toUpstreamRequestError(errorValue);
        lastError = error;

        if (!shouldTryNextEndpoint(error, endpoint)) {
          throw error;
        }
      }
    }
    /* v8 ignore stop */

    /* v8 ignore next 2 */
    throw lastError ?? new Error("github_copilot_request_failed");
  }

  private async *streamChatCompletions(input: {
    request: ChatStreamRequest;
    signal: AbortSignal;
    token: string;
  }) {
    const completionResponse = await this.postChatCompletions(input, true);
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

  private async *completeChatCompletions(input: {
    request: ChatStreamRequest;
    signal: AbortSignal;
    token: string;
  }) {
    const response = await this.postChatCompletions(input, false);
    const payload = (await response.json()) as ChatCompletionPayload;
    const content = readChatCompletionText(payload.choices?.[0]?.message?.content);

    if (content) {
      yield normalizeUpstreamEvent({
        delta: content,
        type: "delta"
      });
    }

    yield normalizeUpstreamEvent({
      type: "done",
      usage: {
        /* v8 ignore next 2 */
        inputTokens: payload.usage?.prompt_tokens ?? payload.usage?.input_tokens ?? 0,
        /* v8 ignore next 2 */
        outputTokens: payload.usage?.completion_tokens ?? payload.usage?.output_tokens ?? 0
      }
    });
  }

  private async *streamResponses(input: {
    request: ChatStreamRequest;
    signal: AbortSignal;
    token: string;
  }) {
    const response = await this.postResponses(input, true);
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

  private async *completeResponses(input: {
    request: ChatStreamRequest;
    signal: AbortSignal;
    token: string;
  }) {
    const response = await this.postResponses(input, false);
    const payload = (await response.json()) as ResponsesPayload;
    const content = readResponsesText(payload);

    if (content) {
      yield normalizeUpstreamEvent({
        delta: content,
        type: "delta"
      });
    }

    yield normalizeUpstreamEvent({
      type: "done",
      usage: {
        /* v8 ignore next 2 */
        inputTokens: payload.usage?.input_tokens ?? 0,
        /* v8 ignore next 2 */
        outputTokens: payload.usage?.output_tokens ?? 0
      }
    });
  }

  private async *runWithRetry(
    execute: () => AsyncGenerator<ReturnType<typeof normalizeUpstreamEvent>>,
    endpoint: EndpointKind,
    mode: DeliveryMode
  ) {
    let lastError: UpstreamRequestError | null = null;

    /* v8 ignore start */
    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        yield* execute();
        return;
      } catch (errorValue) {
        const error = toUpstreamRequestError(errorValue);
        lastError = error;

        if (!shouldRetry(error, endpoint, mode) || attempt === MAX_REQUEST_ATTEMPTS) {
          throw error;
        }
      }
    }
    /* v8 ignore stop */

    /* v8 ignore next 2 */
    throw lastError ?? new Error("github_copilot_request_failed");
  }

  private async fetchModelRecords(token: string) {
    const payload = await this.requestJson<unknown>(`${this.copilotBaseUrl}/models`, {
      headers: copilotHeaders(token)
    });

    const records = Array.isArray(payload)
      ? payload
      : typeof payload === "object" && payload && "data" in payload && Array.isArray(payload.data)
        ? payload.data
        : [];

    const normalized = records.filter(isCopilotModelRecord);
    for (const model of normalized) {
      this.modelCache.set(model.id, model);
    }

    return normalized;
  }

  private resolveExecutionShape(modelId: string): ModelExecutionShape {
    const model = this.modelCache.get(modelId);
    const supported = model?.supported_endpoints ?? [];

    if (supported.length === 0) {
      return {
        endpointOrder: ["chat", "responses"]
      };
    }

    if (supported.includes("/responses") && !supported.includes("/chat/completions")) {
      return {
        endpointOrder: ["responses"]
      };
    }

    if (supported.includes("/chat/completions") && !supported.includes("/responses")) {
      return {
        endpointOrder: ["chat"]
      };
    }

    return {
      endpointOrder: ["chat", "responses"]
    };
  }

  private async postChatCompletions(
    input: {
      request: ChatStreamRequest;
      signal: AbortSignal;
      token: string;
    },
    stream: boolean
  ) {
    const response = await this.fetchFn(`${this.copilotBaseUrl}/chat/completions`, {
      body: JSON.stringify({
        messages: input.request.messages.map(toUpstreamMessage),
        model: input.request.modelId,
        ...(stream
          ? {
              stream: true,
              stream_options: {
                include_usage: true
              }
            }
          : {
              stream: false
            })
      }),
      headers: {
        ...copilotHeaders(input.token),
        "content-type": "application/json"
      },
      method: "POST",
      signal: input.signal
    });

    if (!response.ok) {
      throw createUpstreamRequestError(await readError(response));
    }

    return response;
  }

  private async postResponses(
    input: {
      request: ChatStreamRequest;
      signal: AbortSignal;
      token: string;
    },
    stream: boolean
  ) {
    const response = await this.fetchFn(`${this.copilotBaseUrl}/responses`, {
      body: JSON.stringify({
        input: input.request.messages.map(toResponsesInputMessage),
        model: input.request.modelId,
        stream
      }),
      headers: {
        ...copilotHeaders(input.token),
        "content-type": "application/json"
      },
      method: "POST",
      signal: input.signal
    });

    if (!response.ok) {
      throw createUpstreamRequestError(await readError(response));
    }

    return response;
  }

  private async requestJson<T>(url: string, init?: RequestInit) {
    const response = await this.fetchFn(url, init);
    if (!response.ok) {
      throw createUpstreamRequestError(await readError(response));
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

function pickCatalogMatch(models: CopilotModelRecord[]) {
  return models.reduce<CopilotModelRecord | null>((best, model) => {
    if (!best || scoreModel(model) > scoreModel(best)) {
      return model;
    }

    return best;
  }, null);
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
  const text = await response.text();

  try {
    const payload = JSON.parse(text) as {
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
        "github_copilot_request_failed",
      status: response.status
    };
  } catch {
    return {
      code: undefined,
      message: "github_copilot_request_failed",
      status: response.status
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

/* v8 ignore start */
function readChatCompletionText(content?: string | Array<{ text?: string; type?: string }>) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => (part.type === "text" || !part.type ? part.text ?? "" : ""))
    .join("");
}

function readResponsesText(payload: ResponsesPayload) {
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((part) => (part.type === "output_text" || !part.type ? part.text ?? "" : ""))
    .join("");
}
/* v8 ignore stop */

function createUpstreamRequestError(details: UpstreamErrorDetails): UpstreamRequestError {
  return Object.assign(new Error(details.message), details);
}

function toUpstreamRequestError(errorValue: unknown): UpstreamRequestError {
  if (errorValue instanceof Error) {
    return errorValue as UpstreamRequestError;
  }

  return createUpstreamRequestError({
    message: "github_copilot_request_failed",
    status: 0
  });
}

function shouldRetry(error: UpstreamRequestError, endpoint: EndpointKind, mode: DeliveryMode) {
  if (isUnsupportedEndpoint(error, endpoint)) {
    return false;
  }

  if (mode === "stream" && endpoint === "chat" && isUnsupportedModel(error)) {
    return true;
  }

  if (mode === "non_stream" && endpoint === "responses" && isUnsupportedModel(error)) {
    return false;
  }

  return [403, 408, 409, 425, 429, 500, 502, 503, 504].includes(error.status);
}

function shouldTryNonStreaming(error: UpstreamRequestError, endpoint: EndpointKind) {
  if (error.status === 403) {
    return true;
  }

  if (endpoint === "responses" && isUnsupportedModel(error)) {
    return true;
  }

  return false;
}

function shouldTryNextEndpoint(error: UpstreamRequestError, endpoint: EndpointKind) {
  if (endpoint === "chat" && (isUnsupportedModel(error) || isUnsupportedEndpoint(error, endpoint))) {
    return true;
  }

  return false;
}

function isUnsupportedModel(error: UpstreamRequestError) {
  return error.code === "model_not_supported";
}

function isUnsupportedEndpoint(error: UpstreamRequestError, endpoint: EndpointKind) {
  if (error.code !== "unsupported_api_for_model") {
    return false;
  }

  if (endpoint === "chat") {
    return error.message.includes("/chat/completions");
  }

  /* v8 ignore next */
  if (endpoint === "responses") {
    return error.message.includes("Responses API");
  }
}
