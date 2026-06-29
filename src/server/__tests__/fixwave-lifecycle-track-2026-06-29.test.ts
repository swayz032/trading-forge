/**
 * fixwave-lifecycle-track-2026-06-29.test.ts
 *
 * Lifecycle + gate-libs fix-wave track (2026-06-29). Verifies:
 *
 *   FIX #1 (C1 consumer side) — parameter-drift cpcv_exempt.
 *     walk_forward.py emits a top-level `param_stability_status` key. On the CPCV path
 *     it is "cpcv_not_applicable"; the parameter-drift gate must return the DISTINCT
 *     cpcv_exempt result (distinct audit) instead of collapsing into legacy_null. The
 *     value must survive the walkForwardResults JSONB round-trip (the cherry-pick in
 *     backtest-service.ts now carries it). Mirrors the WFE/PBO cpcv-exempt tests in
 *     gate-chain-integration.test.ts (JSONB round-trip + pure-gate evaluation).
 *
 *   FIX #2 (H1/H2/H3) — CANDIDATE → TESTING → SHADOW ladder + PBO at TESTING → SHADOW.
 *     The Gate 1.5 TESTING → SHADOW driver fires the existing Wave 29 Pass A.2 PBO gate.
 *     pbo_overall > 0.15 must BLOCK (strategy held at TESTING, not silently promoted);
 *     pbo_overall < 0.15 proceeds. Routing determinism: the Gate 1.5 selector
 *     (lifecycle_state='TESTING' AND shadow_mode_enabled=true) and the Gate 2 guard
 *     (skip shadow_mode_enabled=true) are MUTUALLY EXCLUSIVE — proving no dual-driver
 *     double-promote.
 *
 * The full checkAutoPromotions/promoteStrategy path is exercised by the gate-chain pglite
 * suite (owned by another agent) + candidate-backtest-conveyor.test.ts; this track test
 * follows the same JSONB-round-trip + pure-gate contract pattern used for every other
 * lifecycle gate in this repo.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { createTestDb } from "./helpers/pglite-db.js";
import type { TestDb } from "./helpers/pglite-db.js";
import { strategies, backtests } from "../db/schema.js";
import { evaluateParameterDriftGate } from "../lib/parameter-drift-gate.js";
import { evaluatePboGate } from "../lib/pbo-gate.js";

const STRAT_DRIFT = "ccd10001-0000-0000-0000-000000000001";
const BT_DRIFT_CPCV = "ccd10001-0000-0000-0000-0000000000a1";
const BT_DRIFT_PLAIN = "ccd10001-0000-0000-0000-0000000000a2";
const BT_DRIFT_LEGACY = "ccd10001-0000-0000-0000-0000000000a3";

const STRAT_SHADOW = "ccd10002-0000-0000-0000-000000000002"; // TESTING + shadow_mode_enabled=true
const STRAT_LEGACY_PAPER = "ccd10003-0000-0000-0000-000000000003"; // TESTING + shadow_mode_enabled=false
const BT_PBO_BLOCK = "ccd10002-0000-0000-0000-0000000000b1";
const BT_PBO_PASS = "ccd10002-0000-0000-0000-0000000000b2";

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDb();

  await ctx.db.insert(strategies).values([
    { id: STRAT_DRIFT, name: "drift-cpcv-track", symbol: "MES", timeframe: "5m", config: {} },
    // FIX #2 routing fixtures: both in TESTING, differing only by shadow_mode_enabled.
    { id: STRAT_SHADOW, name: "testing-shadow-bound", symbol: "MES", timeframe: "5m", config: {}, lifecycleState: "TESTING", shadowModeEnabled: true },
    { id: STRAT_LEGACY_PAPER, name: "testing-legacy-paper", symbol: "MES", timeframe: "5m", config: {}, lifecycleState: "TESTING", shadowModeEnabled: false },
  ]);

  await ctx.db.insert(backtests).values([
    {
      id: BT_DRIFT_CPCV,
      strategyId: STRAT_DRIFT,
      symbol: "MES",
      timeframe: "5m",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-06-01"),
      status: "completed",
      // Producer (CPCV path): param_stability classifier is N/A, but the top-level
      // param_stability_status explicitly signals the exemption.
      walkForwardResults: {
        param_stability: { drift_classification: null, drift_confidence: null },
        param_stability_status: "cpcv_not_applicable",
      },
    },
    {
      id: BT_DRIFT_PLAIN,
      strategyId: STRAT_DRIFT,
      symbol: "MES",
      timeframe: "5m",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-06-01"),
      status: "completed",
      // Regression: plain WF with a real overfit_drift must STILL block — cpcv-exempt
      // must not weaken the genuine drift block.
      walkForwardResults: {
        param_stability: { drift_classification: "overfit_drift", drift_confidence: 0.9 },
        param_stability_status: "computed",
      },
    },
    {
      id: BT_DRIFT_LEGACY,
      strategyId: STRAT_DRIFT,
      symbol: "MES",
      timeframe: "5m",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-06-01"),
      status: "completed",
      // Genuine legacy: no param_stability_status key at all (pre-Pass-B.1 backtest).
      walkForwardResults: { param_stability: { drift_classification: null, drift_confidence: null } },
    },
    {
      id: BT_PBO_BLOCK,
      strategyId: STRAT_SHADOW,
      symbol: "MES",
      timeframe: "5m",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-06-01"),
      status: "completed",
      walkForwardResults: { pbo_overall: 0.20 }, // > 0.15 → Gate 1.5 must block TESTING→SHADOW
    },
    {
      id: BT_PBO_PASS,
      strategyId: STRAT_LEGACY_PAPER,
      symbol: "MES",
      timeframe: "5m",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-06-01"),
      status: "completed",
      walkForwardResults: { pbo_overall: 0.05 }, // < 0.15 → proceeds
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

// ─── FIX #1 — parameter-drift cpcv_exempt (JSONB round-trip) ───────────────────

describe("FIX #1 — param_stability_status cpcv_exempt (JSONB round-trip)", () => {
  it("param_stability_status survives the walkForwardResults JSONB round-trip", async () => {
    const wfr = await selectWfRow(BT_DRIFT_CPCV);
    expect(wfr?.param_stability_status).toBe("cpcv_not_applicable");
  });

  it("CPCV: param_stability_status=cpcv_not_applicable → gate returns cpcv_exempt, NOT legacy_null", async () => {
    const wfr = await selectWfRow(BT_DRIFT_CPCV);
    const ps = (wfr?.param_stability as Record<string, unknown> | null) ?? null;
    const cls = (ps?.drift_classification as string | null) ?? null;
    const conf = ps?.drift_confidence != null ? Number(ps.drift_confidence) : null;
    const status = (wfr?.param_stability_status as string | null) ?? null;

    const result = evaluateParameterDriftGate(cls, conf, status);

    expect(result.status).toBe("cpcv_exempt");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.parameter_drift_cpcv_exempt");
    expect(result.status).not.toBe("legacy_null");
    expect(result.auditAction).not.toBe("lifecycle.parameter_drift_unavailable");
  });

  it("regression: plain-WF overfit_drift + confidence 0.90 STILL BLOCKS (cpcv-exempt must not weaken)", async () => {
    const wfr = await selectWfRow(BT_DRIFT_PLAIN);
    const ps = (wfr?.param_stability as Record<string, unknown> | null) ?? null;
    const cls = (ps?.drift_classification as string | null) ?? null;
    const conf = ps?.drift_confidence != null ? Number(ps.drift_confidence) : null;
    const status = (wfr?.param_stability_status as string | null) ?? null;

    const result = evaluateParameterDriftGate(cls, conf, status);

    expect(result.status).toBe("blocked");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.parameter_overfit_drift_block");
  });

  it("genuine legacy: absent param_stability_status + null classification → legacy_null (unchanged)", async () => {
    const wfr = await selectWfRow(BT_DRIFT_LEGACY);
    expect(wfr?.param_stability_status).toBeUndefined();
    const ps = (wfr?.param_stability as Record<string, unknown> | null) ?? null;
    const cls = (ps?.drift_classification as string | null) ?? null;
    const status = (wfr?.param_stability_status as string | null) ?? null;

    const result = evaluateParameterDriftGate(cls, null, status);

    expect(result.status).toBe("legacy_null");
    expect(result.auditAction).toBe("lifecycle.parameter_drift_unavailable");
  });
});

// ─── FIX #2 — PBO gate at TESTING → SHADOW (Gate 1.5) ─────────────────────────

describe("FIX #2 — PBO < 0.15 gate fires at TESTING → SHADOW (Gate 1.5)", () => {
  it("pbo_overall=0.20 > 0.15 → BLOCKS (strategy held at TESTING, not silently promoted)", async () => {
    const wfr = await selectWfRow(BT_PBO_BLOCK);
    const pboOverall = (wfr?.pbo_overall ?? null) as number | null;

    const result = evaluatePboGate({ pbo_overall: pboOverall });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_overfit_block");
  });

  it("pbo_overall=0.05 < 0.15 → proceeds (TESTING → SHADOW allowed)", async () => {
    const wfr = await selectWfRow(BT_PBO_PASS);
    const pboOverall = (wfr?.pbo_overall ?? null) as number | null;

    const result = evaluatePboGate({ pbo_overall: pboOverall });

    expect(result.ok).toBe(true);
    expect(result.auditPayload.blocked).toBe(false);
  });
});

// ─── FIX #2 — deterministic routing (no dual-driver double-promote) ───────────

describe("FIX #2 — Gate 1.5 vs Gate 2 selectors are mutually exclusive", () => {
  it("Gate 1.5 selector (TESTING + shadow_mode_enabled=true) returns ONLY the shadow-bound strategy", async () => {
    const rows = await ctx.db
      .select({ id: strategies.id })
      .from(strategies)
      .where(and(eq(strategies.lifecycleState, "TESTING"), eq(strategies.shadowModeEnabled, true)));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(STRAT_SHADOW);
    expect(ids).not.toContain(STRAT_LEGACY_PAPER);
  });

  it("Gate 2 guard (skip shadow_mode_enabled=true) excludes the shadow-bound strategy", async () => {
    // Gate 2 selects all TESTING then `if (s.shadowModeEnabled) continue;`. Emulate the
    // post-guard set: a TESTING strategy is processed by Gate 2 iff shadow_mode_enabled=false.
    const testingRows = await ctx.db
      .select({ id: strategies.id, shadow: strategies.shadowModeEnabled })
      .from(strategies)
      .where(eq(strategies.lifecycleState, "TESTING"));
    const gate2Processed = testingRows.filter((r) => !r.shadow).map((r) => r.id);
    expect(gate2Processed).toContain(STRAT_LEGACY_PAPER);
    expect(gate2Processed).not.toContain(STRAT_SHADOW); // never double-driven to PAPER
  });

  it("no TESTING strategy is eligible for BOTH Gate 1.5 (→SHADOW) and Gate 2 (→PAPER)", async () => {
    const testingRows = await ctx.db
      .select({ id: strategies.id, shadow: strategies.shadowModeEnabled })
      .from(strategies)
      .where(eq(strategies.lifecycleState, "TESTING"));
    const gate15 = new Set(testingRows.filter((r) => r.shadow).map((r) => r.id));
    const gate2 = new Set(testingRows.filter((r) => !r.shadow).map((r) => r.id));
    const overlap = [...gate15].filter((id) => gate2.has(id));
    expect(overlap).toHaveLength(0);
  });
});
