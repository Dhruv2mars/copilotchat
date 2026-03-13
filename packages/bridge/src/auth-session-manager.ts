const SESSION_KEY = "copilot_session";
const PROVIDER = "github-copilot";

export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface StoredSession {
  accessToken: string;
  accountLabel: string;
  expiresAt: string;
  refreshToken: string;
}

export interface SessionView {
  accountLabel: string | null;
  authenticated: boolean;
  expiresAt?: string;
  provider: typeof PROVIDER;
}

export class AuthSessionManager {
  constructor(private readonly options: { store: SecureStore }) {}

  async connect(session: StoredSession) {
    await this.options.store.set(SESSION_KEY, JSON.stringify(session));
  }

  async getSession(): Promise<SessionView> {
    const raw = await this.options.store.get(SESSION_KEY);
    if (!raw) {
      return {
        accountLabel: null,
        authenticated: false,
        provider: PROVIDER
      };
    }

    const session = JSON.parse(raw) as StoredSession;
    return {
      accountLabel: session.accountLabel,
      authenticated: true,
      expiresAt: session.expiresAt,
      provider: PROVIDER
    };
  }

  async logout() {
    await this.options.store.delete(SESSION_KEY);
  }
}
