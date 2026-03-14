import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type {
  AppBootstrapResponse,
  AppDeviceAuthPollResponse,
  AuthDeviceStartResponse,
  AuthSessionResponse,
  ChatCompletionResponse,
  ChatMessage,
  ChatStreamRequest,
  ListedModel
} from "../../../../packages/shared/src/protocol.js";

type AppFetch = (input: string, init?: RequestInit) => Promise<Response>;
type CommandResult = {
  ok: boolean;
  stderr?: string;
  stdout: string;
};
type ExecCommand = (command: string, args: string[]) => Promise<CommandResult>;

interface GitHubUser {
  login: string;
}

interface DeviceCodePayload {
  device_code?: string;
  expires_in?: number;
  interval?: number;
  user_code?: string;
  verification_uri?: string;
}

interface AccessTokenPayload {
  access_token?: string;
  error?: string;
  expires_in?: number;
  interval?: number;
}

interface SessionCookiePayload {
  accountLabel: string;
  models?: ListedModel[];
  token: string;
  tokenHint: string;
}

interface CatalogModelRecord {
  capabilities?: string[];
  id: string;
  name?: string;
  supported_input_modalities?: string[];
  supported_output_modalities?: string[];
  task?: string;
}

interface ChatCompletionPayload {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; type?: string }>;
      role?: string;
    };
  }>;
  usage?: {
    completion_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    input_tokens?: number;
  };
}

const copilotGaModels = [
  { id: "openai/gpt-5-mini", label: "OpenAI GPT-5 mini" },
  { id: "openai/gpt-4.1", label: "OpenAI GPT-4.1" },
  { id: "openai/gpt-4o", label: "OpenAI GPT-4o" }
] as const;

export function createGitHubBff(options: {
  allowDevCliAuth: boolean;
  apiBaseUrl?: string;
  clientId: string;
  cookieName?: string;
  cookieSecret: string;
  execCommand: ExecCommand;
  fetchFn?: AppFetch;
  loginBaseUrl?: string;
  modelsBaseUrl?: string;
  now?: () => Date;
  scope?: string;
  secureCookies?: boolean;
}) {
  const fetchFn = options.fetchFn ?? fetch;
  const apiBaseUrl = options.apiBaseUrl ?? "https://api.github.com";
  const clientId = options.clientId.trim();
  const cookieName = options.cookieName ?? "copilotchat_session";
  const loginBaseUrl = options.loginBaseUrl ?? "https://github.com/login";
  const modelsBaseUrl = options.modelsBaseUrl ?? "https://models.github.ai";
  const now = options.now ?? (() => new Date());
  const scope = options.scope?.trim() || undefined;
  const secureCookies = options.secureCookies ?? false;

  return {
    async authWithPat(input: { token: string }) {
      const token = input.token.trim();
      if (!token) {
        throw new Error("pat_required");
      }

      const session = await resolveSession({
        apiBaseUrl,
        fetchFn,
        modelsBaseUrl,
        token
      });

      return {
        ...(await bootstrapResponse({
          auth: buildAuthResponse(session),
          devCliAvailable: options.allowDevCliAuth,
          models: session.models
        })),
        setCookieHeader: sealSessionCookie({
          accountLabel: session.accountLabel,
          cookieName,
          cookieSecret: options.cookieSecret,
          models: session.models,
          secure: secureCookies,
          token: session.token,
          tokenHint: session.tokenHint
        })
      };
    },

    async authWithCli() {
      if (!options.allowDevCliAuth) {
        throw new Error("dev_cli_auth_disabled");
      }

      const result = await options.execCommand("gh", ["auth", "token"]);
      if (!result.ok) {
        throw new Error("dev_cli_auth_failed");
      }

      const session = await resolveSession({
        apiBaseUrl,
        fetchFn,
        modelsBaseUrl,
        token: result.stdout.trim()
      });

      return {
        ...(await bootstrapResponse({
          auth: buildAuthResponse(session),
          devCliAvailable: options.allowDevCliAuth,
          models: session.models
        })),
        setCookieHeader: sealSessionCookie({
          accountLabel: session.accountLabel,
          cookieName,
          cookieSecret: options.cookieSecret,
          models: session.models,
          secure: secureCookies,
          token: session.token,
          tokenHint: session.tokenHint
        })
      };
    },

    async bootstrap(input?: { cookieHeader?: string }) {
      const session = readSessionCookie({
        cookieHeader: input?.cookieHeader,
        cookieName,
        cookieSecret: options.cookieSecret
      });

      if (!session) {
        return anonymousBootstrap(options.allowDevCliAuth);
      }

      try {
        if (!session.models?.length) {
          const refreshedSession = await resolveSession({
            apiBaseUrl,
            fetchFn,
            modelsBaseUrl,
            token: session.token
          });

          return {
            ...(await bootstrapResponse({
              auth: buildAuthResponse(refreshedSession),
              devCliAvailable: options.allowDevCliAuth,
              models: refreshedSession.models
            })),
            setCookieHeader: sealSessionCookie({
              accountLabel: refreshedSession.accountLabel,
              cookieName,
              cookieSecret: options.cookieSecret,
              models: refreshedSession.models,
              secure: secureCookies,
              token: refreshedSession.token,
              tokenHint: refreshedSession.tokenHint
            })
          };
        }

        return await bootstrapResponse({
          auth: buildAuthResponse(session),
          devCliAvailable: options.allowDevCliAuth,
          models: session.models
        });
      } catch {
        return {
          ...anonymousBootstrap(options.allowDevCliAuth),
          setCookieHeader: clearSessionCookie(cookieName, secureCookies)
        };
      }
    },

    async completeChat(input: { cookieHeader?: string; request: ChatStreamRequest }): Promise<ChatCompletionResponse> {
      const session = readSessionCookie({
        cookieHeader: input.cookieHeader,
        cookieName,
        cookieSecret: options.cookieSecret
      });
      if (!session) {
        throw new Error("auth_required");
      }

      let lastError = "github_models_request_failed";
      for (const modelId of inferenceAttemptOrder(
        input.request.modelId,
        session.models?.map((model) => model.id)
      )) {
        const response = await fetchFn(`${modelsBaseUrl}/inference/chat/completions`, {
          body: JSON.stringify({
            messages: input.request.messages.map(toUpstreamMessage),
            model: modelId,
            stream: false
          }),
          headers: {
            ...githubHeaders(session.token),
            "content-type": "application/json"
          },
          method: "POST"
        });

        if (!response.ok) {
          lastError = await readError(response);
          if (lastError === "no_access") {
            continue;
          }
          throw new Error(lastError);
        }

        const payload = (await response.json()) as ChatCompletionPayload;
        const content = normalizeAssistantContent(payload.choices?.[0]?.message?.content);
        if (!content) {
          throw new Error("chat_empty");
        }

        return {
          message: {
            content,
            id: randomUUID(),
            role: "assistant"
          },
          usedModel: {
            id: modelId,
            label: labelForModel(modelId)
          },
          usage: {
            inputTokens: payload.usage?.prompt_tokens ?? payload.usage?.input_tokens ?? 0,
            outputTokens: payload.usage?.completion_tokens ?? payload.usage?.output_tokens ?? 0
          }
        };
      }

      throw new Error(lastError);
    },

    async logout() {
      return {
        ...anonymousBootstrap(options.allowDevCliAuth),
        setCookieHeader: clearSessionCookie(cookieName, secureCookies)
      };
    },

    async pollDeviceAuth(input: { deviceCode: string }): Promise<
      AppDeviceAuthPollResponse & {
        setCookieHeader?: string;
      }
    > {
      const payload = await requestDeviceAccessToken({
        clientId,
        deviceCode: input.deviceCode,
        fetchFn,
        loginBaseUrl
      });

      if (payload.error === "authorization_pending" || payload.error === "slow_down") {
        return {
          pollAfterSeconds: payload.interval ?? 5,
          status: "pending"
        };
      }

      if (!payload.access_token) {
        throw new Error(payload.error ?? "github_auth_failed");
      }

      const session = await resolveSession({
        apiBaseUrl,
        fetchFn,
        modelsBaseUrl,
        token: payload.access_token
      });

      return {
        ...(await bootstrapResponse({
          auth: buildAuthResponse(session),
          devCliAvailable: options.allowDevCliAuth,
          models: session.models
        })),
        setCookieHeader: sealSessionCookie({
          accountLabel: session.accountLabel,
          cookieName,
          cookieSecret: options.cookieSecret,
          models: session.models,
          secure: secureCookies,
          token: session.token,
          tokenHint: session.tokenHint
        }),
        status: "complete"
      };
    },

    async startDeviceAuth(): Promise<AuthDeviceStartResponse> {
      if (!clientId) {
        throw new Error("github_auth_not_configured");
      }

      const body = new URLSearchParams({
        client_id: clientId
      });
      if (scope) {
        body.set("scope", scope);
      }

      const response = await fetchFn(`${loginBaseUrl}/device/code`, {
        body,
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded"
        },
        method: "POST"
      });

      const payload = (await response.json()) as DeviceCodePayload;
      if (!response.ok || !payload.device_code || !payload.user_code || !payload.verification_uri) {
        throw new Error("github_device_code_failed");
      }

      return {
        deviceCode: payload.device_code,
        expiresAt: new Date(now().getTime() + (payload.expires_in ?? 900) * 1000).toISOString(),
        intervalSeconds: payload.interval ?? 5,
        userCode: payload.user_code,
        verificationUri: payload.verification_uri
      };
    }
  };
}

export function sealSessionCookie(input: {
  accountLabel: string;
  cookieName?: string;
  cookieSecret: string;
  models?: ListedModel[];
  secure?: boolean;
  token: string;
  tokenHint?: string;
}) {
  const payload = JSON.stringify({
    accountLabel: input.accountLabel,
    models: input.models,
    token: input.token,
    tokenHint: input.tokenHint ?? maskToken(input.token)
  } satisfies SessionCookiePayload);
  const iv = randomBytes(12);
  const key = secretKey(input.cookieSecret);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const value = Buffer.concat([iv, tag, encrypted]).toString("base64url");
  return serializeCookie(input.cookieName ?? "copilotchat_session", value, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
    sameSite: "Lax",
    secure: input.secure ?? false
  });
}

export function readCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) {
    return null;
  }

  for (const entry of cookieHeader.split(";")) {
    const [key, ...rest] = entry.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }

  return null;
}

export function splitSetCookieHeader(value: string) {
  return value.split(/,(?=\s*[^;]+=)/).map((entry) => entry.trim());
}

async function bootstrapResponse(input: {
  auth: AuthSessionResponse;
  devCliAvailable: boolean;
  models: ListedModel[];
}): Promise<AppBootstrapResponse> {
  return {
    auth: input.auth,
    devCliAvailable: input.devCliAvailable,
    models: input.models
  };
}

function buildAuthResponse(session: SessionCookiePayload): AuthSessionResponse {
  return {
    accountLabel: session.accountLabel,
    authenticated: true,
    provider: "github-models",
    tokenHint: session.tokenHint
  };
}

function clearSessionCookie(cookieName: string, secure: boolean) {
  return serializeCookie(cookieName, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "Lax",
    secure
  });
}

function anonymousBootstrap(devCliAvailable: boolean): AppBootstrapResponse {
  return {
    auth: {
      accountLabel: null,
      authenticated: false,
      provider: "github-models"
    },
    devCliAvailable,
    models: []
  };
}

async function listModels(input: {
  fetchFn: AppFetch;
  modelsBaseUrl: string;
  token: string;
}): Promise<ListedModel[]> {
  const response = await input.fetchFn(`${input.modelsBaseUrl}/catalog/models`, {
    headers: githubHeaders(input.token)
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const payload = (await response.json()) as unknown;
  const records = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload && "data" in payload && Array.isArray(payload.data)
      ? payload.data
      : [];

  const modelMap = new Map(
    records
      .filter(isCatalogModelRecord)
      .filter(isChatCapable)
      .map((model) => [model.id, model] as const)
  );

  return copilotGaModels
    .filter((model) => modelMap.has(model.id))
    .map((model) => ({
      id: model.id,
      label: model.label
    }));
}

async function lookupViewerLabel(input: {
  apiBaseUrl: string;
  fetchFn: AppFetch;
  token: string;
}) {
  const response = await input.fetchFn(`${input.apiBaseUrl}/user`, {
    headers: githubHeaders(input.token)
  });
  if (!response.ok) {
    return "GitHub Models";
  }

  const user = (await response.json()) as GitHubUser;
  return typeof user.login === "string" && user.login ? user.login : "GitHub Models";
}

async function validateModelsAccess(input: {
  fetchFn: AppFetch;
  modelsBaseUrl: string;
  token: string;
}) {
  try {
    return await listModels(input);
  } catch (errorValue) {
    const error = errorValue instanceof Error ? errorValue.message : "github_models_request_failed";
    if (error === "insufficient_scope" || error === "Resource not accessible by integration") {
      throw new Error("github_models_pat_required");
    }
    throw errorValue;
  }
}

async function resolveSession(input: {
  apiBaseUrl: string;
  fetchFn: AppFetch;
  modelsBaseUrl: string;
  token: string;
}) {
  const catalogModels = await validateModelsAccess({
    fetchFn: input.fetchFn,
    modelsBaseUrl: input.modelsBaseUrl,
    token: input.token
  });
  const models = await probeReachableModels({
    fetchFn: input.fetchFn,
    models: catalogModels,
    modelsBaseUrl: input.modelsBaseUrl,
    token: input.token
  });
  if (!models.length) {
    throw new Error("no_inference_access");
  }

  return {
    accountLabel: await lookupViewerLabel({
      apiBaseUrl: input.apiBaseUrl,
      fetchFn: input.fetchFn,
      token: input.token
    }),
    models,
    token: input.token,
    tokenHint: maskToken(input.token)
  };
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
    return payload.error?.code ?? payload.error?.message ?? payload.message ?? "github_models_request_failed";
  } catch {
    return "github_models_request_failed";
  }
}

function readSessionCookie(input: {
  cookieHeader?: string;
  cookieName: string;
  cookieSecret: string;
}) {
  const value = readCookie(input.cookieHeader, input.cookieName);
  if (!value) {
    return null;
  }

  try {
    const raw = Buffer.from(value, "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", secretKey(input.cookieSecret), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    return JSON.parse(decrypted) as SessionCookiePayload;
  } catch {
    return null;
  }
}

async function requestDeviceAccessToken(input: {
  clientId: string;
  deviceCode: string;
  fetchFn: AppFetch;
  loginBaseUrl: string;
}) {
  const response = await input.fetchFn(`${input.loginBaseUrl}/oauth/access_token`, {
    body: new URLSearchParams({
      client_id: input.clientId,
      device_code: input.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    }),
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    method: "POST"
  });

  if (!response.ok && response.status >= 500) {
    throw new Error("github_auth_failed");
  }

  return (await response.json()) as AccessTokenPayload;
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

function maskToken(token: string) {
  const trimmed = token.trim();
  return trimmed.length <= 8 ? trimmed : `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

async function probeReachableModels(input: {
  fetchFn: AppFetch;
  models: ListedModel[];
  modelsBaseUrl: string;
  token: string;
}) {
  const reachableModels: ListedModel[] = [];
  let firstProbeError: Error | null = null;

  for (const model of input.models) {
    try {
      if (
        await probeModelAccess({
          fetchFn: input.fetchFn,
          modelId: model.id,
          modelsBaseUrl: input.modelsBaseUrl,
          token: input.token
        })
      ) {
        reachableModels.push(model);
      }
    } catch (errorValue) {
      if (!firstProbeError) {
        firstProbeError = errorValue instanceof Error ? errorValue : new Error("github_models_request_failed");
      }
    }
  }

  if (!reachableModels.length && firstProbeError) {
    throw firstProbeError;
  }

  return reachableModels;
}

async function probeModelAccess(input: {
  fetchFn: AppFetch;
  modelId: string;
  modelsBaseUrl: string;
  token: string;
}) {
  const response = await input.fetchFn(`${input.modelsBaseUrl}/inference/chat/completions`, {
    body: JSON.stringify({
      messages: [
        {
          content: "Reply with ok.",
          role: "user"
        }
      ],
      model: input.modelId,
      stream: false
    }),
    headers: {
      ...githubHeaders(input.token),
      "content-type": "application/json"
    },
    method: "POST"
  });

  if (response.ok) {
    return true;
  }

  const error = await readError(response);
  if (error === "no_access") {
    return false;
  }

  throw new Error(error);
}

function inferenceAttemptOrder(selectedModelId: string, availableModelIds?: string[]) {
  const modelIds = availableModelIds?.length ? availableModelIds : copilotGaModels.map((model) => model.id);
  return [selectedModelId, ...modelIds.filter((id) => id !== selectedModelId)];
}

function labelForModel(modelId: string) {
  return copilotGaModels.find((model) => model.id === modelId)?.label ?? modelId;
}

function normalizeAssistantContent(
  content: string | Array<{ text?: string; type?: string }> | undefined
) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? "").join("");
  }

  return "";
}

function randomUUID() {
  return crypto.randomUUID();
}

function secretKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly: boolean;
    maxAge: number;
    path: string;
    sameSite: "Lax";
    secure: boolean;
  }
) {
  const parts = [`${name}=${value}`, `Path=${options.path}`, `Max-Age=${options.maxAge}`, `SameSite=${options.sameSite}`];
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function toUpstreamMessage(message: ChatMessage) {
  return {
    content: message.content,
    role: message.role
  };
}
