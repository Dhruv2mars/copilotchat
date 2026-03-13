import type { AuthDeviceStartRequest, AuthDeviceStartResponse } from "@copilotchat/shared";

import type { AuthProvider, StoredSession } from "./auth-session-manager";
import { GitHubModelsClient } from "./github-models-client";

type BridgeFetch = (input: string, init?: RequestInit) => Promise<Response>;
type OpenUrl = (url: string) => Promise<void>;

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
  error_description?: string;
  expires_in?: number;
  interval?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

export class GitHubDeviceFlowClient implements AuthProvider {
  private readonly clientId: string;
  private readonly fetchFn: BridgeFetch;
  private readonly loginBaseUrl: string;
  private readonly modelsClient: GitHubModelsClient;
  private readonly openUrl?: OpenUrl;
  private readonly scope?: string;

  constructor(options: {
    clientId: string;
    fetchFn?: BridgeFetch;
    loginBaseUrl?: string;
    modelsClient: GitHubModelsClient;
    openUrl?: OpenUrl;
    scope?: string;
  }) {
    this.clientId = options.clientId.trim();
    this.fetchFn = options.fetchFn ?? fetch;
    this.loginBaseUrl = options.loginBaseUrl ?? "https://github.com/login";
    this.modelsClient = options.modelsClient;
    this.openUrl = options.openUrl;
    this.scope = options.scope?.trim() || undefined;
  }

  async pollDeviceAuthorization(input: { deviceCode: string; organization?: string }) {
    const payload = await this.requestAccessToken({
      device_code: input.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    });

    if (payload.error === "authorization_pending" || payload.error === "slow_down") {
      return {
        intervalSeconds: payload.interval ?? 5,
        status: "pending" as const
      };
    }

    if (!payload.access_token) {
      throw new Error(payload.error ?? "github_auth_failed");
    }

    return {
      session: await this.resolveSession({
        organization: input.organization,
        payload
      }),
      status: "complete" as const
    };
  }

  async refresh(session: StoredSession): Promise<StoredSession> {
    if (!session.refreshToken) {
      throw new Error("auth_refresh_unavailable");
    }

    if (
      session.refreshTokenExpiresAt &&
      Date.parse(session.refreshTokenExpiresAt) <= Date.now()
    ) {
      throw new Error("auth_refresh_expired");
    }

    const payload = await this.requestAccessToken({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken
    });

    if (!payload.access_token) {
      throw new Error(payload.error ?? "github_auth_refresh_failed");
    }

    return this.resolveSession({
      organization: session.organization,
      payload
    });
  }

  async startDeviceAuthorization(input: AuthDeviceStartRequest): Promise<AuthDeviceStartResponse> {
    if (!this.clientId) {
      throw new Error("github_auth_not_configured");
    }

    const body = new URLSearchParams({
      client_id: this.clientId
    });

    if (this.scope) {
      body.set("scope", this.scope);
    }

    const response = await this.fetchFn(`${this.loginBaseUrl}/device/code`, {
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

    if (input.openInBrowser !== false && this.openUrl) {
      void this.openUrl(payload.verification_uri).catch(() => undefined);
    }

    return {
      deviceCode: payload.device_code,
      expiresAt: new Date(Date.now() + (payload.expires_in ?? 900) * 1000).toISOString(),
      intervalSeconds: payload.interval ?? 5,
      organization: input.organization?.trim() || undefined,
      userCode: payload.user_code,
      verificationUri: payload.verification_uri
    };
  }

  private async requestAccessToken(bodyInput: Record<string, string>) {
    const body = new URLSearchParams({
      client_id: this.clientId,
      ...bodyInput
    });

    const response = await this.fetchFn(`${this.loginBaseUrl}/oauth/access_token`, {
      body,
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded"
      },
      method: "POST"
    });

    const payload = (await response.json()) as AccessTokenPayload;
    if (!response.ok && !payload.error) {
      throw new Error("github_auth_failed");
    }

    return payload;
  }

  private async resolveSession(input: {
    organization?: string;
    payload: AccessTokenPayload & {
      access_token?: string;
    };
  }) {
    const accessToken = input.payload.access_token as string;
    const session = await this.modelsClient.connect({
      organization: input.organization,
      token: accessToken
    });

    return {
      ...session,
      expiresAt: input.payload.expires_in
        ? new Date(Date.now() + input.payload.expires_in * 1000).toISOString()
        : undefined,
      refreshToken: input.payload.refresh_token,
      refreshTokenExpiresAt: input.payload.refresh_token_expires_in
        ? new Date(Date.now() + input.payload.refresh_token_expires_in * 1000).toISOString()
        : undefined
    };
  }
}
