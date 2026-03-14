import type { ChatMessage } from "@copilotchat/shared";
import { MessageSquare, Send, Square } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "../lib/utils";
import { MessageBubble } from "./message-bubble";
import { ModelSelector } from "./model-selector";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export function ChatView(props: {
  activeSession: {
    draft: string;
    id: string;
    messages: ChatMessage[];
  } | null;
  isSending: boolean;
  models: { id: string; label: string }[];
  onStop?: () => void;
  selectedModel: string;
  sendMessage(): Promise<void>;
  setDraft(value: string): void;
  setSelectedModel(value: string): void;
  statusNote: string;
}) {
  const messages = props.activeSession?.messages ?? [];
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const selectedModelLabel =
    props.models.find((m) => m.id === props.selectedModel)?.label ?? null;

  // auto-scroll on new messages / streaming
  useEffect(() => {
    if (shouldAutoScroll.current && bottomRef.current) {
      /* v8 ignore next -- jsdom has no scrollIntoView */
      bottomRef.current.scrollIntoView?.({ behavior: "smooth" });
    }
  }, [messages]);

  /* v8 ignore next 6 -- jsdom has no scroll geometry */
  function handleScroll() {
    const el = scrollAreaRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScroll.current = distanceFromBottom < 80;
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!props.isSending) {
        void props.sendMessage();
      }
    }
  }

  const draft = props.activeSession?.draft ?? "";
  const canSend = Boolean(draft.trim()) && Boolean(props.selectedModel) && !props.isSending;

  return (
    <div className="flex h-full flex-col">
      {/* minimal header: model selector + status */}
      <header className="flex items-center justify-between border-b px-4 py-2">
        <ModelSelector
          models={props.models}
          selectedModel={props.selectedModel}
          setSelectedModel={props.setSelectedModel}
        />
        {props.statusNote ? (
          <span className="truncate text-xs text-muted-foreground max-w-[50%]">
            {props.statusNote}
          </span>
        ) : null}
      </header>

      {/* message area */}
      <div
        ref={scrollAreaRef}
        className="flex-1 min-h-0 overflow-y-auto"
        onScroll={handleScroll}
      >
        <div className="px-4 py-6">
          {messages.length > 0 ? (
            <div className="mx-auto flex max-w-3xl flex-col gap-6">
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  modelLabel={selectedModelLabel}
                />
              ))}
              <div ref={bottomRef} />
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
      </div>

      {/* input area */}
      <footer className="border-t px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <div className="relative">
            <label className="sr-only" htmlFor="chat-input">
              Message
            </label>
            <Textarea
              id="chat-input"
              aria-label="Message"
              className={cn(
                "min-h-[56px] max-h-[200px] resize-none pr-12 text-sm",
                "rounded-xl border-border/60 bg-background",
                "focus-visible:ring-1 focus-visible:ring-ring"
              )}
              onChange={(event) => props.setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Send a message..."
              rows={1}
              value={draft}
            />
            <div className="absolute bottom-2 right-2">
              {props.isSending ? (
                <Button
                  aria-label="Stop generating"
                  className="h-8 w-8 rounded-lg"
                  onClick={props.onStop}
                  size="icon"
                  type="button"
                  variant="destructive"
                >
                  <Square className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  aria-label="Send"
                  className={cn(
                    "h-8 w-8 rounded-lg",
                    canSend ? "" : "opacity-40"
                  )}
                  disabled={!canSend}
                  onClick={() => void props.sendMessage()}
                  size="icon"
                  type="button"
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground/60">
            Streaming through local bridge. Shift+Enter for new line.
          </p>
        </div>
      </footer>
    </div>
  );
}
