/**
 * carter-tool-registry.contract.test.ts
 *
 * Structural contract: tool registry ↔ handler map parity.
 * No network, no DB. Pure structural assertions.
 *
 * Assertions:
 *   1. Every tool name matches ^[a-z][a-z0-9_]*$ (stable URL-safe identifier).
 *   2. Tool names are unique.
 *   3. Every NON-red tool's `handler` key exists in one of the three handler maps
 *      (READ / ACTION / CONFIRM).
 *   4. No handler key in any map is absent from the registry.
 *   5. Every RED tool has tier 'red', handler null, and NO entry in any handler map.
 *   6. Counts: 16 read + 12 action + 18 yellow (9 propose/confirm pairs) + 16 red.
 *      (Wave 7: research_strategy_idea removed; +extract_youtube_strategy,
 *       +research_reddit, +institutional_research → action 10 → 12.)
 */

// ── Mocks — prevent side-effectful service imports ────────────────────────────
// vi.mock() calls are hoisted by vitest — they run before any imports.

vi.mock("../../db/index.js", () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), execute: vi.fn() } }));
vi.mock("../../db/schema.js", () => ({
  strategies: {},
  strategyPendingBuckets: {},
  strategyPendingMentions: {},
  auditLog: {},
  systemState: {},
  systemParameters: {},
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
import { CARTER_ACTION_HANDLERS, CARTER_CONFIRM_HANDLERS } from "../../lib/carter/carter-actions.js";

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
  // Introspection tools (carter-introspect.ts) — "knows every inch of Trading Forge"
  "explain_gate",
  "list_subsystems",
  "summarize_subsystem",
  "read_strategy_internals",
  "trace_correlation",
  "read_recent_decisions",
  "read_system_map",
  // Recommendation-engine tools (carter-recommend.ts) — grounded raw material for fixes
  "diagnose_pipeline",
  "analyze_gate_blocks",
  "review_strategy",
  "find_hardening_opportunities",
  // Memory continuity read tool (carter-memory-store.ts)
  "recall",
  // Daily Analyst read tool (carter-insights.ts) — proactive insight surface
  "get_daily_insights",
] as const;

const REQUIRED_ACTION_TOOLS = [
  "run_backtest",
  "run_walk_forward",
  "run_monte_carlo",
  "run_matrix",
  "fire_scout_cycle",
  "competitive_intel",
  "scan_youtube_for_setups",
  "extract_youtube_strategy",
  "research_reddit",
  "institutional_research",
  "deposit_pending_mention",
  "evaluate_kill_signal",
  "save_code_draft",
  // Memory continuity action tool (carter-memory-store.ts)
  "remember",
] as const;

// 9 YELLOW capabilities, each a propose_/confirm_ pair = 18 tools.
const YELLOW_CAPABILITIES = [
  "toggle_bot_power",
  "set_learning_loop_mode",
  "toggle_vacation_mode",
  "self_restart",
  "trigger_n8n_workflow",
  "run_quantum",
  "request_lifecycle_check",
  "request_promotion",
  "rearm_scheduler_job",
] as const;

const REQUIRED_YELLOW_TOOLS = YELLOW_CAPABILITIES.flatMap((c) => [`propose_${c}`, `confirm_${c}`]);

const REQUIRED_RED_TOOLS = [
  "enable_live_execution",
  "place_live_order",
  "open_position",
  "clear_kill_switch",
  "clear_safety_autopause",
  "clear_stuck_session",
  "delete_backtest",
  "delete_strategy",
  "set_gate_threshold",
  "set_compliance_shadow",
  "edit_framework_sizing",
  "enable_cloud_quantum",
  "assign_rl_challenger",
  "manage_n8n_workflow",
  "kasa_power_cycle",
  "disable_safety_cron",
] as const;

const REQUIRED_TOOLS = [
  ...REQUIRED_READ_TOOLS,
  ...REQUIRED_ACTION_TOOLS,
  ...REQUIRED_YELLOW_TOOLS,
  ...REQUIRED_RED_TOOLS,
] as const;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Carter tool registry — structural contract", () => {
  it("has exactly 77 tools (29 read + 14 action + 18 yellow + 16 red)", () => {
    expect(CARTER_TOOLS).toHaveLength(77);
    expect(CARTER_TOOLS.filter((t) => t.tier === "green")).toHaveLength(43);
    expect(CARTER_TOOLS.filter((t) => t.tier === "yellow")).toHaveLength(18);
    expect(CARTER_TOOLS.filter((t) => t.tier === "red")).toHaveLength(16);
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

  it("every NON-red tool handler key exists in one of the three handler maps", () => {
    const mergedHandlers = { ...CARTER_READ_HANDLERS, ...CARTER_ACTION_HANDLERS, ...CARTER_CONFIRM_HANDLERS };
    for (const tool of CARTER_TOOLS) {
      if (tool.tier === "red") continue;
      expect(
        typeof tool.handler === "string",
        `Tool "${tool.name}" is tier "${tool.tier}" but has no handler key`
      ).toBe(true);
      expect(
        Object.prototype.hasOwnProperty.call(mergedHandlers, tool.handler as string),
        `Handler key "${tool.handler}" for tool "${tool.name}" is missing from all three handler maps`
      ).toBe(true);
    }
  });

  it("no handler key in any map is absent from the registry", () => {
    const registryHandlerKeys = new Set(
      CARTER_TOOLS.filter((t) => typeof t.handler === "string").map((t) => t.handler as string)
    );
    for (const map of [CARTER_READ_HANDLERS, CARTER_ACTION_HANDLERS, CARTER_CONFIRM_HANDLERS]) {
      for (const key of Object.keys(map)) {
        expect(
          registryHandlerKeys.has(key),
          `Handler key "${key}" has no matching registry entry`
        ).toBe(true);
      }
    }
  });

  it("every RED tool is tier 'red' with handler null and NO handler in any map", () => {
    const mergedHandlers = { ...CARTER_READ_HANDLERS, ...CARTER_ACTION_HANDLERS, ...CARTER_CONFIRM_HANDLERS };
    for (const name of REQUIRED_RED_TOOLS) {
      const tool = getCarterTool(name);
      expect(tool, `RED tool "${name}" missing from registry`).toBeDefined();
      expect(tool!.tier).toBe("red");
      expect(tool!.handler, `RED tool "${name}" must have handler null`).toBeNull();
      expect(
        Object.prototype.hasOwnProperty.call(mergedHandlers, name),
        `RED tool "${name}" must NOT have a handler in any map`
      ).toBe(false);
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

  it("all green + yellow tools have a handler key; no red tool has one", () => {
    for (const tool of CARTER_TOOLS) {
      if (tool.tier === "red") {
        expect(tool.handler, `Red tool "${tool.name}" must not have a handler`).toBeNull();
      } else {
        expect(
          typeof tool.handler === "string",
          `${tool.tier} tool "${tool.name}" must have a handler key`
        ).toBe(true);
      }
    }
  });

  it("CARTER_READ_HANDLERS exports exactly 29 functions (16 base + 7 introspection + 4 recommend + 1 memory + 1 insights)", () => {
    expect(Object.keys(CARTER_READ_HANDLERS)).toHaveLength(29);
  });

  it("CARTER_ACTION_HANDLERS exports exactly 14 functions", () => {
    expect(Object.keys(CARTER_ACTION_HANDLERS)).toHaveLength(14);
  });

  it("CARTER_CONFIRM_HANDLERS exports exactly 18 functions (9 propose + 9 confirm)", () => {
    expect(Object.keys(CARTER_CONFIRM_HANDLERS)).toHaveLength(18);
  });

  it("all handler-map values are functions", () => {
    for (const map of [CARTER_READ_HANDLERS, CARTER_ACTION_HANDLERS, CARTER_CONFIRM_HANDLERS]) {
      for (const [key, fn] of Object.entries(map)) {
        expect(typeof fn, `Handler "${key}" must be a function`).toBe("function");
      }
    }
  });

  it("no handler key exists in more than one map (no collision)", () => {
    const seen = new Set<string>();
    for (const map of [CARTER_READ_HANDLERS, CARTER_ACTION_HANDLERS, CARTER_CONFIRM_HANDLERS]) {
      for (const key of Object.keys(map)) {
        expect(seen.has(key), `Handler key "${key}" exists in more than one map — collision`).toBe(false);
        seen.add(key);
      }
    }
  });
});
