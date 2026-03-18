import { describe, expect, it, vi } from "vitest";

import {
  AuthSessionManager,
  type AuthProvider,
  type SecureStore
} from "../src/auth-session-manager";

const SESSION_KEY = "copilot_session_v2";

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
      provider: {
        async pollDeviceAuthorization() {
          return {
            intervalSeconds: 5,
            status: "pending"
          };
        },
        async startDeviceAuthorization() {
          return {
            deviceCode: "device-1",
            expiresAt: "2026-03-13T10:10:00.000Z",
            intervalSeconds: 5,
            userCode: "ABCD-EFGH",
            verificationUri: "https://github.com/login/device"
          };
        }
      },
      store: new MemoryStore()
    });

    await expect(manager.getSession()).resolves.toEqual({
      accountLabel: null,
      authenticated: false,
      provider: "github-copilot"
    });
  });

  it("tracks device auth, persists session, refreshes, and clears on logout", async () => {
    let now = Date.parse("2026-03-13T10:00:00.000Z");
    const store = new MemoryStore();
    const provider: AuthProvider = {
      pollDeviceAuthorization: vi
        .fn()
        .mockResolvedValueOnce({
          intervalSeconds: 5,
          status: "pending"
        })
        .mockResolvedValueOnce({
          session: {
            accountLabel: "dhruv2mars",
            expiresAt: "2026-03-13T10:01:00.000Z",
            organization: "acme",
            refreshToken: "refresh-1",
            token: "access-1",
            tokenHint: "ghu_...cess"
          },
          status: "complete"
        }),
      refresh: vi.fn().mockResolvedValue({
        accountLabel: "dhruv2mars",
        expiresAt: "2026-03-13T10:30:00.000Z",
        organization: "acme",
        refreshToken: "refresh-2",
        token: "access-2",
        tokenHint: "ghu_...ss-2"
      }),
      startDeviceAuthorization: vi.fn().mockResolvedValue({
        deviceCode: "device-1",
        expiresAt: "2026-03-13T10:10:00.000Z",
        intervalSeconds: 5,
        organization: "acme",
        userCode: "ABCD-EFGH",
        verificationUri: "https://github.com/login/device"
      })
    };

    const manager = new AuthSessionManager({
      now: () => now,
      provider,
      store
    });

    await expect(
      manager.startDeviceAuthorization({
        organization: "acme"
      })
    ).resolves.toMatchObject({
      deviceCode: "device-1"
    });

    await expect(
      manager.pollDeviceAuthorization({
        deviceCode: "device-1"
      })
    ).resolves.toEqual({
      accountLabel: null,
      authenticated: false,
      organization: "acme",
      pollAfterSeconds: 5,
      provider: "github-copilot",
      status: "pending"
    });

    await expect(
      manager.pollDeviceAuthorization({
        deviceCode: "device-1"
      })
    ).resolves.toEqual({
      accountLabel: "dhruv2mars",
      authenticated: true,
      expiresAt: "2026-03-13T10:01:00.000Z",
      organization: "acme",
      provider: "github-copilot",
      status: "complete",
      tokenHint: "ghu_...cess"
    });

    now = Date.parse("2026-03-13T10:00:30.000Z");
    await expect(manager.getStoredSession()).resolves.toMatchObject({
      token: "access-2"
    });
    expect(provider.refresh).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "access-1"
      })
    );

    await manager.logout();

    await expect(manager.getSession()).resolves.toEqual({
      accountLabel: null,
      authenticated: false,
      provider: "github-copilot"
    });
    await expect(store.get(SESSION_KEY)).resolves.toBeNull();
  });

  it("rejects missing or expired device flows and clears bad refreshes", async () => {
    let now = Date.parse("2026-03-13T10:00:00.000Z");
    const store = new MemoryStore();
    const manager = new AuthSessionManager({
      now: () => now,
      provider: {
        async pollDeviceAuthorization() {
          return {
            intervalSeconds: 5,
            status: "pending"
          };
        },
        refresh: vi.fn().mockRejectedValue(new Error("refresh_failed")),
        async startDeviceAuthorization() {
          return {
            deviceCode: "device-2",
            expiresAt: "2026-03-13T10:00:10.000Z",
            intervalSeconds: 5,
            userCode: "WXYZ-0000",
            verificationUri: "https://github.com/login/device"
          };
        }
      },
      store
    });

    await expect(
      manager.pollDeviceAuthorization({
        deviceCode: "missing"
      })
    ).rejects.toThrow("auth_flow_not_found");

    await manager.startDeviceAuthorization({});
    now = Date.parse("2026-03-13T10:00:11.000Z");
    await expect(
      manager.pollDeviceAuthorization({
        deviceCode: "device-2"
      })
    ).rejects.toThrow("auth_flow_expired");

    await store.set(
      SESSION_KEY,
      JSON.stringify({
        accountLabel: "dhruv2mars",
        expiresAt: "2026-03-13T10:00:00.000Z",
        refreshToken: "refresh-1",
        token: "access-1",
        tokenHint: "ghu_...cess"
      })
    );

    await expect(manager.getStoredSession()).resolves.toBeNull();
    await expect(store.get(SESSION_KEY)).resolves.toBeNull();
  });

  it("returns expiring sessions unchanged when provider has no refresh", async () => {
    const store = new MemoryStore();
    await store.set(
      SESSION_KEY,
      JSON.stringify({
        accountLabel: "dhruv2mars",
        expiresAt: "2026-03-13T10:00:00.000Z",
        token: "access-1",
        tokenHint: "ghu_...cess"
      })
    );

    const manager = new AuthSessionManager({
      now: () => Date.parse("2026-03-13T10:00:00.000Z"),
      provider: {
        async pollDeviceAuthorization() {
          return {
            intervalSeconds: 5,
            status: "pending"
          };
        },
        async startDeviceAuthorization() {
          return {
            deviceCode: "device-1",
            expiresAt: "2026-03-13T10:10:00.000Z",
            intervalSeconds: 5,
            userCode: "ABCD-EFGH",
            verificationUri: "https://github.com/login/device"
          };
        }
      },
      store
    });

    await expect(manager.getStoredSession()).resolves.toMatchObject({
      token: "access-1"
    });
  });

  it("preserves non-expiring sessions and trims blank orgs from auth start", async () => {
    const store = new MemoryStore();
    await store.set(
      SESSION_KEY,
      JSON.stringify({
        accountLabel: "dhruv2mars",
        token: "access-1",
        tokenHint: "ghu_...cess"
      })
    );

    const provider: AuthProvider = {
      async pollDeviceAuthorization() {
        return {
          intervalSeconds: 5,
          status: "pending"
        };
      },
      async startDeviceAuthorization() {
        return {
          deviceCode: "device-3",
          expiresAt: "2026-03-13T10:10:00.000Z",
          intervalSeconds: 5,
          userCode: "ABCD-EFGH",
          verificationUri: "https://github.com/login/device"
        };
      }
    };

    const manager = new AuthSessionManager({
      now: () => Date.parse("2026-03-13T10:00:00.000Z"),
      provider,
      store
    });

    await expect(manager.getStoredSession()).resolves.toMatchObject({
      token: "access-1"
    });

    await expect(
      manager.startDeviceAuthorization({
        organization: "   "
      })
    ).resolves.toMatchObject({
      deviceCode: "device-3"
    });

    await expect(
      manager.pollDeviceAuthorization({
        deviceCode: "device-3"
      })
    ).resolves.toEqual({
      accountLabel: null,
      authenticated: false,
      organization: undefined,
      pollAfterSeconds: 5,
      provider: "github-copilot",
      status: "pending"
    });
  });

  it("uses the default clock when no custom time source is provided", async () => {
    const store = new MemoryStore();
    await store.set(
      SESSION_KEY,
      JSON.stringify({
        accountLabel: "dhruv2mars",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        token: "access-1",
        tokenHint: "ghu_...cess"
      })
    );

    const manager = new AuthSessionManager({
      provider: {
        async pollDeviceAuthorization() {
          return {
            intervalSeconds: 5,
            status: "pending"
          };
        },
        async startDeviceAuthorization() {
          return {
            deviceCode: "device-4",
            expiresAt: "2026-03-13T10:10:00.000Z",
            intervalSeconds: 5,
            userCode: "ABCD-EFGH",
            verificationUri: "https://github.com/login/device"
          };
        }
      },
      store
    });

    await expect(manager.getStoredSession()).resolves.toMatchObject({
      token: "access-1"
    });
  });
});
