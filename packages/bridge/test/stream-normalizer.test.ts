import { describe, expect, it } from "vitest";

import { normalizeUpstreamEvent } from "../src/stream-normalizer";

describe("normalizeUpstreamEvent", () => {
  it("maps upstream delta, done, and error events into stable bridge events", () => {
    expect(
      normalizeUpstreamEvent({
        type: "delta",
        delta: "hel"
      })
    ).toEqual({
      data: "hel",
      type: "assistant_delta"
    });

    expect(
      normalizeUpstreamEvent({
        type: "done",
        usage: {
          inputTokens: 10,
          outputTokens: 20
        }
      })
    ).toEqual({
      type: "assistant_done",
      usage: {
        inputTokens: 10,
        outputTokens: 20
      }
    });

    expect(
      normalizeUpstreamEvent({
        message: "copilot_unavailable",
        type: "error"
      })
    ).toEqual({
      message: "copilot_unavailable",
      type: "assistant_error"
    });
  });
});
