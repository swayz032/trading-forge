/**
 * Broker Router — Single source of truth for order routing.
 *
 * `routeOrder(accountId, signal)` looks up broker_accounts.broker_type and
 * dispatches to the appropriate broker integration. Today only the TradersPost
 * path actually fires; TopstepX returns a clear "not configured" stub.
 *
 * Fail-CLOSED contract:
 *   - Account not found        → { success: false, reason: "account_not_found" }
 *   - broker_type unknown      → { success: false, reason: "unknown_broker_type" }
 *   - Credential vault error   → { success: false, reason: "credential_load_error" }
 *   - Pipeline paused          → { success: false, reason: "pipeline_paused" }
 *   - Any unexpected error     → { success: false, reason: "internal_error" }
 *
 * Every route attempt (success or failure) writes one audit_log row and emits
 * one SSE event (broker:order_routed).
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLog, brokerAccounts } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { broadcastSSE } from "../routes/sse.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { loadBrokerCredentials } from "../lib/credential-loader.js";
import { submitWebhookOrder } from "../integrations/traderspost/client.js";
import { buildWebhookPayload } from "../integrations/traderspost/webhook-builder.js";
import type { WebhookSignal } from "../integrations/traderspost/webhook-builder.js";
import { notifyCritical } from "./notification-service.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type BrokerResultReason =
  | "account_not_found"
  | "unknown_broker_type"
  | "credential_load_error"
  | "pipeline_paused"
  | "topstepx_not_configured"
  | "internal_error"
  | "routed";

export interface BrokerResult {
  success: boolean;
  reason: BrokerResultReason;
  accountId: string;
  brokerType?: string;
  firmId?: string;
  statusCode?: number;
  responseBody?: unknown;
  error?: string;
}

// ─── SSE event name ───────────────────────────────────────────────────────────

export const BROKER_ORDER_ROUTED_EVENT = "broker:order_routed";

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function writeAuditLog(
  accountId: string,
  signal: WebhookSignal,
  result: BrokerResult,
  correlationId?: string | null,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action: "broker_router.route_order",
      entityType: "broker_account",
      entityId: null,
      decisionAuthority: "system",
      input: {
        accountId,
        ticker: signal.ticker,
        action: signal.action,
        orderType: signal.orderType ?? "market",
      } as Record<string, unknown>,
      result: {
        success: result.success,
        reason: result.reason,
        brokerType: result.brokerType,
        firmId: result.firmId,
        statusCode: result.statusCode,
        error: result.error,
      } as Record<string, unknown>,
      status: result.success ? "success" : "failure",
      correlationId: correlationId ?? null,
    });
  } catch (auditErr) {
    // Audit failure must never block the caller — log and continue
    logger.error({ auditErr, accountId }, "broker-router: failed to write audit log row (non-blocking)");
  }
}

// ─── Primary export ───────────────────────────────────────────────────────────

/**
 * Route an order to the appropriate broker integration.
 *
 * @param accountId     - UUID from broker_accounts.account_id
 * @param signal        - Normalized signal shape (see WebhookSignal)
 * @param correlationId - Optional trace ID propagated from the caller (Track 5
 *                        assignment → Track 6 Pine export → Track 8 marker).
 *                        Written to the audit_log row so all three events are
 *                        queryable by correlation_id.
 * @returns             BrokerResult — always resolves, never throws
 */
export async function routeOrder(
  accountId: string,
  signal: WebhookSignal,
  correlationId?: string | null,
): Promise<BrokerResult> {
  // ── Pipeline pause guard ────────────────────────────────────────────────────
  const active = await isPipelineActive().catch(() => false);
  if (!active) {
    const result: BrokerResult = {
      success: false,
      reason: "pipeline_paused",
      accountId,
    };
    broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...result, correlationId: correlationId ?? null });
    await writeAuditLog(accountId, signal, result, correlationId);
    return result;
  }

  // ── Account lookup ──────────────────────────────────────────────────────────
  let account: typeof brokerAccounts.$inferSelect | undefined;
  try {
    const rows = await db
      .select()
      .from(brokerAccounts)
      .where(eq(brokerAccounts.accountId, accountId))
      .limit(1);
    account = rows[0];
  } catch (err) {
    const result: BrokerResult = {
      success: false,
      reason: "internal_error",
      accountId,
      error: `Account lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    };
    logger.error({ err, accountId, correlationId }, "broker-router: account lookup error (fail-CLOSED)");
    broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...result, correlationId: correlationId ?? null });
    await writeAuditLog(accountId, signal, result, correlationId);
    return result;
  }

  if (!account) {
    const result: BrokerResult = {
      success: false,
      reason: "account_not_found",
      accountId,
    };
    logger.warn({ accountId, correlationId }, "broker-router: account not found (fail-CLOSED)");
    broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...result, correlationId: correlationId ?? null });
    await writeAuditLog(accountId, signal, result, correlationId);
    return result;
  }

  if (!account.enabled) {
    const result: BrokerResult = {
      success: false,
      reason: "account_not_found", // treat disabled same as not-found for security
      accountId,
      firmId: account.firmId,
      brokerType: account.brokerType,
      error: "account_disabled",
    };
    logger.warn({ accountId, firmId: account.firmId, correlationId }, "broker-router: account disabled (fail-CLOSED)");
    broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...result, correlationId: correlationId ?? null });
    await writeAuditLog(accountId, signal, result, correlationId);
    return result;
  }

  // ── Wave 10 Task 3C: Route-time safety clamp ─────────────────────────────────
  // Last-line defense: clamp signal.quantity to the firm's per-symbol contract
  // cap. paper-signal-service already applies this upstream, but any other code
  // path that calls routeOrder() directly (manual orders, future automation) must
  // also be protected. If the incoming quantity exceeds the firm cap, we clamp,
  // log a warning, and write a drift audit row — this indicates state drift from
  // the upstream sizing decision and is a real bug worth surfacing.
  //
  // We do NOT call computeRiskDerivedContracts() here because we don't have live
  // ATR or bar context at the broker-router level (it's a signal passthrough).
  // The firm-cap ceiling is the minimum safe guard we can enforce unconditionally.
  if (signal.quantity !== undefined && signal.quantity !== null && typeof signal.quantity === "number") {
    try {
      // Derive a per-firm cap. Firm contract caps: Topstep=15, MFFU=15 per docs.
      // Liquid micro default = 20 (CONTRACT_CAP_MAX from firm-config.ts).
      const ROUTE_FIRM_CAPS: Record<string, number> = {
        topstep: 15, topstep_50k: 15, topstep_100k: 15, topstep_150k: 15,
        mffu: 15, mffu_50k: 15,
      };
      const routeFirmKey = (account.firmId ?? "").toLowerCase();
      const routeFirmCap = ROUTE_FIRM_CAPS[routeFirmKey] ?? 20; // 20 = safe default

      if (signal.quantity > routeFirmCap) {
        const originalQty = signal.quantity;
        signal = { ...signal, quantity: routeFirmCap };

        logger.warn(
          { accountId, firmId: account.firmId, originalQty, clampedQty: routeFirmCap, correlationId },
          "broker-router: quantity exceeds firm cap — clamping (DRIFT: upstream sizing should have caught this)",
        );

        // Audit row for drift detection — this should never fire in steady state
        db.insert(auditLog).values({
          action: "broker_router.quantity_clamp_drift",
          entityType: "broker_account",
          entityId: null,
          decisionAuthority: "system",
          input: { accountId, ticker: signal.ticker, originalQty } as Record<string, unknown>,
          result: { firmId: account.firmId, routeFirmCap, clampedQty: routeFirmCap, driftDetected: true } as Record<string, unknown>,
          status: "success",
          correlationId: correlationId ?? null,
        }).catch((err: unknown) => {
          logger.error({ err }, "broker-router: drift audit_log write failed (non-blocking)");
        });
      }
    } catch (clampErr) {
      // Firm-cap clamp failure is non-fatal — log and proceed
      logger.error({ err: clampErr, accountId, correlationId }, "broker-router: route-time cap clamp failed — proceeding without clamp");
    }
  }

  // ── Broker type dispatch ────────────────────────────────────────────────────
  if (account.brokerType === "traderspost") {
    // ── Credential load ───────────────────────────────────────────────────────
    let apiKey: string;
    try {
      const creds = await loadBrokerCredentials(accountId);
      apiKey = creds.apiKey;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const result: BrokerResult = {
        success: false,
        reason: "credential_load_error",
        accountId,
        firmId: account.firmId,
        brokerType: account.brokerType,
        error: `Credential load failed: ${errorMsg}`,
      };
      logger.error({ err, accountId, correlationId }, "broker-router: credential load error (fail-CLOSED)");
      // CRITICAL Discord alert — vault failure blocks all order routing for this account.
      // Payout-affecting: orders silently drop until vault is restored.
      notifyCritical(
        "Broker Credential Vault Failure",
        `Credential load failed for account ${accountId} (firm: ${account.firmId}). ` +
          `All order routing is BLOCKED for this account until the vault is restored. ` +
          `Error: ${errorMsg}`,
        { accountId, firmId: account.firmId, correlationId: correlationId ?? null },
      );
      broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...result, correlationId: correlationId ?? null });
      await writeAuditLog(accountId, signal, result, correlationId);
      return result;
    }

    // ── Build + submit webhook ────────────────────────────────────────────────
    const payload = buildWebhookPayload(apiKey, signal);
    const submitResult = await submitWebhookOrder(payload);

    const result: BrokerResult = {
      success: submitResult.success,
      reason: "routed",
      accountId,
      firmId: account.firmId,
      brokerType: account.brokerType,
      statusCode: submitResult.statusCode,
      responseBody: submitResult.responseBody,
      error: submitResult.error,
    };

    broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...result, correlationId: correlationId ?? null });
    await writeAuditLog(accountId, signal, result, correlationId);
    return result;
  }

  if (account.brokerType === "topstepx") {
    // TopstepX is deferred until operator opens Topstep account with TopstepX API.
    // See: src/server/integrations/topstepx/STUB.md
    const result: BrokerResult = {
      success: false,
      reason: "topstepx_not_configured",
      accountId,
      firmId: account.firmId,
      brokerType: account.brokerType,
      error: "TopstepX integration deferred. See src/server/integrations/topstepx/STUB.md",
    };
    logger.warn({ accountId, firmId: account.firmId, correlationId }, "broker-router: TopstepX not configured (stub returns false)");
    broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...result, correlationId: correlationId ?? null });
    await writeAuditLog(accountId, signal, result, correlationId);
    return result;
  }

  // ── Unknown broker_type (should not occur due to DB CHECK constraint) ───────
  const result: BrokerResult = {
    success: false,
    reason: "unknown_broker_type",
    accountId,
    firmId: account.firmId,
    brokerType: account.brokerType,
    error: `Unknown broker_type: ${account.brokerType}`,
  };
  logger.error({ accountId, brokerType: account.brokerType, correlationId }, "broker-router: unknown broker_type (fail-CLOSED)");
  broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...result, correlationId: correlationId ?? null });
  await writeAuditLog(accountId, signal, result, correlationId);
  return result;
}
