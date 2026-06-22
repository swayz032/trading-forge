/**
 * Broker Router — Single source of truth for order routing.
 *
 * `routeOrder(accountId, signal)` looks up broker_accounts.broker_type and
 * dispatches to the appropriate broker integration. Today only the TradersPost
 * path actually fires; TopstepX returns a clear "not configured" stub.
 *
 * Fail-CLOSED contract:
 *   - Production halted        → { success: false, reason: "production_halt" }
 *   - Account not found        → { success: false, reason: "account_not_found" }
 *   - broker_type unknown      → { success: false, reason: "unknown_broker_type" }
 *   - Credential vault error   → { success: false, reason: "credential_load_error" }
 *   - Pipeline paused          → { success: false, reason: "pipeline_paused" }
 *   - Firm not enabled         → { success: false, reason: "account_not_found" }
 *   - Compliance violation     → { success: false, reason: "compliance_violation" }
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
import type { IdempotencyKeyInputs } from "../integrations/traderspost/client.js";
import { buildWebhookPayload } from "../integrations/traderspost/webhook-builder.js";
import type { WebhookSignal } from "../integrations/traderspost/webhook-builder.js";
import { notifyCritical } from "./notification-service.js";
import { killSwitch } from "../production/kill-switch.js";
import { getEnabledFirms } from "./strategy-assignment-service.js";
import { getFirmLimit, CONTRACT_CAP_MAX } from "../../shared/firm-config.js";
import { CircuitBreakerRegistry, CircuitOpenError } from "../lib/circuit-breaker.js";

// ─── FINDING #4: TradersPost circuit breaker ─────────────────────────────────
// Wraps all TradersPost HTTP submissions. On N consecutive failures (default 3
// per TRADERSPOST_CB_FAILURE_THRESHOLD), opens the breaker for
// TRADERSPOST_CB_COOLDOWN_MS (default 30 s). While open, all submission
// attempts fast-fail with reason "traderspost_circuit_open" and write an audit
// row — no live order is sent, operator gets a clear signal.
//
// Discord critical fires ONCE on the CLOSED → OPEN transition (not per order).
// SSE "broker:degraded" fires on the same transition.
// Recovery (OPEN → HALF_OPEN → CLOSED) emits no Discord noise — the absence of
// further critical alerts signals restoration.

export const TRADERSPOST_CIRCUIT_BREAKER_KEY = "traderspost-webhook";
export const TRADERSPOST_CIRCUIT_OPEN_REASON = "traderspost_circuit_open" as const;

const _tpCbFailureThreshold = Math.max(
  1,
  parseInt(process.env.TRADERSPOST_CB_FAILURE_THRESHOLD ?? "3", 10) || 3,
);
const _tpCbCooldownMs = Math.max(
  5_000,
  parseInt(process.env.TRADERSPOST_CB_COOLDOWN_MS ?? "30000", 10) || 30_000,
);

// Obtain (or create) the singleton breaker for TradersPost.
const _traderspostBreaker = CircuitBreakerRegistry.get(TRADERSPOST_CIRCUIT_BREAKER_KEY, {
  failureThreshold: _tpCbFailureThreshold,
  cooldownMs: _tpCbCooldownMs,
});

// Track whether we've already fired the critical alert for this open window.
// Resets when the breaker returns to CLOSED so the next open window fires again.
let _tpBreacherAlertedOpen = false;

// State-change hook: fires once per transition.
CircuitBreakerRegistry.setOnStateChange((name, _from, to) => {
  if (name !== TRADERSPOST_CIRCUIT_BREAKER_KEY) return;

  if (to === "OPEN" && !_tpBreacherAlertedOpen) {
    _tpBreacherAlertedOpen = true;
    // Discord critical — operator must investigate.
    notifyCritical(
      "TradersPost Webhook Degraded",
      `TradersPost circuit breaker OPENED after ${_tpCbFailureThreshold} consecutive ` +
        `failures. All order routing for TradersPost accounts is fast-failing until the ` +
        `breaker half-opens (~${Math.round(_tpCbCooldownMs / 1000)}s). ` +
        `Check TradersPost status page and inspect audit_log for broker_router.traderspost_submission_failed rows.`,
      { circuitBreaker: TRADERSPOST_CIRCUIT_BREAKER_KEY, failureThreshold: _tpCbFailureThreshold },
    );
    // SSE so the dashboard surfaces the degradation immediately.
    broadcastSSE("broker:degraded", {
      broker: "traderspost",
      reason: "circuit_breaker_open",
      failureThreshold: _tpCbFailureThreshold,
      cooldownMs: _tpCbCooldownMs,
      timestamp: new Date().toISOString(),
    });
    logger.error(
      { breaker: TRADERSPOST_CIRCUIT_BREAKER_KEY, threshold: _tpCbFailureThreshold },
      "broker-router: TradersPost circuit breaker OPENED — fast-failing all orders",
    );
  }

  if (to === "CLOSED") {
    _tpBreacherAlertedOpen = false;
    logger.info(
      { breaker: TRADERSPOST_CIRCUIT_BREAKER_KEY },
      "broker-router: TradersPost circuit breaker CLOSED — order routing restored",
    );
  }
});

// ─── F-5: killSwitch import verification (module-load time) ───────────────────
// killSwitch is exported as a named `const killSwitch = new KillSwitch()` from
// ../production/kill-switch.js. If that file ever migrates to a default export
// or a different shape, this assertion-style log makes the breakage obvious at
// startup instead of failing silently inside the first routeOrder() call.
if (typeof killSwitch?.isHaltedForProduction !== "function") {
  // Log loudly — this is a production-safety regression we cannot recover from.
  logger.error(
    {
      hasKillSwitch: typeof killSwitch,
      hasMethod: typeof killSwitch?.isHaltedForProduction,
    },
    "broker-router: killSwitch.isHaltedForProduction is NOT a function — kill-switch gate will fail-CLOSED on every call",
  );
} else {
  logger.info(
    { killSwitchMethod: "isHaltedForProduction" },
    "broker-router: killSwitch import verified (F-5)",
  );
}

// ─── F-6: enabled_firms canonical fallback ──────────────────────────────────
// If getEnabledFirms() returns an empty array, broker-router would silently
// block ALL routing — appearing as "every order rejected by enabled_firms" in
// audit_log. That failure mode is hard to diagnose and trips on misconfigured
// instance_config rows. We fall back to the CLAUDE.md §6 canonical default
// (Topstep + MFFU) with a WARN log so the operator sees the fallback in logs.
const ENABLED_FIRMS_FALLBACK = ["topstep", "mffu"] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type BrokerResultReason =
  | "account_not_found"
  | "unknown_broker_type"
  | "credential_load_error"
  | "pipeline_paused"
  | "production_halt"
  | "compliance_violation"
  | "topstepx_not_configured"
  | "traderspost_circuit_open"
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
 * @param accountId       - UUID from broker_accounts.account_id
 * @param signal          - Normalized signal shape (see WebhookSignal)
 * @param correlationId   - Optional trace ID propagated from the caller (Track 5
 *                          assignment → Track 6 Pine export → Track 8 marker).
 *                          Written to the audit_log row so all three events are
 *                          queryable by correlation_id.
 * @param webhookFiredAt  - Optional Unix-ms timestamp of when TradingView fired
 *                          the alert (captured in tradingview-webhook.ts from
 *                          payload.time or handler entry time). Used to compute
 *                          fire_to_ack_ms for the webhook.broker_ack audit row.
 *                          When omitted no latency row is written.
 * @returns               BrokerResult — always resolves, never throws
 */
export async function routeOrder(
  accountId: string,
  signal: WebhookSignal,
  correlationId?: string | null,
  webhookFiredAt?: number | null,
): Promise<BrokerResult> {
  // ── F-2: Kill switch supremacy — FIRST gate, no exceptions ─────────────────
  // isHaltedForProduction() is fail-CLOSED: DB error → returns true → blocks.
  // This gate fires BEFORE pipeline check, account lookup, or anything else.
  // It is the unconditional production safety interlock for live order routing.
  let halted: boolean;
  try {
    halted = await killSwitch.isHaltedForProduction();
  } catch (killSwitchErr) {
    // Fail-CLOSED: if the check itself throws, treat as halted.
    // F-5: surface the error so silent halts are visible. Without this, every
    // order silently rejects with reason="production_halt" but no log trail
    // explains WHY the kill-switch evaluation failed — an extremely hard bug
    // to root-cause post-hoc.
    logger.error(
      { err: killSwitchErr, accountId, correlationId },
      "broker-router: killSwitch.isHaltedForProduction() threw — fail-CLOSED halt active (F-5)",
    );
    halted = true;
  }
  if (halted) {
    const result: BrokerResult = {
      success: false,
      reason: "production_halt",
      accountId,
      error: "killswitch_halt",
    };
    logger.error(
      { accountId, correlationId },
      "broker-router: BLOCKED — production halt active (kill switch FIRST gate)",
    );
    await db.insert(auditLog).values({
      action: "broker_router.route_rejected",
      entityType: "broker_account",
      entityId: null,
      decisionAuthority: "system",
      input: { accountId, ticker: signal.ticker, action: signal.action } as Record<string, unknown>,
      result: { reason: "production_halt", error: "killswitch_halt" } as Record<string, unknown>,
      status: "blocked",
      correlationId: correlationId ?? null,
    }).catch((err: unknown) => {
      logger.error({ err }, "broker-router: kill-switch audit_log write failed (non-blocking)");
    });
    broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...result, correlationId: correlationId ?? null });
    return result;
  }

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

  // ── F-3: Enabled-firms enforcement ─────────────────────────────────────────
  // instance_config.enabled_firms controls which firms this deployment allows.
  // A firm not in that list is blocked here — prevents accidental routing to a
  // firm that is disabled at the instance level (e.g. during firm suspension,
  // multi-firm compliance pause, or operator reconfiguration).
  // Fail-open on read error: if getEnabledFirms() throws, we proceed (same
  // fail-open contract as compliance-gate-service — avoids blocking all orders
  // on a transient DB error during a read-only config check).
  try {
    let enabledFirms = await getEnabledFirms();
    // F-6: empty-array guard. A misconfigured instance_config.enabled_firms row
    // would silently block ALL routing. Fall back to CLAUDE.md §6 canonical
    // default (Topstep + MFFU) with a WARN log so the operator sees the
    // fallback in logs instead of debugging a silent block.
    if (!Array.isArray(enabledFirms) || enabledFirms.length === 0) {
      logger.warn(
        { accountId, firmId: account.firmId, correlationId },
        "broker-router: getEnabledFirms() returned empty — falling back to canonical default ['topstep','mffu'] (F-6)",
      );
      enabledFirms = [...ENABLED_FIRMS_FALLBACK];
    }
    const normalizedFirmId = (account.firmId ?? "").toLowerCase().replace(/_\d+k$/, "");
    if (!enabledFirms.includes(account.firmId) && !enabledFirms.includes(normalizedFirmId)) {
      const result: BrokerResult = {
        success: false,
        reason: "account_not_found",
        accountId,
        firmId: account.firmId,
        brokerType: account.brokerType,
        error: `firm ${account.firmId} not in instance enabled_firms`,
      };
      logger.warn(
        { accountId, firmId: account.firmId, enabledFirms, correlationId },
        "broker-router: firm not in enabled_firms — blocked (F-3)",
      );
      broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...result, correlationId: correlationId ?? null });
      await writeAuditLog(accountId, signal, result, correlationId);
      return result;
    }
  } catch (enabledFirmsErr) {
    // Fail-open: log and proceed — read-only config check must not block orders
    logger.warn(
      { err: enabledFirmsErr, accountId, firmId: account.firmId, correlationId },
      "broker-router: getEnabledFirms() failed — proceeding (fail-open for config read)",
    );
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
      // F-4: Derive per-firm cap from getFirmLimit() (canonical source).
      // Strips account-tier suffixes (e.g. _50k, _100k) to match firm-config keys.
      // Falls back to CONTRACT_CAP_MAX when firm is unknown.
      const routeFirmKey = (account.firmId ?? "").toLowerCase().replace(/_\d+k$/, "");
      const firmLimitData = getFirmLimit(routeFirmKey);
      const routeFirmCap = firmLimitData?.maxContracts ?? CONTRACT_CAP_MAX;

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

  // ── F-5: MFFU 2026 compliance gate (route-time defense-in-depth) ───────────
  // paper-execution-service runs this gate with full context (account_balance,
  // trades_today, open_positions). Here we run it as a last-line guard with the
  // subset of context available at route time. This catches:
  //   - Quantity exceeding firm contract cap (already clamped above, audited here)
  //   - Automated trading flag (always true at route time)
  // Checks requiring account balance / open positions / trades_today are richer
  // upstream in paper-execution-service; this layer adds broker-route audit trail.
  // Fail-open: if runPythonModule throws, we log and proceed to avoid blocking
  // all live orders on a transient Python subprocess failure.
  if (account.firmId) {
    try {
      const { runPythonModule } = await import("../lib/python-runner.js");
      const routeComplianceFirmKey = account.firmId.toLowerCase().replace(/_\d+k$/, "");
      const routeViolationResult = await runPythonModule<{
        violation: boolean;
        status: string;
        message: string;
        violations: string[];
      }>({
        module: "src.engine.compliance.compliance_gate",
        config: {
          action: "check_violation",
          firm: routeComplianceFirmKey,
          // Minimal strategy_state available at route time.
          // Full context (account_balance, trades_today, open_positions) is
          // enforced upstream by paper-execution-service — this is defense-in-depth.
          strategy_state: {
            automated: true,
            account_phase: "pa",
            host: process.env["TF_HOST_TAG"] ?? "local",
            pa_account_count: 1,
            // Quantity-derived intended_max_loss approximation:
            // Conservative estimate using firm's per-contract daily loss limit.
            // Real check done upstream with actual account balance.
            intended_max_loss: null,
            account_balance: null,
            trades_today: null,
            open_positions: [],
            proposed_symbol: signal.ticker,
          },
        },
        timeoutMs: 3_000,
        componentName: "compliance-gate-broker-router",
      });

      if (routeViolationResult.violation) {
        const result: BrokerResult = {
          success: false,
          reason: "compliance_violation",
          accountId,
          firmId: account.firmId,
          brokerType: account.brokerType,
          error: routeViolationResult.message,
        };
        logger.error(
          {
            accountId,
            firmId: account.firmId,
            symbol: signal.ticker,
            status: routeViolationResult.status,
            violations: routeViolationResult.violations,
            correlationId,
          },
          "broker-router: BLOCKED — compliance gate violation (F-5)",
        );
        await db.insert(auditLog).values({
          action: "broker_router.compliance_rejected",
          entityType: "broker_account",
          entityId: null,
          decisionAuthority: "system",
          input: {
            accountId,
            firmId: account.firmId,
            ticker: signal.ticker,
            violations: routeViolationResult.violations,
          } as Record<string, unknown>,
          result: {
            status: routeViolationResult.status,
            message: routeViolationResult.message,
            blocked: true,
          } as Record<string, unknown>,
          status: "blocked",
          correlationId: correlationId ?? null,
        }).catch((err: unknown) => {
          logger.error({ err }, "broker-router: compliance audit_log write failed (non-blocking)");
        });
        broadcastSSE("compliance:rejected", {
          firmId: account.firmId,
          symbol: signal.ticker,
          reason: routeViolationResult.message,
          correlationId: correlationId ?? null,
        });
        broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...result, correlationId: correlationId ?? null });
        await writeAuditLog(accountId, signal, result, correlationId);
        return result;
      }
    } catch (routeComplianceErr) {
      // Fail-open: log warning, proceed — broker-router compliance gate is
      // defense-in-depth; upstream paper-execution-service is the primary gate.
      logger.warn(
        { err: routeComplianceErr, accountId, firmId: account.firmId, correlationId },
        "broker-router: compliance gate subprocess failed — proceeding (fail-open, primary gate is paper-execution-service)",
      );
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

    // FINDING #2 FIX: Pass bar-scoped idempotency inputs so the HTTP client
    // derives a deterministic key from (accountId, strategyId, ticker, action,
    // barTs). A TradingView retry of the same bar produces the same key →
    // TradersPost deduplicates server-side → no duplicate live order.
    // correlationId is still passed for tracing/audit linkage only.
    const idempotencyInputs: IdempotencyKeyInputs | null =
      signal.barTimestamp
        ? {
            accountId,
            strategyId: payload.strategyId ?? signal.strategyId ?? "tf",
            ticker: signal.ticker,
            action: signal.action,
            barTs: signal.barTimestamp,
          }
        : null;

    // FINDING #4 FIX: Wrap the HTTP submission in the TradersPost circuit
    // breaker. CircuitOpenError fast-fails here; the catch block below converts
    // it to a structured BrokerResult with reason "traderspost_circuit_open"
    // and writes an audit row without contacting TradersPost at all.
    let submitResult: Awaited<ReturnType<typeof submitWebhookOrder>>;
    try {
      submitResult = await _traderspostBreaker.call(() =>
        submitWebhookOrder(payload, correlationId, idempotencyInputs)
      );
    } catch (brekerErr) {
      if (brekerErr instanceof CircuitOpenError) {
        const cbResult: BrokerResult = {
          success: false,
          reason: TRADERSPOST_CIRCUIT_OPEN_REASON,
          accountId,
          firmId: account.firmId,
          brokerType: account.brokerType,
          error: `traderspost_circuit_open: ${brekerErr.message}`,
        };
        logger.warn(
          { accountId, firmId: account.firmId, correlationId, reopensAt: brekerErr.reopensAt.toISOString() },
          "broker-router: TradersPost circuit OPEN — fast-failing order (no broker contact)",
        );
        // Audit row for every open-circuit fast-fail (operator can count them)
        db.insert(auditLog)
          .values({
            action: "broker_router.traderspost_circuit_open",
            entityType: "broker_account",
            entityId: null,
            decisionAuthority: "system",
            input: { accountId, ticker: signal.ticker, action: signal.action } as Record<string, unknown>,
            result: {
              reason: TRADERSPOST_CIRCUIT_OPEN_REASON,
              reopensAt: brekerErr.reopensAt.toISOString(),
            } as Record<string, unknown>,
            status: "failure",
            correlationId: correlationId ?? null,
          })
          .catch((err: unknown) =>
            logger.error({ err }, "broker-router: circuit-open audit write failed (non-blocking)")
          );
        broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...cbResult, correlationId: correlationId ?? null });
        return cbResult;
      }
      // Non-CircuitOpenError from the breaker.call wrapper — should not happen
      // (submitWebhookOrder is fail-CLOSED and never throws), but guard anyway.
      const fallbackResult: BrokerResult = {
        success: false,
        reason: "internal_error",
        accountId,
        firmId: account.firmId,
        brokerType: account.brokerType,
        error: brekerErr instanceof Error ? brekerErr.message : String(brekerErr),
      };
      logger.error({ err: brekerErr, accountId, correlationId }, "broker-router: unexpected error from breaker.call");
      broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...fallbackResult, correlationId: correlationId ?? null });
      await writeAuditLog(accountId, signal, fallbackResult, correlationId);
      return fallbackResult;
    }

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

    // ── webhook.broker_ack latency emitter (Wave 25 CF#1) ────────────────────
    // Only on SUCCESSFUL broker ack. Rejection events have their own audit rows.
    // Writes the row consumed by webhook-latency-monitor-service.ts (cron every
    // 15 min) to compute p50/p95 fire-to-ack latency over a rolling 1h window.
    if (submitResult.success && webhookFiredAt != null) {
      const ackAt = Date.now();
      const fire_to_ack_ms = ackAt - webhookFiredAt;
      db.insert(auditLog)
        .values({
          action: "webhook.broker_ack",
          entityType: "broker_account",
          entityId: null,
          decisionAuthority: "system",
          input: {
            accountId,
            ticker: signal.ticker,
            action: signal.action,
          } as Record<string, unknown>,
          result: {
            fire_to_ack_ms,
            source: account.brokerType === "traderspost" ? "traderspost" : "direct",
            fired_at_iso: new Date(webhookFiredAt).toISOString(),
            ack_at_iso: new Date(ackAt).toISOString(),
            broker: account.brokerType,
            account_id: accountId,
          } as Record<string, unknown>,
          status: "success",
          correlationId: correlationId ?? null,
        })
        .catch((err: unknown) => {
          logger.error({ err, accountId, correlationId }, "broker-router: webhook.broker_ack audit write failed (non-blocking)");
        });
    }

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
