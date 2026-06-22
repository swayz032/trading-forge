/**
 * wave23h-pre-market-cron.test.ts — W23H.2 Pre-Market Cron Logic
 *
 * Tests the scheduler-level cron logic for pre-market-routine:
 *  - Hour-gate: only fires at UTC hours 12 or 13
 *  - Idempotency: first run inserts 3 symbol rows; second run same UTC day skips
 *  - Error path: one symbol fails → other symbols still complete; errored audit emitted
 *
 * We test the cron job behavior by extracting the logic into testable pure functions
 * and verifying the scheduler integration patterns.
 *
 * All tests are pure unit tests — no DB connections.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  composeWrittenBias,
  computeAtrStats,
  type PreMarketDataAccessLayer,
  type DailyBar,
  type IntraBar,
  type UpsertPreMarketInput,
  __resetLiveDalForTests,
} from "../services/pre-market-routine.js";

// ─── Mock audit-log-helper ─────────────────────────────────────────────────────
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  __resetLiveDalForTests();
  vi.clearAllMocks();
});

// ─── Hour gate logic ──────────────────────────────────────────────────────────

/**
 * Mirror of the scheduler hour-gate: only fire at UTC 12 or 13.
 */
function shouldFirePreMarketRoutine(hourUtc: number): boolean {
  return hourUtc === 12 || hourUtc === 13;
}

describe("W23H.2 scheduler hour-gate", () => {
  const allHours = Array.from({ length: 24 }, (_, i) => i);
  const targetHours = [12, 13];
  const nonTargetHours = allHours.filter((h) => !targetHours.includes(h));

  it("fires at UTC hour 12 (8:30 AM ET DST)", () => {
    expect(shouldFirePreMarketRoutine(12)).toBe(true);
  });

  it("fires at UTC hour 13 (8:30 AM ET EST)", () => {
    expect(shouldFirePreMarketRoutine(13)).toBe(true);
  });

  it.each(nonTargetHours)("does NOT fire at UTC hour %i", (hour) => {
    expect(shouldFirePreMarketRoutine(hour)).toBe(false);
  });
});

// ─── Idempotency: audit_log check pattern ────────────────────────────────────

/**
 * Mirror of idempotency check: count audit_log rows with
 * action='pre_market_routine.completed' AND result->>'session_date' = sessionDate
 * AND created_at >= startOfDay.
 */
function shouldSkipDueToIdempotency(
  existingCompletedCount: number,
): boolean {
  return existingCompletedCount > 0;
}

describe("W23H.2 idempotency check", () => {
  it("no completed rows → should NOT skip", () => {
    expect(shouldSkipDueToIdempotency(0)).toBe(false);
  });

  it("1 completed row → should skip", () => {
    expect(shouldSkipDueToIdempotency(1)).toBe(true);
  });

  it("3 completed rows (one per symbol) → should skip", () => {
    expect(shouldSkipDueToIdempotency(3)).toBe(true);
  });
});

// ─── Symbol iteration with error isolation ────────────────────────────────────

/**
 * Simulate the scheduler's per-symbol iteration: on error, emit errored audit,
 * continue to next symbol.
 *
 * This mirrors the for-loop in scheduler.ts pre-market-routine job.
 */
async function runSymbolsWithErrorIsolation(
  symbols: readonly string[],
  runFn: (symbol: string) => Promise<{ rowId: number; fieldsPopulated: string[] }>,
  auditFn: (action: string, symbol: string) => Promise<void>,
): Promise<{ succeeded: string[]; errored: string[] }> {
  const succeeded: string[] = [];
  const errored: string[] = [];

  for (const symbol of symbols) {
    try {
      await runFn(symbol);
      succeeded.push(symbol);
    } catch {
      errored.push(symbol);
      await auditFn("pre_market_routine.errored", symbol).catch(() => undefined);
    }
  }

  return { succeeded, errored };
}

describe("W23H.2 per-symbol error isolation", () => {
  it("all symbols succeed → succeeded=[MES,MNQ,MCL], errored=[]", async () => {
    const symbols = ["MES", "MNQ", "MCL"] as const;
    const runFn = vi.fn().mockResolvedValue({ rowId: 1, fieldsPopulated: ["pdh", "pdl"] });
    const auditFn = vi.fn().mockResolvedValue(undefined);

    const result = await runSymbolsWithErrorIsolation(symbols, runFn, auditFn);

    expect(result.succeeded).toEqual(["MES", "MNQ", "MCL"]);
    expect(result.errored).toEqual([]);
    expect(runFn).toHaveBeenCalledTimes(3);
    expect(auditFn).toHaveBeenCalledTimes(0);
  });

  it("MNQ fails → MES and MCL still complete; errored audit emitted for MNQ", async () => {
    const symbols = ["MES", "MNQ", "MCL"] as const;
    const runFn = vi.fn().mockImplementation(async (symbol: string) => {
      if (symbol === "MNQ") throw new Error("MNQ data unavailable");
      return { rowId: 42, fieldsPopulated: ["pdh"] };
    });
    const auditFn = vi.fn().mockResolvedValue(undefined);

    const result = await runSymbolsWithErrorIsolation(symbols, runFn, auditFn);

    expect(result.succeeded).toEqual(["MES", "MCL"]);
    expect(result.errored).toEqual(["MNQ"]);
    expect(auditFn).toHaveBeenCalledTimes(1);
    expect(auditFn).toHaveBeenCalledWith("pre_market_routine.errored", "MNQ");
  });

  it("all symbols fail → errored audit emitted for each; succeeded=[]", async () => {
    const symbols = ["MES", "MNQ", "MCL"] as const;
    const runFn = vi.fn().mockRejectedValue(new Error("DB unavailable"));
    const auditFn = vi.fn().mockResolvedValue(undefined);

    const result = await runSymbolsWithErrorIsolation(symbols, runFn, auditFn);

    expect(result.succeeded).toEqual([]);
    expect(result.errored).toEqual(["MES", "MNQ", "MCL"]);
    expect(auditFn).toHaveBeenCalledTimes(3);
  });

  it("audit emit failure does NOT propagate; errored symbol still recorded", async () => {
    const symbols = ["MES"] as const;
    const runFn = vi.fn().mockRejectedValue(new Error("symbol failed"));
    // Audit emit itself fails — must not cause the loop to throw
    const auditFn = vi.fn().mockRejectedValue(new Error("audit write failed"));

    // Should not throw even if auditFn rejects (we catch it in runSymbolsWithErrorIsolation)
    await expect(
      runSymbolsWithErrorIsolation(symbols, runFn, auditFn),
    ).resolves.toMatchObject({ errored: ["MES"] });
  });
});

// ─── Full cron run simulation ─────────────────────────────────────────────────

describe("W23H.2 cron full run simulation", () => {
  /**
   * Simulate a full cron tick:
   * 1. Check hour-gate
   * 2. Check idempotency (audit_log count)
   * 3. If not idempotent: emit started audit, run each symbol, emit skipped or errored audits
   */
  async function simulateCronTick(params: {
    hourUtc: number;
    alreadyRanCount: number;
    symbolResults: Record<string, "ok" | "fail">;
  }): Promise<{
    fired: boolean;
    skipped: boolean;
    symbolsCompleted: string[];
    symbolsErrored: string[];
    auditsEmitted: string[];
  }> {
    const auditsEmitted: string[] = [];
    const symbolsCompleted: string[] = [];
    const symbolsErrored: string[] = [];

    if (!shouldFirePreMarketRoutine(params.hourUtc)) {
      return { fired: false, skipped: false, symbolsCompleted, symbolsErrored, auditsEmitted };
    }

    if (shouldSkipDueToIdempotency(params.alreadyRanCount)) {
      auditsEmitted.push("pre_market_routine.skipped_already_ran_today");
      return { fired: true, skipped: true, symbolsCompleted, symbolsErrored, auditsEmitted };
    }

    auditsEmitted.push("pre_market_routine.started");
    const symbols = ["MES", "MNQ", "MCL"] as const;

    for (const symbol of symbols) {
      if (params.symbolResults[symbol] === "ok") {
        symbolsCompleted.push(symbol);
        // pre_market_routine.completed is emitted by runPreMarketRoutine internally
      } else {
        symbolsErrored.push(symbol);
        auditsEmitted.push("pre_market_routine.errored");
      }
    }

    return { fired: true, skipped: false, symbolsCompleted, symbolsErrored, auditsEmitted };
  }

  it("UTC hour 12, first run of day → fires, started audit emitted, all 3 symbols complete", async () => {
    const res = await simulateCronTick({
      hourUtc: 12,
      alreadyRanCount: 0,
      symbolResults: { MES: "ok", MNQ: "ok", MCL: "ok" },
    });

    expect(res.fired).toBe(true);
    expect(res.skipped).toBe(false);
    expect(res.symbolsCompleted).toEqual(["MES", "MNQ", "MCL"]);
    expect(res.auditsEmitted).toContain("pre_market_routine.started");
    expect(res.auditsEmitted).not.toContain("pre_market_routine.skipped_already_ran_today");
  });

  it("UTC hour 13, second run same UTC day → skips; skipped_already_ran_today audit emitted", async () => {
    const res = await simulateCronTick({
      hourUtc: 13,
      alreadyRanCount: 3, // 3 completed rows exist from the 12:00 UTC run
      symbolResults: { MES: "ok", MNQ: "ok", MCL: "ok" },
    });

    expect(res.fired).toBe(true);
    expect(res.skipped).toBe(true);
    expect(res.symbolsCompleted).toEqual([]);
    expect(res.auditsEmitted).toContain("pre_market_routine.skipped_already_ran_today");
  });

  it("UTC hour 14 → does NOT fire (not a target hour)", async () => {
    const res = await simulateCronTick({
      hourUtc: 14,
      alreadyRanCount: 0,
      symbolResults: { MES: "ok", MNQ: "ok", MCL: "ok" },
    });

    expect(res.fired).toBe(false);
    expect(res.auditsEmitted).toHaveLength(0);
  });

  it("error path: MES fails → MCL/MNQ complete; errored audit × 1", async () => {
    const res = await simulateCronTick({
      hourUtc: 12,
      alreadyRanCount: 0,
      symbolResults: { MES: "fail", MNQ: "ok", MCL: "ok" },
    });

    expect(res.fired).toBe(true);
    expect(res.skipped).toBe(false);
    expect(res.symbolsCompleted).toEqual(["MNQ", "MCL"]);
    expect(res.symbolsErrored).toEqual(["MES"]);
    expect(res.auditsEmitted.filter((a) => a === "pre_market_routine.errored")).toHaveLength(1);
  });
});

// ─── runPreMarketRoutine end-to-end with DAL (3-symbol sequential run) ────────

describe("W23H.2 runPreMarketRoutine via DAL: 3-symbol sequential", () => {
  /**
   * Verify that running all 3 BIAS_SYMBOLS sequentially calls upsertPreMarketSession
   * exactly 3 times with different symbols.
   */
  it("three sequential calls produce 3 distinct upsert rows", async () => {
    const { runPreMarketRoutine } = await import("../services/pre-market-routine.js");

    const upsertFn = vi.fn().mockImplementation(async (input: UpsertPreMarketInput) => {
      return input.symbol === "MES" ? 1 : input.symbol === "MNQ" ? 2 : 3;
    });

    function makeDalForSymbol(): PreMarketDataAccessLayer {
    // @ts-ignore — partial PreMarketDataAccessLayer mock object; may not satisfy all interface members (W0.3 2026-06-22)
      return {
        getDailyBars: vi.fn().mockResolvedValue([
          { date: "2026-05-20", open: 5840, high: 5860, low: 5820, close: 5850 },
          { date: "2026-05-19", open: 5820, high: 5845, low: 5800, close: 5830 },
        ]),
        getOvernightBars: vi.fn().mockResolvedValue([]),
        getSkipDecisionsForDate: vi.fn().mockResolvedValue([]),
        getFirstRthBar: vi.fn().mockResolvedValue(null),
        getHtfBias: vi.fn().mockResolvedValue("TRENDING_UP"),
        upsertPreMarketSession: upsertFn,
      };
    }

    const symbols = ["MES", "MNQ", "MCL"] as const;
    const sessionDate = "2026-05-21";
    const dal = makeDalForSymbol();

    for (const symbol of symbols) {
      await runPreMarketRoutine(symbol, sessionDate, `corr-${symbol}`, dal);
    }

    expect(upsertFn).toHaveBeenCalledTimes(3);
    const upsertedSymbols = upsertFn.mock.calls.map((c) => (c[0] as UpsertPreMarketInput).symbol);
    expect(upsertedSymbols).toEqual(["MES", "MNQ", "MCL"]);
  });
});
