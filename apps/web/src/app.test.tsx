import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { createAppStore } from "./app-store";
import type { BridgeBootstrap, BridgeClient } from "./bridge-client";

function renderApp(client: BridgeClient, path = "/chat") {
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

function createOfflineBootstrap(): BridgeBootstrap {
  return {
    auth: {
      accountLabel: null,
      authenticated: false,
      provider: "github-copilot"
    },
    bridge: {
      paired: false,
      reachable: false
    },
    models: []
  };
}

function createSignedOutBootstrap(): BridgeBootstrap {
  return {
    auth: {
      accountLabel: null,
      authenticated: false,
      provider: "github-copilot"
    },
    bridge: {
      bridgeVersion: "2.0.0",
      paired: true,
      protocolVersion: "2026-03-13",
      reachable: true
    },
    models: []
  };
}

function createReadyBootstrap(): BridgeBootstrap {
  return {
    auth: {
      accountLabel: "dhruv2mars",
      authenticated: true,
      provider: "github-copilot",
      tokenHint: "ghu_...7890"
    },
    bridge: {
      bridgeVersion: "2.0.0",
      paired: true,
      protocolVersion: "2026-03-13",
      reachable: true
    },
    models: [
      {
        id: "openai/gpt-5-mini",
        label: "OpenAI GPT-5 mini"
      },
      {
        id: "openai/gpt-4.1",
        label: "OpenAI GPT-4.1"
      }
    ]
  };
}

function createBaseClient(overrides: Partial<BridgeClient> = {}): BridgeClient {
  return {
    bootstrap: vi.fn().mockResolvedValue(createSignedOutBootstrap()),
    logout: vi.fn().mockResolvedValue(createSignedOutBootstrap()),
    pollDeviceAuth: vi.fn(),
    startDeviceAuth: vi.fn(),
    streamChat: vi.fn(),
    ...overrides
  };
}

describe("App", () => {
  it("shows bridge offline guidance", async () => {
    renderApp(
      createBaseClient({
        bootstrap: vi.fn().mockResolvedValue(createOfflineBootstrap())
      })
    );

    expect(await screen.findByRole("heading", { name: "Bridge offline" })).toBeInTheDocument();
    expect(screen.getByText("Start the local bridge on your machine to continue.")).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("connects GitHub Copilot, streams chat, supports diagnostics, and logs out", async () => {
    const client = createBaseClient({
      bootstrap: vi.fn().mockResolvedValue(createSignedOutBootstrap()),
      logout: vi.fn().mockResolvedValue(createSignedOutBootstrap()),
      pollDeviceAuth: vi
        .fn()
        .mockResolvedValueOnce({
          pollAfterSeconds: 0,
          status: "pending"
        })
        .mockResolvedValueOnce({
          ...createReadyBootstrap(),
          status: "complete"
        }),
      startDeviceAuth: vi.fn().mockResolvedValue({
        deviceCode: "device-1",
        expiresAt: "2026-03-14T10:10:00.000Z",
        intervalSeconds: 0,
        userCode: "ABCD-EFGH",
        verificationUri: "https://github.com/login/device"
      }),
      streamChat: vi.fn().mockImplementation(async ({ onEvent, request }) => {
        onEvent({
          data: "hello ",
          type: "assistant_delta"
        });
        onEvent({
          data: "world",
          type: "assistant_delta"
        });
        onEvent({
          type: "assistant_done",
          usage: {
            inputTokens: request.messages.length,
            outputTokens: 2
          }
        });

        return {
          inputTokens: request.messages.length,
          outputTokens: 2
        };
      })
    });

    renderApp(client);

    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Connect GitHub Copilot" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Connect GitHub Copilot" }));

    // wait for ready state — model selector trigger should appear
    expect(await screen.findByLabelText("Select model")).toBeInTheDocument();

    // open model selector popover, search and select a model
    await user.click(screen.getByLabelText("Select model"));
    await user.type(screen.getByLabelText("Search models"), "4.1");
    await user.click(screen.getByRole("option", { name: /OpenAI GPT-4.1/i }));

    // type message and send
    await user.type(screen.getByLabelText("Message"), "Ship it");
    await user.click(screen.getByLabelText("Send"));

    expect(client.streamChat).toHaveBeenCalledWith({
      onEvent: expect.any(Function),
      request: {
        messages: [
          {
            content: "Ship it",
            id: expect.any(String),
            role: "user"
          }
        ],
        modelId: "openai/gpt-4.1",
        requestId: expect.any(String)
      },
      signal: expect.any(AbortSignal)
    });
    expect(await screen.findByText("hello world")).toBeInTheDocument();
    expect(screen.getAllByText("2 output tokens")).not.toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "New thread" }));
    await user.type(screen.getByLabelText("Search sessions"), "Ship");
    await user.click(screen.getByRole("button", { name: /Ship it/i }));
    expect(screen.getByText("hello world")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search sessions"));
    await user.type(screen.getByLabelText("Search sessions"), "zzz");
    expect(screen.getByText("No search matches.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search sessions"));

    await user.click(screen.getByRole("link", { name: "Diagnostics" }));
    expect(await screen.findByRole("heading", { name: "Bridge facts" })).toBeInTheDocument();
    expect(screen.getByText("2.0.0")).toBeInTheDocument();
    expect(screen.getByText("OpenAI GPT-5 mini, OpenAI GPT-4.1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Logout" }));
    await user.click(screen.getByRole("link", { name: "Chat" }));
    expect(await screen.findByRole("heading", { name: "Connect GitHub Copilot" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Logout" })).toBeNull();
  });

  it("surfaces auth and chat failures", async () => {
    const client = createBaseClient({
      bootstrap: vi.fn().mockResolvedValue(createSignedOutBootstrap()),
      pollDeviceAuth: vi.fn().mockRejectedValue(new Error("auth_flow_not_found")),
      startDeviceAuth: vi.fn().mockResolvedValue({
        deviceCode: "device-1",
        expiresAt: "2026-03-14T10:10:00.000Z",
        intervalSeconds: 0,
        userCode: "ABCD-EFGH",
        verificationUri: "https://github.com/login/device"
      }),
      streamChat: vi.fn().mockRejectedValue(new Error("stream_failed"))
    });

    const firstView = renderApp(client);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Connect GitHub Copilot" }));
    expect(
      await screen.findAllByText("Bridge auth flow expired. Start sign-in again.")
    ).not.toHaveLength(0);
    firstView.unmount();

    const secondView = renderApp(
      createBaseClient({
        bootstrap: vi.fn().mockResolvedValue(createReadyBootstrap()),
        streamChat: vi.fn().mockRejectedValue({})
      })
    );

    await user.type(await screen.findByLabelText("Message"), "Ship it");
    await user.click(screen.getByLabelText("Send"));
    expect(await screen.findAllByText("bridge_request_failed")).not.toHaveLength(0);
    secondView.unmount();

    const thirdView = renderApp(
      createBaseClient({
        bootstrap: vi.fn().mockResolvedValue(createReadyBootstrap()),
        streamChat: vi.fn().mockRejectedValue("plain_string_error")
      })
    );

    await user.type(await screen.findByLabelText("Message"), "Ship it again");
    await user.click(screen.getByLabelText("Send"));
    expect(await screen.findAllByText("plain_string_error")).not.toHaveLength(0);
    thirdView.unmount();

    renderApp(
      createBaseClient({
        bootstrap: vi.fn().mockResolvedValue(createReadyBootstrap()),
        streamChat: vi.fn().mockRejectedValue(new Error("bridge_request_failed"))
      })
    );

    await user.type(await screen.findByLabelText("Message"), "Ship it final");
    await user.click(screen.getByLabelText("Send"));
    expect(await screen.findAllByText("bridge_request_failed")).not.toHaveLength(0);
  });

  it("guards empty sends and surfaces logout failure", async () => {
    const client = createBaseClient({
      bootstrap: vi.fn().mockResolvedValue(createReadyBootstrap()),
      logout: vi.fn().mockRejectedValue(new Error("logout_failed"))
    });

    renderApp(client);

    const user = userEvent.setup();
    await screen.findByLabelText("Select model");

    await user.click(screen.getByLabelText("Send"));
    expect(client.streamChat).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Logout" }));
    expect(await screen.findAllByText("logout_failed")).not.toHaveLength(0);
  });

  it("stops generation when stop button is clicked", async () => {
    let rejectStream: (reason: Error) => void = () => {};
    const client = createBaseClient({
      bootstrap: vi.fn().mockResolvedValue(createReadyBootstrap()),
      streamChat: vi.fn().mockImplementation(({ signal }) => {
        return new Promise((_resolve, reject) => {
          rejectStream = reject;
          signal?.addEventListener("abort", () => {
            reject(new DOMException("AbortError", "AbortError"));
          });
        });
      })
    });

    renderApp(client);
    const user = userEvent.setup();
    await screen.findByLabelText("Select model");

    await user.type(screen.getByLabelText("Message"), "Stop me");
    await user.click(screen.getByLabelText("Send"));

    // stop button should appear while streaming
    const stopButton = await screen.findByLabelText("Stop generating");
    await user.click(stopButton);

    // should show "Generation stopped"
    expect(await screen.findAllByText("Generation stopped")).not.toHaveLength(0);
  });
});
