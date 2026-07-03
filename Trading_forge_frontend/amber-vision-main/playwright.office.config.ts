/**
 * Playwright config for the Slumhouse OFFICE E2E specs (Layer-4 Office P0).
 *
 * The Office is served by the Express backend, NOT by this Vite SPA — these
 * specs boot `e2e/office-test-server.mts` from the repo root (real Office HTML
 * + real admin-session crypto + documented in-memory doubles for the DB-backed
 * pieces; see that file's header for the exact real-vs-stubbed inventory).
 *
 * Run: npm run test:e2e:office   (from Trading_forge_frontend/amber-vision-main)
 */
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "../..");
const PORT = 4790;

export default defineConfig({
  testDir: "./e2e/office",
  // The harness holds shared in-memory state (lockout counter, switch store,
  // audit rows) — specs reset it in beforeEach, so they must not interleave.
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx tsx e2e/office-test-server.mts",
    cwd: repoRoot,
    url: `http://127.0.0.1:${PORT}/slumhouse/admin/status`,
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      OFFICE_E2E_PORT: String(PORT),
      SLUMHOUSE_ADMIN_PASSCODE: "1974test",
      SLUMHOUSE_SESSION_SECRET: "office-e2e-session-secret-0123456789abcdef",
    },
  },
});
