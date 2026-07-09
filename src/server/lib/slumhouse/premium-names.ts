export interface NamedStrategyRow {
  name: string;
  symbols: string[];
  timeframe: string;
  config?: Record<string, unknown> | null;
}

// Operator-curated. familyKey (normalized archetype/concept) → premium menu name.
// Add/rename freely; unmapped families fall back to a Title-Cased raw name.
export const PREMIUM_NAMES: Record<string, string> = {
  opening_range_breakout: "Opening Heist",
  orb: "Opening Heist",
  orb_15m: "Opening Heist",
  silver_bullet: "Silver Bullet",
  ict_silver_bullet_ny_am: "Silver Bullet",
  connors_rsi2: "The Dip Snatch",
  ema_9_21_pullback: "Trend Rider",
  ema_20_50_pullback: "Trend Rider",
  vwap_fade: "The Fade",
  vwap_hod_lod_rejection: "The Fade",
  liquidity_sweep_reversal: "Crude Sweep",
  bollinger_squeeze: "Squeeze Play",
  keltner_squeeze: "Squeeze Play",
  nr7: "Coiled Spring",
  ict_bias_aligned_continuation: "The Continuation",
  bounce_off_level: "The Bounce",
};

const SESSION_MAP: Record<string, string> = { ny_am: "NY AM", ny_pm: "NY PM", london: "London", asian: "Asian", asia: "Asian" };
const TF_RE = /_(\d+m|\d+min|\d+h|daily|weekly)$/i;
const SYM_RE = /_(mes|mnq|mcl|es|nq|cl)$/i;
const SESSION_RE = /_(ny_am|ny_pm|london|asian|asia)$/i;

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export function familyKeyFor(row: NamedStrategyRow): string {
  const ind = typeof row.config?.["entry_indicator"] === "string" ? String(row.config["entry_indicator"]) : "";
  if (ind.startsWith("archetype:")) return ind.slice("archetype:".length).toLowerCase();
  let k = (row.name || "").toLowerCase();
  let prev;
  do { prev = k; for (const re of [SESSION_RE, SYM_RE, TF_RE]) { k = k.replace(re, ""); } } while (k !== prev);
  return k;
}

export function resolvePremiumName(row: NamedStrategyRow): { family: string; premiumName: string; variantTag: string } {
  const family = familyKeyFor(row);
  const premiumName = PREMIUM_NAMES[family] ?? PREMIUM_NAMES[(row.name || "").toLowerCase()] ?? titleCase(row.name || family);
  const parts: string[] = [];
  if (row.timeframe) parts.push(row.timeframe);
  if (row.symbols?.[0]) parts.push(row.symbols[0]);
  const sessMatch = (row.name || "").toLowerCase().match(/(ny_am|ny_pm|london|asian|asia)/);
  if (sessMatch) parts.push(SESSION_MAP[sessMatch[1]] ?? sessMatch[1]);
  return { family, premiumName, variantTag: parts.join(" · ") };
}
