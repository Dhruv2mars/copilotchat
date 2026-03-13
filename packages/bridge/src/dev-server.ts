import type { BridgeStreamEvent, ChatStreamRequest } from "@copilotchat/shared";

import { AuthSessionManager } from "./auth-session-manager";
import { createBridgeServer } from "./bridge-server";
import { ModelRegistry } from "./model-registry";
import { PairingService } from "./pairing-service";

class MemoryStore {
  private readonly map = new Map<string, string>();

  async get(key: string) {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.map.set(key, value);
  }

  async delete(key: string) {
    this.map.delete(key);
  }
}

const port = Number(process.env.BRIDGE_PORT ?? "8787");
const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "http://localhost:5173";

const server = createBridgeServer({
  auth: new AuthSessionManager({
    store: new MemoryStore()
  }),
  bridgeVersion: "1.0.0",
  chatGateway: {
    async *streamChat(request: ChatStreamRequest, signal: AbortSignal): AsyncGenerator<BridgeStreamEvent> {
      const prompt = request.messages.at(-1)?.content ?? "Ready.";
      const reply = `Local bridge online. ${prompt}`;

      for (const chunk of reply.split(" ")) {
        if (signal.aborted) {
          yield {
            message: "stream_aborted",
            type: "assistant_error"
          };
          return;
        }

        yield {
          data: `${chunk} `,
          type: "assistant_delta"
        };

        await Bun.sleep(24);
      }

      yield {
        type: "assistant_done",
        usage: {
          inputTokens: prompt.length,
          outputTokens: reply.length
        }
      };
    }
  },
  modelRegistry: new ModelRegistry({
    cacheTtlMs: 60_000,
    now: () => Date.now(),
    source: {
      async fetchModels() {
        return [
          {
            capabilities: ["chat"],
            id: "gpt-4.1",
            label: "GPT-4.1",
            status: "available"
          },
          {
            capabilities: ["chat"],
            id: "gpt-4.5",
            label: "GPT-4.5",
            status: "available"
          }
        ];
      }
    }
  }),
  pairing: new PairingService({
    allowedOrigins: [allowedOrigin],
    challengeTtlMs: 60_000,
    clock: {
      now: () => new Date()
    },
    tokenTtlMs: 3_600_000
  })
});

Bun.serve({
  fetch(request) {
    return server.handle(request);
  },
  hostname: "127.0.0.1",
  port
});

console.log(`bridge listening on http://127.0.0.1:${port}`);
console.log(`allowed origin: ${allowedOrigin}`);
