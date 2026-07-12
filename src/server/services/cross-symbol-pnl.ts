/**
 * cross-symbol-pnl.ts — W23H.F Cross-Symbol DLL Coordinator
 *
 * Aggregates realized P&L + open MTM P&L across ALL symbols on a given firmId
 * (= paper account grouping) for today's trading session.
 *
 * Called once per bar entry signal evaluation.  Results are NOT cached because
 * they must reflect the latest closed trades; the risk-gate daily-loss cache
 * in paper-risk-gate.ts handles global loss at a coarser level.
 *
 * DLL thresholds (from CLAUDE.md §4):
 *   HALT new entries  at 67% of personal_dll  (env: DLL_HALT_PCT, default 0.67)
 *   FORCE-CLOSE all   at 95% of personal_dll  (env: DLL_FORCE_CLOSE_PCT, default 0.95)
 *   personal_dll      = 67% of firm DLL
 *
 * Design:
 *  - groups by firmId (paper sessions have firmId; broker_accounts also carry firmId)
 *  - sums realized PnL from paper_trades.pnl WHERE exit_time on today's CME trading day
 *  - sums unrealized PnL from paper_positions WHERE closed_at IS NULL
 *  - returns pnLBySymbol breakdown for audit
 *
 * Fail-open: any DB error returns a result with totalPnL=0 so trading is never blocked
 * by a query error.
 */

import { logger } from "../lib/logger.js";
// HIGH C-1 fix (deep-scan #16 wave-1 track-3, 2026-07-04): per-account personal-DLL
// resolution reuses the SAME Topstep trailing-DD tier table already used at the
// sizing site (paper-signal-service.ts ~5171) so the two subsystems never disagree
// on what an account's real firm DLL is.
import { TOPSTEP_TRAILING_DD_BY_SIZE } from "../../shared/firm-config.js";

// deepscan7 paper-MED-1 (2026-07-02): the firm-level DLL aggregate must include
// sessions stopped/paused mid-day — an "active"-only filter let a sibling session
// under-count firm losses already realized today by a session the operator (or a
// halt path) stopped after taking losses. Day-scoping stays in the per-session
// dailyPnlBreakdown[sessionDate] read, so a stopped session with only prior-day
// losses still contributes 0 to today's aggregate.
export const DLL_AGGREGATE_SESSION_STATUSES = ["active", "stopped", "paused"] as const;

export interface AccountSessionPnL {
  /**
   * HIGH C-1 (deep-scan #16 wave-1 track-3, 2026-07-04): this field now holds the
   * RESOLVED account-scoping key (see resolveAccountKey below), not necessarily the
   * raw paper_sessions.firm_id string. For the common single-account-per-firm case
   * (no config.account_key set) the two are identical — fully backward-compatible.
   * Field name kept as `firmId` to avoid churning the existing AccountSessionPnL
   * consumers/tests.
   */
  firmId: string;
  sessionDate: string;
  realizedPnL: number;
  openPnLMtm: number;
  totalPnL: number;       // realized + open MTM
  pnLBySymbol: Record<string, number>;
  /**
   * deep-scan 2026-07-11 HIGH: true when a DB fault prevented computing the real P&L (the returned
   * zeros are NOT trustworthy). Fail-CLOSED callers (kill-switch L2, fill-time DLL gate) MUST treat a
   * degraded result as "unknown P&L → block new entries". Absent/false = trustworthy figures.
   */
  degraded?: boolean;
}

/**
 * HIGH C-1 fix (deep-scan #16 wave-1 track-3, 2026-07-04):
 * Resolve the real per-account scoping key for cross-symbol DLL aggregation.
 *
 * `paper_sessions` has no first-class `account_id` column — only the free-text
 * `firm_id` ("topstep" / "mffu"). Under Phase-3 scaling (multiple Topstep accounts
 * per operator), every session on the SAME firm was netted into ONE shared bucket:
 * account A at −90% of its own DLL could hide behind account B's gains (neither
 * halts nor force-closes), and conversely a healthy account B could get falsely
 * halted by account A's losses the moment B's own entry-check queries the same
 * shared "topstep" bucket.
 *
 * Adding a real `account_id` column requires a migration (out of scope for this
 * file-owned fix — see CLAUDE.md subagent file-ownership boundaries). Until then,
 * the operator can tag per-account sessions via `paper_sessions.config.account_key`
 * (a plain string, e.g. "topstep-acct-2"). When unset, resolution falls back to
 * `firmId` — IDENTICAL to pre-fix behavior for the single-account-per-firm case,
 * so this is purely additive and does not change behavior until the operator opts
 * a second Topstep/MFFU account into a distinct key.
 *
 * INVARIANT the operator MUST maintain until a real `account_id` column lands:
 * one `config.account_key` == exactly one funded account. Reusing the same key
 * across two different funded accounts silently defeats DLL isolation again.
 */
// deepscan18 C-C4 (2026-07-05): dedup set so the fallback WARN below fires
// ONCE per distinct fallback key per process lifetime, not on every call —
// resolveAccountKey() is invoked on the hot signal-evaluation path (once or
// more per bar per session), so an un-deduped WARN would flood the logs
// under today's normal single-account operation (where the fallback path is
// the EXPECTED/safe default, not an error).
const _accountKeyFallbackWarnedKeys = new Set<string>();

export function resolveAccountKey(session: { firmId?: string | null; config?: unknown }): string {
  const cfg = session.config as { account_key?: unknown } | null | undefined;
  const rawKey = cfg && typeof cfg.account_key === "string" ? cfg.account_key.trim() : "";
  if (rawKey.length > 0) return rawKey;

  const fallbackKey = session.firmId ?? "default";
  // deepscan18 C-C4 fix: a 2nd real account on the SAME firm that never gets
  // config.account_key set silently re-merges its DLL bucket with every other
  // session on this fallback key (the exact isolation failure the C-1 fix
  // above solves for accounts that DID set the key). The daily
  // account-key-uniqueness-sanity cron (scheduler.ts) is the authoritative
  // detector for that condition, but it only runs once a day — this loud,
  // deduped WARN is the FIRST visible signal, fired the moment the fallback
  // path is actually exercised. Safe/expected today (operator runs a single
  // account per firm), so it fires once per fallback key, not on every call.
  if (!_accountKeyFallbackWarnedKeys.has(fallbackKey)) {
    _accountKeyFallbackWarnedKeys.add(fallbackKey);
    logger.warn(
      { firm_id: fallbackKey },
      `cross-symbol-pnl.resolveAccountKey: falling back to firmId="${fallbackKey}" — no config.account_key set. ` +
        `DLL isolation currently assumes only ONE funded account maps to this key. If a second account on ` +
        `"${fallbackKey}" begins trading without its own distinct config.account_key, its P&L will silently ` +
        `merge with every other session sharing this fallback (see account-key-uniqueness-sanity cron for the ` +
        `daily audit of this condition).`,
    );
  }
  return fallbackKey;
}

/**
 * HIGH C-1 fix (deep-scan #16 wave-1 track-3, 2026-07-04):
 * Resolve the PERSONAL dollar DLL base for a SPECIFIC account/session, replacing
 * the single global `DEFAULT_PERSONAL_DLL_DOLLARS` constant every account used to
 * share regardless of its real funded size.
 *
 * Resolution order mirrors the EXACT trailing-DD lookup already used at the
 * sizing site (paper-signal-service.ts ~5165-5171) so the two subsystems can never
 * disagree about a Topstep account's real firm DLL:
 *   1. session.config.trailing_dd_amount (operator override for this account)
 *   2. TOPSTEP_TRAILING_DD_BY_SIZE[accountStartingFloor] (firm tier table)
 *   3. $2,000 (50K combine hard default)
 *
 * MFFU / other firms have no per-tier trailing-DD table today (MFFU's rule is a
 * flat 2%-of-balance cap, not a fixed dollar DLL) — they fall back to the
 * operator's global default (personalDefault, $1,000 ≈ MFFU 50K eval @ 2%).
 */
export function resolvePersonalDllDollars(input: {
  firmId?: string | null;
  trailingDdOverride?: number | null;
  accountStartingFloor?: number | null;
  personalDefault?: number;
}): number {
  const personalDefault = input.personalDefault ?? DEFAULT_PERSONAL_DLL_DOLLARS;
  const firm = (input.firmId ?? "").toLowerCase();

  if (firm === "topstep") {
    if (typeof input.trailingDdOverride === "number" && input.trailingDdOverride > 0) {
      return input.trailingDdOverride;
    }
    if (typeof input.accountStartingFloor === "number") {
      const byTier = TOPSTEP_TRAILING_DD_BY_SIZE[input.accountStartingFloor];
      if (typeof byTier === "number") return byTier;
    }
    return 2_000; // Topstep 50K combine hard default — matches paper-signal-service.ts fallback
  }

  return personalDefault;
}

/**
 * HIGH C-1 fix (deep-scan #16 wave-1 track-3, 2026-07-04):
 * Compute cumulative P&L (realized + open MTM) across all symbols scoped to a
 * resolved account key (see resolveAccountKey) for today's CME trading day.
 *
 * Returns a zero-valued result on any error so callers always get a valid object.
 */
export async function getAccountSessionCumulativePnL(
  accountKey: string,
  sessionDate: string,
): Promise<AccountSessionPnL> {
  const zero: AccountSessionPnL = {
    firmId: accountKey,
    sessionDate,
    realizedPnL: 0,
    openPnLMtm: 0,
    totalPnL: 0,
    pnLBySymbol: {},
  };

  try {
    // Lazy imports to avoid top-level DB bootstrap in tests
    const { db } = await import("../db/index.js");
    const { paperPositions, paperSessions } = await import("../db/schema.js");
    const { eq, and, isNull, inArray, sql } = await import("drizzle-orm");

    // ── 1. Realized P&L: sum paper_trades.pnl for today ──────────────────────
    // We use the dailyPnlBreakdown JSONB on each session (already maintained by
    // the trade-close path) as the realized P&L source. This avoids a full
    // paper_trades scan and gives the same result.
    //
    // HIGH C-1 fix: the real account-scoping key can live inside config.account_key
    // (JSONB), which is not a plain SQL column we can `eq()` against firmId — so we
    // fetch every session matching the STATUS filter (still narrows the common case
    // materially) and resolve+filter by account key in application code below.
    // Trade-off documented: at current operator scale (dozens of sessions) this is
    // cheap; if paper_sessions grows large enough to matter, promote account_key to
    // a real indexed column via migration instead of tightening this query further.
    const sessionRows = await db
      .select({
        id: paperSessions.id,
        firmId: paperSessions.firmId,
        config: paperSessions.config,
        symbol: sql<string>`(${paperSessions.config}->>'symbol')`.as("symbol"),
        dailyPnlBreakdown: paperSessions.dailyPnlBreakdown,
      })
      .from(paperSessions)
      .where(inArray(paperSessions.status, [...DLL_AGGREGATE_SESSION_STATUSES]));

    let totalRealized = 0;
    const bySymbol: Record<string, number> = {};

    for (const session of sessionRows) {
      if (resolveAccountKey(session) !== accountKey) continue;

      const breakdown = (session.dailyPnlBreakdown as Record<string, number> | null) ?? {};
      const todayPnl = breakdown[sessionDate] ?? 0;
      totalRealized += todayPnl;

      const sym = session.symbol ?? "UNKNOWN";
      bySymbol[sym] = (bySymbol[sym] ?? 0) + todayPnl;
    }

    // ── 2. Open MTM P&L: sum unrealized_pnl from open positions ─────────────
    // Join paper_positions to paper_sessions; account-key filtering happens in
    // application code for the same JSONB reason as above.
    const openPositions = await db
      .select({
        symbol: paperPositions.symbol,
        unrealizedPnl: paperPositions.unrealizedPnl,
        sessionFirmId: paperSessions.firmId,
        sessionConfig: paperSessions.config,
      })
      .from(paperPositions)
      .innerJoin(paperSessions, eq(paperSessions.id, paperPositions.sessionId))
      .where(and(
        isNull(paperPositions.closedAt),
        // deepscan7 paper-MED-1: a paused session's open positions are live firm
        // exposure — count their MTM toward the firm DLL like the active set.
        inArray(paperSessions.status, [...DLL_AGGREGATE_SESSION_STATUSES]),
      ));

    let totalMtm = 0;
    for (const pos of openPositions) {
      if (resolveAccountKey({ firmId: pos.sessionFirmId, config: pos.sessionConfig }) !== accountKey) continue;

      const mtm = parseFloat(pos.unrealizedPnl ?? "0");
      totalMtm += mtm;
      const sym = pos.symbol ?? "UNKNOWN";
      bySymbol[sym] = (bySymbol[sym] ?? 0) + mtm;
    }

    return {
      firmId: accountKey,
      sessionDate,
      realizedPnL: totalRealized,
      openPnLMtm: totalMtm,
      totalPnL: totalRealized + totalMtm,
      pnLBySymbol: bySymbol,
    };
  } catch (err) {
    // deep-scan 2026-07-11 HIGH fix: mark the result DEGRADED so fail-CLOSED callers (kill-switch L2,
    // fill-time DLL gate) can honor their documented fail-closed contract. Previously this returned a
    // clean zero on ANY error — including a partial fault where the realized-loss scan SUCCEEDED
    // (e.g. -$1,900) but the subsequent MTM join timed out — silently discarding the loss so L2 saw
    // drawdown=0 and APPROVED a new entry on an account already at its DLL. Signal-time (fail-open)
    // callers may still ignore `degraded` and treat totalPnL=0 as non-blocking.
    logger.warn(
      { err, accountKey, sessionDate },
      "cross-symbol-pnl: DB query failed — returning DEGRADED zero (fail-closed callers must block; signal-time fail-open)",
    );
    return { ...zero, degraded: true };
  }
}

// ─── DLL threshold constants ─────────────────────────────────────────────────
// From CLAUDE.md §4: personal DLL = 67% of firm DLL.
// At 67% of personal DLL → HALT new entries.
// At 95% of personal DLL → FORCE-CLOSE all positions.
//
// The firm DLL is a $ amount per firm. We use a reasonable default of $1,000
// for paper trading (matches MFFU 50K eval at 2% = $1,000). Operator can
// override via PERSONAL_DLL_DOLLARS env var.

export const DEFAULT_PERSONAL_DLL_DOLLARS = (() => {
  const envVal = process.env["PERSONAL_DLL_DOLLARS"];
  if (envVal && !isNaN(parseFloat(envVal))) return parseFloat(envVal);
  return 1_000;   // $1,000 default personal DLL for paper sessions
})();

// DLL_HALT_PCT: halt new entries at this fraction of personal DLL (default 67%)
export const DLL_HALT_PCT = (() => {
  const envVal = process.env["DLL_HALT_PCT"];
  if (envVal && !isNaN(parseFloat(envVal))) return parseFloat(envVal);
  return 0.67;
})();

// DLL_FORCE_CLOSE_PCT: force-close all positions at this fraction (default 95%)
export const DLL_FORCE_CLOSE_PCT = (() => {
  const envVal = process.env["DLL_FORCE_CLOSE_PCT"];
  if (envVal && !isNaN(parseFloat(envVal))) return parseFloat(envVal);
  return 0.95;
})();

// DLL_WARN_80PCT: alert-only band between the 67% halt and the 95% force-close.
// At 80% a family-grade warning fires once per session (in kill-switch.ts Layer 2).
// Does NOT halt or reduce size on its own — the 67% halt has already fired.
// Exported here alongside peer DLL threshold constants for auditability.
export const DLL_WARN_80PCT = (() => {
  const envVal = process.env["DLL_WARN_80PCT"];
  if (envVal && !isNaN(parseFloat(envVal))) return parseFloat(envVal);
  return 0.80;
})();

// DLL_REDUCE_SIZE_PCT: SOFT band BELOW the halt — at this fraction of personal DLL, new entries
// are sized DOWN (not blocked) to absorb a losing streak before the hard 67% halt. Completes the
// institutional 60/80/90/100 escalation ladder (NexusFi Operations Manual 2026-06; a 60% band is
// math, not paranoia — a $50K Topstep tolerates ~2.5 max-loss days). Default 60%.
export const DLL_REDUCE_SIZE_PCT = (() => {
  const envVal = process.env["DLL_REDUCE_SIZE_PCT"];
  if (envVal && !isNaN(parseFloat(envVal))) return parseFloat(envVal);
  return 0.60;
})();

// DLL_REDUCE_SIZE_FACTOR: size multiplier applied when in the reduce_size band (default 0.50 = half).
export const DLL_REDUCE_SIZE_FACTOR = (() => {
  const envVal = process.env["DLL_REDUCE_SIZE_FACTOR"];
  if (envVal && !isNaN(parseFloat(envVal))) {
    const v = parseFloat(envVal);
    if (v > 0 && v <= 1) return v;   // clamp to (0,1] — a reduce factor must shrink, never zero/grow
  }
  return 0.50;
})();

export interface CrossSymbolDllResult {
  /** none — within limits; reduce_size — soft 60% band (size down, don't block); halt — 67%; force_close — 95% */
  action: "none" | "reduce_size" | "halt" | "force_close";
  combinedPnL: number;
  dllPct: number;   // fraction of personal DLL consumed (negative = loss, positive = gain)
  reduceThreshold: number;
  reduceSizeFactor: number;   // multiplier to apply to new-entry contracts when action === "reduce_size"
  haltThreshold: number;
  forceCloseThreshold: number;
  pnLBySymbol: Record<string, number>;
  /** deep-scan 2026-07-11 HIGH: propagated from AccountSessionPnL.degraded — fail-closed callers halt. */
  degraded?: boolean;
}

/**
 * Check combined P&L against cross-symbol DLL thresholds.
 * Pure function — no DB access.
 */
export function evaluateCrossSymbolDll(
  pnl: AccountSessionPnL,
  personalDllDollars: number = DEFAULT_PERSONAL_DLL_DOLLARS,
): CrossSymbolDllResult {
  const reduceThreshold = personalDllDollars * DLL_REDUCE_SIZE_PCT;
  const haltThreshold = personalDllDollars * DLL_HALT_PCT;
  const forceCloseThreshold = personalDllDollars * DLL_FORCE_CLOSE_PCT;

  // Only drawdown (negative P&L) is relevant for DLL.
  // A positive combined P&L never triggers a halt.
  const drawdown = pnl.totalPnL < 0 ? Math.abs(pnl.totalPnL) : 0;
  const dllPct = personalDllDollars > 0 ? drawdown / personalDllDollars : 0;

  // Escalation ladder (highest band wins): force_close (95%) > halt (67%) > reduce_size (60%) > none.
  let action: CrossSymbolDllResult["action"] = "none";
  if (drawdown >= forceCloseThreshold) {
    action = "force_close";
  } else if (drawdown >= haltThreshold) {
    action = "halt";
  } else if (drawdown >= reduceThreshold) {
    action = "reduce_size";
  }

  return {
    action,
    combinedPnL: pnl.totalPnL,
    dllPct,
    reduceThreshold,
    reduceSizeFactor: DLL_REDUCE_SIZE_FACTOR,
    haltThreshold,
    forceCloseThreshold,
    pnLBySymbol: pnl.pnLBySymbol,
    // Propagate the degraded signal so fail-CLOSED callers can block on unknown P&L (action stays
    // computed from totalPnL so fail-OPEN callers are unaffected — the decision is theirs to make).
    degraded: pnl.degraded ?? false,
  };
}

// ─── A-2 (deepscan17, 2026-07-05): account_key uniqueness sanity check ────────
//
// resolveAccountKey() silently falls back to firmId when config.account_key is
// unset, re-merging accounts that were supposed to be isolated (the exact bug
// C-1 fixed above). A firm with 2+ real broker accounts but <2 distinct
// account_key values in its active sessions means the operator has NOT opted
// the second account into config.account_key yet — DLL isolation is silently
// INACTIVE for that firm today, and nothing currently surfaces that fact.

export interface AccountKeyUniquenessWarning {
  firmId: string;
  distinctBrokerAccounts: number;
  distinctActiveAccountKeys: number;
}

/**
 * Pure comparison function — callers supply already-queried counts so this is
 * trivially unit-testable without a DB round-trip. WARN when a firm has >=2
 * broker accounts but <2 distinct account_key values across its active sessions.
 */
export function checkAccountKeyUniquenessSanity(
  brokerAccountCountsByFirm: Record<string, number>,
  activeAccountKeysByFirm: Record<string, Set<string>>,
): AccountKeyUniquenessWarning[] {
  const warnings: AccountKeyUniquenessWarning[] = [];
  for (const [firmId, brokerAccountCount] of Object.entries(brokerAccountCountsByFirm)) {
    const distinctKeys = activeAccountKeysByFirm[firmId]?.size ?? 0;
    if (brokerAccountCount >= 2 && distinctKeys < 2) {
      warnings.push({ firmId, distinctBrokerAccounts: brokerAccountCount, distinctActiveAccountKeys: distinctKeys });
    }
  }
  return warnings;
}

/**
 * Live DB-backed wrapper around checkAccountKeyUniquenessSanity().
 *
 * deepscan18 (2026-07-05) C-C3 correction: this docstring previously read "NOT
 * wired to a scheduler in this fix wave" (true at deepscan17 Wave 1 time). It
 * WAS subsequently wired in deepscan17 Wave 2 — see scheduler.ts's
 * `registerJob("account-key-uniqueness-sanity", ...)` (daily, 24h interval,
 * pinned to 7:37 AM ET via the `cron.schedule("37 11,12 * * *", ...)` DST-aware
 * guard). Verified live at deepscan18 audit time — this is genuinely wired,
 * not a dangling TODO. Fail-open: a DB error logs and returns [] rather than
 * blocking anything (this is a sanity WARN, never a trading gate).
 */
export async function runAccountKeyUniquenessSanityCheck(): Promise<AccountKeyUniquenessWarning[]> {
  try {
    const { db } = await import("../db/index.js");
    const { brokerAccounts, paperSessions } = await import("../db/schema.js");
    const { eq, inArray } = await import("drizzle-orm");

    const brokerRows = await db
      .select({ firmId: brokerAccounts.firmId })
      .from(brokerAccounts)
      .where(eq(brokerAccounts.enabled, true));

    const brokerAccountCountsByFirm: Record<string, number> = {};
    for (const row of brokerRows) {
      const firmId = row.firmId ?? "default";
      brokerAccountCountsByFirm[firmId] = (brokerAccountCountsByFirm[firmId] ?? 0) + 1;
    }

    const sessionRows = await db
      .select({ firmId: paperSessions.firmId, config: paperSessions.config })
      .from(paperSessions)
      .where(inArray(paperSessions.status, [...DLL_AGGREGATE_SESSION_STATUSES]));

    const activeAccountKeysByFirm: Record<string, Set<string>> = {};
    for (const session of sessionRows) {
      const firmId = session.firmId ?? "default";
      const key = resolveAccountKey(session);
      (activeAccountKeysByFirm[firmId] ??= new Set()).add(key);
    }

    const warnings = checkAccountKeyUniquenessSanity(brokerAccountCountsByFirm, activeAccountKeysByFirm);
    for (const w of warnings) {
      logger.warn(
        { ...w },
        "cross-symbol-pnl A-2: firm has multiple broker accounts but <2 distinct config.account_key values in active sessions — DLL isolation may be INACTIVE for this firm's second account (deepscan17, 2026-07-05)",
      );
    }
    return warnings;
  } catch (err) {
    logger.warn({ err }, "cross-symbol-pnl A-2: uniqueness sanity check failed — fail-open, no warnings emitted");
    return [];
  }
}
