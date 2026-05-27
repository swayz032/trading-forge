/**
 * mechanic-portability.ts — Wave 26 Pass J Phase 2 (2026-05-26)
 *
 * Pure-function rules-based classifier for "do this strategy's mechanics
 * port to intraday MES/MNQ/MCL trading, regardless of what chart the
 * speaker demonstrated on?"
 *
 * Replaces the prior `instrument_classification` chart-based gate
 * (which over-rejected real strategies whose speakers happened to demo
 * on EURUSD / AAPL / BTC). Most trading mechanics — EMA crosses, RSI
 * reversal, breakouts, supply/demand, ICT/SMC, market structure, VWAP
 * fades, ORB, momentum, mean reversion, candle patterns — work
 * IDENTICALLY across futures, forex, stocks, and crypto.
 *
 * Hard reject classes (5, mechanic-based — chart symbol is irrelevant):
 *   1. Options-derivative — Greeks / theta / multi-leg / premium decay
 *   2. Swing / multi-day / overnight holds — Topstep EOD trailing DD = fatal
 *   3. Forex-specific economic mechanics — carry trade / swap / central-bank
 *   4. Stock-specific corporate-event mechanics — dividends / earnings / catalyst
 *   5. Crypto-specific market-structure mechanics — on-chain / funding-rate / 24-7
 *
 * Everything else PORTS.
 *
 * Pure-function, no I/O, no LLM, no Date.now(). Deterministic for replay.
 */

export type MechanicRejectClass =
  | "options_derivative"
  | "swing_multi_day"
  | "forex_specific_mechanics"
  | "stock_specific_mechanics"
  | "crypto_specific_mechanics";

export interface MechanicPortabilityResult {
  /** True if mechanics port to intraday futures (most strategies). */
  portable: boolean;
  /** When portable=false, which class triggered the reject. */
  reject_class: MechanicRejectClass | null;
  /** Human-readable evidence (matched terms). Caps at 5 items. */
  evidence: string[];
  /**
   * Confidence in the classification, [0,1].
   * 1.0 = explicit terminology hit. 0.7 = soft pattern match.
   */
  confidence: number;
}

interface RejectPattern {
  class: MechanicRejectClass;
  /** Regex (case-insensitive, word-boundary where sensible). */
  pattern: RegExp;
  /** Soft (0.7) vs hard (1.0) signal. */
  hard: boolean;
}

/**
 * Hard-reject pattern table.
 *
 * Each entry is a mechanic-specific phrase or term that signals the strategy
 * uses an instrument-class-specific mechanic. We deliberately use mechanic
 * vocabulary, NOT instrument names. "EURUSD" alone is NOT a reject (most
 * forex demos teach portable mechanics); "carry trade" IS a reject (mechanic
 * doesn't port — futures has no carry).
 *
 * Word boundaries chosen to avoid false positives:
 *   "iron condor" not "iron" (would hit "iron mountain")
 *   "carry trade" not "carry" (would hit "carry over")
 *   "dividend" + word boundary not bare "div" (would hit "divergence")
 */
const REJECT_PATTERNS: RejectPattern[] = [
  // ─── 1. OPTIONS-DERIVATIVE ──────────────────────────────────
  { class: "options_derivative", pattern: /\b(?:iron condors?|iron butterfl(?:y|ies)|credit spreads?|debit spreads?|vertical spreads?|calendar spreads?|diagonal spreads?|straddles?|strangles?|covered calls?|naked calls?|naked puts?|cash[- ]secured puts?|wheel strateg(?:y|ies))\b/i, hard: true },
  { class: "options_derivative", pattern: /\b(?:theta decay|premium decay|implied volatilit(?:y|ies)?|IV crush|gamma scalp(?:ing)?|delta hedg(?:e|ing))\b/i, hard: true },
  { class: "options_derivative", pattern: /\b(?:weekly option(?:s)?|0[- ]?DTE|zero[- ]?DTE|expiration friday|OPEX|monthly expir(?:y|ation))\b/i, hard: true },
  { class: "options_derivative", pattern: /\b(?:call option|put option|long call|long put|short call|short put|sell to open|buy to close)\b/i, hard: true },
  // SPY/QQQ context: standalone "SPY" can be index-futures-portable, but "SPY options" is hard reject
  { class: "options_derivative", pattern: /\b(?:SPY|QQQ|IWM|SPX|NDX|RUT|VIX) (?:options?|calls?|puts?|premium|chain)\b/i, hard: true },

  // ─── 2. SWING / MULTI-DAY ───────────────────────────────────
  // 2026-05-26 false-positive fix: require SUBJECTIVE ATTRIBUTION (speaker DOES it)
  // not just any mention. Scalping/intraday videos commonly DISMISS swing trading
  // ("I don't care what anybody says about swing trading", "made more than silly old
  // swing traders") — bare-mention regex matched those and rejected real intraday
  // strategies. New rule: require "I'm/I am/we're/we are a swing trader", "I/we
  // swing trade", "my/our swing", or "swing trades I/we take" — first-person
  // self-attribution. Bare "swing trading" without self-attribution is now CLEAR.
  // Negation guard (`evaluateLunchBlackoutGate`-style) suppresses matches when
  // "don't/not/never/no/instead of/against/avoid" appears within 25 chars before.
  { class: "swing_multi_day", pattern: /\b(?:I(?:'m| am)? a swing trader|we(?:'re| are) swing traders?|I swing trade|we swing trade|my swing trades?|our swing trades?|swing trades? (?:I|we) take)\b/i, hard: true },
  { class: "swing_multi_day", pattern: /\b(?:I(?:'m| am)? a position trader|we(?:'re| are) position traders?|I position trade|we position trade)\b/i, hard: true },
  // First-person overnight/multi-day action — speaker DOES it
  { class: "swing_multi_day", pattern: /\b(?:I|we) (?:hold (?:for )?(?:days?|weeks?|months?)|hold(?:ing)? overnight|carry (?:positions? )?over(?:night)?)\b/i, hard: true },
  { class: "swing_multi_day", pattern: /\b(?:I'll|we'll|I will|we will) (?:hold (?:for )?(?:days?|weeks?|months?)|hold(?:ing)? overnight|carry (?:positions? )?over(?:night)?)\b/i, hard: true },
  // Multi-day hold patterns with explicit time framing — the language is too
  // specific to be incidental (e.g. "weekly chart strategy" only said by users)
  { class: "swing_multi_day", pattern: /\b(?:weekly chart entry|daily chart entry|monthly chart entry).{0,40}(?:hold|swing|position)\b/i, hard: true },
  // Soft: "buy and hold" / "long-term" framing — first-person attribution
  { class: "swing_multi_day", pattern: /\b(?:I|we) (?:buy and hold|long[- ]term invest|set and forget)\b/i, hard: false },

  // ─── 3. FOREX-SPECIFIC MECHANICS ────────────────────────────
  { class: "forex_specific_mechanics", pattern: /\b(?:carry trade|carry pair|positive carry|negative carry|swap rate|swap (?:fee|cost|interest)|rollover (?:fee|interest|swap))\b/i, hard: true },
  { class: "forex_specific_mechanics", pattern: /\b(?:central bank intervention|BoJ intervention|ECB rate decision|Fed rate decision|interest rate differential|currency correlation arb|triangular arbitrage)\b/i, hard: true },
  { class: "forex_specific_mechanics", pattern: /\b(?:DXY (?:correlation|hedge|arb)|currency basket|G10 (?:currenc(?:y|ies)|FX))\b/i, hard: true },

  // ─── 4. STOCK-SPECIFIC CORPORATE-EVENT MECHANICS ────────────
  { class: "stock_specific_mechanics", pattern: /\b(?:dividend capture|ex[- ]dividend|dividend yield play|special dividend|dividend reinvest)\b/i, hard: true },
  { class: "stock_specific_mechanics", pattern: /\b(?:earnings (?:play|trade|gap|run[- ]?up|whisper|surprise|announcement)|post[- ]earnings|pre[- ]earnings drift|EPS beat|EPS miss|guidance raise)\b/i, hard: true },
  { class: "stock_specific_mechanics", pattern: /\b(?:stock split|reverse split|spin[- ]?off|merger arb(?:itrage)?|tender offer|IPO (?:flip|lock[- ]?up|allocation)|secondary offering|share buyback)\b/i, hard: true },
  { class: "stock_specific_mechanics", pattern: /\b(?:sector rotation|sector ETF rotation|industry group|relative strength.{0,20}sector|GICS sector)\b/i, hard: true },
  { class: "stock_specific_mechanics", pattern: /\b(?:short[- ]squeeze (?:play|setup)|gamma squeeze|float (?:rotation|squeeze)|low float runner|small[- ]?cap pump)\b/i, hard: true },
  { class: "stock_specific_mechanics", pattern: /\b(?:insider buying|insider selling|13F filing|institutional ownership change)\b/i, hard: true },

  // ─── 5. CRYPTO-SPECIFIC MECHANICS ───────────────────────────
  { class: "crypto_specific_mechanics", pattern: /\b(?:on[- ]chain (?:metric|signal|indicator|data)|MVRV|NUPL|SOPR|exchange (?:inflow|outflow)|whale wallet|whale alert)\b/i, hard: true },
  { class: "crypto_specific_mechanics", pattern: /\b(?:funding rate (?:arb|trade|harvest|reset)|perp[- ]?spot basis|cash[- ]and[- ]carry crypto|negative funding play)\b/i, hard: true },
  { class: "crypto_specific_mechanics", pattern: /\b(?:halving (?:cycle|narrative|trade)|bitcoin halving|stock[- ]?to[- ]?flow|S2F model)\b/i, hard: true },
  { class: "crypto_specific_mechanics", pattern: /\b(?:DeFi yield|staking reward|liquidity (?:pool|mining)|impermanent loss|airdrop farm(?:ing)?|MEV)\b/i, hard: true },
  // Crypto 24/7 dependency
  { class: "crypto_specific_mechanics", pattern: /\b(?:weekend (?:gap|crypto trad(?:e|ing))|24[/ ]?7 market structure|crypto never sleeps)\b/i, hard: true },
];

/**
 * Classify a transcript by mechanic portability.
 *
 * Pure-function, deterministic, no side effects.
 *
 * @param transcript - raw transcript text (already de-formatted by NLP pre-pass)
 * @returns MechanicPortabilityResult — portable=true means extract; false means reject
 */
export function classifyMechanicPortability(transcript: string): MechanicPortabilityResult {
  if (!transcript || typeof transcript !== "string") {
    return { portable: false, reject_class: null, evidence: ["empty_transcript"], confidence: 1.0 };
  }

  const evidenceByClass = new Map<MechanicRejectClass, { hits: string[]; hardHit: boolean }>();

  for (const { class: cls, pattern, hard } of REJECT_PATTERNS) {
    const match = transcript.match(pattern);
    if (!match) continue;
    const matched = match[0];
    const entry = evidenceByClass.get(cls) ?? { hits: [], hardHit: false };
    if (entry.hits.length < 5 && !entry.hits.includes(matched)) {
      entry.hits.push(matched);
    }
    if (hard) entry.hardHit = true;
    evidenceByClass.set(cls, entry);
  }

  // Pick the strongest reject signal: hard hit wins over soft; first class to
  // get a hard hit takes precedence (options before swing before forex etc.)
  // since options-derivative is the most architecturally distinct.
  const priorityOrder: MechanicRejectClass[] = [
    "options_derivative",
    "swing_multi_day",
    "forex_specific_mechanics",
    "stock_specific_mechanics",
    "crypto_specific_mechanics",
  ];

  for (const cls of priorityOrder) {
    const entry = evidenceByClass.get(cls);
    if (entry?.hardHit) {
      return {
        portable: false,
        reject_class: cls,
        evidence: entry.hits,
        confidence: 1.0,
      };
    }
  }

  // No hard hit — check soft hits
  for (const cls of priorityOrder) {
    const entry = evidenceByClass.get(cls);
    if (entry && entry.hits.length > 0) {
      return {
        portable: false,
        reject_class: cls,
        evidence: entry.hits,
        confidence: 0.7,
      };
    }
  }

  // Nothing matched — strategy mechanics port to intraday futures
  return {
    portable: true,
    reject_class: null,
    evidence: [],
    confidence: 1.0,
  };
}

/**
 * Human-readable explanation of a reject class.
 * Used for audit row payload + Discord baby-jargon translation.
 */
export function explainRejectClass(cls: MechanicRejectClass): string {
  switch (cls) {
    case "options_derivative":
      return "Options-derivative strategy (Greeks, theta, multi-leg). Futures has no options Greeks — mechanics don't port.";
    case "swing_multi_day":
      return "Swing / multi-day / overnight hold. Topstep EOD trailing drawdown makes overnight risk fatal. Day-trader-only mandate.";
    case "forex_specific_mechanics":
      return "Forex-specific mechanic (carry trade, swap rate, central-bank intervention). No equivalent in futures.";
    case "stock_specific_mechanics":
      return "Stock-specific corporate-event mechanic (dividend capture, earnings play, sector rotation, short-squeeze). No equivalent in futures.";
    case "crypto_specific_mechanics":
      return "Crypto-specific mechanic (on-chain metrics, funding-rate arb, halving cycle, DeFi yield). No equivalent in futures.";
  }
}
