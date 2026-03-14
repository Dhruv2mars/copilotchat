# copilotchat

Hosted web chat UI + local bridge for GitHub Copilot auth and inference.

## Goal

User opens the web app, connects GitHub Copilot through a local bridge, then chats with available models in a normal streaming chat UI.

Provider auth stays local:
- bridge owns auth
- bridge stores tokens in secure storage
- browser never receives raw provider token

## Packages

- `apps/web`: hosted Vite/React app
- `packages/bridge`: local Bun bridge
- `packages/shared`: shared protocol types

## Dev

```bash
bun install

bun run dev
# or split
bun run dev:bridge
bun run dev:web
```

Default local URLs:
- web: `http://localhost:5173`
- bridge: `http://127.0.0.1:8787`

## Env

```bash
export ALLOWED_ORIGIN=http://localhost:5173
export BRIDGE_PORT=8787
export GITHUB_DEVICE_SCOPE=read:user
```

Notes:
- bundled GitHub device client id may be used by default
- bridge should store auth in OS keychain on supported platforms

## Verify

```bash
bun run test
bun run check
bun run build
```

Manual flow:
1. start bridge
2. start web
3. connect GitHub Copilot
4. wait for models
5. send prompt
6. confirm streamed response
