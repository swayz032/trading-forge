/**
 * picker-metrics.ts — W23H.C smart picker composite score helpers.
 *
 * Computes four equal-weight (0.25 each) components per strategy candidate:
 *
 *   1. rolling_30d_deflated_sharpe  — from backtest resultExtras.deflated_sharpe.dsr,
 *                                     most recent completed backtest within 30 days.
 *                                     Clamped to [0, 1] via min(dsr/3, 1.0).
 *
 *   2. regime_conditional_pf        — profit factor on backtest_trades whose
 *                                     macro_regime matches the current regimeLabel.
 *                                     Normalised: min(pf/3, 1.0). 0 when no matching
 *                                     trades or no completed backtest.
 *
 *   3. recency_penalty              — 1.0 / (1 + days_since_last_selection / 30).
 *                                     Sourced from most-recent bias_state row where
 *                                     active_strategy_id matches. 1.0 when never picked.
 *
 *   4. diversification_score        — 1.0 - fraction_of_same_archetype_picks_last_7d.
 *                                     Archetype = first underscore-delimited token of
 *                                     strategy name (e.g. "orb_mes_15m" → "orb").
 *                                     1.0 when no prior picks in window.
 *
 * Overfitting guard: weights FIXED at 0.25 × 4. Adjust ONLY after 30+ days of
 * forward-data instrumentation via audit_log bias_engine.strategy_selected rows.
 *
 * All component values clamped to [0, 1] before summation → composite in [0, 1].
 *
 * Testability: production data access is isolated behind PickerDataAccessLayer.
 * Unit tests inject a mock DAL; production passes dalOverride=undefined to use
 * the default Drizzle-backed implementation.
 */

import { and, eq, gte, sql, desc } from "drizzle-orm";
import {
  backtests,
  backtestTrades,
  biasState,
  strategies,
} from "../db/schema.js";
import { logger } from "../lib/logger.js";

// ─── Lazy DB import ───────────────────────────────────────────────────────────
// db/index.ts throws at module load when DATABASE_URL is absent.
// Lazy import lets picker-metrics.ts load in unit tests that inject a mock DAL.
let _productionDb: (typeof import("../db/index.js"))["db"] | undefined;

async function getProductionDb(): Promise<(typeof import("../db/index.js"))["db"]> {
  if (!_productionDb) {
    const mod = await import("../db/index.js");
    _productionDb = mod.db;
  }
  return _productionDb;
}

// ─── Public contract ──────────────────────────────────────────────────────────

export interface PickerScoreComponents {
  /** Deflated Sharpe Ratio normalised to [0,1]. 0 when unavailable. */
  rolling_30d_deflated_sharpe: number;
  /** Regime-conditional profit factor normalised to [0,1]. 0 when unavailable. */
  regime_conditional_pf: number;
  /** Recency: 1.0 = never picked (or recently active); < 1 for stale picks. */
  recency_penalty: number;
  /** Archetype diversification: 1.0 when no same-archetype picks in last 7 days. */
  diversification_score: number;
  /** Weighted composite: each component × 0.25. Range [0, 1]. */
  composite: number;
}

// ─── Data access layer (DAL) ──────────────────────────────────────────────────
// Thin interface over the DB queries picker-metrics needs.
// Concrete implementation uses Drizzle; unit tests inject stubs.

export interface StrategyNameRow {
  id: string;
  name: string;
}

export interface BacktestRow {
  strategyId: string;
  resultExtras: unknown;
  createdAt: Date;
}

export interface LatestBacktestIdRow {
  strategyId: string;
  backtestId: string;
}

export interface TradeRow {
  backtestId: string;
  pnl: string | null;
}

export interface BiasStatePickRow {
  activeStrategyId: string | null;
  computedAt: Date;
}

export interface DiversificationPickRow {
  activeStrategyId: string | null;
  stratName: string | null;
  computedAt: Date;
}

export interface PickerDataAccessLayer {
  getStrategyNames(ids: string[]): Promise<StrategyNameRow[]>;
  getRecentBacktests(ids: string[], cutoff: Date): Promise<BacktestRow[]>;
  getLatestBacktestIds(ids: string[]): Promise<LatestBacktestIdRow[]>;
  getRegimeFilteredTrades(backtestIds: string[], regimeLabel: string): Promise<TradeRow[]>;
  getBiasStatePicks(ids: string[]): Promise<BiasStatePickRow[]>;
  getDiversificationPicks(cutoff: Date): Promise<DiversificationPickRow[]>;
}

export interface PickerMetricOpts {
  /** Override "now" for deterministic tests. Defaults to new Date(). */
  now?: Date;
  /** Injectable DAL for unit tests. Defaults to DrizzlePickerDal (production). */
  dalOverride?: PickerDataAccessLayer;
}

// ─── Internal constants ───────────────────────────────────────────────────────

const COMPONENT_WEIGHT = 0.25;
const SHARPE_LOOKBACK_DAYS = 30;
const PF_NORMALISE_DIVISOR = 3;
const DSR_NORMALISE_DIVISOR = 3;
const RECENCY_HALF_LIFE_DAYS = 30;
const DIVERSIFICATION_LOOKBACK_DAYS = 7;

// ─── Helper ───────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function archetypeOf(name: string): string {
  return name.split("_")[0] ?? name;
}

// ─── Production Drizzle DAL ───────────────────────────────────────────────────

class DrizzlePickerDal implements PickerDataAccessLayer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(db: any) {
    this.db = db;
  }

  private idArraySql(ids: string[]) {
    return sql`ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}])`;
  }

  async getStrategyNames(ids: string[]): Promise<StrategyNameRow[]> {
    return this.db
      .select({ id: strategies.id, name: strategies.name })
      .from(strategies)
      .where(sql`${strategies.id} = ${this.idArraySql(ids)}`);
  }

  async getRecentBacktests(ids: string[], cutoff: Date): Promise<BacktestRow[]> {
    return this.db
      .select({
        strategyId: backtests.strategyId,
        resultExtras: backtests.resultExtras,
        createdAt: backtests.createdAt,
      })
      .from(backtests)
      .where(
        and(
          sql`${backtests.strategyId} = ${this.idArraySql(ids)}`,
          eq(backtests.status, "completed"),
          gte(backtests.createdAt, cutoff),
        ),
      )
      .orderBy(desc(backtests.createdAt));
  }

  async getLatestBacktestIds(ids: string[]): Promise<LatestBacktestIdRow[]> {
    return this.db
      .select({
        strategyId: backtests.strategyId,
        backtestId: backtests.id,
      })
      .from(backtests)
      .where(
        and(
          sql`${backtests.strategyId} = ${this.idArraySql(ids)}`,
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt));
  }

  async getRegimeFilteredTrades(btIds: string[], regimeLabel: string): Promise<TradeRow[]> {
    if (!btIds.length) return [];
    return this.db
      .select({
        backtestId: backtestTrades.backtestId,
        pnl: backtestTrades.pnl,
      })
      .from(backtestTrades)
      .where(
        and(
          sql`${backtestTrades.backtestId} = ${this.idArraySql(btIds)}`,
          eq(backtestTrades.macroRegime, regimeLabel),
        ),
      );
  }

  async getBiasStatePicks(ids: string[]): Promise<BiasStatePickRow[]> {
    return this.db
      .select({
        activeStrategyId: biasState.activeStrategyId,
        computedAt: biasState.computedAt,
      })
      .from(biasState)
      .where(sql`${biasState.activeStrategyId} = ${this.idArraySql(ids)}`)
      .orderBy(desc(biasState.computedAt));
  }

  async getDiversificationPicks(cutoff: Date): Promise<DiversificationPickRow[]> {
    return this.db
      .select({
        activeStrategyId: biasState.activeStrategyId,
        stratName: strategies.name,
        computedAt: biasState.computedAt,
      })
      .from(biasState)
      .leftJoin(strategies, eq(biasState.activeStrategyId, strategies.id))
      .where(
        and(
          sql`${biasState.activeStrategyId} IS NOT NULL`,
          gte(biasState.computedAt, cutoff),
        ),
      );
  }
}

// ─── Component computations ───────────────────────────────────────────────────

async function computeDeflatedSharpeMap(
  candidateIds: string[],
  cutoff: Date,
  dal: PickerDataAccessLayer,
): Promise<Map<string, number>> {
  const result = new Map<string, number>(candidateIds.map((id) => [id, 0]));
  try {
    const rows = await dal.getRecentBacktests(candidateIds, cutoff);
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.strategyId)) continue;
      seen.add(row.strategyId);
      const extras = row.resultExtras as Record<string, unknown> | null;
      const ds = extras?.deflated_sharpe as Record<string, unknown> | undefined;
      const dsr = typeof ds?.dsr === "number" ? ds.dsr : 0;
      result.set(row.strategyId, clamp01(dsr / DSR_NORMALISE_DIVISOR));
    }
  } catch (err) {
    logger.warn({ err }, "picker-metrics: deflated_sharpe fetch failed — defaulting to 0");
  }
  return result;
}

async function computeRegimePfMap(
  candidateIds: string[],
  regimeLabel: string,
  dal: PickerDataAccessLayer,
): Promise<Map<string, number>> {
  const result = new Map<string, number>(candidateIds.map((id) => [id, 0]));
  try {
    const latestRows = await dal.getLatestBacktestIds(candidateIds);
    const stratToBacktest = new Map<string, string>();
    for (const row of latestRows) {
      if (!stratToBacktest.has(row.strategyId)) {
        stratToBacktest.set(row.strategyId, row.backtestId);
      }
    }
    if (!stratToBacktest.size) return result;

    const backtestIds = [...stratToBacktest.values()];
    const trades = await dal.getRegimeFilteredTrades(backtestIds, regimeLabel);

    const backtestToStrat = new Map<string, string>();
    for (const [strat, bt] of stratToBacktest.entries()) {
      backtestToStrat.set(bt, strat);
    }

    const winsByBt = new Map<string, number>();
    const lossByBt = new Map<string, number>();
    for (const t of trades) {
      const pnl = Number(t.pnl ?? 0);
      if (pnl > 0) winsByBt.set(t.backtestId, (winsByBt.get(t.backtestId) ?? 0) + pnl);
      else if (pnl < 0) lossByBt.set(t.backtestId, (lossByBt.get(t.backtestId) ?? 0) + Math.abs(pnl));
    }

    for (const [btId, stratId] of backtestToStrat.entries()) {
      const wins = winsByBt.get(btId) ?? 0;
      const losses = lossByBt.get(btId) ?? 0;
      if (losses === 0 && wins === 0) continue;
      const pf = losses === 0 ? PF_NORMALISE_DIVISOR : wins / losses;
      result.set(stratId, clamp01(pf / PF_NORMALISE_DIVISOR));
    }
  } catch (err) {
    logger.warn({ err, regimeLabel }, "picker-metrics: regime_pf fetch failed — defaulting to 0");
  }
  return result;
}

async function computeRecencyMap(
  candidateIds: string[],
  now: Date,
  dal: PickerDataAccessLayer,
): Promise<Map<string, number>> {
  const result = new Map<string, number>(candidateIds.map((id) => [id, 1.0]));
  try {
    const rows = await dal.getBiasStatePicks(candidateIds);
    const seen = new Set<string>();
    for (const row of rows) {
      const sid = row.activeStrategyId;
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      const msSince = now.getTime() - row.computedAt.getTime();
      const daysSince = msSince / (1000 * 60 * 60 * 24);
      result.set(sid, clamp01(1.0 / (1 + daysSince / RECENCY_HALF_LIFE_DAYS)));
    }
  } catch (err) {
    logger.warn({ err }, "picker-metrics: recency fetch failed — defaulting to 1.0");
  }
  return result;
}

async function computeDiversificationMap(
  candidateIds: string[],
  candidateNames: Map<string, string>,
  now: Date,
  dal: PickerDataAccessLayer,
): Promise<Map<string, number>> {
  const result = new Map<string, number>(candidateIds.map((id) => [id, 1.0]));
  try {
    const cutoff = new Date(now.getTime() - DIVERSIFICATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const rows = await dal.getDiversificationPicks(cutoff);

    const totalPicks = rows.length;
    if (totalPicks === 0) return result;

    const archetypeCounts = new Map<string, number>();
    for (const row of rows) {
      if (!row.stratName) continue;
      const arch = archetypeOf(row.stratName);
      archetypeCounts.set(arch, (archetypeCounts.get(arch) ?? 0) + 1);
    }

    for (const id of candidateIds) {
      const name = candidateNames.get(id) ?? id;
      const arch = archetypeOf(name);
      const archCount = archetypeCounts.get(arch) ?? 0;
      result.set(id, clamp01(1.0 - archCount / totalPicks));
    }
  } catch (err) {
    logger.warn({ err }, "picker-metrics: diversification fetch failed — defaulting to 1.0");
  }
  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute picker score components for a set of candidate strategy IDs.
 *
 * All four component queries run in parallel via Promise.all.
 * Each component clamped to [0, 1]. Composite = equal-weight sum (0.25 × 4).
 *
 * Returns empty Map when candidateIds is empty.
 * Never throws — all component fetches fail-open to safe defaults.
 */
export async function computePickerScores(
  candidateIds: string[],
  regimeLabel: string,
  opts?: PickerMetricOpts,
): Promise<Map<string, PickerScoreComponents>> {
  const result = new Map<string, PickerScoreComponents>();
  if (!candidateIds.length) return result;

  const now = opts?.now ?? new Date();
  const cutoff30d = new Date(now.getTime() - SHARPE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  // Resolve DAL — either injected test mock or production Drizzle
  let dal: PickerDataAccessLayer;
  if (opts?.dalOverride) {
    dal = opts.dalOverride;
  } else {
    const db = await getProductionDb();
    dal = new DrizzlePickerDal(db);
  }

  // Resolve candidate names for diversification archetype lookup
  let candidateNames = new Map<string, string>();
  try {
    const nameRows = await dal.getStrategyNames(candidateIds);
    for (const r of nameRows) candidateNames.set(r.id, r.name);
  } catch (err) {
    logger.warn({ err }, "picker-metrics: name fetch failed — diversification will use id as name");
    for (const id of candidateIds) candidateNames.set(id, id);
  }

  // All four metric computations run in parallel
  const [sharpeMap, pfMap, recencyMap, diversMap] = await Promise.all([
    computeDeflatedSharpeMap(candidateIds, cutoff30d, dal),
    computeRegimePfMap(candidateIds, regimeLabel, dal),
    computeRecencyMap(candidateIds, now, dal),
    computeDiversificationMap(candidateIds, candidateNames, now, dal),
  ]);

  for (const id of candidateIds) {
    const rolling_30d_deflated_sharpe = sharpeMap.get(id) ?? 0;
    const regime_conditional_pf = pfMap.get(id) ?? 0;
    const recency_penalty = recencyMap.get(id) ?? 1.0;
    const diversification_score = diversMap.get(id) ?? 1.0;

    const composite = clamp01(
      rolling_30d_deflated_sharpe * COMPONENT_WEIGHT +
      regime_conditional_pf * COMPONENT_WEIGHT +
      recency_penalty * COMPONENT_WEIGHT +
      diversification_score * COMPONENT_WEIGHT,
    );

    result.set(id, {
      rolling_30d_deflated_sharpe,
      regime_conditional_pf,
      recency_penalty,
      diversification_score,
      composite,
    });
  }

  return result;
}
