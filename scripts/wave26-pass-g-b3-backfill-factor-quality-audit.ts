/**
 * wave26-pass-g-b3-backfill-factor-quality-audit.ts
 * Wave 26 Pass G B3 (2026-05-26)
 *
 * Retroactively classifies and records factor_quality for the 99 existing
 * strategies in the library.
 *
 * WHAT THIS DOES:
 *   1. Queries all ACTIVE strategies (CANDIDATE through DEPLOYED, excluding GRAVEYARD/RETIRED)
 *   2. For each strategy, reads config.entry_quality.confluence_factors
 *   3. Classifies factor_quality using the same classifyFactorQuality() logic
 *      used at graduation time (no LLM call — pure structural classification)
 *   4. In --apply mode:
 *      a. Writes one "graduation.factor_quality_classified" audit row per strategy
 *         (marked with metadata.backfill=true so these rows are distinguishable)
 *      b. Updates config.entry_quality.factor_quality in the strategy's config JSONB
 *   5. Prints a distribution report: total by quality bucket
 *
 * DRY-RUN BY DEFAULT: requires --apply flag to actually write to DB.
 *
 * Usage:
 *   npx tsx scripts/wave26-pass-g-b3-backfill-factor-quality-audit.ts
 *   npx tsx scripts/wave26-pass-g-b3-backfill-factor-quality-audit.ts --apply
 *
 * Safe to re-run: audit rows are keyed by (strategy_id, action) de-dup. The
 * UPSERT pattern writes action + result but never duplicates rows because the
 * audit_log table is append-only (each run adds a new row) — the idempotency
 * contract is documented as "backfill rows are marked metadata.backfill=true
 * and are non-binding; duplicates are harmless".
 *
 * Exits non-zero if the DB write fails in --apply mode.
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";

// ─── Factor quality constants (mirrors confluence-quality-audit.ts) ───────────

const AUTO_FLOOR_FACTORS = new Set(["regime_match", "structural_setup"]);

type FactorQuality = "rich" | "thin" | "fallback_only";
type FactorSource  = "extracted" | "auto_floor";

function classifyFactorQuality(factors: string[]): FactorQuality {
  if (factors.length === 0) return "fallback_only";
  const extracted = factors.filter((f) => !AUTO_FLOOR_FACTORS.has(f));
  if (extracted.length === 0) return "fallback_only";
  if (extracted.length < 3)   return "thin";
  return "rich";
}

function tagFactorSources(factors: string[]): Record<string, FactorSource> {
  const out: Record<string, FactorSource> = {};
  for (const f of factors) {
    out[f] = AUTO_FLOOR_FACTORS.has(f) ? "auto_floor" : "extracted";
  }
  return out;
}

// ─── DB connection ────────────────────────────────────────────────────────────

function loadDbUrl(): string {
  try {
    const env = readFileSync(".env", "utf-8");
    const line = env.split("\n").find((l) => l.startsWith("DATABASE_URL="));
    const url  = line?.split("=").slice(1).join("=").trim();
    if (url) return url;
  } catch {}
  const fromProcess = process.env["DATABASE_URL"];
  if (fromProcess) return fromProcess;
  throw new Error("DATABASE_URL not found in .env or environment");
}

// ─── Active lifecycle states ──────────────────────────────────────────────────

const ACTIVE_STATES = [
  "CANDIDATE", "TESTING", "PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED", "DECLINING",
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const applyMode = process.argv.includes("--apply");

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(" Wave 26 Pass G B3 — Factor Quality Backfill");
  console.log(`  Mode: ${applyMode ? "APPLY (writing to DB)" : "DRY-RUN (no writes)"}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  const dbUrl = loadDbUrl();
  const sql   = postgres(dbUrl, { max: 2, idle_timeout: 30 });

  try {
    // 1. Load all active strategies
    const rows = await sql<{
      id:     string;
      name:   string;
      config: Record<string, unknown>;
    }[]>`
      SELECT id, name, config
      FROM strategies
      WHERE lifecycle_state = ANY(${ACTIVE_STATES})
      ORDER BY created_at ASC
    `;

    console.log(`Loaded ${rows.length} active strategies.\n`);

    const distribution: Record<FactorQuality, number> = {
      rich:          0,
      thin:          0,
      fallback_only: 0,
    };

    type StrategyRow = { id: string; name: string; quality: FactorQuality; factors: string[]; sources: Record<string, FactorSource> };
    const classified: StrategyRow[] = [];

    for (const row of rows) {
      const entryQuality = (row.config as any)?.entry_quality;
      const rawFactors: string[] = Array.isArray(entryQuality?.confluence_factors)
        ? entryQuality.confluence_factors
        : [];

      const quality  = classifyFactorQuality(rawFactors);
      const sources  = tagFactorSources(rawFactors);

      distribution[quality]++;
      classified.push({ id: row.id, name: row.name, quality, factors: rawFactors, sources });
    }

    // 2. Print distribution
    console.log("─── Factor quality distribution ──────────────────────────────");
    console.log(`  rich:          ${distribution.rich}`);
    console.log(`  thin:          ${distribution.thin}`);
    console.log(`  fallback_only: ${distribution.fallback_only}`);
    console.log(`  total:         ${rows.length}\n`);

    // 3. List fallback_only and thin strategies (operators may want to re-extract)
    const thinOrFallback = classified.filter((s) => s.quality !== "rich");
    if (thinOrFallback.length > 0) {
      console.log("─── Strategies needing re-extraction (thin / fallback_only) ──");
      for (const s of thinOrFallback) {
        console.log(`  [${s.quality.padEnd(13)}] ${s.name}`);
        console.log(`    id:      ${s.id}`);
        console.log(`    factors: [${s.factors.join(", ")}]`);
      }
      console.log();
    }

    if (!applyMode) {
      console.log("─── DRY-RUN complete — re-run with --apply to write audit rows and update config ──");
      return;
    }

    // 4. APPLY MODE: write audit rows + update config
    console.log("─── APPLY mode: writing audit rows and updating config JSONB ─");
    let auditWritten  = 0;
    let configUpdated = 0;
    let errors        = 0;

    for (const s of classified) {
      try {
        // a. Write audit row
        await sql`
          INSERT INTO audit_log (
            action, entity_type, entity_id,
            input, result, status,
            decision_authority, correlation_id
          ) VALUES (
            'graduation.factor_quality_classified',
            'strategy',
            ${s.id},
            ${JSON.stringify({
              strategy_name:      s.name,
              confluence_factors: s.factors,
            })},
            ${JSON.stringify({
              factor_quality: s.quality,
              factor_sources: s.sources,
              backfill:       true,
            })},
            'info',
            'system',
            NULL
          )
        `;
        auditWritten++;

        // b. Update config.entry_quality.factor_quality
        await sql`
          UPDATE strategies
          SET
            config = jsonb_set(
              config,
              '{entry_quality,factor_quality}',
              ${JSON.stringify(s.quality)}::jsonb,
              true
            ),
            updated_at = NOW()
          WHERE id = ${s.id}
        `;
        configUpdated++;

        process.stdout.write(".");
      } catch (err: unknown) {
        errors++;
        console.error(
          `\n  ERROR on strategy ${s.id} (${s.name}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    console.log(`\n\n─── APPLY complete ───────────────────────────────────────────`);
    console.log(`  audit rows written:  ${auditWritten}`);
    console.log(`  config rows updated: ${configUpdated}`);
    console.log(`  errors:              ${errors}`);

    if (errors > 0) {
      console.error("\nBackfill completed with errors — check logs above.");
      process.exit(1);
    }

    console.log("\nBackfill complete.");

  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Backfill script fatal error:", err);
  process.exit(1);
});
