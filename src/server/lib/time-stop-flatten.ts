/**
 * time-stop-flatten.ts (deep-scan #24, 2026-07-11) — the pure 15:55 ET hard-flatten predicate, split
 * out of paper-execution-service.ts so it can be unit-tested WITHOUT importing that service (which
 * throws at import when DATABASE_URL is unset). Same split rationale as consistency-scope.ts. No DB,
 * no I/O, no side effects — a single pure boolean function.
 */

/**
 * True when a bar's ET time is at/after the 15:55 ET hard-flatten threshold — mirrors the Python
 * style_c_handler `_is_time_stop` (current_time_et >= 15:55). Lets the TS intrabar stop-breach (BL-1)
 * defer to TIME-STOP semantics on the flatten bar: the backtester checks the 15:55 time-stop FIRST and
 * exits at the bar CLOSE with reason time_stop even when the bar also crossed the stop.
 *
 * Robust to zero-padded or non-padded "H:MM"/"HH:MM"; empty/unparseable → false (fail-safe: no early
 * flatten on a garbage timestamp — the position is managed on its real stop until a parseable bar).
 */
export function _isTimeStopFlattenBar(currentTimeEt: string | undefined | null): boolean {
  if (!currentTimeEt) return false;
  const m = /^(\d{1,2}):(\d{2})/.exec(currentTimeEt);
  if (!m) return false;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  return h > 15 || (h === 15 && min >= 55); // >= 15:55 ET hard-flatten invariant
}
