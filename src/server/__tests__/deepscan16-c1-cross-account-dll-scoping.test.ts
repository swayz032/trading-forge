/**
 * deepscan16-c1-cross-account-dll-scoping.test.ts — Deep-scan #16 Wave-1 Track-3 (2026-07-04)
 *
 * HIGH C-1: cross-account DLL nets across the firm STRING, not per-account.
 *
 * `cross-symbol-pnl.ts` grouped `paper_sessions` by `paperSessions.firmId`
 * (free-text "topstep"/"mffu", NOT a real account_id). Under Phase-3 scaling
 * (multiple Topstep accounts per operator), two accounts on the SAME firm were
 * netted into ONE shared bucket:
 *
 *   1. "A hidden behind B" — A at -$900 (90% of its own $1,000 DLL, should HALT)
 *      nets with B at +$500 (healthy) → combined -$400 (40%) → NEITHER halts.
 *      A's real breach is invisible.
 *
 *   2. "false halt of healthy B" — A at -$800 (80%, should genuinely halt A alone)
 *      and B at $0 (healthy) share the same bucket. Whenever B's OWN entry check
 *      queries the shared "topstep" key, it sees the combined -$800 (80%) and
 *      incorrectly halts B too, even though B's own account is untouched.
 *
 * Fix: `resolveAccountKey()` scopes aggregation by `config.account_key` (falling
 * back to firmId for backward compat) instead of raw firmId, and
 * `resolvePersonalDllDollars()` derives each account's DLL dollar base from its
 * own trailing-DD tier instead of one global $1,000 constant.
 *
 * Escalation ordering preserved: force_close(95%) > halt(67%) > reduce_size(60%) > none.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  positions: [] as Array<Record<string, unknown>>,
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(state.sessions)),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(state.positions)),
        })),
      })),
    })),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getAccountSessionCumulativePnL,
  evaluateCrossSymbolDll,
  resolveAccountKey,
  resolvePersonalDllDollars,
  DEFAULT_PERSONAL_DLL_DOLLARS,
} from "../services/cross-symbol-pnl.js";

const TODAY = "2026-07-04";

describe("C-1 — resolveAccountKey pure function", () => {
  it("falls back to firmId when config.account_key is absent (backward-compat default)", () => {
    expect(resolveAccountKey({ firmId: "topstep", config: null })).toBe("topstep");
    expect(resolveAccountKey({ firmId: "topstep", config: {} })).toBe("topstep");
  });

  it("uses config.account_key when present (per-account override)", () => {
    expect(resolveAccountKey({ firmId: "topstep", config: { account_key: "topstep-acct-2" } })).toBe("topstep-acct-2");
  });

  it("trims whitespace and ignores blank account_key strings", () => {
    expect(resolveAccountKey({ firmId: "topstep", config: { account_key: "  " } })).toBe("topstep");
    expect(resolveAccountKey({ firmId: "topstep", config: { account_key: "  acct-9  " } })).toBe("acct-9");
  });

  it("falls back to 'default' when both firmId and account_key are absent", () => {
    expect(resolveAccountKey({ firmId: null, config: null })).toBe("default");
    expect(resolveAccountKey({})).toBe("default");
  });
});

describe("C-1 — resolvePersonalDllDollars pure function", () => {
  it("topstep: uses config.trailing_dd_amount override when present", () => {
    expect(resolvePersonalDllDollars({ firmId: "topstep", trailingDdOverride: 3_500 })).toBe(3_500);
  });

  it("topstep: falls back to TOPSTEP_TRAILING_DD_BY_SIZE[accountStartingFloor]", () => {
    expect(resolvePersonalDllDollars({ firmId: "topstep", accountStartingFloor: 100_000 })).toBe(3_000);
    expect(resolvePersonalDllDollars({ firmId: "topstep", accountStartingFloor: 150_000 })).toBe(4_500);
  });

  it("topstep: falls back to $2,000 combine default with no override/tier match", () => {
    expect(resolvePersonalDllDollars({ firmId: "topstep" })).toBe(2_000);
    expect(resolvePersonalDllDollars({ firmId: "topstep", accountStartingFloor: 999_999 })).toBe(2_000);
  });

  it("mffu / other firms: falls back to the global personal default", () => {
    expect(resolvePersonalDllDollars({ firmId: "mffu" })).toBe(DEFAULT_PERSONAL_DLL_DOLLARS);
    expect(resolvePersonalDllDollars({ firmId: "mffu", accountStartingFloor: 100_000 })).toBe(DEFAULT_PERSONAL_DLL_DOLLARS);
  });

  it("respects an explicit personalDefault override", () => {
    expect(resolvePersonalDllDollars({ firmId: "mffu", personalDefault: 1_500 })).toBe(1_500);
  });
});

describe("C-1 — getAccountSessionCumulativePnL scopes by resolved account key, not raw firmId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.sessions = [];
    state.positions = [];
  });

  it("two Topstep accounts sharing firmId='topstep' but DIFFERENT config.account_key stay isolated", async () => {
    state.sessions = [
      { id: "s-A", firmId: "topstep", config: { account_key: "topstep-A" }, symbol: "MES", dailyPnlBreakdown: { [TODAY]: -900 } },
      { id: "s-B", firmId: "topstep", config: { account_key: "topstep-B" }, symbol: "MNQ", dailyPnlBreakdown: { [TODAY]: 500 } },
    ];
    state.positions = [];

    const pnlA = await getAccountSessionCumulativePnL("topstep-A", TODAY);
    const pnlB = await getAccountSessionCumulativePnL("topstep-B", TODAY);

    // THE BUG (pre-fix): both queries would net to -400 combined regardless of key.
    expect(pnlA.totalPnL).toBe(-900);
    expect(pnlB.totalPnL).toBe(500);
  });

  it("scenario 1 — A-hidden-behind-B: A's real 90% breach is now visible in isolation", async () => {
    state.sessions = [
      { id: "s-A", firmId: "topstep", config: { account_key: "topstep-A" }, symbol: "MES", dailyPnlBreakdown: { [TODAY]: -900 } },
      { id: "s-B", firmId: "topstep", config: { account_key: "topstep-B" }, symbol: "MNQ", dailyPnlBreakdown: { [TODAY]: 500 } },
    ];

    const pnlA = await getAccountSessionCumulativePnL("topstep-A", TODAY);
    const pnlB = await getAccountSessionCumulativePnL("topstep-B", TODAY);

    const resultA = evaluateCrossSymbolDll(pnlA, 1_000);
    const resultB = evaluateCrossSymbolDll(pnlB, 1_000);

    // A is at 90% of its own $1,000 DLL → HALT (was masked as "none" when netted
    // with B's +$500 gain to a combined -$400 / 40%).
    expect(resultA.dllPct).toBeCloseTo(0.90, 2);
    expect(resultA.action).toBe("halt");

    // B is healthy and positive — never triggers on its own P&L.
    expect(resultB.action).toBe("none");
  });

  it("scenario 2 — false-halt-of-healthy-B: B's own entry check no longer inherits A's losses", async () => {
    // A is genuinely bad (80% of its own DLL — correctly halts A alone).
    // B has ZERO P&L today (perfectly healthy) but shares firmId='topstep'.
    state.sessions = [
      { id: "s-A", firmId: "topstep", config: { account_key: "topstep-A" }, symbol: "MES", dailyPnlBreakdown: { [TODAY]: -800 } },
      { id: "s-B", firmId: "topstep", config: { account_key: "topstep-B" }, symbol: "MNQ", dailyPnlBreakdown: { [TODAY]: 0 } },
    ];

    const pnlA = await getAccountSessionCumulativePnL("topstep-A", TODAY);
    const pnlB = await getAccountSessionCumulativePnL("topstep-B", TODAY);

    const resultA = evaluateCrossSymbolDll(pnlA, 1_000);
    const resultB = evaluateCrossSymbolDll(pnlB, 1_000);

    // A's own entry-check correctly halts (80% >= 67% halt threshold).
    expect(resultA.action).toBe("halt");

    // B's own entry-check is NOT contaminated by A's losses — B stays "none".
    // Pre-fix: both A's and B's checks queried the SAME "topstep" bucket
    // (combined -$800 = 80%), so B would have been incorrectly halted too.
    expect(pnlB.totalPnL).toBe(0);
    expect(resultB.action).toBe("none");
  });

  it("sessions without config.account_key (single-account-per-firm, the common case) are UNCHANGED", async () => {
    // No account_key set anywhere — resolves to firmId, matching pre-fix behavior
    // exactly for operators who have not opted into multi-account scoping.
    state.sessions = [
      { id: "s-1", firmId: "mffu", config: null, symbol: "MES", dailyPnlBreakdown: { [TODAY]: -300 } },
      { id: "s-2", firmId: "mffu", config: null, symbol: "MNQ", dailyPnlBreakdown: { [TODAY]: -100 } },
    ];

    const result = await getAccountSessionCumulativePnL("mffu", TODAY);
    expect(result.realizedPnL).toBe(-400); // still netted — single account, correct
  });

  it("escalation ordering preserved per account: force_close(95%) > halt(67%) > reduce_size(60%) > none", async () => {
    const mk = (key: string, loss: number): Record<string, unknown> => ({
      id: `s-${key}`, firmId: "topstep", config: { account_key: key }, symbol: "MES",
      dailyPnlBreakdown: { [TODAY]: -loss },
    });
    state.sessions = [mk("acct-force", 950), mk("acct-halt", 670), mk("acct-reduce", 600), mk("acct-none", 590)];

    const pnlForce = await getAccountSessionCumulativePnL("acct-force", TODAY);
    const pnlHalt = await getAccountSessionCumulativePnL("acct-halt", TODAY);
    const pnlReduce = await getAccountSessionCumulativePnL("acct-reduce", TODAY);
    const pnlNone = await getAccountSessionCumulativePnL("acct-none", TODAY);

    expect(evaluateCrossSymbolDll(pnlForce, 1_000).action).toBe("force_close");
    expect(evaluateCrossSymbolDll(pnlHalt, 1_000).action).toBe("halt");
    expect(evaluateCrossSymbolDll(pnlReduce, 1_000).action).toBe("reduce_size");
    expect(evaluateCrossSymbolDll(pnlNone, 1_000).action).toBe("none");
  });

  it("open MTM positions are ALSO scoped by resolved account key (not just realized P&L)", async () => {
    state.sessions = [];
    state.positions = [
      { symbol: "MES", unrealizedPnl: "-700", sessionFirmId: "topstep", sessionConfig: { account_key: "topstep-A" } },
      { symbol: "MNQ", unrealizedPnl: "300", sessionFirmId: "topstep", sessionConfig: { account_key: "topstep-B" } },
    ];

    const pnlA = await getAccountSessionCumulativePnL("topstep-A", TODAY);
    const pnlB = await getAccountSessionCumulativePnL("topstep-B", TODAY);

    expect(pnlA.openPnLMtm).toBe(-700);
    expect(pnlB.openPnLMtm).toBe(300);
  });

  it("fail-open contract preserved: DB error returns zero-valued result keyed by the requested account", async () => {
    const { db } = await import("../db/index.js");
    vi.mocked(db.select).mockImplementationOnce(() => {
      throw new Error("db down");
    });

    const result = await getAccountSessionCumulativePnL("topstep-A", TODAY);
    expect(result.totalPnL).toBe(0);
    expect(result.firmId).toBe("topstep-A");
  });
});
