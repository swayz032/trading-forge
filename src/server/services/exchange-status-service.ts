/**
 * C1 — CME Exchange Status Service (W15 Team B)
 * C4 — Broker API Connectivity Monitoring export (W16 Team A)
 *
 * C1: Polls the CME status feed every 60 seconds. On detecting an outage:
 *   1. Writes an exchange_outages row.
 *   2. Emits SSE event "exchange:outage-detected".
 *   3. Calls paper-execution-service to cancel pending orders and block entries.
 *   4. Logs open positions (held, not closed — manual review required).
 *
 * On resume:
 *   1. Closes the exchange_outages row (sets ended_at).
 *   2. Emits SSE event "exchange:outage-resolved".
 *   3. Calls paper-execution-service to lift the entry block.
 *   4. Does NOT auto-reissue queued orders — manual review required.
 *      Lesson from Nov 28 2025: bots that auto-reissued caused severe slippage on resume.
 *
 * C4: Also exports checkBrokerConnectivity() which probes Tradovate API reachability.
 * Called by network-failover.ts to distinguish "ISP down" from "broker-side outage".
 * Read-only: does not affect order routing or paper execution.
 *
 * CME official status: https://www.cmegroup.com/technical/messaging-status.html
 * Fall-back: if the HTTP fetch fails, the service fails CLOSED — outage state is
 * preserved (no false clearance) and an alert is fired.
 *
 * Pipeline pause guard: this service continues to run when the pipeline is paused
 * because outage state is a safety signal, not a trading signal.
 */

import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { exchangeOutages } from "../db/schema.js";
import { eq, isNull, and } from "drizzle-orm";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
import { AlertFactory } from "./alert-service.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";

// ─── CME outage state (process-local) ────────────────────────────────────────
// Track active outage IDs per exchange so we can close them on resume.
// In-memory: single-instance paper engine, no distributed state needed.
const activeOutageIds = new Map<string, string>(); // exchange → outage row UUID

// Notify paper engine on state changes. Imported lazily to avoid circular deps.
type OutageNotifyFn = (exchange: string, isActive: boolean, affectedSymbols: string[]) => Promise<void>;
let _onOutageChange: OutageNotifyFn | null = null;

/**
 * Register the paper engine callback for outage state changes.
 * Called once from paper-execution-service.ts at module init time.
 */
export function registerOutageChangeCallback(fn: OutageNotifyFn): void {
  _onOutageChange = fn;
}

// ─── C4: Broker API connectivity check ───────────────────────────────────────
// Probes Tradovate (primary broker) to determine whether broker APIs are reachable.
// This is distinct from CME venue status (C1): broker API reachability and
// exchange venue availability are independent signals.
// network-failover.ts calls this to distinguish "ISP down" from "broker-side incident".

const TRADOVATE_PROBE_URL =
  process.env.TRADOVATE_STATUS_URL ??
  "https://live.tradovateapi.com/v1/auth/accesstokenrequest";
const BROKER_PROBE_TIMEOUT_MS = 8_000;

export interface BrokerConnectivityResult {
  tradovate: { reachable: boolean; reason?: string };
  overallReachable: boolean;
  classification: "healthy" | "broker_unreachable";
  reason?: string;
}

/**
 * C4: Probe Tradovate API reachability.
 * HEAD request only — no auth required, no account side effects.
 * Returns overallReachable=true if Tradovate responds (any HTTP status).
 * Returns overallReachable=false on network error or timeout.
 */
export async function checkBrokerConnectivity(): Promise<BrokerConnectivityResult> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), BROKER_PROBE_TIMEOUT_MS);
  try {
    await fetch(TRADOVATE_PROBE_URL, { method: "HEAD", signal: ctrl.signal });
    clearTimeout(tid);
    return {
      tradovate: { reachable: true },
      overallReachable: true,
      classification: "healthy",
    };
  } catch (err) {
    clearTimeout(tid);
    const isAbort = err instanceof Error && err.name === "AbortError";
    const reason = isAbort
      ? `probe timed out (${BROKER_PROBE_TIMEOUT_MS}ms)`
      : (err instanceof Error ? err.message : String(err));
    return {
      tradovate: { reachable: false, reason },
      overallReachable: false,
      classification: "broker_unreachable",
      reason: `Tradovate probe failed: ${reason}`,
    };
  }
}

// ─── CME status fetch ─────────────────────────────────────────────────────────
// CME does not have a free, machine-readable status JSON endpoint.
// We probe a known CME API endpoint (market data heartbeat) and treat
// non-2xx / connection failure as potential outage. This is a best-effort
// availability probe — real production would subscribe to CME's official
// FIX/MDP3 channel drop detection. For paper trading this probe is sufficient.
//
// The probe URL is the CME Group's public data-services health endpoint.
// Response: 200 = operational, 503/504/connection-error = degraded/halted.

const CME_PROBE_URL = process.env.CME_STATUS_URL ?? "https://www.cmegroup.com/CmeWS/mvc/Venue/GLOBEX/status";
const CME_PROBE_TIMEOUT_MS = 10_000;

// CME symbols affected during a venue-level outage (all markets on GLOBEX).
const CME_GLOBEX_SYMBOLS = ["MES", "MNQ", "MCL", "ES", "NQ", "CL", "GC", "SI", "ZB", "ZN"];

export interface ExchangeStatusResult {
  exchange: string;
  operational: boolean;
  reason?: string;
  fetchError?: string;
}

/**
 * C1 fix 2026-07-11 (ratify packet 1): the CME venue-status page
 * (`cmegroup.com/CmeWS/...`) is bot-blocked (403/000/timeout — verified), so the
 * OLD behavior (any venue-probe transport failure → treat as CME outage) opened a
 * phantom outage on EVERY 60s poll → 80 stale rows → C1 hard-blocked every paper
 * entry on boot. A bot-blocked marketing page is NOT evidence CME Globex is halted.
 *
 * New contract: a venue-probe TRANSPORT failure (non-200 / connection error /
 * timeout) no longer opens an outage by itself — it corroborates against the
 * BROKER-reachability probe (Tradovate, the path orders actually route through):
 *   • broker reachable  → operational=true  (no outage — fixes the phantom)
 *   • broker UNREACHABLE → operational=false (fail-CLOSED on the signal that
 *     actually blocks trading for a Tradovate day-trader)
 * An affirmative venue "degraded/halted" (200 + status body) STILL opens an outage
 * (belt-and-suspenders if the status page ever becomes reachable).
 *
 * OPERATOR NOTE (flagged for veto): this shifts the C1 primary signal from
 * "CME venue-status page" to "broker reachability". A genuine CME venue halt while
 * Tradovate's API stays up would NOT open a C1 outage — that residual is covered by
 * broker order-rejection handling + C2 firm-suspension + the 15:55 flatten. Point
 * `CME_STATUS_URL` at a working venue-status source to restore affirmative venue
 * detection.
 */
async function corroborateVenueProbeFailureWithBroker(venueReason: string): Promise<ExchangeStatusResult> {
  try {
    const broker = await checkBrokerConnectivity();
    if (broker.overallReachable) {
      // Venue status-page unreachable, but the broker (order path) IS reachable →
      // NOT an outage. This is the phantom-block fix.
      logger.debug(
        { venueReason },
        "exchange-status: CME venue probe unreachable but broker reachable — treating as operational (no phantom outage)",
      );
      return { exchange: "CME", operational: true };
    }
    // Broker unreachable too → real routing failure → fail-CLOSED (open outage).
    return {
      exchange: "CME",
      operational: false,
      reason: `Broker (Tradovate) unreachable + CME venue probe failed (${venueReason})`,
    };
  } catch (brokerErr) {
    // Broker probe itself threw → fail-CLOSED (conservative).
    const msg = brokerErr instanceof Error ? brokerErr.message : String(brokerErr);
    return {
      exchange: "CME",
      operational: false,
      reason: `Broker corroboration probe errored (${msg}); CME venue probe failed (${venueReason})`,
    };
  }
}

/**
 * Probe the CME status endpoint, corroborating a venue-probe transport failure with
 * broker reachability (see corroborateVenueProbeFailureWithBroker). An affirmative
 * venue "degraded/halted" opens an outage directly; a transport failure defers to
 * the broker probe. Fails CLOSED only when the BROKER is unreachable.
 */
export async function checkCmeStatus(): Promise<ExchangeStatusResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CME_PROBE_TIMEOUT_MS);

  try {
    const resp = await fetch(CME_PROBE_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeout);

    if (resp.status === 200) {
      // Try to parse — if CME returns a JSON status object, check the content.
      let body: Record<string, unknown> = {};
      try {
        body = await resp.json() as Record<string, unknown>;
      } catch {
        // Plain 200 with no JSON = treat as operational
        return { exchange: "CME", operational: true };
      }

      // CME status endpoint returns {"status": "operational"} or {"status": "degraded"}
      const status = typeof body.status === "string" ? body.status.toLowerCase() : "unknown";
      const operational = !["degraded", "outage", "halted", "incident"].includes(status);
      return {
        exchange: "CME",
        operational,
        reason: operational ? undefined : `CME reported status: ${status}`,
      };
    }

    // Non-200 HTTP response — venue status page unreachable (bot-block etc.).
    // C1 fix: corroborate with broker reachability instead of assuming outage.
    return await corroborateVenueProbeFailureWithBroker(`CME status HTTP ${resp.status}`);
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err instanceof Error && err.name === "AbortError";
    const fetchError = isAbort ? "Request timed out" : (err instanceof Error ? err.message : String(err));
    // C1 fix: venue-probe transport failure corroborates with the broker probe
    // rather than opening a phantom outage.
    return await corroborateVenueProbeFailureWithBroker(fetchError);
  }
}

/**
 * Main polling function — called by scheduler every 60 seconds.
 *
 * State machine:
 *   No active outage + probe OK   → no-op
 *   No active outage + probe FAIL → open outage, notify engine, alert
 *   Active outage + probe FAIL    → no-op (outage already recorded)
 *   Active outage + probe OK      → close outage, notify engine
 *
 * The fetch-error path fails CLOSED: a fetch failure is treated as an outage
 * because failing to detect an outage is worse than a false positive.
 */
export async function pollCmeStatus(): Promise<void> {
  const cronCorrelationId = randomUUID();
  const result = await checkCmeStatus();
  let isOutageActive = activeOutageIds.has("CME");

  // C1 fix 2026-07-11 (ratify packet 1): DB-aware dedup. The old dedup checked ONLY
  // the in-memory `activeOutageIds` map, so the boot-race (reconcileMissedRuns
  // catchup-runs this poll before reconcileOutageState() hydrates the map) inserted
  // a fresh row every boot — the 80-row accumulation. If we would open a NEW outage
  // but an open CME row already exists in the DB, adopt it into the map instead of
  // inserting a duplicate. (A partial unique index — migration 0199 — is the
  // belt-and-suspenders backstop at the DB level.)
  if (!result.operational && !isOutageActive) {
    try {
      const [existing] = await db
        .select({ id: exchangeOutages.id })
        .from(exchangeOutages)
        .where(and(eq(exchangeOutages.exchange, "CME"), isNull(exchangeOutages.endedAt)))
        .limit(1);
      if (existing?.id) {
        activeOutageIds.set("CME", existing.id);
        isOutageActive = true;
        logger.debug(
          { outageId: existing.id },
          "exchange-status: adopted existing open CME outage row (DB-aware dedup) — no duplicate inserted",
        );
      }
    } catch (dedupErr) {
      // Non-fatal: fall through to the unique-index-guarded insert below.
      logger.warn({ err: dedupErr }, "exchange-status: DB dedup check failed (non-fatal)");
    }
  }

  if (!result.operational && !isOutageActive) {
    // ── New outage detected ──────────────────────────────────────────────────
    logger.error(
      { exchange: "CME", reason: result.reason, fetchError: result.fetchError },
      "CME outage detected — blocking new entries, cancelling pending orders",
    );

    // Persist outage row
    let outageId: string | null = null;
    try {
      const [row] = await db.insert(exchangeOutages).values({
        exchange: "CME",
        startedAt: new Date(),
        reason: result.reason ?? result.fetchError ?? "status probe failed",
        affectedSymbols: CME_GLOBEX_SYMBOLS,
        responseTaken: "pending", // updated after engine response
      }).returning({ id: exchangeOutages.id });
      outageId = row?.id ?? null;
      if (outageId) activeOutageIds.set("CME", outageId);
    } catch (dbErr) {
      logger.error({ err: dbErr }, "exchange-status: failed to persist outage row");
    }

    // Notify paper engine
    let engineResponse = "engine_notified";
    if (_onOutageChange) {
      try {
        await _onOutageChange("CME", true, CME_GLOBEX_SYMBOLS);
      } catch (engineErr) {
        logger.error({ err: engineErr }, "exchange-status: paper engine outage callback failed");
        engineResponse = "engine_callback_failed";
      }
    }

    // Update responseTaken
    if (outageId) {
      try {
        await db.update(exchangeOutages)
          .set({ responseTaken: engineResponse })
          .where(eq(exchangeOutages.id, outageId));
      } catch {
        // Non-blocking
      }
    }

    // Audit log
    await insertAuditRow({
      action: "exchange.outage_detected",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { exchange: "CME", reason: result.reason, fetchError: result.fetchError } as Record<string, unknown>,
      result: { outageId, responseTaken: engineResponse } as Record<string, unknown>,
      status: "success",
      correlationId: cronCorrelationId,
    }).catch((err) => logger.error({ err }, "exchange-status: audit log write failed (non-blocking)"));

    // SSE broadcast — goalscan 2026-07-16: thread correlationId so a dashboard consumer can
    // join this event to its audit_log / exchange_outages row without timestamp-matching
    // (ds21 established this for kill-switch's production:mode-changed; it was never carried here).
    broadcastSSE("exchange:outage-detected", {
      exchange: "CME",
      reason: result.reason,
      affectedSymbols: CME_GLOBEX_SYMBOLS,
      outageId,
      correlationId: cronCorrelationId,
    });

    // Alert (critical — directly actionable). goalscan 2026-07-16: pass cronCorrelationId so the
    // Discord CRITICAL + alerts.metadata carry it (phone triage → audit_log grep).
    AlertFactory.systemError(
      "cme-outage-detected",
      new Error(`CME exchange outage detected: ${result.reason ?? "probe failed"}. New entries blocked. Open positions held. DO NOT auto-reissue orders on resume — manual review required.`),
      cronCorrelationId,
    );

  } else if (result.operational && isOutageActive) {
    // ── Outage resolved ──────────────────────────────────────────────────────
    const outageId = activeOutageIds.get("CME")!;
    logger.info(
      { exchange: "CME", outageId },
      "CME status restored — lifting entry block. Open positions held; orders NOT auto-reissued (manual review required).",
    );

    activeOutageIds.delete("CME");

    // Close outage row
    try {
      await db.update(exchangeOutages)
        .set({
          endedAt: new Date(),
          responseTaken: "entry_block_lifted_no_auto_reissue",
        })
        .where(eq(exchangeOutages.id, outageId));
    } catch (dbErr) {
      logger.error({ err: dbErr, outageId }, "exchange-status: failed to close outage row");
    }

    // Notify paper engine (resume)
    if (_onOutageChange) {
      try {
        await _onOutageChange("CME", false, CME_GLOBEX_SYMBOLS);
      } catch (engineErr) {
        logger.error({ err: engineErr }, "exchange-status: paper engine resume callback failed");
      }
    }

    // Audit log
    await insertAuditRow({
      action: "exchange.outage_resolved",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { exchange: "CME", outageId } as Record<string, unknown>,
      result: { endedAt: new Date().toISOString(), auto_reissue: false } as Record<string, unknown>,
      status: "success",
      correlationId: cronCorrelationId,
    }).catch((err) => logger.error({ err }, "exchange-status: audit log write failed (non-blocking)"));

    // SSE broadcast — goalscan 2026-07-16: correlationId for audit-trail join (see outage-detected above).
    broadcastSSE("exchange:outage-resolved", {
      exchange: "CME",
      outageId,
      note: "Entry block lifted. Open positions held. Orders NOT auto-reissued — manual review required.",
      correlationId: cronCorrelationId,
    });

  } else if (!result.operational && isOutageActive) {
    // Outage still ongoing — log at debug level to avoid log spam
    logger.debug({ exchange: "CME", reason: result.reason }, "CME outage still active");
  }
  // operational && !isOutageActive → healthy, no-op
}

/**
 * Query the current active outage state for a given exchange.
 * Used by paper-execution-service to gate new entries.
 */
export function isExchangeHalted(exchange: string): boolean {
  return activeOutageIds.has(exchange);
}

/**
 * Get all active outage IDs (for testing / admin endpoints).
 */
export function getActiveOutages(): Map<string, string> {
  return new Map(activeOutageIds);
}

/**
 * Test/admin hook — inject a simulated outage event without polling the real feed.
 * Fires the full state machine (DB write, SSE, engine callback, alert).
 * Used for C1 verification: "simulate CME outage event via test endpoint".
 */
export async function simulateOutage(exchange: string, reason: string, affectedSymbols: string[] = CME_GLOBEX_SYMBOLS): Promise<{ outageId: string | null }> {
  if (activeOutageIds.has(exchange)) {
    logger.warn({ exchange }, "simulateOutage called while outage already active — ignored");
    return { outageId: activeOutageIds.get(exchange) ?? null };
  }

  logger.info({ exchange, reason }, "exchange-status: simulating outage (test/admin)");

  let outageId: string | null = null;
  try {
    const [row] = await db.insert(exchangeOutages).values({
      exchange,
      startedAt: new Date(),
      reason: `[SIMULATED] ${reason}`,
      affectedSymbols,
      responseTaken: "pending",
    }).returning({ id: exchangeOutages.id });
    outageId = row?.id ?? null;
    if (outageId) activeOutageIds.set(exchange, outageId);
  } catch (dbErr) {
    logger.error({ err: dbErr }, "exchange-status: failed to persist simulated outage row");
  }

  if (_onOutageChange) {
    try {
      await _onOutageChange(exchange, true, affectedSymbols);
    } catch (engineErr) {
      logger.error({ err: engineErr }, "exchange-status: paper engine callback failed for simulated outage");
    }
  }

  if (outageId) {
    await db.update(exchangeOutages)
      .set({ responseTaken: "simulated_engine_notified" })
      .where(eq(exchangeOutages.id, outageId))
      .catch((dbErr: unknown) => logger.error({ err: dbErr, outageId }, "exchange-status: failed to update simulated outage responseTaken"));
  }

  broadcastSSE("exchange:outage-detected", {
    exchange,
    reason: `[SIMULATED] ${reason}`,
    affectedSymbols,
    outageId,
  });

  await insertAuditRow({
    action: "exchange.outage_simulated",
    entityType: "system",
    entityId: null,
    decisionAuthority: "human_admin",
    input: { exchange, reason, affectedSymbols } as Record<string, unknown>,
    result: { outageId } as Record<string, unknown>,
    status: "success",
    correlationId: randomUUID(),
  }).catch((err) => logger.error({ err }, "exchange-status: audit log write failed (non-blocking)"));

  return { outageId };
}

/**
 * Test/admin hook — resolve a simulated or real outage by exchange name.
 */
export async function resolveOutage(exchange: string): Promise<{ resolved: boolean }> {
  const outageId = activeOutageIds.get(exchange);
  if (!outageId) return { resolved: false };

  activeOutageIds.delete(exchange);

  try {
    await db.update(exchangeOutages)
      .set({ endedAt: new Date(), responseTaken: "manually_resolved" })
      .where(eq(exchangeOutages.id, outageId));
  } catch (dbErr) {
    logger.error({ err: dbErr }, "exchange-status: failed to resolve outage row");
  }

  if (_onOutageChange) {
    try {
      await _onOutageChange(exchange, false, CME_GLOBEX_SYMBOLS);
    } catch (engineErr) {
      logger.error({ err: engineErr }, "exchange-status: paper engine resume callback failed on manual resolve");
    }
  }

  broadcastSSE("exchange:outage-resolved", {
    exchange,
    outageId,
    note: "Manually resolved. Open positions held. Orders NOT auto-reissued.",
  });

  await insertAuditRow({
    action: "exchange.outage_resolved",
    entityType: "system",
    entityId: null,
    decisionAuthority: "human_admin",
    input: { exchange, outageId } as Record<string, unknown>,
    result: { endedAt: new Date().toISOString(), auto_reissue: false } as Record<string, unknown>,
    status: "success",
    correlationId: randomUUID(),
  }).catch((err) => logger.error({ err }, "exchange-status: audit log write failed (non-blocking)"));

  return { resolved: true };
}

/**
 * On-startup reconciliation: re-hydrate activeOutageIds from DB rows
 * where ended_at IS NULL. Protects against state loss after process restart.
 */
export async function reconcileOutageState(): Promise<void> {
  try {
    const activeRows = await db
      .select({ id: exchangeOutages.id, exchange: exchangeOutages.exchange })
      .from(exchangeOutages)
      .where(isNull(exchangeOutages.endedAt));

    for (const row of activeRows) {
      activeOutageIds.set(row.exchange, row.id);
      // Re-engage engine block for any exchange that was halted before restart
      if (_onOutageChange) {
        try {
          await _onOutageChange(row.exchange, true, CME_GLOBEX_SYMBOLS);
        } catch (err) {
          logger.error({ err, exchange: row.exchange }, "exchange-status: engine callback failed during startup reconciliation");
        }
      }
    }

    if (activeRows.length > 0) {
      logger.warn(
        { activeOutages: activeRows.map(r => r.exchange) },
        "exchange-status: startup reconciliation found active outages — entry block re-engaged",
      );
    }
  } catch (err) {
    logger.error({ err }, "exchange-status: startup reconciliation failed");
  }
}
