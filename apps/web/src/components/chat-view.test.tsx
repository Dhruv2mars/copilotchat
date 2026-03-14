import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatView } from "./chat-view";

function renderChatView() {
  const setSelectedModel = vi.fn();

  render(
    <ChatView
      accountLabel="dhruv2mars"
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
      sendMessage={vi.fn()}
      setDraft={vi.fn()}
      setSelectedModel={setSelectedModel}
      statusNote=""
    />
  );

  return {
    setSelectedModel
  };
}

describe("ChatView", () => {
  it("filters models as the user types and selects from the list", async () => {
    const user = userEvent.setup();
    const { setSelectedModel } = renderChatView();

    await user.type(screen.getByLabelText("Search models"), "4.1");

    expect(screen.getByRole("button", { name: /OpenAI GPT-4.1/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /OpenAI GPT-5 mini/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Claude Sonnet 4/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: /OpenAI GPT-4.1/i }));

    expect(setSelectedModel).toHaveBeenCalledWith("openai/gpt-4.1");
  });

  it("shows an empty state when no models match", async () => {
    const user = userEvent.setup();

    renderChatView();
    await user.type(screen.getByLabelText("Search models"), "zzz");

    expect(screen.getByText("No models match.")).toBeInTheDocument();
  });
});
