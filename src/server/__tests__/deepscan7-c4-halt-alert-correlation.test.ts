/**
 * deepscan7-c4-halt-alert-correlation.test.ts — Deep-scan #7 Track C (2026-07-02)
 *
 * C4 (MED obs-M6): setMode("HALT") generates modeChangeCorrelationId and writes
 * it to the production.mode_changed audit row, but the operator Discord alert
 * (AlertFactory.systemError "production-halt-activated") omitted it — the
 * operator could not query audit_log directly from the alert.
 *
 * Fix: the alert body now carries `CorrelationId: <uuid>` — the SAME uuid
 * written to the audit row.
 *
 * Mock preamble mirrors kill-switch.test.ts, plus paper-execution-service is
 * mocked so the HALT force-flatten path resolves without the real module graph.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then(
            resolve: (v: unknown[]) => unknown,
            reject?: (err: unknown) => unknown,
          ) {
            return Promise.resolve([]).then(resolve, reject);
          },
          limit: vi.fn().mockResolvedValue([
            {
              productionMode: "PAPER",
              killReason: null,
              setBy: "test",
              setAt: new Date("2026-07-02T00:00:00Z"),
            },
          ]),
        }),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([{ id: "test-id" }]),
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  systemState: { id: "system_state" },
  auditLog: { action: "audit_log" },
  weeklyDriftReports: { severity: "severity", reportWeek: "report_week", ranAt: "ran_at" },
  brokerAccounts: { firmId: "firm_id", enabled: "enabled" },
  paperSessions: {
    id: "id",
    firmId: "firm_id",
    status: "status",
    dailyPnlBreakdown: "daily_pnl_breakdown",
    currentEquity: "current_equity",
    realizedPeakEquity: "realized_peak_equity",
  },
  ProductionMode: undefined,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => `eq(${String(_val)})`),
  desc: vi.fn(() => "desc"),
  and: vi.fn((...args: unknown[]) => `and(${args.join(",")})`),
}));

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: { systemError: vi.fn() },
  createAlert: vi.fn().mockResolvedValue({ id: "alert-test-id" }),
}));

vi.mock("../services/exchange-status-service.js", () => ({
  isExchangeHalted: vi.fn().mockReturnValue(false),
}));

vi.mock("../services/prop-firm-health-service.js", () => ({
  isFirmSuspended: vi.fn().mockReturnValue(false),
}));

vi.mock("../lib/network-failover.js", () => ({
  isConnectivityDegraded: vi.fn().mockReturnValue(false),
}));

vi.mock("../services/macro-gate-service.js", () => ({
  evaluateMacroGates: vi.fn().mockResolvedValue({ crisisGateTriggered: false }),
}));

vi.mock("../services/windows-health-check-service.js", () => ({
  runPreTradingDayHealthCheck: vi.fn().mockResolvedValue({ status: "healthy" }),
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn().mockReturnValue({ dailyLossLimit: 1000, maxDrawdown: 2000 }),
}));

// HALT path dynamic-imports paper-execution-service for the force-flatten —
// mock it so _confirmedForceClose resolves immediately.
vi.mock("../services/paper-execution-service.js", () => ({
  forceCloseAllPositions: vi.fn().mockResolvedValue(undefined),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { killSwitch } from "../production/kill-switch.js";
import { AlertFactory } from "../services/alert-service.js";
import { db } from "../db/index.js";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("C4 — HALT Discord alert carries the mode-change correlationId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("setMode(HALT) alert body includes the SAME correlationId written to the audit row", async () => {
    await killSwitch.setMode("HALT", "deepscan7_c4_test", "operator");

    // 1. Grab the correlationId from the production.mode_changed audit row.
    //    db.insert mock returns a shared object; its values() accumulates calls.
    const insertResults = vi.mocked(db.insert).mock.results;
    expect(insertResults.length).toBeGreaterThan(0);
    const valuesFn = insertResults[0].value.values as ReturnType<typeof vi.fn>;
    const auditCall = valuesFn.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((v) => v.action === "production.mode_changed");
    expect(auditCall).toBeDefined();
    const auditCorrelationId = auditCall!.correlationId as string;
    expect(auditCorrelationId).toMatch(UUID_RE);

    // 2. The operator Discord alert must carry the same id in its body.
    const alertCalls = vi
      .mocked(AlertFactory.systemError)
      .mock.calls.filter((c) => c[0] === "production-halt-activated");
    expect(alertCalls.length).toBeGreaterThan(0);
    const alertErr = alertCalls[0][1] as Error;
    expect(alertErr.message).toContain("CorrelationId:");
    expect(alertErr.message).toContain(auditCorrelationId);
  });

  it("non-HALT setMode does not fire the production-halt-activated alert (no regression)", async () => {
    // @ts-ignore — legacy mode string, same convention as kill-switch.test.ts
    await killSwitch.setMode("PAPER", "deepscan7_c4_non_halt", "operator");

    const alertCalls = vi
      .mocked(AlertFactory.systemError)
      .mock.calls.filter((c) => c[0] === "production-halt-activated");
    expect(alertCalls.length).toBe(0);
  });
});
