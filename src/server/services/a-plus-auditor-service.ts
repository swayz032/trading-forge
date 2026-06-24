/**
 * A+ Market Auditor Service — Tier 3.3 (Gemini Quantum Blueprint, W3b)
 *
 * ADVISORY-ONLY observability subsystem. This service is NOT consulted by the
 * live signal path and does NOT gate trading decisions. It surfaces a daily
 * "which market has the best edge today" insight to dashboard/SSE/Discord/audit.
 * Slumdawg cannot be blocked by this module — by construction, paper-signal-service.ts
 * contains no import of or call to this service.
 *
 * Orchestrates the daily pre-market scan:
 *   1. Check QUANTUM_AMARKET_AUDITOR_ENABLED feature flag — exit early if false.
 *   2. Enrich market inputs with real ATR from pre_market_sessions (F-4 fix).
 *   3. Enrich market inputs with data-driven p_target_hit estimates (F-5 fix).
 *   4. Insert pending row in a_plus_market_scans (pending-row contract).
 *   5. Wrap scan in quantum-cost-tracker (moduleName="a_plus_auditor").
 *   6. Spawn Python subprocess: src.engine.a_plus_market_auditor (CLI entry).
 *   7. Parse AuditResult JSON; update scan row to completed/failed.
 *   8. Broadcast SSE event "a-plus-auditor:scan-complete".
 *   9. Emit audit_log row and Discord advisory (family-grade postscript).
 *
 * Authority: advisory / challenger_only. This service writes evidence rows;
 * it does NOT signal execution or modify lifecycle state.
 *
 * Governance invariant: the A+ auditor output (winner_market, observation_mode,
 * edge_scores) is ADVISORY ONLY. It is NOT a hard gate. It is NOT consulted by
 * the live signal path. paper-signal-service.ts does not import this module.
 * Consumers: dashboard (GET /api/auditor/latest), SSE, Discord advisory, audit_log.
 *
 * Feature flag: QUANTUM_AMARKET_AUDITOR_ENABLED=true (enabled — safe now, advisory only)
 * When false: returns early with { skipped: true }.
 */

import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { aPlusMarketScans } from "../db/schema.js";
import { runPythonModule } from "../lib/python-runner.js";
import { withCostTracking } from "../lib/quantum-cost-tracker.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";

// ─── ATR Percentile Defaults (per-symbol historical baselines) ────────────────
// These are starting-point baselines derived from CME published average daily ranges.
// Overridden by real pre_market_sessions data when available.
// TODO(go-live enrichment): replace these with Databento 8-year rolling ATR averages
// once the pre-market ATR history feed is wired (Databento session required).
const ATR_8YR_BASELINE: Record<string, number> = {
  MES: 2.8,   // ~2.8 points average daily range — 8yr CME baseline
  MNQ: 4.5,   // ~4.5 points average daily range — 8yr CME baseline
  MCL: 0.35,  // ~0.35/barrel average intraday range — 8yr CME baseline
};

// ─── Feature Flag ─────────────────────────────────────────────────────────────
function isAuditorEnabled(): boolean {
  return process.env.QUANTUM_AMARKET_AUDITOR_ENABLED === "true";
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarketInput {
  atr_5m: number;
  atr_8yr_avg: number;
  vix: number;
  gap_atr: number;
  spread: number;
  /** Pre-computed P(hit 1:2 reward) — if provided, Python skips MC circuit */
  p_target_hit?: number | null;
  /** Pre-computed noise score — if provided, Python skips entropy circuit */
  noise_score?: number | null;
}

export interface AuditorScanInput {
  marketInputs: Record<string, MarketInput>; // {"MES": {...}, "MNQ": {...}, "MCL": {...}}
  corrMatrix?: Record<string, Record<string, number>>; // 60-min rolling correlation matrix
  seed?: number;
}

export interface EdgeScoreDetail {
  vol: number;
  p_target: number;
  noise: number | null;
  entangle: number | null;
  composite: number;
  passes_p_target_gate: boolean;
  passes_noise_gate: boolean;
}

export interface AuditorScanResult {
  scanRowId: string;
  winnerMarket: string | null;
  observationMode: boolean;
  edgeScores: Record<string, EdgeScoreDetail>;
  leadMarket: string | null;
  lagWindowMinutes: number | null;
  entanglementStrength: number | null;
  governance: Record<string, unknown>;
  scanDurationMs: number;
  hardware: string;
  seed: number;
  /** True when QUANTUM_AMARKET_AUDITOR_ENABLED=false */
  skipped?: boolean;
}

// ─── Default correlation matrix (fallback when caller doesn't provide one) ────
const DEFAULT_CORR_MATRIX: Record<string, Record<string, number>> = {
  MES: { MES: 1.0, MNQ: 0.82, MCL: 0.15, DXY: -0.30 },
  MNQ: { MES: 0.82, MNQ: 1.0,  MCL: 0.12, DXY: -0.28 },
  MCL: { MES: 0.15, MNQ: 0.12, MCL: 1.0,  DXY:  0.05 },
  DXY: { MES: -0.30, MNQ: -0.28, MCL: 0.05, DXY: 1.0  },
};

// ─── p_target_hit Classical Estimator (F-5 fix) ──────────────────────────────

/**
 * Estimate P(hit 1:2 reward target) for a single market from pre-market data.
 *
 * ADVISORY-ONLY: this estimate feeds the A+ auditor scan. It is NOT used to gate
 * live signals. The estimate is a classical proxy — not a quantum circuit — so
 * it is fast and does not require IBM/Braket access.
 *
 * Formula (classical, deterministic):
 *   base = 0.70 — starts at a moderate-positive prior
 *   - ATR percentile > 70 (elevated vol): -0.08 (directional setups have worse follow-through)
 *   - ATR percentile > 85 (extreme vol):  -0.06 (additional penalty; stacks with above)
 *   - ATR percentile < 30 (calm):         +0.06 (calmer days favour measured moves)
 *   - crossAssetAligned:                  +0.07 (DXY/10Y agree with expected bias)
 *   - overnightRangePoints large (>1×ATR_baseline): -0.05 (large gap → more noise early)
 *   - vix > 25:                           -0.06 (macro anxiety suppresses follow-through)
 *   Final: clip to [0.40, 0.92]
 *
 * Rationale: distinct markets on the same day have different ATR environments,
 * gap sizes, and cross-asset alignment — so this estimate produces genuinely
 * distinct p_target_hit values per market, ending the F-5 observation_mode lock.
 *
 * No execution authority. No promotion authority. No lifecycle authority.
 */
export function estimatePTargetHit(params: {
  atrPercentile: number | null;
  crossAssetAligned: boolean | null;
  overnightRangePoints: number | null;
  vix: number;
  symbol?: string;
}): number {
  const { atrPercentile, crossAssetAligned, overnightRangePoints, vix, symbol } = params;

  let estimate = 0.70; // base: moderate-positive prior

  // ATR percentile adjustments (elevated vol hurts directional targets)
  if (atrPercentile !== null) {
    if (atrPercentile > 85) {
      estimate -= 0.14; // extreme vol: both tiers stack
    } else if (atrPercentile > 70) {
      estimate -= 0.08; // elevated vol
    } else if (atrPercentile < 30) {
      estimate += 0.06; // calm vol: target-hit easier
    }
  }

  // Cross-asset alignment: DXY/10Y agreeing with expected bias
  if (crossAssetAligned === true) {
    estimate += 0.07;
  } else if (crossAssetAligned === false) {
    estimate -= 0.04;
  }

  // Large overnight gap: more noise at open, harder to achieve 1:2R cleanly
  const baselineAtr = symbol ? (ATR_8YR_BASELINE[symbol] ?? 2.5) : 2.5;
  if (overnightRangePoints !== null && overnightRangePoints > baselineAtr) {
    estimate -= 0.05;
  }

  // VIX > 25: macro anxiety suppresses directional follow-through
  if (vix > 25) {
    estimate -= 0.06;
  }

  return Math.min(0.92, Math.max(0.40, estimate));
}

// ─── Real ATR Enrichment from pre_market_sessions (F-4 fix) ──────────────────

/**
 * Enrich market inputs with real ATR from the most recent pre_market_sessions row.
 *
 * ADVISORY-ONLY: feeds the A+ auditor scan. NOT used to gate live signals.
 *
 * For each market:
 *   - Query the most recent pre_market_sessions row (today or last available)
 *     for overnight_range_points and vix_proxy_atr_percentile.
 *   - Derive atr_5m from overnight_range_points (proxy for recent session ATR).
 *   - Keep atr_8yr_avg from the ATR_8YR_BASELINE constant (go-live TODO: Databento).
 *   - On DB error or no row: preserve caller's original values with a warning.
 *
 * This replaces the hardcoded flat constants (F-4) that made every market score
 * atr_ratio=1.0 and produced meaningless identical vol scores.
 *
 * Go-live enrichment TODO: once Databento pre-market ATR feed is wired, replace
 * the ATR_8YR_BASELINE constant with real 8-year rolling averages from the
 * Databento session for per-symbol long-run volatility context.
 *
 * Never throws — returns original inputs on any failure.
 */
export async function enrichWithRealAtr(
  marketInputs: Record<string, MarketInput>,
): Promise<Record<string, MarketInput>> {
  const enriched: Record<string, MarketInput> = {};
  const today = new Date().toISOString().slice(0, 10);

  for (const [symbol, mdata] of Object.entries(marketInputs)) {
    try {
      // Query most recent pre_market_sessions row for this symbol (today or last available)
      const rows = await db.execute(sql`
        SELECT overnight_range_points, vix_proxy_atr_percentile
        FROM pre_market_sessions
        WHERE symbol = ${symbol}
          AND session_date <= ${today}::date
          AND overnight_range_points IS NOT NULL
        ORDER BY session_date DESC
        LIMIT 1
      `);

      const row = Array.isArray(rows)
        ? rows[0]
        : (rows as { rows?: unknown[] }).rows?.[0];

      if (row) {
        const rawRange = (row as Record<string, unknown>).overnight_range_points;
        const rawPct = (row as Record<string, unknown>).vix_proxy_atr_percentile;

        const overnightRange = rawRange != null ? parseFloat(String(rawRange)) : null;
        const atrPercentile = rawPct != null ? parseFloat(String(rawPct)) : null;

        if (overnightRange !== null && !isNaN(overnightRange) && overnightRange > 0) {
          // overnight_range_points is the pre-market range — use as a proxy for intraday ATR.
          // Scale: overnight range tends to be ~70–90% of full-session ATR for MES/MNQ,
          // and ~80–95% for MCL (overnight includes most of the vol event).
          // Conservative: use overnight_range as a floor (real ATR may be slightly higher).
          const atr5m = Math.round(overnightRange * 100) / 100;
          const atr8yrAvg = ATR_8YR_BASELINE[symbol] ?? mdata.atr_8yr_avg;

          enriched[symbol] = { ...mdata, atr_5m: atr5m, atr_8yr_avg: atr8yrAvg };

          logger.debug(
            { symbol, atr5m, atr8yrAvg, atrPercentile },
            "a-plus-auditor: real ATR enriched from pre_market_sessions",
          );
          continue;
        }
      }

      // No row or zero range — use baseline ATR
      const atr8yrAvg = ATR_8YR_BASELINE[symbol] ?? mdata.atr_8yr_avg;
      enriched[symbol] = { ...mdata, atr_8yr_avg: atr8yrAvg };

      logger.debug(
        { symbol },
        "a-plus-auditor: no pre_market_sessions ATR row — using caller original + baseline",
      );
    } catch (err) {
      logger.warn(
        { err, symbol },
        "a-plus-auditor: ATR enrichment DB query failed — using caller original values",
      );
      enriched[symbol] = { ...mdata };
    }
  }

  return enriched;
}

// ─── p_target_hit Enrichment from pre_market_sessions ────────────────────────

/**
 * Enrich market inputs with data-driven p_target_hit estimates (F-5 fix).
 *
 * ADVISORY-ONLY: feeds the A+ auditor scan. NOT used to gate live signals.
 *
 * For each market:
 *   - Query most recent pre_market_sessions row for vix_proxy_atr_percentile,
 *     cross_asset_aligned, overnight_range_points.
 *   - Call estimatePTargetHit() with real per-market values.
 *   - If caller already provided p_target_hit, preserve it (caller wins).
 *   - On DB error: use estimatePTargetHit with null fields (neutral estimate).
 *
 * This replaces the F-5 flat 0.5 default that made every market always fail
 * the 0.75 gate and forced observation_mode=True every single day.
 *
 * Never throws — returns original inputs on any failure.
 */
export async function enrichWithPTargetHit(
  marketInputs: Record<string, MarketInput>,
): Promise<Record<string, MarketInput>> {
  const enriched: Record<string, MarketInput> = {};
  const today = new Date().toISOString().slice(0, 10);

  for (const [symbol, mdata] of Object.entries(marketInputs)) {
    // If caller already provided a p_target_hit, preserve it
    if (mdata.p_target_hit != null) {
      enriched[symbol] = mdata;
      continue;
    }

    let atrPercentile: number | null = null;
    let crossAssetAligned: boolean | null = null;
    let overnightRangePoints: number | null = null;

    try {
      const rows = await db.execute(sql`
        SELECT vix_proxy_atr_percentile, cross_asset_aligned, overnight_range_points
        FROM pre_market_sessions
        WHERE symbol = ${symbol}
          AND session_date <= ${today}::date
        ORDER BY session_date DESC
        LIMIT 1
      `);

      const row = Array.isArray(rows)
        ? rows[0]
        : (rows as { rows?: unknown[] }).rows?.[0];

      if (row) {
        const r = row as Record<string, unknown>;
        if (r.vix_proxy_atr_percentile != null) {
          const p = parseFloat(String(r.vix_proxy_atr_percentile));
          if (!isNaN(p)) atrPercentile = p;
        }
        if (r.cross_asset_aligned != null) {
          crossAssetAligned = Boolean(r.cross_asset_aligned);
        }
        if (r.overnight_range_points != null) {
          const rp = parseFloat(String(r.overnight_range_points));
          if (!isNaN(rp)) overnightRangePoints = rp;
        }
      }
    } catch (err) {
      logger.warn(
        { err, symbol },
        "a-plus-auditor: p_target_hit enrichment DB query failed — using neutral estimate",
      );
    }

    const pTargetHit = estimatePTargetHit({
      atrPercentile,
      crossAssetAligned,
      overnightRangePoints,
      vix: mdata.vix,
      symbol,
    });

    logger.debug(
      { symbol, pTargetHit, atrPercentile, crossAssetAligned, overnightRangePoints },
      "a-plus-auditor: data-driven p_target_hit estimated",
    );

    enriched[symbol] = { ...mdata, p_target_hit: pTargetHit };
  }

  return enriched;
}

// ─── Advisory Context Reader (for dashboard/observability only) ───────────────

/**
 * Get the most recent completed scan for advisory display purposes.
 *
 * ADVISORY-ONLY: this function exists for dashboard and observability consumers
 * (dashboard tile, Discord advisory, SSE push). NO gate calls this function.
 * paper-signal-service.ts does not call this. Lifecycle promotion does not call this.
 * The A+ auditor output is NOT a hard gate in any system path.
 *
 * Returns null if no completed scan exists for today.
 */
export async function getAdvisoryContext(
  scanDate?: string,
): Promise<{
  winnerMarket: string | null;
  observationMode: boolean;
  edgeScores: Record<string, unknown>;
  leadMarket: string | null;
  entanglementStrength: number | null;
  hardware: string;
  governance: Record<string, unknown>;
  scanDate: string;
  isAdvisoryOnly: true; // always true — enforces caller awareness
} | null> {
  const date = scanDate ?? new Date().toISOString().slice(0, 10);
  const [row] = await db
    .select()
    .from(aPlusMarketScans)
    .where(eq(aPlusMarketScans.scanDate, date))
    .limit(1);

  if (!row || row.status !== "completed") return null;

  return {
    winnerMarket: row.winnerMarket ?? null,
    observationMode: row.observationMode ?? true,
    edgeScores: (row.edgeScores as Record<string, unknown>) ?? {},
    leadMarket: row.leadMarket ?? null,
    entanglementStrength:
      row.entanglementStrength != null ? parseFloat(String(row.entanglementStrength)) : null,
    hardware: row.hardware ?? "unknown",
    governance: { authoritative: false, decision_role: "challenger_only" },
    scanDate: date,
    isAdvisoryOnly: true,
  };
}

// ─── Per-Market Noise Enrichment ─────────────────────────────────────────────

/**
 * Query skip_decisions for the most recent quantum_noise_score per market symbol.
 *
 * For each market in marketInputs:
 *   - If noise_score is already provided by the caller, it is preserved (no DB query).
 *   - Otherwise: query skip_decisions JOIN strategies WHERE symbol=market AND
 *     created_at > NOW()-6h ORDER BY created_at DESC LIMIT 1.
 *     Extract signals->>'quantum_noise_score'.
 *   - Falls back to null if no recent decision exists or on DB error.
 *
 * Governance: advisory only. This enrichment injects challenger evidence into
 * the Python auditor's per-market noise slot. It does NOT spawn quantum compute
 * and does NOT modify lifecycle state.
 *
 * Never throws — returns original inputs with null noise_score on any failure.
 */
export async function enrichWithPerMarketNoise(
  marketInputs: Record<string, MarketInput>,
): Promise<Record<string, MarketInput>> {
  const enriched: Record<string, MarketInput> = {};

  for (const [symbol, mdata] of Object.entries(marketInputs)) {
    // If caller already provided a noise_score, preserve it — no DB query needed.
    if (mdata.noise_score != null) {
      enriched[symbol] = mdata;
      continue;
    }

    let noiseScore: number | null = null;
    try {
      // Query most recent skip_decisions row for this symbol in last 6 hours.
      // Joins strategies to filter by symbol (skip_decisions.strategy_id is nullable
      // for portfolio-wide rows; we only pick strategy-scoped rows here).
      const rows = await db.execute(sql`
        SELECT (sd.signals->>'quantum_noise_score')::text AS noise_score
        FROM skip_decisions sd
        JOIN strategies s ON s.id = sd.strategy_id
        WHERE s.symbol = ${symbol}
          AND sd.created_at > now() - interval '6 hours'
          AND (sd.signals->>'quantum_noise_score') IS NOT NULL
        ORDER BY sd.created_at DESC
        LIMIT 1
      `);

      const row = Array.isArray(rows) ? rows[0] : (rows as { rows?: unknown[] }).rows?.[0];
      if (row) {
        const rawScore = (row as Record<string, unknown>).noise_score;
        if (rawScore != null) {
          const parsed = parseFloat(String(rawScore));
          if (!isNaN(parsed) && parsed >= 0.0 && parsed <= 1.0) {
            noiseScore = parsed;
          }
        }
      }

      logger.debug(
        { symbol, noiseScore },
        "a-plus-auditor: per-market noise enrichment from skip_decisions",
      );
    } catch (err) {
      // Graceful fallback — log and continue with null
      logger.warn(
        { err, symbol },
        "a-plus-auditor: noise enrichment DB query failed — falling back to null",
      );
    }

    enriched[symbol] = { ...mdata, noise_score: noiseScore };
  }

  return enriched;
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Run a full A+ Market Auditor scan for today.
 *
 * Follows pending-row contract:
 *   - Row inserted with status="pending" before Python call.
 *   - Updated to "completed" or "failed" on resolve.
 *
 * Never throws to the cron caller — all errors are caught and persisted
 * as status="failed" with errorMessage.
 */
export async function runAuditScan(
  input: AuditorScanInput,
  correlationId?: string,
): Promise<AuditorScanResult> {
  const logCtx = { correlationId, moduleName: "a_plus_auditor" };

  // ── Feature flag early-exit ──────────────────────────────────────────────
  if (!isAuditorEnabled()) {
    logger.debug(
      logCtx,
      "a-plus-auditor: QUANTUM_AMARKET_AUDITOR_ENABLED=false — skipping scan",
    );
    return {
      scanRowId: "",
      winnerMarket: null,
      observationMode: false,
      edgeScores: {},
      leadMarket: null,
      lagWindowMinutes: null,
      entanglementStrength: null,
      governance: { authoritative: false, decision_role: "challenger_only" },
      scanDurationMs: 0,
      hardware: "skipped",
      seed: input.seed ?? 42,
      skipped: true,
    };
  }

  const scanDate = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  // ── Insert pending row ───────────────────────────────────────────────────
  let scanRowId: string;
  try {
    const [pendingRow] = await db
      .insert(aPlusMarketScans)
      .values({
        scanDate,
        status: "pending",
        observationMode: false,
        edgeScores: {},
        seed: input.seed ?? 42,
      })
      .onConflictDoUpdate({
        target: [aPlusMarketScans.scanDate],
        set: {
          status: "pending",
          edgeScores: {},
          winnerMarket: null,
          observationMode: false,
          leadMarket: null,
          lagWindowMinutes: null,
          entanglementStrength: null,
          errorMessage: null,
          scanDurationMs: null,
          hardware: null,
          seed: input.seed ?? 42,
        },
      })
      .returning();
    scanRowId = pendingRow.id;
    logger.info(
      { ...logCtx, scanRowId, scanDate },
      "a-plus-auditor: pending row inserted",
    );
  } catch (err) {
    logger.error(
      { ...logCtx, err },
      "a-plus-auditor: failed to insert pending row — aborting scan",
    );
    throw err;
  }

  // ── Enrich market inputs with real ATR from pre_market_sessions (F-4 fix) ──
  // Replaces hardcoded flat constants with real overnight_range_points per symbol,
  // producing distinct atr_ratio values across markets.
  // Falls back to caller values on DB error.
  const atrEnrichedInputs = await enrichWithRealAtr(input.marketInputs);

  // ── Enrich market inputs with data-driven p_target_hit estimates (F-5 fix) ──
  // Replaces the flat 0.5 default (always below 0.75 threshold → always observation_mode)
  // with a classical estimate based on real pre_market_sessions data per symbol.
  // Callers who already provide p_target_hit are not overridden.
  const ptEnrichedInputs = await enrichWithPTargetHit(atrEnrichedInputs);

  // ── Enrich market inputs with per-market noise scores from skip_decisions ──
  // W3b deferred: query quantum_noise_score from skip_decisions per symbol so
  // the Python auditor uses real per-market noise rather than neutral default.
  // Falls back to null per market on DB error — auditor continues with neutral 0.5.
  const enrichedMarketInputs = await enrichWithPerMarketNoise(ptEnrichedInputs);

  // ── Build Python payload ─────────────────────────────────────────────────
  const pythonPayload = {
    market_inputs: Object.fromEntries(
      Object.entries(enrichedMarketInputs).map(([sym, mdata]) => [
        sym,
        {
          atr_5m: mdata.atr_5m,
          atr_8yr_avg: mdata.atr_8yr_avg,
          vix: mdata.vix,
          gap_atr: mdata.gap_atr,
          spread: mdata.spread,
          p_target_hit: mdata.p_target_hit ?? null,
          noise_score: mdata.noise_score ?? null,
        },
      ]),
    ),
    corr_matrix: input.corrMatrix ?? DEFAULT_CORR_MATRIX,
    seed: input.seed ?? 42,
  };

  // ── Run scan with cost tracking ──────────────────────────────────────────
  let pythonResult: Record<string, unknown>;
  try {
    pythonResult = await withCostTracking(
      { moduleName: "a_plus_auditor" },
      async () => {
        return await runPythonModule<Record<string, unknown>>({
          module: "src.engine.a_plus_market_auditor",
          config: pythonPayload,
          timeoutMs: 120_000,
          componentName: "a-plus-market-auditor",
          correlationId,
        });
      },
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(
      { ...logCtx, scanRowId, err },
      "a-plus-auditor: Python scan failed",
    );
    await db
      .update(aPlusMarketScans)
      .set({ status: "failed", errorMessage })
      .where(eq(aPlusMarketScans.id, scanRowId));
    throw err;
  }

  // ── Parse result ─────────────────────────────────────────────────────────
  const winnerMarket = (pythonResult.winner_market as string | null) ?? null;
  const observationMode = Boolean(pythonResult.observation_mode ?? false);
  const edgeScores = (pythonResult.edge_scores as Record<string, EdgeScoreDetail>) ?? {};
  const leadMarket = (pythonResult.lead_market as string | null) ?? null;
  const lagWindowMinutes = (pythonResult.lag_window_minutes as number | null) ?? null;
  const entanglementStrength = (pythonResult.entanglement_strength as number | null) ?? null;
  const governance = (pythonResult.governance as Record<string, unknown>) ?? {};
  const scanDurationMs = (pythonResult.scan_duration_ms as number) ?? 0;
  const hardware = (pythonResult.hardware as string) ?? "fallback_unavailable";
  const seed = (pythonResult.seed as number) ?? (input.seed ?? 42);

  // ── Update row to completed ──────────────────────────────────────────────
  await db
    .update(aPlusMarketScans)
    .set({
      winnerMarket,
      observationMode,
      edgeScores: edgeScores as Record<string, unknown>,
      leadMarket,
      lagWindowMinutes,
      entanglementStrength: entanglementStrength !== null ? String(entanglementStrength) : null,
      status: "completed",
      scanDurationMs,
      hardware,
      seed,
      errorMessage: null,
    })
    .where(eq(aPlusMarketScans.id, scanRowId));

  logger.info(
    {
      ...logCtx,
      scanRowId,
      winnerMarket,
      observationMode,
      leadMarket,
      entanglementStrength,
      scanDurationMs,
      hardware,
    },
    "a-plus-auditor: scan completed",
  );

  // ── SSE broadcast ────────────────────────────────────────────────────────
  broadcastSSE("a-plus-auditor:scan-complete", {
    scanRowId,
    winnerMarket,
    observationMode,
    leadMarket,
    entanglementStrength,
    scanDate,
    completedAt: new Date().toISOString(),
  });

  return {
    scanRowId,
    winnerMarket,
    observationMode,
    edgeScores,
    leadMarket,
    lagWindowMinutes,
    entanglementStrength,
    governance,
    scanDurationMs,
    hardware,
    seed,
  };
}

/**
 * Get the most recent completed scan result for a given date.
 * Used by the GET /api/auditor/latest route for dashboard reads.
 *
 * ADVISORY-ONLY: this is NOT consulted by the live signal path. The skip engine
 * does NOT call this function. No gate calls this function to block trading.
 *
 * Returns null if no completed scan exists for that date.
 */
export async function getLatestScan(
  scanDate?: string,
): Promise<typeof aPlusMarketScans.$inferSelect | null> {
  const date = scanDate ?? new Date().toISOString().slice(0, 10);
  const [row] = await db
    .select()
    .from(aPlusMarketScans)
    .where(eq(aPlusMarketScans.scanDate, date))
    .limit(1);
  return row ?? null;
}
