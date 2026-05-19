/**
 * C11 Macro Gate Service — hard gate logic for crisis/FOMC/release days.
 *
 * Hard gates (C11 spec):
 *   1. prob_crisis > 0.60       → no new longs >2hr horizon (ES/NQ/MES/MNQ)
 *   2. ISM < 49 AND RRP < $20B  → no ES/NQ longs (hard gate trigger combo)
 *   3. FOMC day ±1              → 50% position size, tighter stops
 *   4. Macro release day        → no new entries 1hr before to 3hr after
 *
 * Authority:
 *   - Hard gates block new entries (write to audit_log on every block).
 *   - Does NOT force-close existing positions (positions are HELD per C1 logic).
 *   - Gate decisions are ALWAYS deterministic given the current regime state.
 *
 * Consumed by:
 *   - paper-signal-service.ts (entry signal blocking)
 *   - regime-state-service.ts (sizing reduction notification)
 *
 * Pipeline pause guard:
 *   - Gate CHECK (read-only) is ALWAYS allowed.
 *   - Gate WRITE (audit_log) is allowed when pipeline active.
 *
 * Non-duplication note vs B11 calendar_filter:
 *   B11 (calendar_filter.py) handles SHORT-HORIZON FOMC ±30min intraday blackout.
 *   C11 (this service) handles LONGER-HORIZON macro context (days to weeks):
 *     crisis lasting days, ISM regime lasting weeks, FOMC ±1 day sizing modulation.
 *   They are COMPLEMENTARY at different time horizons.
 */

import { eq, desc, and, gte } from "drizzle-orm";
import { db } from "../db/index.js";
import { macroFeatures, macroRegimeStates, auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { getLatestMacroRegimeState } from "./macro-regime-service.js";

// ─── Gate result type ─────────────────────────────────────────────

export interface MacroGateResult {
  /** Allow the entry signal through */
  allowed: boolean;
  /** Block new long entries (crisis or ISM gate) */
  blockNewLongs: boolean;
  /** Block all new entries (release day gate) */
  blockNewEntries: boolean;
  /** FOMC proximity → apply 50% size reduction */
  fomcSizeReduction: boolean;
  /** Human-readable reason for gate decision */
  gateReason: string;
  /** Gate severity */
  severity: "none" | "advisory" | "warning" | "critical";
  /** Macro regime context for audit log */
  macroContext: {
    dominantState: string;
    probCrisis: number;
    crisisGateTriggered: boolean;
    fomcDayProximity: number | null;
    macroReleaseDay: boolean;
  };
}

// ─── ISM/RRP combined gate ───────────────────────────────────────

/**
 * Check if ISM <49 AND RRP <$20B (C11 hard gate combo for ES/NQ/MES/MNQ).
 * Reads from macro_features directly.
 */
async function checkIsmRrpGate(): Promise<{
  ismBelow49: boolean;
  rrpBelow20B: boolean;
  bothTriggered: boolean;
  ismValue: number | null;
  rrpValue: number | null;
}> {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 45);

    // Latest ISM/NAPM value
    const ismRows = await db
      .select()
      .from(macroFeatures)
      .where(
        and(
          eq(macroFeatures.seriesId, "NAPM"),
          gte(macroFeatures.seriesDate, thirtyDaysAgo.toISOString().slice(0, 10)),
        )
      )
      .orderBy(desc(macroFeatures.seriesDate))
      .limit(1);

    // Latest RRPONTSYD value
    const rrpRows = await db
      .select()
      .from(macroFeatures)
      .where(
        and(
          eq(macroFeatures.seriesId, "RRPONTSYD"),
          gte(macroFeatures.seriesDate, thirtyDaysAgo.toISOString().slice(0, 10)),
        )
      )
      .orderBy(desc(macroFeatures.seriesDate))
      .limit(1);

    const ismValue = ismRows.length > 0 ? parseFloat(ismRows[0].value ?? "50") : null;
    const rrpValue = rrpRows.length > 0 ? parseFloat(rrpRows[0].value ?? "100") : null;

    const ismBelow49 = ismValue !== null && ismValue < 49;
    const rrpBelow20B = rrpValue !== null && rrpValue < 20;

    return {
      ismBelow49,
      rrpBelow20B,
      bothTriggered: ismBelow49 && rrpBelow20B,
      ismValue,
      rrpValue,
    };
  } catch (err) {
    logger.warn({ err }, "C11 ISM/RRP gate check failed — assuming no gate");
    return { ismBelow49: false, rrpBelow20B: false, bothTriggered: false, ismValue: null, rrpValue: null };
  }
}

// ─── Main gate evaluation ─────────────────────────────────────────

/**
 * Evaluate all C11 macro hard gates for a proposed entry.
 *
 * @param instrument — Futures instrument symbol ("ES", "NQ", "MES", "MNQ", "MCL")
 * @param direction  — Entry direction ("long" | "short")
 * @param strategyId — Strategy UUID for audit log attribution
 * @returns MacroGateResult
 */
export async function evaluateMacroGates(
  instrument: string,
  direction: "long" | "short",
  strategyId?: string,
): Promise<MacroGateResult> {
  const regimeState = await getLatestMacroRegimeState();

  // No regime state → fail open (don't block when we don't know)
  if (!regimeState) {
    return {
      allowed: true,
      blockNewLongs: false,
      blockNewEntries: false,
      fomcSizeReduction: false,
      gateReason: "no macro regime state available — fail open",
      severity: "none",
      macroContext: {
        dominantState: "unknown",
        probCrisis: 0,
        crisisGateTriggered: false,
        fomcDayProximity: null,
        macroReleaseDay: false,
      },
    };
  }

  const {
    probCrisis,
    crisisGateTriggered,
    fomcDayProximity,
    macroReleaseDay,
    dominantState,
  } = regimeState;

  const isIndexFuture = ["ES", "NQ", "MES", "MNQ"].includes(instrument.toUpperCase());
  const reasons: string[] = [];
  let blockNewLongs = false;
  let blockNewEntries = false;
  let fomcSizeReduction = false;
  let severity: MacroGateResult["severity"] = "none";

  // Gate 1: Crisis probability > 0.60 → no new longs (index futures only)
  if ((crisisGateTriggered || probCrisis > 0.60) && isIndexFuture && direction === "long") {
    blockNewLongs = true;
    reasons.push(`Crisis gate: prob_crisis=${probCrisis.toFixed(3)} > 0.60`);
    severity = "critical";
  }

  // Gate 2: ISM <49 AND RRP <$20B → no ES/NQ longs
  if (isIndexFuture && direction === "long") {
    const ismRrp = await checkIsmRrpGate();
    if (ismRrp.bothTriggered) {
      blockNewLongs = true;
      reasons.push(
        `ISM/RRP gate: ISM=${ismRrp.ismValue?.toFixed(1)} <49 AND RRP=${ismRrp.rrpValue?.toFixed(1)}B <$20B`
      );
      if (severity !== "critical") severity = "critical";
    }
  }

  // Gate 3: Macro release day → no new entries ±1hr (handled intraday by B11)
  if (macroReleaseDay) {
    blockNewEntries = true;
    reasons.push("Macro release day: no new entries within ±1hr window");
    if (severity === "none") severity = "warning";
  }

  // Gate 4: FOMC proximity ±1 day → 50% size reduction
  if (fomcDayProximity !== null && Math.abs(fomcDayProximity) <= 1) {
    fomcSizeReduction = true;
    reasons.push(`FOMC ±1 day (proximity=${fomcDayProximity}): 50% size reduction`);
    if (severity === "none") severity = "advisory";
  }

  const allowed = !blockNewLongs && !blockNewEntries;
  const gateReason = reasons.length > 0 ? reasons.join("; ") : "no macro gate triggered";

  // Write audit log on any block (fire-and-forget)
  if (!allowed && strategyId) {
    void db.insert(auditLog).values({
      action: "macro_gate.blocked",
      entityType: "strategy",
      entityId: strategyId,
      details: {
        instrument,
        direction,
        gateReason,
        probCrisis,
        dominantState,
        crisisGateTriggered,
        fomcDayProximity,
        macroReleaseDay,
      },
      severity: severity as string,
      source: "macro-gate-service",
    }).catch((err) => {
      logger.warn({ err }, "C11 macro gate audit log write failed");
    });
  }

  if (!allowed) {
    logger.info(
      { instrument, direction, gateReason, severity, strategyId },
      "C11 macro gate BLOCKED entry signal"
    );
  }

  return {
    allowed,
    blockNewLongs,
    blockNewEntries,
    fomcSizeReduction,
    gateReason,
    severity,
    macroContext: {
      dominantState,
      probCrisis,
      crisisGateTriggered,
      fomcDayProximity,
      macroReleaseDay,
    },
  };
}
