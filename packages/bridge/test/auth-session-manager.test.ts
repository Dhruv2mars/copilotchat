import { describe, expect, it } from "vitest";

import {
  AuthSessionManager,
  type AuthProvider,
  type SecureStore
} from "../src/auth-session-manager";

class MemoryStore implements SecureStore {
  private readonly map = new Map<string, string>();

  async get(key: string) {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.map.set(key, value);
  }

  async delete(key: string) {
    this.map.delete(key);
  }
}

describe("AuthSessionManager", () => {
  const provider: AuthProvider = {
    async connect(input) {
      return {
        accountLabel: "dhruv2mars",
        organization: input.organization,
        token: input.token,
        tokenHint: "ghp_...7890"
      };
    }
  };

  it("reports disconnected by default", async () => {
    const manager = new AuthSessionManager({
      provider,
      store: new MemoryStore()
    });

    await expect(manager.getSession()).resolves.toEqual({
      accountLabel: null,
      authenticated: false,
      provider: "github-models"
    });
  });

  it("persists connect and clears on logout", async () => {
    const store = new MemoryStore();
    const manager = new AuthSessionManager({
      provider,
      store
    });

    await manager.connect({
      organization: "acme",
      token: "ghp_1234567890"
    });

    await expect(manager.getSession()).resolves.toEqual({
      accountLabel: "dhruv2mars",
      authenticated: true,
      organization: "acme",
      provider: "github-models",
      tokenHint: "ghp_...7890"
    });

    await expect(manager.getStoredSession()).resolves.toMatchObject({
      token: "ghp_1234567890"
    });

    await manager.logout();

    await expect(manager.getSession()).resolves.toEqual({
      accountLabel: null,
      authenticated: false,
      provider: "github-models"
    });
    await expect(store.get("copilot_session")).resolves.toBeNull();
  });
});
