# copilotchat

Hybrid app:
- hosted Vite/React UI
- local bridge for GitHub auth + inference

## env

Real GitHub auth needs a device-flow app client id.

Copy `.env.example` values into your shell or launch config:

```bash
export ALLOWED_ORIGIN=http://localhost:5173
export GITHUB_DEVICE_CLIENT_ID=your_github_device_app_client_id
export GITHUB_DEVICE_SCOPE=read:user
```

Notes:
- `GITHUB_DEVICE_CLIENT_ID` can come from a GitHub OAuth app or GitHub App with device flow enabled
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
bun run test:e2e
```
