import { describe, expect, it, vi } from "vitest";

import { GitHubCopilotClient } from "../src/github-copilot-client";
import { GitHubDeviceFlowClient } from "../src/github-device-flow-client";

describe("GitHubDeviceFlowClient", () => {
  it("starts device auth and opens the browser", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          device_code: "device-1",
          expires_in: 900,
          interval: 5,
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device"
        })
      )
    );
    const openUrl = vi.fn().mockResolvedValue(undefined);

    const client = new GitHubDeviceFlowClient({
      clientId: "client-1",
      fetchFn,
      copilotClient: new GitHubCopilotClient({
        fetchFn: vi.fn()
      }),
      openUrl,
      scope: "read:user"
    });

    await expect(
      client.startDeviceAuthorization({
        openInBrowser: true,
        organization: "acme"
      })
    ).resolves.toMatchObject({
      deviceCode: "device-1",
      organization: "acme",
      userCode: "ABCD-EFGH"
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://github.com/login/device/code",
      expect.objectContaining({
        body: expect.any(URLSearchParams)
      })
    );
    expect(openUrl).toHaveBeenCalledWith("https://github.com/login/device");
  });

  it("skips browser open when disabled and handles slow_down responses", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: "device-2",
            user_code: "WXYZ-0000",
            verification_uri: "https://github.com/login/device"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "slow_down"
          })
        )
      );
    const openUrl = vi.fn().mockResolvedValue(undefined);

    const client = new GitHubDeviceFlowClient({
      clientId: "client-1",
      fetchFn,
      copilotClient: new GitHubCopilotClient({
        fetchFn: vi.fn()
      }),
      openUrl
    });

    await expect(
      client.startDeviceAuthorization({
        openInBrowser: false
      })
    ).resolves.toMatchObject({
      expiresAt: expect.any(String),
      intervalSeconds: 5
    });
    expect(openUrl).not.toHaveBeenCalled();

    await expect(
      client.pollDeviceAuthorization({
        deviceCode: "device-2"
      })
    ).resolves.toEqual({
      intervalSeconds: 5,
      status: "pending"
    });
  });

  it("polls pending auth, completes auth, and refreshes stored sessions", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "authorization_pending",
            interval: 7
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "ghu_access_1",
            expires_in: 300,
            refresh_token: "refresh-1",
            refresh_token_expires_in: 600
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "ghu_access_2",
            expires_in: 300,
            refresh_token: "refresh-2",
            refresh_token_expires_in: 600
          })
        )
      );
    const copilotClient = {
      connect: vi
        .fn()
        .mockResolvedValueOnce({
          accountLabel: "dhruv2mars",
          organization: "acme",
          token: "ghu_access_1",
          tokenHint: "ghu_...ss_1"
        })
        .mockResolvedValueOnce({
          accountLabel: "dhruv2mars",
          organization: "acme",
          token: "ghu_access_2",
          tokenHint: "ghu_...ss_2"
        })
    } as unknown as GitHubCopilotClient;

    const client = new GitHubDeviceFlowClient({
      clientId: "client-1",
      fetchFn,
      copilotClient
    });

    await expect(
      client.pollDeviceAuthorization({
        deviceCode: "device-1",
        organization: "acme"
      })
    ).resolves.toEqual({
      intervalSeconds: 7,
      status: "pending"
    });

    await expect(
      client.pollDeviceAuthorization({
        deviceCode: "device-1",
        organization: "acme"
      })
    ).resolves.toMatchObject({
      session: {
        accountLabel: "dhruv2mars",
        organization: "acme",
        refreshToken: "refresh-1",
        token: "ghu_access_1"
      },
      status: "complete"
    });

    await expect(
      client.refresh({
        accountLabel: "dhruv2mars",
        organization: "acme",
        refreshToken: "refresh-1",
        token: "ghu_access_1",
        tokenHint: "ghu_...ss_1"
      })
    ).resolves.toMatchObject({
      refreshToken: "refresh-2",
      token: "ghu_access_2"
    });
  });

  it("maps missing config, expired refresh, and failed token exchanges", async () => {
    const client = new GitHubDeviceFlowClient({
      clientId: "",
      fetchFn: vi.fn(),
      copilotClient: new GitHubCopilotClient({
        fetchFn: vi.fn()
      })
    });

    await expect(client.startDeviceAuthorization({})).rejects.toThrow("github_auth_not_configured");

    const failingClient = new GitHubDeviceFlowClient({
      clientId: "client-1",
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: "expired_token"
            })
          )
        ),
      copilotClient: new GitHubCopilotClient({
        fetchFn: vi.fn()
      })
    });

    await expect(failingClient.startDeviceAuthorization({})).rejects.toThrow("github_device_code_failed");
    await expect(
      failingClient.pollDeviceAuthorization({
        deviceCode: "device-1"
      })
    ).rejects.toThrow("expired_token");
    await expect(
      failingClient.refresh({
        accountLabel: "dhruv2mars",
        token: "ghu_access_1",
        tokenHint: "ghu_...ss_1"
      })
    ).rejects.toThrow("auth_refresh_unavailable");

    await expect(
      failingClient.refresh({
        accountLabel: "dhruv2mars",
        refreshToken: "refresh-1",
        refreshTokenExpiresAt: "1970-01-01T00:00:00.000Z",
        token: "ghu_access_1",
        tokenHint: "ghu_...ss_1"
      })
    ).rejects.toThrow("auth_refresh_expired");
  });

  it("maps refresh token errors and leaves optional expiries undefined", async () => {
    const copilotClient = {
      connect: vi.fn().mockResolvedValue({
        accountLabel: "dhruv2mars",
        token: "ghu_access_3",
        tokenHint: "ghu_...ss_3"
      })
    } as unknown as GitHubCopilotClient;

    const refreshFailureClient = new GitHubDeviceFlowClient({
      clientId: "client-1",
      fetchFn: vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({}))),
      copilotClient
    });

    await expect(
      refreshFailureClient.pollDeviceAuthorization({
        deviceCode: "device-3"
      })
    ).rejects.toThrow("github_auth_failed");

    await expect(
      refreshFailureClient.refresh({
        accountLabel: "dhruv2mars",
        refreshToken: "refresh-3",
        token: "ghu_access_2",
        tokenHint: "ghu_...ss_2"
      })
    ).rejects.toThrow("github_auth_refresh_failed");

    const successClient = new GitHubDeviceFlowClient({
      clientId: "client-1",
      fetchFn: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "ghu_access_3"
          })
        )
      ),
      copilotClient
    });

    await expect(
      successClient.pollDeviceAuthorization({
        deviceCode: "device-4"
      })
    ).resolves.toMatchObject({
      session: {
        expiresAt: undefined,
        refreshTokenExpiresAt: undefined,
        token: "ghu_access_3"
      },
      status: "complete"
    });
  });

  it("uses global fetch by default and maps empty poll payloads", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "ghu_access_4"
          })
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}))) as unknown as typeof fetch;

    const client = new GitHubDeviceFlowClient({
      clientId: "client-1",
      copilotClient: {
        connect: vi.fn().mockResolvedValue({
          accountLabel: "dhruv2mars",
          token: "ghu_access_4",
          tokenHint: "ghu_...ss_4"
        })
      } as unknown as GitHubCopilotClient
    });

    await expect(
      client.pollDeviceAuthorization({
        deviceCode: "device-5"
      })
    ).resolves.toMatchObject({
      session: {
        token: "ghu_access_4"
      },
      status: "complete"
    });

    await expect(
      client.pollDeviceAuthorization({
        deviceCode: "device-6"
      })
    ).rejects.toThrow("github_auth_failed");

    globalThis.fetch = originalFetch;
  });
});
