/**
 * Broker Router Tests (Track 4 — Pass 2)
 *
 * 8 tests covering:
 * 1. TradersPost route fires and returns success
 * 2. TopstepX route returns stub with reason 'topstepx_not_configured'
 * 3. Account not found returns clear error
 * 4. broker_type='unknown' returns clear error
 * 5. Per-firm credential lookup (vault ref resolved)
 * 6. Pause-guard: pipeline paused → returns pipeline_paused
 * 7. audit_log row written on every route
 * 8. Legacy firm_id rejection (disabled accounts treated as not-found)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── vi.mock factories: MUST be fully self-contained (no outer-var refs) ──────
// Vitest hoists vi.mock() above all imports; any outer variable ref is a TDZ
// error. We use inline vi.fn() only, then override per-test via vi.mocked().

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([{ id: "test-audit-id" }]),
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  brokerAccounts: {},
  auditLog: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: {
    isHaltedForProduction: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("../services/strategy-assignment-service.js", () => ({
  getEnabledFirms: vi.fn().mockResolvedValue(["mffu", "topstep"]),
}));

vi.mock("../../shared/firm-config.js", () => ({
  getFirmLimit: vi.fn().mockReturnValue({ maxContracts: 50 }),
  CONTRACT_CAP_MAX: 60,
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ violation: false, status: "ok", message: "", violations: [] }),
}));

vi.mock("../lib/credential-loader.js", () => ({
  loadBrokerCredentials: vi.fn().mockResolvedValue({ apiKey: "test-api-key-abc123" }),
}));

vi.mock("../integrations/traderspost/client.js", () => ({
  submitWebhookOrder: vi.fn().mockResolvedValue({ success: true, statusCode: 200, responseBody: { ok: true } }),
}));

vi.mock("../integrations/traderspost/webhook-builder.js", () => ({
  buildWebhookPayload: vi.fn().mockReturnValue({
    apiKey: "test-api-key-abc123",
    action: "buy",
    ticker: "MES1!",
    orderType: "market",
    positionType: "long",
  }),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { routeOrder } from "../services/broker-router.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import { loadBrokerCredentials } from "../lib/credential-loader.js";
import { submitWebhookOrder } from "../integrations/traderspost/client.js";
import { broadcastSSE } from "../routes/sse.js";
import { db } from "../db/index.js";
import { killSwitch } from "../production/kill-switch.js";
import { getEnabledFirms } from "../services/strategy-assignment-service.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TRADERSPOST_ACCOUNT = {
  id: 1,
  accountId: "test-account-uuid-1234",
  firmId: "mffu",
  brokerType: "traderspost",
  apiKeyVaultRef: "TRADERSPOST_API_KEY_MFFU",
  accountIdExternal: "EXT-123",
  enabled: true,
  createdAt: new Date(),
};

const TOPSTEPX_ACCOUNT = {
  ...TRADERSPOST_ACCOUNT,
  accountId: "test-account-uuid-5678",
  firmId: "topstep",
  brokerType: "topstepx",
};

const TEST_SIGNAL = {
  action: "enter_long" as const,
  ticker: "MES1!",
  quantity: 1,
  orderType: "market" as const,
  strategyId: "strategy-uuid-test",
};

// ─── Helper: set up db.select chain to return a specific account ──────────────

function mockSelectReturning(accounts: unknown[]) {
    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(accounts),
      }),
    }),
  } as ReturnType<typeof db.select>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("broker-router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: pipeline active, kill switch off, traderspost account found, all firms enabled
    vi.mocked(isPipelineActive).mockResolvedValue(true);
    vi.mocked(killSwitch.isHaltedForProduction).mockResolvedValue(false);
    vi.mocked(getEnabledFirms).mockResolvedValue(["mffu", "topstep"]);
    mockSelectReturning([TRADERSPOST_ACCOUNT]);
    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockResolvedValue([{ id: "test-audit-id" }]),
    } as ReturnType<typeof db.insert>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Test 1 ────────────────────────────────────────────────────────────────

  it("routes to TradersPost and returns success", async () => {
    vi.mocked(submitWebhookOrder).mockResolvedValue({ success: true, statusCode: 200, responseBody: { ok: true } });

    const result = await routeOrder("test-account-uuid-1234", TEST_SIGNAL);

    expect(result.success).toBe(true);
    expect(result.reason).toBe("routed");
    expect(result.brokerType).toBe("traderspost");
    expect(result.firmId).toBe("mffu");
    expect(result.statusCode).toBe(200);
    expect(submitWebhookOrder).toHaveBeenCalledOnce();
  });

  // ─── Test 2 ────────────────────────────────────────────────────────────────

  it("returns topstepx_not_configured for TopstepX accounts", async () => {
    mockSelectReturning([TOPSTEPX_ACCOUNT]);

    const result = await routeOrder("test-account-uuid-5678", TEST_SIGNAL);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("topstepx_not_configured");
    expect(result.brokerType).toBe("topstepx");
    expect(result.firmId).toBe("topstep");
    expect(submitWebhookOrder).not.toHaveBeenCalled();
    expect(broadcastSSE).toHaveBeenCalledOnce();
  });

  // ─── Test 3 ────────────────────────────────────────────────────────────────

  it("returns account_not_found when no DB row exists for the accountId", async () => {
    mockSelectReturning([]);

    const result = await routeOrder("nonexistent-uuid", TEST_SIGNAL);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("account_not_found");
    expect(submitWebhookOrder).not.toHaveBeenCalled();
  });

  // ─── Test 4 ────────────────────────────────────────────────────────────────

  it("returns unknown_broker_type for unrecognized broker types", async () => {
    mockSelectReturning([{ ...TRADERSPOST_ACCOUNT, brokerType: "unknown_future_broker" }]);

    const result = await routeOrder("test-account-uuid-1234", TEST_SIGNAL);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("unknown_broker_type");
    expect(result.error).toContain("unknown_future_broker");
    expect(submitWebhookOrder).not.toHaveBeenCalled();
  });

  // ─── Test 5 ────────────────────────────────────────────────────────────────

  it("calls loadBrokerCredentials with the accountId before submitting", async () => {
    vi.mocked(loadBrokerCredentials).mockResolvedValue({ apiKey: "resolved-key-xyz" });
    vi.mocked(submitWebhookOrder).mockResolvedValue({ success: true, statusCode: 200 });

    await routeOrder("test-account-uuid-1234", TEST_SIGNAL);

    expect(loadBrokerCredentials).toHaveBeenCalledWith("test-account-uuid-1234");
  });

  // ─── Test 6 ────────────────────────────────────────────────────────────────

  it("returns pipeline_paused when pipeline is not active", async () => {
    vi.mocked(isPipelineActive).mockResolvedValue(false);

    const result = await routeOrder("test-account-uuid-1234", TEST_SIGNAL);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("pipeline_paused");
    expect(submitWebhookOrder).not.toHaveBeenCalled();
    expect(loadBrokerCredentials).not.toHaveBeenCalled();
  });

  // ─── Test 7 ────────────────────────────────────────────────────────────────

  it("writes an audit_log row on every route attempt (success path)", async () => {
    const valuesMock = vi.fn().mockResolvedValue([{ id: "audit-row-id" }]);
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
    vi.mocked(db.insert).mockImplementation(insertMock);
    vi.mocked(submitWebhookOrder).mockResolvedValue({ success: true, statusCode: 200 });

    await routeOrder("test-account-uuid-1234", TEST_SIGNAL);

    expect(insertMock).toHaveBeenCalled();
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "broker_router.route_order",
        status: "success",
      }),
    );
  });

  // ─── Test 8 ────────────────────────────────────────────────────────────────

  it("treats disabled accounts as not-found (returns account_not_found)", async () => {
    // Disabled accounts are rejected before any broker dispatch
    mockSelectReturning([{ ...TRADERSPOST_ACCOUNT, enabled: false }]);

    const result = await routeOrder("test-account-uuid-1234", TEST_SIGNAL);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("account_not_found");
    expect(submitWebhookOrder).not.toHaveBeenCalled();
  });

  // ─── Test 9 (F-2): Kill switch is FIRST gate ──────────────────────────────

  it("F-2: returns production_halt when kill switch is active — FIRST gate, before pipeline check", async () => {
    vi.mocked(killSwitch.isHaltedForProduction).mockResolvedValue(true);
    // Even if pipeline is active and account exists, kill switch wins
    vi.mocked(isPipelineActive).mockResolvedValue(true);
    mockSelectReturning([TRADERSPOST_ACCOUNT]);

    const result = await routeOrder("test-account-uuid-1234", TEST_SIGNAL, "corr-123");

    expect(result.success).toBe(false);
    expect(result.reason).toBe("production_halt");
    expect(result.error).toBe("killswitch_halt");
    // Must NOT have proceeded to account lookup or order submission
    expect(submitWebhookOrder).not.toHaveBeenCalled();
    expect(loadBrokerCredentials).not.toHaveBeenCalled();
  });

  // ─── Test 10 (F-3): Enabled-firms enforcement ─────────────────────────────

  it("F-3: returns account_not_found when firm is not in enabled_firms", async () => {
    // Disable mffu at the instance level
    vi.mocked(getEnabledFirms).mockResolvedValue(["topstep"]);
    mockSelectReturning([TRADERSPOST_ACCOUNT]); // firmId=mffu

    const result = await routeOrder("test-account-uuid-1234", TEST_SIGNAL);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("account_not_found");
    expect(result.error).toMatch(/not in instance enabled_firms/);
    expect(submitWebhookOrder).not.toHaveBeenCalled();
  });
});
