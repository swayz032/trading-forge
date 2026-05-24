import { defineConfig } from "vitest/config";

// Wave 24 Pass 2 Item 23 — Full-fleet overnight baseline-defense config.
// singleFork: true serialises all tests into one process — zero OOM risk on Windows.
// Slower (~3–5× vs parallel), but 100% stable for the Wave 6 baseline-defense run.
// Use: npm run test:full-fleet
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // one process, never OOMs — baseline defence mode
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/server/**/*.ts"],
      exclude: [
        "src/server/**/*.test.ts",
        "src/server/db/migrations/**",
        "src/server/__tests__/**",
        "node_modules/**",
      ],
      thresholds: {
        lines: 40,
        functions: 40,
        branches: 30,
        statements: 40,
      },
    },
  },
});
