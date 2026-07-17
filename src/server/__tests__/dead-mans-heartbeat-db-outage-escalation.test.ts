/**
 * MED finding (telemetry-honesty-safety-adjacent, 2026-07-17):
 * dead-mans-heartbeat-service.ts::getLastHeartbeatAt() used to collapse a
 * genuine DB-connectivity outage (the SELECT query itself throwing — e.g.
 * connection refused, pool exhausted, network partition) into the exact same
 * null result as "table genuinely has zero rows" (the normal case right
 * after a fresh RTH-open startup). Both reached the caller's identical
 * `if (!lastAt)` branch, so a total DB outage during RTH only ever produced
 * the soft WARNING reserved for "backend hasn't written its first heartbeat
 * yet" — never the CRITICAL a total DB outage deserves.
 *
 * This suite proves runHeartbeatStaleCheck() now distinguishes the two
 * causes and escalates a genuine query failure to notifyCritical(), while
 * the benign "query succeeded, zero rows" case still gets the softer
 * notifyWarning() unchanged. Also covers the parallel fix in the
 * out-of-RTH secondary check (silent debug-only → notifyWarning()).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  notifyWarning: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { db } from "../db/index.js";
import { notifyCritical, notifyWarning } from "../services/notification-service.js";

// ─── ET hour control (mirrors dead-mans-heartbeat.test.ts pattern) ──────────

let _etHour = 10;
const _origFormatToParts = Intl.DateTimeFormat.prototype.formatToParts;

function setupDateMock() {
  Intl.DateTimeFormat.prototype.formatToParts = function (
    date?: Date | number,
  ): Intl.DateTimeFormatPart[] {
    const resolvedOptions = this.resolvedOptions();
    if (
      (resolvedOptions.timeZone === "America/New_York" && resolvedOptions.hourCycle === "h23") ||
      (resolvedOptions.hour !== undefined && resolvedOptions.timeZone === "America/New_York")
    ) {
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

describe("dead-mans-heartbeat-service: DB outage escalation (MED finding fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _etHour = 10;
    setupDateMock();
  });

  afterEach(() => {
    teardownDateMock();
  });

  describe("runHeartbeatStaleCheck — RTH path", () => {
    it("query THROWS (DB unreachable) during RTH → notifyCritical, not notifyWarning", async () => {
      setEtHour(10); // RTH
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockRejectedValue(
        new Error("connection refused"),
      );

      const { runHeartbeatStaleCheck } = await import("../services/dead-mans-heartbeat-service.js");
      await runHeartbeatStaleCheck();

      expect(notifyCritical).toHaveBeenCalled();
      const criticalCall = (notifyCritical as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(criticalCall[0]).toContain("query failed");
      expect(notifyWarning).not.toHaveBeenCalled();
    });

    it("query SUCCEEDS with zero rows during RTH → notifyWarning, NOT notifyCritical (regression guard)", async () => {
      setEtHour(10);
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([]);

      const { runHeartbeatStaleCheck } = await import("../services/dead-mans-heartbeat-service.js");
      await runHeartbeatStaleCheck();

      expect(notifyWarning).toHaveBeenCalled();
      expect(notifyCritical).not.toHaveBeenCalled();
    });
  });

  describe("runOffRthHeartbeatCheck — OOH path", () => {
    it("query THROWS (DB unreachable) outside RTH → notifyWarning fires (was completely silent before)", async () => {
      setEtHour(20); // outside RTH
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockRejectedValue(
        new Error("connection refused"),
      );

      const { runOffRthHeartbeatCheck } = await import("../services/dead-mans-heartbeat-service.js");
      await runOffRthHeartbeatCheck();

      expect(notifyWarning).toHaveBeenCalled();
      const warnCall = (notifyWarning as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(warnCall[0]).toContain("query failed");
    });

    it("query SUCCEEDS with zero rows outside RTH → no notification at all (regression guard, expected pre-RTH state)", async () => {
      setEtHour(20);
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([]);

      const { runOffRthHeartbeatCheck } = await import("../services/dead-mans-heartbeat-service.js");
      await runOffRthHeartbeatCheck();

      expect(notifyWarning).not.toHaveBeenCalled();
      expect(notifyCritical).not.toHaveBeenCalled();
    });
  });

  describe("getLastHeartbeatAt — public Date|null contract preserved", () => {
    it("still returns null on query throw (backward-compat: callers using the public function unaffected)", async () => {
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockRejectedValue(new Error("timeout"));
      const { getLastHeartbeatAt } = await import("../services/dead-mans-heartbeat-service.js");
      const result = await getLastHeartbeatAt();
      expect(result).toBeNull();
    });

    it("still returns null on zero rows", async () => {
      (db as typeof db & { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([]);
      const { getLastHeartbeatAt } = await import("../services/dead-mans-heartbeat-service.js");
      const result = await getLastHeartbeatAt();
      expect(result).toBeNull();
    });
  });
});
