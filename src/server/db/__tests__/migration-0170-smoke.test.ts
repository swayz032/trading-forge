/**
 * migration-0170-smoke.test.ts — Pass 1 Track C pglite smoke test
 *
 * Applies the 0170_live_order_pine_dedup DDL to an in-memory PGlite instance
 * and verifies:
 *
 *   1. The table can be created (idempotent — CREATE TABLE IF NOT EXISTS).
 *   2. A valid row can be INSERTed and SELECT-ed back.
 *   3. ON CONFLICT DO NOTHING prevents duplicate rows on the same
 *      (account_id, strategy_id, bar_timestamp, action) key.
 *   4. RETURNING id returns non-null on first-insert and empty on conflict.
 *   5. correlation_id is nullable (can be NULL).
 *
 * Uses PGlite directly (no Drizzle) so we verify the raw SQL the migration
 * runner will apply, not just the Drizzle abstraction.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

// ── Inline DDL (matches 0170_live_order_pine_dedup.sql exactly) ──────────────

const MIGRATION_DDL = `
CREATE TABLE IF NOT EXISTS live_order_pine_dedup (
  id             BIGSERIAL PRIMARY KEY,
  account_id     UUID NOT NULL,
  strategy_id    UUID NOT NULL,
  bar_timestamp  TIMESTAMPTZ NOT NULL,
  action         TEXT NOT NULL,
  correlation_id UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_live_order_pine_dedup_key
  ON live_order_pine_dedup (account_id, strategy_id, bar_timestamp, action);

CREATE INDEX IF NOT EXISTS idx_live_order_pine_dedup_account
  ON live_order_pine_dedup (account_id, created_at DESC);
`;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
const STRATEGY_ID = "22222222-2222-2222-2222-222222222222";
const BAR_TS = "2026-06-22T14:30:00+00:00";
const ACTION = "long";
const CORRELATION_ID = "33333333-3333-3333-3333-333333333333";

// ─────────────────────────────────────────────────────────────────────────────

describe("migration-0170 smoke: live_order_pine_dedup", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    // Apply the migration DDL — this is what the boot-migration-runner will do.
    await pg.exec(MIGRATION_DDL);
  });

  afterAll(async () => {
    await pg.close();
  });

  it("creates the table (DDL applies without error)", async () => {
    const result = await pg.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name   = 'live_order_pine_dedup'`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].table_name).toBe("live_order_pine_dedup");
  });

  it("creates the unique index", async () => {
    const result = await pg.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE tablename = 'live_order_pine_dedup'
         AND indexname = 'idx_live_order_pine_dedup_key'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  it("creates the account lookup index", async () => {
    const result = await pg.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE tablename = 'live_order_pine_dedup'
         AND indexname = 'idx_live_order_pine_dedup_account'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  it("inserts a row and returns the generated id", async () => {
    const result = await pg.query<{ id: number }>(
      `INSERT INTO live_order_pine_dedup
         (account_id, strategy_id, bar_timestamp, action, correlation_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [ACCOUNT_ID, STRATEGY_ID, BAR_TS, ACTION, CORRELATION_ID],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBeGreaterThan(0);
  });

  it("returns empty RETURNING on duplicate (ON CONFLICT DO NOTHING)", async () => {
    // Second insert of the exact same dedup key — should be a no-op.
    const result = await pg.query<{ id: number }>(
      `INSERT INTO live_order_pine_dedup
         (account_id, strategy_id, bar_timestamp, action, correlation_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [ACCOUNT_ID, STRATEGY_ID, BAR_TS, ACTION, CORRELATION_ID],
    );
    // Empty rows → conflict was detected → caller treats this as a duplicate.
    expect(result.rows).toHaveLength(0);
  });

  it("confirms only one row exists after duplicate attempt", async () => {
    const result = await pg.query<{ cnt: number | string }>(
      `SELECT count(*) AS cnt FROM live_order_pine_dedup
       WHERE account_id  = $1
         AND strategy_id = $2
         AND bar_timestamp = $3
         AND action       = $4`,
      [ACCOUNT_ID, STRATEGY_ID, BAR_TS, ACTION],
    );
    // PGlite may return count as a number; PostgreSQL returns a string.
    // Compare via Number() to be driver-agnostic.
    expect(Number(result.rows[0].cnt)).toBe(1);
  });

  it("allows a different action on the same bar (distinct dedup key)", async () => {
    const result = await pg.query<{ id: number }>(
      `INSERT INTO live_order_pine_dedup
         (account_id, strategy_id, bar_timestamp, action, correlation_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [ACCOUNT_ID, STRATEGY_ID, BAR_TS, "short", CORRELATION_ID],
    );
    // Different action → different unique key → should INSERT successfully.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBeGreaterThan(0);
  });

  it("allows correlation_id to be NULL", async () => {
    const differentTs = "2026-06-22T15:00:00+00:00";
    const result = await pg.query<{ id: number; correlation_id: string | null }>(
      `INSERT INTO live_order_pine_dedup
         (account_id, strategy_id, bar_timestamp, action)
       VALUES ($1, $2, $3, $4)
       RETURNING id, correlation_id`,
      [ACCOUNT_ID, STRATEGY_ID, differentTs, ACTION],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].correlation_id).toBeNull();
  });

  it("DDL is idempotent — running it twice does not error", async () => {
    // The IF NOT EXISTS clauses make the DDL safe to re-run.
    await expect(pg.exec(MIGRATION_DDL)).resolves.not.toThrow();
  });

  it("selects back the inserted row with all expected columns", async () => {
    const result = await pg.query<{
      id: number;
      account_id: string;
      strategy_id: string;
      bar_timestamp: string;
      action: string;
      correlation_id: string;
      created_at: string;
    }>(
      `SELECT id, account_id, strategy_id, bar_timestamp, action,
              correlation_id, created_at
       FROM live_order_pine_dedup
       WHERE account_id  = $1
         AND strategy_id = $2
         AND bar_timestamp = $3
         AND action       = $4
       LIMIT 1`,
      [ACCOUNT_ID, STRATEGY_ID, BAR_TS, ACTION],
    );
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.account_id).toBe(ACCOUNT_ID);
    expect(row.strategy_id).toBe(STRATEGY_ID);
    expect(row.action).toBe(ACTION);
    expect(row.correlation_id).toBe(CORRELATION_ID);
    expect(row.created_at).toBeTruthy();
  });
});
