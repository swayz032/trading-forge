/**
 * Tests for migration 0088: synthetic_regime_bank + synthetic_black_swan_runs
 * (W19 / A14 Synthetic Black Swan Engine — Pass 1 foundation).
 *
 * Two layers (mirrors quantum_run_costs / lifecycle_transitions test pattern):
 *   1. Migration-text invariants — verify the migration file declares both
 *      tables, all expected columns, FK CASCADE, and the required indexes.
 *      Runs everywhere; no DB needed.
 *   2. Live DB enforcement — when DATABASE_URL is set, query
 *      information_schema.tables / columns and pg_indexes to confirm
 *      the tables + columns + indexes actually exist after migration.
 *      Skipped when DATABASE_URL is not set (e.g. in unit-test CI).
 *
 * Why these tables exist (Pass 1 of A14):
 *   `synthetic_regime_bank`   — holds the bank of TimeGrad-generated regimes
 *                                (only stylized-fact-passing rows are drawn).
 *   `synthetic_black_swan_runs` — per-strategy survival evaluation row,
 *                                 written via pending-row contract.
 *   Phase 0 advisory; Phase 1 hard gate at PAPER → DEPLOY_READY.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "src/server/db/migrations/0088_synthetic_black_swan_runs.sql"
);

describe("Migration 0088: synthetic_regime_bank + synthetic_black_swan_runs", () => {
  it("migration file exists", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  // ─── synthetic_regime_bank invariants ──────────────────────────────────────

  it("declares the synthetic_regime_bank table", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(
      /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?synthetic_regime_bank/i
    );
  });

  it("synthetic_regime_bank declares all required columns", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(/\bid\s+uuid\b/i);
    expect(sql).toMatch(/\bsymbol\s+text\b/i);
    expect(sql).toMatch(/\btimeframe\s+text\b/i);
    expect(sql).toMatch(/\bregime_label\s+text\b/i);
    expect(sql).toMatch(/\bconditioning_vector_compressed\s+bytea\b/i);
    expect(sql).toMatch(/\bconditioning_dim\s+integer\b/i);
    expect(sql).toMatch(/\bs3_path\s+text\b/i);
    expect(sql).toMatch(/\bnum_bars\s+integer\b/i);
    expect(sql).toMatch(/\bstylized_fact_passed\s+boolean\b/i);
    expect(sql).toMatch(/\bgenerator_model_version\s+text\b/i);
  });

  it("synthetic_regime_bank declares the three indexes", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_synth_bank_symbol_tf/i
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_synth_bank_regime/i
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_synth_bank_passed/i
    );
    // The passed-only index must be partial — keeps it small.
    expect(sql).toMatch(/WHERE\s+stylized_fact_passed\s*=\s*true/i);
  });

  // ─── synthetic_black_swan_runs invariants ──────────────────────────────────

  it("declares the synthetic_black_swan_runs table", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(
      /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?synthetic_black_swan_runs/i
    );
  });

  it("synthetic_black_swan_runs declares all required columns", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(/\bid\s+uuid\b/i);
    expect(sql).toMatch(/\bstrategy_id\s+uuid\b/i);
    expect(sql).toMatch(/\bbacktest_id\s+uuid\b/i);
    expect(sql).toMatch(/\bstatus\s+text\b/i);
    expect(sql).toMatch(/\bnum_regimes_tested\s+integer\b/i);
    expect(sql).toMatch(/\bnum_regimes_survived\s+integer\b/i);
    expect(sql).toMatch(/\bsurvival_rate\s+numeric/i);
    expect(sql).toMatch(/\bworst_regime_id\s+uuid\b/i);
    expect(sql).toMatch(/\bworst_regime_drawdown\s+numeric\b/i);
    expect(sql).toMatch(/\bworst_regime_label\s+text\b/i);
    expect(sql).toMatch(/\bresult_summary\s+jsonb\b/i);
    expect(sql).toMatch(/\berror_message\s+text\b/i);
    expect(sql).toMatch(/\bexecution_time_ms\s+integer\b/i);
    expect(sql).toMatch(/\bgenerator_model_version\s+text\b/i);
    expect(sql).toMatch(/\bcreated_at\s+timestamp\b/i);
    expect(sql).toMatch(/\bresolved_at\s+timestamp\b/i);
  });

  it("synthetic_black_swan_runs has pending-row contract default", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    // Must mirror frankenstein_test_runs / quantum_run_costs pending-row pattern
    expect(sql).toMatch(/\bstatus\s+text\s+NOT\s+NULL\s+DEFAULT\s+'pending'/i);
  });

  it("synthetic_black_swan_runs declares foreign keys with ON DELETE CASCADE", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    // strategy_id and backtest_id must cascade
    expect(sql).toMatch(
      /strategy_id[\s\S]*REFERENCES\s+strategies\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i
    );
    expect(sql).toMatch(
      /backtest_id[\s\S]*REFERENCES\s+backtests\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i
    );
    // worst_regime_id is a soft FK (no cascade) — the regime bank survives.
    expect(sql).toMatch(/REFERENCES\s+synthetic_regime_bank\s*\(\s*id\s*\)/i);
  });

  it("synthetic_black_swan_runs declares the three indexes", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_blackswan_backtest/i
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_blackswan_strategy/i
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_blackswan_completed/i
    );
    // The completed index must be partial (gate filter).
    expect(sql).toMatch(/WHERE\s+status\s*=\s*'completed'/i);
  });

  // ─── Additive-only invariants ──────────────────────────────────────────────

  it("migration is additive only — no destructive operations", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });

  // ─── Drizzle journal + schema.ts integration ───────────────────────────────

  it("registered in drizzle journal", () => {
    const journalPath = resolve(
      process.cwd(),
      "src/server/db/migrations/meta/_journal.json"
    );
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const tags: string[] = journal.entries.map((e: { tag: string }) => e.tag);
    expect(tags).toContain("0088_synthetic_black_swan_runs");
  });

  it("schema.ts exports syntheticRegimeBank Drizzle table", () => {
    const schemaPath = resolve(process.cwd(), "src/server/db/schema.ts");
    const ts = readFileSync(schemaPath, "utf8");
    expect(ts).toMatch(
      /export\s+const\s+syntheticRegimeBank\s*=\s*pgTable\s*\(\s*["']synthetic_regime_bank["']/
    );
    expect(ts).toMatch(
      /regimeLabel\s*:\s*text\(\s*["']regime_label["']\s*\)/
    );
    expect(ts).toMatch(
      /conditioningVectorCompressed\s*:\s*bytea\(\s*["']conditioning_vector_compressed["']\s*\)/
    );
    expect(ts).toMatch(
      /stylizedFactPassed\s*:\s*boolean\(\s*["']stylized_fact_passed["']\s*\)/
    );
  });

  it("schema.ts exports syntheticBlackSwanRuns Drizzle table", () => {
    const schemaPath = resolve(process.cwd(), "src/server/db/schema.ts");
    const ts = readFileSync(schemaPath, "utf8");
    expect(ts).toMatch(
      /export\s+const\s+syntheticBlackSwanRuns\s*=\s*pgTable\s*\(\s*["']synthetic_black_swan_runs["']/
    );
    expect(ts).toMatch(
      /strategyId\s*:\s*uuid\(\s*["']strategy_id["']\s*\)[\s\S]*onDelete\s*:\s*["']cascade["']/
    );
    expect(ts).toMatch(
      /backtestId\s*:\s*uuid\(\s*["']backtest_id["']\s*\)[\s\S]*onDelete\s*:\s*["']cascade["']/
    );
    expect(ts).toMatch(
      /survivalRate\s*:\s*numeric\(\s*["']survival_rate["']/
    );
    expect(ts).toMatch(
      /status\s*:\s*text\(\s*["']status["']\s*\)\.notNull\(\)\.default\(\s*["']pending["']\s*\)/
    );
  });
});

// ─── Live DB enforcement (only when DATABASE_URL is set) ────────────────────
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)(
  "synthetic_regime_bank + synthetic_black_swan_runs — live DB",
  () => {
    it("synthetic_regime_bank exists in information_schema", async () => {
      const { client } = await import("../db/index.js");
      const rows = await client<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'synthetic_regime_bank'
      `;
      expect(rows.length).toBe(1);
    });

    it("synthetic_regime_bank has all expected columns with correct types", async () => {
      const { client } = await import("../db/index.js");
      const rows = await client<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }[]>`
        SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'synthetic_regime_bank'
      `;
      const colMap = new Map(rows.map((r) => [r.column_name, r]));
      expect(colMap.get("id")?.data_type).toBe("uuid");
      expect(colMap.get("symbol")?.data_type).toBe("text");
      expect(colMap.get("symbol")?.is_nullable).toBe("NO");
      expect(colMap.get("timeframe")?.data_type).toBe("text");
      expect(colMap.get("regime_label")?.data_type).toBe("text");
      expect(colMap.get("conditioning_vector_compressed")?.data_type).toBe("bytea");
      expect(colMap.get("conditioning_dim")?.data_type).toBe("integer");
      expect(colMap.get("s3_path")?.data_type).toBe("text");
      expect(colMap.get("num_bars")?.data_type).toBe("integer");
      expect(colMap.get("stylized_fact_passed")?.data_type).toBe("boolean");
      expect(colMap.get("generator_model_version")?.data_type).toBe("text");
    });

    it("synthetic_black_swan_runs exists in information_schema", async () => {
      const { client } = await import("../db/index.js");
      const rows = await client<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'synthetic_black_swan_runs'
      `;
      expect(rows.length).toBe(1);
    });

    it("synthetic_black_swan_runs has all expected columns with correct types", async () => {
      const { client } = await import("../db/index.js");
      const rows = await client<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }[]>`
        SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'synthetic_black_swan_runs'
      `;
      const colMap = new Map(rows.map((r) => [r.column_name, r]));
      expect(colMap.get("id")?.data_type).toBe("uuid");
      expect(colMap.get("strategy_id")?.data_type).toBe("uuid");
      expect(colMap.get("strategy_id")?.is_nullable).toBe("NO");
      expect(colMap.get("backtest_id")?.data_type).toBe("uuid");
      expect(colMap.get("backtest_id")?.is_nullable).toBe("NO");
      expect(colMap.get("status")?.data_type).toBe("text");
      expect(colMap.get("status")?.is_nullable).toBe("NO");
      expect(colMap.get("survival_rate")?.data_type).toBe("numeric");
      expect(colMap.get("worst_regime_id")?.data_type).toBe("uuid");
      expect(colMap.get("result_summary")?.data_type).toBe("jsonb");
    });

    it("synthetic_black_swan_runs FK to strategies and backtests use ON DELETE CASCADE", async () => {
      const { client } = await import("../db/index.js");
      const rows = await client<{
        constraint_name: string;
        delete_rule: string;
      }[]>`
        SELECT rc.constraint_name, rc.delete_rule
        FROM information_schema.referential_constraints rc
        JOIN information_schema.table_constraints tc
          ON tc.constraint_name = rc.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'synthetic_black_swan_runs'
      `;
      // At least the strategy_id and backtest_id FKs must cascade.
      const cascadeCount = rows.filter((r) => r.delete_rule === "CASCADE").length;
      expect(cascadeCount).toBeGreaterThanOrEqual(2);
    });

    it("synthetic_regime_bank has the expected indexes", async () => {
      const { client } = await import("../db/index.js");
      const rows = await client<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'synthetic_regime_bank'
      `;
      const names = rows.map((r) => r.indexname);
      expect(names).toContain("idx_synth_bank_symbol_tf");
      expect(names).toContain("idx_synth_bank_regime");
      expect(names).toContain("idx_synth_bank_passed");
    });

    it("synthetic_black_swan_runs has the expected indexes", async () => {
      const { client } = await import("../db/index.js");
      const rows = await client<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'synthetic_black_swan_runs'
      `;
      const names = rows.map((r) => r.indexname);
      expect(names).toContain("idx_blackswan_backtest");
      expect(names).toContain("idx_blackswan_strategy");
      expect(names).toContain("idx_blackswan_completed");
    });
  }
);
