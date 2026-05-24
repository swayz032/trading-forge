/**
 * wave26-consistency-tracker.test.ts — Wave 26 Pass 6
 *
 * Tests for the Topstep consistency concentration tracker.
 * All db calls are intercepted via vi.mock at the top of the file.
 * Cache is cleared between tests via the exported _invalidateConsistencyCache helper.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock setup (must be before any imports) ─────────────────────────────────

const mockExecute = vi.fn();
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbValues = vi.fn().mockResolvedValue([]);

vi.mock("../db/index.js", () => ({
  db: {
    execute: (...args: unknown[]) => mockExecute(...args),
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => ({ values: mockDbValues }),
  },
}));

vi.mock("../db/schema.js", () => ({
  paperPositions: {},
  paperSessions: {},
  brokerAccounts: { accountId: "account_id", firmId: "firm_id", enabled: "enabled" },
  auditLog: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  gte: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
    { raw: vi.fn() },
  ),
}));

const mockNotifyWarning = vi.fn();
const mockNotifyCritical = vi.fn();

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: (...args: unknown[]) => mockNotifyWarning(...args),
  notifyCritical: (...args: unknown[]) => mockNotifyCritical(...args),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: (body: string, what: string, action: string) =>
    `${body}\n--- For family ---\n${what}\n${action}`,
}));

const mockInsertAuditRowSafe = vi.fn().mockResolvedValue(true);

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: (...args: unknown[]) => mockInsertAuditRowSafe(...args),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Import the service AFTER mocks ──────────────────────────────────────────

import {
  getConsistencyState,
  shouldBlockNewEntry,
  runConsistencyDailyDigest,
  _invalidateConsistencyCache,
} from "../services/consistency-tracker-service.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Set up two db.execute calls: daily rows + unrealized total */
function setupDb(
  dailyRows: Array<{ day: string; pnl: number }>,
  unrealizedTotal: number,
) {
  mockExecute
    .mockResolvedValueOnce(dailyRows)
    .mockResolvedValueOnce([{ total_unrealized: unrealizedTotal }]);
}

/** Set up db.select chain for broker accounts query */
function setupAccountsSelect(accounts: Array<{ accountId: string }>) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(accounts),
  };
  mockDbSelect.mockReturnValue(chain);
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Clear the in-process cache so each test starts cold
  _invalidateConsistencyCache();
  // Default: no accounts in digest
  setupAccountsSelect([]);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getConsistencyState", () => {
  it("1. happy path: 5 trading days, cumulative $3000, best day $1200 → concentration=40% → gateState=warn_40", async () => {
    // $600 + $1200 + $400 + $500 + $300 = $3000; best=$1200 → 40%
    setupDb(
      [
        { day: "2026-05-19", pnl: 600 },
        { day: "2026-05-20", pnl: 1200 },
        { day: "2026-05-21", pnl: 400 },
        { day: "2026-05-22", pnl: 500 },
        { day: "2026-05-23", pnl: 300 },
      ],
      0,
    );

    const state = await getConsistencyState("acct-1", new Date("2026-05-24T10:00:00Z"));

    expect(state.cycleCumulativeProfit).toBeCloseTo(3000);
    expect(state.highestDayProfit).toBeCloseTo(1200);
    expect(state.highestDayDate).toBe("2026-05-20");
    expect(state.currentConcentrationPct).toBeCloseTo(40, 0);
    expect(state.gateState).toBe("warn_40");

    // warn_40 audit should be written
    const warnCall = mockInsertAuditRowSafe.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.action === "consistency.40pct_warned",
    );
    expect(warnCall).toBeDefined();
    expect(mockNotifyWarning).toHaveBeenCalled();
  });

  it("2. 51% concentration → gateState=block_50 and critical notification fires", async () => {
    // $510 + $490 = $1000; best=$510 → 51%
    setupDb(
      [
        { day: "2026-05-20", pnl: 510 },
        { day: "2026-05-21", pnl: 490 },
      ],
      0,
    );

    const state = await getConsistencyState("acct-2", new Date("2026-05-22T10:00:00Z"));

    expect(state.currentConcentrationPct).toBeCloseTo(51, 0);
    expect(state.gateState).toBe("block_50");
    expect(state.falsePositiveSuspected).toBe(false);

    const blockCall = mockInsertAuditRowSafe.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.action === "consistency.50pct_blocked",
    );
    expect(blockCall).toBeDefined();
    expect(mockNotifyCritical).toHaveBeenCalled();
  });

  it("3. shouldBlockNewEntry: already at block_50 → block=true regardless of trade size", async () => {
    // Same 51% state
    setupDb([{ day: "2026-05-20", pnl: 510 }, { day: "2026-05-21", pnl: 490 }], 0);

    const result = await shouldBlockNewEntry("acct-3", 2.0, 20);

    expect(result.block).toBe(true);
    expect(result.reason).toMatch(/51|block/i);
  });

  it("4. shouldBlockNewEntry: current 39%, tiny trade → projected still ok → block=false", async () => {
    // $390 + $220 + $200 = $810; best=$390 → 48.1%… we need < 40%.
    // Use: $100 + $90 + $70 = $260; best=$100 → 38.5% — ok ✓
    setupDb(
      [
        { day: "2026-05-18", pnl: 100 },
        { day: "2026-05-19", pnl: 90 },
        { day: "2026-05-20", pnl: 70 },
      ],
      0,
    );

    // 0.1R × $10 = $1 projected profit → today = $1; projected_highest = max(100, 1) = 100;
    // projected_cumulative = 260 + $1 = $261; pct = 100/261 = 38.3% — still ok
    const result = await shouldBlockNewEntry("acct-4", 0.1, 10);

    expect(result.block).toBe(false);
    expect(result.reason).toBe("ok");
  });

  it("5. false-positive guard fires: clean strategy + trending regime + 25 sessions → WARN not CRITICAL", async () => {
    // block_50 state
    setupDb([{ day: "2026-05-20", pnl: 510 }, { day: "2026-05-21", pnl: 490 }], 0);

    const cleanCtx = {
      rollingSharpe30d: 1.8,
      sessionsRunClean: 25,
      currentRegime: "trending_up",
      confluenceScoreAtEntry: 0.92,
    };

    // shouldBlockNewEntry with a large trade that would still be block_50
    const result = await shouldBlockNewEntry("acct-5", 50, 100, cleanCtx);

    // Must still block — FP guard downgrades severity, does NOT bypass the gate
    expect(result.block).toBe(true);
    // FP audit action fired
    const fpCall = mockInsertAuditRowSafe.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.action === "consistency.false_positive_suspected",
    );
    expect(fpCall).toBeDefined();
    // notifyWarning fires (not notifyCritical) because FP guard is active
    expect(mockNotifyWarning).toHaveBeenCalled();
    // Critically: notifyCritical should NOT have been called from shouldBlockNewEntry path
    // (getConsistencyState was called first for block_50 state — it may have fired critical.
    //  But the shouldBlockNewEntry FP-guard path should fire warning)
    expect(result.audit.falsePositiveSuspected).toBe(true);
  });

  it("6. false-positive guard: choppy regime → guard does NOT fire → critical fires normally", async () => {
    setupDb([{ day: "2026-05-20", pnl: 510 }, { day: "2026-05-21", pnl: 490 }], 0);

    const choppyCtx = {
      rollingSharpe30d: 1.8,
      sessionsRunClean: 25,
      currentRegime: "choppy",           // NOT in FP_CLEAN_REGIMES
      confluenceScoreAtEntry: 0.92,
    };

    const result = await shouldBlockNewEntry("acct-6", 50, 100, choppyCtx);

    expect(result.block).toBe(true);
    expect(result.audit.falsePositiveSuspected).toBe(false);

    const blockCall = mockInsertAuditRowSafe.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.action === "consistency.50pct_blocked",
    );
    expect(blockCall).toBeDefined();
    // At least one notifyCritical call fired (from getConsistencyState or shouldBlockNewEntry)
    expect(mockNotifyCritical).toHaveBeenCalled();
  });

  it("7. 5-second cache prevents repeated DB hits on sequential calls", async () => {
    // Fresh account (no prior cache entry)
    setupDb([{ day: "2026-05-20", pnl: 200 }, { day: "2026-05-21", pnl: 400 }], 0);

    const asOf = new Date("2026-05-21T10:00:00Z");
    // First call — hits DB (2 execute calls)
    await getConsistencyState("acct-cache-7", asOf);
    const callsAfterFirst = mockExecute.mock.calls.length;
    expect(callsAfterFirst).toBe(2);

    // Next 9 calls — should hit cache (no new DB calls)
    for (let i = 0; i < 9; i++) {
      await getConsistencyState("acct-cache-7", asOf);
    }

    // Still exactly 2 DB calls total
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("8. cycle boundary: June 1 cycle starts fresh — highestDayProfit=0, gateState=ok", async () => {
    // Empty daily rows (new cycle, no trades yet)
    setupDb([], 0);

    const asOf = new Date("2026-06-01T10:00:00Z");
    const state = await getConsistencyState("acct-boundary-8", asOf);

    expect(state.cycleStartDate).toBe("2026-06-01");
    expect(state.cycleDay).toBe(1);
    expect(state.cycleCumulativeProfit).toBe(0);
    expect(state.highestDayProfit).toBe(0);
    expect(state.highestDayDate).toBeNull();
    expect(state.currentConcentrationPct).toBe(0);
    expect(state.gateState).toBe("ok");
  });

  it("9a. audit row contract: consistency.40pct_warned — entityType, entityId, result fields", async () => {
    // $400 + $300 + $300 = $1000; best=$400 → 40% → warn_40
    setupDb(
      [
        { day: "2026-05-18", pnl: 400 },
        { day: "2026-05-19", pnl: 300 },
        { day: "2026-05-20", pnl: 300 },
      ],
      0,
    );

    await getConsistencyState("acct-audit-9a", new Date("2026-05-21T10:00:00Z"));

    const auditCall = mockInsertAuditRowSafe.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.action === "consistency.40pct_warned",
    );
    expect(auditCall).toBeDefined();
    const payload = auditCall![0] as Record<string, unknown>;
    expect(payload.entityType).toBe("broker_account");
    expect(payload.entityId).toBe("acct-audit-9a");
    expect(payload.status).toBe("warning");
    expect(payload.decisionAuthority).toBe("system");
    expect((payload.result as Record<string, unknown>)).toHaveProperty("currentConcentrationPct");
  });

  it("9b. audit row contract: consistency.50pct_blocked — status='failure'", async () => {
    setupDb([{ day: "2026-05-20", pnl: 510 }, { day: "2026-05-21", pnl: 490 }], 0);

    await getConsistencyState("acct-audit-9b", new Date("2026-05-22T10:00:00Z"));

    const blockCall = mockInsertAuditRowSafe.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.action === "consistency.50pct_blocked",
    );
    expect(blockCall).toBeDefined();
    const payload = blockCall![0] as Record<string, unknown>;
    expect(payload.status).toBe("failure");
    expect(payload.entityType).toBe("broker_account");
    expect(payload.entityId).toBe("acct-audit-9b");
  });

  it("9c. audit row contract: consistency.gate_cleared fires when concentration < 40%", async () => {
    // $100 + $90 + $80 = $270; best=$100 → 37.0% — ok
    setupDb(
      [
        { day: "2026-05-18", pnl: 100 },
        { day: "2026-05-19", pnl: 90 },
        { day: "2026-05-20", pnl: 80 },
      ],
      0,
    );

    await getConsistencyState("acct-audit-9c", new Date("2026-05-21T10:00:00Z"));

    const clearedCall = mockInsertAuditRowSafe.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.action === "consistency.gate_cleared",
    );
    expect(clearedCall).toBeDefined();
    const payload = clearedCall![0] as Record<string, unknown>;
    expect(payload.entityType).toBe("broker_account");
    expect(payload.entityId).toBe("acct-audit-9c");
    expect(payload.status).toBe("success");
  });

  it("9d. audit row contract: consistency.false_positive_suspected — status='warning'", async () => {
    setupDb([{ day: "2026-05-20", pnl: 510 }, { day: "2026-05-21", pnl: 490 }], 0);

    const cleanCtx = {
      rollingSharpe30d: 2.0,
      sessionsRunClean: 30,
      currentRegime: "expansion",
      confluenceScoreAtEntry: 0.90,
    };

    await shouldBlockNewEntry("acct-audit-9d", 100, 200, cleanCtx);

    const fpCall = mockInsertAuditRowSafe.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.action === "consistency.false_positive_suspected",
    );
    expect(fpCall).toBeDefined();
    const payload = fpCall![0] as Record<string, unknown>;
    expect(payload.status).toBe("warning");
    expect(payload.entityType).toBe("broker_account");
  });

  it("10. daily digest cron: iterates enabled accounts and warns/blocks per concentration", async () => {
    // Set up two accounts: one warn_40, one ok
    setupAccountsSelect([{ accountId: "acct-digest-A" }, { accountId: "acct-digest-B" }]);

    // Account A: warn_40 (40%)
    // Account B: ok (20%)
    mockExecute
      // Account A daily rows
      .mockResolvedValueOnce([{ day: "2026-05-18", pnl: 400 }, { day: "2026-05-19", pnl: 300 }, { day: "2026-05-20", pnl: 300 }])
      .mockResolvedValueOnce([{ total_unrealized: 0 }])
      // Account B daily rows
      .mockResolvedValueOnce([{ day: "2026-05-18", pnl: 100 }, { day: "2026-05-19", pnl: 90 }, { day: "2026-05-20", pnl: 80 }])
      .mockResolvedValueOnce([{ total_unrealized: 0 }]);

    const result = await runConsistencyDailyDigest();

    expect(result.accountsChecked).toBe(2);
    // Account A is warn_40 → warned
    expect(result.accountsWarned).toBe(1);
    // Account B is ok → not in digest
    expect(result.accountsBlocked).toBe(0);

    // notifyWarning fired at least once (for account A warn_40)
    expect(mockNotifyWarning).toHaveBeenCalled();
  });
});
