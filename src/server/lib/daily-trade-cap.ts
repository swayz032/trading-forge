/**
 * daily-trade-cap.ts — Wave 26 Pass K Phase 1 (2026-05-26)
 *
 * Enforces the operator's "1-2 A+ trades/day per account" mandate as a HARD
 * SIGNAL-TIME gate (not just execution-time via the Python kill switch).
 *
 * Why signal-time instead of execution-time:
 *   - paper-execution-service already enforces `sessionCfg.max_trades_per_day`
 *     at fill time via the Python kill switch, but the field is per-session
 *     opt-in and not framework-default.
 *   - The operator's mandate is "1 A+ trade/day; sizing math anchors on 1
 *     trade/day not 5" (memory pin project_one_aplus_trade_per_day.md).
 *   - Letting signals continue to fire after the daily cap is reached wastes
 *     compute, pollutes audit logs, and risks the post-fill kill switch
 *     racing with concurrent signal fires.
 *
 * Counting contract (CORRECTED — deep-scan #16 wave-1 track-3, 2026-07-04):
 *   - "Trade" = one `paper_trades` row CLOSED today (paper-signal-service.ts's
 *     caller queries `count(*) WHERE session_id=... AND exit_time falls on
 *     today's CME trading day`). The implementation does NOT additionally
 *     count open `paper_positions` rows — the docstring previously claimed it
 *     did ("CLOSED today OR OPENED today"), which was never true.
 *   - Why this is safe TODAY: every session enforces AT MOST ONE open position
 *     at a time (the single-open-position gate elsewhere in the signal-eval
 *     path blocks a 2nd entry while one is still open). So on any given day,
 *     "trades closed so far" and "trades closed-or-open so far" can only
 *     differ by the ONE currently-open position — and that open position
 *     cannot itself trigger a 2nd concurrent entry, so under-counting it here
 *     never lets a 3rd position open concurrently with a 2nd.
 *   - KNOWN LIMITATION / carry-forward: if the single-open-position-per-session
 *     invariant is ever relaxed (e.g. multi-position support), this gate would
 *     under-count and must be extended to also count open `paper_positions`
 *     rows opened today (deduplicated against closed rows so a trade that
 *     opens AND closes same day is counted once, not twice) — do not simply
 *     re-add the "OR opened" contract without handling that dedup.
 *   - "Today" = CME futures trading day (toFuturesTradingDayString), so trades
 *     opened 17:00–23:59 ET count toward NEXT day's quota — matches
 *     paper-execution-service.ts:925 convention.
 *   - Scope = per-ACCOUNT (DS19 C-3, 2026-07-05). This module is the pure
 *     evaluator; the SCOPE is set by whatever `tradesToday` the caller supplies.
 *     The caller (paper-signal-service.ts) now counts paper_trades closed today
 *     across ALL active sessions that resolve to the same account key
 *     (cross-symbol-pnl.ts::resolveAccountKey), so the "1-2 A+ trades/day per
 *     ACCOUNT" mandate holds even when one account runs multiple sessions (e.g.
 *     MES + MNQ). Pre-fix the caller counted a single session, which under
 *     multi-session-per-account allowed up to 2×N trades/day. For the
 *     single-session-per-account setup today the sibling set is just this
 *     session, so the account-scoped count is byte-identical to the old
 *     per-session count. A 2nd trade on Account A's MNQ session is now correctly
 *     counted against the same quota as its MES session.
 *
 * Defaults:
 *   - TF_MAX_TRADES_PER_DAY=2 (operator's mandate; 1-2 trades/day means
 *     the 3rd is the FIRST rejection).
 *   - Per-session override via sessionCfg.max_trades_per_day continues to work
 *     and TAKES PRECEDENCE (the per-session value, when set, replaces the env
 *     default for that session — same precedence as the Wave 27.5 Pass C
 *     compliance-mode pattern: DB-column > env > default).
 *
 * Failure mode:
 *   - DB error → fail-OPEN (allow the trade through; emit warn audit). Better
 *     to let a 3rd trade slip on the rare query error than to silently halt
 *     trading on infra failure.
 *
 * Pure-function design:
 *   - This module is the pure evaluator: feeds in `tradesCount` + `cap` →
 *     returns `{allow, reason, evidence}`.
 *   - Caller (paper-signal-service.ts) owns the DB query and the audit-row
 *     emission. Keeps this module test-friendly without DB bootstrap.
 */

export interface DailyTradeCapInput {
  /** Number of trades already taken on this session today (per CME trading day). */
  tradesToday: number;
  /** The per-session cap if set on the session row, else null. */
  perSessionCap: number | null;
  /** The framework env default (TF_MAX_TRADES_PER_DAY). */
  envDefault: number;
}

export interface DailyTradeCapResult {
  /** True if a new entry signal may proceed. */
  allow: boolean;
  /** Resolved effective cap (perSessionCap if set, else envDefault). */
  effectiveCap: number;
  /** Trades already taken today (echoed for audit). */
  tradesToday: number;
  /** Plain-English reason — used in audit row + Discord WARN payload. */
  reason: string;
}

/**
 * Resolve the active daily trade cap, applying precedence:
 *   1. per-session perSessionCap (if non-null + > 0)
 *   2. env default (TF_MAX_TRADES_PER_DAY)
 *
 * Returns the resolved integer.
 */
export function resolveEffectiveCap(input: Pick<DailyTradeCapInput, "perSessionCap" | "envDefault">): number {
  if (input.perSessionCap !== null && input.perSessionCap !== undefined && input.perSessionCap > 0) {
    return Math.floor(input.perSessionCap);
  }
  return Math.floor(input.envDefault);
}

/**
 * Pure-function evaluator. Caller queries `tradesToday` from DB, supplies
 * the per-session + env values, and gets back `{allow, reason}`.
 *
 * Contract:
 *   - tradesToday < effectiveCap → allow=true (within quota)
 *   - tradesToday >= effectiveCap → allow=false (quota exhausted, blocked)
 *   - Negative / NaN tradesToday → treated as 0 (fail-open on bad input)
 *   - effectiveCap <= 0 → allow=true (cap disabled — operator explicitly
 *     set 0/negative to bypass)
 */
export function evaluateDailyTradeCap(input: DailyTradeCapInput): DailyTradeCapResult {
  const effectiveCap = resolveEffectiveCap(input);
  const tradesToday = Number.isFinite(input.tradesToday) && input.tradesToday > 0
    ? Math.floor(input.tradesToday)
    : 0;

  // Cap disabled
  if (effectiveCap <= 0) {
    return {
      allow: true,
      effectiveCap,
      tradesToday,
      reason: "daily_trade_cap_disabled",
    };
  }

  if (tradesToday < effectiveCap) {
    return {
      allow: true,
      effectiveCap,
      tradesToday,
      reason: `within_quota: ${tradesToday}/${effectiveCap} trades taken today`,
    };
  }

  return {
    allow: false,
    effectiveCap,
    tradesToday,
    reason: `daily_trade_cap_reached: ${tradesToday}/${effectiveCap} trades taken today — 1-2 A+ trades/day mandate (CLAUDE.md §4)`,
  };
}

/**
 * Read the framework env default. Centralized so tests can mock and code
 * doesn't sprinkle `process.env.TF_MAX_TRADES_PER_DAY` reads everywhere.
 *
 * Default: 2 (operator's mandate "1-2 A+ trades/day" — 2 is the upper bound;
 * the 3rd signal of the day is the first rejected).
 */
export function getDailyTradeCapEnvDefault(): number {
  const raw = process.env.TF_MAX_TRADES_PER_DAY;
  if (raw === undefined || raw === null || raw === "") return 2;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 2;
  return Math.floor(n);
}
