/**
 * carter-tool-registry.contract.test.ts
 *
 * Structural contract: tool registry ↔ handler map parity.
 * No network, no DB. Pure structural assertions.
 *
 * Assertions:
 *   1. Every tool name matches ^[a-z][a-z0-9_]*$ (stable URL-safe identifier).
 *   2. Tool names are unique.
 *   3. Every non-red tool's `handler` key exists in CARTER_READ_HANDLERS OR CARTER_ACTION_HANDLERS.
 *   4. No handler key in either map is absent from the registry.
 *   5. All 25 required tools are present (15 read + 10 action).
 */

// ── Mocks — prevent side-effectful service imports ────────────────────────────
// vi.mock() calls are hoisted by vitest — they run before any imports.

vi.mock("../../db/index.js", () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), execute: vi.fn() } }));
vi.mock("../../db/schema.js", () => ({
  strategies: {},
  strategyPendingBuckets: {},
  strategyPendingMentions: {},
  auditLog: {},
}));
vi.mock("../../routes/backtests.js", () => ({ getBacktestConcurrencyStats: vi.fn(() => ({ active: 0, cap: 3, saturated: false })) }));
vi.mock("../../lib/python-runner.js", () => ({ getPythonSubprocessStats: vi.fn() }));
vi.mock("../../services/paper-trading-stream.js", () => ({
  getActiveStreams: vi.fn(() => new Map()),
  stopAllStreams: vi.fn(),
}));
vi.mock("../../routes/production-status.js", () => ({
  buildProductionStatus: vi.fn(),
  buildDrawdownDistance: vi.fn(),
  productionStatusRoutes: { get: vi.fn() },
}));
vi.mock("../../routes/slumhouse/admin.js", () => ({
  computeSwitchStates: vi.fn(),
  getSwitchStates: vi.fn(),
  postSwitch: vi.fn(),
}));
vi.mock("../../routes/composite-health.js", () => ({
  buildCompositeHealthSummary: vi.fn(),
  compositeHealthRoutes: { get: vi.fn() },
}));
vi.mock("../../routes/ab-comparison.js", () => ({
  buildABComparisonData: vi.fn(),
  abComparisonRoutes: { get: vi.fn() },
}));
vi.mock("../../lib/slumhouse/kitchen-data.js", () => ({
  assembleKitchenData: vi.fn(),
  assembleTodaysMenu: vi.fn(),
}));
vi.mock("../../lib/slumhouse/crib-data.js", () => ({ assembleCribData: vi.fn() }));
vi.mock("../../services/pipeline-control-service.js", () => ({
  getMode: vi.fn(),
  setMode: vi.fn(),
  isActive: vi.fn(async () => true),
}));
vi.mock("../../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async () => true),
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Carter issue store mock (prevents DB access in contract test)
vi.mock("../../lib/carter/carter-issues-store.js", () => ({
  listOpenIssues:  vi.fn(() => []),
  hydrateFromDb:   vi.fn(async () => {}),
  upsertIssue:     vi.fn(),
  resolveIssue:    vi.fn(),
  _resetForTest:   vi.fn(),
}));
// Action handler service mocks
vi.mock("../../services/backtest-service.js", () => ({ runBacktest: vi.fn() }));
vi.mock("../../services/monte-carlo-service.js", () => ({ runMonteCarlo: vi.fn() }));
vi.mock("../../services/matrix-backtest-service.js", () => ({ runMatrix: vi.fn(), getMatrixStatus: vi.fn() }));
vi.mock("../../services/autonomous-scout-runner.js", () => ({
  runAutonomousScoutCycle: vi.fn(),
  fetchYouTubeTopVideos: vi.fn(async () => []),
}));
vi.mock("../../services/search-router.js", () => ({
  strategyHunt: vi.fn(async () => ({ query: "", depth: "advanced", totalRaw: 0, totalFused: 0, totalAfterGraveyard: 0, perProvider: {}, results: [] })),
}));
vi.mock("../../services/strategy-fingerprint.js", () => ({
  computeConceptFingerprintHash: vi.fn(() => "mock-hash"),
  extractEntryArchetype: vi.fn(() => "unknown"),
  normalizeExitType: vi.fn(() => "unknown"),
  computeFingerprintHash: vi.fn(() => "mock-hash"),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from "vitest";
import { CARTER_TOOLS, getCarterTool } from "../../lib/carter/tool-registry.js";
import { CARTER_READ_HANDLERS } from "../../lib/carter/carter-reads.js";
import { CARTER_ACTION_HANDLERS } from "../../lib/carter/carter-actions.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const TOOL_NAME_RE = /^[a-z][a-z0-9_]*$/;

const REQUIRED_READ_TOOLS = [
  "report_system_health",
  "report_production_status",
  "report_switch_states",
  "report_composite_health",
  "report_ab_comparison",
  "report_pipeline_lifecycle",
  "report_crib_today",
  "report_strategy_status",
  "report_backtest_result",
  "report_montecarlo_survival",
  "report_paper_session",
  "report_pending_buckets",
  "report_recent_alerts",
  "query_audit_log",
  "report_drawdown_status",
  "get_current_issues",
] as const;

const REQUIRED_ACTION_TOOLS = [
  "run_backtest",
  "run_walk_forward",
  "run_monte_carlo",
  "run_matrix",
  "fire_scout_cycle",
  "research_strategy_idea",
  "competitive_intel",
  "scan_youtube_for_setups",
  "deposit_pending_mention",
  "evaluate_kill_signal",
] as const;

const REQUIRED_TOOLS = [...REQUIRED_READ_TOOLS, ...REQUIRED_ACTION_TOOLS] as const;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Carter tool registry — structural contract", () => {
  it("has exactly 26 tools (16 read + 10 action)", () => {
    expect(CARTER_TOOLS).toHaveLength(26);
  });

  it("contains all required tool names", () => {
    const names = new Set(CARTER_TOOLS.map((t) => t.name));
    for (const required of REQUIRED_TOOLS) {
      expect(names.has(required), `Missing required tool: ${required}`).toBe(true);
    }
  });

  it("every tool name matches ^[a-z][a-z0-9_]*$", () => {
    for (const tool of CARTER_TOOLS) {
      expect(
        TOOL_NAME_RE.test(tool.name),
        `Tool name "${tool.name}" does not match naming pattern`
      ).toBe(true);
    }
  });

  it("tool names are unique", () => {
    const names = CARTER_TOOLS.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("every non-red tool handler key exists in CARTER_READ_HANDLERS or CARTER_ACTION_HANDLERS", () => {
    const mergedHandlers = { ...CARTER_READ_HANDLERS, ...CARTER_ACTION_HANDLERS };
    for (const tool of CARTER_TOOLS) {
      if (tool.tier === "red") continue;
      expect(
        tool.handler,
        `Tool "${tool.name}" is tier "${tool.tier}" but has no handler key`
      ).toBeDefined();
      expect(
        Object.prototype.hasOwnProperty.call(mergedHandlers, tool.handler!),
        `Handler key "${tool.handler}" for tool "${tool.name}" is missing from both CARTER_READ_HANDLERS and CARTER_ACTION_HANDLERS`
      ).toBe(true);
    }
  });

  it("no handler key in CARTER_READ_HANDLERS or CARTER_ACTION_HANDLERS is absent from the registry", () => {
    const registryHandlerKeys = new Set(
      CARTER_TOOLS.filter((t) => t.handler !== undefined).map((t) => t.handler!)
    );
    for (const key of Object.keys(CARTER_READ_HANDLERS)) {
      expect(
        registryHandlerKeys.has(key),
        `Handler key "${key}" in CARTER_READ_HANDLERS has no matching registry entry`
      ).toBe(true);
    }
    for (const key of Object.keys(CARTER_ACTION_HANDLERS)) {
      expect(
        registryHandlerKeys.has(key),
        `Handler key "${key}" in CARTER_ACTION_HANDLERS has no matching registry entry`
      ).toBe(true);
    }
  });

  it("getCarterTool returns the correct tool by name", () => {
    for (const tool of CARTER_TOOLS) {
      const found = getCarterTool(tool.name);
      expect(found).toBeDefined();
      expect(found!.name).toBe(tool.name);
      expect(found!.tier).toBe(tool.tier);
    }
  });

  it("getCarterTool returns undefined for unknown name", () => {
    expect(getCarterTool("does_not_exist")).toBeUndefined();
    expect(getCarterTool("")).toBeUndefined();
  });

  it("all green tools have a handler key", () => {
    for (const tool of CARTER_TOOLS.filter((t) => t.tier === "green")) {
      expect(
        tool.handler,
        `Green tool "${tool.name}" must have a handler key`
      ).toBeDefined();
    }
  });

  it("CARTER_READ_HANDLERS exports exactly 16 functions", () => {
    expect(Object.keys(CARTER_READ_HANDLERS)).toHaveLength(16);
  });

  it("CARTER_ACTION_HANDLERS exports exactly 10 functions", () => {
    expect(Object.keys(CARTER_ACTION_HANDLERS)).toHaveLength(10);
  });

  it("all CARTER_READ_HANDLERS values are functions", () => {
    for (const [key, fn] of Object.entries(CARTER_READ_HANDLERS)) {
      expect(typeof fn, `Handler "${key}" must be a function`).toBe("function");
    }
  });

  it("all CARTER_ACTION_HANDLERS values are functions", () => {
    for (const [key, fn] of Object.entries(CARTER_ACTION_HANDLERS)) {
      expect(typeof fn, `Action handler "${key}" must be a function`).toBe("function");
    }
  });

  it("no handler key exists in both CARTER_READ_HANDLERS and CARTER_ACTION_HANDLERS (no collision)", () => {
    const readKeys = new Set(Object.keys(CARTER_READ_HANDLERS));
    for (const key of Object.keys(CARTER_ACTION_HANDLERS)) {
      expect(
        readKeys.has(key),
        `Handler key "${key}" exists in both CARTER_READ_HANDLERS and CARTER_ACTION_HANDLERS — collision`
      ).toBe(false);
    }
  });
});
