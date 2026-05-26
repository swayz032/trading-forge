/**
 * wave29-pass-b2-frozen-policy.test.ts — Wave 29 Pass B.2 (backtest-core)
 *
 * Tests for:
 *  1. computeFrozenPolicyHash — determinism, field sensitivity, canonical sort
 *  2. freezePolicyForStrategy — DB write + audit emission
 *  3. evaluateFrozenPolicyDriftAtPromotion — ok/blocked/first-time branches
 *  4. POST /api/admin/frozen-policy-override HMAC endpoint — happy path + error paths
 *  5. Lifecycle PAPER → DEPLOY_READY frozen-policy gate stubs
 *
 * No supertest dependency — uses ephemeral-port fetch (project pattern from
 * prop-firm-route-survival.test.ts / quantum-pre-flight.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import express from "express";
import type { Express } from "express";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  dbSelectResult: vi.fn(),
  dbUpdateCalled: vi.fn(),
  dbInsertValues: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => {
          // Return an object that is both awaitable AND supports .limit()
          const resultPromise = Promise.resolve(mocks.dbSelectResult());
          (resultPromise as unknown as Record<string, unknown>).limit = (_n: number) =>
            Promise.resolve(mocks.dbSelectResult());
          return resultPromise as unknown as Promise<unknown[]> & { limit: (n: number) => Promise<unknown[]> };
        },
      }),
    }),
    insert: (_table: unknown) => ({
      values: (vals: unknown) => {
        mocks.dbInsertValues(vals);
        return Promise.resolve(undefined);
      },
    }),
    update: (_table: unknown) => ({
      set: (vals: unknown) => ({
        where: (_cond: unknown) => {
          mocks.dbUpdateCalled(vals);
          return Promise.resolve(undefined);
        },
      }),
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies: { id: "id", config: "config", frozenPolicyHash: "frozenPolicyHash" },
  auditLog: {},
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Test data helpers ────────────────────────────────────────────────────────

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    entry_quality: { use_weighted_scoring: true, min_confluence: 0.72 },
    position_size: { type: "risk_derived_pyramid", base_contracts: 6 },
    stop_loss: { type: "structural", atr_multiplier: 1.5, ceiling_pts: 14 },
    take_profit: { style: "style_c", tp1_r: 1.0, tp2_r: 2.0 },
    exit_plan_config: { exit_style: "adaptive" },
    ...overrides,
  };
}

// ─── 1. computeFrozenPolicyHash — determinism ─────────────────────────────────

import {
  computeFrozenPolicyHash,
  evaluateFrozenPolicyDriftAtPromotion,
  freezePolicyForStrategy,
} from "../lib/frozen-policy-contract.js";

describe("computeFrozenPolicyHash", () => {
  it("returns a 64-character hex string", () => {
    const hash = computeFrozenPolicyHash({ config: makeConfig() });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic: identical config → identical hash on repeated calls", () => {
    const config = makeConfig();
    const h1 = computeFrozenPolicyHash({ config });
    const h2 = computeFrozenPolicyHash({ config });
    expect(h1).toBe(h2);
  });

  it("produces different hash when entry_quality changes", () => {
    const base = computeFrozenPolicyHash({ config: makeConfig() });
    const mutated = computeFrozenPolicyHash({
      config: makeConfig({ entry_quality: { use_weighted_scoring: false, min_confluence: 0.60 } }),
    });
    expect(base).not.toBe(mutated);
  });

  it("produces different hash when position_size changes", () => {
    const base = computeFrozenPolicyHash({ config: makeConfig() });
    const mutated = computeFrozenPolicyHash({
      config: makeConfig({ position_size: { type: "fixed", contracts: 1 } }),
    });
    expect(base).not.toBe(mutated);
  });

  it("produces different hash when stop_loss changes", () => {
    const base = computeFrozenPolicyHash({ config: makeConfig() });
    const mutated = computeFrozenPolicyHash({
      config: makeConfig({ stop_loss: { type: "structural", atr_multiplier: 2.0, ceiling_pts: 10 } }),
    });
    expect(base).not.toBe(mutated);
  });

  it("produces different hash when take_profit changes", () => {
    const base = computeFrozenPolicyHash({ config: makeConfig() });
    const mutated = computeFrozenPolicyHash({
      config: makeConfig({ take_profit: { style: "style_c", tp1_r: 1.5, tp2_r: 3.0 } }),
    });
    expect(base).not.toBe(mutated);
  });

  it("produces different hash when exit_plan_config changes", () => {
    const base = computeFrozenPolicyHash({ config: makeConfig() });
    const mutated = computeFrozenPolicyHash({
      config: makeConfig({ exit_plan_config: { exit_style: "static_styleC" } }),
    });
    expect(base).not.toBe(mutated);
  });

  it("produces SAME hash when an unrelated non-policy field is added to config", () => {
    const baseConfig = makeConfig();
    const extendedConfig = { ...makeConfig(), extra_debug_field: "ignore_me", symbol: "MES" };
    // extra_debug_field and symbol are NOT in the 5 hashed fields
    const h1 = computeFrozenPolicyHash({ config: baseConfig });
    const h2 = computeFrozenPolicyHash({ config: extendedConfig });
    expect(h1).toBe(h2);
  });

  it("is canonical-sort invariant: hash is the same regardless of JSON key order", () => {
    const config1 = {
      entry_quality: { a: 1, b: 2 },
      exit_plan_config: { z: "last", a: "first" },
      position_size: { contracts: 6 },
      stop_loss: { floor: 1.5 },
      take_profit: { r1: 1.0 },
    };
    const config2 = {
      stop_loss: { floor: 1.5 },
      take_profit: { r1: 1.0 },
      entry_quality: { b: 2, a: 1 },
      position_size: { contracts: 6 },
      exit_plan_config: { a: "first", z: "last" },
    };
    const h1 = computeFrozenPolicyHash({ config: config1 });
    const h2 = computeFrozenPolicyHash({ config: config2 });
    expect(h1).toBe(h2);
  });
});

// ─── 2. evaluateFrozenPolicyDriftAtPromotion ─────────────────────────────────

describe("evaluateFrozenPolicyDriftAtPromotion", () => {
  it("returns ok:true when frozenHash is null (never frozen — first-time freeze allowed)", () => {
    const strategy = { id: "abc", config: makeConfig(), frozenPolicyHash: null };
    const result = evaluateFrozenPolicyDriftAtPromotion(strategy);
    expect(result.ok).toBe(true);
    expect(result.frozenHash).toBeNull();
  });

  it("returns ok:true when current hash matches frozen hash (policy stable)", () => {
    const config = makeConfig();
    const hash = computeFrozenPolicyHash({ config });
    const strategy = { id: "abc", config, frozenPolicyHash: hash };
    const result = evaluateFrozenPolicyDriftAtPromotion(strategy);
    expect(result.ok).toBe(true);
    expect(result.currentHash).toBe(hash);
    expect(result.frozenHash).toBe(hash);
  });

  it("returns ok:false with reason populated when hashes differ", () => {
    const originalConfig = makeConfig();
    const frozenHash = computeFrozenPolicyHash({ config: originalConfig });
    const mutatedConfig = makeConfig({ position_size: { type: "fixed", contracts: 99 } });
    const strategy = { id: "abc", config: mutatedConfig, frozenPolicyHash: frozenHash };
    const result = evaluateFrozenPolicyDriftAtPromotion(strategy);
    expect(result.ok).toBe(false);
    expect(result.frozenHash).toBe(frozenHash);
    expect(result.currentHash).not.toBe(frozenHash);
    expect(result.reason).toMatch(/hash_mismatch/);
  });

  it("currentHash is always a 64-char hex string regardless of outcome", () => {
    const strategy = { id: "abc", config: makeConfig(), frozenPolicyHash: "old_hash" };
    const result = evaluateFrozenPolicyDriftAtPromotion(strategy);
    expect(result.currentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── 3. freezePolicyForStrategy — DB write + audit ───────────────────────────

describe("freezePolicyForStrategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves with { hash, frozen_at } and calls DB update + audit insert", async () => {
    mocks.dbSelectResult.mockReturnValue([
      {
        id: "11111111-1111-1111-1111-111111111111",
        config: makeConfig(),
      },
    ]);

    const result = await freezePolicyForStrategy(
      "11111111-1111-1111-1111-111111111111",
      "TRENDING",
    );

    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.frozen_at).toBeInstanceOf(Date);

    // DB update was called (mocks.dbUpdateCalled receives the .set() value)
    expect(mocks.dbUpdateCalled).toHaveBeenCalled();

    // Audit INSERT for frozen_policy.set was called
    const insertCall = mocks.dbInsertValues.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).action === "frozen_policy.set",
    );
    expect(insertCall).toBeDefined();
    expect((insertCall![0] as Record<string, unknown>).entityId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("throws when strategy not found", async () => {
    mocks.dbSelectResult.mockReturnValue([]); // empty = not found

    await expect(
      freezePolicyForStrategy("nonexistent-id", "RANGE_BOUND"),
    ).rejects.toThrow("not found");
  });
});

// ─── 4. HMAC override endpoint — ephemeral-port fetch (project pattern) ──────

const TEST_SECRET = "test-super-secret-hmac-key-for-unit-tests-32char";
const VALID_STRATEGY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const VALID_RATIONALE = "This is a valid rationale that is definitely more than fifty characters long and is institutional-grade.";

function makeValidSignature(
  secret: string,
  timestamp: number,
  strategyId: string,
  rationale: string,
): string {
  const payload = `${timestamp}:${strategyId}:${rationale}`;
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

async function buildOverrideApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  const { adminFrozenPolicyOverrideRoutes } = await import("../routes/admin-frozen-policy-override.js");
  app.use("/api/admin", adminFrozenPolicyOverrideRoutes);
  return app;
}

async function callOverrideEndpoint(
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

describe("POST /api/admin/frozen-policy-override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_OVERRIDE_HMAC_SECRET = TEST_SECRET;
    process.env.NODE_ENV = "test";
  });

  it("returns 401 on invalid HMAC signature", async () => {
    const app = await buildOverrideApp();
    const timestamp = Math.floor(Date.now() / 1000);
    const { status, body } = await callOverrideEndpoint(
      app,
      { strategy_id: VALID_STRATEGY_ID, rationale: VALID_RATIONALE, timestamp },
      { "x-override-signature": "deadbeef".repeat(8) },
    );
    expect(status).toBe(401);
    expect(body.error).toBe("hmac_verification_failed");
  });

  it("returns 401 on timestamp drift > 60s (replay protection)", async () => {
    const app = await buildOverrideApp();
    const oldTimestamp = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago
    const sig = makeValidSignature(TEST_SECRET, oldTimestamp, VALID_STRATEGY_ID, VALID_RATIONALE);
    const { status, body } = await callOverrideEndpoint(
      app,
      { strategy_id: VALID_STRATEGY_ID, rationale: VALID_RATIONALE, timestamp: oldTimestamp },
      { "x-override-signature": sig },
    );
    expect(status).toBe(401);
    expect(body.error).toBe("timestamp_drift_exceeded");
  });

  it("returns 400 and frozen_policy.override_rationale_too_short audit when rationale < 50 chars", async () => {
    mocks.dbInsertValues.mockClear();
    const app = await buildOverrideApp();
    const timestamp = Math.floor(Date.now() / 1000);
    const shortRationale = "Too short.";
    const sig = makeValidSignature(TEST_SECRET, timestamp, VALID_STRATEGY_ID, shortRationale);
    const { status, body } = await callOverrideEndpoint(
      app,
      { strategy_id: VALID_STRATEGY_ID, rationale: shortRationale, timestamp },
      { "x-override-signature": sig },
    );
    expect(status).toBe(400);
    expect(body.error).toBe("rationale_too_short");
    // Audit row for too_short should have been written
    const insertCall = mocks.dbInsertValues.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).action === "frozen_policy.override_rationale_too_short",
    );
    expect(insertCall).toBeDefined();
  });

  it("returns 503 when ADMIN_OVERRIDE_HMAC_SECRET is unset in production", async () => {
    delete process.env.ADMIN_OVERRIDE_HMAC_SECRET;
    process.env.NODE_ENV = "production";
    const app = await buildOverrideApp();
    const timestamp = Math.floor(Date.now() / 1000);
    const { status, body } = await callOverrideEndpoint(
      app,
      { strategy_id: VALID_STRATEGY_ID, rationale: VALID_RATIONALE, timestamp },
    );
    expect(status).toBe(503);
    expect(body.error).toBe("admin_override_not_configured");
    process.env.NODE_ENV = "test";
  });

  it("returns 200 with ok:true, override_count++ and frozen_policy.override_used audit on valid request", async () => {
    process.env.ADMIN_OVERRIDE_HMAC_SECRET = TEST_SECRET;
    mocks.dbSelectResult.mockReturnValue([
      {
        id: VALID_STRATEGY_ID,
        name: "test_override_strat",
        config: makeConfig(),
        frozenPolicyHash: "oldhash".padEnd(64, "0"),
        frozenPolicyOverrideCount: 2,
      },
    ]);

    const app = await buildOverrideApp();
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = makeValidSignature(TEST_SECRET, timestamp, VALID_STRATEGY_ID, VALID_RATIONALE);
    const { status, body } = await callOverrideEndpoint(
      app,
      { strategy_id: VALID_STRATEGY_ID, rationale: VALID_RATIONALE, timestamp },
      { "x-override-signature": sig },
    );

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.override_count).toBe(3); // 2 + 1
    expect(body.new_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.strategy_id).toBe(VALID_STRATEGY_ID);

    // frozen_policy.override_used audit was written
    const insertCall = mocks.dbInsertValues.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).action === "frozen_policy.override_used",
    );
    expect(insertCall).toBeDefined();
    const auditResult = (insertCall![0] as Record<string, unknown>).result as Record<string, unknown>;
    expect(auditResult.rationale).toBe(VALID_RATIONALE);
    expect(auditResult.override_count).toBe(3);

    // DB update was called
    expect(mocks.dbUpdateCalled).toHaveBeenCalled();
  });
});

// ─── 5. Lifecycle PAPER → DEPLOY_READY frozen-policy gate integration stubs ──

describe("Lifecycle PAPER → DEPLOY_READY frozen-policy gate (contract stubs)", () => {
  it("hash mismatch → evaluateFrozenPolicyDriftAtPromotion ok:false + lifecycle.frozen_policy_drift_blocked fires", () => {
    const config = makeConfig();
    const frozenHash = computeFrozenPolicyHash({ config });
    const mutatedConfig = makeConfig({ entry_quality: { changed: true } });
    const strategy = {
      id: "strat-xyz",
      config: mutatedConfig,
      frozenPolicyHash: frozenHash,
    };
    const result = evaluateFrozenPolicyDriftAtPromotion(strategy);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("hash_mismatch");
    // lifecycle-service.ts gate: on ok:false AND frozenHash !== null → continue (skip this strategy)
    // and emit lifecycle.frozen_policy_drift_blocked audit
  });

  it("first-time freeze → ok:true, frozenHash null → lifecycle calls freezePolicyForStrategy", () => {
    const config = makeConfig();
    const strategy = { id: "strat-new", config, frozenPolicyHash: null };
    const result = evaluateFrozenPolicyDriftAtPromotion(strategy);
    expect(result.ok).toBe(true);
    expect(result.frozenHash).toBeNull();
    // lifecycle-service.ts gate: on ok:true AND frozenHash === null → fire-and-forget
    // freezePolicyForStrategy → then proceed to promoteStrategy
  });
});
