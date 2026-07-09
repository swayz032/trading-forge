/**
 * deepscan17-wave2-stale-detector-cas.test.ts — Deep-scan #17 Fix Wave 2 (#2)
 *
 * strategy-stale-detector CAS guard: demoteToNeedsRevision blindly UPDATE'd by id (no
 * from-state predicate) and its idempotency/protected-state SELECT ran OUTSIDE the tx —
 * a concurrent promotion (or a second demotion) landing in that window would clobber the
 * write and record a stale fromState in the lifecycle_transitions ledger. Its exported
 * siblings setNeedsArchetype / setNeedsRevision had RETURNING + no-op handling but no
 * strict from-state CAS. Wave-2 unified all three to promoteStrategy's race-guard pattern:
 * UPDATE ... WHERE lifecycle_state = ${fromState} ... RETURNING id, and treat an empty
 * RETURNING as a lost race (no ledger + no audit row claimed).
 *
 * demoteToNeedsRevision is not exported; this file exercises the exported siblings, which
 * carry the identical CAS predicate + empty-RETURNING handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/** FIFO of tx.execute() results: [SELECT lifecycle_state, UPDATE ... RETURNING id]. */
const execQueue: unknown[] = [];
/** Raw SQL template chunks captured per sql`...` call (for CAS-predicate assertions). */
const sqlStrings: string[] = [];
/** Rows captured from tx.insert(table).values(row). */
const insertedRows: Array<{ table: string; row: Record<string, unknown> }> = [];

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ..._vals: unknown[]) => {
    const joined = Array.from(strings).join(" ? ");
    sqlStrings.push(joined);
    return { __sql: joined };
  },
}));

vi.mock("../db/schema.js", () => ({
  lifecycleTransitions: "__lifecycleTransitions__",
  auditLog: "__auditLog__",
}));

function tableName(t: unknown): string {
  if (t === "__lifecycleTransitions__") return "lifecycleTransitions";
  if (t === "__auditLog__") return "auditLog";
  return String(t);
}

const tx = {
  execute: vi.fn(async () => execQueue.shift() ?? []),
  insert: (t: unknown) => ({
    values: (row: Record<string, unknown>) => {
      insertedRows.push({ table: tableName(t), row });
      return Promise.resolve();
    },
  }),
};

vi.mock("../db/index.js", () => ({
  db: {
    transaction: async (cb: (txArg: unknown) => Promise<void>) => cb(tx),
    execute: vi.fn(async () => []),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRowSafe: vi.fn() }));
vi.mock("../services/pipeline-control-service.js", () => ({ getMode: vi.fn(async () => "ACTIVE") }));

import { setNeedsRevision, setNeedsArchetype } from "../services/strategy-stale-detector.js";

beforeEach(() => {
  vi.clearAllMocks();
  execQueue.length = 0;
  sqlStrings.length = 0;
  insertedRows.length = 0;
});

function updateSql(): string {
  return sqlStrings.find((s) => s.includes("UPDATE strategies") && s.includes("RETURNING")) ?? "";
}

describe("#2 CAS guard — setNeedsRevision", () => {
  it("carries the from-state CAS predicate in the UPDATE and claims the transition when a row changes", async () => {
    execQueue.push([{ lifecycle_state: "CANDIDATE" }]); // in-tx SELECT
    execQueue.push([{ id: "s1" }]);                     // UPDATE ... RETURNING (1 row → applied)

    await setNeedsRevision("s1", "strat-1", "source_url_unreachable", "corr-1");

    // CAS predicate present (lifecycle_state = fromState) alongside RETURNING.
    expect(updateSql()).toContain("lifecycle_state =");
    expect(updateSql()).toContain("RETURNING id");
    // Ledger + audit both claimed on a successful CAS.
    expect(insertedRows.map((r) => r.table)).toEqual(["lifecycleTransitions", "auditLog"]);
    expect(insertedRows[0].row.toState).toBe("NEEDS_REVISION");
  });

  it("claims NOTHING when the CAS loses the race (empty RETURNING)", async () => {
    execQueue.push([{ lifecycle_state: "CANDIDATE" }]); // in-tx SELECT
    execQueue.push([]);                                 // UPDATE ... RETURNING (0 rows → lost race)

    await setNeedsRevision("s1", "strat-1", "source_url_unreachable", "corr-1");

    // No ledger row, no audit row — the phantom-origin / clobber path is closed.
    expect(insertedRows).toHaveLength(0);
  });
});

describe("#2 CAS guard — setNeedsArchetype", () => {
  it("carries the from-state CAS predicate and claims the transition when a row changes", async () => {
    execQueue.push([{ lifecycle_state: "CANDIDATE" }]);
    execQueue.push([{ id: "s2" }]);

    await setNeedsArchetype("s2", "strat-2", "orb_missing", "corr-2");

    expect(updateSql()).toContain("lifecycle_state =");
    expect(updateSql()).toContain("RETURNING id");
    expect(insertedRows.map((r) => r.table)).toEqual(["lifecycleTransitions", "auditLog"]);
    expect(insertedRows[0].row.toState).toBe("NEEDS_ARCHETYPE");
  });

  it("claims NOTHING when the CAS loses the race (empty RETURNING)", async () => {
    execQueue.push([{ lifecycle_state: "CANDIDATE" }]);
    execQueue.push([]);

    await setNeedsArchetype("s2", "strat-2", "orb_missing", "corr-2");

    expect(insertedRows).toHaveLength(0);
  });
});
