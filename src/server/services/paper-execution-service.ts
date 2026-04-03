import { db } from "../db/index.js";
import { paperSessions, paperPositions, paperTrades, strategies, shadowSignals, auditLog, macroSnapshots, skipDecisions } from "../db/schema.js";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";
import { onPaperTradeClose } from "../scheduler.js";
import { getFirmAccount, CONTRACT_SPECS, getCommissionPerSide } from "../../shared/firm-config.js";
import { toEasternDateString } from "./paper-risk-gate.js";
import { tracer } from "../lib/tracing.js";
export { CONTRACT_SPECS };

export interface ExecutionResult {
  positionId: string;
  entryPrice: number;
  contracts: number;
  slippage: number;
  expectedPrice: number;
  actualPrice: number;
  arrivalPrice: number;
  implementationShortfall: number;
  fillRatio: number;
  filled: boolean;
}

// ─── Slippage Calculation ────────────────────────────────────

function calculateSlippage(
  symbol: string,
  baseSlippageTicks: number = 1,
  atr?: number,
  medianAtr?: number,
  orderType?: string,
  session?: string,
): number {
  const spec = CONTRACT_SPECS[symbol];
  if (!spec) return 0;

  // Variable slippage: scale with ATR (matches backtester's slippage.py)
  let slippageTicks = baseSlippageTicks;
  if (atr && medianAtr && medianAtr > 0) {
    slippageTicks = baseSlippageTicks * (atr / medianAtr);
  }

  // Order-type modifier (matches slippage.py)
  let orderMod = 1.0;
  if (orderType === "stop_market") orderMod = 2.0;
  else if (orderType === "limit") orderMod = 0.5;
  else if (orderType === "stop_limit") orderMod = 1.0;

  // Session multiplier (overnight = 2x, London = 1.5x, RTH = 1x)
  let sessionMult = 1.0;
  if (session === "OVERNIGHT" || session === "ASIAN") sessionMult = 2.0;
  else if (session === "LONDON") sessionMult = 1.5;

  return slippageTicks * orderMod * sessionMult * spec.tickSize;
}

// ─── Gap 7: Latency Simulation ───────────────────────────────

function applyLatency(signalPrice: number, symbol: string, latencyMs: number, atr?: number): number {
  if (latencyMs <= 0 || !atr || atr <= 0) return signalPrice;
  // Random walk estimate: price drifts by ATR * latency_factor during latency window
  const latencyFactor = (latencyMs / 1000) * 0.1; // 10% of ATR per second of delay
  const drift = (Math.random() * 2 - 1) * atr * latencyFactor;
  return signalPrice + drift;
}

// ─── Gap 6: Fill Probability Model ───────────────────────────

interface FillProbabilityParams {
  orderType: "market" | "limit" | "stop_limit";
  rsi?: number;
  atr?: number;
  symbol: string;
}

function computeFillProbability(params: FillProbabilityParams): number {
  if (params.orderType === "market") return 1.0;

  // RSI-based fill probability for limit orders
  // At extreme RSI (oversold/overbought), fill probability is lower
  // because price may reverse before filling
  let baseProbability = 0.75; // default
  if (params.rsi !== undefined && !isNaN(params.rsi)) {
    if (params.rsi < 20) baseProbability = 0.50;       // extreme oversold — hard to fill long limit
    else if (params.rsi < 30) baseProbability = 0.60;
    else if (params.rsi < 40) baseProbability = 0.70;
    else if (params.rsi > 80) baseProbability = 0.50;   // extreme overbought — hard to fill short limit
    else if (params.rsi > 70) baseProbability = 0.60;
    else baseProbability = 0.85;                         // normal range — likely to fill
  }

  // ATR adjustment: higher volatility = slightly better fills (more price movement)
  if (params.atr && params.atr > 0) {
    const spec = CONTRACT_SPECS[params.symbol];
    if (spec) {
      const atrTicks = params.atr / spec.tickSize;
      if (atrTicks > 40) baseProbability = Math.min(baseProbability + 0.10, 0.95);
    }
  }

  // Stop-limit: multiply by 0.85 (gap risk)
  if (params.orderType === "stop_limit") {
    baseProbability *= 0.85;
  }

  return Math.max(0.30, Math.min(0.95, baseProbability));
}

// ─── Session Classification ───────────────────────────────────

/**
 * Returns ET offset in minutes from UTC.
 * DST: second Sunday in March through first Sunday in November.
 * EDT = UTC-4 (-240 min), EST = UTC-5 (-300 min).
 */
function getEtOffsetMinutes(utcDate: Date): number {
  const year = utcDate.getUTCFullYear();
  // Second Sunday in March (DST start)
  const march1 = new Date(Date.UTC(year, 2, 1));
  const marchSunday1 = (7 - march1.getUTCDay()) % 7; // days until first Sunday
  const dstStart = new Date(Date.UTC(year, 2, 1 + marchSunday1 + 7)); // second Sunday
  // First Sunday in November (DST end)
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const novSunday1 = (7 - nov1.getUTCDay()) % 7;
  const dstEnd = new Date(Date.UTC(year, 10, 1 + novSunday1 === 0 ? 7 : novSunday1));
  return utcDate >= dstStart && utcDate < dstEnd ? -240 : -300;
}

/**
 * Classify trading session from a UTC timestamp.
 * Buckets (ET windows):
 *   ASIA       00:00–03:00 ET
 *   LONDON     03:00–09:30 ET
 *   NY_OPEN    09:30–10:30 ET
 *   NY_CORE    10:30–14:30 ET
 *   NY_CLOSE   14:30–16:00 ET
 *   OVERNIGHT  16:00–00:00 ET
 */
export function classifySessionType(utcDate: Date): string {
  const offsetMin = getEtOffsetMinutes(utcDate);
  const utcMinutes = utcDate.getUTCHours() * 60 + utcDate.getUTCMinutes();
  // Map to ET minutes-since-midnight, keeping result in [0, 1440)
  const etMinutes = ((utcMinutes + offsetMin) % 1440 + 1440) % 1440;

  if (etMinutes >= 570 && etMinutes < 630)  return "NY_OPEN";   // 09:30–10:30 ET
  if (etMinutes >= 630 && etMinutes < 870)  return "NY_CORE";   // 10:30–14:30 ET
  if (etMinutes >= 870 && etMinutes < 960)  return "NY_CLOSE";  // 14:30–16:00 ET
  if (etMinutes >= 180 && etMinutes < 570)  return "LONDON";    // 03:00–09:30 ET
  if (etMinutes >= 0   && etMinutes < 180)  return "ASIA";      // 00:00–03:00 ET
  return "OVERNIGHT";                                           // 16:00–00:00 ET
}

// ─── Open Position ───────────────────────────────────────────

export async function openPosition(sessionId: string, params: {
  symbol: string;
  side: "long" | "short";
  signalPrice: number;
  contracts: number;
  orderType?: "market" | "limit" | "stop_limit";
  rsi?: number;
  atr?: number;
}) {
  const openSpan = tracer.startSpan("paper.position_open");
  openSpan.setAttribute("symbol", params.symbol);
  openSpan.setAttribute("side", params.side);
  openSpan.setAttribute("contracts", params.contracts);

  try {
  // Get session config for latency/fill model settings
  const [session] = await db.select().from(paperSessions).where(eq(paperSessions.id, sessionId));
  if (!session) throw new Error(`Session ${sessionId} not found`);
  if (session.status !== "active") throw new Error(`Cannot open position on ${session.status} session`);
  const sessionConfig = (session.config ?? {}) as Record<string, unknown>;
  const fillModelEnabled = sessionConfig.fillModelEnabled !== false; // default: true
  const latencyMs = (sessionConfig.latencyMs as number) ?? 150;     // default: 150ms

  const arrivalPrice = params.signalPrice; // price when signal was generated

  // Gap 6: Fill probability check
  // capturedFillProbability is persisted on the position row so closePosition() can copy it to the trade journal.
  // Market orders bypass the model entirely and are recorded as 1.0.
  let capturedFillProbability: number | null = params.orderType === "market" || !fillModelEnabled ? 1.0 : null;
  const fillSpan = tracer.startSpan("paper.fill_check");
  if (fillModelEnabled && params.orderType && params.orderType !== "market") {
    const fillProb = computeFillProbability({
      orderType: params.orderType,
      rsi: params.rsi,
      atr: params.atr,
      symbol: params.symbol,
    });
    capturedFillProbability = fillProb;
    if (Math.random() > fillProb) {
      logger.info({ sessionId, symbol: params.symbol, fillProb, orderType: params.orderType }, "Fill probability miss — order not filled");
      broadcastSSE("paper:fill-miss", { sessionId, symbol: params.symbol, fillProb, orderType: params.orderType });
      fillSpan.setAttribute("filled", false);
      fillSpan.end();
      openSpan.end();
      return {
        position: null,
        executionResult: {
          positionId: "",
          entryPrice: 0,
          contracts: params.contracts,
          slippage: 0,
          expectedPrice: arrivalPrice,
          actualPrice: 0,
          arrivalPrice,
          implementationShortfall: 0,
          fillRatio: 0,
          filled: false,
        } satisfies ExecutionResult,
      };
    }
  }
  fillSpan.setAttribute("filled", true);
  fillSpan.end();

  // Gap 7: Apply latency to price
  const priceAfterLatency = applyLatency(params.signalPrice, params.symbol, latencyMs, params.atr);

  // Apply variable slippage (ATR-scaled, session-aware, order-type-aware)
  // Use median ATR estimate: assume current ATR is near median unless extreme
  // This gives ~1x slippage normally, 1.5-2x during high vol, 0.5-0.7x during low vol
  const medianAtrEstimate = params.atr ? params.atr * 0.85 : undefined; // Slight underestimate to bias conservatively
  const slippage = calculateSlippage(params.symbol, 1, params.atr, medianAtrEstimate, params.orderType);
  const actualEntry = params.side === "long"
    ? priceAfterLatency + slippage
    : priceAfterLatency - slippage;

  // Gap 8: TCA — implementation shortfall
  const spec = CONTRACT_SPECS[params.symbol];
  if (!spec) {
    throw new Error(`Unknown symbol "${params.symbol}" — no CONTRACT_SPECS entry. Cannot open position.`);
  }
  const implementationShortfall = Math.abs(actualEntry - arrivalPrice) * spec.pointValue * params.contracts;

  const [position] = await db.insert(paperPositions).values({
    sessionId,
    symbol: params.symbol,
    side: params.side,
    entryPrice: String(actualEntry),
    currentPrice: String(actualEntry),
    contracts: params.contracts,
    unrealizedPnl: "0",
    arrivalPrice: String(arrivalPrice),
    implementationShortfall: String(implementationShortfall),
    fillRatio: "1.0",
    fillProbability: capturedFillProbability !== null ? String(capturedFillProbability) : null,
  }).returning();

  const executionResult: ExecutionResult = {
    positionId: position.id,
    entryPrice: actualEntry,
    contracts: params.contracts,
    slippage,
    expectedPrice: params.signalPrice,
    actualPrice: actualEntry,
    arrivalPrice,
    implementationShortfall,
    fillRatio: 1.0,
    filled: true,
  };

  broadcastSSE("paper:position-opened", {
    sessionId,
    position,
    executionQuality: executionResult,
  });

  logger.info({ sessionId, executionResult }, "Paper position opened");

  // Auto-shadow: write shadow signal entry for every position open
  try {
    await db.insert(shadowSignals).values({
      sessionId,
      signalTime: new Date(),
      direction: params.side,
      expectedEntry: String(arrivalPrice),
      actualMarketPrice: String(params.signalPrice),
      wouldHaveFilled: true,
      modelSlippage: String(slippage),
    });
  } catch (shadowErr) {
    logger.warn({ sessionId, err: shadowErr }, "Shadow signal write failed (non-blocking)");
  }

  // Audit trail — paper trade open
  try {
    await db.insert(auditLog).values({
      action: "paper.trade_open",
      entityType: "paper_position",
      entityId: position.id,
      input: {
        sessionId,
        symbol: params.symbol,
        direction: params.side,
        contracts: params.contracts,
        entryPrice: params.signalPrice,
      },
      result: {
        fillPrice: actualEntry,
        slippage,
        implementationShortfall,
      },
      status: "success",
      decisionAuthority: "agent",
    });
  } catch (auditErr) {
    logger.warn({ sessionId, positionId: position.id, err: auditErr }, "Audit log write failed for paper.trade_open (non-blocking)");
  }

  return { position, executionResult };
  } finally {
    openSpan.end();
  }
}

// ─── Close Position ──────────────────────────────────────────

/**
 * Close an open paper position.
 *
 * @param positionId       UUID of the open position record.
 * @param exitSignalPrice  Signal/reference price at close time.
 * @param atr              Current ATR from the bar context.  When provided, exit
 *                         slippage is ATR-scaled (matching entry slippage model).
 *                         Omit for manual/force-close — falls back to base-tick
 *                         slippage (prior behaviour).
 */
export async function closePosition(positionId: string, exitSignalPrice: number, atr?: number) {
  const closeSpan = tracer.startSpan("paper.position_close");
  try {
  const [pos] = await db.select().from(paperPositions).where(eq(paperPositions.id, positionId));
  if (!pos) throw new Error(`Position ${positionId} not found`);

  // Fetch session early to get firmId for commission lookup
  // (session is re-read after the equity update below for downstream logic)
  const [sessionForFirm] = await db.select({ firmId: paperSessions.firmId })
    .from(paperSessions).where(eq(paperSessions.id, pos.sessionId));

  // 2.6: ATR-scaled exit slippage — mirrors entry slippage model so paper P&L is
  // not systematically overstated by using base-tick slippage on exits.
  // medianAtrEstimate mirrors the entry convention: current ATR × 0.85.
  // Falls back to base-tick slippage when ATR is unavailable (prior behaviour).
  const medianAtrEstimate = atr ? atr * 0.85 : undefined;
  const slippage = calculateSlippage(pos.symbol, 1, atr, medianAtrEstimate);
  closeSpan.setAttribute("exitSlippage", slippage);
  closeSpan.setAttribute("atrProvided", atr !== undefined);
  const actualExit = pos.side === "long"
    ? exitSignalPrice - slippage
    : exitSignalPrice + slippage;

  const spec = CONTRACT_SPECS[pos.symbol];
  if (!spec) throw new Error(`Unknown contract symbol: ${pos.symbol} — not in CONTRACT_SPECS`);
  const entryPrice = Number(pos.entryPrice);
  const direction = pos.side === "long" ? 1 : -1;
  const grossPnl = direction * (actualExit - entryPrice) * spec.pointValue * pos.contracts;

  // Commission: round-trip (entry + exit sides) × contracts
  // Per-side rate comes from the firm's commissionPerSide in firm-config.ts.
  // Falls back to $0.62/side when firmId is null/unknown (conservative — avoids overstating net P&L).
  const commissionPerSide = getCommissionPerSide(sessionForFirm?.firmId);
  const commission = commissionPerSide * 2 * pos.contracts;
  const netPnl = grossPnl - commission;

  closeSpan.setAttribute("grossPnl", grossPnl);
  closeSpan.setAttribute("commission", commission);
  closeSpan.setAttribute("netPnl", netPnl);
  closeSpan.setAttribute("firmId", sessionForFirm?.firmId ?? "unknown");

  // Wrap the 3 writes (trade insert, position close, session equity update) in a single
  // transaction so a crash or connection loss mid-close cannot leave partial state:
  //   - trade row missing but position still open
  //   - position closed but session equity not updated
  // totalTrades is incremented here as well (H3) so it stays in sync with the trade row.
  // SSE broadcast and metrics/drift detection run OUTSIDE the transaction — they are
  // non-critical and must not block or roll back the core writes.
  const closedAt = new Date();

  // ─── Phase 1.1: Journal Enrichment ──────────────────────────────────────────
  // All enrichment is gathered BEFORE the transaction.
  // Each field is independently try/caught — any failure produces null, never blocks the close.

  // Pure computation — cannot fail
  const entryDate = pos.entryTime instanceof Date ? pos.entryTime : new Date(pos.entryTime);
  const holdDurationMs = closedAt.getTime() - entryDate.getTime();
  const hourOfDay = entryDate.getUTCHours();
  const dayOfWeek = entryDate.getUTCDay(); // 0=Sun JS standard
  const sessionType = classifySessionType(entryDate);

  // macroRegime — query latest snapshot (non-blocking)
  let macroRegime: string | null = null;
  try {
    const [snap] = await db.select({ macroRegime: macroSnapshots.macroRegime })
      .from(macroSnapshots)
      .orderBy(desc(macroSnapshots.snapshotDate))
      .limit(1);
    macroRegime = snap?.macroRegime ?? null;
  } catch (err) {
    logger.warn({ positionId, err }, "Journal enrichment: macroRegime query failed (non-blocking)");
  }

  // eventActive — Python calendar_filter (same pattern as paper-signal-service.ts; non-blocking)
  let eventActive: boolean | null = null;
  try {
    const { runPythonModule } = await import("../lib/python-runner.js");
    const calResult = await runPythonModule<{ is_economic_event: boolean }>({
      module: "src.engine.skip_engine.calendar_filter",
      config: {
        date: entryDate.toISOString().split("T")[0],
        datetime: entryDate.toISOString(),
      },
      timeoutMs: 5_000,
      componentName: "calendar-filter",
    });
    eventActive = calResult.is_economic_event === true;
  } catch (err) {
    logger.warn({ positionId, err }, "Journal enrichment: eventActive calendar_filter call failed (non-blocking)");
  }

  // skipSignal — most recent skipDecisions row for today's ET trading date (non-blocking)
  let skipSignal: string | null = null;
  try {
    const today = toEasternDateString();
    const [skipRow] = await db.select({ decision: skipDecisions.decision })
      .from(skipDecisions)
      .where(sql`DATE(${skipDecisions.decisionDate} AT TIME ZONE 'America/New_York') = ${today}::date`)
      .orderBy(desc(skipDecisions.decisionDate))
      .limit(1);
    skipSignal = skipRow?.decision ?? null;
  } catch (err) {
    logger.warn({ positionId, err }, "Journal enrichment: skipSignal query failed (non-blocking)");
  }

  // fillProbability — read from position row (written at open time)
  const fillProbabilityStr = pos.fillProbability ?? null;

  const [trade] = await db.transaction(async (tx) => {
    // 1. Insert closed trade — pnl column holds NET P&L; grossPnl and commission stored for audit/analytics
    const [tradeRow] = await tx.insert(paperTrades).values({
      sessionId: pos.sessionId,
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entryPrice,
      exitPrice: String(actualExit),
      pnl: String(netPnl),
      grossPnl: String(grossPnl),
      commission: String(commission),
      contracts: pos.contracts,
      entryTime: pos.entryTime,
      exitTime: closedAt,
      slippage: String(slippage),
      // Phase 1.1 enrichment columns
      mae: null,              // Known gap: no per-bar watermark tracking yet
      mfe: null,              // Known gap: no per-bar watermark tracking yet
      holdDurationMs,
      hourOfDay,
      dayOfWeek,
      sessionType,
      macroRegime,
      eventActive,
      skipSignal,
      fillProbability: fillProbabilityStr,
    }).returning();

    // 2. Mark position as closed — unrealizedPnl resets to 0 (realized P&L lives in paperTrades)
    await tx.update(paperPositions).set({
      closedAt,
      currentPrice: String(actualExit),
      unrealizedPnl: "0",
    }).where(eq(paperPositions.id, positionId));

    // 3. Update session equity atomically using NET P&L — prevents read-modify-write race on
    //    concurrent closes.  Also update peak equity (high-water mark) for trailing drawdown.
    //    totalTrades is incremented here so it always matches the number of trade rows.
    await tx.update(paperSessions).set({
      currentEquity: sql`${paperSessions.currentEquity}::numeric + ${netPnl}`,
      peakEquity: sql`GREATEST(${paperSessions.peakEquity}::numeric, ${paperSessions.currentEquity}::numeric + ${netPnl})`,
      totalTrades: sql`COALESCE(${paperSessions.totalTrades}, 0) + 1`,
    }).where(eq(paperSessions.id, pos.sessionId));

    return [tradeRow];
  });

  // Audit trail — paper trade close (written immediately after the transaction commits)
  try {
    await db.insert(auditLog).values({
      action: "paper.trade_close",
      entityType: "paper_trade",
      entityId: trade.id,
      input: { positionId },
      result: {
        exitPrice: actualExit,
        netPnl,
        grossPnl,
        commission,
      },
      status: "success",
      decisionAuthority: "agent",
    });
  } catch (auditErr) {
    logger.warn({ positionId, tradeId: trade.id, err: auditErr }, "Audit log write failed for paper.trade_close (non-blocking)");
  }

  // Re-read session after atomic update for downstream logic
  const [session] = await db.select().from(paperSessions).where(eq(paperSessions.id, pos.sessionId));
  if (session) {
    // Gap 4: Consistency rule check + daily P&L tracking (net P&L — matches what the firm sees)
    // Wrapped individually so one failure doesn't block the other or the SSE broadcast.
    try {
      await checkConsistencyRule(session, netPnl);
    } catch (consistencyErr) {
      logger.error({ positionId, sessionId: pos.sessionId, err: consistencyErr }, "checkConsistencyRule failed (non-blocking)");
    }

    // Gap 5: Rolling Sharpe + decay detection (net P&L — promotion inputs must be net)
    try {
      await updateRollingMetrics(pos.sessionId, session.strategyId);
    } catch (metricsErr) {
      logger.error({ positionId, sessionId: pos.sessionId, err: metricsErr }, "updateRollingMetrics failed (non-blocking)");
    }
  }

  // SSE broadcast always fires if the transaction succeeded — not gated on post-close checks
  broadcastSSE("paper:trade", { trade, pnl: netPnl, grossPnl, commission });
  logger.info({ positionId, grossPnl, commission, netPnl, slippage, firmId: sessionForFirm?.firmId }, "Paper position closed");

  // Phase 1.4: Record trade into rolling metrics window and broadcast live metrics.
  // Runs after the SSE broadcast so a metrics failure never delays the trade event.
  // Dynamic import keeps the module boundary clean (avoids circular dep at load time).
  try {
    const { metricsAggregator } = await import("./metrics-aggregator.js");
    const metrics = metricsAggregator.recordTrade(pos.sessionId, { pnl: netPnl, closedAt });
    broadcastSSE("metrics:trade-close", {
      ...metrics,          // includes sessionId from computeMetrics
      strategyId: session?.strategyId ?? null,
      tradeId: trade.id,
    });
  } catch (metricsRecordErr) {
    logger.warn({ err: metricsRecordErr, sessionId: pos.sessionId }, "MetricsAggregator.recordTrade failed (non-blocking)");
  }

  // Fix 4.6: Drift detection is independently try/caught and awaited.
  // A failure here must not suppress the trade close event or leave the
  // caller hanging if onPaperTradeClose throws synchronously.
  if (session?.strategyId) {
    try {
      await onPaperTradeClose(pos.sessionId, session.strategyId);
    } catch (err) {
      logger.error({ sessionId: pos.sessionId, err }, "onPaperTradeClose drift check failed (non-blocking)");
    }
  }

  return { trade, pnl: netPnl, grossPnl, commission, slippage };
  } finally {
    closeSpan.end();
  }
}

// ─── Gap 4: Consistency Rule Enforcement ─────────────────────

async function checkConsistencyRule(
  session: typeof paperSessions.$inferSelect,
  tradePnl: number,
): Promise<void> {
  if (!session.firmId) return;
  const firmConfig = getFirmAccount(session.firmId);
  if (!firmConfig?.consistencyRule) return;

  // Update daily P&L breakdown atomically — increment today's value in SQL
  // Use Eastern Time date (futures trading day is ET-based)
  const today = toEasternDateString();

  const jsonPath = `{${today}}`;
  await db.update(paperSessions).set({
    dailyPnlBreakdown: sql`jsonb_set(
      COALESCE(${paperSessions.dailyPnlBreakdown}, '{}'::jsonb),
      ${jsonPath}::text[],
      (COALESCE((${paperSessions.dailyPnlBreakdown}->>${today})::numeric, 0) + ${tradePnl})::text::jsonb
    )`,
  }).where(eq(paperSessions.id, session.id));

  // Re-read breakdown for consistency check (reflects atomic update)
  const [updated] = await db.select({ dailyPnlBreakdown: paperSessions.dailyPnlBreakdown })
    .from(paperSessions).where(eq(paperSessions.id, session.id));
  const breakdown = (updated?.dailyPnlBreakdown ?? {}) as Record<string, number>;

  // Check consistency: no single day > X% of total profit
  const breakdownValues = Object.values(breakdown);
  if (breakdownValues.length === 0) return; // no data yet
  const totalPnl = breakdownValues.reduce((sum, v) => sum + v, 0);
  if (totalPnl <= 0) return; // only applies when profitable

  const maxDayPnl = Math.max(...breakdownValues);
  const maxDayRatio = maxDayPnl / totalPnl;

  if (maxDayRatio > firmConfig.consistencyRule) {
    const maxDay = Object.entries(breakdown).find(([, v]) => v === maxDayPnl)?.[0] ?? "unknown";
    const pctStr = (maxDayRatio * 100).toFixed(1);
    const limitPct = (firmConfig.consistencyRule * 100).toFixed(0);
    const warning = `Consistency rule: ${pctStr}% from single day (${maxDay}) exceeds ${limitPct}% limit for ${session.firmId}`;
    logger.warn({ sessionId: session.id, maxDayRatio, limit: firmConfig.consistencyRule }, warning);
    broadcastSSE("paper:consistency-warning", {
      sessionId: session.id,
      firmId: session.firmId,
      maxDayRatio,
      limit: firmConfig.consistencyRule,
      maxDay,
      message: warning,
    });
  }
}

// ─── Gap 5: Rolling Sharpe + Decay Detection ─────────────────

async function updateRollingMetrics(sessionId: string, strategyId: string | null): Promise<void> {
  // Get last 30 trades for rolling Sharpe
  const recentTrades = await db.select({ pnl: paperTrades.pnl })
    .from(paperTrades)
    .where(eq(paperTrades.sessionId, sessionId))
    .orderBy(desc(paperTrades.exitTime))
    .limit(30);

  if (recentTrades.length < 5) return; // need minimum trades for meaningful Sharpe

  const pnls = recentTrades.map(t => Number(t.pnl));
  const mean = pnls.reduce((s, v) => s + v, 0) / pnls.length;
  const variance = pnls.length > 1
    ? pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / (pnls.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  // Annualize using trades-per-day estimate: sqrt(252 * avgTradesPerDay)
  // For now, assume ~1 trade/day (conservative); adjusts as more data accumulates
  const rollingSharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

  // Store metrics snapshot
  const metricsSnapshot = {
    rollingSharpe: Math.round(rollingSharpe * 100) / 100,
    tradeCount: recentTrades.length,
    avgPnl: Math.round(mean * 100) / 100,
    stdPnl: Math.round(stdDev * 100) / 100,
    updatedAt: new Date().toISOString(),
  };

  await db.update(paperSessions).set({
    metricsSnapshot,
  }).where(eq(paperSessions.id, sessionId));

  // Compare to backtest Sharpe if we have a linked strategy
  if (strategyId) {
    const [strategy] = await db.select({ rollingSharpe30d: strategies.rollingSharpe30d })
      .from(strategies).where(eq(strategies.id, strategyId));

    if (strategy?.rollingSharpe30d) {
      const backtestSharpe = Number(strategy.rollingSharpe30d);
      const deviation = Math.abs(rollingSharpe - backtestSharpe);
      // Rough std dev of Sharpe estimates ~ 0.5 for small samples
      const sharpeStdErr = 0.5;

      if (deviation > 2 * sharpeStdErr) {
        broadcastSSE("paper:decay-alert", {
          sessionId,
          level: "alert",
          rollingSharpe,
          backtestSharpe,
          deviation: Math.round(deviation * 100) / 100,
          message: `ALERT: Rolling Sharpe (${rollingSharpe.toFixed(2)}) deviates >2σ from backtest (${backtestSharpe.toFixed(2)})`,
        });
        logger.warn({ sessionId, rollingSharpe, backtestSharpe }, "Decay ALERT: >2σ deviation");
      } else if (deviation > 1 * sharpeStdErr) {
        broadcastSSE("paper:decay-warning", {
          sessionId,
          level: "warning",
          rollingSharpe,
          backtestSharpe,
          deviation: Math.round(deviation * 100) / 100,
          message: `Warning: Rolling Sharpe (${rollingSharpe.toFixed(2)}) deviates >1σ from backtest (${backtestSharpe.toFixed(2)})`,
        });
      }
    }
  }
}

// ─── Update Position Prices ──────────────────────────────────

export async function updatePositionPrices(sessionId: string, prices: Record<string, number>) {
  const openPositions = await db.select().from(paperPositions)
    .where(and(eq(paperPositions.sessionId, sessionId), isNull(paperPositions.closedAt)));

  let totalUnrealizedPnl = 0;

  for (const pos of openPositions) {
    const currentPrice = prices[pos.symbol];
    if (currentPrice === undefined) continue;

    const spec = CONTRACT_SPECS[pos.symbol];
    if (!spec) {
      logger.warn({ symbol: pos.symbol, positionId: pos.id }, "Missing CONTRACT_SPECS — skipping unrealized P&L update");
      continue;
    }
    const entryPrice = Number(pos.entryPrice);
    const direction = pos.side === "long" ? 1 : -1;
    const unrealizedPnl = direction * (currentPrice - entryPrice) * spec.pointValue * pos.contracts;

    await db.update(paperPositions).set({
      currentPrice: String(currentPrice),
      unrealizedPnl: String(unrealizedPnl),
    }).where(eq(paperPositions.id, pos.id));

    totalUnrealizedPnl += unrealizedPnl;
  }

  // Update session equity to reflect unrealized P&L (needed for realtime trailing drawdown)
  if (openPositions.length > 0) {
    const [session] = await db.select({
      startingCapital: paperSessions.startingCapital,
      peakEquity: paperSessions.peakEquity,
    }).from(paperSessions).where(eq(paperSessions.id, sessionId));

    if (session) {
      // Get total realized P&L from closed trades
      const closedTrades = await db.select({ pnl: paperTrades.pnl })
        .from(paperTrades)
        .where(eq(paperTrades.sessionId, sessionId));
      const realizedPnl = closedTrades.reduce((sum, t) => sum + Number(t.pnl), 0);

      // Current equity = starting capital + realized P&L + unrealized P&L
      const newEquity = Number(session.startingCapital) + realizedPnl + totalUnrealizedPnl;
      const newPeak = Math.max(Number(session.peakEquity), newEquity);

      await db.update(paperSessions).set({
        currentEquity: String(newEquity),
        peakEquity: String(newPeak),
      }).where(eq(paperSessions.id, sessionId));
    }
  }

  broadcastSSE("paper:pnl", { sessionId, unrealizedPnl: totalUnrealizedPnl });
  return { sessionId, unrealizedPnl: totalUnrealizedPnl, positionsUpdated: openPositions.length };
}

// ─── Execution Quality Stats ─────────────────────────────────

export async function getExecutionQuality(sessionId: string) {
  const trades = await db.select().from(paperTrades)
    .where(eq(paperTrades.sessionId, sessionId));

  if (trades.length === 0) return { totalTrades: 0, avgSlippage: 0, totalSlippageCost: 0 };

  const slippages = trades.map(t => Number(t.slippage ?? 0));
  const avgSlippage = slippages.reduce((a, b) => a + b, 0) / slippages.length;
  const totalSlippageCost = slippages.reduce((sum, s, i) => {
    const spec = CONTRACT_SPECS[trades[i].symbol];
    return sum + s * (spec?.pointValue ?? 1) * trades[i].contracts;
  }, 0);

  return {
    totalTrades: trades.length,
    avgSlippage: Math.round(avgSlippage * 1000) / 1000,
    totalSlippageCost: Math.round(totalSlippageCost * 100) / 100,
  };
}

// ─── Gap 8: TCA Report ──────────────────────────────────────

export async function getTcaReport(sessionId: string) {
  const positions = await db.select().from(paperPositions)
    .where(eq(paperPositions.sessionId, sessionId));

  if (positions.length === 0) {
    return { totalPositions: 0, avgShortfall: 0, totalExecutionCost: 0, avgFillRatio: 1.0, worstFills: [] };
  }

  const closedPositions = positions.filter(p => p.closedAt);
  const shortfalls = closedPositions
    .map(p => Number(p.implementationShortfall ?? 0))
    .filter(v => v > 0);
  const fillRatios = closedPositions.map(p => Number(p.fillRatio ?? 1));

  const avgShortfall = shortfalls.length > 0
    ? shortfalls.reduce((s, v) => s + v, 0) / shortfalls.length
    : 0;
  const totalExecutionCost = shortfalls.reduce((s, v) => s + v, 0);
  const avgFillRatio = fillRatios.length > 0
    ? fillRatios.reduce((s, v) => s + v, 0) / fillRatios.length
    : 1.0;

  // Worst fills: top 5 by implementation shortfall
  const worstFills = closedPositions
    .filter(p => Number(p.implementationShortfall ?? 0) > 0)
    .sort((a, b) => Number(b.implementationShortfall ?? 0) - Number(a.implementationShortfall ?? 0))
    .slice(0, 5)
    .map(p => ({
      positionId: p.id,
      symbol: p.symbol,
      arrivalPrice: Number(p.arrivalPrice ?? 0),
      entryPrice: Number(p.entryPrice),
      shortfall: Number(p.implementationShortfall ?? 0),
      fillRatio: Number(p.fillRatio ?? 1),
    }));

  return {
    totalPositions: closedPositions.length,
    avgShortfall: Math.round(avgShortfall * 100) / 100,
    totalExecutionCost: Math.round(totalExecutionCost * 100) / 100,
    avgFillRatio: Math.round(avgFillRatio * 1000) / 1000,
    worstFills,
  };
}

// ─── Rolling Metrics (public getter for route) ───────────────

export async function getRollingMetrics(sessionId: string) {
  const [session] = await db.select({
    metricsSnapshot: paperSessions.metricsSnapshot,
    dailyPnlBreakdown: paperSessions.dailyPnlBreakdown,
    firmId: paperSessions.firmId,
  }).from(paperSessions).where(eq(paperSessions.id, sessionId));

  if (!session) return null;
  return {
    metrics: session.metricsSnapshot,
    dailyPnl: session.dailyPnlBreakdown,
    firmId: session.firmId,
  };
}
