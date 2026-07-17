/**
 * profit-milestone-shadow.ts — Wave 6 ($250-1K/day campaign) shadow profit-milestone governor.
 *
 * WHAT THIS IS:
 *   A pure OBSERVABILITY bucketing tool. It watches a paper session's running realized
 *   P&L and classifies it into a coarse zone (NORMAL / BASE / STRONG / EXCEPTIONAL) so a
 *   human — or a future dashboard — can see when a session is having an exceptional day.
 *
 * WHAT THIS IS NOT (operator directive — non-negotiable, CLAUDE.md §5):
 *   Daily upside stays UNCAPPED. There is no fixed take-profit ceiling anywhere in this
 *   system, and this module must NEVER become one, now or by future accident. It does not
 *   read position state, does not compute an exit price, does not touch a stop, and has
 *   no code path that can influence `lockoutBlocked` or any exit/close function. Reaching
 *   "EXCEPTIONAL" means "log it for the operator to see," never "stop trading" or
 *   "take profit here." A strong trend day is exactly what the runner-trail exit engine
 *   is designed to ride — this module observes that outcome, it does not gate it.
 *
 *   Deliberately NOT named a "ceiling", "cap", or "limit" anywhere in this file — those
 *   words describe the opposite of what this module is for.
 *
 * Zones (observability buckets ONLY — see the block comment above the thresholds below
 * for the full non-negotiable framing):
 *   NORMAL      : sessionPnl <  $250
 *   BASE        : $250  <= sessionPnl <  $500
 *   STRONG      : $500  <= sessionPnl <  $1000
 *   EXCEPTIONAL : sessionPnl >= $1000
 *
 * Fail-open philosophy (mirrors daily-trade-cap.ts's fail-open-toward-"allow" precedent,
 * but stricter — this module fails open toward "never blocks, never throws past its own
 * boundary, always returns a benign result on internal error"):
 *   - `evaluateProfitMilestone` is a pure function with no DB/network/I-O of any kind, so
 *     under normal conditions it cannot throw. It is still wrapped in an internal try/catch
 *     as a structural guarantee: a caller may pass a malformed `input` (e.g. via `any`-typed
 *     JS callers, or a future refactor that loosens the type), and this function must NEVER
 *     propagate an exception past its own boundary. Any unexpected internal error resolves
 *     to the benign `{ zone: "NORMAL", sessionPnl: 0 }` result — the same shape a legitimate
 *     zero-P&L session would produce — rather than throwing.
 *   - Non-finite input (`NaN`, `Infinity`, `-Infinity`, non-number) is treated as NORMAL
 *     zone, never thrown. A broken P&L feed must not surface as a crash on the hot signal
 *     evaluation path.
 *   - The caller (paper-signal-service.ts) additionally wraps its own call to this evaluator
 *     in a try/catch, writes a warn-status audit row documenting the fail-open, and lets
 *     signal evaluation proceed completely unaffected — this governor is structurally
 *     incapable of blocking a trade even if every internal safeguard here somehow failed.
 *
 * Pure-function design:
 *   - This module owns zero I/O. Caller (paper-signal-service.ts) owns the DB/audit/SSE
 *     side effects — same separation of concerns as daily-trade-cap.ts and
 *     consistency-lane.ts. Keeps this module trivially unit-testable.
 */

export interface ProfitMilestoneInput {
  /** Session realized P&L so far (running total), in dollars. */
  sessionPnl: number;
}

export type ProfitMilestoneZone = "NORMAL" | "BASE" | "STRONG" | "EXCEPTIONAL";

export interface ProfitMilestoneResult {
  /** Which observability bucket the session currently sits in. */
  zone: ProfitMilestoneZone;
  /** Echoed input P&L (0 when the input was non-finite — never fabricated). */
  sessionPnl: number;
}

// ─── Zone thresholds (USD, session realized P&L) ───────────────────────────
// OBSERVABILITY BUCKETS ONLY. Daily upside is UNCAPPED by explicit operator directive
// (CLAUDE.md §5) — these numbers exist so a human can see "today is a strong/exceptional
// day," never to cap, throttle, or halt trading. This evaluator must NEVER be wired to
// block an entry or touch an exit; any future change that does so regresses the directive.
const ZONE_BASE_MIN_USD = 250;
const ZONE_STRONG_MIN_USD = 500;
const ZONE_EXCEPTIONAL_MIN_USD = 1000;

/**
 * Pure-function evaluator. Caller supplies the session's running realized P&L and gets
 * back the observability zone it falls into. Never throws, never blocks, never touches
 * any exit/position state (it doesn't even accept any).
 *
 * Boundary semantics (inclusive lower bound per zone):
 *   249.99 -> NORMAL, 250 -> BASE, 499.99 -> BASE, 500 -> STRONG,
 *   999.99 -> STRONG, 1000 -> EXCEPTIONAL.
 * Negative P&L (e.g. -500) -> NORMAL (there is no "negative milestone" concept here).
 * Non-finite (NaN / +-Infinity) or non-number input -> NORMAL, sessionPnl echoed as 0.
 */
export function evaluateProfitMilestone(input: ProfitMilestoneInput): ProfitMilestoneResult {
  try {
    const pnl = input?.sessionPnl;
    if (typeof pnl !== "number" || !Number.isFinite(pnl)) {
      return { zone: "NORMAL", sessionPnl: 0 };
    }

    let zone: ProfitMilestoneZone;
    if (pnl >= ZONE_EXCEPTIONAL_MIN_USD) {
      zone = "EXCEPTIONAL";
    } else if (pnl >= ZONE_STRONG_MIN_USD) {
      zone = "STRONG";
    } else if (pnl >= ZONE_BASE_MIN_USD) {
      zone = "BASE";
    } else {
      zone = "NORMAL";
    }
    return { zone, sessionPnl: pnl };
  } catch {
    // Structural fail-open: this evaluator must NEVER throw past its own boundary,
    // no matter what malformed input reaches it.
    return { zone: "NORMAL", sessionPnl: 0 };
  }
}

export interface ProfitMilestoneTransitionDecision {
  /** True when the caller should write the audit row + fire the SSE broadcast. */
  emit: boolean;
  /** The zone marker the caller should persist (session-scoped dedup state) after this call. */
  nextMarker: ProfitMilestoneZone | null;
}

/**
 * Pure transition/de-dup decision, extracted so the exact algorithm the caller wires
 * into paper-signal-service.ts can be unit-tested directly (rather than only
 * source-inspected) and so the wiring and the test can never silently drift apart.
 *
 * Given the zone marker already logged for this session this trading day (or `null`
 * if nothing has been logged yet / the session fell back below STRONG), and the zone
 * the current evaluation just produced, decide:
 *   - whether to emit (audit row + SSE) this evaluation, and
 *   - what marker the caller should persist for the NEXT evaluation.
 *
 * Only STRONG and EXCEPTIONAL are "milestone zones" that ever emit — NORMAL/BASE never
 * fire an audit row or SSE event. Emission happens ONLY on the transition INTO a new
 * milestone zone (first time STRONG is reached, and separately the first time
 * EXCEPTIONAL is reached) — repeated evaluations that remain in the same already-logged
 * zone do not re-emit. If the session's P&L falls back below STRONG (e.g. after a
 * losing trade), the marker is cleared so a future re-entry into STRONG/EXCEPTIONAL
 * logs a fresh transition rather than staying silently suppressed for the rest of the
 * session.
 */
export function decideProfitMilestoneTransition(
  lastLoggedZone: ProfitMilestoneZone | null,
  currentZone: ProfitMilestoneZone,
): ProfitMilestoneTransitionDecision {
  const isMilestoneZone = currentZone === "STRONG" || currentZone === "EXCEPTIONAL";

  if (isMilestoneZone && lastLoggedZone !== currentZone) {
    return { emit: true, nextMarker: currentZone };
  }
  if (!isMilestoneZone && lastLoggedZone !== null) {
    return { emit: false, nextMarker: null };
  }
  return { emit: false, nextMarker: lastLoggedZone };
}

export interface ProfitMilestoneShadowConfig {
  profit_milestone_shadow_enabled?: boolean;
}

/**
 * Resolve whether the shadow profit-milestone governor should even evaluate + log for a
 * given session. Precedence mirrors `consistency-lane.ts::resolveConsistencyEnforced`:
 *   1. explicit per-session boolean override (`profit_milestone_shadow_enabled`) — highest
 *   2. env var `PROFIT_MILESTONE_SHADOW_ENABLED` ("true"/"1" -> on, "false"/"0" -> off)
 *   3. default -> ON
 *
 * Default ON is the ONE deliberate inversion of the consistency-lane pattern (which
 * defaults OFF) — and that inversion is intentional, not a copy-paste bug:
 *   - consistency-lane defaults OFF because enforcing it wrongly would BLOCK trades on
 *     the Standard payout lane (a real, harmful side effect).
 *   - This governor has no enforcement path at all — it only classifies a number into a
 *     bucket and writes an audit row + SSE event. There is no harmful side effect to
 *     guard against, so it is safe to default ON and get observability for free.
 * A reviewer diffing this against consistency-lane.ts should read this comment as the
 * explanation for the flipped default, not assume drift.
 */
export function resolveProfitMilestoneShadowEnabled(
  config: ProfitMilestoneShadowConfig | null | undefined,
): boolean {
  // 1. explicit per-session boolean override
  if (config?.profit_milestone_shadow_enabled === true) return true;
  if (config?.profit_milestone_shadow_enabled === false) return false;

  // 2. env var (both directions honored — unlike consistency-lane, our default is ON,
  //    so an explicit "false"/"0" is the only way to opt a whole deployment out via env)
  const env = (process.env.PROFIT_MILESTONE_SHADOW_ENABLED ?? "").toLowerCase().trim();
  if (env === "true" || env === "1") return true;
  if (env === "false" || env === "0") return false;

  // 3. default ON — observability-only, safe by construction (see doc comment above)
  return true;
}
