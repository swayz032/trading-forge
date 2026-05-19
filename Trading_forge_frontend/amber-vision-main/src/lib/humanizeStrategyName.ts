// Pass 21 (2026-05-12) — humanize snake_case strategy names for display.
// Used on Strategies list cards + StrategyDetail header.
//
//   "mes_pivot_points_data_backed_edgeful_blog_5m"  → "Pivot Points Data Backed Edgeful"
//   "mes_fvg_what_is_fair_value_gap_meaning_atas_5m" → "FVG Fair Value Gap Meaning Atas"
//   "mes_r_daytrading_on_reddit_ema_9_and_21_5m"     → "R Daytrading Reddit EMA 9 21"
const STOPWORDS = new Set([
  "a", "an", "the", "what", "is", "of", "to", "and", "are", "in", "with",
  "for", "by", "on", "explained", "explanation", "explanations", "guide",
  "basics", "types", "indicator", "blog", "stockcharts", "com", "strategies",
  "strategy", "rules", "tips", "tutorial",
]);
const ACRONYMS = new Set([
  "mes", "mnq", "mcl", "ema", "sma", "rsi", "vwap", "macd", "atr", "orb",
  "ict", "fvg", "smc", "vah", "val", "vp", "dll", "be", "tp", "sl", "rth",
  "eth",
]);

export function humanizeStrategyName(rawName: string): string {
  if (!rawName) return "Strategy";
  let s = rawName.toLowerCase()
    .replace(/^(mes|mnq|mcl)_/, "")
    .replace(/_(1m|5m|15m|30m|1h|4h|1d)$/, "")
    .replace(/_(continuation|reversal|breakout|fade|setup)$/, "")
    .trim();
  if (!s) s = rawName;
  const tokens = s.split(/[_\s]+/).filter(Boolean);
  const meaningful = tokens.filter((t) => !STOPWORDS.has(t));
  const display = (meaningful.length >= 2 ? meaningful : tokens)
    .slice(0, 6)
    .map((t) => ACRONYMS.has(t) ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1))
    .join(" ");
  return display || rawName;
}
