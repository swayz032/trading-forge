/**
 * Shadow Service — Log shadow signals and detect divergence.
 *
 * Shadow mode generates signals without execution, comparing expected vs actual.
 */

import { db } from "../db/index.js";
import { shadowSignals } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";

interface ShadowSignalInput {
  sessionId: string;
  signalTime: Date;
  direction: "long" | "short";
  expectedEntry: number;
  expectedExit?: number;
  actualMarketPrice?: number;
  wouldHaveFilled?: boolean;
  theoreticalPnl?: number;
  modelSlippage?: number;
  actualSlippage?: number;
  correlationId?: string | null; // propagated from the signal evaluation path
}

export async function logShadowSignal(input: ShadowSignalInput): Promise<void> {
  const wouldFill = input.actualMarketPrice != null && input.expectedEntry != null
    ? Math.abs(input.actualMarketPrice - input.expectedEntry) / input.expectedEntry < 0.005
    : null;

  try {
    await db.insert(shadowSignals).values({
      sessionId: input.sessionId,
      signalTime: input.signalTime,
      direction: input.direction,
      expectedEntry: String(input.expectedEntry),
      expectedExit: input.expectedExit != null ? String(input.expectedExit) : null,
      actualMarketPrice: input.actualMarketPrice != null ? String(input.actualMarketPrice) : null,
      // SHADOW invariant: traderspost_webhook_called must NEVER be true in shadow rows.
      // wouldHaveFilled reflects fill probability analysis only — not actual execution.
      wouldHaveFilled: input.wouldHaveFilled ?? wouldFill,
      theoreticalPnl: input.theoreticalPnl != null ? String(input.theoreticalPnl) : null,
      modelSlippage: input.modelSlippage != null ? String(input.modelSlippage) : null,
      actualSlippage: input.actualSlippage != null ? String(input.actualSlippage) : null,
    });

    // Emit success audit row so the shadow signal is visible in audit_log with correlationId.
    await insertAuditRowSafe({
      action: "signal.shadow_logged",
      entityType: "paper_session",
      entityId: input.sessionId,
      decisionAuthority: "system",
      status: "info",
      input: {
        direction: input.direction,
        expectedEntry: input.expectedEntry,
        signalTime: input.signalTime.toISOString(),
      } as Record<string, unknown>,
      result: {
        wouldHaveFilled: input.wouldHaveFilled ?? wouldFill,
        traderspost_webhook_called: false, // SHADOW invariant
      } as Record<string, unknown>,
      correlationId: input.correlationId ?? null,
    });
  } catch (err) {
    // Fail-soft: DB error must NOT throw into the signal-evaluation caller.
    // Log the error and emit an audit row for the failure path so the gap is visible.
    logger.error(
      { err, sessionId: input.sessionId, direction: input.direction, correlationId: input.correlationId },
      "shadow-service: logShadowSignal insert failed — fail-soft, caller not thrown",
    );

    // Fire-and-forget audit for the failure: insertAuditRowSafe is already fail-soft.
    await insertAuditRowSafe({
      action: "lifecycle.shadow_signal_log_failed",
      entityType: "paper_session",
      entityId: input.sessionId,
      decisionAuthority: "system",
      status: "error",
      input: {
        direction: input.direction,
        expectedEntry: input.expectedEntry,
        signalTime: input.signalTime.toISOString(),
      } as Record<string, unknown>,
      result: {
        error: err instanceof Error ? err.message : String(err),
        traderspost_webhook_called: false, // SHADOW invariant preserved even on failure
      } as Record<string, unknown>,
      correlationId: input.correlationId ?? null,
    });
  }
}

export async function getShadowReport(sessionId: string) {
  const signals = await db
    .select()
    .from(shadowSignals)
    .where(eq(shadowSignals.sessionId, sessionId))
    .orderBy(desc(shadowSignals.signalTime));

  if (signals.length === 0) {
    return {
      session_id: sessionId,
      total_signals: 0,
      message: "No shadow signals recorded yet.",
    };
  }

  const filled = signals.filter((s) => s.wouldHaveFilled === true);
  const fillRate = signals.length > 0 ? filled.length / signals.length : 0;

  const pnls = signals
    .map((s) => parseFloat(String(s.theoreticalPnl ?? "0")))
    .filter((v) => !isNaN(v));
  const totalPnl = pnls.reduce((s, v) => s + v, 0);

  const slippages = signals
    .filter((s) => s.modelSlippage != null && s.actualSlippage != null)
    .map((s) => ({
      model: parseFloat(String(s.modelSlippage)),
      actual: parseFloat(String(s.actualSlippage)),
    }));

  const avgModelSlippage = slippages.length > 0
    ? slippages.reduce((s, v) => s + v.model, 0) / slippages.length
    : null;
  const avgActualSlippage = slippages.length > 0
    ? slippages.reduce((s, v) => s + v.actual, 0) / slippages.length
    : null;

  // Divergence: if actual slippage > 2x model slippage
  const slippageDrift = avgModelSlippage != null && avgActualSlippage != null
    ? avgActualSlippage / Math.max(avgModelSlippage, 0.01)
    : null;

  const divergenceDetected = slippageDrift != null && slippageDrift > 2.0;

  return {
    session_id: sessionId,
    total_signals: signals.length,
    fill_rate: Math.round(fillRate * 1000) / 1000,
    theoretical_pnl: Math.round(totalPnl * 100) / 100,
    avg_model_slippage: avgModelSlippage != null ? Math.round(avgModelSlippage * 100) / 100 : null,
    avg_actual_slippage: avgActualSlippage != null ? Math.round(avgActualSlippage * 100) / 100 : null,
    slippage_drift_ratio: slippageDrift != null ? Math.round(slippageDrift * 100) / 100 : null,
    divergence_detected: divergenceDetected,
    long_signals: signals.filter((s) => s.direction === "long").length,
    short_signals: signals.filter((s) => s.direction === "short").length,
  };
}
