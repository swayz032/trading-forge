/**
 * wave25-starvation-watchdog.test.ts — Wave 25 Gap 3
 *
 * Tests for deployed-strategy-starvation-watchdog.ts covering:
 *   1. No deployed strategies → no-op (zero checks, no alerts)
 *   2. Deployed strategy with normal entries → no alarm
 *   3. Zero entries + non-zero signal evals → WARN fires
 *   4. Zero signal evals → CRITICAL fires
 *   5. Alarm idempotency — same condition within 4h does not double-fire
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
}));

vi.mock("../../server/routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../../server/services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

async function getModules() {
  const { db } = await import("../../server/db/index.js");
  const { logger } = await import("../../server/lib/logger.js");
  const { broadcastSSE } = await import("../../server/routes/sse.js");
  const { notifyCritical, notifyWarning } = await import(
    "../../server/services/notification-service.js"
  );
  const { runDeployedStrategyStarvationCheck, __test__ } = await import(
    "../../server/services/deployed-strategy-starvation-watchdog.js"
  );
  return { db, logger, broadcastSSE, notifyCritical, notifyWarning, runDeployedStrategyStarvationCheck, __test__ };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runDeployedStrategyStarvationCheck", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("no deployed strategies → no-op, no alerts fired", async () => {
    const { db, runDeployedStrategyStarvationCheck, notifyCritical, notifyWarning } =
      await getModules();

    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const result = await runDeployedStrategyStarvationCheck();

    expect(result.strategiesChecked).toBe(0);
    expect(result.results).toHaveLength(0);
    expect(result.anyAlertFired).toBe(false);
    expect(notifyCritical).not.toHaveBeenCalled();
    expect(notifyWarning).not.toHaveBeenCalled();
  });

  it("deployed strategy with normal entries → no alarm", async () => {
    const { db, runDeployedStrategyStarvationCheck, notifyCritical, notifyWarning } =
      await getModules();

    const strategies = [{ id: "strat-1", name: "TestStrategy", lifecycle_state: "DEPLOYED" }];
    let callN = 0;
    (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callN++;
      if (callN === 1) return strategies;
      if (callN === 2) return [{ n: 12 }]; // entryCount = 12 (non-zero)
      if (callN === 3) return [{ n: 50 }]; // signalEvalCount = 50
      return [];
    });

    const result = await runDeployedStrategyStarvationCheck();

    expect(result.strategiesChecked).toBe(1);
    expect(result.anyAlertFired).toBe(false);
    expect(result.results[0].warnFired).toBe(false);
    expect(result.results[0].criticalFired).toBe(false);
    expect(notifyCritical).not.toHaveBeenCalled();
    expect(notifyWarning).not.toHaveBeenCalled();
  });

  it("zero entries + non-zero signal evals → WARN fires", async () => {
    const { db, runDeployedStrategyStarvationCheck, notifyWarning, notifyCritical, broadcastSSE } =
      await getModules();

    const strategies = [{ id: "strat-2", name: "StarvedStrategy", lifecycle_state: "PILOT" }];
    let callN = 0;
    const mockInsertChain = { values: vi.fn().mockResolvedValue(undefined) };
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(mockInsertChain);
    (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callN++;
      if (callN === 1) return strategies;
      if (callN === 2) return [{ n: 0 }]; // entryCount = 0
      if (callN === 3) return [{ n: 30 }]; // signalEvalCount = 30 (non-zero)
      if (callN === 4) return []; // no recent deduplication alert
      return [];
    });

    const result = await runDeployedStrategyStarvationCheck();

    expect(result.anyAlertFired).toBe(true);
    expect(result.results[0].warnFired).toBe(true);
    expect(result.results[0].criticalFired).toBe(false);
    expect(notifyWarning).toHaveBeenCalledOnce();
    expect(notifyCritical).not.toHaveBeenCalled();
    expect(broadcastSSE).toHaveBeenCalledWith(
      "alert:signal_starvation_warn",
      expect.objectContaining({ strategyId: "strat-2", alarmLevel: "WARN" }),
    );
  });

  it("zero signal evals → CRITICAL fires", async () => {
    const { db, runDeployedStrategyStarvationCheck, notifyWarning, notifyCritical, broadcastSSE } =
      await getModules();

    const strategies = [{ id: "strat-3", name: "BrokenStrategy", lifecycle_state: "DEPLOYED" }];
    let callN = 0;
    const mockInsertChain = { values: vi.fn().mockResolvedValue(undefined) };
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(mockInsertChain);
    (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callN++;
      if (callN === 1) return strategies;
      if (callN === 2) return [{ n: 0 }]; // entryCount = 0
      if (callN === 3) return [{ n: 0 }]; // signalEvalCount = 0 → CRITICAL
      if (callN === 4) return []; // no recent deduplication alert
      return [];
    });

    const result = await runDeployedStrategyStarvationCheck();

    expect(result.anyAlertFired).toBe(true);
    expect(result.results[0].criticalFired).toBe(true);
    expect(result.results[0].warnFired).toBe(false);
    expect(notifyCritical).toHaveBeenCalledOnce();
    expect(notifyWarning).not.toHaveBeenCalled();
    expect(broadcastSSE).toHaveBeenCalledWith(
      "alert:signal_starvation_critical",
      expect.objectContaining({ strategyId: "strat-3", alarmLevel: "CRITICAL" }),
    );
  });

  it("alarm idempotency — CRITICAL already fired within 4h → no double-fire", async () => {
    const { db, runDeployedStrategyStarvationCheck, notifyCritical } = await getModules();

    const strategies = [{ id: "strat-4", name: "DupeStrategy", lifecycle_state: "DEPLOYED" }];
    let callN = 0;
    (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callN++;
      if (callN === 1) return strategies;
      if (callN === 2) return [{ n: 0 }]; // entryCount = 0
      if (callN === 3) return [{ n: 0 }]; // signalEvalCount = 0 → would be CRITICAL
      if (callN === 4) return [{ "1": 1 }]; // recent alert EXISTS → suppress
      return [];
    });

    const result = await runDeployedStrategyStarvationCheck();

    // Alert suppressed by dedupe
    expect(result.results[0].criticalFired).toBe(false);
    expect(notifyCritical).not.toHaveBeenCalled();
  });

  it("db failure on strategies query → fail-open with empty result", async () => {
    const { db, runDeployedStrategyStarvationCheck, notifyCritical, notifyWarning } =
      await getModules();

    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB connection error"),
    );

    const result = await runDeployedStrategyStarvationCheck();

    expect(result.strategiesChecked).toBe(0);
    expect(result.anyAlertFired).toBe(false);
    expect(notifyCritical).not.toHaveBeenCalled();
    expect(notifyWarning).not.toHaveBeenCalled();
  });

  it("constants match expected values", async () => {
    const { __test__ } = await getModules();
    expect(__test__.LOOKBACK_CALENDAR_DAYS).toBe(7);
    expect(__test__.DEDUPE_HOURS).toBe(4);
  });
});
