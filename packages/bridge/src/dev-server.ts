import type { BridgeStreamEvent, ChatStreamRequest } from "@copilotchat/shared";
import { homedir } from "node:os";
import { join } from "node:path";

import { AuthSessionManager, type AuthProvider, type SecureStore } from "./auth-session-manager";
import { createBridgeServer } from "./bridge-server";
import { GitHubDeviceFlowClient } from "./github-device-flow-client";
import { GitHubCopilotClient } from "./github-copilot-client";
import { resolveAllowedOrigins } from "./bridge-config";
import { FileStore } from "./file-store";
import { ModelRegistry } from "./model-registry";
import { PairingService } from "./pairing-service";

const port = Number(process.env.BRIDGE_PORT ?? "8787");
const allowedOrigins = resolveAllowedOrigins();
const defaultGitHubDeviceClientId = "Iv1.b507a08c87ecfe98";
const copilotClient = new GitHubCopilotClient();
const auth = new AuthSessionManager({
  provider: createAuthProvider(),
  store: createSecureStore()
});

const server = createBridgeServer({
  auth,
  bridgeVersion: "2.0.0",
  chatGateway: {
    async *streamChat(
      request: ChatStreamRequest,
      signal: AbortSignal
    ): AsyncGenerator<BridgeStreamEvent> {
      const session = await auth.getStoredSession();
      if (!session) {
        throw new Error("auth_required");
      }

      yield* copilotClient.streamChat({
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

        return copilotClient.listModels({
          organization: session.organization,
          token: session.token
        });
      }
    }
  }),
  pairing: new PairingService({
    allowedOrigins,
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
console.log(`allowed origins: ${allowedOrigins.join(", ")}`);
console.log("bridge mode: live github-copilot");

function createAuthProvider(): AuthProvider {
  return new GitHubDeviceFlowClient({
    clientId: process.env.GITHUB_DEVICE_CLIENT_ID ?? defaultGitHubDeviceClientId,
    copilotClient,
    openUrl: openSystemBrowser,
    scope: process.env.GITHUB_DEVICE_SCOPE
  });
}

function createSecureStore() {
  const sessionPath = join(homedir(), ".copilotchat", "bridge-session.json");
  return new FileStore(sessionPath);
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
