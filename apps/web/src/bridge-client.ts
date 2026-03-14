import type {
  AssistantDoneEvent,
  AuthDeviceStartResponse,
  BridgeAuthPollResult,
  BridgeBootstrapResponse,
  BridgeHealth,
  BridgeStreamEvent,
  ListedModel,
  PairConfirmResponse,
  PairStartResponse,
  ChatStreamRequest
} from "@copilotchat/shared";

type AppFetch = (input: string, init?: RequestInit) => Promise<Response>;
type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

const PAIRING_TOKEN_STORAGE_KEY = "copilotchat.bridge_pairing_token";

export interface StreamChatInput {
  onEvent(event: BridgeStreamEvent): void;
  request: ChatStreamRequest;
  signal?: AbortSignal;
}

export interface BridgeClient {
  bootstrap(): Promise<BridgeBootstrapResponse>;
  logout(): Promise<BridgeBootstrapResponse>;
  pollDeviceAuth(input: { deviceCode: string }): Promise<BridgeAuthPollResult>;
  startDeviceAuth(): Promise<AuthDeviceStartResponse>;
  streamChat(input: StreamChatInput): Promise<AssistantDoneEvent["usage"]>;
}

export type { BridgeAuthPollResult, BridgeBootstrapResponse as BridgeBootstrap };

export function createBridgeClient(options: {
  baseUrl: string;
  fetchFn?: AppFetch;
  origin?: string;
  storage?: StorageLike;
}): BridgeClient {
  const fetchFn = options.fetchFn ?? fetch;
  const origin = options.origin ?? window.location.origin;
  const storage = options.storage ?? sessionStorage;

  return {
    async bootstrap() {
      const health = await readHealth(fetchFn, options.baseUrl);
      if (!health) {
        clearPairingToken(storage);
        return offlineBootstrap();
      }

      let token = await ensurePairing({
        baseUrl: options.baseUrl,
        fetchFn,
        origin,
        storage
      }).catch(() => null);
      let models: ListedModel[] = [];

      if (health.auth.authenticated && token) {
        try {
          models = await loadModels({
            baseUrl: options.baseUrl,
            fetchFn,
            storage,
            token
          });
        } catch (errorValue) {
          if (errorValue instanceof Error && errorValue.message === "pairing_required") {
            token = await ensurePairing({
              baseUrl: options.baseUrl,
              fetchFn,
              origin,
              storage
            }).catch(() => null);
            /* v8 ignore next 7 -- repair fallback only when pairing reissue also fails */
            models = token
              ? await loadModels({
                  baseUrl: options.baseUrl,
                  fetchFn,
                  storage,
                  token
                })
              /* v8 ignore next -- null repaired token leaves models empty */
              : [];
          } else {
            throw errorValue;
          }
        }
      }

      return {
        auth: health.auth,
        bridge: {
          bridgeVersion: health.bridgeVersion,
          paired: Boolean(token),
          protocolVersion: health.protocolVersion,
          reachable: true
        },
        models
      };
    },

    async logout() {
      const health = await readHealth(fetchFn, options.baseUrl);
      if (!health) {
        clearPairingToken(storage);
        return offlineBootstrap();
      }

      const token = await getPairingToken(storage);
      if (token) {
        await request(fetchFn, `${options.baseUrl}/auth/logout`, {
          headers: {
            "x-bridge-token": token
          },
          method: "POST"
        });
      }

      clearPairingToken(storage);
      return {
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
      };
    },

    async pollDeviceAuth(input) {
      const token = await ensurePairing({
        baseUrl: options.baseUrl,
        fetchFn,
        origin,
        storage
      });
      const response = await requestJson<{
        accountLabel?: string | null;
        authenticated?: boolean;
        pollAfterSeconds?: number;
        provider?: "github-copilot";
        status: "complete" | "pending";
        tokenHint?: string;
      }>(fetchFn, `${options.baseUrl}/auth/device/poll`, {
        body: JSON.stringify(input),
        headers: {
          "content-type": "application/json",
          "x-bridge-token": token
        },
        method: "POST"
      });

      if (response.status === "pending") {
        return {
          pollAfterSeconds: response.pollAfterSeconds,
          status: "pending"
        };
      }

      return {
        auth: {
          accountLabel: response.accountLabel ?? null,
          authenticated: response.authenticated ?? false,
          provider: response.provider ?? "github-copilot",
          tokenHint: response.tokenHint
        },
        bridge: {
          paired: true,
          reachable: true
        },
        models: await loadModels({
          baseUrl: options.baseUrl,
          fetchFn,
          storage,
          token
        }),
        status: "complete"
      };
    },

    async startDeviceAuth() {
      const token = await ensurePairing({
        baseUrl: options.baseUrl,
        fetchFn,
        origin,
        storage
      });

      return requestJson<AuthDeviceStartResponse>(fetchFn, `${options.baseUrl}/auth/device/start`, {
        body: JSON.stringify({
          openInBrowser: true
        }),
        headers: {
          "content-type": "application/json",
          "x-bridge-token": token
        },
        method: "POST"
      });
    },

    async streamChat(input) {
      const token = await ensurePairing({
        baseUrl: options.baseUrl,
        fetchFn,
        origin,
        storage
      });
      const response = await request(fetchFn, `${options.baseUrl}/chat/stream`, {
        body: JSON.stringify(input.request),
        headers: {
          "content-type": "application/json",
          "x-bridge-token": token
        },
        method: "POST",
        signal: input.signal
      });

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("stream_missing");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let usage: AssistantDoneEvent["usage"] | null = null;

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
          const event = JSON.parse(payload) as BridgeStreamEvent;
          if (event.type === "assistant_error") {
            throw new Error(event.message);
          }

          input.onEvent(event);
          if (event.type === "assistant_done") {
            usage = event.usage;
          }
        }
      }

      if (!usage) {
        throw new Error("stream_missing_done");
      }

      return usage;
    }
  };
}

async function ensurePairing(input: {
  baseUrl: string;
  fetchFn: AppFetch;
  origin: string;
  storage: StorageLike;
}) {
  const existingToken = getPairingToken(input.storage);
  if (existingToken) {
    return existingToken;
  }

  const challenge = await requestJson<PairStartResponse>(input.fetchFn, `${input.baseUrl}/pair/start`, {
    body: JSON.stringify({
      origin: input.origin
    }),
    headers: {
      "content-type": "application/json",
      origin: input.origin
    },
    method: "POST"
  });
  const pairing = await requestJson<PairConfirmResponse>(input.fetchFn, `${input.baseUrl}/pair/confirm`, {
    body: JSON.stringify({
      code: challenge.code,
      origin: input.origin,
      pairingId: challenge.pairingId
    }),
    headers: {
      "content-type": "application/json",
      origin: input.origin
    },
    method: "POST"
  });

  setPairingToken(input.storage, pairing.token);
  return pairing.token;
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

function clearPairingToken(storage: StorageLike) {
  storage.removeItem(PAIRING_TOKEN_STORAGE_KEY);
}

function getPairingToken(storage: StorageLike) {
  return storage.getItem(PAIRING_TOKEN_STORAGE_KEY);
}

async function loadModels(input: {
  baseUrl: string;
  fetchFn: AppFetch;
  storage: StorageLike;
  token: string;
}) {
  try {
    return await requestJson<ListedModel[]>(input.fetchFn, `${input.baseUrl}/models`, {
      headers: {
        "x-bridge-token": input.token
      }
    });
  } catch (errorValue) {
    if (errorValue instanceof Error && errorValue.message === "pairing_required") {
      clearPairingToken(input.storage);
      throw errorValue;
    }

    throw errorValue;
  }
}

function offlineBootstrap(): BridgeBootstrapResponse {
  return {
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
  };
}

async function readHealth(fetchFn: AppFetch, baseUrl: string) {
  try {
    return await requestJson<BridgeHealth>(fetchFn, `${baseUrl}/health`);
  } catch {
    return null;
  }
}

async function request(fetchFn: AppFetch, url: string, init?: RequestInit) {
  const response = await fetchFn(url, init);
  if (!response.ok) {
    throw await readError(response);
  }

  return response;
}

async function requestJson<T>(fetchFn: AppFetch, url: string, init?: RequestInit) {
  const response = await request(fetchFn, url, init);
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

function setPairingToken(storage: StorageLike, token: string) {
  storage.setItem(PAIRING_TOKEN_STORAGE_KEY, token);
}
