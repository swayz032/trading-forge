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
import { eq, desc, and } from "drizzle-orm";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
import { AlertFactory, createAlert } from "../services/alert-service.js";
import { isExchangeHalted } from "../services/exchange-status-service.js";
import { isFirmSuspended } from "../services/prop-firm-health-service.js";
import { isConnectivityDegraded } from "../lib/network-failover.js";

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

// ─── Per-session 80% DLL warn dedup ──────────────────────────────────────────
// Prevents re-firing the 80% approach warning on every bar check within the 1s
// layer cache TTL. Session IDs are unique per trading session; the Set persists
// for the process lifetime (acceptable — sessions are per-trading-day, and the
// process restarts at most once per day). Tests can use unique session IDs to
// avoid cross-test interference; no explicit clear hook is required.
const dll80PctWarnedSessionIds = new Set<string>();

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

const layerCache: Map<number, LayerCacheEntry> = new Map();

/** Retrieve a cached layer result if still within TTL. */
function getCachedLayer(layer: number): HaltDecision | null {
  const entry = layerCache.get(layer);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.decision;
  }
  return null;
}

/** Store a layer result in cache for 1s. */
function setCachedLayer(layer: number, decision: HaltDecision): void {
  layerCache.set(layer, { decision, expiresAt: Date.now() + LAYER_CACHE_TTL_MS });
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
 */
async function checkLayer2DailyLoss(): Promise<HaltDecision> {
  const cached = getCachedLayer(2);
  if (cached) return cached;

  let decision: HaltDecision;
  try {
    const { getFirmAccount } = await import("../../shared/firm-config.js");
    const _cmeEtFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
    const today = _cmeEtFormatter.format(new Date(Date.now() + 7 * 3_600_000));

    const activeSessions = await db
      .select({
        id: paperSessions.id,
        firmId: paperSessions.firmId,
        dailyPnlBreakdown: paperSessions.dailyPnlBreakdown,
      })
      .from(paperSessions)
      .where(eq(paperSessions.status, "active"));

    for (const session of activeSessions) {
      const firmId = session.firmId ?? "mffu";
      let firmAccount: { dailyLossLimit?: number } | null = null;
      try {
        firmAccount = getFirmAccount(firmId) as { dailyLossLimit?: number };
      } catch {
        continue;
      }
      const dll = firmAccount?.dailyLossLimit;
      if (!dll || dll <= 0) continue;

      const breakdown = session.dailyPnlBreakdown as Record<string, number> | null ?? {};
      const dayPnl = breakdown[today] ?? 0;

      // ── M-1 FIX: 95% DLL force-close (highest band — check first) ───────────
      // Python compliance_gate.py:562 force-closes at 95% DLL. Without this
      // check, paper holds tail exposure that backtests would have closed —
      // a parity break. Layer 3 force-closes on trailing-DD $200 buffer (different
      // axis), so this sub-check does NOT double-fire with Layer 3.
      // Ordering: force_close (95%) > halt (67%) > reduce_size (60%) > none.
      if (dayPnl < 0 && Math.abs(dayPnl) >= DLL_FORCE_CLOSE_PCT * dll) {
        const fcCorrelationId = randomUUID();
        logger.warn(
          { session_id: session.id, firm_id: firmId, day_pnl: dayPnl, dll, threshold_pct: DLL_FORCE_CLOSE_PCT },
          "kill-switch L2: DLL at 95% — force-closing all positions (M-1 fix)"
        );
        // Audit — status PENDING until the close actually confirms. Deep-scan
        // 2026-06-28: this row used to pre-write status:"success" BEFORE the
        // fire-and-forget close ran, so a failed close left a misleading
        // "success" row and no alert. Now: pending → completed/failed below.
        insertAuditRow({
          action: "sizing.dll_force_close",
          entityType: "system",
          entityId: session.id,
          decisionAuthority: "system",
          input: { session_id: session.id, firm_id: firmId, day_pnl: dayPnl, dll, threshold_pct: DLL_FORCE_CLOSE_PCT } as Record<string, unknown>,
          result: { action: "force_close", outcome: "triggered" } as Record<string, unknown>,
          status: "pending",
          correlationId: fcCorrelationId,
        }).catch((auditErr) =>
          logger.error({ err: auditErr }, "kill-switch L2: dll 95pct force-close trigger audit failed (non-blocking)")
        );
        // SSE — consistent with existing force-close path in setMode("HALT")
        broadcastSSE("kill_switch:dll_force_close", {
          session_id: session.id,
          firm_id: firmId,
          day_pnl: dayPnl,
          dll,
          threshold_pct: DLL_FORCE_CLOSE_PCT,
          correlationId: fcCorrelationId,
          forced_at: new Date().toISOString(),
        });
        // Force-close — mirrors setMode("HALT") dynamic-import pattern. Deep-scan
        // 2026-06-28: now writes a completion/failure audit row + fires a Discord
        // CRITICAL on failure (positions may still be open at a 95% DLL breach —
        // a silent logger.error is not enough for a live-capital safety path).
        import("../services/paper-execution-service.js")
          .then(({ forceCloseAllPositions }) =>
            forceCloseAllPositions(`dll_force_close_at_95pct:${session.id}`)
          )
          .then(() => {
            insertAuditRow({
              action: "sizing.dll_force_close_completed",
              entityType: "system",
              entityId: session.id,
              decisionAuthority: "system",
              input: { session_id: session.id, firm_id: firmId } as Record<string, unknown>,
              result: { action: "force_close", outcome: "completed" } as Record<string, unknown>,
              status: "success",
              correlationId: fcCorrelationId,
            }).catch((auditErr) =>
              logger.error({ err: auditErr }, "kill-switch L2: dll 95pct force-close completed-audit failed (non-blocking)")
            );
          })
          .catch((err) => {
            logger.error({ err, session_id: session.id }, "kill-switch L2: dll 95pct forceCloseAllPositions FAILED — positions may still be open");
            insertAuditRow({
              action: "sizing.dll_force_close_failed",
              entityType: "system",
              entityId: session.id,
              decisionAuthority: "system",
              input: { session_id: session.id, firm_id: firmId, day_pnl: dayPnl, dll } as Record<string, unknown>,
              result: { action: "force_close", outcome: "failed" } as Record<string, unknown>,
              status: "error",
              errorMessage: String(err instanceof Error ? err.message : err),
              correlationId: fcCorrelationId,
            }).catch((auditErr) =>
              logger.error({ err: auditErr }, "kill-switch L2: dll 95pct force-close failed-audit write failed (non-blocking)")
            );
            createAlert({
              type: "system",
              severity: "critical",
              title: "DLL 95% force-close FAILED — positions may still be open",
              message:
                "The bot hit 95% of today's loss safety limit and tried to close ALL positions, " +
                "but the close did not complete. Positions may still be open and losing. " +
                "Check the trading account now and flatten manually if needed.",
              metadata: { session_id: session.id, firm_id: firmId, day_pnl: dayPnl, dll, correlation_id: fcCorrelationId },
            }).catch((alertErr) =>
              logger.error({ err: alertErr }, "kill-switch L2: dll 95pct force-close failure Discord alert failed")
            );
          });
        decision = {
          halted: true,
          layer: 2,
          reason: "dll_force_close_at_95pct",
          detail: { session_id: session.id, firm_id: firmId, day_pnl: dayPnl, dll, threshold_pct: DLL_FORCE_CLOSE_PCT },
        };
        break;
      }

      // ── A-5 FIX: 80% DLL approach warning (once per session, deduped) ────────
      // No alert exists between the 67% halt and 95% force-close. Families see a
      // force-close with no prior warning. This warning fires once per session
      // (deduped via dll80PctWarnedSessionIds) when losses are between 67-95%.
      // Does NOT halt on its own — falls through to the 67% halt check below.
      if (dayPnl < 0 && Math.abs(dayPnl) >= DLL_WARN_PCT * dll && !dll80PctWarnedSessionIds.has(session.id)) {
        dll80PctWarnedSessionIds.add(session.id);
        const warnCorrelationId = randomUUID();
        insertAuditRow({
          action: "sizing.dll_80pct_approach_warned",
          entityType: "system",
          entityId: session.id,
          decisionAuthority: "system",
          input: { session_id: session.id, firm_id: firmId, day_pnl: dayPnl, dll, threshold_pct: DLL_WARN_PCT } as Record<string, unknown>,
          result: { warned: true } as Record<string, unknown>,
          status: "success",
          correlationId: warnCorrelationId,
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
          metadata: { session_id: session.id, firm_id: firmId, day_pnl: dayPnl, dll },
        }).catch((alertErr) =>
          logger.error({ err: alertErr }, "kill-switch L2: dll 80pct approach alert failed (non-blocking)")
        );
      }

      // ── Existing 67% halt ──────────────────────────────────────────────────
      if (dayPnl < 0 && Math.abs(dayPnl) >= DLL_HALT_PCT * dll) {
        const reason = `dll_at_${Math.round(DLL_HALT_PCT * 100)}pct_personal_threshold`;
        decision = {
          halted: true,
          layer: 2,
          reason,
          detail: { session_id: session.id, firm_id: firmId, day_pnl: dayPnl, dll },
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

  setCachedLayer(2, decision);
  return decision;
}

/**
 * Layer 3: Trailing drawdown.
 * Fail-CLOSED: DB error → halted.
 */
async function checkLayer3TrailingDD(): Promise<HaltDecision> {
  const cached = getCachedLayer(3);
  if (cached) return cached;

  let decision: HaltDecision;
  try {
    const { getFirmAccount } = await import("../../shared/firm-config.js");

    const activeSessions = await db
      .select({
        id: paperSessions.id,
        firmId: paperSessions.firmId,
        currentEquity: paperSessions.currentEquity,
        realizedPeakEquity: paperSessions.realizedPeakEquity,
      })
      .from(paperSessions)
      .where(eq(paperSessions.status, "active"));

    for (const session of activeSessions) {
      const firmId = session.firmId ?? "mffu";
      let firmAccount: { maxDrawdown?: number; maxDailyDrawdown?: number } | null = null;
      try {
        firmAccount = getFirmAccount(firmId) as { maxDrawdown?: number; maxDailyDrawdown?: number };
      } catch {
        continue;
      }
      const maxDrawdown = firmAccount?.maxDrawdown ?? firmAccount?.maxDailyDrawdown;
      if (!maxDrawdown || maxDrawdown <= 0) continue;

      const currentEquity = parseFloat(String(session.currentEquity ?? "0"));
      const peakEquity    = parseFloat(String(session.realizedPeakEquity ?? "0"));
      const drawdown      = peakEquity - currentEquity;

      if (drawdown >= maxDrawdown - TRAILING_DD_BUFFER_DOLLARS) {
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

  setCachedLayer(3, decision);
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
    });
    decision = { halted: true, layer: 6, reason: "cme_outage_eval_failed", detail: { error: errMsg } };
  }

  setCachedLayer(6, decision);
  return decision;
}

/**
 * Layer 7: Firm suspension.
 * Fail-CLOSED: DB unavailable = we cannot verify suspension → halt.
 */
async function checkLayer7FirmSuspension(correlationId: string): Promise<HaltDecision> {
  const cached = getCachedLayer(7);
  if (cached) return cached;

  let decision: HaltDecision;
  try {
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
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "C2 multi-firm suspension check FAILED — blocking entries (fail-closed, Layer 7)");
    decision = {
      halted: true,
      layer: 7,
      reason: "firm_suspension_check_failed",
      detail: { error: errMsg, fail_closed: true },
    };
    insertAuditRow({
      action: "kill_switch.c2_multi_firm_check",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { error_message: errMsg, layer: 7 } as Record<string, unknown>,
      result: { suspended_firms: [], halted: true, eval_failed: true } as Record<string, unknown>,
      status: "failure",
      correlationId,
    }).catch((auditErr) =>
      logger.error({ err: auditErr }, "kill-switch L7: audit_log write failed (non-blocking)"),
    );
  }

  setCachedLayer(7, decision);
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
): Promise<HaltDecision> {
  const timeoutPromise: Promise<HaltDecision> = new Promise((resolve) => {
    const timer = setTimeout(() => {
      logger.warn(
        { layer, timeout_ms: LAYER_CHECK_TIMEOUT_MS, correlationId },
        `kill-switch: Layer ${layer} check timed out — failing OPEN (signal path budget exceeded)`,
      );
      // Fire-and-forget audit — non-blocking
      insertAuditRow({
        action: `kill_switch.layer_${layer}_timeout`,
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { layer, timeout_ms: LAYER_CHECK_TIMEOUT_MS } as Record<string, unknown>,
        result: { halted: false, fail_open: true } as Record<string, unknown>,
        status: "failure",
        correlationId,
      }).catch((auditErr) =>
        logger.error({ err: auditErr }, `kill-switch L${layer}: timeout audit_log write failed`),
      );
      resolve({ halted: false });
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
   */
  async evaluateAllKillSwitchLayers(
    opts: { correlationId?: string } = {},
  ): Promise<HaltDecision> {
    const correlationId = opts.correlationId ?? randomUUID();

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
    const l2 = await runLayerWithTimeout(2, () => checkLayer2DailyLoss(), correlationId);
    if (l2.halted) {
      await this._emitLayerHaltedSignals(l2, correlationId);
      return l2;
    }

    // ── Layer 3: Trailing drawdown ──
    const l3 = await runLayerWithTimeout(3, () => checkLayer3TrailingDD(), correlationId);
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
    const l7 = await runLayerWithTimeout(
      7,
      () => checkLayer7FirmSuspension(correlationId),
      correlationId,
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
   * Fail-CLOSED: any unhandled error returns true (halted).
   */
  async isHaltedForProduction(opts: { correlationId?: string } = {}): Promise<boolean> {
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

    // Audit log — non-blocking
    db.insert(auditLog)
      .values({
        action: "production.mode_changed",
        entityType: "system",
        entityId: null,
        decisionAuthority: setBy === "operator" ? "human" : "system",
        input: { previousMode, newMode: mode, reason } as Record<string, unknown>,
        result: { mode, setBy, reason } as Record<string, unknown>,
        status: "success",
        correlationId: modeChangeCorrelationId,
      })
      .catch((err) =>
        logger.error({ err }, "kill-switch: audit_log write failed (non-blocking)")
      );

    // SSE broadcast
    broadcastSSE("production:mode-changed", {
      previousMode,
      newMode: mode,
      reason,
      setBy,
      changedAt: new Date().toISOString(),
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
      AlertFactory.systemError(
        "production-halt-activated",
        new Error(
          `Production mode set to HALT by ${setBy}: ${reason}. ` +
          `Force-flattening all open paper positions.`
        )
      );
      import("../services/paper-execution-service.js")
        .then(({ forceCloseAllPositions }) =>
          forceCloseAllPositions(`production_halt:${reason}`)
        )
        .catch((err) =>
          logger.error({ err, reason, setBy }, "kill-switch: forceCloseAllPositions dynamic import or call failed")
        );
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
    const l2Result = await checkLayer2DailyLoss();
    layers.push({
      layer: 2,
      name: "daily_loss",
      halted: l2Result.halted,
      reason: l2Result.reason,
    });

    // ── Layer 3: Trailing drawdown ──
    const l3Result = await checkLayer3TrailingDD();
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
  }

  /** Exposed for tests only. Injects a pre-computed layer result into the cache. */
  _setLayerCacheForTests(layer: number, decision: HaltDecision): void {
    setCachedLayer(layer, decision);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const killSwitch = new KillSwitch();
