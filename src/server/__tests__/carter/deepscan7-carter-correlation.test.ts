/**
 * deepscan7-carter-correlation.test.ts — Track B / B4 (obs-H2), 2026-07-02
 *
 * Carter promotion-chain correlationId threading:
 *   - auditActionExecuted no longer hard-sets correlationId=null — every
 *     carter.action_executed row carries a UUID.
 *   - confirm_request_promotion mints ONE crypto.randomUUID() and the SAME value
 *     lands on the promoteStrategy options AND the action audit row (success and
 *     gate-block paths).
 *   - confirm_request_lifecycle_check threads the SAME UUID into
 *     checkAutoPromotions/checkAutoDemotions context and the action audit row,
 *     so lifecycle.promoted rows produced by the sweep are no longer null-correlated.
 *
 * Mock harness mirrors carter-confirm-actions.test.ts.
 */

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  promote: vi.fn(async (): Promise<{ success: boolean; error?: string }> => ({ success: true })),
  checkPromo: vi.fn(async () => ["s1"]),
  checkDemo: vi.fn(async () => [] as string[]),
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
vi.mock("../../lib/learning-loop-mode.js", () => ({ LEARNING_LOOP_MODE_PARAM: "auto_patch_loop_enabled" }));
vi.mock("../../services/quantum-mc-service.js", () => ({ runQuantumMC: vi.fn(async () => ({ id: "qmc-1" })) }));
vi.mock("../../services/lifecycle-service.js", () => ({
  LifecycleService: class {
    promoteStrategy = mocks.promote;
    checkAutoPromotions = mocks.checkPromo;
    checkAutoDemotions = mocks.checkDemo;
  },
}));
vi.mock("../../scheduler.js", () => ({ enableJob: vi.fn(() => true) }));
vi.mock("../../services/dead-mans-heartbeat-service.js", () => ({ clearOperatorAbsenceMarkers: vi.fn(async () => ({})) }));

// ── Imports ─────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CARTER_CONFIRM_HANDLERS } from "../../lib/carter/carter-actions.js";
import { _resetUsedConfirmations } from "../../lib/carter/carter-confirm.js";

const SECRET = "test-carter-tools-secret-0123456789abcdef";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function proposeToken(capability: string, params: object): Promise<string> {
  const propose = CARTER_CONFIRM_HANDLERS[`propose_${capability}`];
  const out = (await propose(params)) as { token: string };
  return out.token;
}

/** Read call args off a vi.fn() whose signature has no declared params. */
function callArg(fn: unknown, callIdx: number, argIdx: number): unknown {
  const calls = (fn as { mock: { calls: unknown[][] } }).mock.calls;
  return calls[callIdx]?.[argIdx];
}

function lastAuditRow(): Record<string, unknown> {
  const calls = (mocks.insertAudit as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetUsedConfirmations();
  process.env.CARTER_TOOLS_HMAC_SECRET = SECRET;
  mocks.promote.mockResolvedValue({ success: true });
  mocks.isActive.mockResolvedValue(true);
});

// ─── B4 — confirm_request_promotion ───────────────────────────────────────────

describe("B4 (obs-H2) — confirm_request_promotion correlationId threading", () => {
  it("mints one UUID that lands on BOTH the promoteStrategy options and the action audit row", async () => {
    const params = { strategyId: "s-1", toState: "DEPLOY_READY" };
    const token = await proposeToken("request_promotion", params);

    const ok = await CARTER_CONFIRM_HANDLERS.confirm_request_promotion(params, token) as { executed?: boolean };
    expect(ok.executed).toBe(true);

    expect(mocks.promote).toHaveBeenCalledTimes(1);
    const promoteOptions = callArg(mocks.promote, 0, 3) as { actor: string; correlationId?: string };
    expect(promoteOptions.actor).toBe("system"); // guardrail preserved
    expect(promoteOptions.correlationId).toMatch(UUID_RE);

    const audit = lastAuditRow();
    expect(audit.action).toBe("carter.action_executed");
    expect(audit.correlationId).toBe(promoteOptions.correlationId); // SAME UUID
  });

  it("gate-block path: the failure audit row shares the promoteStrategy UUID", async () => {
    mocks.promote.mockResolvedValue({ success: false, error: "lifecycle.b14_hard_blocked" });
    const params = { strategyId: "s-2", toState: "DEPLOY_READY" };
    const token = await proposeToken("request_promotion", params);

    const blocked = await CARTER_CONFIRM_HANDLERS.confirm_request_promotion(params, token) as { blocked?: boolean };
    expect(blocked.blocked).toBe(true);

    const promoteOptions = callArg(mocks.promote, 0, 3) as { correlationId?: string };
    const audit = lastAuditRow();
    expect(audit.status).toBe("failure");
    expect(audit.correlationId).toBe(promoteOptions.correlationId);
    expect(audit.correlationId).toMatch(UUID_RE);
  });

  it("two separate actions mint two DIFFERENT UUIDs (one UUID per Carter action)", async () => {
    const params = { strategyId: "s-3", toState: "DEPLOY_READY" };
    const t1 = await proposeToken("request_promotion", params);
    await CARTER_CONFIRM_HANDLERS.confirm_request_promotion(params, t1);
    const first = (callArg(mocks.promote, 0, 3) as { correlationId?: string }).correlationId;

    _resetUsedConfirmations();
    const t2 = await proposeToken("request_promotion", params);
    await CARTER_CONFIRM_HANDLERS.confirm_request_promotion(params, t2);
    const second = (callArg(mocks.promote, 1, 3) as { correlationId?: string }).correlationId;

    expect(first).toMatch(UUID_RE);
    expect(second).toMatch(UUID_RE);
    expect(first).not.toBe(second);
  });
});

// ─── B4 — confirm_request_lifecycle_check ─────────────────────────────────────

describe("B4 (obs-H2) — confirm_request_lifecycle_check correlationId threading", () => {
  it("threads one UUID into checkAutoPromotions + checkAutoDemotions context and the audit row", async () => {
    const params = {};
    const token = await proposeToken("request_lifecycle_check", params);

    const out = await CARTER_CONFIRM_HANDLERS.confirm_request_lifecycle_check(params, token) as { executed?: boolean };
    expect(out.executed).toBe(true);

    expect(mocks.checkPromo).toHaveBeenCalledTimes(1);
    expect(mocks.checkDemo).toHaveBeenCalledTimes(1);
    const promoCtx = callArg(mocks.checkPromo, 0, 0) as { correlationId?: string };
    const demoCtx = callArg(mocks.checkDemo, 0, 0) as { correlationId?: string };
    expect(promoCtx.correlationId).toMatch(UUID_RE);
    expect(demoCtx.correlationId).toBe(promoCtx.correlationId);

    const audit = lastAuditRow();
    expect(audit.action).toBe("carter.action_executed");
    expect(audit.correlationId).toBe(promoCtx.correlationId); // SAME UUID end-to-end
  });
});

// ─── B4 — no more null-correlated action rows anywhere ────────────────────────

describe("B4 (obs-H2) — auditActionExecuted never writes correlationId=null", () => {
  it("an action that does not thread its own UUID still gets a fresh one (toggle_bot_power)", async () => {
    const params = { mode: "PAUSED" };
    const token = await proposeToken("toggle_bot_power", params);

    await CARTER_CONFIRM_HANDLERS.confirm_toggle_bot_power(params, token);

    const audit = lastAuditRow();
    expect(audit.action).toBe("carter.action_executed");
    expect(audit.correlationId).not.toBeNull();
    expect(String(audit.correlationId)).toMatch(UUID_RE);
  });
});
