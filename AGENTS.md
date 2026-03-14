# AGENTS.md — copilotchat

## Product Goal

Hosted web chat app for GitHub Copilot users.

User flow:
- open hosted web app
- app connects to local bridge on user machine
- bridge pairs browser origin
- user connects GitHub Copilot in bridge via device flow
- bridge stores provider auth in OS secure storage
- bridge fetches available chat models
- user chats in web UI
- bridge performs inference and streams tokens back

Non-goal:
- hosted backend holding user GitHub/Copilot tokens by default
- PAT-first auth
- browser talking direct to provider with raw token

## Architecture

Monorepo with bun workspaces.

### Packages

| Package | Path | Purpose |
|---|---|---|
| `@copilotchat/web` | `apps/web` | Hosted Vite/React UI |
| `@copilotchat/bridge` | `packages/bridge` | Local bridge for pairing, auth, model discovery, streaming chat |
| `@copilotchat/shared` | `packages/shared` | Shared protocol types |

### System Boundaries

- `web` is untrusted for provider secrets
- `bridge` is trusted for provider auth and inference
- browser stores only local bridge pairing/session data
- provider tokens live only in bridge secure storage
- cloud hosts static app assets; no provider-token custody in default architecture

### Desired Runtime Flow

1. Web app probes local bridge health.
2. Web app pairs with bridge for current origin.
3. Bridge reports auth state.
4. If signed out, web app starts device auth on bridge.
5. Bridge opens GitHub device page and polls completion.
6. Bridge stores session in OS keychain/secure store.
7. Web app loads models from bridge.
8. Web app sends chat request to bridge.
9. Bridge streams assistant deltas back.
10. Web app renders a normal chat experience.

## Current Direction

When code conflicts with old hosted-BFF assumptions, follow this target architecture:
- local bridge is primary
- streaming chat is primary
- GitHub Copilot connect UX is primary
- hosted BFF auth/chat code is legacy and should be removed unless explicitly retained for a proven need

## Build / Dev

```bash
bun install

# primary dev loop
bun run dev

# split processes
bun run dev:web
bun run dev:bridge

# checks
bun run test
bun run check
bun run build
```

## Testing Rules

- Vitest with 100% thresholds stays enforced.
- Follow TDD.
- Start with failing tests for auth flow, pairing flow, model load, chat streaming, and error states.
- Prefer CLI-level / integration-like tests around bridge client behavior first.
- Verify the actual app manually after automated tests pass.
- Do not use fake mode, mock providers, mock auth, or synthetic end-to-end flows for final verification.
- End-to-end verification must use real integrations and real provider behavior, same as production.
- After the verification loop is closed, run the full workflow from start to end with `agent-browser` before filing the PR.
- The pre-PR browser pass must cover the real user flow end to end, not a partial spot check.
- If real verification is blocked by missing credentials, missing external access, rate limits, or another hard constraint, stop and state the blocker explicitly. Do not substitute a fake flow.

## Code Rules

### General

- TypeScript strict mode.
- ESM only.
- Double quotes.
- Semicolons.
- 2-space indent.
- Prefer small factory functions over classes in app/web code.

### Imports

Order:
1. external
2. workspace
3. local
4. css last

Use `import type` where possible.

### Naming

- files: kebab-case
- components: named PascalCase exports
- functions: camelCase
- object shapes: `interface`
- unions/aliases: `type`
- no enums

### Errors

- throw machine-readable error codes
- catch variable name: `errorValue`
- bridge/http errors return `{ error: "code" }`

## Web App Contract

The web app should assume:
- bridge may be offline
- pairing token may expire
- auth may expire or require reconnect
- models may change between sessions
- streaming may abort mid-response

The web app must:
- recover cleanly from bridge offline/unpaired states
- never require page reload for normal auth/chat flow
- show device-code instructions clearly
- stream assistant output incrementally
- allow repeated chats like a normal chat app

## Bridge Contract

The bridge must:
- bind to loopback only
- validate allowed origins
- require pairing token for privileged routes
- keep provider token out of browser responses
- store auth in secure storage when available
- support logout
- support model listing
- support streaming chat
- support aborting an active stream

## Environment

```bash
ALLOWED_ORIGIN=http://localhost:5173
BRIDGE_PORT=8787
GITHUB_DEVICE_CLIENT_ID=
GITHUB_DEVICE_SCOPE=
```

Notes:
- default bridge origin for web dev is `http://localhost:5173`
- bridge should stay usable without cloud env vars
- production hosting is static web + local bridge, not server auth handlers

## Verification Checklist

Before submit:

```bash
bun run test
bun run check
bun run build
```

Manual:
- start bridge
- start web
- pair
- connect GitHub Copilot
- load models
- send prompt
- confirm streamed response renders
- logout and reconnect
- all of the above must be real, not fake-mode
