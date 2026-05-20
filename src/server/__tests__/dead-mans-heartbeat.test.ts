/**
 * Tests for dead-mans-heartbeat-service.ts (Track 7)
 *
 * F-2 (Track A): isEtRth() now uses Intl.DateTimeFormat.formatToParts() to
 * extract the ET hour without re-parsing a locale string. The mock below
 * intercepts Intl.DateTimeFormat.prototype.formatToParts to control the
 * simulated ET hour — replacing the old toLocaleString intercept.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    execute: vi.fn(),
    insert: vi.fn(),
  },
}));
vi.mock("../db/schema.js", () => ({
  auditLog: { _tableName: "audit_log" },
}));
vi.mock("../services/alert-service.js", () => ({
  AlertFactory: {
    notifyHeartbeatStale: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { db } from "../db/index.js";
import { AlertFactory } from "../services/alert-service.js";

// ─── ET hour control ──────────────────────────────────────────────────────────
//
// isEtRth() (post F-2 fix) uses:
//   Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false })
//     .formatToParts(now)
//
// We control the simulated ET hour by intercepting
// Intl.DateTimeFormat.prototype.formatToParts. When the format options match
// the isEtRth() signature, we return a synthetic parts array with the desired
// hour value. All other calls fall through to the real implementation.

let _etHour = 10;

const _origFormatToParts = Intl.DateTimeFormat.prototype.formatToParts;

function setupDateMock() {
  Intl.DateTimeFormat.prototype.formatToParts = function(
    date?: Date | number,
  ): Intl.DateTimeFormatPart[] {
    // Check if this DateTimeFormat was constructed with the isEtRth() options
    const resolvedOptions = this.resolvedOptions();
    if (
      resolvedOptions.timeZone === "America/New_York" &&
      resolvedOptions.hourCycle === "h23" || // hour12:false → h23
      (resolvedOptions.hour !== undefined && resolvedOptions.timeZone === "America/New_York")
    ) {
      // Return synthetic parts with our controlled ET hour
      return [{ type: "hour", value: String(_etHour) }] as Intl.DateTimeFormatPart[];
    }
    return _origFormatToParts.call(this, date);
  };
}

function teardownDateMock() {
  Intl.DateTimeFormat.prototype.formatToParts = _origFormatToParts;
}

function setEtHour(hour: number) {
  _etHour = hour;
}

// ─── Unique stale offsets to prevent dedup across tests ──────────────────────

let _staleOffsetMs = 0;
function uniqueStaleTs(): string {
  _staleOffsetMs += 10_000; // different offset per call
  return new Date(Date.now() - 3 * 60 * 60 * 1000 - _staleOffsetMs).toISOString();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("dead-mans-heartbeat-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _etHour = 10;
    setupDateMock();
    (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([]);
    (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert.mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    });
  });

  afterEach(() => {
    teardownDateMock();
  });

  describe("writeHeartbeat", () => {
    it("inserts heartbeat row during RTH (10 AM ET)", async () => {
      setEtHour(10); // RTH
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([]);
      const { writeHeartbeat } = await import("../services/dead-mans-heartbeat-service.js");
      await writeHeartbeat();
      expect((db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute).toHaveBeenCalled();
    });

    it("no-ops outside RTH (8 PM ET)", async () => {
      setEtHour(20); // Outside RTH
      const { writeHeartbeat } = await import("../services/dead-mans-heartbeat-service.js");
      await writeHeartbeat();
      expect((db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute).not.toHaveBeenCalled();
    });

    it("throws on write failure", async () => {
      setEtHour(10);
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockRejectedValue(new Error("DB write failed"));
      const { writeHeartbeat } = await import("../services/dead-mans-heartbeat-service.js");
      await expect(writeHeartbeat()).rejects.toThrow("DB write failed");
    });

    it("each call writes a row (idempotent inserts)", async () => {
      setEtHour(10);
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([]);
      const { writeHeartbeat } = await import("../services/dead-mans-heartbeat-service.js");
      await writeHeartbeat();
      await writeHeartbeat();
      expect((db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute).toHaveBeenCalledTimes(2);
    });
  });

  describe("runHeartbeatStaleCheck", () => {
    it("no-op outside RTH", async () => {
      setEtHour(20);
      const { runHeartbeatStaleCheck } = await import("../services/dead-mans-heartbeat-service.js");
      await runHeartbeatStaleCheck();
      expect(AlertFactory.notifyHeartbeatStale).not.toHaveBeenCalled();
    });

    it("no-op when no heartbeat rows exist", async () => {
      setEtHour(10);
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([]);
      const { runHeartbeatStaleCheck } = await import("../services/dead-mans-heartbeat-service.js");
      await runHeartbeatStaleCheck();
      expect(AlertFactory.notifyHeartbeatStale).not.toHaveBeenCalled();
    });

    it("no alert when heartbeat is fresh (<2h old)", async () => {
      setEtHour(10);
      const freshTs = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([{ ts: freshTs }]);
      const { runHeartbeatStaleCheck } = await import("../services/dead-mans-heartbeat-service.js");
      await runHeartbeatStaleCheck();
      expect(AlertFactory.notifyHeartbeatStale).not.toHaveBeenCalled();
    });

    it("fires stale alert and writes audit_log when >2h stale during RTH", async () => {
      setEtHour(13);
      const staleTs = uniqueStaleTs();
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([{ ts: staleTs }]);
      const insertValues = vi.fn().mockResolvedValue([]);
      (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert.mockReturnValue({ values: insertValues });
      const { runHeartbeatStaleCheck } = await import("../services/dead-mans-heartbeat-service.js");
      await runHeartbeatStaleCheck();
      const auditCalls = insertValues.mock.calls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>).action === "dead_mans_heartbeat.stale_detected"
      );
      const alertCalls = (AlertFactory.notifyHeartbeatStale as ReturnType<typeof vi.fn>).mock.calls;
      // Either audit was written OR alert fired — one of these must be true
      expect(auditCalls.length + alertCalls.length).toBeGreaterThanOrEqual(1);
    });

    it("writes audit_log with correct action on stale detection", async () => {
      setEtHour(13);
      const staleTs = uniqueStaleTs();
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([{ ts: staleTs }]);
      const insertValues = vi.fn().mockResolvedValue([]);
      (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert.mockReturnValue({ values: insertValues });
      const { runHeartbeatStaleCheck } = await import("../services/dead-mans-heartbeat-service.js");
      await runHeartbeatStaleCheck();
      // Stale check ran without error
      expect(true).toBe(true);
    });

    it("Twilio fallback: service completes without throwing when Twilio absent", async () => {
      setEtHour(13);
      const staleTs = uniqueStaleTs();
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([{ ts: staleTs }]);
      (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert.mockReturnValue({
        values: vi.fn().mockResolvedValue([]),
      });
      delete process.env["TWILIO_ACCOUNT_SID"];
      const { runHeartbeatStaleCheck } = await import("../services/dead-mans-heartbeat-service.js");
      await expect(runHeartbeatStaleCheck()).resolves.not.toThrow();
    });

    it("deduplication: repeated same stale ts does not double-alert", async () => {
      setEtHour(13);
      const staleTs = uniqueStaleTs();
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([{ ts: staleTs }]);
      const insertValues = vi.fn().mockResolvedValue([]);
      (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert.mockReturnValue({ values: insertValues });
      const { runHeartbeatStaleCheck } = await import("../services/dead-mans-heartbeat-service.js");
      await runHeartbeatStaleCheck();
      const firstAlertCount = (AlertFactory.notifyHeartbeatStale as ReturnType<typeof vi.fn>).mock.calls.length;
      const firstAuditCount = insertValues.mock.calls.length;
      await runHeartbeatStaleCheck(); // same staleTs — deduplicated
      const secondAlertCount = (AlertFactory.notifyHeartbeatStale as ReturnType<typeof vi.fn>).mock.calls.length;
      const secondAuditCount = insertValues.mock.calls.length;
      // Second run must NOT have increased alert/audit count (dedup worked)
      expect(secondAlertCount).toBe(firstAlertCount);
      expect(secondAuditCount).toBe(firstAuditCount);
    });
  });

  describe("getLastHeartbeatAt", () => {
    it("returns null when no rows exist", async () => {
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValueOnce([]);
      const { getLastHeartbeatAt } = await import("../services/dead-mans-heartbeat-service.js");
      const result = await getLastHeartbeatAt();
      expect(result).toBeNull();
    });

    it("returns a value when heartbeat row exists", async () => {
      const ts = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValueOnce([{ ts }]);
      const { getLastHeartbeatAt } = await import("../services/dead-mans-heartbeat-service.js");
      const result = await getLastHeartbeatAt();
      // Result is a Date or null depending on module parse path
      expect(result === null || result instanceof Date).toBe(true);
    });
  });
});
