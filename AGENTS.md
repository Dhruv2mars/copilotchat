# AGENTS.md — copilotchat

## Project Overview

Hybrid chat app: hosted Vite/React UI + local bridge for GitHub auth + inference.
Monorepo with bun workspaces. Deployed on Vercel (serverless functions in `api/`).

### Workspace Packages

| Package | Path | Purpose |
|---|---|---|
| `@copilotchat/web` | `apps/web` | Vite + React frontend (Tailwind, Radix, Zustand, TanStack Query) |
| `@copilotchat/bridge` | `packages/bridge` | Local bridge server (auth, pairing, streaming) |
| `@copilotchat/shared` | `packages/shared` | Shared protocol types between web and bridge |

Serverless BFF lives in `apps/web/src/server/github-bff.ts`; Vercel handlers in `api/`.

## Build / Lint / Test Commands

```bash
# Install
bun install

# Dev (starts Vercel dev server wrapping both web + bridge)
bun run dev
# Or individually:
bun run --filter @copilotchat/web dev
bun run --filter @copilotchat/bridge dev

# Type check all packages
bun run check

# Build all packages
bun run build

# Run ALL tests with coverage (100% thresholds enforced)
bun run test

# Run tests for a single package
bun run --filter @copilotchat/web test:coverage
bun run --filter @copilotchat/bridge test:coverage

# Run a single test file
bunx vitest run src/app-store.test.ts          # from apps/web/
bunx vitest run src/bff-client.test.ts         # from apps/web/

# Run a single test by name
bunx vitest run -t "creates, updates, and deletes"  # from relevant workdir

# Watch mode (single file)
bunx vitest src/app-store.test.ts              # from apps/web/
```

## Test Framework & Coverage

- **Vitest** with `@vitest/coverage-v8`. 100% coverage thresholds (lines, functions, branches, statements) on both `web` and `bridge`.
- Web tests use `jsdom` environment + `@testing-library/react` + `@testing-library/user-event`.
- Bridge tests use `node` environment.
- Test setup: `apps/web/src/test/setup.ts` (cleanup, localStorage clear, ResizeObserver polyfill).
- Test files are colocated: `foo.ts` -> `foo.test.ts` (same directory).
- Use `/* v8 ignore next */` comments for intentional uncovered lines (theme cycling, etc.).

## Code Style

### General

- **No ESLint or Prettier config.** Formatting is manual/editor-based.
- **TypeScript strict mode** (`strict: true` in `tsconfig.base.json`).
- **ES2022** target, **ESNext** modules, **Bundler** module resolution.
- **Double quotes** for strings. **Semicolons** at end of statements.
- **2-space indentation.**
- All packages use `"type": "module"` (ESM).

### Imports

Imports follow a strict grouping order separated by blank lines:

1. **External packages** (node builtins, npm packages) — grouped together
2. **Workspace packages** (`@copilotchat/shared`, etc.)
3. **Local imports** (`./foo`, `../bar`)
4. **CSS imports** last (`./styles.css`)

Type-only imports use `import type { ... }` syntax. Mixed imports separate types:
```ts
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ChatMessage } from "@copilotchat/shared";
```

### Naming Conventions

| Kind | Convention | Example |
|---|---|---|
| Files | `kebab-case.ts` / `kebab-case.tsx` | `app-store.ts`, `chat-view.tsx` |
| React components | `PascalCase` (named export) | `export function ChatView(...)` |
| Component files | `kebab-case.tsx` (NOT PascalCase) | `chat-view.tsx`, NOT `ChatView.tsx` |
| Interfaces | `PascalCase`, no `I` prefix | `interface AppState { ... }` |
| Types | `PascalCase` | `type RuntimeState = ...` |
| Functions | `camelCase` | `createAppStore()`, `readErrorMessage()` |
| Constants | `UPPER_SNAKE_CASE` or `camelCase` | `STORAGE_KEY`, `encoder` |
| Factory functions | `create*` prefix | `createBridgeServer()`, `createHttpBffClient()` |
| Test files | Same name + `.test.ts(x)` | `app-store.test.ts` |

### TypeScript Patterns

- **Prefer `interface` for object shapes**, `type` for unions/aliases.
- **Use `satisfies`** for type-safe object literals: `{ ... } satisfies SessionCookiePayload`.
- **Cast API responses** with `as T`: `(await response.json()) as ChatCompletionPayload`.
- **No enums.** Use string literal unions: `type RuntimeState = "loading" | "ready" | "signed_out"`.
- **No classes in app code** (bridge uses factory functions returning plain objects with methods).
- Exported types from shared package are the source of truth for protocol shapes.

### React Patterns

- **Functional components only** — no class components.
- **Props typed inline** in function signature: `function ChatView(props: { ... })`.
- **No default exports** for components. Named exports: `export function App(...)`.
- **Dependency injection** via props: `App` receives `client: BffClient` and `store: AppStore`.
- **Zustand** for client state (vanilla store, persisted to localStorage).
- **TanStack Query** for server state (`useQuery` for bootstrap).
- **Tailwind CSS** for styling with `cn()` utility (clsx + tailwind-merge).
- **Radix UI primitives** via shadcn-style `components/ui/` wrappers.

### Error Handling

- Throw `new Error("snake_case_error_code")` — machine-readable error codes, not sentences.
- Catch blocks use `errorValue` as the variable name (not `err` or `e`).
- Pattern for unknown errors:
  ```ts
  } catch (errorValue) {
    const message = errorValue instanceof Error ? errorValue.message : "fallback_code";
  }
  ```
- API error responses return `{ error: "snake_case_code" }` JSON with appropriate HTTP status.

### Test Patterns

- Import `describe, expect, it, vi` from `vitest`.
- Use `vi.fn()` for mocks, chain `.mockResolvedValue()` / `.mockRejectedValue()`.
- No `beforeEach`/`afterAll` — setup is per-test via factory functions.
- Factory helpers at top of test file: `createBaseClient()`, `createReadyBootstrap()`.
- Assertions: `toMatchObject` for partial checks, `toEqual` for exact, `toThrow` for errors.
- React tests use `render()`, `screen.findByRole()`, `userEvent.setup()`.

### Architecture Patterns

- **Factory function pattern**: `createGitHubBff(options)` returns object with methods. No classes.
- **BFF (Backend-for-Frontend)**: `github-bff.ts` handles auth, cookie encryption, GitHub API calls.
- **Vercel serverless handlers** in `api/` are thin wrappers calling BFF methods.
- **Protocol types** in `packages/shared/src/protocol.ts` — single source of truth.
- **Encrypted session cookies** (AES-256-GCM) — browser never stores GitHub tokens directly.

## Environment Variables

```bash
# Required in production
SESSION_SECRET=           # or GITHUB_SESSION_SECRET — cookie encryption key

# Optional overrides
ALLOWED_ORIGIN=http://localhost:5173
GITHUB_DEVICE_CLIENT_ID=  # defaults to bundled product GitHub App
GITHUB_DEVICE_SCOPE=read:user
ENABLE_GH_CLI_AUTH=1      # auto-enabled in non-production
```

## Verification Checklist

Before submitting changes, run:
```bash
bun run test    # 100% coverage required
bun run check   # type check
bun run build   # production build
```
