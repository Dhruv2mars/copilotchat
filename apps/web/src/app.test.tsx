import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  AuthSessionResponse,
  BridgeHealth,
  BridgeStreamEvent,
  ChatStreamRequest,
  ListedModel,
  PairConfirmResponse,
  PairStartResponse
} from "@copilotchat/shared";

import { App } from "./App";
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

describe("App", () => {
  it("shows install help when bridge is offline", async () => {
    const client: BridgeClient = {
      abortChat: vi.fn(),
      connectAuth: vi.fn(),
      confirmPairing: vi.fn(),
      health: vi.fn().mockRejectedValue(new Error("offline")),
      listModels: vi.fn(),
      logout: vi.fn(),
      startPairing: vi.fn(),
      streamChat: vi.fn()
    };

    renderApp(client, "/chat");

    expect(await screen.findByText("Install the bridge")).toBeInTheDocument();
    expect(screen.getByText("macOS")).toBeInTheDocument();
  });

  it("pairs, connects, and streams a chat session", async () => {
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
            auth: {
              accountLabel: "dhruv2mars",
              authenticated: true,
              provider: "github-models",
              tokenHint: "ghp_...7890"
            },
        bridgeVersion: "1.0.0",
        protocolVersion: "2026-03-13",
        status: "ok"
      }
    ];

    const client: BridgeClient = {
      abortChat: vi.fn().mockResolvedValue(undefined),
      connectAuth: vi.fn().mockResolvedValue({
        accountLabel: "dhruv2mars",
        authenticated: true,
        provider: "github-models",
        tokenHint: "ghp_...7890"
      } satisfies AuthSessionResponse),
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
      startPairing: vi.fn().mockResolvedValue({
        code: "ABC123",
        expiresAt: "2026-03-13T10:01:00.000Z",
        origin: "http://localhost:4173",
        pairingId: "pairing-1"
      } satisfies PairStartResponse),
      streamChat: vi.fn().mockImplementation(
        async (
          request: { origin: string; request: ChatStreamRequest; token: string },
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

    await user.type(await screen.findByLabelText("GitHub token"), "ghp_1234567890");
    await user.type(screen.getByLabelText("Organization slug optional"), "acme");
    await user.click(await screen.findByRole("button", { name: "Connect GitHub" }));
    await waitFor(() => {
      expect(client.listModels).toHaveBeenCalled();
    });
    expect(client.connectAuth).toHaveBeenCalledWith({
      organization: "acme",
      token: "ghp_1234567890"
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
            auth: {
              accountLabel: "dhruv2mars",
              authenticated: true,
              provider: "github-models",
              tokenHint: "ghp_...7890"
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
      }
    ];

    const client: BridgeClient = {
      abortChat: vi.fn().mockImplementation(async () => {
        releaseStream();
      }),
      connectAuth: vi.fn(),
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
    expect(screen.getByText("stream interrupted")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => {
      expect(client.abortChat).toHaveBeenCalled();
    });
    expect(await screen.findByText("Generation stopped")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Logout" }));
    expect(await screen.findByRole("button", { name: "Connect GitHub" })).toBeInTheDocument();
  });

  it("shows diagnostics when no pairing token exists", async () => {
    const client: BridgeClient = {
      abortChat: vi.fn(),
      connectAuth: vi.fn(),
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
      startPairing: vi.fn(),
      streamChat: vi.fn()
    };

    renderApp(client, "/diagnostics");

    expect(await screen.findByText("Runtime facts")).toBeInTheDocument();
    expect(screen.getByText("no")).toBeInTheDocument();
  });

  it("surfaces pair, blank-token, and logout failures", async () => {
    const failingPairClient: BridgeClient = {
      abortChat: vi.fn(),
      connectAuth: vi.fn(),
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
    await user.click(await screen.findByRole("button", { name: "Connect GitHub" }));
    expect(await screen.findByText("Paste a GitHub token first")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Logout" }));
    expect(await screen.findByText("bridge_request_failed")).toBeInTheDocument();
  });

  it("surfaces connect, send, and stop failures", async () => {
    const unauthStore = createAppStore();
    unauthStore.getState().setPairingToken("pair-token");

    const connectClient: BridgeClient = {
      abortChat: vi.fn(),
      connectAuth: vi.fn().mockRejectedValue(new Error("auth_failed")),
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
      startPairing: vi.fn(),
      streamChat: vi.fn()
    };

    const user = userEvent.setup();
    const connectView = renderApp(connectClient, "/chat", unauthStore);
    await user.type(await screen.findByLabelText("GitHub token"), "ghp_1234567890");
    await user.click(screen.getByRole("button", { name: "Connect GitHub" }));
    expect(await screen.findByText("auth_failed")).toBeInTheDocument();

    connectView.unmount();
    localStorage.clear();

    const readyStore = createAppStore();
    readyStore.getState().setPairingToken("pair-token");
    readyStore.getState().createSession("session-1");
    readyStore.getState().setDraft("session-1", "Ship it");

    let releaseStream: () => void = () => undefined;
    const readyClient: BridgeClient = {
      abortChat: vi.fn().mockRejectedValue(new Error("abort_failed")),
      connectAuth: vi.fn(),
      confirmPairing: vi.fn(),
      health: vi.fn().mockResolvedValue({
        auth: {
          accountLabel: "dhruv2mars",
          authenticated: true,
          provider: "github-models",
          tokenHint: "ghp_...7890"
        },
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
    expect(await screen.findByText("send_failed")).toBeInTheDocument();

    readyStore.getState().setDraft("session-1", "Try again");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("button", { name: "Stop" });
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByText("abort_failed")).toBeInTheDocument();
    releaseStream();
  });
});
