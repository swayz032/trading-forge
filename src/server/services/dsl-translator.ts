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
}

interface PaperTradingConfig {
  entry_rules: string[];
  exit_rules: string[];
  side: "long" | "short" | "both";
  contracts: number;
  stop_loss?: { type: string; multiplier: number };
  trail_stop?: { type: string; multiplier: number };
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

  // Build trail stop from take profit
  const trail_stop = dsl.take_profit_atr_multiple
    ? { type: "atr", multiplier: dsl.take_profit_atr_multiple }
    : undefined;

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

  logger.info({ indicator, entryRules: entry_rules, exitRules: exit_rules }, "DSL translated to paper trading config");

  return result;
}
