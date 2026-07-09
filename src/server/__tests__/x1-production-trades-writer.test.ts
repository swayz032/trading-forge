/**
 * x1-production-trades-writer.test.ts — Deep-Scan #18b X-1 option a (2026-07-05)
 *
 * Unit tests for broker-router.ts::writeProductionTradeRow — the writer that
 * closes the "production_trades has no writer wired" gap flagged by the X-1
 * reconciliation fix. Before this writer existed, reconciliation-service.ts's
 * fetchProxyCountsFromProductionTrades() always read zero rows, so daily recon
 * could only ever report yellow/UNVERIFIABLE, never a genuine green.
 *
 * Covers:
 *   1. Success path writes a production_trades row keyed on the deterministic
 *      TradersPost idempotency key (traderspost_webhook_id).
 *   2. A DB failure during the write is swallowed (never throws) and an
 *      audit_log warning row is written instead.
 *   3. A retry with the SAME idempotency key does not create a duplicate row
 *      (simulates the ON CONFLICT (traderspost_webhook_id) DO NOTHING guard
 *      added by migration 0194 / the schema.ts uniqueIndex).
 *   4. No strategyId on the signal → skipped silently (NOT NULL constraint on
 *      production_trades.strategy_id — nothing safe to key the row on).
 *
 * This file mirrors the full mock rig from broker-router.test.ts (broker-router.ts
 * pulls in a large dependency surface at module load) but is a SEPARATE test file
 * so its productionTrades/strategies-aware db mocks cannot perturb the existing
 * 16-test broker-router.test.ts suite.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  // Simulates the production_trades table's unique index on traderspost_webhook_id.
  productionTradesRows: [] as Array<Record<string, unknown>>,
  auditLogRows: [] as Array<Record<string, unknown>>,
  insertShouldThrow: false,
  strategyConfigRow: { id: "strategy-uuid-test", config: { entry_quality: { foo: "bar" } } } as
    | { id: string; config: unknown }
    | null,
}));

// ─── Mocks (mirrors broker-router.test.ts's rig + schema additions) ──────────

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (mockState.strategyConfigRow ? [mockState.strategyConfigRow] : [])),
        })),
      })),
    })),
    insert: vi.fn((table: { tableName?: string }) => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        if (table?.tableName === "production_trades") {
          if (mockState.insertShouldThrow) {
            throw new Error("simulated_db_write_failure");
          }
          // Simulate ON CONFLICT (traderspost_webhook_id) DO NOTHING: skip the
          // insert if a row with the same key already exists.
          const conflict = mockState.productionTradesRows.some(
            (r) => r.traderspostWebhookId === vals.traderspostWebhookId,
          );
          return {
            onConflictDoNothing: vi.fn(async () => {
              if (!conflict) mockState.productionTradesRows.push(vals);
              return [] as unknown[];
            }),
          };
        }
        if (table?.tableName === "audit_log") {
          mockState.auditLogRows.push(vals);
          return Promise.resolve([{ id: "audit-row-id" }]);
        }
        return Promise.resolve([{ id: "generic-row-id" }]);
      }),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  brokerAccounts: { tableName: "broker_accounts" },
  auditLog: { tableName: "audit_log" },
  productionTrades: { tableName: "production_trades", traderspostWebhookId: "traderspost_webhook_id" },
  strategies: { tableName: "strategies", id: "id", config: "config" },
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
  getFirmAccount: vi.fn().mockReturnValue(undefined),
  CONTRACT_SPECS: {},
  DEFAULT_ACCOUNT_SIZE: 50000,
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
  buildDeterministicIdempotencyKey: vi.fn(
    (inputs: { accountId: string; strategyId: string; ticker: string; action: string; barTs: string }) =>
      `idem:${inputs.accountId}|${inputs.strategyId}|${inputs.ticker}|${inputs.action}|${inputs.barTs}`,
  ),
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

import { writeProductionTradeRow } from "../services/broker-router.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_SIGNAL = {
  action: "enter_long" as const,
  ticker: "MES1!",
  quantity: 1,
  orderType: "market" as const,
  strategyId: "strategy-uuid-test",
  barTimestamp: "2026-05-09T14:30:00.000Z",
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockState.productionTradesRows = [];
  mockState.auditLogRows = [];
  mockState.insertShouldThrow = false;
  mockState.strategyConfigRow = { id: "strategy-uuid-test", config: { entry_quality: { foo: "bar" } } };
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("broker-router — writeProductionTradeRow (X-1 option a)", () => {
  it("success path: writes exactly one production_trades row keyed on the idempotency key", async () => {
    await writeProductionTradeRow({
      accountId: "test-account-uuid-1234",
      signal: BASE_SIGNAL,
      idempotencyKey: "idem:test-account-uuid-1234|strategy-uuid-test|MES1!|enter_long|2026-05-09T14:30:00.000Z",
      correlationId: "corr-success-1",
    });

    expect(mockState.productionTradesRows).toHaveLength(1);
    const row = mockState.productionTradesRows[0];
    expect(row.strategyId).toBe("strategy-uuid-test");
    expect(row.traderspostWebhookId).toBe(
      "idem:test-account-uuid-1234|strategy-uuid-test|MES1!|enter_long|2026-05-09T14:30:00.000Z",
    );
    expect(row.signalValue).toBe(1); // enter_long → +1
    expect(row.correlationId).toBe("corr-success-1");
    expect(typeof row.strategyVersionHash).toBe("string");
    expect((row.strategyVersionHash as string).length).toBeGreaterThan(0);
    // No fabricated PnL — honest null until a real TP target can be threaded through.
    expect(row.expectedPnl).toBeNull();
  });

  it("success path: enter_short encodes signal_value = -1", async () => {
    await writeProductionTradeRow({
      accountId: "test-account-uuid-1234",
      signal: { ...BASE_SIGNAL, action: "enter_short" },
      idempotencyKey: "idem:short-key",
      correlationId: null,
    });

    expect(mockState.productionTradesRows).toHaveLength(1);
    expect(mockState.productionTradesRows[0].signalValue).toBe(-1);
  });

  it("failure is swallowed (never throws) and an audit_log warning row is written", async () => {
    mockState.insertShouldThrow = true;

    await expect(
      writeProductionTradeRow({
        accountId: "test-account-uuid-1234",
        signal: BASE_SIGNAL,
        idempotencyKey: "idem:will-fail",
        correlationId: "corr-fail-1",
      }),
    ).resolves.toBeUndefined();

    // No row was persisted (the throw happened before push)...
    expect(mockState.productionTradesRows).toHaveLength(0);
    // ...but the failure was captured as an auditable warning, not silently lost.
    const failureAudit = mockState.auditLogRows.find(
      (r) => r.action === "broker_router.production_trades_write_failed",
    );
    expect(failureAudit).toBeDefined();
    expect(failureAudit?.status).toBe("warning");
    expect(failureAudit?.correlationId).toBe("corr-fail-1");
  });

  it("retry with the same idempotency key does not create a duplicate row", async () => {
    const params = {
      accountId: "test-account-uuid-1234",
      signal: BASE_SIGNAL,
      idempotencyKey: "idem:retry-key-stable",
      correlationId: "corr-retry-1",
    };

    await writeProductionTradeRow(params);
    await writeProductionTradeRow(params); // simulates a network retry / DLQ replay of the same order

    expect(mockState.productionTradesRows).toHaveLength(1);
  });

  it("two DIFFERENT idempotency keys DO produce two distinct rows (sanity check on the dedup simulation)", async () => {
    await writeProductionTradeRow({
      accountId: "test-account-uuid-1234",
      signal: BASE_SIGNAL,
      idempotencyKey: "idem:key-A",
      correlationId: "corr-a",
    });
    await writeProductionTradeRow({
      accountId: "test-account-uuid-1234",
      signal: BASE_SIGNAL,
      idempotencyKey: "idem:key-B",
      correlationId: "corr-b",
    });

    expect(mockState.productionTradesRows).toHaveLength(2);
  });

  it("skips silently when the signal has no strategyId (NOT NULL constraint — nothing safe to key on)", async () => {
    await writeProductionTradeRow({
      accountId: "test-account-uuid-1234",
      signal: { ...BASE_SIGNAL, strategyId: undefined },
      idempotencyKey: "idem:no-strategy-id",
      correlationId: "corr-no-strategy",
    });

    expect(mockState.productionTradesRows).toHaveLength(0);
    // Not a failure — no warning audit row should be written for this case.
    const failureAudit = mockState.auditLogRows.find(
      (r) => r.action === "broker_router.production_trades_write_failed",
    );
    expect(failureAudit).toBeUndefined();
  });

  it("falls back to a degraded (but still non-null) strategy_version_hash when the strategy row can't be read", async () => {
    mockState.strategyConfigRow = null; // simulates strategy lookup returning zero rows

    await writeProductionTradeRow({
      accountId: "test-account-uuid-1234",
      signal: BASE_SIGNAL,
      idempotencyKey: "idem:no-strategy-row",
      correlationId: "corr-degraded",
    });

    expect(mockState.productionTradesRows).toHaveLength(1);
    const hash = mockState.productionTradesRows[0].strategyVersionHash as string;
    expect(hash.startsWith("unavailable:")).toBe(true);
  });
});
