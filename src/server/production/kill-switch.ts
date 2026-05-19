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
import { systemState, auditLog, weeklyDriftReports, type ProductionMode } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
import { AlertFactory } from "../services/alert-service.js";
import { isExchangeHalted } from "../services/exchange-status-service.js";
import { isFirmSuspended } from "../services/prop-firm-health-service.js";
import { isConnectivityDegraded } from "../lib/network-failover.js";

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

    // ── Layer 2: Daily loss ── (Phase 4C wires real PnL check)
    layers.push({
      layer: 2,
      name: "daily_loss",
      halted: false,
      reason: "phase_4c_pending: paper-execution-service DLL check not yet wired to kill-switch",
    });

    // ── Layer 3: Trailing drawdown ── (Phase 4C wires real drawdown check)
    layers.push({
      layer: 3,
      name: "trailing_drawdown",
      halted: false,
      reason: "phase_4c_pending: drawdown distance check not yet wired to kill-switch",
    });

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
    let l6Halted = false;
    try {
      l6Halted = isExchangeHalted("CME");
    } catch {
      l6Halted = false;
    }
    layers.push({
      layer: 6,
      name: "cme_outage",
      halted: l6Halted,
      reason: l6Halted ? "exchange-status: CME outage active" : undefined,
    });

    // ── Layer 7: Firm suspension ──
    // Check for the primary firm (MFFU). Phase 4C can expand to check all active firms.
    let l7Halted = false;
    let l7Reason: string | undefined;
    try {
      // Check the primary trading firm
      const primaryFirm = process.env["PRIMARY_PROP_FIRM_ID"] ?? "mffu";
      if (isFirmSuspended(primaryFirm)) {
        l7Halted = true;
        l7Reason = `prop-firm-health: ${primaryFirm} suspended`;
      }
    } catch {
      l7Halted = false;
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
