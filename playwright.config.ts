import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  use: {
    baseURL: "http://localhost:4173",
    headless: true
  },
  webServer: [
    {
      command: "ALLOWED_ORIGIN=http://localhost:4173 BRIDGE_FAKE_MODE=1 BRIDGE_PORT=8788 bun run --filter @copilotchat/bridge dev",
      port: 8788,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: "VITE_BRIDGE_URL=http://127.0.0.1:8788 bun run --filter @copilotchat/web dev -- --host localhost --port 4173",
      port: 4173,
      reuseExistingServer: false,
      timeout: 120_000
    }
  ],
  workers: 1
});
