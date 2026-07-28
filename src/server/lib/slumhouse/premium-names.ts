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
  session_open_breakout: "Opening Heist",
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
  ema_crossover: "Corner Cross",
  rsi_reversal: "Dip Snatch",
  bollinger_breakout: "Pressure Break",
  macd_crossover: "Momentum Flip",
  donchian_breakout: "Range Jack",
  atr_breakout: "Volatility Run",
  supertrend: "Trend Hustle",
  ichimoku_cloud: "Cloud Nine",
  cumulative_delta: "Order Flow",
};

const SESSION_MAP: Record<string, string> = { ny_am: "NY AM", ny_pm: "NY PM", london: "London", asian: "Asian", asia: "Asian" };
const TF_RE = /_(\d+m|\d+min|\d+h|daily|weekly)$/i;
const SYM_RE = /_(mes|mnq|mcl|es|nq|cl)$/i;
const SESSION_RE = /_(ny_am|ny_pm|london|asian|asia)$/i;

export function familyKeyFor(row: NamedStrategyRow): string {
  const ind = typeof row.config?.["entry_indicator"] === "string" ? String(row.config["entry_indicator"]) : "";
  if (ind.startsWith("archetype:")) return ind.slice("archetype:".length).toLowerCase();
  if (ind) return ind.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  let k = (row.name || "").toLowerCase();
  let prev;
  do { prev = k; for (const re of [SESSION_RE, SYM_RE, TF_RE]) { k = k.replace(re, ""); } } while (k !== prev);
  return k;
}

const PREMIUM_VARIANTS = [
  "VVS", "Onyx", "Noir", "Phantom", "Velvet", "Royal", "Crown", "Midnight",
  "Empire", "Platinum", "Diamond", "Legacy", "Luxe", "Ghost", "Skyline", "Major",
  "Supreme", "Cashmere", "Gold", "Ace", "Monarch", "Prestige", "Sovereign", "Blackout",
  "Obsidian", "Chrome", "Sterling", "Marble", "Eclipse", "Regal", "Elite", "Victory",
  "Uptown", "Fifth", "Penthouse", "Maybach", "Cartier", "Rolex", "Caviar", "Champagne",
  "Gatsby", "Riviera", "Jetset", "Icon", "Dynasty", "Fortune", "Midas", "Gilded",
  "Rare", "Prime", "Titan", "Apollo", "Atlas", "Caesar", "Noble", "Vanguard",
  "Signature", "Private", "Reserve", "Classic", "Premier", "Executive", "Grand", "Couture",
];

const GENERATED_MAIN_PREFIXES = ["Black", "Gold", "Night", "High", "First", "Rare", "Big", "Clean", "Silent", "Heavy", "Cold", "Prime", "Royal", "Street", "Top", "Grand"];
const GENERATED_MAIN_NOUNS = ["Label", "Money", "Motion", "Business", "Pressure", "Route", "Play", "Move", "Code", "Ticket", "Lane", "Hand", "Bag", "Work", "Run", "Touch"];

function stableIndex(value: string, modulo: number): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0) % modulo;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

export function resolvePremiumName(row: NamedStrategyRow): { family: string; premiumName: string; displayName: string; variantTag: string } {
  const family = familyKeyFor(row);
  const premiumName = PREMIUM_NAMES[family] ?? PREMIUM_NAMES[(row.name || "").toLowerCase()] ??
    `${GENERATED_MAIN_PREFIXES[stableIndex(family, GENERATED_MAIN_PREFIXES.length)]} ${GENERATED_MAIN_NOUNS[stableIndex(`${family}:noun`, GENERATED_MAIN_NOUNS.length)]}`;
  const parts: string[] = [];
  if (row.timeframe) parts.push(row.timeframe);
  if (row.symbols?.[0]) parts.push(row.symbols[0]);
  const sessMatch = (row.name || "").toLowerCase().match(/(ny_am|ny_pm|london|asian|asia)/);
  if (sessMatch) parts.push(SESSION_MAP[sessMatch[1]] ?? sessMatch[1]);
  const variantIdentity = `${family}|${row.timeframe}|${(row.symbols || []).join(",")}|${stableSerialize(row.config ?? {})}`;
  const variantName = PREMIUM_VARIANTS[stableIndex(variantIdentity, PREMIUM_VARIANTS.length)];
  return { family, premiumName, displayName: `${premiumName} ${variantName}`, variantTag: parts.join(" · ") };
}
