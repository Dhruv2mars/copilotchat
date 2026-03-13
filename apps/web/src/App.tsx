import { useQuery } from "@tanstack/react-query";
import type { AuthDeviceStartResponse, ChatMessage } from "@copilotchat/shared";
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { useStore } from "zustand";

import type { AppSession, AppStore } from "./app-store";
import { createSessionId } from "./app-store";
import type { BridgeClient } from "./bridge-client";

import "./styles.css";

export function App(props: { client: BridgeClient; store: AppStore }) {
  return (
    <BrowserRouter>
      <Shell {...props} />
    </BrowserRouter>
  );
}

function Shell({ client, store }: { client: BridgeClient; store: AppStore }) {
  const pairingToken = useStore(store, (state) => state.pairingToken);
  const sessions = useStore(store, (state) => state.sessions);
  const activeSessionId = useStore(store, (state) => state.activeSessionId);
  const sessionSearch = useStore(store, (state) => state.sessionSearch);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;

  const healthQuery = useQuery({
    queryFn: () => client.health(),
    queryKey: ["bridge-health"],
    retry: false,
    staleTime: 5_000
  });
  const refetchHealth = healthQuery.refetch;

  const isReady = Boolean(pairingToken && healthQuery.data?.auth.authenticated);
  const modelsQuery = useQuery({
    enabled: isReady,
    queryFn: () =>
      client.listModels({
        origin: window.location.origin,
        token: pairingToken as string
      }),
    queryKey: ["bridge-models", pairingToken]
  });

  const [selectedModel, setSelectedModel] = useState("");
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState("");
  const [authChallenge, setAuthChallenge] = useState<AuthDeviceStartResponse | null>(null);
  const [organizationDraft, setOrganizationDraft] = useState("");
  const deferredSearch = useDeferredValue(sessionSearch);

  useEffect(() => {
    if (!selectedModel && modelsQuery.data?.[0]?.id) {
      setSelectedModel(modelsQuery.data[0].id);
    }
  }, [modelsQuery.data, selectedModel]);

  useEffect(() => {
    if (!isReady || activeSessionId) {
      return;
    }

    startTransition(() => {
      store.getState().createSession(createSessionId());
    });
  }, [activeSessionId, isReady, store]);

  useEffect(() => {
    if (!authChallenge || !pairingToken) {
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;

    const pollOnce = async () => {
      try {
        const response = await client.pollDeviceAuth({
          deviceCode: authChallenge.deviceCode,
          origin: window.location.origin,
          token: pairingToken
        });

        /* v8 ignore next */
        if (cancelled) return;

        if (response.status === "pending") {
          setStatusNote("Waiting for GitHub approval");
          /* v8 ignore next */
          timerId = window.setTimeout(() => void pollOnce(), (response.pollAfterSeconds ?? authChallenge.intervalSeconds) * 1000);
          return;
        }

        setAuthChallenge(null);
        setStatusNote("GitHub connected");
        await refetchHealth();
      } catch (errorValue) {
        setAuthChallenge(null);
        setStatusNote(readErrorMessage(errorValue));
      }
    };

    void pollOnce();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [authChallenge, client, pairingToken, refetchHealth]);

  const runtime = healthQuery.isError
    ? "offline"
    : !pairingToken
      ? "unpaired"
      : healthQuery.data?.auth.authenticated
        ? "ready"
        : "unauthenticated";

  const filteredSessions = useMemo(
    () =>
      sessions.filter((session) =>
        session.title.toLowerCase().includes(deferredSearch.trim().toLowerCase())
      ),
    [deferredSearch, sessions]
  );

  async function pairBridge() {
    try {
      const challenge = await client.startPairing({
        origin: window.location.origin
      });
      const session = await client.confirmPairing({
        code: challenge.code,
        origin: window.location.origin,
        pairingId: challenge.pairingId
      });
      store.getState().setPairingToken(session.token);
      setStatusNote("Bridge paired");
      await refetchHealth();
    } catch (errorValue) {
      setStatusNote(readErrorMessage(errorValue));
    }
  }

  async function startGitHubAuth() {
    try {
      const challenge = await client.startDeviceAuth({
        openInBrowser: true,
        organization: organizationDraft.trim() || undefined,
        origin: window.location.origin,
        token: pairingToken as string
      });
      setAuthChallenge(challenge);
      setStatusNote("Approve GitHub in the browser");
    } catch (errorValue) {
      setStatusNote(readErrorMessage(errorValue));
    }
  }

  async function sendMessage() {
    if (!activeSession || !pairingToken || !selectedModel || !activeSession.draft.trim()) {
      return;
    }

    const userMessage: ChatMessage = {
      content: activeSession.draft,
      id: createSessionId(),
      role: "user"
    };
    const assistantMessageId = createSessionId();
    const requestId = createSessionId();

    store.getState().appendMessage(activeSession.id, userMessage);
    store.getState().setDraft(activeSession.id, "");
    store.getState().appendMessage(activeSession.id, {
      content: "…",
      id: assistantMessageId,
      role: "assistant"
    });

    setPendingRequestId(requestId);
    setStatusNote("Streaming from local bridge");

    let assistantText = "";

    try {
      await client.streamChat(
        {
          origin: window.location.origin,
          request: {
            messages: [...activeSession.messages, userMessage],
            modelId: selectedModel,
            requestId
          },
          token: pairingToken
        },
        (event) => {
          if (event.type === "assistant_delta") {
            assistantText += event.data;
            startTransition(() => {
              store.getState().upsertMessage(activeSession.id, {
                content: assistantText,
                id: assistantMessageId,
                role: "assistant"
              });
            });
            return;
          }

          if (event.type === "assistant_done") {
            setStatusNote(`${event.usage.outputTokens} output tokens`);
            return;
          }

          setStatusNote(event.message);
        }
      );
    } catch (errorValue) {
      setStatusNote(readErrorMessage(errorValue));
    } finally {
      setPendingRequestId(null);
    }
  }

  async function stopStreaming(requestId: string, token: string) {
    try {
      await client.abortChat({
        origin: window.location.origin,
        requestId,
        token
      });
      setPendingRequestId(null);
      setStatusNote("Generation stopped");
    } catch (errorValue) {
      setStatusNote(readErrorMessage(errorValue));
    }
  }

  async function logout() {
    try {
      await client.logout();
      setAuthChallenge(null);
      setStatusNote("Local bridge logged out");
      await refetchHealth();
    } catch (errorValue) {
      setStatusNote(readErrorMessage(errorValue));
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Copilot Chat</p>
          <h1>Local bridge. Hosted shell. No secret leakage.</h1>
        </div>

        <nav className="nav-row" aria-label="Primary">
          <Link to="/chat">Chat</Link>
          <Link to="/install">Install</Link>
          <Link to="/diagnostics">Diagnostics</Link>
        </nav>

        <div className="status-card">
          <span className={`status-pill status-${runtime}`}>{runtime}</span>
          <p>{healthQuery.data?.auth.accountLabel ?? "Bridge-first runtime"}</p>
          <button className="ghost-button" onClick={() => void logout()} type="button">
            Logout
          </button>
        </div>

        <label className="search-box">
          <span>Search sessions</span>
          <input
            onChange={(event) => store.getState().setSessionSearch(event.target.value)}
            value={sessionSearch}
          />
        </label>

        <button
          className="new-thread"
          onClick={() => startTransition(() => store.getState().createSession(createSessionId()))}
          type="button"
        >
          New thread
        </button>

        <div className="session-list">
          {filteredSessions.map((session: AppSession) => (
            <button
              className={session.id === activeSessionId ? "session-row active" : "session-row"}
              key={session.id}
              onClick={() => store.getState().setActiveSession(session.id)}
              type="button"
            >
              <span>{session.title}</span>
              <small>{session.messages.length} msgs</small>
            </button>
          ))}
        </div>
      </aside>

      <main className="content-panel">
        <Routes>
          <Route
            element={
              <ChatRoute
                activeSession={activeSession}
                accountLabel={healthQuery.data?.auth.accountLabel ?? "GitHub Models"}
                authChallenge={authChallenge}
                organizationDraft={organizationDraft}
                models={modelsQuery.data ?? []}
                pairBridge={pairBridge}
                pendingRequestId={pendingRequestId}
                runtime={runtime}
                selectedModel={selectedModel}
                sendMessage={sendMessage}
                startGitHubAuth={startGitHubAuth}
                setOrganizationDraft={setOrganizationDraft}
                setDraft={(value) => {
                  if (activeSession) {
                    store.getState().setDraft(activeSession.id, value);
                  }
                }}
                setSelectedModel={setSelectedModel}
                statusNote={statusNote}
                stopStreaming={
                  pendingRequestId && pairingToken
                    ? () => stopStreaming(pendingRequestId, pairingToken)
                    : null
                }
              />
            }
            path="/chat"
          />
          <Route element={<InstallRoute />} path="/install" />
          <Route
            element={
              <DiagnosticsRoute
                pairingToken={pairingToken}
                runtime={runtime}
                version={healthQuery.data?.bridgeVersion ?? "offline"}
              />
            }
            path="/diagnostics"
          />
          <Route element={<Navigate replace to="/chat" />} path="*" />
        </Routes>
      </main>

      <aside className="settings-panel">
        <p className="eyebrow">Runtime</p>
        <h2>Production bridge rules</h2>
        <ul>
          <li>Auth lives in the bridge, not browser storage.</li>
          <li>Pairing gates every protected local call.</li>
          <li>Hosted Vercel UI never holds Copilot secrets.</li>
        </ul>
      </aside>
    </div>
  );
}

function ChatRoute(props: {
  activeSession: {
    draft: string;
    id: string;
    messages: ChatMessage[];
  } | null;
  accountLabel: string;
  authChallenge: AuthDeviceStartResponse | null;
  models: { id: string; label: string }[];
  organizationDraft: string;
  pairBridge(): Promise<void>;
  pendingRequestId: string | null;
  runtime: "offline" | "ready" | "unauthenticated" | "unpaired";
  selectedModel: string;
  sendMessage(): Promise<void>;
  startGitHubAuth(): Promise<void>;
  setDraft(value: string): void;
  setOrganizationDraft(value: string): void;
  setSelectedModel(value: string): void;
  statusNote: string;
  stopStreaming: (() => Promise<void>) | null;
}) {
  if (props.runtime === "offline") {
    return <InstallRoute />;
  }

  if (props.runtime === "unpaired") {
    return (
      <section className="hero-card">
        <p className="eyebrow">Bridge handshake</p>
        <h2>Pair your local bridge</h2>
        <p>The hosted shell found no paired localhost runtime yet.</p>
        {props.statusNote ? <p>{props.statusNote}</p> : null}
        <button className="primary-button" onClick={() => void props.pairBridge()} type="button">
          Pair bridge
        </button>
      </section>
    );
  }

  if (props.runtime === "unauthenticated") {
    return (
      <section className="hero-card">
        <p className="eyebrow">GitHub auth</p>
        <h2>Connect with GitHub</h2>
        <p>The local bridge owns auth. Browser never receives the GitHub secret.</p>
        {props.statusNote ? <p>{props.statusNote}</p> : null}
        <label className="search-box">
          <span>Organization slug optional</span>
          <input
            onChange={(event) => props.setOrganizationDraft(event.target.value)}
            placeholder="acme-inc"
            value={props.organizationDraft}
          />
        </label>
        {props.authChallenge ? (
          <div className="status-card">
            <p>Enter this code on GitHub:</p>
            <h3>{props.authChallenge.userCode}</h3>
            <p>Expires {new Date(props.authChallenge.expiresAt).toLocaleTimeString()}</p>
            <a href={props.authChallenge.verificationUri} rel="noreferrer" target="_blank">
              Open GitHub verification
            </a>
          </div>
        ) : null}
        <button className="primary-button" onClick={() => void props.startGitHubAuth()} type="button">
          Connect with GitHub
        </button>
      </section>
    );
  }

  return (
    <section className="chat-layout">
      <header className="chat-header">
        <div>
          <p className="eyebrow">Connected operator</p>
          <h2>{props.accountLabel}</h2>
        </div>

        <label className="model-picker">
          <span>Model</span>
          <select onChange={(event) => props.setSelectedModel(event.target.value)} value={props.selectedModel}>
            {props.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="thread-card">
        {(props.activeSession?.messages ?? []).map((message) => (
          <article className={`message message-${message.role}`} key={message.id}>
            <span>{message.role}</span>
            <p>{message.content}</p>
          </article>
        ))}
      </div>

      <footer className="composer-card">
        <textarea
          onChange={(event) => props.setDraft(event.target.value)}
          placeholder="Ask through your local Copilot bridge"
          value={props.activeSession?.draft ?? ""}
        />
        <div className="composer-row">
          <p>{props.statusNote}</p>
          {props.pendingRequestId && props.stopStreaming ? (
            <button className="ghost-button" onClick={() => void props.stopStreaming?.()} type="button">
              Stop
            </button>
          ) : null}
          <button className="primary-button" onClick={() => void props.sendMessage()} type="button">
            Send
          </button>
        </div>
      </footer>
    </section>
  );
}

function InstallRoute() {
  return (
    <section className="hero-card">
      <p className="eyebrow">Bridge install</p>
      <h2>Install the bridge</h2>
      <p>This UI is live on Vercel. Inference still runs through your localhost bridge.</p>
      <div className="platform-grid">
        <article>
          <span>macOS</span>
          <p>Signed `.dmg` helper with login auto-start.</p>
        </article>
        <article>
          <span>Windows</span>
          <p>Signed installer with update channel manifest.</p>
        </article>
        <article>
          <span>Linux</span>
          <p>Portable artifact plus checksum metadata.</p>
        </article>
      </div>
    </section>
  );
}

function DiagnosticsRoute(props: { pairingToken: string | null; runtime: string; version: string }) {
  return (
    <section className="hero-card">
      <p className="eyebrow">Diagnostics</p>
      <h2>Runtime facts</h2>
      <dl className="diagnostics-grid">
        <div>
          <dt>Bridge version</dt>
          <dd>{props.version}</dd>
        </div>
        <div>
          <dt>Runtime state</dt>
          <dd>{props.runtime}</dd>
        </div>
        <div>
          <dt>Paired</dt>
          <dd>{props.pairingToken ? "yes" : "no"}</dd>
        </div>
      </dl>
    </section>
  );
}

function readErrorMessage(errorValue: unknown) {
  return errorValue instanceof Error ? errorValue.message : "bridge_request_failed";
}
