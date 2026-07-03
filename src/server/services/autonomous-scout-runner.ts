/**
 * Autonomous Scout Runner — Pass 21 / 2026-05-11; Wave 9 prune / 2026-05-17
 *
 * Replaces the broken 5R→5P/5Q n8n webhook chain with an in-process orchestrator
 * that runs every 4 hours via scheduler.ts. Does the SAME work the n8n workflows
 * are supposed to do — Brave + Exa discovery → YouTube Data API search →
 * `youtube-transcript` npm package transcript → /scout-extract → Reddit JSON
 * relevance search → POST 3 layer mentions per concept — but inside the
 * backend process where:
 *
 *   - No webhook registration drift (n8n MCP partial-update bug)
 *   - Deterministic error handling + retry per layer
 *   - No silent SplitInBatches index-0 vs index-1 confusion
 *   - Direct DB observability for every step
 *
 * Wave 9 (2026-05-17) — ScrapingBee, Supadata, and ScrapingDog fallback chains
 * removed. The free `youtube-transcript` npm package is the sole transcript
 * provider; Google's YouTube Data API v3 is the sole video discovery provider.
 * Web pages use direct fetch only (no rendered-HTML scraping service).
 *
 * Each cycle: discover queries → strategy NAMES (Brave + Exa) → for each name
 * fan out to YouTube + Reddit → POST web/youtube/reddit layer mentions →
 * bucket fingerprint converges → 3-layer coverage triggers graduation →
 * strategy row lands with framework-overlay applied.
 */
import { logger } from "../index.js";
import { db } from "../db/index.js";
import { strategies, strategyPendingBuckets, auditLog, transcriptFetchOutcomes } from "../db/schema.js";
import { fetchTranscriptWithRetry } from "./transcript-fetch-queue.js";
import { fetchRedditEnrichment } from "./reddit-cross-extract.js";
import { eq, sql as drizzleSql, count as drizzleCount } from "drizzle-orm";
import { canonicalConceptName } from "./strategy-fingerprint.js";
import { randomUUID } from "crypto";
// F-7 (2026-05-20): service-internal pipeline gate (defense-in-depth).
// Track C adds the scheduler-level gate; this ensures the cron action itself
// respects pause even when called directly (e.g. operator manual trigger, tests).
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { notifyWarning } from "../services/notification-service.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";

const BACKEND_URL = `http://localhost:${process.env.PORT ?? 4000}`;
const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY || "";
const YOUTUBE_API_KEY = process.env.YOUTUBE_DATA_API_KEY || "";
const EXA_API_KEY = process.env.EXA_API_KEY || "";

// ─── Track O (deepscan11, 2026-07-02) — YouTube quota budget enforcement ────
//
// Real quota math (corrected from stale "2400/day" comment):
//   fetchYouTubeTopVideos = 2 passes × 3 orders = 6 API calls × 100 units = 600 units/concept
//   TARGET_CONCEPTS default = 5 concepts/cycle
//   Cron cadence = every 4 hours = 6 cycles/day
//   Total: 5 × 600 × 6 = 18,000 units/day (EXCEEDS 10K free tier by 80%)
//
// Mitigation: YOUTUBE_DAILY_QUOTA_BUDGET cap (default 9000) enforced per UTC day.
// On budget exhaustion: skip further YT searches, emit audit row + deduped Discord WARN.
// On HTTP 403/quota response: same audit + Discord, and skip remaining calls.

const YOUTUBE_DAILY_QUOTA_BUDGET = (() => {
  const raw = Number(process.env.YOUTUBE_DAILY_QUOTA_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 9_000;
})();

// 100 units per YouTube Data API search.list call (Google's official quota cost).
const YOUTUBE_QUOTA_UNITS_PER_CALL = 100;

/** In-memory quota state — resets at UTC day boundary. Not durable across restarts. */
const _ytQuotaState = {
  usedUnits: 0,
  utcDay: "",          // YYYY-MM-DD of the current UTC day
  warnedToday: false,  // deduplication: only one Discord WARN per UTC day
};

function _ytQuotaUtcDay(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function _ensureYtDayReset(): void {
  const today = _ytQuotaUtcDay();
  if (_ytQuotaState.utcDay !== today) {
    _ytQuotaState.usedUnits = 0;
    _ytQuotaState.utcDay = today;
    _ytQuotaState.warnedToday = false;
  }
}

/** Record N units consumed; returns true if the budget is still available. */
function _ytConsumeQuota(units: number): boolean {
  _ensureYtDayReset();
  _ytQuotaState.usedUnits += units;
  return _ytQuotaState.usedUnits <= YOUTUBE_DAILY_QUOTA_BUDGET;
}

function _ytBudgetRemaining(): number {
  _ensureYtDayReset();
  return Math.max(0, YOUTUBE_DAILY_QUOTA_BUDGET - _ytQuotaState.usedUnits);
}

/** Emit audit + deduped-daily Discord WARN on quota exhaustion. */
async function _emitYtQuotaExhausted(correlationId?: string): Promise<void> {
  _ensureYtDayReset();
  try {
    await insertAuditRow({
      action: "scout.youtube_quota_exhausted",
      entityType: "scout_cycle",
      entityId: correlationId ?? "quota_check",
      status: "warning",
      input: { budget: YOUTUBE_DAILY_QUOTA_BUDGET },
      result: {
        used_units: _ytQuotaState.usedUnits,
        budget: YOUTUBE_DAILY_QUOTA_BUDGET,
        utc_day: _ytQuotaState.utcDay,
      },
    });
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "autonomous-scout: scout.youtube_quota_exhausted audit write failed (non-blocking)");
  }
  if (!_ytQuotaState.warnedToday) {
    _ytQuotaState.warnedToday = true;
    notifyWarning(
      "YouTube quota exhausted",
      `YouTube Data API daily budget of ${YOUTUBE_DAILY_QUOTA_BUDGET} units reached (${_ytQuotaState.usedUnits} used). YouTube layer disabled for the rest of the UTC day. Resets at midnight UTC.`,
      { used_units: _ytQuotaState.usedUnits, budget: YOUTUBE_DAILY_QUOTA_BUDGET, utc_day: _ytQuotaState.utcDay },
    );
  }
}

// ─── Track O (deepscan11, 2026-07-02) — Zero-extract cycle tracking ──────────
// When 3+ consecutive cycles produce 0 total mentions, emit a deduped-daily Discord WARN.

const _zeroExtractState = {
  consecutiveZeroCycles: 0,
  warnedToday: false,
  lastWarnUtcDay: "",
};

// ─── W23F.E — Symbol-tagged query template groups ────────────────────────────
//
// Three groups drive discovery rotation so the pipeline surfaces MNQ (Nasdaq /
// NQ / tech futures) and MCL (crude / WTI / oil futures) content at the same
// rate as MES. Without this rotation, Brave's SEO bias returns S&P vocabulary
// on every cycle and all buckets land as MES. Each 4-hour cron tick picks ONE
// group; every third cycle returns to MES for continuity.
//
// MES group: ported directly from the Pass-21 DISCOVERY_QUERIES list that was
// the pre-W23F.E query set. Those queries use S&P/ES/MES/SPX vocabulary.
// MNQ group: Nasdaq/NQ/QQQ/tech vocabulary sourced fresh for W23F.E.
// MCL group: crude/WTI/CL/oil vocabulary sourced fresh for W23F.E.
//
// Design:
//   - Family taxonomy spread intentional — trend/mean-revert/breakout/ICT/volume/gap
//   - Parametric specificity (numbers in title) breaks SEO-dominant generic content
//   - Trader-name queries (Connors, Raschke, Grimes, Carter) surface book/podcast content
//   - No market-news/manipulation language per prop-firm rules
//   - Queries are complete sentences — no {topic} interpolation needed

// Pass 21 / W23F.E — MES group (S&P / ES / micro / SPX vocabulary)
// Ported from pre-W23F.E DISCOVERY_QUERIES; these are the MES-seeded queries.
export const MES_QUERY_TEMPLATES: string[] = [
  // ── Parametric mean-reversion — engine: rsi_reversal, bollinger_breakout
  "RSI 2 strategy backtest futures Connors",
  "Bollinger band 2 standard deviation fade MES",
  "RSI 14 oversold reversal futures intraday",
  "stochastic 14 3 3 reversal futures rules",
  "Williams %R reversal futures backtest",
  // ── Parametric trend-follow — engine: ema_crossover, macd_crossover, supertrend
  "9 21 EMA pullback continuation MES rules",
  "20 50 SMA crossover futures backtest",
  "supertrend 10 3 indicator futures setup",
  "MACD 12 26 9 pullback futures rules",
  "ATR 14 trailing stop trend futures",
  // ── Parametric breakout — engine: donchian_breakout, keltner_squeeze, atr_breakout
  "Donchian 20 channel breakout futures backtest",
  "Keltner 20 2 channel breakout MES",
  "inside bar breakout futures rules",
  "NR4 narrow range 4 day breakout futures",
  "NR7 narrow range 7 inside day double compression futures",
  // ── ICT methodology — engine: silver_bullet.py, judas_swing.py, ny_lunch_reversal.py
  "ICT silver bullet 10am NY AM strategy futures NQ MNQ",
  "ICT silver bullet 3am London open window futures",
  "ICT judas swing London session manipulation futures",
  "ICT NY lunch reversal 12pm 1pm futures",
  "ICT midnight open NDOG NWOG futures bias",
  // ── ICT structural primitives — engine: market_structure.py, liquidity.py
  "ICT BOS break of structure continuation futures",
  "ICT CHoCH change of character reversal futures NQ ES",
  "ICT MSS market structure shift displacement futures",
  "ICT CISD change in state of delivery futures bullish bearish",
  "ICT liquidity sweep BSL SSL stop hunt futures",
  "ICT FVG fair value gap retrace entry MES MNQ",
  "ICT order block OB last opposite candle futures",
  "ICT breaker block failed swing futures NQ",
  "ICT unicorn FVG breaker confluence futures",
  "ICT optimal trade entry OTE 62 79 fibonacci futures",
  "ICT power of 3 accumulation manipulation distribution futures",
  "ICT turtle soup swing high low failure futures",
  "ICT mitigation block return retrace futures",
  // ── SMC / Smart Money — engine: order_flow.py, smt.py
  "smart money concepts SMC order block liquidity futures NQ ES",
  "SMC institutional order flow imbalance futures",
  "SMC SMT divergence ES NQ correlated futures",
  "SMC mitigation continuation entry futures",
  // ── Wyckoff — engine: market_structure.py (spring/upthrust as swept low/high primitives)
  "Wyckoff accumulation phase spring futures algorithm",
  "Wyckoff distribution upthrust UTAD futures algorithm",
  "Wyckoff secondary test spring confirmation futures",
  // ── Volume Profile / Market Profile — engine: initial_balance.py, htf_context.py
  "volume profile POC VAH VAL rejection MES strategy",
  "market profile initial balance IB extension futures",
  "market profile value area rotation fade futures",
  "volume profile HVN LVN futures intraday",
  "anchored VWAP HTF rejection 1 hour futures",
  // ── Order flow — engine: order_flow.py, cumulative_delta indicator
  "cumulative delta divergence futures ES NQ entry",
  "order flow imbalance stacked footprint futures",
  "absorption iceberg order DOM futures",
  // ── Session / range breakouts — engine: session_open_breakout, sessions.py
  "opening range breakout 15 minute MES rules",
  "opening range breakout 5 minute MES rules",
  "failed opening range breakout reversal futures",
  "pre-market range break RTH futures strategy",
  // ── VWAP archetypes — engine: vwap_fade, vwap_order_flow
  "VWAP rejection HOD LOD futures fade",
  "anchored VWAP pullback continuation MES",
  "VWAP first standard deviation band fade futures",
  // ── Gap & overnight — engine: overnight_drift, news_fade_mco
  "overnight gap fade RTH open futures MES",
  "overnight inventory drift futures continuation",
  "Asian session range fade RTH break futures",
  // ── Trend-day continuation
  "trend day continuation pullback futures Bellafiore",
  "ADD advance decline trend day MES continuation",
  // ── Time-of-day
  "London NY overlap reversal MNQ futures rules",
  "afternoon doldrums chop fade futures 2pm",
  "EOD power hour reversal MES strategy",
  // ── Topstep / funded-trader windowed strategies
  "Topstep funded trader session windowed strategy MES",
  "MFFU funded futures consistency target strategy",
  // ── Trader names — book-driven
  "Connors short-term trading strategy futures",
  "Raschke Holy Grail setup futures",
  "Carter TTM squeeze futures rules",
  "Crabel narrow range opening range expansion futures",
  // ── Crude-specific (MCL) — included in MES cycle for completeness
  "MCL crude oil inventory report fade",
  "MCL crude oil ATR breakout setup",
  "MCL crude oil session high low fade",
  // 2026-06-27 operator keyword extension — YouTube-led discovery pivot.
  "MES day trading strategy rules",
  "MES structural trade setup",
  "MES macro setup entry criteria",
  "MES market structure shift",
];

// W23F.E — MNQ group (Nasdaq / NQ / QQQ / tech futures vocabulary)
// New queries seeded for W23F.E to surface MNQ-centric content that Brave's
// S&P-dominant SEO would otherwise never return.
export const MNQ_QUERY_TEMPLATES: string[] = [
  // ── Parametric trend-follow — NQ-specific vocabulary
  "9 21 EMA pullback continuation MNQ Nasdaq futures",
  "20 50 SMA crossover MNQ Nasdaq micro futures rules",
  "supertrend 10 3 MNQ Nasdaq futures day trading",
  "MACD 12 26 9 momentum MNQ NQ futures strategy",
  "ATR 14 breakout NQ Nasdaq futures continuation",
  // ── Nasdaq-specific mean-reversion
  "RSI 14 oversold NQ Nasdaq futures reversal intraday",
  "Bollinger band 2 standard deviation fade NQ futures",
  "VWAP rejection MNQ Nasdaq tech futures fade",
  // ── Nasdaq session / range
  "opening range breakout 15 minute MNQ Nasdaq futures",
  "pre-market high low break MNQ NQ Nasdaq futures",
  "London NY overlap reversal NQ Nasdaq futures rules",
  "failed opening range breakout MNQ Nasdaq reversal",
  // ── ICT on Nasdaq — engine: silver_bullet.py, judas_swing.py on NQ
  "ICT silver bullet NQ MNQ Nasdaq 10am AM window strategy",
  "ICT FVG fair value gap MNQ Nasdaq micro futures entry",
  "ICT order block MNQ NQ Nasdaq futures strategy",
  "SMC SMT divergence NQ ES Nasdaq correlated futures",
  // ── Volume profile on Nasdaq
  "volume profile POC VAH VAL rejection NQ Nasdaq futures",
  "anchored VWAP HTF MNQ Nasdaq rejection continuation",
  // ── QQQ / tech-sector correlation
  "QQQ futures strategy day trading NQ Nasdaq",
  "tech sector momentum NQ Nasdaq futures setup rules",
  "Nasdaq 100 breakout strategy futures intraday rules",
  // ── Funded trader / prop firm specific
  "Topstep funded trader MNQ Nasdaq strategy windowed",
  "MFFU funded MNQ Nasdaq consistency rules",
  // 2026-06-27 operator keyword extension — YouTube-led discovery pivot.
  "MNQ intraday trend following",
];

// W23F.E — MCL group (crude / WTI / CL / oil vocabulary)
// New queries seeded for W23F.E to surface MCL-centric content. Crude oil
// strategies have a completely different driver set (inventory reports,
// geopolitical, supply/demand) that never appears in S&P query results.
export const MCL_QUERY_TEMPLATES: string[] = [
  // ── Inventory report plays — engine: news_fade_mco
  "crude oil inventory EIA report fade strategy futures",
  "WTI crude oil API inventory surprise trade setup",
  "MCL micro crude inventory report day trading rules",
  "CL crude oil DOE EIA report momentum strategy",
  // ── Parametric breakout / ATR on crude
  "MCL crude oil ATR 14 breakout day trading rules",
  "WTI crude oil ATR breakout continuation futures",
  "CL crude oil Keltner 20 2 channel breakout futures",
  "crude oil Donchian 20 channel breakout strategy",
  // ── Session-based crude strategies
  "crude oil opening range breakout 5 minute MCL rules",
  "WTI crude oil London open breakout session strategy",
  "MCL crude oil session high low fade intraday",
  "crude oil Asian session range RTH break strategy",
  // ── Mean-reversion on crude
  "crude oil VWAP rejection HOD LOD fade WTI CL",
  "WTI crude oil RSI 14 oversold reversal intraday",
  "crude oil Bollinger band 2 standard deviation fade futures",
  // ── Trend following on crude
  "WTI crude oil 9 21 EMA trend continuation day trading",
  "CL crude oil supertrend 10 3 strategy futures rules",
  "crude oil MACD 12 26 9 pullback strategy",
  // ── Supply / demand and geopolitical news fade
  "crude oil supply demand level fade WTI strategy",
  "WTI crude oil news fade geopolitical risk micro futures",
  // ── Funded trader / prop firm specific
  "Topstep funded trader MCL crude oil windowed strategy",
  "MFFU funded MCL micro crude consistency rules",
  // 2026-06-27 operator keyword extension — YouTube-led discovery pivot.
  "MCL session trading setup",
  "MCL intraday trend continuation",
];

// ─── W23F.V (2026-05-19) — Operator-curated discovery query set ──────────────
// REPLACES the W23F.P 44-query concept-targeted set.
//
// Operator (swayz032) explicitly chose these 8 keywords as the canonical
// discovery query set after V4/V5 testing showed they produce higher-quality,
// rules-based, futures-specific content vs the previous 44 concept queries.
// Concept families (SMC/ICT/Wyckoff/VP/order-flow/indicator-specific) are
// IMPLICITLY captured: "futures A+ setups" surfaces SMC/ICT content, "futures
// indicators" surfaces Bollinger/MACD/RSI content, "futures trend trading"
// surfaces EMA/Supertrend content, etc.
//
// All output still passes framework-overlay → Style C 33/33/33 + sizing 6/6/18
// + per-symbol liquidity caps. Format invariants preserved.
//
// DO NOT MODIFY without operator sign-off — these are the production query set.
// Exported for unit testing (keyword-presence assertions in test suite).
export const OPERATOR_QUERY_TEMPLATES: string[] = [
  "futures trading strategies rules",
  "futures 4 hr strategy",
  "futures 15min strategy",
  "futures 5min strategy",
  "futures 1hr strategy",
  "futures indicators",
  "futures trading A+ setups",
  "futures trend trading strategy",
  // 2026-06-27 operator keyword extension — YouTube-led discovery pivot.
  // "Opening Range Breakout 15 min" SKIPPED — near-duplicate of
  // "opening range breakout 15 minute MES rules" in MES_QUERY_TEMPLATES.
  "futures intraday momentum setup",
  "Initial Balance breakout futures",
  "VWAP deviation bands day trade",
  "naked POC futures target strategy",
  "first hour futures trading strategy",
];

// Symbol-agnostic shared across all symbol groups via getQueryTemplatesForGroup.
const ALL_CONCEPT_QUERIES: string[] = [...OPERATOR_QUERY_TEMPLATES];

// ─── Rotation logic ───────────────────────────────────────────────────────────
//
// W23F.E — deterministic MES → MNQ → MCL cycle. The cycle index is persisted
// across process restarts via Option B: count completed `scout_cycle.started`
// audit_log rows and modulo 3. This requires no schema migration and is
// self-healing — the audit_log is append-only and accumulates history naturally.
//
// Persistence rationale: no key-value / settings table exists in the schema.
// Using audit_log count is:
//   - Zero-migration (audit_log already exists + indexed on action)
//   - Self-healing (restart from any state, counts are durable)
//   - Audit-visible (the audit trail itself drives the rotation)
//
// Failure mode: if DB is unreachable at cycle start, defaults to MES so the
// cycle still runs (fail-open; ORB monoculture is better than total skip).

export type SymbolGroup = "MES" | "MNQ" | "MCL";
const SYMBOL_GROUP_ROTATION: SymbolGroup[] = ["MES", "MNQ", "MCL"];

/**
 * Deterministic rotation: 0 → MES, 1 → MNQ, 2 → MCL, 3 → MES, ...
 * Exported for unit testing.
 */
export function pickSymbolGroupForCycle(cycleIndex: number): SymbolGroup {
  return SYMBOL_GROUP_ROTATION[((cycleIndex % 3) + 3) % 3];
}

/**
 * Return the query template array for a given symbol group.
 * Exported for unit testing.
 */
export function getQueryTemplatesForGroup(group: SymbolGroup): string[] {
  // W23F.P — every symbol group includes the concept-targeted queries to
  // surface diverse strategy families (SMC, ICT, Wyckoff, VP, order flow,
  // indicator-specific, mean-reversion, session-pattern). The symbol-specific
  // queries focus on contract specs; the concept queries focus on the edge
  // hypothesis. The LLM extractor then identifies the market per source.
  const base = (() => {
    switch (group) {
      case "MES": return MES_QUERY_TEMPLATES;
      case "MNQ": return MNQ_QUERY_TEMPLATES;
      case "MCL": return MCL_QUERY_TEMPLATES;
    }
  })();
  return [...base, ...ALL_CONCEPT_QUERIES];
}

/**
 * W23F.E — Resolve current cycle index from audit_log row count.
 *
 * Counts completed `scout_cycle.started` rows (append-only, never deleted).
 * The count is the number of cycles PREVIOUSLY completed; the next cycle index
 * is exactly that count. modulo-3 rotation is applied by the caller.
 *
 * Returns 0 on DB error so the cycle defaults to MES (fail-open).
 */
export async function resolveCycleIndex(): Promise<number> {
  try {
    const rows = await db
      .select({ n: drizzleCount() })
      .from(auditLog)
      .where(drizzleSql`${auditLog.action} = 'scout_cycle.started'`);
    const n = Number(rows[0]?.n ?? 0);
    return isNaN(n) ? 0 : n;
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "autonomous-scout: cycle index read failed, defaulting to 0 (MES)");
    return 0;
  }
}

// ─── 2026-06-27 daily-rotating-subset (freshness mechanism) ──────────────────
//
// Each 4h cycle fires only a deterministic window (wrap-around slice) of the full
// query pool rather than all queries at once. Benefits:
//   - YouTube API quota spread across the full keyword set over multiple cycles
//   - Each cycle surfaces different vocabulary → reduces SEO-monoculture bias
//   - No randomness: replay-deterministic, testable, auditable
//
// Default SCOUT_KEYWORD_SUBSET_SIZE = 16.
// At a ~80-110 combined query pool per group (post-2026-06-27 extension), a
// 16-query window rotates the entire pool every ~5-7 cycles (20-28 hours at the
// 4h cron cadence). Operator can raise the env var to fire more queries per cycle
// or lower it to stay tighter under quota limits.
//
// Fail-open contract: if the env var is missing / unparseable, or subsetSize >=
// pool.length, the full pool fires unchanged (identical to pre-2026-06-27 behavior).

/**
 * Default rotating-subset size when SCOUT_KEYWORD_SUBSET_SIZE env var is absent
 * or unparseable. Named constant — never use a bare magic number.
 */
const DEFAULT_SCOUT_KEYWORD_SUBSET_SIZE = 16;

/**
 * Returns a deterministic wrap-around window of `subsetSize` queries from `pool`
 * starting at `(cycleIndex % pool.length)`.
 *
 * Fail-open: returns a copy of the full pool when:
 *   - pool is empty
 *   - subsetSize <= 0, NaN, or non-finite
 *   - subsetSize >= pool.length (no slicing needed)
 *
 * Pure function — no I/O, no Math.random(), no Date.now(). Deterministic for
 * replay and tests: identical (pool, cycleIndex, subsetSize) → identical output.
 *
 * Exported for unit testing.
 */
export function getRotatingQuerySubset(
  pool: string[],
  cycleIndex: number,
  subsetSize: number,
): string[] {
  if (
    !pool.length ||
    !Number.isFinite(subsetSize) ||
    subsetSize <= 0 ||
    subsetSize >= pool.length
  ) {
    return [...pool];
  }
  const n = pool.length;
  const size = Math.floor(subsetSize);
  // Use double-modulo to handle any negative cycleIndex safely.
  const offset = ((cycleIndex % n) + n) % n;
  const result: string[] = [];
  for (let i = 0; i < size; i++) {
    result.push(pool[(offset + i) % n]);
  }
  return result;
}

const REDDIT_SUBS = ["FuturesTrading", "Daytrading", "algotrading"];

// YouTube title scoring — same regex as 5P's Parse Search Videos.
const POSITIVE_TITLE = /(how to|step by step|the rules|complete guide|tutorial|setup|strategy guide|backtested|exact rules|entry and exit|playbook|breaking down|explained|template|blueprint|profitable)/i;
const NEGATIVE_TITLE = /(why .* lose|why .* fail|don.t work|doesn.t work|warning|exposed|scam|truth about|reaction|podcast|interview|q.a|news|recap|vlog|motivation|mindset|story time)/i;

// W23H-postmortem-fix18 (2026-05-21) — operator: "WE NOT SWING TRADERS WE
// DAY TRADERS. SWING TRADERS NEEDS TO BE BAN AS A TERM AND THE SCREENSHOT
// VIDEOS". This is a HARD REJECT (not just a score penalty) — Trading
// Forge is intraday-only (4H bias + 15M/5M/1M execution), MFFU/Topstep
// EOD trailing drawdowns make multi-day holds incompatible with the
// risk model. Screenshot-only videos are also rejected — they show
// past trades without the rule-set that generated them.
const HARD_REJECT_TITLE = /\b(swing trad(?:er|ers|ing)|swing setup|hold(?:ing)? overnight|multi.?day hold|weekly chart strategy|monthly chart strategy|long.?term hold|position trad(?:er|ing)|screenshot(?:s)?|trade recap|my best trades|my trades this week|my trades today|recap of (?:my|this) trades|trade screenshots)\b/i;

// W23F.S (2026-05-19) — clickbait downweight + indicator-name upweight.
// E2E test discovered title scorer was favoring CLICKBAIT ("Make $500 a Day") over
// PARAMETRIC content ("Liquidity Sweep Strategy by BrandonTrades"). Direct fixes:
//   - CLICKBAIT_TITLE: -5 for money-promise titles (low parametric yield)
//   - INDICATOR_NAME_TITLE: +3 for titles naming specific indicators / archetypes
const CLICKBAIT_TITLE = /\b(make \$|made \$|earn(?:ed)? \$|\$\d+ ?(?:a|per) ?day|profit \$|easy money|prints? money|secret strategy|secret method|get rich|millionaire|6.figure|7.figure|life.changing|too easy|magic indicator|holy grail)\b/i;
const INDICATOR_NAME_TITLE = /\b(ema|sma|hma|dema|wma|rsi|macd|adx|atr|bollinger|bb |keltner|donchian|stochastic|stoch |vwap|cci|williams|supertrend|ichimoku|cumulative delta|cvd\b|order flow|volume profile|opening range|liquidity sweeps?|order block|fvg|fair value gap|smt |smc |ict |wyckoff|spring|breaker|silver bullet|judas|optimal trade entry|ote |poc |vah |val |displacement|imbalance|mean reversion|chandelier|fibonacci|fib retrace|pivot point)\b/i;
// Note: ORB is intentionally NOT in INDICATOR_NAME_TITLE — it's covered by NUMERIC_TITLE_PATTERNS
// when accompanied by a number ("15-minute ORB"). Bare "ORB" too generic for indicator bonus.

// Wave 11 (2026-05-17) — title-scoring numeric bonus. Videos with explicit numeric
// indicator patterns in title statistically have far higher parametric-extraction
// yield ("9 21 EMA" + tutorial >> "EMA pullback strategy" + tutorial). +3 bonus.
const NUMERIC_TITLE_PATTERNS: RegExp[] = [
  /\b\d{1,3}(?:\s*(?:and|\/|&|,)\s*|\s+)\d{1,3}\s+(?:ema|sma|hma|dema|alma|wma)\b/i, // "9 21 EMA", "9 and 21 EMA", "9/21 EMA"
  /\b(?:ema|sma|hma|dema|alma|wma)\s+\d{1,3}(?:\s*(?:and|\/|&|,)\s*|\s+)\d{1,3}\b/i,  // "EMA 9 21", "EMA 9 and 21"
  /\b(?:rsi|stoch|stochastic|cci|williams)[- ]?\d{1,3}\b/i,                            // "RSI 2", "RSI-14"
  /\b\d{1,3}[- ]?(?:minute|min|m)\s+(?:orb|opening range|breakout|squeeze)\b/i,        // "15-minute ORB"
  /\b(?:bollinger|keltner|donchian)\s*\d{1,3}\b/i,                                     // "Bollinger 20"
  /\b\d{1,3}\s*(?:tick|pt|point)\s+(?:stop|target)\b/i,                                 // "10-tick stop"
  /\b\d{1,3}(?:\s*(?:and|&|\/)\s*|\s+)\d{1,3}\s+(?:rsi|macd|stoch|crossover)\b/i,      // "2 and 5 RSI"
];

// Wave 11 — pre-extraction transcript quality gate. Skip the LLM call entirely when
// the transcript has NO numeric tokens AND NO structural-archetype keywords AND NO
// indicator-catalog names. Saves OpenAI tokens (~5K per skipped call) AND surfaces
// the empty-content cases for audit visibility. This is the upstream filter — the
// downstream prompt is still strict; this just stops obviously-empty inputs.
const TRANSCRIPT_STRUCTURAL_KEYWORDS = /\b(sweep|displacement|mss|fvg|order block|breaker|liquidity (?:grab|sweep|raid)|killzone|judas|silver bullet|otes?|ote entry|bos\b|choch|cisd|wyckoff|spring|upthrust|secondary test|poc|vah|val|imbalance|absorption|institutional|smart money|smc|ict)\b/i;
const TRANSCRIPT_INDICATOR_KEYWORDS = /\b(ema|sma|hma|dema|alma|wma|rsi|macd|adx|atr|bollinger|keltner|donchian|stochastic|vwap|cci|williams|supertrend|ichimoku|cumulative delta|order flow|volume profile|opening range|orb|gap|drift)\b/i;
const TRANSCRIPT_NUMERIC_TOKEN = /\b\d{1,4}(?:\.\d{1,2})?\b/;

export interface TranscriptQualityCheck {
  shouldExtract: boolean;
  numericTokens: number;
  hasStructuralKeyword: boolean;
  hasIndicatorKeyword: boolean;
  skipReason: null | "no_numeric_content" | "no_archetype_or_indicator" | "transcript_too_short";
}

/**
 * Wave 11 transcript quality pre-gate. Returns shouldExtract:false ONLY when the
 * transcript fails all three signal channels — no numbers, no structural keywords,
 * no indicator names. Single hit on any channel → shouldExtract:true (let the LLM
 * try; refusal is still a legitimate output if narration is genuinely vague).
 *
 * Exported for testing.
 */
export function checkTranscriptQuality(transcript: string): TranscriptQualityCheck {
  if (transcript.length < 300) {
    return { shouldExtract: false, numericTokens: 0, hasStructuralKeyword: false, hasIndicatorKeyword: false, skipReason: "transcript_too_short" };
  }
  // Count distinct numeric tokens (not just one — many tutorial videos mention
  // "2024" once and never another number; that's not a parametric strategy).
  const numericMatches = transcript.match(/\b\d{1,4}(?:\.\d{1,2})?\b/g) ?? [];
  const numericTokens = new Set(numericMatches).size;
  const hasStructuralKeyword = TRANSCRIPT_STRUCTURAL_KEYWORDS.test(transcript);
  const hasIndicatorKeyword = TRANSCRIPT_INDICATOR_KEYWORDS.test(transcript);

  // Require at least 3 distinct numeric tokens (filters out videos that mention
  // "2024" + "5 minute" but no actual indicator params) OR a structural keyword
  // OR an indicator keyword. If all three channels are empty → skip.
  const hasNumericContent = numericTokens >= 3;
  if (!hasNumericContent && !hasStructuralKeyword && !hasIndicatorKeyword) {
    return {
      shouldExtract: false,
      numericTokens,
      hasStructuralKeyword: false,
      hasIndicatorKeyword: false,
      skipReason: "no_archetype_or_indicator",
    };
  }
  // Edge case: indicator keyword present but zero numeric tokens — still allow
  // (could be structural archetype using indicator vocabulary, e.g. "VWAP rejection").
  return {
    shouldExtract: true,
    numericTokens,
    hasStructuralKeyword,
    hasIndicatorKeyword,
    skipReason: null,
  };
}

/**
 * Wave 11 title scoring with numeric bonus. Returns score in approximate range
 * [-3, +5]. Caller filters to score > -3 (well-known threshold from Pass 21).
 *
 * Exported for testing. DO NOT change this function's signature or behavior —
 * W23G.10 tests (wave23g-title-scorer-clickbait-tune.test.ts) import it directly.
 */
export function scoreVideoTitle(title: string): { score: number; positiveHit: boolean; negativeHit: boolean; numericHit: boolean; clickbaitHit: boolean; indicatorHit: boolean; hardRejectHit?: boolean } {
  // W23H-postmortem-fix18: hard-reject swing-trader + screenshot-recap videos.
  // Returns score=-99 (below any eligibility threshold) and hardRejectHit=true.
  // Day-trader-only mandate — see CLAUDE.md §4 (4H bias + intraday execution).
  if (HARD_REJECT_TITLE.test(title)) {
    return { score: -99, positiveHit: false, negativeHit: false, numericHit: false, clickbaitHit: false, indicatorHit: false, hardRejectHit: true };
  }
  let score = 0;
  const positiveHit = POSITIVE_TITLE.test(title);
  const negativeHit = NEGATIVE_TITLE.test(title);
  const numericHit = NUMERIC_TITLE_PATTERNS.some((re) => re.test(title));
  // W23F.S additions:
  const clickbaitHit = CLICKBAIT_TITLE.test(title);
  const indicatorHit = INDICATOR_NAME_TITLE.test(title);
  if (positiveHit) score += 2;
  if (numericHit) score += 3;       // Wave 11 — strongest signal for parametric extractability
  if (indicatorHit) score += 3;     // W23F.S — explicit indicator names = high parametric yield
  // W23F.X (2026-05-19): critique/podcast/vlog still dominates (those genuinely have no rules).
  // BUT clickbait titles often wrap real parametric content (futures creators use '$X/day' for
  // engagement). Operator caught this — Novo Legacy '4hr candle $500/day' has real 4hr continuation
  // rules; was filtered by score=-2 → operator forced re-evaluation. Clickbait now -3 (was -5,
  // hard floor -2) so a positive+indicator hit (+5) can offset clickbait (-3) to reach +2.
  if (negativeHit) score = Math.min(score - 5, -2);
  // W23G.10 (2026-05-19): when both an explicit indicator name AND clickbait are
  // present, the indicator term is a stronger educational signal than the clickbait
  // is a noise signal. Reduce clickbait penalty from -3 to -1 in that combo so
  // INDICATOR(+3) + CLICKBAIT(-1) = +2 net-positive. Standalone clickbait (no
  // indicator hit) retains the full -3 penalty.
  if (clickbaitHit) score -= indicatorHit ? 1 : 3;
  return { score, positiveHit, negativeHit, numericHit, clickbaitHit, indicatorHit };
}

// W23F.X — eligibility threshold for autonomous-scout-runner. Was 3 (too strict);
// lowered to 0 so clickbait-titled-but-parametric content (long-form $X/day videos
// with real rules) enters the pipeline. Critique/podcast videos still excluded
// (their score forced to <= -2 by the negativeHit branch).
export const TITLE_SCORE_ELIGIBILITY_THRESHOLD = 0;

/**
 * W23G.6 — description-aware combined scoring.
 *
 * Extends scoreVideoTitle with snippet.description signal at HALF weight.
 * Description is noisier than title (often auto-generated or marketing copy),
 * so its contribution is halved before combining.
 *
 * combined_score = title_score + Math.round(description_score / 2)
 *
 * The same POSITIVE / NEGATIVE / CLICKBAIT / INDICATOR / NUMERIC regexes are
 * applied to description so the scoring logic stays consistent. NEGATIVE in
 * description is also halved — a description mentioning "warning" on a
 * parametric video shouldn't be as damaging as a negative title.
 *
 * CRITICAL: scoreVideoTitle is UNCHANGED — this is a NEW wrapper. All existing
 * callers and tests continue to use scoreVideoTitle directly.
 *
 * Exported for testing.
 */
export function scoreVideoContent(
  title: string,
  description: string,
): { titleScore: number; combinedScore: number; titleResult: ReturnType<typeof scoreVideoTitle> } {
  const titleResult = scoreVideoTitle(title);
  const titleScore = titleResult.score;

  if (!description || description.trim().length === 0) {
    return { titleScore, combinedScore: titleScore, titleResult };
  }

  // Compute description raw score using the same regexes at half weight.
  let descScore = 0;
  const descPositive = POSITIVE_TITLE.test(description);
  const descNegative = NEGATIVE_TITLE.test(description);
  const descNumeric = NUMERIC_TITLE_PATTERNS.some((re) => re.test(description));
  const descClickbait = CLICKBAIT_TITLE.test(description);
  const descIndicator = INDICATOR_NAME_TITLE.test(description);
  if (descPositive) descScore += 2;
  if (descNumeric) descScore += 3;
  if (descIndicator) descScore += 3;
  if (descNegative) descScore = Math.min(descScore - 5, -2);
  if (descClickbait) descScore -= descIndicator ? 1 : 3;

  const combinedScore = titleScore + Math.round(descScore / 2);
  return { titleScore, combinedScore, titleResult };
}

interface BraveResult { title: string; url: string; description?: string }
interface ConceptCandidate {
  name: string;
  conceptName: string;  // snake_case
  webSourceUrl: string;
  webThesis: string;
}

async function braveSearch(query: string): Promise<BraveResult[]> {
  if (!BRAVE_API_KEY) return [];
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
  try {
    const res = await fetch(url, {
      headers: { "X-Subscription-Token": BRAVE_API_KEY, "Accept": "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const j = await res.json() as any;
    return ((j?.web?.results ?? []) as any[]).map((r) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      description: String(r.description ?? ""),
    })).filter((r) => r.url && r.title);
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e), query }, "autonomous-scout: brave search failed");
    return [];
  }
}

// Pass 21 (2026-05-12) — Exa neural search as second discovery source. Unlike
// Brave (SEO-biased), Exa is neural — surfaces fresher/less-SEO'd content.
// 500 searches/month → ~16/day budget. We use ~1 Exa call per cycle, so plenty.
// On 402/quota errors, returns [] silently and Brave handles everything.
async function exaSearch(query: string): Promise<BraveResult[]> {
  if (!EXA_API_KEY) return [];
  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": EXA_API_KEY },
      body: JSON.stringify({
        query,
        num_results: 8,
        type: "neural",
        useAutoprompt: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      if (res.status === 402 || res.status === 429) {
        logger.warn({ status: res.status, query }, "autonomous-scout: Exa quota/billing — falling through to Brave only");
      }
      return [];
    }
    const j = await res.json() as any;
    return ((j?.results ?? []) as any[]).map((r) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      description: String(r.text ?? r.summary ?? "").slice(0, 500),
    })).filter((r) => r.url && r.title);
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e), query }, "autonomous-scout: exa search failed");
    return [];
  }
}

function deriveConceptName(title: string): string {
  // Extract a short, snake_case concept name from a Brave result title.
  // Drops boilerplate words and caps at 50 chars.
  const cleaned = title
    .replace(/\b(20\d{2}|the|best|top|10|complete|guide|to|how|trading|trade|strategy|futures|review|tutorial|step|by|for|day|traders?)\b/gi, " ")
    .replace(/[^a-z0-9\s]/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  return cleaned || "unknown_concept";
}

// Wave 17 (2026-05-18) — postLayerMention now forwards the FULL parametric DSL
// when the caller has it (from a rich extraction). Wave 16 fixed the scout-extract
// route to preserve LLM-emitted entry_indicator/entry_params/direction/etc., but
// THIS function was still only forwarding prose strings, stripping the rich fields
// at the SECOND boundary. Deep-scan confirmed: scout cycles produced 10 mentions
// post-Wave-16 but `extracted_idea` still had {entry_params:null, entry_indicator:null}
// for all of them because postLayerMention dropped those fields here.
//
// `richIdea` is the optional payload — if present, ALL its DSL fields propagate
// through to /scout-ideas/pending, which stores them in strategy_pending_mentions.
// CV-only fallback paths (Wave 9 mentions, web cite-only) pass richIdea=undefined
// and behave as before.
async function postLayerMention(opts: {
  conceptName: string;
  market: "MES" | "MNQ" | "MCL";
  layer: "web" | "youtube" | "reddit";
  sourceProvider: string;
  sourceUrl: string;
  thesis: string;
  entryRules: string;
  exitRules: string;
  riskRules: string;
  timeframe?: string;
  richIdea?: Record<string, unknown>;  // Wave 17 — pass entire LLM-extracted idea here
  seededSymbol?: SymbolGroup;           // W23F.E — which rotation group seeded this mention
  correlationId: string;                // W23F.G fix — forward cycle correlation_id end-to-end
}): Promise<{ accepted: boolean; status?: string; bucketId?: string }> {
  try {
    const body: Record<string, unknown> = {
      thesis: opts.thesis,
      market: opts.market,
      timeframe: opts.timeframe ?? "5m",
      entry_rules: opts.entryRules,
      exit_rules: opts.exitRules,
      risk_rules: opts.riskRules,
      source_url: opts.sourceUrl,
      regime: "TRENDING",
      concept_name: opts.conceptName,
      source_provider: opts.sourceProvider,
      layer: opts.layer,
      is_cross_validation_result: false,
    };
    // Wave 17 — forward structured DSL when caller has it.
    if (opts.richIdea && typeof opts.richIdea === "object") {
      const r = opts.richIdea;
      if (typeof r.entry_indicator === "string")    body.entry_indicator       = r.entry_indicator;
      if (typeof r.entry_archetype === "string")    body.entry_archetype       = r.entry_archetype;
      if (r.entry_params && typeof r.entry_params === "object")  body.entry_params  = r.entry_params;
      if (typeof r.entry_condition === "string")    body.entry_condition       = r.entry_condition;
      if (typeof r.entry_type === "string")         body.entry_type            = r.entry_type;
      if (typeof r.direction === "string")          body.direction             = r.direction;
      if (typeof r.exit_type === "string")          body.exit_type             = r.exit_type;
      if (r.exit_params && typeof r.exit_params === "object")    body.exit_params   = r.exit_params;
      if (typeof r.stop_loss_atr_multiple === "number")          body.stop_loss_atr_multiple   = r.stop_loss_atr_multiple;
      if (typeof r.take_profit_atr_multiple === "number")        body.take_profit_atr_multiple = r.take_profit_atr_multiple;
      if (typeof r.preferred_regime === "string")   body.preferred_regime      = r.preferred_regime;
      if (typeof r.session_filter === "string")     body.session_filter        = r.session_filter;
      if (typeof r.extraction_confidence === "number") body.extraction_confidence = r.extraction_confidence;
      if (typeof r.name === "string")               body.name                  = r.name;
      if (typeof r.max_contracts === "number")      body.max_contracts         = r.max_contracts;
      if (typeof r.base_contracts === "number")     body.base_contracts        = r.base_contracts;
      if (typeof r.tier_increment === "number")     body.tier_increment        = r.tier_increment;
      // W23F.B field-strip fix (2026-05-19) — same pattern as Wave 17 fixed for entry_indicator.
      // The 5 new entry_quality fields produced by the LLM must propagate to /scout-ideas/pending.
      if (Array.isArray(r.confluence_factors))                                  body.confluence_factors    = r.confluence_factors;
      if (typeof r.min_factors_satisfied === "number")                          body.min_factors_satisfied = r.min_factors_satisfied;
      if (r.source_claim_win_rate === null || typeof r.source_claim_win_rate === "number") body.source_claim_win_rate = r.source_claim_win_rate;
      if (r.source_claim_avg_r === null || typeof r.source_claim_avg_r === "number")       body.source_claim_avg_r    = r.source_claim_avg_r;
      if (Array.isArray(r.symbols) && r.symbols.length > 0)                     body.symbols               = r.symbols;
      // Override regime + timeframe with rich-idea values when present
      if (typeof r.preferred_regime === "string" && r.preferred_regime.length > 0) body.regime = r.preferred_regime;
      else if (typeof (r as any).regime === "string") body.regime = (r as any).regime;
      if (typeof r.timeframe === "string") body.timeframe = r.timeframe;
    }
    // W23F.E — tag the mention with the seeded symbol group so the graduator
    // can prefer it when LLM extraction is ambiguous about the market symbol.
    // Stored inside extracted_idea JSONB as __scout_seeded_symbol (double-underscore
    // prefix = scout metadata, not LLM output) — no new column migration needed.
    if (opts.seededSymbol) {
      body.__scout_seeded_symbol = opts.seededSymbol;
    }
    const res = await fetch(`${BACKEND_URL}/api/agent/scout-ideas/pending`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-correlation-id": opts.correlationId,  // W23F.G fix — propagate cycle correlationId
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const respBody = await res.json().catch(() => ({})) as any;
    return { accepted: Boolean(respBody?.accepted), status: respBody?.status, bucketId: respBody?.bucket_id };
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e), concept: opts.conceptName, layer: opts.layer }, "autonomous-scout: postLayerMention failed");
    return { accepted: false };
  }
}

// Wave 9 (2026-05-17) — direct HTTP fetch + plain-text extraction only.
// ScrapingBee fallback removed; the operator confirmed the service was
// exhausted/disabled. Most futures-strategy blogs (tradingsim, edgeful,
// quantifiedstrategies, optimusfutures) are plain HTML — no JS needed. We do a
// vanilla fetch with a Mozilla UA, strip script/style/HTML, and return text.
// Cost: $0. Pages that require JS-rendering return "" silently.
async function fetchWebPageBody(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; TradingForge-Scout/1.0)",
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const raw = await res.text();
      // Strip script/style/nav/footer chrome, collapse whitespace
      const body = raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
        .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
      if (body.length > 200) return body.slice(0, 20_000);
    }
  } catch (e) {
    logger.debug({ err: e instanceof Error ? e.message : String(e), url }, "autonomous-scout: direct web body fetch failed");
  }
  return "";
}

// W23G.5 (2026-05-19) — Multi-order YouTube sampling + per-channel cap.
//
// Track O (deepscan11 2026-07-02) — CORRECTED quota math:
//   Per concept: 2 passes (captioned + uncaptioned) × 3 orders (relevance/viewCount/date)
//     = 6 API calls × 100 units = 600 units/concept
//   Per cycle: TARGET_CONCEPTS (default 5) × 600 = 3,000 units/cycle
//   Per day: 6 cycles (every 4h) × 3,000 = 18,000 units/day
//   Free tier cap: 10,000 units/day → EXCEEDS by 80%
//
// Mitigation: YOUTUBE_DAILY_QUOTA_BUDGET (default 9000) enforced in-memory per UTC day.
// Budget guard fires at concept granularity in fetchYouTubeTopVideos(), not per-call.
//
// (Previous stale comment said "8 queries × 3 calls × 100 = 2400/day" — this was
// based on the pre-W23G.4 single-pass design and did not account for the second pass
// or the cycles/day factor. 2400 was wrong by ~7.5×.)
//
// Discovery order semantics:
//   relevance(25) — YouTube's default ranking; surfaces SEO-dominant content
//   viewCount(15)  — surfaces high-view educational content (may not be top-SEO)
//   date(10)       — surfaces the freshest uploads; catches new educators
//
// Per-channel cap (2) is applied BEFORE transcript fetch to preserve transcript
// quota for diverse channels (BrandonTrades / TradingLab domination prevention).
//
// W23G.6: scoring uses scoreVideoContent (title + description at half weight)
// for the eligibility threshold. The discovery_order tag is preserved on each
// video candidate for downstream observability.

interface YouTubeCandidate {
  videoId: string;
  url: string;
  title: string;
  description: string;
  channel: string;
  titleScore: number;
  combinedScore: number;
  numericHit: boolean;
  discoveryOrder: "relevance" | "viewCount" | "date";
}

/** Fetch one order page from YouTube Data API. Returns raw candidates.
 *
 * @param includeCaption  When true, adds `videoCaption=closedCaption` to the
 *   request (Pass 1 — high-yield captioned content). When false, omits the
 *   filter (Pass 2 — uncaptioned recovery pass). W23G.4.
 */
async function _fetchYouTubeOrder(
  query: string,
  order: "relevance" | "viewCount" | "date",
  maxResults: number,
  includeCaption = true,
): Promise<YouTubeCandidate[]> {
  const base = "https://www.googleapis.com/youtube/v3/search";
  const paramObj: Record<string, string> = {
    part: "snippet",
    q: query,
    type: "video",
    videoDuration: "medium",
    relevanceLanguage: "en",
    maxResults: String(maxResults),
    order,
    key: YOUTUBE_API_KEY,
  };
  // W23G.4 — only add caption filter for Pass 1.
  if (includeCaption) {
    paramObj.videoCaption = "closedCaption";
  }
  const params = new URLSearchParams(paramObj);
  // Track O (deepscan11, 2026-07-02): count quota before sending so we know the
  // units were consumed even if the response fails.
  _ytConsumeQuota(YOUTUBE_QUOTA_UNITS_PER_CALL);
  const res = await fetch(`${base}?${params.toString()}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    // Track O (deepscan11, 2026-07-02): on 403/quota — emit audit + Discord WARN
    if (res.status === 403 || res.status === 429) {
      logger.warn({ status: res.status, query, order }, "autonomous-scout: YouTube API quota/auth error — emitting scout.youtube_quota_exhausted");
      _emitYtQuotaExhausted().catch(() => {});
    } else {
      logger.warn({ status: res.status, query, order }, "autonomous-scout: YouTube API call failed");
    }
    return [];
  }
  const j = (await res.json()) as any;
  const items = (j.items ?? []) as any[];
  const out: YouTubeCandidate[] = [];
  for (const item of items) {
    const vid = item?.id?.videoId;
    const title = String(item?.snippet?.title ?? "").trim();
    const description = String(item?.snippet?.description ?? "").trim();
    const channel = String(item?.snippet?.channelTitle ?? "").trim();
    if (!vid || !title) continue;
    const { titleScore, combinedScore, titleResult } = scoreVideoContent(title, description);
    out.push({
      videoId: vid,
      url: `https://www.youtube.com/watch?v=${vid}`,
      title,
      description,
      channel,
      titleScore,
      combinedScore,
      numericHit: titleResult.numericHit,
      discoveryOrder: order,
    });
  }
  return out;
}

// Wave 9 (2026-05-17) — YouTube Data API v3 search.list is the sole discovery
// path. Clean JSON, no regex parsing, official titles.
//
// W23G.5 (2026-05-19) — upgraded from single order=relevance call to 3-order
// parallel sampling. Dedupe by videoId; per-channel cap of 2. Audit log emits
// diversity stats per cycle call.
//
// W23G.6 (2026-05-19) — eligibility now uses combined_score (title + description
// at half weight) rather than title-only score. Threshold unchanged at > -3 but
// applied to combined_score.
// Exported so carter-actions.ts can call YouTube discovery without re-implementing
// the two-pass captioned+uncaptioned strategy. Returns candidate list (title+url) only —
// callers MUST NOT auto-extract transcripts; that is the autonomous-cycle's job.
export async function fetchYouTubeTopVideos(
  conceptName: string,
  cycleCorrelationId?: string,
): Promise<Array<{ url: string; title: string; source_pass: "captioned" | "uncaptioned"; sourceQuery: string; titleScore: number; combinedScore: number; videoId: string }>> {
  if (!YOUTUBE_API_KEY) {
    logger.warn({ conceptName }, "autonomous-scout: YOUTUBE_DATA_API_KEY not set — YouTube layer disabled");
    return [];
  }
  // Track O (deepscan11, 2026-07-02): budget guard — each concept costs 6 calls × 100 = 600 units.
  // Check BEFORE making any calls so we don't burn quota and then skip.
  const UNITS_PER_CONCEPT = 6 * YOUTUBE_QUOTA_UNITS_PER_CALL; // 6 API calls × 100 = 600
  if (_ytBudgetRemaining() < UNITS_PER_CONCEPT) {
    logger.warn(
      { conceptName, budgetRemaining: _ytBudgetRemaining(), budgetTotal: YOUTUBE_DAILY_QUOTA_BUDGET },
      "autonomous-scout: YouTube daily budget exhausted — skipping YouTube layer for this concept",
    );
    await _emitYtQuotaExhausted(cycleCorrelationId);
    return [];
  }
  const human = conceptName.replace(/_/g, " ");
  const query = `${human} futures strategy rules`;
  try {
    // W23G.4 — Two-pass search strategy.
    // Pass 1 (captioned, high-yield): videoCaption=closedCaption ensures 96%+ transcript
    //   success rate. This is the primary discovery channel.
    // Pass 2 (uncaptioned, recovery): no caption filter — catches high-value channels
    //   (Novo Legacy, JackTrades, specialist educators) that don't caption. Operator
    //   audit (tmp-factory-audit/manual-youtube-scout-v6.mjs) showed these channels
    //   account for ~30% of quality content. Pass 2 videos are tagged "uncaptioned"
    //   so the retry queue can apply appropriate backoff policy.
    //
    // W23G.5 — 3 parallel calls per pass: relevance(25) + viewCount(15) + date(10)
    const [p1Relevance, p1ViewCount, p1Date] = await Promise.all([
      _fetchYouTubeOrder(query, "relevance", 25, true),
      _fetchYouTubeOrder(query, "viewCount", 15, true),
      _fetchYouTubeOrder(query, "date", 10, true),
    ]);

    // Collect Pass 1 (captioned) videoIds for deduplication in Pass 2
    const pass1Ids = new Set<string>();
    const seenIds = new Set<string>();
    const allCandidatesPass1: YouTubeCandidate[] = [];
    for (const c of [...p1Relevance, ...p1ViewCount, ...p1Date]) {
      if (seenIds.has(c.videoId)) continue;
      seenIds.add(c.videoId);
      pass1Ids.add(c.videoId);
      allCandidatesPass1.push(c);
    }

    // Pass 2 (uncaptioned, recovery) — same 3-order parallel calls WITHOUT caption filter
    const [p2Relevance, p2ViewCount, p2Date] = await Promise.all([
      _fetchYouTubeOrder(query, "relevance", 25, false),
      _fetchYouTubeOrder(query, "viewCount", 15, false),
      _fetchYouTubeOrder(query, "date", 10, false),
    ]);

    // Pass 2 only adds videos NOT already in Pass 1 (additive, never duplicates)
    const allCandidatesPass2: YouTubeCandidate[] = [];
    for (const c of [...p2Relevance, ...p2ViewCount, ...p2Date]) {
      if (seenIds.has(c.videoId)) continue;  // already found in Pass 1
      seenIds.add(c.videoId);
      allCandidatesPass2.push(c);
    }

    const allCandidates = [...allCandidatesPass1, ...allCandidatesPass2];

    // W23G.6 — filter on combined_score (title + description half-weight)
    let pool = allCandidates.filter((c) => c.combinedScore > -3);
    if (pool.length === 0) pool = [...allCandidates];  // fallback: no eligible → use all
    pool.sort((a, b) => b.combinedScore - a.combinedScore);

    // W23G.5 — per-channel cap: max 2 videos per channelTitle to prevent
    // BrandonTrades / TradingLab domination of the candidate pool.
    const channelCounts = new Map<string, number>();
    const cappedPool: YouTubeCandidate[] = [];
    for (const c of pool) {
      const count = channelCounts.get(c.channel) ?? 0;
      if (count >= 2) continue;
      channelCounts.set(c.channel, count + 1);
      cappedPool.push(c);
    }

    // W23G.5 — audit log: diversity stats for observability
    const uniqueChannelCount = new Set(allCandidates.map((c) => c.channel)).size;
    const maxPerChannelSeen = allCandidates.reduce((acc, c) => {
      const k = c.channel;
      const n = (acc.counts.get(k) ?? 0) + 1;
      acc.counts.set(k, n);
      acc.max = Math.max(acc.max, n);
      return acc;
    }, { counts: new Map<string, number>(), max: 0 }).max;

    db.insert(auditLog).values({
      action: "scout.diversity_stats",
      entityType: "scout_youtube",
      entityId: cycleCorrelationId ?? conceptName,
      result: {
        concept_name: conceptName,
        total_unique_videos: allCandidates.length,
        pass1_captioned_count: allCandidatesPass1.length,
        pass2_uncaptioned_count: allCandidatesPass2.length,
        unique_channels: uniqueChannelCount,
        max_per_channel_seen: maxPerChannelSeen,
        order_relevance_count: p1Relevance.length + p2Relevance.length,
        order_viewcount_count: p1ViewCount.length + p2ViewCount.length,
        order_date_count: p1Date.length + p2Date.length,
        eligible_after_threshold: pool.length,
        after_channel_cap: cappedPool.length,
      } as Record<string, unknown>,
      status: "success",
      decisionAuthority: "autonomous_scout",
      correlationId: cycleCorrelationId ?? conceptName,
    }).catch((err) => {
      logger.warn({ err: err instanceof Error ? err.message : String(err), conceptName }, "autonomous-scout: diversity_stats audit write failed (non-blocking)");
    });

    const top = cappedPool.slice(0, 3);  // W23G.4: up to 3 videos (was 2) to absorb Pass 2
    logger.info({
      query,
      totalUnique: allCandidates.length,
      pass1Captioned: allCandidatesPass1.length,
      pass2Uncaptioned: allCandidatesPass2.length,
      uniqueChannels: uniqueChannelCount,
      afterCap: cappedPool.length,
      picked: top.length,
      provider: "youtube_data_api",
    }, "autonomous-scout: YouTube two-pass discovery done (W23G.4)");

    // Log per-video combined score for W23G.6 observability
    for (const v of top) {
      logger.debug({
        videoId: v.videoId,
        title: v.title,
        channel: v.channel,
        discoveryOrder: v.discoveryOrder,
        titleScore: v.titleScore,
        combinedScore: v.combinedScore,
        sourcePass: pass1Ids.has(v.videoId) ? "captioned" : "uncaptioned",
      }, "autonomous-scout: video scored (W23G.6)");
    }

    return top.map((c) => ({
      url: c.url,
      title: c.title,
      source_pass: (pass1Ids.has(c.videoId) ? "captioned" : "uncaptioned") as "captioned" | "uncaptioned",
      sourceQuery: query,
      titleScore: c.titleScore,
      combinedScore: c.combinedScore,
      videoId: c.videoId,
    }));
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "autonomous-scout: YouTube API error");
    return [];
  }
}

function extractYoutubeId(url: string): string | null {
  const m = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

// Wave 9 (2026-05-17) — single transcript provider: `youtube-transcript` npm.
// ScrapingBee, Supadata, and ScrapingDog fallbacks removed (services exhausted
// or disabled). The npm package hits YouTube's internal timedtext endpoint
// (same one the browser uses for "Show transcript"). Per-IP rate limits exist
// but are generous; if a transcript is unavailable we just skip the video.
async function fetchYouTubeTranscript(youtubeUrl: string): Promise<{ text: string; provider: string }> {
  const vid = extractYoutubeId(youtubeUrl);
  if (!vid) return { text: "", provider: "none" };
  try {
    const { YoutubeTranscript } = await import("youtube-transcript");
    const segments = await YoutubeTranscript.fetchTranscript(vid);
    if (Array.isArray(segments) && segments.length > 0) {
      const text = segments.map((s: any) => String(s.text ?? "")).join(" ")
        .replace(/&amp;/gi, "&")
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 200) return { text, provider: "youtube_transcript_npm" };
    }
  } catch (e) {
    logger.debug({ err: e instanceof Error ? e.message : String(e), vid }, "autonomous-scout: youtube-transcript fetch failed");
  }
  return { text: "", provider: "none" };
}

// Back-compat alias — older callers reference the previous chained name.
async function fetchTranscriptWithFallback(youtubeUrl: string): Promise<{ text: string; provider: string }> {
  return fetchYouTubeTranscript(youtubeUrl);
}

// Pass 21 (2026-05-12) — TPM-aware throttle. OpenAI's gpt-5-mini caps at
// 500K tokens/minute. A scout-extract call costs ~15K tokens (mostly cached).
// At 6 concepts × 2 YT vids = 12 extracts/cycle, burst-fired they hit 180K
// tokens in a few seconds — close to the per-minute cap. Adding a 250ms
// inter-call delay spreads the burst across ~3 seconds, which keeps us under
// 500K tokens/minute even in worst case.
let _lastExtractAt = 0;
const SCOUT_EXTRACT_MIN_INTERVAL_MS = 250;

async function extractStrategyFromText(opts: {
  sourceUrl: string;
  markdown: string;
  sourceProvider: "brave" | "tavily" | "parallel" | "exa";
  title: string;
}): Promise<Array<Record<string, unknown>>> {
  if (opts.markdown.length < 200) return [];

  // TPM throttle — wait if we just made an extract call
  const sinceLast = Date.now() - _lastExtractAt;
  if (sinceLast < SCOUT_EXTRACT_MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, SCOUT_EXTRACT_MIN_INTERVAL_MS - sinceLast));
  }
  _lastExtractAt = Date.now();

  // Pass 21 (2026-05-12 v2) — retry-with-backoff on transient failures.
  // Single-shot was losing concepts to OpenAI 502s, brief network blips, etc.
  // 1 retry with 2s backoff catches the vast majority of transient issues
  // without significantly slowing the cycle.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/agent/scout-extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
        signal: AbortSignal.timeout(300_000),
      });
      // 429 TPM rate-limit → silent retry after backoff (don't burn the retry slot on a network issue)
      if (res.status === 429) {
        if (attempt === 0) {
          logger.info({ url: opts.sourceUrl }, "autonomous-scout: scout-extract TPM-throttled, retrying in 2s");
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        logger.info({ url: opts.sourceUrl }, "autonomous-scout: scout-extract TPM-throttled after retry, treating as empty");
        return [];
      }
      // 5xx → transient upstream issue, retry
      if (res.status >= 500 && attempt === 0) {
        logger.info({ url: opts.sourceUrl, status: res.status }, "autonomous-scout: scout-extract 5xx, retrying in 2s");
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      const j = await res.json() as any;
      return Array.isArray(j?.ideas) ? j.ideas : [];
    } catch (e) {
      if (attempt === 0) {
        logger.info({ err: e instanceof Error ? e.message : String(e), url: opts.sourceUrl }, "autonomous-scout: scout-extract threw, retrying in 2s");
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      logger.warn({ err: e instanceof Error ? e.message : String(e), url: opts.sourceUrl }, "autonomous-scout: scout-extract failed after retry");
      return [];
    }
  }
  return [];
}

async function fetchRedditRelevancePosts(conceptName: string): Promise<Array<{ url: string; title: string; body: string }>> {
  const human = conceptName.replace(/_/g, " ") + " futures";
  const out: Array<{ url: string; title: string; body: string }> = [];
  for (const sub of REDDIT_SUBS) {
    const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(human)}&restrict_sr=1&sort=relevance&t=all&limit=5`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; TradingForge-AutonomousScout/1.0)" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) continue;
      const j = await res.json() as any;
      const posts = (j?.data?.children ?? []) as any[];
      for (const p of posts) {
        const pd = p?.data ?? {};
        const selfLen = typeof pd.selftext === "string" ? pd.selftext.length : 0;
        if (selfLen < 200) continue;  // skip thin posts
        out.push({
          url: `https://www.reddit.com${pd.permalink ?? ""}`,
          title: String(pd.title ?? ""),
          body: String(pd.selftext ?? ""),
        });
        if (out.length >= 6) break;
      }
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e), sub, conceptName }, "autonomous-scout: reddit search failed");
    }
    if (out.length >= 6) break;
  }
  return out;
}

interface CycleResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  queriesRun: number;
  conceptsDiscovered: number;
  webMentions: number;
  youtubeMentions: number;
  redditMentions: number;
  errors: string[];
  symbolGroup?: SymbolGroup;  // W23F.E — which group was seeded this cycle
  cycleIndex?: number;        // W23F.E — rotation index
  // F-7 (2026-05-20): pipeline pause defense-in-depth. Scheduler-level gate is
  // Track C's responsibility; this is the service-internal gate.
  skipped?: boolean;
  reason?: string;
}

/**
 * Run one full autonomous scout cycle: 10 queries → discover concepts → fan out
 * to YouTube + Reddit → post 3 layer mentions per concept. Buckets auto-graduate
 * once they hit web+youtube+reddit coverage.
 *
 * Skips if any required API key is missing — logs once and exits clean.
 */
export async function runAutonomousScoutCycle(): Promise<CycleResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const errors: string[] = [];
  let webMentions = 0;
  let youtubeMentions = 0;
  let redditMentions = 0;

  // F-7 (2026-05-20): Service-internal pipeline gate (defense-in-depth).
  // Track C adds the scheduler-level gate; this gate protects direct invocations
  // (manual operator triggers, integration tests calling the function directly).
  try {
    const active = await isPipelineActive();
    if (!active) {
      logger.info("autonomous-scout: pipeline not ACTIVE — cycle skipped (pipeline_paused)");
      return {
        startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0,
        queriesRun: 0, conceptsDiscovered: 0, webMentions, youtubeMentions, redditMentions,
        errors: [], skipped: true, reason: "pipeline_paused",
      };
    }
  } catch (gateErr) {
    // Gate check failure is non-fatal — log and proceed conservatively.
    // If we can't check pipeline state, proceeding is safe: the scheduler-level
    // gate (Track C) already blocks if paused. Fail-open here to avoid silently
    // killing every scout cycle on a transient DB hiccup.
    logger.warn({ err: gateErr }, "autonomous-scout: pipeline gate check failed — proceeding");
  }

  if (!BRAVE_API_KEY) {
    return {
      startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0,
      queriesRun: 0, conceptsDiscovered: 0, webMentions, youtubeMentions, redditMentions,
      errors: ["BRAVE_SEARCH_API_KEY not set — autonomous scout disabled"],
    };
  }

  // W23F.E — resolve cycle index from audit_log row count (Option B persistence).
  // Count completed scout_cycle.started rows; the NEXT cycle index = that count.
  // Defaults to 0 (MES) on DB error so cycle always proceeds.
  const correlationId = randomUUID();
  const cycleIndex = await resolveCycleIndex();
  const symbolGroup = pickSymbolGroupForCycle(cycleIndex);
  const discoveryQueries = getQueryTemplatesForGroup(symbolGroup);

  // 2026-06-27: daily-rotating-subset freshness mechanism. Each cycle fires a
  // deterministic wrap-around window of SCOUT_KEYWORD_SUBSET_SIZE queries from
  // the combined pool, offset by cycleIndex. Prevents every 4h tick from
  // re-firing the same high-SEO queries; spreads YouTube API quota across the
  // full keyword set over multiple cycles. Fail-open: full pool fires when the
  // env var is absent, unparseable, or >= pool length.
  const resolvedSubsetSize = (() => {
    const raw = Number(process.env.SCOUT_KEYWORD_SUBSET_SIZE);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_SCOUT_KEYWORD_SUBSET_SIZE;
  })();
  const activeQueries = getRotatingQuerySubset(discoveryQueries, cycleIndex, resolvedSubsetSize);
  const subsetOffset = cycleIndex % Math.max(1, discoveryQueries.length);
  logger.info(
    { poolSize: discoveryQueries.length, subsetSize: activeQueries.length, subsetOffset, cycleIndex, symbolGroup },
    "autonomous-scout: cycle starting",
  );

  // W23F.E — emit audit row at cycle start so the rotation state is durable.
  // The count of these rows drives the next cycle's symbol group selection.
  db.insert(auditLog).values({
    action: "scout_cycle.started",
    entityType: "scout_cycle",
    entityId: correlationId,
    result: {
      cycle_index: cycleIndex,
      seeded_symbol: symbolGroup,
      query_count: activeQueries.length,
      pool_size: discoveryQueries.length,
      subset_offset: subsetOffset,
    } as Record<string, unknown>,
    status: "success",
    decisionAuthority: "scheduler",
    correlationId,
  }).catch((err) => {
    logger.warn({ err: err instanceof Error ? err.message : String(err), correlationId }, "autonomous-scout: scout_cycle.started audit write failed (non-blocking)");
  });

  // Pass 21 — load existing canonical concepts so we DON'T re-discover them.
  // Without this guard, Brave's ORB-heavy SEO bias means every cycle re-finds
  // the same opening-range-breakout family and produces zero new strategies.
  // We exclude:
  //   - canonical names of every existing strategy
  //   - canonical names of every pending/graduating/graduated bucket from the
  //     last 30 days (so we don't re-graduate something already in the pipeline)
  const existingCanonicals = new Set<string>();
  try {
    const existingStrats = await db.select({ name: strategies.name }).from(strategies);
    for (const r of existingStrats) existingCanonicals.add(canonicalConceptName(r.name));
    const existingBuckets = await db
      .select({ concept_name: strategyPendingBuckets.conceptName })
      .from(strategyPendingBuckets)
      .where(drizzleSql`first_seen_at > NOW() - INTERVAL '30 days'`);
    for (const r of existingBuckets) {
      if (r.concept_name) existingCanonicals.add(canonicalConceptName(r.concept_name));
    }
    logger.info({ existingCanonicalCount: existingCanonicals.size }, "autonomous-scout: loaded canonical exclusion set");
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "autonomous-scout: failed to load existing canonicals, falling back to per-cycle dedup only");
  }

  // Shuffle the active rotating subset so we don't always pick from offset position first.
  // W23F.E: shuffle within the selected symbol group's query list.
  // 2026-06-27: shuffles the rotating subset (not the full pool) so intra-cycle
  // order varies while the cross-cycle rotation remains deterministic.
  const queriesShuffled = [...activeQueries].sort(() => Math.random() - 0.5);

  // Step 1 — discover concepts from Brave + Exa in parallel per query.
  // Pass 21 (2026-05-12 v2): added Exa neural search alongside Brave.
  //   - Brave: SEO-indexed, returns popular/dominant content (ORB-heavy)
  //   - Exa:   neural search, surfaces fresher/less-SEO'd technical content
  // Merging both per query gives ~2x candidate diversity. TARGET_CONCEPTS:
  // 2026-05-12 bumped 6→10, but produced 53 graduations in one day vs target
  // 5-6/day (CLAUDE.md §3) and 51M GPT-5-mini tokens. Reverted to 5 on
  // 2026-05-13. With 4h cycle (6 cycles/day) × 5 concepts = 30 candidate
  // concepts/day; graduator's GRADUATION_DAILY_CAP=8 caps real graduations.
  // Override via SCOUT_TARGET_CONCEPTS env.
  const concepts: ConceptCandidate[] = [];
  const seenCanonical = new Set<string>();
  const TARGET_CONCEPTS = Math.max(1, Number(process.env.SCOUT_TARGET_CONCEPTS) || 5);

  for (const q of queriesShuffled) {
    // Fan Brave + Exa in parallel per query; merge results.
    const [braveResults, exaResults] = await Promise.all([
      braveSearch(q),
      exaSearch(q),
    ]);
    // Interleave so neither source dominates — Brave first then Exa, alternating.
    const merged: BraveResult[] = [];
    const maxLen = Math.max(braveResults.length, exaResults.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < braveResults.length) merged.push(braveResults[i]);
      if (i < exaResults.length) merged.push(exaResults[i]);
    }
    for (const r of merged.slice(0, 10)) {  // 7 brave + ~3 exa interleaved
      const cn = deriveConceptName(r.title);
      if (!cn || cn === "unknown_concept") continue;
      const canonical = canonicalConceptName(cn);
      if (!canonical) continue;
      if (seenCanonical.has(canonical)) continue;            // dedup within this cycle
      if (existingCanonicals.has(canonical)) continue;       // skip — already in our pipeline
      seenCanonical.add(canonical);
      concepts.push({
        name: r.title,
        conceptName: cn,
        webSourceUrl: r.url,
        webThesis: r.description || r.title,
      });
      if (concepts.length >= TARGET_CONCEPTS) break;
    }
    if (concepts.length >= TARGET_CONCEPTS) break;
  }

  // Step 1b — Reddit-driven discovery: if Brave didn't fill the target, mine
  // r/algotrading and r/Daytrading for "my strategy" / "backtest results" /
  // "setup" posts. Reddit titles are user-authored (not SEO-optimized) so they
  // surface fresher, more specific concepts than Brave.
  if (concepts.length < TARGET_CONCEPTS) {
    const redditSubs = ["algotrading", "Daytrading", "FuturesTrading"];
    const redditQueries = [
      "my strategy futures backtest",
      "setup rules futures",
      "looking for feedback strategy",
      "this works for me futures",
    ];
    outer: for (const sub of redditSubs) {
      for (const q of redditQueries) {
        if (concepts.length >= TARGET_CONCEPTS) break outer;
        try {
          // F-5 (2026-05-20): t=all per CLAUDE.md §2b pinned — t=year returns popular off-topic posts.
          const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(q)}&restrict_sr=1&sort=relevance&t=all&limit=15`;
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; TradingForge-Scout/1.0)" },
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) continue;
          const j = (await res.json()) as any;
          const posts = (j?.data?.children ?? []) as any[];
          for (const p of posts) {
            const pd = p?.data ?? {};
            const title = String(pd.title ?? "");
            const selflen = typeof pd.selftext === "string" ? pd.selftext.length : 0;
            if (selflen < 300) continue;  // skip thin posts — won't extract well
            const cn = deriveConceptName(title);
            if (!cn || cn === "unknown_concept") continue;
            const canonical = canonicalConceptName(cn);
            if (!canonical || seenCanonical.has(canonical) || existingCanonicals.has(canonical)) continue;
            seenCanonical.add(canonical);
            concepts.push({
              name: title,
              conceptName: cn,
              webSourceUrl: `https://www.reddit.com${pd.permalink ?? ""}`,
              webThesis: (pd.selftext ?? title).slice(0, 500),
            });
            if (concepts.length >= TARGET_CONCEPTS) break outer;
          }
        } catch (e) {
          logger.debug({ err: e instanceof Error ? e.message : String(e), sub, q }, "autonomous-scout: Reddit discovery query failed");
        }
      }
    }
    logger.info({ afterRedditFill: concepts.length }, "autonomous-scout: Reddit-driven discovery filled");
  }

  if (concepts.length === 0) {
    logger.info({ skipped: "all concepts already in pipeline" }, "autonomous-scout: nothing new to discover this cycle");
  }

  logger.info({ conceptsDiscovered: concepts.length }, "autonomous-scout: Brave layer done");

  // W23G.4 — cycle-level transcript fetch counters for summary audit event.
  let transcriptFetchTotal = 0;
  const transcriptFetchCounters = {
    captioned_succeeded: 0,
    captioned_failed: 0,
    auto_recovered: 0,
    all_failed: 0,
  };

  // Step 2 — for each concept, fan out web + youtube + reddit
  for (const c of concepts) {
    // Web layer — Pass 21 (2026-05-12 burn-fix): use Brave's description only,
    // no per-page fetch. Most strategy sites are Cloudflare-protected so direct
    // HTTP returns "Just a moment..." junk, and ScrapingBee quota is gone.
    // The web mention here serves as a CROSS-VALIDATION SIGNAL (concept exists
    // on the open web with a reputable source) — YouTube + Reddit are the rich
    // content layers that drive DSL extraction. Brave description is enough to
    // count as one of the 2-3 confirming sources for the silver/gold gates.
    // Wave 13B (2026-05-18) — rich web extraction first, CV-only fallback.
    // The web layer was previously CV-only (Brave description posted as thin
    // mention). That left buckets at-threshold with no rich DSL — graduator
    // assembled web-citation text as entry_long and LLM judge correctly rejected.
    // Now: try fetchWebPageBody + extractStrategyFromText FIRST. If extraction
    // returns ≥1 idea, post the RICH mention with real DSL. Else fall back to
    // CV-only as before.
    const webThesis = `${c.name} — ${c.webThesis}`.slice(0, 2000);
    let webPosted = false;
    try {
      const pageBody = await fetchWebPageBody(c.webSourceUrl);
      if (pageBody && pageBody.length >= 600) {
        const richIdeas = await extractStrategyFromText({
          sourceUrl: c.webSourceUrl,
          markdown: pageBody,
          sourceProvider: "exa",  // scout-extract enum
          title: c.name,
        });
        if (richIdeas.length > 0) {
          const idea = richIdeas[0] as any;
          const webRichOk = await postLayerMention({
            conceptName: c.conceptName,
            market: (idea.market as any) ?? "MES",
            timeframe: (idea.timeframe as any) ?? "5m",
            layer: "web",
            sourceProvider: "brave_search",
            sourceUrl: c.webSourceUrl,
            thesis: String(idea.thesis ?? webThesis).slice(0, 2000),
            entryRules: String(idea.entry_rules ?? "").slice(0, 2000) || `Web-extraction for ${c.name}. Framework overlay applies risk rules.`,
            exitRules: String(idea.exit_rules ?? "Style D framework overlay applies.").slice(0, 2000),
            riskRules: String(idea.risk_rules ?? "CLAUDE.md §4 framework risk rules apply post-overlay.").slice(0, 1000),
            richIdea: idea,  // Wave 17 — forward the full DSL (entry_indicator, params, direction, etc.)
            seededSymbol: symbolGroup,  // W23F.E
            correlationId,              // W23F.G fix — propagate cycle correlationId end-to-end
          });
          if (webRichOk.accepted) webMentions++;
          webPosted = true;
          logger.info({ url: c.webSourceUrl, conceptName: c.conceptName }, "autonomous-scout: web RICH mention posted (Wave 13B)");
        }
      }
    } catch (e) {
      logger.debug({ err: e instanceof Error ? e.message : String(e), url: c.webSourceUrl }, "autonomous-scout: web rich-extraction failed, falling back to CV-only");
    }
    if (!webPosted) {
      // CV-only fallback — same as Wave 9 web mention
      const webEntry = `Web-layer cross-validation: ${c.name} — content surfaced on a reputable web source via Brave Search. Page body either unfetchable or contained no parametric strategy content. This mention is a concept-confirmation signal only.`;
      const webExit = `Framework overlay applies Style D: 50% off at 1R, Chandelier(14,2) trail, BE+1tick stop, 15:55 ET hard flat.`;
      const webRisk = `Framework overlay: ATR 1.5x stop, structural ceiling 14pt MES, 67% personal DLL per CLAUDE.md §4.`;
      const webOk = await postLayerMention({
        conceptName: c.conceptName,
        market: "MES",
        layer: "web",
        sourceProvider: "brave_search",
        sourceUrl: c.webSourceUrl,
        thesis: webThesis,
        entryRules: webEntry,
        exitRules: webExit,
        riskRules: webRisk,
        seededSymbol: symbolGroup,  // W23F.E
        correlationId,              // W23F.G fix
      });
      if (webOk.accepted) webMentions++;
    }

    // YouTube layer — top 3 scored videos, transcript → /scout-extract → post each as mention.
    //
    // Wave 9 (2026-05-17): split YouTube's two roles. The "rich DSL" path goes through the
    // transcript_extractor LLM. The "cross-validation signal" path (concept exists on YouTube
    // with title-confirmation) fires when extraction returns []. Earlier audit showed 99.4%
    // empty-extraction rate (168/169 transcripts → 0 ideas). Without the CV-only fallback,
    // Layer 2 never lights up and 3-layer convergence becomes 2-layer (web+reddit) in practice.
    //
    // The CV-only mention writes layer='youtube' but with thin entry_rules — the bucket-graduator
    // still requires real DSL prose from at least one layer (web or reddit) before graduation,
    // so CV-only YouTube cannot single-handedly graduate a junk concept.
    const ytVideos = await fetchYouTubeTopVideos(c.conceptName, correlationId);
    const conceptTokens = c.conceptName.toLowerCase().split(/_+/).filter((t) => t.length >= 3);
    for (const v of ytVideos) {
      // W23G.4 — use retry queue instead of single-shot fetchYouTubeTranscript.
      // fetchTranscriptWithRetry: 3 attempts, 2s/8s/30s jitter backoff, lang:"en" → no-lang fallback.
      const vid = extractYoutubeId(v.url) ?? v.url;
      const retryResult = await fetchTranscriptWithRetry(vid);
      const transcript = retryResult.transcript ?? "";

      // Persist fetch outcome for cycle dashboard observability (fire-and-forget).
      db.insert(transcriptFetchOutcomes).values({
        videoId: vid,
        outcome: retryResult.finalOutcome,
        attemptCount: retryResult.attempts.length,
        totalDurationMs: retryResult.attempts.reduce((a, x) => a + x.durationMs, 0),
        sourcePass: v.source_pass,
        sourceQuery: v.sourceQuery,
        errorMessage: retryResult.attempts.at(-1)?.errorMessage ?? null,
      }).catch((err) =>
        logger.warn({ err: err instanceof Error ? err.message : String(err), videoId: vid }, "transcript_fetch_outcomes write failed"),
      );

      // Accumulate for cycle-end summary
      transcriptFetchTotal++;
      transcriptFetchCounters[retryResult.finalOutcome as keyof typeof transcriptFetchCounters]++;

      const tr = { text: transcript, provider: retryResult.transcript ? "youtube_transcript_npm" : "none" };
      const titleLower = v.title.toLowerCase();
      const tokenHits = conceptTokens.filter((t) => titleLower.includes(t)).length;
      const titleConfirmsConcept = conceptTokens.length === 0 || tokenHits >= Math.min(2, conceptTokens.length);

      if (transcript.length < 300) {
        logger.info({ url: v.url, provider: tr.provider, transcriptLen: transcript.length, titleConfirmsConcept }, "autonomous-scout: transcript too short");
        // Even with short transcript, the title confirmation still counts as Layer-2 CV signal.
        if (titleConfirmsConcept) {
          const ytCvOk = await postLayerMention({
            conceptName: c.conceptName,
            market: "MES",
            layer: "youtube",
            sourceProvider: "youtube_data_api",
            sourceUrl: v.url,
            thesis: `${v.title} — YouTube-layer cross-validation: concept "${c.conceptName.replace(/_/g, " ")}" surfaced in tutorial-scored video title via Google YT Data API.`.slice(0, 2000),
            entryRules: `YouTube-layer CV mention (title-confirmed, transcript absent). Rich DSL extraction not available from this video — concept confirmation only. Framework overlay applies risk rules.`,
            exitRules: "Style D framework overlay applies.",
            riskRules: "CLAUDE.md §4 framework risk rules apply post-overlay.",
            seededSymbol: symbolGroup,  // W23F.E
        correlationId,              // W23F.G fix
          });
          if (ytCvOk.accepted) youtubeMentions++;
        }
        continue;
      }

      // Wave 11 — pre-extraction transcript-quality gate. Skip the LLM round-trip
      // when transcript has no numeric/structural/indicator content. Saves tokens
      // and surfaces the skip reason for audit visibility.
      const quality = checkTranscriptQuality(transcript);
      logger.info({ url: v.url, provider: tr.provider, len: transcript.length, titleConfirmsConcept, ...quality }, "autonomous-scout: transcript fetched");
      let ideas: Array<Record<string, unknown>> = [];
      if (!quality.shouldExtract) {
        logger.info({ url: v.url, skipReason: quality.skipReason, numericTokens: quality.numericTokens }, "autonomous-scout: skipping LLM extract — transcript-quality gate");
      } else {
        ideas = await extractStrategyFromText({
          sourceUrl: v.url,
          markdown: transcript,
          sourceProvider: "exa",  // /scout-extract enum — closest to YouTube; framework-overlay rewrites metadata.source
          title: v.title,
        });
      }

      if (ideas.length > 0) {
        // Rich-DSL path — extractor found at least one strategy in the transcript.
        const idea = ideas[0] as any;
        const ytOk = await postLayerMention({
          conceptName: c.conceptName,
          market: (idea.market as any) ?? "MES",
          timeframe: (idea.timeframe as any) ?? "5m",
          layer: "youtube",
          sourceProvider: "youtube_transcript_npm",
          sourceUrl: v.url,
          thesis: String(idea.thesis ?? `${v.title} — YouTube-layer DSL extraction for ${c.conceptName}`).slice(0, 2000),
          entryRules: String(idea.entry_rules ?? "").slice(0, 2000) || `YouTube extraction: ${v.title}. Framework overlay applies risk rules.`,
          exitRules: String(idea.exit_rules ?? "").slice(0, 2000) || "Style D framework overlay applies.",
          riskRules: String(idea.risk_rules ?? "").slice(0, 1000) || "CLAUDE.md §4 framework risk rules apply post-overlay.",
          richIdea: idea,  // Wave 17 — forward full DSL through to /scout-ideas/pending
          seededSymbol: symbolGroup,  // W23F.E
        correlationId,              // W23F.G fix
        });
        if (ytOk.accepted) youtubeMentions++;
        continue;
      }

      // W23G.8 — Reddit cross-extract enrichment. When YouTube extractor returned
      // empty for a high-promise video (titleScore >= 5 — i.e. clear indicator +
      // tutorial signal in the title), fall back to Reddit JSON API for a top
      // post + top-5 comments and re-run scout-extract on that markdown. Reddit
      // posters often state explicit rules that YouTube creators only flash
      // on-screen. We tag the resulting idea with extraction_provenance:
      // "reddit_only" so downstream observability can distinguish.
      //
      // Guardrails:
      //   - Single-attempt per (video, concept) — no recursive Reddit re-extract
      //   - Whitelisted subs only (futurestrading/daytrading/algotrading)
      //   - Upvote >= 50 community signal-quality bar
      //   - Failures (no post, all below threshold, network) audited and skipped
      if (ideas.length === 0 && v.titleScore >= 5) {
        try {
          db.insert(auditLog).values({
            action: "scout.reddit_enrichment_attempted",
            entityType: "scout_youtube",
            entityId: v.videoId,
            result: {
              concept_hint: c.conceptName,
              video_id: v.videoId,
              video_url: v.url,
              title: v.title,
              title_score: v.titleScore,
            } as Record<string, unknown>,
            status: "info",
            decisionAuthority: "autonomous_scout",
            correlationId,
          }).catch(() => {});
        } catch { /* non-blocking */ }

        const enrichment = await fetchRedditEnrichment(c.conceptName).catch(() => null);
        if (enrichment && enrichment.rawMarkdown.length >= 200) {
          const reIdeas = await extractStrategyFromText({
            sourceUrl: enrichment.postUrl,
            markdown: enrichment.rawMarkdown,
            sourceProvider: "brave",  // closest enum to "reddit" for scout-extract
            title: `${v.title} (Reddit enrichment from r/${enrichment.subreddit})`,
          });
          if (reIdeas.length > 0) {
            const idea = reIdeas[0] as Record<string, unknown>;
            // Tag extraction_provenance so downstream observability can see this came from Reddit
            (idea as any).extraction_provenance = "reddit_only";
            (idea as any).reddit_enrichment_applied = true;
            (idea as any).reddit_post_url = enrichment.postUrl;
            (idea as any).reddit_subreddit = enrichment.subreddit;
            (idea as any).reddit_upvote_score = enrichment.upvoteScore;

            db.insert(auditLog).values({
              action: "scout.reddit_enriched",
              entityType: "scout_youtube",
              entityId: v.videoId,
              result: {
                concept_name: c.conceptName,
                subreddit: enrichment.subreddit,
                upvote_score: enrichment.upvoteScore,
                post_url: enrichment.postUrl,
                video_id: v.videoId,
              } as Record<string, unknown>,
              status: "success",
              decisionAuthority: "autonomous_scout",
              correlationId,
            }).catch(() => {});

            const enrichedOk = await postLayerMention({
              conceptName: c.conceptName,
              market: ((idea as any).market as any) ?? "MES",
              timeframe: ((idea as any).timeframe as any) ?? "5m",
              layer: "youtube",  // logical layer remains YouTube (this is the YT-empty fallback path)
              sourceProvider: "youtube_transcript_npm",
              sourceUrl: v.url,
              thesis: String((idea as any).thesis ?? `${v.title} — Reddit-enriched DSL for ${c.conceptName}`).slice(0, 2000),
              entryRules: String((idea as any).entry_rules ?? "").slice(0, 2000) || `Reddit-enrichment extraction for ${c.conceptName} (r/${enrichment.subreddit}, ${enrichment.upvoteScore} upvotes). Framework overlay applies risk rules.`,
              exitRules: String((idea as any).exit_rules ?? "").slice(0, 2000) || "Style C framework overlay applies.",
              riskRules: String((idea as any).risk_rules ?? "").slice(0, 1000) || "CLAUDE.md §4 framework risk rules apply post-overlay.",
              richIdea: idea,
              seededSymbol: symbolGroup,
              correlationId,
            });
            if (enrichedOk.accepted) youtubeMentions++;
            logger.info({
              videoId: v.videoId, conceptName: c.conceptName, subreddit: enrichment.subreddit,
              upvotes: enrichment.upvoteScore, accepted: enrichedOk.accepted,
            }, "autonomous-scout: Reddit-enriched extraction succeeded (W23G.8)");
            continue;
          }

          // Reddit returned content but second extract still failed.
          db.insert(auditLog).values({
            action: "scout.reddit_enriched_but_extract_failed",
            entityType: "scout_youtube",
            entityId: v.videoId,
            result: {
              concept_name: c.conceptName,
              subreddit: enrichment.subreddit,
              upvote_score: enrichment.upvoteScore,
              post_url: enrichment.postUrl,
              video_id: v.videoId,
            } as Record<string, unknown>,
            status: "rejected",
            decisionAuthority: "autonomous_scout",
            correlationId,
          }).catch(() => {});
          // fall through to CV-only fallback below
        }
      }

      // CV-only fallback — extractor empty AND title token-confirms concept.
      // This is the path that lights up Layer 2 for the ~99% of tutorial videos whose
      // transcripts ramble too much for parametric extraction but whose titles legitimately
      // discuss the concept.
      if (titleConfirmsConcept) {
        const ytCvOk = await postLayerMention({
          conceptName: c.conceptName,
          market: "MES",
          layer: "youtube",
          sourceProvider: "youtube_data_api",
          sourceUrl: v.url,
          thesis: `${v.title} — YouTube-layer cross-validation: concept "${c.conceptName.replace(/_/g, " ")}" discussed in tutorial-scored video (transcript extracted ${transcript.length} chars, no parametric DSL found).`.slice(0, 2000),
          entryRules: `YouTube-layer CV mention (title-confirmed, transcript present but non-parametric). Rich DSL must come from web or reddit layer; this confirms the concept exists on YouTube. Framework overlay applies risk rules.`,
          exitRules: "Style D framework overlay applies.",
          riskRules: "CLAUDE.md §4 framework risk rules apply post-overlay.",
          seededSymbol: symbolGroup,  // W23F.E
        correlationId,              // W23F.G fix
        });
        if (ytCvOk.accepted) youtubeMentions++;
        logger.info({ url: v.url, conceptName: c.conceptName, tokenHits, ytCvAccepted: ytCvOk.accepted }, "autonomous-scout: YouTube CV-only mention posted");
      } else {
        logger.info({ url: v.url, conceptName: c.conceptName, tokenHits, conceptTokens: conceptTokens.length }, "autonomous-scout: YouTube extractor empty AND title did not token-confirm concept — skipping");
      }
    }

    // Reddit layer — relevance-sorted, top posts with >200 char selftext
    const redditPosts = await fetchRedditRelevancePosts(c.conceptName);
    for (const p of redditPosts.slice(0, 3)) {
      const ideas = await extractStrategyFromText({
        sourceUrl: p.url,
        markdown: `${p.title}\n\n${p.body}`,
        sourceProvider: "brave",  // closest enum — overlay rewrites
        title: p.title,
      });
      let rdEntry = `Reddit relevance match for ${c.conceptName}: ${p.title}`;
      let rdExit = "Style D framework overlay applies.";
      let rdRisk = "CLAUDE.md §4 framework risk rules apply post-overlay.";
      let rdRichIdea: Record<string, unknown> | undefined = undefined;
      if (ideas.length > 0) {
        const idea = ideas[0] as any;
        rdEntry = String(idea.entry_rules ?? rdEntry).slice(0, 2000);
        rdExit = String(idea.exit_rules ?? rdExit).slice(0, 2000);
        rdRisk = String(idea.risk_rules ?? rdRisk).slice(0, 1000);
        rdRichIdea = idea;  // Wave 17 — preserve LLM-extracted DSL
      }
      const rdOk = await postLayerMention({
        conceptName: c.conceptName,
        market: "MES",
        layer: "reddit",
        sourceProvider: "reddit_json",
        sourceUrl: p.url,
        thesis: `${p.title} — Reddit community-validated discussion for ${c.conceptName}.`.slice(0, 2000),
        entryRules: rdEntry,
        exitRules: rdExit,
        riskRules: rdRisk,
        richIdea: rdRichIdea,  // Wave 17 — pass-through when present, undefined for CV-only
        seededSymbol: symbolGroup,  // W23F.E
        correlationId,              // W23F.G fix
      });
      if (rdOk.accepted) redditMentions++;
    }
  }

  // W23G.4 — emit cycle-level transcript fetch summary for dashboard observability.
  // Fires after the concept loop completes. Non-blocking (fire-and-forget + .catch).
  if (transcriptFetchTotal > 0) {
    const successCount =
      transcriptFetchCounters.captioned_succeeded +
      transcriptFetchCounters.captioned_failed +
      transcriptFetchCounters.auto_recovered;
    const successRatePct = Math.round((successCount / transcriptFetchTotal) * 100);
    db.insert(auditLog).values({
      action: "scout.transcript_fetch_summary",
      entityType: "scout_cycle",
      result: {
        total_videos: transcriptFetchTotal,
        captioned_succeeded: transcriptFetchCounters.captioned_succeeded,
        captioned_failed: transcriptFetchCounters.captioned_failed,
        auto_recovered: transcriptFetchCounters.auto_recovered,
        all_failed: transcriptFetchCounters.all_failed,
        success_rate_pct: successRatePct,
        cycle_index: cycleIndex,
        symbol_group: symbolGroup,
      } as Record<string, unknown>,
      status: "success",
      decisionAuthority: "autonomous_scout",
      correlationId,
    }).catch((err) =>
      logger.warn({ err: err instanceof Error ? err.message : String(err), correlationId }, "autonomous-scout: transcript_fetch_summary audit write failed (non-blocking)"),
    );
    logger.info({
      transcriptFetchTotal,
      successCount,
      successRatePct,
      ...transcriptFetchCounters,
    }, "autonomous-scout: W23G.4 transcript fetch summary");
  }

  const finishedAt = new Date().toISOString();
  const result: CycleResult = {
    startedAt, finishedAt, durationMs: Date.now() - t0,
    queriesRun: activeQueries.length,
    conceptsDiscovered: concepts.length,
    webMentions, youtubeMentions, redditMentions, errors,
    symbolGroup,  // W23F.E
    cycleIndex,   // W23F.E
  };
  logger.info(result, "autonomous-scout: cycle complete");

  // Track O (deepscan11, 2026-07-02) FIX 4 — zero-extract cycle visibility.
  // When the full cycle yields 0 total layer mentions, emit an audit row and
  // track consecutive zeroes. On 3+ consecutive zero cycles, emit a deduped-daily
  // Discord WARN so the operator knows the conveyor is stalled.
  const totalMentions = webMentions + youtubeMentions + redditMentions;
  if (totalMentions === 0 && concepts.length >= 0) {
    // Cycle produced no extracts (could be 0 concepts or 0 from existing concepts)
    _zeroExtractState.consecutiveZeroCycles += 1;
    try {
      await insertAuditRow({
        action: "scout.cycle_zero_extracts",
        entityType: "scout_cycle",
        entityId: correlationId,
        status: "info",
        result: {
          consecutive_zero_cycles: _zeroExtractState.consecutiveZeroCycles,
          web_mentions: webMentions,
          youtube_mentions: youtubeMentions,
          reddit_mentions: redditMentions,
          concepts_discovered: concepts.length,
          queries_run: activeQueries.length,
          cycle_index: cycleIndex,
          symbol_group: symbolGroup,
        },
      });
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, "autonomous-scout: scout.cycle_zero_extracts audit write failed (non-blocking)");
    }
    // Deduped-daily Discord WARN on 3+ consecutive zero-extract cycles
    if (_zeroExtractState.consecutiveZeroCycles >= 3) {
      const today = _ytQuotaUtcDay();
      if (_zeroExtractState.lastWarnUtcDay !== today) {
        _zeroExtractState.lastWarnUtcDay = today;
        _zeroExtractState.warnedToday = false;
      }
      if (!_zeroExtractState.warnedToday) {
        _zeroExtractState.warnedToday = true;
        notifyWarning(
          "Scout conveyor stalled — 3+ consecutive zero-extract cycles",
          `The autonomous scout cycle has produced 0 layer mentions for ${_zeroExtractState.consecutiveZeroCycles} consecutive cycles. ` +
          `Latest cycle: ${cycleIndex}, symbol group: ${symbolGroup}. ` +
          `Check Brave/Exa API keys, YouTube API quota, and pipeline status.`,
          {
            consecutive_zero_cycles: _zeroExtractState.consecutiveZeroCycles,
            cycle_index: cycleIndex,
            symbol_group: symbolGroup,
            correlation_id: correlationId,
          },
        );
      }
    }
  } else {
    // Non-zero cycle — reset consecutive counter
    _zeroExtractState.consecutiveZeroCycles = 0;
  }

  return result;
}
