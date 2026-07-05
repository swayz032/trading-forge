/**
 * deepscan15-broker-router-two-percent.test.ts — deep-scan #15 FIX M5
 *
 * Route-level MFFU 2%-per-trade enforcement. A caller reaching routeOrder()
 * DIRECTLY (not via paper-execution-service) is now checked against the firm's 2%
 * rule using the signal's own risk geometry — closing the gap where the route-time
 * Python compliance gate passes intended_max_loss=null and structurally skips 2%.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (hoisted; fully self-contained factories) ─────────────────────────

const accountRowRef: { current: Record<string, unknown> | undefined } = { current: undefined };

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (accountRowRef.current ? [accountRowRef.current] : [])),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(async () => [{ id: "audit-id" }]) })),
  },
}));

vi.mock("../db/schema.js", () => ({ brokerAccounts: { accountId: {} }, auditLog: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((col: unknown, val: unknown) => ({ col, val })) }));
vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn(), BROKER_ORDER_ROUTED_EVENT: "broker:order_routed" }));
vi.mock("../services/pipeline-control-service.js", () => ({ isActive: vi.fn().mockResolvedValue(true) }));
vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: vi.fn().mockResolvedValue(false) },
}));
vi.mock("../services/strategy-assignment-service.js", () => ({
  getEnabledFirms: vi.fn().mockResolvedValue(["topstep", "mffu"]),
}));

// firm-config: provide the M5 accessors the route-level 2% check reads.
vi.mock("../../shared/firm-config.js", () => ({
  getFirmLimit: vi.fn().mockReturnValue({ maxContracts: 50 }),
  CONTRACT_CAP_MAX: 60,
  DEFAULT_ACCOUNT_SIZE: 50_000,
  CONTRACT_SPECS: {
    MES: { pointValue: 5.0, tickSize: 0.25, tickValue: 1.25, contractClass: "micro" },
    MNQ: { pointValue: 2.0, tickSize: 0.25, tickValue: 0.5, contractClass: "micro" },
    MCL: { pointValue: 100.0, tickSize: 0.01, tickValue: 1.0, contractClass: "micro" },
  },
  getFirmAccount: vi.fn((firm: string) => {
    const f = (firm ?? "").toLowerCase();
    if (f === "mffu") return { accountSize: 50_000, twoPercentRulePct: 0.02, maxContracts: 50 };
    if (f === "topstep") return { accountSize: 50_000, maxContracts: 50 }; // no twoPercentRulePct
    return null;
  }),
}));

// contract-class: deterministic stop ceiling (MES=14pt) for the fallback path.
vi.mock("../lib/contract-class.js", () => ({
  getStopCeilingPts: vi.fn((sym: string) => (sym === "MNQ" ? 62 : sym === "MCL" ? 1.0 : 14)),
}));

vi.mock("../services/notification-service.js", () => ({ notifyCritical: vi.fn(), notifyWarning: vi.fn() }));
vi.mock("../lib/notification-helpers.js", () => ({ appendFamilyGradePostscript: vi.fn((m: string) => m) }));
vi.mock("../lib/credential-loader.js", () => ({
  loadBrokerCredentials: vi.fn().mockResolvedValue({ apiKey: "k" }),
}));
vi.mock("../integrations/traderspost/client.js", () => ({
  submitWebhookOrder: vi.fn().mockResolvedValue({ success: true, statusCode: 200, responseBody: { ok: true } }),
  buildDeterministicIdempotencyKey: vi.fn(() => "test-idempotency-key"),
}));
vi.mock("../integrations/traderspost/webhook-builder.js", () => ({
  buildWebhookPayload: vi.fn().mockReturnValue({ apiKey: "k", action: "buy", ticker: "MES", orderType: "market" }),
}));
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ violation: false, status: "ok", message: "", violations: [] }),
}));

import { routeOrder } from "../services/broker-router.js";
import { db } from "../db/index.js";

const MFFU_ACCT = {
  accountId: "acct-mffu-1",
  firmId: "mffu",
  brokerType: "traderspost",
  enabled: true,
  apiKeyVaultRef: "vault://mffu",
  accountIdExternal: "ext-1",
  enabledSymbols: ["MES"],
  dllOptedIn: true,
  createdAt: new Date(),
};

describe("routeOrder — route-level MFFU 2%-per-trade enforcement (FIX M5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountRowRef.current = { ...MFFU_ACCT };
  });

  it("BLOCKS an MFFU entry whose intended max loss exceeds 2% of the account", async () => {
    // 40 MES × 14pt stop-ceiling × $5/pt = $2,800 intended loss > 2% × $50k = $1,000.
    const result = await routeOrder("acct-mffu-1", {
      action: "enter_long",
      ticker: "MES1!",
      quantity: 40,
    } as never);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("compliance_violation");
    expect(result.error).toContain("two_percent_rule_block");

    // A dedicated audit row is written for the block.
    const insertCalls = (db.insert as unknown as ReturnType<typeof vi.fn>).mock.results;
    const wroteTwoPct = insertCalls.some((r) => {
      const values = (r.value as { values?: ReturnType<typeof vi.fn> })?.values;
      return values && values.mock.calls.some((c: unknown[]) => (c[0] as { action?: string })?.action === "broker_router.two_percent_rule_block");
    });
    expect(wroteTwoPct).toBe(true);
  });

  it("uses signal entry↔stop geometry when both prices are present", async () => {
    // 30 MES × |6000-5990|=10pt × $5 = $1,500 > $1,000 → block.
    const result = await routeOrder("acct-mffu-1", {
      action: "enter_long",
      ticker: "MES1!",
      quantity: 30,
      price: 6000,
      stopPrice: 5990,
    } as never);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("compliance_violation");
    expect(result.error).toContain("two_percent_rule_block");
  });

  it("ALLOWS an MFFU entry whose intended max loss is within 2%", async () => {
    // 2 MES × |6000-5996|=4pt × $5 = $40 < $1,000 → passes the 2% check → routes.
    const result = await routeOrder("acct-mffu-1", {
      action: "enter_long",
      ticker: "MES1!",
      quantity: 2,
      price: 6000,
      stopPrice: 5996,
    } as never);

    expect(result.reason).not.toBe("compliance_violation");
    expect(result.success).toBe(true);
  });

  it("does NOT apply the 2% block on exit signals (no per-trade risk added)", async () => {
    const result = await routeOrder("acct-mffu-1", {
      action: "exit",
      ticker: "MES1!",
      quantity: 40,
    } as never);

    // Exit routes normally — never blocked by the 2% rule.
    expect(result.reason).not.toBe("compliance_violation");
  });

  it("does NOT apply the 2% block for a firm with no 2% rule (topstep)", async () => {
    accountRowRef.current = { ...MFFU_ACCT, accountId: "acct-topstep-1", firmId: "topstep", brokerType: "topstepx" };
    const result = await routeOrder("acct-topstep-1", {
      action: "enter_long",
      ticker: "MES1!",
      quantity: 40,
    } as never);

    // Topstep has no twoPercentRulePct → the 2% block never fires. Topstep routes to
    // the TopstepX stub (topstepx_not_configured), NOT a compliance_violation.
    expect(result.reason).not.toBe("compliance_violation");
    expect(result.reason).toBe("topstepx_not_configured");
  });
});
