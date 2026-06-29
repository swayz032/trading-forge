/**
 * carter-tool-registry.contract.test.ts
 *
 * Structural contract: tool registry ↔ handler map parity.
 * No network, no DB. Pure structural assertions.
 *
 * Assertions:
 *   1. Every tool name matches ^[a-z][a-z0-9_]*$ (stable URL-safe identifier).
 *   2. Tool names are unique.
 *   3. Every non-red tool's `handler` key exists in CARTER_READ_HANDLERS.
 *   4. No CARTER_READ_HANDLER key is absent from the registry.
 *   5. All 15 required tools are present.
 */

// ── Mocks — prevent side-effectful service imports ────────────────────────────
// vi.mock() calls are hoisted by vitest — they run before any imports.

vi.mock("../../db/index.js", () => ({ db: {} }));
vi.mock("../../db/schema.js", () => ({}));
vi.mock("../../routes/backtests.js", () => ({ getBacktestConcurrencyStats: vi.fn() }));
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
}));
vi.mock("../../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async () => true),
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from "vitest";
import { CARTER_TOOLS, getCarterTool } from "../../lib/carter/tool-registry.js";
import { CARTER_READ_HANDLERS } from "../../lib/carter/carter-reads.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const TOOL_NAME_RE = /^[a-z][a-z0-9_]*$/;

const REQUIRED_TOOLS = [
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
] as const;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Carter tool registry — structural contract", () => {
  it("has exactly 15 tools", () => {
    expect(CARTER_TOOLS).toHaveLength(15);
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

  it("every non-red tool handler key exists in CARTER_READ_HANDLERS", () => {
    for (const tool of CARTER_TOOLS) {
      if (tool.tier === "red") continue;
      expect(
        tool.handler,
        `Tool "${tool.name}" is tier "${tool.tier}" but has no handler key`
      ).toBeDefined();
      expect(
        Object.prototype.hasOwnProperty.call(CARTER_READ_HANDLERS, tool.handler!),
        `Handler key "${tool.handler}" for tool "${tool.name}" is missing from CARTER_READ_HANDLERS`
      ).toBe(true);
    }
  });

  it("no CARTER_READ_HANDLERS key is absent from the registry", () => {
    const registryHandlerKeys = new Set(
      CARTER_TOOLS.filter((t) => t.handler !== undefined).map((t) => t.handler!)
    );
    for (const key of Object.keys(CARTER_READ_HANDLERS)) {
      expect(
        registryHandlerKeys.has(key),
        `Handler key "${key}" in CARTER_READ_HANDLERS has no matching registry entry`
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

  it("CARTER_READ_HANDLERS exports exactly 15 functions", () => {
    expect(Object.keys(CARTER_READ_HANDLERS)).toHaveLength(15);
  });

  it("all CARTER_READ_HANDLERS values are functions", () => {
    for (const [key, fn] of Object.entries(CARTER_READ_HANDLERS)) {
      expect(typeof fn, `Handler "${key}" must be a function`).toBe("function");
    }
  });
});
