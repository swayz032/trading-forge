/**
 * test_pilot_protected.test.ts — CRITICAL #3: PILOT in PROTECTED_LIFECYCLE_STATES
 *
 * Verifies that PILOT is included in PROTECTED_LIFECYCLE_STATES in strategies.ts.
 * Uses source-file inspection to confirm the guard array contains "PILOT"
 * alongside the existing protected states.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("CRITICAL #3: PILOT in PROTECTED_LIFECYCLE_STATES", () => {
  const routeSource = readFileSync(
    resolve(__dirname, "../routes/strategies.ts"),
    "utf-8",
  );

  it("PROTECTED_LIFECYCLE_STATES includes PILOT", () => {
    const match = routeSource.match(
      /const PROTECTED_LIFECYCLE_STATES[^=]*=\s*(\[[^\]]*\])/,
    );
    expect(match, "PROTECTED_LIFECYCLE_STATES declaration not found in strategies.ts").toBeTruthy();
    const arrayLiteral = match![1];
    expect(arrayLiteral).toContain('"PILOT"');
  });

  it("PROTECTED_LIFECYCLE_STATES still includes DEPLOYED, PAPER, DEPLOY_READY (regression)", () => {
    const match = routeSource.match(
      /const PROTECTED_LIFECYCLE_STATES[^=]*=\s*(\[[^\]]*\])/,
    );
    const arrayLiteral = match![1];
    expect(arrayLiteral).toContain('"DEPLOYED"');
    expect(arrayLiteral).toContain('"PAPER"');
    expect(arrayLiteral).toContain('"DEPLOY_READY"');
  });

  it("PROTECTED_LIFECYCLE_STATES does NOT protect CANDIDATE or TESTING (still deletable)", () => {
    const match = routeSource.match(
      /const PROTECTED_LIFECYCLE_STATES[^=]*=\s*(\[[^\]]*\])/,
    );
    const arrayLiteral = match![1];
    expect(arrayLiteral).not.toContain('"CANDIDATE"');
    expect(arrayLiteral).not.toContain('"TESTING"');
  });

  it("delete route guard applies PROTECTED_LIFECYCLE_STATES.includes() and returns 409", () => {
    expect(routeSource).toMatch(/PROTECTED_LIFECYCLE_STATES\.includes\(currentState\)/);
    expect(routeSource).toMatch(/status\(409\)/);
  });
});
