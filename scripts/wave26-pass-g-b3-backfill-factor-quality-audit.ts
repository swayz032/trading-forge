/**
 * wave26-pass-g-b3-backfill-factor-quality-audit.ts
 * Wave 26 Pass G B3 + Pass H2 (2026-05-26)
 *
 * Retroactively classifies and records factor_quality for the 99 existing
 * strategies in the library.
 *
 * WHAT THIS DOES (Pass H2 update):
 *   1. Queries all ACTIVE strategies (CANDIDATE through DEPLOYED, excluding GRAVEYARD/RETIRED)
 *   2. For each strategy, reads config.entry_quality.confluence_factors
 *   3. When config.entry_indicator starts with "archetype:", infers the archetype's
 *      definitional confluence factors via inferFactorsFromArchetype() and merges them
 *      into the factor list (tagged kb_inferred). This is the same logic that now runs
 *      at graduation time in direct-bucket-graduator.ts.
 *   4. Classifies factor_quality using the merged factor list:
 *      "rich"          — ≥2 real (extracted + kb_inferred) factors
 *      "thin"          — 1 real factor
 *      "fallback_only" — zero real factors (all auto_floor)
 *   5. In --apply mode:
 *      a. Writes one "graduation.factor_quality_classified" audit row per strategy
 *         (marked with metadata.backfill=true and wave26_pass_h2=true)
 *      b. Updates config.entry_quality.factor_quality in the strategy's config JSONB
 *      c. If kb_inferred factors were added, also updates
 *         config.entry_quality.confluence_factors and config.entry_quality.factor_sources
 *         so the strategy's live config reflects the merged list
 *   6. Prints a distribution report: total by quality bucket, PRE vs POST
 *
 * DRY-RUN BY DEFAULT: requires --apply flag to actually write to DB.
 *
 * Usage:
 *   npx tsx scripts/wave26-pass-g-b3-backfill-factor-quality-audit.ts
 *   npx tsx scripts/wave26-pass-g-b3-backfill-factor-quality-audit.ts --apply
 *
 * Safe to re-run: audit rows are append-only; duplicates are harmless (marked
 * metadata.backfill=true so queries can filter them). The JSONB update is
 * idempotent — running twice produces the same result.
 *
 * Exits non-zero if the DB write fails in --apply mode.
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";

// ─── Archetype-implied factors (mirrors archetype-implied-factors.ts) ─────────
// Inline copy to avoid TS import path issues in tsx script context.
// SYNC CONTRACT: any change to ARCHETYPE_IMPLIED_FACTORS in the lib module
// MUST be mirrored here.  The source of truth is the lib module.

const ARCHETYPE_IMPLIED_FACTORS: Record<string, string[]> = {
  ict_bias_aligned_continuation: [
    "market_structure_aligned",
    "htf_bias_aligned",
    "fvg_present_or_ob",
    "liquidity_target_clear",
    "killzone_active",
  ],
  ict_silver_bullet_ny_am: [
    "killzone_active",
    "market_structure_aligned",
    "fvg_present_or_ob",
    "displacement_confirmed",
  ],
  ict_silver_bullet_ny_pm: [
    "killzone_active",
    "market_structure_aligned",
    "fvg_present_or_ob",
    "displacement_confirmed",
  ],
  ict_power_of_3: [
    "asian_range_swept",
    "manipulation_phase_done",
    "displacement_confirmed",
    "liquidity_target_clear",
  ],
  ict_turtle_soup: [
    "liquidity_target_clear",
    "false_breakout_confirmed",
    "market_structure_aligned",
  ],
  ict_judas_swing: [
    "session_open_aligned",
    "manipulation_phase_done",
    "market_structure_aligned",
  ],
  ict_ote: [
    "market_structure_aligned",
    "htf_bias_aligned",
    "fvg_present_or_ob",
  ],
  bounce_off_level: [
    "ma_as_support_resistance",
    "rejection_pattern_confirmed",
    "regime_match",
  ],
  fvg_retrace: ["fvg_present_or_ob", "market_structure_aligned"],
  order_block: ["fvg_present_or_ob", "market_structure_aligned"],
  liquidity_magnet: ["liquidity_target_clear", "market_structure_aligned"],
  market_structure_shift: ["market_structure_aligned", "displacement_confirmed"],
  // Wave 26 Pass H Phase 1 (2026-05-26) — extended depth for BoS
  break_of_structure: ["market_structure_aligned", "displacement_confirmed", "htf_bias_aligned"],
  displacement: ["displacement_confirmed"],
  wyckoff_spring: ["accumulation_phase_active", "liquidity_sweep_confirmed"],
  wyckoff_upthrust: ["distribution_phase_active", "liquidity_sweep_confirmed"],
  vwap_band_reject: ["vwap_alignment", "market_structure_aligned"],
  anchored_vwap_retest: ["vwap_alignment", "market_structure_aligned", "displacement_confirmed"],
  // Wave 26 Pass H Phase 1 (2026-05-26) — new parametric KB entries
  session_open_breakout:  ["killzone_active", "opening_range_breakout", "first_30min_volume_above_avg"],
  ema_crossover:          ["regime_match", "htf_bias_aligned"],
  opening_range_breakout: ["killzone_active", "first_30min_volume_above_avg"],
  vwap_bounce:            ["vwap_alignment", "regime_match"],
  moving_average:         ["regime_match", "ma_as_support_resistance"],
};

function inferFactorsFromArchetype(archetypeName: string): string[] {
  const key = archetypeName.startsWith("archetype:")
    ? archetypeName.slice("archetype:".length).trim()
    : archetypeName.trim();
  return ARCHETYPE_IMPLIED_FACTORS[key] ?? [];
}

// ─── Factor quality constants (mirrors confluence-quality-audit.ts) ───────────

const AUTO_FLOOR_FACTORS = new Set(["regime_match", "structural_setup"]);

type FactorQuality = "rich" | "thin" | "fallback_only";
type FactorSource  = "extracted" | "auto_floor" | "kb_inferred";

/**
 * Classifies factor_quality from a merged factor list that may include
 * kb_inferred entries added by archetype inference.
 *
 * "rich"          — ≥2 factors that are NOT in AUTO_FLOOR_FACTORS
 *                   (counts both "extracted" and "kb_inferred" as real)
 * "thin"          — exactly 1 real factor
 * "fallback_only" — zero real factors (all auto_floor)
 */
function classifyFactorQuality(factors: string[]): FactorQuality {
  if (factors.length === 0) return "fallback_only";
  const realFactors = factors.filter((f) => !AUTO_FLOOR_FACTORS.has(f));
  if (realFactors.length === 0) return "fallback_only";
  if (realFactors.length < 2)   return "thin";
  return "rich";
}

/**
 * Wave 26 Pass H Phase 1 (2026-05-26) — source-aware quality classifier.
 *
 * Mirrors the graduator/lib `classifyFactorSources` semantics: a factor counts
 * as "real" if its source is `extracted` OR `kb_inferred`. Auto-floor factors
 * (regime_match, structural_setup tagged as `auto_floor`) do not count.
 *
 * This MUST be used in the backfill once Pass H2 introduces archetype-implied
 * factors that may legitimately be `regime_match` / `structural_setup` via
 * the kb_inferred path (e.g. ema_crossover → [regime_match, htf_bias_aligned]).
 * The simpler `classifyFactorQuality(factors)` cannot distinguish these
 * paths because it operates on the merged list without source labels.
 */
function classifyFactorQualityFromSources(
  sources: Record<string, FactorSource>,
): FactorQuality {
  const realCount = Object.values(sources).filter(
    (s) => s === "extracted" || s === "kb_inferred",
  ).length;
  if (realCount === 0) return "fallback_only";
  if (realCount < 2)   return "thin";
  return "rich";
}

/**
 * Tag each factor with its source, given the raw LLM factors and any
 * kb_inferred factors that were added by archetype inference.
 */
function tagFactorSources(
  rawLlmFactors: string[],
  kbInferredFactors: string[],
  allFactors: string[],
): Record<string, FactorSource> {
  const rawSet = new Set(rawLlmFactors);
  const kbSet  = new Set(kbInferredFactors);
  const out: Record<string, FactorSource> = {};
  for (const f of allFactors) {
    if (rawSet.has(f))  out[f] = "extracted";
    else if (kbSet.has(f)) out[f] = "kb_inferred";
    else                out[f] = "auto_floor";
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
  console.log(" Wave 26 Pass G B3 + Pass H2 — Factor Quality Backfill");
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

    const preDist: Record<FactorQuality, number> = { rich: 0, thin: 0, fallback_only: 0 };
    const postDist: Record<FactorQuality, number> = { rich: 0, thin: 0, fallback_only: 0 };

    type StrategyRow = {
      id:                string;
      name:              string;
      quality:           FactorQuality;
      preQuality:        FactorQuality;
      factors:           string[];   // merged (may include kb_inferred)
      rawLlmFactors:     string[];   // original LLM-extracted factors
      kbInferredAdded:   string[];   // net-new kb_inferred factors
      sources:           Record<string, FactorSource>;
      entryIndicator:    string | null;
    };
    const classified: StrategyRow[] = [];

    for (const row of rows) {
      const entryQuality = (row.config as any)?.entry_quality;

      // Raw factors as stored in DB (from LLM extraction + floor guard)
      const rawStoredFactors: string[] = Array.isArray(entryQuality?.confluence_factors)
        ? entryQuality.confluence_factors
        : [];

      // The LLM-extracted factors are the non-auto_floor ones among rawStoredFactors
      const rawLlmFactors: string[] = rawStoredFactors.filter(
        (f) => !AUTO_FLOOR_FACTORS.has(f),
      );

      // Pre-Pass-H2 quality (what the B3 original backfill would have assigned)
      const preQuality = classifyFactorQuality(rawStoredFactors);
      preDist[preQuality]++;

      // ─── Pass H2: archetype-implied factor inference ──────────────────────
      // When the strategy's entry_indicator is an archetype, derive and merge
      // the implied confluence factors so the quality classification improves.
      const entryIndicator: string | null =
        (row.config as any)?.entry_indicator ?? null;

      const impliedFactors: string[] = entryIndicator
        ? inferFactorsFromArchetype(entryIndicator)
        : [];

      // Merge: start from rawStoredFactors; add any implied not already present
      const mergedSet = new Set(rawStoredFactors);
      const kbInferredAdded: string[] = [];
      for (const implied of impliedFactors) {
        if (!mergedSet.has(implied)) {
          mergedSet.add(implied);
          kbInferredAdded.push(implied);
        }
      }
      const mergedFactors = [...mergedSet];

      // Post-Pass-H2 quality — source-aware (Phase 1: kb_inferred counts as
      // real, matching graduator/lib semantics; required for parametric KB
      // entries whose implied set legitimately contains regime_match).
      const sources = tagFactorSources(rawLlmFactors, kbInferredAdded, mergedFactors);
      const quality = classifyFactorQualityFromSources(sources);
      postDist[quality]++;

      classified.push({
        id: row.id,
        name: row.name,
        quality,
        preQuality,
        factors: mergedFactors,
        rawLlmFactors,
        kbInferredAdded,
        sources,
        entryIndicator,
      });
    }

    // 2. Print distribution comparison (PRE vs POST)
    console.log("─── Factor quality distribution: PRE vs POST Pass H2 ─────────");
    console.log(`  ${"".padEnd(16)} ${"PRE".padEnd(6)} → POST`);
    for (const q of ["rich", "thin", "fallback_only"] as FactorQuality[]) {
      const changed = preDist[q] !== postDist[q] ? " <-- CHANGED" : "";
      console.log(`  ${q.padEnd(16)} ${String(preDist[q]).padEnd(6)} → ${postDist[q]}${changed}`);
    }
    console.log(`  ${"total".padEnd(16)} ${rows.length}`);
    console.log();

    // 3. Strategies that improved (PRE != POST quality)
    const improved = classified.filter((s) => s.preQuality !== s.quality);
    if (improved.length > 0) {
      console.log("─── Strategies upgraded by Pass H2 archetype inference ───────");
      for (const s of improved) {
        console.log(`  ${s.preQuality} → ${s.quality}  ${s.name}`);
        console.log(`    id:           ${s.id}`);
        console.log(`    entry_indicator: ${s.entryIndicator ?? "(none)"}`);
        console.log(`    kb_inferred added: [${s.kbInferredAdded.join(", ")}]`);
        console.log(`    merged factors:    [${s.factors.join(", ")}]`);
      }
      console.log();
    }

    // 4. Remaining thin/fallback_only after Pass H2
    const stillNeedWork = classified.filter((s) => s.quality !== "rich");
    if (stillNeedWork.length > 0) {
      console.log("─── Strategies still needing re-extraction after Pass H2 ─────");
      for (const s of stillNeedWork) {
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

    // 5. APPLY MODE: write audit rows + update config
    console.log("─── APPLY mode: writing audit rows and updating config JSONB ─");
    let auditWritten  = 0;
    let configUpdated = 0;
    let errors        = 0;
    let kbInferredUpgraded = 0;

    for (const s of classified) {
      try {
        // a. Write audit row (includes wave26_pass_h2 marker + kb_inferred_added list)
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
              factor_quality:      s.quality,
              factor_quality_pre:  s.preQuality,
              factor_sources:      s.sources,
              kb_inferred_added:   s.kbInferredAdded,
              backfill:            true,
              wave26_pass_h2:      true,
            })},
            'info',
            'system',
            NULL
          )
        `;
        auditWritten++;

        // b. Update config.entry_quality with merged factor list, sources, and quality.
        // When kb_inferred factors were added, also update confluence_factors and
        // factor_sources so the live config reflects the full merged state.
        if (s.kbInferredAdded.length > 0) {
          // Wave 26 Pass H Phase 1 (2026-05-26) — Fix 3 bare-string normalization:
          // Use `to_jsonb(text)` for the bare-string factor_quality stamp instead of
          // `JSON.stringify(...)::jsonb` (postgres-js auto-encodes the JS string at
          // the parameter boundary, then `JSON.stringify` adds a second encode →
          // JSONB string `"rich"` with literal quote characters). Arrays/objects still
          // use the `JSON.stringify(...)::jsonb` pattern because postgres-js does NOT
          // auto-encode non-string parameters.
          await sql`
            UPDATE strategies
            SET
              config = jsonb_set(
                jsonb_set(
                  jsonb_set(
                    config,
                    '{entry_quality,factor_quality}',
                    to_jsonb(${s.quality}::text),
                    true
                  ),
                  '{entry_quality,confluence_factors}',
                  ${JSON.stringify(s.factors)}::jsonb,
                  true
                ),
                '{entry_quality,factor_sources}',
                ${JSON.stringify(s.sources)}::jsonb,
                true
              ),
              updated_at = NOW()
            WHERE id = ${s.id}
          `;
          kbInferredUpgraded++;
        } else {
          // Minimal update: factor_quality only (no new factors added)
          await sql`
            UPDATE strategies
            SET
              config = jsonb_set(
                config,
                '{entry_quality,factor_quality}',
                to_jsonb(${s.quality}::text),
                true
              ),
              updated_at = NOW()
            WHERE id = ${s.id}
          `;
        }
        configUpdated++;

        process.stdout.write(s.kbInferredAdded.length > 0 ? "+" : ".");
      } catch (err: unknown) {
        errors++;
        console.error(
          `\n  ERROR on strategy ${s.id} (${s.name}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    console.log(`\n\n─── APPLY complete ───────────────────────────────────────────`);
    console.log(`  audit rows written:       ${auditWritten}`);
    console.log(`  config rows updated:      ${configUpdated}`);
    console.log(`  upgraded by kb_inferred:  ${kbInferredUpgraded}`);
    console.log(`  errors:                   ${errors}`);

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
