/**
 * migration-0204-paper-pending-entries.test.ts — M2 determinism + durability (2026-07-17)
 *
 * Verifies migration 0204 (paper_pending_entries — durability backstop for
 * paper-signal-service.ts's in-memory pendingEntryQueue):
 *   1. Structural invariants on the migration file text.
 *   2. The ACTUAL migration SQL applies cleanly TWICE against a real PGlite
 *      instance (idempotency — the fail-CLOSED boot-migration runner re-runs
 *      migrations that weren't recorded as applied, so a non-idempotent
 *      migration can crash-loop the whole API).
 *   3. A fresh full-schema bootstrap (createTestDb(), which now includes this
 *      table in CORE_DDL) succeeds and the table has the expected columns.
 *   4. The (session_id, symbol, signal_bar_timestamp) UNIQUE constraint holds.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "./helpers/pglite-db.js";
import type { TestDb } from "./helpers/pglite-db.js";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "src/server/db/migrations/0204_paper_pending_entries.sql",
);

const migrationSql = existsSync(MIGRATION_PATH) ? readFileSync(MIGRATION_PATH, "utf8") : "";

describe("Migration 0204: paper_pending_entries", () => {
  it("migration file exists", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("has no BOM (UTF-8, no leading EF BB BF)", () => {
    const buf = readFileSync(MIGRATION_PATH);
    expect(buf[0]).not.toBe(0xef);
  });

  it("declares CREATE TABLE IF NOT EXISTS (idempotent)", () => {
    expect(migrationSql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+paper_pending_entries/i);
  });

  it("declares all required columns matching the PendingEntry TS interface", () => {
    expect(migrationSql).toMatch(/\bsession_id\s+UUID\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/\bsymbol\s+TEXT\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/\bside\s+TEXT\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/\bcontracts\s+INTEGER\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/\border_type\s+TEXT\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/\bstop_limit_offset\s+NUMERIC/i);
    expect(migrationSql).toMatch(/\brsi\s+NUMERIC/i);
    expect(migrationSql).toMatch(/\batr\s+NUMERIC/i);
    expect(migrationSql).toMatch(/\bbar_volume\s+NUMERIC/i);
    expect(migrationSql).toMatch(/\bmedian_bar_volume\s+NUMERIC/i);
    expect(migrationSql).toMatch(/\bsignal_bar_timestamp\s+TEXT\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/\bcorrelation_id\s+TEXT/i);
    expect(migrationSql).toMatch(/\bstop_multiplier\s+NUMERIC\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/\bentry_context\s+JSONB/i);
    expect(migrationSql).toMatch(/\bnews_reduced_at_signal_time\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE/i);
    expect(migrationSql).toMatch(/\bcreated_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+NOW\(\)/i);
  });

  it("declares the (session_id, symbol, signal_bar_timestamp) UNIQUE index", () => {
    expect(migrationSql).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+paper_pending_entries_key_idx/i);
    expect(migrationSql).toMatch(/ON\s+paper_pending_entries\s*\(\s*session_id\s*,\s*symbol\s*,\s*signal_bar_timestamp\s*\)/i);
  });

  it("references paper_sessions with ON DELETE CASCADE", () => {
    expect(migrationSql).toMatch(/REFERENCES\s+paper_sessions\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
  });

  it("contains no INSERT/UPDATE statements (fail-CLOSED boot runner discipline)", () => {
    expect(migrationSql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(migrationSql).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
  });
});

describe("Migration 0204 — real PGlite idempotency (applies twice clean)", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    // Minimal paper_sessions stub — just enough for the FK the migration declares.
    await pg.exec(`CREATE TABLE paper_sessions (id UUID PRIMARY KEY DEFAULT gen_random_uuid());`);
  });

  afterAll(async () => {
    await pg.close();
  });

  it("applies the real migration file once with no error", async () => {
    await expect(pg.exec(migrationSql)).resolves.not.toThrow();
  });

  it("applies the SAME migration file a SECOND time with no error (idempotency)", async () => {
    await expect(pg.exec(migrationSql)).resolves.not.toThrow();
  });

  it("applies a THIRD time for good measure — genuinely idempotent, not lucky-twice", async () => {
    await expect(pg.exec(migrationSql)).resolves.not.toThrow();
  });

  it("the table exists with the expected columns after repeated application", async () => {
    const res = await pg.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'paper_pending_entries' ORDER BY column_name;`,
    );
    const cols = res.rows.map((r) => r.column_name).sort();
    expect(cols).toEqual(
      [
        "atr",
        "bar_volume",
        "contracts",
        "correlation_id",
        "created_at",
        "entry_context",
        "id",
        "median_bar_volume",
        "news_reduced_at_signal_time",
        "order_type",
        "rsi",
        "session_id",
        "side",
        "signal_bar_timestamp",
        "stop_limit_offset",
        "stop_multiplier",
        "symbol",
      ].sort(),
    );
  });

  it("enforces the (session_id, symbol, signal_bar_timestamp) UNIQUE constraint", async () => {
    const [{ id: sessionId }] = (
      await pg.query<{ id: string }>(`INSERT INTO paper_sessions DEFAULT VALUES RETURNING id;`)
    ).rows;

    await pg.exec(
      `INSERT INTO paper_pending_entries
         (session_id, symbol, side, contracts, order_type, signal_bar_timestamp, stop_multiplier)
       VALUES ('${sessionId}', 'MES', 'long', 9, 'stop_limit', '2026-07-17T10:00:00Z', 1.5);`,
    );

    await expect(
      pg.exec(
        `INSERT INTO paper_pending_entries
           (session_id, symbol, side, contracts, order_type, signal_bar_timestamp, stop_multiplier)
         VALUES ('${sessionId}', 'MES', 'long', 9, 'stop_limit', '2026-07-17T10:00:00Z', 1.5);`,
      ),
    ).rejects.toThrow();

    // A DIFFERENT signal_bar_timestamp for the same session+symbol is a distinct row (DB-level).
    await expect(
      pg.exec(
        `INSERT INTO paper_pending_entries
           (session_id, symbol, side, contracts, order_type, signal_bar_timestamp, stop_multiplier)
         VALUES ('${sessionId}', 'MES', 'long', 9, 'stop_limit', '2026-07-17T10:05:00Z', 1.5);`,
      ),
    ).resolves.not.toThrow();
  });

  it("ON DELETE CASCADE removes pending entries when the session is deleted", async () => {
    const [{ id: sessionId }] = (
      await pg.query<{ id: string }>(`INSERT INTO paper_sessions DEFAULT VALUES RETURNING id;`)
    ).rows;
    await pg.exec(
      `INSERT INTO paper_pending_entries
         (session_id, symbol, side, contracts, order_type, signal_bar_timestamp, stop_multiplier)
       VALUES ('${sessionId}', 'MNQ', 'short', 9, 'stop_limit', '2026-07-17T11:00:00Z', 1.5);`,
    );
    await pg.exec(`DELETE FROM paper_sessions WHERE id = '${sessionId}';`);
    const res = await pg.query(`SELECT * FROM paper_pending_entries WHERE session_id = '${sessionId}';`);
    expect(res.rows.length).toBe(0);
  });
});

describe("Migration 0204 — fresh full-schema bootstrap (CORE_DDL replay)", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("boots cleanly with paper_pending_entries present via the shared test-DB factory", async () => {
    const res = await ctx.pg.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'paper_pending_entries';`,
    );
    expect(res.rows.length).toBe(1);
  });

  it("running the same createTestDb() bootstrap flow twice in one process is safe (fresh instances don't collide)", async () => {
    const ctx2 = await createTestDb();
    try {
      const res = await ctx2.pg.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'paper_pending_entries';`,
      );
      expect(res.rows.length).toBe(1);
    } finally {
      await ctx2.close();
    }
  });
});
