import { defineConfig } from "vitest/config";
import { NO_DATABASE_TEST_EXCLUDES } from "./vitest.db-policy";

// Wave 24 Pass 2 Item 23: switched from threads pool to forks pool.
// tinypool's threads mode hits VirtualAlloc failures on Windows 16 GB RAM
// when the full test fleet (280+ test files) spins up simultaneously.
// forks pool gives each worker its own process address space — stable on Windows.
// maxForks=4 keeps peak RAM ≤ ~4 GB for the test layer (safe on 16 GB Skytech tower).
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: process.env.DATABASE_URL ? [] : NO_DATABASE_TEST_EXCLUDES,
    pool: "forks", // threads → forks: eliminates VirtualAlloc OOM on Windows
    poolOptions: {
      forks: {
        singleFork: false, // parallel forks — fast CI; use full-fleet config for overnight runs
        maxForks: 4,       // 4 × ~1 GB each ≈ 4 GB peak — safe on 16 GB tower
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
