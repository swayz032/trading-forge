/**
 * liquidity-map-null-price-telemetry.test.ts — 2026-07-17 liveness audit fix
 *
 * Root cause (diagnosed separately, not re-fixed here): /api/bars/:symbol
 * doesn't exist server-side, so pre-market-routine.ts 404s and every
 * bars-derived field on pre_market_sessions lands null. Before this fix,
 * insertLevel() silently no-op'd on price===null and the 30-min RTH cron
 * wrote an identical `liquidity_map.session_refreshed` "success" audit row
 * whether the tick was genuinely healthy-and-empty or the entire data source
 * was unavailable — 390 consecutive false-green rows, 0 rows ever in
 * liquidity_levels.
 *
 * This test file proves the telemetry-honesty fix ONLY:
 *   1. A null price on a bars-derived field produces a loud, distinct signal
 *      (structured warn log + aggregated liquidity_map.insert_skipped_null_price
 *      audit row) instead of a silent no-op.
 *   2. A missing pre_market_sessions row produces its own distinct
 *      liquidity_map.refresh_no_premarket_data signal.
 *   3. The nullIsExpected=true carve-out on EQH/EQL suppresses the loud
 *      signal when a supplied structureState doesn't produce a match — this
 *      test exercises that exclusion MECHANISM directly (it passes
 *      structureState as the optional 5th arg, which the test harness can do
 *      even though production never does — see the F-1 correction below).
 *   4. A normal tick with real prices still reports cleanly — no regression
 *      on the healthy path (nullPriceSkips=0, no warning audit rows).
 *
 * Explicitly OUT OF SCOPE (not tested/fixed here): implementing
 * /api/bars/:symbol, or the 6 missing liquidity_levels level_type producers
 * (hod/lod/asian_high/asian_low/untouched_fvg/untouched_ob).
 *
 * F-1 correction (independent grading, same date): EQH/EQL is NOT merely
 * "sometimes no equal high/low this session" in production — it is
 * STRUCTURALLY DEAD. The only real caller, scheduler.ts:4906, invokes
 * `refreshSessionLevels(symbol, sessionDate, correlationId)` with just 3 args
 * and never supplies `structureState`, so swingH/swingL are ALWAYS null in
 * production, unconditionally, forever. Test 3 below passes structureState
 * explicitly to prove the nullIsExpected carve-out itself works correctly
 * (it must not fire on ANY EQH/EQL null, matched-heuristic-miss or otherwise)
 * — it is NOT evidence that this scenario occurs in production. Wiring
 * bias_state.structure_state into the scheduler call site is a separate,
 * out-of-scope fix.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (must be before imports that pull db/schema) ────────────────

vi.mock("../db/index.js", () => ({
  db: {},
}));
vi.mock("../db/schema.js", () => ({}));

// vi.mock factories are hoisted above regular top-level declarations, so the
// mock fns they close over must themselves be created via vi.hoisted() —
// referencing an ordinary outer `const` here would throw a TDZ error.
const { insertAuditRowMock, loggerWarnMock } = vi.hoisted(() => ({
  insertAuditRowMock: vi.fn().mockResolvedValue(undefined),
  loggerWarnMock: vi.fn(),
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: insertAuditRowMock,
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: loggerWarnMock,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
  refreshSessionLevels,
  type LiquidityMapDAL,
  type UpsertLevelInput,
  type ActiveLevelRow,
  type PreMarketRow,
} from "../services/liquidity-map-service.js";

// ─── DAL factory helpers (mirrors wave25-liquidity-map.test.ts conventions) ───

function makeHealthyPreMarketRow(overrides: Partial<PreMarketRow> = {}): PreMarketRow {
  return {
    pdh: 4280.0,
    pdl: 4220.0,
    pwh: 4300.0,
    pwl: 4200.0,
    pwhIso: 4310.0,
    pwlIso: 4195.0,
    pmh: 4350.0,
    pml: 4150.0,
    londonRangeHigh: 4260.0,
    londonRangeLow: 4240.0,
    nearbyNakedPocs: [],
    ...overrides,
  };
}

/** Simulates the exact production failure: row exists, every bars-derived field is null. */
function makeAllNullPreMarketRow(): PreMarketRow {
  return {
    pdh: null,
    pdl: null,
    pwh: null,
    pwl: null,
    pwhIso: null,
    pwlIso: null,
    pmh: null,
    pml: null,
    londonRangeHigh: null,
    londonRangeLow: null,
    nearbyNakedPocs: null,
  };
}

function makeMockDAL(
  preMarketRow: PreMarketRow | null,
  existingLevels: ActiveLevelRow[] = [],
): LiquidityMapDAL & { upsertCalls: UpsertLevelInput[] } {
  const upsertCalls: UpsertLevelInput[] = [];
  return {
    upsertCalls,
    async upsertLevel(row: UpsertLevelInput): Promise<{ id: string }> {
      upsertCalls.push(row);
      return { id: `id-${row.levelType}-${Math.round(row.price)}` };
    },
    async getActiveLevels(): Promise<ActiveLevelRow[]> {
      return existingLevels;
    },
    async updateSweepProbability(): Promise<void> {},
    async incrementTouchedCount(): Promise<void> {},
    async expireLevels(): Promise<number> {
      return 0;
    },
    async getPreMarketSession(): Promise<PreMarketRow | null> {
      return preMarketRow;
    },
  };
}

beforeEach(() => {
  insertAuditRowMock.mockClear();
  loggerWarnMock.mockClear();
});

describe("liquidity-map null-price telemetry honesty", () => {
  it("loud signal: all-null pre_market_sessions row skips every bars-derived insert AND fires insert_skipped_null_price", async () => {
    const dal = makeMockDAL(makeAllNullPreMarketRow());

    const result = await refreshSessionLevels("MES", "2026-07-17", "cid-null-price", dal);

    // No inserts happened — the silent-no-op part of the old behavior is preserved
    // (we are not fabricating levels), but it must no longer be SILENT.
    expect(dal.upsertCalls).toHaveLength(0);
    expect(result.added).toBe(0);
    expect(result.nullPriceSkips).toBeGreaterThan(0);
    // 8 bars-derived fields: pdh, pdl, pwh_iso, pwl_iso, pmh, pml, london_high, london_low
    expect(result.nullPriceSkips).toBe(8);

    // A distinct, loud audit row fired — not the generic "success" shape.
    const skipAuditCalls = insertAuditRowMock.mock.calls.filter(
      ([arg]) => arg.action === "liquidity_map.insert_skipped_null_price",
    );
    expect(skipAuditCalls).toHaveLength(1);
    const [skipArg] = skipAuditCalls[0];
    expect(skipArg.status).toBe("warning");
    expect(skipArg.result.skippedCount).toBe(8);
    expect(skipArg.result.skippedLevelTypes).toEqual(
      expect.arrayContaining(["pdh", "pdl", "pwh_iso", "pwl_iso", "pmh", "pml", "london_high", "london_low"]),
    );

    // Per-level structured warn logs also fired (cheap, non-audit-volume signal).
    expect(loggerWarnMock).toHaveBeenCalled();
    const warnedForPdh = loggerWarnMock.mock.calls.some(
      ([fields, msg]) => fields?.levelType === "pdh" && /source price unavailable/.test(msg),
    );
    expect(warnedForPdh).toBe(true);

    // Never a "success" row for this tick's level inserts (there were none).
    const successRows = insertAuditRowMock.mock.calls.filter(([arg]) => arg.status === "success");
    expect(successRows).toHaveLength(0);
  });

  it("loud signal: missing pre_market_sessions row fires refresh_no_premarket_data (distinct action)", async () => {
    const dal = makeMockDAL(null);

    const result = await refreshSessionLevels("MES", "2026-07-17", "cid-no-row", dal);

    expect(result.added).toBe(0);
    expect(dal.upsertCalls).toHaveLength(0);

    const noRowCalls = insertAuditRowMock.mock.calls.filter(
      ([arg]) => arg.action === "liquidity_map.refresh_no_premarket_data",
    );
    expect(noRowCalls).toHaveLength(1);
    expect(noRowCalls[0][0].status).toBe("warning");

    // Must NOT also fire the null-price-skip signal (no levels were even attempted).
    const skipCalls = insertAuditRowMock.mock.calls.filter(
      ([arg]) => arg.action === "liquidity_map.insert_skipped_null_price",
    );
    expect(skipCalls).toHaveLength(0);
  });

  it("nullIsExpected carve-out: EQH/EQL non-match on a supplied structureState does NOT fire the loud null-price signal", async () => {
    // Healthy pre_market row; structureState is passed explicitly here so
    // swing_high/swing_low are far from pdh/pdl and EQH/EQL don't match.
    // This proves the carve-out mechanism itself (nullIsExpected=true must
    // suppress the signal for ANY EQH/EQL null, not just some) — it is NOT
    // evidence this scenario occurs in production. In production,
    // structureState is never supplied at all (scheduler.ts:4906 calls
    // refreshSessionLevels with only 3 args), so EQH/EQL is unconditionally
    // null for a structural reason, not a per-session heuristic miss — see
    // the F-1 correction in the file header. That gap is a separate,
    // out-of-scope wiring fix, not something this carve-out should surface.
    const dal = makeMockDAL(
      makeHealthyPreMarketRow({ pdh: 4280.0, pdl: 4220.0 }),
    );

    const result = await refreshSessionLevels("MES", "2026-07-17", "cid-eqh-normal", dal, {
      swing_high: 4400.0, // far from pdh — no EQH match
      swing_low: 4000.0, // far from pdl — no EQL match
    });

    // All 8 bars-derived fields were real, so those inserted successfully.
    const levelTypes = dal.upsertCalls.map((c) => c.levelType);
    expect(levelTypes).not.toContain("eqh");
    expect(levelTypes).not.toContain("eql");

    // nullPriceSkips must be 0 — the nullIsExpected carve-out excludes EQH/EQL
    // from this count (whether the null comes from a non-match or, as in
    // production, from structureState being unwired entirely).
    expect(result.nullPriceSkips).toBe(0);
    const skipCalls = insertAuditRowMock.mock.calls.filter(
      ([arg]) => arg.action === "liquidity_map.insert_skipped_null_price",
    );
    expect(skipCalls).toHaveLength(0);
  });

  it("healthy path regression check: normal tick with real prices reports cleanly, no warning signals", async () => {
    const dal = makeMockDAL(makeHealthyPreMarketRow());

    const result = await refreshSessionLevels("MES", "2026-07-17", "cid-healthy", dal);

    expect(result.added).toBeGreaterThan(0);
    expect(result.nullPriceSkips).toBe(0);

    const warningAuditCalls = insertAuditRowMock.mock.calls.filter(
      ([arg]) => arg.status === "warning",
    );
    expect(warningAuditCalls).toHaveLength(0);

    const skipWarnLogs = loggerWarnMock.mock.calls.filter(([, msg]) =>
      /source price unavailable/.test(msg ?? ""),
    );
    expect(skipWarnLogs).toHaveLength(0);
  });
});
