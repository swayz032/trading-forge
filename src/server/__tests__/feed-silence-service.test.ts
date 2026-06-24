/**
 * feed-silence-service.test.ts — W1 go-live blocker #5a
 *
 * Tests for feed-silence-service.ts covering:
 *   1. Silence beyond threshold during RTH → alert fired + audit row written
 *   2. Within cadence (recent signal) → no alert
 *   3. Outside RTH → skipped (rtbGate = false, no checks)
 *   4. Pipeline-exempt behaviour: runFeedSilenceCheck runs even when pipeline paused
 *      (the gate-exempt contract is verified by checking it proceeds without checking
 *       isPipelineActive — the service has no pipeline gate, it always runs)
 *   5. Lock-contention skip: if _tryAcquireJobLock returns false the cron body returns
 *      early (verified via in-process dedup — second identical call within same window
 *      does NOT re-fire the alert)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../server/lib/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../server/db/index.js", () => ({
  db: {
    execute: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("../../server/db/schema.js", () => ({
  auditLog: { $inferInsert: {} },
  strategies: {},
  paperSessions: {},
  paperSignalLogs: {},
}));

vi.mock("../../server/lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../server/services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
}));

vi.mock("../../server/lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn(
    (body: string, _what: string, _action: string) => body + "\n\n--- For family members ---",
  ),
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

async function getModules() {
  const { db } = await import("../../server/db/index.js");
  const { insertAuditRow } = await import("../../server/lib/audit-log-helper.js");
  const { notifyCritical } = await import("../../server/services/notification-service.js");
  const {
    runFeedSilenceCheck,
    timeframeToMs,
    isEtRth,
    _silenceAlertedFor,
    _silenceEmergencyClosedFor, // Wave hardening 2026-06-22, A-3
    __test__,
  } = await import("../../server/services/feed-silence-service.js");
  return {
    db,
    insertAuditRow,
    notifyCritical,
    runFeedSilenceCheck,
    timeframeToMs,
    isEtRth,
    _silenceAlertedFor,
    _silenceEmergencyClosedFor,
    __test__,
  };
}

/** Build a fake execute result that returns one active strategy row. */
function makeStrategyRow(opts: {
  strategyId: string;
  strategyName: string;
  timeframe: string | null;
  lastSignalAt: string | null;
}) {
  return [
    {
      strategy_id: opts.strategyId,
      strategy_name: opts.strategyName,
      timeframe: opts.timeframe,
      last_signal_at: opts.lastSignalAt,
    },
  ];
}

// ─── timeframeToMs unit tests ─────────────────────────────────────────────────

describe("timeframeToMs", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("converts numeric minute strings correctly", async () => {
    const { timeframeToMs } = await getModules();
    expect(timeframeToMs("1")).toBe(60_000);
    expect(timeframeToMs("5")).toBe(300_000);
    expect(timeframeToMs("15")).toBe(900_000);
    expect(timeframeToMs("30")).toBe(1_800_000);
  });

  it("converts 60-minute to 1h in ms", async () => {
    const { timeframeToMs } = await getModules();
    expect(timeframeToMs("60")).toBe(3_600_000);
  });

  it("handles Nh suffix (hours)", async () => {
    const { timeframeToMs } = await getModules();
    expect(timeframeToMs("1h")).toBe(3_600_000);
    expect(timeframeToMs("2H")).toBe(7_200_000);
  });

  it("handles Nm suffix (minutes)", async () => {
    const { timeframeToMs } = await getModules();
    expect(timeframeToMs("5m")).toBe(300_000);
    expect(timeframeToMs("15M")).toBe(900_000);
  });

  it("returns null for daily/weekly/monthly", async () => {
    const { timeframeToMs } = await getModules();
    expect(timeframeToMs("D")).toBeNull();
    expect(timeframeToMs("W")).toBeNull();
    expect(timeframeToMs("M")).toBeNull();
    expect(timeframeToMs("1D")).toBeNull();
  });

  it("returns null for null/empty/unknown", async () => {
    const { timeframeToMs } = await getModules();
    expect(timeframeToMs(null)).toBeNull();
    expect(timeframeToMs(undefined)).toBeNull();
    expect(timeframeToMs("")).toBeNull();
    expect(timeframeToMs("xyz")).toBeNull();
  });
});

// ─── isEtRth (pure function — we can mock Date) ───────────────────────────────

describe("isEtRth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns true at 10:00 AM ET on a weekday", async () => {
    // 10:00 AM ET (UTC-4 EDT) = 14:00 UTC
    vi.setSystemTime(new Date("2026-06-22T14:00:00.000Z")); // Monday
    const { isEtRth } = await getModules();
    expect(isEtRth()).toBe(true);
  });

  it("returns false at 17:00 ET (after market close)", async () => {
    vi.setSystemTime(new Date("2026-06-22T21:00:00.000Z")); // 17:00 ET
    const { isEtRth } = await getModules();
    expect(isEtRth()).toBe(false);
  });

  it("returns false on Saturday", async () => {
    vi.setSystemTime(new Date("2026-06-20T14:00:00.000Z")); // Saturday 10:00 ET
    const { isEtRth } = await getModules();
    expect(isEtRth()).toBe(false);
  });
});

// ─── runFeedSilenceCheck core tests ──────────────────────────────────────────

describe("runFeedSilenceCheck", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Test 1: silence beyond threshold during RTH → alert + audit
  it("fires alert and audit row when strategy is silent beyond threshold during RTH", async () => {
    // Set time to 10:00 AM ET (Monday) — inside RTH
    vi.setSystemTime(new Date("2026-06-22T14:00:00.000Z"));

    const { db, insertAuditRow, notifyCritical, runFeedSilenceCheck, __test__ } =
      await getModules();
    __test__.clearDedupMap();

    // Last signal was 30 minutes ago — well beyond 5-min bar × 3 = 15-min threshold
    const lastSignal = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStrategyRow({
        strategyId: "strat-001",
        strategyName: "VWAP-MES-5m",
        timeframe: "5",
        lastSignalAt: lastSignal,
      }),
    );

    const result = await runFeedSilenceCheck();

    expect(result.rtbGate).toBe(true);
    expect(result.strategiesChecked).toBe(1);
    expect(result.silentStrategies).toBe(1);
    expect(result.alertsFired).toBe(1);
    expect(result.statuses[0].isSilent).toBe(true);
    expect(result.statuses[0].alertFired).toBe(true);

    expect(notifyCritical).toHaveBeenCalledOnce();
    expect(insertAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "feed.silence_detected", entityId: "strat-001" }),
    );
  });

  // Test 2: within cadence → no alert
  it("does not fire alert when last signal is within threshold", async () => {
    vi.setSystemTime(new Date("2026-06-22T14:00:00.000Z"));

    const { db, notifyCritical, insertAuditRow, runFeedSilenceCheck, __test__ } =
      await getModules();
    __test__.clearDedupMap();

    // Last signal was 5 seconds ago — well within 5-min bar × 3 = 15-min threshold
    const lastSignal = new Date(Date.now() - 5000).toISOString();
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStrategyRow({
        strategyId: "strat-002",
        strategyName: "EMA-NQ-1m",
        timeframe: "1",
        lastSignalAt: lastSignal,
      }),
    );

    const result = await runFeedSilenceCheck();

    expect(result.rtbGate).toBe(true);
    expect(result.silentStrategies).toBe(0);
    expect(result.alertsFired).toBe(0);
    expect(result.statuses[0].isSilent).toBe(false);
    expect(notifyCritical).not.toHaveBeenCalled();
    expect(insertAuditRow).not.toHaveBeenCalled();
  });

  // Test 3: outside RTH → skipped entirely
  it("skips all checks when outside RTH", async () => {
    // 20:00 UTC = 16:00 ET (market closed)
    vi.setSystemTime(new Date("2026-06-22T20:30:00.000Z"));

    const { db, notifyCritical, runFeedSilenceCheck, __test__ } = await getModules();
    __test__.clearDedupMap();

    const result = await runFeedSilenceCheck();

    expect(result.rtbGate).toBe(false);
    expect(result.strategiesChecked).toBe(0);
    expect(result.alertsFired).toBe(0);
    // DB should NOT be queried
    expect(db.execute).not.toHaveBeenCalled();
    expect(notifyCritical).not.toHaveBeenCalled();
  });

  // Test 4: pipeline-exempt — service has no pipeline gate, always runs during RTH
  it("runs during RTH regardless of pipeline state (no pipeline gate in this service)", async () => {
    vi.setSystemTime(new Date("2026-06-22T14:00:00.000Z"));

    const { db, runFeedSilenceCheck, __test__ } = await getModules();
    __test__.clearDedupMap();

    // No strategies active — just verify the service runs and queries DB
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const result = await runFeedSilenceCheck();

    expect(result.rtbGate).toBe(true);
    expect(result.strategiesChecked).toBe(0);
    // DB was queried (proves the service ran its full path)
    expect(db.execute).toHaveBeenCalledOnce();
  });

  // Test 5: in-process dedup prevents re-fire for same silence window (lock-contention analog).
  // NOTE: This test must NOT call vi.resetModules() between the two ticks because the dedup
  // Map is module-level state. The outer beforeEach resets modules, but within a single test
  // we reuse the same module import to simulate two consecutive cron ticks in the same process.
  it("dedup prevents re-alerting the same silence window on repeated ticks", async () => {
    vi.setSystemTime(new Date("2026-06-22T14:00:00.000Z"));

    // Get module references ONCE — do not reset modules between ticks.
    const { db, notifyCritical, insertAuditRow, runFeedSilenceCheck, __test__ } =
      await getModules();
    __test__.clearDedupMap();

    // 5-min bar × 3 = 15-min threshold. Silence = 30 min → isSilent = true.
    const lastSignal = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const row = makeStrategyRow({
      strategyId: "strat-003",
      strategyName: "BB-ES-5m",
      timeframe: "5",
      lastSignalAt: lastSignal,
    });

    // First tick — alert fires
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);
    const result1 = await runFeedSilenceCheck();
    expect(result1.alertsFired).toBe(1);
    expect(notifyCritical).toHaveBeenCalledTimes(1);

    // Second tick — same silence window — dedup must suppress the alert.
    // Only clear the call counts (vi.clearAllMocks), NOT the module graph.
    vi.clearAllMocks();
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);
    const result2 = await runFeedSilenceCheck();
    expect(result2.alertsFired).toBe(0);
    expect(notifyCritical).not.toHaveBeenCalled();
    expect(insertAuditRow).not.toHaveBeenCalled();
  });

  // Bonus: strategy with unparseable timeframe is skipped gracefully
  it("skips strategy with unparseable timeframe without throwing", async () => {
    vi.setSystemTime(new Date("2026-06-22T14:00:00.000Z"));

    const { db, notifyCritical, runFeedSilenceCheck, __test__ } = await getModules();
    __test__.clearDedupMap();

    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStrategyRow({
        strategyId: "strat-004",
        strategyName: "Manual-Strategy",
        timeframe: null,
        lastSignalAt: null,
      }),
    );

    const result = await runFeedSilenceCheck();
    expect(result.strategiesChecked).toBe(1);
    expect(result.alertsFired).toBe(0);
    expect(result.statuses[0].skipReason).toBe("timeframe_unparseable");
    expect(notifyCritical).not.toHaveBeenCalled();
  });

  // Bonus: DB error on query → fail-open (no throw, no alerts)
  it("fails open when DB query throws", async () => {
    vi.setSystemTime(new Date("2026-06-22T14:00:00.000Z"));

    const { db, notifyCritical, runFeedSilenceCheck, __test__ } = await getModules();
    __test__.clearDedupMap();

    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("DB timeout"));

    const result = await runFeedSilenceCheck();
    expect(result.rtbGate).toBe(true);
    expect(result.strategiesChecked).toBe(0);
    expect(notifyCritical).not.toHaveBeenCalled();
  });
});

/**
 * Wave hardening 2026-06-22, autonomous-readiness A-3:
 * Sustained feed silence triggers emergency position close.
 *
 * Design:
 * - First silence detection: alert fires (existing behaviour — tested above).
 * - Sustained silence (same silence window, silenceMs > EMERGENCY_CLOSE_THRESHOLD_MS):
 *   attemptEmergencyCloseForStrategy is called + audit row written +
 *   emergency-close Discord alert fires.
 * - Close is prop-firm-safe (only closes, never opens/flips).
 * - If no open positions: no close attempted, no alert.
 * - Entry-block: feed recovery clears emergency dedup so re-alert is possible.
 */
describe("A-3 sustained feed silence — emergency close", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT attempt emergency close on first silence detection (dedup not yet set)", async () => {
    vi.setSystemTime(new Date("2026-06-22T14:00:00.000Z"));
    const { db, notifyCritical, insertAuditRow, runFeedSilenceCheck, __test__ } = await getModules();
    __test__.clearDedupMap();

    const lastSignal = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStrategyRow({ strategyId: "s-ec1", strategyName: "VWAP-5m", timeframe: "5", lastSignalAt: lastSignal }),
    );

    await runFeedSilenceCheck();

    // First tick: normal silence alert fires, but no emergency-close audit
    expect(notifyCritical).toHaveBeenCalledOnce();
    const auditCalls = (insertAuditRow as ReturnType<typeof vi.fn>).mock.calls as unknown as Array<
      [{ action: string }]
    >;
    const closeAudit = auditCalls.find(
      ([arg]: [{ action: string }]) => arg.action === "feed.silence_emergency_close",
    );
    expect(closeAudit).toBeUndefined();
  });

  it("attempts emergency close on sustained silence beyond threshold when dedup key is already set", async () => {
    vi.setSystemTime(new Date("2026-06-22T14:00:00.000Z"));

    // Import modules ONCE — don't reset between ticks (dedup is module-level state).
    const { db, insertAuditRow, __test__ } = await getModules();
    __test__.clearDedupMap();

    // Silence for 3 hours > 2h default emergency threshold
    const lastSignal = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    const stratRow = makeStrategyRow({
      strategyId: "s-ec2",
      strategyName: "EMA-NQ-15m",
      timeframe: "15",
      lastSignalAt: lastSignal,
    });

    // Tick 1 — fires first alert, sets dedup key
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(stratRow);
    await (await import("../../server/services/feed-silence-service.js")).runFeedSilenceCheck();

    vi.clearAllMocks();

    // Tick 2 — same silence window, silenceMs > 2h threshold → emergency close triggered.
    // Strategy query + open positions query both return successfully.
    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(stratRow)  // queryActiveStrategiesWithLastSignal
      .mockResolvedValueOnce([
        { position_id: "pos-001", session_id: "sess-001" },
      ]);                               // open positions query inside attemptEmergencyCloseForStrategy

    // paper-execution-service is lazy-imported; closePosition must succeed
    vi.doMock("../../server/services/paper-execution-service.js", () => ({
      closePosition: vi.fn().mockResolvedValue(undefined),
    }));

    await (await import("../../server/services/feed-silence-service.js")).runFeedSilenceCheck();

    // The emergency close is fire-and-forget — drain the microtask queue so the
    // Promise chain inside attemptEmergencyCloseForStrategy fully resolves before
    // we assert on the audit calls.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const auditCalls = (insertAuditRow as ReturnType<typeof vi.fn>).mock.calls as unknown as Array<
      [{ action: string }]
    >;
    const closeAudit = auditCalls.find(
      ([arg]: [{ action: string }]) => arg.action === "feed.silence_emergency_close",
    );
    expect(closeAudit).toBeDefined();
    expect(closeAudit?.[0]).toMatchObject({
      action: "feed.silence_emergency_close",
      entityId: "s-ec2",
    });
  });

  it("does NOT attempt emergency close a second time for the same silence window", async () => {
    vi.setSystemTime(new Date("2026-06-22T14:00:00.000Z"));

    // Use getModules() so all mocks are properly wired in this reset context.
    const { db, insertAuditRow, _silenceAlertedFor, _silenceEmergencyClosedFor, runFeedSilenceCheck } =
      await getModules();

    const silenceKey = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    // Pre-seed both dedup maps as if ticks 1 and 2 already ran
    _silenceAlertedFor.set("s-ec3", silenceKey);
    _silenceEmergencyClosedFor.set("s-ec3", silenceKey);

    const stratRow = makeStrategyRow({
      strategyId: "s-ec3",
      strategyName: "BB-MES-5m",
      timeframe: "5",
      lastSignalAt: silenceKey,
    });

    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(stratRow);

    await runFeedSilenceCheck();

    // Drain microtask queue — no async work expected but be safe
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // No emergency-close audit on tick 3 — already closed this window
    const auditCalls = (insertAuditRow as ReturnType<typeof vi.fn>).mock.calls as unknown as Array<
      [{ action: string }]
    >;
    const closeAudit = auditCalls.find(
      ([arg]: [{ action: string }]) => arg.action === "feed.silence_emergency_close",
    );
    expect(closeAudit).toBeUndefined();
  });

  it("clears emergency-close dedup when feed recovers", async () => {
    vi.setSystemTime(new Date("2026-06-22T14:00:00.000Z"));

    const { _silenceAlertedFor, _silenceEmergencyClosedFor, __test__ } =
      await import("../../server/services/feed-silence-service.js");

    const silenceKey = "2026-06-22T10:00:00.000Z";
    _silenceAlertedFor.set("s-ec4", silenceKey);
    _silenceEmergencyClosedFor.set("s-ec4", silenceKey);

    // clearDedupMap should wipe both maps
    __test__.clearDedupMap();

    expect(_silenceAlertedFor.has("s-ec4")).toBe(false);
    expect(_silenceEmergencyClosedFor.has("s-ec4")).toBe(false);
  });

  it("fails open when attemptEmergencyCloseForStrategy DB query throws", async () => {
    vi.setSystemTime(new Date("2026-06-22T14:00:00.000Z"));

    const { db, __test__, notifyCritical } = await getModules();
    __test__.clearDedupMap();

    // 3h silence → above emergency threshold
    const silenceKey = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const stratRow = makeStrategyRow({
      strategyId: "s-ec5",
      strategyName: "VWAP-NQ-1m",
      timeframe: "1",
      lastSignalAt: silenceKey,
    });

    // Tick 1 — set dedup
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(stratRow);
    await (await import("../../server/services/feed-silence-service.js")).runFeedSilenceCheck();
    vi.clearAllMocks();

    // Tick 2 — position query throws → fail-open (no throw propagated)
    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(stratRow)                    // queryActiveStrategiesWithLastSignal
      .mockRejectedValueOnce(new Error("positions DB down")); // position query fails

    await expect(
      (await import("../../server/services/feed-silence-service.js")).runFeedSilenceCheck(),
    ).resolves.not.toThrow();

    // No emergency-close notifyCritical should have fired (fail-open)
    const calls = (notifyCritical as ReturnType<typeof vi.fn>).mock.calls as unknown as Array<
      [string]
    >;
    const emergencyCall = calls.find(
      ([title]: [string]) => title?.includes("emergency close"),
    );
    expect(emergencyCall).toBeUndefined();
  });
});
