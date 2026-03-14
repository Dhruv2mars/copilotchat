import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatMessage } from "@copilotchat/shared";
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useStore } from "zustand";

import type { AppStore } from "./app-store";
import { createSessionId } from "./app-store";
import type { BffClient } from "./bff-client";

import { Sidebar } from "./components/sidebar";
import { ChatView } from "./components/chat-view";
import { AuthView } from "./components/auth-view";
import { LoadingView } from "./components/loading-view";
import { AccessView } from "./components/access-view";
import { DiagnosticsView } from "./components/diagnostics-view";

import "./styles.css";

type RuntimeState = "loading" | "ready" | "signed_out";

export function App(props: { client: BffClient; store: AppStore }) {
  return (
    <BrowserRouter>
      <Shell {...props} />
    </BrowserRouter>
  );
}

function Shell({ client, store }: { client: BffClient; store: AppStore }) {
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
  const isReady = Boolean(bootstrap?.auth.authenticated);
  const models = bootstrap?.models ?? [];
  const accountLabel = bootstrap?.auth.accountLabel ?? "GitHub Models";
  const deferredSearch = useDeferredValue(sessionSearch);

  const [selectedModel, setSelectedModel] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [personalAccessToken, setPersonalAccessToken] = useState("");

  useEffect(() => {
    if (!models.length) {
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

  const runtime: RuntimeState = bootstrapQuery.isPending ? "loading" : isReady ? "ready" : "signed_out";

  const filteredSessions = useMemo(
    () =>
      sessions.filter((session) =>
        session.title.toLowerCase().includes(deferredSearch.trim().toLowerCase())
      ),
    [deferredSearch, sessions]
  );

  async function authWithCli() {
    try {
      const next = await client.authWithCli();
      queryClient.setQueryData(["bootstrap"], next);
      setStatusNote("GitHub CLI session loaded");
    } catch (errorValue) {
      setStatusNote(readErrorMessage(errorValue));
    }
  }

  async function authWithPat() {
    try {
      const next = await client.authWithPat({
        token: personalAccessToken
      });
      queryClient.setQueryData(["bootstrap"], next);
      setPersonalAccessToken("");
      setStatusNote("PAT connected");
    } catch (errorValue) {
      setStatusNote(readErrorMessage(errorValue));
    }
  }

  async function sendMessage() {
    if (!activeSession || !selectedModel || !activeSession.draft.trim() || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      content: activeSession.draft,
      id: createSessionId(),
      role: "user"
    };

    store.getState().appendMessage(activeSession.id, userMessage);
    store.getState().setDraft(activeSession.id, "");
    setIsSending(true);
    setStatusNote("Waiting for GitHub Models");

    try {
      const requestedModel = selectedModel;
      const response = await client.completeChat({
        messages: [...activeSession.messages, userMessage],
        modelId: selectedModel,
        requestId: createSessionId()
      });
      store.getState().appendMessage(activeSession.id, response.message);
      if (response.usedModel?.id && response.usedModel.id !== requestedModel) {
        setSelectedModel(response.usedModel.id);
        setStatusNote(
          `Used ${response.usedModel.label} after ${labelForModel(models, requestedModel)} returned no_access. ${response.usage.outputTokens} output tokens.`
        );
      } else {
        setStatusNote(`${response.usage.outputTokens} output tokens`);
      }
    } catch (errorValue) {
      setStatusNote(readErrorMessage(errorValue));
    } finally {
      setIsSending(false);
    }
  }

  async function logout() {
    try {
      const next = await client.logout();
      queryClient.setQueryData(["bootstrap"], next);
      setStatusNote("Signed out");
    } catch (errorValue) {
      setStatusNote(readErrorMessage(errorValue));
    }
  }

  function renderChatContent() {
    if (runtime === "loading") {
      return <LoadingView />;
    }

    if (runtime === "signed_out") {
      return (
        <AuthView
          /* v8 ignore next */
          devCliAvailable={bootstrap?.devCliAvailable ?? false}
          personalAccessToken={personalAccessToken}
          setPersonalAccessToken={setPersonalAccessToken}
          startPatAuth={authWithPat}
          startLocalCliAuth={authWithCli}
          statusNote={statusNote}
        />
      );
    }

    return (
      <ChatView
        accountLabel={accountLabel}
        activeSession={activeSession}
        isSending={isSending}
        models={models}
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
        accountLabel={accountLabel}
        activeSessionId={activeSessionId}
        filteredSessions={filteredSessions}
        logout={logout}
        runtime={runtime}
        sessionSearch={sessionSearch}
        setSessionSearch={(value) => store.getState().setSessionSearch(value)}
        startNewThread={() => startTransition(() => store.getState().createSession(createSessionId()))}
        statusNote={statusNote}
        switchSession={(sessionId) => store.getState().setActiveSession(sessionId)}
      />

      <main className="flex-1 min-w-0 overflow-hidden">
        <Routes>
          <Route element={renderChatContent()} path="/chat" />
          <Route
            element={<AccessView devCliAvailable={bootstrap?.devCliAvailable ?? false} />}
            path="/access"
          />
          <Route
            element={
              <DiagnosticsView
                accountLabel={accountLabel}
                devCliAvailable={bootstrap?.devCliAvailable ?? false}
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

  return "github_bff_request_failed";
}

function labelForModel(models: Array<{ id: string; label: string }>, modelId: string) {
  /* v8 ignore next */
  return models.find((model) => model.id === modelId)?.label ?? modelId;
}

function friendlyError(error: string) {
  if (error === "github_models_pat_required") {
    return "PAT lacks GitHub Models access";
  }

  if (error === "no_inference_access") {
    return "This account/token cannot run chat inference on the current included Copilot models.";
  }

  return error;
}
