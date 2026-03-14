import type { ChatMessage } from "@copilotchat/shared";
import { Bot, User } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "../lib/utils";

export function MessageBubble(props: {
  message: ChatMessage;
  modelLabel?: string | null;
}) {
  const isUser = props.message.role === "user";
  const label = isUser ? "You" : (props.modelLabel ?? "Assistant");
  const isStreaming = !isUser && !props.message.content;

  return (
    <article className="animate-fade-in">
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          {isUser ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
        </div>
        <span className="text-sm font-semibold">{label}</span>
      </div>

      <div className="pl-8">
        {isStreaming ? (
          <div className="flex items-center gap-1 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse [animation-delay:0.2s]" />
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse [animation-delay:0.4s]" />
          </div>
        ) : isUser ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {props.message.content}
          </p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-code:before:content-none prose-code:after:content-none prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm">
            <Markdown remarkPlugins={[remarkGfm]}>
              {props.message.content}
            </Markdown>
          </div>
        )}
      </div>
    </article>
  );
}
