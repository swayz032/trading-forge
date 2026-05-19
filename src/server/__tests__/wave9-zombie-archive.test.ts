/**
 * Wave 9 — Zombie strategy archive backfill test
 *
 * Verifies the migration 0109 backfill semantics in isolation:
 *   - Strategies with archived_* tags get archived_at + archive_reason set.
 *   - Clean strategies are untouched.
 *
 * Runs against the live Drizzle test DB (the same one used by other __tests__
 * suites). Skips itself if DATABASE_URL is not set or migration 0109 has not
 * been applied (column `archived_at` missing).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";

const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB_URL ? describe : describe.skip;

describeIfDb("Wave 9 — zombie strategy archive backfill", () => {
  let db: any;
  let migrationApplied = false;
  const insertedIds: string[] = [];

  beforeAll(async () => {
    const mod = await import("../db/index.js");
    db = mod.db;
    // Probe whether migration 0109 has been applied — column existence check.
    try {
      const rows = await db.execute(sql`
        SELECT 1
          FROM information_schema.columns
         WHERE table_name = 'strategies'
           AND column_name = 'archived_at'
         LIMIT 1
      `);
      const r = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
      migrationApplied = r.length > 0;
    } catch {
      migrationApplied = false;
    }
  });

  afterAll(async () => {
    if (!migrationApplied || insertedIds.length === 0) return;
    try {
      for (const id of insertedIds) {
        await db.execute(sql`DELETE FROM strategies WHERE id = ${id}::uuid`);
      }
    } catch {
      // Best-effort cleanup
    }
  });

  it("backfills archived_at + archive_reason from archive tags; leaves clean rows untouched", async () => {
    if (!migrationApplied) {
      // Migration 0109 not yet applied on this DB — skip gracefully.
      return;
    }

    // Insert 3 test strategies with distinct tag patterns
    const baseCfg = { entry_indicator: "test_wave9", entry_params: {} };
    const ts = Date.now();
    const inserts = [
      { name: `__test_wave9_dup_${ts}`,    tags: ["archived_duplicate"],          expect_reason: "archived_duplicate" },
      { name: `__test_wave9_thin_${ts}`,   tags: ["archived_thin_placeholder"],   expect_reason: "archived_thin_placeholder" },
      { name: `__test_wave9_clean_${ts}`,  tags: ["live"],                        expect_reason: null },
    ];

    for (const row of inserts) {
      const result = await db.execute(sql`
        INSERT INTO strategies (name, symbol, timeframe, config, lifecycle_state, source, tags)
        VALUES (${row.name}, 'MES', '5m', ${JSON.stringify(baseCfg)}::jsonb, 'CANDIDATE',
                'graduated_bucket', ${row.tags}::text[])
        RETURNING id::text
      `);
      const rs = Array.isArray(result) ? result : (result as any).rows ?? [];
      insertedIds.push(rs[0].id);
    }

    // Re-run the same backfill statement the migration uses. Idempotent: it only
    // touches rows whose archived_at is still NULL.
    await db.execute(sql`
      UPDATE strategies s
         SET archived_at    = COALESCE(s.archived_at, NOW()),
             archive_reason = COALESCE(
               s.archive_reason,
               (
                 SELECT tag
                   FROM unnest(COALESCE(s.tags, ARRAY[]::text[])) AS tag
                  WHERE tag IN (
                    'archived_duplicate',
                    'archived_thin_placeholder',
                    'archived_unsupported_concept',
                    'archived_post_gate_audit',
                    'archived_deep_audit_2026_05_17',
                    'archived_rule_identity'
                  )
                  LIMIT 1
               )
             )
       WHERE COALESCE(s.tags, ARRAY[]::text[]) && ARRAY[
               'archived_duplicate',
               'archived_thin_placeholder',
               'archived_unsupported_concept',
               'archived_post_gate_audit',
               'archived_deep_audit_2026_05_17',
               'archived_rule_identity'
             ]::text[]
         AND s.archived_at IS NULL
    `);

    // Verify
    for (const row of inserts) {
      const r = await db.execute(sql`
        SELECT archived_at, archive_reason
          FROM strategies
         WHERE name = ${row.name}
         LIMIT 1
      `);
      const got = Array.isArray(r) ? r[0] : (r as any).rows[0];
      if (row.expect_reason === null) {
        expect(got.archived_at).toBeNull();
        expect(got.archive_reason).toBeNull();
      } else {
        expect(got.archived_at).not.toBeNull();
        expect(got.archive_reason).toBe(row.expect_reason);
      }
    }
  });
});
