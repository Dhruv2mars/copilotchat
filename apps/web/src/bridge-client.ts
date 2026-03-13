import type {
  AuthConnectRequest,
  AuthSessionResponse,
  BridgeHealth,
  BridgeStreamEvent,
  ChatStreamRequest,
  ListedModel,
  PairConfirmRequest,
  PairConfirmResponse,
  PairStartRequest,
  PairStartResponse
} from "@copilotchat/shared";

type BridgeFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface BridgeClient {
  abortChat(input: { origin: string; requestId: string; token: string }): Promise<void>;
  connectAuth(input: AuthConnectRequest): Promise<AuthSessionResponse>;
  confirmPairing(input: PairConfirmRequest): Promise<PairConfirmResponse>;
  health(): Promise<BridgeHealth>;
  listModels(input: { origin: string; token: string }): Promise<ListedModel[]>;
  logout(): Promise<AuthSessionResponse>;
  startPairing(input: PairStartRequest): Promise<PairStartResponse>;
  streamChat(
    input: {
      origin: string;
      request: ChatStreamRequest;
      token: string;
    },
    onEvent: (event: BridgeStreamEvent) => void
  ): Promise<void>;
}

export function createHttpBridgeClient(options: {
  baseUrl: string;
  fetchFn?: BridgeFetch;
}): BridgeClient {
  const fetchFn = options.fetchFn ?? fetch;

  return {
    async abortChat(input) {
      await requestJson(fetchFn, `${options.baseUrl}/chat/abort`, {
        body: JSON.stringify({
          requestId: input.requestId
        }),
        headers: {
          "content-type": "application/json",
          "x-bridge-token": input.token
        },
        method: "POST"
      });
    },
    async connectAuth(input) {
      return requestJson(fetchFn, `${options.baseUrl}/auth/connect`, {
        body: JSON.stringify(input),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
    },
    async confirmPairing(input) {
      return requestJson(fetchFn, `${options.baseUrl}/pair/confirm`, {
        body: JSON.stringify(input),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
    },
    async health() {
      return requestJson(fetchFn, `${options.baseUrl}/health`);
    },
    async listModels(input) {
      return requestJson(fetchFn, `${options.baseUrl}/models`, {
        headers: {
          "x-bridge-token": input.token
        }
      });
    },
    async logout() {
      return requestJson(fetchFn, `${options.baseUrl}/auth/logout`, {
        method: "POST"
      });
    },
    async startPairing(input) {
      return requestJson(fetchFn, `${options.baseUrl}/pair/start`, {
        body: JSON.stringify(input),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
    },
    async streamChat(input, onEvent) {
      const response = await fetchFn(`${options.baseUrl}/chat/stream`, {
        body: JSON.stringify(input.request),
        headers: {
          "content-type": "application/json",
          "x-bridge-token": input.token
        },
        method: "POST"
      });

      if (!response.ok) {
        throw await readError(response);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("stream_missing");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }

        buffer += decoder.decode(chunk.value, {
          stream: true
        });

        buffer = flushEvents(buffer, onEvent);
      }

      flushEvents(buffer, onEvent);
    }
  };
}

async function requestJson<T>(fetchFn: BridgeFetch, url: string, init?: RequestInit) {
  const response = await fetchFn(url, init);
  if (!response.ok) {
    throw await readError(response);
  }

  return (await response.json()) as T;
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return new Error(body.error ?? "bridge_request_failed");
  } catch {
    return new Error("bridge_request_failed");
  }
}

function flushEvents(buffer: string, onEvent: (event: BridgeStreamEvent) => void) {
  const frames = buffer.split("\n\n");
  const tail = frames.pop() as string;

  for (const frame of frames) {
    if (!frame.startsWith("data: ")) {
      continue;
    }

    const payload = frame.slice(6);
    onEvent(JSON.parse(payload) as BridgeStreamEvent);
  }

  return tail;
}
