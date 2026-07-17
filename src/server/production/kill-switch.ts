/**
 * src/server/production/kill-switch.ts
 *
 * Single source of truth for production trading mode.
 *
 * ─── HARD ISOLATION BOUNDARY ───────────────────────────────────────────────
 * This file MUST NOT import from: agent-service, critic-optimizer-service,
 * quantum_* modules, synthetic_market_simulator, or any scout-* service.
 * Violation detection: `npm run check:production-isolation`
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Design principles:
 *   - Fail-CLOSED: any DB error returns halted=true (never proceed on uncertainty)
 *   - Sub-10ms reads: 5-second in-memory cache on the singleton system_state row
 *   - Singleton: exported as `killSwitch` — same instance across all imports
 *   - Audit trail: every mode change writes audit_log + broadcasts SSE
 *   - 9-layer status: getKillSwitchStatus() reports all layers independently
 *   - Signal-path guard: evaluateAllKillSwitchLayers() / isHaltedForProduction()
 *     enforces ALL 9 layers, not just Layer 1. Each layer has a 1s LRU cache and
 *     a 100ms per-layer timeout budget; timeout → fail-OPEN with audit row.
 *
 * 9 Kill Switch Layers:
 *   1. Manual (operator)     — production_mode === 'HALT'
 *   2. Daily loss            — daily_pnl_pct exceeds firm DLL threshold
 *   3. Trailing drawdown     — equity distance from high-water mark
 *   4. Connectivity          — network-failover state machine
 *   5. Drift                 — weekly_drift_reports.severity === 'red'
 *   6. CME outage            — exchange-status-service.isExchangeHalted()
 *   7. Firm suspension       — prop-firm-health-service.isFirmSuspended()
 *   8. Macro crisis          — macro-gate-service crisis_gate_triggered
 *   9. Windows reboot pending — windows-health-check-service last result
 */

import { randomUUID } from "crypto";
import { db } from "../db/index.js";
import { systemState, auditLog, weeklyDriftReports, brokerAccounts, paperSessions, type ProductionMode } from "../db/schema.js";
import { eq, desc, and, inArray } from "drizzle-orm";
// HIGH-3 (deep-scan 2026-07-09, ratified): Layer 2/3 must discover accounts across the
// SAME session statuses the DLL aggregation treats as live exposure — a paused/stopped
// session's OPEN positions are still firm exposure. Single source of truth = the constant
// cross-symbol-pnl.ts already uses, so the two can never drift.
import { DLL_AGGREGATE_SESSION_STATUSES } from "../services/cross-symbol-pnl.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
import { AlertFactory, createAlert } from "../services/alert-service.js";
import { isExchangeHalted } from "../services/exchange-status-service.js";
import { isFirmSuspended } from "../services/prop-firm-health-service.js";
import { isConnectivityDegraded } from "../lib/network-failover.js";
// deepscan17 (2026-07-05) C-1/C-2 fix: Layer 2 now reads the SAME account-scoped
// aggregator + tier-aware DLL-base resolver the signal-time gates use
// (paper-signal-service.ts ~2646-2656, ~3360-3370) instead of its own per-session
// loop against raw getFirmAccount(firmId).dailyLossLimit. Two implementations of
// the same safety number could previously disagree on when "95%" was hit.
import {
  resolveAccountKey,
  resolvePersonalDllDollars,
  getAccountSessionCumulativePnL,
  evaluateCrossSymbolDll,
} from "../services/cross-symbol-pnl.js";
// deep-scan round 2 MED-3: both Layer 2 and Layer 3 previously inlined their OWN
// copy of the CME-ET trading-day (+7h shift then en-CA Intl format) formula
// instead of importing a shared single source of truth. Byte-identical
// behavior today, but two independent copies of the same day-key formula is a
// drift class. Imports the sibling production/ implementation
// (reconciliation-service.ts::toCmeTradingDayString) rather than
// paper-risk-gate.ts's identical toFuturesTradingDayString() — the latter
// transitively imports the full server bootstrap (`../index.js`), which
// regressed this file's narrow unit-test mocks (verified empirically while
// implementing this fix). See the block comment in reconciliation-service.ts
// next to toCmeTradingDayString() for the full story; the two functions stay
// byte-identical by construction (same +7h-shift/en-CA-Intl formula).
import { toCmeTradingDayString } from "./reconciliation-service.js";

// ─── deepscan18 (2026-07-05) Track 1 — Multi-Account Isolation ────────────────
// deepscan17's C-1 fix scoped the force-close ACTION (forceCloseAllPositions)
// to the breaching account, but three sibling paths stayed GLOBALLY scoped:
//
//   C-C1: evaluateAllKillSwitchLayers()/isHaltedForProduction() took no account
//   context at all. Layer 2 (checkLayer2DailyLoss), Layer 3 (checkLayer3TrailingDD),
//   and Layer 7 (checkLayer7FirmSuspension) each iterate every active
//   account/session/firm and `break` on the FIRST breach found ANYWHERE in the
//   system, returning ONE decision that every caller receives regardless of
//   which account is asking. Under single-account operation (today) this is
//   moot — there is only one account to find. Under Phase 3/4 multi-account
//   scaling it means Account A's breach falsely halts Account B's entirely
//   healthy account. Fixed by threading an OPTIONAL account/firm scope through
//   the whole evaluation chain: omitting it preserves the exact legacy
//   iterate-and-break-on-first-breach behavior (dashboard reads, and any
//   caller not yet updated); supplying it narrows Layer 2/3 to sessions
//   resolving to that account key, and Layer 7 to that one firm.
//
//   A-C2: the force-close concurrency guard (_forceCloseInFlight) was a single
//   module-level boolean shared by EVERY account. Two accounts breaching 95%
//   within the same FORCE_CLOSE_TIMEOUT_MS window meant the second account's
//   flatten was silently skipped (deduped) as if it were a duplicate of the
//   first. Fixed by keying the in-flight guard by account (Map<accountKey|
//   "__global__", boolean>) — see _isForceCloseInFlight() below. Unscoped
//   (legacy) callers keep the conservative "true if ANY force-close, anywhere,
//   is in flight" semantics identical to the old single-boolean behavior.

/** Sentinel scope key for the global (unscoped) cache/in-flight bucket. */
const GLOBAL_SCOPE_KEY = "__global__";

// ─── FINDING #3 FIX sentinel ─────────────────────────────────────────────────
// Exported as a verifiable boolean so tests can assert the fix is active without
// importing the whole kill-switch module graph in a live-DB environment.
export const LAYER7_AUDIT_GENERATES_CORRELATION_ID = true;

// ─── H6 FIX sentinel ─────────────────────────────────────────────────────────
// Exported so tests can assert that the signal-path enforcement is active.
export const ALL_LAYERS_ENFORCED_ON_SIGNAL_PATH = true;

// ─── DLL / trailing-DD thresholds (match paper-execution-service) ─────────────
const DLL_HALT_PCT        = parseFloat(process.env.DLL_HALT_PCT        ?? "0.67");
// DLL_WARN_PCT: alert threshold between halt (67%) and force-close (95%).
// Fires once per session via dll80PctWarnedSessionIds dedup below (A-5 fix).
const DLL_WARN_PCT        = parseFloat(process.env.DLL_WARN_PCT        ?? "0.80");
const DLL_FORCE_CLOSE_PCT = parseFloat(process.env.DLL_FORCE_CLOSE_PCT ?? "0.95");
const TRAILING_DD_BUFFER_DOLLARS = 200; // force-close trigger: $200 inside max drawdown

// ─── Per-account 80% DLL warn dedup ──────────────────────────────────────────
// Prevents re-firing the 80% approach warning on every bar check within the 1s
// layer cache TTL. deepscan17 (2026-07-05) C-1 fix: keyed by the RESOLVED account
// key (see cross-symbol-pnl.ts::resolveAccountKey), not session id — two sessions
// on the SAME account must not each fire their own warn for what is one combined
// breach. The Set persists for the process lifetime (acceptable — sessions are
// per-trading-day, and the process restarts at most once per day). Tests can use
// unique account keys (via config.account_key) to avoid cross-test interference;
// no explicit clear hook is required.
const dll80PctWarnedAccountKeys = new Set<string>();

// ─── Per-layer cache (1s TTL for signal-path budget) ─────────────────────────
// Each entry holds the last HaltDecision returned and its expiry timestamp.
// Separate from the 5s system_state cache — layers 2-9 do DB/service calls that
// would exceed the per-bar budget without short-lived caching.
const LAYER_CACHE_TTL_MS = 1_000;
const LAYER_CHECK_TIMEOUT_MS = 100; // fail-OPEN if a layer takes longer than this

interface LayerCacheEntry {
  decision: HaltDecision;
  expiresAt: number;
}

// deepscan18 C-C1: the cache key now includes the evaluation SCOPE (accountKey
// for Layer 2/3, firmId for Layer 7) so an account-scoped decision is never
// read back for a DIFFERENT account (or for the unscoped/global caller) and
// vice versa. Layers that don't support scoping (1,4,5,6,8,9) always pass
// scope=undefined, which resolves to GLOBAL_SCOPE_KEY — identical cache
// behavior to before this change.
const layerCache: Map<string, LayerCacheEntry> = new Map();

function _layerCacheKey(layer: number, scope?: string): string {
  return `${layer}:${scope ?? GLOBAL_SCOPE_KEY}`;
}

/** Retrieve a cached layer result if still within TTL. */
function getCachedLayer(layer: number, scope?: string): HaltDecision | null {
  const entry = layerCache.get(_layerCacheKey(layer, scope));
  if (entry && Date.now() < entry.expiresAt) {
    return entry.decision;
  }
  return null;
}

/** Store a layer result in cache for 1s. */
function setCachedLayer(layer: number, decision: HaltDecision, scope?: string): void {
  layerCache.set(_layerCacheKey(layer, scope), { decision, expiresAt: Date.now() + LAYER_CACHE_TTL_MS });
}

// ─── FINDING #1 FIX: confirmed force-close ───────────────────────────────────
// forceCloseAllPositions was fire-and-forget at both the 95% DLL trigger (Layer 2)
// and the production HALT path (setMode). Positions could remain open past firm DLL.
// Dynamic import is retained to avoid a kill-switch ↔ paper-execution circular dep.
const FORCE_CLOSE_TIMEOUT_MS = parseInt(process.env.FORCE_CLOSE_TIMEOUT_MS ?? "10000", 10);

// F3 FIX: in-flight guard for Layer-2 DLL-95% force-close.
//
// Root cause: runLayerWithTimeout has a 100ms budget for L2. _confirmedForceClose
// takes up to FORCE_CLOSE_TIMEOUT_MS (10s). When the 100ms expires, the layer
// returns fail-OPEN *without* setting the layer cache, so the next signal
// immediately re-enters checkLayer2DailyLoss and calls _confirmedForceClose again.
// Under a sustained DLL breach this creates concurrent force-close calls that:
//   a) flood the audit log with duplicate rows
//   b) race on paper position state
//   c) may cause double-broker orders
//
// The guard makes the second (and subsequent) concurrent L2 evaluations return
// {halted:true, reason:"force_close_in_progress"} immediately until the first
// completes. This does NOT suppress the halt result — L2 is still reported HALTED.
//
// deepscan18 A-C2 fix: was a single module-level boolean shared by every
// account — two accounts breaching 95% within the same FORCE_CLOSE_TIMEOUT_MS
// window meant the SECOND account's force-close was deduped away as if it
// were a duplicate of the first (it isn't — different account, different
// positions). Now a Map keyed by resolved accountKey (or GLOBAL_SCOPE_KEY for
// the system-wide operator-HALT path), so accounts are independently guarded.
const _forceCloseInFlightByAccount: Map<string, boolean> = new Map();
// deep-scan 2026-07-11 MED fix (#8): accountKey → CME-ET trading-day of the last COMPLETED 95%
// force-close. Once an account force-closes for the day it stays at 95% (P&L doesn't recover), so
// every subsequent cache-TTL L2 eval would otherwise re-fire the pending+completed audit rows + SSE +
// a no-op re-flatten for the rest of RTH — polluting the append-only §2 trust spine + spamming the
// dashboard. This lets the repeat evals stay HALTED silently. Re-arms each new trading day.
const _forceClosedTodayByAccount: Map<string, string> = new Map();

// MED#7+#8 (fresh-scan 2026-07-12): throttle force-close RE-ATTEMPTS. A persistently-INCOMPLETE L2
// force-close (a `stuck` no-price position → closed:0, so the CRIT fix correctly does NOT arm the
// day-dedup and re-attempts) OR a persistently-BREACHED L3 trailing-DD (equity doesn't recover) leaves
// the account at/over threshold, so every ~1s cache-TTL eval would re-fire the pending audit + SSE +
// Discord + a re-attempt — a trust-spine/dashboard STORM. We STILL re-attempt (must not permanently
// disarm — that was the CRIT), but at most once per backoff window; between attempts we stay HALTED
// silently. Keyed by accountKey (L2) / sessionId (L3). Cleared on a completed close + on test reset.
const _forceCloseLastAttemptByAccount: Map<string, number> = new Map();
const FORCE_CLOSE_REATTEMPT_BACKOFF_MS = Number.isFinite(Number(process.env.FORCE_CLOSE_REATTEMPT_BACKOFF_MS))
  ? Number(process.env.FORCE_CLOSE_REATTEMPT_BACKOFF_MS)
  : 60_000;
/** True (and records the attempt time) when a force-close re-attempt for `key` is due per the backoff;
 *  false to skip the re-fire this eval (stay HALTED silently). */
function _forceCloseReattemptDue(key: string, nowMs: number): boolean {
  const last = _forceCloseLastAttemptByAccount.get(key);
  if (last != null && nowMs - last < FORCE_CLOSE_REATTEMPT_BACKOFF_MS) return false;
  _forceCloseLastAttemptByAccount.set(key, nowMs);
  return true;
}

/**
 * True when a force-close is currently in flight for the given scope.
 *
 * - `accountKey` omitted (legacy/global callers, e.g. dashboard reads or any
 *   caller not yet account-aware): conservative — true if ANY force-close
 *   (global or any specific account) is in flight anywhere. This is BYTE-
 *   IDENTICAL to the old single-shared-boolean semantics for callers that
 *   don't pass a scope — used by the unscoped isHalted fast-path
 *   (evaluateAllKillSwitchLayers) + advisory-layer timeout fallback, which want
 *   the conservative "anything in flight → treat as halted" default. Do NOT
 *   narrow this branch — the DEDUP-specific global-vs-global logic lives in
 *   _safeForceClose (MED freshscan5), NOT here, so those other callers keep the
 *   legacy conservative contract (deepscan18-c1 test enforces this).
 * - `accountKey` supplied: true only if THIS account's own force-close is in
 *   flight, OR a genuine system-wide (GLOBAL_SCOPE_KEY) force-close is in
 *   flight (which is about to/already touched every account, including this
 *   one). A sibling account's scoped force-close does NOT block this one.
 */
function _isForceCloseInFlight(accountKey?: string): boolean {
  if (accountKey === undefined) {
    for (const v of _forceCloseInFlightByAccount.values()) {
      if (v) return true;
    }
    return false;
  }
  if (_forceCloseInFlightByAccount.get(accountKey)) return true;
  if (_forceCloseInFlightByAccount.get(GLOBAL_SCOPE_KEY)) return true;
  return false;
}

/**
 * Awaited force-close with wall-clock timeout and CRITICAL escalation on failure.
 * On timeout or call failure, writes paper.force_flatten_kill_switch_failed audit
 * and fires a CRITICAL Discord alert so the operator knows positions may be open.
 */
async function _confirmedForceClose(
  reason: string,
  correlationId: string,
  scope?: { accountKey?: string; sessionIds?: string[] },
): Promise<boolean> {
  const timeoutMs = FORCE_CLOSE_TIMEOUT_MS > 0 ? FORCE_CLOSE_TIMEOUT_MS : 10_000;
  try {
    const fcResult = await Promise.race([
      import("../services/paper-execution-service.js").then(({ forceCloseAllPositions }) =>
        forceCloseAllPositions(reason, { correlationId, scope })
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`forceCloseAllPositions timed out after ${timeoutMs}ms`)),
          timeoutMs,
        )
      ),
    ]);
    // CRIT (deep-scan 2026-07-12): forceCloseAllPositions RESOLVES normally even when it closed
    // 0-of-N positions — per-position closePosition() errors are caught, pushed to `errors`, and the
    // loop CONTINUES (paper-execution-service.ts ~5425), returning { count, closed, stuck }. Returning
    // `true` here on a partial/total failure made the L2 caller (a) write a false "completed=success"
    // row contradicting the batch's own partial_failure row, and (b) arm the #8 _forceClosedTodayByAccount
    // dedup — permanently DISARMING retry for the rest of the CME trading day while the bleeding
    // position stays OPEN past the DLL (Topstep trailing-DD breach). Only report success when EVERY
    // position actually closed; otherwise escalate + audit + return false so the caller re-attempts.
    const closedAll =
      fcResult != null &&
      typeof fcResult === "object" &&
      (fcResult as { count?: number }).count === (fcResult as { closed?: number }).closed &&
      ((fcResult as { stuck?: number }).stuck ?? 0) === 0;
    if (closedAll) {
      logger.info({ reason, correlationId, ...fcResult }, "kill-switch: forceCloseAllPositions completed");
      return true;
    }
    logger.error(
      { reason, correlationId, result: fcResult },
      "kill-switch: forceCloseAllPositions INCOMPLETE (closed < count or stuck) — positions may still be open; NOT arming day-dedup, will re-attempt",
    );
    AlertFactory.systemError(
      "kill-switch-force-flatten-incomplete",
      new Error(
        `forceCloseAllPositions incomplete (${JSON.stringify(fcResult)}). Reason: ${reason}. ` +
        `CorrelationId: ${correlationId}. IMMEDIATE ACTION REQUIRED — positions may still be open.`,
      ),
    );
    insertAuditRow({
      action: "paper.force_flatten_kill_switch_incomplete",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { reason, correlationId } as Record<string, unknown>,
      result: { ...(fcResult as Record<string, unknown>), positions_may_be_open: true } as Record<string, unknown>,
      status: "error",
      correlationId,
    }).catch((auditErr) =>
      logger.error({ err: auditErr }, "kill-switch: force_flatten_incomplete audit write also failed"),
    );
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, reason, correlationId },
      "kill-switch: forceCloseAllPositions FAILED — positions may still be open"
    );
    AlertFactory.systemError(
      "kill-switch-force-flatten-failed",
      new Error(
        `forceCloseAllPositions failed: ${msg}. Reason: ${reason}. CorrelationId: ${correlationId}. ` +
        `IMMEDIATE ACTION REQUIRED — manually close all open positions.`
      )
    );
    insertAuditRow({
      action: "paper.force_flatten_kill_switch_failed",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { reason, correlationId } as Record<string, unknown>,
      result: { error: msg, positions_may_be_open: true } as Record<string, unknown>,
      status: "error",
      correlationId,
    }).catch((auditErr) =>
      logger.error({ err: auditErr }, "kill-switch: force_flatten_failed audit write also failed")
    );
    return false;
  }
}

/**
 * FIX 2 (Track M): Deduplication wrapper for force-close calls.
 *
 * Both the L2 DLL-95% path (checkLayer2DailyLoss) and the production-HALT
 * path (setMode("HALT")) can trigger force-close concurrently — e.g. a DLL
 * breach fires at the same moment the operator manually sets HALT. Without
 * this wrapper, both paths call _confirmedForceClose independently, racing on
 * paper position state and potentially issuing double-broker orders.
 *
 * _safeForceClose is idempotent: the second concurrent caller writes a
 * "kill_switch.force_close_deduped" audit row and returns false immediately.
 * The first caller manages _forceCloseInFlight via try/finally.
 */
async function _safeForceClose(
  trigger: string,
  correlationId: string,
  scope?: { accountKey?: string; sessionIds?: string[] },
): Promise<boolean> {
  // deepscan18 A-C2: guard + set/clear are keyed by scope.accountKey (falls
  // back to GLOBAL_SCOPE_KEY for the unscoped system-wide path) so a scoped
  // force-close in flight for account A never dedupes a concurrent scoped
  // force-close for account B.
  const scopeKey = scope?.accountKey ?? GLOBAL_SCOPE_KEY;
  // MED (freshscan5 2026-07-12): the DEDUP decision is scope-asymmetric and lives HERE (not in the
  // shared _isForceCloseInFlight, whose unscoped "any account in flight" semantics the isHalted
  // fast-path + advisory-timeout fallback depend on). A GLOBAL/operator flatten (the superset that
  // touches EVERY account) must dedup ONLY against another GLOBAL close in flight — NOT against a
  // subset account-scoped close. Previously the global path reused _isForceCloseInFlight(undefined)
  // ("any account in flight"), so an in-flight account-A scoped 95%-DLL close SUPPRESSED the operator's
  // master HALT flatten, leaving sibling accounts B/C… un-flattened through the HALT (multi-account
  // capital safety). closePosition is idempotent via its closedAt-IS-NULL claim, so a global
  // re-flatten of an already-closing account A is a safe no-op. A scoped close still dedups against its
  // own account OR a global-in-flight (unchanged).
  const _alreadyInFlight = scope?.accountKey === undefined
    ? _forceCloseInFlightByAccount.get(GLOBAL_SCOPE_KEY) === true
    : _isForceCloseInFlight(scope.accountKey);
  if (_alreadyInFlight) {
    logger.warn(
      { trigger, correlationId, accountKey: scope?.accountKey },
      "kill-switch: force-close already in-flight — skip concurrent invocation (_safeForceClose dedup, FIX 2)",
    );
    insertAuditRow({
      action: "kill_switch.force_close_deduped",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { trigger, correlationId, accountKey: scope?.accountKey ?? null } as Record<string, unknown>,
      result: { skipped: true, reason: "force_close_already_in_flight" } as Record<string, unknown>,
      status: "success",
      correlationId,
    }).catch((auditErr) =>
      logger.error({ err: auditErr }, "kill-switch: force_close_deduped audit write failed"),
    );
    return false;
  }
  _forceCloseInFlightByAccount.set(scopeKey, true);
  try {
    return await _confirmedForceClose(trigger, correlationId, scope);
  } finally {
    _forceCloseInFlightByAccount.set(scopeKey, false);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type { ProductionMode };

export interface SystemState {
  production_mode: ProductionMode;
  kill_reason: string | null;
  set_by: string;
  set_at: Date;
}

/** Result of a single layer evaluation. */
export interface HaltDecision {
  halted: boolean;
  layer?: number;
  reason?: string;
  detail?: Record<string, unknown>;
}

export interface KillSwitchLayerStatus {
  layer: number;
  name: string;
  halted: boolean;
  reason?: string;
}

export interface KillSwitchStatusReport {
  overall_halted: boolean;
  production_mode: ProductionMode;
  layers: KillSwitchLayerStatus[];
  checked_at: Date;
}

// ─── Lazy imports to avoid circular init ─────────────────────────────────────

async function getMacroGateResult(): Promise<{ crisis_gate_triggered: boolean }> {
  try {
    const { evaluateMacroGates } = await import("../services/macro-gate-service.js");
    const result = await evaluateMacroGates("MES", "long");
    return { crisis_gate_triggered: result.macroContext?.crisisGateTriggered ?? false };
  } catch {
    return { crisis_gate_triggered: false }; // fail-open for status reporting
  }
}

async function getWindowsHealthOk(): Promise<boolean> {
  try {
    const { runPreTradingDayHealthCheck } = await import("../services/windows-health-check-service.js");
    const result = await runPreTradingDayHealthCheck();
    return result.status === "healthy";
  } catch {
    return true; // fail-open for status reporting (Windows check is independent)
  }
}

// ─── Per-layer pure-function predicates ──────────────────────────────────────
// Each function returns a HaltDecision (halted: true|false, reason, detail).
// Heavy functions cache their result for LAYER_CACHE_TTL_MS (1s).
// All are called from both evaluateAllKillSwitchLayers() (signal path) and
// getKillSwitchStatus() (dashboard reporting), keeping logic DRY.

/**
 * Layer 1: Manual operator — production_mode === 'HALT'.
 * No cache needed: delegates to the existing 5s system_state cache.
 */
async function checkLayer1Manual(state: SystemState): Promise<HaltDecision> {
  const halted = state.production_mode === "HALT";
  return halted
    ? { halted: true, layer: 1, reason: "production_mode_halt", detail: { production_mode: state.production_mode } }
    : { halted: false };
}

/**
 * Layer 2: Daily loss limit.
 * Fail-CLOSED: DB error → halted (a crashed DB cannot bypass the DLL gate).
 *
 * deepscan17 (2026-07-05) C-1/C-2 rewrite:
 *   - C-1(a) under-halt: previously evaluated each session's OWN
 *     dailyPnlBreakdown[today] in isolation against the full firm DLL — two
 *     sessions on the SAME account (e.g. two Topstep symbols) could each sit
 *     under the 95% threshold individually while their COMBINED loss exceeded
 *     it, and neither would halt. Now groups active sessions by the resolved
 *     account key and reads the combined P&L via the SAME account-scoped
 *     aggregator (getAccountSessionCumulativePnL / evaluateCrossSymbolDll) the
 *     signal-time gates use — single source of truth, not a second per-session loop.
 *   - C-1(b) over-reach: force-close is now scoped to {accountKey} so a breach
 *     on one account cannot flatten sibling accounts/firms (see
 *     forceCloseAllPositions in paper-execution-service.ts).
 *   - C-2: the personal DLL dollar base now comes from resolvePersonalDllDollars
 *     (session firmId / config.trailing_dd_amount / accountStartingFloor) instead
 *     of raw getFirmAccount(firmId).dailyLossLimit — the same base the signal-time
 *     sites use, so the two subsystems can never disagree on what "95%" means.
 *   - E-2: accepts the signal-path root correlationId and uses it for the
 *     sizing.dll_* audit rows instead of minting local ones.
 *
 * deepscan18 (2026-07-05) C-C1 fix: accepts an OPTIONAL `scopeAccountKey`. When
 * supplied, evaluation is narrowed to ONLY that account instead of iterating
 * every active account and returning the first breach found ANYWHERE in the
 * system — the exact over-broad-halt bug this wave fixes (Account A's breach
 * must not halt Account B's healthy entries). Omitting it preserves the
 * verbatim legacy iterate-and-break-on-first-breach behavior (dashboard reads
 * via getKillSwitchStatus(), and any caller not yet account-aware).
 */
async function checkLayer2DailyLoss(correlationId?: string, scopeAccountKey?: string): Promise<HaltDecision> {
  const cached = getCachedLayer(2, scopeAccountKey);
  if (cached) return cached;

  // deepscan17 E-2: thread the caller's correlationId through the sizing.dll_*
  // audit trail; fall back to a fresh id only when none was supplied (e.g. a
  // direct getKillSwitchStatus() dashboard read with no signal-path root).
  const effectiveCorrelationId = correlationId ?? randomUUID();

  let decision: HaltDecision;
  try {
    // deep-scan round 2 MED-3: canonical CME-ET trading-day string — was an
    // inline copy of this exact formula (Intl.DateTimeFormat + 7h shift).
    const today = toCmeTradingDayString(new Date());

    const activeSessions = await db
      .select({
        id: paperSessions.id,
        firmId: paperSessions.firmId,
        config: paperSessions.config,
        startingCapital: paperSessions.startingCapital,
      })
      .from(paperSessions)
      // HIGH-3: include paused/stopped sessions — their open positions are live firm
      // exposure the DLL/trailing-DD force-close must still evaluate (was "active" only).
      .where(inArray(paperSessions.status, [...DLL_AGGREGATE_SESSION_STATUSES]));

    // Group active sessions by RESOLVED account key (not raw firmId) — two
    // sessions on the same account must be evaluated TOGETHER (C-1 fix above).
    const accountReps = new Map<string, { firmId: string | null; config: unknown; startingCapital: unknown }>();
    for (const session of activeSessions) {
      const accountKey = resolveAccountKey(session);
      if (!accountReps.has(accountKey)) {
        accountReps.set(accountKey, { firmId: session.firmId, config: session.config, startingCapital: session.startingCapital });
      }
    }

    // deepscan18 C-C1: when the caller supplies a scope, restrict evaluation to
    // ONLY that account's entry. Entries iteration order (Map insertion order)
    // is unchanged for the unscoped case, so the unscoped path is byte-for-byte
    // identical to before this fix.
    const accountEntries = [...accountReps.entries()];
    const repsToEvaluate = scopeAccountKey
      ? accountEntries.filter(([key]) => key === scopeAccountKey)
      : accountEntries;

    for (const [accountKey, rep] of repsToEvaluate) {
      // C-1 fix: combined P&L (realized + open MTM, across ALL sessions scoped to
      // this account — including stopped/paused, per cross-symbol-pnl.ts) from the
      // same single source of truth the signal-time DLL gates use.
      const cumPnL = await getAccountSessionCumulativePnL(accountKey, today);

      // C-2 fix: tier-aware personal DLL base, same resolver the signal-time
      // sites use (paper-signal-service.ts ~2646-2656, ~3360-3370).
      const trailingDdOverride = (rep.config as { trailing_dd_amount?: number } | null)?.trailing_dd_amount ?? null;
      const accountStartingFloor = parseFloat(rep.startingCapital as string) || 50_000;
      const personalDllDollars = resolvePersonalDllDollars({
        firmId: rep.firmId,
        trailingDdOverride,
        accountStartingFloor,
      });

      const dllResult = evaluateCrossSymbolDll(cumPnL, personalDllDollars);
      const dayPnl = dllResult.combinedPnL;

      // deep-scan 2026-07-11 HIGH fix: a DEGRADED cross-symbol P&L (a DB fault swallowed inside
      // getAccountSessionCumulativePnL) means the drawdown figure is untrustworthy — fail CLOSED by
      // BLOCKING new entries, honoring the L2 documented contract (header line 13: "a crashed DB
      // cannot bypass the DLL gate"). Previously the swallowed error returned a clean zero → drawdown=0
      // → action="none" → L2 approved an entry on an account potentially already at its DLL. We HALT
      // (block new risk) rather than force_close, since acting on unknown P&L would be over-aggressive.
      if (dllResult.degraded) {
        // MED (deep-scan 2026-07-12 #10): a degraded result now preserves the REALIZED-alone P&L (a
        // certain, banked lower bound — see cross-symbol-pnl.ts MTM-only catch). If that alone already
        // breaches the 95% force-close threshold, the breach is KNOWN despite the missing MTM — fall
        // through to force-close the bleeding position (previously degraded ALWAYS short-circuited to a
        // halt, leaving a known-over-DLL position open). Otherwise (realized under threshold, or P&L
        // truly unknown) stay conservative: HALT new entries, never force-close on data we can't trust.
        if (dllResult.action !== "force_close") {
          logger.warn(
            { account_key: accountKey, firm_id: rep.firmId, realized_pnl: dayPnl },
            "kill-switch L2: cross-symbol P&L DEGRADED, realized-alone under 95% — halting new entries (fail-closed; no force-close on unknown P&L)",
          );
          decision = { halted: true, reason: "dll_pnl_degraded_fail_closed", layer: 2 };
          break;
        }
        logger.error(
          { account_key: accountKey, firm_id: rep.firmId, realized_pnl: dayPnl, dll: personalDllDollars },
          "kill-switch L2: cross-symbol P&L DEGRADED but REALIZED-alone loss already breaches 95% DLL — force-closing the KNOWN breach (fall through)",
        );
        // fall through to the force_close handler below (do NOT break)
      }

      // ── M-1 FIX: 95% DLL force-close (highest band — check first) ───────────
      // Python compliance_gate.py:562 force-closes at 95% DLL. Without this
      // check, paper holds tail exposure that backtests would have closed —
      // a parity break. Layer 3 force-closes on trailing-DD $200 buffer (different
      // axis), so this sub-check does NOT double-fire with Layer 3.
      // Ordering: force_close (95%) > halt (67%) > reduce_size (60%) > none.
      if (dllResult.action === "force_close") {
        // deep-scan 2026-07-11 MED fix (#8): if this account ALREADY completed a 95% force-close this
        // CME trading day, stay HALTED but do NOT re-fire the audit/SSE/re-flatten. Positions are flat
        // and the account remains at 95% until session reset, so repeating every TTL only pollutes the
        // trust spine + dashboard with no-op rows. Re-arms on a new trading day (map keyed on `today`).
        if (_forceClosedTodayByAccount.get(accountKey) === today) {
          decision = { halted: true, reason: "dll_force_close_already_done_today", layer: 2 };
          break;
        }
        // F3 FIX: concurrent L2 evaluations (caused by the 100ms runLayerWithTimeout
        // returning fail-OPEN before the 10s _confirmedForceClose finishes) must NOT
        // all call _confirmedForceClose. The first call sets the in-flight flag;
        // subsequent calls return HALTED immediately without re-entering the close.
        // deepscan18 A-C2: guard is now PER-ACCOUNT — a concurrent force-close
        // in flight for a DIFFERENT account must not dedupe THIS account's own
        // 95% breach into a no-op.
        if (_isForceCloseInFlight(accountKey)) {
          logger.warn(
            { account_key: accountKey, firm_id: rep.firmId, day_pnl: dayPnl },
            "kill-switch L2: force-close already in-flight — skipping concurrent invocation (F3 fix)",
          );
          decision = { halted: true, reason: "force_close_in_progress", layer: 2 };
          break;
        }
        // MED#7 (fresh-scan 2026-07-12): back off the RE-ATTEMPT of a persistently-incomplete force-close
        // (e.g. a stuck no-price position → closed:0 → the CRIT fix correctly re-attempts). Without this,
        // every ~1s cache-TTL eval re-fires the pending audit + SSE + Discord + a fresh attempt — a storm.
        // Stay HALTED silently between attempts; re-attempt at most once per backoff window.
        if (!_forceCloseReattemptDue(accountKey, Date.now())) {
          decision = { halted: true, reason: "dll_force_close_reattempt_backoff", layer: 2 };
          break;
        }
        logger.warn(
          { account_key: accountKey, firm_id: rep.firmId, day_pnl: dayPnl, dll: personalDllDollars, threshold_pct: DLL_FORCE_CLOSE_PCT },
          "kill-switch L2: DLL at 95% — force-closing all positions for this account (C-1 fix: account-scoped)"
        );
        // Audit — status PENDING until the close actually confirms. The
        // pending → completed/failed pattern prevents a misleading "success" row
        // when a failed close leaves positions open.
        insertAuditRow({
          action: "sizing.dll_force_close",
          entityType: "system",
          entityId: accountKey,
          decisionAuthority: "system",
          input: { account_key: accountKey, firm_id: rep.firmId, day_pnl: dayPnl, dll: personalDllDollars, threshold_pct: DLL_FORCE_CLOSE_PCT } as Record<string, unknown>,
          result: { action: "force_close", outcome: "triggered" } as Record<string, unknown>,
          status: "pending",
          correlationId: effectiveCorrelationId,
        }).catch((auditErr) =>
          logger.error({ err: auditErr }, "kill-switch L2: dll 95pct force-close trigger audit failed (non-blocking)")
        );
        // SSE — consistent with existing force-close path in setMode("HALT")
        broadcastSSE("kill_switch:dll_force_close", {
          account_key: accountKey,
          firm_id: rep.firmId,
          day_pnl: dayPnl,
          dll: personalDllDollars,
          threshold_pct: DLL_FORCE_CLOSE_PCT,
          correlationId: effectiveCorrelationId,
          forced_at: new Date().toISOString(),
        });
        // FIX 2 (Track M): _safeForceClose manages the _forceCloseInFlight sentinel
        // and deduplicates concurrent calls (e.g. L2 and setMode("HALT") racing).
        // C-1 fix: scope:{accountKey} — the flatten hits ONLY this account's open
        // positions, not every account/firm sharing the process.
        const _fcOk = await _safeForceClose(
          `dll_force_close_at_95pct:${accountKey}`,
          effectiveCorrelationId,
          { accountKey },
        );
        // Completion observability (phase-0 deep-scan): record a success audit row ONLY
        // when the force-close actually completed. On failure/timeout, _confirmedForceClose
        // already wrote paper.force_flatten_kill_switch_failed + fired a CRITICAL Discord —
        // so we must NOT also emit a "completed" row (would falsely mark success while
        // positions may still be open).
        if (_fcOk) {
          // deep-scan 2026-07-11 MED fix (#8): mark this account force-closed for today so subsequent
          // cache-TTL evals short-circuit to a silent HALT instead of re-firing audit/SSE/re-flatten.
          _forceClosedTodayByAccount.set(accountKey, today);
          _forceCloseLastAttemptByAccount.delete(accountKey); // MED#7: completed → clear re-attempt backoff
          insertAuditRow({
            action: "sizing.dll_force_close_completed",
            entityType: "system",
            entityId: accountKey,
            decisionAuthority: "system",
            input: { account_key: accountKey, firm_id: rep.firmId } as Record<string, unknown>,
            result: { action: "force_close", outcome: "completed" } as Record<string, unknown>,
            status: "success",
            correlationId: effectiveCorrelationId,
          }).catch((auditErr) =>
            logger.error({ err: auditErr }, "kill-switch L2: dll 95pct force-close completed-audit failed (non-blocking)")
          );
        }
        decision = {
          halted: true,
          layer: 2,
          reason: "dll_force_close_at_95pct",
          detail: { account_key: accountKey, firm_id: rep.firmId, day_pnl: dayPnl, dll: personalDllDollars, threshold_pct: DLL_FORCE_CLOSE_PCT },
        };
        break;
      }

      // ── A-5 FIX: 80% DLL approach warning (once per account, deduped) ────────
      // No alert exists between the 67% halt and 95% force-close. Families see a
      // force-close with no prior warning. This warning fires once per ACCOUNT
      // (deduped via dll80PctWarnedAccountKeys — C-1 fix: was per-session, which
      // would double-warn two sessions on the same account for one combined breach)
      // when losses are between 67-95%. Does NOT halt on its own — falls through
      // to the 67% halt check below.
      if (dllResult.dllPct >= DLL_WARN_PCT && !dll80PctWarnedAccountKeys.has(accountKey)) {
        dll80PctWarnedAccountKeys.add(accountKey);
        insertAuditRow({
          action: "sizing.dll_80pct_approach_warned",
          entityType: "system",
          entityId: accountKey,
          decisionAuthority: "system",
          input: { account_key: accountKey, firm_id: rep.firmId, day_pnl: dayPnl, dll: personalDllDollars, threshold_pct: DLL_WARN_PCT } as Record<string, unknown>,
          result: { warned: true } as Record<string, unknown>,
          status: "success",
          correlationId: effectiveCorrelationId,
        }).catch((auditErr) =>
          logger.error({ err: auditErr }, "kill-switch L2: dll 80pct warn audit failed (non-blocking)")
        );
        createAlert({
          type: "system",
          severity: "warning",
          title: `DLL approach: ${Math.round(DLL_WARN_PCT * 100)}% of daily safety limit reached`,
          message:
            "Trading losses today are at 80% of the safety limit. " +
            "The bot already stopped taking new trades. " +
            "It is still holding its current position. " +
            "No action needed — it will exit automatically if losses continue.",
          metadata: { account_key: accountKey, firm_id: rep.firmId, day_pnl: dayPnl, dll: personalDllDollars },
        }).catch((alertErr) =>
          logger.error({ err: alertErr }, "kill-switch L2: dll 80pct approach alert failed (non-blocking)")
        );
      }

      // ── Existing 67% halt ──────────────────────────────────────────────────
      if (dllResult.action === "halt") {
        const reason = `dll_at_${Math.round(DLL_HALT_PCT * 100)}pct_personal_threshold`;
        decision = {
          halted: true,
          layer: 2,
          reason,
          detail: { account_key: accountKey, firm_id: rep.firmId, day_pnl: dayPnl, dll: personalDllDollars },
        };
        break;
      }
    }

    decision ??= { halted: false };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "kill-switch L2: DLL check failed — blocking entries (fail-closed)");
    decision = {
      halted: true,
      layer: 2,
      reason: "dll_check_failed",
      detail: { error: errMsg, fail_closed: true },
    };
  }

  setCachedLayer(2, decision, scopeAccountKey);
  return decision;
}

/**
 * Layer 3: Trailing drawdown.
 * Fail-CLOSED: DB error → halted.
 *
 * deepscan18 (2026-07-05) C-C1 fix: accepts an OPTIONAL `scopeAccountKey`,
 * same rationale/contract as checkLayer2DailyLoss above — narrows evaluation
 * to sessions belonging to the caller's own account instead of iterating
 * every active session system-wide and halting on the first breach found
 * ANYWHERE. Omitting it preserves the legacy global behavior byte-for-byte.
 */
async function checkLayer3TrailingDD(correlationId?: string, scopeAccountKey?: string): Promise<HaltDecision> {
  const cached = getCachedLayer(3, scopeAccountKey);
  if (cached) return cached;

  let decision: HaltDecision;
  try {
    const { getFirmAccount } = await import("../../shared/firm-config.js");

    const activeSessions = await db
      .select({
        id: paperSessions.id,
        firmId: paperSessions.firmId,
        // deepscan18 C-C1: config is needed to resolveAccountKey() when a scope
        // is supplied. Harmless additive field for the unscoped path (never
        // read there), so the unscoped query result/behavior is unchanged.
        config: paperSessions.config,
        currentEquity: paperSessions.currentEquity,
        realizedPeakEquity: paperSessions.realizedPeakEquity,
      })
      .from(paperSessions)
      // HIGH-3: include paused/stopped sessions — their open positions are live firm
      // exposure the DLL/trailing-DD force-close must still evaluate (was "active" only).
      .where(inArray(paperSessions.status, [...DLL_AGGREGATE_SESSION_STATUSES]));

    // deepscan18 C-C1: scope to the caller's own account when supplied — same
    // resolveAccountKey() used by Layer 2/cross-symbol-pnl.ts, so a scoped
    // Layer 3 check evaluates exactly the session(s) belonging to the
    // requesting account, never a sibling account's trailing-DD breach.
    const sessionsToEvaluate = scopeAccountKey
      ? activeSessions.filter((s) => resolveAccountKey(s) === scopeAccountKey)
      : activeSessions;

    for (const session of sessionsToEvaluate) {
      const firmId = session.firmId ?? "mffu";
      // deep-scan round 2 LOW-4: getFirmAccount() returns FirmAccountConfig
      // (src/shared/firm-config.ts), whose `maxDrawdown` field is NON-OPTIONAL
      // (always populated) and which has no `maxDailyDrawdown` field at all —
      // that field only ever existed in test mocks (mock-fabricates-a-field
      // smell), never the real producer. The `?? firmAccount?.maxDailyDrawdown`
      // fallback was dead code reading a field that never exists at runtime.
      let firmAccount: { maxDrawdown: number } | null = null;
      try {
        firmAccount = getFirmAccount(firmId) as { maxDrawdown: number };
      } catch {
        continue;
      }
      const maxDrawdown = firmAccount?.maxDrawdown;
      if (!maxDrawdown || maxDrawdown <= 0) continue;

      const currentEquity = parseFloat(String(session.currentEquity ?? "0"));
      const peakEquity    = parseFloat(String(session.realizedPeakEquity ?? "0"));
      const drawdown      = peakEquity - currentEquity;

      if (drawdown >= maxDrawdown - TRAILING_DD_BUFFER_DOLLARS) {
        // CAP-1 fix (deep-scan 2026-07-11): Layer 3 previously only set halted:true (blocking NEW
        // entries) and NEVER flattened the OPEN position causing the trailing-DD breach — so the
        // position kept bleeding through the firm trailing-max-DD line and the account could still be
        // closed, despite the reason string "trailing_dd_force_close_at_95pct". Mirror Layer 2's
        // account-scoped force-close so the breach actually force-closes. _safeForceClose dedupes
        // concurrent calls via _forceCloseInFlight and scopes the flatten to ONLY this account.
        const l3AccountKey = resolveAccountKey(session);
        // MED#4 (fresh-scan 2026-07-12): a SUCCESSFUL L3 force-close leaves the account flat but STILL
        // breached (realizing losses doesn't recover equity), so the breach persists all RTH. The CONT-7
        // MED#8 backoff was DEFEATED by its own delete-on-success (which reopened the storm on the next
        // eval). Mirror L2's day-dedup: once L3 has COMPLETED a force-close for this account today, stay
        // HALTED silently for the rest of the day. Keyed `l3:` so it never collides with the L2 dedup.
        // deep-scan round 2 MED-3: canonical CME-ET trading-day string — was an
        // inline copy of the same formula Layer 2 (above) also duplicated.
        const _l3Today = toCmeTradingDayString(new Date());
        if (_forceClosedTodayByAccount.get(`l3:${l3AccountKey}`) === _l3Today) {
          decision = {
            halted: true,
            layer: 3,
            reason: "trailing_dd_force_close_already_done_today",
            detail: { session_id: session.id, firm_id: firmId, account_key: l3AccountKey },
          };
          break;
        }
        // F-2 (CAP-1 grade 2026-07-11): mirror Layer 2's in-flight pre-check — if a force-close for
        // this account is already running, short-circuit BEFORE writing the pending audit row/SSE so
        // overlapping evaluators (signal path + dashboard status poll, which have distinct cache keys)
        // don't leave a dangling pending row with no matching _completed row (false "stuck close"
        // alarm). _safeForceClose still dedups the actual flatten; this keeps the audit trail honest.
        if (_isForceCloseInFlight(l3AccountKey)) {
          decision = {
            halted: true,
            layer: 3,
            reason: "force_close_in_progress",
            detail: { session_id: session.id, firm_id: firmId, account_key: l3AccountKey },
          };
          break;
        }
        // MED#8 (fresh-scan 2026-07-12): L3 had NO re-fire guard (unlike L2's day-dedup). After a
        // trailing-DD breach the positions flatten but equity does NOT recover, so `drawdown >=
        // maxDrawdown - buffer` stays true and every ~1s eval re-wrote the pending audit + SSE +
        // re-attempt — a storm. Back off the re-attempt (still re-attempts, at most once per window;
        // stay HALTED silently between). Keyed distinctly (`l3:` prefix) so it doesn't share L2's key.
        if (!_forceCloseReattemptDue(`l3:${l3AccountKey}`, Date.now())) {
          decision = {
            halted: true,
            layer: 3,
            reason: "trailing_dd_force_close_reattempt_backoff",
            detail: { session_id: session.id, firm_id: firmId, account_key: l3AccountKey },
          };
          break;
        }
        // F-1 (CAP-1 grade 2026-07-11): thread the signal-path root correlationId (fallback to a fresh
        // UUID only when absent) so the trailing_dd force-close audit/SSE rows join to the triggering
        // bar/signal, matching Layer 2 (CLAUDE.md §2 correlation_id reconstruction requirement).
        const l3CorrelationId = correlationId ?? randomUUID();
        insertAuditRow({
          action: "sizing.trailing_dd_force_close",
          entityType: "system",
          entityId: l3AccountKey,
          decisionAuthority: "system",
          input: { account_key: l3AccountKey, firm_id: firmId, drawdown, max_dd: maxDrawdown, buffer_dollars: TRAILING_DD_BUFFER_DOLLARS } as Record<string, unknown>,
          result: { action: "force_close", outcome: "triggered" } as Record<string, unknown>,
          status: "pending",
          correlationId: l3CorrelationId,
        }).catch((auditErr) =>
          logger.error({ err: auditErr }, "kill-switch L3: trailing-DD force-close trigger audit failed (non-blocking)")
        );
        broadcastSSE("kill_switch:trailing_dd_force_close", {
          account_key: l3AccountKey,
          firm_id: firmId,
          drawdown,
          max_dd: maxDrawdown,
          buffer_remaining: maxDrawdown - drawdown,
          correlationId: l3CorrelationId,
          forced_at: new Date().toISOString(),
        });
        const _l3FcOk = await _safeForceClose(
          `trailing_dd_force_close_at_95pct:${l3AccountKey}`,
          l3CorrelationId,
          { accountKey: l3AccountKey },
        );
        if (_l3FcOk) {
          _forceCloseLastAttemptByAccount.delete(`l3:${l3AccountKey}`); // clear the incomplete-retry backoff
          _forceClosedTodayByAccount.set(`l3:${l3AccountKey}`, _l3Today); // MED#4: silent for the rest of the day (was delete → storm)
          insertAuditRow({
            action: "sizing.trailing_dd_force_close_completed",
            entityType: "system",
            entityId: l3AccountKey,
            decisionAuthority: "system",
            input: { account_key: l3AccountKey, firm_id: firmId } as Record<string, unknown>,
            result: { action: "force_close", outcome: "completed" } as Record<string, unknown>,
            status: "success",
            correlationId: l3CorrelationId,
          }).catch((auditErr) =>
            logger.error({ err: auditErr }, "kill-switch L3: trailing-DD force-close completed-audit failed (non-blocking)")
          );
        }
        decision = {
          halted: true,
          layer: 3,
          reason: "trailing_dd_force_close_at_95pct",
          detail: {
            session_id: session.id,
            firm_id: firmId,
            drawdown,
            max_dd: maxDrawdown,
            buffer_remaining: maxDrawdown - drawdown,
          },
        };
        break;
      }
    }

    decision ??= { halted: false };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "kill-switch L3: trailing-DD check failed — blocking entries (fail-closed)");
    decision = {
      halted: true,
      layer: 3,
      reason: "trailing_dd_check_failed",
      detail: { error: errMsg, fail_closed: true },
    };
  }

  setCachedLayer(3, decision, scopeAccountKey);
  return decision;
}

/**
 * Layer 4: Connectivity.
 * Fail-OPEN: if the connectivity check itself errors, don't block trading.
 * Advisory only — connectivity degradation is transient; hard-halt only when
 * the poller has confirmed degraded state (not on a check error).
 */
function checkLayer4Connectivity(): HaltDecision {
  const cached = getCachedLayer(4);
  if (cached) return cached;

  let decision: HaltDecision;
  try {
    const degraded = isConnectivityDegraded();
    decision = degraded
      ? { halted: true, layer: 4, reason: "network_failover_connectivity_degraded" }
      : { halted: false };
  } catch {
    decision = { halted: false };
  }

  setCachedLayer(4, decision);
  return decision;
}

/**
 * Layer 5: Drift — latest weekly_drift_report severity === 'red'.
 * Fail-OPEN: drift detector is advisory until Phase 4B hard-gate wiring.
 */
async function checkLayer5Drift(): Promise<HaltDecision> {
  const cached = getCachedLayer(5);
  if (cached) return cached;

  let decision: HaltDecision;
  try {
    const driftRows = await db
      .select({ severity: weeklyDriftReports.severity, reportWeek: weeklyDriftReports.reportWeek })
      .from(weeklyDriftReports)
      .orderBy(desc(weeklyDriftReports.ranAt))
      .limit(1);

    if (driftRows.length > 0 && driftRows[0].severity === "red") {
      decision = {
        halted: true,
        layer: 5,
        reason: "weekly_drift_red",
        detail: { report_week: driftRows[0].reportWeek },
      };
    } else {
      decision = { halted: false };
    }
  } catch {
    // Fail-open: drift is advisory
    decision = { halted: false };
  }

  setCachedLayer(5, decision);
  return decision;
}

/**
 * Layer 6: CME outage.
 * Fail-CLOSED: if isExchangeHalted() throws (poller crash), we cannot determine
 * outage status → block entries.
 */
function checkLayer6CmeOutage(correlationId: string): HaltDecision {
  const cached = getCachedLayer(6);
  if (cached) return cached;

  let decision: HaltDecision;
  try {
    const halted = isExchangeHalted("CME");
    decision = halted
      ? { halted: true, layer: 6, reason: "cme_outage_active" }
      : { halted: false };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "C1 CME outage eval FAILED — blocking entries (fail-closed, Layer 6)");
    // Fire-and-forget audit + SSE
    insertAuditRow({
      action: "kill_switch.c1_cme_outage_eval_failed",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { error_message: errMsg, layer: 6 } as Record<string, unknown>,
      result: { halted: true } as Record<string, unknown>,
      status: "failure",
      correlationId,
    }).catch((auditErr) =>
      logger.error({ err: auditErr }, "kill-switch L6: audit_log write failed (non-blocking)"),
    );
    broadcastSSE("kill_switch:c1_cme_eval_failed", {
      error_message: errMsg,
      layer: 6,
      halted: true,
      timestamp: new Date().toISOString(),
      correlationId,
    });
    decision = { halted: true, layer: 6, reason: "cme_outage_eval_failed", detail: { error: errMsg } };
  }

  setCachedLayer(6, decision);
  return decision;
}

/**
 * Layer 7: Firm suspension.
 * Fail-CLOSED: DB unavailable = we cannot verify suspension → halt.
 *
 * deepscan18 (2026-07-05) C-C1 fix: accepts an OPTIONAL `scopeFirmId`. When
 * supplied, checks ONLY that firm's suspension status instead of enumerating
 * every enabled broker account's firm and halting the caller if ANY of them
 * is suspended — a DIFFERENT firm's suspension must not halt entries on an
 * unrelated, healthy firm's account (same over-broad-halt class Layer 2/3 fix
 * above). Omitting it preserves the legacy global behavior byte-for-byte.
 */
async function checkLayer7FirmSuspension(correlationId: string, scopeFirmId?: string): Promise<HaltDecision> {
  const cached = getCachedLayer(7, scopeFirmId);
  if (cached) return cached;

  let decision: HaltDecision;
  try {
    if (scopeFirmId) {
      // Scoped path: the caller already knows it holds an active account on
      // this firm (it's asking on behalf of that account) — skip the
      // enabled-broker-accounts enumeration and check ONLY this firm.
      const suspended = isFirmSuspended(scopeFirmId);
      if (suspended) {
        decision = {
          halted: true,
          layer: 7,
          reason: `firm_suspended:${scopeFirmId}`,
          detail: { suspended_firms: [scopeFirmId], scoped_firm_id: scopeFirmId },
        };
        insertAuditRow({
          action: "kill_switch.c2_multi_firm_check",
          entityType: "system",
          entityId: null,
          decisionAuthority: "system",
          input: { firms_checked: [scopeFirmId], scoped: true } as Record<string, unknown>,
          result: { suspended_firms: [scopeFirmId], halted: true } as Record<string, unknown>,
          status: "success",
          correlationId,
        }).catch((auditErr) =>
          logger.error({ err: auditErr }, "kill-switch L7: audit_log write failed (non-blocking)"),
        );
      } else {
        decision = { halted: false };
      }
    } else {
      const enabledAccounts = await db
        .select({ firmId: brokerAccounts.firmId })
        .from(brokerAccounts)
        .where(eq(brokerAccounts.enabled, true));

      const firmsChecked = [...new Set(enabledAccounts.map((r) => r.firmId))];
      const suspendedFirms = firmsChecked.filter((firmId) => isFirmSuspended(firmId));

      if (suspendedFirms.length > 0) {
        decision = {
          halted: true,
          layer: 7,
          // Name the suspended firm(s) so the operator knows WHICH firm halted the
          // bot without drilling into detail (deep-scan 2026-06-28).
          reason: `firm_suspended:${suspendedFirms.join(",")}`,
          detail: { suspended_firms: suspendedFirms },
        };
        // Audit ONLY on actual suspension (deep-scan 2026-06-28). The old code
        // wrote a "checked firms, nothing suspended" row on every per-second
        // signal-path eval (up to ~23k+ rows/day RTH), burying real suspension
        // events in the append-only trust spine. The clean-state result is already
        // visible via the kill-switch status report + SSE; it does not need an
        // immutable audit row. Suspension (a real event) still always audits.
        insertAuditRow({
          action: "kill_switch.c2_multi_firm_check",
          entityType: "system",
          entityId: null,
          decisionAuthority: "system",
          input: { firms_checked: firmsChecked } as Record<string, unknown>,
          result: { suspended_firms: suspendedFirms, halted: decision.halted } as Record<string, unknown>,
          status: "success",
          correlationId,
        }).catch((auditErr) =>
          logger.error({ err: auditErr }, "kill-switch L7: audit_log write failed (non-blocking)"),
        );
      } else {
        decision = { halted: false };
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "C2 multi-firm suspension check FAILED — blocking entries (fail-closed, Layer 7)");
    decision = {
      halted: true,
      layer: 7,
      reason: "firm_suspension_check_failed",
      detail: { error: errMsg, fail_closed: true, ...(scopeFirmId ? { scoped_firm_id: scopeFirmId } : {}) },
    };
    insertAuditRow({
      action: "kill_switch.c2_multi_firm_check",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { error_message: errMsg, layer: 7, scoped_firm_id: scopeFirmId ?? null } as Record<string, unknown>,
      result: { suspended_firms: [], halted: true, eval_failed: true } as Record<string, unknown>,
      status: "failure",
      correlationId,
    }).catch((auditErr) =>
      logger.error({ err: auditErr }, "kill-switch L7: audit_log write failed (non-blocking)"),
    );
  }

  setCachedLayer(7, decision, scopeFirmId);
  return decision;
}

/**
 * Layer 8: Macro crisis.
 * Fail-OPEN: macro gate is advisory for status reporting.
 */
async function checkLayer8MacroCrisis(): Promise<HaltDecision> {
  const cached = getCachedLayer(8);
  if (cached) return cached;

  let decision: HaltDecision;
  try {
    const macro = await getMacroGateResult();
    decision = macro.crisis_gate_triggered
      ? { halted: true, layer: 8, reason: "macro_crisis_gate_triggered", detail: { prob_crisis_above_0_60: true } }
      : { halted: false };
  } catch {
    decision = { halted: false };
  }

  setCachedLayer(8, decision);
  return decision;
}

/**
 * Layer 9: Windows reboot pending.
 * Fail-OPEN: Windows check is independent of trading infrastructure.
 */
async function checkLayer9WindowsReboot(): Promise<HaltDecision> {
  const cached = getCachedLayer(9);
  if (cached) return cached;

  let decision: HaltDecision;
  try {
    const windowsOk = await getWindowsHealthOk();
    decision = !windowsOk
      ? { halted: true, layer: 9, reason: "windows_reboot_pending_or_unhealthy" }
      : { halted: false };
  } catch {
    decision = { halted: false };
  }

  setCachedLayer(9, decision);
  return decision;
}

/**
 * Runs a single layer check with a per-layer timeout budget.
 * If the check times out (> LAYER_CHECK_TIMEOUT_MS), returns halted:false
 * (fail-OPEN) and emits a kill_switch.layer_N_timeout audit row so the
 * operator knows which layer is slow.
 *
 * This prevents a slow DB or external service from blocking the signal path
 * indefinitely on every bar.
 */
async function runLayerWithTimeout(
  layer: number,
  checkFn: () => Promise<HaltDecision>,
  correlationId: string,
  // deepscan18 A-C2/C-C1: the caller's account scope (if any) so the FIX 1b
  // force-close-pending check below is account-aware. Omitted for layers that
  // don't take a scope (4,5,6,8,9 always pass undefined here) — identical to
  // pre-fix behavior for those.
  scopeAccountKeyForForceCloseCheck?: string,
  // CRIT-2 (deep-scan 2026-07-09, operator-ratified): force-close-TRIGGERING layers
  // (L2 daily-loss/95%-force-close, L3 trailing-DD, L7 firm-suspension) must fail
  // CLOSED on timeout, NOT fail-open. Their own thrown-exception paths are already
  // fail-closed (catch → halted:true); a merely-SLOW check (>100ms under ordinary
  // Railway-Postgres latency, not an error) previously resolved halted:false and
  // approved a new entry on an account that should be force-closed — a confused
  // deputy that silently defeated the documented fail-closed contract. The
  // _isForceCloseInFlight() guard doesn't help because the very layer that would
  // DETECT the breach is the one timing out (nothing is in flight yet). Advisory
  // layers (4/5/8/9) keep failing OPEN (default false) — a slow advisory check must
  // not block trading.
  failClosedOnTimeout: boolean = false,
): Promise<HaltDecision> {
  const timeoutPromise: Promise<HaltDecision> = new Promise((resolve) => {
    const timer = setTimeout(() => {
      // A force-close already in flight forces HALTED regardless (FIX 1b, account-scoped).
      const forceCloseInFlight = _isForceCloseInFlight(scopeAccountKeyForForceCloseCheck);
      const halted = failClosedOnTimeout || forceCloseInFlight;
      const reason = forceCloseInFlight
        ? "layer_timeout_force_close_pending"
        : failClosedOnTimeout
          ? "layer_timeout_fail_closed"
          : undefined;
      logger.warn(
        { layer, timeout_ms: LAYER_CHECK_TIMEOUT_MS, correlationId, halted, failClosedOnTimeout },
        `kill-switch: Layer ${layer} check timed out — failing ${halted ? "CLOSED (force-close-triggering layer)" : "OPEN (advisory layer, signal-path budget exceeded)"}`,
      );
      // Fire-and-forget audit — non-blocking
      insertAuditRow({
        action: `kill_switch.layer_${layer}_timeout`,
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { layer, timeout_ms: LAYER_CHECK_TIMEOUT_MS, fail_closed_on_timeout: failClosedOnTimeout } as Record<string, unknown>,
        result: { halted, fail_open: !halted } as Record<string, unknown>,
        status: "failure",
        correlationId,
      }).catch((auditErr) =>
        logger.error({ err: auditErr }, `kill-switch L${layer}: timeout audit_log write failed`),
      );
      // LOW#9 (fresh-scan 2026-07-12): include the real `layer` so the halted-signal emitter's
      // `decision.layer ?? 0` no longer misattributes a fail-closed L2/L3/L7 timeout as the nonexistent
      // "layer 0" in the trust-spine row + SSE.
      resolve(halted ? { halted: true, reason: reason ?? "layer_timeout_fail_closed", layer } : { halted: false, layer });
    }, LAYER_CHECK_TIMEOUT_MS);
    // Prevent the timeout timer from keeping Node alive if the check resolves first
    if (typeof timer.unref === "function") timer.unref();
  });

  return Promise.race([checkFn(), timeoutPromise]);
}

// ─── KillSwitch ───────────────────────────────────────────────────────────────

class KillSwitch {
  private cache: { state: SystemState; lastCheck: number } | null = null;
  private readonly CACHE_TTL_MS = 5_000;

  // ── Core mode read ────────────────────────────────────────────────────────

  /**
   * Evaluates ALL 9 kill switch layers in priority order.
   * Returns the FIRST blocking layer's HaltDecision, or {halted:false} if all pass.
   *
   * Each layer:
   *   - Has a 1s in-memory cache (amortizes DB/service cost across signal bars)
   *   - Has a 100ms per-layer timeout budget → fail-OPEN with audit row on timeout
   *   - Emits kill_switch.layer_N_halted audit row + kill_switch:layer_halted SSE on block
   *   - Returns on the FIRST blocking layer (priority: L1 > L2 > L3 > ... > L9)
   *
   * Callers on the signal path must use isHaltedForProduction() which wraps this
   * and returns a boolean for backward compatibility.
   *
   * deepscan18 (2026-07-05) C-C1 fix: `opts.accountKey` / `opts.firmId` are
   * OPTIONAL account/firm scopes. When supplied, Layer 2 and Layer 3 evaluate
   * ONLY the given account, and Layer 7 evaluates ONLY the given firm — a
   * breach on a DIFFERENT account/firm no longer halts this caller. Omitting
   * both preserves the exact legacy global (iterate-every-account, halt-on-
   * first-breach-found-anywhere) behavior — byte-identical for callers that
   * don't pass a scope (dashboard reads via getKillSwitchStatus(), and any
   * caller not yet updated to pass one).
   */
  async evaluateAllKillSwitchLayers(
    opts: { correlationId?: string; accountKey?: string; firmId?: string | null } = {},
  ): Promise<HaltDecision> {
    const correlationId = opts.correlationId ?? randomUUID();
    const accountKey = opts.accountKey;
    const firmId = opts.firmId ?? undefined;

    // FIX 1a (Track M): fast-path — when a force-close is already in flight,
    // skip all layer checks and return HALTED immediately. Without this guard,
    // runLayerWithTimeout returns halted:false at 100ms (fail-OPEN budget),
    // giving L2 DLL-95% one entry window while the 10s force-close is running.
    // deepscan18 A-C2: account-aware — a sibling account's in-flight
    // force-close no longer fast-path-halts THIS account's entry evaluation.
    if (_isForceCloseInFlight(accountKey)) {
      logger.warn(
        { correlationId, accountKey },
        "kill-switch: force-close in-flight — fast-path halt, all layers bypassed (Track M FIX 1a)",
      );
      return { halted: true, layer: 2, reason: "force_close_in_flight" };
    }

    // ── Layer 1: Manual halt — no timeout needed (5s cached state read) ──
    let state: SystemState;
    try {
      state = await this.getCurrentState();
    } catch (err) {
      logger.error({ err }, "kill-switch: DB error reading system_state — failing CLOSED (halted)");
      return { halted: true, layer: 1, reason: "system_state_read_failed", detail: { fail_closed: true } };
    }
    const l1 = await checkLayer1Manual(state);
    if (l1.halted) {
      await this._emitLayerHaltedSignals(l1, correlationId);
      return l1;
    }

    // ── Layer 2: Daily loss limit ──
    // CRIT-2: L2 (daily-loss / 95%-force-close) fails CLOSED on timeout — a slow
    // check must not approve entries on an account that may be at its DLL.
    const l2 = await runLayerWithTimeout(2, () => checkLayer2DailyLoss(correlationId, accountKey), correlationId, accountKey, true);
    if (l2.halted) {
      await this._emitLayerHaltedSignals(l2, correlationId);
      return l2;
    }

    // ── Layer 3: Trailing drawdown ──
    // CRIT-2: L3 (trailing-DD) fails CLOSED on timeout — force-close-triggering.
    const l3 = await runLayerWithTimeout(3, () => checkLayer3TrailingDD(correlationId, accountKey), correlationId, accountKey, true);
    if (l3.halted) {
      await this._emitLayerHaltedSignals(l3, correlationId);
      return l3;
    }

    // ── Layer 4: Connectivity (sync — no timeout wrapping needed) ──
    const l4 = checkLayer4Connectivity();
    if (l4.halted) {
      await this._emitLayerHaltedSignals(l4, correlationId);
      return l4;
    }

    // ── Layer 5: Drift ──
    const l5 = await runLayerWithTimeout(5, () => checkLayer5Drift(), correlationId);
    if (l5.halted) {
      await this._emitLayerHaltedSignals(l5, correlationId);
      return l5;
    }

    // ── Layer 6: CME outage (sync, but wraps its own error into audit) ──
    const l6 = checkLayer6CmeOutage(correlationId);
    if (l6.halted) {
      await this._emitLayerHaltedSignals(l6, correlationId);
      return l6;
    }

    // ── Layer 7: Firm suspension ──
    // CRIT-2: fails CLOSED on timeout — a suspended firm must not get new entries
    // just because the suspension check was slow.
    const l7 = await runLayerWithTimeout(
      7,
      () => checkLayer7FirmSuspension(correlationId, firmId),
      correlationId,
      accountKey,
      true,
    );
    if (l7.halted) {
      await this._emitLayerHaltedSignals(l7, correlationId);
      return l7;
    }

    // ── Layer 8: Macro crisis ──
    const l8 = await runLayerWithTimeout(8, () => checkLayer8MacroCrisis(), correlationId);
    if (l8.halted) {
      await this._emitLayerHaltedSignals(l8, correlationId);
      return l8;
    }

    // ── Layer 9: Windows reboot pending ──
    const l9 = await runLayerWithTimeout(9, () => checkLayer9WindowsReboot(), correlationId);
    if (l9.halted) {
      await this._emitLayerHaltedSignals(l9, correlationId);
      return l9;
    }

    return { halted: false };
  }

  /**
   * Emits the kill_switch.layer_N_halted audit row and kill_switch:layer_halted SSE.
   * Called only when a layer returns halted:true. Fire-and-forget (non-blocking).
   */
  private async _emitLayerHaltedSignals(
    decision: HaltDecision,
    correlationId: string,
  ): Promise<void> {
    const layer = decision.layer ?? 0;
    const reason = decision.reason ?? "unknown";

    // Audit row (non-blocking)
    insertAuditRow({
      action: `kill_switch.layer_${layer}_halted`,
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { layer, reason, detail: decision.detail ?? {} } as Record<string, unknown>,
      result: { halted: true } as Record<string, unknown>,
      status: "failure",
      correlationId,
    }).catch((auditErr) =>
      logger.error(
        { err: auditErr, layer },
        `kill-switch L${layer}: halted audit_log write failed (non-blocking)`,
      ),
    );

    // SSE broadcast (non-blocking)
    broadcastSSE("kill_switch:layer_halted", {
      layer,
      reason,
      detail: decision.detail ?? {},
      correlationId,
      halted_at: new Date().toISOString(),
    });

    logger.warn(
      { layer, reason, correlationId },
      `kill-switch: Layer ${layer} HALTED signal path — ${reason}`,
    );
  }

  /**
   * Returns true when production trading should be blocked.
   * NOW enforces ALL 9 layers, not just Layer 1 (H6 fix — 2026-06-23).
   *
   * Backward-compatible boolean wrapper over evaluateAllKillSwitchLayers().
   * All existing callers (paper-signal-service, paper-execution-service,
   * openPosition) continue to work without changes.
   *
   * deepscan18 (2026-07-05) C-C1: accepts the same OPTIONAL `accountKey` /
   * `firmId` scope as evaluateAllKillSwitchLayers() — see that method's
   * docstring for the full contract. Passed straight through.
   *
   * Fail-CLOSED: any unhandled error returns true (halted).
   */
  async isHaltedForProduction(
    opts: { correlationId?: string; accountKey?: string; firmId?: string | null } = {},
  ): Promise<boolean> {
    try {
      const decision = await this.evaluateAllKillSwitchLayers(opts);
      return decision.halted;
    } catch (err) {
      logger.error({ err }, "kill-switch: evaluateAllKillSwitchLayers threw unexpectedly — failing CLOSED (halted)");
      return true;
    }
  }

  /**
   * Returns current system_state row with 5-second cache.
   * Throws on DB error — callers that want fail-CLOSED must catch and return halted.
   */
  async getCurrentState(): Promise<SystemState> {
    const now = Date.now();
    if (this.cache && now - this.cache.lastCheck < this.CACHE_TTL_MS) {
      return this.cache.state;
    }

    const rows = await db
      .select()
      .from(systemState)
      .where(eq(systemState.id, 1))
      .limit(1);

    if (rows.length === 0) {
      // Singleton row missing — treat as HALT (fail-closed)
      const fallback: SystemState = {
        production_mode: "HALT",
        kill_reason: "system_state_row_missing",
        set_by: "kill-switch",
        set_at: new Date(),
      };
      logger.error("kill-switch: system_state singleton row missing — returning HALT (fail-closed)");
      return fallback;
    }

    const row = rows[0];
    const state: SystemState = {
      production_mode: row.productionMode as ProductionMode,
      kill_reason: row.killReason,
      set_by: row.setBy,
      set_at: row.setAt,
    };

    this.cache = { state, lastCheck: now };
    return state;
  }

  // ── Mode transition ───────────────────────────────────────────────────────

  /**
   * Sets production mode. Atomically:
   *   1. Reads current mode (for audit diff)
   *   2. Updates system_state singleton
   *   3. Invalidates cache
   *   4. Writes audit_log row (production.mode_changed)
   *   5. Broadcasts SSE (production:mode-changed)
   *   6. If mode === 'HALT': logs force-flatten advisory
   *      (Phase 4C wires the actual paper-execution-service call)
   */
  async setMode(mode: ProductionMode, reason: string, setBy: string): Promise<void> {
    let previousMode: ProductionMode = "HALT";

    try {
      // Read previous state for audit diff
      const prev = await this.getCurrentState().catch(() => null);
      previousMode = prev?.production_mode ?? "HALT";
    } catch {
      // Non-blocking; best-effort for audit context
    }

    // Update DB
    await db
      .update(systemState)
      .set({
        productionMode: mode,
        killReason: reason,
        setBy,
        setAt: new Date(),
      })
      .where(eq(systemState.id, 1));

    // Invalidate cache (both system_state and all layer caches)
    this.cache = null;
    layerCache.clear();

    // FINDING #3 FIX: Generate a correlationId for the mode-change audit row.
    const modeChangeCorrelationId = randomUUID();

    // HIGH#6 (fresh-scan 2026-07-12): AWAIT the mode-change audit and ESCALATE on failure. This is the
    // single highest-value capital-authority trace — operator HALT/RESUME enables/disables ALL live
    // deployment. A fire-and-forget `.catch(log)` swallowed a transient DB fault, so the immutable
    // audit_log's last mode_changed row could read HALT while the account is actually TRADING — §2's
    // "every capital decision has a reconstructable audit row" broken exactly where it matters most.
    try {
      await db.insert(auditLog).values({
        action: "production.mode_changed",
        entityType: "system",
        entityId: null,
        decisionAuthority: setBy === "operator" ? "human" : "system",
        input: { previousMode, newMode: mode, reason } as Record<string, unknown>,
        result: { mode, setBy, reason } as Record<string, unknown>,
        status: "success",
        correlationId: modeChangeCorrelationId,
      });
    } catch (auditErr) {
      logger.error(
        { err: auditErr, previousMode, newMode: mode, setBy, correlationId: modeChangeCorrelationId },
        "kill-switch: production.mode_changed audit write FAILED — capital-authority trace gap",
      );
      AlertFactory.systemError(
        "kill-switch-mode-change-audit-failed",
        new Error(
          `production.mode_changed audit write FAILED after mode set to ${mode} (setBy=${setBy}, reason=${reason}). ` +
          `audit_log may not reflect the CURRENT mode — reconcile immediately. CorrelationId: ${modeChangeCorrelationId}.`,
        ),
      );
    }

    // SSE broadcast
    // ds21 (deep-scan #21 Band D): thread the same correlationId used on the audit row
    // (:1319) into the SSE payload so a dashboard consumer of this capital-safety HALT/RESUME
    // event can correlate it to its audit trail without timestamp-matching.
    broadcastSSE("production:mode-changed", {
      previousMode,
      newMode: mode,
      reason,
      setBy,
      changedAt: new Date().toISOString(),
      correlationId: modeChangeCorrelationId,
    });

    logger.info(
      { previousMode, newMode: mode, reason, setBy },
      "kill-switch: production mode changed"
    );

    // HALT path: dynamic-import force-flatten to avoid circular dependency.
    if (mode === "HALT") {
      logger.warn(
        { reason, setBy },
        "kill-switch: HALT activated — force-flattening all open paper positions"
      );
      // deepscan7 obs-M6 (2026-07-02): surface the mode-change correlationId in the
      // operator alert so audit_log can be queried directly from the Discord message
      // (the audit row above already carries it; the alert body previously omitted it).
      AlertFactory.systemError(
        "production-halt-activated",
        new Error(
          `Production mode set to HALT by ${setBy}: ${reason}. ` +
          `Force-flattening all open paper positions. ` +
          `CorrelationId: ${modeChangeCorrelationId}`
        )
      );
      // FINDING #1 FIX: awaited force-close with timeout and CRITICAL escalation on failure.
      // FIX 2 (Track M): _safeForceClose deduplicates concurrent L2+setMode force-close calls.
      await _safeForceClose(`production_halt:${reason}`, modeChangeCorrelationId);
    }
  }

  // ── 9-Layer Status (dashboard reporting) ─────────────────────────────────

  /**
   * Returns the status of all 9 kill switch layers independently.
   * Used by GET /api/production/status dashboard endpoint.
   * Each layer is evaluated in isolation using the same per-layer check functions
   * as evaluateAllKillSwitchLayers() — logic is NOT duplicated.
   *
   * Note: unlike evaluateAllKillSwitchLayers(), this evaluates ALL layers even
   * after finding a block, so the dashboard shows the full picture. The signal path
   * uses evaluateAllKillSwitchLayers() which short-circuits on first block.
   */
  async getKillSwitchStatus(): Promise<KillSwitchStatusReport> {
    const checkedAt = new Date();
    const evalCorrelationId = randomUUID();
    const layers: KillSwitchLayerStatus[] = [];

    // ── Layer 1: Manual (operator) ──
    let l1Halted = true;
    let productionMode: ProductionMode = "HALT";
    try {
      const state = await this.getCurrentState();
      l1Halted = state.production_mode === "HALT";
      productionMode = state.production_mode;
    } catch (err) {
      l1Halted = true; // fail-closed
    }
    layers.push({
      layer: 1,
      name: "manual_operator",
      halted: l1Halted,
      reason: l1Halted ? "production_mode=HALT" : undefined,
    });

    // ── Layer 2: Daily loss ──
    // Re-use per-layer checker (applies its own cache independently of this call)
    const l2Result = await checkLayer2DailyLoss(evalCorrelationId);
    layers.push({
      layer: 2,
      name: "daily_loss",
      halted: l2Result.halted,
      reason: l2Result.reason,
    });

    // ── Layer 3: Trailing drawdown ──
    const l3Result = await checkLayer3TrailingDD(evalCorrelationId);
    layers.push({
      layer: 3,
      name: "trailing_drawdown",
      halted: l3Result.halted,
      reason: l3Result.reason,
    });

    // ── Layer 4: Connectivity ──
    const l4Result = checkLayer4Connectivity();
    layers.push({
      layer: 4,
      name: "connectivity",
      halted: l4Result.halted,
      reason: l4Result.halted ? "network_failover: connectivity degraded" : undefined,
    });

    // ── Layer 5: Drift ──
    const l5Result = await checkLayer5Drift();
    layers.push({
      layer: 5,
      name: "drift",
      halted: l5Result.halted,
      reason: l5Result.reason,
    });

    // ── Layer 6: CME outage ──
    const l6EvalCorrelationId = evalCorrelationId;
    const l6Result = checkLayer6CmeOutage(l6EvalCorrelationId);
    layers.push({
      layer: 6,
      name: "cme_outage",
      halted: l6Result.halted,
      reason: l6Result.halted ? "exchange-status: CME outage active" : undefined,
    });

    // ── Layer 7: Firm suspension ──
    const l7EvalCorrelationId = evalCorrelationId;
    const l7Result = await checkLayer7FirmSuspension(l7EvalCorrelationId);
    layers.push({
      layer: 7,
      name: "firm_suspension",
      halted: l7Result.halted,
      reason: l7Result.reason,
    });

    // ── Layer 8: Macro crisis ──
    const l8Result = await checkLayer8MacroCrisis();
    layers.push({
      layer: 8,
      name: "macro_crisis",
      halted: l8Result.halted,
      reason: l8Result.reason,
    });

    // ── Layer 9: Windows reboot pending ──
    const l9Result = await checkLayer9WindowsReboot();
    layers.push({
      layer: 9,
      name: "windows_reboot_pending",
      halted: l9Result.halted,
      reason: l9Result.halted ? "windows-health: reboot pending or health check failed" : undefined,
    });

    const overallHalted = layers.some((l) => l.halted);

    return {
      overall_halted: overallHalted,
      production_mode: productionMode,
      layers,
      checked_at: checkedAt,
    };
  }

  // ── Cache invalidation (for testing) ─────────────────────────────────────

  /** Exposed for tests only. Clears the in-memory cache. */
  _invalidateCacheForTests(): void {
    this.cache = null;
    layerCache.clear();
    // #8 (deep-scan 2026-07-11): also clear the force-closed-today dedup map. It is a
    // module-singleton that otherwise persists across it() cases — once one test drives an
    // account through a 95% force-close, the dedup silently HALTs every later test's
    // force-close on the same accountKey (no audit/SSE/re-flatten), flipping assertions.
    // Every suite that exercises the L2 force-close path already calls this in beforeEach.
    _forceClosedTodayByAccount.clear();
    // MED#7+#8: the re-attempt backoff map is also a module singleton — clear it for test isolation.
    _forceCloseLastAttemptByAccount.clear();
  }

  /**
   * Exposed for tests only. Injects a pre-computed layer result into the cache.
   * `scope` is OPTIONAL (deepscan18 C-C1) — omitting it seeds the GLOBAL cache
   * entry, identical to pre-fix behavior for every existing test that calls
   * this with 2 args. Pass `scope` (accountKey for L2/L3, firmId for L7) to
   * seed an account/firm-scoped cache entry for new account-aware tests.
   */
  _setLayerCacheForTests(layer: number, decision: HaltDecision, scope?: string): void {
    setCachedLayer(layer, decision, scope);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const killSwitch = new KillSwitch();

// ─── Test seams (Track M FIX 1 + FIX 2, deepscan18 A-C2) ────────────────────
// Exposed for vitest only — do NOT use in production code.

/**
 * Set the force-close in-flight state for test isolation of FIX 1a / FIX 1b /
 * FIX 2 / deepscan18 A-C2 scenarios.
 *
 * deepscan18 A-C2: the underlying state is now a Map keyed by account (see
 * _isForceCloseInFlight above), not a single boolean. This test seam keeps
 * its ORIGINAL 1-arg (boolean) signature fully working — every pre-existing
 * test that calls `_setForceCloseInFlightForTests(true/false)` with no
 * accountKey continues to pass unmodified:
 *   - `(true)` with no accountKey sets the GLOBAL scope flag — matches old
 *     "the one boolean is true" semantics (an unscoped
 *     _getForceCloseInFlightForTests()/_isForceCloseInFlight(undefined) read
 *     is conservative and reports true whenever ANY entry is true).
 *   - `(false)` with no accountKey CLEARS the entire map — matches old
 *     "nothing in flight, anywhere" semantics and gives clean test isolation
 *     between test cases regardless of what a previous test scoped.
 *   - Pass `accountKey` to set/clear ONE account's flag independently for new
 *     multi-account tests (deepscan18 Track 1).
 */
export function _setForceCloseInFlightForTests(value: boolean, accountKey?: string): void {
  if (accountKey) {
    _forceCloseInFlightByAccount.set(accountKey, value);
    return;
  }
  if (value === false) {
    _forceCloseInFlightByAccount.clear();
  } else {
    _forceCloseInFlightByAccount.set(GLOBAL_SCOPE_KEY, true);
  }
}

/**
 * Read the force-close in-flight state for test assertions.
 * Omit `accountKey` for the legacy "true if ANY force-close (any scope) is in
 * flight" read (matches the old single-boolean semantics). Pass `accountKey`
 * to assert one account's own flag independently of any other account's.
 */
export function _getForceCloseInFlightForTests(accountKey?: string): boolean {
  return _isForceCloseInFlight(accountKey);
}

/**
 * Reset the #8 force-closed-today dedup map for test isolation. Without this the
 * module-singleton `_forceClosedTodayByAccount` persists across `it()` cases: once one
 * test drives an account through a 95% force-close, the dedup silently HALTs every later
 * test's force-close on the same accountKey (no audit/SSE/re-flatten), flipping their
 * assertions. Omit `accountKey` to clear the whole map (default beforeEach reset); pass
 * one to seed/clear a single account's last-force-closed trading-day for targeted tests.
 */
export function _resetForceClosedTodayForTests(accountKey?: string, tradingDay?: string): void {
  if (accountKey) {
    if (tradingDay) _forceClosedTodayByAccount.set(accountKey, tradingDay);
    else _forceClosedTodayByAccount.delete(accountKey);
    return;
  }
  _forceClosedTodayByAccount.clear();
}

// CRIT-2 (2026-07-09) test seam: direct access to runLayerWithTimeout so tests can
// prove force-close-triggering layers (failClosedOnTimeout=true) resolve HALTED on
// timeout while advisory layers (false) resolve fail-open.
export const _runLayerWithTimeoutForTests = runLayerWithTimeout;
