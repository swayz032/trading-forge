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
import { readFileSync } from "fs";
import { resolve } from "path";

// ─── vi.mock factories: MUST be fully self-contained (no outer-var refs) ──────
// Vitest hoists vi.mock() above all imports; any outer variable ref is a TDZ
// error. We use inline vi.fn() only, then override per-test via vi.mocked().

vi.mock("../db/index.js", () => ({
  db: {
    // MED fix (capital-safety-compliance-gates wave, 2026-07-17): the
    // broker-router F-5 gate now also queries `complianceRulesets` via
    // `.where().orderBy().limit()` (to pass a real ruleset into
    // check_violation). The pre-existing account lookup uses
    // `.where().limit()` with NO `.orderBy()` — the mock distinguishes the
    // two call shapes so both coexist without one clobbering the other.
    // `.orderBy()` defaults to an empty ruleset (matches pre-fix behavior
    // for every test that doesn't care about the ruleset payload); override
    // via `mockSelectReturning(accounts, rulesetRows)` when a test needs a
    // specific ruleset row.
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
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
  // X-1 option a (Deep-Scan #18b): production_trades writer + strategy-version-hash
  // lookup references. Dedicated coverage lives in x1-production-trades-writer.test.ts;
  // these are just enough shape for writeProductionTradeRow's fail-soft paths to not
  // throw a stray "no export" error in this file's broader routeOrder() coverage.
  productionTrades: { tableName: "production_trades", traderspostWebhookId: "traderspostWebhookId" },
  strategies: { tableName: "strategies", id: "id", config: "config" },
  complianceRulesets: {
    tableName: "compliance_rulesets",
    firm: "firm",
    parsedRules: "parsedRules",
    retrievedAt: "retrievedAt",
    driftDetected: "driftDetected",
    contentHash: "contentHash",
    status: "status",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  desc: vi.fn((col: unknown) => ({ col, desc: true })),
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
  // W3A ratify-packet (2026-07-17) item 2: the M5 2%-per-trade block now
  // fail-CLOSED on a thrown check (was fail-open). This mock previously
  // omitted getFirmAccount/CONTRACT_SPECS/DEFAULT_ACCOUNT_SIZE entirely, which
  // used to throw silently inside the (then fail-open) M5 try block on every
  // entry signal and get masked. getFirmAccount returning null + empty
  // CONTRACT_SPECS makes the M5 guard condition evaluate false (graceful
  // skip) instead of throwing — same net effect as before, without relying on
  // an unrelated exception being swallowed.
  getFirmAccount: vi.fn().mockReturnValue(null),
  CONTRACT_SPECS: {},
  DEFAULT_ACCOUNT_SIZE: 50_000,
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ violation: false, status: "ok", message: "", violations: [] }),
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn((msg: string) => msg),
}));

vi.mock("../lib/credential-loader.js", () => ({
  loadBrokerCredentials: vi.fn().mockResolvedValue({ apiKey: "test-api-key-abc123" }),
}));

vi.mock("../integrations/traderspost/client.js", () => ({
  submitWebhookOrder: vi.fn().mockResolvedValue({ success: true, statusCode: 200, responseBody: { ok: true } }),
  buildDeterministicIdempotencyKey: vi.fn(() => "test-idempotency-key"),
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
import { notifyCritical } from "../services/notification-service.js";

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

function mockSelectReturning(accounts: unknown[], rulesetRows: unknown[] = []) {
    // @ts-ignore — Drizzle builder mock: partial {from/values chain} can't satisfy full SelectBuilder/InsertBuilder return type (W0.3 2026-06-22)
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        // Account lookup (`.where().limit()`, no orderBy) — unchanged.
        limit: vi.fn().mockResolvedValue(accounts),
        // complianceRulesets lookup (`.where().orderBy().limit()`) — the
        // broker-router F-5 ruleset fetch. Defaults to no ruleset row so
        // pre-existing tests that don't care about it are unaffected.
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rulesetRows),
        }),
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
    // @ts-ignore — Drizzle builder mock: partial {from/values chain} can't satisfy full SelectBuilder/InsertBuilder return type (W0.3 2026-06-22)
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

  // ─── Test 11: Null firmId is BLOCKED, not silently passed through ─────────
  // Hole 3: account.firmId === null previously skipped the compliance gate
  // entirely because `if (account.firmId)` is falsy for null/undefined.
  // An unidentified-firm order must NEVER bypass compliance — fail-CLOSED.

  it("F-5-hole-3: null firmId blocks the order and writes compliance_null_firm_blocked audit row", async () => {
    // Account with no firmId (should never exist in prod, but must be hardened)
    const nullFirmAccount = { ...TRADERSPOST_ACCOUNT, firmId: null };
    mockSelectReturning([nullFirmAccount]);

    const valuesMock = vi.fn().mockResolvedValue([{ id: "audit-null-firm" }]);
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
    // @ts-ignore — partial Drizzle mock
    vi.mocked(db.insert).mockImplementation(insertMock);

    const result = await routeOrder("test-account-uuid-1234", TEST_SIGNAL, "corr-nullfirm");

    expect(result.success).toBe(false);
    expect(result.reason).toBe("compliance_violation");
    expect(submitWebhookOrder).not.toHaveBeenCalled();

    // Must have written a broker_router.compliance_null_firm_blocked audit row
    const auditCalls: string[] = valuesMock.mock.calls
      .flat()
      .map((v: { action?: string }) => v?.action)
      .filter((a): a is string => Boolean(a));
    expect(auditCalls).toContain("broker_router.compliance_null_firm_blocked");
  });

  // ─── Test 12: Compliance subprocess failure writes an audit row ───────────
  // Hole 2: the catch block at the compliance gate previously logged a warn and
  // proceeded with NO audit row — a blackout-window bypass was not reconstructable.

  it("F-5-hole-2: compliance subprocess failure writes compliance_gate_failed audit row", async () => {
    const { runPythonModule } = await import("../lib/python-runner.js");

    // Make the compliance check throw (subprocess crash / timeout)
    vi.mocked(runPythonModule).mockRejectedValue(new Error("Python subprocess timed out"));

    const valuesMock = vi.fn().mockResolvedValue([{ id: "audit-gate-failed" }]);
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
    // @ts-ignore — partial Drizzle mock
    vi.mocked(db.insert).mockImplementation(insertMock);

    // Route should still proceed (fail-open after audit — paper-execution-service
    // is the primary gate per documented defense-in-depth contract)
    const result = await routeOrder("test-account-uuid-1234", TEST_SIGNAL, "corr-gate-fail");

    // Order proceeds despite subprocess failure (fail-open is intentional here)
    expect(result.success).toBe(true);

    // But an audit row MUST have been written for the subprocess failure
    const auditCalls: string[] = valuesMock.mock.calls
      .flat()
      .map((v: { action?: string }) => v?.action)
      .filter((a): a is string => Boolean(a));
    expect(auditCalls).toContain("broker_router.compliance_gate_failed");
  });

  // ─── Test 13: 2% check inputs documented truthfully ──────────────────────
  // Hole 1: intended_max_loss and account_balance are passed as null to
  // compliance_gate.py — which structurally skips the 2% check.  The correct
  // fix at this layer is to truthfully document that 2% is NOT enforced here
  // (it IS enforced by paper-execution-service with real values) and confirm
  // the compliance call still runs (for other checks like automated flag,
  // proposed_symbol, etc.).  This test asserts that runPythonModule IS called
  // even though both balance fields are null — i.e., the gate is attempted and
  // non-2%-checks fire as intended.

  it("F-5-hole-1: compliance gate is called even with null balance inputs (2% checked upstream by paper-execution-service)", async () => {
    const { runPythonModule } = await import("../lib/python-runner.js");
    vi.mocked(runPythonModule).mockResolvedValue({ violation: false, status: "ok", message: "", violations: [] });

    await routeOrder("test-account-uuid-1234", TEST_SIGNAL, "corr-balance-null");

    // The gate must still be invoked — non-2% checks (automated flag,
    // proposed_symbol, account_phase) run regardless of null balance.
    expect(runPythonModule).toHaveBeenCalledOnce();

    // Verify that the call is made with null balance fields — this is the
    // truthful documented contract: 2% is NOT checked at this layer.
    const callArg = vi.mocked(runPythonModule).mock.calls[0][0] as {
      config: { strategy_state: { intended_max_loss: unknown; account_balance: unknown } };
    };
    expect(callArg.config.strategy_state.intended_max_loss).toBeNull();
    expect(callArg.config.strategy_state.account_balance).toBeNull();
  });

  // ─── Test 13b: MED fix — check_violation is called WITH a real ruleset ────
  // capital-safety-compliance-gates wave (2026-07-17): the route-level
  // check_violation call previously omitted `ruleset` entirely from the
  // config. check_violation IS a ruleset-dependent action in
  // compliance_gate.py, so the Python CLI's no_ruleset short-circuit fired
  // on every call — check_violation() never actually ran here. This test
  // asserts the route now fetches the firm's latest compliance_rulesets row
  // and passes a non-empty `ruleset` payload through to runPythonModule.

  it("MED fix: check_violation call includes a real ruleset payload fetched from complianceRulesets", async () => {
    const { runPythonModule } = await import("../lib/python-runner.js");
    vi.mocked(runPythonModule).mockResolvedValue({ violation: false, status: "ok", message: "", violations: [] });

    const RULESET_ROW = {
      firm: "mffu",
      parsedRules: { automation_banned: false, two_percent_rule: true },
      retrievedAt: new Date("2026-07-01T00:00:00.000Z"),
      driftDetected: false,
      contentHash: "abc123hash",
      status: "verified",
    };
    mockSelectReturning([TRADERSPOST_ACCOUNT], [RULESET_ROW]);

    await routeOrder("test-account-uuid-1234", TEST_SIGNAL, "corr-ruleset-passthrough");

    expect(runPythonModule).toHaveBeenCalledOnce();
    const callArg = vi.mocked(runPythonModule).mock.calls[0][0] as {
      config: { action: string; ruleset?: Record<string, unknown> };
    };
    expect(callArg.config.action).toBe("check_violation");
    // The core assertion: `ruleset` must be a real, non-empty payload — not
    // undefined/omitted (the pre-fix bug) and not an empty object.
    expect(callArg.config.ruleset).toBeDefined();
    expect(callArg.config.ruleset).toMatchObject({
      firm: "mffu",
      parsed_rules: { automation_banned: false, two_percent_rule: true },
      content_hash: "abc123hash",
      status: "verified",
    });
    expect(Object.keys(callArg.config.ruleset ?? {}).length).toBeGreaterThan(0);
  });

  it("MED fix: check_violation ruleset is undefined (not fabricated) when no ruleset row exists for the firm", async () => {
    const { runPythonModule } = await import("../lib/python-runner.js");
    vi.mocked(runPythonModule).mockResolvedValue({ violation: false, status: "ok", message: "", violations: [] });

    // Default mockSelectReturning([TRADERSPOST_ACCOUNT]) from beforeEach already
    // returns an empty ruleset-rows array — re-assert explicitly here for clarity.
    mockSelectReturning([TRADERSPOST_ACCOUNT], []);

    await routeOrder("test-account-uuid-1234", TEST_SIGNAL, "corr-ruleset-missing");

    const callArg = vi.mocked(runPythonModule).mock.calls[0][0] as {
      config: { ruleset?: Record<string, unknown> };
    };
    expect(callArg.config.ruleset).toBeUndefined();
  });

  // ─── Test 14 (F-3 invariant): firm↔broker_type mismatch is REFUSED ─────────
  // TOPOLOGY + COMPLIANCE SAFETY: a Topstep row mis-seeded as broker_type=
  // 'traderspost' must NOT route Topstep orders through TradersPost (§7: Topstep
  // uses TopstepX ONLY). The invariant fail-CLOSES, writes a CRITICAL audit row,
  // fires a Discord critical, and does NOT route.

  it("F-3-invariant: refuses a Topstep account mis-seeded as broker_type='traderspost'", async () => {
    // firmId=topstep but broker_type=traderspost — the dangerous mis-seed.
    mockSelectReturning([{ ...TRADERSPOST_ACCOUNT, firmId: "topstep", brokerType: "traderspost" }]);

    const valuesMock = vi.fn().mockResolvedValue([{ id: "audit-mismatch" }]);
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
    // @ts-ignore — partial Drizzle mock
    vi.mocked(db.insert).mockImplementation(insertMock);

    const result = await routeOrder("test-account-uuid-1234", TEST_SIGNAL, "corr-mismatch");

    expect(result.success).toBe(false);
    expect(result.reason).toBe("firm_broker_mismatch");
    expect(result.firmId).toBe("topstep");
    expect(result.brokerType).toBe("traderspost");
    expect(result.error).toMatch(/firm_broker_mismatch/);
    // Did NOT route to any broker
    expect(submitWebhookOrder).not.toHaveBeenCalled();
    expect(loadBrokerCredentials).not.toHaveBeenCalled();

    // CRITICAL audit row written
    const auditCalls: string[] = valuesMock.mock.calls
      .flat()
      .map((v: { action?: string }) => v?.action)
      .filter((a): a is string => Boolean(a));
    expect(auditCalls).toContain("broker_router.firm_broker_mismatch");

    // CRITICAL Discord fired
    expect(notifyCritical).toHaveBeenCalledOnce();
  });

  // ─── Test 15 (F-3 invariant): MFFU mis-seeded as topstepx is REFUSED ───────

  it("F-3-invariant: refuses an MFFU account mis-seeded as broker_type='topstepx'", async () => {
    // firmId=mffu but broker_type=topstepx — the reverse mis-seed.
    mockSelectReturning([{ ...TRADERSPOST_ACCOUNT, firmId: "mffu", brokerType: "topstepx" }]);

    const result = await routeOrder("test-account-uuid-1234", TEST_SIGNAL, "corr-mismatch-2");

    expect(result.success).toBe(false);
    expect(result.reason).toBe("firm_broker_mismatch");
    expect(result.firmId).toBe("mffu");
    expect(result.brokerType).toBe("topstepx");
    // Did NOT reach the TopstepX stub (would have been topstepx_not_configured)
    expect(result.reason).not.toBe("topstepx_not_configured");
    expect(submitWebhookOrder).not.toHaveBeenCalled();
  });

  // ─── Test 16 (F-3 invariant): tier-suffixed firmId normalizes correctly ────
  // A Topstep account keyed as 'topstep_50k' must still resolve to the 'topstep'
  // firm key (suffix stripped) and pass the invariant when broker_type=topstepx.

  it("F-3-invariant: tier-suffixed topstep_50k with topstepx PASSES the invariant (reaches stub)", async () => {
    mockSelectReturning([{ ...TRADERSPOST_ACCOUNT, firmId: "topstep_50k", brokerType: "topstepx" }]);

    const result = await routeOrder("test-account-uuid-1234", TEST_SIGNAL, "corr-suffix");

    // Invariant passes (topstep_50k → topstep ⇒ topstepx is consistent); the
    // request flows through to the TopstepX stub, NOT firm_broker_mismatch.
    expect(result.reason).not.toBe("firm_broker_mismatch");
    expect(result.reason).toBe("topstepx_not_configured");
  });

  // ─── Test 17 (deep-scan fix-wave 2026-07-10): kill-switch correlationId/firmId scoping ─
  // CONFIRMED HIGH finding: routeOrder() received `correlationId` as a parameter
  // but called killSwitch.isHaltedForProduction() with ZERO opts, so (a) every
  // kill-switch audit row/SSE event for the check got a disconnected random UUID
  // (unjoinable to this order's correlationId — breaking 90-day trade
  // reconstruction) and (b) Layer 2/3/7 fell back to the legacy GLOBAL scope
  // (iterate every account/firm, halt on the first breach found ANYWHERE).
  // These tests assert the fix: real correlationId + real firmId are threaded
  // through, and accountKey is never fabricated from the accountId UUID.

  it("F-2-scoping: isHaltedForProduction is called with the real correlationId, not a bare call", async () => {
    mockSelectReturning([TRADERSPOST_ACCOUNT]); // firmId="mffu"

    await routeOrder("test-account-uuid-1234", TEST_SIGNAL, "corr-scoping-mffu");

    expect(killSwitch.isHaltedForProduction).toHaveBeenCalledOnce();
    const optsArg = vi.mocked(killSwitch.isHaltedForProduction).mock.calls[0][0] as
      | Record<string, unknown>
      | undefined;
    // Must be a non-empty opts object (regression guard: the original bug was
    // `isHaltedForProduction()` called with ZERO arguments).
    expect(optsArg).toBeDefined();
    expect(optsArg).not.toEqual({});
    expect(optsArg?.correlationId).toBe("corr-scoping-mffu");
  });

  it("F-2-scoping: firmId is resolved from the real broker_accounts row (mffu), not hardcoded", async () => {
    mockSelectReturning([TRADERSPOST_ACCOUNT]); // firmId="mffu"

    await routeOrder("test-account-uuid-1234", TEST_SIGNAL, "corr-firmid-mffu");

    const optsArg = vi.mocked(killSwitch.isHaltedForProduction).mock.calls[0][0] as
      | Record<string, unknown>
      | undefined;
    expect(optsArg?.firmId).toBe("mffu");
  });

  it("F-2-scoping: firmId is resolved per-account — topstep account yields firmId='topstep'", async () => {
    mockSelectReturning([TOPSTEPX_ACCOUNT]); // firmId="topstep"

    await routeOrder("test-account-uuid-5678", TEST_SIGNAL, "corr-firmid-topstep");

    const optsArg = vi.mocked(killSwitch.isHaltedForProduction).mock.calls[0][0] as
      | Record<string, unknown>
      | undefined;
    expect(optsArg?.firmId).toBe("topstep");
  });

  it("F-2-scoping: accountKey is NEVER fabricated from the broker_accounts.account_id UUID", async () => {
    // kill-switch's accountKey lives in a DIFFERENT identity space
    // (resolveAccountKey() over a paper_sessions row) than broker_accounts.
    // account_id. Passing the raw accountId UUID as accountKey would make
    // Layer 2/3's account-scoped filter match NOTHING and silently PASS those
    // layers for this account (a worse fail-open than the pre-fix global
    // scope) — so accountKey must stay absent until a genuine schema-level
    // accountId→accountKey mapping exists.
    mockSelectReturning([TRADERSPOST_ACCOUNT]);

    await routeOrder("test-account-uuid-1234", TEST_SIGNAL, "corr-no-fabricated-key");

    const optsArg = vi.mocked(killSwitch.isHaltedForProduction).mock.calls[0][0] as
      | Record<string, unknown>
      | undefined;
    expect(optsArg?.accountKey).toBeUndefined();
    expect(optsArg?.accountKey).not.toBe("test-account-uuid-1234");
  });

  it("F-2-scoping: firmId prefetch DB error degrades gracefully — kill switch still runs, order still processes", async () => {
    // The firmId lookup is a passive, fail-soft, best-effort read that must
    // NEVER block the order or bypass the kill-switch gate. Simulate a DB
    // error on exactly the first db.select() call (the new firmId prefetch,
    // which runs before the pre-existing account lookup) and verify the
    // kill-switch check still fires (with firmId undefined, i.e. the
    // byte-identical pre-fix unscoped Layer 7 behavior) and the order still
    // completes normally via the unaffected second (existing) account lookup.
    const dbErr = new Error("db connection reset");
    vi.mocked(db.select).mockImplementationOnce(() => {
      throw dbErr;
    });
    // Subsequent db.select() calls (the pre-existing account lookup, etc.)
    // fall back to this normal mock once the one-shot throw is consumed.
    mockSelectReturning([TRADERSPOST_ACCOUNT]);

    const result = await routeOrder("test-account-uuid-1234", TEST_SIGNAL, "corr-firmid-db-error");

    expect(killSwitch.isHaltedForProduction).toHaveBeenCalledOnce();
    const optsArg = vi.mocked(killSwitch.isHaltedForProduction).mock.calls[0][0] as
      | Record<string, unknown>
      | undefined;
    expect(optsArg?.correlationId).toBe("corr-firmid-db-error");
    expect(optsArg?.firmId).toBeUndefined();
    // The firmId-prefetch failure must NOT propagate into a route failure.
    expect(result.success).toBe(true);
  });

  it("F-2-scoping (regression): source no longer contains a bare isHaltedForProduction() call", () => {
    // Static source guard mirroring the M12 pattern in
    // m2-m12-shadow-divergence-and-correlation-plumbing.test.ts — ensures a
    // future edit can't silently reintroduce the zero-opts call this fix
    // removed.
    const src = readFileSync(
      resolve(import.meta.dirname, "../services/broker-router.ts"),
      "utf8",
    );
    const bareCall = src.match(/await killSwitch\.isHaltedForProduction\(\)/);
    expect(bareCall).toBeNull();
    // And confirm the real call site does carry correlationId (brace-bounded,
    // matching the multi-line `{ correlationId, firmId }` object literal).
    const scopedCalls = [...src.matchAll(/killSwitch\.isHaltedForProduction\(\{([^}]*)\}/g)];
    expect(scopedCalls.length).toBeGreaterThan(0);
    for (const c of scopedCalls) expect(c[1]).toMatch(/\bcorrelationId\b/);
  });
});
