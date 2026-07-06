/**
 * src/server/production/reconciliation-service.ts
 *
 * Daily 4:15 PM ET reconciliation cron (Phase 4B).
 *
 * Compares production_trades vs TradersPost webhook log vs Tradovate fills
 * vs MFFU Playwright dashboard snapshot — and writes one daily_reconciliation
 * row per trading day. Fires a critical Discord alert on any mismatch.
 *
 * ─── HARD ISOLATION BOUNDARY ───────────────────────────────────────────────
 * This file MUST NOT import from: agent-service, critic-optimizer-service,
 * quantum_* modules, synthetic_market_simulator, or any scout-* service.
 * Violation detection: `npm run check:production-isolation`
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Design principles:
 *   - Fail-CLOSED: any data-fetch error → severity=red, alert fires
 *   - Bypasses pipeline gate: safety-signal cron — runs regardless of pause state
 *   - Idempotent: UNIQUE constraint on recon_date, upserts cleanly
 *   - 5-minute wall-clock timeout (bounded job)
 *   - Audit_log row on every run completion
 *
 * Thresholds (all in config — no magic numbers):
 *   PNL_TOLERANCE_DOLLARS   = 5    ($5 tolerance on PnL comparison)
 *   YELLOW_MISMATCH_COUNT   = 1    (1-2 mismatches → yellow)
 *   RED_MISMATCH_COUNT      = 3    (3+ mismatches → red)
 *   RECON_TIMEOUT_MS        = 300_000  (5-minute hard wall-clock)
 */

import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import {
  dailyReconciliation,
  productionTrades,
  auditLog,
} from "../db/schema.js";
import { eq, sql, gte, lt, and, sum, count } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { deriveReconSeverity } from "../lib/recon-severity.js";
import { AlertFactory } from "../services/alert-service.js";
import { broadcastSSE } from "../routes/sse.js";
import { runDashboardSnapshots } from "../services/dashboard-snapshot-service.js";
import { getMarkerCountForDate } from "../services/tradingview-marker-service.js";

// ─── Config (all thresholds here — no magic numbers in logic) ────────────────

export const RECON_CONFIG = {
  PNL_TOLERANCE_DOLLARS: Number(process.env["RECON_PNL_TOLERANCE_DOLLARS"] ?? 5),
  YELLOW_MISMATCH_COUNT: Number(process.env["RECON_YELLOW_MISMATCH_COUNT"] ?? 1),
  RED_MISMATCH_COUNT: Number(process.env["RECON_RED_MISMATCH_COUNT"] ?? 3),
  RECON_TIMEOUT_MS: Number(process.env["RECON_TIMEOUT_MS"] ?? 300_000),
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReconSeverity = "green" | "yellow" | "red";

export interface MismatchDetail {
  source: string;
  expected: number | string;
  actual: number | string;
  delta?: number;
}

export interface ReconciliationResult {
  reconDate: string;
  productionTradesCount: number;
  traderspostLogCount: number;
  tradovateFillsCount: number;
  mffuDashboardPnl: number | null;
  expectedPnl: number;
  // 5th source (Track 8): TradingView marker count for the day.
  // null when the tradingview_markers table does not exist yet (pre-Track-8 installs).
  tradingviewMarkerCount: number | null;
  mismatchCount: number;
  mismatchDetails: MismatchDetail[];
  severity: ReconSeverity;
  alertFired: boolean;
  ranAt: Date;
}

export interface ReconciliationStatus {
  reconDate: string;
  severity: ReconSeverity;
  mismatchCount: number;
  ranAt: Date | null;
}

// ─── Helper: today's date as ISO date string (ET-adjusted) ───────────────────

function todayEt(): Date {
  // Round to start-of-day in ET — trade date matches the session.
  // For recon purposes, we use UTC date (cron fires at 4:15 PM ET,
  // session is always complete by then).
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// ─── Data-fetch helpers ────────────────────────────────────────────────────────

/**
 * Count production_trades rows for the given trading date.
 * A production trade is associated with bar_timestamp on that date (UTC).
 */
async function fetchProductionTradesCount(date: Date): Promise<number> {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayEnd   = new Date(dayStart.getTime() + 86_400_000);

  const rows = await db
    .select({ cnt: count() })
    .from(productionTrades)
    .where(
      and(
        gte(productionTrades.barTimestamp, dayStart),
        lt(productionTrades.barTimestamp, dayEnd)
      )
    );

  return Number(rows[0]?.cnt ?? 0);
}

/**
 * Sum expected_pnl from production_trades for the given trading date.
 */
async function fetchExpectedPnl(date: Date): Promise<number> {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayEnd   = new Date(dayStart.getTime() + 86_400_000);

  const rows = await db
    .select({ total: sum(productionTrades.expectedPnl) })
    .from(productionTrades)
    .where(
      and(
        gte(productionTrades.barTimestamp, dayStart),
        lt(productionTrades.barTimestamp, dayEnd)
      )
    );

  return Number(rows[0]?.total ?? 0);
}

/**
 * Fetch traderspost and tradovate proxy counts for the given date.
 *
 * M-7 CONSOLIDATION: Both sources currently read production_trades row count (1:1
 * proxy) because independent APIs are not yet wired (see F-7 GAP below).
 * Running a single SQL query avoids redundant DB round-trips while maintaining
 * semantic separation: once Phase 4C wires real webhook-confirm IDs and fill IDs,
 * the two functions below can query distinct columns independently.
 *
 * F-7 GAP: TradersPost does not expose a public order-status polling API.
 * Order confirmation is delivered as a webhook callback (TradersPost → Trading Forge),
 * not as a queryable REST endpoint. True reconciliation requires:
 *
 *   Option A (implemented): Count production_trades rows written by broker-router.ts
 *     when routeOrder() calls submitWebhookOrder(). This is a sent-count, not a
 *     confirmed-fill-count — mismatches only surface if paper-execution-service
 *     wrote the trade row but submitWebhookOrder() silently dropped it.
 *
 *   Option B (TODO — next session): Implement a TradersPost webhook consumer endpoint
 *     POST /api/traderspost/order-status that receives their outbound confirmation
 *     callbacks, and write a confirmed_at timestamp into production_trades.
 *     This would close the reconciliation loop: sent_count === confirmed_count.
 *     Reference: https://traderspost.io/docs/webhooks#order-callbacks
 *     Migration needed: production_trades.traderspost_confirmed_at (nullable timestamptz)
 *
 * Until Option B is implemented, traderspostLogCount === productionTradesCount (1:1 proxy).
 * checkCoverage tracks how many of the 5 recon sources have INDEPENDENT data — right now
 * only 2 are independent (productionTrades DB + MFFU snapshot). When < 3 independent
 * sources are available, severity is floored at "yellow" (degraded reconciliation mode).
 */

/** How many of the 5 recon sources have truly independent data backing them. */
export const INDEPENDENT_SOURCE_COUNT = 2; // productionTrades + MFFU snapshot
/** Minimum independent sources before severity is clamped to at most "yellow". */
export const MIN_INDEPENDENT_SOURCES_FOR_RED = 3;

/**
 * deep-scan A: are the traderspost / tradovate COUNT legs independent of the
 * production_trades count?  Today they are 1:1 PROXIES (fetchTraderspostLogCount /
 * fetchTradovateFillsCount both return the shared production_trades count — see the
 * F-7 GAP docstring above), so count checks 1 & 2 would be self-comparisons that can
 * NEVER surface a mismatch. Recording those as "0 mismatches (pass)" overstates
 * assurance — it reads like a 3-way count reconciliation actually ran. This flag gates
 * checks 1 & 2 so they are SKIPPED (and recorded as not-independently-verifiable) until
 * Option B (a TradersPost webhook-confirm consumer writing traderspost_confirmed_at, or
 * live tradovate_fill_id under server-mediated execution) makes the legs genuinely
 * independent. Flip to `true` in the SAME change that wires the distinct-column queries.
 */
export const PROXY_COUNT_LEGS_INDEPENDENT = false;

async function fetchProxyCountsFromProductionTrades(date: Date): Promise<number> {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayEnd   = new Date(dayStart.getTime() + 86_400_000);

  const rows = await db
    .select({ cnt: count() })
    .from(productionTrades)
    .where(
      and(
        gte(productionTrades.barTimestamp, dayStart),
        lt(productionTrades.barTimestamp, dayEnd)
      )
    );

  return Number(rows[0]?.cnt ?? 0);
}

/** deep-scan A / Option B: the operator opts the traderspost leg into REAL independence
 *  (count of TradersPost-CONFIRMED rows) once the POST /api/traderspost/order-status webhook
 *  is wired and orders flow. Default false → proxy mode (unchanged). */
export function isTraderspostConfirmIndependent(): boolean {
  return process.env.RECON_TRADERSPOST_CONFIRM_INDEPENDENT === "true";
}

/** Option B: count production_trades rows TradersPost has confirmed (traderspost_confirmed_at
 *  IS NOT NULL) in the day window — a GENUINELY independent "confirmed" leg vs the server "sent"
 *  count. Migration 0197 adds the column; stamped by traderspost-confirm.ts. */
async function fetchTraderspostConfirmedCount(date: Date): Promise<number> {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const rows = await db
    .select({ cnt: count() })
    .from(productionTrades)
    .where(
      and(
        gte(productionTrades.barTimestamp, dayStart),
        lt(productionTrades.barTimestamp, dayEnd),
        sql`${productionTrades.traderspostConfirmedAt} IS NOT NULL`,
      ),
    );
  return Number(rows[0]?.cnt ?? 0);
}

/**
 * TradersPost log count. When RECON_TRADERSPOST_CONFIRM_INDEPENDENT=true (Option B webhook wired),
 * returns the genuinely-independent CONFIRMED count. Otherwise a 1:1 proxy of the production_trades
 * count (re-uses the caller's shared query result).
 */
async function fetchTraderspostLogCount(date: Date, sharedCount: number): Promise<number> {
  if (isTraderspostConfirmIndependent()) {
    return fetchTraderspostConfirmedCount(date);
  }
  return sharedCount;
}

/**
 * Proxy for Tradovate fills count. Until Phase 4C wires tradovate_fill_id,
 * returns the same productionTrades count (re-uses the shared query result supplied
 * by the caller).
 */
async function fetchTradovateFillsCount(date: Date, sharedCount: number): Promise<number> {
  // When tradovate_fill_id is populated, query that column instead.
  void date;
  return sharedCount;
}

/**
 * Read the latest MFFU Playwright snapshot PnL for the given date.
 *
 * MFFU dashboard snapshots are captured hourly by dashboard-snapshot-service.
 * In Phase 4B, we read the snapshot directory for the most recent MFFU capture.
 * In a future phase, the snapshot service can extract structured PnL from the
 * screenshot metadata. Until then, returns null (mismatch against null is skipped).
 *
 * The AbortSignal is passed from runDailyReconciliation's AbortController so the
 * 5-minute recon wall-clock can interrupt the Playwright session if it hangs.
 */
async function fetchMffuDashboardPnl(date: Date, signal?: AbortSignal): Promise<number | null> {
  // Attempt to trigger a fresh snapshot capture; if Playwright is unavailable,
  // fall back gracefully (returns null — mismatch against null is skipped).
  try {
    // Honour abort before launching Playwright.
    if (signal?.aborted) {
      throw signal.reason ?? new Error("recon_timeout");
    }
    const results = await runDashboardSnapshots();
    const mffuResult = results.find((r) => r.firmId === "mffu");

    if (!mffuResult || mffuResult.status !== "captured") {
      logger.debug(
        { date: date.toISOString(), status: mffuResult?.status },
        "reconciliation: MFFU snapshot not captured — PnL comparison skipped"
      );
      return null;
    }

    // Snapshot captured but structured PnL extraction requires Phase 4C wiring.
    // Return null until the Playwright scraper extracts the balance field.
    logger.debug(
      { date: date.toISOString() },
      "reconciliation: MFFU snapshot captured but PnL extraction not yet wired (Phase 4C)"
    );
    return null;
  } catch (err) {
    logger.warn(
      { err, date: date.toISOString() },
      "reconciliation: MFFU snapshot fetch failed — PnL comparison skipped"
    );
    return null;
  }
}

/**
 * Count TradingView markers for a given trading date (5th recon source).
 *
 * Aggregated across ALL accounts for the operator's instance.
 * Fails gracefully: returns null if the tradingview_markers table does not yet
 * exist (pre-Track-8 installs) so the 5th comparison is simply skipped.
 *
 * NOTE: this compares TOTAL marker count for the day across accounts, not per
 * account. For multi-account setups, this is a conservative check — a more
 * precise per-account reconciliation can be added in Phase 5C.
 */
async function fetchTradingviewMarkerCount(date: Date): Promise<number | null> {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayEnd   = new Date(dayStart.getTime() + 86_400_000);

  try {
    // Use raw SQL to be resilient if the table hasn't been migrated yet.
    const result = await db.execute<{ cnt: string }>(
      sql`SELECT COUNT(*) AS cnt
          FROM tradingview_markers
          WHERE bar_timestamp >= ${dayStart.toISOString()}
            AND bar_timestamp < ${dayEnd.toISOString()}`
    );
    return Number(result?.[0]?.cnt ?? 0);
  } catch (err) {
    // Table likely doesn't exist yet — skip this comparison gracefully.
    logger.debug(
      { date: date.toISOString(), err: err instanceof Error ? err.message : String(err) },
      "reconciliation: tradingview_markers count skipped (table may not exist yet)"
    );
    return null;
  }
}

// ─── Main recon logic ─────────────────────────────────────────────────────────

/**
 * Run daily reconciliation for `reconDate` (defaults to today ET).
 *
 * Returns the full ReconciliationResult and writes a daily_reconciliation row.
 * Fires alert + writes audit_log on mismatch or fail-CLOSED error.
 *
 * Fail-CLOSED contract:
 *   - Any data-fetch error → rethrows, caller writes a severity=red row with
 *     the error embedded in mismatch_details.
 */
export async function runDailyReconciliation(
  reconDate: Date = todayEt()
): Promise<ReconciliationResult> {
  const startedAt = Date.now();
  const reconRunId = randomUUID();
  const reconDateStr = reconDate.toISOString().slice(0, 10);

  logger.info(
    { reconDate: reconDateStr, reconRunId },
    "reconciliation: starting daily recon"
  );

  // ── 5-minute hard timeout (AbortController) ─────────────────────────────
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    logger.error(
      { reconDate: reconDateStr, timeoutMs: RECON_CONFIG.RECON_TIMEOUT_MS },
      "reconciliation: TIMEOUT — recon exceeded 5-minute wall-clock limit"
    );
    controller.abort(new Error("recon_timeout"));
  }, RECON_CONFIG.RECON_TIMEOUT_MS);

  try {
    // ── Fetch all five data sources ────────────────────────────────────────
    let productionTradesCount: number;
    let traderspostLogCount: number;
    let tradovateFillsCount: number;
    let mffuDashboardPnl: number | null;
    let expectedPnl: number;
    let tradingviewMarkerCount: number | null;

    try {
      // M-7: fetchProductionTradesCount is the single SQL query that backs both
      // the traderspost proxy and the tradovate proxy until Phase 4C wires real
      // IDs. The shared count is fetched once and passed to both proxy functions.
      let sharedProductionCount: number;
      [
        sharedProductionCount,
        mffuDashboardPnl,
        expectedPnl,
        tradingviewMarkerCount,
      ] = await Promise.all([
        fetchProxyCountsFromProductionTrades(reconDate),
        fetchMffuDashboardPnl(reconDate, controller.signal),
        fetchExpectedPnl(reconDate),
        fetchTradingviewMarkerCount(reconDate),
      ]);
      productionTradesCount = sharedProductionCount;
      traderspostLogCount = await fetchTraderspostLogCount(reconDate, sharedProductionCount);
      tradovateFillsCount = await fetchTradovateFillsCount(reconDate, sharedProductionCount);

      // If abort fired while Promise.all was in flight but didn't propagate
      // (DB queries don't honor AbortSignal), check now and bail cleanly.
      if (controller.signal.aborted) {
        throw controller.signal.reason ?? new Error("recon_timeout");
      }
    } catch (fetchErr) {
      // Re-classify timeout aborts so the fail-CLOSED path can log them accurately.
      const isTimeout =
        fetchErr instanceof Error && fetchErr.message === "recon_timeout";
      if (isTimeout) {
        logger.error(
          { reconDate: reconDateStr, timeoutMs: RECON_CONFIG.RECON_TIMEOUT_MS },
          "reconciliation: aborted by timeout signal — writing fail-CLOSED red row"
        );
      }
      // Fail-CLOSED: data fetch error → write severity=red row
      logger.error(
        { err: fetchErr, reconDate: reconDateStr },
        "reconciliation: data fetch error — writing fail-CLOSED severity=red row"
      );

      const failClosedResult = await writeReconRow({
        reconDate: reconDateStr,
        productionTradesCount: 0,
        traderspostLogCount: 0,
        tradovateFillsCount: 0,
        mffuDashboardPnl: null,
        expectedPnl: 0,
        tradingviewMarkerCount: null,
        mismatchCount: 1,
        mismatchDetails: [
          {
            source: "data_fetch",
            expected: "success",
            actual: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
          },
        ],
        severity: "red",
        alertFired: true,
        startedAt,
        correlationId: reconRunId,
      });

      await AlertFactory.criticalReconciliationMismatch(reconDateStr, 1, [
        {
          source: "data_fetch",
          expected: "success",
          actual: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
        },
      ]);

      return failClosedResult;
    }

    // ── Compare: build mismatch_details ───────────────────────────────────
    const mismatches: MismatchDetail[] = [];

    // ⚠ F-3 (confirmation-latency window — OPERATOR MUST ACCEPT BEFORE FLIPPING THE FLAG): check 1
    // is a strict same-day equality. A trade sent shortly before the recon run whose TradersPost
    // confirmation webhook hasn't landed yet would count as a transient sent≠confirmed mismatch
    // (timing, not a real breach). Typical webhook latency is seconds, but before setting
    // RECON_TRADERSPOST_CONFIRM_INDEPENDENT=true the operator must either accept this transient-alert
    // risk in writing OR add a grace window (exclude trades within N min of the recon boundary).
    // Check 1: production_trades (SENT) vs traderspost (CONFIRMED). deep-scan A / Option B:
    // when RECON_TRADERSPOST_CONFIRM_INDEPENDENT=true, traderspostLogCount is the genuinely
    // independent count of TradersPost-confirmed rows (traderspost_confirmed_at IS NOT NULL,
    // stamped by POST /api/traderspost/order-status) — a REAL sent-vs-confirmed reconciliation.
    // Otherwise the leg is a 1:1 proxy of production_trades (self-comparison → fake pass), so the
    // check is skipped and logged rather than silently "passing".
    const traderspostConfirmIndependent = isTraderspostConfirmIndependent();
    if (traderspostConfirmIndependent || PROXY_COUNT_LEGS_INDEPENDENT) {
      if (productionTradesCount !== traderspostLogCount) {
        mismatches.push({
          source: traderspostConfirmIndependent
            ? "production_trades_vs_traderspost_confirmed"
            : "production_trades_vs_traderspost",
          expected: productionTradesCount,
          actual: traderspostLogCount,
          delta: traderspostLogCount - productionTradesCount,
        });
      }
    } else {
      logger.info(
        { productionTradesCount },
        "reconciliation: count check 1 SKIPPED — traderspost leg is a proxy of production_trades. " +
          "Wire the Option-B webhook (POST /api/traderspost/order-status) and set " +
          "RECON_TRADERSPOST_CONFIRM_INDEPENDENT=true post go-live to make it a real sent-vs-confirmed check.",
      );
    }

    // Check 2: traderspost vs tradovate_fills — STILL a proxy (tradovate fill IDs need SME/live
    // fill population), so gated on PROXY_COUNT_LEGS_INDEPENDENT only.
    if (PROXY_COUNT_LEGS_INDEPENDENT) {
      if (traderspostLogCount !== tradovateFillsCount) {
        mismatches.push({
          source: "traderspost_vs_tradovate_fills",
          expected: traderspostLogCount,
          actual: tradovateFillsCount,
          delta: tradovateFillsCount - traderspostLogCount,
        });
      }
    }

    // Check 3: tradovate_fills.pnl ≈ mffu_dashboard_pnl (within tolerance)
    // Skip if mffu_dashboard_pnl is null (not yet wired or snapshot failed)
    if (mffuDashboardPnl !== null) {
      const pnlDelta = Math.abs(mffuDashboardPnl - expectedPnl);
      if (pnlDelta > RECON_CONFIG.PNL_TOLERANCE_DOLLARS) {
        mismatches.push({
          source: "pnl_mffu_vs_expected",
          expected: expectedPnl,
          actual: mffuDashboardPnl,
          delta: mffuDashboardPnl - expectedPnl,
        });
      }
    }

    // Check 4: expected_pnl from production_trades ≈ actual_pnl (self-consistency)
    // (actual_pnl populated by Phase 4C broker confirms; until then, skip)

    // Check 5: tradingview_markers.count === traderspost_log.count (Track 8)
    // Detects "Pine alert fired but TradersPost never received the webhook"
    // within minutes instead of 24 hours (Tradovate fill discrepancy path).
    //
    // Mismatch interpretation:
    //   markerCount > traderspostCount → webhook delivery failure (Pine fired, TP didn't receive)
    //   markerCount < traderspostCount → manual override or duplicate delivery
    //
    // Skip when tradingviewMarkerCount is null (table not yet migrated).
    if (tradingviewMarkerCount !== null) {
      if (tradingviewMarkerCount !== traderspostLogCount) {
        const delta = tradingviewMarkerCount - traderspostLogCount;
        const absDelta = Math.abs(delta);
        const interpretation = delta > 0
          ? `Pine fired ${tradingviewMarkerCount} alerts but TradersPost shows only ${traderspostLogCount} — webhook delivery failure likely`
          : `TradersPost shows ${traderspostLogCount} orders but only ${tradingviewMarkerCount} Pine marker(s) — manual override or duplicate`;

        mismatches.push({
          source: "tradingview_marker_vs_traderspost_log",
          expected: tradingviewMarkerCount,
          actual: traderspostLogCount,
          delta,
        });

        logger.warn(
          {
            reconDate: reconDateStr,
            tradingviewMarkerCount,
            traderspostLogCount,
            delta,
            severity: absDelta > 1 ? "critical" : "warning",
            interpretation,
          },
          "reconciliation: tradingview_markers vs traderspost_log mismatch"
        );
      }
    }

    // ── Derive severity ────────────────────────────────────────────────────
    const mismatchCount = mismatches.length;
    // Deep-Scan #18b X-1 (2026-07-05): "green" must mean VERIFIED agreement, not the
    // all-zeros tautology. production_trades has no writer wired (Phase 4C incomplete),
    // so productionTradesCount is structurally always 0; when every source is empty the
    // reconciliation verified NOTHING — reporting green off 0/0/0/null was a false-green
    // on the operator's primary ProductionStatusPanel (the panel §3 tells the operator to
    // trust). Require ≥1 independent source to have actually produced data before a
    // zero-mismatch run can be called green; otherwise it is UNVERIFIABLE → yellow
    // (degraded), never green. Green becomes meaningful again once the production_trades
    // writers are wired (X-1 fix sketch option a) or a real broker source produces rows.
    const hasVerifiableData =
      productionTradesCount > 0 ||
      traderspostLogCount > 0 ||
      tradovateFillsCount > 0 ||
      (tradingviewMarkerCount !== null && tradingviewMarkerCount > 0) ||
      mffuDashboardPnl !== null;
    // deep-scan A / Option B fix (F-1): effective independent-source count includes the TradersPost
    // CONFIRMED leg when Option B is wired (RECON_TRADERSPOST_CONFIRM_INDEPENDENT=true), so the
    // degraded clamp lifts and a genuine sent-vs-confirmed breach reaches RED instead of being
    // permanently capped at yellow.
    const effectiveIndependentSources =
      INDEPENDENT_SOURCE_COUNT + (isTraderspostConfirmIndependent() ? 1 : 0);
    const { severity: derivedSeverity, degraded } = deriveReconSeverity({
      mismatchCount,
      hasVerifiableData,
      effectiveIndependentSources,
      redMismatchCount: RECON_CONFIG.RED_MISMATCH_COUNT,
      minIndependentSourcesForRed: MIN_INDEPENDENT_SOURCES_FOR_RED,
    });
    let severity: ReconSeverity = derivedSeverity;
    if (mismatchCount === 0 && !hasVerifiableData) {
      logger.warn(
        {
          reconDate: reconDateStr,
          productionTradesCount,
          traderspostLogCount,
          tradovateFillsCount,
          tradingviewMarkerCount,
          mffuDashboardPnl,
        },
        "reconciliation UNVERIFIABLE — all data sources empty/null (production_trades has no writer wired); reporting yellow (degraded), NOT a confirmed-clean green"
      );
    }

    // Also red if mffu PnL delta > tolerance. deep-scan Observability re-cert F-1: this override runs
    // AFTER deriveReconSeverity, so it must respect the SAME independent-source bar the clamp enforces —
    // otherwise a MFFU-PnL delta against an unverified (empty production_trades) expected side would
    // report an unconfirmable RED. Force RED only with enough independent sources; in degraded mode
    // the disagreement still degrades a clean green to yellow, but never fabricates a red.
    if (
      mffuDashboardPnl !== null &&
      Math.abs(mffuDashboardPnl - expectedPnl) > RECON_CONFIG.PNL_TOLERANCE_DOLLARS
    ) {
      if (effectiveIndependentSources >= MIN_INDEPENDENT_SOURCES_FOR_RED) {
        severity = "red";
      } else if (severity === "green") {
        severity = "yellow"; // surface the MFFU disagreement without asserting an unverified red
      }
    }

    // Degraded-reconciliation mode (M-7 + ds21 Bands A+D). The CLAMP itself now lives in
    // deriveReconSeverity() above, keyed on the DYNAMIC effectiveIndependentSources (F-1 fix) — so
    // it correctly LIFTS once Option B is wired (3 independent sources) and a genuine breach can
    // reach red. Here we only LOG the degraded downgrade. Before Option B: traderspost/tradovate
    // counts are 1:1 proxies of production_trades (self-comparison can't mismatch), so red/green are
    // capped at yellow ("ran, but cannot independently confirm" — the honest state).
    if (degraded) {
      logger.warn(
        {
          reconDate: reconDateStr,
          effectiveIndependentSources,
          minRequired: MIN_INDEPENDENT_SOURCES_FOR_RED,
          downgradedSeverity: "yellow",
        },
        "reconciliation: degraded mode — insufficient independent sources; red/green capped at yellow " +
          "(wire the Option-B confirm webhook + set RECON_TRADERSPOST_CONFIRM_INDEPENDENT=true to lift this)"
      );
    }

    const alertFired = mismatchCount > 0;

    // ── Write daily_reconciliation row ─────────────────────────────────────
    const result = await writeReconRow({
      reconDate: reconDateStr,
      productionTradesCount,
      traderspostLogCount,
      tradovateFillsCount,
      mffuDashboardPnl,
      expectedPnl,
      tradingviewMarkerCount,
      mismatchCount,
      mismatchDetails: mismatches,
      severity,
      alertFired,
      startedAt,
      correlationId: reconRunId,
    });

    // ── Fire alert on mismatch ─────────────────────────────────────────────
    if (alertFired) {
      // deep-scan Observability #5: pass reconRunId so the Discord alert is traceable back to the
      // daily_reconciliation row + audit_log correlation chain (was dropped at this last hop).
      await AlertFactory.criticalReconciliationMismatch(reconDateStr, mismatchCount, mismatches, reconRunId);
    }

    logger.info(
      {
        reconDate: reconDateStr,
        severity,
        mismatchCount,
        durationMs: Date.now() - startedAt,
      },
      "reconciliation: daily recon complete"
    );

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Write recon row + audit_log ─────────────────────────────────────────────

interface WriteReconRowParams {
  reconDate: string;
  productionTradesCount: number;
  traderspostLogCount: number;
  tradovateFillsCount: number;
  mffuDashboardPnl: number | null;
  expectedPnl: number;
  // 5th source: may be null when tradingview_markers table is not yet present.
  tradingviewMarkerCount: number | null;
  mismatchCount: number;
  mismatchDetails: MismatchDetail[];
  severity: ReconSeverity;
  alertFired: boolean;
  startedAt: number;
  // Correlation ID linking all audit rows for this recon run.
  correlationId: string;
}

async function writeReconRow(params: WriteReconRowParams): Promise<ReconciliationResult> {
  const ranAt = new Date();
  const durationMs = Date.now() - params.startedAt;

  // Upsert (idempotent — UNIQUE on recon_date)
  await db
    .insert(dailyReconciliation)
    .values({
      reconDate: params.reconDate,
      productionTradesCount: params.productionTradesCount,
      traderspostLogCount: params.traderspostLogCount,
      tradovateFillsCount: params.tradovateFillsCount,
      mffuDashboardPnl: params.mffuDashboardPnl !== null ? String(params.mffuDashboardPnl) : null,
      expectedPnl: String(params.expectedPnl),
      mismatchCount: params.mismatchCount,
      mismatchDetails: params.mismatchDetails as unknown as Record<string, unknown>[],
      alertFired: params.alertFired,
      // ds21: persist the authoritative (clamped) severity so the read path can't
      // recompute a weaker false-green from mismatch_count alone.
      severity: params.severity,
      ranAt,
    })
    .onConflictDoUpdate({
      target: dailyReconciliation.reconDate,
      set: {
        productionTradesCount: params.productionTradesCount,
        traderspostLogCount: params.traderspostLogCount,
        tradovateFillsCount: params.tradovateFillsCount,
        mffuDashboardPnl: params.mffuDashboardPnl !== null ? String(params.mffuDashboardPnl) : null,
        expectedPnl: String(params.expectedPnl),
        mismatchCount: params.mismatchCount,
        mismatchDetails: params.mismatchDetails as unknown as Record<string, unknown>[],
        alertFired: params.alertFired,
        severity: params.severity,
        ranAt,
      },
    });

  // Audit log — non-blocking, fire-and-forget
  db.insert(auditLog)
    .values({
      action: "production.reconciliation.completed",
      entityType: "reconciliation",
      entityId: null,
      decisionAuthority: "system",
      input: {
        reconDate: params.reconDate,
      } as Record<string, unknown>,
      result: {
        severity: params.severity,
        mismatchCount: params.mismatchCount,
        productionTradesCount: params.productionTradesCount,
        traderspostLogCount: params.traderspostLogCount,
        tradovateFillsCount: params.tradovateFillsCount,
        mffuDashboardPnl: params.mffuDashboardPnl,
        expectedPnl: params.expectedPnl,
        tradingviewMarkerCount: params.tradingviewMarkerCount,
        alertFired: params.alertFired,
      } as Record<string, unknown>,
      status: params.severity === "red" ? "failure" : "success",
      durationMs,
      correlationId: params.correlationId,
    })
    .catch((err) =>
      logger.error({ err }, "reconciliation: audit_log write failed (non-blocking)")
    );

  // SSE event. deep-scan Observability re-cert F-2: carry correlationId so the SSE hop of the
  // bar→handler→DB→SSE→audit_log chain is traceable (Discord + audit already carry it; SSE was the
  // one hop still dropping it — a dashboard push can now be joined to its daily_reconciliation row).
  broadcastSSE("production:reconciliation-completed", {
    reconDate: params.reconDate,
    severity: params.severity,
    mismatchCount: params.mismatchCount,
    ranAt: ranAt.toISOString(),
    correlationId: params.correlationId,
  });

  return {
    reconDate: params.reconDate,
    productionTradesCount: params.productionTradesCount,
    traderspostLogCount: params.traderspostLogCount,
    tradovateFillsCount: params.tradovateFillsCount,
    mffuDashboardPnl: params.mffuDashboardPnl,
    expectedPnl: params.expectedPnl,
    tradingviewMarkerCount: params.tradingviewMarkerCount,
    mismatchCount: params.mismatchCount,
    mismatchDetails: params.mismatchDetails,
    severity: params.severity,
    alertFired: params.alertFired,
    ranAt,
  };
}

// ─── Status read ──────────────────────────────────────────────────────────────

/**
 * Read the most recent daily_reconciliation row for `date`.
 * Returns green/yellow/red + mismatch count.
 *
 * Used by GET /api/production/status (Q4 — last clean reconciliation).
 */
export async function getDailyReconciliationStatus(
  date: Date = todayEt()
): Promise<ReconciliationStatus> {
  const dateStr = date.toISOString().slice(0, 10);

  const rows = await db
    .select({
      reconDate: dailyReconciliation.reconDate,
      mismatchCount: dailyReconciliation.mismatchCount,
      // ds21: read the persisted authoritative severity (incl. the degraded-mode clamp).
      severity: dailyReconciliation.severity,
      ranAt: dailyReconciliation.ranAt,
    })
    .from(dailyReconciliation)
    .where(eq(dailyReconciliation.reconDate, dateStr))
    .limit(1);

  if (rows.length === 0) {
    return {
      reconDate: dateStr,
      severity: "red",   // Never ran → treat as worst-case
      mismatchCount: 0,
      ranAt: null,
    };
  }

  const row = rows[0];
  const mc = row.mismatchCount;
  // ds21 CRITICAL (deep-scan #21 Band D): prefer the PERSISTED severity written at run time.
  // Previously this recomputed severity from mismatch_count alone (green whenever mc===0),
  // which discarded the write-path degraded-mode clamp and resurrected the false-green the
  // compute path just closed (the primary ProductionStatusPanel reads through here). Only fall
  // back to the mismatch-count recompute for legacy rows written before the severity column
  // existed (severity === null).
  let severity: ReconSeverity;
  if (row.severity === "green" || row.severity === "yellow" || row.severity === "red") {
    severity = row.severity;
  } else {
    // Legacy row (no persisted severity) — recompute from mismatch count.
    severity = "green";
    if (mc >= RECON_CONFIG.RED_MISMATCH_COUNT) {
      severity = "red";
    } else if (mc >= RECON_CONFIG.YELLOW_MISMATCH_COUNT) {
      severity = "yellow";
    }
  }

  return {
    reconDate: row.reconDate,
    severity,
    mismatchCount: mc,
    ranAt: row.ranAt,
  };
}

// AlertFactory.criticalReconciliationMismatch is now a first-class method on
// AlertFactory in alert-service.ts (H-4 fix). No dynamic attachment needed.
