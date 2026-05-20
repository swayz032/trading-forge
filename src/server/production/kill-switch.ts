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

import { db } from "../db/index.js";
import { systemState, auditLog, weeklyDriftReports, brokerAccounts, paperSessions, type ProductionMode } from "../db/schema.js";
import { eq, desc, and } from "drizzle-orm";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
import { AlertFactory } from "../services/alert-service.js";
import { isExchangeHalted } from "../services/exchange-status-service.js";
import { isFirmSuspended } from "../services/prop-firm-health-service.js";
import { isConnectivityDegraded } from "../lib/network-failover.js";

// ─── DLL / trailing-DD thresholds (match paper-execution-service) ─────────────
const DLL_HALT_PCT        = parseFloat(process.env.DLL_HALT_PCT        ?? "0.67");
const DLL_FORCE_CLOSE_PCT = parseFloat(process.env.DLL_FORCE_CLOSE_PCT ?? "0.95");
const TRAILING_DD_BUFFER_DOLLARS = 200; // force-close trigger: $200 inside max drawdown

// Lazy imports to avoid circular init issues. These services start their own
// timers at module load; we only need their query functions here.
async function getMacroGateResult(): Promise<{ crisis_gate_triggered: boolean }> {
  try {
    const { evaluateMacroGates } = await import("../services/macro-gate-service.js");
    const result = await evaluateMacroGates("MES");
    return { crisis_gate_triggered: result.crisisGateTriggered ?? false };
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

// ─── Types ────────────────────────────────────────────────────────────────────

export type { ProductionMode };

export interface SystemState {
  production_mode: ProductionMode;
  kill_reason: string | null;
  set_by: string;
  set_at: Date;
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

// ─── KillSwitch ───────────────────────────────────────────────────────────────

class KillSwitch {
  private cache: { state: SystemState; lastCheck: number } | null = null;
  private readonly CACHE_TTL_MS = 5_000;

  // ── Core mode read ────────────────────────────────────────────────────────

  /**
   * Returns true when production trading should be blocked.
   * Fail-CLOSED: DB error → returns true (halted). Never returns undefined.
   * Cache hit within 5s TTL → sub-1ms. DB read → sub-10ms.
   */
  async isHaltedForProduction(): Promise<boolean> {
    try {
      const state = await this.getCurrentState();
      return state.production_mode === "HALT";
    } catch (err) {
      logger.error({ err }, "kill-switch: DB error reading system_state — failing CLOSED (halted)");
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

    // Invalidate cache
    this.cache = null;

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
        correlationId: null,
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
    // kill-switch.ts (production/) cannot statically import paper-execution-service
    // (services/) — that would create production/ → services/ → production/ cycle.
    // Dynamic import at call time breaks the cycle while preserving the wiring.
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
      // Non-blocking: fire-and-forget so setMode() returns promptly.
      // Errors are logged inside forceCloseAllPositions; they do not affect
      // the mode-change result (mode is already committed to DB above).
      import("../services/paper-execution-service.js")
        .then(({ forceCloseAllPositions }) =>
          forceCloseAllPositions(`production_halt:${reason}`)
        )
        .catch((err) =>
          logger.error({ err, reason, setBy }, "kill-switch: forceCloseAllPositions dynamic import or call failed")
        );
    }
  }

  // ── 9-Layer Status ────────────────────────────────────────────────────────

  /**
   * Returns the status of all 9 kill switch layers independently.
   * Each layer is evaluated in isolation — failure of one layer's check
   * does not prevent others from reporting.
   *
   * This is the Phase 4B input for GET /api/production/status.
   * Layers 2-3 (daily loss, trailing drawdown) require the Phase 4C
   * paper-execution-service integration to produce real values; until
   * then they report not_halted with a note.
   */
  async getKillSwitchStatus(): Promise<KillSwitchStatusReport> {
    const checkedAt = new Date();
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
    // Query all active sessions. If any session's today-P&L has exceeded
    // DLL_HALT_PCT of its firm's daily loss limit → halt new entries.
    // Fail-CLOSED: DB error → halted so a crashed DB cannot bypass the gate.
    let l2Halted = false;
    let l2Reason: string | undefined;
    try {
      const { getFirmAccount } = await import("../../shared/firm-config.js");
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD UTC

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
          // unknown firmId — skip
          continue;
        }
        const dll = firmAccount?.dailyLossLimit;
        if (!dll || dll <= 0) continue;

        // dailyPnlBreakdown is a JSON object keyed by trading-day string → number
        const breakdown = session.dailyPnlBreakdown as Record<string, number> | null ?? {};
        const dayPnl = breakdown[today] ?? 0;

        // dayPnl is negative when losing; compare magnitude against DLL
        if (dayPnl < 0 && Math.abs(dayPnl) >= DLL_HALT_PCT * dll) {
          l2Halted = true;
          l2Reason = `dll_at_${Math.round(DLL_HALT_PCT * 100)}pct_personal_threshold: session=${session.id} firm=${firmId} day_pnl=${dayPnl.toFixed(2)} dll=${dll}`;
          break;
        }
      }
    } catch (l2Err) {
      l2Halted = true; // fail-CLOSED
      const errMsg = l2Err instanceof Error ? l2Err.message : String(l2Err);
      logger.error({ err: l2Err }, "kill-switch L2: DLL check failed — blocking entries (fail-closed)");
      l2Reason = `dll_check_failed (fail-closed): ${errMsg}`;
    }
    layers.push({ layer: 2, name: "daily_loss", halted: l2Halted, reason: l2Reason });

    // ── Layer 3: Trailing drawdown ──
    // Query all active sessions. If (realizedPeakEquity - currentEquity) is within
    // $200 of the firm's maxDrawdown → trigger force-close (95% threshold).
    // Fail-CLOSED: DB error → halted.
    let l3Halted = false;
    let l3Reason: string | undefined;
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

        // Trigger when drawdown has consumed 95%+ of the max-drawdown budget
        // i.e. remaining buffer < $200 (TRAILING_DD_BUFFER_DOLLARS)
        if (drawdown >= maxDrawdown - TRAILING_DD_BUFFER_DOLLARS) {
          l3Halted = true;
          l3Reason = `trailing_dd_force_close_at_95pct: session=${session.id} firm=${firmId} drawdown=${drawdown.toFixed(2)} max_dd=${maxDrawdown} buffer_remaining=${(maxDrawdown - drawdown).toFixed(2)}`;
          break;
        }
      }
    } catch (l3Err) {
      l3Halted = true; // fail-CLOSED
      const errMsg = l3Err instanceof Error ? l3Err.message : String(l3Err);
      logger.error({ err: l3Err }, "kill-switch L3: trailing-DD check failed — blocking entries (fail-closed)");
      l3Reason = `trailing_dd_check_failed (fail-closed): ${errMsg}`;
    }
    layers.push({ layer: 3, name: "trailing_drawdown", halted: l3Halted, reason: l3Reason });

    // ── Layer 4: Connectivity ──
    let l4Halted = false;
    try {
      l4Halted = isConnectivityDegraded();
    } catch {
      l4Halted = false;
    }
    layers.push({
      layer: 4,
      name: "connectivity",
      halted: l4Halted,
      reason: l4Halted ? "network_failover: connectivity degraded" : undefined,
    });

    // ── Layer 5: Drift ──
    let l5Halted = false;
    let l5Reason: string | undefined;
    try {
      const driftRows = await db
        .select({ severity: weeklyDriftReports.severity, reportWeek: weeklyDriftReports.reportWeek })
        .from(weeklyDriftReports)
        .orderBy(desc(weeklyDriftReports.ranAt))
        .limit(1);
      if (driftRows.length > 0 && driftRows[0].severity === "red") {
        l5Halted = true;
        l5Reason = `weekly_drift: severity=red for week ${driftRows[0].reportWeek}`;
      }
    } catch {
      l5Halted = false; // fail-open for status (drift detector is advisory until Phase 4B)
    }
    layers.push({ layer: 5, name: "drift", halted: l5Halted, reason: l5Reason });

    // ── Layer 6: CME outage ──
    // C1 fail-CLOSED: if isExchangeHalted() throws (poller crash, import error),
    // we cannot determine outage status → block entries (Wave 23H Fix 1).
    let l6Halted = false;
    try {
      l6Halted = isExchangeHalted("CME");
    } catch (l6Err) {
      l6Halted = true; // fail-CLOSED: unknown outage state = halt
      const errMsg = l6Err instanceof Error ? l6Err.message : String(l6Err);
      logger.error(
        { err: l6Err },
        "C1 CME outage eval FAILED — blocking entries (fail-closed, Layer 6)",
      );
      // Audit row — fire-and-forget (non-blocking)
      insertAuditRow({
        action: "kill_switch.c1_cme_outage_eval_failed",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { error_message: errMsg, layer: 6 } as Record<string, unknown>,
        result: { l6Halted: true } as Record<string, unknown>,
        status: "failure",
        correlationId: null,
      }).catch((auditErr) =>
        logger.error({ err: auditErr }, "kill-switch L6: audit_log write failed (non-blocking)"),
      );
      // SSE so dashboard surfaces the eval failure immediately
      broadcastSSE("kill_switch:c1_cme_eval_failed", {
        error_message: errMsg,
        layer: 6,
        halted: true,
        timestamp: new Date().toISOString(),
      });
    }
    layers.push({
      layer: 6,
      name: "cme_outage",
      halted: l6Halted,
      reason: l6Halted ? "exchange-status: CME outage active" : undefined,
    });

    // ── Layer 7: Firm suspension ──
    // C2 multi-firm: query ALL enabled broker_accounts and check each firmId.
    // If ANY firm is suspended → halt. Fail-CLOSED on DB error so a crashed
    // DB cannot be used to bypass the suspension gate (Wave 23H Fix 2).
    let l7Halted = false;
    let l7Reason: string | undefined;
    try {
      const enabledAccounts = await db
        .select({ firmId: brokerAccounts.firmId })
        .from(brokerAccounts)
        .where(eq(brokerAccounts.enabled, true));

      // Deduplicate firm IDs (one firm may have multiple accounts)
      const firmsChecked = [...new Set(enabledAccounts.map((r) => r.firmId))];
      const suspendedFirms = firmsChecked.filter((firmId) => isFirmSuspended(firmId));

      if (suspendedFirms.length > 0) {
        l7Halted = true;
        l7Reason = `prop-firm-health: suspended firms: ${suspendedFirms.join(", ")}`;
      }

      // Audit row for every evaluation (non-blocking)
      insertAuditRow({
        action: "kill_switch.c2_multi_firm_check",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { firms_checked: firmsChecked } as Record<string, unknown>,
        result: { suspended_firms: suspendedFirms, halted: l7Halted } as Record<string, unknown>,
        status: "success",
        correlationId: null,
      }).catch((auditErr) =>
        logger.error({ err: auditErr }, "kill-switch L7: audit_log write failed (non-blocking)"),
      );
    } catch (l7Err) {
      // Fail-CLOSED: DB unavailable = we cannot verify suspension state → halt
      l7Halted = true;
      const errMsg = l7Err instanceof Error ? l7Err.message : String(l7Err);
      logger.error(
        { err: l7Err },
        "C2 multi-firm suspension check FAILED — blocking entries (fail-closed, Layer 7)",
      );
      l7Reason = `prop-firm-health: multi-firm check failed (fail-closed): ${errMsg}`;
      insertAuditRow({
        action: "kill_switch.c2_multi_firm_check",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { error_message: errMsg, layer: 7 } as Record<string, unknown>,
        result: { suspended_firms: [], halted: true, eval_failed: true } as Record<string, unknown>,
        status: "failure",
        correlationId: null,
      }).catch((auditErr) =>
        logger.error({ err: auditErr }, "kill-switch L7: audit_log write failed (non-blocking)"),
      );
    }
    layers.push({ layer: 7, name: "firm_suspension", halted: l7Halted, reason: l7Reason });

    // ── Layer 8: Macro crisis ──
    let l8Halted = false;
    let l8Reason: string | undefined;
    try {
      const macro = await getMacroGateResult();
      if (macro.crisis_gate_triggered) {
        l8Halted = true;
        l8Reason = "macro-gate: crisis_gate_triggered (prob_crisis > 0.60)";
      }
    } catch {
      l8Halted = false;
    }
    layers.push({ layer: 8, name: "macro_crisis", halted: l8Halted, reason: l8Reason });

    // ── Layer 9: Windows reboot pending ──
    let l9Halted = false;
    let l9Reason: string | undefined;
    try {
      const windowsOk = await getWindowsHealthOk();
      if (!windowsOk) {
        l9Halted = true;
        l9Reason = "windows-health: reboot pending or health check failed";
      }
    } catch {
      l9Halted = false;
    }
    layers.push({
      layer: 9,
      name: "windows_reboot_pending",
      halted: l9Halted,
      reason: l9Reason,
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
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const killSwitch = new KillSwitch();
