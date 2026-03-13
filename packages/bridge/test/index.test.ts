import { describe, expect, it } from "vitest";

import * as bridge from "../src/index";

describe("bridge exports", () => {
  it("re-exports the public bridge modules", () => {
    expect(bridge.AuthSessionManager).toBeTypeOf("function");
    expect(bridge.GitHubModelsClient).toBeTypeOf("function");
    expect(bridge.MacOsKeychainStore).toBeTypeOf("function");
    expect(bridge.ModelRegistry).toBeTypeOf("function");
    expect(bridge.PairingService).toBeTypeOf("function");
    expect(bridge.normalizeUpstreamEvent).toBeTypeOf("function");
  });
});
