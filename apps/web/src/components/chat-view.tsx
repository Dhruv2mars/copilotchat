import type { ChatMessage } from "@copilotchat/shared";
import { MessageSquare, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Textarea } from "./ui/textarea";
import { MessageBubble } from "./message-bubble";

export function ChatView(props: {
  accountLabel: string;
  activeSession: {
    draft: string;
    id: string;
    messages: ChatMessage[];
  } | null;
  isSending: boolean;
  models: { id: string; label: string }[];
  selectedModel: string;
  sendMessage(): Promise<void>;
  setDraft(value: string): void;
  setSelectedModel(value: string): void;
  statusNote: string;
}) {
  const messages = props.activeSession?.messages ?? [];
  const [modelQuery, setModelQuery] = useState("");
  const selectedModel = props.models.find((model) => model.id === props.selectedModel) ?? null;
  const normalizedModelQuery = modelQuery.trim().toLowerCase();
  const filteredModels = useMemo(
    () =>
      props.models.filter((model) => {
        if (!normalizedModelQuery) {
          return true;
        }

        return (
          model.label.toLowerCase().includes(normalizedModelQuery) ||
          model.id.toLowerCase().includes(normalizedModelQuery)
        );
      }),
    [normalizedModelQuery, props.models]
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-4 border-b px-6 py-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{props.accountLabel}</h2>
          <Badge variant="success" className="font-mono text-[10px]">
            {props.statusNote || "Ready for chat"}
          </Badge>
        </div>

        <div className="w-full max-w-xl xl:min-w-[24rem]">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">Model</span>
            {selectedModel ? (
              <span className="truncate text-xs font-medium text-muted-foreground">{selectedModel.label}</span>
            ) : null}
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/70 p-2 shadow-sm backdrop-blur">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search models"
                className="h-11 rounded-xl border-transparent bg-background/80 pl-9 text-sm font-medium shadow-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
                onChange={(event) => setModelQuery(event.target.value)}
                placeholder={
                  selectedModel ? `Search models. Current: ${selectedModel.label}` : "Search models"
                }
                value={modelQuery}
              />
            </div>

            <ul aria-label="Model results" className="mt-2 grid max-h-48 gap-1 overflow-y-auto">
              {filteredModels.length > 0 ? (
                filteredModels.map((model) => {
                  const isSelected = model.id === props.selectedModel;

                  return (
                    <li key={model.id}>
                      <button
                        className={[
                          "flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "bg-transparent hover:bg-accent hover:text-accent-foreground"
                        ].join(" ")}
                        onClick={() => {
                          props.setSelectedModel(model.id);
                          setModelQuery("");
                        }}
                        type="button"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{model.label}</span>
                          <span
                            className={[
                              "block truncate text-[11px]",
                              isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
                            ].join(" ")}
                          >
                            {model.id}
                          </span>
                        </span>
                        {isSelected ? (
                          <span className="rounded-full border border-primary-foreground/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]">
                            Live
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              ) : (
                <li className="rounded-xl border border-dashed border-border/80 px-3 py-6 text-center text-sm text-muted-foreground">
                  No models match.
                </li>
              )}
            </ul>
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-6">
          {messages.length > 0 ? (
            <div className="mx-auto flex max-w-3xl flex-col gap-5">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                <MessageSquare className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-xl font-semibold tracking-tight">Ask GitHub Copilot</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                Prompts stream through the local bridge so chat feels like a normal assistant.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      <footer className="border-t px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <label className="sr-only" htmlFor="chat-input">
            Message
          </label>
          <Textarea
            id="chat-input"
            aria-label="Message"
            className="mb-3 min-h-[100px] resize-none"
            onChange={(event) => props.setDraft(event.target.value)}
            placeholder="Send a message..."
            value={props.activeSession?.draft ?? ""}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {props.statusNote || "Streaming through local bridge."}
            </p>
            <Button disabled={props.isSending} onClick={() => void props.sendMessage()} size="sm">
              {props.isSending ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
