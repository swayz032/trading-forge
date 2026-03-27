/**
 * Regime Service — Python subprocess bridge for regime detection.
 * Same pattern as backtest-service.ts.
 */

import { logger } from "../index.js";
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
