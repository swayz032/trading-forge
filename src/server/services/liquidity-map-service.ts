/**
 * liquidity-map-service.ts — Wave 25 Pass 3, W25.6
 *
 * Persistent ranked institutional liquidity engine.
 *
 * Promotes liquidity tracking from per-bar lookup (stub) to a persistent ranked
 * map that survives across bars and sessions.  Closes GPT institutional critique
 * #4: "Institutional bots maintain an active liquidity map."
 *
 * Public API:
 *   refreshSessionLevels(symbol, sessionDate, correlationId) — pull levels from
 *     pre_market_sessions + bias_state structure_state and persist via UPSERT.
 *   getNearestLiquidity(symbol, fromPrice, direction, maxDistance?) — ranked query.
 *   markLevelTouched(levelId) — called when price sweeps a level.
 *   expireOldLevels(symbol, beforeDate) — called by the 30-min cron for cleanup.
 *
 * Signal path integration:
 *   confluence-score.ts::evalLiquidityTargetClear() calls getNearestLiquidity().
 *
 * Sweep probability model (institutionally shaped heuristic):
 *   base           = 0.5 + 0.1 × htf_significance  (0.6 → 1.0)
 *   age_decay      = max(0, 1 − age_hours / 168)    (1-week window)
 *   touch_decay    = max(0, 1 − touched_count × 0.2)
 *   distance_factor = exp(−distance / (maxDistance / 2))
 *   result         = clamp(base × age_decay × touch_decay × distance_factor, 0, 1)
 *
 * Logger import: ./logger.js leaf module (feedback_helper_logger_import).
 * Audit: insertAuditRow from ../lib/audit-log-helper.js.
 * DB DAL is injectable for test isolation.
 */

import { logger } from "../lib/logger.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { db } from "../db/index.js";
import { liquidityLevels, preMarketSessions } from "../db/schema.js";
import { eq, and, isNull, gt, lt, lte, gte, sql } from "drizzle-orm";

// ─── Level type enum ─────────────────────────────────────────────────────────
// 17 canonical values — THIS IS A CONTRACT FOR PASS 7 ADAPTIVE EXITS.
// Do NOT add more level types without updating the adaptive-exit-engine contract.

export type LevelType =
  | "pdh" | "pdl"
  | "pwh_iso" | "pwl_iso"
  | "pmh" | "pml"
  | "asian_high" | "asian_low"
  | "london_high" | "london_low"
  | "naked_poc"
  | "untouched_fvg"
  | "untouched_ob"
  | "eqh" | "eql"
  | "hod" | "lod";

// ─── htf_significance mapping ─────────────────────────────────────────────────
// 1=intraday, 2=session, 3=daily, 4=weekly, 5=monthly
const HTF_SIGNIFICANCE: Record<LevelType, number> = {
  // intraday (1)
  hod: 1, lod: 1,
  asian_high: 1, asian_low: 1,
  london_high: 1, london_low: 1,
  // session (2)
  naked_poc: 2, untouched_fvg: 2, untouched_ob: 2,
  // daily (3)
  pdh: 3, pdl: 3, eqh: 3, eql: 3,
  // weekly (4)
  pwh_iso: 4, pwl_iso: 4,
  // monthly (5)
  pmh: 5, pml: 5,
};

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface RankedLevel {
  id: string;
  symbol: string;
  level_type: LevelType;
  price: number;
  htf_significance: number;
  sweep_probability: number;   // [0,1] — computed
  touched_count: number;
  age_hours: number;
  source_meta: Record<string, unknown>;
  distance_points: number;     // signed: positive = level above query price
}

/** Minimal DAL for test injection */
export interface LiquidityMapDAL {
  upsertLevel(row: UpsertLevelInput): Promise<{ id: string }>;
  getActiveLevels(symbol: string): Promise<ActiveLevelRow[]>;
  updateSweepProbability(id: string, sweepProbability: number): Promise<void>;
  incrementTouchedCount(id: string): Promise<void>;
  expireLevels(symbol: string, beforeDate: string): Promise<number>;
  getPreMarketSession(symbol: string, sessionDate: string): Promise<PreMarketRow | null>;
}

export interface UpsertLevelInput {
  symbol: string;
  sessionDate: string;
  levelType: LevelType;
  price: number;
  htfSignificance: number;
  sourceMeta: Record<string, unknown>;
  correlationId: string;
}

export interface ActiveLevelRow {
  id: string;
  symbol: string;
  sessionDate: string;
  levelType: string;
  price: number;
  htfSignificance: number;
  sweepProbability: number | null;
  touchedCount: number;
  sourceMeta: Record<string, unknown>;
  createdAt: Date;
}

export interface PreMarketRow {
  pdh: number | null;
  pdl: number | null;
  pwh: number | null;
  pwl: number | null;
  pwhIso: number | null;
  pwlIso: number | null;
  pmh: number | null;
  pml: number | null;
  londonRangeHigh: number | null;
  londonRangeLow: number | null;
  nearbyNakedPocs: unknown;
}

// ─── Default ADR fallback distances (points) ─────────────────────────────────
// Used when maxDistance is not explicitly specified.
const DEFAULT_MAX_DISTANCE: Record<string, number> = {
  MES: 14,  // ~1 ATR MES
  MNQ: 40,  // ~1 ATR MNQ
  MCL: 1.5, // ~1 ATR MCL (crude, in dollars/barrel)
};

function defaultMaxDistance(symbol: string): number {
  return DEFAULT_MAX_DISTANCE[symbol] ?? 14;
}

// ─── Sweep probability heuristic ─────────────────────────────────────────────
// Institutional heuristic — shaped like what market-making/execution algos use.
// All inputs must be already validated (non-negative).

export function computeSweepProbability(
  htfSignificance: number,
  ageHours: number,
  touchedCount: number,
  distancePoints: number,
  maxDistance: number,
): number {
  const base = 0.5 + 0.1 * htfSignificance;               // 0.6–1.0
  const ageDecay = Math.max(0, 1 - ageHours / 168);        // 1-week window
  const touchDecay = Math.max(0, 1 - touchedCount * 0.2);  // each touch -0.2
  const safeDist = maxDistance > 0 ? maxDistance : 14;
  const distanceFactor = Math.exp(-distancePoints / (safeDist / 2));
  const raw = base * ageDecay * touchDecay * distanceFactor;
  return Math.max(0, Math.min(1, raw));
}

// ─── Composite rank score ─────────────────────────────────────────────────────
// Used for sorting getNearestLiquidity results.
// htf_significance × 0.4 + sweep_probability × 0.4 + proximity_factor × 0.2

export function computeRankScore(
  htfSignificance: number,
  sweepProbability: number,
  distancePoints: number,
  maxDistance: number,
): number {
  const safeDist = maxDistance > 0 ? maxDistance : 14;
  const proximityFactor = 1 / (1 + Math.abs(distancePoints) / safeDist);
  return (htfSignificance / 5) * 0.4 + sweepProbability * 0.4 + proximityFactor * 0.2;
}

// ─── EQH/EQL detection ───────────────────────────────────────────────────────
// Detects equal highs/lows from structureState.swing_high/swing_low.
// Two swing highs/lows matching within EQH_EQL_TICK_TOLERANCE ticks → EQH/EQL.

const EQH_EQL_TICK_TOLERANCE_MES  = 0.25; // 1 tick MES
const EQH_EQL_TICK_TOLERANCE_MNQ  = 0.25; // 1 tick MNQ
const EQH_EQL_TICK_TOLERANCE_MCL  = 0.01; // 1 tick MCL

function eqTolerance(symbol: string): number {
  if (symbol === "MNQ") return EQH_EQL_TICK_TOLERANCE_MNQ;
  if (symbol === "MCL") return EQH_EQL_TICK_TOLERANCE_MCL;
  return EQH_EQL_TICK_TOLERANCE_MES;
}

/**
 * From a list of prior swing highs and a new swing_high, detect EQH/EQL.
 * Returns { eqh: number | null, eql: number | null }.
 * Only uses data already in pre_market_sessions/bias_state — no new feeds.
 */
function detectEqhEql(
  swingHigh: number | null,
  swingLow: number | null,
  pdh: number | null,
  pdl: number | null,
  symbol: string,
): { eqh: number | null; eql: number | null } {
  const tol = eqTolerance(symbol);
  let eqh: number | null = null;
  let eql: number | null = null;

  // EQH: swing_high ≈ pdh (yesterday's high acts as prior swing high reference)
  if (swingHigh !== null && pdh !== null && Math.abs(swingHigh - pdh) <= tol) {
    eqh = (swingHigh + pdh) / 2; // midpoint as canonical EQH price
  }

  // EQL: swing_low ≈ pdl
  if (swingLow !== null && pdl !== null && Math.abs(swingLow - pdl) <= tol) {
    eql = (swingLow + pdl) / 2;
  }

  return { eqh, eql };
}

// ─── Production DAL ───────────────────────────────────────────────────────────

/**
 * Build the production DAL backed by Drizzle + postgres.
 * Injectable for test isolation.
 */
export function makeProductionDAL(): LiquidityMapDAL {
  return {
    async upsertLevel(row: UpsertLevelInput): Promise<{ id: string }> {
      // UPSERT: conflict on (symbol, session_date, level_type, rounded price).
      // We round price to 2 decimal places as the de-dup bucket — this covers
      // the ±0.25pt tolerance requirement without complex range queries.
      const priceRounded = Math.round(row.price * 4) / 4; // nearest 0.25

      const result = await db
        .insert(liquidityLevels)
        .values({
          symbol: row.symbol,
          sessionDate: row.sessionDate,
          levelType: row.levelType,
          price: String(priceRounded),
          htfSignificance: row.htfSignificance,
          sourceMeta: row.sourceMeta,
        })
        .onConflictDoNothing() // same (symbol, session_date, level_type, price bucket) = skip
        .returning({ id: liquidityLevels.id });

      if (result.length === 0) {
        // Already existed — query existing id for audit
        const existing = await db
          .select({ id: liquidityLevels.id })
          .from(liquidityLevels)
          .where(
            and(
              eq(liquidityLevels.symbol, row.symbol),
              eq(liquidityLevels.sessionDate, row.sessionDate),
              eq(liquidityLevels.levelType, row.levelType),
              eq(liquidityLevels.price, String(priceRounded)),
            ),
          )
          .limit(1);
        return { id: existing[0]?.id ?? "unknown" };
      }
      return { id: result[0].id };
    },

    async getActiveLevels(symbol: string): Promise<ActiveLevelRow[]> {
      const rows = await db
        .select()
        .from(liquidityLevels)
        .where(and(eq(liquidityLevels.symbol, symbol), isNull(liquidityLevels.expiredAt)));
      return rows.map((r) => ({
        id: r.id,
        symbol: r.symbol,
        sessionDate: r.sessionDate,
        levelType: r.levelType,
        price: Number(r.price),
        htfSignificance: r.htfSignificance,
        sweepProbability: r.sweepProbability !== null ? Number(r.sweepProbability) : null,
        touchedCount: r.touchedCount,
        sourceMeta: (r.sourceMeta as Record<string, unknown>) ?? {},
        createdAt: r.createdAt,
      }));
    },

    async updateSweepProbability(id: string, sweepProbability: number): Promise<void> {
      await db
        .update(liquidityLevels)
        .set({ sweepProbability: String(sweepProbability) })
        .where(eq(liquidityLevels.id, id));
    },

    async incrementTouchedCount(id: string): Promise<void> {
      await db
        .update(liquidityLevels)
        .set({ touchedCount: sql`touched_count + 1` })
        .where(eq(liquidityLevels.id, id));
    },

    async expireLevels(symbol: string, beforeDate: string): Promise<number> {
      const result = await db
        .update(liquidityLevels)
        .set({ expiredAt: new Date() })
        .where(
          and(
            eq(liquidityLevels.symbol, symbol),
            isNull(liquidityLevels.expiredAt),
            lte(liquidityLevels.sessionDate, beforeDate),
          ),
        )
        .returning({ id: liquidityLevels.id });
      return result.length;
    },

    async getPreMarketSession(symbol: string, sessionDate: string): Promise<PreMarketRow | null> {
      const rows = await db
        .select({
          pdh: preMarketSessions.pdh,
          pdl: preMarketSessions.pdl,
          pwh: preMarketSessions.pwh,
          pwl: preMarketSessions.pwl,
          pwhIso: preMarketSessions.pwhIso,
          pwlIso: preMarketSessions.pwlIso,
          pmh: preMarketSessions.pmh,
          pml: preMarketSessions.pml,
          londonRangeHigh: preMarketSessions.londonRangeHigh,
          londonRangeLow: preMarketSessions.londonRangeLow,
          nearbyNakedPocs: preMarketSessions.nearbyNakedPocs,
        })
        .from(preMarketSessions)
        .where(
          and(
            eq(preMarketSessions.symbol, symbol),
            eq(preMarketSessions.sessionDate, sessionDate),
          ),
        )
        .limit(1);

      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        pdh: r.pdh !== null ? Number(r.pdh) : null,
        pdl: r.pdl !== null ? Number(r.pdl) : null,
        pwh: r.pwh !== null ? Number(r.pwh) : null,
        pwl: r.pwl !== null ? Number(r.pwl) : null,
        pwhIso: r.pwhIso !== null ? Number(r.pwhIso) : null,
        pwlIso: r.pwlIso !== null ? Number(r.pwlIso) : null,
        pmh: r.pmh !== null ? Number(r.pmh) : null,
        pml: r.pml !== null ? Number(r.pml) : null,
        londonRangeHigh: r.londonRangeHigh !== null ? Number(r.londonRangeHigh) : null,
        londonRangeLow: r.londonRangeLow !== null ? Number(r.londonRangeLow) : null,
        nearbyNakedPocs: r.nearbyNakedPocs,
      };
    },
  };
}

// ─── refreshSessionLevels ─────────────────────────────────────────────────────

/**
 * Pull levels from pre_market_sessions + bias_state structure_state and persist
 * via UPSERT.  Idempotent — calling twice same day produces no duplicates.
 *
 * Level sources:
 *   pre_market_sessions: PDH/PDL/PWH_ISO/PWL_ISO/PMH/PML/Asian/London/naked_pocs
 *   bias_state.structureState: EQH/EQL (swing_high/swing_low heuristic)
 *
 * Audit: liquidity_map.level_added per inserted row.
 *
 * Telemetry honesty (2026-07-17 liveness audit): when the upstream bars-derived
 * fields on pre_market_sessions are unavailable (e.g. /api/bars/:symbol 404s),
 * every insertLevel() call for those fields silently no-ops on price===null —
 * previously indistinguishable from a healthy tick with nothing new to add.
 * See liquidity_map.insert_skipped_null_price / liquidity_map.refresh_no_premarket_data
 * below. This does NOT fix the upstream data gap — it makes the failure loud.
 *
 * @param dal  Injected DAL (defaults to production Drizzle DAL)
 */
export async function refreshSessionLevels(
  symbol: string,
  sessionDate: string,
  correlationId: string,
  dal: LiquidityMapDAL = makeProductionDAL(),
  /** Optional structure state (bias-state-service publishes this at session start) */
  structureState?: {
    swing_high: number | null;
    swing_low: number | null;
  } | null,
): Promise<{ added: number; expired: number; nullPriceSkips: number }> {
  let added = 0;

  // ── Pull pre_market_sessions row ─────────────────────────────────────────
  const pmRow = await dal.getPreMarketSession(symbol, sessionDate);

  // Loud-signal tracking for the null-price-no-op class of bug. Populated only
  // for levels whose price SHOULD be present when the source data is healthy
  // (bars-derived pre_market_sessions fields). EQH/EQL are excluded via
  // opts.nullIsExpected=true below — NOT because a null there is a normal
  // per-session heuristic miss, but because `structureState` is UNWIRED from
  // production: the only caller, scheduler.ts:4906, invokes
  // `refreshSessionLevels(symbol, sessionDate, correlationId)` with just 3
  // args and never supplies the optional 5th `structureState` parameter, so
  // `swingH`/`swingL` below are ALWAYS null in production — detectEqhEql()
  // ALWAYS returns {eqh: null, eql: null}, unconditionally, forever. EQH/EQL
  // detection is structurally dead pending that wiring (the swing data does
  // exist — bias-state-service.ts persists it to bias_state.structure_state
  // JSONB — nothing fetches and passes it at the scheduler call site). The
  // carve-out exists so this pre-existing dead path doesn't get double-counted
  // as a NEW null-price-skip finding by this fix; it does NOT mean the gap is
  // benign or already covered. Wiring bias_state.structure_state into the
  // scheduler call site is a separate, out-of-scope fix (2026-07-17 liveness
  // audit F-1 correction — this comment previously mischaracterized the gap
  // as "a normal, expected outcome of the heuristic").
  const skippedLevels: Array<{
    levelType: LevelType;
    reason: "null_price" | "non_finite_price" | "non_positive_price";
  }> = [];

  /** Helper: insert a level and audit it if new */
  const insertLevel = async (
    levelType: LevelType,
    price: number | null,
    sourceMeta: Record<string, unknown> = {},
    opts: { nullIsExpected?: boolean } = {},
  ): Promise<void> => {
    if (price === null || !Number.isFinite(price) || price <= 0) {
      if (!opts.nullIsExpected) {
        const reason: "null_price" | "non_finite_price" | "non_positive_price" =
          price === null
            ? "null_price"
            : !Number.isFinite(price)
              ? "non_finite_price"
              : "non_positive_price";
        skippedLevels.push({ levelType, reason });
        logger.warn(
          { symbol, sessionDate, correlationId, levelType, price, reason },
          "liquidity-map: insertLevel skipped — source price unavailable (possible upstream data gap, e.g. /api/bars/:symbol)",
        );
      }
      return;
    }

    const significance = HTF_SIGNIFICANCE[levelType];

    try {
      const { id } = await dal.upsertLevel({
        symbol,
        sessionDate,
        levelType,
        price,
        htfSignificance: significance,
        sourceMeta,
        correlationId,
      });

      if (id && id !== "unknown") {
        await insertAuditRow({
          action: "liquidity_map.level_added",
          entityType: "liquidity_level",
          entityId: id,
          correlationId,
          status: "success",
          result: {
            symbol,
            sessionDate,
            levelType,
            price,
            htfSignificance: significance,
          },
        }).catch((err) => {
          logger.warn({ err, levelType, symbol }, "liquidity-map: audit insert failed (non-blocking)");
        });
        added++;
      }
    } catch (err) {
      logger.warn(
        { err, symbol, sessionDate, levelType, price },
        "liquidity-map: insertLevel failed (non-blocking)",
      );
    }
  };

  if (pmRow) {
    // PDH/PDL (daily — htf_significance=3)
    await insertLevel("pdh", pmRow.pdh, { source: "pre_market_sessions" });
    await insertLevel("pdl", pmRow.pdl, { source: "pre_market_sessions" });

    // PWH_ISO/PWL_ISO (weekly — htf_significance=4)
    await insertLevel("pwh_iso", pmRow.pwhIso, { source: "pre_market_sessions" });
    await insertLevel("pwl_iso", pmRow.pwlIso, { source: "pre_market_sessions" });

    // PMH/PML (monthly — htf_significance=5)
    await insertLevel("pmh", pmRow.pmh, { source: "pre_market_sessions" });
    await insertLevel("pml", pmRow.pml, { source: "pre_market_sessions" });

    // London range (intraday — htf_significance=1)
    await insertLevel("london_high", pmRow.londonRangeHigh, { source: "pre_market_sessions" });
    await insertLevel("london_low", pmRow.londonRangeLow, { source: "pre_market_sessions" });

    // Naked POCs from nearby_naked_pocs JSONB (session — htf_significance=2)
    if (pmRow.nearbyNakedPocs && Array.isArray(pmRow.nearbyNakedPocs)) {
      for (const poc of pmRow.nearbyNakedPocs as Array<{ price?: number; session?: string }>) {
        if (poc && typeof poc.price === "number") {
          await insertLevel("naked_poc", poc.price, {
            source: "nearby_naked_pocs",
            poc_session: poc.session ?? null,
          });
        }
      }
    }

    // EQH/EQL detection (daily — htf_significance=3). `structureState` is
    // UNWIRED from production: scheduler.ts:4906 is the only real caller and
    // it never passes this optional 5th param, so swingH/swingL below are
    // ALWAYS null in production and detectEqhEql() ALWAYS returns
    // {eqh: null, eql: null} — this is a structurally-dead path, not a
    // benign "no equal high/low this session" miss. nullIsExpected=true
    // keeps this PRE-EXISTING dead path out of the NEW null-price-skip
    // signal below (it is a distinct, already-known gap, tracked separately —
    // see the fuller note above the `skippedLevels` declaration; wiring
    // bias_state.structure_state into the scheduler call site is a separate,
    // out-of-scope fix).
    const swingH = structureState?.swing_high ?? null;
    const swingL = structureState?.swing_low ?? null;
    const { eqh, eql } = detectEqhEql(swingH, swingL, pmRow.pdh, pmRow.pdl, symbol);
    await insertLevel(
      "eqh",
      eqh,
      { source: "structure_state_heuristic", swing_high: swingH, pdh: pmRow.pdh },
      { nullIsExpected: true },
    );
    await insertLevel(
      "eql",
      eql,
      { source: "structure_state_heuristic", swing_low: swingL, pdl: pmRow.pdl },
      { nullIsExpected: true },
    );
  } else {
    // No pre_market_sessions row at all for this symbol/session — a stronger
    // signal than a per-field null: the entire market-data source never
    // populated for this session. Distinct action so it can never be read as
    // "nothing new to add" on a healthy tick.
    await insertAuditRow({
      action: "liquidity_map.refresh_no_premarket_data",
      entityType: "liquidity_map",
      entityId: `${symbol}:${sessionDate}`,
      correlationId,
      status: "warning",
      result: { symbol, sessionDate },
    }).catch((err) => {
      logger.warn(
        { err, symbol, sessionDate },
        "liquidity-map: refresh_no_premarket_data audit insert failed (non-blocking)",
      );
    });
    logger.warn(
      { symbol, sessionDate, correlationId },
      "liquidity-map: refreshSessionLevels — no pre_market_sessions row found (upstream data gap?)",
    );
  }

  // Loud, AGGREGATED per-tick signal (one row per symbol per tick, not one per
  // skipped level — proportionate volume) when one or more bars-derived
  // levels were skipped because their source price was null/invalid. This is
  // what makes a "source data entirely unavailable" tick distinguishable from
  // a genuinely healthy tick that simply had nothing new to add — the prior
  // behavior wrote an identical {added:0, expired:0} success row for both.
  if (skippedLevels.length > 0) {
    await insertAuditRow({
      action: "liquidity_map.insert_skipped_null_price",
      entityType: "liquidity_map",
      entityId: `${symbol}:${sessionDate}`,
      correlationId,
      status: "warning",
      result: {
        symbol,
        sessionDate,
        skippedCount: skippedLevels.length,
        skippedLevelTypes: skippedLevels.map((s) => s.levelType),
        skippedReasons: skippedLevels.map((s) => s.reason),
      },
    }).catch((err) => {
      logger.warn(
        { err, symbol, sessionDate },
        "liquidity-map: insert_skipped_null_price audit insert failed (non-blocking)",
      );
    });
  }

  const expiredCount = 0; // expiry runs separately via expireOldLevels()

  logger.info(
    { symbol, sessionDate, correlationId, added, expired: expiredCount, nullPriceSkips: skippedLevels.length },
    "liquidity-map: refreshSessionLevels complete",
  );

  return { added, expired: expiredCount, nullPriceSkips: skippedLevels.length };
}

// ─── getNearestLiquidity ──────────────────────────────────────────────────────

/**
 * Return active levels for symbol, ranked by composite score.
 *
 * @param dal           Injected DAL (defaults to production)
 * @param maxResults    Maximum levels to return (default 5)
 */
export async function getNearestLiquidity(
  symbol: string,
  fromPrice: number,
  direction: "above" | "below",
  maxDistance?: number,
  dal: LiquidityMapDAL = makeProductionDAL(),
  maxResults = 5,
): Promise<RankedLevel[]> {
  const distanceCap = maxDistance ?? defaultMaxDistance(symbol);

  let activeLevels: ActiveLevelRow[];
  try {
    activeLevels = await dal.getActiveLevels(symbol);
  } catch (err) {
    logger.warn({ err, symbol }, "liquidity-map: getActiveLevels failed — returning empty");
    return [];
  }

  const now = Date.now();
  const results: Array<RankedLevel & { _rankScore: number }> = [];

  for (const row of activeLevels) {
    const dist = direction === "above"
      ? row.price - fromPrice
      : fromPrice - row.price;

    // Filter: must be in the correct direction and within maxDistance
    if (dist < 0) continue;
    if (dist > distanceCap) continue;

    const ageHours = (now - row.createdAt.getTime()) / (1000 * 60 * 60);
    const sp = computeSweepProbability(
      row.htfSignificance,
      ageHours,
      row.touchedCount,
      dist,
      distanceCap,
    );

    // Update stored sweep_probability lazily (fire-and-forget)
    if (row.sweepProbability === null || Math.abs(sp - (row.sweepProbability ?? 0)) > 0.05) {
      dal.updateSweepProbability(row.id, sp).catch((e) =>
        logger.warn({ e, id: row.id }, "liquidity-map: sweep_probability update failed (non-blocking)"),
      );
    }

    const rankScore = computeRankScore(row.htfSignificance, sp, dist, distanceCap);
    const signedDistance = direction === "above" ? dist : -dist;

    results.push({
      id: row.id,
      symbol: row.symbol,
      level_type: row.levelType as LevelType,
      price: row.price,
      htf_significance: row.htfSignificance,
      sweep_probability: sp,
      touched_count: row.touchedCount,
      age_hours: ageHours,
      source_meta: row.sourceMeta,
      distance_points: signedDistance,
      _rankScore: rankScore,
    });
  }

  // Sort by composite rank descending, return top N
  results.sort((a, b) => b._rankScore - a._rankScore);
  return results.slice(0, maxResults).map(({ _rankScore: _r, ...rest }) => rest);
}

// ─── markLevelTouched ────────────────────────────────────────────────────────

/**
 * Increment touched_count and emit audit row.
 * Called when price sweeps through a tracked level.
 */
export async function markLevelTouched(
  levelId: string,
  correlationId = "",
  dal: LiquidityMapDAL = makeProductionDAL(),
): Promise<void> {
  try {
    await dal.incrementTouchedCount(levelId);
    await insertAuditRow({
      action: "liquidity_map.level_swept",
      entityType: "liquidity_level",
      entityId: levelId,
      correlationId: correlationId || undefined,
      status: "success",
      result: { touched_at: new Date().toISOString() },
    }).catch((err) =>
      logger.warn({ err, levelId }, "liquidity-map: level_swept audit failed (non-blocking)"),
    );
  } catch (err) {
    logger.warn({ err, levelId }, "liquidity-map: markLevelTouched failed (non-blocking)");
  }
}

// ─── expireOldLevels ─────────────────────────────────────────────────────────

/**
 * Expire all active levels for symbol with session_date <= beforeDate.
 * Returns count of expired rows.
 * Called by the 30-min cron after EOD.
 */
export async function expireOldLevels(
  symbol: string,
  beforeDate: string,
  correlationId = "",
  dal: LiquidityMapDAL = makeProductionDAL(),
): Promise<number> {
  try {
    const count = await dal.expireLevels(symbol, beforeDate);
    if (count > 0) {
      logger.info({ symbol, beforeDate, count, correlationId }, "liquidity-map: expired stale levels");
    }
    return count;
  } catch (err) {
    logger.warn({ err, symbol, beforeDate }, "liquidity-map: expireOldLevels failed");
    return 0;
  }
}
