import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppBootstrapResponse } from "@copilotchat/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { createAppStore } from "./app-store";
import type { BffClient } from "./bff-client";

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

function createSignedOutBootstrap(devCliAvailable = false): AppBootstrapResponse {
  return {
    auth: {
      accountLabel: null,
      authenticated: false,
      provider: "github-models"
    },
    devCliAvailable,
    models: []
  };
}

function createReadyBootstrap(devCliAvailable = false): AppBootstrapResponse {
  return {
    auth: {
      accountLabel: "Dhruv2mars",
      authenticated: true,
      provider: "github-models",
      tokenHint: "ghp_...7890"
    },
    devCliAvailable,
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

function createBaseClient(overrides: Partial<BffClient> = {}): BffClient {
  return {
    authWithCli: vi.fn(),
    authWithPat: vi.fn(),
    bootstrap: vi.fn().mockResolvedValue(createSignedOutBootstrap()),
    completeChat: vi.fn(),
    logout: vi.fn().mockResolvedValue(createSignedOutBootstrap()),
    pollDeviceAuth: vi.fn(),
    startDeviceAuth: vi.fn(),
    ...overrides
  };
}

describe("App", () => {
  it("authenticates with a pat and completes a chat session", async () => {
    const client = createBaseClient({
      authWithPat: vi.fn().mockResolvedValue(createReadyBootstrap()),
      completeChat: vi.fn().mockResolvedValue({
        message: {
          content: "hello test",
          id: "assistant-1",
          role: "assistant"
        },
        usedModel: {
          id: "openai/gpt-4.1",
          label: "OpenAI GPT-4.1"
        },
        usage: {
          inputTokens: 13,
          outputTokens: 3
        }
      })
    });

    renderApp(client);

    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Connect a PAT with Models access" })).toBeInTheDocument();
    expect(screen.getByText("Create first thread.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Personal access token"), "github_pat_test");
    await user.click(screen.getByRole("button", { name: "Connect PAT" }));

    expect(client.authWithPat).toHaveBeenCalledWith({
      token: "github_pat_test"
    });
    expect(await screen.findByRole("heading", { name: "Dhruv2mars" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Model"), "openai/gpt-4.1");
    await user.type(screen.getByLabelText("Message"), "Ship it");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(client.completeChat).toHaveBeenCalledWith({
      messages: [
        {
          content: "Ship it",
          id: expect.any(String),
          role: "user"
        }
      ],
      modelId: "openai/gpt-4.1",
      requestId: expect.any(String)
    });
    expect(await screen.findByText("hello test")).toBeInTheDocument();
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
    const client = createBaseClient({
      authWithCli: vi.fn().mockResolvedValue(createReadyBootstrap(true)),
      bootstrap: vi.fn().mockResolvedValue(createSignedOutBootstrap(true))
    });

    renderApp(client, "/diagnostics");

    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Session facts" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Chat" }));
    await user.click(await screen.findByRole("button", { name: "Use local GitHub CLI" }));
    expect(await screen.findByRole("heading", { name: "Dhruv2mars" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Diagnostics" }));
    expect(await screen.findByText("yes")).toBeInTheDocument();
    expect(screen.getByText(/OpenAI GPT-5 mini/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Logout" }));
    await user.click(screen.getByRole("link", { name: "Chat" }));
    expect(await screen.findByRole("heading", { name: "Connect a PAT with Models access" })).toBeInTheDocument();
  });

  it("surfaces pat, cli, chat, and logout failures", async () => {
    const client = createBaseClient({
      authWithCli: vi.fn().mockRejectedValue(new Error("cli_failed")),
      authWithPat: vi.fn().mockRejectedValue(new Error("pat_failed")),
      bootstrap: vi.fn().mockResolvedValue(createReadyBootstrap(true)),
      completeChat: vi.fn().mockRejectedValue(new Error("chat_failed")),
      logout: vi.fn().mockRejectedValue("logout_failed")
    });

    const firstRender = renderApp(client);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Message"), "Ship it");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findAllByText("chat_failed")).not.toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Logout" }));
    expect(await screen.findAllByText("logout_failed")).not.toHaveLength(0);
    firstRender.unmount();

    renderApp(
      createBaseClient({
        authWithCli: vi.fn().mockRejectedValue(new Error("cli_failed")),
        authWithPat: vi.fn().mockRejectedValue(new Error("pat_failed")),
        bootstrap: vi.fn().mockResolvedValue(createSignedOutBootstrap(true))
      })
    );

    await user.type(await screen.findByLabelText("Personal access token"), "bad-token");
    await user.click(screen.getByRole("button", { name: "Connect PAT" }));
    expect(await screen.findAllByText("pat_failed")).not.toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Use local GitHub CLI" }));
    expect(await screen.findAllByText("cli_failed")).not.toHaveLength(0);
  });

  it("falls back to a generic request error for unknown values", async () => {
    renderApp(
      createBaseClient({
        authWithPat: vi.fn().mockRejectedValue({}),
        bootstrap: vi.fn().mockResolvedValue(createSignedOutBootstrap())
      })
    );

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Personal access token"), "bad-token");
    await user.click(screen.getByRole("button", { name: "Connect PAT" }));
    expect(await screen.findAllByText("github_bff_request_failed")).not.toHaveLength(0);
  });

  it("shows a friendly message when auth cannot run inference", async () => {
    renderApp(
      createBaseClient({
        authWithPat: vi.fn().mockRejectedValue(new Error("no_inference_access")),
        bootstrap: vi.fn().mockResolvedValue(createSignedOutBootstrap())
      })
    );

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Personal access token"), "bad-token");
    await user.click(screen.getByRole("button", { name: "Connect PAT" }));
    expect(
      await screen.findAllByText(
        "This account/token cannot run chat inference on the current included Copilot models."
      )
    ).not.toHaveLength(0);
  });

  it("shows a friendly message when the pat lacks models access", async () => {
    renderApp(
      createBaseClient({
        authWithPat: vi.fn().mockRejectedValue(new Error("github_models_pat_required")),
        bootstrap: vi.fn().mockResolvedValue(createSignedOutBootstrap())
      })
    );

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Personal access token"), "bad-token");
    await user.click(screen.getByRole("button", { name: "Connect PAT" }));
    expect(await screen.findAllByText("PAT lacks GitHub Models access")).not.toHaveLength(0);
  });

  it("covers loading, access, and no-cli states", async () => {
    const loadingView = renderApp(
      createBaseClient({
        bootstrap: vi.fn(() => new Promise<AppBootstrapResponse>(() => undefined))
      })
    );
    expect(await screen.findByRole("heading", { name: "Loading session" })).toBeInTheDocument();
    loadingView.unmount();

    const accessEnabledView = renderApp(
      createBaseClient({ bootstrap: vi.fn().mockResolvedValue(createSignedOutBootstrap(true)) }),
      "/access"
    );
    expect(await screen.findByRole("heading", { name: "PAT in, cookie out" })).toBeInTheDocument();
    expect(await screen.findByText("Local GitHub CLI auth is enabled.")).toBeInTheDocument();
    expect(await screen.findByText("Device flow hidden because it does not reliably grant Models API access.")).toBeInTheDocument();
    accessEnabledView.unmount();

    renderApp(createBaseClient({ bootstrap: vi.fn().mockResolvedValue(createSignedOutBootstrap(false)) }), "/access");
    expect(await screen.findByText("Local GitHub CLI auth is disabled.")).toBeInTheDocument();
  });

  it("guards empty sends and clears pat input after success", async () => {
    const client = createBaseClient({
      authWithPat: vi.fn().mockResolvedValue(createReadyBootstrap()),
      bootstrap: vi.fn().mockResolvedValue(createReadyBootstrap())
    });

    const readyView = renderApp(client);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Send" }));
    expect(client.completeChat).not.toHaveBeenCalled();
    readyView.unmount();

    const signedOutClient = createBaseClient({
      authWithPat: vi.fn().mockResolvedValue(createReadyBootstrap())
    });
    renderApp(signedOutClient);

    const tokenField = await screen.findByLabelText("Personal access token");
    await user.type(tokenField, "github_pat_test");
    await user.click(screen.getByRole("button", { name: "Connect PAT" }));
    expect(await screen.findByRole("heading", { name: "Dhruv2mars" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("github_pat_test")).toBeNull();
  });

  it("switches the picker when the server falls back after no_access", async () => {
    const client = createBaseClient({
      bootstrap: vi.fn().mockResolvedValue(createReadyBootstrap()),
      completeChat: vi.fn().mockResolvedValue({
        message: {
          content: "fallback ok",
          id: "assistant-1",
          role: "assistant"
        },
        usedModel: {
          id: "openai/gpt-5-mini",
          label: "OpenAI GPT-5 mini"
        },
        usage: {
          inputTokens: 13,
          outputTokens: 3
        }
      })
    });

    renderApp(client);

    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Model"), "openai/gpt-4.1");
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("fallback ok")).toBeInTheDocument();
    expect(
      screen.getAllByText("Used OpenAI GPT-5 mini after OpenAI GPT-4.1 returned no_access. 3 output tokens.")
    ).not.toHaveLength(0);
    expect(screen.getByLabelText("Model")).toHaveValue("openai/gpt-5-mini");
  });

  it("uses raw model ids in fallback notes when the requested model is unknown", async () => {
    const client = createBaseClient({
      bootstrap: vi.fn().mockResolvedValue({
        ...createReadyBootstrap(),
        models: [
          {
            id: "openai/gpt-5-mini",
            label: "OpenAI GPT-5 mini"
          }
        ]
      }),
      completeChat: vi.fn().mockResolvedValue({
        message: {
          content: "fallback ok",
          id: "assistant-1",
          role: "assistant"
        },
        usedModel: {
          id: "openai/gpt-5-mini",
          label: "OpenAI GPT-5 mini"
        },
        usage: {
          inputTokens: 13,
          outputTokens: 3
        }
      })
    });

    renderApp(client);

    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Model"), "openai/gpt-5-mini");
    client.completeChat = vi.fn().mockResolvedValue({
      message: {
        content: "fallback ok",
        id: "assistant-1",
        role: "assistant"
      },
      usedModel: {
        id: "openai/gpt-5-mini",
        label: "OpenAI GPT-5 mini"
      },
      usage: {
        inputTokens: 13,
        outputTokens: 3
      }
    });
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("fallback ok")).toBeInTheDocument();
    expect(screen.getAllByText("3 output tokens")).not.toHaveLength(0);
  });
});
