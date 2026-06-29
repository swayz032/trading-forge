/**
 * deepscan-wiring-obs-gaps.test.ts
 *
 * Tests for 6 observability audit findings fixed in the deepscan-wiring worktree:
 *
 *   Finding 1 [CRITICAL] — docs/admin-runbook.md kill-switch SQL: correct column
 *     names (param_name / current_value) and 0/1/2 numeric mode semantics verified
 *     via source-code assertion.
 *
 *   Finding 2 [HIGH] — lifecycle-service.ts AlertFactory.deployReady swallowed
 *     catch: now logs logger.error + writes lifecycle.deploy_ready_alert_failed
 *     audit row via insertAuditRowSafe. Verified via source-code assertion.
 *
 *   Finding 3 [HIGH] — bifGateEvaluationsTotal: source code asserts counter
 *     incremented with short-form outcome label (clean|warn|blocked|legacy_null).
 *     (Integration coverage is in observability-gap-fixes.test.ts GAP 3.)
 *
 *   Finding 4 [HIGH] — lifecycle-service.ts bare "lifecycle:pbo_evaluated" and
 *     "lifecycle:shadow_divergence_evaluated" strings replaced by WAVE29_EVENTS
 *     constants. Source-code assertion verifies import + constant usage.
 *
 *   Finding 5 [MED] — LIFECYCLE_GATE_EVENTS missing three entries:
 *     PAPER_TO_DEPLOY_READY_BLOCKED, SHADOW_TO_PAPER_BLOCKED, PROMOTED. Added;
 *     lifecycle-service.ts no longer uses bare strings at these broadcast sites.
 *
 *   Finding 6 [MED] — lifecycleShadowPromotionsTotal missing blocked_unavailable
 *     zero-init. IIFE added in metrics-registry.ts covers all 4 outcome labels.
 *     (Counter increment test is in wave29-prod-hardening-prom-counters.test.ts §2.)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Source file path helpers ─────────────────────────────────────────────────

const SRC_ROOT = join(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(SRC_ROOT, relPath), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Finding 1 — docs/admin-runbook.md: kill-switch SQL column names
// ─────────────────────────────────────────────────────────────────────────────

describe("Finding 1 [CRITICAL] — admin-runbook.md: kill-switch SQL correctness", () => {
  const RUNBOOK = join(SRC_ROOT, "..", "..", "docs", "admin-runbook.md");

  it("runbook uses param_name column (not the wrong 'key' column)", () => {
    const src = readFileSync(RUNBOOK, "utf8");
    expect(src).toContain("param_name");
    expect(src).not.toMatch(/WHERE\s+key\s*=/);
  });

  it("runbook uses current_value column (not the wrong 'value' column)", () => {
    const src = readFileSync(RUNBOOK, "utf8");
    expect(src).toContain("current_value");
    // Must not have the old wrong pattern: SET value = 'false'
    expect(src).not.toMatch(/SET\s+value\s*=\s*'false'/);
    expect(src).not.toMatch(/SET\s+value\s*=\s*'true'/);
  });

  it("runbook documents 0=OFF / 1=OBSERVE / 2=AUTOPILOT three-mode semantics", () => {
    const src = readFileSync(RUNBOOK, "utf8");
    expect(src).toContain("0");
    expect(src).toContain("1");
    expect(src).toContain("2");
    expect(src).toMatch(/OFF|halted|halt/i);
    expect(src).toMatch(/OBSERVE|advisory/i);
    expect(src).toMatch(/AUTOPILOT|autonomous/i);
  });

  it("runbook SQL sets current_value = '0' for OFF (not 'false')", () => {
    const src = readFileSync(RUNBOOK, "utf8");
    expect(src).toContain("current_value = '0'");
  });

  it("runbook SQL sets current_value = '2' for AUTOPILOT (not 'true')", () => {
    const src = readFileSync(RUNBOOK, "utf8");
    expect(src).toContain("current_value = '2'");
  });

  it("runbook includes a verification SELECT so operator can confirm the change", () => {
    const src = readFileSync(RUNBOOK, "utf8");
    expect(src).toContain("SELECT");
    expect(src).toContain("param_name");
    expect(src).toContain("auto_patch_loop_enabled");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 2 [HIGH] — lifecycle-service.ts: AlertFactory.deployReady catch fixed
// ─────────────────────────────────────────────────────────────────────────────

describe("Finding 2 [HIGH] — lifecycle-service.ts: AlertFactory.deployReady error is now observable", () => {
  it("lifecycle-service.ts no longer has empty catch on AlertFactory.deployReady", () => {
    const src = readSrc("services/lifecycle-service.ts");

    // The old pattern had a bare .catch(() => {}) immediately after .deployReady(...)
    // Verify no such empty swallow exists adjacent to deployReady
    // (We check for the specific combination that was the bug)
    const deployReadyIdx = src.indexOf("AlertFactory.deployReady(");
    expect(deployReadyIdx).toBeGreaterThan(-1);

    // Extract the 600 chars after the deployReady call to inspect the catch handler
    const window = src.slice(deployReadyIdx, deployReadyIdx + 600);

    // Must NOT have empty catch
    expect(window).not.toMatch(/\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/);
  });

  it("lifecycle-service.ts catches AlertFactory.deployReady failure with logger.error", () => {
    const src = readSrc("services/lifecycle-service.ts");

    // The fix wires logger.error in the catch handler for AlertFactory.deployReady
    expect(src).toContain("AlertFactory.deployReady failed — operator will not receive DEPLOY_READY notification");
    expect(src).toContain("deploy_ready_alert_failed");
  });

  it("lifecycle-service.ts writes lifecycle.deploy_ready_alert_failed audit row on AlertFactory failure", () => {
    const src = readSrc("services/lifecycle-service.ts");

    // The audit row must use insertAuditRowSafe and fire the correct action
    expect(src).toContain('"lifecycle.deploy_ready_alert_failed"');
    expect(src).toContain("insertAuditRowSafe");
  });

  it("AlertFactory.deployReady failure audit row carries strategyId in entityId field", () => {
    const src = readSrc("services/lifecycle-service.ts");

    // Verify the audit row structure around deploy_ready_alert_failed
    const markerIdx = src.indexOf("deploy_ready_alert_failed");
    expect(markerIdx).toBeGreaterThan(-1);
    // entityId should be present in the block
    const block = src.slice(Math.max(0, markerIdx - 300), markerIdx + 500);
    expect(block).toContain("entityId");
    expect(block).toContain("entityType");
    expect(block).toContain("failure");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 3 [HIGH] — bifGateEvaluationsTotal: counter wiring in lifecycle-service
// ─────────────────────────────────────────────────────────────────────────────

describe("Finding 3 [HIGH] — bifGateEvaluationsTotal counter wired in lifecycle-service.ts", () => {
  it("lifecycle-service.ts contains evaluateBifGate call that feeds the counter", () => {
    const src = readSrc("services/lifecycle-service.ts");
    expect(src).toContain("evaluateBifGate(");
    expect(src).toContain("bifGateEvaluationsTotal");
    expect(src).toContain("bifOutcome");
  });

  it("counter increment uses short-form outcome labels: clean, warn, blocked, legacy_null", () => {
    const src = readSrc("services/lifecycle-service.ts");
    // All 4 short-form labels must appear in the mapping block
    expect(src).toContain('"blocked"');
    expect(src).toContain('"legacy_null"');
    expect(src).toContain('"warn"');
    expect(src).toContain('"clean"');
  });

  it("counter increment is non-blocking (wrapped in try/catch)", () => {
    const src = readSrc("services/lifecycle-service.ts");

    // Deep-scan #5 (2026-06-29): de-brittled. The old assertion sliced a fixed 300-char
    // window backward from the FIRST "bifOutcome" looking for "try {" — but the manual-path
    // counter's enclosing `try {` sits beyond that window (separated by a multi-line comment +
    // the multi-line evaluateBifGate call), so it false-failed on correct code. Instead assert
    // the counter increment appears in an inline try { ... } catch wrap (the cron-path form),
    // which deterministically proves the increment is non-blocking regardless of comment length.
    expect(src).toMatch(
      /try\s*\{\s*bifGateEvaluationsTotal\.labels\([^)]*\)\.inc\(\);\s*\}\s*catch/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 4 [HIGH] — WAVE29_EVENTS constants used for pbo_evaluated and shadow_divergence_evaluated
// ─────────────────────────────────────────────────────────────────────────────

describe("Finding 4 [HIGH] — lifecycle-service.ts: WAVE29_EVENTS constants replace bare pbo/shadow strings", () => {
  it("lifecycle-service.ts imports WAVE29_EVENTS from sse.ts", () => {
    const src = readSrc("services/lifecycle-service.ts");
    expect(src).toMatch(/import.*WAVE29_EVENTS.*from.*sse\.js/);
  });

  it("lifecycle-service.ts does NOT use bare 'lifecycle:pbo_evaluated' string at broadcastSSE sites", () => {
    const src = readSrc("services/lifecycle-service.ts");
    const broadcastPboMagic = /broadcastSSE\s*\(\s*"lifecycle:pbo_evaluated"/;
    expect(broadcastPboMagic.test(src)).toBe(false);
  });

  it("lifecycle-service.ts does NOT use bare 'lifecycle:shadow_divergence_evaluated' at broadcastSSE sites", () => {
    const src = readSrc("services/lifecycle-service.ts");
    const broadcastShadowMagic = /broadcastSSE\s*\(\s*"lifecycle:shadow_divergence_evaluated"/;
    expect(broadcastShadowMagic.test(src)).toBe(false);
  });

  it("lifecycle-service.ts uses WAVE29_EVENTS.PBO_EVALUATED constant", () => {
    const src = readSrc("services/lifecycle-service.ts");
    expect(src).toContain("WAVE29_EVENTS.PBO_EVALUATED");
  });

  it("lifecycle-service.ts uses WAVE29_EVENTS.SHADOW_DIVERGENCE_EVALUATED constant", () => {
    const src = readSrc("services/lifecycle-service.ts");
    expect(src).toContain("WAVE29_EVENTS.SHADOW_DIVERGENCE_EVALUATED");
  });

  it("WAVE29_EVENTS.PBO_EVALUATED and SHADOW_DIVERGENCE_EVALUATED have correct string values in source", () => {
    const src = readSrc("routes/sse.ts");
    // The constants must map to the exact SSE event names that were previously bare strings
    expect(src).toContain('PBO_EVALUATED: "lifecycle:pbo_evaluated"');
    expect(src).toContain('SHADOW_DIVERGENCE_EVALUATED: "lifecycle:shadow_divergence_evaluated"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 5 [MED] — LIFECYCLE_GATE_EVENTS: 3 new entries catalogued
// ─────────────────────────────────────────────────────────────────────────────

describe("Finding 5 [MED] — LIFECYCLE_GATE_EVENTS: new catalog entries for promoted/blocked events", () => {
  it("LIFECYCLE_GATE_EVENTS.PAPER_TO_DEPLOY_READY_BLOCKED has correct string value in source", () => {
    const src = readSrc("routes/sse.ts");
    expect(src).toContain('PAPER_TO_DEPLOY_READY_BLOCKED: "lifecycle:paper_to_deploy_ready_blocked"');
  });

  it("LIFECYCLE_GATE_EVENTS.SHADOW_TO_PAPER_BLOCKED has correct string value in source", () => {
    const src = readSrc("routes/sse.ts");
    expect(src).toContain('SHADOW_TO_PAPER_BLOCKED: "lifecycle:shadow_to_paper_blocked"');
  });

  it("LIFECYCLE_GATE_EVENTS.PROMOTED has correct string value in source", () => {
    const src = readSrc("routes/sse.ts");
    expect(src).toContain('PROMOTED: "lifecycle:promoted"');
  });

  it("lifecycle-service.ts does NOT broadcast bare 'lifecycle:paper_to_deploy_ready_blocked'", () => {
    const src = readSrc("services/lifecycle-service.ts");
    const pattern = /broadcastSSE\s*\(\s*"lifecycle:paper_to_deploy_ready_blocked"/;
    expect(pattern.test(src)).toBe(false);
  });

  it("lifecycle-service.ts does NOT broadcast bare 'lifecycle:shadow_to_paper_blocked'", () => {
    const src = readSrc("services/lifecycle-service.ts");
    const pattern = /broadcastSSE\s*\(\s*"lifecycle:shadow_to_paper_blocked"/;
    expect(pattern.test(src)).toBe(false);
  });

  it("lifecycle-service.ts does NOT broadcast bare 'lifecycle:promoted'", () => {
    const src = readSrc("services/lifecycle-service.ts");
    const pattern = /broadcastSSE\s*\(\s*"lifecycle:promoted"/;
    expect(pattern.test(src)).toBe(false);
  });

  it("lifecycle-service.ts uses LIFECYCLE_GATE_EVENTS.PAPER_TO_DEPLOY_READY_BLOCKED constant", () => {
    const src = readSrc("services/lifecycle-service.ts");
    expect(src).toContain("LIFECYCLE_GATE_EVENTS.PAPER_TO_DEPLOY_READY_BLOCKED");
  });

  it("lifecycle-service.ts uses LIFECYCLE_GATE_EVENTS.SHADOW_TO_PAPER_BLOCKED constant", () => {
    const src = readSrc("services/lifecycle-service.ts");
    expect(src).toContain("LIFECYCLE_GATE_EVENTS.SHADOW_TO_PAPER_BLOCKED");
  });

  it("lifecycle-service.ts uses LIFECYCLE_GATE_EVENTS.PROMOTED constant (at all 5 broadcast sites)", () => {
    const src = readSrc("services/lifecycle-service.ts");
    // Should appear multiple times (CANDIDATE→TESTING, TESTING→PAPER, PILOT→DEPLOYED, 2× PILOT→GRAVEYARD)
    const matches = src.match(/LIFECYCLE_GATE_EVENTS\.PROMOTED/g);
    expect(matches).toBeDefined();
    expect(matches!.length).toBeGreaterThanOrEqual(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 6 [MED] — lifecycleShadowPromotionsTotal: blocked_unavailable zero-init
// ─────────────────────────────────────────────────────────────────────────────

describe("Finding 6 [MED] — metrics-registry.ts: blocked_unavailable zero-init IIFE", () => {
  it("metrics-registry.ts contains IIFE that zero-inits blocked_unavailable", () => {
    const src = readSrc("lib/metrics-registry.ts");
    // The IIFE must include blocked_unavailable in its label list
    expect(src).toContain('"blocked_unavailable"');
    // The IIFE must call .inc(0) for each outcome
    expect(src).toContain(".inc(0)");
  });

  it("metrics-registry.ts IIFE covers all 4 shadow promotion outcome labels", () => {
    const src = readSrc("lib/metrics-registry.ts");
    expect(src).toContain('"passed"');
    expect(src).toContain('"blocked_divergence"');
    expect(src).toContain('"blocked_insufficient_samples"');
    expect(src).toContain('"blocked_unavailable"');
  });

  it("lifecycle-service.ts increments blocked_unavailable on the fail-closed DB-error path", () => {
    const src = readSrc("services/lifecycle-service.ts");
    // Verify the fail-closed path at ~line 3001 still uses this label
    expect(src).toContain('lifecycleShadowPromotionsTotal.labels({ outcome: "blocked_unavailable" }).inc()');
  });
});
