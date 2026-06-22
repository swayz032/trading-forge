/**
 * test_kill_switch_blocks_cron.ts — HIGH #13: killSwitch.isHaltedForProduction()
 * is the FIRST gate on checkAutoPromotions, checkAutoDemotions, checkPilotAutoPromotions.
 *
 * Verifies that:
 *   - checkAutoPromotions returns [] immediately when killSwitch is halted
 *   - checkAutoDemotions returns [] immediately when killSwitch is halted
 *   - checkPilotAutoPromotions returns zero-counts when killSwitch is halted
 *   - When NOT halted, functions proceed normally (DB is queried)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── kill-switch mock — togglable ──────────────────────────────────────────────
// vi.mock() is hoisted above variable declarations so we cannot reference
// a variable defined in module scope inside the factory. Use vi.hoisted() to
// create the mock function before the factory runs.
const mockIsHalted = vi.hoisted(() => vi.fn().mockResolvedValue(false));

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: mockIsHalted },
}));

vi.mock("../db/index.js", () => {
  const selectChain: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    groupBy: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
  };
  const dbMock = {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    transaction: vi.fn().mockImplementation(async (cb: Function) => { await cb(dbMock); }),
    _selectChain: selectChain,
  };
  return { db: dbMock };
});

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("./alert-service.js", () => ({
  AlertFactory: { deployReady: vi.fn().mockResolvedValue(undefined), decayAlert: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("./evolution-service.js", () => ({ evolveStrategy: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("./pine-export-service.js", () => ({
  compileDualPineExport: vi.fn().mockResolvedValue({ id: "pine-uuid" }),
  checkExportability: vi.fn().mockResolvedValue({ ok: true, score: 100, band: "green", deductions: [] }),
}));
vi.mock("./notification-service.js", () => ({
  notifyInfo: vi.fn().mockResolvedValue(undefined),
  notifyCritical: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./pipeline-control-service.js", () => ({ isActive: vi.fn().mockResolvedValue(true) }));
vi.mock("./agent-coordinator-service.js", () => ({
  agentCoordinator: { notify: vi.fn(), register: vi.fn(), emit: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/tracing.js", () => {
  const span = { setAttribute: vi.fn(), end: vi.fn() };
  return { tracer: { startSpan: vi.fn().mockReturnValue(span) }, OTEL_AVAILABLE: false };
});
vi.mock("./adversarial-stress-service.js", () => ({ getLatestAdversarialStressRun: vi.fn().mockResolvedValue(null) }));
vi.mock("./frankenstein-service.js", () => ({
  getLatestFrankensteinRun: vi.fn().mockResolvedValue({ passed: true, runId: "frank-1", p95Sharpe: 0.1, medianPf: 1.0 }),
}));
vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/metrics-registry.js", () => ({
  strategyPromotions: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
}));
vi.mock("./multi-firm-promotion-service.js", () => ({
  evaluateMultiFirmEligibility: vi.fn().mockResolvedValue(undefined),
}));

import { LifecycleService } from "./lifecycle-service.js";
import { db } from "../db/index.js";
// WHY: lifecycle-service.ts imports logger from ../lib/logger.js (NOT ../index.js).
// Asserting against the ../index.js mock inspects a different vi.fn() that the
// source never calls — the halt-warn was logged to the lib/logger mock.
// (See feedback_helper_logger_import.md.)
import { logger } from "../lib/logger.js";

describe("LifecycleService — HIGH #13: killSwitch first gate on auto-check methods", () => {
  let svc: LifecycleService;

  beforeEach(() => {
    svc = new LifecycleService();
    vi.clearAllMocks();
    mockIsHalted.mockResolvedValue(false);
  });

  describe("checkAutoPromotions", () => {
    it("returns [] immediately when killSwitch is halted, without querying DB", async () => {
      mockIsHalted.mockResolvedValue(true);

      const result = await svc.checkAutoPromotions({ correlationId: "test-cid" });

      expect(result).toEqual([]);
      // DB.select should NOT have been called (no strategy queries)
      expect((db.select as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it("logs a warn when halted", async () => {
      mockIsHalted.mockResolvedValue(true);

      await svc.checkAutoPromotions({ correlationId: "test-cid" });

      const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
      const haltedLog = warnCalls.find((args: unknown[]) =>
        typeof args[1] === "string" && (args[1] as string).includes("killSwitch halted"),
      );
      expect(haltedLog).toBeDefined();
    });

    it("proceeds to query DB when not halted — killSwitch checked before any DB call", async () => {
      mockIsHalted.mockResolvedValue(false);

      // checkAutoPromotions may throw due to mock DB chain not being iterable (no then()),
      // but what matters is that isHaltedForProduction was called (not short-circuited)
      // and db.select was called — meaning the function entered the main loop.
      try {
        await svc.checkAutoPromotions({ correlationId: "test-cid" });
      } catch {
        // Mock DB chain incompatibility is expected — the important check is below.
      }

      expect(mockIsHalted).toHaveBeenCalled();
      expect((db.select as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe("checkAutoDemotions", () => {
    it("returns [] immediately when killSwitch is halted", async () => {
      mockIsHalted.mockResolvedValue(true);

      const result = await svc.checkAutoDemotions({ correlationId: "test-cid" });

      expect(result).toEqual([]);
      expect((db.select as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it("proceeds to query DB when not halted — killSwitch checked before DB", async () => {
      mockIsHalted.mockResolvedValue(false);

      try {
        await svc.checkAutoDemotions({ correlationId: "test-cid" });
      } catch {
        // Mock DB chain incompatibility is expected
      }

      expect(mockIsHalted).toHaveBeenCalled();
      expect((db.select as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe("checkPilotAutoPromotions", () => {
    it("returns zero-counts immediately when killSwitch is halted", async () => {
      mockIsHalted.mockResolvedValue(true);

      const result = await svc.checkPilotAutoPromotions({ correlationId: "test-cid" });

      expect(result.swept).toBe(0);
      expect(result.promoted).toBe(0);
      expect(result.killed).toBe(0);
      expect(result.pending).toBe(0);
      expect(result.errors).toBe(0);
      expect((db.select as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it("proceeds to query DB when not halted — killSwitch checked before DB", async () => {
      mockIsHalted.mockResolvedValue(false);

      try {
        await svc.checkPilotAutoPromotions({ correlationId: "test-cid" });
      } catch {
        // Mock DB chain incompatibility is expected
      }

      expect(mockIsHalted).toHaveBeenCalled();
      expect((db.select as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });
  });
});
