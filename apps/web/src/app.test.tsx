import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppBootstrapResponse, AppDeviceAuthPollResponse } from "@copilotchat/shared";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { createAppStore } from "./app-store";
import type { BffClient } from "./bff-client";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve
  };
}

function renderApp(client: BffClient, path = "/chat") {
  window.history.pushState({}, "", path);

  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: {
              retry: false
            }
          }
        })
      }
    >
      <App client={client} store={createAppStore()} />
    </QueryClientProvider>
  );
}

describe("App", () => {
  it("runs device auth and completes a chat session", async () => {
    const client: BffClient = {
      authWithCli: vi.fn(),
      bootstrap: vi.fn().mockResolvedValue({
        auth: {
          accountLabel: null,
          authenticated: false,
          provider: "github-models"
        },
        devCliAvailable: false,
        models: []
      }),
      completeChat: vi.fn().mockResolvedValue({
        message: {
          content: "hello test",
          id: "assistant-1",
          role: "assistant"
        },
        usage: {
          inputTokens: 13,
          outputTokens: 3
        }
      }),
      logout: vi.fn(),
      pollDeviceAuth: vi
        .fn()
        .mockResolvedValueOnce({
          pollAfterSeconds: 1,
          status: "pending"
        })
        .mockResolvedValueOnce({
          auth: {
            accountLabel: "Dhruv2mars",
            authenticated: true,
            provider: "github-models",
            tokenHint: "gho_...7890"
          },
          devCliAvailable: false,
          models: [
            {
              id: "openai/gpt-4.1-mini",
              label: "OpenAI GPT-4.1 Mini"
            },
            {
              id: "openai/gpt-5-mini",
              label: "OpenAI GPT-5 Mini"
            }
          ],
          status: "complete"
        }),
      startDeviceAuth: vi.fn().mockResolvedValue({
        deviceCode: "device-1",
        expiresAt: "2026-03-13T18:00:00.000Z",
        intervalSeconds: 1,
        userCode: "ABCD-EFGH",
        verificationUri: "https://github.com/login/device"
      })
    };

    renderApp(client);

    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Connect with GitHub" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Connect with GitHub" }));
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();

    await waitFor(() => {
      expect(client.pollDeviceAuth).toHaveBeenCalledTimes(2);
    });

    await user.selectOptions(await screen.findByLabelText("Model"), "openai/gpt-5-mini");
    await user.type(screen.getByLabelText("Message"), "Ship it");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("hello test")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dhruv2mars" })).toBeInTheDocument();
    expect(screen.getAllByText("3 output tokens")).not.toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "New thread" }));
    await user.type(screen.getByLabelText("Search sessions"), "Ship");
    await user.click(screen.getByRole("button", { name: /Ship it/i }));

    expect(screen.getByText("hello test")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search sessions"));
    await user.type(screen.getByLabelText("Search sessions"), "zzz");
    expect(screen.getByText("No search matches.")).toBeInTheDocument();
  });

  it("supports dev cli auth, diagnostics, and logout", async () => {
    const health = {
      auth: {
        accountLabel: null,
        authenticated: false,
        provider: "github-models" as const
      },
      devCliAvailable: true,
      models: []
    };

    const client: BffClient = {
      authWithCli: vi.fn().mockResolvedValue({
        auth: {
          accountLabel: "Dhruv2mars",
          authenticated: true,
          provider: "github-models",
          tokenHint: "gho_...7890"
        },
        devCliAvailable: true,
        models: [
          {
            id: "openai/gpt-4.1-mini",
            label: "OpenAI GPT-4.1 Mini"
          }
        ]
      }),
      bootstrap: vi.fn().mockResolvedValue(health),
      completeChat: vi.fn(),
      logout: vi.fn().mockResolvedValue(health),
      pollDeviceAuth: vi.fn(),
      startDeviceAuth: vi.fn()
    };

    renderApp(client, "/diagnostics");

    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Session facts" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Chat" }));
    await user.click(await screen.findByRole("button", { name: "Use local GitHub CLI" }));

    expect(await screen.findByRole("heading", { name: "Dhruv2mars" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Diagnostics" }));
    expect(await screen.findByText("yes")).toBeInTheDocument();
    expect(screen.getByText("OpenAI GPT-4.1 Mini")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Logout" }));
    await user.click(screen.getByRole("link", { name: "Chat" }));
    expect(await screen.findByRole("button", { name: "Connect with GitHub" })).toBeInTheDocument();
  });

  it("surfaces chat and auth failures", async () => {
    const client: BffClient = {
      authWithCli: vi.fn().mockRejectedValue(new Error("cli_failed")),
      bootstrap: vi.fn().mockResolvedValue({
        auth: {
          accountLabel: "Dhruv2mars",
          authenticated: true,
          provider: "github-models",
          tokenHint: "gho_...7890"
        },
        devCliAvailable: true,
        models: [
          {
            id: "openai/gpt-4.1-mini",
            label: "OpenAI GPT-4.1 Mini"
          }
        ]
      }),
      completeChat: vi.fn().mockRejectedValue(new Error("chat_failed")),
      logout: vi.fn().mockRejectedValue("logout_failed"),
      pollDeviceAuth: vi.fn(),
      startDeviceAuth: vi.fn().mockRejectedValue(new Error("auth_start_failed"))
    };

    const firstRender = renderApp(client);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Message"), "Ship it");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findAllByText("chat_failed")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Logout" }));
    expect(await screen.findAllByText("logout_failed")).toHaveLength(3);
    firstRender.unmount();

    renderApp(
      {
        ...client,
        bootstrap: vi.fn().mockResolvedValue({
          auth: {
            accountLabel: null,
            authenticated: false,
            provider: "github-models"
          },
          devCliAvailable: true,
          models: []
        })
      },
      "/chat"
    );

    await user.click(await screen.findByRole("button", { name: "Connect with GitHub" }));
    expect(await screen.findAllByText("auth_start_failed")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Use local GitHub CLI" }));
    expect(await screen.findAllByText("cli_failed")).toHaveLength(2);
  });

  it("covers loading, access, and fallback error states", async () => {
    const loadingClient: BffClient = {
      authWithCli: vi.fn(),
      bootstrap: vi.fn(() => new Promise<AppBootstrapResponse>(() => undefined)),
      completeChat: vi.fn(),
      logout: vi.fn(),
      pollDeviceAuth: vi.fn(),
      startDeviceAuth: vi.fn()
    };

    const loadingView = renderApp(loadingClient);
    expect(await screen.findByRole("heading", { name: "Loading session" })).toBeInTheDocument();
    loadingView.unmount();

    const accessClient: BffClient = {
      authWithCli: vi.fn().mockRejectedValue({}),
      bootstrap: vi.fn().mockResolvedValue({
        auth: {
          accountLabel: null,
          authenticated: false,
          provider: "github-models"
        },
        devCliAvailable: true,
        models: []
      }),
      completeChat: vi.fn(),
      logout: vi.fn(),
      pollDeviceAuth: vi.fn().mockResolvedValueOnce({ status: "pending" }).mockImplementation(() => new Promise(() => undefined)),
      startDeviceAuth: vi.fn().mockRejectedValueOnce({}).mockResolvedValueOnce({
        deviceCode: "device-2",
        expiresAt: "2026-03-13T18:05:00.000Z",
        intervalSeconds: 60,
        userCode: "WXYZ-1234",
        verificationUri: "https://github.com/login/device"
      })
    };

    renderApp(accessClient);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Connect with GitHub" }));
    expect(await screen.findAllByText("github_bff_request_failed")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Use local GitHub CLI" }));
    expect(await screen.findAllByText("github_bff_request_failed")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Connect with GitHub" }));
    expect(await screen.findByText("WXYZ-1234")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Access" }));
    expect(await screen.findByRole("heading", { name: "No bridge install required" })).toBeInTheDocument();
    expect(screen.getByText("Local GitHub CLI auth is enabled.")).toBeInTheDocument();
    expect(screen.getByText("Device code active and waiting for approval.")).toBeInTheDocument();

    const noCliClient: BffClient = {
      ...accessClient,
      bootstrap: vi.fn().mockResolvedValue({
        auth: {
          accountLabel: null,
          authenticated: false,
          provider: "github-models"
        },
        devCliAvailable: false,
        models: []
      }),
      startDeviceAuth: vi.fn(),
      pollDeviceAuth: vi.fn()
    };

    renderApp(noCliClient, "/access");
    expect(await screen.findByText("Local GitHub CLI auth is disabled.")).toBeInTheDocument();
    expect(screen.getByText("No device flow request active.")).toBeInTheDocument();
  });

  it("covers auth poll cleanup, auth poll failures, and empty send guards", async () => {
    const deferredPoll = createDeferred<{ pollAfterSeconds: number; status: "pending" }>();
    const cleanupClient: BffClient = {
      authWithCli: vi.fn(),
      bootstrap: vi.fn().mockResolvedValue({
        auth: {
          accountLabel: null,
          authenticated: false,
          provider: "github-models"
        },
        devCliAvailable: false,
        models: []
      }),
      completeChat: vi.fn(),
      logout: vi.fn(),
      pollDeviceAuth: vi.fn(() => deferredPoll.promise),
      startDeviceAuth: vi.fn().mockResolvedValue({
        deviceCode: "device-3",
        expiresAt: "2026-03-13T18:10:00.000Z",
        intervalSeconds: 60,
        userCode: "LMNO-4567",
        verificationUri: "https://github.com/login/device"
      })
    };

    const cleanupView = renderApp(cleanupClient);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Connect with GitHub" }));
    expect(await screen.findByText("LMNO-4567")).toBeInTheDocument();

    cleanupView.unmount();
    await act(async () => {
      deferredPoll.resolve({
        pollAfterSeconds: 60,
        status: "pending"
      });
      await Promise.resolve();
    });

    const pollFailureClient: BffClient = {
      ...cleanupClient,
      pollDeviceAuth: vi.fn().mockRejectedValue(new Error("poll_failed"))
    };

    renderApp(pollFailureClient);
    await user.click(await screen.findByRole("button", { name: "Connect with GitHub" }));
    expect(await screen.findAllByText("poll_failed")).toHaveLength(2);

    const sendGuardClient: BffClient = {
      authWithCli: vi.fn(),
      bootstrap: vi.fn().mockResolvedValue({
        auth: {
          accountLabel: "Dhruv2mars",
          authenticated: true,
          provider: "github-models",
          tokenHint: "gho_...7890"
        },
        devCliAvailable: false,
        models: [
          {
            id: "openai/gpt-4.1-mini",
            label: "OpenAI GPT-4.1 Mini"
          }
        ]
      }),
      completeChat: vi.fn(),
      logout: vi.fn(),
      pollDeviceAuth: vi.fn(),
      startDeviceAuth: vi.fn()
    };

    renderApp(sendGuardClient);
    await user.click(await screen.findByRole("button", { name: "Send" }));
    expect(sendGuardClient.completeChat).not.toHaveBeenCalled();
  });

  it("clears device auth state after successful cli auth", async () => {
    const client: BffClient = {
      authWithCli: vi.fn().mockResolvedValue({
        auth: {
          accountLabel: "Dhruv2mars",
          authenticated: true,
          provider: "github-models",
          tokenHint: "gho_...7890"
        },
        devCliAvailable: true,
        models: [
          {
            id: "openai/gpt-4.1-mini",
            label: "OpenAI GPT-4.1 Mini"
          }
        ]
      }),
      bootstrap: vi.fn().mockResolvedValue({
        auth: {
          accountLabel: null,
          authenticated: false,
          provider: "github-models"
        },
        devCliAvailable: true,
        models: []
      }),
      completeChat: vi.fn(),
      logout: vi.fn(),
      pollDeviceAuth: vi.fn(() => new Promise<AppDeviceAuthPollResponse>(() => undefined)),
      startDeviceAuth: vi.fn().mockResolvedValue({
        deviceCode: "device-4",
        expiresAt: "2026-03-13T18:15:00.000Z",
        intervalSeconds: 60,
        userCode: "PQRS-1111",
        verificationUri: "https://github.com/login/device"
      })
    };

    renderApp(client);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Connect with GitHub" }));
    expect(await screen.findByText("PQRS-1111")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use local GitHub CLI" }));
    expect(await screen.findByRole("heading", { name: "Dhruv2mars" })).toBeInTheDocument();
    expect(screen.queryByText("PQRS-1111")).toBeNull();
    expect(screen.queryByText("Waiting for GitHub approval")).toBeNull();
    expect(screen.getAllByText("GitHub CLI session loaded")).not.toHaveLength(0);
  });
});
