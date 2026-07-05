/**
 * paper-risk-gate.account-scoped-loss.test.ts — deepscan #18 fix wave,
 * Track 1: Multi-Account Isolation, C-C2 (2026-07-05)
 *
 * checkRiskGate()'s gate (f) "global daily loss limit" previously summed
 * dailyPnlBreakdown[today] across EVERY active session system-wide and
 * compared the ONE sum to a single hardcoded $5,000 limit, regardless of
 * which account a session belonged to. Under multi-account scaling that
 * silently NETS independent accounts: Account A losing $3,000 + Account B
 * losing $3,000 = $6,000 combined -> BOTH accounts rejected even though
 * NEITHER individually breached $5,000.
 *
 * Fix: the aggregate is now scoped to the resolved account key (see
 * cross-symbol-pnl.ts::resolveAccountKey) of the session being gated — each
 * account measured against its OWN limit. A single-account operator (today)
 * sees byte-identical behavior since every active session resolves to the
 * SAME account key. An explicit opt-in (RISK_GATE_HOUSEHOLD_LOSS_SCOPE=true)
 * restores the old system-wide netting for an operator who deliberately
 * wants one combined household ceiling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db/index.js", () => ({
  db: { select: vi.fn() },
}));

vi.mock("../index.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/tracing.js", () => ({
  tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })) },
}));

// Firm config is mocked explicitly (rather than relying on the real
// shared/firm-config.ts) so this suite is independent of real-world firm-tier
// drift — dailyLossLimit=null cleanly skips gate (d), isolating gate (f)
// (the gate under test) as the only thing that can block these sessions.
vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn(() => ({ dailyLossLimit: null, maxDrawdown: 2000, overnightOk: true, maxContracts: 50 })),
  getTightestDrawdown: vi.fn(() => ({ firm: "topstep", maxDrawdown: 2000 })),
}));

import { db } from "../db/index.js";

async function makeTodayKey(): Promise<string> {
  const { toFuturesTradingDayString } = await import("./paper-risk-gate.js");
  return toFuturesTradingDayString();
}

function makeSessionRow(opts: {
  id: string;
  firmId: string;
  accountKey?: string;
  lossToday: number;
  todayKey: string;
  startingCapital?: number;
  currentEquity?: number;
  peakEquity?: number;
  realizedPeakEquity?: number;
}) {
  const {
    id, firmId, accountKey, lossToday, todayKey,
    startingCapital = 50_000, currentEquity = 50_000, peakEquity = 50_000, realizedPeakEquity = 50_000,
  } = opts;
  const dailyPnlBreakdown = lossToday > 0 ? { [todayKey]: -lossToday } : {};
  return {
    id, firmId,
    config: accountKey ? { account_key: accountKey, max_positions: 1 } : { max_positions: 1 },
    startingCapital, currentEquity, peakEquity, realizedPeakEquity,
    dailyPnlBreakdown,
    status: "active",
  };
}

/** Route db.select() by requested column shape (mirrors checkRiskGate's 3 distinct queries). */
function wireDbMock(targetSession: object, allActiveSessions: object[]) {
  // @ts-ignore — mock shape (partial Drizzle chain, not the full builder type)
  vi.mocked(db.select).mockImplementation((cols?: Record<string, unknown>) => {
    // openPositions query: { id: paperPositions.id } — exactly one key, "id".
    if (cols && Object.keys(cols).length === 1 && "id" in cols) {
      return { from: () => ({ where: () => Promise.resolve([]) }) };
    }
    // session-by-id lookup: db.select() with NO column projection.
    if (cols === undefined) {
      return {
        from: () => ({
          where: () => ({
            then: (fn: (rows: object[]) => unknown) => Promise.resolve(fn([targetSession])),
          }),
        }),
      };
    }
    // gate (f) active-sessions aggregate query: has dailyPnlBreakdown.
    if ("dailyPnlBreakdown" in cols) {
      return { from: () => ({ where: () => Promise.resolve(allActiveSessions) }) };
    }
    return { from: () => ({ where: () => Promise.resolve([]) }) };
  });
}

describe("deepscan18 C-C2: checkRiskGate daily-loss gate is account-scoped, not system-wide", () => {
  let todayKey: string;

  beforeEach(async () => {
    todayKey = await makeTodayKey();
    const { __resetDailyLossCacheForTests } = await import("./paper-risk-gate.js");
    __resetDailyLossCacheForTests();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const { __resetDailyLossCacheForTests } = await import("./paper-risk-gate.js");
    __resetDailyLossCacheForTests();
  });

  it("Account A ($3,000 loss) is ALLOWED even though Account B ALSO lost $3,000 (combined $6,000 > $5,000)", async () => {
    const sessionA = makeSessionRow({ id: "sess-A", firmId: "mffu", accountKey: "acct-A", lossToday: 3000, todayKey });
    const sessionB = makeSessionRow({ id: "sess-B", firmId: "mffu", accountKey: "acct-B", lossToday: 3000, todayKey });
    wireDbMock(sessionA, [sessionA, sessionB]);

    const { checkRiskGate } = await import("./paper-risk-gate.js");
    const result = await checkRiskGate("sess-A", "MES", 6);

    // Pre-fix, this would have been BLOCKED (3000+3000=6000 >= 5000 system-wide).
    // Post-fix, Account A's OWN scoped aggregate is 3000 < 5000 -> allowed.
    expect(result.check).not.toBe("global_daily_loss");
    expect(result.allowed).toBe(true);
  });

  it("Account B (the sibling) is ALSO allowed when gated independently — neither account sees the other's loss", async () => {
    const sessionA = makeSessionRow({ id: "sess-A", firmId: "mffu", accountKey: "acct-A", lossToday: 3000, todayKey });
    const sessionB = makeSessionRow({ id: "sess-B", firmId: "mffu", accountKey: "acct-B", lossToday: 3000, todayKey });
    wireDbMock(sessionB, [sessionA, sessionB]);

    const { checkRiskGate } = await import("./paper-risk-gate.js");
    const result = await checkRiskGate("sess-B", "MES", 6);

    expect(result.check).not.toBe("global_daily_loss");
    expect(result.allowed).toBe(true);
  });

  it("a single account WITH its own $5,500 combined loss across 2 sessions IS still blocked (per-account limit still enforced)", async () => {
    // Two sessions, SAME account_key "acct-A" — combined loss must still gate.
    const sessionA1 = makeSessionRow({ id: "sess-A1", firmId: "mffu", accountKey: "acct-A", lossToday: 3000, todayKey });
    const sessionA2 = makeSessionRow({ id: "sess-A2", firmId: "mffu", accountKey: "acct-A", lossToday: 2500, todayKey });
    wireDbMock(sessionA1, [sessionA1, sessionA2]);

    const { checkRiskGate } = await import("./paper-risk-gate.js");
    const result = await checkRiskGate("sess-A1", "MES", 6);

    expect(result.allowed).toBe(false);
    expect(result.check).toBe("global_daily_loss");
  });

  it("(regression) single-account-per-firm operator setup: 2 sessions, no account_key set anywhere, combined $5,500 loss still blocks — byte-identical to pre-fix", async () => {
    // No config.account_key on EITHER session -> both fall back to firmId
    // "mffu" -> SAME resolved account key -> aggregate == old system-wide sum.
    const session1 = makeSessionRow({ id: "sess-1", firmId: "mffu", lossToday: 3000, todayKey });
    const session2 = makeSessionRow({ id: "sess-2", firmId: "mffu", lossToday: 2500, todayKey });
    wireDbMock(session1, [session1, session2]);

    const { checkRiskGate } = await import("./paper-risk-gate.js");
    const result = await checkRiskGate("sess-1", "MES", 6);

    expect(result.allowed).toBe(false);
    expect(result.check).toBe("global_daily_loss");
    expect(result.reason).toMatch(/5000|\$5,000|mffu/i);
  });

  it("(regression) single account under $5,000 is allowed — byte-identical to pre-fix", async () => {
    const session1 = makeSessionRow({ id: "sess-1", firmId: "mffu", lossToday: 1500, todayKey });
    wireDbMock(session1, [session1]);

    const { checkRiskGate } = await import("./paper-risk-gate.js");
    const result = await checkRiskGate("sess-1", "MES", 6);

    expect(result.check).not.toBe("global_daily_loss");
  });
});

describe("deepscan18 C-C2: RISK_GATE_HOUSEHOLD_LOSS_SCOPE opt-in restores system-wide netting", () => {
  const ORIGINAL_ENV = process.env.RISK_GATE_HOUSEHOLD_LOSS_SCOPE;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.RISK_GATE_HOUSEHOLD_LOSS_SCOPE;
    else process.env.RISK_GATE_HOUSEHOLD_LOSS_SCOPE = ORIGINAL_ENV;
    vi.resetModules();
  });

  it("with the opt-in enabled, two independently-under-limit accounts combine into ONE household breach", async () => {
    process.env.RISK_GATE_HOUSEHOLD_LOSS_SCOPE = "true";
    vi.resetModules();

    const { checkRiskGate, __resetDailyLossCacheForTests, toFuturesTradingDayString } = await import("./paper-risk-gate.js");
    __resetDailyLossCacheForTests();
    const todayKey = toFuturesTradingDayString();

    const sessionA = makeSessionRow({ id: "sess-A", firmId: "mffu", accountKey: "acct-A", lossToday: 3000, todayKey });
    const sessionB = makeSessionRow({ id: "sess-B", firmId: "mffu", accountKey: "acct-B", lossToday: 3000, todayKey });
    wireDbMock(sessionA, [sessionA, sessionB]);

    const result = await checkRiskGate("sess-A", "MES", 6);

    // Explicit opt-in restores the pre-fix combined-household view: this is a
    // DELIBERATE operator choice, not a silent default.
    expect(result.allowed).toBe(false);
    expect(result.check).toBe("global_daily_loss");
    expect(result.reason).toMatch(/household/i);
  });
});
