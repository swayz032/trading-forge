/**
 * w3a-broker-router-entry-fail-closed.test.ts — ratify-packet W3A (Execution
 * Hardening, 2026-07-17), Item 2.
 *
 * Two catch blocks in broker-router.ts guard entry-risk checks and, before
 * this fix, BOTH failed OPEN (proceeded silently or with only a diagnostic
 * audit row, never blocking the order):
 *
 *   1. Route-time safety clamp (~977-1024, catch ~1020-1023) — runs for ANY
 *      signal carrying a numeric `quantity`, NOT scoped to entries (fires for
 *      exits too).
 *   2. FIX M5 2%-per-trade enforcement (~1026 onward, catch ~1136-1165) —
 *      ALREADY structurally scoped to entries only (enclosing
 *      `if (signal.action === "enter_long" || "enter_short")` at ~1044).
 *
 * FIX:
 *   - M5 catch: unconditional flip to fail-CLOSED (the whole block is already
 *     entry-only) — blocks with a NEW audit action
 *     `broker_router.entry_risk_check_unavailable` and BrokerResult
 *     reason "entry_risk_check_unavailable". The OLD `two_percent_rule_check_error`
 *     action is CONSOLIDATED AWAY (not kept alongside) for this catch: nothing
 *     downstream reads that action name (verified via repo-wide grep), and its
 *     payload/log text ("proceeding (fail-open)") would be actively FALSE once
 *     this catch always blocks — keeping it verbatim would leave a misleading
 *     audit trail on the live-money path.
 *   - Clamp catch: NOT scoped to entries today, so it must NOT blindly flip.
 *     An explicit in-catch branch is added: entry actions fail-closed (same
 *     new audit action + reason); every other action (all exit variants)
 *     preserves the EXACT pre-fix fail-open behavior — "flatten must never
 *     block" (CLAUDE.md hard invariant).
 *
 * TEST STRATEGY: real `routeOrder()` via the deepscan15-broker-router-two-percent.test.ts
 * mock harness (reused/extended here), injecting a throw into the dependency
 * each catch block calls, then asserting on the REAL BrokerResult + captured
 * audit_log inserts. The exits-never-block assertions are REGRESSION GUARDS,
 * not RED-proofs — exits already proceeded pre-fix via fail-open and must
 * still proceed post-fix (green before AND after); the RED→GREEN proof is the
 * entries-blocked assertions (pre-fix: proceeds; post-fix: blocked).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (hoisted; fully self-contained factories) ─────────────────────────

const accountRowRef: { current: Record<string, unknown> | undefined } = { current: undefined };
// Toggle flags let each test inject a throw into exactly one dependency.
const throwFlags = { getFirmLimit: false, normalizeFirmKey: false };

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

// firm-config: provide the M5 + clamp accessors. getFirmLimit throws when
// throwFlags.getFirmLimit is set — this is the ONLY call site in broker-router.ts
// (the route-time clamp block), so flipping it isolates that catch precisely.
vi.mock("../../shared/firm-config.js", () => ({
  getFirmLimit: vi.fn(() => {
    if (throwFlags.getFirmLimit) throw new Error("boom-clamp: getFirmLimit threw");
    return { maxContracts: 50 };
  }),
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
    if (f === "topstep") return { accountSize: 50_000, maxContracts: 50 };
    return null;
  }),
}));

// firm-broker-topology: normalizeFirmKey throws when throwFlags.normalizeFirmKey
// is set. This is the ONLY call site of normalizeFirmKey in broker-router.ts (the
// M5 block), so flipping it isolates that catch precisely WITHOUT disturbing the
// earlier firm/broker topology invariant check (which uses the sibling
// validateFirmBrokerTopology export, left untouched/working here).
vi.mock("../lib/firm-broker-topology.js", () => ({
  validateFirmBrokerTopology: vi.fn((firmId: string, brokerType: string) => ({
    firmKey: (firmId ?? "").toLowerCase().replace(/_\d+k$/, ""),
    expectedBrokerType: brokerType, // always "matches" — topology check never blocks in this suite
  })),
  normalizeFirmKey: vi.fn((firmId: string) => {
    if (throwFlags.normalizeFirmKey) throw new Error("boom-m5: normalizeFirmKey threw");
    return (firmId ?? "").toLowerCase().replace(/_\d+k$/, "");
  }),
}));

// contract-class: deterministic stop ceiling (MES=14pt) for the M5 fallback path.
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
  // F-5 general compliance gate: always passes (violation:false) so it never
  // interferes with the M5 / clamp catch assertions under test here.
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

function auditActionsWritten(): string[] {
  const insertCalls = (db.insert as unknown as ReturnType<typeof vi.fn>).mock.results;
  const actions: string[] = [];
  for (const r of insertCalls) {
    const values = (r.value as { values?: ReturnType<typeof vi.fn> })?.values;
    if (values) {
      for (const c of values.mock.calls as unknown[][]) {
        const action = (c[0] as { action?: string })?.action;
        if (action) actions.push(action);
      }
    }
  }
  return actions;
}

beforeEach(() => {
  vi.clearAllMocks();
  accountRowRef.current = { ...MFFU_ACCT };
  throwFlags.getFirmLimit = false;
  throwFlags.normalizeFirmKey = false;
});

// ─── Clamp catch (:1020-1023) ────────────────────────────────────────────────

describe("W3A item 2: route-time safety clamp catch — newly action-scoped", () => {
  it("RED→GREEN: entries are BLOCKED when the clamp check throws (was fail-open pre-fix)", async () => {
    throwFlags.getFirmLimit = true;

    const result = await routeOrder("acct-mffu-1", {
      action: "enter_long",
      ticker: "MES1!",
      quantity: 10,
    } as never);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("entry_risk_check_unavailable");
    expect(auditActionsWritten()).toContain("broker_router.entry_risk_check_unavailable");
  });

  it("REGRESSION GUARD: exits still proceed when the SAME clamp check throws (flatten must never block)", async () => {
    throwFlags.getFirmLimit = true;

    const result = await routeOrder("acct-mffu-1", {
      action: "exit_long",
      ticker: "MES1!",
      quantity: 10,
    } as never);

    expect(result.reason).not.toBe("entry_risk_check_unavailable");
    expect(result.success).toBe(true);
  });

  it("REGRESSION GUARD: bare exit action also proceeds when the clamp check throws", async () => {
    throwFlags.getFirmLimit = true;

    const result = await routeOrder("acct-mffu-1", {
      action: "exit",
      ticker: "MES1!",
      quantity: 10,
    } as never);

    expect(result.reason).not.toBe("entry_risk_check_unavailable");
    expect(result.success).toBe(true);
  });

  it("baseline: entries proceed normally when the clamp check does NOT throw", async () => {
    const result = await routeOrder("acct-mffu-1", {
      action: "enter_long",
      ticker: "MES1!",
      quantity: 10,
      price: 6000,
      stopPrice: 5996, // small stop distance -> passes 2% check too
    } as never);

    expect(result.success).toBe(true);
    expect(result.reason).not.toBe("entry_risk_check_unavailable");
  });
});

// ─── M5 catch (:1136-1165) ────────────────────────────────────────────────────

describe("W3A item 2: FIX M5 2%-per-trade catch — unconditional fail-closed (already entry-scoped)", () => {
  it("RED→GREEN: entries are BLOCKED when the M5 check throws (was fail-open pre-fix)", async () => {
    throwFlags.normalizeFirmKey = true;

    const result = await routeOrder("acct-mffu-1", {
      action: "enter_long",
      ticker: "MES1!",
      quantity: 10,
    } as never);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("entry_risk_check_unavailable");
    expect(auditActionsWritten()).toContain("broker_router.entry_risk_check_unavailable");
  });

  it("also blocks enter_short when the M5 check throws", async () => {
    throwFlags.normalizeFirmKey = true;

    const result = await routeOrder("acct-mffu-1", {
      action: "enter_short",
      ticker: "MES1!",
      quantity: 10,
    } as never);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("entry_risk_check_unavailable");
  });

  it("CONSOLIDATION: the old two_percent_rule_check_error action is NOT written by this catch anymore", async () => {
    throwFlags.normalizeFirmKey = true;

    await routeOrder("acct-mffu-1", {
      action: "enter_long",
      ticker: "MES1!",
      quantity: 10,
    } as never);

    expect(auditActionsWritten()).not.toContain("broker_router.two_percent_rule_check_error");
  });

  it("REGRESSION GUARD: exits never even reach this block (structurally entry-gated) — proceed when normalizeFirmKey throws", async () => {
    throwFlags.normalizeFirmKey = true;

    const result = await routeOrder("acct-mffu-1", {
      action: "exit_long",
      ticker: "MES1!",
      quantity: 10,
    } as never);

    expect(result.reason).not.toBe("entry_risk_check_unavailable");
    expect(result.success).toBe(true);
  });

  it("baseline: entries proceed normally when the M5 check does NOT throw", async () => {
    const result = await routeOrder("acct-mffu-1", {
      action: "enter_long",
      ticker: "MES1!",
      quantity: 2,
      price: 6000,
      stopPrice: 5996,
    } as never);

    expect(result.success).toBe(true);
    expect(result.reason).not.toBe("entry_risk_check_unavailable");
  });
});

// ─── Audit row shape ──────────────────────────────────────────────────────────

describe("W3A item 2: broker_router.entry_risk_check_unavailable audit row shape", () => {
  it("carries accountId/firmId/ticker/action/quantity in input and a blocked status", async () => {
    throwFlags.normalizeFirmKey = true;

    await routeOrder("acct-mffu-1", {
      action: "enter_long",
      ticker: "MES1!",
      quantity: 7,
    } as never);

    const insertCalls = (db.insert as unknown as ReturnType<typeof vi.fn>).mock.results;
    let found: Record<string, unknown> | undefined;
    for (const r of insertCalls) {
      const values = (r.value as { values?: ReturnType<typeof vi.fn> })?.values;
      if (values) {
        for (const c of values.mock.calls as unknown[][]) {
          const row = c[0] as Record<string, unknown>;
          if (row?.action === "broker_router.entry_risk_check_unavailable") found = row;
        }
      }
    }

    expect(found).toBeDefined();
    expect(found!.entityType).toBe("broker_account");
    expect(found!.decisionAuthority).toBe("system");
    expect(found!.status).toBe("blocked");
    expect((found!.input as Record<string, unknown>).accountId).toBe("acct-mffu-1");
    expect((found!.input as Record<string, unknown>).action).toBe("enter_long");
  });
});
