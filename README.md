# copilotchat

Chat with GitHub Copilot from your terminal.

`copilotchat` is a Rust TUI chat app. You connect your own GitHub Copilot account once, pick a model, and chat with streaming replies like a normal assistant app.
Auth stays in local app files under `~/.copilotchat/`. No Keychain/system secret-store prompt path is used.

## Why

- browser-to-localhost permissions were too brittle for the main product path
- CLI keeps auth local
- install is simple
- chat feels fast and direct

## Install

Use any supported package manager:

```bash
npm i -g @dhruv2mars/copilotchat
```

```bash
bun install -g @dhruv2mars/copilotchat
```

```bash
pnpm add -g @dhruv2mars/copilotchat
```

First run downloads the native binary into `~/.copilotchat/bin/`.

## Quickstart

```bash
copilotchat
```

First run flow:
1. open `copilotchat`
2. approve the GitHub device code
3. search/select a model
4. send a prompt
5. resume the thread later

## Commands

```bash
copilotchat
copilotchat auth login
copilotchat auth status
copilotchat auth logout
copilotchat models
copilotchat chat "indian capital city?"
copilotchat update
```

## TUI keys

- `Enter` send
- `Shift+Enter` newline
- `Tab` / `Shift+Tab` move focus
- `Ctrl+K` focus models
- `Ctrl+J` focus threads
- `Ctrl+M` focus composer
- `Ctrl+N` new chat
- `Ctrl+L` logout
- `Esc` stop stream or clear search
- `q` quit

## Install notes

- `npm`, `bun`, `pnpm`, and `yarn` installs all use the same JS launcher
- the launcher downloads the right native binary on first run
- no postinstall is required, so Bun global installs are usable without trusting scripts
- `copilotchat update` upgrades with the same package manager used for install when possible

## Release binaries

GitHub Releases publish:
- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`
- `win32-arm64`
- `win32-x64`

## Local dev

```bash
bun install
bun run cli
bun run test
bun run check
bun run build
```

Real manual verify:

```bash
cargo run -p copilotchat-cli -- auth login
cargo run -p copilotchat-cli -- models
cargo run -p copilotchat-cli -- chat "indian capital city?"
cargo run -p copilotchat-cli --
```

## Docs

- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [CLI package docs](./packages/cli/README.md)

## Release

```bash
bunx changeset
bun run release:version
TAG="v$(node -p \"require('./packages/cli/package.json').version\")"
git tag "$TAG"
git push origin "$TAG"
```

Tags trigger:
- GitHub Release creation
- cross-platform binary builds
- npm publish
