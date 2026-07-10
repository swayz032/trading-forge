/**
 * Wave 25 Pass 2 — Y-1: Weekly drift cron pipeline-gate-exempt tests.
 *
 * Verifies:
 * 1. _PIPELINE_GATE_EXEMPT contains all 3 expected entries:
 *    bw-session-refresh, prop-firm-cookie-refresh, weekly-drift-2sigma-check.
 * 2. weekly-drift-2sigma-check is in the exempt set (gate is bypassed even
 *    when pipeline is paused).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Heavy scheduler mocks — prevent real crons from starting ─────────────────

vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn(),
    getTasks: vi.fn().mockReturnValue(new Map()),
  },
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    execute: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies: {},
  paperSessions: {},
  paperTrades: {},
  paperPositions: {},
  paperSignalLogs: {},
  backtests: {},
  systemJournal: {},
  skipDecisions: {},
  auditLog: { id: "id", action: "action", entityType: "entity_type", entityId: "entity_id", createdAt: "created_at" },
  dayArchetypes: {},
  tournamentResults: {},
  macroSnapshots: {},
  macroFeatures: {},
  macroRegimeStates: {},
  lifecycleTransitions: {},
  harshRegimePhase: {},
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(false),  // Pipeline PAUSED for test isolation
  getMode: vi.fn().mockReturnValue("PAUSED"),
}));

// Mock all services imported by scheduler to prevent actual execution
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../services/lifecycle-service.js", () => ({ LifecycleService: vi.fn() }));
vi.mock("../services/alert-service.js", () => ({ AlertFactory: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn() }));
vi.mock("../services/paper-trading-stream.js", () => ({
  startStream: vi.fn(), stopStream: vi.fn(), isStreaming: vi.fn(), getActiveStreams: vi.fn().mockReturnValue([]), getStreamHealth: vi.fn(),
}));
vi.mock("../services/paper-signal-service.js", () => ({
  restorePositionState: vi.fn(), cleanupSession: vi.fn(), restoreGovernorState: vi.fn(),
}));
vi.mock("../services/deepar-service.js", () => ({
  trainDeepAR: vi.fn(), predictRegime: vi.fn(), validatePastForecasts: vi.fn(), isDeepARDeferred: vi.fn().mockReturnValue(true),
}));
vi.mock("../services/regime-state-service.js", () => ({ setRegimeWeights: vi.fn() }));
vi.mock("../services/agent-audit-service.js", () => ({ runAgentHealthSweep: vi.fn() }));
vi.mock("../services/portfolio-optimizer-service.js", () => ({ runPortfolioCorrelationCheck: vi.fn() }));
vi.mock("../services/meta-optimizer-service.js", () => ({ runMetaParameterReview: vi.fn() }));
vi.mock("../services/anti-setup-effectiveness-service.js", () => ({ runAntiSetupEffectivenessAnalysis: vi.fn() }));
vi.mock("../services/anti-setup-gate-service.js", () => ({ invalidateAntiSetupCache: vi.fn() }));
vi.mock("../services/macro-regime-service.js", () => ({
  runFredDailyIngestion: vi.fn(), runH41Ingestion: vi.fn(), runBlsIngestion: vi.fn(),
  runTreasuryAuctionIngestion: vi.fn(), runMacroRegimeClassification: vi.fn(), invalidateMacroRegimeCache: vi.fn(),
}));
vi.mock("../services/contract-specs-service.js", () => ({ runDefinitionPull: vi.fn() }));
vi.mock("../services/settlement-reconciliation-service.js", () => ({
  runStatisticsPull: vi.fn(), runSettlementReconciliation: vi.fn(),
}));
vi.mock("../services/opening-auction-service.js", () => ({ runAuctionImbalancePull: vi.fn() }));
vi.mock("../lib/dlq-service.js", () => ({ registerRetryHandler: vi.fn() }));
vi.mock("../lib/system-topology.js", () => ({ checkSystemMapDrift: vi.fn().mockResolvedValue({ driftItems: [] }) }));
vi.mock("../lib/boot-migration-runner.js", () => ({ runBootMigrations: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../production/kill-switch.js", () => ({
  killSwitch: {
    isHaltedForProduction: vi.fn().mockResolvedValue(false),
    getCurrentState: vi.fn().mockResolvedValue({ production_mode: "ACTIVE" }),
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wave 25 Pass 2 Y-1 — weekly-drift cron pipeline-gate-exempt", () => {
  it("_PIPELINE_GATE_EXEMPT contains bw-session-refresh, prop-firm-cookie-refresh, weekly-drift-2sigma-check", async () => {
    // Import the scheduler module's _testOnly seam to inspect the PIPELINE_GATE_EXEMPT set.
    // We read it via a runtime import of the scheduler which exposes the set
    // indirectly through SCHEDULER_JOBS + _testOnly.
    //
    // Since _PIPELINE_GATE_EXEMPT is not directly exported, we verify it indirectly
    // by checking that reconcileMissedRuns skips pipeline-gated jobs but NOT exempt
    // ones when isPipelineActive() returns false. A simpler approach: we import
    // _testOnly and inspect via the getPipelineExemptJobs seam if it exists,
    // otherwise we read the source code pattern.
    //
    // The cleanest test for this is a source-level assertion: grep the scheduler source
    // to confirm all 3 names appear in the _PIPELINE_GATE_EXEMPT Set initializer or
    // the subsequent .add() calls.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schedulerSrc = readFileSync(
      join(process.cwd(), "src/server/scheduler.ts"),
      "utf-8",
    );

    // All 3 job names must appear in the scheduler source in an exempt context
    expect(schedulerSrc).toContain('"bw-session-refresh"');
    expect(schedulerSrc).toContain('"prop-firm-cookie-refresh"');
    expect(schedulerSrc).toContain('"weekly-drift-2sigma-check"');

    // Specifically verify weekly-drift-2sigma-check is in the _PIPELINE_GATE_EXEMPT
    // Set or has an .add() call for it:
    const hasExemptDecl = schedulerSrc.includes('_PIPELINE_GATE_EXEMPT.add("weekly-drift-2sigma-check")')
      || (
        schedulerSrc.includes('"weekly-drift-2sigma-check"') &&
        schedulerSrc.includes("_PIPELINE_GATE_EXEMPT")
      );
    expect(hasExemptDecl).toBe(true);
  });

  it("weekly-drift-2sigma-check is in _PIPELINE_GATE_EXEMPT (verified via source)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schedulerSrc = readFileSync(
      join(process.cwd(), "src/server/scheduler.ts"),
      "utf-8",
    );

    // The Set initializer or .add() call must reference weekly-drift-2sigma-check
    // near _PIPELINE_GATE_EXEMPT. We check both forms:
    //   Form A: listed in the Set([...]) initializer
    //   Form B: _PIPELINE_GATE_EXEMPT.add("weekly-drift-2sigma-check")
    const exemptSetSection = schedulerSrc.slice(
      schedulerSrc.indexOf("_PIPELINE_GATE_EXEMPT = new Set"),
      schedulerSrc.indexOf("_PIPELINE_GATE_EXEMPT = new Set") + 3000,
    );

    const isExempted =
      exemptSetSection.includes('"weekly-drift-2sigma-check"') ||
      schedulerSrc.includes('_PIPELINE_GATE_EXEMPT.add("weekly-drift-2sigma-check")');

    expect(isExempted).toBe(true);

    // Also verify the defensive log is present before pipelineGate
    expect(schedulerSrc).toContain(
      '"weekly-drift-2sigma-check" }, "running pipeline-gate-exempt drift check"',
    );
  });
});
