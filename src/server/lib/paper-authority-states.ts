/**
 * paper-authority-states.ts — M3-core: PAPER Authority Flip (2026-07-17)
 *
 * Single source of truth for "which lifecycle states are TradersPost/broker
 * -authoritative" — i.e. states for which the internal paper-trading simulator
 * (Massive-WS stream + evaluateSignals + openPosition) must NEVER produce a
 * fill or route an order, because an external system (TradersPost's broker
 * tape) is the canonical journal instead.
 *
 * WHY THIS FILE EXISTS: before this module, the same 4-state literal
 * `["PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED"]` (or the equivalent Set) was
 * independently declared at 3 call sites (`routes/paper.ts`,
 * `services/paper-signal-service.ts`, `scheduler.ts`). Fixing "PAPER should no
 * longer be broker-authoritative" by editing 3 literals independently would
 * recreate the exact duplicated-constant drift class this campaign has
 * repeatedly found and fixed (e.g. GATE3's `countPaperTradingDaysSince`
 * extraction, landed the same day as this packet). All 3 sites now import
 * from here so the value can never drift apart between them again.
 *
 * PRE-M3 value (historical, no longer live): {PAPER, DEPLOY_READY, PILOT, DEPLOYED}
 *   — TradersPost was authoritative for PAPER and everything after it.
 * POST-M3 value (this file):                 {DEPLOY_READY, PILOT, DEPLOYED}
 *   — PAPER is now internal-engine-only. TradersPost authority begins only
 *     at DEPLOY_READY (the strategy-library / human-review stage) and
 *     continues through PILOT and DEPLOYED. PILOT and DEPLOYED are UNTOUCHED
 *     by this wave — byte-identical behavior before and after.
 *
 * NOT the same concept as (do NOT merge with these — see their own docstrings):
 *   - `services/validation-cadence-service.ts`'s `PAPER_PLUS_STATES` /
 *     `END_TO_END_TARGET_STATES` — "has this strategy been tested end-to-end"
 *     for the monthly Reality Check cadence report. PAPER still counts as
 *     tested end-to-end under the new doctrine (arguably more so — it's now
 *     genuinely internal-engine-driven rather than externally proxied), so
 *     that set correctly KEEPS PAPER. Merging it into this module would wrongly
 *     couple an unrelated observability metric to the broker-authority boundary.
 *   - `services/shadow-rerun-service.ts`'s `PAPER_PLUS_STATES` — "strategies
 *     that produced real evidence and were promoted past TESTING" for the
 *     shadow backtest re-run diff tool. Also correctly KEEPS PAPER (a PAPER
 *     strategy's backtest evidence is still real evidence past TESTING,
 *     regardless of who journals its live paper trades). Also correctly out
 *     of scope for this module.
 *   CORRECTION (2026-07-17, independent-grader finding): the two files' actual
 *   VALUES are not identical — `validation-cadence-service.ts` is the OLD
 *   4-state shape `["PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED"]`, while
 *   `shadow-rerun-service.ts` is a DIFFERENT 6-state shape
 *   `["PAPER", "DEPLOY_READY", "DEPLOYED", "DECLINING", "RETIRED", "GRAVEYARD"]`
 *   (missing PILOT; includes 3 terminal states neither this module nor
 *   validation-cadence's set covers). Both are still correctly out of this
 *   module's scope — they encode their own orthogonal concepts, verified
 *   directly above — but do not assume the two are textually identical to
 *   each other; only the identical CONSTANT NAME (`PAPER_PLUS_STATES`) across
 *   3+ files is the pre-existing naming collision worth a future rename to
 *   reduce confusion. Renaming an unrelated file's private/exported constant
 *   is out of this packet's scope and risks unrelated regressions in
 *   reporting the operator depends on (AGENTS.md "no new infra while panel
 *   RED" rule).
 *
 * `server-mediated-executor.ts`'s `LIVE_EXECUTION_STATES` ({DEPLOYED, PILOT})
 * is a stricter subset (excludes DEPLOY_READY — not yet live-execution-
 * eligible even though broker-authoritative for paper purposes). It is kept
 * as its OWN independent literal rather than derived from this module — see
 * that file's docstring for why (a subtractive derivation would fail-OPEN on
 * the live-capital boundary if a future broker-authoritative state were added
 * without updating a filter). A dedicated test
 * (`server-mediated-executor.test.ts` / this module's own test file) asserts
 * LIVE_EXECUTION_STATES is always a strict subset of BROKER_AUTHORITATIVE_STATES
 * so the two can never silently diverge in the dangerous direction.
 */

/** Lifecycle states for which TradersPost (external broker) is the canonical
 *  paper-trade journal. The internal simulator must never fill or route for
 *  a strategy in one of these states. */
export const BROKER_AUTHORITATIVE_STATES = ["DEPLOY_READY", "PILOT", "DEPLOYED"] as const;

export type BrokerAuthoritativeState = (typeof BROKER_AUTHORITATIVE_STATES)[number];

const BROKER_AUTHORITATIVE_STATES_SET: ReadonlySet<string> = new Set(BROKER_AUTHORITATIVE_STATES);

/**
 * True when `lifecycleState` is one of the broker/TradersPost-authoritative
 * states. Null/undefined/unknown strings are treated as NOT broker-
 * authoritative (fail-open toward the internal engine, matching the existing
 * B5 scheduler guard's documented fail-open-on-missing-FK behavior — an
 * orphaned session with no resolvable lifecycle state is safe to treat as
 * pre-authoritative rather than silently never-resumable).
 */
export function isBrokerAuthoritativeState(lifecycleState: string | null | undefined): boolean {
  if (!lifecycleState) return false;
  return BROKER_AUTHORITATIVE_STATES_SET.has(lifecycleState);
}
