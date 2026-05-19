/**
 * Maps Trading Forge instrument codes (MES, MNQ, MCL, etc.) to TradingView
 * symbols that work on the FREE tier. CME futures continuation contracts
 * (CME_MINI:ES1!) require a paid TradingView account, so we use ETF proxies
 * which always render without auth.
 *
 * Used purely for the live-preview chart embed. Never affects strategy
 * symbols or backtest data — strategies use their own stored symbol code.
 */
const TV_FUTURES: Record<string, string> = {
  ES: "AMEX:SPY",
  MES: "AMEX:SPY",
  NQ: "NASDAQ:QQQ",
  MNQ: "NASDAQ:QQQ",
  CL: "AMEX:USO",
  MCL: "AMEX:USO",
  GC: "AMEX:GLD",
  MGC: "AMEX:GLD",
  RTY: "AMEX:IWM",
  M2K: "AMEX:IWM",
  YM: "AMEX:DIA",
  MYM: "AMEX:DIA",
};

export function tvSymbolFromFutures(symbol: string | undefined | null): string {
  if (!symbol) return "AMEX:SPY";
  const upper = symbol.toUpperCase();
  return TV_FUTURES[upper] ?? "AMEX:SPY";
}

/**
 * Convert a Forge timeframe code (5m, 15m, 1h, 4h, 1d) to TradingView's
 * advanced-chart interval string.
 */
export function tvIntervalFromTimeframe(timeframe: string | undefined | null): string {
  if (!timeframe) return "60";
  const tf = timeframe.toLowerCase().trim();
  if (tf.endsWith("m")) {
    const n = parseInt(tf.slice(0, -1), 10);
    if (Number.isFinite(n) && n > 0) return String(n);
  }
  if (tf.endsWith("h")) {
    const n = parseInt(tf.slice(0, -1), 10);
    if (Number.isFinite(n) && n > 0) return String(n * 60);
  }
  if (tf === "1d" || tf === "d") return "D";
  if (tf === "1w" || tf === "w") return "W";
  return "60";
}
