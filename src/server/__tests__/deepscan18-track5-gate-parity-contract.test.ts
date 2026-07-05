/**
 * deepscan18-track5-gate-parity-contract.test.ts — Deep-Scan #18 Track 5
 *
 * Source-text + subprocess contract tests for:
 *   D-D1: cron-vs-manual PAPER→DEPLOY_READY gate-parity net (scripts/check-gate-parity.mjs)
 *   D-D2: stale-detector NEEDS_REVISION edges are now valid in VALID_TRANSITIONS
 *   D-D3: Wave-29 PBO gate catch is fail-CLOSED (no PBO-bypass path per §12)
 *   D-D4: schema.ts lifecycle_state comment enumerates all 12 states incl. SHADOW
 *
 * Convention: source-text assertions mirror lifecycle-gauntlet-hardening.test.ts —
 * lifecycle-service.ts requires heavy DB mocking to exercise directly, so the contract
 * is asserted against the source + the parity script is run as a real subprocess.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const LIFECYCLE_PATH = resolve(process.cwd(), "src/server/services/lifecycle-service.ts");
const SCHEMA_PATH = resolve(process.cwd(), "src/server/db/schema.ts");
const PARITY_SCRIPT = resolve(process.cwd(), "scripts/check-gate-parity.mjs");

// ─────────────────────────────────────────────────────────────────────────────
// D-D1 — gate-parity net
// ─────────────────────────────────────────────────────────────────────────────

describe("D-D1 — PAPER→DEPLOY_READY cron-vs-manual gate-parity net", () => {
  it("check:gate-parity passes (exit 0) on the current tree — all HARD gates on both paths", () => {
    const res = spawnSync("node", [PARITY_SCRIPT], { encoding: "utf8" });
    // Surface stdout/stderr on failure for a legible diagnosis.
    if (res.status !== 0) {
      // eslint-disable-next-line no-console
      console.error(res.stdout, res.stderr);
    }
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("parity OK");
  });

  it("enumerates the 12 canonical HARD gates that must fire on both paths", () => {
    const src = readFileSync(PARITY_SCRIPT, "utf8");
    // The registry must name every hard gate the incident class covers (A-1 / A7 + the
    // Wave 27.5 / 29 stack). A missing entry here is itself a parity blind spot.
    for (const id of [
      "compliance_drift",
      "a1_dsl_guards",
      "a7_signal_correlation",
      "b14_survival_twin",
      "b14_ci",
      "b15_param_robustness",
      "parameter_drift",
      "dsr_walk_forward",
      "slippage_survival",
      "bif",
      "orchestrator",
      "frozen_policy",
    ]) {
      expect(src).toContain(`id: "${id}"`);
    }
  });

  it("is a HARD gate — exit 1 on any parity violation, and cannot silently pass on a broken anchor", () => {
    const src = readFileSync(PARITY_SCRIPT, "utf8");
    expect(src).toContain("process.exit(1)");
    // Anchor-not-found routes through fail() → non-empty errors → exit 1 (never a silent pass).
    expect(src).toContain("Region anchor NOT FOUND");
  });

  it("documents the A-1 / A7 incident as the reason the net exists", () => {
    const src = readFileSync(PARITY_SCRIPT, "utf8");
    expect(src).toContain("A-1");
    expect(src).toContain("A7");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-D2 — stale-detector NEEDS_REVISION edges valid in VALID_TRANSITIONS
// ─────────────────────────────────────────────────────────────────────────────

function transitionTargetsLine(src: string, fromState: string): string {
  const idx = src.indexOf(`${fromState}: [`);
  expect(idx).toBeGreaterThan(-1);
  const end = src.indexOf("]", idx);
  return src.slice(idx, end + 1);
}

describe("D-D2 — VALID_TRANSITIONS allows stale-detector NEEDS_REVISION demotion edges", () => {
  it("PAPER → NEEDS_REVISION is now a valid transition", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(transitionTargetsLine(src, "PAPER")).toContain('"NEEDS_REVISION"');
  });

  it("DEPLOY_READY → NEEDS_REVISION is now a valid transition", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(transitionTargetsLine(src, "DEPLOY_READY")).toContain('"NEEDS_REVISION"');
  });

  it("PILOT and DEPLOYED do NOT get a NEEDS_REVISION edge (real-capital demotion-exempt states)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(transitionTargetsLine(src, "PILOT")).not.toContain('"NEEDS_REVISION"');
    expect(transitionTargetsLine(src, "DEPLOYED")).not.toContain('"NEEDS_REVISION"');
  });

  it("stale-detector still writes NEEDS_REVISION as its max demotion (contract producer)", () => {
    const staleSrc = readFileSync(
      resolve(process.cwd(), "src/server/services/strategy-stale-detector.ts"),
      "utf8",
    );
    expect(staleSrc).toContain('toState: "NEEDS_REVISION"');
    // The CAS still excludes the real-capital states, matching the VALID_TRANSITIONS omission.
    expect(staleSrc).toContain("NOT IN ('DEPLOYED', 'PILOT')");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-D3 — Wave-29 PBO gate catch fail-CLOSED
// ─────────────────────────────────────────────────────────────────────────────

describe("D-D3 — Wave-29 PBO gate read/eval error is fail-CLOSED (§12: no PBO-bypass path)", () => {
  it("catch (pboW29Err) block returns { success: false } (blocks promotion)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const idx = src.indexOf("catch (pboW29Err)");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 3400);
    expect(block).toContain("return { success: false");
    expect(block).toContain("lifecycle.pbo_gate_error_fail_closed");
  });

  it("no longer describes itself as non-blocking / promotion-continues", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const idx = src.indexOf("catch (pboW29Err)");
    const block = src.slice(idx, idx + 3400);
    expect(block).not.toContain("Non-blocking: PBO gate failure must not abort a promotion");
    expect(block).not.toContain("non-blocking — promotion continues");
  });

  it("emits a loud audit row + Prom counter on the fail-closed path (matching sibling gates)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const idx = src.indexOf("catch (pboW29Err)");
    const block = src.slice(idx, idx + 3400);
    expect(block).toContain('action: "lifecycle.pbo_gate_error_fail_closed"');
    expect(block).toContain("pboBlocksTotal.labels");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-D4 — schema comment enumerates all 12 lifecycle states incl. SHADOW
// ─────────────────────────────────────────────────────────────────────────────

describe("D-D4 — schema.ts lifecycle_state comment enumerates all 12 states", () => {
  it("the lifecycle_state column comment includes SHADOW", () => {
    const src = readFileSync(SCHEMA_PATH, "utf8");
    const idx = src.indexOf('lifecycleState: text("lifecycle_state")');
    expect(idx).toBeGreaterThan(-1);
    const line = src.slice(idx, src.indexOf("\n", idx));
    for (const state of [
      "CANDIDATE",
      "TESTING",
      "SHADOW",
      "PAPER",
      "DEPLOY_READY",
      "PILOT",
      "DEPLOYED",
      "DECLINING",
      "RETIRED",
      "GRAVEYARD",
      "NEEDS_ARCHETYPE",
      "NEEDS_REVISION",
    ]) {
      expect(line).toContain(state);
    }
  });
});
