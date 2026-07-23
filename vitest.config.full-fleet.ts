import { defineConfig } from "vitest/config";
import { NO_DATABASE_TEST_EXCLUDES } from "./vitest.db-policy";

// Wave 24 Pass 2 Item 23 — Full-fleet overnight baseline-defense config.
// One isolated worker keeps memory bounded without sharing module/mock state
// between test files. A single shared fork made outcomes order-dependent.
// Use: npm run test:full-fleet
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: process.env.DATABASE_URL ? [] : NO_DATABASE_TEST_EXCLUDES,
    pool: "threads",
    maxWorkers: 1,
    minWorkers: 1,
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
