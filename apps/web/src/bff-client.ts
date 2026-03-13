import type {
  AppBootstrapResponse,
  AppDeviceAuthPollResponse,
  AuthDeviceStartResponse,
  ChatCompletionResponse,
  ChatStreamRequest,
  PatAuthRequest
} from "@copilotchat/shared";

type AppFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface BffClient {
  authWithPat(input: PatAuthRequest): Promise<AppBootstrapResponse>;
  authWithCli(): Promise<AppBootstrapResponse>;
  bootstrap(): Promise<AppBootstrapResponse>;
  completeChat(request: ChatStreamRequest): Promise<ChatCompletionResponse>;
  logout(): Promise<AppBootstrapResponse>;
  pollDeviceAuth(input: { deviceCode: string }): Promise<AppDeviceAuthPollResponse>;
  startDeviceAuth(): Promise<AuthDeviceStartResponse>;
}

export function createHttpBffClient(options: {
  baseUrl: string;
  fetchFn?: AppFetch;
}): BffClient {
  const fetchFn = options.fetchFn ?? fetch;

  return {
    authWithPat(input) {
      return requestJson(fetchFn, `${options.baseUrl}/auth/pat`, {
        body: JSON.stringify(input),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
    },
    authWithCli() {
      return requestJson(fetchFn, `${options.baseUrl}/auth/dev/cli`, {
        method: "POST"
      });
    },
    bootstrap() {
      return requestJson(fetchFn, `${options.baseUrl}/bootstrap`);
    },
    completeChat(request) {
      return requestJson(fetchFn, `${options.baseUrl}/chat`, {
        body: JSON.stringify(request),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
    },
    logout() {
      return requestJson(fetchFn, `${options.baseUrl}/logout`, {
        method: "POST"
      });
    },
    pollDeviceAuth(input) {
      return requestJson(fetchFn, `${options.baseUrl}/auth/device/poll`, {
        body: JSON.stringify(input),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
    },
    startDeviceAuth() {
      return requestJson(fetchFn, `${options.baseUrl}/auth/device/start`, {
        method: "POST"
      });
    }
  };
}

async function requestJson<T>(fetchFn: AppFetch, url: string, init?: RequestInit) {
  const response = await fetchFn(url, init);
  if (!response.ok) {
    throw await readError(response);
  }

  return (await response.json()) as T;
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return new Error(body.error ?? "github_bff_request_failed");
  } catch {
    return new Error("github_bff_request_failed");
  }
}
