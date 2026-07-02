/**
 * carter-red-refusal.test.ts — RED refusal surface (Wave 5 Task 5.3).
 *
 * The governance guarantee: RED tools are DOCUMENTED in the registry but have NO
 * tool path. For EACH red tool:
 *   (a) the registry entry is tier 'red' with handler: null
 *   (b) there is NO matching handler in read/action/confirm maps
 *   (c) POST /api/carter/<redtool> returns 403 red_action_no_tool_path
 */

// ── Mocks — load the real registry + real handler maps under safe stubs ─────────

vi.mock("../../db/index.js", () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), execute: vi.fn() } }));
vi.mock("../../db/schema.js", () => ({
  strategies: {}, strategyPendingBuckets: {}, strategyPendingMentions: {}, auditLog: {},
  systemState: {}, systemParameters: {},
}));
vi.mock("../../routes/backtests.js", () => ({ getBacktestConcurrencyStats: vi.fn(() => ({ active: 0, cap: 3, saturated: false })) }));
vi.mock("../../lib/python-runner.js", () => ({ getPythonSubprocessStats: vi.fn() }));
vi.mock("../../services/paper-trading-stream.js", () => ({ getActiveStreams: vi.fn(() => new Map()), stopAllStreams: vi.fn() }));
vi.mock("../../routes/production-status.js", () => ({ buildProductionStatus: vi.fn(), buildDrawdownDistance: vi.fn(), productionStatusRoutes: { get: vi.fn() } }));
vi.mock("../../routes/slumhouse/admin.js", () => ({ computeSwitchStates: vi.fn(), getSwitchStates: vi.fn(), postSwitch: vi.fn() }));
vi.mock("../../routes/composite-health.js", () => ({ buildCompositeHealthSummary: vi.fn(), compositeHealthRoutes: { get: vi.fn() } }));
vi.mock("../../routes/ab-comparison.js", () => ({ buildABComparisonData: vi.fn(), abComparisonRoutes: { get: vi.fn() } }));
vi.mock("../../lib/slumhouse/kitchen-data.js", () => ({ assembleKitchenData: vi.fn(), assembleTodaysMenu: vi.fn() }));
vi.mock("../../lib/slumhouse/crib-data.js", () => ({ assembleCribData: vi.fn() }));
vi.mock("../../services/pipeline-control-service.js", () => ({ getMode: vi.fn(), setMode: vi.fn(), isActive: vi.fn(async () => true) }));
vi.mock("../../services/backtest-service.js", () => ({ runBacktest: vi.fn() }));
vi.mock("../../services/monte-carlo-service.js", () => ({ runMonteCarlo: vi.fn() }));
vi.mock("../../services/matrix-backtest-service.js", () => ({ runMatrix: vi.fn(), getMatrixStatus: vi.fn() }));
vi.mock("../../services/autonomous-scout-runner.js", () => ({ runAutonomousScoutCycle: vi.fn(), fetchYouTubeTopVideos: vi.fn(async () => []) }));
vi.mock("../../services/search-router.js", () => ({ strategyHunt: vi.fn() }));
vi.mock("../../services/strategy-fingerprint.js", () => ({ computeConceptFingerprintHash: vi.fn(() => "h"), extractEntryArchetype: vi.fn(() => "unknown"), normalizeExitType: vi.fn(() => "unknown") }));
vi.mock("../../lib/audit-log-helper.js", () => ({ insertAuditRowSafe: vi.fn(async () => true) }));
vi.mock("../../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../lib/carter/carter-issues-store.js", () => ({
  listOpenIssues: vi.fn(() => []), hydrateFromDb: vi.fn(async () => {}), upsertIssue: vi.fn(), resolveIssue: vi.fn(), _resetForTest: vi.fn(),
}));
// Auth passes — the RED 403 must happen AFTER auth (it is a tier decision, not an auth failure).
vi.mock("../../lib/carter/carter-auth.js", () => ({ verifyCarterToolAuth: vi.fn(() => ({ ok: true })) }));

// ── Imports ─────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { CARTER_TOOLS, getCarterTool } from "../../lib/carter/tool-registry.js";
import { CARTER_READ_HANDLERS } from "../../lib/carter/carter-reads.js";
import { CARTER_ACTION_HANDLERS, CARTER_CONFIRM_HANDLERS } from "../../lib/carter/carter-actions.js";
import { carterToolsRouter } from "../../routes/carter-tools.js";

const RED_TOOLS = [
  "enable_live_execution", "place_live_order", "open_position", "clear_kill_switch",
  "clear_safety_autopause", "clear_stuck_session", "delete_backtest", "delete_strategy",
  "set_gate_threshold", "set_compliance_shadow", "edit_framework_sizing", "enable_cloud_quantum",
  "assign_rl_challenger", "manage_n8n_workflow", "kasa_power_cycle", "disable_safety_cron",
];

function makeReq(tool: string): Request {
  return { params: { tool }, headers: { authorization: "Bearer ok" }, body: {}, id: "cid" } as unknown as Request;
}
function makeRes() {
  let _status = 200; let _body: unknown;
  const res = {
    status: vi.fn((c: number) => { _status = c; return res; }),
    json: vi.fn((b: unknown) => { _body = b; }),
    getStatus: () => _status, getBody: () => _body,
  };
  return res as unknown as Response & { getStatus: () => number; getBody: () => unknown };
}
async function callRoute(req: Request, res: Response): Promise<void> {
  const layer = (carterToolsRouter as unknown as { stack: Array<{ route: { path: string; stack: Array<{ handle: (r: Request, rs: Response) => Promise<void> }> } }> }).stack.find(
    (l) => l.route?.path === "/:tool",
  );
  if (!layer) throw new Error("Route /:tool not registered");
  await layer.route.stack[0].handle(req, res);
}

describe("Carter RED refusal surface", () => {
  it("registry contains all 16 red tools, each tier 'red' with handler null", () => {
    for (const name of RED_TOOLS) {
      const tool = getCarterTool(name);
      expect(tool, `red tool ${name} missing`).toBeDefined();
      expect(tool!.tier).toBe("red");
      expect(tool!.handler).toBeNull();
    }
    expect(CARTER_TOOLS.filter((t) => t.tier === "red")).toHaveLength(16);
  });

  it("no red tool has a handler in read/action/confirm maps", () => {
    const merged = { ...CARTER_READ_HANDLERS, ...CARTER_ACTION_HANDLERS, ...CARTER_CONFIRM_HANDLERS };
    for (const name of RED_TOOLS) {
      expect(Object.prototype.hasOwnProperty.call(merged, name), `${name} must have no handler`).toBe(false);
    }
  });

  it.each(RED_TOOLS)("POST /api/carter/%s returns 403 red_action_no_tool_path", async (name) => {
    const req = makeReq(name);
    const res = makeRes();
    await callRoute(req, res as unknown as Response);
    expect(res.getStatus()).toBe(403);
    expect((res.getBody() as { error: string }).error).toBe("red_action_no_tool_path");
  });
});
