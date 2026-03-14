import type { ChatMessage } from "@copilotchat/shared";
import {
  Activity,
  LogOut,
  MessageCircle,
  MessageSquarePlus,
  Monitor,
  Moon,
  Search,
  Sun
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { cn } from "../lib/utils";
import { useTheme } from "./theme-provider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";

type RuntimeState = "bridge_offline" | "loading" | "ready" | "signed_out";

export function Sidebar(props: {
  accountLabel: string;
  activeSessionId: string | null;
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
  const { theme, setTheme } = useTheme();

  /* v8 ignore next 4 */
  function cycleTheme() {
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
  }

  /* v8 ignore next 3 */
  const themeIcon =
    theme === "light" ? <Sun className="h-4 w-4" /> :
    theme === "dark" ? <Moon className="h-4 w-4" /> :
    <Monitor className="h-4 w-4" />;

  return (
    <aside className="flex h-full w-[280px] flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="px-4 py-5">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-base font-semibold tracking-tight">Copilot Chat</h1>
          <Button className="h-8 w-8" onClick={cycleTheme} size="icon" type="button" variant="ghost">
            {themeIcon}
          </Button>
        </div>

        <Button
          className="w-full justify-start gap-2"
          disabled={props.runtime !== "ready"}
          onClick={props.startNewThread}
          size="sm"
          type="button"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New thread
        </Button>
      </div>

      <Separator />

      <nav aria-label="Primary" className="px-3 py-3">
        <div className="flex flex-col gap-1">
          <Link
            className={navClassName(location.pathname === "/chat")}
            to="/chat"
          >
            <MessageCircle className="h-4 w-4" />
            Chat
          </Link>
          <Link
            className={navClassName(location.pathname === "/diagnostics")}
            to="/diagnostics"
          >
            <Activity className="h-4 w-4" />
            Diagnostics
          </Link>
        </div>
      </nav>

      <Separator />

      <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
        <div className="mb-3 flex items-center gap-2 px-1">
          <p className="flex-1 text-xs font-mono uppercase tracking-widest text-muted-foreground">
            Threads
          </p>
        </div>

        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search sessions"
            className="h-9 pl-9 text-sm"
            disabled={props.runtime !== "ready"}
            onChange={(event) => props.setSessionSearch(event.target.value)}
            placeholder="Find a thread..."
            value={props.sessionSearch}
          />
        </div>

        <ScrollArea className="flex-1 -mx-1">
          <div className="flex flex-col gap-0.5 px-1">
            {props.filteredSessions.length ? (
              props.filteredSessions.map((session) => (
                <button
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                    session.id === props.activeSessionId
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                  key={session.id}
                  onClick={() => props.switchSession(session.id)}
                  type="button"
                >
                  <span className="truncate">{session.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {session.messages.length} msgs
                  </span>
                </button>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-xs text-muted-foreground">
                  {props.activeSessionId ? "No search matches." : "Create first thread."}
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <Separator />

      <div className="space-y-2 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Badge
              variant={
                props.runtime === "ready" ? "success" :
                props.runtime === "loading" ? "secondary" :
                props.runtime === "bridge_offline" ? "destructive" :
                "warning"
              }
              className="font-mono text-[10px] shrink-0"
            >
              {formatRuntimeLabel(props.runtime)}
            </Badge>
            <span className="truncate text-sm font-medium">{props.accountLabel}</span>
          </div>
          {props.runtime === "ready" ? (
            <Button
              className="h-8 w-8 shrink-0"
              onClick={() => void props.logout()}
              size="icon"
              type="button"
              variant="ghost"
            >
              <LogOut className="h-4 w-4" />
              <span className="sr-only">Logout</span>
            </Button>
          ) : null}
        </div>
        {props.statusNote ? (
          <p className="truncate text-xs text-muted-foreground">{props.statusNote}</p>
        ) : null}
      </div>
    </aside>
  );
}

function formatRuntimeLabel(runtime: RuntimeState) {
  if (runtime === "ready") return "Ready";
  if (runtime === "loading") return "Loading";
  if (runtime === "bridge_offline") return "Offline";
  return "Signed out";
}

function navClassName(active: boolean) {
  return cn(
    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
  );
}
