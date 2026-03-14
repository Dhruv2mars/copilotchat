import type { ChatMessage } from "@copilotchat/shared";
import { MessageSquare } from "lucide-react";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
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

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{props.accountLabel}</h2>
          <Badge variant="success" className="font-mono text-[10px]">
            {props.statusNote || "Ready for chat"}
          </Badge>
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-mono text-xs uppercase tracking-wide">Model</span>
          <select
            aria-label="Model"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
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
