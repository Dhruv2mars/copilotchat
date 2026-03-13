import type { AuthConnectRequest } from "@copilotchat/shared";

const SESSION_KEY = "copilot_session";
const PROVIDER = "github-models";

export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface StoredSession {
  accountLabel: string;
  expiresAt?: string;
  organization?: string;
  token: string;
  tokenHint: string;
}

export interface AuthProvider {
  connect(input: AuthConnectRequest): Promise<StoredSession>;
}

export interface SessionView {
  accountLabel: string | null;
  authenticated: boolean;
  expiresAt?: string;
  organization?: string;
  provider: typeof PROVIDER;
  tokenHint?: string;
}

export class AuthSessionManager {
  constructor(
    private readonly options: {
      provider: AuthProvider;
      store: SecureStore;
    }
  ) {}

  async connect(input: AuthConnectRequest) {
    const session = await this.options.provider.connect(input);
    await this.options.store.set(SESSION_KEY, JSON.stringify(session));
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

    return {
      accountLabel: session.accountLabel,
      authenticated: true,
      expiresAt: session.expiresAt,
      organization: session.organization,
      provider: PROVIDER,
      tokenHint: session.tokenHint
    };
  }

  async getStoredSession(): Promise<StoredSession | null> {
    const raw = await this.options.store.get(SESSION_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as StoredSession;
  }

  async logout() {
    await this.options.store.delete(SESSION_KEY);
  }
}
