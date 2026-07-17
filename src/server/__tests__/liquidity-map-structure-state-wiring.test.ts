/**
 * liquidity-map-structure-state-wiring.test.ts — HIGH fix
 * (critic-replay-lifecycle-misc, 2026-07-17)
 *
 * Root cause: the only production caller of refreshSessionLevels()
 * (scheduler.ts:5085, held back this fix wave) never supplied the optional
 * `structureState` 5th argument, so EQH/EQL swing data was ALWAYS null and
 * detectEqhEql() ALWAYS returned {eqh: null, eql: null} — a structurally dead
 * path. The null-price audit signal that would have made this visible was
 * also unconditionally suppressed via `nullIsExpected: true`.
 *
 * Fix: refreshSessionLevels() now self-resolves structure state from
 * bias_state.structure_state via `dal.getStructureState()` whenever the
 * caller omits the `structureState` argument entirely (a plain table read —
 * does not touch scheduler.ts or bias-state-service.ts, both held back this
 * wave). The null-price suppression is now narrower: only genuinely benign
 * "swing value present, no EQH/EQL match" misses stay suppressed; a resolved-
 * but-null swing value (once the resolution mechanism itself is live) now
 * surfaces loudly, so a genuine future regression in bias_state population
 * stays visible instead of being silently absorbed forever.
 *
 * This test file proves:
 *   1. When the DAL implements getStructureState() and it returns real swing
 *      data that matches PDH/PDL within tolerance, EQH/EQL levels are
 *      inserted WITHOUT the caller passing structureState at all — the
 *      wiring gap is closed.
 *   2. When the DAL implements getStructureState() and it returns null (no
 *      bias_state row yet, or structure_state not computed), the null-price
 *      signal is NOT suppressed for eqh/eql — a genuine data gap now surfaces.
 *   3. When the DAL implements getStructureState() and swing data is present
 *      but doesn't match PDH/PDL (no equal high/low this session), the
 *      benign carve-out still applies — no loud signal (matches the
 *      pre-existing test in liquidity-map-null-price-telemetry.test.ts, but
 *      exercised via the self-resolution path instead of an explicit arg).
 *   4. Explicitly passing `structureState: null` still overrides
 *      self-resolution (dal.getStructureState is never called) — the
 *      existing test-injection contract is preserved.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/index.js", () => ({
  db: {},
}));
vi.mock("../db/schema.js", () => ({}));

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

import {
  refreshSessionLevels,
  type LiquidityMapDAL,
  type UpsertLevelInput,
  type ActiveLevelRow,
  type PreMarketRow,
  type StructureStateSwing,
} from "../services/liquidity-map-service.js";

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

/** DAL that implements getStructureState — models the production DAL after this fix. */
function makeWiredDAL(
  preMarketRow: PreMarketRow | null,
  structureState: StructureStateSwing | null,
): LiquidityMapDAL & { upsertCalls: UpsertLevelInput[]; getStructureStateCalls: number } {
  const upsertCalls: UpsertLevelInput[] = [];
  let getStructureStateCalls = 0;
  return {
    upsertCalls,
    get getStructureStateCalls() {
      return getStructureStateCalls;
    },
    async upsertLevel(row: UpsertLevelInput): Promise<{ id: string }> {
      upsertCalls.push(row);
      return { id: `id-${row.levelType}-${Math.round(row.price)}` };
    },
    async getActiveLevels(): Promise<ActiveLevelRow[]> {
      return [];
    },
    async updateSweepProbability(): Promise<void> {},
    async incrementTouchedCount(): Promise<void> {},
    async expireLevels(): Promise<number> {
      return 0;
    },
    async getPreMarketSession(): Promise<PreMarketRow | null> {
      return preMarketRow;
    },
    async getStructureState(): Promise<StructureStateSwing | null> {
      getStructureStateCalls++;
      return structureState;
    },
  };
}

beforeEach(() => {
  insertAuditRowMock.mockClear();
  loggerWarnMock.mockClear();
});

describe("liquidity-map EQH/EQL structureState self-resolution wiring", () => {
  it("wires EQH/EQL through when the caller omits structureState but the DAL can resolve it", async () => {
    const dal = makeWiredDAL(
      makeHealthyPreMarketRow({ pdh: 4280.0, pdl: 4220.0 }),
      { swing_high: 4280.1, swing_low: 4219.9 }, // within 0.25pt MES tolerance of pdh/pdl
    );

    // No 5th arg — mirrors the real production call site (scheduler.ts).
    const result = await refreshSessionLevels("MES", "2026-07-17", "cid-wired", dal);

    expect(dal.getStructureStateCalls).toBe(1);
    const levelTypes = dal.upsertCalls.map((c) => c.levelType);
    expect(levelTypes).toContain("eqh");
    expect(levelTypes).toContain("eql");
    expect(result.nullPriceSkips).toBe(0);
  });

  it("surfaces a loud signal when getStructureState resolves but returns null (genuine data gap)", async () => {
    const dal = makeWiredDAL(makeHealthyPreMarketRow(), null);

    const result = await refreshSessionLevels("MES", "2026-07-17", "cid-gap", dal);

    expect(dal.getStructureStateCalls).toBe(1);
    const levelTypes = dal.upsertCalls.map((c) => c.levelType);
    expect(levelTypes).not.toContain("eqh");
    expect(levelTypes).not.toContain("eql");

    // The 8 bars-derived fields were healthy; eqh + eql are the only skips —
    // and unlike the pre-fix behavior, they are NOT suppressed.
    expect(result.nullPriceSkips).toBe(2);

    const skipAuditCalls = insertAuditRowMock.mock.calls.filter(
      ([arg]) => arg.action === "liquidity_map.insert_skipped_null_price",
    );
    expect(skipAuditCalls).toHaveLength(1);
    const [skipArg] = skipAuditCalls[0];
    expect(skipArg.result.skippedLevelTypes).toEqual(
      expect.arrayContaining(["eqh", "eql"]),
    );
  });

  it("keeps the benign carve-out when swing data resolves but doesn't match PDH/PDL", async () => {
    const dal = makeWiredDAL(
      makeHealthyPreMarketRow({ pdh: 4280.0, pdl: 4220.0 }),
      { swing_high: 4400.0, swing_low: 4000.0 }, // far from pdh/pdl — no EQH/EQL match
    );

    const result = await refreshSessionLevels("MES", "2026-07-17", "cid-no-match", dal);

    expect(dal.getStructureStateCalls).toBe(1);
    const levelTypes = dal.upsertCalls.map((c) => c.levelType);
    expect(levelTypes).not.toContain("eqh");
    expect(levelTypes).not.toContain("eql");
    // Benign miss — swing data WAS present, just didn't match. Stays suppressed.
    expect(result.nullPriceSkips).toBe(0);
  });

  it("explicit structureState (including null) overrides self-resolution — dal.getStructureState is never called", async () => {
    const dal = makeWiredDAL(makeHealthyPreMarketRow(), { swing_high: 4280.05, swing_low: 4219.95 });

    const result = await refreshSessionLevels("MES", "2026-07-17", "cid-explicit-null", dal, null);

    // Explicit null was passed — self-resolution must NOT engage even though
    // the DAL could have resolved real swing data.
    expect(dal.getStructureStateCalls).toBe(0);
    const levelTypes = dal.upsertCalls.map((c) => c.levelType);
    expect(levelTypes).not.toContain("eqh");
    expect(levelTypes).not.toContain("eql");
    // structureStateMechanismAvailable=true (explicit, even if null) and
    // swingH/swingL are both null → NOT suppressed (consistent with test 2 above).
    expect(result.nullPriceSkips).toBe(2);
  });
});
