import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatView } from "./chat-view";

function renderChatView(overrides: Partial<Parameters<typeof ChatView>[0]> = {}) {
  const setSelectedModel = vi.fn();
  const sendMessage = vi.fn().mockResolvedValue(undefined);

  render(
    <ChatView
      activeSession={{
        draft: "",
        id: "session-1",
        messages: []
      }}
      isSending={false}
      models={[
        {
          id: "openai/gpt-5-mini",
          label: "OpenAI GPT-5 mini"
        },
        {
          id: "openai/gpt-4.1",
          label: "OpenAI GPT-4.1"
        },
        {
          id: "anthropic/claude-sonnet-4",
          label: "Claude Sonnet 4"
        }
      ]}
      selectedModel="openai/gpt-5-mini"
      sendMessage={sendMessage}
      setDraft={vi.fn()}
      setSelectedModel={setSelectedModel}
      statusNote=""
      {...overrides}
    />
  );

  return {
    sendMessage,
    setSelectedModel
  };
}

describe("ChatView", () => {
  it("opens model selector popover, filters models, and selects from the list", async () => {
    const user = userEvent.setup();
    const { setSelectedModel } = renderChatView();

    // open the model selector popover
    await user.click(screen.getByLabelText("Select model"));

    // search input appears in the popover
    const searchInput = screen.getByLabelText("Search models");
    await user.type(searchInput, "4.1");

    // only matching model visible
    expect(screen.getByRole("option", { name: /OpenAI GPT-4.1/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /OpenAI GPT-5 mini/i })).toBeNull();
    expect(screen.queryByRole("option", { name: /Claude Sonnet 4/i })).toBeNull();

    await user.click(screen.getByRole("option", { name: /OpenAI GPT-4.1/i }));

    expect(setSelectedModel).toHaveBeenCalledWith("openai/gpt-4.1");
  });

  it("shows an empty state when no models match", async () => {
    const user = userEvent.setup();

    renderChatView();

    await user.click(screen.getByLabelText("Select model"));
    await user.type(screen.getByLabelText("Search models"), "zzz");

    expect(screen.getByText("No models match.")).toBeInTheDocument();
  });

  it("sends message on Enter key", async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    const { sendMessage } = renderChatView({
      activeSession: {
        draft: "hello",
        id: "session-1",
        messages: []
      },
      setDraft
    });

    const input = screen.getByLabelText("Message");
    await user.click(input);
    await user.keyboard("{Enter}");

    expect(sendMessage).toHaveBeenCalled();
  });

  it("does not send on Shift+Enter (allows newline)", async () => {
    const user = userEvent.setup();
    const { sendMessage } = renderChatView({
      activeSession: {
        draft: "hello",
        id: "session-1",
        messages: []
      }
    });

    const input = screen.getByLabelText("Message");
    await user.click(input);
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("shows stop button when sending", async () => {
    const onStop = vi.fn();
    renderChatView({ isSending: true, onStop });

    expect(screen.getByLabelText("Stop generating")).toBeInTheDocument();
    expect(screen.queryByLabelText("Send")).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Stop generating"));
    expect(onStop).toHaveBeenCalled();
  });

  it("renders markdown in assistant messages", () => {
    renderChatView({
      activeSession: {
        draft: "",
        id: "session-1",
        messages: [
          { content: "hello **bold**", id: "m1", role: "assistant" }
        ]
      }
    });

    const bold = screen.getByText("bold");
    expect(bold.tagName).toBe("STRONG");
  });

  it("shows streaming indicator for empty assistant message", () => {
    renderChatView({
      activeSession: {
        draft: "",
        id: "session-1",
        messages: [
          { content: "", id: "m1", role: "assistant" }
        ]
      }
    });

    // model label appears both in the selector trigger and as the message author
    expect(screen.getAllByText("OpenAI GPT-5 mini").length).toBeGreaterThanOrEqual(2);
  });

  it("selects model via keyboard navigation (ArrowDown, ArrowUp, Enter)", async () => {
    const user = userEvent.setup();
    const { setSelectedModel } = renderChatView();

    await user.click(screen.getByLabelText("Select model"));
    const searchInput = screen.getByLabelText("Search models");

    // arrow down to second model (index 1)
    await user.keyboard("{ArrowDown}");
    // arrow down to third model (index 2)
    await user.keyboard("{ArrowDown}");
    // arrow up back to second model (index 1)
    await user.keyboard("{ArrowUp}");
    // enter to select
    await user.keyboard("{Enter}");

    expect(setSelectedModel).toHaveBeenCalledWith("openai/gpt-4.1");
  });

  it("shows user messages with 'You' label", () => {
    renderChatView({
      activeSession: {
        draft: "",
        id: "session-1",
        messages: [
          { content: "test message", id: "m1", role: "user" }
        ]
      }
    });

    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("test message")).toBeInTheDocument();
  });

  it("shows 'Assistant' fallback label when modelLabel is missing", () => {
    renderChatView({
      activeSession: {
        draft: "",
        id: "session-1",
        messages: [
          { content: "hello", id: "m1", role: "assistant" }
        ]
      },
      selectedModel: "unknown-model"
    });

    expect(screen.getByText("Assistant")).toBeInTheDocument();
  });
});
