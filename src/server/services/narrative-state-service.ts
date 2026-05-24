/**
 * narrative-state-service.ts — Wave 25 Pass 6 W25.11
 *
 * Tracks institutional narrative continuity: the Accumulation → Manipulation →
 * Distribution cycle that institutional desks ride. Closes the "biggest missing
 * concept" GPT critique: narrative continuity across sessions.
 *
 * Public API:
 *   computeNarrativeState(htfNarrative, structureState, currentBar, liquidityLevelsNearby)
 *     Pure function — no DB, no Date.now(), no side effects. Deterministic for replay.
 *
 *   persistNarrativeState(sessionDate, symbol, state, correlationId)
 *     Writes state to bias_state.narrative_state (UPDATE latest row for the day).
 *     Fires audit event narrative.phase_transition ONLY on phase change (idempotent).
 *
 * Phase state machine:
 *   NEUTRAL → ACCUMULATION  when Asian range is formed and bar is pre-NY-open.
 *   ACCUMULATION → MANIPULATION  when price sweeps a key HTF level.
 *   MANIPULATION → DISTRIBUTION  when structureState.mss_recent confirms displacement.
 *   DISTRIBUTION → REVERSAL_FORMING  when price returns to swept level (failed expansion).
 *   Any → NEUTRAL  when input data is insufficient or outside the cycle.
 *
 * Hard rules:
 *   - DOES NOT mutate DailyDealing or any existing HtfNarrative sub-dataclass.
 *   - NarrativePhase is a parallel field added alongside the 4 existing HtfNarrative
 *     sub-dataclasses (A/M/D parallel, NOT a piggyback on DailyDealing.current_quadrant).
 *   - Backward-compat: htfNarrative=null or structureState=null → NEUTRAL (fail-open).
 *   - Logger imported from ./logger.js leaf module (not ../index.js).
 *   - Audit rows use insertAuditRow from ../lib/audit-log-helper.js.
 *
 * Env var:
 *   CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE=true|false (default false)
 *   When true, evalMarketStructureAligned() in confluence-score.ts additionally
 *   requires narrativePhase === "DISTRIBUTION" to satisfy the factor.
 */

import { logger } from "../lib/logger.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { db } from "../db/index.js";
import { biasState } from "../db/schema.js";
import { sql, desc, and, eq } from "drizzle-orm";
import type { HtfNarrative } from "./bias-state-service.js";
import type { StructureState } from "./confluence-score.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type NarrativePhase =
  | "ACCUMULATION"      // pre-NY-open range forming
  | "MANIPULATION"      // liquidity sweep of accumulation extreme
  | "DISTRIBUTION"      // expansion away from sweep with displacement confirmed
  | "REVERSAL_FORMING"  // post-distribution failed expansion; new accumulation forming
  | "NEUTRAL";          // outside the cycle (mid-session chop, holiday, insufficient data)

export interface NarrativeState {
  phase: NarrativePhase;
  phase_started_at: string;          // ISO timestamp when this phase was entered
  accumulation_range: { high: number | null; low: number | null };
  manipulation_swept: {
    which: "pdh" | "pdl" | "asian_high" | "asian_low" | "london_high" | "london_low" | null;
    price: number | null;
  };
  displacement_confirmed: boolean;
  expansion_target: number | null;   // nearest DOL in direction-of-displacement
  computed_at_bar_idx: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

// Sweep tolerance: price must exceed the level by at least this many ticks
// (0.25 point for MES/MNQ) to count as a genuine sweep, not a tag.
const SWEEP_TOLERANCE = 0.25;

// Reversal threshold: price must return within this fraction of the swept level's
// distance from accumulation midpoint to classify as REVERSAL_FORMING.
const REVERSAL_RETURN_FRACTION = 0.5;

/**
 * Determine if `price` sweeps `level` from `approaching_direction`.
 * approaching_direction="above" means we expect the level to be above price (short sweep).
 */
function _sweepsLevel(
  price: number,
  level: number,
  direction: "above" | "below",
): boolean {
  if (direction === "above") {
    return price >= level + SWEEP_TOLERANCE;
  }
  return price <= level - SWEEP_TOLERANCE;
}

// ─── Core compute function (pure — no I/O) ────────────────────────────────────

/**
 * Compute the current narrative phase from available context.
 *
 * Pure function — deterministic, no side effects, no Date.now().
 * Callers supply `currentBar.ts_event` for phase_started_at.
 *
 * @param htfNarrative    Pass 2 HtfNarrative; null → NEUTRAL.
 * @param structureState  Pass 1 StructureState; null → blocks DISTRIBUTION.
 * @param currentBar      Current execution bar snapshot.
 * @param liquidityLevelsNearby  Ranked levels from liquidity-map-service.
 * @param previousState   Prior NarrativeState if available (for phase continuity).
 */
export function computeNarrativeState(
  htfNarrative: HtfNarrative | null,
  structureState: StructureState | null,
  currentBar: { close: number; high: number; low: number; ts_event: Date },
  liquidityLevelsNearby: Array<{ price: number; level_type: string }>,
  previousState?: NarrativeState | null,
): NarrativeState {
  const now = currentBar.ts_event.toISOString();

  const neutral = (): NarrativeState => ({
    phase: "NEUTRAL",
    phase_started_at: now,
    accumulation_range: { high: null, low: null },
    manipulation_swept: { which: null, price: null },
    displacement_confirmed: false,
    expansion_target: null,
    computed_at_bar_idx: previousState?.computed_at_bar_idx ?? 0,
  });

  // Back-compat guard: missing inputs → NEUTRAL
  if (htfNarrative === null) {
    return neutral();
  }

  // ── Compute UTC hour of the current bar for session guard ─────────────────
  const utcHour = currentBar.ts_event.getUTCHours();
  const utcMin = currentBar.ts_event.getUTCMinutes();
  const totalUtcMin = utcHour * 60 + utcMin;

  // NY open = 13:30 UTC (09:30 ET EDT). 13:30 = 810 min UTC.
  const isPreNyOpen = totalUtcMin < 810;

  // ── Detect ACCUMULATION ───────────────────────────────────────────────────
  // Condition: Asian range is formed AND we are still pre-NY-open.
  const asianHigh = htfNarrative.asian_range.high;
  const asianLow = htfNarrative.asian_range.low;
  const asianRangeFormed = asianHigh !== null && asianLow !== null &&
    htfNarrative.asian_range.range_size !== null &&
    htfNarrative.asian_range.range_size > 0;

  if (!asianRangeFormed) {
    return neutral();
  }

  // ── Resolve london extremes (null-safe) ───────────────────────────────────
  // We need these for sweep detection even outside accumulation window.
  // london_high / london_low are not stored on LondonBias directly — we approximate
  // by checking swept_pdh / swept_pdl and using PDH/PDL from DailyDealing.
  const pdh = htfNarrative.daily_dealing.dealing_range_high;
  const pdl = htfNarrative.daily_dealing.dealing_range_low;

  // ── Carry previous phase forward if inputs are consistent ─────────────────
  // This is the key continuity mechanism: once a phase is entered, it persists
  // until the next gate fires. The cron calls computeNarrativeState every 5 min
  // and passes the prior state so we don't regress from DISTRIBUTION to ACCUMULATION
  // just because we're past NY open.
  const prevPhase = previousState?.phase ?? "NEUTRAL";
  const prevManipulationSwept = previousState?.manipulation_swept ?? { which: null, price: null };
  const prevDisplacementConfirmed = previousState?.displacement_confirmed ?? false;
  const prevPhaseStartedAt = previousState?.phase_started_at ?? now;
  const prevAccumRange = previousState?.accumulation_range ?? { high: null, low: null };

  // ── DISTRIBUTION → REVERSAL_FORMING detection ─────────────────────────────
  if (prevPhase === "DISTRIBUTION" && prevManipulationSwept.price !== null) {
    // Price returning to the swept level after displacement = failed expansion.
    const sweptPrice = prevManipulationSwept.price;
    const accMid =
      prevAccumRange.high !== null && prevAccumRange.low !== null
        ? (prevAccumRange.high + prevAccumRange.low) / 2
        : sweptPrice;
    const distanceFromMid = Math.abs(sweptPrice - accMid);
    const revertThreshold = distanceFromMid * REVERSAL_RETURN_FRACTION;

    const reversedToSwept =
      Math.abs(currentBar.close - sweptPrice) <= revertThreshold;

    if (reversedToSwept) {
      return {
        phase: "REVERSAL_FORMING",
        phase_started_at: now,
        accumulation_range: prevAccumRange,
        manipulation_swept: prevManipulationSwept,
        displacement_confirmed: prevDisplacementConfirmed,
        expansion_target: null,
        computed_at_bar_idx: previousState?.computed_at_bar_idx ?? 0,
      };
    }

    // Still in DISTRIBUTION — carry forward with same phase_started_at
    return {
      phase: "DISTRIBUTION",
      phase_started_at: prevPhaseStartedAt,
      accumulation_range: prevAccumRange,
      manipulation_swept: prevManipulationSwept,
      displacement_confirmed: true,
      expansion_target: previousState?.expansion_target ?? null,
      computed_at_bar_idx: previousState?.computed_at_bar_idx ?? 0,
    };
  }

  // ── MANIPULATION → DISTRIBUTION detection ────────────────────────────────
  if (prevPhase === "MANIPULATION" && structureState !== null) {
    // MSS (Market Structure Shift) confirms institutional displacement after the sweep.
    if (structureState.mss_recent === true) {
      // Find expansion target: nearest liquidity level in the direction of displacement.
      const mssDirection = structureState.mss_direction;
      let expansionTarget: number | null = null;
      if (mssDirection === "bullish") {
        const above = liquidityLevelsNearby
          .filter((l) => l.price > currentBar.close)
          .sort((a, b) => a.price - b.price);
        expansionTarget = above[0]?.price ?? null;
      } else if (mssDirection === "bearish") {
        const below = liquidityLevelsNearby
          .filter((l) => l.price < currentBar.close)
          .sort((a, b) => b.price - a.price);
        expansionTarget = below[0]?.price ?? null;
      }

      return {
        phase: "DISTRIBUTION",
        phase_started_at: now,
        accumulation_range: prevAccumRange,
        manipulation_swept: prevManipulationSwept,
        displacement_confirmed: true,
        expansion_target: expansionTarget,
        computed_at_bar_idx: previousState?.computed_at_bar_idx ?? 0,
      };
    }

    // Still in MANIPULATION — carry forward
    return {
      phase: "MANIPULATION",
      phase_started_at: prevPhaseStartedAt,
      accumulation_range: prevAccumRange,
      manipulation_swept: prevManipulationSwept,
      displacement_confirmed: false,
      expansion_target: null,
      computed_at_bar_idx: previousState?.computed_at_bar_idx ?? 0,
    };
  }

  // ── REVERSAL_FORMING — carry forward (becomes ACCUMULATION on next session) ─
  if (prevPhase === "REVERSAL_FORMING") {
    return {
      phase: "REVERSAL_FORMING",
      phase_started_at: prevPhaseStartedAt,
      accumulation_range: prevAccumRange,
      manipulation_swept: prevManipulationSwept,
      displacement_confirmed: prevDisplacementConfirmed,
      expansion_target: null,
      computed_at_bar_idx: previousState?.computed_at_bar_idx ?? 0,
    };
  }

  // ── ACCUMULATION → MANIPULATION sweep detection ───────────────────────────
  // We check sweeps regardless of prevPhase when we know the asian range is formed.
  // This handles the case where a previous state was NEUTRAL or ACCUMULATION.
  //
  // DIRECTIONAL sweep logic:
  //   "resistance" levels (highs): swept when bar HIGH exceeds level + tolerance
  //   "support" levels (lows):     swept when bar LOW  falls below level - tolerance
  //
  // PDH/PDL are checked FIRST — higher HTF significance than Asian/London highs.
  // This prevents an Asian-high match shadowing a PDH sweep on the same bar.
  type SweepCandidate = {
    which: "pdh" | "pdl" | "asian_high" | "asian_low" | "london_high" | "london_low";
    price: number;
    side: "resistance" | "support"; // resistance = swept by high; support = swept by low
  };
  const sweepCandidates: SweepCandidate[] = [];

  // PDH/PDL first — highest HTF significance
  if (pdh !== null) {
    sweepCandidates.push({ which: "pdh", price: pdh, side: "resistance" });
  }
  if (pdl !== null) {
    sweepCandidates.push({ which: "pdl", price: pdl, side: "support" });
  }

  // Asian high/low sweeps
  if (asianHigh !== null) {
    sweepCandidates.push({ which: "asian_high", price: asianHigh, side: "resistance" });
  }
  if (asianLow !== null) {
    sweepCandidates.push({ which: "asian_low", price: asianLow, side: "support" });
  }

  // London sweep approximation using swept_pdh / swept_pdl flags
  // If London swept PDH, the london_high is approximately at PDH level.
  if (htfNarrative.london_bias.swept_pdh && pdh !== null) {
    sweepCandidates.push({ which: "london_high", price: pdh, side: "resistance" });
  }
  if (htfNarrative.london_bias.swept_pdl && pdl !== null) {
    sweepCandidates.push({ which: "london_low", price: pdl, side: "support" });
  }

  // Check if current bar sweeps any candidate (directional: high for resistance, low for support)
  let swept: SweepCandidate | null = null;
  for (const candidate of sweepCandidates) {
    if (
      candidate.side === "resistance"
        ? currentBar.high >= candidate.price + SWEEP_TOLERANCE
        : currentBar.low <= candidate.price - SWEEP_TOLERANCE
    ) {
      swept = candidate;
      break; // Use first matching candidate (PDH/PDL prioritised)
    }
  }

  if (swept !== null) {
    return {
      phase: "MANIPULATION",
      phase_started_at: now,
      accumulation_range: { high: asianHigh, low: asianLow },
      manipulation_swept: { which: swept.which, price: swept.price },
      displacement_confirmed: false,
      expansion_target: null,
      computed_at_bar_idx: previousState?.computed_at_bar_idx ?? 0,
    };
  }

  // ── ACCUMULATION (pre-NY-open, range formed, no sweep yet) ───────────────
  if (isPreNyOpen) {
    return {
      phase: "ACCUMULATION",
      phase_started_at: prevPhase === "ACCUMULATION" ? prevPhaseStartedAt : now,
      accumulation_range: { high: asianHigh, low: asianLow },
      manipulation_swept: { which: null, price: null },
      displacement_confirmed: false,
      expansion_target: null,
      computed_at_bar_idx: previousState?.computed_at_bar_idx ?? 0,
    };
  }

  // ── Default: NEUTRAL ──────────────────────────────────────────────────────
  return neutral();
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Persist NarrativeState to bias_state.narrative_state.
 *
 * Updates the most recent bias_state row for (session_date, symbol) via a
 * targeted SQL UPDATE. Does NOT INSERT a new row — bias_state rows are owned
 * by bias-state-service.ts; we piggyback narrative data on the existing row.
 *
 * Fires audit event narrative.phase_transition ONLY when the phase changed
 * from the previously persisted value (idempotent: no spam on repeated ticks).
 *
 * Never throws — all errors are logged and swallowed (non-blocking).
 */
export async function persistNarrativeState(
  sessionDate: string,
  symbol: string,
  state: NarrativeState,
  correlationId: string,
): Promise<void> {
  try {
    // Read the latest row for this (session_date, symbol) to detect phase transitions
    const rows = await db
      .select({
        id: biasState.id,
        narrativeState: biasState.narrativeState,
      })
      .from(biasState)
      .where(
        and(
          eq(biasState.sessionDate, sessionDate),
          eq(biasState.symbol, symbol),
        ),
      )
      .orderBy(desc(biasState.computedAt))
      .limit(1);

    if (rows.length === 0) {
      logger.warn(
        { sessionDate, symbol, correlationId },
        "narrative-state-service: no bias_state row found for session — skipping persist",
      );
      return;
    }

    const row = rows[0];
    const prevNarrative = row.narrativeState as NarrativeState | null;
    const prevPhase = prevNarrative?.phase ?? null;
    const newPhase = state.phase;
    const phaseChanged = prevPhase !== newPhase;

    // Update the narrative_state column on the latest row
    await db
      .update(biasState)
      .set({ narrativeState: state as unknown as Record<string, unknown> })
      .where(eq(biasState.id, row.id));

    logger.debug(
      { sessionDate, symbol, phase: newPhase, prevPhase, correlationId },
      "narrative-state-service: persisted narrative state",
    );

    // Audit event only on phase transition — not every 5-min tick
    if (phaseChanged) {
      await insertAuditRow({
        action: "narrative.phase_transition",
        entityType: "narrative_state",
        entityId: `${symbol}:${sessionDate}`,
        status: "success",
        input: { sessionDate, symbol, correlationId },
        result: {
          from_phase: prevPhase,
          to_phase: newPhase,
          evidence: {
            trigger: _buildTransitionTrigger(state),
            sweep_price: state.manipulation_swept.price,
            displacement_confirmed: state.displacement_confirmed,
          },
          symbol,
          session_date: sessionDate,
        },
        correlationId,
      }).catch((err) => {
        logger.warn(
          { err, sessionDate, symbol, correlationId },
          "narrative-state-service: audit insert failed (non-blocking)",
        );
      });

      logger.info(
        { from_phase: prevPhase, to_phase: newPhase, symbol, sessionDate, correlationId },
        "narrative-state-service: phase transition",
      );
    }
  } catch (err) {
    logger.warn(
      { err, sessionDate, symbol, correlationId },
      "narrative-state-service: persistNarrativeState failed (non-blocking)",
    );
  }
}

/** Build a human-readable transition trigger string for the audit evidence. */
function _buildTransitionTrigger(state: NarrativeState): string {
  switch (state.phase) {
    case "ACCUMULATION":
      return "asian_range_formed";
    case "MANIPULATION":
      return state.manipulation_swept.which
        ? `sweep_of_${state.manipulation_swept.which}`
        : "sweep_detected";
    case "DISTRIBUTION":
      return "mss_displacement_confirmed";
    case "REVERSAL_FORMING":
      return "price_returned_to_swept_level";
    case "NEUTRAL":
    default:
      return "insufficient_data_or_outside_cycle";
  }
}

/**
 * Load the latest persisted NarrativeState for a given session+symbol.
 * Returns null when no row exists or narrative_state column is null.
 * Used by the narrative-state-tracker cron to provide previousState continuity.
 */
export async function loadLatestNarrativeState(
  sessionDate: string,
  symbol: string,
): Promise<NarrativeState | null> {
  try {
    const rows = await db
      .select({ narrativeState: biasState.narrativeState })
      .from(biasState)
      .where(
        and(
          eq(biasState.sessionDate, sessionDate),
          eq(biasState.symbol, symbol),
        ),
      )
      .orderBy(desc(biasState.computedAt))
      .limit(1);

    const raw = rows[0]?.narrativeState;
    if (raw == null) return null;
    return raw as NarrativeState;
  } catch (err) {
    logger.warn(
      { err, sessionDate, symbol },
      "narrative-state-service: loadLatestNarrativeState failed",
    );
    return null;
  }
}
