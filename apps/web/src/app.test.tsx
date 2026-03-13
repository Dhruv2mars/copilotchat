import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AuthDevicePollResponse,
  AuthDeviceStartResponse,
  AuthSessionResponse,
  BridgeHealth,
  BridgeStreamEvent,
  ChatStreamRequest,
  ListedModel,
  PairConfirmResponse,
  PairStartResponse
} from "@copilotchat/shared";

import { App, ChatRoute, formatRuntimeLabel, readErrorMessage, runtimeSummary } from "./App";
import { createAppStore } from "./app-store";
import type { BridgeClient } from "./bridge-client";

function renderApp(client: BridgeClient, path = "/", store = createAppStore()) {
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
      <App client={client} store={store} />
    </QueryClientProvider>
  );
}

function createChallenge(overrides?: Partial<AuthDeviceStartResponse>): AuthDeviceStartResponse {
  return {
    deviceCode: "device-1",
    expiresAt: "2026-03-13T10:10:00.000Z",
    intervalSeconds: 5,
    organization: "acme",
    userCode: "ABCD-EFGH",
    verificationUri: "https://github.com/login/device",
    ...overrides
  };
}

function createAuthSession(overrides?: Partial<AuthSessionResponse>): AuthSessionResponse {
  return {
    accountLabel: "dhruv2mars",
    authenticated: true,
    organization: "acme",
    provider: "github-models",
    tokenHint: "ghu_...7890",
    ...overrides
  };
}

function createPollResponse(overrides?: Partial<AuthDevicePollResponse>): AuthDevicePollResponse {
  return {
    accountLabel: null,
    authenticated: false,
    organization: "acme",
    pollAfterSeconds: 5,
    provider: "github-models",
    status: "pending",
    ...overrides
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("App", () => {
  it("covers runtime and error helper branches", () => {
    expect(formatRuntimeLabel("ready")).toBe("Ready");
    expect(formatRuntimeLabel("offline")).toBe("Offline");
    expect(formatRuntimeLabel("unpaired")).toBe("Unpaired");
    expect(formatRuntimeLabel("unauthenticated")).toBe("Auth required");

    expect(runtimeSummary("ready")).toBe("Inference path armed.");
    expect(runtimeSummary("offline")).toBe("Bridge not reachable on localhost.");
    expect(runtimeSummary("unpaired")).toBe("Pairing required before protected calls.");
    expect(runtimeSummary("unauthenticated")).toBe("GitHub auth still pending in bridge.");

    expect(readErrorMessage(new Error("boom"))).toBe("boom");
    expect(readErrorMessage("bad")).toBe("bad");
    expect(readErrorMessage({ nope: true })).toBe("bridge_request_failed");
  });

  it("shows install help when bridge is offline", async () => {
    const client: BridgeClient = {
      abortChat: vi.fn(),
      confirmPairing: vi.fn(),
      health: vi.fn().mockRejectedValue(new Error("offline")),
      listModels: vi.fn(),
      logout: vi.fn(),
      pollDeviceAuth: vi.fn(),
      startDeviceAuth: vi.fn(),
      startPairing: vi.fn(),
      streamChat: vi.fn()
    };

    renderApp(client, "/chat");

    expect(await screen.findByText("Install the bridge")).toBeInTheDocument();
    expect(screen.getByText("macOS")).toBeInTheDocument();
  });

  it("marks install nav active and shows no-match session copy", async () => {
    const store = createAppStore();
    store.getState().setPairingToken("pair-token");
    store.getState().createSession("session-1");

    const client: BridgeClient = {
      abortChat: vi.fn(),
      confirmPairing: vi.fn(),
      health: vi.fn().mockResolvedValue({
        auth: createAuthSession(),
        bridgeVersion: "1.0.0",
        protocolVersion: "2026-03-13",
        status: "ok"
      }),
      listModels: vi.fn().mockResolvedValue([
        {
          id: "gpt-4.1",
          label: "GPT-4.1"
        }
      ]),
      logout: vi.fn(),
      pollDeviceAuth: vi.fn(),
      startDeviceAuth: vi.fn(),
      startPairing: vi.fn(),
      streamChat: vi.fn()
    };

    renderApp(client, "/install", store);

    expect(await screen.findByRole("link", { name: "Install" })).toHaveClass("active");

    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Chat" }));
    await user.type(await screen.findByLabelText("Search sessions"), "zzz");
    expect(screen.getByText("No search matches.")).toBeInTheDocument();
  });

  it("pairs, runs github device auth, and streams a chat session", async () => {
    const healthQueue: BridgeHealth[] = [
      {
        auth: {
          accountLabel: null,
          authenticated: false,
          provider: "github-models"
        },
        bridgeVersion: "1.0.0",
        protocolVersion: "2026-03-13",
        status: "ok"
      },
      {
        auth: {
          accountLabel: null,
          authenticated: false,
          provider: "github-models"
        },
        bridgeVersion: "1.0.0",
        protocolVersion: "2026-03-13",
        status: "ok"
      },
      {
        auth: createAuthSession(),
        bridgeVersion: "1.0.0",
        protocolVersion: "2026-03-13",
        status: "ok"
      }
    ];

    const client: BridgeClient = {
      abortChat: vi.fn().mockResolvedValue(undefined),
      confirmPairing: vi.fn().mockResolvedValue({
        pairedAt: "2026-03-13T10:00:00.000Z",
        token: "pair-token"
      } satisfies PairConfirmResponse),
      health: vi.fn().mockImplementation(async () => healthQueue.shift() ?? healthQueue.at(-1)),
      listModels: vi.fn().mockResolvedValue([
        {
          id: "gpt-4.1",
          label: "GPT-4.1"
        },
        {
          id: "gpt-4.5",
          label: "GPT-4.5"
        }
      ] satisfies ListedModel[]),
      logout: vi.fn().mockResolvedValue({
        accountLabel: null,
        authenticated: false,
        provider: "github-models"
      }),
      pollDeviceAuth: vi.fn().mockResolvedValue(
        createPollResponse({
          ...createAuthSession(),
          authenticated: true,
          status: "complete"
        })
      ),
      startDeviceAuth: vi.fn().mockResolvedValue(createChallenge()),
      startPairing: vi.fn().mockResolvedValue({
        code: "ABC123",
        expiresAt: "2026-03-13T10:01:00.000Z",
        origin: "http://localhost:4173",
        pairingId: "pairing-1"
      } satisfies PairStartResponse),
      streamChat: vi.fn().mockImplementation(
        async (
          _request: { origin: string; request: ChatStreamRequest; token: string },
          onEvent: (event: BridgeStreamEvent) => void
        ) => {
          onEvent({
            data: "Bridge says hi",
            type: "assistant_delta"
          });
          onEvent({
            type: "assistant_done",
            usage: {
              inputTokens: 1,
              outputTokens: 3
            }
          });
        }
      )
    };

    renderApp(client, "/chat");

    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Pair bridge" }));
    await waitFor(() => {
      expect(client.confirmPairing).toHaveBeenCalled();
    });

    await user.type(await screen.findByLabelText("Organization slug optional"), "acme");
    await user.click(await screen.findByRole("button", { name: "Connect with GitHub" }));

    expect(client.startDeviceAuth).toHaveBeenCalledWith({
      openInBrowser: true,
      organization: "acme",
      origin: "http://localhost:3000",
      token: "pair-token"
    });
    await waitFor(() => {
      expect(client.pollDeviceAuth).toHaveBeenCalledTimes(1);
      expect(client.listModels).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(client.streamChat).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByRole("combobox"), "gpt-4.5");
    await user.type(await screen.findByPlaceholderText("Ask through your local Copilot bridge"), "Ship it");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Bridge says hi")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "dhruv2mars" })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("gpt-4.5");
    await user.type(screen.getByLabelText("Search sessions"), "Ship");
    await user.clear(screen.getByLabelText("Search sessions"));
    await user.click(screen.getByRole("button", { name: "New thread" }));
    await user.click(screen.getByRole("button", { name: /Ship it/ }));
  });

  it("shows diagnostics, stops generation, surfaces stream errors, and logs out", async () => {
    const store = createAppStore();
    store.getState().setPairingToken("pair-token");
    store.getState().createSession("session-1");
    store.getState().setDraft("session-1", "Stop now");

    let releaseStream: () => void = () => undefined;
    const healthQueue: BridgeHealth[] = [
      {
        auth: createAuthSession(),
        bridgeVersion: "1.0.0",
        protocolVersion: "2026-03-13",
        status: "ok"
      },
      {
        auth: {
          accountLabel: null,
          authenticated: false,
          provider: "github-models"
        },
        bridgeVersion: "1.0.0",
        protocolVersion: "2026-03-13",
        status: "ok"
      }
    ];

    const client: BridgeClient = {
      abortChat: vi.fn().mockImplementation(async () => {
        releaseStream();
      }),
      confirmPairing: vi.fn(),
      health: vi.fn().mockImplementation(async () => healthQueue.shift() ?? healthQueue.at(-1)),
      listModels: vi.fn().mockResolvedValue([
        {
          id: "gpt-4.1",
          label: "GPT-4.1"
        }
      ]),
      logout: vi.fn().mockResolvedValue({
        accountLabel: null,
        authenticated: false,
        provider: "github-models"
      }),
      pollDeviceAuth: vi.fn(),
      startDeviceAuth: vi.fn(),
      startPairing: vi.fn(),
      streamChat: vi.fn().mockImplementation(
        async (
          _request: { origin: string; request: ChatStreamRequest; token: string },
          onEvent: (event: BridgeStreamEvent) => void
        ) => {
          onEvent({
            data: "partial",
            type: "assistant_delta"
          });
          onEvent({
            message: "stream interrupted",
            type: "assistant_error"
          });

          await new Promise<void>((resolve) => {
            releaseStream = resolve;
          });
        }
      )
    };

    renderApp(client, "/diagnostics", store);

    expect(await screen.findByText("Runtime facts")).toBeInTheDocument();
    expect(screen.getByText("yes")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Chat" }));
    await user.click(await screen.findByRole("button", { name: "Send" }));
    expect(await screen.findByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(await screen.findByText("partial")).toBeInTheDocument();
    expect(await screen.findAllByText("stream interrupted")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => {
      expect(client.abortChat).toHaveBeenCalled();
    });
    expect(await screen.findAllByText("Generation stopped")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Logout" }));
    expect(await screen.findByRole("button", { name: "Connect with GitHub" })).toBeInTheDocument();
  });

  it("shows diagnostics when no pairing token exists", async () => {
    const client: BridgeClient = {
      abortChat: vi.fn(),
      confirmPairing: vi.fn(),
      health: vi.fn().mockResolvedValue({
        auth: {
          accountLabel: null,
          authenticated: false,
          provider: "github-models"
        },
        bridgeVersion: "1.0.0",
        protocolVersion: "2026-03-13",
        status: "ok"
      }),
      listModels: vi.fn(),
      logout: vi.fn(),
      pollDeviceAuth: vi.fn(),
      startDeviceAuth: vi.fn(),
      startPairing: vi.fn(),
      streamChat: vi.fn()
    };

    renderApp(client, "/diagnostics");

    expect(await screen.findByText("Runtime facts")).toBeInTheDocument();
    expect(screen.getByText("no")).toBeInTheDocument();
  });

  it("shows empty ready thread state", async () => {
    const store = createAppStore();
    store.getState().setPairingToken("pair-token");
    store.getState().createSession("session-1");

    const client: BridgeClient = {
      abortChat: vi.fn(),
      confirmPairing: vi.fn(),
      health: vi.fn().mockResolvedValue({
        auth: createAuthSession(),
        bridgeVersion: "1.0.0",
        protocolVersion: "2026-03-13",
        status: "ok"
      }),
      listModels: vi.fn().mockResolvedValue([
        {
          id: "gpt-4.1",
          label: "GPT-4.1"
        }
      ]),
      logout: vi.fn(),
      pollDeviceAuth: vi.fn(),
      startDeviceAuth: vi.fn(),
      startPairing: vi.fn(),
      streamChat: vi.fn()
    };

    renderApp(client, "/chat", store);

    expect(await screen.findByRole("heading", { name: "Ask through your local Copilot bridge" })).toBeInTheDocument();
    expect(screen.getByText("Ready for chat")).toBeInTheDocument();
  });

  it("shows ready state before first session hydrates", async () => {
    const store = createAppStore();
    store.getState().setPairingToken("pair-token");

    const client: BridgeClient = {
      abortChat: vi.fn(),
      confirmPairing: vi.fn(),
      health: vi.fn().mockResolvedValue({
        auth: createAuthSession(),
        bridgeVersion: "1.0.0",
        protocolVersion: "2026-03-13",
        status: "ok"
      }),
      listModels: vi.fn().mockResolvedValue([
        {
          id: "gpt-4.1",
          label: "GPT-4.1"
        }
      ]),
      logout: vi.fn(),
      pollDeviceAuth: vi.fn(),
      startDeviceAuth: vi.fn(),
      startPairing: vi.fn(),
      streamChat: vi.fn()
    };

    renderApp(client, "/chat", store);

    expect(await screen.findByRole("heading", { name: "Ask through your local Copilot bridge" })).toBeInTheDocument();
  });

  it("renders empty ready state when active session is null", () => {
    render(
      <ChatRoute
        activeSession={null}
        accountLabel="dhruv2mars"
        authChallenge={null}
        models={[]}
        organizationDraft=""
        pairBridge={vi.fn()}
        pendingRequestId={null}
        runtime="ready"
        selectedModel=""
        sendMessage={vi.fn()}
        setDraft={vi.fn()}
        setOrganizationDraft={vi.fn()}
        setSelectedModel={vi.fn()}
        startGitHubAuth={vi.fn()}
        statusNote=""
        stopStreaming={null}
      />
    );

    expect(screen.getByRole("heading", { name: "Ask through your local Copilot bridge" })).toBeInTheDocument();
  });

  it("surfaces pair, auth-start, and logout failures", async () => {
    const failingPairClient: BridgeClient = {
      abortChat: vi.fn(),
      confirmPairing: vi.fn(),
      health: vi.fn().mockResolvedValue({
        auth: {
          accountLabel: null,
          authenticated: false,
          provider: "github-models"
        },
        bridgeVersion: "1.0.0",
        protocolVersion: "2026-03-13",
        status: "ok"
      }),
      listModels: vi.fn(),
      logout: vi.fn().mockRejectedValue("bad"),
      pollDeviceAuth: vi.fn(),
      startDeviceAuth: vi.fn().mockRejectedValue(new Error("auth_failed")),
      startPairing: vi.fn().mockRejectedValue(new Error("pair_failed")),
      streamChat: vi.fn()
    };

    const pairView = renderApp(failingPairClient, "/chat");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Pair bridge" }));
    await waitFor(() => {
      expect(failingPairClient.startPairing).toHaveBeenCalled();
    });

    pairView.unmount();
    localStorage.clear();
    const store = createAppStore();
    store.getState().setPairingToken("pair-token");
    renderApp(failingPairClient, "/chat", store);
    await user.click(await screen.findByRole("button", { name: "Connect with GitHub" }));
    expect(await screen.findAllByText("auth_failed")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Logout" }));
    expect(await screen.findAllByText("bad")).toHaveLength(2);
  });

  it("surfaces auth-poll, send, and stop failures", async () => {
    const unauthStore = createAppStore();
    unauthStore.getState().setPairingToken("pair-token");

    const connectClient: BridgeClient = {
      abortChat: vi.fn(),
      confirmPairing: vi.fn(),
      health: vi.fn().mockResolvedValue({
        auth: {
          accountLabel: null,
          authenticated: false,
          provider: "github-models"
        },
        bridgeVersion: "1.0.0",
        protocolVersion: "2026-03-13",
        status: "ok"
      }),
      listModels: vi.fn(),
      logout: vi.fn(),
      pollDeviceAuth: vi.fn().mockRejectedValue(new Error("auth_poll_failed")),
      startDeviceAuth: vi.fn().mockResolvedValue(createChallenge({ intervalSeconds: 1 })),
      startPairing: vi.fn(),
      streamChat: vi.fn()
    };

    const user = userEvent.setup();
    const connectView = renderApp(connectClient, "/chat", unauthStore);
    await user.click(await screen.findByRole("button", { name: "Connect with GitHub" }));
    expect(await screen.findAllByText("auth_poll_failed")).toHaveLength(2);

    connectView.unmount();
    localStorage.clear();

    const readyStore = createAppStore();
    readyStore.getState().setPairingToken("pair-token");
    readyStore.getState().createSession("session-1");
    readyStore.getState().setDraft("session-1", "Ship it");

    let releaseStream: () => void = () => undefined;
    const readyClient: BridgeClient = {
      abortChat: vi.fn().mockRejectedValue(new Error("abort_failed")),
      confirmPairing: vi.fn(),
      health: vi.fn().mockResolvedValue({
        auth: createAuthSession(),
        bridgeVersion: "1.0.0",
        protocolVersion: "2026-03-13",
        status: "ok"
      }),
      listModels: vi.fn().mockResolvedValue([
        {
          id: "gpt-4.1",
          label: "GPT-4.1"
        }
      ]),
      logout: vi.fn(),
      pollDeviceAuth: vi.fn(),
      startDeviceAuth: vi.fn(),
      startPairing: vi.fn(),
      streamChat: vi
        .fn()
        .mockRejectedValueOnce(new Error("send_failed"))
        .mockImplementationOnce(
          async (
            _request: { origin: string; request: ChatStreamRequest; token: string },
            onEvent: (event: BridgeStreamEvent) => void
          ) => {
            onEvent({
              data: "partial",
              type: "assistant_delta"
            });

            await new Promise<void>((resolve) => {
              releaseStream = resolve;
            });
          }
        )
    };

    renderApp(readyClient, "/chat", readyStore);
    await user.click(await screen.findByRole("button", { name: "Send" }));
    expect(await screen.findAllByText("send_failed")).toHaveLength(3);

    readyStore.getState().setDraft("session-1", "Try again");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("button", { name: "Stop" });
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findAllByText("abort_failed")).toHaveLength(3);
    releaseStream();
  });

  it("cleans up pending auth polling on unmount", async () => {
    const store = createAppStore();
    store.getState().setPairingToken("pair-token");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    const client: BridgeClient = {
      abortChat: vi.fn(),
      confirmPairing: vi.fn(),
      health: vi.fn().mockResolvedValue({
        auth: {
          accountLabel: null,
          authenticated: false,
          provider: "github-models"
        },
        bridgeVersion: "1.0.0",
        protocolVersion: "2026-03-13",
        status: "ok"
      }),
      listModels: vi.fn(),
      logout: vi.fn(),
      pollDeviceAuth: vi.fn().mockResolvedValue(createPollResponse({ pollAfterSeconds: 60 })),
      startDeviceAuth: vi.fn().mockResolvedValue(createChallenge({ intervalSeconds: 60 })),
      startPairing: vi.fn(),
      streamChat: vi.fn()
    };

    const view = renderApp(client, "/chat", store);
    fireEvent.click(await screen.findByRole("button", { name: "Connect with GitHub" }));
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    await waitFor(() => {
      expect(client.pollDeviceAuth).toHaveBeenCalledTimes(1);
    });

    view.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

});
