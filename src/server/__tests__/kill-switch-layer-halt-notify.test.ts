/**
 * kill-switch-layer-halt-notify.test.ts — C-1 (2026-06-29)
 *
 * Verifies that _emitLayerHaltedSignals fires exactly ONE CRITICAL Discord
 * notification per autonomous halt layer (L3–L9).
 *
 * Failure mode addressed: during unattended vacations, layers 3–9 can halt all
 * new entries with no phone alert — the dead-man heartbeat keeps writing so
 * nothing pages the operator.  After C-1, every autonomous halt reaches Discord.
 *
 * MED-4: also exercises that the audit_log write is awaited (durable) before
 * the Discord notification fires — audit first, then Discord.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted() — variables must be initialised before vi.mock() factories run.
// vi.mock() calls are hoisted to the top of the file by vitest. Any variable
// referenced inside a factory closure must also be hoisted via vi.hoisted()
// to avoid TDZ (temporal dead zone) errors.
// ─────────────────────────────────────────────────────────────────────────────

const {
  mockNotifyCritical,
  mockAppendFamilyGradePostscript,
  mockInsertAuditRow,
  mockBroadcastSSE,
} = vi.hoisted(() => {
  const mockNotifyCritical = vi.fn();
  const mockAppendFamilyGradePostscript = vi.fn(
    (body: string, what: string, action: string) =>
      `${body}\n\n--- For family members ---\nWhat this means: ${what}\nWhat to do: ${action}`,
  );
  const mockInsertAuditRow = vi.fn().mockResolvedValue(undefined);
  const mockBroadcastSSE = vi.fn();
  return {
    mockNotifyCritical,
    mockAppendFamilyGradePostscript,
    mockInsertAuditRow,
    mockBroadcastSSE,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// vi.mock() declarations — hoisted by vitest; factories run lazily
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: mockNotifyCritical,
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: mockAppendFamilyGradePostscript,
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: mockInsertAuditRow,
  insertAuditRowSafe: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: mockBroadcastSSE,
  LIFECYCLE_GATE_EVENTS: {},
  FACTORY_EVENTS: [],
  WAVE29_EVENTS: [],
  PINE_EVENTS: [],
  ARCHETYPE_ROUTING_EVENTS: [],
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([
            {
              productionMode: "PAPER",
              killReason: null,
              setBy: "test",
              setAt: new Date(),
            },
          ]),
        })),
        orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
        limit: vi.fn().mockResolvedValue([]),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: "inserted-id" }]),
        catch: vi.fn().mockResolvedValue(undefined),
        then(
          resolve: (v: unknown[]) => unknown,
          reject?: (err: unknown) => unknown,
        ) {
          return Promise.resolve([{ id: "inserted-id" }]).then(resolve, reject);
        },
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    })),
    execute: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../db/schema.js", () => ({
  systemState: { id: "id", productionMode: "production_mode" },
  auditLog: { action: "action" },
  weeklyDriftReports: {
    severity: "severity",
    reportWeek: "report_week",
    ranAt: "ran_at",
  },
  brokerAccounts: { firmId: "firm_id", enabled: "enabled" },
  paperSessions: {
    id: "id",
    firmId: "firm_id",
    status: "status",
    currentEquity: "current_equity",
    realizedPeakEquity: "realized_peak_equity",
    dailyPnlBreakdown: "daily_pnl_breakdown",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => `eq(${String(val)})`),
  and: vi.fn((...args: unknown[]) => `and(${args.join(",")})`),
  desc: vi.fn(() => "desc"),
  gte: vi.fn(),
  lte: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: {
    systemError: vi.fn(),
    notifyAbsentAutoPromoteFailed: vi.fn().mockResolvedValue(undefined),
  },
  createAlert: vi.fn().mockResolvedValue({ id: "alert-id" }),
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
  evaluateMacroGates: vi.fn().mockResolvedValue({
    macroContext: { crisisGateTriggered: false },
  }),
}));

vi.mock("../services/windows-health-check-service.js", () => ({
  runPreTradingDayHealthCheck: vi.fn().mockResolvedValue({ status: "healthy" }),
}));

vi.mock("../services/paper-execution-service.js", () => ({
  forceCloseAllPositions: vi.fn().mockResolvedValue({ count: 0, closed: 0, stuck: 0 }),
}));

vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn().mockReturnValue({ dailyLossLimit: 1000, maxDrawdown: 2000 }),
  getFirmLimit: vi.fn().mockReturnValue({ maxContracts: 50 }),
  CONTRACT_CAP_MAX: 60,
}));

vi.mock("../lib/metrics-registry.js", () => ({
  cronJobsConcurrent: { inc: vi.fn(), dec: vi.fn() },
  activeSSEConnections: { set: vi.fn() },
  traderspostRejectsTotal: { inc: vi.fn() },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Module under test (loaded after all vi.mock() calls are registered)
// ─────────────────────────────────────────────────────────────────────────────

import { killSwitch } from "../production/kill-switch.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Call the private method directly via bracket notation to avoid TypeScript private access error. */
async function callEmitSignals(
  layer: number,
  reason: string,
  correlationId = "test-corr-id",
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (killSwitch as any)._emitLayerHaltedSignals(
    { halted: true, layer, reason },
    correlationId,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suites
// ─────────────────────────────────────────────────────────────────────────────

describe("C-1: _emitLayerHaltedSignals fires CRITICAL Discord on autonomous halt (L3–L9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertAuditRow.mockResolvedValue(undefined);
    mockAppendFamilyGradePostscript.mockImplementation(
      (body: string, what: string, action: string) =>
        `${body}\n\n--- For family members ---\nWhat this means: ${what}\nWhat to do: ${action}`,
    );
  });

  const HALT_LAYERS = [3, 4, 5, 6, 7, 8, 9] as const;

  for (const layer of HALT_LAYERS) {
    it(`Layer ${layer}: fires exactly one notifyCritical with body mentioning "Layer ${layer}"`, async () => {
      await callEmitSignals(layer, `test_halt_L${layer}`, `corr-L${layer}`);

      expect(mockNotifyCritical).toHaveBeenCalledTimes(1);

      const callArgs = mockNotifyCritical.mock.calls[0] as [string, string, ...unknown[]];
      const body = callArgs[1];
      expect(typeof body).toBe("string");
      // Body must mention the layer number so the operator knows which layer fired
      expect(body).toContain(String(layer));
    });
  }

  it("appendFamilyGradePostscript is called once per halt with non-empty plain-English text", async () => {
    await callEmitSignals(6, "cme_outage_active", "corr-postscript-test");

    expect(mockAppendFamilyGradePostscript).toHaveBeenCalledTimes(1);

    const [, familyWhat, familyAction] =
      mockAppendFamilyGradePostscript.mock.calls[0] as [string, string, string];
    expect(typeof familyWhat).toBe("string");
    expect(familyWhat.length).toBeGreaterThan(20);
    expect(typeof familyAction).toBe("string");
    expect(familyAction.length).toBeGreaterThan(20);
  });

  it("notifyCritical is not called for layer 0 (no LAYER_LABELS entry for unknown layer)", async () => {
    await callEmitSignals(0, "unknown_reason", "corr-zero-layer");
    // Layer 0 has no label entry — guard must prevent Discord fire
    expect(mockNotifyCritical).not.toHaveBeenCalled();
  });
});

describe("MED-4: halt audit_log write is awaited (durable) before Discord fires", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertAuditRow.mockResolvedValue(undefined);
  });

  it("insertAuditRow completes before notifyCritical is called (audit-first order)", async () => {
    const callOrder: string[] = [];

    mockInsertAuditRow.mockImplementation(async () => {
      callOrder.push("audit");
    });
    mockNotifyCritical.mockImplementation(() => {
      callOrder.push("discord");
    });
    mockAppendFamilyGradePostscript.mockReturnValue("family-grade body text");

    await callEmitSignals(6, "cme_outage_active", "corr-order-test");

    // Audit write must complete (awaited) before Discord fires
    expect(callOrder[0]).toBe("audit");
    expect(callOrder[1]).toBe("discord");
  });

  it("audit write failure is caught — notifyCritical still fires and no throw", async () => {
    mockInsertAuditRow.mockRejectedValue(new Error("DB down during halt"));
    mockAppendFamilyGradePostscript.mockReturnValue("family-grade body text");

    // Must not throw even when audit write fails
    await expect(
      callEmitSignals(4, "connectivity_degraded", "corr-audit-fail"),
    ).resolves.toBeUndefined();

    // Discord fires despite audit failure (fail-safe: operator must be paged)
    expect(mockNotifyCritical).toHaveBeenCalledTimes(1);
  });
});
