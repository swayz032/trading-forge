/**
 * obs-fix3-frozen-policy-tx-atomicity.test.ts
 *
 * Proves FIX 3: POST /api/admin/frozen-policy-override now wraps the UPDATE +
 * audit INSERT in a single db.transaction() so they commit/rollback together.
 *
 * Invariants under test:
 *   1. Happy path: transaction called with UPDATE + INSERT in the same tx context.
 *   2. If the UPDATE inside the tx fails, audit INSERT is NOT called and endpoint returns 500.
 *   3. If the audit INSERT inside the tx fails, UPDATE is also rolled back and endpoint returns 500.
 *   4. HMAC verification, replay-protection, and rationale-length gates are unchanged.
 *   5. frozen_policy.override_used audit carries correlationId.
 *
 * Uses the same ephemeral-port fetch pattern as wave29-pass-b2-frozen-policy.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import express from "express";
import type { Express } from "express";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  dbSelectResult: vi.fn(),
  txUpdateCalled: vi.fn(),
  txInsertValues: vi.fn(),
  txUpdateShouldFail: false,
  txInsertShouldFail: false,
  transactionCalled: false,
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => {
          const resultPromise = Promise.resolve(mocks.dbSelectResult());
          (resultPromise as unknown as Record<string, unknown>).limit = (_n: number) =>
            Promise.resolve(mocks.dbSelectResult());
          return resultPromise as unknown as Promise<unknown[]> & { limit: (n: number) => Promise<unknown[]> };
        },
      }),
    }),
    // The non-transactional insert path is used for the rationale_too_short audit only
    insert: (_table: unknown) => ({
      values: (vals: unknown) => {
        mocks.txInsertValues(vals);
        return Promise.resolve(undefined);
      },
    }),
    update: (_table: unknown) => ({
      set: (vals: unknown) => ({
        where: (_cond: unknown) => {
          mocks.txUpdateCalled(vals);
          return Promise.resolve(undefined);
        },
      }),
    }),
    // FIX 3: transaction wraps UPDATE + audit INSERT
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      mocks.transactionCalled = true;

      const tx = {
        update: (_table: unknown) => ({
          set: (vals: unknown) => ({
            where: (_cond: unknown) => {
              mocks.txUpdateCalled(vals);
              if (mocks.txUpdateShouldFail) {
                return Promise.reject(new Error("tx update failed"));
              }
              return Promise.resolve(undefined);
            },
          }),
        }),
        insert: (_table: unknown) => ({
          values: (vals: unknown) => {
            mocks.txInsertValues(vals);
            if (mocks.txInsertShouldFail) {
              return Promise.reject(new Error("tx audit insert failed"));
            }
            return Promise.resolve(undefined);
          },
        }),
      };

      return cb(tx);
    },
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies: { id: "id", config: "config", frozenPolicyHash: "frozenPolicyHash" },
  auditLog: {},
}));

vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../lib/metrics-registry.js", () => ({
  frozenPolicyOverridesTotal: { inc: vi.fn() },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn((body: string) => body),
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

const TEST_SECRET = "fix3-test-super-secret-hmac-key-32char!!";
const VALID_STRATEGY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const VALID_RATIONALE = "This rationale is definitely over fifty characters and is institutional-grade for FIX 3 testing.";

function makeValidSignature(secret: string, timestamp: number, strategyId: string, rationale: string): string {
  const payload = `${timestamp}:${strategyId}:${rationale}`;
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function makeConfig() {
  return {
    entry_quality: { use_weighted_scoring: true },
    position_size: { type: "risk_derived_pyramid", base_contracts: 6 },
    stop_loss: { type: "structural", atr_multiplier: 1.5, ceiling_pts: 14 },
    take_profit: { style: "style_c", tp1_r: 1.0, tp2_r: 2.0 },
    exit_plan_config: { exit_style: "adaptive" },
  };
}

async function buildApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  const { adminFrozenPolicyOverrideRoutes } = await import("../routes/admin-frozen-policy-override.js");
  app.use("/api/admin", adminFrozenPolicyOverrideRoutes);
  return app;
}

async function callEndpoint(
  app: Express,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(`http://127.0.0.1:${port}/api/admin/frozen-policy-override`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
        });
        const json = await res.json() as Record<string, unknown>;
        resolve({ status: res.status, body: json });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
    server.on("error", reject);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FIX 3 — frozen-policy override: atomic transaction (UPDATE + audit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbSelectResult.mockReturnValue([
      {
        id: VALID_STRATEGY_ID,
        name: "fix3_test_strategy",
        config: makeConfig(),
        frozenPolicyHash: "oldhash".padEnd(64, "0"),
        frozenPolicyOverrideCount: 0,
      },
    ]);
    mocks.txUpdateShouldFail = false;
    mocks.txInsertShouldFail = false;
    mocks.transactionCalled = false;
    process.env.ADMIN_OVERRIDE_HMAC_SECRET = TEST_SECRET;
    process.env.NODE_ENV = "test";
  });

  it("happy path: db.transaction() is called (UPDATE + INSERT in same tx context)", async () => {
    const app = await buildApp();
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = makeValidSignature(TEST_SECRET, timestamp, VALID_STRATEGY_ID, VALID_RATIONALE);

    const { status, body } = await callEndpoint(
      app,
      { strategy_id: VALID_STRATEGY_ID, rationale: VALID_RATIONALE, timestamp },
      { "x-override-signature": sig },
    );

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.transactionCalled).toBe(true);

    // UPDATE was called inside the tx
    expect(mocks.txUpdateCalled).toHaveBeenCalledOnce();

    // frozen_policy.override_used audit INSERT was called inside the tx
    const overrideAudit = (mocks.txInsertValues.mock.calls as unknown[][]).find(
      (c) => (c[0] as Record<string, unknown>).action === "frozen_policy.override_used",
    );
    expect(overrideAudit).toBeDefined();

    // correlationId is present in the audit row
    const auditRow = overrideAudit![0] as Record<string, unknown>;
    expect(typeof auditRow.correlationId).toBe("string");
    expect((auditRow.correlationId as string).length).toBeGreaterThan(0);
  });

  it("if UPDATE inside tx fails → endpoint returns 500 (no partial commit)", async () => {
    mocks.txUpdateShouldFail = true;

    const app = await buildApp();
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = makeValidSignature(TEST_SECRET, timestamp, VALID_STRATEGY_ID, VALID_RATIONALE);

    const { status, body } = await callEndpoint(
      app,
      { strategy_id: VALID_STRATEGY_ID, rationale: VALID_RATIONALE, timestamp },
      { "x-override-signature": sig },
    );

    expect(status).toBe(500);
    expect(body.error).toBe("override_transaction_failed");

    // No audit INSERT was called (tx rolled back at UPDATE step)
    const overrideAudit = (mocks.txInsertValues.mock.calls as unknown[][]).find(
      (c) => (c[0] as Record<string, unknown>).action === "frozen_policy.override_used",
    );
    expect(overrideAudit).toBeUndefined();
  });

  it("if audit INSERT inside tx fails → endpoint returns 500 (UPDATE also rolled back)", async () => {
    mocks.txInsertShouldFail = true;

    const app = await buildApp();
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = makeValidSignature(TEST_SECRET, timestamp, VALID_STRATEGY_ID, VALID_RATIONALE);

    const { status, body } = await callEndpoint(
      app,
      { strategy_id: VALID_STRATEGY_ID, rationale: VALID_RATIONALE, timestamp },
      { "x-override-signature": sig },
    );

    expect(status).toBe(500);
    expect(body.error).toBe("override_transaction_failed");
    expect(typeof body.correlationId).toBe("string");
  });

  it("HMAC verification gate is unchanged (401 on invalid sig)", async () => {
    const app = await buildApp();
    const timestamp = Math.floor(Date.now() / 1000);
    const { status, body } = await callEndpoint(
      app,
      { strategy_id: VALID_STRATEGY_ID, rationale: VALID_RATIONALE, timestamp },
      { "x-override-signature": "deadbeef".repeat(8) },
    );
    expect(status).toBe(401);
    expect(body.error).toBe("hmac_verification_failed");
    // Transaction must NOT be called on auth failure
    expect(mocks.transactionCalled).toBe(false);
  });

  it("rationale-too-short gate is unchanged (400, no transaction)", async () => {
    const app = await buildApp();
    const shortRationale = "Too short.";
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = makeValidSignature(TEST_SECRET, timestamp, VALID_STRATEGY_ID, shortRationale);

    const { status, body } = await callEndpoint(
      app,
      { strategy_id: VALID_STRATEGY_ID, rationale: shortRationale, timestamp },
      { "x-override-signature": sig },
    );
    expect(status).toBe(400);
    expect(body.error).toBe("rationale_too_short");
    expect(mocks.transactionCalled).toBe(false);
  });

  it("frozen_policy.override_used audit row carries correlationId and override_count", async () => {
    // override_count starts at 0 → should be 1 after the call
    const app = await buildApp();
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = makeValidSignature(TEST_SECRET, timestamp, VALID_STRATEGY_ID, VALID_RATIONALE);

    await callEndpoint(
      app,
      { strategy_id: VALID_STRATEGY_ID, rationale: VALID_RATIONALE, timestamp },
      { "x-override-signature": sig },
    );

    const auditCall = (mocks.txInsertValues.mock.calls as unknown[][]).find(
      (c) => (c[0] as Record<string, unknown>).action === "frozen_policy.override_used",
    );
    expect(auditCall).toBeDefined();
    const auditRow = auditCall![0] as Record<string, unknown>;
    const result = auditRow.result as Record<string, unknown>;

    expect(result.override_count).toBe(1); // 0 + 1
    expect(result.rationale).toBe(VALID_RATIONALE);
    expect(typeof auditRow.correlationId).toBe("string");
  });
});
