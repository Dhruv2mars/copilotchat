import { describe, expect, it } from "vitest";

import { createAppStore, createSessionId } from "./app-store";

describe("app-store", () => {
  it("creates, updates, and deletes persisted chat sessions", () => {
    const store = createAppStore();
    const sessionId = createSessionId();

    store.getState().createSession(sessionId);
    store.getState().setDraft(sessionId, "hello");
    store.getState().appendMessage(sessionId, {
      content: "hello",
      id: "m1",
      role: "user"
    });
    store.getState().renameSession(sessionId, "Launch thread");

    expect(store.getState().sessions[0]).toMatchObject({
      draft: "hello",
      id: sessionId,
      messages: [
        {
          content: "hello",
          id: "m1",
          role: "user"
        }
      ],
      title: "Launch thread"
    });

    store.getState().deleteSession(sessionId);
    expect(store.getState().sessions).toHaveLength(0);
  });

  it("covers store mutations for pairing, search, selection, and message upserts", () => {
    const store = createAppStore();
    const firstId = createSessionId();
    const secondId = createSessionId();

    store.getState().createSession(firstId);
    store.getState().createSession(secondId);
    store.getState().renameSession(firstId, "Pinned title");
    store.getState().appendMessage(firstId, {
      content: "First prompt",
      id: "m1",
      role: "user"
    });
    store.getState().upsertMessage(firstId, {
      content: "Draft answer",
      id: "a1",
      role: "assistant"
    });
    store.getState().upsertMessage(firstId, {
      content: "Final answer",
      id: "a1",
      role: "assistant"
    });
    store.getState().setDraft(firstId, "draft");
    store.getState().setPairingToken("pair-token");
    store.getState().setSessionSearch("Pinned");
    store.getState().setActiveSession(firstId);

    expect(store.getState()).toMatchObject({
      activeSessionId: firstId,
      pairingToken: "pair-token",
      sessionSearch: "Pinned"
    });
    expect(store.getState().sessions.find((session) => session.id === firstId)?.messages).toEqual([
      {
        content: "First prompt",
        id: "m1",
        role: "user"
      },
      {
        content: "Final answer",
        id: "a1",
        role: "assistant"
      }
    ]);

    store.getState().deleteSession(firstId);
    expect(store.getState().activeSessionId).toBe(secondId);
    store.getState().appendMessage(secondId, {
      content: "   ",
      id: "m2",
      role: "user"
    });
    expect(store.getState().sessions[0]?.title).toBe("Fresh bridge run");

    store.getState().setActiveSession(secondId);
    store.getState().deleteSession(firstId);
    expect(store.getState().activeSessionId).toBe(secondId);

    store.getState().createSession(secondId);
    expect(store.getState().sessions).toHaveLength(1);
  });
});
