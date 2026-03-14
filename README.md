# copilotchat

Hybrid app:
- hosted Vite/React UI
- local bridge for GitHub auth + inference

## env

Real GitHub auth uses the bundled product client id by default.

Copy `.env.example` values into your shell or launch config if you need to override defaults:

```bash
export ALLOWED_ORIGIN=http://localhost:5173
export GITHUB_DEVICE_SCOPE=read:user
```

Notes:
- bundled default client id is the product GitHub App
- `GITHUB_DEVICE_CLIENT_ID` is optional override
- bridge stores the resulting user token in OS keychain on macOS
- browser never stores GitHub auth secret

## dev

```bash
bun run --filter @copilotchat/bridge dev
bun run --filter @copilotchat/web dev
```

## verify

```bash
bun run test
bun run check
bun run build
```
