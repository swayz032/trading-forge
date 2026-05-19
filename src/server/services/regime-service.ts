/**
 * Regime Service — Python subprocess bridge for regime detection.
 * Same pattern as backtest-service.ts.
 */

import { runPythonModule } from "../lib/python-runner.js";

export interface RegimeResult {
  regime: string;
  adx: number;
  atr_percentile: number;
  ma_slope: number;
  confidence: number;
  symbol?: string;
  timeframe?: string;
  error?: string;
}

export async function analyzeMarket(
  symbol: string,
  timeframe: string = "1h",
  adxPeriod: number = 14,
): Promise<RegimeResult> {
  return runPythonModule<RegimeResult>({
    module: "src.engine.regime",
    config: { symbol, timeframe, adx_period: adxPeriod },
    componentName: "regime-engine",
  });
}

/**
 * HMM probabilistic regime detection — slower but more accurate.
 * Returns transition matrix, state probabilities, regime persistence.
 * Falls back to rule-based if hmmlearn unavailable.
 */
export interface HMMRegimeResult {
  method: string;
  n_regimes?: number;
  current_regime?: number;
  current_probabilities?: number[];
  transition_matrix?: number[][];
  persistence?: Record<string, { stay_probability: number; expected_duration_days: number }>;
  regime_stats?: Array<{ regime_id: number; mean_return: number; volatility: number; frequency: number }>;
  log_likelihood?: number;
  hmm_available?: boolean;
  error?: string;
}

export async function analyzeMarketHMM(
  symbol: string,
  timeframe: string = "daily",
  nRegimes: number = 3,
): Promise<HMMRegimeResult> {
  return runPythonModule<HMMRegimeResult>({
    module: "src.engine.regime",
    config: { symbol, timeframe, mode: "hmm", n_regimes: nRegimes },
    componentName: "regime-hmm",
  });
}
