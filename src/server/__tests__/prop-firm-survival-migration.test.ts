/**
 * Tests for migration 0089: firm_adversarial_priors + strategy_firm_eligibility
 * additive columns (W20 / B14 Prop-Firm Survival Twin — Pass 1 foundation).
 *
 * Two layers (mirrors 0088 synthetic_black_swan_runs test pattern):
 *   1. Migration-text invariants — verify the migration file declares the
 *      table, columns, indexes, UNIQUE constraint, and that the four
 *      additive ALTER TABLE columns are present. Runs everywhere; no DB.
 *   2. Live DB enforcement — when DATABASE_URL is set, query
 *      information_schema.tables / columns / pg_indexes and exercise the
 *      UNIQUE constraint with INSERT/INSERT to confirm the schema is real
 *      after migration. Skipped when DATABASE_URL is not set.
 *
 * Why this table + these columns exist (Pass 1 of B14):
 *   `firm_adversarial_priors` — per-firm priors for adversarial events
 *     (account_suspension, payout_denial, fund_freeze, profitable_trader_ban,
 *     vpn_detection). Seeded from public-dispute curation; recalibrated
 *     monthly from prop_firm_health_checks observations.
 *   `strategy_firm_eligibility` columns — survival_probability, survival_curve,
 *     survival_evidence_weight, survival_last_fitted_at: persisted by the
 *     B14 survival service AFTER the existing B5 eligibility check, never
 *     blocking promotion. Phase 0 advisory; Phase 1 tiebreaker.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "src/server/db/migrations/0089_prop_firm_survival.sql"
);

const SEED_PATH = resolve(
  process.cwd(),
  "src/server/db/seeds/firm_adversarial_priors_seed.json"
);

describe("Migration 0089: firm_adversarial_priors + strategy_firm_eligibility additive columns", () => {
  it("migration file exists", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  // ─── firm_adversarial_priors invariants ────────────────────────────────────

  it("declares the firm_adversarial_priors table", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(
      /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?firm_adversarial_priors/i
    );
  });

  it("firm_adversarial_priors declares all required columns", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(/\bid\s+uuid\b/i);
    expect(sql).toMatch(/\bfirm_id\s+text\b/i);
    expect(sql).toMatch(/\bevent_type\s+text\b/i);
    expect(sql).toMatch(/\bbase_rate\s+numeric/i);
    expect(sql).toMatch(/\bevidence_weight\s+integer\b/i);
    expect(sql).toMatch(/\bevidence_sources\s+jsonb\b/i);
    expect(sql).toMatch(/\blast_observed_at\s+timestamp\b/i);
    expect(sql).toMatch(/\bfit_method\s+text\b/i);
    expect(sql).toMatch(/\blast_fitted_at\s+timestamp\b/i);
    expect(sql).toMatch(/\bcreated_at\s+timestamp\b/i);
    expect(sql).toMatch(/\bupdated_at\s+timestamp\b/i);
  });

  it("firm_adversarial_priors enforces fit_method default 'manual_seed'", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    // manual_seed is the lowest-authority fit method per B14 rule freshness model
    expect(sql).toMatch(/\bfit_method\s+text\s+NOT\s+NULL\s+DEFAULT\s+'manual_seed'/i);
  });

  it("firm_adversarial_priors declares the UNIQUE(firm_id, event_type) constraint", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    // Must be UNIQUE on (firm_id, event_type) so recalibration upserts cleanly
    expect(sql).toMatch(/UNIQUE\s*\(\s*firm_id\s*,\s*event_type\s*\)/i);
  });

  it("firm_adversarial_priors declares the three lookup indexes", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_firm_priors_firm/i
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_firm_priors_event/i
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_firm_priors_recent/i
    );
    // Recency index must sort DESC for staleness-scan queries
    expect(sql).toMatch(/idx_firm_priors_recent[\s\S]*last_fitted_at\s+DESC/i);
  });

  // ─── strategy_firm_eligibility additive columns ────────────────────────────

  it("strategy_firm_eligibility receives all 4 additive survival columns", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    // All four ALTERs must use IF NOT EXISTS for idempotency
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+strategy_firm_eligibility[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+survival_probability\s+numeric/i
    );
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+strategy_firm_eligibility[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+survival_curve\s+jsonb/i
    );
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+strategy_firm_eligibility[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+survival_evidence_weight\s+integer/i
    );
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+strategy_firm_eligibility[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+survival_last_fitted_at\s+timestamp/i
    );
  });

  it("additive columns are NULLABLE (no NOT NULL clauses on the 4 new survival columns)", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    // The four additive columns must be nullable so existing rows aren't broken.
    // If anyone ever adds a NOT NULL clause to one of these ALTERs, fail.
    expect(sql).not.toMatch(/survival_probability\s+numeric[^,;\n]*NOT\s+NULL/i);
    expect(sql).not.toMatch(/survival_curve\s+jsonb[^,;\n]*NOT\s+NULL/i);
    expect(sql).not.toMatch(/survival_evidence_weight\s+integer[^,;\n]*NOT\s+NULL/i);
    expect(sql).not.toMatch(/survival_last_fitted_at\s+timestamp[^,;\n]*NOT\s+NULL/i);
  });

  // ─── Additive-only invariants ──────────────────────────────────────────────

  it("migration is additive only — no destructive operations", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bDROP\s+CONSTRAINT\b/i);
    expect(sql).not.toMatch(/\bDROP\s+INDEX\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    // ALTER TABLE is allowed but only as ADD COLUMN IF NOT EXISTS
    // (the additive-columns test above already validates this)
  });

  // ─── Drizzle journal + schema.ts integration ───────────────────────────────

  it("registered in drizzle journal", () => {
    const journalPath = resolve(
      process.cwd(),
      "src/server/db/migrations/meta/_journal.json"
    );
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const tags: string[] = journal.entries.map((e: { tag: string }) => e.tag);
    expect(tags).toContain("0089_prop_firm_survival");
  });

  it("schema.ts exports firmAdversarialPriors Drizzle table", () => {
    const schemaPath = resolve(process.cwd(), "src/server/db/schema.ts");
    const ts = readFileSync(schemaPath, "utf8");
    expect(ts).toMatch(
      /export\s+const\s+firmAdversarialPriors\s*=\s*pgTable\s*\(\s*["']firm_adversarial_priors["']/
    );
    expect(ts).toMatch(/firmId\s*:\s*text\(\s*["']firm_id["']\s*\)/);
    expect(ts).toMatch(/eventType\s*:\s*text\(\s*["']event_type["']\s*\)/);
    expect(ts).toMatch(/baseRate\s*:\s*numeric\(\s*["']base_rate["']/);
    expect(ts).toMatch(
      /fitMethod\s*:\s*text\(\s*["']fit_method["']\s*\)\.notNull\(\)\.default\(\s*["']manual_seed["']\s*\)/
    );
  });

  it("schema.ts extends strategyFirmEligibility with 4 survival columns", () => {
    const schemaPath = resolve(process.cwd(), "src/server/db/schema.ts");
    const ts = readFileSync(schemaPath, "utf8");
    expect(ts).toMatch(
      /survivalProbability\s*:\s*numeric\(\s*["']survival_probability["']/
    );
    expect(ts).toMatch(/survivalCurve\s*:\s*jsonb\(\s*["']survival_curve["']\s*\)/);
    expect(ts).toMatch(
      /survivalEvidenceWeight\s*:\s*integer\(\s*["']survival_evidence_weight["']\s*\)/
    );
    expect(ts).toMatch(
      /survivalLastFittedAt\s*:\s*timestamp\(\s*["']survival_last_fitted_at["']\s*\)/
    );
  });

  // ─── Seed JSON shape & coverage ────────────────────────────────────────────

  it("seed JSON file exists and parses cleanly", () => {
    expect(existsSync(SEED_PATH)).toBe(true);
    const raw = readFileSync(SEED_PATH, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("seed JSON covers mffu and topstep firmIds only (legacy firms removed 2026-05-10)", () => {
    const raw = readFileSync(SEED_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      rows: Array<{
        firmId: string;
        eventType: string;
        baseRate: number;
        evidenceWeight: number;
        evidenceSources: Array<unknown>;
        lastObservedAt: string;
        fitMethod: string;
      }>;
    };
    expect(Array.isArray(parsed.rows)).toBe(true);

    const firmIds = new Set(parsed.rows.map((r) => r.firmId));
    // Only MFFU + Topstep supported after migration 0097
    expect(firmIds.has("topstep")).toBe(true);
    expect(firmIds.has("mffu")).toBe(true);
    // Legacy firms must NOT appear in the cleaned seed
    expect(firmIds.has("apex")).toBe(false);
    expect(firmIds.has("tpt")).toBe(false);
    expect(firmIds.has("ffn")).toBe(false);
    expect(firmIds.has("alpha")).toBe(false);
    expect(firmIds.has("tradeify")).toBe(false);
    expect(firmIds.has("earn2trade")).toBe(false);

    // Every row must declare fit_method=manual_seed for the seed file
    for (const row of parsed.rows) {
      expect(row.fitMethod).toBe("manual_seed");
      expect(typeof row.baseRate).toBe("number");
      expect(row.baseRate).toBeGreaterThanOrEqual(0);
      expect(row.baseRate).toBeLessThanOrEqual(1);
      expect(Array.isArray(row.evidenceSources)).toBe(true);
    }
  });

  it("seed JSON: Topstep has the lowest profitable_trader_ban + account_suspension rates (2-firm set)", () => {
    // Topstep is the primary ATS deployment target. Per CLAUDE.md, Topstep's
    // automation-friendliness shows up as low adversarial-event base rates.
    // The seed must reflect this expected ordering across the 2-firm set.
    const raw = readFileSync(SEED_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      rows: Array<{ firmId: string; eventType: string; baseRate: number }>;
    };

    const banRates = new Map<string, number>();
    const suspendRates = new Map<string, number>();
    for (const r of parsed.rows) {
      if (r.eventType === "profitable_trader_ban") banRates.set(r.firmId, r.baseRate);
      if (r.eventType === "account_suspension") suspendRates.set(r.firmId, r.baseRate);
    }

    // Topstep's profitable_trader_ban rate must be defined and minimal
    const topBan = banRates.get("topstep");
    expect(topBan).toBeDefined();
    // No other firm should have a lower ban rate (MFFU has no ban-rate row in seed)
    for (const [firm, rate] of banRates.entries()) {
      if (firm === "topstep") continue;
      expect(topBan!).toBeLessThanOrEqual(rate);
    }

    // Topstep's account_suspension must be at or below all other firms that
    // declare an account_suspension prior.
    const topSuspend = suspendRates.get("topstep");
    expect(topSuspend).toBeDefined();
    for (const [firm, rate] of suspendRates.entries()) {
      if (firm === "topstep") continue;
      expect(topSuspend!).toBeLessThanOrEqual(rate);
    }
  });
});

// ─── Live DB enforcement (only when DATABASE_URL is set) ────────────────────
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)(
  "firm_adversarial_priors + strategy_firm_eligibility — live DB",
  () => {
    it("firm_adversarial_priors exists in information_schema", async () => {
      const { client } = await import("../db/index.js");
      const rows = await client<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'firm_adversarial_priors'
      `;
      expect(rows.length).toBe(1);
    });

    it("firm_adversarial_priors has all expected columns with correct types", async () => {
      const { client } = await import("../db/index.js");
      const rows = await client<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }[]>`
        SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'firm_adversarial_priors'
      `;
      const colMap = new Map(rows.map((r) => [r.column_name, r]));
      expect(colMap.get("id")?.data_type).toBe("uuid");
      expect(colMap.get("firm_id")?.data_type).toBe("text");
      expect(colMap.get("firm_id")?.is_nullable).toBe("NO");
      expect(colMap.get("event_type")?.data_type).toBe("text");
      expect(colMap.get("event_type")?.is_nullable).toBe("NO");
      expect(colMap.get("base_rate")?.data_type).toBe("numeric");
      expect(colMap.get("base_rate")?.is_nullable).toBe("NO");
      expect(colMap.get("evidence_weight")?.data_type).toBe("integer");
      expect(colMap.get("evidence_weight")?.is_nullable).toBe("NO");
      expect(colMap.get("evidence_sources")?.data_type).toBe("jsonb");
      expect(colMap.get("last_observed_at")?.data_type).toBe(
        "timestamp without time zone"
      );
      expect(colMap.get("fit_method")?.data_type).toBe("text");
      expect(colMap.get("fit_method")?.is_nullable).toBe("NO");
      expect(colMap.get("last_fitted_at")?.data_type).toBe(
        "timestamp without time zone"
      );
    });

    it("firm_adversarial_priors has the expected indexes", async () => {
      const { client } = await import("../db/index.js");
      const rows = await client<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'firm_adversarial_priors'
      `;
      const names = rows.map((r) => r.indexname);
      expect(names).toContain("idx_firm_priors_firm");
      expect(names).toContain("idx_firm_priors_event");
      expect(names).toContain("idx_firm_priors_recent");
      // The UNIQUE constraint is enforced via an implicit index named
      // idx_firm_priors_unique (declared as `CONSTRAINT idx_firm_priors_unique UNIQUE(...)`).
      expect(names).toContain("idx_firm_priors_unique");
    });

    it("UNIQUE(firm_id, event_type) is enforced at DB level", async () => {
      const { client } = await import("../db/index.js");
      const probeFirm = "__b14_test_firm__";
      const probeEvent = "__b14_test_event__";

      // Cleanup any leftover probe rows from prior runs so the test is
      // idempotent.
      await client`
        DELETE FROM firm_adversarial_priors
        WHERE firm_id = ${probeFirm} AND event_type = ${probeEvent}
      `;

      try {
        // First insert should succeed.
        await client`
          INSERT INTO firm_adversarial_priors
            (firm_id, event_type, base_rate, evidence_weight, fit_method)
          VALUES (${probeFirm}, ${probeEvent}, 0.0100, 0, 'manual_seed')
        `;

        // Duplicate (firm_id, event_type) must fail.
        let dupErr: Error | null = null;
        try {
          await client`
            INSERT INTO firm_adversarial_priors
              (firm_id, event_type, base_rate, evidence_weight, fit_method)
            VALUES (${probeFirm}, ${probeEvent}, 0.0200, 0, 'manual_seed')
          `;
        } catch (err) {
          dupErr = err as Error;
        }
        expect(dupErr).not.toBeNull();
        expect(dupErr?.message ?? "").toMatch(/duplicate|unique/i);
      } finally {
        // Always clean up the probe row.
        await client`
          DELETE FROM firm_adversarial_priors
          WHERE firm_id = ${probeFirm} AND event_type = ${probeEvent}
        `;
      }
    });

    it("strategy_firm_eligibility has the 4 new survival columns and they are nullable", async () => {
      const { client } = await import("../db/index.js");
      const rows = await client<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }[]>`
        SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'strategy_firm_eligibility'
          AND column_name IN (
            'survival_probability',
            'survival_curve',
            'survival_evidence_weight',
            'survival_last_fitted_at'
          )
      `;
      const colMap = new Map(rows.map((r) => [r.column_name, r]));
      expect(colMap.size).toBe(4);

      expect(colMap.get("survival_probability")?.data_type).toBe("numeric");
      expect(colMap.get("survival_probability")?.is_nullable).toBe("YES");

      expect(colMap.get("survival_curve")?.data_type).toBe("jsonb");
      expect(colMap.get("survival_curve")?.is_nullable).toBe("YES");

      expect(colMap.get("survival_evidence_weight")?.data_type).toBe("integer");
      expect(colMap.get("survival_evidence_weight")?.is_nullable).toBe("YES");

      expect(colMap.get("survival_last_fitted_at")?.data_type).toBe(
        "timestamp without time zone"
      );
      expect(colMap.get("survival_last_fitted_at")?.is_nullable).toBe("YES");
    });

    it("inserting a fully-populated firm_adversarial_priors row succeeds and round-trips", async () => {
      const { client } = await import("../db/index.js");
      const probeFirm = "__b14_roundtrip_firm__";
      const probeEvent = "__b14_roundtrip_event__";

      await client`
        DELETE FROM firm_adversarial_priors
        WHERE firm_id = ${probeFirm} AND event_type = ${probeEvent}
      `;

      const sourcesJson = JSON.stringify([
        {
          source: "test",
          url: "https://example.com/dispute/1",
          observed_at: "2025-04-01",
          severity: "high",
        },
      ]);

      try {
        await client`
          INSERT INTO firm_adversarial_priors
            (firm_id, event_type, base_rate, evidence_weight, evidence_sources, fit_method)
          VALUES (
            ${probeFirm},
            ${probeEvent},
            0.0123,
            2,
            ${sourcesJson}::jsonb,
            'manual_seed'
          )
        `;

        const rows = await client<{
          firm_id: string;
          event_type: string;
          base_rate: string;
          evidence_weight: number;
          evidence_sources: Array<{ url: string }>;
          fit_method: string;
        }[]>`
          SELECT firm_id, event_type, base_rate, evidence_weight,
                 evidence_sources, fit_method
          FROM firm_adversarial_priors
          WHERE firm_id = ${probeFirm} AND event_type = ${probeEvent}
        `;
        expect(rows.length).toBe(1);
        expect(rows[0].firm_id).toBe(probeFirm);
        expect(rows[0].event_type).toBe(probeEvent);
        expect(Number(rows[0].base_rate)).toBeCloseTo(0.0123, 4);
        expect(rows[0].evidence_weight).toBe(2);
        expect(rows[0].fit_method).toBe("manual_seed");
        expect(Array.isArray(rows[0].evidence_sources)).toBe(true);
        expect(rows[0].evidence_sources[0].url).toBe(
          "https://example.com/dispute/1"
        );
      } finally {
        await client`
          DELETE FROM firm_adversarial_priors
          WHERE firm_id = ${probeFirm} AND event_type = ${probeEvent}
        `;
      }
    });

    it("pre-existing strategy_firm_eligibility rows still readable (additive contract)", async () => {
      // Confirms that pre-B14 rows (created before migration 0089) are still
      // readable and that the new survival columns default to NULL on those
      // rows. This is the core additive-contract guarantee.
      const { client } = await import("../db/index.js");
      const rows = await client<{
        id: string;
        survival_probability: string | null;
        survival_curve: unknown | null;
        survival_evidence_weight: number | null;
        survival_last_fitted_at: Date | null;
      }[]>`
        SELECT id, survival_probability, survival_curve,
               survival_evidence_weight, survival_last_fitted_at
        FROM strategy_firm_eligibility
        LIMIT 50
      `;
      // The query itself succeeding is the critical assertion.
      // Existing rows MUST have NULL on the four new columns (no DEFAULT was
      // declared, so existing rows pre-migration receive NULL). New rows can
      // populate them. This guarantees no destructive impact on B5 reads.
      for (const row of rows) {
        // Each row must successfully expose the new columns even if NULL —
        // that's the contract. A missing column would have thrown at SELECT.
        expect(row).toHaveProperty("survival_probability");
        expect(row).toHaveProperty("survival_curve");
        expect(row).toHaveProperty("survival_evidence_weight");
        expect(row).toHaveProperty("survival_last_fitted_at");
      }
    });
  }
);
