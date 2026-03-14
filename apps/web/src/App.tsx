import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthDeviceStartResponse, ChatMessage } from "@copilotchat/shared";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useStore } from "zustand";

import type { AppStore } from "./app-store";
import { createSessionId } from "./app-store";
import type { BridgeClient } from "./bridge-client";

import { Sidebar } from "./components/sidebar";
import { ChatView } from "./components/chat-view";
import { AuthView } from "./components/auth-view";
import { LoadingView } from "./components/loading-view";
import { DiagnosticsView } from "./components/diagnostics-view";

import "./styles.css";

type RuntimeState = "bridge_offline" | "loading" | "ready" | "signed_out";

export function App(props: { client: BridgeClient; store: AppStore }) {
  return (
    <BrowserRouter>
      <Shell {...props} />
    </BrowserRouter>
  );
}

function Shell({ client, store }: { client: BridgeClient; store: AppStore }) {
  const queryClient = useQueryClient();
  const sessions = useStore(store, (state) => state.sessions);
  const activeSessionId = useStore(store, (state) => state.activeSessionId);
  const sessionSearch = useStore(store, (state) => state.sessionSearch);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;

  const bootstrapQuery = useQuery({
    queryFn: () => client.bootstrap(),
    queryKey: ["bootstrap"],
    retry: false,
    staleTime: 15_000
  });

  const bootstrap = bootstrapQuery.data ?? null;
  const models = bootstrap?.models ?? [];
  const isBridgeReachable = bootstrap?.bridge.reachable ?? false;
  const isReady = Boolean(bootstrap?.auth.authenticated);
  const accountLabel = bootstrap?.auth.accountLabel ?? "GitHub Copilot";
  const deferredSearch = useDeferredValue(sessionSearch);

  const [deviceAuth, setDeviceAuth] = useState<AuthDeviceStartResponse | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!models.length) {
      /* v8 ignore next 3 -- defensive reset after model list disappears */
      if (selectedModel) {
        setSelectedModel("");
      }
      return;
    }

    if (!models.some((model) => model.id === selectedModel)) {
      setSelectedModel(models[0].id);
    }
  }, [models, selectedModel]);

  useEffect(() => {
    if (!isReady || activeSessionId) {
      return;
    }

    startTransition(() => {
      store.getState().createSession(createSessionId());
    });
  }, [activeSessionId, isReady, store]);

  const filteredSessions = useMemo(
    () =>
      sessions.filter((session) =>
        session.title.toLowerCase().includes(deferredSearch.trim().toLowerCase())
      ),
    [deferredSearch, sessions]
  );

  const runtime: RuntimeState = bootstrapQuery.isPending
    ? "loading"
    : !isBridgeReachable
      ? "bridge_offline"
      : isReady
        ? "ready"
        : "signed_out";

  async function connectGitHub() {
    setIsConnecting(true);

    try {
      const challenge = await client.startDeviceAuth();
      setDeviceAuth(challenge);
      setStatusNote("Waiting for GitHub Copilot sign-in");

      while (true) {
        const pollResult = await client.pollDeviceAuth({
          deviceCode: challenge.deviceCode
        });

        if (pollResult.status === "pending") {
          /* v8 ignore next 2 -- polling delay already covered via immediate test loop */
          await sleep((pollResult.pollAfterSeconds ?? challenge.intervalSeconds) * 1000);
          continue;
        }

        queryClient.setQueryData(["bootstrap"], pollResult);
        setDeviceAuth(null);
        setStatusNote("GitHub Copilot connected");
        return;
      }
    } catch (errorValue) {
      setStatusNote(readErrorMessage(errorValue));
    } finally {
      setIsConnecting(false);
    }
  }

  async function logout() {
    try {
      const next = await client.logout();
      queryClient.setQueryData(["bootstrap"], next);
      setDeviceAuth(null);
      setSelectedModel("");
      store.setState({
        activeSessionId: null,
        sessionSearch: "",
        sessions: []
      });
      setStatusNote("Signed out");
    } catch (errorValue) {
      setStatusNote(readErrorMessage(errorValue));
    }
  }

  async function sendMessage() {
    /* v8 ignore next 2 -- defensive; UI prevents send without session/model/content */
    if (!activeSession || !selectedModel || !activeSession.draft.trim() || isSending) return;

    const sessionId = activeSession.id;
    const userMessage: ChatMessage = {
      content: activeSession.draft,
      id: createSessionId(),
      role: "user"
    };

    store.getState().appendMessage(sessionId, userMessage);
    store.getState().setDraft(sessionId, "");
    setIsSending(true);
    setStatusNote("Streaming response from local bridge");

    const assistantId = createSessionId();
    let assistantContent = "";
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const usage = await client.streamChat({
        onEvent(event) {
          if (event.type === "assistant_delta") {
            assistantContent += event.data;
            store.getState().upsertMessage(sessionId, {
              content: assistantContent,
              id: assistantId,
              role: "assistant"
            });
          }
        },
        request: {
          messages: [...activeSession.messages, userMessage],
          modelId: selectedModel,
          requestId: createSessionId()
        },
        signal: controller.signal
      });

      setStatusNote(`${usage.outputTokens} output tokens`);
    } catch (errorValue) {
      if (controller.signal.aborted) {
        setStatusNote("Generation stopped");
      } else {
        setStatusNote(readErrorMessage(errorValue));
      }
    } finally {
      abortRef.current = null;
      setIsSending(false);
    }
  }

  function stopGenerating() {
    abortRef.current?.abort();
  }

  function renderChatContent() {
    if (runtime === "loading") {
      return <LoadingView />;
    }

    if (runtime !== "ready") {
      return (
        <AuthView
          bridgeReachable={isBridgeReachable}
          deviceAuth={deviceAuth}
          isConnecting={isConnecting}
          startDeviceAuth={connectGitHub}
          statusNote={statusNote}
        />
      );
    }

    return (
      <ChatView
        activeSession={activeSession}
        isSending={isSending}
        models={models}
        onStop={stopGenerating}
        selectedModel={selectedModel}
        sendMessage={sendMessage}
        setDraft={(value) => {
          if (activeSession) {
            store.getState().setDraft(activeSession.id, value);
          }
        }}
        setSelectedModel={setSelectedModel}
        statusNote={statusNote}
      />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        accountLabel={runtime === "ready" ? accountLabel : isBridgeReachable ? "GitHub Copilot" : "Bridge offline"}
        activeSessionId={runtime === "ready" ? activeSessionId : null}
        filteredSessions={runtime === "ready" ? filteredSessions : []}
        logout={logout}
        runtime={runtime}
        sessionSearch={runtime === "ready" ? sessionSearch : ""}
        setSessionSearch={(value) => store.getState().setSessionSearch(value)}
        startNewThread={() => startTransition(() => store.getState().createSession(createSessionId()))}
        statusNote={statusNote}
        switchSession={(sessionId) => store.getState().setActiveSession(sessionId)}
      />

      <main className="flex-1 min-w-0 overflow-hidden">
        <Routes>
          <Route element={renderChatContent()} path="/chat" />
          <Route
            element={
              <DiagnosticsView
                accountLabel={accountLabel}
                bridgeState={bootstrap?.bridge ?? { paired: false, reachable: false }}
                models={models}
                runtime={runtime}
              />
            }
            path="/diagnostics"
          />
          <Route element={<Navigate replace to="/chat" />} path="*" />
        </Routes>
      </main>
    </div>
  );
}

function readErrorMessage(errorValue: unknown) {
  if (errorValue instanceof Error) {
    return friendlyError(errorValue.message);
  }

  if (typeof errorValue === "string") {
    return friendlyError(errorValue);
  }

  return "bridge_request_failed";
}

function friendlyError(error: string) {
  if (error === "auth_flow_not_found") {
    return "Bridge auth flow expired. Start sign-in again.";
  }

  if (error === "bridge_request_failed") {
    return "bridge_request_failed";
  }

  return error;
}

function sleep(delayMs: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}
