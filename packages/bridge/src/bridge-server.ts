import {
  BRIDGE_PROTOCOL_VERSION,
  type AuthConnectRequest,
  type BridgeStreamEvent,
  type ChatStreamRequest,
  type PairConfirmRequest,
  type PairStartRequest
} from "@copilotchat/shared";

import { AuthSessionManager } from "./auth-session-manager";
import { ModelRegistry } from "./model-registry";
import { PairingService } from "./pairing-service";

const encoder = new TextEncoder();

export interface ChatGateway {
  streamChat(request: ChatStreamRequest, signal: AbortSignal): AsyncGenerator<BridgeStreamEvent>;
}

export interface BridgeServer {
  handle(request: Request): Promise<Response>;
}

export function createBridgeServer(options: {
  auth: AuthSessionManager;
  bridgeVersion: string;
  chatGateway: ChatGateway;
  modelRegistry: ModelRegistry;
  pairing: PairingService;
}): BridgeServer {
  const activeRequests = new Map<string, AbortController>();

  return {
    async handle(request) {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");

      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: corsHeaders(origin)
        });
      }

      try {
        if (request.method === "GET" && url.pathname === "/health") {
          return json(
            {
              auth: await options.auth.getSession(),
              bridgeVersion: options.bridgeVersion,
              protocolVersion: BRIDGE_PROTOCOL_VERSION,
              status: "ok"
            },
            origin
          );
        }

        if (request.method === "POST" && url.pathname === "/pair/start") {
          const body = await readJson<PairStartRequest>(request);
          return json(options.pairing.start(body), origin);
        }

        if (request.method === "POST" && url.pathname === "/pair/confirm") {
          const body = await readJson<PairConfirmRequest>(request);
          return json(options.pairing.confirm(body), origin);
        }

        if (request.method === "GET" && url.pathname === "/auth/session") {
          return json(await options.auth.getSession(), origin);
        }

        if (request.method === "POST" && url.pathname === "/auth/connect") {
          const body = await readJson<AuthConnectRequest>(request);
          await options.auth.connect(body);
          return json(await options.auth.getSession(), origin);
        }

        if (request.method === "POST" && url.pathname === "/auth/logout") {
          await options.auth.logout();
          return json(await options.auth.getSession(), origin);
        }

        if (request.method === "GET" && url.pathname === "/models") {
          if (!isPaired(request, options.pairing)) {
            return error("pairing_required", 401, origin);
          }

          const session = await options.auth.getSession();
          if (!session.authenticated) {
            return error("auth_required", 401, origin);
          }

          return json(await options.modelRegistry.list(), origin);
        }

        if (request.method === "POST" && url.pathname === "/chat/stream") {
          if (!isPaired(request, options.pairing)) {
            return error("pairing_required", 401, origin);
          }

          const session = await options.auth.getSession();
          if (!session.authenticated) {
            return error("auth_required", 401, origin);
          }

          const body = await readJson<ChatStreamRequest>(request);
          const abortController = new AbortController();
          activeRequests.set(body.requestId, abortController);

          const stream = new ReadableStream({
            start: async (controller) => {
              try {
                for await (const event of options.chatGateway.streamChat(body, abortController.signal)) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                }
              } catch {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ message: "stream_failed", type: "assistant_error" })}\n\n`
                  )
                );
              } finally {
                activeRequests.delete(body.requestId);
                controller.close();
              }
            }
          });

          return new Response(stream, {
            headers: {
              ...corsHeaders(origin),
              "cache-control": "no-cache",
              connection: "keep-alive",
              "content-type": "text/event-stream"
            }
          });
        }

        if (request.method === "POST" && url.pathname === "/chat/abort") {
          if (!isPaired(request, options.pairing)) {
            return error("pairing_required", 401, origin);
          }

          const body = await readJson<{ requestId: string }>(request);
          const activeRequest = activeRequests.get(body.requestId);
          activeRequest?.abort();

          return json(
            {
              aborted: Boolean(activeRequest)
            },
            origin,
            202
          );
        }

        return error("not_found", 404, origin);
      } catch (errorValue) {
        const message = errorValue instanceof Error ? errorValue.message : "bridge_error";
        return error(message, 400, origin);
      }
    }
  };
}

function isPaired(request: Request, pairing: PairingService) {
  const token = request.headers.get("x-bridge-token");
  const origin = request.headers.get("origin");

  if (!token || !origin) {
    return false;
  }

  return pairing.validate({
    origin,
    token
  });
}

function corsHeaders(origin: string | null) {
  return {
    "access-control-allow-headers": "content-type, x-bridge-token",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-origin": origin ?? "*"
  };
}

function json(body: unknown, origin: string | null, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders(origin),
      "content-type": "application/json"
    },
    status
  });
}

function error(message: string, status: number, origin: string | null) {
  return json(
    {
      error: message
    },
    origin,
    status
  );
}

async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}
