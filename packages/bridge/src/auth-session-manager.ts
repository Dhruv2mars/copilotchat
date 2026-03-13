import type {
  AuthDevicePollRequest,
  AuthDevicePollResponse,
  AuthDeviceStartRequest,
  AuthDeviceStartResponse
} from "@copilotchat/shared";

const SESSION_KEY = "copilot_session";
const PROVIDER = "github-models";
const REFRESH_SKEW_MS = 60_000;

export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface StoredSession {
  accountLabel: string;
  expiresAt?: string;
  organization?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  token: string;
  tokenHint: string;
}

export interface AuthProvider {
  pollDeviceAuthorization(input: {
    deviceCode: string;
    organization?: string;
  }): Promise<
    | {
        intervalSeconds: number;
        status: "pending";
      }
    | {
        session: StoredSession;
        status: "complete";
      }
  >;
  refresh?(session: StoredSession): Promise<StoredSession>;
  startDeviceAuthorization(input: AuthDeviceStartRequest): Promise<AuthDeviceStartResponse>;
}

export interface SessionView {
  accountLabel: string | null;
  authenticated: boolean;
  expiresAt?: string;
  organization?: string;
  provider: typeof PROVIDER;
  tokenHint?: string;
}

interface PendingAuthorization {
  expiresAt: string;
  organization?: string;
}

export class AuthSessionManager {
  private readonly now: () => number;
  private readonly pending = new Map<string, PendingAuthorization>();

  constructor(
    private readonly options: {
      now?: () => number;
      provider: AuthProvider;
      store: SecureStore;
    }
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  async getSession(): Promise<SessionView> {
    const session = await this.getStoredSession();
    if (!session) {
      return {
        accountLabel: null,
        authenticated: false,
        provider: PROVIDER
      };
    }

    return toSessionView(session);
  }

  async getStoredSession(): Promise<StoredSession | null> {
    const raw = await this.options.store.get(SESSION_KEY);
    if (!raw) {
      return null;
    }

    const session = JSON.parse(raw) as StoredSession;
    if (!needsRefresh(session, this.now())) {
      return session;
    }

    if (!this.options.provider.refresh) {
      return session;
    }

    try {
      const refreshed = await this.options.provider.refresh(session);
      await this.options.store.set(SESSION_KEY, JSON.stringify(refreshed));
      return refreshed;
    } catch {
      await this.logout();
      return null;
    }
  }

  async logout() {
    this.pending.clear();
    await this.options.store.delete(SESSION_KEY);
  }

  async pollDeviceAuthorization(input: AuthDevicePollRequest): Promise<AuthDevicePollResponse> {
    const pending = this.pending.get(input.deviceCode);
    if (!pending) {
      throw new Error("auth_flow_not_found");
    }

    if (Date.parse(pending.expiresAt) <= this.now()) {
      this.pending.delete(input.deviceCode);
      throw new Error("auth_flow_expired");
    }

    const response = await this.options.provider.pollDeviceAuthorization({
      deviceCode: input.deviceCode,
      organization: pending.organization
    });

    if (response.status === "pending") {
      return {
        accountLabel: null,
        authenticated: false,
        organization: pending.organization,
        pollAfterSeconds: response.intervalSeconds,
        provider: PROVIDER,
        status: "pending"
      };
    }

    this.pending.delete(input.deviceCode);
    await this.options.store.set(SESSION_KEY, JSON.stringify(response.session));
    return {
      ...toSessionView(response.session),
      status: "complete"
    };
  }

  async startDeviceAuthorization(input: AuthDeviceStartRequest) {
    const response = await this.options.provider.startDeviceAuthorization(input);
    this.pending.set(response.deviceCode, {
      expiresAt: response.expiresAt,
      organization: input.organization?.trim() || undefined
    });
    return response;
  }
}

function needsRefresh(session: StoredSession, now: number) {
  if (!session.expiresAt) {
    return false;
  }

  return Date.parse(session.expiresAt) <= now + REFRESH_SKEW_MS;
}

function toSessionView(session: StoredSession): SessionView {
  return {
    accountLabel: session.accountLabel,
    authenticated: true,
    expiresAt: session.expiresAt,
    organization: session.organization,
    provider: PROVIDER,
    tokenHint: session.tokenHint
  };
}
