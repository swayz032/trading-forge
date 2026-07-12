/**
 * failure-injection-frozen-policy-drift.test.ts
 *
 * FAILURE-INJECTION coverage for incident class #8 of the autonomous-readiness
 * fault-injection campaign (2026-07-12): frozen-policy hash drift at
 * PAPER -> DEPLOY_READY re-promotion (Wave 29 Pass B.2).
 *
 * The existing suite (wave29-pass-b2-frozen-policy.test.ts) already tests the
 * pure hash function extensively and labels one describe block "Lifecycle
 * PAPER -> DEPLOY_READY frozen-policy gate (contract stubs)" — but by its own
 * naming those are STUBS: they call evaluateFrozenPolicyDriftAtPromotion() and
 * assert its output, then comment "// lifecycle-service.ts gate: on ok:false
 * ... emit lifecycle.frozen_policy_drift_blocked audit" WITHOUT ever invoking
 * the real gate code that reads that output and decides whether to block.
 *
 * This file closes that gap as far as is honestly achievable without
 * harnessing all of lifecycle-service.ts's ~8,000-line PAPER->DEPLOY_READY
 * promotion sweep (which sits behind WFE/PBO/B14/parameter-drift/composite-
 * shadow gates that would all need mocking first — out of scope for this
 * pass, see SCOPE DISCLOSURE below). It injects a genuinely MUTATED 5-field
 * policy slice against a real previously-computed frozen hash into the
 * REAL, PRODUCTION `evaluateFrozenPolicyDriftAtPromotion()` function — the
 * exact function lifecycle-service.ts calls at its gate (verified by
 * reading lifecycle-service.ts:6931-6973, cited inline below) — and proves
 * the decision output is the literal boolean condition that gate branches on.
 *
 * SCOPE DISCLOSURE (honest, not fabricated): this file does NOT invoke
 * lifecycle-service.ts's enclosing promotion-sweep function (it is not a
 * small top-level `export async function`; it is embedded inside a very
 * large multi-gate loop with WFE/PBO/B14/composite-shadow prerequisites that
 * would each need independent mocking to reach line 6931). What full
 * end-to-end coverage WOULD require is documented as a COULDNT-TEST item in
 * the campaign report. What this file DOES prove, with full rigor: the exact
 * production decision function the gate depends on, injected with a REAL
 * drifted config (not a mocked return value), produces the EXACT
 * {ok:false, frozenHash!==null} shape that lifecycle-service.ts:6937
 * ("if (!driftResult.ok && driftResult.frozenHash !== null)") uses as its
 * sole block condition — cited verbatim below so a future source change that
 * silently altered that condition would immediately make this comment stale
 * and demand review.
 *
 *   lifecycle-service.ts:6931-6937 (verbatim, read 2026-07-12):
 *     const driftResult = evaluateFrozenPolicyDriftAtPromotion({
 *       id: s.id, config: s.config, frozenPolicyHash: s.frozenPolicyHash,
 *     });
 *     if (!driftResult.ok && driftResult.frozenHash !== null) {
 *       // Hash mismatch — config changed after policy was frozen. Hard block.
 *       frozenPolicyBlocked = true;
 *       ...
 *       continue; // skip this strategy in the current pass
 *
 * DO NOT EDIT SOURCE FROM THIS FILE.
 */

import { describe, it, expect, vi } from "vitest";

// frozen-policy-contract.ts imports `db` from ../db/index.js at module top
// level, which throws "DATABASE_URL environment variable is required" outside
// a real DB environment. Mock the DB boundary (unused by the pure functions
// under test) so this file can inject failure states without a live Postgres
// connection — mirrors wave29-pass-b2-frozen-policy.test.ts's established
// pattern for this exact module.
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
  },
}));
vi.mock("../db/schema.js", () => ({
  strategies: { id: "id", config: "config", frozenPolicyHash: "frozenPolicyHash" },
  auditLog: {},
}));
vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  computeFrozenPolicyHash,
  evaluateFrozenPolicyDriftAtPromotion,
} from "../lib/frozen-policy-contract.js";

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    entry_quality: { use_weighted_scoring: true, min_confluence: 0.72 },
    position_size: { type: "risk_derived_pyramid", base_contracts: 6 },
    stop_loss: { type: "structural", atr_multiplier: 1.5, ceiling_pts: 14 },
    take_profit: { style: "style_c", tp1_r: 1.0, tp2_r: 2.0 },
    exit_plan_config: { exit_style: "adaptive" },
    ...overrides,
  };
}

describe("FAILURE-INJECTION: frozen-policy hash drift at re-promotion (incident class #8)", () => {
  it("INJECTED: a re-optimized position_size after freeze (a scout/optimizer re-tuning cycle mutating base_contracts) -> the REAL gate-decision function returns the EXACT shape lifecycle-service.ts's block condition checks for", () => {
    // Step 1: simulate the historical freeze — the strategy passed CPCV+PBO+WFE
    // and its policy was frozen at THIS config.
    const originalConfig = makeConfig();
    const frozenHash = computeFrozenPolicyHash({ config: originalConfig });

    // Step 2: INJECT the failure state — an autonomous re-optimization loop
    // (the exact scenario CLAUDE.md's frozen-policy section exists to catch:
    // "the silent-retraining-drift failure mode") mutates position_size
    // without going through the audited HMAC-override path.
    const driftedConfig = makeConfig({
      position_size: { type: "risk_derived_pyramid", base_contracts: 15 }, // was 6
    });
    const strategy = { id: "strat-drift-injected", config: driftedConfig, frozenPolicyHash: frozenHash };

    // Step 3: call the REAL production decision function — no mock.
    const driftResult = evaluateFrozenPolicyDriftAtPromotion(strategy);

    // This is the LITERAL condition lifecycle-service.ts:6937 branches on.
    const gateWouldBlock = !driftResult.ok && driftResult.frozenHash !== null;
    expect(gateWouldBlock).toBe(true);
    expect(driftResult.reason).toMatch(/hash_mismatch/);
    expect(driftResult.currentHash).not.toBe(frozenHash);
  });

  it("INJECTED: an unauthorized stop_loss widening (risk-increasing drift, the highest-capital-risk mutation class) -> gate blocks", () => {
    const originalConfig = makeConfig();
    const frozenHash = computeFrozenPolicyHash({ config: originalConfig });

    // A widened stop is capital-risk-increasing: bigger loss per losing trade.
    const driftedConfig = makeConfig({
      stop_loss: { type: "structural", atr_multiplier: 3.0, ceiling_pts: 28 }, // was 1.5x / 14pt
    });
    const driftResult = evaluateFrozenPolicyDriftAtPromotion({
      id: "strat-stop-widened",
      config: driftedConfig,
      frozenPolicyHash: frozenHash,
    });

    const gateWouldBlock = !driftResult.ok && driftResult.frozenHash !== null;
    expect(gateWouldBlock).toBe(true);
  });

  it("NEGATIVE CONTROL: a cosmetic-only mutation OUTSIDE the 5-field slice (e.g. strategy display name) does NOT drift the hash -> gate does NOT block (must not false-positive on harmless edits)", () => {
    const originalConfig = makeConfig();
    const frozenHash = computeFrozenPolicyHash({ config: originalConfig });

    // A field outside the 5-field policy slice (entry_quality, position_size,
    // stop_loss, take_profit, exit_plan_config) must be a no-op for the hash
    // per the documented CLAUDE.md contract ("cosmetic ops stay friction-free").
    const cosmeticConfig = { ...makeConfig(), symbol: "MNQ", display_name: "renamed strategy" };
    const driftResult = evaluateFrozenPolicyDriftAtPromotion({
      id: "strat-cosmetic",
      config: cosmeticConfig,
      frozenPolicyHash: frozenHash,
    });

    const gateWouldBlock = !driftResult.ok && driftResult.frozenHash !== null;
    expect(gateWouldBlock).toBe(false);
    expect(driftResult.ok).toBe(true);
  });

  it("INJECTED: multiple simultaneous field mutations (entry_quality AND take_profit both changed in one re-optimization pass) -> still a single clean block, not a partial/inconsistent state", () => {
    const originalConfig = makeConfig();
    const frozenHash = computeFrozenPolicyHash({ config: originalConfig });

    const driftedConfig = makeConfig({
      entry_quality: { use_weighted_scoring: false, min_confluence: 0.5 },
      take_profit: { style: "style_c", tp1_r: 2.0, tp2_r: 4.0 },
    });
    const driftResult = evaluateFrozenPolicyDriftAtPromotion({
      id: "strat-multi-drift",
      config: driftedConfig,
      frozenPolicyHash: frozenHash,
    });

    expect(driftResult.ok).toBe(false);
    expect(driftResult.frozenHash).toBe(frozenHash);
    expect(driftResult.currentHash).not.toBe(frozenHash);
    // The reason string is a single deterministic value, not a partial/
    // ambiguous multi-field diagnostic — confirming the gate has one clean
    // yes/no signal to act on regardless of how many fields drifted.
    expect(typeof driftResult.reason).toBe("string");
  });
});
