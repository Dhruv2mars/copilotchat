import type { ChatMessage } from "@copilotchat/shared";
import {
  MessageSquarePlus,
  Search,
  LogOut,
  Sun,
  Moon,
  Monitor,
  MessageCircle,
  Shield,
  Activity
} from "lucide-react";
import { useLocation, Link } from "react-router-dom";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";
import { Badge } from "./ui/badge";
import { useTheme } from "./theme-provider";
import { cn } from "../lib/utils";

type RuntimeState = "loading" | "ready" | "signed_out";

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

  /* v8 ignore next 4 -- theme cycling requires ThemeProvider context not present in unit tests */
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
    <aside className="flex flex-col h-full w-[280px] border-r bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="px-4 py-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-base font-semibold tracking-tight">Copilot Chat</h1>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={cycleTheme} type="button">
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

      {/* Navigation */}
      <nav aria-label="Primary" className="px-3 py-3">
        <div className="flex flex-col gap-1">
          <Link
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              location.pathname === "/chat"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
            to="/chat"
          >
            <MessageCircle className="h-4 w-4" />
            Chat
          </Link>
          <Link
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              location.pathname === "/access"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
            to="/access"
          >
            <Shield className="h-4 w-4" />
            Access
          </Link>
          <Link
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              location.pathname === "/diagnostics"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
            to="/diagnostics"
          >
            <Activity className="h-4 w-4" />
            Diagnostics
          </Link>
        </div>
      </nav>

      <Separator />

      {/* Sessions */}
      <div className="flex-1 flex flex-col min-h-0 px-3 py-3">
        <div className="flex items-center gap-2 mb-3 px-1">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex-1">
            Threads
          </p>
        </div>

        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search sessions"
            className="pl-9 h-9 text-sm"
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
                    "flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors w-full",
                    session.id === props.activeSessionId
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                  key={session.id}
                  onClick={() => props.switchSession(session.id)}
                  type="button"
                >
                  <span className="truncate">{session.title}</span>
                  <span className="text-xs shrink-0 tabular-nums text-muted-foreground">
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

      {/* Footer */}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Badge
              variant={
                props.runtime === "ready" ? "success" :
                props.runtime === "loading" ? "secondary" :
                "warning"
              }
              className="font-mono text-[10px] shrink-0"
            >
              {formatRuntimeLabel(props.runtime)}
            </Badge>
            <span className="text-sm font-medium truncate">{props.accountLabel}</span>
          </div>
          {props.runtime === "ready" ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => void props.logout()}
              type="button"
            >
              <LogOut className="h-4 w-4" />
              <span className="sr-only">Logout</span>
            </Button>
          ) : null}
        </div>
        {props.statusNote ? (
          <p className="text-xs text-muted-foreground truncate">{props.statusNote}</p>
        ) : null}
      </div>
    </aside>
  );
}

function formatRuntimeLabel(runtime: RuntimeState) {
  if (runtime === "ready") return "Ready";
  if (runtime === "loading") return "Loading";
  return "Signed out";
}
