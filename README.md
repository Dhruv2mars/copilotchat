# copilotchat

Rust CLI chat app for GitHub Copilot users.

Primary flow:
- run `copilotchat`
- connect GitHub Copilot with device code
- pick/search a model
- chat in terminal with streaming replies
- resume old threads from local history

Web + bridge stay in repo for now, but CLI is the primary product.

## Install

Local dev:

```bash
bun install
bun run build
cargo run -p copilotchat-cli -- --help
```

Published install target:

```bash
npm i -g @dhruv2mars/copilotchat
copilotchat
```

First install downloads the native Rust binary into `~/.copilotchat/bin/`.

## Commands

```bash
copilotchat
copilotchat auth login
copilotchat auth status
copilotchat auth logout
copilotchat models
copilotchat chat "indian capital city?"
```

## Dev

```bash
bun install
bun run test
bun run check
bun run build
```

## Verify

Real manual flow:
1. `cargo run -p copilotchat-cli -- auth login`
2. approve GitHub device auth
3. `cargo run -p copilotchat-cli -- models`
4. `cargo run -p copilotchat-cli -- chat "indian capital city?"`
5. `cargo run -p copilotchat-cli`
6. confirm thread history, model picker, streaming, logout/login
