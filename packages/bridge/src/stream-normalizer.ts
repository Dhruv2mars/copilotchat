export type UpstreamEvent =
  | { type: "delta"; delta: string }
  | { type: "done"; usage: { inputTokens: number; outputTokens: number } }
  | { type: "error"; message: string };

export function normalizeUpstreamEvent(event: UpstreamEvent) {
  switch (event.type) {
    case "delta":
      return {
        data: event.delta,
        type: "assistant_delta" as const
      };
    case "done":
      return {
        type: "assistant_done" as const,
        usage: event.usage
      };
    case "error":
      return {
        message: event.message,
        type: "assistant_error" as const
      };
  }
}
