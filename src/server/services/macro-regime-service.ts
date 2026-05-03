/**
 * C11 Macro Regime Service
 *
 * Orchestrates:
 *   1. FRED daily ingestion (6 series, daily 4 PM ET cron)
 *   2. H.4.1 weekly ingestion (RRP + TGA, Friday 9 AM ET cron)
 *   3. BLS release ingestion (NFP/CPI/AHE/JOLTS, release-day 8:35 AM ET cron)
 *   4. TreasuryDirect auction ingestion (as-published, same-day cron)
 *   5. HMM classifier run (daily, after FRED pull)
 *   6. macro_regime_states persistence
 *
 * Serves:
 *   - Current macro regime probabilities (GET /api/macro/regime/current)
 *   - Historical series values (GET /api/macro/series/:id)
 *
 * Authority:
 *   - Observation + gate layer only. Does NOT affect strategy lifecycle.
 *   - macro-gate-service.ts reads this service to evaluate hard gates.
 *   - regime-state-service.ts reads this for macro fusion with DeepAR.
 *
 * Pipeline pause guard:
 *   - Ingestion crons apply isPipelineActive() early-exit (fire-and-forget paths).
 *   - Crisis gate detection is ALWAYS_RUN (safety signal, same as C1/C2).
 */

import { and, desc, gte, lte, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { macroFeatures, macroRegimeStates } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { runPythonModule } from "../lib/python-runner.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";

// ─── Types ──────────────────────────────────────────────────────

export interface MacroRegimeState {
  stateDate: string;          // YYYY-MM-DD
  probGrowth: number;
  probInflation: number;
  probCrisis: number;
  probEasing: number;
  dominantState: "Growth" | "Inflation" | "Crisis" | "Easing";
  crisisGateTriggered: boolean;
  fomcDayProximity: number | null;
  macroReleaseDay: boolean;
}

// In-memory cache of the latest regime state (refreshed daily)
let _latestRegimeState: MacroRegimeState | null = null;
let _latestRegimeStateAt: Date | null = null;

// ─── Public accessors ─────────────────────────────────────────────

/**
 * Get the latest macro regime state.
 * Returns in-memory cache first; falls back to DB read; falls back to null.
 */
export async function getLatestMacroRegimeState(): Promise<MacroRegimeState | null> {
  // Cache is fresh if < 6 hours old
  if (
    _latestRegimeState &&
    _latestRegimeStateAt &&
    Date.now() - _latestRegimeStateAt.getTime() < 6 * 60 * 60 * 1000
  ) {
    return _latestRegimeState;
  }

  try {
    const rows = await db
      .select()
      .from(macroRegimeStates)
      .orderBy(desc(macroRegimeStates.stateDate))
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0];
    _latestRegimeState = {
      stateDate: String(row.stateDate),
      probGrowth: parseFloat(row.probGrowth ?? "0"),
      probInflation: parseFloat(row.probInflation ?? "0"),
      probCrisis: parseFloat(row.probCrisis ?? "0"),
      probEasing: parseFloat(row.probEasing ?? "0"),
      dominantState: (row.dominantState ?? "Growth") as MacroRegimeState["dominantState"],
      crisisGateTriggered: Boolean(row.crisisGateTriggered),
      fomcDayProximity: row.fomcDayProximity ?? null,
      macroReleaseDay: Boolean(row.macroReleaseDay),
    };
    _latestRegimeStateAt = new Date();
    return _latestRegimeState;
  } catch (err) {
    logger.warn({ err }, "macro-regime-service: DB read failed, returning cached or null");
    return _latestRegimeState;
  }
}

/**
 * Force-refresh the in-memory cache from DB.
 * Called by crons after writing new regime state.
 */
export function invalidateMacroRegimeCache(): void {
  _latestRegimeState = null;
  _latestRegimeStateAt = null;
}

// ─── FRED daily ingestion ─────────────────────────────────────────

/**
 * Pull FRED daily series (C11: T10Y2Y, DFF, USEPUINDXD, VIXCLS, DTWEXBGS, RRPONTSYD).
 * Called by 4 PM ET daily cron.
 *
 * Returns number of new rows persisted.
 */
export async function runFredDailyIngestion(): Promise<number> {
  if (!(await isPipelineActive())) {
    logger.debug("macro-regime-service: pipeline not active — skipping FRED ingestion");
    return 0;
  }

  try {
    const result = await runPythonModule({
      scriptCode: `
import json, sys
sys.path.insert(0, '.')

try:
    from src.engine.macro_data.fred_ingestion import pull_fred_daily
    obs_list = pull_fred_daily(lookback_days=7)
    rows = [o._asdict() for o in obs_list]
    print(json.dumps({"status": "ok", "rows": rows, "count": len(rows)}))
except Exception as e:
    print(json.dumps({"status": "error", "error": str(e), "rows": [], "count": 0}))
`,
      componentName: "c11-fred-daily",
      timeoutMs: 60_000,
    });

    const parsed = result as { status: string; rows: unknown[]; count: number; error?: string };

    if (parsed.status === "error") {
      logger.error({ error: parsed.error }, "C11 FRED daily ingestion: Python error");
      return 0;
    }

    const rows = (parsed.rows ?? []) as Array<{
      series_id: string;
      series_date: string;
      publication_timestamp: string;
      value: number;
      revision_number: number;
      source: string;
    }>;

    if (rows.length === 0) return 0;

    // Upsert to macro_features (UNIQUE(series_id, series_date, revision_number))
    let persisted = 0;
    for (const row of rows) {
      try {
        await db
          .insert(macroFeatures)
          .values({
            seriesId: row.series_id,
            seriesDate: row.series_date,
            publicationTimestamp: new Date(row.publication_timestamp),
            value: String(row.value),
            revisionNumber: row.revision_number,
            source: row.source,
          })
          .onConflictDoNothing();
        persisted++;
      } catch (insertErr) {
        logger.warn({ err: insertErr, seriesId: row.series_id, date: row.series_date }, "C11 FRED upsert conflict");
      }
    }

    logger.info({ persisted, total: rows.length }, "C11 FRED daily ingestion complete");
    return persisted;
  } catch (err) {
    logger.error({ err }, "C11 FRED daily ingestion failed");
    return 0;
  }
}

// ─── H.4.1 weekly ingestion ───────────────────────────────────────

/**
 * Pull H.4.1 RRP/TGA data (Friday 9 AM ET cron).
 * Returns number of rows persisted.
 */
export async function runH41Ingestion(): Promise<number> {
  if (!(await isPipelineActive())) return 0;

  try {
    const result = await runPythonModule({
      scriptCode: `
import json, sys
sys.path.insert(0, '.')

try:
    from src.engine.macro_data.h41_ingestion import pull_h41_rrp_tga
    obs_list = pull_h41_rrp_tga(lookback_days=14)
    rows = [o._asdict() for o in obs_list]
    print(json.dumps({"status": "ok", "rows": rows, "count": len(rows)}))
except Exception as e:
    print(json.dumps({"status": "error", "error": str(e), "rows": [], "count": 0}))
`,
      componentName: "c11-h41",
      timeoutMs: 30_000,
    });

    const parsed = result as { status: string; rows: unknown[]; count: number; error?: string };
    if (parsed.status === "error") {
      logger.error({ error: parsed.error }, "C11 H.4.1 ingestion error");
      return 0;
    }

    const rows = (parsed.rows ?? []) as Array<Record<string, unknown>>;
    let persisted = 0;

    for (const row of rows) {
      try {
        await db.insert(macroFeatures).values({
          seriesId: String(row.series_id),
          seriesDate: String(row.series_date),
          publicationTimestamp: new Date(String(row.publication_timestamp)),
          value: String(row.value),
          revisionNumber: Number(row.revision_number ?? 1),
          source: String(row.source),
        }).onConflictDoNothing();
        persisted++;
      } catch {
        // duplicate — skip
      }
    }

    logger.info({ persisted }, "C11 H.4.1 ingestion complete");
    return persisted;
  } catch (err) {
    logger.error({ err }, "C11 H.4.1 ingestion failed");
    return 0;
  }
}

// ─── BLS release ingestion ────────────────────────────────────────

/**
 * Pull BLS release data on macro release days.
 * Called by 8:35 AM ET cron on NFP/CPI/PPI/JOLTS release days.
 */
export async function runBlsIngestion(): Promise<number> {
  if (!(await isPipelineActive())) return 0;

  try {
    const result = await runPythonModule({
      scriptCode: `
import json, sys
sys.path.insert(0, '.')

try:
    from src.engine.macro_data.bls_ingestion import pull_bls_release
    obs_list = pull_bls_release()
    rows = [o._asdict() for o in obs_list]
    print(json.dumps({"status": "ok", "rows": rows, "count": len(rows)}))
except Exception as e:
    print(json.dumps({"status": "error", "error": str(e), "rows": [], "count": 0}))
`,
      componentName: "c11-bls",
      timeoutMs: 60_000,
    });

    const parsed = result as { status: string; rows: unknown[]; count: number; error?: string };
    if (parsed.status === "error") {
      logger.error({ error: parsed.error }, "C11 BLS ingestion error");
      return 0;
    }

    const rows = (parsed.rows ?? []) as Array<Record<string, unknown>>;
    let persisted = 0;

    for (const row of rows) {
      try {
        await db.insert(macroFeatures).values({
          seriesId: String(row.series_id),
          seriesDate: String(row.series_date),
          publicationTimestamp: new Date(String(row.publication_timestamp)),
          value: String(row.value),
          revisionNumber: Number(row.revision_number ?? 1),
          source: "bls",
        }).onConflictDoNothing();
        persisted++;
      } catch {
        // duplicate
      }
    }

    logger.info({ persisted }, "C11 BLS ingestion complete");
    return persisted;
  } catch (err) {
    logger.error({ err }, "C11 BLS ingestion failed");
    return 0;
  }
}

// ─── Treasury auction ingestion ───────────────────────────────────

/**
 * Pull TreasuryDirect auction data (as-published, same-day cron).
 */
export async function runTreasuryAuctionIngestion(): Promise<number> {
  if (!(await isPipelineActive())) return 0;

  try {
    const result = await runPythonModule({
      scriptCode: `
import json, sys
sys.path.insert(0, '.')

try:
    from src.engine.macro_data.treasury_auction_ingestion import pull_treasury_auctions
    obs_list = pull_treasury_auctions(lookback_days=30)
    rows = [o._asdict() for o in obs_list]
    print(json.dumps({"status": "ok", "rows": rows, "count": len(rows)}))
except Exception as e:
    print(json.dumps({"status": "error", "error": str(e), "rows": [], "count": 0}))
`,
      componentName: "c11-treasury",
      timeoutMs: 60_000,
    });

    const parsed = result as { status: string; rows: unknown[]; count: number; error?: string };
    if (parsed.status === "error") {
      logger.error({ error: parsed.error }, "C11 Treasury ingestion error");
      return 0;
    }

    const rows = (parsed.rows ?? []) as Array<Record<string, unknown>>;
    let persisted = 0;

    for (const row of rows) {
      try {
        await db.insert(macroFeatures).values({
          seriesId: String(row.series_id),
          seriesDate: String(row.series_date),
          publicationTimestamp: new Date(String(row.publication_timestamp)),
          value: String(row.value),
          revisionNumber: Number(row.revision_number ?? 1),
          source: "treasury_direct",
        }).onConflictDoNothing();
        persisted++;
      } catch {
        // duplicate
      }
    }

    logger.info({ persisted }, "C11 Treasury auction ingestion complete");
    return persisted;
  } catch (err) {
    logger.error({ err }, "C11 Treasury auction ingestion failed");
    return 0;
  }
}

// ─── HMM classifier run ───────────────────────────────────────────

/**
 * Run the 4-state HMM macro regime classifier on available features.
 * Writes today's state to macro_regime_states.
 * Called after FRED daily ingestion (4 PM ET → classify → write state).
 *
 * Look-ahead safe: uses only features with publication_timestamp <= now.
 */
export async function runMacroRegimeClassification(): Promise<MacroRegimeState | null> {
  try {
    const lookbackDays = 180; // 6 months for HMM training stability
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    // Fetch features from DB (look-ahead safe: publication_timestamp <= now)
    const features = await db
      .select()
      .from(macroFeatures)
      .where(
        and(
          gte(macroFeatures.seriesDate, cutoffDate.toISOString().slice(0, 10)),
          lte(macroFeatures.publicationTimestamp, new Date()),
        )
      )
      .orderBy(macroFeatures.seriesDate);

    if (features.length < 30) {
      logger.warn(
        { featureCount: features.length },
        "C11 HMM: insufficient features for classification (need 30+) — skipping"
      );
      return null;
    }

    // Serialize features for Python
    const featureJson = JSON.stringify(features.map((f) => ({
      series_id: f.seriesId,
      series_date: String(f.seriesDate),
      value: parseFloat(f.value ?? "0"),
    })));

    const todayStr = new Date().toISOString().slice(0, 10);

    const result = await runPythonModule({
      scriptCode: `
import json, sys
sys.path.insert(0, '.')

features = ${featureJson}
today_str = "${todayStr}"

try:
    from src.engine.macro_regime_classifier import (
        build_feature_matrix, classify_daily_regime
    )
    from collections import defaultdict

    # Get all dates from features
    all_dates = sorted(set(f["series_date"] for f in features))

    # Build feature matrix
    feat_matrix = build_feature_matrix(features)

    # Classify all dates
    regimes = classify_daily_regime(feat_matrix, all_dates)

    # Return only today's regime (or last available)
    today_regime = None
    for r in reversed(regimes):
        today_regime = r
        break

    print(json.dumps({"status": "ok", "regime": today_regime, "n_dates": len(regimes)}))
except Exception as e:
    import traceback
    print(json.dumps({"status": "error", "error": str(e), "trace": traceback.format_exc()}))
`,
      componentName: "c11-hmm-classify",
      timeoutMs: 120_000,
    });

    const parsed = result as {
      status: string;
      regime: Record<string, unknown> | null;
      n_dates: number;
      error?: string;
      trace?: string;
    };

    if (parsed.status === "error") {
      logger.error({ error: parsed.error, trace: parsed.trace }, "C11 HMM classification failed");
      return null;
    }

    const regime = parsed.regime;
    if (!regime) return null;

    const stateDate = String(regime.state_date ?? todayStr);
    const probGrowth = Number(regime.prob_growth ?? 0.25);
    const probInflation = Number(regime.prob_inflation ?? 0.25);
    const probCrisis = Number(regime.prob_crisis ?? 0.25);
    const probEasing = Number(regime.prob_easing ?? 0.25);
    const dominantState = String(regime.dominant_state ?? "Growth") as MacroRegimeState["dominantState"];
    const crisisGateTriggered = Boolean(regime.crisis_gate_triggered);

    // Determine if today is a macro release day (simple calendar check)
    const isMacroReleaseDay = await _checkMacroReleaseDay(todayStr);

    // Upsert to macro_regime_states
    await db
      .insert(macroRegimeStates)
      .values({
        stateDate: stateDate,
        probGrowth: String(probGrowth),
        probInflation: String(probInflation),
        probCrisis: String(probCrisis),
        probEasing: String(probEasing),
        dominantState,
        crisisGateTriggered,
        fomcDayProximity: null, // TODO: wire FOMC calendar from economic_calendar.py
        macroReleaseDay: isMacroReleaseDay,
      })
      .onConflictDoUpdate({
        target: macroRegimeStates.stateDate,
        set: {
          probGrowth: String(probGrowth),
          probInflation: String(probInflation),
          probCrisis: String(probCrisis),
          probEasing: String(probEasing),
          dominantState,
          crisisGateTriggered,
          macroReleaseDay: isMacroReleaseDay,
        },
      });

    const state: MacroRegimeState = {
      stateDate,
      probGrowth,
      probInflation,
      probCrisis,
      probEasing,
      dominantState,
      crisisGateTriggered,
      fomcDayProximity: null,
      macroReleaseDay: isMacroReleaseDay,
    };

    // Refresh cache
    _latestRegimeState = state;
    _latestRegimeStateAt = new Date();

    logger.info(
      { dominantState, probCrisis: probCrisis.toFixed(3), crisisGateTriggered },
      "C11 macro regime classification complete"
    );

    return state;
  } catch (err) {
    logger.error({ err }, "C11 macro regime classification failed");
    return null;
  }
}

// ─── Macro release calendar helper ───────────────────────────────

/**
 * Check if today is a scheduled macro release day (CPI/NFP/PPI).
 * Uses the existing economic_calendar.py (skip engine).
 */
async function _checkMacroReleaseDay(dateStr: string): Promise<boolean> {
  try {
    const result = await runPythonModule({
      scriptCode: `
import json, sys
sys.path.insert(0, '.')

date_str = "${dateStr}"
try:
    from src.engine.economic_calendar import get_events_for_date
    events = get_events_for_date(date_str)
    macro_events = [e for e in events if e.get("type") in ("NFP", "CPI", "PPI", "FOMC", "ISM")]
    print(json.dumps({"is_release_day": len(macro_events) > 0, "events": macro_events}))
except Exception as e:
    print(json.dumps({"is_release_day": False, "error": str(e)}))
`,
      componentName: "c11-release-day-check",
      timeoutMs: 15_000,
    });

    const parsed = result as { is_release_day: boolean };
    return Boolean(parsed.is_release_day);
  } catch {
    return false;
  }
}

// ─── Series query helper ───────────────────────────────────────────

/**
 * Get recent observations for a macro series.
 * Used by GET /api/macro/series/:id route.
 */
export async function getMacroSeriesHistory(
  seriesId: string,
  limitDays: number = 90,
): Promise<Array<{ date: string; value: number; source: string }>> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - limitDays);

  const rows = await db
    .select()
    .from(macroFeatures)
    .where(
      and(
        eq(macroFeatures.seriesId, seriesId),
        gte(macroFeatures.seriesDate, cutoff.toISOString().slice(0, 10)),
      )
    )
    .orderBy(desc(macroFeatures.seriesDate))
    .limit(limitDays);

  return rows.map((r) => ({
    date: String(r.seriesDate),
    value: parseFloat(r.value ?? "0"),
    source: r.source,
  }));
}
