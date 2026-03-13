import { describe, expect, it } from "vitest";

import {
  AuthSessionManager,
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
  it("reports disconnected by default", async () => {
    const manager = new AuthSessionManager({
      store: new MemoryStore()
    });

    await expect(manager.getSession()).resolves.toEqual({
      accountLabel: null,
      authenticated: false,
      provider: "github-copilot"
    });
  });

  it("persists connect and clears on logout", async () => {
    const store = new MemoryStore();
    const manager = new AuthSessionManager({
      store
    });

    await manager.connect({
      accessToken: "secret",
      accountLabel: "dhruv2mars",
      expiresAt: "2026-03-14T10:00:00.000Z",
      refreshToken: "refresh"
    });

    await expect(manager.getSession()).resolves.toEqual({
      accountLabel: "dhruv2mars",
      authenticated: true,
      expiresAt: "2026-03-14T10:00:00.000Z",
      provider: "github-copilot"
    });

    await expect(store.get("copilot_session")).resolves.toContain("secret");

    await manager.logout();

    await expect(manager.getSession()).resolves.toEqual({
      accountLabel: null,
      authenticated: false,
      provider: "github-copilot"
    });
    await expect(store.get("copilot_session")).resolves.toBeNull();
  });
});
