# AGENTS.md — copilotchat

## Product Goal

Rust CLI chat app for GitHub Copilot users.

Primary user flow:
- install `copilotchat`
- open terminal app
- connect GitHub Copilot via device flow
- store auth in OS secure storage
- fetch available Copilot chat models
- search/select model
- chat with streaming responses
- persist and resume local threads

Secondary surface for now:
- web + bridge stay in repo short-term
- not primary
- not release-blocking for CLI work

Non-goal:
- hosted backend owning user GitHub/Copilot tokens
- browser-first runtime as main product
- fake auth, fake provider, fake end-to-end verification

## Architecture

Monorepo with Bun workspaces + Rust workspace.

### Packages / Crates

| Unit | Path | Purpose |
|---|---|---|
| `@copilotchat/web` | `apps/web` | legacy hosted UI |
| `@copilotchat/bridge` | `packages/bridge` | legacy local bridge |
| `@copilotchat/shared` | `packages/shared` | shared TS protocol types |
| `@dhruv2mars/copilotchat` | `packages/cli` | npm wrapper / installer / launcher |
| `copilotchat-core` | `crates/copilotchat-core` | native Copilot auth, models, history, streaming |
| `copilotchat-cli` | `crates/copilotchat-cli` | Rust CLI + TUI entrypoint |

### Desired Runtime Flow

1. User runs `copilotchat`.
2. CLI checks secure local session.
3. If signed out, CLI starts GitHub device auth.
4. User approves device code in browser.
5. CLI stores session in OS secure storage.
6. CLI loads Copilot models.
7. User searches/selects model in TUI.
8. User chats and receives streaming output.
9. CLI saves thread history under `~/.copilotchat/`.
10. Next launch resumes prior state.

## Build / Dev

```bash
bun install
bun run test
bun run check
bun run build
```

## Testing Rules

- TDD always.
- Start with failing tests.
- 100% coverage remains the target for Rust core and JS wrapper logic.
- No fake mode, no mocked final verification, no synthetic end-to-end signoff.
- Final verification must use real GitHub Copilot auth and real Copilot inference.
- Before PR:
  - run `bun run test`
  - run `bun run check`
  - run `bun run build`
  - run real CLI auth/login/models/chat/logout flow
- After verification loop closes, run the full workflow from start to end using the real CLI, not a partial spot check.
- If real verification is blocked by credentials, external outage, rate limit, or another hard blocker, stop and state it explicitly.

## Code Rules

### General

- TypeScript strict mode.
- Rust edition `2024`.
- ESM only for JS wrapper.
- Double quotes.
- Semicolons.
- 2-space indent in TS/JS.

### Errors

- Use clear machine-readable errors where practical.
- Do not swallow provider/auth failures.
- Secure storage failure must fail clearly, not downgrade silently.

## CLI Contract

CLI must support:
- `copilotchat`
- `copilotchat auth login`
- `copilotchat auth status`
- `copilotchat auth logout`
- `copilotchat models`
- `copilotchat chat "<prompt>"`

CLI must:
- keep provider token local only
- use device flow for auth
- stream assistant output
- persist threads locally
- resume old threads
- allow model search/selection
- allow cancelling active stream

## Local Data

Stored under:

```bash
~/.copilotchat/
```

Expected files/dirs:
- `install-meta.json`
- `config.json`
- `threads/`
- `logs/`
- `bin/`

## Verification Checklist

Before submit:

```bash
bun run test
bun run check
bun run build
```

Manual:
- `cargo run -p copilotchat-cli -- auth login`
- approve device code
- `cargo run -p copilotchat-cli -- models`
- `cargo run -p copilotchat-cli -- chat "indian capital city?"`
- `cargo run -p copilotchat-cli`
- verify model search
- verify thread resume
- verify logout + reconnect
- all real, no fake-mode
