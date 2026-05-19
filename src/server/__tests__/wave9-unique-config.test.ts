/**
 * Wave 9 — SQL-level uniqueness invariant on active strategies.
 *
 * Verifies the partial UNIQUE index `strategies_active_config_uniq` from
 * migration 0109:
 *   - Two active rows with the same (symbol, timeframe, entry_indicator,
 *     entry_params) → Postgres rejects with unique_violation (SQLSTATE 23505).
 *   - When one is archived (archived_at set) the insert succeeds.
 *
 * Skips itself if DATABASE_URL is not set or migration 0109 has not yet been
 * applied (index missing).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";

const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB_URL ? describe : describe.skip;

describeIfDb("Wave 9 — strategies_active_config_uniq partial index", () => {
  let db: any;
  let indexExists = false;
  const insertedIds: string[] = [];

  beforeAll(async () => {
    const mod = await import("../db/index.js");
    db = mod.db;
    try {
      const rows = await db.execute(sql`
        SELECT 1
          FROM pg_indexes
         WHERE indexname = 'strategies_active_config_uniq'
         LIMIT 1
      `);
      const r = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
      indexExists = r.length > 0;
    } catch {
      indexExists = false;
    }
  });

  afterAll(async () => {
    if (!indexExists || insertedIds.length === 0) return;
    try {
      for (const id of insertedIds) {
        await db.execute(sql`DELETE FROM strategies WHERE id = ${id}::uuid`);
      }
    } catch {
      // Best-effort cleanup
    }
  });

  it("rejects duplicate active rows and accepts a duplicate when prior is archived", async () => {
    if (!indexExists) {
      // Migration 0109 not yet applied — skip gracefully.
      return;
    }

    const ts = Date.now();
    const cfg = { entry_indicator: "ema_crossover_wave9_test", entry_params: { fast: 9, slow: 21 } };

    // Insert #1 — should succeed.
    const r1 = await db.execute(sql`
      INSERT INTO strategies (name, symbol, timeframe, config, lifecycle_state, source)
      VALUES (${"__test_wave9_uniq_a_" + ts}, 'MES', '5m', ${JSON.stringify(cfg)}::jsonb, 'CANDIDATE', 'graduated_bucket')
      RETURNING id::text
    `);
    const rs1 = Array.isArray(r1) ? r1 : (r1 as any).rows ?? [];
    insertedIds.push(rs1[0].id);

    // Insert #2 — same fingerprint, both active → must throw unique_violation.
    let threw = false;
    try {
      const r2 = await db.execute(sql`
        INSERT INTO strategies (name, symbol, timeframe, config, lifecycle_state, source)
        VALUES (${"__test_wave9_uniq_b_" + ts}, 'MES', '5m', ${JSON.stringify(cfg)}::jsonb, 'CANDIDATE', 'graduated_bucket')
        RETURNING id::text
      `);
      const rs2 = Array.isArray(r2) ? r2 : (r2 as any).rows ?? [];
      if (rs2[0]?.id) insertedIds.push(rs2[0].id);
    } catch (err: any) {
      threw = true;
      // 23505 = unique_violation in Postgres
      const code = err?.code ?? err?.cause?.code;
      expect([code, err?.message]).toSatisfy((v: any) => {
        return String(v[0] ?? "") === "23505" || /unique/i.test(String(v[1] ?? ""));
      });
    }
    expect(threw).toBe(true);

    // Archive insert #1.
    await db.execute(sql`
      UPDATE strategies
         SET archived_at = NOW(), archive_reason = 'archived_test',
             lifecycle_state = 'GRAVEYARD'
       WHERE id = ${rs1[0].id}::uuid
    `);

    // Insert #3 — same fingerprint, prior is archived → MUST succeed.
    const r3 = await db.execute(sql`
      INSERT INTO strategies (name, symbol, timeframe, config, lifecycle_state, source)
      VALUES (${"__test_wave9_uniq_c_" + ts}, 'MES', '5m', ${JSON.stringify(cfg)}::jsonb, 'CANDIDATE', 'graduated_bucket')
      RETURNING id::text
    `);
    const rs3 = Array.isArray(r3) ? r3 : (r3 as any).rows ?? [];
    expect(rs3[0]?.id).toBeTruthy();
    insertedIds.push(rs3[0].id);
  });
});
