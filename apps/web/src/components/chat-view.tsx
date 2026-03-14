import type { ChatMessage } from "@copilotchat/shared";
import { MessageSquare } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { ScrollArea } from "./ui/scroll-area";
import { Badge } from "./ui/badge";
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
    <div className="flex flex-col h-full">
      {/* Topbar */}
      <header className="flex items-center justify-between gap-4 px-6 py-4 border-b">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{props.accountLabel}</h2>
          <Badge variant="success" className="font-mono text-[10px]">
            {props.statusNote || "Ready for chat"}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
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
        </div>
      </header>

      {/* Thread */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-6">
          {messages.length > 0 ? (
            <div className="flex flex-col gap-5 max-w-3xl mx-auto">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted mb-4">
                <MessageSquare className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold tracking-tight mb-2">Ask GitHub Models</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Each send is one non-streaming serverless round-trip through the hosted BFF.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Composer */}
      <footer className="border-t px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <label className="sr-only" htmlFor="chat-input">
            Message
          </label>
          <Textarea
            id="chat-input"
            aria-label="Message"
            className="min-h-[100px] resize-none mb-3"
            onChange={(event) => props.setDraft(event.target.value)}
            placeholder="Send a message..."
            value={props.activeSession?.draft ?? ""}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {props.statusNote || "One function invocation per prompt."}
            </p>
            <Button
              disabled={props.isSending}
              onClick={() => void props.sendMessage()}
              size="sm"
            >
              {props.isSending ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
