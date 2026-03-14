import { describe, expect, it } from "vitest";

import { resolveAllowedOrigins } from "./bridge-config";

describe("resolveAllowedOrigins", () => {
  it("includes localhost and prod origins by default", () => {
    expect(resolveAllowedOrigins()).toEqual([
      "http://localhost:5173",
      "https://copilotchat.vercel.app"
    ]);
  });

  it("supports comma-separated overrides", () => {
    expect(resolveAllowedOrigins("https://one.test, https://two.test")).toEqual([
      "https://one.test",
      "https://two.test"
    ]);
  });
});
