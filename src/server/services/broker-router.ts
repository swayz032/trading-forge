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
 *   - Firm↔broker_type drift   → { success: false, reason: "firm_broker_mismatch" }
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
import { notifyCritical, notifyWarning } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { killSwitch } from "../production/kill-switch.js";
import { getEnabledFirms } from "./strategy-assignment-service.js";
import { getFirmLimit, CONTRACT_CAP_MAX, getFirmAccount, CONTRACT_SPECS, DEFAULT_ACCOUNT_SIZE } from "../../shared/firm-config.js";
// deep-scan #15 FIX M3: shared firm↔broker_type topology invariant (single source
// of truth for the F-3 dispatch guard AND the insert/update-time guard).
import { validateFirmBrokerTopology, normalizeFirmKey } from "../lib/firm-broker-topology.js";
// deep-scan #15 FIX M5: route-level MFFU 2%-per-trade enforcement helpers.
import { getStopCeilingPts } from "../lib/contract-class.js";
import { CircuitBreakerRegistry, CircuitOpenError } from "../lib/circuit-breaker.js";
import { traderspostRejectsTotal } from "../lib/metrics-registry.js";

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
      appendFamilyGradePostscript(
        `TradersPost circuit breaker OPENED after ${_tpCbFailureThreshold} consecutive ` +
          `failures. All order routing for TradersPost accounts is fast-failing until the ` +
          `breaker half-opens (~${Math.round(_tpCbCooldownMs / 1000)}s). ` +
          `Check TradersPost status page and inspect audit_log for broker_router.traderspost_submission_failed rows.`,
        "The TradersPost circuit is OPEN — orders are safely blocked.",
        "Tell Tony: 'TradersPost is unreachable from the bot.' If you cannot reach him, do nothing — orders are safely blocked, not silently mis-routed.",
      ),
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

// ─── A-11: Proactive TradersPost API key validity probe ──────────────────────
//
// Detects API key revocation BEFORE the first live order fails with 401.
// Strategy: POST a minimal payload (only apiKey, no action/ticker) to the
// TradersPost webhook URL on a slow cadence.
//   • HTTP 401/403 → key is revoked/invalid  → emit warning + audit row
//   • HTTP 4xx (not 401/403) → key is valid, payload rejected (expected)
//   • HTTP 5xx / timeout / network error → probe_failed (don't emit warning)
//
// No new scheduler cron is added — probe fires:
//   (a) Once at boot (via setImmediate after module load) — primary signal.
//   (b) Lazily inside routeOrder() for the traderspost path — when the per-account
//       probe result is >4h old, a non-blocking async re-probe is fired. The
//       in-flight probe doesn't delay the current order; the NEXT order sees
//       the updated result.
//
// SECURITY: apiKey must NEVER appear in log output.

const TP_PROBE_BASE_URL =
  process.env.TRADERSPOST_WEBHOOK_URL ?? "https://traderspost.io/trading/webhook";
const TP_PROBE_TIMEOUT_MS = 5_000;
const TP_PROBE_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface TpProbeResult {
  result: "valid" | "revoked" | "probe_failed";
  probedAt: Date;
}
// Per-account probe cache (keyed by accountId)
const _tpKeyProbeCache = new Map<string, TpProbeResult>();

/**
 * Probe a single TradersPost API key.
 * Does NOT use the circuit breaker (health check, not an order attempt).
 * Returns:
 *   "valid"        — key accepted (we got 4xx other than 401/403)
 *   "revoked"      — 401/403 received
 *   "probe_failed" — network/timeout/5xx (inconclusive, no alert)
 */
async function probeSingleTradersPostKey(
  apiKey: string,
  accountId: string,
): Promise<"valid" | "revoked" | "probe_failed"> {
  // Minimal payload: include only apiKey. TradersPost should reject on missing
  // required fields (400/422) if the key is valid, or reject on the key itself (401).
  const payload = JSON.stringify({ apiKey });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TP_PROBE_TIMEOUT_MS);

  let probeResult: "valid" | "revoked" | "probe_failed";
  try {
    const resp = await fetch(TP_PROBE_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // SECURITY: payload contains apiKey — must never be logged
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (resp.status === 401 || resp.status === 403) {
      probeResult = "revoked";
    } else if (resp.status >= 400 && resp.status < 500) {
      // 400/422 = key valid, payload incomplete — expected for our probe
      probeResult = "valid";
    } else {
      // 5xx or 2xx (unexpected but treat as inconclusive)
      logger.debug(
        { accountId, statusCode: resp.status },
        "broker-router: TP key probe inconclusive status code",
      );
      probeResult = "probe_failed";
    }
  } catch (fetchErr: unknown) {
    clearTimeout(timeoutId);
    const isAbort = fetchErr instanceof Error && fetchErr.name === "AbortError";
    logger.debug(
      { accountId, isAbort },
      "broker-router: TP key probe network/timeout error (inconclusive)",
    );
    probeResult = "probe_failed";
  }

  // Cache the result
  _tpKeyProbeCache.set(accountId, { result: probeResult, probedAt: new Date() });

  if (probeResult === "revoked") {
    logger.warn(
      { accountId },
      "broker-router: A-11: TradersPost API key probe returned 401/403 — key may be revoked",
    );
    // Emit warning alert (non-blocking — don't await)
    notifyWarning(
      "TradersPost API Key May Be Revoked",
      // Deep-scan #5 (2026-06-29): family-grade postscript (was the unwrapped notifyWarning
      // the postscript lint flagged — pre-existing at HEAD, fixed here).
      appendFamilyGradePostscript(
        `Proactive key validity probe for broker account ${accountId} received HTTP 401/403 from TradersPost. ` +
          `The API key may have been revoked. The next live order will fail with 'credential_load_error' or HTTP 401. ` +
          `Check TradersPost account settings and re-generate the API key if needed.`,
        "The bot's connection key to the broker (TradersPost) looks like it stopped working.",
        "No trade was lost — this is an early warning. Tell Tony to re-generate the TradersPost API key.",
      ),
      { accountId, probeUrl: TP_PROBE_BASE_URL },
    );
    // Audit row (fire-and-forget)
    void db
      .insert(auditLog)
      .values({
        action: "broker_router.traderspost_key_probe_revoked",
        entityType: "broker_account",
        entityId: null,
        decisionAuthority: "system",
        input: { accountId, probeUrl: TP_PROBE_BASE_URL } as Record<string, unknown>,
        result: { probeResult, probedAt: new Date().toISOString() } as Record<string, unknown>,
        status: "warning",
        correlationId: null,
      })
      .catch((auditErr: unknown) => {
        logger.warn(
          { err: auditErr, accountId },
          "broker-router: TP key probe revoked audit row write failed (non-blocking)",
        );
      });
  } else if (probeResult === "valid") {
    logger.debug({ accountId }, "broker-router: TP key probe result: valid");
  }

  return probeResult;
}

/**
 * Probe all enabled TradersPost accounts.
 * Called at boot (setImmediate) and on demand. Fail-soft — never throws.
 */
export async function probeTradersPostApiKeys(): Promise<void> {
  try {
    const accounts = await db
      .select({ accountId: brokerAccounts.accountId, enabled: brokerAccounts.enabled })
      .from(brokerAccounts)
      .where(eq(brokerAccounts.brokerType, "traderspost"));

    const enabledAccounts = accounts.filter((a) => a.enabled);
    if (enabledAccounts.length === 0) {
      logger.debug("broker-router: A-11: no enabled TradersPost accounts to probe");
      return;
    }

    logger.info(
      { count: enabledAccounts.length },
      "broker-router: A-11: probing TradersPost API keys for enabled accounts",
    );

    for (const account of enabledAccounts) {
      try {
        const creds = await loadBrokerCredentials(account.accountId);
        await probeSingleTradersPostKey(creds.apiKey, account.accountId);
      } catch (credErr: unknown) {
        // Credential load failure is already surfaced at order-time — don't double-alert
        logger.debug(
          { accountId: account.accountId, err: credErr },
          "broker-router: A-11: could not load credentials for probe (non-blocking)",
        );
      }
    }
  } catch (err: unknown) {
    logger.warn({ err }, "broker-router: A-11: probeTradersPostApiKeys failed (non-blocking)");
  }
}

// Boot-time probe — fires after module load (setImmediate gives the server
// time to finish starting before we hit the vault and the TradersPost endpoint).
setImmediate(() => {
  void probeTradersPostApiKeys().catch((e: unknown) => {
    logger.warn({ err: e }, "broker-router: A-11: boot-time key probe failed silently (non-blocking)");
  });
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
  | "firm_broker_mismatch"
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

/**
 * FIX M5: resolve a CONTRACT_SPECS entry (symbol root + point value) from a
 * TradingView-style ticker (e.g. "MESU2026", "MES", "ES1!"). Micros are matched
 * BEFORE minis so "MCLF2026" resolves to MCL (not CL) and "MESU2026" to MES (not
 * ES). Returns null when no known contract root matches — the caller then skips
 * the 2% check rather than guessing a point value (which would risk a false block).
 */
function resolveRouteContractSpec(ticker: string | null | undefined): { symbol: string; pointValue: number } | null {
  const upper = (ticker ?? "").toUpperCase();
  if (!upper) return null;
  // Micros first (MES/MNQ/MCL), then minis (ES/NQ/CL) — longest-prefix-first intent.
  for (const key of ["MES", "MNQ", "MCL", "ES", "NQ", "CL"] as const) {
    if (upper.startsWith(key)) {
      const s = CONTRACT_SPECS[key];
      if (s && typeof s.pointValue === "number") return { symbol: key, pointValue: s.pointValue };
    }
  }
  const direct = CONTRACT_SPECS[upper];
  if (direct && typeof direct.pointValue === "number") return { symbol: upper, pointValue: direct.pointValue };
  return null;
}

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
  // F5 FIX: capture request timestamp at function entry so it is stable for the
  // entire call (even if the function awaits for several seconds before reaching
  // the idempotency key construction).  When signal.barTimestamp is missing we
  // fall back to `req_<epoch>` instead of null, ensuring EVERY order gets a
  // stable idempotency key and DLQ replay / network retry cannot double-submit.
  const _routeOrderRequestTs = Date.now();

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

  // ── Null-firmId guard (Hole 3 fix) ─────────────────────────────────────────
  // An account with no firmId cannot be compliance-checked — the compliance gate
  // normalizes firm keys and cannot safely run without an identified firm. An
  // order from an unidentified firm MUST fail-CLOSED with an audit row so the
  // bypass is reconstructable. This check must run BEFORE the F-3 enabled-firms
  // guard to ensure we emit the specific "compliance_null_firm_blocked" audit
  // action rather than the generic "account_not_found" path.
  if (!account.firmId) {
    const nullFirmResult: BrokerResult = {
      success: false,
      reason: "compliance_violation",
      accountId,
      firmId: undefined,
      brokerType: account.brokerType,
      error: "compliance_gate_skipped_null_firm",
    };
    logger.error(
      { accountId, correlationId },
      "broker-router: BLOCKED — account has null firmId, compliance gate cannot run (fail-CLOSED)",
    );
    await db.insert(auditLog).values({
      action: "broker_router.compliance_null_firm_blocked",
      entityType: "broker_account",
      entityId: null,
      decisionAuthority: "system",
      input: { accountId, ticker: signal.ticker, action: signal.action } as Record<string, unknown>,
      result: {
        blocked: true,
        reason: "null_firm_id",
        error: "An account with no firmId cannot be routed — unidentifiable firm bypasses compliance",
      } as Record<string, unknown>,
      status: "blocked",
      correlationId: correlationId ?? null,
    }).catch((err: unknown) => {
      logger.error({ err }, "broker-router: null-firm compliance audit_log write failed (non-blocking)");
    });
    broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...nullFirmResult, correlationId: correlationId ?? null });
    await writeAuditLog(accountId, signal, nullFirmResult, correlationId);
    return nullFirmResult;
  }

  // ── F-3: firm_id ↔ broker_type routing invariant (FAIL-CLOSED) ─────────────
  // TOPOLOGY + COMPLIANCE SAFETY. Dispatch (below) keys purely on
  // broker_accounts.broker_type, but nothing upstream guarantees broker_type
  // actually matches the firm. A Topstep account row mis-seeded as
  // broker_type='traderspost' would silently route Topstep orders through
  // TradersPost — a topology violation (CLAUDE.md §7: Topstep uses TopstepX ONLY
  // since the 2026-01-12 Tradovate/NinjaTrader lockdown) AND a compliance
  // violation (orders crossing the wrong broker/firm boundary).
  //
  // Canonical mapping (CLAUDE.md §7):
  //   topstep        ⇒ topstepx
  //   mffu / others  ⇒ traderspost
  //
  // On mismatch we REFUSE the order, write a CRITICAL audit row
  // (broker_router.firm_broker_mismatch), fire a Discord critical, and do NOT
  // route. firmId is guaranteed non-null/non-empty here (the null-firm guard
  // above already fail-CLOSED on missing firmId). This runs BEFORE the
  // enabled-firms check so a mis-seeded row is surfaced as the specific topology
  // violation rather than masked as a generic enabled-firms block.
  //
  // SCOPE: this invariant enforces consistency only between the two KNOWN
  // routing targets (traderspost / topstepx). A genuinely-unknown broker_type
  // (DB CHECK-constraint violation) is a DIFFERENT failure and falls through to
  // the dedicated `unknown_broker_type` handler at the dispatch tail — we do not
  // conflate "wrong known broker" with "broker_type we don't recognize at all".
  {
    const KNOWN_BROKER_TYPES = ["traderspost", "topstepx"] as const;
    // FIX M3: derive the invariant from the shared helper so the runtime dispatch
    // guard and the write-time guard / DB CHECK constraint can never drift.
    const topology = validateFirmBrokerTopology(account.firmId, account.brokerType);
    const invariantFirmKey = topology.firmKey;
    const expectedBrokerType = topology.expectedBrokerType;
    if (
      (KNOWN_BROKER_TYPES as readonly string[]).includes(account.brokerType) &&
      account.brokerType !== expectedBrokerType
    ) {
      const result: BrokerResult = {
        success: false,
        reason: "firm_broker_mismatch",
        accountId,
        firmId: account.firmId,
        brokerType: account.brokerType,
        error: `firm_broker_mismatch: firm '${account.firmId}' (key '${invariantFirmKey}') requires broker_type '${expectedBrokerType}' but the broker_accounts row is configured as '${account.brokerType}'`,
      };
      logger.error(
        {
          accountId,
          firmId: account.firmId,
          firmKey: invariantFirmKey,
          brokerType: account.brokerType,
          expectedBrokerType,
          correlationId,
        },
        "broker-router: BLOCKED — firm↔broker_type mismatch (topology + compliance violation, fail-CLOSED)",
      );
      await db
        .insert(auditLog)
        .values({
          action: "broker_router.firm_broker_mismatch",
          entityType: "broker_account",
          entityId: null,
          decisionAuthority: "system",
          input: {
            accountId,
            firmId: account.firmId,
            ticker: signal.ticker,
            action: signal.action,
          } as Record<string, unknown>,
          result: {
            blocked: true,
            firmId: account.firmId,
            firmKey: invariantFirmKey,
            brokerType: account.brokerType,
            expectedBrokerType,
            error:
              "firm_id and broker_type are inconsistent — refusing to route to the wrong broker (topology/compliance violation)",
          } as Record<string, unknown>,
          status: "blocked",
          correlationId: correlationId ?? null,
        })
        .catch((err: unknown) => {
          logger.error({ err }, "broker-router: firm_broker_mismatch audit_log write failed (non-blocking)");
        });
      // CRITICAL Discord — a mis-seeded broker_accounts row is a capital-routing
      // safety event: orders would otherwise hit the wrong broker entirely.
      notifyCritical(
        "Broker Routing Topology Violation",
        appendFamilyGradePostscript(
          `Account ${accountId} (firm: ${account.firmId}) has broker_type='${account.brokerType}' but firm ` +
            `'${invariantFirmKey}' requires '${expectedBrokerType}'. The order was REFUSED — routing it would ` +
            `send orders to the WRONG broker (topology + compliance violation). Fix the broker_accounts row so ` +
            `broker_type matches the firm, then re-enable the account.`,
          "A trading account is pointed at the wrong broker — orders are safely blocked, not mis-routed.",
          "Tell Tony: 'A trading account is pointed at the wrong broker.' If you cannot reach him, do nothing — orders are safely blocked, not sent to the wrong place.",
        ),
        {
          accountId,
          firmId: account.firmId,
          brokerType: account.brokerType,
          expectedBrokerType,
          correlationId: correlationId ?? null,
        },
      );
      broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...result, correlationId: correlationId ?? null });
      await writeAuditLog(accountId, signal, result, correlationId);
      return result;
    }
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
    // FIX 8: On exception, apply the canonical fallback list rather than
    // bypassing the enabled-firms filter entirely. Bypassing silently allows
    // routing to any firm even if the instance is misconfigured.
    logger.warn(
      { err: enabledFirmsErr, accountId, firmId: account.firmId, correlationId },
      "broker-router: getEnabledFirms() threw — falling back to canonical default list (F-8)",
    );
    const fallbackFirms = [...ENABLED_FIRMS_FALLBACK];
    const normalizedFirmId = (account.firmId ?? "").toLowerCase().replace(/_\d+k$/, "");
    if (!fallbackFirms.includes(account.firmId as never) && !fallbackFirms.includes(normalizedFirmId as never)) {
      const result: BrokerResult = {
        success: false,
        reason: "account_not_found",
        accountId,
        firmId: account.firmId,
        brokerType: account.brokerType,
        error: `firm ${account.firmId} not in fallback enabled_firms (getEnabledFirms threw)`,
      };
      logger.warn(
        { accountId, firmId: account.firmId, correlationId },
        "broker-router: firm not in fallback enabled_firms — blocked (F-8)",
      );
      broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...result, correlationId: correlationId ?? null });
      await writeAuditLog(accountId, signal, result, correlationId);
      return result;
    }
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

  // ── FIX M5: route-level MFFU 2%-per-trade enforcement ──────────────────────
  // The F-5 Python compliance gate below passes intended_max_loss + account_balance
  // as NULL (they are not available at route time), so the 2%-per-trade rule is
  // structurally SKIPPED there. A caller reaching routeOrder() DIRECTLY (manual
  // order / future automation) therefore bypasses the 2% rule entirely — the
  // richer paper-execution-service check never runs for that path.
  //
  // This block closes that gap: it derives the intended max loss from the signal's
  // own risk geometry (quantity × stop-distance × point value) and enforces the
  // firm's 2% rule against the firm's NOMINAL account size. Only fires for entry
  // actions on firms that carry the 2% rule (MFFU). Exits add no per-trade risk.
  //
  // deepscan15 L2 note: nominal size is the conservative basis ONLY when live funded
  // equity >= nominal. On a DRAWN-DOWN account (equity < nominal) a nominal-basis 2%
  // ceiling UNDER-enforces relative to 2% of actual equity — live equity is not
  // available at route time, so paper-execution-service (which has the live balance)
  // remains the authoritative 2% enforcer; this route-level guard is a defense-in-depth
  // upper bound, not the primary check.
  if (signal.action === "enter_long" || signal.action === "enter_short") {
    try {
      const firmKey = normalizeFirmKey(account.firmId); // deepscan15 L4: shared helper (was inline regex)
      const acct = getFirmAccount(firmKey);
      const twoPctRule = acct?.twoPercentRulePct;
      const contracts = typeof signal.quantity === "number" ? signal.quantity : NaN;
      const spec = resolveRouteContractSpec(signal.ticker);

      if (
        acct &&
        typeof twoPctRule === "number" &&
        twoPctRule > 0 &&
        Number.isFinite(contracts) &&
        contracts > 0 &&
        spec
      ) {
        // Stop distance: prefer the signal's real entry↔stop geometry; fall back to
        // the firm/symbol stop ceiling (conservative upper bound) when either price
        // is missing so the check still runs rather than silently skipping.
        const hasPrices =
          typeof signal.price === "number" &&
          Number.isFinite(signal.price) &&
          typeof signal.stopPrice === "number" &&
          Number.isFinite(signal.stopPrice) &&
          signal.price !== signal.stopPrice;
        const stopDistancePts = hasPrices
          ? Math.abs((signal.price as number) - (signal.stopPrice as number))
          : getStopCeilingPts(spec.symbol);

        const intendedMaxLoss = contracts * stopDistancePts * spec.pointValue;
        const accountBalance = acct.accountSize ?? DEFAULT_ACCOUNT_SIZE;
        const maxAllowedLoss = twoPctRule * accountBalance;

        if (intendedMaxLoss > maxAllowedLoss) {
          const result: BrokerResult = {
            success: false,
            reason: "compliance_violation",
            accountId,
            firmId: account.firmId,
            brokerType: account.brokerType,
            error:
              `two_percent_rule_block: intended max loss $${intendedMaxLoss.toFixed(2)} ` +
              `exceeds ${(twoPctRule * 100).toFixed(1)}% of account $${accountBalance.toFixed(0)} ` +
              `(cap $${maxAllowedLoss.toFixed(2)})`,
          };
          logger.warn(
            {
              accountId,
              firmId: account.firmId,
              contracts,
              stopDistancePts,
              pointValue: spec.pointValue,
              intendedMaxLoss,
              accountBalance,
              maxAllowedLoss,
              twoPctRule,
              stopBasis: hasPrices ? "signal_geometry" : "stop_ceiling_fallback",
              correlationId,
            },
            "broker-router: BLOCKED — route-level MFFU 2%-per-trade rule (intended loss exceeds 2% of account)",
          );
          await db.insert(auditLog).values({
            action: "broker_router.two_percent_rule_block",
            entityType: "broker_account",
            entityId: null,
            decisionAuthority: "system",
            input: {
              accountId,
              firmId: account.firmId,
              ticker: signal.ticker,
              action: signal.action,
              quantity: contracts,
            } as Record<string, unknown>,
            result: {
              intendedMaxLoss,
              accountBalance,
              maxAllowedLoss,
              twoPctRule,
              stopDistancePts,
              pointValue: spec.pointValue,
              stopBasis: hasPrices ? "signal_geometry" : "stop_ceiling_fallback",
            } as Record<string, unknown>,
            status: "blocked",
            correlationId: correlationId ?? null,
          }).catch((err: unknown) => {
            logger.error({ err, accountId, correlationId }, "broker-router: two_percent_rule_block audit write failed (non-blocking)");
          });
          broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...result, correlationId: correlationId ?? null });
          await writeAuditLog(accountId, signal, result, correlationId);
          return result;
        }
      }
    } catch (twoPctErr) {
      // Fail-OPEN: this is a route-level defense-in-depth guard. A bug here must
      // not block legitimate orders — paper-execution-service remains the primary
      // 2% enforcement path. Log so the skipped check is visible.
      logger.error(
        { err: twoPctErr, accountId, firmId: account.firmId, correlationId },
        "broker-router: route-level 2% check threw — proceeding (fail-open; paper-execution-service is primary)",
      );
      // deepscan15 L2: a silently-skipped compliance check must be reconstructable —
      // write an audit row like every other skip/decision in this file (log-only left
      // the fail-open invisible to a post-incident audit_log trace).
      await db.insert(auditLog).values({
        action: "broker_router.two_percent_rule_check_error",
        entityType: "broker_account",
        entityId: null,
        decisionAuthority: "system",
        input: {
          accountId,
          firmId: account.firmId,
          ticker: signal.ticker,
          action: signal.action,
          quantity: signal.quantity,
        } as Record<string, unknown>,
        result: { error: String(twoPctErr), failOpen: true, primaryEnforcer: "paper-execution-service" } as Record<string, unknown>,
        status: "warn",
        correlationId: correlationId ?? null,
      }).catch((auditErr: unknown) => {
        logger.error({ err: auditErr, accountId, correlationId }, "broker-router: two_percent_rule_check_error audit write failed (non-blocking)");
      });
    }
  }

  // ── F-5: MFFU 2026 compliance gate (route-time defense-in-depth) ───────────
  // paper-execution-service runs this gate with full context (account_balance,
  // trades_today, open_positions). Here we run it as a last-line guard with the
  // subset of context available at route time. This catches:
  //   - Quantity exceeding firm contract cap (already clamped above, audited here)
  //   - Automated trading flag (always true at route time)
  //
  // WHAT THIS LAYER DOES NOT CHECK:
  //   - 2% per-trade rule: NOT checked here. intended_max_loss and account_balance
  //     are passed as null because neither is available at route time. The 2% rule
  //     IS enforced by paper-execution-service with real account context. Do NOT
  //     rely on this layer for 2% enforcement — it is structurally skipped.
  //   - trades_today / open_positions: likewise null — paper-execution-service owns
  //     those richer checks.
  //
  // Fail-open on subprocess failure: if runPythonModule throws, we log a WARN,
  // write an audit row, and proceed — broker-router compliance gate is defense-
  // in-depth; paper-execution-service is the primary gate.
  //
  // Fail-CLOSED on null/missing firmId: handled above, before F-3. By the time
  // we reach this block, account.firmId is guaranteed non-null/non-empty.

  {
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
          // NOTE: intended_max_loss and account_balance are intentionally null —
          // the 2% per-trade rule CANNOT be enforced here because account balance
          // is not available at route time. The 2% check is enforced upstream by
          // paper-execution-service with real account context.
          // This layer checks: automated flag, account_phase, proposed_symbol,
          // and any firm rules that do not require financial context.
          strategy_state: {
            automated: true,
            account_phase: "pa",
            host: process.env["TF_HOST_TAG"] ?? "local",
            pa_account_count: 1,
            intended_max_loss: null,   // 2% NOT checked here — see paper-execution-service
            account_balance: null,     // 2% NOT checked here — see paper-execution-service
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
      // Hole 2 fix: subprocess failure previously logged a warn and proceeded with
      // NO audit row — a blackout-window bypass was completely undetectable post-hoc.
      // Now we write an audit row so any compliance-gate failure during a live window
      // is reconstructable. We still proceed (fail-open) because paper-execution-service
      // is the primary gate; the audit row makes the bypass observable.
      logger.warn(
        { err: routeComplianceErr, accountId, firmId: account.firmId, correlationId },
        "broker-router: compliance gate subprocess failed — proceeding (fail-open, primary gate is paper-execution-service)",
      );
      db.insert(auditLog).values({
        action: "broker_router.compliance_gate_failed",
        entityType: "broker_account",
        entityId: null,
        decisionAuthority: "system",
        input: {
          accountId,
          firmId: account.firmId,
          ticker: signal.ticker,
        } as Record<string, unknown>,
        result: {
          error: routeComplianceErr instanceof Error ? routeComplianceErr.message : String(routeComplianceErr),
          proceeding: true,
          note: "fail-open: paper-execution-service is primary compliance gate",
        } as Record<string, unknown>,
        status: "failure",
        correlationId: correlationId ?? null,
      }).catch((err: unknown) => {
        logger.error({ err }, "broker-router: compliance-gate-failed audit_log write failed (non-blocking)");
      });
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
        appendFamilyGradePostscript(
          `Credential load failed for account ${accountId} (firm: ${account.firmId}). ` +
            `All order routing is BLOCKED for this account until the vault is restored. ` +
            `Error: ${errorMsg}`,
          "The trading account vault is locked — orders are safely blocked.",
          "Tell Tony: 'The vault is locked.' If you cannot reach him, do nothing — orders are safely blocked, not silently mis-routed.",
        ),
        { accountId, firmId: account.firmId, correlationId: correlationId ?? null },
      );
      broadcastSSE(BROKER_ORDER_ROUTED_EVENT, { ...result, correlationId: correlationId ?? null });
      await writeAuditLog(accountId, signal, result, correlationId);
      return result;
    }

    // ── A-11: Lazy periodic re-probe (no new cron needed) ────────────────────
    // If the probe cache for this account is stale (>4h or never probed),
    // fire an async re-probe. It doesn't block the current order — the NEXT
    // order call will see the refreshed result. On revocation we've already
    // emitted a warning alert via probeSingleTradersPostKey.
    const cachedProbe = _tpKeyProbeCache.get(accountId);
    const needsReprobe =
      !cachedProbe || Date.now() - cachedProbe.probedAt.getTime() > TP_PROBE_CACHE_TTL_MS;
    if (needsReprobe) {
      void probeSingleTradersPostKey(apiKey, accountId).catch((probeErr: unknown) => {
        logger.debug(
          { accountId, err: probeErr },
          "broker-router: A-11: lazy re-probe failed silently (non-blocking)",
        );
      });
    }

    // ── Build + submit webhook ────────────────────────────────────────────────
    const payload = buildWebhookPayload(apiKey, signal);

    // FINDING #2 FIX: Pass bar-scoped idempotency inputs so the HTTP client
    // derives a deterministic key from (accountId, strategyId, ticker, action,
    // barTs). A TradingView retry of the same bar produces the same key →
    // TradersPost deduplicates server-side → no duplicate live order.
    // correlationId is still passed for tracing/audit linkage only.
    //
    // F5 FIX: when signal.barTimestamp is absent (e.g. manual trigger, DLQ
    // replay without bar context), use `req_<epoch>` as the barTs so that
    // idempotencyInputs is NEVER null.  The `req_` prefix distinguishes
    // request-scoped keys from bar-scoped keys in audit logs.
    // _routeOrderRequestTs is captured once at function entry (above).
    const idempotencyBarTs = signal.barTimestamp ?? `req_${_routeOrderRequestTs}`;
    const idempotencyInputs: IdempotencyKeyInputs = {
      accountId,
      strategyId: payload.strategyId ?? signal.strategyId ?? "tf",
      ticker: signal.ticker,
      action: signal.action,
      barTs: idempotencyBarTs,
    };

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

    // ── Pass 4 Track C / M11: per-call TradersPost rejection Discord + Prom ───
    // Fires AFTER audit+SSE so observability is preserved even if the
    // notification helper throws. Distinct from the credential-vault failure at
    // line 664 (which uses notifyCritical because it is systemic).
    //
    // M11 ESCALATION (hardening/phase-0): When H4 retry budget is fully exhausted
    // (retryAttempt >= 2, meaning 3 total attempts all failed 5xx), escalate from
    // notifyWarning → notifyCritical. A retry-exhausted result means the order was
    // silently dropped despite the retry safety net — this is a capital-safety event.
    // All other failures (4xx, first-attempt 5xx, network) keep notifyWarning.
    if (!submitResult.success) {
      const statusCodeStr = submitResult.statusCode != null ? String(submitResult.statusCode) : "unknown";
      const signalActionStr = signal.action ?? "unknown";
      // Increment Prometheus counter before the Discord call (Discord is
      // fire-and-forget void; counter should survive Discord helper failure).
      traderspostRejectsTotal.labels({ status_code: statusCodeStr, signal_action: signalActionStr }).inc();
      const truncatedBody =
        typeof submitResult.responseBody === "string"
          ? submitResult.responseBody.slice(0, 200)
          : submitResult.responseBody != null
            ? JSON.stringify(submitResult.responseBody).slice(0, 200)
            : "";
      const retryExhausted = (submitResult.retryAttempt ?? 0) >= 2;
      if (retryExhausted) {
        // M11: Full retry budget consumed — order was silently dropped after 3 attempts.
        // This is a capital-safety event: the broker never received the order.
        notifyCritical(
          `TradersPost 5xx retry EXHAUSTED for ${signal.ticker ?? "unknown"} — ORDER DROPPED`,
          appendFamilyGradePostscript(
            `Account ${accountId} on ${signalActionStr}: HTTP ${statusCodeStr} after ${(submitResult.retryAttempt ?? 0) + 1} attempts. ` +
              `Body=${truncatedBody}. The broker is not responding and the retry budget is fully consumed. ` +
              `The order was NOT placed.`,
            "The bot tried 3 times to submit an order to the broker and the broker is not responding. The order was NOT placed.",
            "Check the dashboard for the affected strategy. Tony may need to investigate the broker connection.",
          ),
          {
            correlationId: correlationId ?? null,
            accountId,
            firmId: account.firmId,
            statusCode: submitResult.statusCode ?? null,
            signalAction: signal.action ?? null,
            retryAttempt: submitResult.retryAttempt ?? null,
          },
        );
      } else {
        notifyWarning(
          `TradersPost reject for ${signal.ticker ?? "unknown"}`,
          appendFamilyGradePostscript(
            `Account ${accountId} on ${signalActionStr}: HTTP ${statusCodeStr}, body=${truncatedBody}`,
            "TradersPost rejected an order. The order did NOT reach the broker.",
            "Tell Tony: 'A TradersPost order was rejected.' If you cannot reach him, no action is required — the broker did not receive the order.",
          ),
          {
            correlationId: correlationId ?? null,
            accountId,
            firmId: account.firmId,
            statusCode: submitResult.statusCode ?? null,
            signalAction: signal.action ?? null,
          },
        );
      }
    }

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
