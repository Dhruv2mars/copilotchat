import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  use: {
    baseURL: "http://localhost:5173",
    headless: true
  },
  webServer: [
    {
      command: "bun run --filter @copilotchat/bridge dev",
      port: 8787,
      reuseExistingServer: true,
      timeout: 120_000
    },
    {
      command: "bun run --filter @copilotchat/web dev -- --host localhost --port 5173",
      port: 5173,
      reuseExistingServer: true,
      timeout: 120_000
    }
  ],
  workers: 1
});
