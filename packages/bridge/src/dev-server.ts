import type { AuthConnectRequest, BridgeStreamEvent, ChatStreamRequest } from "@copilotchat/shared";

import { AuthSessionManager, type SecureStore } from "./auth-session-manager";
import { createBridgeServer } from "./bridge-server";
import { GitHubModelsClient } from "./github-models-client";
import { MacOsKeychainStore } from "./macos-keychain-store";
import { ModelRegistry } from "./model-registry";
import { PairingService } from "./pairing-service";

class MemoryStore implements SecureStore {
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
const fakeMode = process.env.BRIDGE_FAKE_MODE === "1";
const modelsClient = new GitHubModelsClient();
const auth = new AuthSessionManager({
  provider: fakeMode
    ? {
        async connect(input: AuthConnectRequest) {
          return {
            accountLabel: "fake-user",
            organization: input.organization?.trim() || undefined,
            token: input.token.trim(),
            tokenHint: "fake...token"
          };
        }
      }
    : modelsClient,
  store: createSecureStore()
});

const server = createBridgeServer({
  auth,
  bridgeVersion: "2.0.0",
  chatGateway: fakeMode
    ? {
        async *streamChat(
          request: ChatStreamRequest,
          signal: AbortSignal
        ): AsyncGenerator<BridgeStreamEvent> {
          const prompt = request.messages.at(-1)?.content ?? "Ready.";
          const reply = `Fake bridge online. ${prompt}`;

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

            await Bun.sleep(12);
          }

          yield {
            type: "assistant_done",
            usage: {
              inputTokens: prompt.length,
              outputTokens: reply.length
            }
          };
        }
      }
    : {
        async *streamChat(
          request: ChatStreamRequest,
          signal: AbortSignal
        ): AsyncGenerator<BridgeStreamEvent> {
          const session = await auth.getStoredSession();
          if (!session) {
            throw new Error("auth_required");
          }

          yield* modelsClient.streamChat({
            organization: session.organization,
            request,
            signal,
            token: session.token
          });
        }
      },
  modelRegistry: new ModelRegistry({
    cacheTtlMs: 60_000,
    now: () => Date.now(),
    source: {
      async fetchModels() {
        const session = await auth.getStoredSession();
        if (!session) {
          throw new Error("auth_required");
        }

        return fakeMode
          ? [
              {
                capabilities: ["chat"],
                id: "gpt-4.1",
                label: "GPT-4.1",
                status: "available" as const
              },
              {
                capabilities: ["chat"],
                id: "gpt-4.5",
                label: "GPT-4.5",
                status: "available" as const
              }
            ]
          : modelsClient.listModels({
              organization: session.organization,
              token: session.token
            });
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
console.log(fakeMode ? "bridge mode: fake" : "bridge mode: live github-models");

function createSecureStore() {
  return process.platform === "darwin" && !fakeMode
    ? new MacOsKeychainStore()
    : new MemoryStore();
}
