/**
 * Wave 26 Pass E (2026-05-25) — Single source of truth for Wave 25 institutional
 * defaults applied to every NEW graduated strategy + used to backfill existing.
 *
 * Before Pass E:
 *   Graduations emitted "Wave 23 default" config (Style C exits + risk-derived
 *   pyramid + preferred_regimes[]) but skipped Wave 25 Pass 1/2/7 institutional
 *   layers because those were opt-in. Every new graduation required operator to
 *   run wave25-pass1-weighted-opt-in.ts + wave25-pass7-adaptive-opt-in.ts
 *   separately. Most never got opted in.
 *
 * After Pass E:
 *   Every new graduation carries the full Wave 25 institutional surface by
 *   default — weighted scoring (Path C, 11-factor), 5-TF MTF hierarchy
 *   (daily/htf/itf/trigger), bias_timeframe + confirming_indicators (Wave 23H),
 *   adaptive exits (Wave 25 Pass 7), and multi-symbol fan-out for
 *   symbol-agnostic strategies.
 *
 * The opt-in scripts (wave25-pass1-weighted-opt-in.ts, wave25-pass7-adaptive-opt-in.ts)
 * remain useful for the pre-Wave-26 graduated strategies and as panic-revert
 * tools — they continue to work unchanged.
 */

// ─── Confluence score weights (11-factor canonical) ──────────────────────────
// Inlined from confluence-score.ts CODE_DEFAULTS to keep this module DB-free
// (confluence-score.ts transitively imports db/index.ts). The values are
// canonical per CLAUDE.md §2b — if confluence-score.ts changes them, update
// here AND the WAVE_25_CONFLUENCE_WEIGHTS_MATCH_SOURCE test below.
// Re-exported as a flat {factor → weight} map for the strategies.confluence_score_weights
// JSONB column. Sums to 1.00 — see CLAUDE.md §2b for the canonical table.

export const DEFAULT_CONFLUENCE_THRESHOLD = 0.72;

const CANONICAL_11_FACTOR_WEIGHTS: Record<string, number> = {
  market_structure_aligned:    0.20,
  liquidity_target_clear:      0.13,
  smt_confirmation:            0.10,
  vwap_alignment:              0.10,
  killzone_active:             0.08,
  delta_or_volume_signature:   0.08,
  vp_level_proximity:          0.08,
  macro_alignment:             0.08, // HARD BLOCK — enforced inside evaluator
  internals_aligned:           0.05,
  cross_asset_aligned:         0.05,
  regime_match:                0.05,
};
// sanity: 0.20+0.13+0.10+0.10+0.08+0.08+0.08+0.08+0.05+0.05+0.05 = 1.00

export function buildDefaultConfluenceWeights(): Record<string, number> {
  return { ...CANONICAL_11_FACTOR_WEIGHTS };
}

// ─── 5-TF MTF hierarchy (Wave 25 Pass 2 W25.4) ───────────────────────────────
// Per CLAUDE.md §2b: daily / HTF / ITF / setup (exec) / trigger.
// Strategy declares the exec timeframe; we derive the rest with sensible defaults
// matching the institutional convention.

export function inferMtfHierarchy(execTimeframe: string): {
  daily_tf: string;
  htf_tf: string;
  itf_tf: string;
  trigger_tf: string;
} {
  // Always 1d as the dealing-range/bias timeframe (Pass 2 invariant).
  const daily_tf = "1d";
  const tf = String(execTimeframe ?? "").toLowerCase().trim();

  // HTF / ITF / trigger derive from exec_tf — keep the hierarchy structurally
  // institutional (each lower tier is ~5-8x granularity finer than its parent).
  switch (tf) {
    case "1m":  return { daily_tf, htf_tf: "1h",  itf_tf: "15m", trigger_tf: "1m"  };
    case "5m":  return { daily_tf, htf_tf: "4h",  itf_tf: "1h",  trigger_tf: "5m"  };
    case "15m": return { daily_tf, htf_tf: "4h",  itf_tf: "1h",  trigger_tf: "5m"  };
    case "1h":  return { daily_tf, htf_tf: "1d",  itf_tf: "4h",  trigger_tf: "15m" };
    case "4h":  return { daily_tf, htf_tf: "1d",  itf_tf: "4h",  trigger_tf: "1h"  };
    default:    return { daily_tf, htf_tf: "4h",  itf_tf: "1h",  trigger_tf: tf || "5m" };
  }
}

// ─── Symbol-set inference (Wave 26 Pass E) ───────────────────────────────────
// The operator's mandate: pattern-based strategies (ORB / FVG / EMA-cross /
// VWAP / fib / structure / break-and-retest) work on ALL 3 futures — MES, MNQ,
// MCL — not just the bucket's routing market. Symbol-specific strategies
// (oil-only, nasdaq-only, S&P-only) get filtered to the matching symbol.
//
// Detection precedence (first match wins):
//   1. "oil" / "crude" / "wti" / "cl_" → MCL only
//   2. "nasdaq" / "ndx" / "ndq" / "_nq_" / "_nq " → MNQ only
//   3. "s_p" / "sp500" / "spx" / "_es_" / "_es " → MES only
//   4. Default → all 3 (MES, MNQ, MCL)
//
// `originalMarket` is the bucket's routing market — used as the canonical leader
// position in the multi-symbol array so the strategy_name still reflects the
// primary symbol per W23F.M.

const SYMBOL_AGNOSTIC_DEFAULT = ["MES", "MNQ", "MCL"] as const;

export function inferSymbolSet(
  _strategyName: string | null | undefined,
  conceptName: string | null | undefined,
  originalMarket: "MES" | "MNQ" | "MCL",
): string[] {
  // Detect on concept_name ONLY — strategy_name carries the W23F.M routing
  // suffix `_mes_5m` / `_mnq_15m` / `_mcl_1h` which would mis-classify every
  // strategy as symbol-specific. concept_name is the LLM-extracted concept
  // before the suffix is appended.
  const n = String(conceptName ?? "").toLowerCase();

  // Crude / oil / WTI specific. `_` is a word char in regex so use explicit
  // anchors instead of \b (which fails inside snake_case names).
  if (/(^|_|\s)(oil|crude|wti)(_|\s|$)/.test(n)) return ["MCL"];

  // Nasdaq specific
  if (/(^|_|\s)(nasdaq|ndx|ndq)(_|\s|$)/.test(n)) return ["MNQ"];

  // S&P specific
  if (/(^|_|\s)(s_p|sp500|spx|s&p)(_|\s|$)/.test(n)) return ["MES"];

  // Default — symbol-agnostic, fan out to all 3 with the bucket's routing
  // market in the leader slot to preserve W23F.M naming canonicalization.
  const set = new Set<string>([originalMarket, ...SYMBOL_AGNOSTIC_DEFAULT]);
  return Array.from(set);
}

// ─── Bias timeframe + confirming_indicators (Wave 23H W23F.B / W23F.D) ───────
// bias_timeframe maps to htf_tf when not LLM-extracted.
// confirming_indicators copies confluence_factors when the LLM left it empty
// (graduator-emitted confluence_factors are the rich vocabulary; the W23H
// confirming_indicators contract accepts the same factor names).

export function deriveBiasTimeframe(execTimeframe: string): string {
  const { htf_tf } = inferMtfHierarchy(execTimeframe);
  return htf_tf;
}

// ─── Exit plan config (Wave 25 Pass 7 W25.12) ────────────────────────────────
// Default to adaptive — Pass 7 wired LIVE in Wave 25.5. Operator can flip
// individual strategies back to static_styleC via exit_plan_config update.

export function buildDefaultExitPlanConfig(): {
  exit_style: "adaptive";
} {
  return { exit_style: "adaptive" };
}

// ─── Full strategy defaults bundle ───────────────────────────────────────────
// Single function that returns ALL Wave 25 columns + config sub-blocks for a
// new graduation OR backfill. Caller spreads into INSERT/UPDATE.

export interface Wave25DefaultsInput {
  strategyName: string;
  conceptName: string;
  execTimeframe: string;
  originalMarket: "MES" | "MNQ" | "MCL";
  confluenceFactors: string[];
}

export interface Wave25DefaultsOutput {
  // Top-level columns on strategies table
  symbols: string[];
  useWeightedScoring: true;
  confluenceScoreThreshold: number;
  confluenceScoreWeights: Record<string, number>;
  dailyTf: string;
  htfTf: string;
  itfTf: string;
  triggerTf: string;
  exitPlanConfig: { exit_style: "adaptive" };
  // config-JSONB additions
  configAdditions: {
    bias_timeframe: string;
    confirming_indicators: string[];
  };
}

export function applyWave25Defaults(input: Wave25DefaultsInput): Wave25DefaultsOutput {
  const mtf = inferMtfHierarchy(input.execTimeframe);
  const symbols = inferSymbolSet(input.strategyName, input.conceptName, input.originalMarket);
  // confirming_indicators starts from confluence_factors (Wave 23F.B vocabulary).
  // When the LLM emits richer confirming_indicators directly, the graduator's
  // existing logic for confirming_indicators overrides this default — only
  // empty/null confirming_indicators get backfilled from confluence_factors.
  const confirming_indicators = Array.isArray(input.confluenceFactors)
    ? input.confluenceFactors.filter((s) => typeof s === "string" && s.length > 0)
    : [];

  return {
    symbols,
    useWeightedScoring: true,
    confluenceScoreThreshold: DEFAULT_CONFLUENCE_THRESHOLD,
    confluenceScoreWeights: buildDefaultConfluenceWeights(),
    dailyTf: mtf.daily_tf,
    htfTf: mtf.htf_tf,
    itfTf: mtf.itf_tf,
    triggerTf: mtf.trigger_tf,
    exitPlanConfig: buildDefaultExitPlanConfig(),
    configAdditions: {
      bias_timeframe: mtf.htf_tf,
      confirming_indicators,
    },
  };
}
