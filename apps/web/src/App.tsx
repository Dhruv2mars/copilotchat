import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatMessage } from "@copilotchat/shared";
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useStore } from "zustand";

import type { AppStore } from "./app-store";
import { createSessionId } from "./app-store";
import type { BffClient } from "./bff-client";

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

  return (
    <div className="app-shell">
      <CommandRail
        accountLabel={accountLabel}
        activeSessionId={activeSessionId}
        activeSessionTitle={activeSession?.title ?? "No thread selected"}
        filteredSessions={filteredSessions}
        logout={logout}
        runtime={runtime}
        sessionSearch={sessionSearch}
        setSessionSearch={(value) => store.getState().setSessionSearch(value)}
        startNewThread={() => startTransition(() => store.getState().createSession(createSessionId()))}
        statusNote={statusNote}
        switchSession={(sessionId) => store.getState().setActiveSession(sessionId)}
      />

      <main className="content-panel">
        <Routes>
          <Route
            element={
              <ChatRoute
                accountLabel={accountLabel}
                activeSession={activeSession}
                devCliAvailable={bootstrap?.devCliAvailable ?? false}
                isSending={isSending}
                models={models}
                personalAccessToken={personalAccessToken}
                setPersonalAccessToken={setPersonalAccessToken}
                runtime={runtime}
                selectedModel={selectedModel}
                startPatAuth={authWithPat}
                sendMessage={sendMessage}
                setDraft={(value) => {
                  if (activeSession) {
                    store.getState().setDraft(activeSession.id, value);
                  }
                }}
                setSelectedModel={setSelectedModel}
                startLocalCliAuth={authWithCli}
                statusNote={statusNote}
              />
            }
            path="/chat"
          />
          <Route element={<AccessRoute devCliAvailable={bootstrap?.devCliAvailable ?? false} />} path="/access" />
          <Route
            element={
              <DiagnosticsRoute
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

      <RuntimeAside modelCount={models.length} runtime={runtime} />
    </div>
  );
}

function CommandRail(props: {
  accountLabel: string;
  activeSessionId: string | null;
  activeSessionTitle: string;
  filteredSessions: Array<{
    id: string;
    messages: ChatMessage[];
    title: string;
  }>;
  logout(): Promise<void>;
  runtime: RuntimeState;
  sessionSearch: string;
  setSessionSearch(value: string): void;
  startNewThread(): void;
  statusNote: string;
  switchSession(sessionId: string): void;
}) {
  const location = useLocation();

  return (
    <aside className="command-rail">
      <div className="brand-block">
        <p className="eyebrow">Copilot Chat</p>
        <h1>Hosted BFF, no local bridge.</h1>
        <p className="lead-copy">
          GitHub auth and GitHub Models run through a thin serverless backend; picker stays pinned to current Copilot GA models.
        </p>
      </div>

      <nav aria-label="Primary" className="nav-cluster">
        <Link className={location.pathname === "/chat" ? "nav-link active" : "nav-link"} to="/chat">
          Chat
        </Link>
        <Link className={location.pathname === "/access" ? "nav-link active" : "nav-link"} to="/access">
          Access
        </Link>
        <Link
          className={location.pathname === "/diagnostics" ? "nav-link active" : "nav-link"}
          to="/diagnostics"
        >
          Diagnostics
        </Link>
      </nav>

      <section className="rail-card status-card">
        <div className="status-row">
          <span className={`status-pill status-${props.runtime}`}>{formatRuntimeLabel(props.runtime)}</span>
          <button className="ghost-button" onClick={() => void props.logout()} type="button">
            Logout
          </button>
        </div>
        <p className="rail-title">{props.accountLabel}</p>
        <p className="rail-copy">{props.statusNote || runtimeSummary(props.runtime)}</p>
      </section>

      <section className="rail-card">
        <div className="section-head">
          <p className="eyebrow">Threads</p>
          <button className="new-thread" onClick={props.startNewThread} type="button">
            New thread
          </button>
        </div>
        <label className="search-box">
          <span>Search sessions</span>
          <input
            aria-label="Search sessions"
            onChange={(event) => props.setSessionSearch(event.target.value)}
            placeholder="Find a thread"
            value={props.sessionSearch}
          />
        </label>
        <div className="session-list">
          {props.filteredSessions.length ? (
            props.filteredSessions.map((session) => (
              <button
                className={session.id === props.activeSessionId ? "session-row active" : "session-row"}
                key={session.id}
                onClick={() => props.switchSession(session.id)}
                type="button"
              >
                <span>{session.title}</span>
                <small>{session.messages.length} msgs</small>
              </button>
            ))
          ) : (
            <div className="session-empty">
              <p className="eyebrow">Queue empty</p>
              <p>{props.activeSessionTitle === "No thread selected" ? "Create first thread." : "No search matches."}</p>
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}

function RuntimeAside(props: { modelCount: number; runtime: RuntimeState }) {
  return (
    <aside className="runtime-aside">
      <section className="rail-card policy-card">
        <p className="eyebrow">Runtime policy</p>
        <h2>Production guardrails</h2>
        <ul className="policy-list">
          <li>GitHub token stays in an http-only session cookie, not JS storage.</li>
          <li>Models traffic goes through the hosted BFF because GitHub Models is not browser-CORS friendly.</li>
          <li>Only Copilot GA models that also resolve in the GitHub Models API stay in the picker.</li>
          <li>No local daemon, pairing dance, or machine-specific runtime needed.</li>
        </ul>
      </section>

      <section className="rail-card metrics-card">
        <p className="eyebrow">Live posture</p>
        <div className="metric-grid">
          <article>
            <span>Runtime</span>
            <strong>{formatRuntimeLabel(props.runtime)}</strong>
          </article>
          <article>
            <span>Backend</span>
            <strong>Vercel BFF</strong>
          </article>
          <article>
            <span>Models</span>
            <strong>{props.modelCount || "0"}</strong>
          </article>
        </div>
      </section>
    </aside>
  );
}

function ChatRoute(props: {
  accountLabel: string;
  activeSession: {
    draft: string;
    id: string;
    messages: ChatMessage[];
  } | null;
  devCliAvailable: boolean;
  isSending: boolean;
  models: { id: string; label: string }[];
  personalAccessToken: string;
  runtime: RuntimeState;
  selectedModel: string;
  sendMessage(): Promise<void>;
  setDraft(value: string): void;
  setPersonalAccessToken(value: string): void;
  setSelectedModel(value: string): void;
  startPatAuth(): Promise<void>;
  startLocalCliAuth(): Promise<void>;
  statusNote: string;
}) {
  if (props.runtime === "loading") {
    return (
      <section className="stage stage-hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Session bootstrap</p>
            <h2>Loading session</h2>
            <p>Checking your hosted GitHub session and loading the model catalog.</p>
          </div>
        </div>
      </section>
    );
  }

  if (props.runtime === "signed_out") {
    return (
      <section className="stage stage-hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">GitHub Models auth</p>
            <h2>Connect a PAT with Models access</h2>
            <p>Use a GitHub personal access token with GitHub Models permission. Device-flow tokens do not reliably work here.</p>
            {props.statusNote ? <p className="hero-note">{props.statusNote}</p> : null}
            <label className="search-box">
              <span>Personal access token</span>
              <input
                aria-label="Personal access token"
                autoComplete="off"
                onChange={(event) => props.setPersonalAccessToken(event.target.value)}
                placeholder="github_pat_..."
                type="password"
                value={props.personalAccessToken}
              />
            </label>
            <div className="composer-row">
              <button className="primary-button" onClick={() => void props.startPatAuth()} type="button">
                Connect PAT
              </button>
              {props.devCliAvailable ? (
                <button className="ghost-button" onClick={() => void props.startLocalCliAuth()} type="button">
                  Use local GitHub CLI
                </button>
              ) : null}
            </div>
          </div>

          <div className="hero-side">
            <div className="challenge-card challenge-card-idle">
              <p className="eyebrow">Required token</p>
              <h3>GitHub PAT with Models access</h3>
              <p>The BFF stores it in an encrypted http-only session cookie after validation.</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const messages = props.activeSession?.messages ?? [];
  const threadContent =
    messages.length > 0 ? (
      messages.map((message) => (
        <article className={`message message-${message.role}`} key={message.id}>
          <span>{message.role}</span>
          <p>{message.content}</p>
        </article>
      ))
    ) : (
      <div className="thread-empty">
        <p className="eyebrow">Ready</p>
        <h3>Ask GitHub Models</h3>
        <p>Each send is one non-streaming serverless round-trip through the hosted BFF.</p>
      </div>
    );

  return (
    <section className="stage chat-stage">
      <header className="chat-topbar">
        <div>
          <p className="eyebrow">Connected operator</p>
          <h2>{props.accountLabel}</h2>
        </div>

        <div className="chat-toolbar">
          <div className="toolbar-card">
            <span>Status</span>
            <strong>{props.statusNote || "Ready for chat"}</strong>
          </div>
          <label className="model-picker toolbar-card">
            <span>Model</span>
            <select
              aria-label="Model"
              onChange={(event) => props.setSelectedModel(event.target.value)}
              value={props.selectedModel}
            >
              {props.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="thread-card">{threadContent}</div>

      <footer className="composer-card">
        <label className="composer-label" htmlFor="chat-input">
          Message
        </label>
        <textarea
          id="chat-input"
          onChange={(event) => props.setDraft(event.target.value)}
          placeholder="Send a non-streaming GitHub Models prompt"
          value={props.activeSession?.draft ?? ""}
        />
        <div className="composer-row">
          <p>{props.statusNote || "One function invocation per prompt."}</p>
          <button className="primary-button" disabled={props.isSending} onClick={() => void props.sendMessage()} type="button">
            {props.isSending ? "Sending..." : "Send"}
          </button>
        </div>
      </footer>
    </section>
  );
}

function AccessRoute(props: { devCliAvailable: boolean }) {
  return (
    <section className="stage stage-hero">
      <div className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">Hosted access</p>
          <h2>PAT in, cookie out</h2>
          <p>The app uses a hosted BFF for GitHub auth and model calls, so the browser never hits `models.github.ai` directly.</p>
        </div>
        <div className="platform-grid">
          <article>
            <span>Primary</span>
            <p>GitHub PAT with Models access, validated server-side.</p>
          </article>
          <article>
            <span>Cookie</span>
            <p>Encrypted, http-only session cookie for GitHub access token.</p>
          </article>
          <article>
            <span>Dev</span>
            <p>{props.devCliAvailable ? "Local GitHub CLI auth is enabled." : "Local GitHub CLI auth is disabled."}</p>
          </article>
          <article>
            <span>Legacy</span>
            <p>Device flow hidden because it does not reliably grant Models API access.</p>
          </article>
        </div>
      </div>
    </section>
  );
}

function DiagnosticsRoute(props: {
  accountLabel: string;
  devCliAvailable: boolean;
  models: { id: string; label: string }[];
  runtime: RuntimeState;
}) {
  return (
    <section className="stage stage-hero">
      <div className="diagnostics-head">
        <p className="eyebrow">Diagnostics</p>
        <h2>Session facts</h2>
      </div>
      <dl className="diagnostics-grid">
        <div>
          <dt>Authenticated</dt>
          <dd>{props.runtime === "ready" ? "yes" : "no"}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{props.runtime}</dd>
        </div>
        <div>
          <dt>Account</dt>
          <dd>{props.accountLabel}</dd>
        </div>
        <div>
          <dt>Dev CLI</dt>
          <dd>{props.devCliAvailable ? "enabled" : "disabled"}</dd>
        </div>
        <div>
          <dt>Models</dt>
          <dd>{props.models.length ? props.models.map((model) => model.label).join(", ") : "none"}</dd>
        </div>
      </dl>
    </section>
  );
}

function formatRuntimeLabel(runtime: RuntimeState) {
  if (runtime === "ready") return "Ready";
  if (runtime === "loading") return "Loading";
  return "Signed out";
}

function runtimeSummary(runtime: RuntimeState) {
  if (runtime === "loading") return "Checking hosted session.";
  if (runtime === "signed_out") return "GitHub PAT required.";
  return "Inference path armed.";
}

function readErrorMessage(errorValue: unknown) {
  if (errorValue instanceof Error) {
    return errorValue.message;
  }

  if (typeof errorValue === "string") {
    return errorValue;
  }

  return "github_bff_request_failed";
}

function labelForModel(models: Array<{ id: string; label: string }>, modelId: string) {
  /* v8 ignore next */
  return models.find((model) => model.id === modelId)?.label ?? modelId;
}
