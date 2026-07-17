/**
 * Fix-wave telemetry-honesty-registry-dashboards (2026-07-17) — HIGH finding:
 * assembleKitchenData()'s "Ingredients" stage SELECT referenced `scout_audit`,
 * a table that does not exist anywhere in schema.ts or any migration
 * (verified by repo-wide grep). The query threw on every call and was
 * silently swallowed by `.catch(() => [])`, so the "Ingredients" stage always
 * rendered 0 regardless of real scout-pipeline activity. The real table
 * tracking freshly-scouted, not-yet-graduated ideas is
 * `strategy_pending_buckets` (status='pending' before graduation).
 *
 * The existing mock-based kitchen-data.test.ts could not catch this: its
 * `vi.mock` of `db.execute` returns canned fixture data unconditionally,
 * regardless of what SQL text (or table name) was actually sent. This suite
 * runs assembleKitchenData() against a REAL Postgres-compatible schema
 * (PGlite, mirroring schema.ts) with a real seeded strategy_pending_buckets
 * row, so a nonexistent-table query fails the same way it would in
 * production.
 *
 * RED-PROOF: reverting kitchen-data.ts's Ingredients query to
 * `FROM scout_audit` against this same PGlite fixture makes the assertion
 * below fail (0 instead of the seeded pending-bucket count) — verified
 * manually this fix-wave session before restoring the fix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, type TestDb } from "../helpers/pglite-db.js";

let ctx: TestDb;

// Same production-driver-shape adapter as recipe-data-pglite.test.ts — see
// that file's comment for why .rows must be unwrapped here.
vi.mock("../../db/index.js", () => ({
  db: {
    execute: async (query: unknown) => {
      const result = await (ctx.db.execute as (q: unknown) => Promise<{ rows: unknown[] }>)(query);
      return result.rows;
    },
  },
}));

describe("kitchen-data (pglite real-schema regression — HIGH scout_audit fix)", () => {
  // A fresh PGlite instance per test — assembleKitchenData() has no filter
  // scoping it to a single test's rows (it counts ALL pending buckets), so a
  // shared instance across tests would leak seeded rows between assertions.
  beforeEach(async () => {
    ctx = await createTestDb();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("counts real strategy_pending_buckets pending rows for the Ingredients stage", async () => {
    // 2 pending buckets seen in the last 7 days (should count), 1 pending
    // bucket seen 30 days ago (outside window, should NOT count), 1 already
    // graduated bucket (should NOT count regardless of recency).
    const fresh1 = randomUUID();
    const fresh2 = randomUUID();
    const stale = randomUUID();
    const graduated = randomUUID();

    await ctx.pg.query(
      `INSERT INTO strategy_pending_buckets
         (id, fingerprint_hash, market, entry_archetype, exit_type, status, first_seen_at, last_seen_at)
       VALUES
         ($1, 'fp1', 'MES', 'orb', 'style_c', 'pending', NOW() - INTERVAL '1 day', NOW()),
         ($2, 'fp2', 'MNQ', 'vwap', 'style_c', 'pending', NOW() - INTERVAL '3 days', NOW()),
         ($3, 'fp3', 'MCL', 'orb', 'style_c', 'pending', NOW() - INTERVAL '30 days', NOW() - INTERVAL '29 days'),
         ($4, 'fp4', 'MES', 'orb', 'style_c', 'graduated', NOW() - INTERVAL '1 day', NOW())`,
      [fresh1, fresh2, stale, graduated],
    );

    const { assembleKitchenData } = await import("../../lib/slumhouse/kitchen-data.js");
    const data = await assembleKitchenData();

    expect(data.stages.find((s) => s.name === "Ingredients")?.count).toBe(2);
  });

  it("Ingredients stage is 0 (not a crash) when strategy_pending_buckets is empty", async () => {
    const { assembleKitchenData } = await import("../../lib/slumhouse/kitchen-data.js");
    const data = await assembleKitchenData();
    expect(data.stages.find((s) => s.name === "Ingredients")?.count).toBe(0);
    expect(data.stages).toHaveLength(6);
  });
});
