/**
 * Library Diversity Service — Track 5 Phase D Readiness
 *
 * Computes the distribution of strategies by school and lifecycle stage.
 * Used by LibraryDiversityPanel and the GET /api/library-diversity route.
 *
 * Schools map entry_indicator values from kb/indicator-catalog.md categories:
 *   ICT_HANDCODED   — any of the 19 hand-coded ICT primitives
 *   TREND           — EMA/SMA crossover, ADX, Keltner, ATR breakout
 *   MEAN_REVERSION  — VWAP, RSI, Bollinger Band fade
 *   VOLATILITY      — ATR expansion, squeeze, VIX-relative
 *   VOLUME_ORDER_FLOW — CVD, order block, imbalance, VWAP volume
 *   SESSION_TIME    — ORB, London open, overnight drift, time-of-day
 *   EVENT_DRIVEN    — news fade, EIA, FOMC reaction
 *
 * No behavioral change. Pure read from strategies table.
 */

import { db } from "../db/index.js";
import { strategies } from "../db/schema.js";
import { logger } from "../index.js";

export type School =
  | "ICT_HANDCODED"
  | "TREND"
  | "MEAN_REVERSION"
  | "VOLATILITY"
  | "VOLUME_ORDER_FLOW"
  | "SESSION_TIME"
  | "EVENT_DRIVEN"
  | "UNKNOWN";

export type LifecycleStage =
  | "CANDIDATE"
  | "TESTING"
  | "PAPER"
  | "DEPLOY_READY"
  | "PILOT"
  | "DEPLOYED"
  | "DECLINING"
  | "RETIRED"
  | "GRAVEYARD";

export interface LibraryDiversity {
  byStage: Partial<Record<LifecycleStage, Partial<Record<School, number>>>>;
  total: Partial<Record<School, number>>;
  /** ICT_HANDCODED share of DEPLOYED strategies (0–1). Should drop over time. */
  ictPct: number;
}

/**
 * ICT primitives from indicator-catalog.md (19 hand-coded patterns).
 * Matched against entry_indicator values case-insensitively.
 */
const ICT_INDICATORS = new Set([
  "order_block",
  "breaker_block",
  "fvg",
  "fair_value_gap",
  "bos",
  "choch",
  "liquidity_sweep",
  "sweep_reversal",
  "optimal_trade_entry",
  "ote",
  "power_of_3",
  "judas_swing",
  "london_raid",
  "silver_bullet",
  "ict_swing",
  "quarterly_swing",
  "mitigation",
  "eqhl_raid",
  "midnight_open",
]);

const TREND_INDICATORS = new Set([
  "ema_crossover",
  "sma_crossover",
  "adx_trend",
  "keltner_squeeze",
  "atr_breakout",
  "propulsion",
  "trend_continuation",
  "macd_crossover",
  "parabolic_sar",
]);

const MEAN_REVERSION_INDICATORS = new Set([
  "vwap_reversion",
  "vwap_fade",
  "rsi_reversal",
  "bollinger_band_fade",
  "ny_lunch_reversal",
  "mean_reversion",
  "anchored_vwap_retest",
]);

const VOLATILITY_INDICATORS = new Set([
  "atr_expansion",
  "keltner_breakout",
  "volatility_squeeze",
  "bb_squeeze",
  "vix_spike",
  "vol_expansion",
]);

const VOLUME_ORDER_FLOW_INDICATORS = new Set([
  "cvd_divergence",
  "absorption",
  "delta_exhaustion",
  "volume_imbalance",
  "vpoc_retest",
  "vah_rejection",
  "val_support",
  "volume_profile",
  "order_flow",
  "synthetic_cvd",
]);

const SESSION_TIME_INDICATORS = new Set([
  "iofed",
  "ict_scalp",
  "opening_range_breakout",
  "orb",
  "london_open",
  "overnight_drift",
  "session_open",
  "asia_range",
  "ny_open",
]);

const EVENT_DRIVEN_INDICATORS = new Set([
  "event_driven",
  "event_driven_fade",
  "news_fade",
  "eia_reaction",
  "fomc_fade",
  "cpi_reaction",
]);

function classifySchool(entryIndicator: string | null | undefined): School {
  if (!entryIndicator) return "UNKNOWN";
  const lower = entryIndicator.toLowerCase().replace(/-/g, "_");

  if (ICT_INDICATORS.has(lower)) return "ICT_HANDCODED";
  if (TREND_INDICATORS.has(lower)) return "TREND";
  if (MEAN_REVERSION_INDICATORS.has(lower)) return "MEAN_REVERSION";
  if (VOLATILITY_INDICATORS.has(lower)) return "VOLATILITY";
  if (VOLUME_ORDER_FLOW_INDICATORS.has(lower)) return "VOLUME_ORDER_FLOW";
  if (SESSION_TIME_INDICATORS.has(lower)) return "SESSION_TIME";
  if (EVENT_DRIVEN_INDICATORS.has(lower)) return "EVENT_DRIVEN";

  // Fuzzy fallback: substring matching for compound names
  if (
    lower.includes("order_block") ||
    lower.includes("fvg") ||
    lower.includes("breaker") ||
    lower.includes("ote") ||
    lower.includes("ict")
  )
    return "ICT_HANDCODED";

  if (lower.includes("ema") || lower.includes("sma") || lower.includes("trend"))
    return "TREND";

  if (lower.includes("vwap") || lower.includes("reversion") || lower.includes("mean"))
    return "MEAN_REVERSION";

  if (lower.includes("vol") || lower.includes("atr") || lower.includes("squeeze"))
    return "VOLATILITY";

  if (lower.includes("volume") || lower.includes("cvd") || lower.includes("delta"))
    return "VOLUME_ORDER_FLOW";

  if (lower.includes("session") || lower.includes("orb") || lower.includes("london"))
    return "SESSION_TIME";

  if (lower.includes("news") || lower.includes("event") || lower.includes("fomc"))
    return "EVENT_DRIVEN";

  return "UNKNOWN";
}

function increment<K extends string>(map: Partial<Record<K, number>>, key: K): void {
  map[key] = (map[key] ?? 0) + 1;
}

/**
 * Compute library diversity across all strategies in the DB.
 *
 * Fail-open on DB error: returns empty distribution with ictPct=0.
 */
export async function computeLibraryDiversity(): Promise<LibraryDiversity> {
  try {
    const rows = await db.select({
      lifecycleState: strategies.lifecycleState,
      config: strategies.config,
    }).from(strategies);

    const byStage: Partial<Record<LifecycleStage, Partial<Record<School, number>>>> = {};
    const total: Partial<Record<School, number>> = {};

    for (const row of rows) {
      const stage = row.lifecycleState as LifecycleStage;
      // entry_indicator lives in config JSONB
      const cfg = row.config as Record<string, unknown> | null;
      const entryIndicator = typeof cfg?.entry_indicator === "string"
        ? cfg.entry_indicator
        : typeof cfg?.entryIndicator === "string"
          ? cfg.entryIndicator
          : null;

      const school = classifySchool(entryIndicator);

      // byStage accumulation
      if (!byStage[stage]) byStage[stage] = {};
      increment(byStage[stage]!, school);

      // total accumulation
      increment(total, school);
    }

    // ICT share of DEPLOYED strategies
    const deployedBucket = byStage["DEPLOYED"] ?? {};
    const deployedTotal = Object.values(deployedBucket).reduce((s, n) => s + (n ?? 0), 0);
    const ictDeployed = deployedBucket["ICT_HANDCODED"] ?? 0;
    const ictPct = deployedTotal > 0 ? ictDeployed / deployedTotal : 0;

    return { byStage, total, ictPct };
  } catch (err) {
    logger.error({ err }, "library-diversity-service: failed to compute diversity");
    return { byStage: {}, total: {}, ictPct: 0 };
  }
}

/** Exported for tests — maps an entry_indicator string to its school. */
export { classifySchool };
