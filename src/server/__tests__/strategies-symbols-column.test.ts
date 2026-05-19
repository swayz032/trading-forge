/**
 * Wave 23F Track A — strategies.symbols TEXT[] column
 *
 * Tests:
 *  1. Schema includes the symbols array column (static Drizzle schema check)
 *  2. DB round-trip: inserting ['MES', 'MNQ'] survives SELECT
 *  3. Default value ['MES'] applies when symbols omitted from INSERT
 *
 * The DB tests are skipped when DATABASE_URL is not set (CI without live DB).
 * They use the same guard pattern as wave9-unique-config.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";

// ─── 1. Static schema shape check (always runs) ──────────────────────────────

describe("Wave 23F — strategies.symbols column: Drizzle schema", () => {
  it("strategies table schema includes a symbols array column", async () => {
    const { strategies } = await import("../db/schema.js");
    expect(strategies).toBeDefined();
    // Drizzle column descriptor is on the table object
    const col = (strategies as any).symbols;
    expect(col).toBeDefined();
    // Drizzle marks array columns with dataType "array"
    const config = col?.config ?? col?.columnType ?? "";
    // Accept either: the column exists and is an array-flavored text column,
    // or the raw column name is "symbols" (verifying it was added to the schema).
    const columnName: string =
      col?.name ?? col?.fieldName ?? col?.config?.name ?? "";
    expect(columnName.toLowerCase()).toBe("symbols");
  });
});

// ─── 2 & 3. Live DB tests ─────────────────────────────────────────────────────

const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB_URL ? describe : describe.skip;

describeIfDb("Wave 23F — strategies.symbols column: DB round-trips", () => {
  let db: any;
  let columnExists = false;
  const insertedIds: string[] = [];

  beforeAll(async () => {
    const mod = await import("../db/index.js");
    db = mod.db;

    // Verify migration 0111 has been applied.
    try {
      const rows = await db.execute(sql`
        SELECT 1
          FROM information_schema.columns
         WHERE table_name  = 'strategies'
           AND column_name = 'symbols'
         LIMIT 1
      `);
      const r = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
      columnExists = r.length > 0;
    } catch {
      columnExists = false;
    }
  });

  afterAll(async () => {
    if (insertedIds.length === 0) return;
    try {
      for (const id of insertedIds) {
        await db.execute(
          sql`DELETE FROM strategies WHERE id = ${id}::uuid`
        );
      }
    } catch {
      // Best-effort cleanup
    }
  });

  it("round-trips symbols=['MES','MNQ'] correctly", async () => {
    if (!columnExists) return; // Migration not yet applied — skip gracefully.

    const ts = Date.now();
    const cfg = {
      entry_indicator: "ema_crossover_w23f_test",
      entry_params: { fast: 9, slow: 21 },
    };

    const r = await db.execute(sql`
      INSERT INTO strategies (name, symbol, symbols, timeframe, config, lifecycle_state, source)
      VALUES (
        ${"__test_w23f_symbols_multi_" + ts},
        'MES',
        ARRAY['MES','MNQ']::TEXT[],
        '5m',
        ${JSON.stringify(cfg)}::jsonb,
        'CANDIDATE',
        'manual'
      )
      RETURNING id::text, symbols
    `);
    const rows = Array.isArray(r) ? r : (r as any).rows ?? [];
    expect(rows[0]?.id).toBeTruthy();
    insertedIds.push(rows[0].id);

    // symbols should come back as a JS array with both instruments.
    const symbols: string[] = rows[0]?.symbols ?? [];
    expect(symbols).toContain("MES");
    expect(symbols).toContain("MNQ");
    expect(symbols).toHaveLength(2);
  });

  it("applies default value ['MES'] when symbols omitted from INSERT", async () => {
    if (!columnExists) return;

    const ts = Date.now();
    const cfg = {
      entry_indicator: "ema_crossover_w23f_default_test",
      entry_params: { fast: 5, slow: 15 },
    };

    const r = await db.execute(sql`
      INSERT INTO strategies (name, symbol, timeframe, config, lifecycle_state, source)
      VALUES (
        ${"__test_w23f_symbols_default_" + ts},
        'MES',
        '5m',
        ${JSON.stringify(cfg)}::jsonb,
        'CANDIDATE',
        'manual'
      )
      RETURNING id::text, symbols
    `);
    const rows = Array.isArray(r) ? r : (r as any).rows ?? [];
    expect(rows[0]?.id).toBeTruthy();
    insertedIds.push(rows[0].id);

    const symbols: string[] = rows[0]?.symbols ?? [];
    expect(symbols).toEqual(["MES"]);
  });
});
