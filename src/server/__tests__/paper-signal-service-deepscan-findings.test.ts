/**
 * paper-signal-service-deepscan-findings.test.ts
 *
 * Source-code analysis tests for deepscan audit findings F1 and F2
 * in paper-signal-service.ts.
 *
 * F1: Gate 4 (T1 news re-check) catch block must be fail-CLOSED
 *     (pendingDropReason set + audit row + logger.warn).
 * F2: Cross-symbol DLL force-close must use static import + await +
 *     try/catch + audit row + CRITICAL notification on failure.
 *     (No fire-and-forget dynamic import).
 *
 * Source analysis is appropriate here because evaluateSignals() has too many
 * gateway dependencies for isolated behavioral tests. The structural assertions
 * directly verify the safety invariant rather than the surrounding behavior.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, "../services/paper-signal-service.ts"),
  "utf-8",
);

// ─── Finding 1: Gate 4 (T1 news re-check) must be fail-CLOSED ────────────────

describe("F1 — Gate 4 T1 news re-check must be fail-CLOSED", () => {
  it("sets pendingDropReason = 'macro_news_check_error' in the catch block", () => {
    expect(SRC).toContain('pendingDropReason = "macro_news_check_error"');
  });

  it("emits paper.fill_blocked_news_check_error audit action in the catch block", () => {
    expect(SRC).toContain('"paper.fill_blocked_news_check_error"');
  });

  it("logs a warn (not silent) in the catch block", () => {
    const catchIdx = SRC.indexOf("macro_news_check_error");
    expect(catchIdx).toBeGreaterThan(-1);
    // logger.warn must appear within 800 chars of the pendingDropReason line
    const window = SRC.slice(catchIdx, catchIdx + 800);
    expect(window).toContain("logger.warn");
  });

  it("includes failClosed:true in the audit result", () => {
    expect(SRC).toContain("failClosed: true");
  });

  it("does NOT contain the old Fail-OPEN comment for Gate 4", () => {
    expect(SRC).not.toContain("Fail-OPEN: calendar/news failure is non-blocking");
  });

  it("catch block sets pendingDropReason before the audit row (correct ordering)", () => {
    const dropIdx = SRC.indexOf('pendingDropReason = "macro_news_check_error"');
    const auditIdx = SRC.indexOf('"paper.fill_blocked_news_check_error"');
    expect(dropIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeGreaterThan(-1);
    // pendingDropReason assignment must appear before the audit row write
    expect(dropIdx).toBeLessThan(auditIdx);
  });
});

// ─── Finding 2: DLL force-close must NOT be fire-and-forget dynamic import ────

describe("F2 — Cross-symbol DLL force-close must be awaited + fail-CLOSED on error", () => {
  it("forceCloseAllPositions is statically imported at the top of the file", () => {
    // The static import from paper-execution-service must include forceCloseAllPositions
    const importLineIdx = SRC.indexOf(
      'import { openPosition, closePosition, forceCloseAllPositions } from "./paper-execution-service.js"'
    );
    expect(importLineIdx).toBeGreaterThan(-1);
    // Must be near the top of the file (within first 500 chars)
    expect(importLineIdx).toBeLessThan(500);
  });

  it("does NOT use dynamic import('./paper-execution-service.js') for forceCloseAllPositions", () => {
    // The old fire-and-forget pattern must be gone
    expect(SRC).not.toContain(
      'import("./paper-execution-service.js")\n            .then(({ forceCloseAllPositions })'
    );
  });

  it("does NOT contain the fire-and-forget .then() chain for forceCloseAllPositions", () => {
    // No .then(({ forceCloseAllPositions }) => ...) pattern
    expect(SRC).not.toContain(".then(({ forceCloseAllPositions })");
  });

  it("awaits forceCloseAllPositions in a try/catch block", () => {
    const awaitIdx = SRC.indexOf("await forceCloseAllPositions(");
    expect(awaitIdx).toBeGreaterThan(-1);
    // The await must be inside a try block
    const surrounding = SRC.slice(Math.max(0, awaitIdx - 200), awaitIdx + 100);
    expect(surrounding).toContain("try {");
  });

  it("writes cross_symbol_force_close_failed audit row on failure", () => {
    expect(SRC).toContain('"cross_symbol_force_close_failed"');
  });

  it("fires notifyCritical with CRITICAL title when force-close fails", () => {
    // The error path must call notifyCritical with a CRITICAL message
    const auditIdx = SRC.indexOf('"cross_symbol_force_close_failed"');
    expect(auditIdx).toBeGreaterThan(-1);
    // notifyCritical must appear within 500 chars after the failed audit action
    const window = SRC.slice(auditIdx, auditIdx + 500);
    expect(window).toContain("notifyCritical(");
  });

  it("includes requiresManualClose:true in the failure audit result", () => {
    expect(SRC).toContain("requiresManualClose: true");
  });

  it("logs the error at logger.error level when force-close fails", () => {
    const catchIdx = SRC.indexOf("cross_symbol_force_close_failed");
    const window = SRC.slice(Math.max(0, catchIdx - 300), catchIdx + 600);
    expect(window).toContain("logger.error");
  });
});
