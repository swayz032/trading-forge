/**
 * lunch-blackout-gate.ts — Wave 26 Pass K Phase 2 (2026-05-26)
 *
 * Hard signal-time gate rejecting all entries inside the institutional 2026
 * lunch dead zone (11:30 ET to 13:30 ET).
 *
 * Why this window (not the operator's intuited 12:00 PM cutoff):
 *   - Tradeify 13-year prop firm dataset (2026-04-13): >60% false-breakout
 *     rate from 11:30 ET onward. Dead zone starts at 11:30, not 12:00.
 *   - Tradecovex hour-by-hour guide (2026-04-09): "11:30 AM to 1:30 PM ET —
 *     the worst hours of the day... do not trade at all during this period."
 *   - TradingStats.net 12,095-day futures study (2026-03-16): Lunch
 *     (12:00–13:00 ET) accounts for only 4.5% of NQ HODs vs PM 35%.
 *   - QUANTUITION 2026-05 SPX scalp study confirms median absolute lunch
 *     move is 10–11 points + vol 30–50% below open/close — specialist
 *     mean-reversion edge exists in compressed vol BUT trend-following /
 *     structural-setup strategies (Trading Forge's canonical mandate) take
 *     >60% false-breakouts in this window.
 *
 * Why NOT a full noon-to-EOD cutoff:
 *   - TradingStats.net: PM RTH (13:30–15:30 ET) hosts 35% of NQ HOD
 *     formations + the 73–77% AM/PM opposite-sides structural constant.
 *     Blocking PM entirely discards a major structural edge window.
 *   - PM size taper (`pm-size-factor.ts`) is the correct EOD-DD-aware
 *     mechanism for the PM session, NOT a hard blackout.
 *
 * Pure-function design:
 *   - This module is the evaluator: feeds in `barTsUtc` + window config →
 *     returns `{block, reason}`. Reuses `entry-windows.ts` for ET-aware
 *     time math (DST-correct via Intl.DateTimeFormat).
 *   - Caller (paper-signal-service.ts) owns audit emission.
 *
 * Per-strategy override:
 *   - `entry_quality.lunch_blackout_disabled=true` bypasses the gate.
 *     Reserved for mean-reversion archetypes (bounce_off_level family with
 *     explicit compressed-vol-targeting params). NEVER enable on
 *     trend-following or structural-setup strategies — that's the failure
 *     mode the 60%+ false-breakout dataset captures.
 *
 * Failure mode:
 *   - Bad window config → fail-CLOSED (block all entries). Better to halt
 *     trading on misconfiguration than to silently re-enable a gate the
 *     operator believes is active. This is the OPPOSITE of the daily trade
 *     cap (which fails OPEN) — that gate exists to limit over-trading;
 *     this gate exists to PREVENT a known-bad time window. Different risks.
 */

import { parseEntryWindow, isBarInWindow, type EntryWindow } from "./entry-windows.js";

export interface LunchBlackoutGateInput {
  /** Bar timestamp (UTC). */
  barTsUtc: Date;
  /** Blackout start time, "HH:MM" in ET. Default "11:30". */
  startEt?: string;
  /** Blackout end time, "HH:MM" in ET. Default "13:30". */
  endEt?: string;
  /** Per-strategy disable flag (entry_quality.lunch_blackout_disabled). */
  perStrategyDisabled?: boolean;
}

export interface LunchBlackoutGateResult {
  /** True if the signal must be rejected (inside blackout). */
  block: boolean;
  /** Human-readable reason for audit row + Discord WARN. */
  reason: string;
  /** Resolved window spec (echoed for audit). */
  windowSpec: string;
  /** True if per-strategy override bypassed the gate. */
  perStrategyOverrideApplied: boolean;
}

/**
 * Read the framework env default for the start boundary. Centralized so tests
 * can mock and code doesn't sprinkle `process.env.LUNCH_BLACKOUT_START_ET`.
 *
 * Default: "11:30" (institutional 2026 dead-zone start per Tradeify 13-yr
 * dataset; 30 min earlier than operator's intuited 12:00 PM cutoff).
 */
export function getLunchBlackoutStartEnvDefault(): string {
  const raw = process.env.LUNCH_BLACKOUT_START_ET;
  if (!raw || typeof raw !== "string" || raw.trim() === "") return "11:30";
  return raw.trim();
}

/**
 * Read the framework env default for the end boundary.
 *
 * Default: "13:30" (institutional 2026 dead-zone end; PM session re-opens
 * here per TradingStats.net 35%-of-HODs evidence).
 */
export function getLunchBlackoutEndEnvDefault(): string {
  const raw = process.env.LUNCH_BLACKOUT_END_ET;
  if (!raw || typeof raw !== "string" || raw.trim() === "") return "13:30";
  return raw.trim();
}

/**
 * Evaluate the lunch blackout gate. Pure-function — no I/O, no Date.now().
 *
 * Contract:
 *   - perStrategyDisabled=true → allow (block=false), reason explains override
 *   - barTsUtc inside [start, end) ET → block=true (gate fires)
 *   - barTsUtc outside [start, end) ET → block=false (clear)
 *   - Malformed window config → block=true (fail-CLOSED; halt trading on misconfig)
 *
 * Boundary semantics: `[start, end)` left-inclusive, right-exclusive, matching
 * the entry-windows.ts convention. A bar at exactly 11:30:00 ET IS blocked
 * (start of dead zone); a bar at exactly 13:30:00 ET is NOT blocked (PM re-open).
 */
export function evaluateLunchBlackoutGate(input: LunchBlackoutGateInput): LunchBlackoutGateResult {
  const startEt = input.startEt ?? "11:30";
  const endEt = input.endEt ?? "13:30";
  const windowSpec = `${startEt}-${endEt} ET`;

  if (input.perStrategyDisabled === true) {
    return {
      block: false,
      reason: "per_strategy_override:lunch_blackout_disabled=true",
      windowSpec,
      perStrategyOverrideApplied: true,
    };
  }

  let window: EntryWindow;
  try {
    window = parseEntryWindow(windowSpec);
  } catch (parseErr) {
    // Fail-CLOSED on misconfiguration — never silently re-enable a gate the
    // operator believes is active. The audit row carries the parse error.
    return {
      block: true,
      reason: `lunch_blackout_config_error:${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      windowSpec,
      perStrategyOverrideApplied: false,
    };
  }

  const inside = isBarInWindow(input.barTsUtc, window);
  if (inside) {
    return {
      block: true,
      reason: `lunch_blackout_window:${windowSpec} — Tradeify 13-yr dataset >60% false-breakout rate; TradingStats.net 12k-day study only 4.5% of NQ HODs in this window (CLAUDE.md §4)`,
      windowSpec,
      perStrategyOverrideApplied: false,
    };
  }

  return {
    block: false,
    reason: `outside_blackout_window:${windowSpec}`,
    windowSpec,
    perStrategyOverrideApplied: false,
  };
}
