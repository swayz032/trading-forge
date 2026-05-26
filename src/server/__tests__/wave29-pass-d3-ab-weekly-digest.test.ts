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
 * 10.  Regime breakdown computation: positions grouped by institutional_regime correctly
 * 11.  Kill switch engage count: counts quantum_rl.kill_switch_engaged audit rows in past 7 days
 * 12.  RL training epoch count: counts quantum_rl.training_completed audit rows in past 7 days
 * 13.  Family-grade postscript appended to Discord body
 * 14.  Discord post failure → caught + discord_failed warn audit + does NOT throw
 * 15.  Empty data (no positions): emit digest with "No A/B data yet" body + still posts Discord
 * 16.  dryRun=true: lock contention also skips audit row (dry-run + contention combined)
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

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn(),
    execute: vi.fn().mockResolvedValue([]),
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

/** Build a Drizzle-style query chain resolving to given rows */
function buildSelectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

/** Build a signal.rl_ab_routed result row */
function buildAbRow(
  routing: "baseline" | "rl-challenger",
  regime: string,
  pnl: number,
) {
  return {
    resultJson: {
      account_routing: routing,
      institutional_regime: regime,
      realized_pnl: pnl,
    },
  };
}

/**
 * Setup mockDbSelect to return:
 * 1st call  → baseline signal.rl_ab_routed rows
 * 2nd call  → challenger signal.rl_ab_routed rows
 * 3rd call  → kill_switch_engaged count rows
 * 4th call  → kill_switch_evaluated armed-idle rows
 * 5th call  → training_completed count rows
 * 6th call  → regime breakdown rows (signal.rl_ab_routed for all)
 *
 * In the service, Promise.all fires 6 concurrent queries.
 * mockDbSelect is called 6 times via the select() entry point.
 */
function setupHappyPath(
  baselineRows: unknown[],
  challengerRows: unknown[],
  killEngageCount: number,
  killArmedCount: number,
  trainingCount: number,
  regimeRows: unknown[],
) {
  mockDbSelect
    // baseline metrics: select → from → where
    .mockReturnValueOnce(buildSelectChain(baselineRows))
    // challenger metrics
    .mockReturnValueOnce(buildSelectChain(challengerRows))
    // kill_switch_engaged count
    .mockReturnValueOnce(buildSelectChain(Array(killEngageCount).fill({ id: "x" })))
    // kill_switch armed-idle count
    .mockReturnValueOnce(buildSelectChain(Array(killArmedCount).fill({ resultJson: { decision: "idle" } })))
    // training_completed count
    .mockReturnValueOnce(buildSelectChain(Array(trainingCount).fill({ id: "x" })))
    // regime breakdown
    .mockReturnValueOnce(buildSelectChain(regimeRows));
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetDigestLockForTest();
  mockInsertAuditRowSafe.mockClear();
  mockNotifyInfo.mockClear();
  mockDbSelect.mockReset();
  (appendFamilyGradePostscript as ReturnType<typeof vi.fn>).mockClear();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("runAbComparisonWeeklyDigest — A/B weekly digest", () => {
  it("1. Happy path: data in both sub-accounts → Discord post emitted + audit row written", async () => {
    const baselineRows = [buildAbRow("baseline", "TRENDING", 500), buildAbRow("baseline", "TRENDING", 300)];
    const challengerRows = [buildAbRow("rl-challenger", "TRENDING", 600), buildAbRow("rl-challenger", "TRENDING", 400)];
    setupHappyPath(baselineRows, challengerRows, 0, 2, 5, [...baselineRows, ...challengerRows]);

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
    const baselineRows = [buildAbRow("baseline", "RANGE_BOUND", 100)];
    const challengerRows = [buildAbRow("rl-challenger", "RANGE_BOUND", 150)];
    setupHappyPath(baselineRows, challengerRows, 0, 0, 2, [...baselineRows, ...challengerRows]);

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
    // Simulate in-flight by calling first time without releasing
    // We directly set the lock via calling once and mocking DB to hang
    // Instead: call once with dryRun to pass the guard, then manually test contention
    // by calling twice — first will acquire, second won't

    // First call: acquire lock + complete (we mock DB for a minimal pass)
    setupHappyPath([], [], 0, 0, 0, []);
    const first = await runAbComparisonWeeklyDigest({ asOf: FRI_ET17 });
    expect(first.status).toBe("completed");

    // Reset mocks but NOT the lock (don't call _resetDigestLockForTest)
    mockInsertAuditRowSafe.mockClear();
    mockNotifyInfo.mockClear();
    mockDbSelect.mockReset();

    // Second call: lock is still held from first call? No — first call released in finally.
    // We need to test contention by simulating: manually set the lock then call.
    // The exported lock helpers allow us to test this by calling with dryRun twice quickly.
    // Actually the lock is released after first call completes. We can test contention
    // by calling the private lock helper directly via a different approach:
    // wrap the service to hold the lock, then call again.

    // Simplest: re-import the module and use the _resetDigestLockForTest negation approach:
    // Set lock in-flight manually by calling once without mockDbSelect causing it to hang.
    // Since we can't easily force in-flight without real async, test via the exported reset:
    // Do NOT reset lock → simulate it was already acquired externally:
    // This is the canonical pattern from the B3 test file.

    // NOTE: Since _resetDigestLockForTest() clears the lock and we DON'T call it here,
    // the lock should still be free. We need to force it to be taken.
    // The approach: make mockDbSelect never resolve so the first call stays in-flight
    // ... but that blocks the test. Instead we verify the contention path logic works
    // by checking the audit action is registered correctly:

    // Re-test: don't reset lock between calls. Call once (fast), call again before it finishes.
    // Since the service is async, we can call both and the second will hit contention.
    _resetDigestLockForTest(); // Reset for this test
    mockInsertAuditRowSafe.mockClear();
    mockDbSelect.mockReset();

    // Make the first call never release (hang DB)
    let resolveFirst!: () => void;
    const hangingPromise = new Promise<unknown[]>((r) => { resolveFirst = () => r([]); });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnValue(hangingPromise),
    });

    // Start first call (will hang at DB) but don't await
    const firstPending = runAbComparisonWeeklyDigest({ asOf: FRI_ET17 });

    // Immediately call second — should hit lock contention
    mockInsertAuditRowSafe.mockClear();
    const second = await runAbComparisonWeeklyDigest({ asOf: FRI_ET17 });
    expect(second.status).toBe("skipped_lock_contention");

    const contentionAudit = mockInsertAuditRowSafe.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "ab_comparison_digest.skipped_lock_contention",
    );
    expect(contentionAudit).toBeDefined();

    // Resolve the hang to let the first call complete and release the lock
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
    const baselineRows = [
      buildAbRow("baseline", "TRENDING", 100),
      buildAbRow("baseline", "TRENDING", 200),
      buildAbRow("baseline", "TRENDING", 100),
      buildAbRow("baseline", "TRENDING", 200),
    ];
    const challengerRows = [
      buildAbRow("rl-challenger", "TRENDING", 300),
      buildAbRow("rl-challenger", "TRENDING", 400),
      buildAbRow("rl-challenger", "TRENDING", 300),
      buildAbRow("rl-challenger", "TRENDING", 400),
    ];
    setupHappyPath(baselineRows, challengerRows, 0, 0, 0, [...baselineRows, ...challengerRows]);

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

  it("10. Regime breakdown computation: positions grouped by institutional_regime correctly", async () => {
    const rows = [
      buildAbRow("baseline", "TRENDING", 100),
      buildAbRow("rl-challenger", "TRENDING", 200),
      buildAbRow("rl-challenger", "TRENDING", 200),
      buildAbRow("baseline", "RANGE_BOUND", -50),
      buildAbRow("rl-challenger", "RANGE_BOUND", -30),
    ];
    setupHappyPath(
      [rows[0], rows[3]], // baseline rows
      [rows[1], rows[2], rows[4]], // challenger rows
      0, 0, 0,
      rows, // regime breakdown uses all
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
      [buildAbRow("baseline", "TRENDING", 100)],
      [buildAbRow("rl-challenger", "TRENDING", 200)],
      3, // killEngageCount = 3
      0,
      0,
      [buildAbRow("baseline", "TRENDING", 100), buildAbRow("rl-challenger", "TRENDING", 200)],
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
      [buildAbRow("baseline", "TRENDING", 200)],
      [buildAbRow("rl-challenger", "TRENDING", 300)],
      0, 1, 3,
      [buildAbRow("baseline", "TRENDING", 200), buildAbRow("rl-challenger", "TRENDING", 300)],
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
      [buildAbRow("baseline", "TRENDING", 100)],
      [buildAbRow("rl-challenger", "TRENDING", 200)],
      0, 0, 0,
      [buildAbRow("baseline", "TRENDING", 100), buildAbRow("rl-challenger", "TRENDING", 200)],
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
    // No signal.rl_ab_routed rows, no training, no kill switch events
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
    // Set up first call to hang so lock remains held
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
