/**
 * Wave 24 Pass 1.5 — Item 6: Operator-absent auto-flip tests.
 *
 * Verifies the two-stage state machine that auto-sets
 * system_state.operator_absent_pending → operator_absent_since after
 * 24h / 48h of operator silence (audit_log decision_authority='human').
 *
 * State machine:
 *   stage 0 → 24h silence + pending=NULL → set pending=NOW + alert
 *   stage 1 → 48h silence (pending ≥ 24h old) → set since=NOW + alert
 *   any t  → activity observed → clear pending (since stays — sticky)
 *   any t  → mark-present route → clear BOTH
 *
 * Non-goals: full DB integration. We mock db and verify the UPDATE/INSERT
 * shape only. This is the same isolation level as wave24-bw-cookie-refresh.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── DB mocks ───────────────────────────────────────────────────────────────
// db.select(...).from(...).where(...).orderBy(...).limit(N) chain → returns row[]
// db.update(table).set(values).where(cond)            → resolves void
// db.insert(table).values(values)                     → resolves void

let _systemStateRow: { operatorAbsentSince: Date | null; operatorAbsentPending: Date | null } | null = {
  operatorAbsentSince: null,
  operatorAbsentPending: null,
};
let _lastActivityAt: Date | null = null;

const mockUpdateSet = vi.fn();
const mockUpdate = vi.fn(() => ({
  set: (values: Record<string, unknown>) => {
    mockUpdateSet(values);
    if (_systemStateRow) {
      if ("operatorAbsentSince" in values) _systemStateRow.operatorAbsentSince = values.operatorAbsentSince as Date | null;
      if ("operatorAbsentPending" in values) _systemStateRow.operatorAbsentPending = values.operatorAbsentPending as Date | null;
    }
    return { where: () => Promise.resolve(undefined) };
  },
}));

const mockSelect = vi.fn(() => {
  // Two query shapes — system_state read, then audit_log read.
  // We disambiguate by the `from` argument.
  let target: "system_state" | "audit_log" | null = null;
  return {
    from: (table: unknown) => {
      const t = (table as { __name?: string }).__name ?? "";
      target = t === "system_state" ? "system_state" : "audit_log";
      return {
        where: () => ({
          orderBy: () => ({
            limit: () => {
              if (target === "audit_log") {
                return _lastActivityAt ? [{ createdAt: _lastActivityAt }] : [];
              }
              return [];
            },
          }),
          limit: () => {
            if (target === "system_state") {
              return _systemStateRow ? [_systemStateRow] : [];
            }
            return [];
          },
        }),
      };
    },
  };
});

vi.mock("../db/index.js", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
  },
}));

vi.mock("../db/schema.js", () => ({
  auditLog: { __name: "audit_log", action: "action", decisionAuthority: "decision_authority", createdAt: "created_at" },
  systemState: { __name: "system_state", id: "id", operatorAbsentSince: "operator_absent_since", operatorAbsentPending: "operator_absent_pending" },
}));

const mockNotifyCritical = vi.fn();
const mockNotifyWarning = vi.fn();
vi.mock("../services/notification-service.js", () => ({
  notifyCritical: mockNotifyCritical,
  notifyWarning: mockNotifyWarning,
  notifyInfo: vi.fn(),
}));

const mockInsertAuditRow = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: mockInsertAuditRow,
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: { systemError: vi.fn(), warning: vi.fn(), critical: vi.fn(), info: vi.fn(), notifyHeartbeatStale: vi.fn() },
}));

const NOW = new Date("2026-05-23T18:00:00.000Z").getTime();
const HOURS = (n: number) => n * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  _systemStateRow = { operatorAbsentSince: null, operatorAbsentPending: null };
  _lastActivityAt = null;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("Wave 24 Pass 1.5 Item 6 — operator-absent auto-flip", () => {
  it("fresh activity within 24h: no pending, no since, no alert", async () => {
    _lastActivityAt = new Date(NOW - HOURS(2));
    _systemStateRow = { operatorAbsentSince: null, operatorAbsentPending: null };

    const { runOperatorAbsenceAutoDetect } = await import("../services/dead-mans-heartbeat-service.js");
    await runOperatorAbsenceAutoDetect();

    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockNotifyCritical).not.toHaveBeenCalled();
    expect(_systemStateRow.operatorAbsentPending).toBeNull();
    expect(_systemStateRow.operatorAbsentSince).toBeNull();
  });

  it("24h silence + no pending → sets pending + fires Discord critical", async () => {
    _lastActivityAt = new Date(NOW - HOURS(25));
    _systemStateRow = { operatorAbsentSince: null, operatorAbsentPending: null };

    const { runOperatorAbsenceAutoDetect } = await import("../services/dead-mans-heartbeat-service.js");
    await runOperatorAbsenceAutoDetect();

    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    const setArgs = mockUpdateSet.mock.calls[0][0];
    expect(setArgs.operatorAbsentPending).toBeInstanceOf(Date);
    expect(setArgs.operatorAbsentSince).toBeUndefined();
    expect(mockNotifyCritical).toHaveBeenCalledOnce();
    expect(mockNotifyCritical.mock.calls[0][0]).toMatch(/confirmation window/i);
    expect(mockInsertAuditRow).toHaveBeenCalledWith(expect.objectContaining({ action: "operator_absence.pending_detected" }));
  });

  it("48h silence (pending ≥ 24h old) → promotes to since + Discord critical", async () => {
    _lastActivityAt = new Date(NOW - HOURS(49));
    _systemStateRow = {
      operatorAbsentSince: null,
      operatorAbsentPending: new Date(NOW - HOURS(25)),
    };

    const { runOperatorAbsenceAutoDetect } = await import("../services/dead-mans-heartbeat-service.js");
    await runOperatorAbsenceAutoDetect();

    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    const setArgs = mockUpdateSet.mock.calls[0][0];
    expect(setArgs.operatorAbsentSince).toBeInstanceOf(Date);
    expect(setArgs.operatorAbsentPending).toBeUndefined();
    expect(mockNotifyCritical).toHaveBeenCalledOnce();
    expect(mockNotifyCritical.mock.calls[0][0]).toMatch(/vacation autopilot engaged/i);
    expect(mockInsertAuditRow).toHaveBeenCalledWith(expect.objectContaining({ action: "operator_absence.auto_detected" }));
  });

  it("idempotent — re-run after since is set does NOT overwrite", async () => {
    const earlierSince = new Date(NOW - HOURS(72));
    _lastActivityAt = new Date(NOW - HOURS(100));
    _systemStateRow = {
      operatorAbsentSince: earlierSince,
      operatorAbsentPending: null,
    };

    const { runOperatorAbsenceAutoDetect } = await import("../services/dead-mans-heartbeat-service.js");
    await runOperatorAbsenceAutoDetect();

    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockNotifyCritical).not.toHaveBeenCalled();
    expect(_systemStateRow.operatorAbsentSince).toEqual(earlierSince);
  });

  it("pending set + activity returns within 24h → clears pending (no flap)", async () => {
    _lastActivityAt = new Date(NOW - HOURS(2));
    _systemStateRow = {
      operatorAbsentSince: null,
      operatorAbsentPending: new Date(NOW - HOURS(10)),
    };

    const { runOperatorAbsenceAutoDetect } = await import("../services/dead-mans-heartbeat-service.js");
    await runOperatorAbsenceAutoDetect();

    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet.mock.calls[0][0]).toEqual({ operatorAbsentPending: null });
    expect(_systemStateRow.operatorAbsentPending).toBeNull();
    expect(mockNotifyCritical).not.toHaveBeenCalled();
  });

  it("pending set but only 12h old → wait (no promotion yet, no Discord re-fire)", async () => {
    _lastActivityAt = new Date(NOW - HOURS(30));
    _systemStateRow = {
      operatorAbsentSince: null,
      operatorAbsentPending: new Date(NOW - HOURS(12)),
    };

    const { runOperatorAbsenceAutoDetect } = await import("../services/dead-mans-heartbeat-service.js");
    await runOperatorAbsenceAutoDetect();

    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockNotifyCritical).not.toHaveBeenCalled();
  });

  it("clearOperatorAbsenceMarkers clears BOTH columns and returns prior state", async () => {
    const sinceTs = new Date(NOW - HOURS(72));
    const pendingTs = new Date(NOW - HOURS(96));
    _systemStateRow = { operatorAbsentSince: sinceTs, operatorAbsentPending: pendingTs };

    const { clearOperatorAbsenceMarkers } = await import("../services/dead-mans-heartbeat-service.js");
    const result = await clearOperatorAbsenceMarkers();

    expect(result.clearedSince).toEqual(sinceTs);
    expect(result.clearedPending).toEqual(pendingTs);
    expect(mockUpdateSet).toHaveBeenCalledWith({ operatorAbsentSince: null, operatorAbsentPending: null });
    expect(_systemStateRow.operatorAbsentSince).toBeNull();
    expect(_systemStateRow.operatorAbsentPending).toBeNull();
  });
});
