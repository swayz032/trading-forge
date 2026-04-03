/**
 * MetricsAggregator — rolling per-session trade metrics for the streaming dashboard.
 *
 * Maintains a capped sliding window (last 50 trades) per paper session.
 * After each trade close, caller invokes recordTrade() and broadcasts the result.
 * The emitSnapshot() method broadcasts all active sessions at once (used by the
 * metrics-heartbeat scheduler job every 60s so dashboards stay live without waiting
 * for a trade).
 *
 * All computation is pure (no I/O). Failures in callers are wrapped in try/catch
 * so a computation bug never blocks the paper trade close path.
 */

import { broadcastSSE } from "../routes/sse.js";

export interface TradeRecord {
  pnl: number;
  closedAt: Date;
}

export interface SessionMetrics {
  sessionId: string;
  tradeCount: number;
  totalPnl: number;
  rollingSharpe: number;
  drawdownPct: number;
  winRate: number;
  winStreak: number;
  lossStreak: number;
}

class MetricsAggregator {
  private readonly windows = new Map<string, TradeRecord[]>();
  private static readonly MAX_WINDOW = 50;

  /**
   * Record a closed trade for the given session and return the updated metrics.
   * The window is pruned to MAX_WINDOW after insertion so memory is bounded.
   */
  recordTrade(sessionId: string, trade: TradeRecord): SessionMetrics {
    let trades = this.windows.get(sessionId) ?? [];
    trades = [...trades, trade];
    if (trades.length > MetricsAggregator.MAX_WINDOW) {
      trades = trades.slice(-MetricsAggregator.MAX_WINDOW);
    }
    this.windows.set(sessionId, trades);
    return this.computeMetrics(sessionId, trades);
  }

  /**
   * Return current metrics for one session, or null if no trades recorded yet.
   */
  getSessionMetrics(sessionId: string): SessionMetrics | null {
    const trades = this.windows.get(sessionId);
    if (!trades || trades.length === 0) return null;
    return this.computeMetrics(sessionId, trades);
  }

  /**
   * Return metrics for all sessions that have at least one recorded trade.
   */
  getAllMetrics(): SessionMetrics[] {
    const result: SessionMetrics[] = [];
    for (const [id, trades] of this.windows.entries()) {
      if (trades.length > 0) {
        result.push(this.computeMetrics(id, trades));
      }
    }
    return result;
  }

  /**
   * Broadcast a snapshot of all active session metrics over SSE.
   * Called by the metrics-heartbeat scheduler job every 60s.
   * No-ops silently if there are no active sessions (no noise).
   */
  emitSnapshot(): void {
    const all = this.getAllMetrics();
    if (all.length === 0) return;
    broadcastSSE("metrics:snapshot", {
      sessions: all,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Drop all recorded data for a session. Called when a paper session is stopped
   * to avoid stale windows accumulating indefinitely.
   */
  clearSession(sessionId: string): void {
    this.windows.delete(sessionId);
  }

  // ─── Private ────────────────────────────────────────────────

  private computeMetrics(sessionId: string, trades: TradeRecord[]): SessionMetrics {
    const pnls = trades.map((t) => t.pnl);
    const tradeCount = pnls.length;

    // Totals and mean
    const totalPnl = pnls.reduce((a, b) => a + b, 0);
    const mean = totalPnl / tradeCount;

    // Sample variance (n-1) for Sharpe denominator
    const variance =
      tradeCount > 1
        ? pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / (tradeCount - 1)
        : 0;
    const stdDev = Math.sqrt(variance);

    // Annualised Sharpe (trade-level, not daily — for real-time display only)
    // Multiply by sqrt(252) as a rough annualisation proxy. This is intentionally
    // labelled "rolling" and not used for promotion decisions (daily Sharpe is used there).
    const rollingSharpe = stdDev === 0 ? 0 : (mean / stdDev) * Math.sqrt(252);

    // Win rate
    const wins = pnls.filter((p) => p > 0).length;
    const winRate = wins / tradeCount;

    // Equity-curve drawdown
    let peak = 0;
    let maxDd = 0;
    let cumPnl = 0;
    for (const p of pnls) {
      cumPnl += p;
      if (cumPnl > peak) peak = cumPnl;
      const dd = cumPnl - peak;
      if (dd < maxDd) maxDd = dd;
    }
    // drawdownPct is negative-safe: 0 when peak is 0 (all losers from start)
    const drawdownPct = peak > 0 ? (maxDd / peak) * 100 : 0;

    // Consecutive streaks (max over entire window)
    let winStreak = 0;
    let lossStreak = 0;
    let curWin = 0;
    let curLoss = 0;
    for (const p of pnls) {
      if (p > 0) {
        curWin++;
        curLoss = 0;
        if (curWin > winStreak) winStreak = curWin;
      } else {
        curLoss++;
        curWin = 0;
        if (curLoss > lossStreak) lossStreak = curLoss;
      }
    }

    return {
      sessionId,
      tradeCount,
      totalPnl,
      rollingSharpe,
      drawdownPct,
      winRate,
      winStreak,
      lossStreak,
    };
  }
}

// Singleton — one instance shared across the process lifetime
export const metricsAggregator = new MetricsAggregator();
