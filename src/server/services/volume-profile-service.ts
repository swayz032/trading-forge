/**
 * Volume Profile Service — Track 2 (Volume Profile EXPANDED)
 *
 * Computes and persists daily VP levels (POC/VAH/VAL/nakedPocs/shape/IB/openClass)
 * for MES, MNQ, MCL after RTH close at 5:30 PM ET.
 *
 * Python subprocess contract:
 *   python -m src.engine.indicators.volume_profile --symbol <SYM> --date <YYYY-MM-DD>
 *   Output JSON: { poc, vah, val, naked_pocs, shape, shape_confidence, ib_high, ib_low,
 *                  ib_extension_status, open_classification }
 *
 * Fail-CLOSED on subprocess error — missing VP levels are acceptable; distorted
 * VP levels are not. The bias_engine + playbook_router handle null vp_levels
 * gracefully (backwards compatible).
 *
 * Pipeline pause guard applied to cron compute. GET queries bypass it (read path).
 */

import { db } from "../db/index.js";
import { dailyVolumeProfileLevels, auditLog } from "../db/schema.js";
import { eq, and, lte, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { runPythonModule } from "../lib/python-runner.js";
import { broadcastSSE } from "../routes/sse.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";

// ─── Config ─────────────────────────────────────────────────────────────────

const VP_SYMBOLS = (process.env.VP_SYMBOLS ?? "MES,MNQ,MCL").split(",").map((s) => s.trim());

// VP routing thresholds — NO magic numbers inline
export const VP_CONFIG = {
  /** Profile shapes */
  SHAPES: {
    D: "D",
    b: "b",
    P: "P",
    THIN: "Thin",
  },
  /** IB extension statuses */
  IB_STATUS: {
    HOLD: "IB_HOLD",
    UP: "IB_EXTENSION_UP",
    DOWN: "IB_EXTENSION_DOWN",
    BOTH: "IB_EXTENSION_BOTH",
  },
  /** Open classification values */
  OPEN_CLASS: {
    IN_VALUE: "Open-In-Value",
    OUTSIDE_UP: "Open-Outside-Value-Up",
    OUTSIDE_DOWN: "Open-Outside-Value-Down",
    OUTSIDE_RANGE: "Open-Outside-Range",
  },
  /** Shape scorer weights (used by bias_engine) */
  SHAPE_SCORE: {
    D: 0,   // neutral
    b: 5,   // bullish profile
    P: -5,  // bearish profile
    Thin: 10, // absolute value; direction from HTF — caller multiplies by direction sign
  },
  /** IB score contributions */
  IB_SCORE: {
    IB_HOLD: 0,
    IB_EXTENSION_UP_ALIGNED: 5,
    IB_EXTENSION_UP_AGAINST: -5,
    IB_EXTENSION_DOWN_ALIGNED: 5,
    IB_EXTENSION_DOWN_AGAINST: -5,
    IB_EXTENSION_BOTH: 0,
  },
  /** Open-relative-to-value score contributions */
  OPEN_CLASS_SCORE: {
    "Open-In-Value": 0,
    "Open-Outside-Value-Up": 5,
    "Open-Outside-Value-Down": -5,
    "Open-Outside-Range": 10,
  },
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NakedPoc {
  price: number;
  source_date: string; // ISO date
}

export interface VPLevels {
  symbol: string;
  sessionDate: string;
  poc: number;
  vah: number;
  val: number;
  nakedPocs: NakedPoc[];
  profileShape: string;
  shapeConfidence: number;
  ibHigh: number | null;
  ibLow: number | null;
  ibExtensionStatus: string | null;
  openClassification: string | null;
  computedAt: Date;
}

interface PythonVPOutput {
  poc: number;
  vah: number;
  val: number;
  naked_pocs: NakedPoc[];
  shape: string;
  shape_confidence: number;
  ib_high?: number | null;
  ib_low?: number | null;
  ib_extension_status?: string | null;
  open_classification?: string | null;
  // developing session POC from current intra-day bar buffer
  developing_poc?: number | null;
}

// ─── Developing session POC in-memory store ──────────────────────────────────
// Updated on each bar tick by callers (e.g. processSessionBar).
// Used by buildExitBarContext → StyleExitBarContext.developingSessionPoc.

const _developingPocStore = new Map<string, number>();

/** Called by paper-trading-stream.ts on every intra-day bar to keep the developing POC current. */
export function updateDevelopingPoc(symbol: string, poc: number): void {
  _developingPocStore.set(symbol, poc);
}

/** Returns the latest developing-session POC for a symbol, or null if unavailable. */
export async function getDevelopingSessionPoc(symbol: string): Promise<number | null> {
  const cached = _developingPocStore.get(symbol);
  if (cached !== undefined) return cached;

  // Fallback: read the most recent completed session POC from DB as a proxy
  try {
    const rows = await db
      .select({ poc: dailyVolumeProfileLevels.poc })
      .from(dailyVolumeProfileLevels)
      .where(eq(dailyVolumeProfileLevels.symbol, symbol))
      .orderBy(desc(dailyVolumeProfileLevels.sessionDate))
      .limit(1);
    if (rows.length > 0 && rows[0].poc != null) {
      return parseFloat(rows[0].poc);
    }
  } catch (err) {
    logger.warn({ symbol, err: String(err) }, "volume-profile-service: getDevelopingSessionPoc DB fallback failed");
  }

  return null;
}

// ─── Core compute ────────────────────────────────────────────────────────────

/**
 * Compute VP levels for one symbol+date via Python subprocess.
 * Fail-CLOSED: on any subprocess error, logs and rethrows so the caller
 * can decide (skip this symbol, alert, etc.).
 */
async function computeAndPersistDailyVP(symbol: string, sessionDate: string): Promise<void> {
  const t0 = Date.now();
  logger.info({ symbol, sessionDate }, "volume-profile-service: computing VP levels");

  let pyOutput: PythonVPOutput;
  try {
    pyOutput = await runPythonModule<PythonVPOutput>({
      module: "src.engine.indicators.volume_profile",
      args: ["--symbol", symbol, "--date", sessionDate],
      timeoutMs: 120_000,
      componentName: "volume-profile-compute",
    });
  } catch (err) {
    logger.error({ symbol, sessionDate, err: String(err) }, "volume-profile-service: Python subprocess FAILED — fail-CLOSED, skipping upsert");
    // Write audit row for observability even on failure
    await _writeAuditLog(symbol, sessionDate, "failed", String(err));
    throw err; // Propagate so dailyVolumeProfileCron can count failures
  }

  // Validate required fields
  if (pyOutput.poc == null || pyOutput.vah == null || pyOutput.val == null) {
    const msg = `volume-profile-service: Python returned incomplete VP data for ${symbol} ${sessionDate}`;
    logger.error({ symbol, sessionDate, pyOutput }, msg);
    await _writeAuditLog(symbol, sessionDate, "failed", "incomplete_python_output");
    throw new Error(msg);
  }

  // Upsert into DB
  await db
    .insert(dailyVolumeProfileLevels)
    .values({
      symbol,
      sessionDate,
      poc: String(pyOutput.poc),
      vah: String(pyOutput.vah),
      val: String(pyOutput.val),
      nakedPocs: (pyOutput.naked_pocs ?? []) as Record<string, unknown>[],
      profileShape: pyOutput.shape,
      shapeConfidence: String(pyOutput.shape_confidence),
      ibHigh: pyOutput.ib_high != null ? String(pyOutput.ib_high) : null,
      ibLow: pyOutput.ib_low != null ? String(pyOutput.ib_low) : null,
      ibExtensionStatus: pyOutput.ib_extension_status ?? null,
      openClassification: pyOutput.open_classification ?? null,
    })
    .onConflictDoUpdate({
      target: [dailyVolumeProfileLevels.symbol, dailyVolumeProfileLevels.sessionDate],
      set: {
        poc: String(pyOutput.poc),
        vah: String(pyOutput.vah),
        val: String(pyOutput.val),
        nakedPocs: (pyOutput.naked_pocs ?? []) as Record<string, unknown>[],
        profileShape: pyOutput.shape,
        shapeConfidence: String(pyOutput.shape_confidence),
        ibHigh: pyOutput.ib_high != null ? String(pyOutput.ib_high) : null,
        ibLow: pyOutput.ib_low != null ? String(pyOutput.ib_low) : null,
        ibExtensionStatus: pyOutput.ib_extension_status ?? null,
        openClassification: pyOutput.open_classification ?? null,
        computedAt: new Date(),
      },
    });

  // If the Python subprocess also returned a developing POC, cache it
  if (pyOutput.developing_poc != null) {
    updateDevelopingPoc(symbol, pyOutput.developing_poc);
  }

  // Fire SSE
  broadcastSSE("vp:levels-computed", { symbol, sessionDate, shape: pyOutput.shape });

  // Audit log
  await _writeAuditLog(symbol, sessionDate, "completed", null, Date.now() - t0);

  logger.info(
    { symbol, sessionDate, shape: pyOutput.shape, poc: pyOutput.poc, durationMs: Date.now() - t0 },
    "volume-profile-service: VP levels computed and persisted",
  );
}

async function _writeAuditLog(
  symbol: string,
  sessionDate: string,
  status: "completed" | "failed",
  errorMsg: string | null,
  durationMs?: number,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action: "vp_compute",
      entityType: "volume_profile",
      entityId: `${symbol}:${sessionDate}`,
      result: { symbol, sessionDate, status, errorMsg, durationMs } as Record<string, unknown>,
      decisionAuthority: "system",
    });
  } catch (auditErr) {
    logger.warn({ auditErr: String(auditErr) }, "volume-profile-service: audit log write failed (non-blocking)");
  }
}

// ─── Daily cron entry point ──────────────────────────────────────────────────

/**
 * Daily 5:30 PM ET cron — compute VP for all configured symbols.
 * Pipeline-pause-guarded: cron skips when pipeline is paused.
 */
export async function dailyVolumeProfileCron(): Promise<void> {
  if (!(await isPipelineActive())) {
    logger.debug("volume-profile-service: pipeline not ACTIVE — skipping daily VP compute");
    return;
  }

  const sessionDate = _todayEtDate();
  logger.info({ symbols: VP_SYMBOLS, sessionDate }, "volume-profile-service: daily VP cron starting");

  let succeeded = 0;
  let failed = 0;

  for (const symbol of VP_SYMBOLS) {
    try {
      await computeAndPersistDailyVP(symbol, sessionDate);
      succeeded++;
    } catch {
      // Error already logged inside computeAndPersistDailyVP
      failed++;
    }
  }

  logger.info({ succeeded, failed, sessionDate }, "volume-profile-service: daily VP cron complete");
}

// ─── Read helpers ────────────────────────────────────────────────────────────

/**
 * Returns the most recent VP levels row for a symbol where session_date <= beforeDate.
 * Returns null if no row exists.
 */
export async function getLatestVPLevels(symbol: string, beforeDate?: string): Promise<VPLevels | null> {
  try {
    const conditions = beforeDate
      ? and(eq(dailyVolumeProfileLevels.symbol, symbol), lte(dailyVolumeProfileLevels.sessionDate, beforeDate))
      : eq(dailyVolumeProfileLevels.symbol, symbol);

    const rows = await db
      .select()
      .from(dailyVolumeProfileLevels)
      .where(conditions)
      .orderBy(desc(dailyVolumeProfileLevels.sessionDate))
      .limit(1);

    if (rows.length === 0) return null;
    return _rowToVPLevels(rows[0]);
  } catch (err) {
    logger.warn({ symbol, beforeDate, err: String(err) }, "volume-profile-service: getLatestVPLevels failed");
    return null;
  }
}

/**
 * Returns recent VP levels history for a symbol.
 */
export async function getVPLevelsHistory(symbol: string, days = 30): Promise<VPLevels[]> {
  try {
    const rows = await db
      .select()
      .from(dailyVolumeProfileLevels)
      .where(eq(dailyVolumeProfileLevels.symbol, symbol))
      .orderBy(desc(dailyVolumeProfileLevels.sessionDate))
      .limit(days);

    return rows.map(_rowToVPLevels);
  } catch (err) {
    logger.warn({ symbol, days, err: String(err) }, "volume-profile-service: getVPLevelsHistory failed");
    return [];
  }
}

// ─── Manual trigger ──────────────────────────────────────────────────────────

/**
 * Manual trigger for a single symbol+date compute. Rate-limited by route.
 * Pipeline-pause-guarded: throws 423 when paused.
 */
export async function triggerVPCompute(symbol: string, sessionDate: string): Promise<void> {
  if (!(await isPipelineActive())) {
    throw Object.assign(new Error("pipeline_paused"), { statusCode: 423 });
  }
  await computeAndPersistDailyVP(symbol, sessionDate);
}

// ─── A+ gate VP shape scoring ─────────────────────────────────────────────────

/** Result shape returned to the A+ confluence gate in paper-signal-service. */
export interface SessionShapeScoreResult {
  /** 0-100 numeric score. Higher = stronger / more confident profile. */
  score: number;
  /** Raw profile shape string ('D' | 'b' | 'P' | 'Thin'). */
  shape: string;
  /** shapeConfidence from DB, 0-1. */
  confidence: number;
  /** False when no VP row exists for today — caller should fail-open. */
  available: boolean;
}

/**
 * Returns the VP shape score for the given symbol on the given session date.
 *
 * Score formula:
 *   raw_abs = |VP_CONFIG.SHAPE_SCORE[shape]| (0 for D, 5 for b/P, 10 for Thin)
 *   score   = shapeConfidence * (raw_abs / 10) * 100
 *             → a perfectly confident 'b' or 'P' profile = 50
 *             → a perfectly confident 'Thin' profile      = 100
 *             → a 'D' (neutral) profile                   = 0
 *
 * Threshold used by A+ gate: score >= 60 (confident, directionally strong
 * profile — b/P at ≥ 60% confidence or any Thin profile at ≥ 60% confidence).
 *
 * Fail-open: returns { available: false, score: 0 } when no VP row exists.
 * All DB errors are caught and returned as unavailable.
 *
 * Wave 23.C Gap A.1 fix — replaces unconditional fail-open in A+ gate.
 */
export async function getSessionShapeScore(
  symbol: string,
  sessionDate: string,
): Promise<SessionShapeScoreResult> {
  const unavailable: SessionShapeScoreResult = { score: 0, shape: "", confidence: 0, available: false };

  try {
    const rows = await db
      .select({
        profileShape: dailyVolumeProfileLevels.profileShape,
        shapeConfidence: dailyVolumeProfileLevels.shapeConfidence,
      })
      .from(dailyVolumeProfileLevels)
      .where(
        and(
          eq(dailyVolumeProfileLevels.symbol, symbol),
          lte(dailyVolumeProfileLevels.sessionDate, sessionDate),
        ),
      )
      .orderBy(desc(dailyVolumeProfileLevels.sessionDate))
      .limit(1);

    if (rows.length === 0) return unavailable;

    const shape = rows[0].profileShape ?? "";
    const confidence = parseFloat(rows[0].shapeConfidence ?? "0");

    // Map shape to its absolute base weight (0-10 scale)
    const shapeBaseAbs: Record<string, number> = {
      D: 0,    // neutral — no directional score
      b: 5,    // bullish profile
      P: 5,    // bearish profile (absolute value; direction not needed here)
      Thin: 10, // trend day
    };
    const baseAbs = shapeBaseAbs[shape] ?? 0;

    // Compute 0-100 score: confidence × (baseAbs / 10) × 100
    const score = Math.round(confidence * (baseAbs / 10) * 100);

    return { score, shape, confidence, available: true };
  } catch (err) {
    logger.warn(
      { symbol, sessionDate, err: String(err) },
      "volume-profile-service: getSessionShapeScore DB read failed — returning unavailable (fail-open)",
    );
    return unavailable;
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function _todayEtDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD
}

type VPRow = typeof dailyVolumeProfileLevels.$inferSelect;

function _rowToVPLevels(row: VPRow): VPLevels {
  return {
    symbol: row.symbol,
    sessionDate: row.sessionDate,
    poc: parseFloat(row.poc),
    vah: parseFloat(row.vah),
    val: parseFloat(row.val),
    nakedPocs: (row.nakedPocs as NakedPoc[]) ?? [],
    profileShape: row.profileShape,
    shapeConfidence: parseFloat(row.shapeConfidence),
    ibHigh: row.ibHigh != null ? parseFloat(row.ibHigh) : null,
    ibLow: row.ibLow != null ? parseFloat(row.ibLow) : null,
    ibExtensionStatus: row.ibExtensionStatus ?? null,
    openClassification: row.openClassification ?? null,
    computedAt: row.computedAt,
  };
}
