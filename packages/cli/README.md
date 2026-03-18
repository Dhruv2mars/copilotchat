# @dhruv2mars/copilotchat

Chat with GitHub Copilot from your terminal.

## Install

```bash
npm i -g @dhruv2mars/copilotchat
```

```bash
bun install -g @dhruv2mars/copilotchat
```

First run downloads the native `copilotchat` binary into `~/.copilotchat/bin/`.
Release assets come from GitHub Releases for your platform.
Auth stays in local app files under `~/.copilotchat/`. No Keychain/system secret-store prompt path is used.

Supported release binaries:
- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`
- `win32-arm64`
- `win32-x64`

## Usage

```bash
copilotchat
```

One-shot prompt:

```bash
copilotchat chat "indian capital city?"
```

Model list:

```bash
copilotchat models
```

Manual upgrade:

```bash
copilotchat update
```

The updater prefers the original install manager when possible.

## Auth

```bash
copilotchat auth login
copilotchat auth status
copilotchat auth logout
```

## TUI keys

- `Enter` send
- `Shift+Enter` newline
- `Tab` / `Shift+Tab` move focus
- `Ctrl+K` models
- `Ctrl+J` threads
- `Ctrl+M` composer
- `Ctrl+N` new chat
- `Ctrl+L` logout
- `Esc` stop stream or clear search
- `q` quit

## Install behavior

- no postinstall is required
- first run bootstraps the native binary
- this keeps Bun global installs usable even when script trust is locked down
