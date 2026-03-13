import type { BridgeStreamEvent, ChatStreamRequest } from "@copilotchat/shared";

import { AuthSessionManager, type AuthProvider, type SecureStore } from "./auth-session-manager";
import { createBridgeServer } from "./bridge-server";
import { GitHubDeviceFlowClient } from "./github-device-flow-client";
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
const defaultGitHubDeviceClientId = "Iv23lij7SqVj1Eb2YRdd";
const modelsClient = new GitHubModelsClient();
const auth = new AuthSessionManager({
  provider: createAuthProvider(),
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

function createAuthProvider(): AuthProvider {
  if (fakeMode) {
    return {
      async pollDeviceAuthorization(input) {
        return {
          session: {
            accountLabel: "fake-user",
            organization: input.organization?.trim() || undefined,
            token: "fake-token",
            tokenHint: "fake...token"
          },
          status: "complete"
        };
      },
      async startDeviceAuthorization(input) {
        return {
          deviceCode: "fake-device",
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
          intervalSeconds: 1,
          organization: input.organization?.trim() || undefined,
          userCode: "FAKE-CODE",
          verificationUri: "https://github.com/login/device"
        };
      }
    };
  }

  return new GitHubDeviceFlowClient({
    clientId: process.env.GITHUB_DEVICE_CLIENT_ID ?? defaultGitHubDeviceClientId,
    modelsClient,
    openUrl: openSystemBrowser,
    scope: process.env.GITHUB_DEVICE_SCOPE
  });
}

function createSecureStore() {
  return process.platform === "darwin" && !fakeMode
    ? new MacOsKeychainStore()
    : new MemoryStore();
}

async function openSystemBrowser(url: string) {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];

  const processHandle = Bun.spawn(command, {
    stderr: "ignore",
    stdout: "ignore"
  });

  await processHandle.exited;
}
