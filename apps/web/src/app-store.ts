import type { ChatMessage } from "@copilotchat/shared";
import { createJSONStorage, persist } from "zustand/middleware";
import { createStore, type StoreApi } from "zustand/vanilla";

export interface AppSession {
  draft: string;
  id: string;
  messages: ChatMessage[];
  title: string;
}

export interface AppState {
  activeSessionId: string | null;
  sessionSearch: string;
  sessions: AppSession[];
  appendMessage(sessionId: string, message: ChatMessage): void;
  createSession(sessionId: string): void;
  deleteSession(sessionId: string): void;
  renameSession(sessionId: string, title: string): void;
  setActiveSession(sessionId: string): void;
  setDraft(sessionId: string, draft: string): void;
  setSessionSearch(value: string): void;
  upsertMessage(sessionId: string, message: ChatMessage): void;
}

export type AppStore = StoreApi<AppState>;

const STORAGE_KEY = "copilotchat-web-v1";

export function createSessionId() {
  return crypto.randomUUID();
}

export function createAppStore() {
  return createStore<AppState>()(
    persist(
      (set) => ({
        activeSessionId: null,
        sessionSearch: "",
        sessions: [],
        appendMessage: (sessionId, message) =>
          set((state) => ({
            sessions: state.sessions.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    messages: [...session.messages, message],
                    title: normalizeTitle(session.title, message.content)
                  }
                : session
            )
          })),
        createSession: (sessionId) =>
          set((state) => ({
            activeSessionId: sessionId,
            sessions: state.sessions.some((session) => session.id === sessionId)
              ? state.sessions
              : [
                  {
                    draft: "",
                    id: sessionId,
                    messages: [],
                    title: "Fresh chat"
                  },
                  ...state.sessions
                ]
          })),
        deleteSession: (sessionId) =>
          set((state) => {
            const sessions = state.sessions.filter((session) => session.id !== sessionId);
            return {
              activeSessionId: state.activeSessionId === sessionId ? sessions[0]?.id ?? null : state.activeSessionId,
              sessions
            };
          }),
        renameSession: (sessionId, title) =>
          set((state) => ({
            sessions: state.sessions.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    title
                  }
                : session
            )
          })),
        setActiveSession: (sessionId) =>
          set({
            activeSessionId: sessionId
          }),
        setDraft: (sessionId, draft) =>
          set((state) => ({
            sessions: state.sessions.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    draft
                  }
                : session
            )
          })),
        setSessionSearch: (value) =>
          set({
            sessionSearch: value
          }),
        upsertMessage: (sessionId, message) =>
          set((state) => ({
            sessions: state.sessions.map((session) => {
              if (session.id !== sessionId) {
                return session;
              }

              const existingIndex = session.messages.findIndex((entry) => entry.id === message.id);
              if (existingIndex === -1) {
                return {
                  ...session,
                  messages: [...session.messages, message]
                };
              }

              const messages = [...session.messages];
              messages[existingIndex] = message;
              return {
                ...session,
                messages
              };
            })
          }))
      }),
      {
        name: STORAGE_KEY,
        storage: createJSONStorage(() => localStorage),
        version: 1
      }
    )
  );
}

function normalizeTitle(currentTitle: string, content: string) {
  if (currentTitle !== "Fresh chat") {
    return currentTitle;
  }

  const trimmed = content.trim();
  return trimmed ? trimmed.slice(0, 48) : currentTitle;
}
