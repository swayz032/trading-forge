/**
 * cron-gate-fail-closed.test.ts — H-1 (2026-06-29) + F1 drift guard
 *
 * WHAT THIS GUARDS
 * ----------------
 * The AUTONOMOUS cron promotion path (`checkAutoPromotions` in lifecycle-service.ts)
 * is the PRIMARY promotion path. Five gate-evaluation catch blocks on that path used
 * to FAIL OPEN ("non-blocking — promotion continues") — a transient DB/import error
 * during the cron sweep silently advanced a strategy past the gate:
 *
 *   1. WFE          TESTING → PAPER            (catch var: wfeTpErr)
 *   2. param-drift  TESTING → PAPER            (catch var: driftTpErr)
 *   3. DSR          TESTING → PAPER            (catch var: dsrTpErr)
 *   4. DSR          PAPER   → DEPLOY_READY     (catch var: dsrPdrErr)
 *   5. BIF          PAPER   → DEPLOY_READY     (catch var: bifErr)
 *
 * H-1 changed all five to FAIL CLOSED, mirroring the B14 catch (~:2854 / ~:3846):
 * on exception they write a fail-closed `lifecycle.<gate>_gate_infra_error` audit row,
 * increment the `strategyPromotions` system_gate counter, and `continue` (skip the
 * promotion — it retries next cron cycle). The transition does NOT occur.
 *
 * WHY A SOURCE-STRUCTURAL TEST (F1 drift guard, not a full cron invocation)
 * ------------------------------------------------------------------------
 * Each of these five catch blocks sits BEHIND every preceding hard gate on its
 * transition (e.g. the WFE TESTING→PAPER catch is only reachable after the B14
 * ci_high gate PASSES, which itself needs a completed MC run; the PAPER→DEPLOY_READY
 * catches sit behind B14 + B15 + A7 + drift). The `db` dependency is a module
 * singleton (`import { db } from "../db/index.js"`), not constructor-injected, so a
 * runtime invocation of `checkAutoPromotions` would require a hand-sequenced mock that
 * returns a different array for each of dozens of `.select()` calls in exact order —
 * one off-by-one and the test passes for the WRONG reason without ever reaching the
 * catch. The repo's gate-chain-integration.test.ts deliberately tests the PURE gate
 * functions through PGlite for exactly this reason, and does NOT drive the service.
 *
 * This test therefore asserts the fail-DIRECTION of each catch block at the source
 * level (the smallest reliable unit that pins the invariant). It is deterministic,
 * fails against the pre-H-1 fail-open code, and passes after. The parity invariant —
 * B14 + these 4 gates ALL fail-closed on the cron path — is asserted explicitly so a
 * future edit that reverts any single block to fail-open is caught in CI.
 *
 * (Repo precedent for source-structural lifecycle assertions:
 *  src/server/services/test_pass2c_lifecycle_fixes.test.ts.)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = resolve(__dirname, "../services/lifecycle-service.ts");

/**
 * Extract the body of `} catch (<catchVar>) { ... }` by brace-matching from the
 * first `{` after the catch token to its matching close. Returns the inner text.
 */
function extractCatchBlock(source: string, catchVar: string): string {
  const marker = `catch (${catchVar})`;
  const markerIdx = source.indexOf(marker);
  if (markerIdx === -1) {
    throw new Error(`catch (${catchVar}) not found in lifecycle-service.ts — block renamed or removed`);
  }
  const openIdx = source.indexOf("{", markerIdx);
  if (openIdx === -1) throw new Error(`no opening brace after catch (${catchVar})`);
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(openIdx + 1, i);
    }
  }
  throw new Error(`unbalanced braces in catch (${catchVar})`);
}

// The 5 in-scope cron catch blocks: catch var → expected fail-closed audit action + transition.
const CRON_FAIL_CLOSED_CATCHES: ReadonlyArray<{
  catchVar: string;
  gate: string;
  action: string;
  fromState: string;
  toState: string;
}> = [
  { catchVar: "wfeTpErr",   gate: "WFE",          action: "lifecycle.wfe_gate_infra_error",            fromState: "TESTING", toState: "PAPER" },
  { catchVar: "driftTpErr", gate: "param-drift",  action: "lifecycle.parameter_drift_gate_infra_error", fromState: "TESTING", toState: "PAPER" },
  { catchVar: "dsrTpErr",   gate: "DSR",          action: "lifecycle.dsr_gate_infra_error",            fromState: "TESTING", toState: "PAPER" },
  { catchVar: "dsrPdrErr",  gate: "DSR",          action: "lifecycle.dsr_gate_infra_error",            fromState: "PAPER",   toState: "DEPLOY_READY" },
  { catchVar: "bifErr",     gate: "BIF",          action: "lifecycle.bif_gate_infra_error",            fromState: "PAPER",   toState: "DEPLOY_READY" },
];

describe("H-1: autonomous-cron gate-exception catches FAIL CLOSED (F1 parity guard)", () => {
  let source: string;

  beforeAll(() => {
    source = readFileSync(SOURCE_PATH, "utf8");
  });

  for (const { catchVar, gate, action, fromState, toState } of CRON_FAIL_CLOSED_CATCHES) {
    describe(`${gate} ${fromState}→${toState} (catch ${catchVar})`, () => {
      let block: string;

      beforeAll(() => {
        block = extractCatchBlock(source, catchVar);
      });

      it("writes the fail-closed audit action", () => {
        expect(block).toContain(`action: "${action}"`);
        // status MUST be "failure" (fail-closed audit semantics, audit_log NOT NULL).
        expect(block).toContain(`status: "failure"`);
        expect(block).toContain(`decisionAuthority: "gate"`);
      });

      it("records the correct transition in the audit input", () => {
        expect(block).toContain(`fromState: "${fromState}"`);
        expect(block).toContain(`toState: "${toState}"`);
      });

      it("increments the strategyPromotions system_gate counter", () => {
        expect(block).toContain("strategyPromotions.labels(");
        expect(block).toContain(`from_state: "${fromState}"`);
        expect(block).toContain(`to_state: "${toState}"`);
        expect(block).toContain(`actor: "system_gate"`);
      });

      it("skips the promotion this cycle (continue — retries next cron tick)", () => {
        expect(block).toContain("continue;");
      });

      it("does NOT fall through fail-open (no 'promotion continues')", () => {
        // The exact pre-H-1 fail-open marker. Its presence in this block = regression.
        expect(block).not.toContain("promotion continues");
        // The pre-H-1 blocks also pushed "data_unavailable" onto gateEvidenceStatuses
        // (PAPER→DEPLOY_READY) and then fell through. A fail-closed block continues
        // BEFORE the evidence aggregation, so it must not push evidence and proceed.
        expect(block).not.toContain('gateEvidenceStatuses.push("data_unavailable")');
      });
    });
  }

  it("PARITY INVARIANT: B14 + WFE + param-drift + DSR + BIF ALL fail-closed on the cron path", () => {
    // B14 was already correct (the reference pattern) — prove it is still present on
    // BOTH cron transitions so this guard documents the full 5-gate parity, not just
    // the 4 newly-hardened gates.
    expect(source).toContain('action: "b14.gate_error_fail_closed"'); // B14 reference (TESTING→PAPER & PAPER→DEPLOY_READY)

    // All 4 newly-hardened fail-closed actions must be present somewhere in the source.
    const requiredActions = [
      "lifecycle.wfe_gate_infra_error",
      "lifecycle.parameter_drift_gate_infra_error",
      "lifecycle.dsr_gate_infra_error",
      "lifecycle.bif_gate_infra_error",
    ];
    for (const a of requiredActions) {
      expect(source).toContain(`action: "${a}"`);
    }

    // Each of the 5 in-scope catch blocks must terminate with `continue;` (fail-closed
    // skip) and contain NO fail-open fall-through marker.
    for (const { catchVar } of CRON_FAIL_CLOSED_CATCHES) {
      const block = extractCatchBlock(source, catchVar);
      expect(block).toContain("continue;");
      expect(block).not.toContain("promotion continues");
    }
  });
});
