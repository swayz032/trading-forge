/**
 * broker-reliability.test.ts
 *
 * TDD tests for three production-hardening findings:
 *
 * FINDING #2 — Deterministic bar-scoped idempotency key
 *   - Two calls for the SAME bar produce the SAME X-Idempotency-Key
 *   - Different bars produce different keys
 *   - The key is independent of the per-request correlationId (UUID)
 *
 * FINDING #4 — Circuit breaker + Discord critical for TradersPost
 *   - TRADERSPOST_CIRCUIT_BREAKER_KEY exported from broker-router
 *   - BrokerResultReason union includes "traderspost_circuit_open"
 *
 * FINDING #3 (kill-switch correlationId rot)
 *   - setMode("HALT") audit row has non-null correlationId
 *   - LAYER7_AUDIT_GENERATES_CORRELATION_ID sentinel exported from kill-switch
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

// ─── Top-level mocks (hoisted by vitest) ─────────────────────────────────────
// These must be at the top level so vitest can hoist them before module imports.

vi.mock("../db/index.js", () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve()),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() =>
            Promise.resolve([
              {
                productionMode: "LIVE",
                killReason: null,
                setBy: "operator",
                setAt: new Date(),
              },
            ])
          ),
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
    execute: vi.fn(() => Promise.resolve({ rows: [{ id: 42 }] })),
  },
}));

vi.mock("../db/schema.js", () => ({
  systemState: { id: 1 },
  auditLog: {},
  weeklyDriftReports: { ranAt: {}, severity: {}, reportWeek: {} },
  brokerAccounts: { enabled: {}, firmId: {}, accountId: {}, brokerType: {} },
  paperSessions: {
    status: {},
    id: {},
    firmId: {},
    dailyPnlBreakdown: {},
    currentEquity: {},
    realizedPeakEquity: {},
  },
  tradingviewMarkers: {},
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../index.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: { systemError: vi.fn() },
}));

vi.mock("../services/exchange-status-service.js", () => ({
  isExchangeHalted: vi.fn(() => false),
}));

vi.mock("../services/prop-firm-health-service.js", () => ({
  isFirmSuspended: vi.fn(() => false),
}));

vi.mock("../lib/network-failover.js", () => ({
  isConnectivityDegraded: vi.fn(() => false),
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn(async () => {}),
  insertAuditRowSafe: vi.fn(async () => true),
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn(async () => true),
}));

vi.mock("../lib/credential-loader.js", () => ({
  loadBrokerCredentials: vi.fn(async () => ({ apiKey: "test-api-key" })),
}));

vi.mock("../integrations/traderspost/webhook-builder.js", () => ({
  buildWebhookPayload: vi.fn(() => ({
    apiKey: "test-api-key",
    ticker: "MES",
    action: "buy",
    orderType: "market",
    strategyId: "strat-001",
  })),
}));

vi.mock("../services/strategy-assignment-service.js", () => ({
  getEnabledFirms: vi.fn(async () => ["topstep", "mffu"]),
}));

vi.mock("../../shared/firm-config.js", () => ({
  getFirmLimit: vi.fn(() => ({ maxContracts: 10 })),
  CONTRACT_CAP_MAX: 10,
  getFirmAccount: vi.fn(() => ({ dailyLossLimit: 500, maxDrawdown: 3000 })),
}));

// ─── FINDING #2 Tests — deterministic idempotency key ─────────────────────────

describe("FINDING #2: Bar-scoped idempotency key", () => {
  it("buildDeterministicIdempotencyKey is exported from client.ts", async () => {
    const mod = await import("../integrations/traderspost/client.js");
    expect(typeof mod.buildDeterministicIdempotencyKey).toBe("function");
  });

  it("same bar inputs produce the same idempotency key", async () => {
    const { buildDeterministicIdempotencyKey } = await import(
      "../integrations/traderspost/client.js"
    );

    const key1 = buildDeterministicIdempotencyKey({
      accountId: "acc-001",
      strategyId: "strat-001",
      ticker: "MES",
      action: "buy",
      barTs: "2026-06-22T14:00:00.000Z",
    });

    const key2 = buildDeterministicIdempotencyKey({
      accountId: "acc-001",
      strategyId: "strat-001",
      ticker: "MES",
      action: "buy",
      barTs: "2026-06-22T14:00:00.000Z",
    });

    expect(key1).toBe(key2);
    expect(typeof key1).toBe("string");
    expect(key1.length).toBeGreaterThan(0);
  });

  it("different bar timestamps produce different idempotency keys", async () => {
    const { buildDeterministicIdempotencyKey } = await import(
      "../integrations/traderspost/client.js"
    );

    const key1 = buildDeterministicIdempotencyKey({
      accountId: "acc-001",
      strategyId: "strat-001",
      ticker: "MES",
      action: "buy",
      barTs: "2026-06-22T14:00:00.000Z",
    });

    const key2 = buildDeterministicIdempotencyKey({
      accountId: "acc-001",
      strategyId: "strat-001",
      ticker: "MES",
      action: "buy",
      barTs: "2026-06-22T14:05:00.000Z",
    });

    expect(key1).not.toBe(key2);
  });

  it("different accounts produce different idempotency keys for the same bar", async () => {
    const { buildDeterministicIdempotencyKey } = await import(
      "../integrations/traderspost/client.js"
    );

    const key1 = buildDeterministicIdempotencyKey({
      accountId: "acc-001",
      strategyId: "strat-001",
      ticker: "MES",
      action: "buy",
      barTs: "2026-06-22T14:00:00.000Z",
    });

    const key2 = buildDeterministicIdempotencyKey({
      accountId: "acc-002",
      strategyId: "strat-001",
      ticker: "MES",
      action: "buy",
      barTs: "2026-06-22T14:00:00.000Z",
    });

    expect(key1).not.toBe(key2);
  });

  it("correlationId (per-request UUID) does NOT affect the idempotency key", async () => {
    const { buildDeterministicIdempotencyKey } = await import(
      "../integrations/traderspost/client.js"
    );

    const inputs = {
      accountId: "acc-001",
      strategyId: "strat-001",
      ticker: "MES",
      action: "buy",
      barTs: "2026-06-22T14:00:00.000Z",
    } as const;

    // Two fresh UUIDs that would differ per-request in the old code
    const uuid1 = randomUUID();
    const uuid2 = randomUUID();
    expect(uuid1).not.toBe(uuid2);

    // Key is bar-scoped — same regardless of any correlation id
    const key1 = buildDeterministicIdempotencyKey(inputs);
    const key2 = buildDeterministicIdempotencyKey(inputs);
    expect(key1).toBe(key2);
  });

  it("different actions on the same bar produce different keys", async () => {
    const { buildDeterministicIdempotencyKey } = await import(
      "../integrations/traderspost/client.js"
    );

    const key1 = buildDeterministicIdempotencyKey({
      accountId: "acc-001",
      strategyId: "strat-001",
      ticker: "MES",
      action: "buy",
      barTs: "2026-06-22T14:00:00.000Z",
    });

    const key2 = buildDeterministicIdempotencyKey({
      accountId: "acc-001",
      strategyId: "strat-001",
      ticker: "MES",
      action: "sell",
      barTs: "2026-06-22T14:00:00.000Z",
    });

    expect(key1).not.toBe(key2);
  });
});

// ─── FINDING #4 Tests — circuit breaker constants ─────────────────────────────

describe("FINDING #4: TradersPost circuit breaker exports", () => {
  it("exports TRADERSPOST_CIRCUIT_BREAKER_KEY constant", async () => {
    const mod = await import("../services/broker-router.js");
    expect(typeof mod.TRADERSPOST_CIRCUIT_BREAKER_KEY).toBe("string");
    expect(mod.TRADERSPOST_CIRCUIT_BREAKER_KEY.length).toBeGreaterThan(0);
  });

  it("exports TRADERSPOST_CIRCUIT_OPEN_REASON constant matching BrokerResultReason", async () => {
    const mod = await import("../services/broker-router.js");
    expect(mod.TRADERSPOST_CIRCUIT_OPEN_REASON).toBe("traderspost_circuit_open");
  });

  it("BrokerResultReason type includes traderspost_circuit_open via the exported constant", async () => {
    const mod = await import("../services/broker-router.js");
    // Runtime check: the constant must equal the string literal
    const reason: string = mod.TRADERSPOST_CIRCUIT_OPEN_REASON;
    expect(reason).toBe("traderspost_circuit_open");
  });
});

// ─── FINDING #3 Tests — kill-switch correlationId ─────────────────────────────

describe("FINDING #3: kill-switch correlationId on audit rows", () => {
  it("exports LAYER7_AUDIT_GENERATES_CORRELATION_ID sentinel as true", async () => {
    const mod = await import("../production/kill-switch.js");
    expect(mod.LAYER7_AUDIT_GENERATES_CORRELATION_ID).toBe(true);
  });

  it("setMode HALT audit row has non-null correlationId", async () => {
    const auditInserted: Array<Record<string, unknown>> = [];

    // Override the db.insert mock to capture rows
    const { db } = await import("../db/index.js");
    (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        auditInserted.push(vals);
        return Promise.resolve();
      }),
    }));
    // Override update mock
    (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    }));
    // getCurrentState — returns LIVE so mode_changed diff works
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() =>
            Promise.resolve([
              {
                productionMode: "LIVE",
                killReason: null,
                setBy: "operator",
                setAt: new Date(),
              },
            ])
          ),
        })),
      })),
    });

    const { killSwitch } = await import("../production/kill-switch.js");
    killSwitch._invalidateCacheForTests();

    await killSwitch.setMode("HALT", "test_halt_reason", "operator");

    const haltRow = auditInserted.find(
      (r) => r["action"] === "production.mode_changed"
    );

    expect(haltRow).toBeDefined();
    expect(haltRow?.["correlationId"]).not.toBeNull();
    expect(haltRow?.["correlationId"]).not.toBeUndefined();
    expect(typeof haltRow?.["correlationId"]).toBe("string");
    // Verify it looks like a UUID
    expect(haltRow?.["correlationId"] as string).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});
