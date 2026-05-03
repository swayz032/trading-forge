/**
 * C1 — CME Exchange Status Service (W15 Team B)
 *
 * Polls the CME status feed every 60 seconds. On detecting an outage:
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
 * CME official status: https://www.cmegroup.com/technical/messaging-status.html
 * Fall-back: if the HTTP fetch fails, the service fails CLOSED — outage state is
 * preserved (no false clearance) and an alert is fired.
 *
 * Pipeline pause guard: this service continues to run when the pipeline is paused
 * because outage state is a safety signal, not a trading signal.
 */

import { db } from "../db/index.js";
import { exchangeOutages, auditLog } from "../db/schema.js";
import { eq, isNull, and } from "drizzle-orm";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
import { AlertFactory } from "./alert-service.js";

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
 * Probe the CME status endpoint.
 * Returns operational=true when the exchange is open for business.
 * Fails CLOSED on fetch error (returns operational=false).
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

    // Non-200 HTTP response — treat as outage.
    return {
      exchange: "CME",
      operational: false,
      reason: `CME status HTTP ${resp.status}`,
    };
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err instanceof Error && err.name === "AbortError";
    const fetchError = isAbort ? "Request timed out" : (err instanceof Error ? err.message : String(err));
    return {
      exchange: "CME",
      operational: false,
      fetchError,
      reason: `CME status fetch failed: ${fetchError}`,
    };
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
  const result = await checkCmeStatus();
  const isOutageActive = activeOutageIds.has("CME");

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
    await db.insert(auditLog).values({
      action: "exchange.outage_detected",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { exchange: "CME", reason: result.reason, fetchError: result.fetchError } as Record<string, unknown>,
      result: { outageId, responseTaken: engineResponse } as Record<string, unknown>,
      status: "success",
      correlationId: null,
    }).catch((err) => logger.error({ err }, "exchange-status: audit log write failed (non-blocking)"));

    // SSE broadcast
    broadcastSSE("exchange:outage-detected", {
      exchange: "CME",
      reason: result.reason,
      affectedSymbols: CME_GLOBEX_SYMBOLS,
      outageId,
    });

    // Alert (critical — directly actionable)
    AlertFactory.systemError(
      "cme-outage-detected",
      new Error(`CME exchange outage detected: ${result.reason ?? "probe failed"}. New entries blocked. Open positions held. DO NOT auto-reissue orders on resume — manual review required.`),
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
    await db.insert(auditLog).values({
      action: "exchange.outage_resolved",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { exchange: "CME", outageId } as Record<string, unknown>,
      result: { endedAt: new Date().toISOString(), auto_reissue: false } as Record<string, unknown>,
      status: "success",
      correlationId: null,
    }).catch((err) => logger.error({ err }, "exchange-status: audit log write failed (non-blocking)"));

    // SSE broadcast
    broadcastSSE("exchange:outage-resolved", {
      exchange: "CME",
      outageId,
      note: "Entry block lifted. Open positions held. Orders NOT auto-reissued — manual review required.",
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
      .catch(() => {});
  }

  broadcastSSE("exchange:outage-detected", {
    exchange,
    reason: `[SIMULATED] ${reason}`,
    affectedSymbols,
    outageId,
  });

  await db.insert(auditLog).values({
    action: "exchange.outage_simulated",
    entityType: "system",
    entityId: null,
    decisionAuthority: "human_admin",
    input: { exchange, reason, affectedSymbols } as Record<string, unknown>,
    result: { outageId } as Record<string, unknown>,
    status: "success",
    correlationId: null,
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

  await db.insert(auditLog).values({
    action: "exchange.outage_resolved",
    entityType: "system",
    entityId: null,
    decisionAuthority: "human_admin",
    input: { exchange, outageId } as Record<string, unknown>,
    result: { endedAt: new Date().toISOString(), auto_reissue: false } as Record<string, unknown>,
    status: "success",
    correlationId: null,
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
