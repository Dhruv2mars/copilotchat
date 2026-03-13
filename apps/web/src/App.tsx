import { useQuery } from "@tanstack/react-query";
import type { AuthDeviceStartResponse, ChatMessage } from "@copilotchat/shared";
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useStore } from "zustand";

import type { AppSession, AppStore } from "./app-store";
import { createSessionId } from "./app-store";
import type { BridgeClient } from "./bridge-client";

import "./styles.css";

type RuntimeState = "offline" | "ready" | "unauthenticated" | "unpaired";

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

  const runtime: RuntimeState = healthQuery.isError
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
      <CommandRail
        activeSessionId={activeSessionId}
        activeSessionTitle={activeSession?.title ?? "No thread selected"}
        accountLabel={healthQuery.data?.auth.accountLabel ?? "Bridge-first runtime"}
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
                activeSession={activeSession}
                accountLabel={healthQuery.data?.auth.accountLabel ?? "GitHub Models"}
                authChallenge={authChallenge}
                models={modelsQuery.data ?? []}
                organizationDraft={organizationDraft}
                pairBridge={pairBridge}
                pendingRequestId={pendingRequestId}
                runtime={runtime}
                selectedModel={selectedModel}
                sendMessage={sendMessage}
                setDraft={(value) => {
                  if (activeSession) {
                    store.getState().setDraft(activeSession.id, value);
                  }
                }}
                setOrganizationDraft={setOrganizationDraft}
                setSelectedModel={setSelectedModel}
                startGitHubAuth={startGitHubAuth}
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

      <RuntimeAside
        bridgeVersion={healthQuery.data?.bridgeVersion ?? "offline"}
        modelCount={modelsQuery.data?.length ?? 0}
        runtime={runtime}
      />
    </div>
  );
}

function CommandRail(props: {
  activeSessionId: string | null;
  activeSessionTitle: string;
  accountLabel: string;
  filteredSessions: AppSession[];
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
        <h1>Bridge control, not browser theater.</h1>
        <p className="lead-copy">
          Hosted shell on Vercel. Auth and inference stay local, visible, and recoverable.
        </p>
      </div>

      <nav aria-label="Primary" className="nav-cluster">
        <Link className={location.pathname === "/chat" ? "nav-link active" : "nav-link"} to="/chat">
          Chat
        </Link>
        <Link className={location.pathname === "/install" ? "nav-link active" : "nav-link"} to="/install">
          Install
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

function RuntimeAside(props: { bridgeVersion: string; modelCount: number; runtime: RuntimeState }) {
  return (
    <aside className="runtime-aside">
      <section className="rail-card policy-card">
        <p className="eyebrow">Runtime policy</p>
        <h2>Production guardrails</h2>
        <ul className="policy-list">
          <li>Bridge keeps secrets in keychain, not browser.</li>
          <li>Pairing gates localhost APIs before chat unlocks.</li>
          <li>Hosted UI stays stateless about Copilot auth.</li>
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
            <span>Bridge</span>
            <strong>{props.bridgeVersion}</strong>
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

export function ChatRoute(props: {
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
  runtime: RuntimeState;
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
      <section className="stage stage-hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Bridge handshake</p>
            <h2>Pair your local bridge</h2>
            <p>
              Chat stays locked until the browser proves it is talking to your localhost runtime, not a hosted fake.
            </p>
            {props.statusNote ? <p className="hero-note">{props.statusNote}</p> : null}
            <button className="primary-button" onClick={() => void props.pairBridge()} type="button">
              Pair bridge
            </button>
          </div>
          <div className="hero-side">
            <div className="signal-card">
              <span>01</span>
              <p>Detect bridge on localhost.</p>
            </div>
            <div className="signal-card">
              <span>02</span>
              <p>Exchange short-lived pairing proof.</p>
            </div>
            <div className="signal-card">
              <span>03</span>
              <p>Unlock auth and model calls.</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (props.runtime === "unauthenticated") {
    return (
      <section className="stage stage-hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">GitHub auth</p>
            <h2>Connect with GitHub</h2>
            <p>Authorize once. Token lands in the bridge keychain. Browser only sees runtime status.</p>
            {props.statusNote ? <p className="hero-note">{props.statusNote}</p> : null}
            <label className="search-box hero-input">
              <span>Organization slug optional</span>
              <input
                aria-label="Organization slug optional"
                onChange={(event) => props.setOrganizationDraft(event.target.value)}
                placeholder="acme-inc"
                value={props.organizationDraft}
              />
            </label>
            <button className="primary-button" onClick={() => void props.startGitHubAuth()} type="button">
              Connect with GitHub
            </button>
          </div>

          <div className="hero-side">
            {props.authChallenge ? (
              <div className="challenge-card">
                <p className="eyebrow">Device code</p>
                <h3>{props.authChallenge.userCode}</h3>
                <p>Expires {new Date(props.authChallenge.expiresAt).toLocaleTimeString()}</p>
                <a href={props.authChallenge.verificationUri} rel="noreferrer" target="_blank">
                  Open GitHub verification
                </a>
              </div>
            ) : (
              <div className="challenge-card challenge-card-idle">
                <p className="eyebrow">Auth path</p>
                <h3>Browser redirect via bridge</h3>
                <p>Device flow opens GitHub, bridge polls, UI refreshes when ready.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  const messages = props.activeSession === null ? [] : props.activeSession.messages;
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
        <h3>Ask through your local Copilot bridge</h3>
        <p>Streaming lands here. Abort, retry, and recovery stay visible instead of hidden behind hosted magic.</p>
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
          placeholder="Ask through your local Copilot bridge"
          value={props.activeSession?.draft ?? ""}
        />
        <div className="composer-row">
          <p>{props.statusNote || "Local stream path armed."}</p>
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
    <section className="stage stage-hero">
      <div className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">Bridge install</p>
          <h2>Install the bridge</h2>
          <p>The Vercel app is public. Auth, models, and chat still require the local runtime on this machine.</p>
        </div>
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
      </div>
    </section>
  );
}

function DiagnosticsRoute(props: { pairingToken: string | null; runtime: string; version: string }) {
  return (
    <section className="stage stage-hero">
      <div className="diagnostics-head">
        <p className="eyebrow">Diagnostics</p>
        <h2>Runtime facts</h2>
      </div>
      <dl className="diagnostics-grid">
        <div>
          <dt>Pairing</dt>
          <dd>{props.pairingToken ? "yes" : "no"}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{props.runtime}</dd>
        </div>
        <div>
          <dt>Bridge version</dt>
          <dd>{props.version}</dd>
        </div>
      </dl>
    </section>
  );
}

export function formatRuntimeLabel(runtime: RuntimeState) {
  if (runtime === "ready") return "Ready";
  if (runtime === "offline") return "Offline";
  if (runtime === "unpaired") return "Unpaired";
  return "Auth required";
}

export function runtimeSummary(runtime: RuntimeState) {
  if (runtime === "offline") return "Bridge not reachable on localhost.";
  if (runtime === "unpaired") return "Pairing required before protected calls.";
  if (runtime === "unauthenticated") return "GitHub auth still pending in bridge.";
  return "Inference path armed.";
}

export function readErrorMessage(errorValue: unknown) {
  if (errorValue instanceof Error) {
    return errorValue.message;
  }

  if (typeof errorValue === "string") {
    return errorValue;
  }

  return "bridge_request_failed";
}
