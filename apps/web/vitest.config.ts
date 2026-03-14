import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    exclude: ["e2e/**"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: "./src/test/setup.ts",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: [
        "dist/**",
        "e2e/**",
        "src/main.tsx",
        "src/components/ui/**",
        "src/lib/utils.ts",
        "src/components/theme-provider.tsx",
        "vite.config.ts",
        "vitest.config.ts",
        "tailwind.config.ts",
        "postcss.config.js"
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100
      }
    }
  }
});
