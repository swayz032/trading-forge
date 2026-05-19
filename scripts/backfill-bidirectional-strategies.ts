/**
 * W23G.12 — Backfill single-direction strategies to bidirectional.
 *
 * Identifies all graduated_bucket strategies where config.direction is 'long'
 * or 'short' AND the entry_indicator (or archetype) is in the symmetric set.
 * Promotes them to direction='both' and sets config.mirror_inferred=true.
 *
 * Idempotent: rows already at direction='both' are skipped.
 * Asymmetric strategies (connors_rsi2, raschke_holy_grail) are never touched.
 *
 * Usage:
 *   npx tsx scripts/backfill-bidirectional-strategies.ts            # dry-run (default)
 *   npx tsx scripts/backfill-bidirectional-strategies.ts --apply    # write to DB
 *
 * Flags:
 *   --dry-run   (default) Report what WOULD change. No DB writes.
 *   --apply     Persist changes. Requires DATABASE_URL to be set.
 */
import "dotenv/config";
import postgres from "postgres";
import { compileDslToEngine } from "../src/server/lib/dsl-compiler.js";

// ─── Symmetric archetype set (W23G.12 + CLAUDE.md §2b + b93aa61 research) ───
//
// These indicators/archetypes have a documented bidirectional formulation.
// Sources: phase21-part6 commit message, CLAUDE.md §2b pinned facts, operator
// research (innercircletrader, wyckoffanalytics, admiralmarkets, QuantVPS, etc.)
//
// Policy: if entry_indicator is in this set → safe to promote to 'both'.
// The compiler already produces both entry_long and entry_short grammar for all
// of these (verified in dsl-compiler.ts:70-210).
export const SYMMETRIC_INDICATORS = new Set<string>([
  // Crossovers (bidirectional by textbook definition)
  "ema_crossover",
  "sma_crossover",
  "dema_crossover",
  "macd_crossover",
  // Breakouts (upper = long, lower = short)
  "atr_breakout",
  "atr_trailing_stop",
  "bollinger_breakout",
  "donchian_breakout",
  // Momentum oscillators (oversold = long, overbought = short)
  "rsi_reversal",
  "rsi_divergence",
  // Mean reversion (above = fade short, below = fade long)
  "mean_reversion",
  "vwap_fade",
  "vwap_reversion",
  "session_open_breakout",     // ORB: above OR high = long, below OR low = short
  // Trend-following (trend up = long, trend down = short)
  "supertrend",
  "ichimoku",
  "ichimoku_cloud",
  "cumulative_delta",
  // SMC / ICT structural concepts (SSL sweep = long, BSL sweep = short)
  "liquidity_sweep",
  "order_block",
  "fvg",
  "fvg_retrace",
  "breaker_block",
  "ict_breaker",
  "ict_silver_bullet_ny_am",
  "judas_swing",
  // Wyckoff (Spring = accumulation long, Upthrust/UTAD = distribution short)
  "wyckoff_spring",
  "wyckoff_upthrust",
]);

// Symmetric archetype names (prefix stripped from archetype:xxx)
export const SYMMETRIC_ARCHETYPES = new Set<string>([
  "liquidity_sweep",
  "order_block",
  "fvg",
  "fvg_retrace",
  "wyckoff_spring",
  "wyckoff_upthrust",
  "judas_swing",
  "silver_bullet",
  "ict_silver_bullet_ny_am",
  "breaker_block",
  "ict_breaker",
  // Crossover / breakout archetypes
  "ema_crossover",
  "bollinger_breakout",
  "opening_range_breakout",
  "mean_reversion",
  "vwap_reversion",
  "supertrend",
  "cumulative_delta",
]);

// Hard-asymmetric indicators that must NEVER be promoted.
// These are one-sided by academic/author specification.
export const ASYMMETRIC_INDICATORS = new Set<string>([
  "connors_rsi2",         // Larry Connors mean-reversion long-only spec
  "raschke_holy_grail",   // Linda Raschke: "buy the pullback in a trend" — long-only
]);

// Name-fragment patterns that identify asymmetric strategies regardless of
// which indicator they compiled to. These authors wrote long-only strategies
// and we must not silently override that.
//
// Checked against strategy NAME (substring match, case-insensitive).
const ASYMMETRIC_NAME_FRAGMENTS: RegExp[] = [
  /connors_rsi/i,           // All Connors RSI(2) strategies
  /raschke/i,               // Linda Raschke Holy Grail variants
  /holy_grail/i,            // Holy Grail name (generic catch for other holy_grail strategies)
  /rsi_2_larry/i,           // Connors RSI 2 by name
  /rsi_2_explained/i,       // Connors RSI 2 explanation strategies
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the archetype name from "archetype:wyckoff_spring" → "wyckoff_spring" */
function archetypeNameFrom(indicator: string): string | null {
  if (indicator.startsWith("archetype:")) {
    return indicator.slice("archetype:".length).toLowerCase().trim();
  }
  return null;
}

/**
 * Returns true if this indicator/archetype is in the symmetric set.
 * Returns false for hard-asymmetric. Returns null for unknown (warn + skip).
 */
export function classifyIndicator(
  indicator: string,
): "symmetric" | "asymmetric" | "unknown" {
  const normalized = indicator.toLowerCase().trim();

  // Check hard-asymmetric first (highest priority — never override)
  if (ASYMMETRIC_INDICATORS.has(normalized)) return "asymmetric";

  // Check archetype prefix
  const archName = archetypeNameFrom(normalized);
  if (archName !== null) {
    if (SYMMETRIC_ARCHETYPES.has(archName)) return "symmetric";
    if (ASYMMETRIC_INDICATORS.has(archName)) return "asymmetric";
    return "unknown";
  }

  // Direct indicator name
  if (SYMMETRIC_INDICATORS.has(normalized)) return "symmetric";

  return "unknown";
}

// ─── Core promotion logic ─────────────────────────────────────────────────────

export interface BackfillRow {
  id: string;
  name: string;
  config: Record<string, unknown>;
}

export interface BackfillResult {
  id: string;
  name: string;
  outcome: "promoted" | "skipped_already_both" | "skipped_asymmetric" | "skipped_unknown" | "error";
  prior_direction?: string;
  archetype?: string;
  entry_short_grammar?: string;
  error?: string;
}

/**
 * Compute the promotion patch for a single strategy row.
 * Does NOT write to DB — returns the new config or a skip reason.
 *
 * This is the pure-function core used by both dry-run and apply modes,
 * and directly by the test suite (no DB required).
 *
 * Entry indicator resolution priority:
 *   1. config.entry_indicator (top-level, set by newer graduator builds)
 *   2. config.strategy.indicators[0].type (set by all builds — the DSL compiler
 *      always writes this; older strategies omit the top-level shortcut)
 */
export function computePromotion(row: BackfillRow): BackfillResult {
  const config = row.config;
  const direction = String((config as any).direction ?? "");

  // Resolve entry indicator — top-level field (newer) or indicators[0].type (all builds)
  const topLevelIndicator = String((config as any).entry_indicator ?? "").trim();
  const indicators = (config as any).strategy?.indicators;
  const ind0Type = Array.isArray(indicators) && indicators.length > 0
    ? String(indicators[0].type ?? "").trim()
    : "";
  const entryIndicator = topLevelIndicator || ind0Type;

  // Already bidirectional — idempotent skip
  if (direction === "both") {
    return { id: row.id, name: row.name, outcome: "skipped_already_both" };
  }

  // Only process single-direction strategies
  if (direction !== "long" && direction !== "short") {
    return {
      id: row.id,
      name: row.name,
      outcome: "skipped_unknown",
      error: `Unexpected direction value: ${JSON.stringify(direction)}`,
    };
  }

  // Name-based asymmetric guard (checked BEFORE indicator classification).
  // Strategies authored by Connors or Raschke are long-only by spec, regardless
  // of which indicator they compiled to (typically rsi_reversal or ema_crossover).
  const nameIsAsymmetric = ASYMMETRIC_NAME_FRAGMENTS.some((re) => re.test(row.name));
  if (nameIsAsymmetric) {
    return {
      id: row.id,
      name: row.name,
      outcome: "skipped_asymmetric",
      prior_direction: direction,
      archetype: entryIndicator || "(name-matched)",
      error: `Strategy name '${row.name}' matched asymmetric author pattern — long-only by spec`,
    };
  }

  const classification = classifyIndicator(entryIndicator);

  if (classification === "asymmetric") {
    return {
      id: row.id,
      name: row.name,
      outcome: "skipped_asymmetric",
      prior_direction: direction,
      archetype: entryIndicator,
    };
  }

  if (classification === "unknown") {
    return {
      id: row.id,
      name: row.name,
      outcome: "skipped_unknown",
      prior_direction: direction,
      archetype: entryIndicator,
      error: `entry_indicator '${entryIndicator}' not in symmetric or asymmetric set — manual review required`,
    };
  }

  // classification === 'symmetric' — recompile with direction='both'
  //
  // entry_params resolution: prefer top-level config.entry_params (newer builds);
  // fall back to the first indicator's object minus the 'type' key (older builds
  // stored params directly in indicators[0]).
  const topLevelParams = (config as any).entry_params;
  let entryParams: Record<string, unknown>;
  if (topLevelParams && typeof topLevelParams === "object" && Object.keys(topLevelParams).length > 0) {
    entryParams = topLevelParams;
  } else if (ind0Type && Array.isArray(indicators) && indicators.length > 0) {
    // Strip 'type' key — remaining keys are the entry params (period, range_minutes, etc.)
    const { type: _type, ...rest } = indicators[0];
    entryParams = rest;
  } else {
    entryParams = {};
  }
  const compiled = compileDslToEngine({
    entry_indicator: entryIndicator,
    entry_params: entryParams,
    direction: "both",
  });

  // compileDslToEngine returns null for two cases:
  //   1. archetype:xxx indicators — structural sentinels, engine handles them via class
  //   2. parametric indicators not yet supported by the compiler
  //
  // For case 1 (archetype: prefix OR indicator is in SYMMETRIC_INDICATORS but has
  // no parametric handler, e.g. wyckoff_spring / order_block stored without prefix):
  // allow promotion with the structural sentinel "high < low" — the engine's archetype
  // handler will generate actual signals from market structure.
  //
  // For case 2 (genuinely unknown indicator returning null), skip.
  const isStructuralEntry = entryIndicator.startsWith("archetype:") ||
    SYMMETRIC_INDICATORS.has(entryIndicator.toLowerCase().trim());

  if (compiled === null && !isStructuralEntry) {
    return {
      id: row.id,
      name: row.name,
      outcome: "skipped_unknown",
      prior_direction: direction,
      archetype: entryIndicator,
      error: `compileDslToEngine returned null for indicator '${entryIndicator}' — unsupported pattern`,
    };
  }

  // When compiled is null for a structural entry, use the structural sentinel.
  // The archetype engine reads entry_short at runtime and overrides it anyway.
  const newEntryShort = compiled?.entry_short ?? "high < low";

  return {
    id: row.id,
    name: row.name,
    outcome: "promoted",
    prior_direction: direction,
    archetype: entryIndicator,
    entry_short_grammar: newEntryShort,
  };
}

/**
 * Build the updated config object for a promotion.
 * Called after computePromotion() returns outcome='promoted'.
 */
export function buildPromotedConfig(
  originalConfig: Record<string, unknown>,
  newEntryShort: string,
): Record<string, unknown> {
  const strategy = (originalConfig.strategy ?? {}) as Record<string, unknown>;
  return {
    ...originalConfig,
    direction: "both",
    mirror_inferred: true,
    strategy: {
      ...strategy,
      entry_short: newEntryShort,
    },
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const applyMode = process.argv.includes("--apply");
  const dryRun = !applyMode;

  if (dryRun) {
    console.log("=== BACKFILL BIDIRECTIONAL STRATEGIES — DRY-RUN MODE ===");
    console.log("(Pass --apply to write changes to DB)\n");
  } else {
    console.log("=== BACKFILL BIDIRECTIONAL STRATEGIES — APPLY MODE ===");
    console.log("Writing changes to DB...\n");
  }

  const sql = postgres(process.env.DATABASE_URL!);

  let rows: Array<{ id: string; name: string; config: any }>;
  try {
    rows = await sql<Array<{ id: string; name: string; config: any }>>`
      SELECT id::text, name, config
      FROM strategies
      WHERE source = 'graduated_bucket'
        AND config->>'direction' IN ('long', 'short')
      ORDER BY created_at ASC
    `;
  } catch (err) {
    console.error("Failed to query strategies:", err);
    await sql.end();
    process.exit(1);
  }

  console.log(`Found ${rows.length} single-direction graduated strategies to evaluate.\n`);

  const results: BackfillResult[] = [];
  let promotedCount = 0;
  let skippedAlreadyBoth = 0;
  let skippedAsymmetric = 0;
  let skippedUnknown = 0;
  let errorCount = 0;

  for (const row of rows) {
    const result = computePromotion(row);
    results.push(result);

    switch (result.outcome) {
      case "promoted": {
        promotedCount++;
        const newConfig = buildPromotedConfig(row.config, result.entry_short_grammar!);

        if (!dryRun) {
          try {
            // Write updated config
            await sql`
              UPDATE strategies
              SET config = ${sql.json(newConfig as any)},
                  updated_at = NOW()
              WHERE id = ${row.id}
            `;

            // Emit audit_log row per backfill action
            await sql`
              INSERT INTO audit_log (action, entity_type, entity_id, input, result, status, decision_authority)
              VALUES (
                'strategy.bidirectional_backfilled',
                'strategy',
                ${row.id},
                ${sql.json({
                  strategy_id: row.id,
                  name: row.name,
                  prior_direction: result.prior_direction,
                  archetype: result.archetype,
                })},
                ${sql.json({
                  strategy_id: row.id,
                  name: row.name,
                  prior_direction: result.prior_direction,
                  archetype: result.archetype,
                  entry_short_grammar: result.entry_short_grammar,
                  mirror_inferred: true,
                })},
                'success',
                'operator'
              )
            `;
            console.log(`  [PROMOTED] ${row.name}`);
            console.log(`    prior_direction : ${result.prior_direction}`);
            console.log(`    entry_indicator : ${result.archetype}`);
            console.log(`    entry_short     : ${result.entry_short_grammar}`);
          } catch (writeErr) {
            errorCount++;
            console.error(`  [ERROR] ${row.name}: ${writeErr}`);
            result.outcome = "error";
            result.error = String(writeErr);
          }
        } else {
          console.log(`  [WOULD PROMOTE] ${row.name}`);
          console.log(`    prior_direction : ${result.prior_direction}`);
          console.log(`    entry_indicator : ${result.archetype}`);
          console.log(`    entry_short     : ${result.entry_short_grammar}`);
        }
        break;
      }

      case "skipped_already_both":
        skippedAlreadyBoth++;
        // Quiet — not expected in this query (we filter for long/short), but guard
        console.log(`  [SKIP already-both] ${row.name}`);
        break;

      case "skipped_asymmetric":
        skippedAsymmetric++;
        console.log(`  [SKIP asymmetric] ${row.name}  (${result.archetype})`);
        break;

      case "skipped_unknown":
        skippedUnknown++;
        console.log(`  [SKIP unknown — manual review] ${row.name}`);
        console.log(`    reason: ${result.error}`);
        break;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Total single-direction strategies evaluated : ${rows.length}`);
  console.log(`Promoted (or would-promote) to 'both'      : ${promotedCount}`);
  console.log(`Skipped (already direction='both')          : ${skippedAlreadyBoth}`);
  console.log(`Skipped (asymmetric — do not promote)       : ${skippedAsymmetric}`);
  console.log(`Skipped (unknown — manual review needed)    : ${skippedUnknown}`);
  if (!dryRun) {
    console.log(`Errors during DB write                      : ${errorCount}`);
  }

  if (dryRun) {
    console.log("\n[DRY-RUN] No changes written. Pass --apply to execute.\n");
  }

  await sql.end();

  // Exit 0 only if all DB writes succeeded (apply mode) or dry-run (always OK)
  const failed = !dryRun && errorCount > 0;
  if (failed) {
    console.error(`\n[ERROR] ${errorCount} write(s) failed — check output above.`);
    process.exit(1);
  }
  process.exit(0);
}

main();
