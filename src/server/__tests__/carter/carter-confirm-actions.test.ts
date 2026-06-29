/**
 * carter-confirm-actions.test.ts — YELLOW confirm-action handlers (Wave 5 Task 5.2).
 *
 * For each confirm_*:
 *   - REJECTS without a valid token → { error: 'confirmation_required' } and NO mutation.
 *   - With a valid token: calls the underlying service (mocked) + writes the
 *     carter.action_executed audit row (decision_authority='voice_agent').
 * Plus:
 *   - set_learning_loop_mode down-shift (OFF/OBSERVE) needs NO token; up-shift (AUTOPILOT) does.
 *   - request_promotion that hits a gate block RETURNS the block reason and does NOT mutate.
 */

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  promote: vi.fn(async (): Promise<{ success: boolean; error?: string }> => ({ success: true })),
  checkPromo: vi.fn(async () => ["s1"]),
  checkDemo: vi.fn(async () => [] as string[]),
  enableJob: vi.fn(() => true),
  runQuantumMC: vi.fn(async () => ({ id: "qmc-1" })),
  clearMarkers: vi.fn(async () => ({ clearedSince: new Date(), clearedPending: null })),
  setMode: vi.fn(async () => ({ previousMode: "ACTIVE", newMode: "PAUSED" })),
  isActive: vi.fn(async () => true),
  insertAudit: vi.fn(async () => true),
  dbUpdateSet: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  dbInsertValues: vi.fn(async () => undefined),
}));

vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ lifecycleState: "PAPER", id: "param-1" }]),
      })),
    })),
    update: vi.fn(() => ({ set: mocks.dbUpdateSet })),
    insert: vi.fn(() => ({ values: mocks.dbInsertValues })),
    execute: vi.fn(async () => []),
  },
}));

vi.mock("../../db/schema.js", () => ({
  strategies: { id: "c", lifecycleState: "c" },
  strategyPendingBuckets: { fingerprintHash: "c", id: "c" },
  strategyPendingMentions: {},
  auditLog: {},
  systemState: { id: "c", operatorAbsentSince: "c" },
  systemParameters: { id: "c", paramName: "c" },
}));

// Static service imports of carter-actions.ts (kept light so module load is cheap).
vi.mock("../../services/backtest-service.js", () => ({ runBacktest: vi.fn() }));
vi.mock("../../services/monte-carlo-service.js", () => ({ runMonteCarlo: vi.fn() }));
vi.mock("../../services/matrix-backtest-service.js", () => ({ runMatrix: vi.fn(), getMatrixStatus: vi.fn() }));
vi.mock("../../services/autonomous-scout-runner.js", () => ({ runAutonomousScoutCycle: vi.fn(), fetchYouTubeTopVideos: vi.fn(async () => []) }));
vi.mock("../../services/search-router.js", () => ({ strategyHunt: vi.fn() }));
vi.mock("../../services/strategy-fingerprint.js", () => ({
  computeConceptFingerprintHash: vi.fn(() => "h"),
  extractEntryArchetype: vi.fn(() => "unknown"),
  normalizeExitType: vi.fn(() => "unknown"),
}));
vi.mock("../../routes/backtests.js", () => ({ getBacktestConcurrencyStats: vi.fn(() => ({ active: 0, cap: 3, saturated: false })) }));

vi.mock("../../services/pipeline-control-service.js", () => ({
  isActive: mocks.isActive,
  setMode: mocks.setMode,
  getMode: vi.fn(),
}));
vi.mock("../../lib/audit-log-helper.js", () => ({ insertAuditRowSafe: mocks.insertAudit }));
vi.mock("../../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

// Dynamic imports inside confirm handlers.
vi.mock("../../lib/learning-loop-mode.js", () => ({ LEARNING_LOOP_MODE_PARAM: "auto_patch_loop_enabled" }));
vi.mock("../../services/quantum-mc-service.js", () => ({ runQuantumMC: mocks.runQuantumMC }));
vi.mock("../../services/lifecycle-service.js", () => ({
  LifecycleService: class {
    promoteStrategy = mocks.promote;
    checkAutoPromotions = mocks.checkPromo;
    checkAutoDemotions = mocks.checkDemo;
  },
}));
vi.mock("../../scheduler.js", () => ({ enableJob: mocks.enableJob }));
vi.mock("../../services/dead-mans-heartbeat-service.js", () => ({ clearOperatorAbsenceMarkers: mocks.clearMarkers }));

// ── Imports ─────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CARTER_CONFIRM_HANDLERS } from "../../lib/carter/carter-actions.js";
import { _resetUsedConfirmations } from "../../lib/carter/carter-confirm.js";

const SECRET = "test-carter-tools-secret-0123456789abcdef";

let fetchMock: ReturnType<typeof vi.fn>;

/** Mint a valid token by calling the matching propose_ handler. */
async function proposeToken(capability: string, params: object): Promise<string> {
  const propose = CARTER_CONFIRM_HANDLERS[`propose_${capability}`];
  const out = (await propose(params)) as { token: string };
  return out.token;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetUsedConfirmations();
  process.env.CARTER_TOOLS_HMAC_SECRET = SECRET;
  process.env.ADMIN_RESTART_HMAC_SECRET = "test-admin-restart-secret-abc";
  process.env.N8N_BASE_URL = "https://n8n.test";
  // restore default success promote
  mocks.promote.mockResolvedValue({ success: true });
  mocks.isActive.mockResolvedValue(true);
  // global fetch stub (self_restart + trigger_n8n_workflow)
  fetchMock = vi.fn(async () => ({ status: 200 }));
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

function expectAuditExecuted() {
  expect(mocks.insertAudit).toHaveBeenCalledWith(
    expect.objectContaining({ action: "carter.action_executed", decisionAuthority: "voice_agent" }),
  );
}

describe("Carter YELLOW confirm handlers — token gating", () => {
  it("confirm_toggle_bot_power rejects without a token, executes with one", async () => {
    const params = { mode: "PAUSED" };

    const rejected = await CARTER_CONFIRM_HANDLERS.confirm_toggle_bot_power(params) as { error?: string };
    expect(rejected.error).toBe("confirmation_required");
    expect(mocks.setMode).not.toHaveBeenCalled();

    const token = await proposeToken("toggle_bot_power", params);
    const ok = await CARTER_CONFIRM_HANDLERS.confirm_toggle_bot_power(params, token) as { executed?: boolean };
    expect(ok.executed).toBe(true);
    expect(mocks.setMode).toHaveBeenCalledWith("PAUSED", expect.any(String), null);
    expectAuditExecuted();
  });

  it("confirm_toggle_vacation_mode rejects without a token, executes with one", async () => {
    const params = { on: true };
    const rejected = await CARTER_CONFIRM_HANDLERS.confirm_toggle_vacation_mode(params) as { error?: string };
    expect(rejected.error).toBe("confirmation_required");

    const token = await proposeToken("toggle_vacation_mode", params);
    const ok = await CARTER_CONFIRM_HANDLERS.confirm_toggle_vacation_mode(params, token) as { executed?: boolean };
    expect(ok.executed).toBe(true);
    expect(mocks.dbUpdateSet).toHaveBeenCalled(); // operator_absent_since set
    expectAuditExecuted();
  });

  it("confirm_toggle_vacation_mode OFF clears the absence markers", async () => {
    const params = { on: false };
    const token = await proposeToken("toggle_vacation_mode", params);
    await CARTER_CONFIRM_HANDLERS.confirm_toggle_vacation_mode(params, token);
    expect(mocks.clearMarkers).toHaveBeenCalled();
  });

  it("confirm_self_restart rejects without a token, fires HMAC restart with one", async () => {
    const params = { reason: "deploy" };
    const rejected = await CARTER_CONFIRM_HANDLERS.confirm_self_restart(params) as { error?: string };
    expect(rejected.error).toBe("confirmation_required");

    const token = await proposeToken("self_restart", params);
    const ok = await CARTER_CONFIRM_HANDLERS.confirm_self_restart(params, token) as { triggered?: boolean };
    expect(ok.triggered).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/self-restart"),
      expect.objectContaining({ headers: expect.objectContaining({ "X-Restart-Signature": expect.any(String) }) }),
    );
    expectAuditExecuted();
  });

  it("confirm_trigger_n8n_workflow rejects without a token, fires webhook with one", async () => {
    const params = { workflowWebhookPath: "my-flow" };
    const rejected = await CARTER_CONFIRM_HANDLERS.confirm_trigger_n8n_workflow(params) as { error?: string };
    expect(rejected.error).toBe("confirmation_required");

    const token = await proposeToken("trigger_n8n_workflow", params);
    const ok = await CARTER_CONFIRM_HANDLERS.confirm_trigger_n8n_workflow(params, token) as { triggered?: boolean };
    expect(ok.triggered).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://n8n.test/webhook/my-flow", expect.anything());
    expectAuditExecuted();
  });

  it("confirm_trigger_n8n_workflow rejects management-looking paths", async () => {
    const params = { workflowWebhookPath: "rest/workflows" };
    const token = await proposeToken("trigger_n8n_workflow", params);
    const out = await CARTER_CONFIRM_HANDLERS.confirm_trigger_n8n_workflow(params, token) as { error?: string };
    expect(out.error).toBe("invalid_webhook_path");
  });

  // F-1 (HIGH) regression — path traversal must NOT resolve past /webhook/ to the management API.
  it.each([
    "../../api/v1/workflows",
    "../api/v1/workflows",
    "%2E%2E/api/v1/workflows",
  ])("confirm_trigger_n8n_workflow rejects traversal path %s and never calls fetch", async (badPath) => {
    const params = { workflowWebhookPath: badPath };
    const token = await proposeToken("trigger_n8n_workflow", params);
    const out = await CARTER_CONFIRM_HANDLERS.confirm_trigger_n8n_workflow(params, token) as { error?: string };
    expect(out.error).toBe("invalid_webhook_path");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirm_trigger_n8n_workflow still triggers a clean path after the traversal guard", async () => {
    const params = { workflowWebhookPath: "my-flow" };
    const token = await proposeToken("trigger_n8n_workflow", params);
    const ok = await CARTER_CONFIRM_HANDLERS.confirm_trigger_n8n_workflow(params, token) as { triggered?: boolean };
    expect(ok.triggered).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://n8n.test/webhook/my-flow", expect.anything());
  });

  it("confirm_run_quantum rejects without a token, runs MC (cloud OFF) with one", async () => {
    const params = { backtestId: "bt-1" };
    const rejected = await CARTER_CONFIRM_HANDLERS.confirm_run_quantum(params) as { error?: string };
    expect(rejected.error).toBe("confirmation_required");

    const token = await proposeToken("run_quantum", params);
    const ok = await CARTER_CONFIRM_HANDLERS.confirm_run_quantum(params, token) as { mcRunId?: string };
    expect(ok.mcRunId).toBe("qmc-1");
    // GUARDRAIL: cloud stays OFF — options object has no optInCloud.
    expect(mocks.runQuantumMC).toHaveBeenCalledWith("bt-1", "breach", "topstep_50k", {});
    expectAuditExecuted();
  });

  it("confirm_request_lifecycle_check rejects without a token, runs sweep with one", async () => {
    const rejected = await CARTER_CONFIRM_HANDLERS.confirm_request_lifecycle_check({}) as { error?: string };
    expect(rejected.error).toBe("confirmation_required");

    const token = await proposeToken("request_lifecycle_check", {});
    const ok = await CARTER_CONFIRM_HANDLERS.confirm_request_lifecycle_check({}, token) as { executed?: boolean; promotions?: number };
    expect(ok.executed).toBe(true);
    expect(mocks.checkPromo).toHaveBeenCalled();
    expect(mocks.checkDemo).toHaveBeenCalled();
    expectAuditExecuted();
  });

  it("confirm_request_lifecycle_check honors pipeline pause", async () => {
    mocks.isActive.mockResolvedValue(false);
    const token = await proposeToken("request_lifecycle_check", {});
    const out = await CARTER_CONFIRM_HANDLERS.confirm_request_lifecycle_check({}, token) as { status?: string };
    expect(out.status).toBe("pipeline_paused");
    expect(mocks.checkPromo).not.toHaveBeenCalled();
  });

  it("confirm_rearm_scheduler_job rejects without a token, enables job with one", async () => {
    const params = { jobName: "heartbeat-stale-check" };
    const rejected = await CARTER_CONFIRM_HANDLERS.confirm_rearm_scheduler_job(params) as { error?: string };
    expect(rejected.error).toBe("confirmation_required");

    const token = await proposeToken("rearm_scheduler_job", params);
    const ok = await CARTER_CONFIRM_HANDLERS.confirm_rearm_scheduler_job(params, token) as { enabled?: boolean };
    expect(ok.enabled).toBe(true);
    expect(mocks.enableJob).toHaveBeenCalledWith("heartbeat-stale-check");
    expectAuditExecuted();
  });
});

describe("set_learning_loop_mode — down-shift GREEN, up-shift YELLOW", () => {
  it("down-shift to OFF(0) executes WITHOUT a token", async () => {
    const out = await CARTER_CONFIRM_HANDLERS.confirm_set_learning_loop_mode({ mode: 0 }) as { executed?: boolean };
    expect(out.executed).toBe(true);
    expect(mocks.dbUpdateSet).toHaveBeenCalled();
    expectAuditExecuted();
  });

  it("down-shift to OBSERVE(1) executes WITHOUT a token", async () => {
    const out = await CARTER_CONFIRM_HANDLERS.confirm_set_learning_loop_mode({ mode: 1 }) as { executed?: boolean };
    expect(out.executed).toBe(true);
  });

  it("up-shift to AUTOPILOT(2) REJECTS without a token", async () => {
    const out = await CARTER_CONFIRM_HANDLERS.confirm_set_learning_loop_mode({ mode: 2 }) as { error?: string };
    expect(out.error).toBe("confirmation_required");
    // no write attempted
    expect(mocks.dbUpdateSet).not.toHaveBeenCalled();
  });

  it("up-shift to AUTOPILOT(2) executes WITH a token", async () => {
    const params = { mode: 2 };
    const token = await proposeToken("set_learning_loop_mode", params);
    const out = await CARTER_CONFIRM_HANDLERS.confirm_set_learning_loop_mode(params, token) as { executed?: boolean };
    expect(out.executed).toBe(true);
    expect(mocks.dbUpdateSet).toHaveBeenCalled();
    expectAuditExecuted();
  });
});

describe("request_promotion — gates are authoritative, never forced", () => {
  it("rejects without a token", async () => {
    const params = { strategyId: "s1", toState: "DEPLOY_READY" };
    const out = await CARTER_CONFIRM_HANDLERS.confirm_request_promotion(params) as { error?: string };
    expect(out.error).toBe("confirmation_required");
    expect(mocks.promote).not.toHaveBeenCalled();
  });

  it("executes a clean promotion with a token", async () => {
    const params = { strategyId: "s1", toState: "DEPLOY_READY" };
    const token = await proposeToken("request_promotion", params);
    const out = await CARTER_CONFIRM_HANDLERS.confirm_request_promotion(params, token) as { executed?: boolean };
    expect(out.executed).toBe(true);
    expect(mocks.promote).toHaveBeenCalledWith("s1", "PAPER", "DEPLOY_READY", { actor: "system" });
    expectAuditExecuted();
  });

  it("a gate block is RETURNED as the reason and does NOT bypass", async () => {
    // promoteStrategy reports the gate block; Carter must surface it, never force.
    mocks.promote.mockResolvedValue({ success: false, error: "B14 ci_high above threshold" });
    const params = { strategyId: "s1", toState: "DEPLOY_READY" };
    const token = await proposeToken("request_promotion", params);
    const out = await CARTER_CONFIRM_HANDLERS.confirm_request_promotion(params, token) as { blocked?: boolean; reason?: string };
    expect(out.blocked).toBe(true);
    expect(out.reason).toBe("B14 ci_high above threshold");
    // The block came from inside promoteStrategy; Carter called it once and did not retry/force.
    expect(mocks.promote).toHaveBeenCalledTimes(1);
    // Audited as failure with the reason.
    expect(mocks.insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "carter.action_executed", status: "failure", decisionAuthority: "voice_agent" }),
    );
  });
});
