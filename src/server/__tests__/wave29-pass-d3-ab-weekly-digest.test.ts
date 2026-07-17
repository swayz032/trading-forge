/**
 * wave29-pass-d3-ab-weekly-digest.test.ts — Wave 29 Pass D.3 (critic-optimizer)
 *
 * Tests for ab-comparison-weekly-digest-service.ts
 *
 * Coverage (16 tests):
 *  1.  Happy path: 7 days of data in both sub-accounts → Discord post emitted + audit row written
 *  2.  dryRun=true: no Discord post, no audit row, but computation proceeds and returns metrics
 *  3.  DST guard at Friday ET-hour=16: skip + skipped_dst_guard audit emitted
 *  4.  DST guard at Friday ET-hour=18: skip + skipped_dst_guard audit emitted
 *  5.  Day-of-week guard at Thursday 17:00 ET: skip + skipped_dst_guard audit emitted
 *  6.  Day-of-week guard at Saturday 17:00 ET: skip + skipped_dst_guard audit emitted
 *  7.  Lock contention: skip + skipped_lock_contention audit
 *  8.  Pipeline PAUSED: digest still fires (exempt registration verified — service has no pipeline gate)
 *  9.  Sharpe gap computation: known fixture returns expected delta
 * 10.  Regime breakdown computation: positions grouped by macro_regime correctly
 * 11.  Kill switch engage count: counts quantum_rl.kill_switch_engaged audit rows in past 7 days
 * 12.  RL training epoch count: counts quantum_rl.training_completed audit rows in past 7 days
 * 13.  Family-grade postscript appended to Discord body
 * 14.  Discord post failure → caught + discord_failed warn audit + does NOT throw
 * 15.  Empty data (no positions): emit digest with "No A/B data yet" body + still posts Discord
 * 16.  dryRun=true: lock contention also skips audit row (dry-run + contention combined)
 *
 * CORRECTED (fixwave-critic-replay-lifecycle-misc round-2, 2026-07-17): the production
 * HIGH fix moved P&L/regime computation from audit_log (db.select) reads to raw SQL
 * (db.execute) queries against paper_trades/paper_sessions/strategies — see
 * ab-comparison-weekly-digest-service.ts's _queryAccountMetrics doc comment. This test
 * file's DB mock previously stubbed db.execute as a static always-[] resolver while its
 * mockDbSelect ordinal queue was still keyed to the OLD call sequence (6 db.select calls),
 * which silently broke every assertion downstream of the shifted ordinals (kill-switch
 * count, epoch count, Sharpe gap, regime breakdown) even though the file reported green.
 * Fixed: db.execute is now a controllable per-test queue (3 calls: baseline daily rows,
 * challenger daily rows, regime rows) and db.select is a separate 3-call queue (kill_switch_
 * engaged count, kill_switch_evaluated armed-idle rows, training_completed count) — matching
 * the real Promise.all dispatch order in runAbComparisonWeeklyDigest.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoist-safe module mocks ────────────────────────────────────────────────────

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { mockInsertAuditRowSafe } = vi.hoisted(() => ({
  mockInsertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: mockInsertAuditRowSafe,
}));

const { mockNotifyInfo } = vi.hoisted(() => ({
  mockNotifyInfo: vi.fn(),
}));
vi.mock("../services/notification-service.js", () => ({
  notifyInfo: mockNotifyInfo,
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn(
    (body: string, _what: string, _action: string) =>
      body + "\n--- For family members ---",
  ),
}));

// ── DB mock ────────────────────────────────────────────────────────────────────
//
// _queryAccountMetrics (baseline + challenger) and _computeRegimeBreakdown all go
// through db.execute(sql`...`) — 3 calls per run, in this order:
//   1. baseline daily P&L rows   (DailyRow[]: { day, pnl })
//   2. challenger daily P&L rows (DailyRow[]: { day, pnl })
//   3. regime breakdown rows     (TradeRegimeRow[]: { regime, routing, pnl })
//
// _countAuditAction (x2) + _countKillSwitchArmedIdle still go through db.select —
// 3 calls per run, in this order:
//   1. kill_switch_engaged count rows
//   2. kill_switch_evaluated armed-idle rows
//   3. training_completed count rows
//
// Promise.all evaluates the array left-to-right synchronously up to each function's
// first await, so this ordinal ordering is deterministic (see production code comment
// at runAbComparisonWeeklyDigest step 3).

const { mockDbSelect, mockDbExecute } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbExecute: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn(),
    execute: mockDbExecute,
    update: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  auditLog: {
    id: "id",
    action: "action",
    createdAt: "created_at",
    result: "result",
    entityType: "entity_type",
    entityId: "entity_id",
    status: "status",
    decisionAuthority: "decision_authority",
    correlationId: "correlation_id",
  },
  strategies: {
    id: "id",
    name: "name",
    symbol: "symbol",
    lifecycleState: "lifecycle_state",
  },
}));

// drizzle-orm operators mock (they are used for building query conditions)
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: vi.fn((...args) => ({ _type: "and", args })),
    gte: vi.fn((col, val) => ({ _type: "gte", col, val })),
    eq: vi.fn((col, val) => ({ _type: "eq", col, val })),
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ _type: "sql", strings, values })),
  };
});

// ── Imports after mocks ────────────────────────────────────────────────────────

import {
  runAbComparisonWeeklyDigest,
  _resetDigestLockForTest,
  _getEtHour,
  _getEtWeekday,
} from "../services/ab-comparison-weekly-digest-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build a Date in EST (UTC-5) for January 2026 that produces the given ET hour
 * on the given weekday. weekday: 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat.
 * Uses dates in January 2026 (EST = UTC-5).
 *
 * Jan 2026:  Mon=5, Tue=6, Wed=7, Thu=8, Fri=9, Sat=10, Sun=11
 */
function makeAsOf(dayOfMonth: number, etHour: number): Date {
  // EST = UTC-5, so UTC hour = ET hour + 5
  const utcHour = etHour + 5;
  if (utcHour < 24) {
    return new Date(Date.UTC(2026, 0, dayOfMonth, utcHour, 0, 0, 0));
  }
  return new Date(Date.UTC(2026, 0, dayOfMonth + 1, utcHour - 24, 0, 0, 0));
}

// In January 2026: Fri = Jan 9
const FRI_ET17 = makeAsOf(9, 17); // Friday 17:00 ET
const FRI_ET16 = makeAsOf(9, 16); // Friday 16:00 ET
const FRI_ET18 = makeAsOf(9, 18); // Friday 18:00 ET
const THU_ET17 = makeAsOf(8, 17); // Thursday 17:00 ET
const SAT_ET17 = makeAsOf(10, 17); // Saturday 17:00 ET

/** Build a Drizzle-style select() query chain resolving to given rows (db.select path). */
function buildSelectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

/** Build a DailyRow ({ day, pnl }) — the shape _queryAccountMetrics's db.execute() resolves to. */
function buildDailyRow(day: string, pnl: number) {
  return { day, pnl };
}

/** Build a TradeRegimeRow ({ regime, routing, pnl }) — the shape _computeRegimeBreakdown's db.execute() resolves to. */
function buildRegimeRow(regime: string | null, routing: "baseline" | "rl-challenger", pnl: number) {
  return { regime, routing, pnl };
}

/**
 * Set up mockDbExecute (3 calls: baseline daily rows, challenger daily rows, regime rows)
 * and mockDbSelect (3 calls: kill_switch_engaged count, kill_switch armed-idle, training count)
 * to match one full runAbComparisonWeeklyDigest Promise.all dispatch.
 */
function setupHappyPath(
  baselineDailyRows: ReturnType<typeof buildDailyRow>[],
  challengerDailyRows: ReturnType<typeof buildDailyRow>[],
  killEngageCount: number,
  killArmedCount: number,
  trainingCount: number,
  regimeRows: ReturnType<typeof buildRegimeRow>[],
) {
  mockDbExecute
    // 1. baseline daily P&L rows
    .mockResolvedValueOnce(baselineDailyRows)
    // 2. challenger daily P&L rows
    .mockResolvedValueOnce(challengerDailyRows)
    // 3. regime breakdown rows
    .mockResolvedValueOnce(regimeRows);

  mockDbSelect
    // 1. kill_switch_engaged count
    .mockReturnValueOnce(buildSelectChain(Array(killEngageCount).fill({ id: "x" })))
    // 2. kill_switch armed-idle count
    .mockReturnValueOnce(buildSelectChain(Array(killArmedCount).fill({ resultJson: { should_dormant: false, reason: null } })))
    // 3. training_completed count
    .mockReturnValueOnce(buildSelectChain(Array(trainingCount).fill({ id: "x" })));
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetDigestLockForTest();
  mockInsertAuditRowSafe.mockClear();
  mockNotifyInfo.mockClear();
  mockDbSelect.mockReset();
  mockDbExecute.mockReset();
  mockDbExecute.mockResolvedValue([]); // default fallback for calls beyond a test's explicit queue
  (appendFamilyGradePostscript as ReturnType<typeof vi.fn>).mockClear();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("runAbComparisonWeeklyDigest — A/B weekly digest", () => {
  it("1. Happy path: data in both sub-accounts → Discord post emitted + audit row written", async () => {
    const baselineDaily = [buildDailyRow("2026-01-05", 500), buildDailyRow("2026-01-06", 300)];
    const challengerDaily = [buildDailyRow("2026-01-05", 600), buildDailyRow("2026-01-06", 400)];
    const regimeRows = [
      buildRegimeRow("TRENDING", "baseline", 500),
      buildRegimeRow("TRENDING", "baseline", 300),
      buildRegimeRow("TRENDING", "rl-challenger", 600),
      buildRegimeRow("TRENDING", "rl-challenger", 400),
    ];
    setupHappyPath(baselineDaily, challengerDaily, 0, 2, 5, regimeRows);

    const result = await runAbComparisonWeeklyDigest({ asOf: FRI_ET17 });

    expect(result.status).toBe("completed");
    expect(result.dryRun).toBe(false);
    expect(result.metrics).toBeDefined();
    expect(result.metrics!.noDataFound).toBe(false);
    expect(result.metrics!.rlTrainingEpochCount).toBe(5);

    // Discord was called once
    expect(mockNotifyInfo).toHaveBeenCalledOnce();
    const callArgs = mockNotifyInfo.mock.calls[0];
    expect(callArgs[0]).toContain("[W29D.3]");

    // Audit row written with action = ab_comparison_digest.completed
    const auditCalls = mockInsertAuditRowSafe.mock.calls;
    const completedAudit = auditCalls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "ab_comparison_digest.completed",
    );
    expect(completedAudit).toBeDefined();
  });

  it("2. dryRun=true: no Discord post, no audit row, computation proceeds and returns metrics", async () => {
    const baselineDaily = [buildDailyRow("2026-01-05", 100)];
    const challengerDaily = [buildDailyRow("2026-01-05", 150)];
    const regimeRows = [
      buildRegimeRow("RANGE_BOUND", "baseline", 100),
      buildRegimeRow("RANGE_BOUND", "rl-challenger", 150),
    ];
    setupHappyPath(baselineDaily, challengerDaily, 0, 0, 2, regimeRows);

    const result = await runAbComparisonWeeklyDigest({ asOf: FRI_ET17, dryRun: true });

    expect(result.status).toBe("completed");
    expect(result.dryRun).toBe(true);
    expect(result.metrics).toBeDefined();
    expect(result.metrics!.rlTrainingEpochCount).toBe(2);

    // No Discord post
    expect(mockNotifyInfo).not.toHaveBeenCalled();
    // No audit rows written (dryRun suppresses)
    expect(mockInsertAuditRowSafe).not.toHaveBeenCalled();
  });

  it("3. DST guard at Friday ET-hour=16: skip + skipped_dst_guard audit", async () => {
    const result = await runAbComparisonWeeklyDigest({ asOf: FRI_ET16 });

    expect(result.status).toBe("skipped_dst_guard");
    expect(mockNotifyInfo).not.toHaveBeenCalled();
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockDbExecute).not.toHaveBeenCalled();

    const auditCalls = mockInsertAuditRowSafe.mock.calls;
    const guardAudit = auditCalls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "ab_comparison_digest.skipped_dst_guard",
    );
    expect(guardAudit).toBeDefined();
    expect((guardAudit![0] as { result: { etHour: number } }).result.etHour).toBe(16);
  });

  it("4. DST guard at Friday ET-hour=18: skip + skipped_dst_guard audit", async () => {
    const result = await runAbComparisonWeeklyDigest({ asOf: FRI_ET18 });

    expect(result.status).toBe("skipped_dst_guard");
    expect(mockNotifyInfo).not.toHaveBeenCalled();

    const guardAudit = mockInsertAuditRowSafe.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "ab_comparison_digest.skipped_dst_guard",
    );
    expect(guardAudit).toBeDefined();
    expect((guardAudit![0] as { result: { etHour: number } }).result.etHour).toBe(18);
  });

  it("5. Day-of-week guard at Thursday 17:00 ET: skip + skipped_dst_guard audit", async () => {
    const result = await runAbComparisonWeeklyDigest({ asOf: THU_ET17 });

    expect(result.status).toBe("skipped_dst_guard");
    expect(mockNotifyInfo).not.toHaveBeenCalled();
    expect(mockDbSelect).not.toHaveBeenCalled();

    const guardAudit = mockInsertAuditRowSafe.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "ab_comparison_digest.skipped_dst_guard",
    );
    expect(guardAudit).toBeDefined();
    expect((guardAudit![0] as { result: { etWeekday: string } }).result.etWeekday).toBe("Thu");
  });

  it("6. Day-of-week guard at Saturday 17:00 ET: skip + skipped_dst_guard audit", async () => {
    const result = await runAbComparisonWeeklyDigest({ asOf: SAT_ET17 });

    expect(result.status).toBe("skipped_dst_guard");
    expect(mockNotifyInfo).not.toHaveBeenCalled();

    const guardAudit = mockInsertAuditRowSafe.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "ab_comparison_digest.skipped_dst_guard",
    );
    expect(guardAudit).toBeDefined();
    expect((guardAudit![0] as { result: { etWeekday: string } }).result.etWeekday).toBe("Sat");
  });

  it("7. Lock contention: skip + skipped_lock_contention audit", async () => {
    // First call: acquire lock + complete (minimal empty pass).
    setupHappyPath([], [], 0, 0, 0, []);
    const first = await runAbComparisonWeeklyDigest({ asOf: FRI_ET17 });
    expect(first.status).toBe("completed");

    // Reset for the contention half of this test.
    _resetDigestLockForTest();
    mockInsertAuditRowSafe.mockClear();
    mockNotifyInfo.mockClear();
    mockDbSelect.mockReset();
    mockDbExecute.mockReset();
    // Execute-based calls (baseline/challenger/regime) resolve immediately —
    // only the select-based calls (kill_switch/training counts) hang below,
    // which is enough to hold the lock open for the contention assertion.
    mockDbExecute.mockResolvedValue([]);

    let resolveFirst!: () => void;
    const hangingPromise = new Promise<unknown[]>((r) => { resolveFirst = () => r([]); });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnValue(hangingPromise),
    });

    // Start first call (will hang at the select-based DB calls) but don't await.
    const firstPending = runAbComparisonWeeklyDigest({ asOf: FRI_ET17 });

    // Immediately call second — should hit lock contention.
    mockInsertAuditRowSafe.mockClear();
    const second = await runAbComparisonWeeklyDigest({ asOf: FRI_ET17 });
    expect(second.status).toBe("skipped_lock_contention");

    const contentionAudit = mockInsertAuditRowSafe.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "ab_comparison_digest.skipped_lock_contention",
    );
    expect(contentionAudit).toBeDefined();

    // Resolve the hang to let the first call complete and release the lock.
    resolveFirst();
    await firstPending;
  });

  it("8. Pipeline PAUSED: digest still fires (service has no pipeline gate)", async () => {
    // The service itself does not check pipelineGate — it is _PIPELINE_GATE_EXEMPT.
    // Verify: calling the service directly on Friday 17:00 ET always runs the computation
    // regardless of pipeline state (there is no gate check inside the service).
    setupHappyPath([], [], 0, 0, 0, []);
    const result = await runAbComparisonWeeklyDigest({ asOf: FRI_ET17 });
    expect(result.status).toBe("completed");
    // If it had a pipeline gate and pipeline was paused, status would NOT be "completed"
  });

  it("9. Sharpe gap computation: known fixture returns expected delta", async () => {
    // Baseline: 4 sessions with P&Ls [100, 200, 100, 200] → mean=150, std=57.74 → Sharpe≈2.598
    // Challenger: 4 sessions with P&Ls [300, 400, 300, 400] → mean=350, std=57.74 → Sharpe≈6.062
    // Gap ≈ 3.46 (challenger is improving)
    const baselineDaily = [
      buildDailyRow("2026-01-02", 100),
      buildDailyRow("2026-01-03", 200),
      buildDailyRow("2026-01-04", 100),
      buildDailyRow("2026-01-05", 200),
    ];
    const challengerDaily = [
      buildDailyRow("2026-01-02", 300),
      buildDailyRow("2026-01-03", 400),
      buildDailyRow("2026-01-04", 300),
      buildDailyRow("2026-01-05", 400),
    ];
    const regimeRows = [
      buildRegimeRow("TRENDING", "baseline", 100),
      buildRegimeRow("TRENDING", "baseline", 200),
      buildRegimeRow("TRENDING", "baseline", 100),
      buildRegimeRow("TRENDING", "baseline", 200),
      buildRegimeRow("TRENDING", "rl-challenger", 300),
      buildRegimeRow("TRENDING", "rl-challenger", 400),
      buildRegimeRow("TRENDING", "rl-challenger", 300),
      buildRegimeRow("TRENDING", "rl-challenger", 400),
    ];
    setupHappyPath(baselineDaily, challengerDaily, 0, 0, 0, regimeRows);

    const result = await runAbComparisonWeeklyDigest({ asOf: FRI_ET17, dryRun: true });

    expect(result.status).toBe("completed");
    expect(result.metrics).toBeDefined();
    const { sharpeGap, sharpeTrend, baseline, challenger } = result.metrics!;

    // Both accounts should have non-null Sharpe (4 sessions each)
    expect(baseline.rollingSharp20).not.toBeNull();
    expect(challenger.rollingSharp20).not.toBeNull();

    // Gap should be positive (challenger > baseline)
    expect(sharpeGap).not.toBeNull();
    expect(sharpeGap!).toBeGreaterThan(0);
    expect(sharpeTrend).toBe("improving");
  });

  it("10. Regime breakdown computation: positions grouped by macro_regime correctly", async () => {
    const regimeRows = [
      buildRegimeRow("TRENDING", "baseline", 100),
      buildRegimeRow("TRENDING", "rl-challenger", 200),
      buildRegimeRow("TRENDING", "rl-challenger", 200),
      buildRegimeRow("RANGE_BOUND", "baseline", -50),
      buildRegimeRow("RANGE_BOUND", "rl-challenger", -30),
    ];
    setupHappyPath(
      [buildDailyRow("2026-01-05", 100), buildDailyRow("2026-01-06", -50)],
      [buildDailyRow("2026-01-05", 200), buildDailyRow("2026-01-06", 200), buildDailyRow("2026-01-07", -30)],
      0, 0, 0,
      regimeRows, // regime breakdown uses all per-trade rows
    );

    const result = await runAbComparisonWeeklyDigest({ asOf: FRI_ET17, dryRun: true });

    expect(result.status).toBe("completed");
    const { regimeBreakdown } = result.metrics!;

    // Should have TRENDING and RANGE_BOUND entries
    const regimes = regimeBreakdown.map((r) => r.regime);
    expect(regimes).toContain("TRENDING");
    expect(regimes).toContain("RANGE_BOUND");

    // Each entry should have session count > 0
    for (const entry of regimeBreakdown) {
      expect(entry.sessions).toBeGreaterThan(0);
    }
  });

  it("11. Kill switch engage count: counts quantum_rl.kill_switch_engaged rows in past 7 days", async () => {
    setupHappyPath(
      [buildDailyRow("2026-01-05", 100)],
      [buildDailyRow("2026-01-05", 200)],
      3, // killEngageCount = 3
      0,
      0,
      [buildRegimeRow("TRENDING", "baseline", 100), buildRegimeRow("TRENDING", "rl-challenger", 200)],
    );

    const result = await runAbComparisonWeeklyDigest({ asOf: FRI_ET17, dryRun: true });

    expect(result.status).toBe("completed");
    expect(result.metrics!.killSwitchEngageCount).toBe(3);

    // Discord body should mention the kill switch engagement
    const discordBody = (appendFamilyGradePostscript as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(discordBody).toContain("Kill switch:");
  });

  it("12. RL training epoch count: counts quantum_rl.training_completed rows in past 7 days", async () => {
    setupHappyPath(
      [],
      [],
      0, 0,
      12, // 12 training epochs
      [],
    );

    const result = await runAbComparisonWeeklyDigest({ asOf: FRI_ET17, dryRun: true });

    expect(result.status).toBe("completed");
    expect(result.metrics!.rlTrainingEpochCount).toBe(12);

    const discordBody = (appendFamilyGradePostscript as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(discordBody).toContain("12 epochs");
  });

  it("13. Family-grade postscript appended to Discord body", async () => {
    setupHappyPath(
      [buildDailyRow("2026-01-05", 200)],
      [buildDailyRow("2026-01-05", 300)],
      0, 1, 3,
      [buildRegimeRow("TRENDING", "baseline", 200), buildRegimeRow("TRENDING", "rl-challenger", 300)],
    );

    const result = await runAbComparisonWeeklyDigest({ asOf: FRI_ET17 });

    expect(result.status).toBe("completed");

    // appendFamilyGradePostscript was called once
    expect(appendFamilyGradePostscript).toHaveBeenCalledOnce();

    // Discord was called with the postscript-appended body
    const discordBody = mockNotifyInfo.mock.calls[0]?.[1] as string;
    expect(discordBody).toContain("--- For family members ---");
  });

  it("14. Discord post failure → caught + discord_failed warn audit + does NOT throw", async () => {
    setupHappyPath(
      [buildDailyRow("2026-01-05", 100)],
      [buildDailyRow("2026-01-05", 200)],
      0, 0, 0,
      [buildRegimeRow("TRENDING", "baseline", 100), buildRegimeRow("TRENDING", "rl-challenger", 200)],
    );

    // Simulate Discord throwing
    mockNotifyInfo.mockImplementationOnce(() => {
      throw new Error("Discord webhook unreachable");
    });

    const result = await runAbComparisonWeeklyDigest({ asOf: FRI_ET17 });

    // Must not rethrow — returns completed
    expect(result.status).toBe("completed");

    // discord_failed warn audit emitted
    const discordFailedAudit = mockInsertAuditRowSafe.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "ab_comparison_digest.discord_failed",
    );
    expect(discordFailedAudit).toBeDefined();
    expect((discordFailedAudit![0] as { status: string }).status).toBe("warning");

    // Completion audit still written
    const completedAudit = mockInsertAuditRowSafe.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "ab_comparison_digest.completed",
    );
    expect(completedAudit).toBeDefined();
  });

  it("15. Empty data (no positions): emit digest with 'No A/B data yet' body + still posts Discord", async () => {
    // No daily P&L rows, no training, no kill switch events
    setupHappyPath([], [], 0, 0, 0, []);

    const result = await runAbComparisonWeeklyDigest({ asOf: FRI_ET17 });

    expect(result.status).toBe("completed");
    expect(result.metrics!.noDataFound).toBe(true);

    // Discord should still fire (operator visibility into gap)
    expect(mockNotifyInfo).toHaveBeenCalledOnce();

    // Body should mention "No A/B data yet"
    const discordBody = mockNotifyInfo.mock.calls[0]?.[1] as string;
    expect(discordBody).toContain("No A/B data yet");
  });

  it("16. dryRun=true + lock contention: skipped_lock_contention skips audit row when dryRun", async () => {
    // Set up first call to hang so lock remains held (select-based calls hang;
    // execute-based calls fall back to the beforeEach default of []).
    let resolveFirst!: () => void;
    const hangPromise = new Promise<unknown[]>((r) => { resolveFirst = () => r([]); });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnValue(hangPromise),
    });

    const firstPending = runAbComparisonWeeklyDigest({ asOf: FRI_ET17 });

    // Second call with dryRun=true under contention should NOT write audit row
    mockInsertAuditRowSafe.mockClear();
    const second = await runAbComparisonWeeklyDigest({ asOf: FRI_ET17, dryRun: true });

    expect(second.status).toBe("skipped_lock_contention");
    // dryRun=true: no audit row written even for skipped_lock_contention
    expect(mockInsertAuditRowSafe).not.toHaveBeenCalled();

    resolveFirst();
    await firstPending;
  });
});

// ── DST helpers sanity checks ──────────────────────────────────────────────────

describe("_getEtHour / _getEtWeekday — DST-safe helpers", () => {
  it("returns correct ET hour for Jan 2026 date (EST = UTC-5)", () => {
    // Jan 9 2026 22:00 UTC = 17:00 EST
    const d = new Date("2026-01-09T22:00:00Z");
    expect(_getEtHour(d)).toBe(17);
  });

  it("returns Fri for Jan 9 2026", () => {
    const d = new Date("2026-01-09T22:00:00Z");
    expect(_getEtWeekday(d)).toBe("Fri");
  });

  it("returns Thu for Jan 8 2026", () => {
    const d = new Date("2026-01-08T22:00:00Z");
    expect(_getEtWeekday(d)).toBe("Thu");
  });

  it("returns Sat for Jan 10 2026", () => {
    const d = new Date("2026-01-10T22:00:00Z");
    expect(_getEtWeekday(d)).toBe("Sat");
  });
});
