import type { ChatMessage } from "@copilotchat/shared";
import { Bot, User } from "lucide-react";
import { cn } from "../lib/utils";

export function MessageBubble(props: { message: ChatMessage }) {
  const isUser = props.message.role === "user";

  return (
    <article
      className={cn(
        "flex gap-3 animate-fade-in",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border mt-0.5",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      <div
        className={cn(
          "flex flex-col gap-1 max-w-[75%]",
          isUser ? "items-end" : "items-start"
        )}
      >
        <span className="text-xs font-medium text-muted-foreground font-mono uppercase tracking-wide">
          {props.message.role}
        </span>
        <div
          className={cn(
            "rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : "bg-muted text-foreground rounded-tl-sm"
          )}
        >
          <p className="m-0">{props.message.content}</p>
        </div>
      </div>
    </article>
  );
}
