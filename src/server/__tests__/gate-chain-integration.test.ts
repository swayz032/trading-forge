/**
 * gate-chain-integration.test.ts — hardening/phase-0 2026-06-22
 *
 * Integration tests: WFE, PBO, B15, and shadow-divergence gate chains
 * round-tripped through a real PGlite in-memory PostgreSQL database.
 *
 * B14 ci_high gate is already covered by a dedicated file:
 *   src/server/__tests__/integration/b14-ruin-ci.integration.test.ts
 *
 * WHY THIS EXISTS
 * ---------------
 * 45% of the test suite mocks the DB, making green CI structurally incapable
 * of catching producer→DB→gate key-path disconnects.  This bug class has shipped
 * green repeatedly:
 *   - B14: Python wrote `bca_confidence_intervals.ci_high`; TS read `probability_of_ruin_ci.ci_high`
 *   - B15: `b15Battery.passed` vs `b15Battery.battery_passed` — silent-pass on gate failure
 *   - Shadow: INTEGER vs UUID on `strategy_id` (composite-shadow disconnect, 2026-06-23)
 *
 * WHAT EACH TEST DOES
 * -------------------
 * For each gate:
 *   1. INSERT data into PGlite using the PRODUCER's assumed write path (exact JSONB key)
 *   2. SELECT via Drizzle using the CONSUMER's read path (same keys lifecycle-service.ts uses)
 *   3. Pass to the real gate function and assert correct passed/blocked decision
 *
 * NEGATIVE (DISCONNECT) TESTS
 * ---------------------------
 * Each gate section includes a negative test that writes using the WRONG key name,
 * then shows exactly what the gate sees (null / undefined) and what decision it makes.
 * These are documentary tests: they prove the exact silent-pass that occurs when
 * a producer drifts to a different key name while the consumer stays fixed.
 *
 * CONSTRAINTS:
 *   - No edits to any production source file
 *   - No git add / git commit
 *   - Only this new test file
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, desc } from "drizzle-orm";
import { createTestDb } from "./helpers/pglite-db.js";
import type { TestDb } from "./helpers/pglite-db.js";
import { evaluateWfeGate } from "../lib/wfe-gate.js";
import { evaluatePboGate } from "../lib/pbo-gate.js";
import { evaluateDsrWalkForwardGate } from "../lib/b14-ci-gate.js";
import { evaluateBifGate } from "../lib/bif-gate.js";
import { evaluateSlippageSurvivalGate } from "../lib/slippage-survival-gate.js";
// deep-scan #15 FIX M1: shared evidence-completeness roll-up accounting.
import { isIncompleteEvidenceStatus, slippageEvidenceBucket } from "../lib/evidence-completeness.js";
import { evaluateParameterDriftGate } from "../lib/parameter-drift-gate.js";
// Deep-scan #5 F-2 (2026-06-29): import the PURE frozen-policy fns from the DB-free module
// (frozen-policy-hash.js) NOT frozen-policy-contract.js — the latter imports ../db/index.js,
// which throws on missing DATABASE_URL and would crash this whole gate-chain file at collection.
import { evaluateFrozenPolicyDriftAtPromotion, computeFrozenPolicyHash } from "../lib/frozen-policy-hash.js";
import {
  backtests,
  strategies,
  lifecycleShadowSignals,
  quantumRlRuns,
} from "../db/schema.js";
import {
  compareShadowToBacktest,
  type ShadowSignal,
  type ExpectedSignal,
} from "../lib/shadow-signal-divergence-checker.js";

// ─── UUID namespaces (one prefix per test suite, no collisions) ───────────────
//
// WFE suite:   cc0000xx-...
// PBO suite:   dd0000xx-...
// DSR suite:   ab0000xx-...
// B15 suite:   ee0000xx-...
// Shadow suite: ff0000xx-...

// ════════════════════════════════════════════════════════════════════════════════
// Suite 1 — WFE gate DB round-trip
// ════════════════════════════════════════════════════════════════════════════════

describe("WFE gate — backtests.walk_forward_results.wfe_overall round-trip (PGlite)", () => {
  let ctx: TestDb;

  const STRAT_ID    = "cc000001-0000-0000-0000-000000000001";
  const BT_PASS     = "cc000001-0000-0000-0000-000000000010"; // wfe_overall=0.80 → PASS
  const BT_BLOCK65  = "cc000001-0000-0000-0000-000000000011"; // wfe_overall=0.65 → BLOCK
  const BT_DEG      = "cc000001-0000-0000-0000-000000000012"; // wfe_status=degenerate_is → BLOCK
  const BT_WRONGKEY = "cc000001-0000-0000-0000-000000000013"; // wrong key wfe_score → silent null

  beforeAll(async () => {
    ctx = await createTestDb();

    await ctx.db.insert(strategies).values({
      id: STRAT_ID,
      name: "wfe-integration-test",
      symbol: "MES",
      timeframe: "5m",
      config: {},
    });

    await ctx.db.insert(backtests).values([
      {
        id: BT_PASS,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // PRODUCER writes: wfe_overall = 0.80 → should PASS the gate (≥ 0.70 floor)
        walkForwardResults: { wfe_overall: 0.80, wfe_status: "ok" },
      },
      {
        id: BT_BLOCK65,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // PRODUCER writes: wfe_overall = 0.65 → should BLOCK (< 0.70 hard floor)
        // This is the key parity fix 2026-06-22: the [0.50, 0.70) band previously
        // returned status="warned" which was treated as PASS. Now it's BLOCK.
        walkForwardResults: { wfe_overall: 0.65, wfe_status: "ok" },
      },
      {
        id: BT_DEG,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // PRODUCER writes: wfe_overall=0.90 but wfe_status="degenerate_is"
        // The G2a hardening (2026-06-22) requires BLOCK here regardless of the
        // numeric value — IS windows produced non-positive/absent Sharpe.
        walkForwardResults: { wfe_overall: 0.90, wfe_status: "degenerate_is" },
      },
      {
        id: BT_WRONGKEY,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // DISCONNECT: producer drifts to writing `wfe_score` instead of `wfe_overall`.
        // Consumer reads `wfe_overall` → gets undefined → gate sees null → legacy-grandfather PASS.
        // The real WFE was 0.30 (below floor) but the gate never sees it.
        walkForwardResults: { wfe_score: 0.30, wfe_status: "ok" },
      },
    ]);
  });

  afterAll(async () => { await ctx.close(); });

  // ── Helper: SELECT a single row's walk_forward_results ─────────────────────
  async function selectWfr(btId: string) {
    const [row] = await ctx.db
      .select({ wfr: backtests.walkForwardResults })
      .from(backtests)
      .where(eq(backtests.id, btId));
    return row?.wfr as Record<string, unknown> | null;
  }

  it("JSONB round-trip preserves wfe_overall numeric value and wfe_status string", async () => {
    const wfr = await selectWfr(BT_PASS);
    expect(wfr).toBeDefined();
    expect(wfr?.wfe_overall).toBe(0.80);
    expect(wfr?.wfe_status).toBe("ok");
  });

  it("PASS: wfe_overall=0.80 (above hard floor 0.70) → gate status=passed", async () => {
    const wfr = await selectWfr(BT_PASS);
    const wfeOverall = (wfr?.wfe_overall ?? null) as number | null;
    const wfeStatus = (wfr?.wfe_status ?? null) as string | null;

    const result = evaluateWfeGate(wfeOverall, undefined, undefined, wfeStatus);

    expect(result.passed).toBe(true);
    expect(result.status).toBe("passed");
    expect(result.wfeOverall).toBe(0.80);
    // Happy path: no audit action emitted
    expect(result.auditAction).toBeNull();
  });

  it("BLOCK: wfe_overall=0.65 (in formerly-warned band [0.50,0.70)) → gate status=blocked (parity fix 2026-06-22)", async () => {
    const wfr = await selectWfr(BT_BLOCK65);
    const wfeOverall = (wfr?.wfe_overall ?? null) as number | null;
    const wfeStatus = (wfr?.wfe_status ?? null) as string | null;

    const result = evaluateWfeGate(wfeOverall, undefined, undefined, wfeStatus);

    // CRITICAL: Pre-2026-06-22 this returned status="warned" with passed=true.
    // The parity fix now returns status="blocked" with passed=false.
    // If this assertion fails, the parity fix was reverted.
    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.wfeOverall).toBe(0.65);
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });

  it("BLOCK: wfe_status=degenerate_is → gate blocks regardless of wfe_overall=0.90 (G2a hardening)", async () => {
    const wfr = await selectWfr(BT_DEG);
    const wfeOverall = (wfr?.wfe_overall ?? null) as number | null;
    const wfeStatus = (wfr?.wfe_status ?? null) as string | null;

    // Confirm the JSONB correctly preserved the degenerate_is status
    expect(wfeOverall).toBe(0.90); // high numeric value would normally pass
    expect(wfeStatus).toBe("degenerate_is");

    const result = evaluateWfeGate(wfeOverall, undefined, undefined, wfeStatus);

    // The degenerate_is flag MUST take priority over the numeric value.
    expect(result.passed).toBe(false);
    expect(result.status).toBe("degenerate_is_block");
    expect(result.auditAction).toBe("lifecycle.wfe_degenerate_is_block");
  });

  it("DISCONNECT (wrong key): producer writes wfe_score=0.30; consumer reads wfe_overall=null → grandfather PASS", async () => {
    const wfr = await selectWfr(BT_WRONGKEY);

    // Prove the wrong key was written and IS present
    expect((wfr as any)?.wfe_score).toBe(0.30);

    // Consumer reads wfe_overall (the correct key) → undefined → null
    const wfeOverall = (wfr?.wfe_overall ?? null) as number | null;
    const wfeStatus = (wfr?.wfe_status ?? null) as string | null;

    // The gap: consumer sees null because wrong key was used
    expect(wfeOverall).toBeNull();

    const result = evaluateWfeGate(wfeOverall, undefined, undefined, wfeStatus);

    // Gate sees null → legacy grandfather pass (treats as pre-Wave-27.5 backtest).
    // The real WFE was 0.30 (blocking) but the gate never saw it.
    // This is a SILENT PRODUCER→CONSUMER KEY DISCONNECT.
    expect(result.passed).toBe(true);
    expect(result.status).toBe("legacy_null");
    expect(result.auditAction).toBe("lifecycle.wfe_unavailable_legacy");
    // The test documents the vulnerability: wrong key → silent grandfather pass.
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite 2 — PBO gate DB round-trip
// ════════════════════════════════════════════════════════════════════════════════

describe("PBO gate — backtests.walk_forward_results.pbo_overall round-trip (PGlite)", () => {
  let ctx: TestDb;

  const STRAT_ID    = "dd000001-0000-0000-0000-000000000001";
  const BT_PASS     = "dd000001-0000-0000-0000-000000000010"; // pbo_overall=0.10 → PASS
  const BT_BLOCK    = "dd000001-0000-0000-0000-000000000011"; // pbo_overall=0.20 → BLOCK
  const BT_LEGACY   = "dd000001-0000-0000-0000-000000000012"; // no pbo_overall key → legacy PASS
  const BT_WRONGKEY = "dd000001-0000-0000-0000-000000000013"; // wrong key `pbo` → null → legacy PASS

  beforeAll(async () => {
    ctx = await createTestDb();

    await ctx.db.insert(strategies).values({
      id: STRAT_ID,
      name: "pbo-integration-test",
      symbol: "MES",
      timeframe: "5m",
      config: {},
    });

    await ctx.db.insert(backtests).values([
      {
        id: BT_PASS,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // pbo_overall = 0.10 ≤ 0.15 threshold → PASS
        walkForwardResults: { pbo_overall: 0.10 },
      },
      {
        id: BT_BLOCK,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // pbo_overall = 0.20 > 0.15 threshold → BLOCK
        walkForwardResults: { pbo_overall: 0.20 },
      },
      {
        id: BT_LEGACY,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // No pbo_overall key at all — pre-Wave-29 backtest → grandfather PASS
        walkForwardResults: { wfe_overall: 0.80 },
      },
      {
        id: BT_WRONGKEY,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // DISCONNECT: producer writes `pbo` instead of `pbo_overall`.
        // Consumer reads `pbo_overall` → undefined → null → legacy grandfather PASS.
        // The real PBO was 0.20 (blocking) but the gate never sees it.
        walkForwardResults: { pbo: 0.20, wfe_overall: 0.80 },
      },
    ]);
  });

  afterAll(async () => { await ctx.close(); });

  async function selectPboRow(btId: string) {
    const [row] = await ctx.db
      .select({ wfr: backtests.walkForwardResults })
      .from(backtests)
      .where(eq(backtests.id, btId));
    return row?.wfr as Record<string, unknown> | null;
  }

  it("JSONB round-trip preserves pbo_overall numeric value", async () => {
    const wfr = await selectPboRow(BT_PASS);
    expect(wfr?.pbo_overall).toBe(0.10);
  });

  it("PASS: pbo_overall=0.10 (≤ 0.15 threshold) → gate ok=true", async () => {
    const wfr = await selectPboRow(BT_PASS);
    const pboOverall = (wfr?.pbo_overall ?? null) as number | null;

    const result = evaluatePboGate({ pbo_overall: pboOverall ?? undefined });

    expect(result.ok).toBe(true);
    expect(result.pbo).toBe(0.10);
    expect(result.legacyNull).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_within_threshold");
  });

  it("BLOCK: pbo_overall=0.20 (> 0.15 threshold, strict >) → gate ok=false", async () => {
    const wfr = await selectPboRow(BT_BLOCK);
    const pboOverall = (wfr?.pbo_overall ?? null) as number | null;

    expect(pboOverall).toBe(0.20);

    const result = evaluatePboGate({ pbo_overall: pboOverall ?? undefined });

    expect(result.ok).toBe(false);
    expect(result.pbo).toBe(0.20);
    expect(result.legacyNull).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_overfit_block");
    expect(result.auditPayload.blocked).toBe(true);
  });

  it("LEGACY PASS: no pbo_overall key (pre-Wave-29 backtest) → gate ok=true (grandfather)", async () => {
    const wfr = await selectPboRow(BT_LEGACY);
    // Confirm the key is genuinely absent
    expect(wfr?.pbo_overall).toBeUndefined();

    const pboOverall = (wfr?.pbo_overall ?? null) as number | null;
    expect(pboOverall).toBeNull();

    const result = evaluatePboGate({ pbo_overall: pboOverall ?? undefined });

    expect(result.ok).toBe(true);
    expect(result.legacyNull).toBe(true);
    expect(result.reason).toBe("lifecycle.pbo_unavailable_legacy");
  });

  it("BLOCK (pure function): NaN pbo_overall → gate ok=false (NaN > 0.15 === false would silently pass without guard)", () => {
    // This tests the non-finite guard added in hardening/phase-0.
    // The DB disconnect: Python json.dumps(float('nan')) produces "NaN" (non-standard JSON);
    // when JS receives NaN through some other path, `NaN > 0.15 === false` would
    // silently PASS the gate — the non-finite guard prevents this.
    //
    // Note: JavaScript JSON.stringify({pbo_overall: NaN}) → {"pbo_overall":null}
    // (NaN is not a valid JSON value; it becomes null in the DB round-trip).
    // So this test exercises the gate function directly, not via DB insert.
    const result = evaluatePboGate({ pbo_overall: NaN });

    // Without the Number.isFinite() guard: NaN > 0.15 === false → would PASS.
    // With the guard: BLOCK with sample-size guard reason.
    expect(result.ok).toBe(false);
    expect(result.legacyNull).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_sample_size_guard");
    expect(result.auditPayload.blocked).toBe(true);
  });

  it("DISCONNECT (wrong key): producer writes pbo=0.20; consumer reads pbo_overall=null → grandfather PASS", async () => {
    const wfr = await selectPboRow(BT_WRONGKEY);

    // Confirm the wrong key is present
    expect((wfr as any)?.pbo).toBe(0.20);

    // Consumer reads pbo_overall (correct key) → undefined → null
    const pboOverall = (wfr?.pbo_overall ?? null) as number | null;
    expect(pboOverall).toBeNull();

    const result = evaluatePboGate({ pbo_overall: pboOverall ?? undefined });

    // Gate sees null → legacy grandfather pass.
    // The real PBO was 0.20 (blocking) but the gate never saw it.
    expect(result.ok).toBe(true);
    expect(result.legacyNull).toBe(true);
    expect(result.reason).toBe("lifecycle.pbo_unavailable_legacy");
    // The test documents: wrong key = silent grandfather pass even when PBO=0.20 > 0.15.
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite 2b — DSR walk-forward gate DB round-trip
// ════════════════════════════════════════════════════════════════════════════════
//
// The DSR gate is the one hardening-batch gate previously missing from this
// producer→DB→gate regression guard. It reads
//   backtests.walk_forward_results.wf_metadata.{dsr_pass, dsr_unavailable, dsr}
// (walk_forward.py FIX 7 / Wave A, 2026-06-22) and lifecycle-service.ts consumes
// it at PAPER → DEPLOY_READY via evaluateDsrWalkForwardGate. The wrong-key
// disconnect mirrors the B14/B15 silent-pass class: a producer that writes
// `dsr_passed` (the honest-SR field name) instead of the consumer's `dsr_pass`
// yields undefined → legacy grandfather PASS, never seeing a real DSR-floor fail.

describe("DSR gate — backtests.walk_forward_results.wf_metadata.dsr_pass round-trip (PGlite)", () => {
  let ctx: TestDb;

  const STRAT_ID    = "ab000001-0000-0000-0000-000000000001";
  const BT_PASS     = "ab000001-0000-0000-0000-000000000010"; // dsr_pass=true → PASS
  const BT_BLOCK    = "ab000001-0000-0000-0000-000000000011"; // dsr_pass=false → BLOCK (floor)
  const BT_LEGACY   = "ab000001-0000-0000-0000-000000000012"; // no dsr_pass key → legacy PASS
  const BT_WRONGKEY = "ab000001-0000-0000-0000-000000000013"; // wrong key dsr_passed → null → legacy PASS

  beforeAll(async () => {
    ctx = await createTestDb();

    await ctx.db.insert(strategies).values({
      id: STRAT_ID,
      name: "dsr-integration-test",
      symbol: "MES",
      timeframe: "5m",
      config: {},
    });

    await ctx.db.insert(backtests).values([
      {
        id: BT_PASS,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // PRODUCER writes: wf_metadata.dsr_pass=true → gate passes clean.
        walkForwardResults: { wf_metadata: { dsr_pass: true, dsr: 0.62 } },
      },
      {
        id: BT_BLOCK,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // PRODUCER writes: dsr_pass=false (honest SR below floor) → BLOCK.
        walkForwardResults: { wf_metadata: { dsr_pass: false, dsr: 0.18 } },
      },
      {
        id: BT_LEGACY,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // No dsr_pass key — pre-Wave-A backtest → grandfather PASS (legacy_proceed).
        walkForwardResults: { wf_metadata: { mode: "cpcv" } },
      },
      {
        id: BT_WRONGKEY,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // DISCONNECT: producer writes `dsr_passed` instead of `dsr_pass`.
        // Consumer reads `dsr_pass` → undefined → legacy grandfather PASS.
        // The real DSR failed the floor (dsr_passed=false) but the gate never sees it.
        walkForwardResults: { wf_metadata: { dsr_passed: false, dsr: 0.18 } },
      },
    ]);
  });

  afterAll(async () => { await ctx.close(); });

  // Mirror lifecycle-service.ts: read walk_forward_results.wf_metadata, pass to gate.
  async function selectWfMeta(btId: string) {
    const [row] = await ctx.db
      .select({ wfr: backtests.walkForwardResults })
      .from(backtests)
      .where(eq(backtests.id, btId));
    const wfr = (row?.wfr as Record<string, unknown> | null) ?? null;
    return (wfr?.wf_metadata as Record<string, unknown> | null) ?? null;
  }

  it("JSONB round-trip preserves wf_metadata.dsr_pass boolean and dsr numeric", async () => {
    const meta = await selectWfMeta(BT_PASS);
    expect(meta?.dsr_pass).toBe(true);
    expect(meta?.dsr).toBe(0.62);
  });

  it("PASS: wf_metadata.dsr_pass=true → gate status=pass", async () => {
    const meta = await selectWfMeta(BT_PASS);

    const result = evaluateDsrWalkForwardGate(
      meta as { dsr_pass?: boolean | null; dsr_unavailable?: boolean | null; dsr?: number | null } | null,
    );

    expect(result.passed).toBe(true);
    expect(result.status).toBe("pass");
    expect(result.auditAction).toBeNull();
  });

  it("BLOCK: wf_metadata.dsr_pass=false → gate status=blocked_dsr_floor", async () => {
    const meta = await selectWfMeta(BT_BLOCK);
    expect(meta?.dsr_pass).toBe(false);

    const result = evaluateDsrWalkForwardGate(
      meta as { dsr_pass?: boolean | null; dsr_unavailable?: boolean | null; dsr?: number | null } | null,
    );

    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked_dsr_floor");
    expect(result.auditAction).toBe("lifecycle.dsr_floor_block");
    expect(result.auditPayload.blocked).toBe(true);
  });

  it("LEGACY PASS: no dsr_pass key (pre-Wave-A backtest) → gate proceeds (grandfather)", async () => {
    const meta = await selectWfMeta(BT_LEGACY);
    // Confirm the key is genuinely absent
    expect(meta?.dsr_pass).toBeUndefined();

    const result = evaluateDsrWalkForwardGate(
      meta as { dsr_pass?: boolean | null; dsr_unavailable?: boolean | null; dsr?: number | null } | null,
    );

    expect(result.passed).toBe(true);
    expect(result.status).toBe("legacy_proceed");
    expect(result.auditAction).toBe("lifecycle.dsr_unavailable_legacy");
  });

  it("DISCONNECT (wrong key): producer writes dsr_passed=false; consumer reads dsr_pass=null → grandfather PASS", async () => {
    const meta = await selectWfMeta(BT_WRONGKEY);

    // Confirm the wrong key IS present in the stored JSONB
    expect((meta as any)?.dsr_passed).toBe(false);

    // Consumer reads dsr_pass (the correct key) → undefined
    expect(meta?.dsr_pass).toBeUndefined();

    const result = evaluateDsrWalkForwardGate(
      meta as { dsr_pass?: boolean | null; dsr_unavailable?: boolean | null; dsr?: number | null } | null,
    );

    // Gate sees no dsr_pass → legacy grandfather pass. The real DSR failed the
    // floor (dsr_passed=false) but the gate never saw it.
    // This documents the SILENT PRODUCER→CONSUMER KEY DISCONNECT (dsr_passed vs dsr_pass).
    expect(result.passed).toBe(true);
    expect(result.status).toBe("legacy_proceed");
    expect(result.auditAction).toBe("lifecycle.dsr_unavailable_legacy");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite 3 — B15 gate DB round-trip
// ════════════════════════════════════════════════════════════════════════════════

describe("B15 gate — backtests.b15_battery.passed round-trip (PGlite)", () => {
  let ctx: TestDb;

  const STRAT_ID      = "ee000001-0000-0000-0000-000000000001";
  const BT_PASS       = "ee000001-0000-0000-0000-000000000010"; // passed=true → gate allows
  const BT_BLOCK      = "ee000001-0000-0000-0000-000000000011"; // passed=false, enabled=true → BLOCK
  const BT_NULL       = "ee000001-0000-0000-0000-000000000012"; // b15Battery=null → skip (phantom-gate fix)
  const BT_WRONGKEY   = "ee000001-0000-0000-0000-000000000013"; // wrong key battery_passed → silent null

  beforeAll(async () => {
    ctx = await createTestDb();

    await ctx.db.insert(strategies).values({
      id: STRAT_ID,
      name: "b15-integration-test",
      symbol: "MES",
      timeframe: "5m",
      config: {},
    });

    await ctx.db.insert(backtests).values([
      {
        id: BT_PASS,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // PRODUCER writes: passed=true with all metrics above threshold
        b15Battery: {
          passed: true,
          sdr: 0.85,
          psi: 0.80,
          rws: 0.78,
          failures: [],
          thresholds: { sdr: 0.70, psi: 0.70, rws: 0.70 },
        },
      },
      {
        id: BT_BLOCK,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // PRODUCER writes: passed=false (SDR below threshold)
        b15Battery: {
          passed: false,
          sdr: 0.50,
          psi: 0.82,
          rws: 0.79,
          failures: ["sdr"],
          thresholds: { sdr: 0.70, psi: 0.70, rws: 0.70 },
        },
      },
      {
        id: BT_NULL,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // PRODUCER: b15Battery not yet run (pre-B15 backtest or battery disabled)
        // b15Battery is null → phantom-gate fix: skip, do NOT hard-block
        b15Battery: null,
      },
      {
        id: BT_WRONGKEY,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // DISCONNECT: producer writes `battery_passed` instead of `passed`.
        // Consumer reads `b15Battery.passed` → undefined → NOT === false → silent gate allow.
        b15Battery: {
          battery_passed: false,  // wrong key
          sdr: 0.50,
          psi: 0.82,
          rws: 0.79,
          failures: ["sdr"],
        },
      },
    ]);
  });

  afterAll(async () => { await ctx.close(); });

  async function selectB15(btId: string) {
    const [row] = await ctx.db
      .select({ b15Battery: backtests.b15Battery })
      .from(backtests)
      .where(eq(backtests.id, btId));
    return row?.b15Battery as Record<string, unknown> | null;
  }

  // The exact condition from lifecycle-service.ts / paper-to-deploy-ready-gates.ts (Gate 3):
  //   const b15 = input.b15Battery;
  //   if (b15 != null && b15.passed === false && b15HardGateEnabled) { BLOCK }
  function isB15Blocked(b15: Record<string, unknown> | null, enabled = true): boolean {
    return b15 != null && b15.passed === false && enabled;
  }

  it("JSONB round-trip preserves b15Battery shape including passed boolean and sub-metrics", async () => {
    const b15 = await selectB15(BT_PASS);
    expect(b15).toBeDefined();
    expect(b15?.passed).toBe(true);
    expect(b15?.sdr).toBe(0.85);
    expect(b15?.psi).toBe(0.80);
    expect(b15?.rws).toBe(0.78);
    expect(Array.isArray(b15?.failures)).toBe(true);
  });

  it("PASS: b15Battery.passed=true → gate condition false → allows promotion", async () => {
    const b15 = await selectB15(BT_PASS);
    expect(b15?.passed).toBe(true);
    // The lifecycle-service gate condition:
    expect(isB15Blocked(b15)).toBe(false);
  });

  it("BLOCK: b15Battery.passed=false and b15HardGateEnabled=true → gate blocks", async () => {
    const b15 = await selectB15(BT_BLOCK);
    expect(b15?.passed).toBe(false);
    expect(b15?.sdr).toBe(0.50);
    expect(b15?.failures).toEqual(["sdr"]);
    // The lifecycle-service gate condition:
    expect(isB15Blocked(b15, true)).toBe(true);
  });

  it("ADVISORY: b15Battery.passed=false but b15HardGateEnabled=false → gate does NOT block (emergency override)", async () => {
    const b15 = await selectB15(BT_BLOCK);
    // When the hard gate is disabled via B15_BATTERY_ENABLED=false,
    // a failed battery is advisory-only.
    expect(isB15Blocked(b15, false)).toBe(false);
  });

  it("NULL SKIP (phantom-gate fix): b15Battery=null and enabled=true → gate skips (no block, no silent-pass)", async () => {
    const b15 = await selectB15(BT_NULL);

    // Confirm null was round-tripped correctly
    expect(b15).toBeNull();

    // The gate condition requires b15 != null as its first check.
    // With null, the condition short-circuits to false → gate does NOT block.
    // This is the phantom-gate fix (2026-06-27): pre-fix this was a silent PASS;
    // post-fix it's still a pass but with an explicit legacy warn emitted by the caller.
    expect(isB15Blocked(b15, true)).toBe(false);
    // The gate skipping null is correct behaviour: pre-B15 backtests lack this data.
  });

  it("DISCONNECT (wrong key): producer writes battery_passed=false; consumer reads passed=undefined → silent allow", async () => {
    const b15 = await selectB15(BT_WRONGKEY);

    // Confirm the wrong key IS present in the stored JSONB
    expect((b15 as any)?.battery_passed).toBe(false);

    // Consumer reads the correct key `passed` → undefined (not present)
    expect(b15?.passed).toBeUndefined();

    // The gate condition: b15.passed === false → undefined === false → false → ALLOWS promotion.
    // The strategy failed B15 (sdr=0.50 < threshold 0.70) but the gate never sees it.
    expect(isB15Blocked(b15, true)).toBe(false);
    // This documents the SILENT PRODUCER→CONSUMER KEY DISCONNECT:
    // if a producer writes `battery_passed` instead of `passed`, the B15 gate is entirely bypassed.
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite 4 — Shadow divergence — lifecycle_shadow_signals DB round-trip (PGlite)
// ════════════════════════════════════════════════════════════════════════════════

describe("Shadow divergence — lifecycle_shadow_signals read + compareShadowToBacktest (PGlite)", () => {
  let ctx: TestDb;

  // Three strategy IDs: one per scenario (insufficient/pass/block).
  // This prevents query cross-contamination without filtering by scenario.
  const STRAT_10      = "ff000001-0000-0000-0000-000000000001"; // 10 signals → insufficient_samples
  const STRAT_PASS    = "ff000001-0000-0000-0000-000000000002"; // 20 aligned signals → PASS
  const STRAT_BLOCK   = "ff000001-0000-0000-0000-000000000003"; // 20 direction-mismatched → BLOCK

  // Base timestamp: 2025-01-01 10:00:00 UTC as a fixed reference
  const BASE_TS = new Date("2025-01-01T10:00:00.000Z");
  const BASE_EPOCH = Math.floor(BASE_TS.getTime() / 1000);

  /**
   * Build N shadow signal insert rows for a given strategy.
   * Each signal is spaced exactly 300s (1 bar) apart from BASE_TS.
   * This matches the comparator's default barSeconds=300 tolerance.
   */
  function buildSignalRows(
    strategyId: string,
    n: number,
    direction: "long" | "short",
    startIndex = 0,
  ) {
    return Array.from({ length: n }, (_, i) => ({
      strategyId,
      signalTs: new Date(BASE_TS.getTime() + (startIndex + i) * 300_000),
      direction,
      entryPrice: 5800,
      intendedSize: 3,
      sourceCorrelationId: `shadow-int-${strategyId.slice(-1)}-${i}`,
    }));
  }

  /**
   * Build N expected signals aligned to the same timestamps as buildSignalRows.
   */
  function buildExpectedSignals(n: number, direction: "long" | "short", startIndex = 0): ExpectedSignal[] {
    return Array.from({ length: n }, (_, i) => ({
      signal_ts: BASE_EPOCH + (startIndex + i) * 300,
      direction,
      entry_price: 5800,
      intended_size: 3,
    }));
  }

  /**
   * Replicate shadow-signal-divergence-loader.ts#loadShadowSignalsForStrategy
   * using the test DB instead of the production DB.
   *
   * This is intentionally the SAME query pattern the loader uses, proving that:
   *   1. The column names (signalTs, direction, entryPrice, intendedSize) exist in schema.ts
   *   2. The ORDER BY + LIMIT + reverse chronological reordering works correctly
   *   3. The TIMESTAMPTZ→epoch conversion (Math.floor(new Date(row.signalTs).getTime()/1000))
   *      produces the correct integer seconds
   *   4. Real schema.ts columns map to the data exactly as the loader expects
   *
   * Note: loadShadowSignalsForStrategy() imports `db` from the production db module,
   * so it cannot be called with the test db directly. This function replicates its
   * exact logic with ctx.db so the key path is fully integration-tested.
   */
  async function loadShadowSignalsFromTestDb(
    strategyId: string,
    n = 20,
  ): Promise<ShadowSignal[]> {
    const rows = await ctx.db
      .select({
        signalTs: lifecycleShadowSignals.signalTs,
        direction: lifecycleShadowSignals.direction,
        entryPrice: lifecycleShadowSignals.entryPrice,
        intendedSize: lifecycleShadowSignals.intendedSize,
        killzone: lifecycleShadowSignals.killzone,
        regime: lifecycleShadowSignals.regime,
        confluenceScore: lifecycleShadowSignals.confluenceScore,
      })
      .from(lifecycleShadowSignals)
      .where(eq(lifecycleShadowSignals.strategyId, strategyId))
      .orderBy(desc(lifecycleShadowSignals.signalTs))
      .limit(n);

    // Mirror loader: reverse from newest-first to oldest-first for comparator stability
    rows.reverse();

    return rows.map((row) => ({
      signal_ts: Math.floor(new Date(row.signalTs).getTime() / 1000),
      direction: row.direction,
      entry_price: row.entryPrice != null ? Number(row.entryPrice) : 0,
      intended_size: row.intendedSize ?? 1,
      killzone: row.killzone ?? undefined,
      regime: row.regime ?? undefined,
      confluence_score: row.confluenceScore != null ? Number(row.confluenceScore) : null,
    }));
  }

  beforeAll(async () => {
    ctx = await createTestDb();

    // Seed 3 strategies
    await ctx.db.insert(strategies).values([
      { id: STRAT_10,    name: "shadow-10",      symbol: "MES", timeframe: "5m", config: {} },
      { id: STRAT_PASS,  name: "shadow-pass-20", symbol: "MES", timeframe: "5m", config: {} },
      { id: STRAT_BLOCK, name: "shadow-block-20", symbol: "MES", timeframe: "5m", config: {} },
    ]);

    // STRAT_10: 10 signals (below MIN_SAMPLE_SIZE=20)
    await ctx.db.insert(lifecycleShadowSignals).values(
      buildSignalRows(STRAT_10, 10, "long"),
    );

    // STRAT_PASS: 20 long signals — all will match expected (same direction/size/timing)
    await ctx.db.insert(lifecycleShadowSignals).values(
      buildSignalRows(STRAT_PASS, 20, "long"),
    );

    // STRAT_BLOCK: 20 short signals — expected will be long → all 20 have direction violations
    await ctx.db.insert(lifecycleShadowSignals).values(
      buildSignalRows(STRAT_BLOCK, 20, "short"),
    );
  });

  afterAll(async () => { await ctx.close(); });

  it("DB round-trip: lifecycle_shadow_signals INSERT → SELECT returns correct row count and field types", async () => {
    const rows = await ctx.db
      .select({
        signalTs: lifecycleShadowSignals.signalTs,
        direction: lifecycleShadowSignals.direction,
        entryPrice: lifecycleShadowSignals.entryPrice,
        intendedSize: lifecycleShadowSignals.intendedSize,
      })
      .from(lifecycleShadowSignals)
      .where(eq(lifecycleShadowSignals.strategyId, STRAT_PASS));

    expect(rows.length).toBe(20);
    // Confirm field types match what the loader expects
    expect(typeof rows[0]!.direction).toBe("string");
    expect(rows[0]!.direction).toBe("long");
    // entryPrice comes back as a number from REAL column
    expect(typeof Number(rows[0]!.entryPrice)).toBe("number");
    expect(Number(rows[0]!.entryPrice)).toBe(5800);
    // intendedSize is INTEGER
    expect(rows[0]!.intendedSize).toBe(3);
    // signalTs is a Date (TIMESTAMPTZ → JS Date)
    expect(rows[0]!.signalTs).toBeInstanceOf(Date);
  });

  it("TIMESTAMPTZ → epoch conversion: Math.floor(new Date(signalTs).getTime()/1000) matches inserted epoch", async () => {
    // Verify the timestamp round-trip used by the loader is accurate.
    const rows = await ctx.db
      .select({ signalTs: lifecycleShadowSignals.signalTs })
      .from(lifecycleShadowSignals)
      .where(eq(lifecycleShadowSignals.strategyId, STRAT_PASS))
      .orderBy(desc(lifecycleShadowSignals.signalTs))
      .limit(1);

    expect(rows.length).toBe(1);
    const signalTs = rows[0]!.signalTs;
    const actualEpoch = Math.floor(new Date(signalTs).getTime() / 1000);

    // The last signal was inserted at BASE_TS + 19 * 300s
    const expectedEpoch = BASE_EPOCH + 19 * 300;
    expect(actualEpoch).toBe(expectedEpoch);
  });

  it("BLOCK: 10 shadow signals (< MIN_SAMPLE_SIZE=20) → comparator blocks with insufficient_samples", async () => {
    const shadowSignals = await loadShadowSignalsFromTestDb(STRAT_10, 20);
    expect(shadowSignals.length).toBe(10);

    const expected = buildExpectedSignals(10, "long");
    const result = compareShadowToBacktest(shadowSignals, expected);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient_samples");
    expect(result.sample_size).toBe(10);
  });

  it("PASS: 20 direction/size/timing-aligned shadow signals → divergence_pct=0 → gate ok=true", async () => {
    const shadowSignals = await loadShadowSignalsFromTestDb(STRAT_PASS, 20);
    expect(shadowSignals.length).toBe(20);

    // Expected signals aligned perfectly to the same timestamps and direction
    const expected = buildExpectedSignals(20, "long");
    const result = compareShadowToBacktest(shadowSignals, expected);

    expect(result.ok).toBe(true);
    expect(result.divergence_pct).toBe(0);
    expect(result.sample_size).toBe(20);
    expect(result.per_signal_violations.length).toBe(0);
  });

  it("BLOCK: 20 shadow signals all SHORT; expected all LONG → 100% direction divergence → gate ok=false", async () => {
    const shadowSignals = await loadShadowSignalsFromTestDb(STRAT_BLOCK, 20);
    expect(shadowSignals.length).toBe(20);

    // Expected signals in opposite direction
    const expected = buildExpectedSignals(20, "long");  // expected LONG
    // Shadow signals are SHORT (seeded as "short")
    expect(shadowSignals[0]!.direction).toBe("short");

    const result = compareShadowToBacktest(shadowSignals, expected);

    expect(result.ok).toBe(false);
    expect(result.sample_size).toBe(20);
    // All 20 signals have direction violations → divergence_pct = 1.0
    expect(result.divergence_pct).toBeCloseTo(1.0, 2);

    const directionViolations = result.per_signal_violations.filter(
      (v) => v.divergence_type === "direction",
    );
    expect(directionViolations.length).toBe(20);
  });

  it("BLOCK boundary: exactly 5% divergence (1 of 20 signals wrong) → gate ok=false (≥ 5% threshold is blocking)", async () => {
    // Build 20 signals: 19 LONG and 1 SHORT (5% divergence = exactly at the blocking threshold).
    // The comparator blocks at divergence_pct >= DIVERGENCE_THRESHOLD (0.05, inclusive).
    const mixed = shadowSignals_19long1short();
    const expected = buildExpectedSignals(20, "long");

    const result = compareShadowToBacktest(mixed, expected);

    expect(result.sample_size).toBe(20);
    expect(result.per_signal_violations.length).toBe(1);
    expect(result.divergence_pct).toBeCloseTo(0.05, 4);
    // BOUNDARY: exactly 5% → ok=false (inclusive boundary: >= 0.05 blocks)
    expect(result.ok).toBe(false);
  });

  it("PASS boundary: 4.9% divergence (< 20 signals, 1/21 = 4.76%) → gate ok=true", () => {
    // Build 21 in-memory signals: 20 LONG, 1 SHORT.
    // 1/21 ≈ 0.0476 < 0.05 → ok=true.
    const mixed: ShadowSignal[] = [
      ...Array.from({ length: 20 }, (_, i) => ({
        signal_ts: BASE_EPOCH + i * 300,
        direction: "long" as const,
        entry_price: 5800,
        intended_size: 3,
      })),
      {
        signal_ts: BASE_EPOCH + 20 * 300,
        direction: "short" as const,  // 1 mismatch
        entry_price: 5800,
        intended_size: 3,
      },
    ];
    const expected: ExpectedSignal[] = Array.from({ length: 21 }, (_, i) => ({
      signal_ts: BASE_EPOCH + i * 300,
      direction: "long",
      entry_price: 5800,
      intended_size: 3,
    }));

    const result = compareShadowToBacktest(mixed, expected);

    expect(result.sample_size).toBe(21);
    expect(result.per_signal_violations.length).toBe(1);
    // 1/21 ≈ 0.0476 < 0.05 → passes
    expect(result.divergence_pct).toBeCloseTo(1 / 21, 4);
    expect(result.ok).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite 5 — CPCV-exempt gate round-trip (hardening/phase-0)
// ════════════════════════════════════════════════════════════════════════════════
//
// Verifies the full producer→DB→gate chain for CPCV-mode backtests.
// Key invariants:
//   1. wfe_status="cpcv_not_applicable" in JSONB → gate returns "cpcv_exempt", NOT "legacy_null"
//      auditAction="lifecycle.wfe_cpcv_exempt", NOT "lifecycle.wfe_unavailable_legacy"
//   2. wf_metadata.pbo_degenerate_reason="cpcv_is_sharpe_unavailable" → gate returns
//      reason="lifecycle.pbo_cpcv_is_unavailable", NOT "lifecycle.pbo_unavailable_legacy"
//      legacyNull=false, cpcv_exempt=true in auditPayload
//   3. Regression: plain-WF wfe_overall=0.30 (below floor), no wfe_status → still BLOCKS
//   4. Regression: plain-WF pbo_overall=0.20 → still BLOCKS

describe("CPCV-exempt gate round-trip — WFE + PBO through PGlite (hardening/phase-0)", () => {
  let ctx: TestDb;

  // Suite 5 IDs use prefix "55"
  const STRAT_ID   = "55000001-0000-0000-0000-000000000001";
  const BT_CPCV    = "55000001-0000-0000-0000-000000000010"; // CPCV mode: wfe_status=cpcv_not_applicable + pbo_degenerate_reason
  const BT_PLAINSF = "55000001-0000-0000-0000-000000000011"; // Plain WF: wfe_overall=0.30 → still BLOCKS
  const BT_PLAINPB = "55000001-0000-0000-0000-000000000012"; // Plain WF: pbo_overall=0.20 → still BLOCKS

  beforeAll(async () => {
    ctx = await createTestDb();

    await ctx.db.insert(strategies).values({
      id: STRAT_ID,
      name: "cpcv-exempt-integration-test",
      symbol: "MES",
      timeframe: "5m",
      config: {},
    });

    await ctx.db.insert(backtests).values([
      {
        id: BT_CPCV,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // Producer: walk_forward.py CPCV mode emits:
        //   wfe_overall=None/null + wfe_status="cpcv_not_applicable" (top-level)
        //   wf_metadata.pbo_degenerate_reason="cpcv_is_sharpe_unavailable"
        //   wf_metadata.bif_reliable=false
        walkForwardResults: {
          wfe_overall: null,
          wfe_status: "cpcv_not_applicable",
          wf_metadata: {
            mode: "cpcv",
            n_paths: 18,
            pbo_degenerate_reason: "cpcv_is_sharpe_unavailable",
            bif_reliable: false,
          },
        },
      },
      {
        id: BT_PLAINSF,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // Regression guard: a plain-WF strategy with wfe_overall=0.30 MUST still BLOCK.
        // The CPCV-exempt fix must NOT weaken this.
        walkForwardResults: { wfe_overall: 0.30, wfe_status: "ok" },
      },
      {
        id: BT_PLAINPB,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // Regression guard: a plain-WF strategy with pbo_overall=0.20 > 0.15 MUST BLOCK.
        walkForwardResults: { pbo_overall: 0.20 },
      },
    ]);
  });

  afterAll(async () => { await ctx.close(); });

  async function selectWfRow(btId: string) {
    const [row] = await ctx.db
      .select({ wfr: backtests.walkForwardResults })
      .from(backtests)
      .where(eq(backtests.id, btId));
    return row?.wfr as Record<string, unknown> | null;
  }

  // ── WFE CPCV-exempt ─────────────────────────────────────────────────────────

  it("CPCV WFE: wfe_status=cpcv_not_applicable stored and retrieved from PGlite JSONB", async () => {
    const wfr = await selectWfRow(BT_CPCV);
    expect(wfr?.wfe_overall).toBeNull();
    expect(wfr?.wfe_status).toBe("cpcv_not_applicable");
    const meta = wfr?.wf_metadata as Record<string, unknown>;
    expect(meta?.mode).toBe("cpcv");
    expect(meta?.pbo_degenerate_reason).toBe("cpcv_is_sharpe_unavailable");
    expect(meta?.bif_reliable).toBe(false);
  });

  it("CPCV WFE: wfe_status=cpcv_not_applicable → gate returns cpcv_exempt, NOT legacy_null", async () => {
    const wfr = await selectWfRow(BT_CPCV);
    const wfeOverall = (wfr?.wfe_overall ?? null) as number | null;
    const wfeStatus = (wfr?.wfe_status ?? null) as string | null;

    const result = evaluateWfeGate(wfeOverall, undefined, undefined, wfeStatus);

    // Must be "cpcv_exempt", never "legacy_null"
    expect(result.status).toBe("cpcv_exempt");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.wfe_cpcv_exempt");
    // Must NOT produce the generic legacy action
    expect(result.auditAction).not.toBe("lifecycle.wfe_unavailable_legacy");
    expect(result.status).not.toBe("legacy_null");
  });

  // ── PBO CPCV-exempt ─────────────────────────────────────────────────────────

  it("CPCV PBO: pbo_degenerate_reason retrieved from wf_metadata JSONB (nested one level)", async () => {
    const wfr = await selectWfRow(BT_CPCV);
    const innerMeta = (wfr?.wf_metadata as Record<string, unknown> | null) ?? null;
    expect(innerMeta?.pbo_degenerate_reason).toBe("cpcv_is_sharpe_unavailable");
  });

  it("CPCV PBO: pbo_degenerate_reason=cpcv_is_sharpe_unavailable → gate reason=pbo_cpcv_is_unavailable, legacyNull=false", async () => {
    const wfr = await selectWfRow(BT_CPCV);
    const pboOverall = (wfr?.pbo_overall ?? null) as number | null;
    const innerMeta = (wfr?.wf_metadata as Record<string, unknown> | null) ?? null;
    const pboDegenReason = (innerMeta?.pbo_degenerate_reason as string | null) ?? null;

    const result = evaluatePboGate({
      pbo_overall: pboOverall,
      pbo_degenerate_reason: pboDegenReason,
    });

    expect(result.ok).toBe(true);
    expect(result.legacyNull).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_cpcv_is_unavailable");
    expect(result.auditPayload.cpcv_exempt).toBe(true);
    // Must NOT produce the generic legacy action or legacy_null=true
    expect(result.reason).not.toBe("lifecycle.pbo_unavailable_legacy");
    expect(result.auditPayload.legacy_null).toBe(false);
  });

  // ── Regression guards ────────────────────────────────────────────────────────

  it("regression: plain-WF wfe_overall=0.30 (below 0.70 floor) → BLOCKS (CPCV-exempt must not weaken this)", async () => {
    const wfr = await selectWfRow(BT_PLAINSF);
    const wfeOverall = (wfr?.wfe_overall ?? null) as number | null;
    const wfeStatus = (wfr?.wfe_status ?? null) as string | null;

    expect(wfeOverall).toBe(0.30);

    const result = evaluateWfeGate(wfeOverall, undefined, undefined, wfeStatus);

    expect(result.status).toBe("blocked");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });

  it("regression: plain-WF pbo_overall=0.20 (> 0.15 threshold) → BLOCKS (CPCV-exempt must not weaken this)", async () => {
    const wfr = await selectWfRow(BT_PLAINPB);
    const pboOverall = (wfr?.pbo_overall ?? null) as number | null;

    expect(pboOverall).toBe(0.20);

    const result = evaluatePboGate({ pbo_overall: pboOverall });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_overfit_block");
    expect(result.legacyNull).toBe(false);
  });
});

// ─── Private helper (outside describe scope, used in suite 4 only) ─────────────

function shadowSignals_19long1short(): ShadowSignal[] {
  const BASE_EPOCH = Math.floor(new Date("2025-01-01T10:00:00.000Z").getTime() / 1000);
  return Array.from({ length: 20 }, (_, i) => ({
    signal_ts: BASE_EPOCH + i * 300,
    direction: i === 19 ? ("short" as const) : ("long" as const), // last one wrong
    entry_price: 5800,
    intended_size: 3,
  }));
}

// ════════════════════════════════════════════════════════════════════════════════
// Suite 6 — BIF gate — backtests.bif numeric column round-trip (PGlite)
// Closes accuracy-validator F-1/H6: WRC/SPA/BIF had no gate-chain integration coverage.
// `bif` is a Drizzle numeric() column → Postgres returns it as a STRING in JS, so the
// consumer must Number()-coerce it. This suite proves the coercion + PASS/BLOCK/LEGACY.
// ════════════════════════════════════════════════════════════════════════════════
describe("BIF gate — backtests.bif numeric column round-trip + string-coercion (PGlite)", () => {
  let ctx: TestDb;

  const STRAT_ID    = "ba000001-0000-0000-0000-000000000001";
  const BT_CLEAN    = "ba000001-0000-0000-0000-000000000010"; // bif=1.5 → clean PASS
  const BT_BLOCK    = "ba000001-0000-0000-0000-000000000011"; // bif=5.0 → BLOCK (>4.0)
  const BT_LEGACY   = "ba000001-0000-0000-0000-000000000012"; // bif=null → grandfather PASS

  beforeAll(async () => {
    ctx = await createTestDb();
    await ctx.db.insert(strategies).values({
      id: STRAT_ID, name: "bif-integration-test", symbol: "MES", timeframe: "5m", config: {},
    });
    await ctx.db.insert(backtests).values([
      { id: BT_CLEAN, strategyId: STRAT_ID, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        bif: "1.5", kEff: "8" },
      { id: BT_BLOCK, strategyId: STRAT_ID, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        bif: "5.0", kEff: "8" },
      { id: BT_LEGACY, strategyId: STRAT_ID, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        bif: null, kEff: null },
    ]);
  });
  afterAll(async () => { await ctx.close(); });

  async function selectBif(btId: string) {
    const [row] = await ctx.db
      .select({ bif: backtests.bif, kEff: backtests.kEff })
      .from(backtests).where(eq(backtests.id, btId));
    return row;
  }

  it("numeric column round-trips as STRING (Drizzle numeric semantics) — consumer must coerce", async () => {
    const row = await selectBif(BT_CLEAN);
    // Postgres numeric → JS string. If this ever becomes a number, the coercion
    // contract changed and downstream Number() is now redundant (still safe).
    expect(typeof row?.bif).toBe("string");
    expect(Number(row?.bif)).toBe(1.5);
  });

  it("PASS: bif=1.5 (≤ 2.0 warn floor) → gate passed, reason bif.clean", async () => {
    const row = await selectBif(BT_CLEAN);
    const result = evaluateBifGate(Number(row?.bif), Number(row?.kEff));
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("bif.clean");
  });

  it("BLOCK: bif=5.0 (> 4.0 block threshold) → gate passed=false", async () => {
    const row = await selectBif(BT_BLOCK);
    const result = evaluateBifGate(Number(row?.bif), Number(row?.kEff));
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("bif.blocked_exceeds_threshold");
  });

  it("LEGACY PASS: bif=null (pre-Wave-3 backtest) → grandfather pass", async () => {
    const row = await selectBif(BT_LEGACY);
    // null coerces to NaN via Number(null)=0 — so guard on the raw null, mirroring
    // the consumer (lifecycle passes null, not Number(null)).
    const rawBif = row?.bif == null ? null : Number(row.bif);
    const result = evaluateBifGate(rawBif, null);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("bif.legacy_null_pre_wave3");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite 7 — WRC gate — backtests.wrc_result.p_value JSONB key round-trip (PGlite)
// The false-green class: a silent Python-side key rename → consumer reads null →
// grandfather pass, invisible to CI. This suite FAILS if the p_value key drifts.
// ════════════════════════════════════════════════════════════════════════════════
describe("WRC gate — backtests.wrc_result.p_value key round-trip + disconnect (PGlite)", () => {
  let ctx: TestDb;

  const STRAT_ID    = "bb000001-0000-0000-0000-000000000001";
  const BT_SIG      = "bb000001-0000-0000-0000-000000000010"; // p_value=0.01 significant
  const BT_INSIG    = "bb000001-0000-0000-0000-000000000011"; // p_value=0.40 insignificant
  const BT_WRONGKEY = "bb000001-0000-0000-0000-000000000012"; // wrong key `pvalue` → null

  beforeAll(async () => {
    ctx = await createTestDb();
    await ctx.db.insert(strategies).values({
      id: STRAT_ID, name: "wrc-integration-test", symbol: "MES", timeframe: "5m", config: {},
    });
    await ctx.db.insert(backtests).values([
      { id: BT_SIG, strategyId: STRAT_ID, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        wrcResult: { p_value: 0.01, n_strategies: 1 } },
      { id: BT_INSIG, strategyId: STRAT_ID, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        wrcResult: { p_value: 0.40, n_strategies: 1 } },
      { id: BT_WRONGKEY, strategyId: STRAT_ID, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        wrcResult: { pvalue: 0.01 } },
    ]);
  });
  afterAll(async () => { await ctx.close(); });

  async function selectWrc(btId: string) {
    const [row] = await ctx.db
      .select({ wrc: backtests.wrcResult }).from(backtests).where(eq(backtests.id, btId));
    return row?.wrc as Record<string, unknown> | null;
  }

  it("round-trip: consumer reads .p_value (the lifecycle-service.ts:521 key) — significant", async () => {
    const wrc = await selectWrc(BT_SIG);
    const wrcPValue = (wrc?.p_value as number | null | undefined) ?? null;
    expect(wrcPValue).toBe(0.01); // significant (< 0.05) → orchestrator wrc_p passes
  });

  it("round-trip: insignificant p_value preserved (orchestrator wrc_p would block)", async () => {
    const wrc = await selectWrc(BT_INSIG);
    const wrcPValue = (wrc?.p_value as number | null | undefined) ?? null;
    expect(wrcPValue).toBe(0.40); // ≥ 0.05 → not significant → block input
  });

  it("DISCONNECT (wrong key): producer writes `pvalue`; consumer reads `p_value`=null → silent grandfather", async () => {
    const wrc = await selectWrc(BT_WRONGKEY);
    expect((wrc as Record<string, unknown>)?.pvalue).toBe(0.01); // wrong key IS present
    const wrcPValue = (wrc?.p_value as number | null | undefined) ?? null;
    expect(wrcPValue).toBeNull(); // correct key absent → null → the false-green this test guards
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite 8 — SPA gate — backtests.spa_result.spa_consistent_p JSONB key round-trip (PGlite)
// ════════════════════════════════════════════════════════════════════════════════
describe("SPA gate — backtests.spa_result.spa_consistent_p key round-trip + disconnect (PGlite)", () => {
  let ctx: TestDb;

  const STRAT_ID    = "bc000001-0000-0000-0000-000000000001";
  const BT_SIG      = "bc000001-0000-0000-0000-000000000010"; // spa_consistent_p=0.02 significant
  const BT_INSIG    = "bc000001-0000-0000-0000-000000000011"; // spa_consistent_p=0.30 insignificant
  const BT_WRONGKEY = "bc000001-0000-0000-0000-000000000012"; // wrong key `spa_p` → null

  beforeAll(async () => {
    ctx = await createTestDb();
    await ctx.db.insert(strategies).values({
      id: STRAT_ID, name: "spa-integration-test", symbol: "MES", timeframe: "5m", config: {},
    });
    await ctx.db.insert(backtests).values([
      { id: BT_SIG, strategyId: STRAT_ID, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        spaResult: { spa_consistent_p: 0.02 } },
      { id: BT_INSIG, strategyId: STRAT_ID, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        spaResult: { spa_consistent_p: 0.30 } },
      { id: BT_WRONGKEY, strategyId: STRAT_ID, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        spaResult: { spa_p: 0.02 } },
    ]);
  });
  afterAll(async () => { await ctx.close(); });

  async function selectSpa(btId: string) {
    const [row] = await ctx.db
      .select({ spa: backtests.spaResult }).from(backtests).where(eq(backtests.id, btId));
    return row?.spa as Record<string, unknown> | null;
  }

  it("round-trip: consumer reads .spa_consistent_p (the lifecycle-service.ts:522 key) — significant", async () => {
    const spa = await selectSpa(BT_SIG);
    const spaP = (spa?.spa_consistent_p as number | null | undefined) ?? null;
    expect(spaP).toBe(0.02);
  });

  it("round-trip: insignificant spa_consistent_p preserved (orchestrator spa_p would block)", async () => {
    const spa = await selectSpa(BT_INSIG);
    const spaP = (spa?.spa_consistent_p as number | null | undefined) ?? null;
    expect(spaP).toBe(0.30);
  });

  it("DISCONNECT (wrong key): producer writes `spa_p`; consumer reads `spa_consistent_p`=null → silent grandfather", async () => {
    const spa = await selectSpa(BT_WRONGKEY);
    expect((spa as Record<string, unknown>)?.spa_p).toBe(0.02); // wrong key present
    const spaP = (spa?.spa_consistent_p as number | null | undefined) ?? null;
    expect(spaP).toBeNull(); // correct key absent → null → false-green guard
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite 9 — Parameter-drift gate — param_stability.drift_classification WRONG-KEY disconnect (PGlite)
//
// (deepscan8 Track D 2026-07-02)
// Documents the key-name sensitivity that produces a silent grandfather pass when
// the Python producer drifts from `drift_classification` to `drift_classification_WRONGKEY`.
// The consumer (lifecycle-service.ts / evaluateParameterDriftGate) reads
//   walk_forward_results.param_stability.drift_classification
// A WRONG-KEY row has `drift_classification_WRONGKEY` instead — consumer sees null →
// route to legacy_null → grandfather pass even if the real classification was "overfit_drift".
// This is the Suite 9 disconnect guard mandated by deep-scan #8 Track D.
// Suite 9 IDs use prefix "97"
// ════════════════════════════════════════════════════════════════════════════════
describe("Parameter-drift gate — param_stability.drift_classification WRONG-KEY disconnect (Suite 9 — PGlite)", () => {
  let ctx: TestDb;

  const STRAT_ID    = "97000001-0000-0000-0000-000000000001";
  const BT_WRONGKEY = "97000001-0000-0000-0000-000000000010"; // drift_classification_WRONGKEY → legacy_null
  const BT_CORRECT  = "97000001-0000-0000-0000-000000000011"; // drift_classification=overfit_drift → BLOCK (regression guard)

  beforeAll(async () => {
    ctx = await createTestDb();
    await ctx.db.insert(strategies).values({
      id: STRAT_ID, name: "param-drift-wrongkey-test", symbol: "MES", timeframe: "5m", config: {},
    });
    await ctx.db.insert(backtests).values([
      {
        id: BT_WRONGKEY, strategyId: STRAT_ID, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        // DISCONNECT: producer writes `drift_classification_WRONGKEY` instead of `drift_classification`.
        // Consumer reads `param_stability.drift_classification` → undefined → null → legacy_null PASS.
        // The real classification was "overfit_drift" (blocking) but the gate never sees it.
        walkForwardResults: {
          param_stability_status: "computed",
          param_stability: { drift_classification_WRONGKEY: "overfit_drift", drift_confidence: 0.80 },
        },
      },
      {
        id: BT_CORRECT, strategyId: STRAT_ID, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        // Regression guard: correct key → gate must BLOCK.
        walkForwardResults: {
          param_stability_status: "computed",
          param_stability: { drift_classification: "overfit_drift", drift_confidence: 0.80 },
        },
      },
    ]);
  });

  afterAll(async () => { await ctx.close(); });

  async function selectWfr(btId: string) {
    const [row] = await ctx.db
      .select({ wfr: backtests.walkForwardResults })
      .from(backtests)
      .where(eq(backtests.id, btId));
    return row?.wfr as Record<string, unknown> | null;
  }

  it("DISCONNECT (wrong key): producer writes drift_classification_WRONGKEY; consumer reads drift_classification=null → legacy_null PASS", async () => {
    const wfr = await selectWfr(BT_WRONGKEY);

    // Confirm the wrong key IS present in the stored JSONB
    const ps = (wfr?.param_stability as Record<string, unknown> | null) ?? null;
    expect((ps as Record<string, unknown>)?.drift_classification_WRONGKEY).toBe("overfit_drift");
    expect((ps as Record<string, unknown>)?.drift_confidence).toBe(0.80);

    // Consumer reads the correct key → undefined → null
    const classification = (ps?.drift_classification as string | null | undefined) ?? null;
    const confidence = (ps?.drift_confidence as number | null | undefined) != null
      ? Number(ps?.drift_confidence)
      : null;
    const status = (wfr?.param_stability_status as string | null | undefined) ?? null;

    // The wrong key means classification is null even though confidence is present
    expect(classification).toBeNull();

    const result = evaluateParameterDriftGate(classification, confidence, status);

    // Gate sees null classification → legacy_null grandfather pass.
    // The real classification was "overfit_drift" (blocking) but the gate never saw it.
    // This is a SILENT PRODUCER→CONSUMER KEY DISCONNECT.
    expect(result.status).toBe("legacy_null");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.parameter_drift_unavailable");
    // Document: drift_classification_WRONGKEY → legacy_null even with drift_confidence=0.80
    // This is the exact vulnerability Suite 9 exists to document.
  });

  it("regression: correct key drift_classification=overfit_drift + confidence 0.80 → gate BLOCKS (wrong-key fix must not weaken this)", async () => {
    const wfr = await selectWfr(BT_CORRECT);
    const ps = (wfr?.param_stability as Record<string, unknown> | null) ?? null;
    const classification = (ps?.drift_classification as string | null | undefined) ?? null;
    const confidence = (ps?.drift_confidence as number | null | undefined) != null
      ? Number(ps?.drift_confidence)
      : null;
    const status = (wfr?.param_stability_status as string | null | undefined) ?? null;

    expect(classification).toBe("overfit_drift");
    expect(confidence).toBe(0.80);

    const result = evaluateParameterDriftGate(classification, confidence, status);

    // Regression guard: the correct key must still block.
    expect(result.status).toBe("blocked");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.parameter_overfit_drift_block");
  });
});

// ── Parameter-drift CPCV-exempt round-trip (C1 — deep-scan #4 net-new guard) ──────
// Re-added 2026-06-29 after the merge reconciliation dropped FIX-T's original guard.
// Guards the C1 fix: walk_forward.py CPCV path now emits param_stability_status=
// "cpcv_not_applicable" so the parameter-drift gate returns a DISTINCT cpcv_exempt
// result instead of silently collapsing to legacy_null (the 4th CPCV-bypassed gate).
describe("Parameter-drift gate — param_stability_status cpcv_exempt round-trip (PGlite)", () => {
  let ctx: TestDb;
  // Suite IDs use prefix "99"
  const STRAT_ID  = "99000001-0000-0000-0000-000000000001";
  const BT_CPCV   = "99000001-0000-0000-0000-000000000010"; // CPCV: param_stability_status=cpcv_not_applicable, no param_stability
  const BT_LEGACY = "99000001-0000-0000-0000-000000000011"; // genuine legacy: neither key present
  const BT_DRIFT  = "99000001-0000-0000-0000-000000000012"; // real overfit_drift + confidence 0.75 → BLOCK

  beforeAll(async () => {
    ctx = await createTestDb();
    await ctx.db.insert(strategies).values({
      id: STRAT_ID, name: "param-drift-cpcv-test", symbol: "MES", timeframe: "5m", config: {},
    });
    await ctx.db.insert(backtests).values([
      {
        id: BT_CPCV, strategyId: STRAT_ID, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        // Producer: walk_forward.py CPCV path emits param_stability_status="cpcv_not_applicable"
        // as a top-level sibling of param_stability (absent in CPCV mode — no single window).
        walkForwardResults: { param_stability_status: "cpcv_not_applicable" },
      },
      {
        id: BT_LEGACY, strategyId: STRAT_ID, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        // Genuine pre-Pass-B.1 backtest: neither key present → legacy_null grandfather.
        walkForwardResults: {},
      },
      {
        id: BT_DRIFT, strategyId: STRAT_ID, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        // Plain-WF with a real overfit_drift classification — the cpcv fix must NOT weaken this.
        walkForwardResults: {
          param_stability_status: "computed",
          param_stability: { drift_classification: "overfit_drift", drift_confidence: 0.75 },
        },
      },
    ]);
  });

  afterAll(async () => { await ctx.close(); });

  async function selectWfr(btId: string) {
    const [row] = await ctx.db
      .select({ wfr: backtests.walkForwardResults })
      .from(backtests)
      .where(eq(backtests.id, btId));
    return row?.wfr as Record<string, unknown> | null;
  }

  it("CPCV: param_stability_status=cpcv_not_applicable stored + retrieved (JSONB round-trip)", async () => {
    const wfr = await selectWfr(BT_CPCV);
    expect(wfr?.param_stability_status).toBe("cpcv_not_applicable");
    expect(wfr?.param_stability).toBeUndefined();
  });

  it("CPCV: gate returns cpcv_exempt + distinct audit, NOT legacy_null (the C1 bypass guard)", async () => {
    const wfr = await selectWfr(BT_CPCV);
    const ps = (wfr?.param_stability ?? null) as Record<string, unknown> | null;
    const classification = (ps?.drift_classification ?? null) as string | null;
    const confidence = (ps?.drift_confidence ?? null) as number | null;
    const status = (wfr?.param_stability_status ?? null) as string | null;

    const result = evaluateParameterDriftGate(classification, confidence, status);

    expect(result.status).toBe("cpcv_exempt");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.parameter_drift_cpcv_exempt");
    // Must NOT silently collapse to the generic legacy path — that was the C1 bug.
    expect(result.status).not.toBe("legacy_null");
    expect(result.auditAction).not.toBe("lifecycle.parameter_drift_unavailable");
  });

  it("Legacy: neither key → legacy_null grandfather (distinct from cpcv_exempt)", async () => {
    const wfr = await selectWfr(BT_LEGACY);
    const status = (wfr?.param_stability_status ?? null) as string | null;
    const result = evaluateParameterDriftGate(null, null, status);
    expect(result.status).toBe("legacy_null");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.parameter_drift_unavailable");
  });

  it("Regression: real overfit_drift + confidence 0.75 STILL BLOCKS (cpcv fix must not weaken)", async () => {
    const wfr = await selectWfr(BT_DRIFT);
    const ps = (wfr?.param_stability ?? null) as Record<string, unknown> | null;
    const classification = (ps?.drift_classification ?? null) as string | null;
    const confidence = (ps?.drift_confidence ?? null) as number | null;
    const status = (wfr?.param_stability_status ?? null) as string | null;

    const result = evaluateParameterDriftGate(classification, confidence, status);

    expect(result.status).toBe("blocked");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.parameter_overfit_drift_block");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite 10 — Frozen-policy gate — strategies.frozen_policy_hash column round-trip (PGlite)
// Deep-scan #5 F-2 (2026-06-29): closes the coverage gap accuracy-validator flagged — the
// frozen-policy gate was MOCK-ONLY, so a future rename/drop of strategies.frozen_policy_hash
// (or CORE_DDL drift) would ship green. This suite INSERTs the column via real PGlite, SELECTs
// it back, and runs the REAL evaluateFrozenPolicyDriftAtPromotion against the round-tripped row.
// Suite 10 IDs use prefix "fc".
// ════════════════════════════════════════════════════════════════════════════════
describe("Frozen-policy gate — strategies.frozen_policy_hash round-trip + drift (PGlite)", () => {
  let ctx: TestDb;

  const STRAT_STABLE = "fc000001-0000-0000-0000-000000000001"; // frozen hash matches config → ok
  const STRAT_DRIFT  = "fc000001-0000-0000-0000-000000000002"; // frozen hash stale → drift block
  const STRAT_FIRST  = "fc000001-0000-0000-0000-000000000003"; // frozen hash null → first-freeze pass

  // The 5-field policy slice lives inside config; other config keys must NOT affect the hash.
  const POLICY_CONFIG = {
    entry_quality: { use_weighted_scoring: true, min_factors_satisfied: 2 },
    position_size: { type: "risk_derived_pyramid", base_contracts: 9 },
    stop_loss: { type: "atr", multiplier: 1.5 },
    take_profit: { style: "c", partials: [{ at_r: 1.0, size_pct: 0.33 }] },
    exit_plan_config: { exit_style: "static_styleC" },
    name: "irrelevant-cosmetic-field",
  };

  beforeAll(async () => {
    ctx = await createTestDb();
    const stableHash = computeFrozenPolicyHash({ config: POLICY_CONFIG });
    await ctx.db.insert(strategies).values([
      { id: STRAT_STABLE, name: "fp-stable", symbol: "MES", timeframe: "5m", config: POLICY_CONFIG, frozenPolicyHash: stableHash },
      { id: STRAT_DRIFT,  name: "fp-drift",  symbol: "MES", timeframe: "5m", config: POLICY_CONFIG, frozenPolicyHash: "0000000000000000000000000000000000000000000000000000000000000000" },
      { id: STRAT_FIRST,  name: "fp-first",  symbol: "MES", timeframe: "5m", config: POLICY_CONFIG, frozenPolicyHash: null },
    ]);
  });
  afterAll(async () => { await ctx.close(); });

  async function selectStrat(id: string) {
    const [row] = await ctx.db
      .select({ id: strategies.id, config: strategies.config, frozenPolicyHash: strategies.frozenPolicyHash })
      .from(strategies).where(eq(strategies.id, id));
    return row;
  }

  it("frozen_policy_hash column round-trips as a 64-char hex string (CORE_DDL contract)", async () => {
    const row = await selectStrat(STRAT_STABLE);
    expect(typeof row?.frozenPolicyHash).toBe("string");
    expect(row?.frozenPolicyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("PASS: stored hash matches current config → ok=true (no drift)", async () => {
    const row = await selectStrat(STRAT_STABLE);
    const result = evaluateFrozenPolicyDriftAtPromotion({
      id: row!.id, config: row!.config, frozenPolicyHash: row!.frozenPolicyHash,
    });
    expect(result.ok).toBe(true);
    expect(result.currentHash).toBe(result.frozenHash);
  });

  it("BLOCK: stored hash stale vs current config → ok=false (operator override required)", async () => {
    const row = await selectStrat(STRAT_DRIFT);
    const result = evaluateFrozenPolicyDriftAtPromotion({
      id: row!.id, config: row!.config, frozenPolicyHash: row!.frozenPolicyHash,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("frozen_policy.hash_mismatch");
  });

  it("FIRST-FREEZE: frozen_policy_hash null → ok=true (permit, lifecycle then stamps the hash)", async () => {
    const row = await selectStrat(STRAT_FIRST);
    expect(row?.frozenPolicyHash).toBeNull();
    const result = evaluateFrozenPolicyDriftAtPromotion({
      id: row!.id, config: row!.config, frozenPolicyHash: row!.frozenPolicyHash,
    });
    expect(result.ok).toBe(true);
    expect(result.frozenHash).toBeNull();
  });
});

// ── Suite 11 local helper: mirror of passingFirmNamesFromCompliance from lifecycle-service.ts ──
// Cannot import lifecycle-service.ts in gate-chain tests because it imports
// ../db/index.js at module-load time, which throws on missing DATABASE_URL
// (same trap as frozen-policy-contract.js per deep-scan #5 F-2 comment above).
// This inline copy must stay in sync with the source; any change to
// FIRM_KEY_TO_FIRM_NAME or the boolean-check logic in lifecycle-service.ts
// must be mirrored here.
const FIRM_KEY_TO_FIRM_NAME_LOCAL: Record<string, string> = {
  topstep_50k: "Topstep",
  mffu_50k: "MFFU",
};
function parseFirmNamesFromCompliance(propCompliance: unknown): string[] {
  if (!propCompliance || typeof propCompliance !== "object") return [];
  const propResults = propCompliance as Record<string, { passed?: boolean; pass?: boolean }>;
  const names = new Set<string>();
  for (const [firmKey, result] of Object.entries(propResults)) {
    const passing = result?.passed === true || result?.pass === true;
    if (!passing) continue;
    const firmName = FIRM_KEY_TO_FIRM_NAME_LOCAL[firmKey];
    if (firmName) {
      names.add(firmName);
    } else {
      const prefix = firmKey.split("_")[0];
      if (prefix) names.add(prefix);
    }
  }
  return [...names];
}

// ════════════════════════════════════════════════════════════════════════════════
// Suite 11 — T→P gate chain coverage (deepscan8 Track D 2026-07-02)
//
// Covers the two gates added to TESTING→PAPER by Track D:
//   (A) Compliance-drift propCompliance JSONB parsing chain — proves backtests.prop_compliance
//       stores and retrieves the passing-firms shape that passingFirmNamesFromCompliance reads.
//       Documents that a WRONG propCompliance key (no firm marked passed=true) yields
//       qualifyingFirms=[] and resolveComplianceDriftForPromotion short-circuits (no DB hit).
//   (B) Freeze-at-T→P then mutate then P→DR drift-block round-trip — proves the key
//       behavioral contract: stamping frozenPolicyHash at TESTING→PAPER means any config
//       change during PAPER is detectable by evaluateFrozenPolicyDriftAtPromotion at P→DR.
//
// Suite 11 IDs use prefix "d8"
// ════════════════════════════════════════════════════════════════════════════════
describe("T→P gate chain — compliance-drift propCompliance parsing + freeze baseline stamp (deepscan8 Track D — PGlite)", () => {
  let ctx: TestDb;

  // Part A: propCompliance JSONB round-trip
  const STRAT_COMP   = "d8000001-0000-0000-0000-000000000001";
  const BT_PASSING   = "d8000001-0000-0000-0000-000000000010"; // topstep_50k passed=true
  const BT_NO_PASS   = "d8000001-0000-0000-0000-000000000011"; // all firms failed → qualifyingFirms=[]
  const BT_WRONGCOMP = "d8000001-0000-0000-0000-000000000012"; // wrong propCompliance shape

  // Part B: freeze baseline + P→DR drift detection
  const STRAT_FREEZE = "d8000001-0000-0000-0000-000000000002";

  const POLICY_CONFIG_PRE = {
    entry_quality: { use_weighted_scoring: true, min_factors_satisfied: 2 },
    position_size: { type: "risk_derived_pyramid", base_contracts: 9 },
    stop_loss: { type: "atr", multiplier: 1.5 },
    take_profit: { style: "c", partials: [{ at_r: 1.0, size_pct: 0.33 }] },
    exit_plan_config: { exit_style: "static_styleC" },
  };

  // Simulates operator mutating base_contracts during PAPER (9 → 12)
  const POLICY_CONFIG_MUTATED = {
    ...POLICY_CONFIG_PRE,
    position_size: { type: "risk_derived_pyramid", base_contracts: 12 },
  };

  beforeAll(async () => {
    ctx = await createTestDb();

    await ctx.db.insert(strategies).values([
      { id: STRAT_COMP,   name: "comp-chain-test",   symbol: "MES", timeframe: "5m", config: {} },
      { id: STRAT_FREEZE, name: "freeze-chain-test",  symbol: "MES", timeframe: "5m", config: POLICY_CONFIG_PRE },
    ]);

    await ctx.db.insert(backtests).values([
      {
        id: BT_PASSING, strategyId: STRAT_COMP, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        // PRODUCER: topstep_50k firm passes → passingFirmNamesFromCompliance should return ["Topstep"]
        propCompliance: { topstep_50k: { passed: true, tier: "50k" } },
      },
      {
        id: BT_NO_PASS, strategyId: STRAT_COMP, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        // PRODUCER: all firms failed → resolveComplianceDriftForPromotion short-circuits (qualifyingFirms=[])
        propCompliance: { topstep_50k: { passed: false }, mffu_50k: { pass: false } },
      },
      {
        id: BT_WRONGCOMP, strategyId: STRAT_COMP, symbol: "MES", timeframe: "5m",
        startDate: new Date("2025-01-01"), endDate: new Date("2025-06-01"), status: "completed",
        // PRODUCER: wrong shape — no `passed` or `pass` boolean → zero qualifying firms
        propCompliance: { topstep_50k: { result: "pass" } },
      },
    ]);
  });

  afterAll(async () => { await ctx.close(); });

  // ── Part A: propCompliance JSONB parsing chain ─────────────────────────────

  it("Part A: propCompliance JSONB round-trip — topstep_50k.passed=true preserved", async () => {
    const [row] = await ctx.db
      .select({ propCompliance: backtests.propCompliance })
      .from(backtests).where(eq(backtests.id, BT_PASSING));
    const pc = row?.propCompliance as Record<string, unknown> | null;
    expect(pc).not.toBeNull();
    const ts = pc?.topstep_50k as Record<string, unknown> | undefined;
    expect(ts?.passed).toBe(true);
  });

  it("Part A: passingFirmNamesFromCompliance reads topstep_50k.passed=true → non-empty qualifying list", async () => {
    const [row] = await ctx.db
      .select({ propCompliance: backtests.propCompliance })
      .from(backtests).where(eq(backtests.id, BT_PASSING));
    const pc = row?.propCompliance;

    // Mirror lifecycle-service.ts passingFirmNamesFromCompliance (inlined — cannot import
    // lifecycle-service.ts in gate-chain tests because it imports ../db/index.js which
    // requires DATABASE_URL at load time; same trap as frozen-policy-contract.js per
    // deep-scan #5 F-2 comment in this file).
    const qualifying = parseFirmNamesFromCompliance(pc);

    // topstep_50k → prefix "topstep" qualifies (FIRM_KEY_TO_FIRM_NAME or fallback prefix)
    expect(qualifying.length).toBeGreaterThan(0);
  });

  it("Part A: all-failed propCompliance → passingFirmNamesFromCompliance returns [] → resolveComplianceDriftForPromotion short-circuits", async () => {
    const [row] = await ctx.db
      .select({ propCompliance: backtests.propCompliance })
      .from(backtests).where(eq(backtests.id, BT_NO_PASS));
    const pc = row?.propCompliance;

    const qualifying = parseFirmNamesFromCompliance(pc);

    // No firm passes → resolveComplianceDriftForPromotion returns { driftFirms: [], qualifyingFirms: [] }
    // and never queries the DB for drift status (short-circuits).
    expect(qualifying).toHaveLength(0);
  });

  it("Part A: WRONG propCompliance shape (result key, not passed/pass) → zero qualifying firms", async () => {
    const [row] = await ctx.db
      .select({ propCompliance: backtests.propCompliance })
      .from(backtests).where(eq(backtests.id, BT_WRONGCOMP));
    const pc = row?.propCompliance;

    const qualifying = parseFirmNamesFromCompliance(pc);

    // `result: "pass"` is not a boolean `passed` or `pass` → gate is not triggered.
    // Documents the sensitivity: only boolean passed===true or pass===true qualifies.
    expect(qualifying).toHaveLength(0);
  });

  // ── Part B: Freeze-at-T→P baseline → mutate → P→DR drift detection ─────────

  it("Part B: freeze baseline at T→P → hash stamped on strategies.frozen_policy_hash (CORE_DDL contract)", async () => {
    // Simulate what freezePolicyForStrategy does: compute hash from current config, write to DB
    const preHash = computeFrozenPolicyHash({ config: POLICY_CONFIG_PRE });

    await ctx.db.update(strategies)
      .set({ frozenPolicyHash: preHash })
      .where(eq(strategies.id, STRAT_FREEZE));

    const [row] = await ctx.db
      .select({ frozenPolicyHash: strategies.frozenPolicyHash })
      .from(strategies).where(eq(strategies.id, STRAT_FREEZE));

    expect(row?.frozenPolicyHash).toBe(preHash);
    expect(row?.frozenPolicyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("Part B: config mutation during PAPER → P→DR drift check detects mismatch (the T→P baseline stamp contract)", async () => {
    // State: strategy was frozen at T→P with POLICY_CONFIG_PRE (base_contracts=9)
    const preHash = computeFrozenPolicyHash({ config: POLICY_CONFIG_PRE });
    await ctx.db.update(strategies)
      .set({ frozenPolicyHash: preHash })
      .where(eq(strategies.id, STRAT_FREEZE));

    // Simulate operator mutating config during PAPER (base_contracts: 9 → 12)
    await ctx.db.update(strategies)
      .set({ config: POLICY_CONFIG_MUTATED })
      .where(eq(strategies.id, STRAT_FREEZE));

    // At P→DR: evaluateFrozenPolicyDriftAtPromotion runs on the mutated config
    const [row] = await ctx.db
      .select({ id: strategies.id, config: strategies.config, frozenPolicyHash: strategies.frozenPolicyHash })
      .from(strategies).where(eq(strategies.id, STRAT_FREEZE));

    const result = evaluateFrozenPolicyDriftAtPromotion({
      id: row!.id,
      config: row!.config,
      frozenPolicyHash: row!.frozenPolicyHash,
    });

    // CRITICAL: P→DR drift check MUST detect the mismatch.
    // Without T→P freeze, frozenPolicyHash would be null → first-freeze pass → drift invisible.
    // WITH T→P freeze, the hash was stamped before PAPER config mutations → drift is caught.
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("frozen_policy.hash_mismatch");
    expect(result.currentHash).not.toBe(result.frozenHash);
    expect(result.frozenHash).toBe(preHash);
  });

  it("Part B: without T→P baseline stamp (null hash) → P→DR first-freeze pass (legacy behavior preserved)", async () => {
    // Simulate a strategy that reached PAPER without a T→P freeze (legacy path, pre-deepscan8)
    await ctx.db.update(strategies)
      .set({ frozenPolicyHash: null, config: POLICY_CONFIG_MUTATED })
      .where(eq(strategies.id, STRAT_FREEZE));

    const [row] = await ctx.db
      .select({ id: strategies.id, config: strategies.config, frozenPolicyHash: strategies.frozenPolicyHash })
      .from(strategies).where(eq(strategies.id, STRAT_FREEZE));

    expect(row?.frozenPolicyHash).toBeNull();

    const result = evaluateFrozenPolicyDriftAtPromotion({
      id: row!.id,
      config: row!.config,
      frozenPolicyHash: row!.frozenPolicyHash,
    });

    // Legacy tolerance: null hash → first-freeze pass at P→DR (the grandfathered legacy path).
    // deepscan8 Track D closes this gap for NEW promotions but preserves backward compat.
    expect(result.ok).toBe(true);
    expect(result.frozenHash).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite 12 — CPCV per-path IS WFE gate — wfe_status="cpcv_per_path_is" round-trip (PGlite)
//
// Deep-scan #9 FIX K (2026-07-02): walk_forward.py CPCV mode with per-path IS Sharpe
// available now emits wfe_status="cpcv_per_path_is" + a real wfe_overall. This is distinct
// from:
//   - "cpcv_not_applicable" (CPCV ran but IS Sharpe unavailable → gate exempt; Suite 5)
//   - "degenerate_is"      (WF ran but IS windows non-positive → hard block; Suite 1)
// The cpcv_per_path_is path MUST enforce the same WFE hard floor (0.70) as plain-WF
// and surface wfeBasis="cpcv_per_path_is" in the returned detail for audit traceability.
// wf_metadata.wfe_cpcv_basis captures the CPCV metadata written by the producer.
//
// Suite 12 IDs use prefix "c1"
// ════════════════════════════════════════════════════════════════════════════════
describe("WFE gate — cpcv_per_path_is status floor enforcement + basis surfacing (Suite 12 — PGlite)", () => {
  let ctx: TestDb;

  const STRAT_ID    = "c1000001-0000-0000-0000-000000000001";
  const BT_BLOCK65  = "c1000001-0000-0000-0000-000000000010"; // cpcv_per_path_is + wfe_overall=0.65 → BLOCK
  const BT_PASS80   = "c1000001-0000-0000-0000-000000000011"; // cpcv_per_path_is + wfe_overall=0.80 → PASS
  const BT_WRONGKEY = "c1000001-0000-0000-0000-000000000012"; // wfe_status_WRONGKEY → fallback to plain-WF numeric eval

  beforeAll(async () => {
    ctx = await createTestDb();

    await ctx.db.insert(strategies).values({
      id: STRAT_ID,
      name: "cpcv-per-path-is-wfe-test",
      symbol: "MES",
      timeframe: "5m",
      config: {},
    });

    await ctx.db.insert(backtests).values([
      {
        id: BT_BLOCK65,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // PRODUCER: CPCV ran with per-path IS Sharpe; wfe_overall=0.65 (below 0.70 hard floor).
        // wf_metadata.wfe_cpcv_basis captures the CPCV computation metadata for audit traceability.
        walkForwardResults: {
          wfe_overall: 0.65,
          wfe_status: "cpcv_per_path_is",
          wf_metadata: {
            wfe_cpcv_basis: {
              n_paths_with_is: 4,
              is_basis: "per_path_is_sharpe_mean",
              oos_basis: "agg_sharpe",
            },
          },
        },
      },
      {
        id: BT_PASS80,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // PRODUCER: same CPCV per-path IS mode; wfe_overall=0.80 (above 0.70 floor) → PASS.
        walkForwardResults: {
          wfe_overall: 0.80,
          wfe_status: "cpcv_per_path_is",
          wf_metadata: {
            wfe_cpcv_basis: {
              n_paths_with_is: 4,
              is_basis: "per_path_is_sharpe_mean",
              oos_basis: "agg_sharpe",
            },
          },
        },
      },
      {
        id: BT_WRONGKEY,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // DISCONNECT DOCUMENTATION: producer writes wfe_status_WRONGKEY instead of wfe_status.
        // Consumer reads wfe_status → undefined → null → gate falls through to the plain-WF
        // numeric evaluation path. wfe_overall=0.65 < 0.70 → BLOCKS via wfe_hard_floor_block
        // WITHOUT the cpcv_per_path_is basis recorded (wfeBasis is absent — basis invisible).
        walkForwardResults: {
          wfe_overall: 0.65,
          wfe_status_WRONGKEY: "cpcv_per_path_is",  // wrong key
          wf_metadata: {
            wfe_cpcv_basis: {
              n_paths_with_is: 4,
              is_basis: "per_path_is_sharpe_mean",
              oos_basis: "agg_sharpe",
            },
          },
        },
      },
    ]);
  });

  afterAll(async () => { await ctx.close(); });

  async function selectWfr(btId: string) {
    const [row] = await ctx.db
      .select({ wfr: backtests.walkForwardResults })
      .from(backtests)
      .where(eq(backtests.id, btId));
    return row?.wfr as Record<string, unknown> | null;
  }

  it("JSONB round-trip: cpcv_per_path_is shape (wfe_overall + wfe_status + wf_metadata.wfe_cpcv_basis) preserved", async () => {
    const wfr = await selectWfr(BT_BLOCK65);
    expect(wfr?.wfe_overall).toBe(0.65);
    expect(wfr?.wfe_status).toBe("cpcv_per_path_is");
    const meta = wfr?.wf_metadata as Record<string, unknown>;
    const basis = meta?.wfe_cpcv_basis as Record<string, unknown>;
    expect(basis?.n_paths_with_is).toBe(4);
    expect(basis?.is_basis).toBe("per_path_is_sharpe_mean");
    expect(basis?.oos_basis).toBe("agg_sharpe");
  });

  it("BLOCK: cpcv_per_path_is + wfe_overall=0.65 (below 0.70 hard floor) → gate status=blocked + wfeBasis surfaced", async () => {
    const wfr = await selectWfr(BT_BLOCK65);
    const wfeOverall = (wfr?.wfe_overall ?? null) as number | null;
    const wfeStatus = (wfr?.wfe_status ?? null) as string | null;

    expect(wfeStatus).toBe("cpcv_per_path_is");
    expect(wfeOverall).toBe(0.65);

    const result = evaluateWfeGate(wfeOverall, undefined, undefined, wfeStatus);

    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.wfeOverall).toBe(0.65);
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
    // CPCV basis MUST be surfaced so audit writers can record the evaluation path.
    expect(result.wfeBasis).toBe("cpcv_per_path_is");
    // Regression: must NOT produce cpcv_exempt or legacy_null (different statuses).
    expect(result.status).not.toBe("cpcv_exempt");
    expect(result.status).not.toBe("legacy_null");
  });

  it("PASS: cpcv_per_path_is + wfe_overall=0.80 (above 0.70 hard floor) → gate status=passed + wfeBasis surfaced", async () => {
    const wfr = await selectWfr(BT_PASS80);
    const wfeOverall = (wfr?.wfe_overall ?? null) as number | null;
    const wfeStatus = (wfr?.wfe_status ?? null) as string | null;

    expect(wfeStatus).toBe("cpcv_per_path_is");
    expect(wfeOverall).toBe(0.80);

    const result = evaluateWfeGate(wfeOverall, undefined, undefined, wfeStatus);

    expect(result.passed).toBe(true);
    expect(result.status).toBe("passed");
    expect(result.wfeOverall).toBe(0.80);
    expect(result.auditAction).toBeNull();
    // Basis MUST be present even on the happy path so callers know this was cpcv_per_path_is.
    expect(result.wfeBasis).toBe("cpcv_per_path_is");
  });

  it("DISCONNECT (wrong key): wfe_status_WRONGKEY → consumer reads wfe_status=null → plain-WF numeric eval; cpcv basis is invisible", async () => {
    const wfr = await selectWfr(BT_WRONGKEY);

    // Confirm the wrong key IS present in the stored JSONB
    expect((wfr as any)?.wfe_status_WRONGKEY).toBe("cpcv_per_path_is");

    // Consumer reads wfe_status (the correct key) → undefined → null
    const wfeOverall = (wfr?.wfe_overall ?? null) as number | null;
    const wfeStatus = (wfr?.wfe_status ?? null) as string | null;

    expect(wfeStatus).toBeNull();   // correct key absent → consumer sees null
    expect(wfeOverall).toBe(0.65);  // the numeric value IS present

    const result = evaluateWfeGate(wfeOverall, undefined, undefined, wfeStatus);

    // Gate falls through to plain-WF numeric eval: wfe_overall=0.65 < 0.70 → BLOCKS.
    // Correct outcome, but WITHOUT the cpcv_per_path_is basis — the CPCV context is lost.
    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
    // CRITICAL: wfeBasis is absent — the producer's CPCV context is INVISIBLE to the consumer.
    // This documents the producer→consumer key-name sensitivity for wfe_status.
    expect(result.wfeBasis).toBeUndefined();
  });
});

// ─── Suite 12b — X5 RATIFIED 2026-07-09: cpcv_combined_fold status ────────────
// Certifier MEDIUM close-out: Suite 12 exercised only the LEGACY "cpcv_per_path_is"
// string. Every backtest since the X5 ratification emits "cpcv_combined_fold"
// (symmetric combined-fold OOS/IS). These pure-function cases lock the gate's
// behaviour on the NEW string and prove it is byte-identical to the legacy path
// (wfe-gate.ts:184 shares one branch for both) so backward-compat is real, not asserted.
describe("WFE gate — cpcv_combined_fold status (Suite 12b — X5 ratified, pure-function)", () => {
  it("BLOCK: cpcv_combined_fold + wfe_overall=0.65 → blocked + wfeBasis='cpcv_combined_fold'", () => {
    const result = evaluateWfeGate(0.65, undefined, undefined, "cpcv_combined_fold");
    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.wfeOverall).toBe(0.65);
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
    expect(result.wfeBasis).toBe("cpcv_combined_fold");
    expect(result.status).not.toBe("cpcv_exempt");
    expect(result.status).not.toBe("legacy_null");
  });

  it("PASS: cpcv_combined_fold + wfe_overall=0.80 → passed + wfeBasis='cpcv_combined_fold'", () => {
    const result = evaluateWfeGate(0.80, undefined, undefined, "cpcv_combined_fold");
    expect(result.passed).toBe(true);
    expect(result.status).toBe("passed");
    expect(result.wfeOverall).toBe(0.80);
    expect(result.auditAction).toBeNull();
    expect(result.wfeBasis).toBe("cpcv_combined_fold");
  });

  it("FAIL-CLOSED: cpcv_combined_fold + null wfe_overall → blocked (producer claimed basis but no value)", () => {
    const result = evaluateWfeGate(null, undefined, undefined, "cpcv_combined_fold");
    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.wfeBasis).toBe("cpcv_combined_fold");
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });

  it("BOUNDARY: exactly 0.70 passes on both strings (>= hard floor)", () => {
    for (const s of ["cpcv_combined_fold", "cpcv_per_path_is"]) {
      const r = evaluateWfeGate(0.70, undefined, undefined, s);
      expect(r.passed).toBe(true);
      expect(r.status).toBe("passed");
      expect(r.wfeBasis).toBe(s);
    }
  });

  it("PARITY: new and legacy CPCV strings gate identically across values (backward-compat is real)", () => {
    for (const wfe of [null, 0.0, 0.49, 0.50, 0.699, 0.70, 0.85, 1.5]) {
      const neu = evaluateWfeGate(wfe as number | null, undefined, undefined, "cpcv_combined_fold");
      const legacy = evaluateWfeGate(wfe as number | null, undefined, undefined, "cpcv_per_path_is");
      expect(neu.passed).toBe(legacy.passed);
      expect(neu.status).toBe(legacy.status);
      expect(neu.auditAction).toBe(legacy.auditAction);
      // wfeBasis correctly reflects each input status (the one intentional difference).
      expect(neu.wfeBasis).toBe("cpcv_combined_fold");
      expect(legacy.wfeBasis).toBe("cpcv_per_path_is");
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite 13 — Slippage-Survival gate — backtests.slippage_survival JSONB round-trip (Wave A, PGlite)
//
// Design spec: docs/superpowers/specs/2026-07-03-slippage-survival-gate-design.md
// Producer (parallel Python track): src/engine/statistics/slippage_survival.py
// Consumer: src/server/lib/slippage-survival-gate.ts, wired at PAPER → DEPLOY_READY
// in lifecycle-service.ts (manual PATCH path + autonomous cron path).
//
// This suite boots the REAL pglite schema (CORE_DDL, not mocked), inserts
// producer-shape rows into the real `backtests.slippage_survival` column via
// Drizzle, and runs the REAL gate reader against the round-tripped JSONB —
// proving the producer key and the consumer key are the same key.
// ════════════════════════════════════════════════════════════════════════════════

describe("Slippage-Survival gate — backtests.slippage_survival JSONB round-trip (Suite 13 — PGlite)", () => {
  let ctx: TestDb;

  const STRAT_ID    = "e2000001-0000-0000-0000-000000000001";
  const BT_FRAGILE  = "e2000001-0000-0000-0000-000000000010"; // breaks_at=2.0 → BLOCK (<= 2.0 default threshold)
  const BT_SURVIVOR = "e2000001-0000-0000-0000-000000000011"; // breaks_at=null → PASS (survives every multiple)
  const BT_WRONGKEY = "e2000001-0000-0000-0000-000000000012"; // wrong key (break_at) → must NOT silently pass as "clean"

  beforeAll(async () => {
    ctx = await createTestDb();

    await ctx.db.insert(strategies).values({
      id: STRAT_ID,
      name: "slippage-survival-integration-test",
      symbol: "MES",
      timeframe: "5m",
      config: {},
    });

    await ctx.db.insert(backtests).values([
      {
        id: BT_FRAGILE,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // PRODUCER shape: edge dies at 2x slippage (fragile — living on optimistic fills).
        slippageSurvival: {
          schema_version: 1,
          multiples: [1.0, 2.0, 3.0],
          pf: { "1x": 1.4, "2x": 0.9, "3x": 0.5 },
          expectancy_r: { "1x": 0.3, "2x": -0.1, "3x": -0.4 },
          breaks_at: 2.0,
          retention_2x: -0.33,
          n_trades: 100,
          insufficient_sample: false,
          computed_at: "2026-07-03T00:00:00Z",
        },
      },
      {
        id: BT_SURVIVOR,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // PRODUCER shape: edge survives every swept multiple — explicit breaks_at: null.
        slippageSurvival: {
          schema_version: 1,
          multiples: [1.0, 2.0, 3.0],
          pf: { "1x": 1.9, "2x": 1.6, "3x": 1.3 },
          expectancy_r: { "1x": 0.5, "2x": 0.35, "3x": 0.2 },
          breaks_at: null,
          retention_2x: 0.7,
          n_trades: 214,
          insufficient_sample: false,
          computed_at: "2026-07-03T00:00:00Z",
        },
      },
      {
        id: BT_WRONGKEY,
        strategyId: STRAT_ID,
        symbol: "MES",
        timeframe: "5m",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-06-01"),
        status: "completed",
        // DISCONNECT: producer drifts to writing `break_at` instead of `breaks_at`.
        // The real value (2.0, which WOULD block) is present but under the wrong key.
        // Consumer must NOT silently interpret this as a clean survivor.
        slippageSurvival: {
          schema_version: 1,
          break_at: 2.0, // WRONG KEY
          n_trades: 100,
        } as unknown as Record<string, unknown>,
      },
    ]);
  });

  afterAll(async () => { await ctx.close(); });

  async function selectSlippageSurvival(btId: string) {
    const [row] = await ctx.db
      .select({ slippageSurvival: backtests.slippageSurvival })
      .from(backtests)
      .where(eq(backtests.id, btId));
    return row?.slippageSurvival as Record<string, unknown> | null;
  }

  it("JSONB round-trip preserves breaks_at, n_trades, and retention_2x", async () => {
    const ss = await selectSlippageSurvival(BT_FRAGILE);
    expect(ss).toBeDefined();
    expect(ss?.breaks_at).toBe(2.0);
    expect(ss?.n_trades).toBe(100);
    expect(ss?.retention_2x).toBe(-0.33);
  });

  it("BLOCK: breaks_at=2.0 (at or below the default 2.0 block multiple) → gate blocks (gate enabled)", async () => {
    const ss = await selectSlippageSurvival(BT_FRAGILE);
    const result = evaluateSlippageSurvivalGate(ss as any, { enabled: true });

    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("slippage_survival.blocked_breaks_at_at_or_below_threshold");
    expect(result.auditPayload.breaks_at).toBe(2.0);
  });

  it("advisory-only by default: same fragile row PASSES when the gate is disabled (SLIPPAGE_SURVIVAL_GATE_ENABLED default false)", async () => {
    const ss = await selectSlippageSurvival(BT_FRAGILE);
    const result = evaluateSlippageSurvivalGate(ss as any); // no opts — reads env default (unset → disabled)

    expect(result.passed).toBe(true);
    expect(result.status).toBe("disabled");
    // The underlying fragile breaks_at is still surfaced for observability even while disabled.
    expect(result.auditPayload.breaks_at).toBe(2.0);
  });

  it("PASS: breaks_at=null (survives every swept multiple) → gate passes cleanly (gate enabled)", async () => {
    const ss = await selectSlippageSurvival(BT_SURVIVOR);
    const result = evaluateSlippageSurvivalGate(ss as any, { enabled: true });

    expect(result.passed).toBe(true);
    expect(result.status).toBe("clean");
    expect(result.reason).toBe("slippage_survival.clean");
    expect(result.auditPayload.breaks_at).toBeNull();
  });

  it("DISCONNECT (wrong key): producer writes break_at=2.0; consumer reads breaks_at=undefined → must NOT silently pass as clean", async () => {
    const ss = await selectSlippageSurvival(BT_WRONGKEY);

    // Prove the wrong key was written and IS present in the JSONB.
    expect((ss as any)?.break_at).toBe(2.0);
    // Prove the correct key is genuinely absent (not just null) — this is the shape
    // distinction the gate uses to detect malformed producer output.
    expect(Object.prototype.hasOwnProperty.call(ss ?? {}, "breaks_at")).toBe(false);

    const result = evaluateSlippageSurvivalGate(ss as any, { enabled: true });

    // Fail-OPEN (never fabricate a block from malformed data) — but MUST be
    // distinguishable from a genuine "clean" survivor. This is the core assertion:
    // a broken producer must never look identical to a real clean pass.
    expect(result.passed).toBe(true);
    expect(result.status).toBe("malformed");
    expect(result.status).not.toBe("clean");
    expect(result.reason).toBe("slippage_survival.malformed_missing_breaks_at");
    expect(result.auditPayload.breaks_at).toBeNull();
  });

  // ── FIX M1 (deep-scan #15): evidence-completeness ROLL-UP accounting ──────────
  // A malformed slippage row must be counted as INCOMPLETE evidence in the
  // >=3-incomplete promotion governor — NOT silently booked as "complete". This
  // rounds the DB row → real gate → real bucket helper → real incomplete predicate,
  // exactly the path the cron uses (lifecycle-service.ts) to accumulate
  // gateEvidenceStatuses before the lifecycle.promotion_evidence_incomplete block.
  it("FIX M1: a malformed slippage_survival row (trades, no breaks_at) is booked INCOMPLETE (not complete)", async () => {
    const ss = await selectSlippageSurvival(BT_WRONGKEY);
    // Sanity: the row has trades but no breaks_at key (the malformed shape).
    expect((ss as any)?.n_trades).toBe(100);
    expect(Object.prototype.hasOwnProperty.call(ss ?? {}, "breaks_at")).toBe(false);

    // Real gate → real bucket helper (the exact push the cron makes at line ~5449).
    const gateResult = evaluateSlippageSurvivalGate(ss as any, { enabled: true });
    const bucket = slippageEvidenceBucket(gateResult.status);

    // The malformed row books the INCOMPLETE "malformed" bucket, NOT "complete".
    expect(gateResult.status).toBe("malformed");
    expect(bucket).toBe("malformed");
    expect(bucket).not.toBe("complete");
    expect(isIncompleteEvidenceStatus(bucket)).toBe(true);
  });

  it("FIX M1: malformed slippage pushes a 2-legacy gate stack to the >=3-incomplete governor threshold", async () => {
    const ss = await selectSlippageSurvival(BT_WRONGKEY);
    const gateResult = evaluateSlippageSurvivalGate(ss as any, { enabled: true });

    // Two earlier gates already grandfather-passed on legacy evidence; the malformed
    // slippage gate is the third INCOMPLETE → triggers lifecycle.promotion_evidence_incomplete.
    const gateEvidenceStatuses = [
      "legacy_null",                              // e.g. a pre-Wave-3 BIF
      "legacy_proceed",                           // e.g. a legacy orchestrator gate
      slippageEvidenceBucket(gateResult.status),  // FIX M1: malformed → INCOMPLETE
    ];
    const incompleteCount = gateEvidenceStatuses.filter(isIncompleteEvidenceStatus).length;
    expect(incompleteCount).toBe(3);
    expect(incompleteCount >= 3).toBe(true);

    // Regression contrast: the OLD accounting booked malformed as "complete" → only
    // 2 incomplete → the broken-producer strategy would have DODGED the governor.
    const oldBuggy = ["legacy_null", "legacy_proceed", "complete"];
    expect(oldBuggy.filter(isIncompleteEvidenceStatus).length).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite 14 — FIX M3: broker_accounts firm↔broker_type topology CHECK constraint
// (migration 0190, mirrored in pglite CORE_DDL) round-trip through PGlite
// ════════════════════════════════════════════════════════════════════════════════

describe("FIX M3: broker_accounts firm↔broker_type topology CHECK constraint (PGlite)", () => {
  let ctx: TestDb;

  beforeAll(async () => { ctx = await createTestDb(); });
  afterAll(async () => { await ctx.close(); });

  it("ACCEPTS topstep + topstepx (valid topology)", async () => {
    await expect(
      ctx.pg.query(
        `INSERT INTO broker_accounts (firm_id, broker_type) VALUES ($1, $2)`,
        ["topstep", "topstepx"],
      ),
    ).resolves.toBeDefined();
  });

  it("ACCEPTS topstep_50k + topstepx (suffix normalized)", async () => {
    await expect(
      ctx.pg.query(
        `INSERT INTO broker_accounts (firm_id, broker_type) VALUES ($1, $2)`,
        ["topstep_50k", "topstepx"],
      ),
    ).resolves.toBeDefined();
  });

  // deepscan15 L1: mixed-case tier suffix. Before the lower-first regex fix, the SQL
  // CHECK stripped BEFORE lowercasing with a lowercase-only 'k', so 'Topstep_50K' did
  // NOT normalize to 'topstep' → the DB would have WRONGLY rejected a valid topstepx row
  // while the TS guard (lowercases first) accepted it. Now both agree.
  it("ACCEPTS Topstep_50K + topstepx (case-insensitive normalize — L1 regression)", async () => {
    await expect(
      ctx.pg.query(
        `INSERT INTO broker_accounts (firm_id, broker_type) VALUES ($1, $2)`,
        ["Topstep_50K", "topstepx"],
      ),
    ).resolves.toBeDefined();
  });

  it("ACCEPTS mffu + traderspost (valid topology)", async () => {
    await expect(
      ctx.pg.query(
        `INSERT INTO broker_accounts (firm_id, broker_type) VALUES ($1, $2)`,
        ["mffu", "traderspost"],
      ),
    ).resolves.toBeDefined();
  });

  it("REJECTS topstep + traderspost (the M3 core violation — Topstep never TradersPost)", async () => {
    await expect(
      ctx.pg.query(
        `INSERT INTO broker_accounts (firm_id, broker_type) VALUES ($1, $2)`,
        ["topstep", "traderspost"],
      ),
    ).rejects.toThrow();
  });

  it("REJECTS topstep_50k + traderspost (suffix normalized violation)", async () => {
    await expect(
      ctx.pg.query(
        `INSERT INTO broker_accounts (firm_id, broker_type) VALUES ($1, $2)`,
        ["topstep_50k", "traderspost"],
      ),
    ).rejects.toThrow();
  });

  it("REJECTS mffu + topstepx (only Topstep may route TopstepX)", async () => {
    await expect(
      ctx.pg.query(
        `INSERT INTO broker_accounts (firm_id, broker_type) VALUES ($1, $2)`,
        ["mffu", "topstepx"],
      ),
    ).rejects.toThrow();
  });

  it("REJECTS an UPDATE that would flip a valid topstep row to traderspost", async () => {
    const [row] = (await ctx.pg.query<{ account_id: string }>(
      `INSERT INTO broker_accounts (firm_id, broker_type) VALUES ($1, $2) RETURNING account_id`,
      ["topstep", "topstepx"],
    )).rows;
    await expect(
      ctx.pg.query(
        `UPDATE broker_accounts SET broker_type = 'traderspost' WHERE account_id = $1`,
        [row.account_id],
      ),
    ).rejects.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite 15 — deepscan16 W1 T4: quantum_rl_runs producer/schema/consumer round-trip
//
// F-1/F-2/F-3/F-4 fixed the quantum_rl_agent.py INSERT shape, schema.ts
// strategy_id type (INTEGER -> UUID), and rl-signal-fetcher.ts's Number(uuid)
// bug. This suite proves the FIXED producer shape round-trips through the
// real quantum_rl_runs DDL (mirrors migration 0158/0165 exactly — see
// helpers/pglite-db.ts), and that both known pre-fix breakage shapes
// (nonexistent columns; non-UUID strategy_id) are rejected by the real DDL,
// not silently accepted.
// ════════════════════════════════════════════════════════════════════════════════

describe("quantum_rl_runs — producer/schema/consumer round-trip (PGlite, deepscan16 W1 T4)", () => {
  let ctx: TestDb;

  const STRAT_ID = "aa150001-0000-0000-0000-000000000001";

  beforeAll(async () => {
    ctx = await createTestDb();
    await ctx.db.insert(strategies).values({
      id: STRAT_ID,
      name: "rl-suite-15-strategy",
      symbol: "MES",
      timeframe: "5m",
      config: {},
    });
  });
  afterAll(async () => { await ctx.close(); });

  it("ACCEPTS the FIXED quantum_rl_agent.py INSERT shape and reads it back via Drizzle", async () => {
    // Exact column set quantum_rl_agent.py's fixed INSERT now targets (F-1 fix).
    await ctx.db.insert(quantumRlRuns).values({
      strategyId: STRAT_ID,
      regime: "TRENDING",
      stateVector: { daily_atr: 4.2, institutional_regime: "TRENDING" },
      action: "act",
      confidenceScore: 0.62,
      effectiveConfidence: 0.31,
      reward: 1.25,
      ciHighAtEvaluation: 0.18,
      drawdownPenalty: null,
      governanceLabels: {
        experimental: true,
        authoritative: false,
        decision_role: "challenger_only",
        training_mode: true,
        sr_is: 0.8,
        sr_oos: 0.6,
        n_training_iterations: 20,
      },
      cpcvFoldId: null,
      seed: 42,
    });

    const [row] = await ctx.db
      .select()
      .from(quantumRlRuns)
      .where(eq(quantumRlRuns.strategyId, STRAT_ID));

    expect(row).toBeDefined();
    expect(row.regime).toBe("TRENDING");
    expect(row.action).toBe("act");
    expect(Number(row.reward)).toBeCloseTo(1.25, 5);
    // F-3 regression guard: consumer-side lookup must use the UUID string
    // directly (Number(uuid) => NaN would have returned zero rows here).
    const gl = row.governanceLabels as Record<string, unknown>;
    expect(gl.sr_is).toBe(0.8);
    expect(gl.sr_oos).toBe(0.6);
    expect(gl.n_training_iterations).toBe(20);
    expect(gl.training_mode).toBe(true);
  });

  it("REJECTS the PRE-FIX column shape (status/method/total_return/sharpe_ratio do not exist)", async () => {
    // Exact column list the broken INSERT used before the F-1 fix.
    await expect(
      ctx.pg.query(
        `INSERT INTO quantum_rl_runs
           (strategy_id, status, method, total_return, sharpe_ratio, governance_labels, seed, created_at)
         VALUES ($1, 'completed', $2, $3, $4, $5, $6, NOW())`,
        [STRAT_ID, "pennylane_vqc_regime_trending", "10.0", "1.5", JSON.stringify({ training_mode: true }), 42],
      ),
    ).rejects.toThrow();
  });

  it("REJECTS a non-UUID strategy_id (the pre-F-2 INTEGER-typed shape)", async () => {
    await expect(
      ctx.pg.query(
        `INSERT INTO quantum_rl_runs
           (strategy_id, regime, state_vector, action, confidence_score,
            effective_confidence, reward, governance_labels)
         VALUES ($1, 'TRENDING', '{}'::jsonb, 'act', 0.5, 0.5, 1.0, '{}'::jsonb)`,
        [12345],
      ),
    ).rejects.toThrow();
  });
});
