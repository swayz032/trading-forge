/**
 * C2 — Prop Firm Health Service (W15 Team B)
 *
 * Polls each prop firm's API every 15 minutes. On detecting an auth failure or
 * "suspended" response:
 *   1. Writes a prop_firm_health_checks row.
 *   2. Fires a high-severity alert.
 *   3. Emits SSE event "prop-firm:suspension-detected".
 *   4. Notifies paper-execution-service to block new orders for the affected firm.
 *
 * Firms tracked: Topstep, Apex, MFFU, TPT, FFN, Alpha, Tradeify, Earn2Trade.
 * Credentials: each firm's API key is read from env vars (TOPSTEP_API_KEY, etc.).
 * If no API key is configured, the check is skipped with a debug log.
 *
 * Background: Apex banned "enormous amount of profitable traders" May 2025 with
 * no warning. MyForexFunds froze funds 2023–2025. Anonymous traders denied payouts
 * citing VPN detection (unresolved 6+ months). This service detects suspension
 * early so open positions can be managed before assets are frozen.
 *
 * Pipeline pause guard: health checks run even when pipeline is paused — a suspended
 * firm is a risk event that should surface regardless of trading state.
 */

import { db } from "../db/index.js";
import { propFirmHealthChecks, auditLog } from "../db/schema.js";
import { desc, eq } from "drizzle-orm";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
import { AlertFactory } from "./alert-service.js";

// ─── Firm suspension state (process-local) ────────────────────────────────────
// Track which firms are currently suspended so paper engine can gate new orders.
const suspendedFirms = new Set<string>();

// ─── Suspension change callback ───────────────────────────────────────────────
type SuspensionNotifyFn = (firmId: string, suspended: boolean) => Promise<void>;
let _onSuspensionChange: SuspensionNotifyFn | null = null;

export function registerSuspensionChangeCallback(fn: SuspensionNotifyFn): void {
  _onSuspensionChange = fn;
}

// ─── Firm probe configuration ─────────────────────────────────────────────────
// Each firm has a lightweight health endpoint we can probe with our API key.
// This is NOT the trading API — just an account-status or portfolio endpoint
// that would return 401/403 if our credentials are revoked or account suspended.
//
// If a firm doesn't have a known probe URL, we skip that firm gracefully.
// All URLs are overridable via env vars for future proofing.

interface FirmProbeConfig {
  firmId: string;
  probeUrl: string;
  apiKeyEnv: string;
  headerName: string;
  suspendedStatusCodes: number[];
  suspendedBodyPatterns: string[];
}

const FIRM_PROBES: FirmProbeConfig[] = [
  {
    firmId: "apex",
    probeUrl: process.env.APEX_PROBE_URL ?? "https://api.apextraderfunding.com/v1/account",
    apiKeyEnv: "APEX_API_KEY",
    headerName: "Authorization",
    suspendedStatusCodes: [403, 401, 423],
    suspendedBodyPatterns: ["suspended", "banned", "terminated", "closed", "inactive"],
  },
  {
    firmId: "topstep",
    probeUrl: process.env.TOPSTEP_PROBE_URL ?? "https://api.topstep.com/v1/account",
    apiKeyEnv: "TOPSTEP_API_KEY",
    headerName: "Authorization",
    suspendedStatusCodes: [403, 401, 423],
    suspendedBodyPatterns: ["suspended", "banned", "terminated", "closed", "inactive"],
  },
  {
    firmId: "mffu",
    probeUrl: process.env.MFFU_PROBE_URL ?? "https://api.myforexfunds.com/v1/account",
    apiKeyEnv: "MFFU_API_KEY",
    headerName: "Authorization",
    suspendedStatusCodes: [403, 401, 423],
    suspendedBodyPatterns: ["suspended", "banned", "terminated", "frozen"],
  },
  {
    firmId: "tpt",
    probeUrl: process.env.TPT_PROBE_URL ?? "https://api.theprofit.trade/v1/account",
    apiKeyEnv: "TPT_API_KEY",
    headerName: "X-Api-Key",
    suspendedStatusCodes: [403, 401],
    suspendedBodyPatterns: ["suspended", "banned", "terminated"],
  },
  {
    firmId: "ffn",
    probeUrl: process.env.FFN_PROBE_URL ?? "https://api.fundednext.com/v1/account",
    apiKeyEnv: "FFN_API_KEY",
    headerName: "Authorization",
    suspendedStatusCodes: [403, 401, 423],
    suspendedBodyPatterns: ["suspended", "banned", "terminated"],
  },
  {
    firmId: "alpha",
    probeUrl: process.env.ALPHA_PROBE_URL ?? "https://api.alphafutures.io/v1/account",
    apiKeyEnv: "ALPHA_API_KEY",
    headerName: "X-Api-Key",
    suspendedStatusCodes: [403, 401],
    suspendedBodyPatterns: ["suspended", "banned", "terminated"],
  },
  {
    firmId: "tradeify",
    probeUrl: process.env.TRADEIFY_PROBE_URL ?? "https://api.tradeify.com/v1/account",
    apiKeyEnv: "TRADEIFY_API_KEY",
    headerName: "Authorization",
    suspendedStatusCodes: [403, 401, 423],
    suspendedBodyPatterns: ["suspended", "banned", "terminated"],
  },
  {
    firmId: "earn2trade",
    probeUrl: process.env.EARN2TRADE_PROBE_URL ?? "https://api.earn2trade.com/v1/account",
    apiKeyEnv: "EARN2TRADE_API_KEY",
    headerName: "Authorization",
    suspendedStatusCodes: [403, 401],
    suspendedBodyPatterns: ["suspended", "banned", "terminated"],
  },
];

const PROBE_TIMEOUT_MS = 10_000;

// ─── Single firm probe ────────────────────────────────────────────────────────

export interface FirmHealthResult {
  firmId: string;
  status: "healthy" | "degraded" | "suspended" | "auth_failure" | "unreachable" | "skipped";
  responseCode?: number;
  responseBodySnippet?: string;
  alertFired: boolean;
}

async function probeFirm(config: FirmProbeConfig): Promise<FirmHealthResult> {
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    logger.debug({ firmId: config.firmId, env: config.apiKeyEnv }, "prop-firm-health: no API key configured — skipping probe");
    return { firmId: config.firmId, status: "skipped", alertFired: false };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const headerValue = apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
    const resp = await fetch(config.probeUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        [config.headerName]: headerValue,
        "User-Agent": "TradingForge-HealthCheck/1.0",
      },
    });
    clearTimeout(timeout);

    const bodyText = await resp.text().catch(() => "");
    const snippet = bodyText.slice(0, 500);
    const bodyLower = snippet.toLowerCase();

    // Check for suspension indicators in status code
    const isSuspendedCode = config.suspendedStatusCodes.includes(resp.status);
    // Check for suspension keywords in body
    const hasSuspendedBody = config.suspendedBodyPatterns.some(p => bodyLower.includes(p));

    let status: FirmHealthResult["status"];
    if (resp.status === 200 && !hasSuspendedBody) {
      status = "healthy";
    } else if (resp.status === 401 || (resp.status === 403 && !hasSuspendedBody)) {
      status = "auth_failure";
    } else if (isSuspendedCode || hasSuspendedBody) {
      status = "suspended";
    } else if (resp.status >= 500) {
      status = "degraded";
    } else {
      status = "degraded";
    }

    const alertFired = status === "suspended" || status === "auth_failure";
    return { firmId: config.firmId, status, responseCode: resp.status, responseBodySnippet: snippet, alertFired };
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err instanceof Error && err.name === "AbortError";
    const msg = isAbort ? "timeout" : (err instanceof Error ? err.message : String(err));
    return {
      firmId: config.firmId,
      status: "unreachable",
      responseBodySnippet: msg,
      alertFired: false, // transient network error ≠ suspension; alert only on repeated failures
    };
  }
}

// ─── Main poll function (called by scheduler every 15 min) ───────────────────

export async function pollPropFirmHealth(): Promise<FirmHealthResult[]> {
  const results: FirmHealthResult[] = [];

  for (const config of FIRM_PROBES) {
    const result = await probeFirm(config);
    results.push(result);

    if (result.status === "skipped") continue;

    // Persist health check row
    try {
      await db.insert(propFirmHealthChecks).values({
        firmId: result.firmId,
        checkedAt: new Date(),
        status: result.status,
        responseCode: result.responseCode ?? null,
        responseBodySnippet: result.responseBodySnippet ?? null,
        alertFired: result.alertFired,
      });
    } catch (dbErr) {
      logger.error({ err: dbErr, firmId: result.firmId }, "prop-firm-health: failed to persist health check row");
    }

    const wasSuspended = suspendedFirms.has(result.firmId);

    if ((result.status === "suspended" || result.status === "auth_failure") && !wasSuspended) {
      // ── New suspension detected ──────────────────────────────────────────
      suspendedFirms.add(result.firmId);

      logger.error(
        { firmId: result.firmId, status: result.status, responseCode: result.responseCode, snippet: result.responseBodySnippet?.slice(0, 200) },
        `C2 prop firm suspension detected: ${result.firmId} — blocking new orders`,
      );

      // High-severity alert (user sees this immediately)
      AlertFactory.systemError(
        `prop-firm-suspension-${result.firmId}`,
        new Error(
          `Prop firm ${result.firmId.toUpperCase()} returned ${result.status} (HTTP ${result.responseCode ?? "?"}). ` +
          `Possible account suspension or API credentials revoked. ` +
          `New orders BLOCKED. Review account dashboard immediately. ` +
          `Run dashboard-snapshot-service to capture evidence.`,
        ),
      );

      // SSE broadcast
      broadcastSSE("prop-firm:suspension-detected", {
        firmId: result.firmId,
        status: result.status,
        responseCode: result.responseCode,
        snippet: result.responseBodySnippet?.slice(0, 200),
      });

      // Notify paper engine
      if (_onSuspensionChange) {
        try {
          await _onSuspensionChange(result.firmId, true);
        } catch (engineErr) {
          logger.error({ err: engineErr, firmId: result.firmId }, "prop-firm-health: engine suspension callback failed");
        }
      }

      // Audit log
      await db.insert(auditLog).values({
        action: "prop_firm.suspension_detected",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { firmId: result.firmId, status: result.status, responseCode: result.responseCode } as Record<string, unknown>,
        result: { ordersBlocked: true, alertFired: true } as Record<string, unknown>,
        status: "success",
        correlationId: null,
      }).catch((err) => logger.error({ err }, "prop-firm-health: audit log write failed (non-blocking)"));

    } else if (result.status === "healthy" && wasSuspended) {
      // ── Suspension cleared ───────────────────────────────────────────────
      suspendedFirms.delete(result.firmId);

      logger.info({ firmId: result.firmId }, "C2 prop firm health restored — lifting order block");

      broadcastSSE("prop-firm:suspension-cleared", { firmId: result.firmId });

      if (_onSuspensionChange) {
        try {
          await _onSuspensionChange(result.firmId, false);
        } catch (engineErr) {
          logger.error({ err: engineErr, firmId: result.firmId }, "prop-firm-health: engine clear callback failed");
        }
      }

      await db.insert(auditLog).values({
        action: "prop_firm.suspension_cleared",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { firmId: result.firmId } as Record<string, unknown>,
        result: { ordersBlocked: false } as Record<string, unknown>,
        status: "success",
        correlationId: null,
      }).catch((err) => logger.error({ err }, "prop-firm-health: audit log write failed (non-blocking)"));
    }
  }

  return results;
}

/**
 * Query whether a firm is currently suspended.
 * Used by paper-execution-service as a last-line gate.
 */
export function isFirmSuspended(firmId: string): boolean {
  return suspendedFirms.has(firmId);
}

/**
 * Get all currently suspended firms (admin / health endpoint).
 */
export function getSuspendedFirms(): string[] {
  return [...suspendedFirms];
}

/**
 * Startup reconciliation: load the most recent check per firm and
 * re-hydrate in-memory suspension state. Protects against restart data loss.
 */
export async function reconcileSuspensionState(): Promise<void> {
  try {
    // For each firm, get the latest health check row
    for (const config of FIRM_PROBES) {
      const [latest] = await db
        .select({ status: propFirmHealthChecks.status })
        .from(propFirmHealthChecks)
        .where(eq(propFirmHealthChecks.firmId, config.firmId))
        .orderBy(desc(propFirmHealthChecks.checkedAt))
        .limit(1);

      if (latest && (latest.status === "suspended" || latest.status === "auth_failure")) {
        suspendedFirms.add(config.firmId);
        logger.warn({ firmId: config.firmId, status: latest.status }, "prop-firm-health: startup reconciliation — firm still shows suspended");
      }
    }
  } catch (err) {
    logger.error({ err }, "prop-firm-health: startup reconciliation failed");
  }
}

/**
 * Test/admin hook — simulate a suspension for a firm.
 */
export async function simulateSuspension(firmId: string): Promise<void> {
  if (suspendedFirms.has(firmId)) return;
  suspendedFirms.add(firmId);

  await db.insert(propFirmHealthChecks).values({
    firmId,
    checkedAt: new Date(),
    status: "suspended",
    responseCode: 403,
    responseBodySnippet: "[SIMULATED] suspended",
    alertFired: true,
  }).catch((err) => logger.error({ err }, "prop-firm-health: simulate suspension DB write failed"));

  broadcastSSE("prop-firm:suspension-detected", { firmId, status: "suspended", simulated: true });

  if (_onSuspensionChange) {
    await _onSuspensionChange(firmId, true).catch((err) => logger.error({ err }, "simulateSuspension engine callback failed"));
  }

  await db.insert(auditLog).values({
    action: "prop_firm.suspension_simulated",
    entityType: "system",
    entityId: null,
    decisionAuthority: "human_admin",
    input: { firmId } as Record<string, unknown>,
    result: { ordersBlocked: true } as Record<string, unknown>,
    status: "success",
    correlationId: null,
  }).catch(() => {});
}

/**
 * Test/admin hook — clear a simulated suspension.
 */
export async function clearSimulatedSuspension(firmId: string): Promise<void> {
  suspendedFirms.delete(firmId);
  broadcastSSE("prop-firm:suspension-cleared", { firmId, simulated: true });
  if (_onSuspensionChange) {
    await _onSuspensionChange(firmId, false).catch(() => {});
  }
}
