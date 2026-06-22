/**
 * W23H.7 — Fresh-start wipe script tests.
 *
 * Tests:
 *  1. Refuses when a PILOT strategy exists
 *  2. Refuses when a DEPLOYED strategy exists
 *  3. Refuses when an active family assignment exists
 *  4. Production URL detection — known patterns + known non-patterns
 *  5. Dry-run: accurate counts returned; no rows deleted (verify via mock call log)
 *  6. --apply: cascade deletes in correct FK-safe order; audit INSERT emitted last
 *  7. --apply: audit_log row count UNCHANGED (tombstone = audit INSERT only, no UPDATE/DELETE)
 *  8. Idempotency: running --apply with empty bucket → wiped_count: 0 audit emitted
 *
 * All tests use mock sql functions — no live DB connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  run,
  countDependentRows,
  detectProductionUrl,
  PROD_URL_PATTERN,
  type ProtectedStrategy,
  type ActiveFamilyAssignment,
  type WipeCounts,
    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
} from "../../../scripts/wipe-strategy-bucket-fresh-start.js";

// ─── Mock sql factory ─────────────────────────────────────────────────────────
//
// The postgres tagged-template returns an array from each call. We build a
// lightweight mock that stores all calls so tests can inspect them.

interface SqlCall {
  query: string; // first arg of tagged template (joined)
}

interface MockState {
  protectedStrategies: ProtectedStrategy[];
  activeFamilyAssignments: ActiveFamilyAssignment[];
  eligibleStrategies: Array<{ id: string; name: string; lifecycle_state: string }>;
  counts: {
    pendingMentions: number;
    pendingBuckets: number;
    exportArtifacts: number;
    accountAssignments: number;
    lifecycleTransitions: number;
    backtests: number;
    walkForwardWindows: number;
    biasState: number;
    auditLog: number;
  };
}

    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
function makeSql(state: MockState) {
  const calls: string[] = [];
  let beginCallback: ((tx: ReturnType<typeof makeSql>) => Promise<void>) | null = null;

  // Query routing: match on the raw string fragments joined from the tagged template
    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
  const sqlFn = vi.fn(async (...args: unknown[]) => {
    // Tagged template: first arg is TemplateStringsArray, rest are interpolated values
    const fragments = args[0] as TemplateStringsArray;
    const query = Array.from(fragments).join(" ??PARAM?? ").replace(/\s+/g, " ").trim();
    calls.push(query);

    // Route by query content
    if (query.includes("lifecycle_state IN") && query.includes("PILOT") && query.includes("DEPLOYED") && query.includes("SELECT")) {
      return state.protectedStrategies;
    }
    if (query.includes("released_to_family") && query.includes("active") && query.includes("SELECT")) {
      return state.activeFamilyAssignments;
    }
    if (query.includes("lifecycle_state NOT IN") && query.includes("SELECT")) {
      return state.eligibleStrategies;
    }
    if (query.includes("strategy_pending_mentions") && query.includes("COUNT")) {
      return [{ n: state.counts.pendingMentions }];
    }
    if (query.includes("strategy_pending_buckets") && query.includes("COUNT")) {
      return [{ n: state.counts.pendingBuckets }];
    }
    if (query.includes("strategy_export_artifacts") && query.includes("COUNT")) {
      return [{ n: state.counts.exportArtifacts }];
    }
    if (query.includes("account_strategy_assignments") && query.includes("COUNT")) {
      return [{ n: state.counts.accountAssignments }];
    }
    if (query.includes("lifecycle_transitions") && query.includes("COUNT")) {
      return [{ n: state.counts.lifecycleTransitions }];
    }
    if (query.includes("backtests") && query.includes("COUNT")) {
      return [{ n: state.counts.backtests }];
    }
    if (query.includes("walk_forward_windows") && query.includes("COUNT")) {
      return [{ n: state.counts.walkForwardWindows }];
    }
    if (query.includes("bias_state") && query.includes("COUNT")) {
      return [{ n: state.counts.biasState }];
    }
    if (query.includes("audit_log") && query.includes("COUNT")) {
      return [{ n: state.counts.auditLog }];
    }
    // DELETE / TRUNCATE / INSERT → no return needed (return empty array)
    return [];
  }) as unknown as ReturnType<typeof makeSql>;

  // begin() simulates a transaction: invokes callback with the same sql mock
  (sqlFn as unknown as { begin: (cb: (tx: unknown) => Promise<void>) => Promise<void> }).begin = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(sqlFn);
  });

  // json() — postgres helper used for JSONB params
  (sqlFn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;

  (sqlFn as unknown as { _calls: string[] })._calls = calls;

    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
  return sqlFn as unknown as postgres.Sql & { _calls: string[] };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBaseState(overrides: Partial<MockState> = {}): MockState {
  return {
    protectedStrategies: [],
    activeFamilyAssignments: [],
    eligibleStrategies: [
      { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "strat_a", lifecycle_state: "CANDIDATE" },
      { id: "aaaaaaaa-0000-0000-0000-000000000002", name: "strat_b", lifecycle_state: "TESTING" },
    ],
    counts: {
      pendingMentions: 5,
      pendingBuckets: 3,
      exportArtifacts: 2,
      accountAssignments: 0,
      lifecycleTransitions: 4,
      backtests: 8,
      walkForwardWindows: 12,
      biasState: 1,
      auditLog: 20,
    },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("W23H.7 — wipe script safety guards", () => {
  it("refuses when a PILOT strategy exists", async () => {
    const state = makeBaseState({
      protectedStrategies: [
        { id: "pilot-id-001", name: "live_strategy", lifecycle_state: "PILOT" },
      ],
    });
    const sql = makeSql(state);

    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
    await expect(run(sql as unknown as postgres.Sql, false)).rejects.toThrow();
  });

  it("refuses when a DEPLOYED strategy exists", async () => {
    const state = makeBaseState({
      protectedStrategies: [
        { id: "deployed-id-001", name: "deployed_strategy", lifecycle_state: "DEPLOYED" },
      ],
    });
    const sql = makeSql(state);

    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
    await expect(run(sql as unknown as postgres.Sql, false)).rejects.toThrow();
  });

  it("refuses when active family assignments exist", async () => {
    const state = makeBaseState({
      activeFamilyAssignments: [
        {
          id: 1,
          account_id: "acct-0000-0000-0000-000000000001",
          strategy_id: "strat-0000-0000-0000-000000000001",
        },
      ],
    });
    const sql = makeSql(state);

    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
    await expect(run(sql as unknown as postgres.Sql, false)).rejects.toThrow();
  });
});

describe("W23H.7 — production URL detection", () => {
  it("detects Railway production URLs", () => {
    expect(detectProductionUrl("postgres://user:pass@switchback.proxy.rlwy.net:5432/db")).toBe(true);
    expect(detectProductionUrl("postgresql://user:pass@some-service.railway.app/db")).toBe(true);
  });

  it("does NOT flag local or non-Railway URLs as production", () => {
    expect(detectProductionUrl("postgres://localhost:5432/trading_forge")).toBe(false);
    expect(detectProductionUrl("postgres://user:pass@127.0.0.1:5432/db")).toBe(false);
    expect(detectProductionUrl("postgres://user:pass@postgres.internal:5432/db")).toBe(false);
  });
});

describe("W23H.7 — dry-run mode", () => {
  it("returns accurate counts without deleting any rows", async () => {
    const state = makeBaseState();
    const sql = makeSql(state);

    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
    const counts = await run(sql as unknown as postgres.Sql, false /* dry-run */);

    expect(counts.strategies).toBe(2);
    expect(counts.pendingMentions).toBe(5);
    expect(counts.pendingBuckets).toBe(3);
    expect(counts.auditLogRows).toBe(20);

    // No DELETE / TRUNCATE / INSERT should appear in the call log
    const deleteCalls = sql._calls.filter(
    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
      (q) => q.includes("DELETE") || q.includes("TRUNCATE") || q.includes("INSERT"),
    );
    expect(deleteCalls).toHaveLength(0);
  });
});

describe("W23H.7 — apply mode", () => {
  it("cascades deletes in FK-safe order and emits completion audit last", async () => {
    const state = makeBaseState();
    const sql = makeSql(state);

    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
    await run(sql as unknown as postgres.Sql, true /* apply */);

    const writeCalls = sql._calls.filter(
    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
      (q) => q.includes("DELETE") || q.includes("TRUNCATE") || q.includes("INSERT"),
    );

    // Must have at least 9 deletes/truncates + 1 insert
    expect(writeCalls.length).toBeGreaterThanOrEqual(10);

    // INSERT into audit_log must be the LAST write call
    const lastWrite = writeCalls[writeCalls.length - 1];
    expect(lastWrite).toMatch(/INSERT/i);
    expect(lastWrite).toMatch(/audit_log/i);
  });

  it("does NOT emit DELETE on audit_log (append-only trigger compliance)", async () => {
    const state = makeBaseState();
    const sql = makeSql(state);

    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
    await run(sql as unknown as postgres.Sql, true /* apply */);

    const auditDeleteCalls = sql._calls.filter(
    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
      (q) => (q.includes("DELETE") || q.includes("UPDATE")) && q.includes("audit_log"),
    );
    expect(auditDeleteCalls).toHaveLength(0);
  });

  it("strategy_pending_buckets is TRUNCATED (not strategy-scoped DELETE)", async () => {
    const state = makeBaseState();
    const sql = makeSql(state);

    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
    await run(sql as unknown as postgres.Sql, true);

    const truncateCalls = sql._calls.filter(
    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
      (q) => q.includes("TRUNCATE") && q.includes("strategy_pending_buckets"),
    );
    expect(truncateCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("W23H.7 — idempotency", () => {
  it("second run with empty bucket emits wiped_count: 0 audit and returns empty counts", async () => {
    const state = makeBaseState({
      eligibleStrategies: [], // nothing to wipe
    });
    const sql = makeSql(state);

    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
    const counts = await run(sql as unknown as postgres.Sql, true /* apply */);

    expect(counts.strategies).toBe(0);

    // A bulk_strategy_wipe.completed INSERT must still be emitted
    const auditInsertCalls = sql._calls.filter(
    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
      (q) => q.includes("INSERT") && q.includes("audit_log"),
    );
    expect(auditInsertCalls.length).toBeGreaterThanOrEqual(1);
  });
});
