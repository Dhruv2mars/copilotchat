import { describe, expect, it, vi } from "vitest";

import {
  ModelRegistry,
  type BridgeModelSource
} from "../src/model-registry";

describe("ModelRegistry", () => {
  it("filters non-chat or unavailable models and caches results", async () => {
    const source: BridgeModelSource = {
      fetchModels: vi.fn().mockResolvedValue([
        {
          id: "gpt-4.1",
          label: "GPT-4.1",
          capabilities: ["chat"],
          status: "available"
        },
        {
          id: "embeddings-1",
          label: "Embeddings",
          capabilities: ["embeddings"],
          status: "available"
        },
        {
          id: "gpt-4o",
          label: "GPT-4o",
          capabilities: ["chat"],
          status: "maintenance"
        }
      ])
    };

    const registry = new ModelRegistry({
      cacheTtlMs: 30_000,
      source,
      now: () => Date.parse("2026-03-13T10:00:00.000Z")
    });

    await expect(registry.list()).resolves.toEqual([
      {
        id: "gpt-4.1",
        label: "GPT-4.1"
      }
    ]);

    await registry.list();

    expect(source.fetchModels).toHaveBeenCalledTimes(1);
  });
});
