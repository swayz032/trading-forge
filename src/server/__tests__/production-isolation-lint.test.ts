/**
 * production-isolation-lint.test.ts — Track 4 Phase 4A
 *
 * Tests for scripts/check-production-isolation.mjs
 *
 * Coverage:
 *   1. Detects forbidden import: agent-service
 *   2. Detects forbidden import: quantum-mc (quantum_* prefix)
 *   3. Allows permitted imports: paper-execution-service
 *   4. Reports correct file:line on violation
 */

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const LINT_SCRIPT = join(REPO_ROOT, "scripts", "check-production-isolation.mjs");

/**
 * Runs the isolation lint script against a temp production directory.
 * Returns { exitCode, stdout, stderr }.
 */
function runLintOn(files: Record<string, string>): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const tempDir = join(REPO_ROOT, "src", "server", "production", "__lint-test-temp__");

  // Clean up from any prior run
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }

  try {
    mkdirSync(tempDir, { recursive: true });

    // Write test files
    for (const [filename, content] of Object.entries(files)) {
      writeFileSync(join(tempDir, filename), content, "utf8");
    }

    try {
      const stdout = execSync(`node "${LINT_SCRIPT}"`, {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { exitCode: 0, stdout, stderr: "" };
    } catch (err: unknown) {
      const execError = err as { status?: number; stdout?: string; stderr?: string };
      return {
        exitCode: execError.status ?? 1,
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? "",
      };
    }
  } finally {
    // Always clean up temp files
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Production Isolation Lint — check-production-isolation.mjs", () => {

  // ── Test 1: Detects forbidden import: agent-service ───────────────────────
  it("reports violation when a file imports from agent-service", () => {
    const result = runLintOn({
      "bad-module.ts": `
import { someFunction } from "../services/agent-service.js";

export function doSomething() {}
`,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("agent-service");
    expect(result.stderr).toContain("VIOLATION");
  });

  // ── Test 2: Detects forbidden import: quantum-mc ──────────────────────────
  it("reports violation when a file imports from a quantum-* module", () => {
    const result = runLintOn({
      "bad-quantum-import.ts": `
import { runQuantumMC } from "../services/quantum-mc-service.js";

export function quantumCheck() {}
`,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("quantum");
    expect(result.stderr).toContain("VIOLATION");
  });

  // ── Test 3: Allows permitted imports (paper-execution-service) ────────────
  it("exits 0 when all imports are from permitted modules", () => {
    const result = runLintOn({
      "clean-module.ts": `
import { openPosition } from "../services/paper-execution-service.js";
import { isFirmSuspended } from "../services/prop-firm-health-service.js";
import { isExchangeHalted } from "../services/exchange-status-service.js";
import { db } from "../db/index.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";

export function safeProductionFunction() {
  return openPosition;
}
`,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CLEAN");
  });

  // ── Test 4: Reports correct file:line on violation ────────────────────────
  it("reports the correct line number where the forbidden import appears", () => {
    const result = runLintOn({
      "file-with-line-number.ts": `// Line 1 — comment
// Line 2 — comment
// Line 3 — comment
import { foo } from "../services/critic-optimizer-service.js";
// Line 5 — comment
`,
    });

    expect(result.exitCode).toBe(1);
    // File name and line 4 should appear in the error output
    expect(result.stderr).toContain("file-with-line-number.ts");
    expect(result.stderr).toContain(":4");
    expect(result.stderr).toContain("critic-optimizer-service");
  });

});
