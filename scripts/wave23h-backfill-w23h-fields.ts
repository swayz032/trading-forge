/**
 * Wave 23H Postmortem Backfill — populate W23H/W23G.11 fields on
 * already-graduated strategies whose configs predate fix 17.
 *
 * Strategy archetype → canonical W23H defaults (per CLAUDE.md §4 + Wave 23H spec):
 *   - All ICT archetypes (silver_bullet, power_of_3, turtle_soup/CRT, fvg_retrace,
 *     order_block, breaker, ote): 4H bias + 15M execution, ALL 3 regimes
 *   - Mean-reversion (vwap_fade, rsi2): RANGE_BOUND only
 *   - Trend (ema_crossover, breakout): TRENDING_UP + TRENDING_DOWN
 *
 * Idempotent: only updates strategies missing the fields.
 * Audit: writes `strategy.w23h_backfilled` row per update.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/wave23h-backfill-w23h-fields.ts          # dry-run
 *   npx tsx -r dotenv/config scripts/wave23h-backfill-w23h-fields.ts --apply  # mutate
 */
import { db } from "../src/server/db/index.js";
import { strategies, auditLog } from "../src/server/db/schema.js";
import { eq, sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

interface W23HFields {
  bias_timeframe: string | null;
  bias_condition: string | null;
  execution_timeframe: string | null;
  primary_indicator: string | null;
  confirming_indicators: Array<{ indicator: string; params: Record<string, unknown>; direction: string }> | null;
  min_factors_satisfied: number | null;
  preferred_regimes: string[];
  confluence_factors: string[];
}

function deriveW23HFromArchetype(name: string, entryIndicator: string): W23HFields {
  const ind = (entryIndicator || "").toLowerCase();
  const n = (name || "").toLowerCase();

  // ICT silver bullet — NY AM session, 4H+15M, displacement+FVG confluence
  if (ind.includes("silver_bullet") || n.includes("silver_bullet") || n.includes("silver-bullet")) {
    return {
      bias_timeframe: "4h",
      bias_condition: "NY AM (10:00-11:00 ET) silver-bullet window; bias from 4H structure (last 4H candle high/low/body)",
      execution_timeframe: "15m",
      primary_indicator: "archetype:ict_silver_bullet",
      confirming_indicators: [
        { indicator: "displacement", params: {}, direction: "agree" },
        { indicator: "fvg", params: {}, direction: "agree" },
      ],
      min_factors_satisfied: 2,
      preferred_regimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"],
      confluence_factors: ["structural_setup"],
    };
  }

  // ICT Power-of-3 — Accumulation/Manipulation/Expansion structure
  if (ind.includes("power_of_3") || ind.includes("power_of_three") || n.includes("power_of_3") || n.includes("power_of_three")) {
    return {
      bias_timeframe: "4h",
      bias_condition: "4H Power-of-3 structure (Accumulation → Manipulation/Judas → Expansion); bias from 4H candle body direction post-manipulation",
      execution_timeframe: "15m",
      primary_indicator: "archetype:ict_power_of_3",
      confirming_indicators: [
        { indicator: "judas_swing", params: {}, direction: "agree" },
        { indicator: "displacement", params: {}, direction: "agree" },
      ],
      min_factors_satisfied: 3,
      preferred_regimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"],
      confluence_factors: ["structural_setup"],
    };
  }

  // CRT (Candle Range Theory) / Turtle Soup — 4H candle range + intraday execution
  if (ind.includes("turtle_soup") || ind.includes("crt") || n.includes("crt") || n.includes("turtle_soup")) {
    return {
      bias_timeframe: "4h",
      bias_condition: "4H candle range defined (high/low/body marked); intraday entries on liquidity sweep of prior 4H extreme then return inside range",
      execution_timeframe: "15m",
      primary_indicator: "archetype:ict_turtle_soup",
      confirming_indicators: [
        { indicator: "liquidity_sweep", params: {}, direction: "agree" },
      ],
      min_factors_satisfied: 2,
      preferred_regimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"],
      confluence_factors: ["structural_setup"],
    };
  }

  // FVG retrace — Fair Value Gap, 4H bias + 15M/1M execution
  if (ind.includes("fvg") || n.includes("fvg")) {
    return {
      bias_timeframe: "4h",
      bias_condition: "4H structural bias; entry on price returning to mitigate prior FVG with rejection",
      execution_timeframe: "15m",
      primary_indicator: "archetype:fvg_retrace",
      confirming_indicators: [
        { indicator: "displacement", params: {}, direction: "agree" },
      ],
      min_factors_satisfied: 2,
      preferred_regimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"],
      confluence_factors: ["structural_setup"],
    };
  }

  // Order block — institutional supply/demand zone retest
  if (ind.includes("order_block") || ind.includes("supply") || ind.includes("demand") || n.includes("order_block")) {
    return {
      bias_timeframe: "4h",
      bias_condition: "4H structural bias; entry on price returning to last opposing order block with rejection",
      execution_timeframe: "15m",
      primary_indicator: "archetype:order_block",
      confirming_indicators: [
        { indicator: "rejection_wick", params: {}, direction: "agree" },
      ],
      min_factors_satisfied: 2,
      preferred_regimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"],
      confluence_factors: ["structural_setup"],
    };
  }

  // Default for unknown archetypes — conservative, single TF
  return {
    bias_timeframe: null,
    bias_condition: null,
    execution_timeframe: null,
    primary_indicator: null,
    confirming_indicators: null,
    min_factors_satisfied: null,
    preferred_regimes: ["TRENDING_UP", "TRENDING_DOWN"],
    confluence_factors: [],
  };
}

async function main() {
  console.log("=== Wave 23H W23H-fields backfill ===");
  console.log("Mode:", APPLY ? "APPLY (will mutate)" : "DRY-RUN");
  console.log();

  // Find strategies whose config is missing one or more W23H fields
  const rows = await db.execute(sql`
    SELECT id, name, lifecycle_state, config, created_at
    FROM strategies
    WHERE lifecycle_state NOT IN ('ARCHIVED', 'KILLED')
    ORDER BY created_at DESC
  `) as unknown as Array<{ id: string; name: string; lifecycle_state: string; config: Record<string, unknown>; created_at: Date }>;

  console.log(`Scanned ${rows.length} strategies`);

  let needsBackfill = 0;
  let updated = 0;
  const W23H_KEYS = ["bias_timeframe", "bias_condition", "execution_timeframe", "primary_indicator", "confirming_indicators", "preferred_regimes"];

  for (const row of rows) {
    const cfg = (row.config ?? {}) as Record<string, unknown>;
    const eq_ = (cfg.entry_quality ?? {}) as Record<string, unknown>;

    const missing = W23H_KEYS.filter((k) => {
      const inCfg = k in cfg && cfg[k] !== undefined;
      const inEq = k in eq_ && eq_[k] !== undefined;
      return !inCfg && !inEq;
    });

    if (missing.length === 0) continue;
    needsBackfill++;

    const entryIndicator = String(cfg.entry_indicator ?? eq_.entry_indicator ?? "");
    const derived = deriveW23HFromArchetype(row.name, entryIndicator);

    console.log(`[${row.lifecycle_state}] ${row.name}`);
    console.log(`  entry: ${entryIndicator}  missing: ${missing.join(",")}`);
    console.log(`  → bias_tf=${derived.bias_timeframe}  exec_tf=${derived.execution_timeframe}  regimes=${derived.preferred_regimes.join(",")}  confirming=${derived.confirming_indicators?.length ?? 0}`);

    if (!APPLY) continue;

    // Patch config: write W23H fields at top level + mirror into entry_quality block
    const newCfg = {
      ...cfg,
      bias_timeframe: derived.bias_timeframe,
      bias_condition: derived.bias_condition,
      execution_timeframe: derived.execution_timeframe,
      primary_indicator: derived.primary_indicator,
      confirming_indicators: derived.confirming_indicators,
      min_factors_satisfied: derived.min_factors_satisfied ?? cfg.min_factors_satisfied,
      preferred_regimes: derived.preferred_regimes,
      entry_quality: {
        ...eq_,
        bias_timeframe: derived.bias_timeframe,
        bias_condition: derived.bias_condition,
        execution_timeframe: derived.execution_timeframe,
        primary_indicator: derived.primary_indicator,
        confirming_indicators: derived.confirming_indicators,
        min_factors_satisfied: derived.min_factors_satisfied ?? eq_.min_factors_satisfied,
        preferred_regimes: derived.preferred_regimes,
        confluence_factors: Array.isArray(eq_.confluence_factors)
          ? Array.from(new Set([...(eq_.confluence_factors as string[]), ...derived.confluence_factors]))
          : derived.confluence_factors,
      },
    };

    await db.update(strategies).set({ config: newCfg as never }).where(eq(strategies.id, row.id));
    await db.insert(auditLog).values({
      action: "strategy.w23h_backfilled",
      entityType: "strategy",
      entityId: row.id,
      decisionAuthority: "system",
      status: "success",
      result: {
        name: row.name,
        missing_fields_before: missing,
        applied: {
          bias_timeframe: derived.bias_timeframe,
          bias_condition: derived.bias_condition,
          execution_timeframe: derived.execution_timeframe,
          primary_indicator: derived.primary_indicator,
          confirming_indicators_count: derived.confirming_indicators?.length ?? 0,
          preferred_regimes: derived.preferred_regimes,
          source: "archetype_derived",
          fix_ref: "wave23h-postmortem-fix17+18",
        },
      },
    });

    updated++;
  }

  console.log();
  console.log("=== Summary ===");
  console.log(`Strategies needing backfill: ${needsBackfill}`);
  console.log(`Updated: ${updated}${APPLY ? "" : " (dry-run — pass --apply to mutate)"}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
