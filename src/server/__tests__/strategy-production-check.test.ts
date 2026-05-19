/**
 * Pass 7 Task 3 — Strategy production-assertion cron tests.
 *
 * Covers:
 *   1. count >= 1 → no alert, no audit row inserted
 *   2. count == 0 → audit_log("alert.no_strategies_today") inserted, notifyCritical called
 *   3. handler runs even when isPipelineActive=false (cron bypasses pause)
 *   4. breakdown query failure does not crash the alert
 *   5. mode resolution failure falls back to UNKNOWN, alert still fires
 *   6. notifyCritical receives mode + breakdown in metadata
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { insertValuesMock, insertMock, notifyCriticalMock, getPipelineModeMock, isPipelineActiveMock } = vi.hoisted(() => {
  const insertValuesMock = vi.fn(() => ({
    catch: vi.fn().mockResolvedValue(undefined),
  }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));
  const notifyCriticalMock = vi.fn();
  const getPipelineModeMock = vi.fn();
  const isPipelineActiveMock = vi.fn();
  return { insertValuesMock, insertMock, notifyCriticalMock, getPipelineModeMock, isPipelineActiveMock };
});

vi.mock("../db/index.js", () => ({
  db: {
    execute: vi.fn(),
    insert: insertMock,
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: notifyCriticalMock,
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  getMode: getPipelineModeMock,
  isActive: isPipelineActiveMock,
}));

import { db } from "../db/index.js";
import { runStrategyProductionCheck } from "../services/strategy-production-check-service.js";

describe("runStrategyProductionCheck — Pass 7 Task 3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPipelineModeMock.mockResolvedValue("ACTIVE");
    isPipelineActiveMock.mockResolvedValue(true);
  });

  it("does NOT alert when count >= 1", async () => {
    (db.execute as any).mockResolvedValueOnce([{ n: 3 }]);
    const result = await runStrategyProductionCheck();
    expect(result.count).toBe(3);
    expect(result.alertFired).toBe(false);
    expect(notifyCriticalMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("alerts when count == 0 — writes audit_log and calls notifyCritical", async () => {
    (db.execute as any)
      .mockResolvedValueOnce([{ n: 0 }])               // production count
      .mockResolvedValueOnce([{ status: "scouted", n: 5 }]) // backlog
      .mockResolvedValueOnce([                          // synth stats
        { action: "scout.rejected_auditor", n: 4 },
        { action: "scout.rejected_compile", n: 1 },
      ]);
    const result = await runStrategyProductionCheck();
    expect(result.count).toBe(0);
    expect(result.alertFired).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    const insertedRow = (insertValuesMock.mock.calls as any)[0][0] as Record<string, unknown>;
    expect(insertedRow.action).toBe("alert.no_strategies_today");
    expect(insertedRow.entityType).toBe("lifecycle");
    expect(insertedRow.status).toBe("warning");
    expect(insertedRow.decisionAuthority).toBe("system");
    expect(notifyCriticalMock).toHaveBeenCalledTimes(1);
  });

  it("runs even when pipeline is paused (cron bypasses pause gate)", async () => {
    isPipelineActiveMock.mockResolvedValue(false);
    getPipelineModeMock.mockResolvedValue("PAUSED");
    (db.execute as any)
      .mockResolvedValueOnce([{ n: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const result = await runStrategyProductionCheck();
    expect(result.alertFired).toBe(true);
    expect(notifyCriticalMock).toHaveBeenCalledTimes(1);
    // Verify the pause mode was captured in the alert
    const callArgs = notifyCriticalMock.mock.calls[0];
    expect(callArgs[1]).toContain("PAUSED");
  });

  it("breakdown query failure does not crash the alert", async () => {
    (db.execute as any)
      .mockResolvedValueOnce([{ n: 0 }])
      .mockRejectedValueOnce(new Error("backlog query blew up"));
    const result = await runStrategyProductionCheck();
    expect(result.alertFired).toBe(true);
    expect(notifyCriticalMock).toHaveBeenCalledTimes(1);
    // Audit row still inserted with empty breakdowns
    const inserted = (insertValuesMock.mock.calls as any)[0][0] as Record<string, unknown>;
    expect((inserted.result as any).scoutBacklog).toEqual({});
    expect((inserted.result as any).synthesizerStats).toEqual({});
  });

  it("mode resolution failure falls back to UNKNOWN", async () => {
    getPipelineModeMock.mockRejectedValue(new Error("mode fetch failed"));
    (db.execute as any)
      .mockResolvedValueOnce([{ n: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const result = await runStrategyProductionCheck();
    expect(result.alertFired).toBe(true);
    const inserted = (insertValuesMock.mock.calls as any)[0][0] as Record<string, unknown>;
    expect((inserted.input as any).mode).toBe("UNKNOWN");
  });

  it("notifyCritical receives mode + breakdowns in metadata", async () => {
    (db.execute as any)
      .mockResolvedValueOnce([{ n: 0 }])
      .mockResolvedValueOnce([{ status: "scouted", n: 7 }])
      .mockResolvedValueOnce([{ action: "scout.audited", n: 2 }]);
    await runStrategyProductionCheck();
    const [title, body, metadata] = notifyCriticalMock.mock.calls[0];
    expect(title).toBe("No new strategies today");
    expect(body).toContain("Pipeline mode: ACTIVE");
    expect(metadata).toMatchObject({
      job: "b14-strategy-production-check",
      mode: "ACTIVE",
    });
    expect((metadata as any).scoutBacklog).toEqual({ scouted: 7 });
    expect((metadata as any).synthesizerStats).toEqual({ "scout.audited": 2 });
  });

  it("count exactly 1 is the boundary — no alert", async () => {
    (db.execute as any).mockResolvedValueOnce([{ n: 1 }]);
    const result = await runStrategyProductionCheck();
    expect(result.count).toBe(1);
    expect(result.alertFired).toBe(false);
    expect(notifyCriticalMock).not.toHaveBeenCalled();
  });

  it("null count from query is treated as 0 (alert fires)", async () => {
    (db.execute as any)
      .mockResolvedValueOnce([{ n: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const result = await runStrategyProductionCheck();
    expect(result.count).toBe(0);
    expect(result.alertFired).toBe(true);
  });

  it("empty rows array from query is treated as 0", async () => {
    (db.execute as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const result = await runStrategyProductionCheck();
    expect(result.count).toBe(0);
    expect(result.alertFired).toBe(true);
  });
});
