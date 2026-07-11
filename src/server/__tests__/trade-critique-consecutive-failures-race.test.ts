/**
 * trade-critique-consecutive-failures-race.test.ts — deep-scan fix wave, 2026-07-10
 *
 * CONFIRMED BUG (fixed in this wave, see trade-critique-service.ts):
 * `incrementConsecutiveFailures()` / `upsertSystemParameter()` used to do a
 * non-atomic SELECT-then-UPDATE/INSERT with no transaction or row lock.
 * `closePosition()` in paper-execution-service.ts dispatches
 * `runTradeCritique()` fire-and-forget per closed position, so even a
 * sequential position-close loop (e.g. several accounts' positions closing at
 * the shared 15:55 ET hard-flatten boundary) produces multiple OVERLAPPING,
 * unawaited critique promises racing on the `system_parameters` row for the
 * full duration of each LLM call (hundreds of ms to seconds) — not just one
 * event-loop tick. A lost-update race silently under-counts real consecutive
 * failures and can delay/suppress the STRIKE_THRESHOLD=3 Discord WARN alert.
 *
 * THE FIX: a single atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`
 * statement — see `incrementConsecutiveFailures()` in trade-critique-service.ts.
 * Postgres's default READ COMMITTED isolation does NOT close this race merely
 * by wrapping the old two-step shape in a transaction (two concurrent
 * transactions can both SELECT the pre-increment value before either
 * commits) — only a single atomic statement (or `SELECT ... FOR UPDATE`) does.
 *
 * WHY THIS TEST — AND NOT A SEQUENTIAL ONE — PROVES THE FIX:
 * firing N calls SEQUENTIALLY (each fully `await`ed before the next starts)
 * would pass even against the ORIGINAL buggy read-then-write code, because
 * there is never an overlapping read window when calls don't overlap. This
 * test fires all N concurrently (`Promise.all` over UNAWAITED calls) against
 * a real PGlite Postgres-compatible backing store, reproducing the actual
 * interleaving that caused the bug: all N calls issue their first DB
 * statement before any of them completes. Trace-through of the OLD code
 * against this exact test: all N `readConsecutiveFailures()` SELECTs would
 * be queued (and resolve) before any write happens, so all N observe the SAME
 * pre-increment value and compute the SAME `next` — the final counter would
 * land on `existing + 1`, not `existing + N`, and this test's
 * `sorted-results === [1..N]` assertion would fail (duplicates would appear
 * instead of a clean run). The FIXED code closes this because
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` is one indivisible
 * statement per caller — PGlite (a single-connection real Postgres engine)
 * executes each one fully before starting the next, so N atomic increments in
 * any order always yield `existing + N` with N distinct RETURNING values.
 *
 * VERIFIED (this wave, re-run on the live tip after porting the fix): this
 * test was run against a deliberately-reverted (buggy) copy of
 * incrementConsecutiveFailures() and failed as predicted (duplicate/short
 * results, final count < N), then re-run against the restored fix and
 * passed. See the landing commit message for the observed failure output.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/pglite-db.js";
import type { TestDb } from "./helpers/pglite-db.js";

// ─── DB injection (mirrors composite-shadow.integration.test.ts — the
// standard pattern for this layer): a live getter lets beforeEach() swap in a
// fresh PGlite instance per test without needing an async vi.mock factory. ──
let injectedDb: TestDb["db"] | null = null;

vi.mock("../db/index.js", () => ({
  get db() {
    return injectedDb;
  },
}));

// trade-critique-service.ts transitively imports these production services,
// but incrementConsecutiveFailures() never touches any of them — stubbed so
// module import doesn't drag in circuit-breaker/API-client side effects.
// Mirrors the mocking convention already established in
// wave26-trade-critique-service.test.ts.
vi.mock("../services/model-router.js", () => ({
  callOpenAI: vi.fn(),
  getFallback: vi.fn(),
  loadSystemPrompt: vi.fn(),
}));
vi.mock("../services/ollama-client.js", () => ({
  OllamaClient: vi.fn().mockImplementation(() => ({ generate: vi.fn() })),
}));
vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
}));

import { systemParameters } from "../db/schema.js";
import { incrementConsecutiveFailures } from "../services/trade-critique-service.js";

// ─── system_parameters DDL ──────────────────────────────────────────────────
// Not part of pglite-db.ts's shared CORE_DDL — added here, mirroring
// column-for-column the real definition in schema.ts (migration-tracked
// table). `DEFAULT gen_random_uuid()` mirrors the existing broker_accounts
// table in pglite-db.ts, which already proves this default works in this
// PGlite version without a separate CREATE EXTENSION statement.
const SYSTEM_PARAMETERS_DDL = `
CREATE TABLE IF NOT EXISTS system_parameters (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  param_name     TEXT NOT NULL UNIQUE,
  current_value  NUMERIC NOT NULL,
  min_value      NUMERIC,
  max_value      NUMERIC,
  description    TEXT,
  domain         TEXT NOT NULL,
  auto_tunable   BOOLEAN DEFAULT FALSE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const CONSECUTIVE_FAILURES_KEY = "trade_critique_consecutive_failures";

async function readCurrentValue(ctx: TestDb): Promise<number | null> {
  const [row] = await ctx.db
    .select({ currentValue: systemParameters.currentValue })
    .from(systemParameters)
    .where(eq(systemParameters.paramName, CONSECUTIVE_FAILURES_KEY));
  return row ? parseInt(row.currentValue, 10) : null;
}

describe("trade-critique-service — consecutive-failure counter race (deep-scan fix wave, 2026-07-10)", () => {
  let ctx: TestDb;

  beforeEach(async () => {
    ctx = await createTestDb();
    await ctx.pg.exec(SYSTEM_PARAMETERS_DDL);
    injectedDb = ctx.db;
  });

  afterEach(async () => {
    await ctx.close();
    injectedDb = null;
  });

  it("5 concurrent increments against a not-yet-existing row land on exactly 5 (INSERT branch of the upsert)", async () => {
    // Fire all 5 concurrently — no `await` between them — to reproduce the
    // actual overlapping-promise pattern from closePosition()'s fire-and-forget
    // dispatch, not a sequential call chain.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => incrementConsecutiveFailures()),
    );

    // A lost-update race would produce duplicate returned values (multiple
    // callers observing/writing the same pre-increment value) and a final
    // count < 5. Genuine atomicity produces exactly one caller per value.
    const sorted = [...results].sort((a, b) => a - b);
    expect(sorted).toEqual([1, 2, 3, 4, 5]);

    expect(await readCurrentValue(ctx)).toBe(5);
  });

  it("5 concurrent increments against a counter already at 10 land on exactly 15 (ON CONFLICT DO UPDATE branch)", async () => {
    // Seed the row directly (bypassing the function under test) so this case
    // exercises the update branch, not the insert branch.
    await ctx.db.insert(systemParameters).values({
      paramName: CONSECUTIVE_FAILURES_KEY,
      currentValue: "10",
      description: "seed",
      domain: "paper",
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => incrementConsecutiveFailures()),
    );

    const sorted = [...results].sort((a, b) => a - b);
    expect(sorted).toEqual([11, 12, 13, 14, 15]);

    expect(await readCurrentValue(ctx)).toBe(15);
  });

  it("10 concurrent increments land on exactly 10 (higher fan-out sanity check)", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => incrementConsecutiveFailures()),
    );

    const sorted = [...results].sort((a, b) => a - b);
    expect(sorted).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await readCurrentValue(ctx)).toBe(10);
  });

  // Documents the point made in the file header: a sequential-only test would
  // pass on BOTH the old buggy code and the new fixed code, so it proves
  // nothing about the race being closed. Kept here only as a contrast/sanity
  // check that the counting logic itself is correct independent of overlap.
  it("(contrast, not a race proof) 5 sequential increments also reach 5", async () => {
    for (let i = 0; i < 5; i++) {
      await incrementConsecutiveFailures();
    }
    expect(await readCurrentValue(ctx)).toBe(5);
  });
});
