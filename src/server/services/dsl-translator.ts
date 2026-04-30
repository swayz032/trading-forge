import { logger } from "../lib/logger.js";

/**
 * Translates a DSL strategy config into paper-trading-compatible rules.
 * DSL format: { entry_type, entry_indicator, entry_params, exit_type, exit_params, ... }
 * Paper format: { entry_rules: string[], exit_rules: string[], side, stop_loss, ... }
 */

interface DSLConfig {
  schema_version?: string;
  name?: string;
  symbol?: string;
  timeframe?: string;
  direction?: string;
  entry_type?: string;
  entry_indicator?: string;
  entry_params?: Record<string, any>;
  entry_condition?: string;
  exit_type?: string;
  exit_params?: Record<string, any>;
  stop_loss_atr_multiple?: number;
  take_profit_atr_multiple?: number;
  max_contracts?: number;
  preferred_regime?: string;
  session_filter?: string;
  // W5b Tier 5.1 — optional explicit trail config block. When present,
  // takes precedence over fields in `exit_params`. Schema-side this is
  // not yet a first-class StrategyDSL field — current archetype fixtures
  // place these fields inside `exit_params`. Translator honors both so
  // future schema additions can move them into a dedicated block without
  // changing the consumer contract.
  trail_config?: {
    atr_multiple?: number;
    atr_period?: number;
    break_even_at_r?: number;
    time_decay_minutes?: number;
    time_decay_multiplier?: number;
  };
}

// W5b Tier 5.1 — TrailStopConfig in paper-signal-service.ts ships with three
// optional fields beyond the classic { type, multiplier } pair. Mirror those
// here so the translator no longer drops them silently.
interface TrailStopOutput {
  type: string;
  multiplier: number;
  atr_period?: number;
  break_even_at_r?: number;
  time_decay_minutes?: number;
  time_decay_multiplier?: number;
}

interface PaperTradingConfig {
  entry_rules: string[];
  exit_rules: string[];
  side: "long" | "short" | "both";
  contracts: number;
  stop_loss?: { type: string; multiplier: number };
  trail_stop?: TrailStopOutput;
  max_hold_bars?: number;
  preferred_sessions?: string[];
  indicators?: Record<string, unknown>;
}

// Map DSL entry_indicator to rule strings
const INDICATOR_RULE_MAP: Record<string, (params: Record<string, any>) => string[]> = {
  sma_crossover: (p) => [`close > sma_${p.fast_period || 10}`, `sma_${p.fast_period || 10} > sma_${p.slow_period || 20}`],
  ema_crossover: (p) => [`close > ema_${p.fast_period || 10}`, `ema_${p.fast_period || 10} > ema_${p.slow_period || 20}`],
  rsi_reversal: (p) => [`rsi_${p.period || 14} < ${p.oversold || 30}`],
  rsi_overbought: (p) => [`rsi_${p.period || 14} > ${p.overbought || 70}`],
  atr_breakout: (p) => [`close > sma_${p.period || 20} + atr_${p.period || 20} * ${p.multiplier || 1.5}`],
  bollinger_squeeze: (p) => [`close > bb_upper_${p.period || 20}`],
  macd_crossover: (_p) => [`macd_line > macd_signal`],
  vwap_reversion: (p) => [`close < vwap * ${1 - (p.deviation || 0.01)}`],
  volume_breakout: (p) => [`volume > sma_volume_${p.period || 20} * ${p.multiplier || 2.0}`],
};

// Map DSL exit_type to exit rules
const EXIT_RULE_MAP: Record<string, (params: Record<string, any>) => string[]> = {
  fixed_target: (p) => [`unrealized_pnl >= ${p.target || 500}`],
  trailing_stop: (_p) => [`trailing_stop_hit`],
  time_exit: (p) => [`bars_held >= ${p.max_bars || 20}`],
  indicator_signal: (_p) => [`exit_signal_triggered`],
  atr_multiple: (p) => [`unrealized_pnl >= atr * ${p.multiple || 2.0}`],
};

// Map DSL session_filter to paper trading preferred_sessions
const SESSION_MAP: Record<string, string[]> = {
  RTH_ONLY: ["NY_RTH"],
  ETH_ONLY: ["ETH"],
  ALL_SESSIONS: [],
  LONDON: ["London"],
  ASIA: ["Asia"],
};

export function isDSLStrategy(config: Record<string, any>): boolean {
  return !!config?.schema_version;
}

export function isPythonStrategy(config: Record<string, any>): boolean {
  return !!config?.python_code;
}

export function isLegacyStrategy(config: Record<string, any>): boolean {
  return Array.isArray(config?.entry_rules);
}

export function translateDSLToPaperConfig(dsl: DSLConfig): PaperTradingConfig {
  const indicator = dsl.entry_indicator || "sma_crossover";
  const entryParams = dsl.entry_params || {};
  const exitType = dsl.exit_type || "atr_multiple";
  const exitParams = dsl.exit_params || {};

  // Generate entry rules from indicator mapping
  const ruleGenerator = INDICATOR_RULE_MAP[indicator];
  const entry_rules = ruleGenerator
    ? ruleGenerator(entryParams)
    : [`${indicator}_signal`]; // Fallback for unknown indicators

  // Generate exit rules
  const exitGenerator = EXIT_RULE_MAP[exitType];
  const exit_rules = exitGenerator
    ? exitGenerator(exitParams)
    : [`exit_${exitType}`];

  // Map direction
  const side = (dsl.direction === "long" || dsl.direction === "short")
    ? dsl.direction
    : "both";

  // Build stop loss config
  const stop_loss = dsl.stop_loss_atr_multiple
    ? { type: "atr", multiplier: dsl.stop_loss_atr_multiple }
    : { type: "atr", multiplier: 2.0 };

  // ── Build trail stop ────────────────────────────────────────────────────
  // W5b Tier 5.1: trail_stop now carries break_even_at_r, time_decay_minutes,
  // and time_decay_multiplier when supplied. Sources, in order of precedence:
  //   1. dsl.trail_config (explicit block, future schema slot)
  //   2. dsl.exit_params with trail-stop-shaped fields
  //   3. dsl.take_profit_atr_multiple (legacy fallback path)
  //
  // Output shape mirrors paper-signal-service.ts TrailStopConfig so the
  // downstream consumer can apply break-even and time-decay legs without
  // additional transformation. When no source provides any field, trail_stop
  // is undefined — IDENTICAL to pre-W5b behavior for backwards compat.
  const trailConfig = dsl.trail_config ?? {};
  const trailMultiplier =
    trailConfig.atr_multiple ??
    (typeof exitParams.trail_atr === "number" ? exitParams.trail_atr : undefined) ??
    dsl.take_profit_atr_multiple;

  let trail_stop: TrailStopOutput | undefined;
  if (typeof trailMultiplier === "number") {
    trail_stop = { type: "atr", multiplier: trailMultiplier };

    const atrPeriod = trailConfig.atr_period ?? exitParams.atr_period;
    if (typeof atrPeriod === "number") trail_stop.atr_period = atrPeriod;

    const breakEvenAtR =
      trailConfig.break_even_at_r ?? exitParams.break_even_at_r;
    if (typeof breakEvenAtR === "number") trail_stop.break_even_at_r = breakEvenAtR;

    const timeDecayMinutes =
      trailConfig.time_decay_minutes ?? exitParams.time_decay_minutes;
    if (typeof timeDecayMinutes === "number")
      trail_stop.time_decay_minutes = timeDecayMinutes;

    const timeDecayMultiplier =
      trailConfig.time_decay_multiplier ?? exitParams.time_decay_multiplier;
    if (typeof timeDecayMultiplier === "number")
      trail_stop.time_decay_multiplier = timeDecayMultiplier;
  }

  // Map sessions
  const preferred_sessions = dsl.session_filter
    ? SESSION_MAP[dsl.session_filter] || []
    : [];

  // Build indicator requirements
  const indicators: Record<string, unknown> = {};
  if (indicator.includes("sma")) {
    indicators.sma = entryParams;
  } else if (indicator.includes("ema")) {
    indicators.ema = entryParams;
  } else if (indicator.includes("rsi")) {
    indicators.rsi = { period: entryParams.period || 14 };
  } else if (indicator.includes("atr")) {
    indicators.atr = { period: entryParams.period || 20 };
  } else if (indicator.includes("macd")) {
    indicators.macd = entryParams;
  } else if (indicator.includes("bollinger")) {
    indicators.bollinger = entryParams;
  }

  const result: PaperTradingConfig = {
    entry_rules,
    exit_rules,
    side: side as "long" | "short" | "both",
    contracts: dsl.max_contracts || 1,
    stop_loss,
    ...(trail_stop && { trail_stop }),
    ...(preferred_sessions.length && { preferred_sessions }),
    indicators,
  };

  logger.info(
    {
      indicator,
      entryRules: entry_rules,
      exitRules: exit_rules,
      trailStop: trail_stop
        ? {
            multiplier: trail_stop.multiplier,
            breakEvenAtR: trail_stop.break_even_at_r ?? null,
            timeDecayMinutes: trail_stop.time_decay_minutes ?? null,
            timeDecayMultiplier: trail_stop.time_decay_multiplier ?? null,
          }
        : null,
    },
    "DSL translated to paper trading config",
  );

  return result;
}
