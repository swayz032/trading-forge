/**
 * src/server/routes/production-status.ts
 *
 * GET /api/production/status — answers 6 production questions in <60s.
 *
 * Returns a single GREEN/YELLOW/RED overall state plus all 9 kill-switch
 * layers and the 6 questions an operator needs to assess production health
 * without running any additional queries.
 *
 * Design:
 *   - 5-second in-memory cache (prevents thundering herd on dashboard polling)
 *   - Sub-100ms p95 response time (validated by test suite)
 *   - All 6 questions answerable in <60s of reading
 *   - Fail-CLOSED: cache read errors return HALT status, not 500
 */

import { Router, type Request, type Response } from "express";
import { db } from "../db/index.js";
import { dailyReconciliation, paperSessions, weeklyDriftReports } from "../db/schema.js";
import { desc, eq, gte, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { killSwitch } from "../production/kill-switch.js";
import { getDailyReconciliationStatus } from "../production/reconciliation-service.js";
import type { KillSwitchStatusReport } from "../production/kill-switch.js";
import { operatorAbsentModeActive } from "../services/operator-absent-mode-service.js";
import { getLastHeartbeatAt } from "../services/dead-mans-heartbeat-service.js";
import { getCookieStatus } from "../services/prop-firm-cookie-refresh-service.js";
import { getDiscordWebhookHealth } from "../services/discord-fanout-audit-service.js";
import type { DiscordWebhookHealth } from "../services/discord-fanout-audit-service.js";
import { toFuturesTradingDayString } from "../services/paper-risk-gate.js";
import { TOPSTEP_TRAILING_DD_BY_SIZE } from "../../shared/firm-config.js";

export const productionStatusRoutes = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

type OverallSeverity = "green" | "yellow" | "red";

interface PnLStatus {
  todayPnl: number | null;
  expectedPnl: number | null;
  delta: number | null;
  severity: OverallSeverity;
}

export interface DrawdownStatus {
  bufferRemaining: number | null;
  firmLimit: number | null;
  usedPct: number | null;
  severity: OverallSeverity;
  /** deep-scan #12 F-2: which DLL model produced firmLimit.
   *  "trailing_dd_hwm" = Topstep EOD trailing-DD anchored on realizedPeakEquity.
   *  "daily_dll_pct"   = MFFU fixed % daily loss limit.
   *  "estimate_5pct"   = unknown firm — conservative 5% estimate.
   *  null              = no active session / error state.
   */
  dllModel: "trailing_dd_hwm" | "daily_dll_pct" | "estimate_5pct" | null;
}

interface ReconStatus {
  lastCleanDate: string | null;
  ageHours: number | null;
  severity: OverallSeverity;
}

interface AlertingStatus {
  lastAlertFiredAt: string | null;
  minutesSinceLastAlert: number | null;
  webhookConfigured: boolean;
}

interface SixQuestions {
  areWeTrading: {
    answer: string;
    halted: boolean;
    reason: string | null;
    severity: OverallSeverity;
  };
  pnlToday: PnLStatus;
  drawdownDistance: DrawdownStatus;
  lastCleanReconciliation: ReconStatus;
  killSwitchLayers: KillSwitchStatusReport;
  alertingStatus: AlertingStatus;
}

interface AutopilotStatus {
  operator_absent_mode_active: boolean;
  last_heartbeat_at: string | null;
  bw_session_expires_at: string | null;  // null until first BW refresh check
  cookie_refresh_status: { mffu: "fresh" | "stale" | "unknown"; topstep: "fresh" | "stale" | "unknown" };
  discord_webhook_health: DiscordWebhookHealth;
}

export interface ProductionStatusResponse {
  overall: OverallSeverity;
  productionMode: string;
  sixQuestions: SixQuestions;
  autopilot_status: AutopilotStatus;
  generatedAt: string;
  cacheHit: boolean;
}

// ─── 5-second response cache ──────────────────────────────────────────────────

let _cache: { response: ProductionStatusResponse; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5_000;

export function _invalidateStatusCacheForTests(): void {
  _cache = null;
}

// ─── Question builders ────────────────────────────────────────────────────────

async function buildAreWeTrading(ksReport: KillSwitchStatusReport): Promise<SixQuestions["areWeTrading"]> {
  const halted = ksReport.overall_halted;
  const haltedLayer = ksReport.layers.find((l) => l.halted);

  return {
    answer: halted
      ? `No — halted by ${haltedLayer?.name ?? "unknown layer"}`
      : `Yes — production mode is ${ksReport.production_mode}`,
    halted,
    reason: haltedLayer?.reason ?? null,
    severity: halted ? "red" : "green",
  };
}

async function buildPnlToday(): Promise<PnLStatus> {
  try {
    // F-2 fix: use CME-futures-trading-day key (rolls at 17:00 ET), not UTC
    // calendar day. `dailyReconciliation.reconDate` is the futures trading day —
    // a UTC slice causes a 5h misalignment from 19:00–23:59 UTC where the UTC
    // date already advanced but the CME trading day hasn't rolled.
    const today = new Date();
    const dateStr = toFuturesTradingDayString(today);

    const rows = await db
      .select({
        reconDate: dailyReconciliation.reconDate,
        expectedPnl: dailyReconciliation.expectedPnl,
        mffuDashboardPnl: dailyReconciliation.mffuDashboardPnl,
      })
      .from(dailyReconciliation)
      .where(eq(dailyReconciliation.reconDate, dateStr))
      .limit(1);

    if (rows.length === 0) {
      return {
        todayPnl: null,
        expectedPnl: null,
        delta: null,
        severity: "yellow", // No recon run yet today
      };
    }

    const row = rows[0];
    const expected = Number(row.expectedPnl ?? 0);
    const actual = row.mffuDashboardPnl !== null ? Number(row.mffuDashboardPnl) : null;
    const delta = actual !== null ? actual - expected : null;

    let severity: OverallSeverity = "green";
    if (delta !== null && Math.abs(delta) > 50) severity = "yellow";
    if (delta !== null && Math.abs(delta) > 200) severity = "red";

    return {
      todayPnl: actual,
      expectedPnl: expected,
      delta,
      severity,
    };
  } catch (err) {
    logger.warn({ err }, "production-status: PnL today query failed");
    return { todayPnl: null, expectedPnl: null, delta: null, severity: "yellow" };
  }
}

// Track A F-4: Wire drawdownDistance to actual session DLL state.
// deep-scan #12 F-2: Topstep uses EOD trailing drawdown (not a fixed % of capital).
// It is handled separately in buildDrawdownDistance() via TOPSTEP_TRAILING_DD_BY_SIZE
// and realizedPeakEquity — tagged dllModel:"trailing_dd_hwm".
// MFFU uses a fixed 2% daily loss limit — tagged dllModel:"daily_dll_pct".
// Unknown firms fall back to the conservative 5% estimate — tagged dllModel:"estimate_5pct".
const FIRM_DLL_PCT: Record<string, number> = {
  mffu: 0.02,       // MFFU 2% daily loss limit (dailyLossLimit = $1K on 50K account)
  // topstep intentionally absent — uses trailing_dd_hwm model, not a fixed %
};
const DEFAULT_DLL_PCT = 0.05; // Unknown firm — use tightest default

export async function buildDrawdownDistance(): Promise<DrawdownStatus> {
  try {
    const activeSessions = await db
      .select({
        id: paperSessions.id,
        firmId: paperSessions.firmId,
        startingCapital: paperSessions.startingCapital,
        currentEquity: paperSessions.currentEquity,
        // deep-scan #12 F-2: realizedPeakEquity is the authoritative trailing-DD HWM
        // (closed-equity only). Required to mirror the Topstep gate formula in
        // paper-risk-gate.ts §session drawdown limit. peakEquity (MTM) over-tightens.
        realizedPeakEquity: paperSessions.realizedPeakEquity,
        dailyPnlBreakdown: paperSessions.dailyPnlBreakdown,
      })
      .from(paperSessions)
      .where(eq(paperSessions.status, "active"))
      .limit(10);

    if (activeSessions.length === 0) {
      // Operator must see the gap — yellow, not green
      return {
        bufferRemaining: null,
        firmLimit: null,
        usedPct: null,
        severity: "yellow",
        dllModel: null,
      };
    }

    // deep-scan #12 F-1: use CME futures trading-day key, not UTC calendar date.
    // dailyPnlBreakdown is written with keys from toFuturesTradingDayString (17:00 ET
    // roll). During 19:00–23:59 ET the UTC date advances to D+1 while the breakdown
    // still holds D — using toISOString().slice(0,10) here returned 0 for that window.
    // Mirrors buildPnlToday() which already used this same pattern. (deep-scan #12 F-1)
    const todayCmeKey = toFuturesTradingDayString(new Date());

    let worstUsedPct = 0;
    let worstFirmLimit: number | null = null;
    let worstBufferRemaining: number | null = null;
    let worstDllModel: DrawdownStatus["dllModel"] = null;

    for (const session of activeSessions) {
      const firmId = session.firmId ?? "";
      const startingCapital = Number(session.startingCapital ?? 50000);
      let firmLimit: number;
      let sessionLoss: number;
      let sessionDllModel: DrawdownStatus["dllModel"];

      if (firmId === "topstep") {
        // deep-scan #12 F-2: Topstep uses EOD trailing drawdown anchored on
        // realizedPeakEquity (closed-equity HWM), not a fixed % of starting capital.
        // Formula mirrors paper-risk-gate.ts §session drawdown limit exactly:
        //   sessionLoss = realizedPeakEquity - currentEquity
        //   firmLimit   = TOPSTEP_TRAILING_DD_BY_SIZE[accountSize] ?? 2000
        // Fall back to startingCapital for sessions that predate migration 0075.
        const rawRealizedPeak = Number(session.realizedPeakEquity ?? 0);
        const peakEquity = rawRealizedPeak > 0 ? rawRealizedPeak : startingCapital;
        const currentEquity = Number(session.currentEquity ?? startingCapital);
        firmLimit = TOPSTEP_TRAILING_DD_BY_SIZE[startingCapital] ?? 2000;
        sessionLoss = Math.max(0, peakEquity - currentEquity);
        sessionDllModel = "trailing_dd_hwm";
      } else {
        // MFFU: fixed 2% daily loss limit measured against today's P&L breakdown.
        // Unknown firms: conservative 5% estimate, same daily-breakdown approach.
        const dllPct = FIRM_DLL_PCT[firmId] ?? DEFAULT_DLL_PCT;
        firmLimit = startingCapital * dllPct;
        const breakdown = (session.dailyPnlBreakdown ?? {}) as Record<string, number>;
        const dayPnl = breakdown[todayCmeKey] ?? 0;
        // DLL tracks loss (negative P&L). dayPnl > 0 means no loss against the limit.
        sessionLoss = Math.max(0, -dayPnl);
        sessionDllModel = firmId === "mffu" ? "daily_dll_pct" : "estimate_5pct";
      }

      const usedPct = sessionLoss / firmLimit;

      if (usedPct > worstUsedPct) {
        worstUsedPct = usedPct;
        worstFirmLimit = firmLimit;
        worstBufferRemaining = firmLimit - sessionLoss;
        worstDllModel = sessionDllModel;
      }
    }

    let severity: OverallSeverity = "green";
    if (worstUsedPct >= 0.5) severity = "yellow";
    if (worstUsedPct >= 0.67) severity = "red";

    return {
      bufferRemaining: worstBufferRemaining !== null ? Math.round(worstBufferRemaining * 100) / 100 : null,
      firmLimit: worstFirmLimit !== null ? Math.round(worstFirmLimit * 100) / 100 : null,
      usedPct: Math.round(worstUsedPct * 1000) / 1000,
      severity,
      dllModel: worstDllModel,
    };
  } catch (err) {
    logger.warn({ err }, "production-status: drawdown distance query failed");
    return { bufferRemaining: null, firmLimit: null, usedPct: null, severity: "yellow", dllModel: null };
  }
}

async function buildLastCleanRecon(): Promise<ReconStatus> {
  try {
    // Find the most recent day with mismatch_count = 0
    const rows = await db
      .select({
        reconDate: dailyReconciliation.reconDate,
        ranAt: dailyReconciliation.ranAt,
      })
      .from(dailyReconciliation)
      .where(eq(dailyReconciliation.mismatchCount, 0))
      .orderBy(desc(dailyReconciliation.ranAt))
      .limit(1);

    if (rows.length === 0) {
      return { lastCleanDate: null, ageHours: null, severity: "red" };
    }

    const lastCleanRanAt = rows[0].ranAt;
    const ageHours = (Date.now() - lastCleanRanAt.getTime()) / (1000 * 60 * 60);

    let severity: OverallSeverity = "green";
    if (ageHours > 24) severity = "yellow";
    if (ageHours > 72) severity = "red";

    return {
      lastCleanDate: rows[0].reconDate,
      ageHours: Math.round(ageHours * 10) / 10,
      severity,
    };
  } catch (err) {
    logger.warn({ err }, "production-status: last clean recon query failed");
    return { lastCleanDate: null, ageHours: null, severity: "red" };
  }
}

async function buildAlertingStatus(): Promise<AlertingStatus> {
  const webhookConfigured = Boolean(
    process.env["DISCORD_WEBHOOK_URL"] || process.env["DISCORD_ALERT_PORT"]
  );

  try {
    const rows = await db.execute<{ created_at: string }>(
      sql`SELECT created_at FROM alerts ORDER BY created_at DESC LIMIT 1`
    );

    if (rows.length === 0) {
      return {
        lastAlertFiredAt: null,
        minutesSinceLastAlert: null,
        webhookConfigured,
      };
    }

    const lastAt = new Date(rows[0].created_at);
    const minutesSinceLastAlert = Math.round((Date.now() - lastAt.getTime()) / 60_000);

    return {
      lastAlertFiredAt: lastAt.toISOString(),
      minutesSinceLastAlert,
      webhookConfigured,
    };
  } catch (err) {
    logger.warn({ err }, "production-status: alerting status query failed");
    return { lastAlertFiredAt: null, minutesSinceLastAlert: null, webhookConfigured };
  }
}

// ─── Autopilot status builder (Track 7) ──────────────────────────────────────

async function buildAutopilotStatus(): Promise<AutopilotStatus> {
  try {
    const [absentActive, lastHeartbeat, cookieStatus, webhookHealth] = await Promise.all([
      operatorAbsentModeActive().catch(() => false),
      getLastHeartbeatAt().catch(() => null),
      Promise.resolve(getCookieStatus()),
      Promise.resolve(getDiscordWebhookHealth()),
    ]);

    return {
      operator_absent_mode_active: absentActive,
      last_heartbeat_at: lastHeartbeat?.toISOString() ?? null,
      bw_session_expires_at: null, // populated by bitwarden-session-refresh-service on next check
      cookie_refresh_status: {
        mffu: (cookieStatus["mffu"] as "fresh" | "stale" | "unknown") ?? "unknown",
        topstep: (cookieStatus["topstep"] as "fresh" | "stale" | "unknown") ?? "unknown",
      },
      discord_webhook_health: webhookHealth,
    };
  } catch (err) {
    logger.warn({ err }, "production-status: autopilot status build failed — returning defaults");
    return {
      operator_absent_mode_active: false,
      last_heartbeat_at: null,
      bw_session_expires_at: null,
      cookie_refresh_status: { mffu: "unknown", topstep: "unknown" },
      discord_webhook_health: "not_configured",
    };
  }
}

// ─── Overall severity computation ─────────────────────────────────────────────

function worstOf(...severities: OverallSeverity[]): OverallSeverity {
  if (severities.includes("red")) return "red";
  if (severities.includes("yellow")) return "yellow";
  return "green";
}

// ─── Main status builder ──────────────────────────────────────────────────────

export async function buildProductionStatus(): Promise<ProductionStatusResponse> {
  const generatedAt = new Date().toISOString();

  // All queries run in parallel for sub-100ms response
  const [ksReport, pnlToday, drawdownDistance, lastCleanRecon, alertingStatus, autopilotStatus] =
    await Promise.all([
      killSwitch.getKillSwitchStatus(),
      buildPnlToday(),
      buildDrawdownDistance(),
      buildLastCleanRecon(),
      buildAlertingStatus(),
      buildAutopilotStatus(),
    ]);

  const areWeTrading = await buildAreWeTrading(ksReport);

  const sixQuestions: SixQuestions = {
    areWeTrading,
    pnlToday,
    drawdownDistance,
    lastCleanReconciliation: lastCleanRecon,
    killSwitchLayers: ksReport,
    alertingStatus,
  };

  const overall = worstOf(
    areWeTrading.severity,
    pnlToday.severity,
    drawdownDistance.severity,
    lastCleanRecon.severity
  );

  return {
    overall,
    productionMode: ksReport.production_mode,
    sixQuestions,
    autopilot_status: autopilotStatus,
    generatedAt,
    cacheHit: false,
  };
}

// ─── Route: GET /api/production/status ───────────────────────────────────────

productionStatusRoutes.get(
  // deep-scan #13: both frontends (ProductionStatusPanel.tsx + office-risk.js)
  // poll /api/production/status, but the router mounts at /api/production, so
  // "/status" was a 404 and the operator's 6-question panel silently aged out.
  ["/", "/status"],
  async (_req: Request, res: Response): Promise<void> => {
    const requestStart = Date.now();

    // Cache hit path
    if (_cache && Date.now() < _cache.expiresAt) {
      const cached = { ..._cache.response, cacheHit: true };
      res.json(cached);
      return;
    }

    try {
      const status = await buildProductionStatus();

      // Populate cache
      _cache = { response: status, expiresAt: Date.now() + CACHE_TTL_MS };

      const durationMs = Date.now() - requestStart;
      logger.debug(
        { overall: status.overall, durationMs },
        "production-status: GET /api/production/status"
      );

      res.json(status);
    } catch (err) {
      logger.error({ err }, "production-status: status build failed");

      // Fail-CLOSED: return a HALT state rather than 500
      const failClosed: ProductionStatusResponse = {
        overall: "red",
        productionMode: "HALT",
        sixQuestions: {
          areWeTrading: {
            answer: "Unknown — status build failed",
            halted: true,
            reason: err instanceof Error ? err.message : String(err),
            severity: "red",
          },
          pnlToday: { todayPnl: null, expectedPnl: null, delta: null, severity: "red" },
          drawdownDistance: { bufferRemaining: null, firmLimit: null, usedPct: null, severity: "red", dllModel: null },
          lastCleanReconciliation: { lastCleanDate: null, ageHours: null, severity: "red" },
          killSwitchLayers: {
            overall_halted: true,
            production_mode: "HALT",
            layers: [],
            checked_at: new Date(),
          },
          alertingStatus: { lastAlertFiredAt: null, minutesSinceLastAlert: null, webhookConfigured: false },
        },
        autopilot_status: {
          operator_absent_mode_active: false,
          last_heartbeat_at: null,
          bw_session_expires_at: null,
          cookie_refresh_status: { mffu: "unknown", topstep: "unknown" },
          discord_webhook_health: "not_configured",
        },
        generatedAt: new Date().toISOString(),
        cacheHit: false,
      };

      res.status(200).json(failClosed); // 200 with red state — not 500 (dashboard keeps rendering)
    }
  }
);
