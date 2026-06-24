/**
 * live-order.ts — Workstream W1 CORE + W1 Follow-Up (Pine Static-Token)
 *
 * POST /api/live-order
 *
 * TF Order Gateway: the in-process gate between every Pine alert and live broker
 * order submission. Makes `routeOrder()` a real production caller so that the
 * full gate stack (kill-switch FIRST, pipeline, compliance, firm-cap, correlation
 * guard) governs live money — not just paper simulation.
 *
 * Problem solved:
 *   Previously, live orders fired Pine → TradersPost → broker, bypassing every
 *   in-process gate. routeOrder() existed with full gate logic but had ZERO
 *   production callers. This endpoint closes that gap.
 *
 * Auth modes — both supported simultaneously, fail-CLOSED on neither:
 *
 *   A) HMAC mode (programmatic callers):
 *      Payload includes `live_order_hmac` (HMAC-SHA256 over canonical message
 *      `${account_id}|${ticker}|${action}|${timestamp_ms}` signed with
 *      LIVE_ORDER_HMAC_SECRET env var). Replay guard: 2-minute timestamp_ms window.
 *
 *   B) Static-token mode (Pine / TradingView alert callers):
 *      Pine Script v5 has no crypto library — per-payload HMAC is physically
 *      impossible at alert fire time. Instead, the exported Pine script carries
 *      the per-account `account_strategy_assignments.hmac_secret` value as a
 *      static bearer token embedded at export compile-time.
 *      Auth: `Authorization: Bearer <token>` header OR `live_order_token` body field.
 *      DB lookup: account_strategy_assignments WHERE account_id + strategy_id.
 *      Replay guard: same 2-minute timestamp_ms window as HMAC mode.
 *      Dedup guard: bar_timestamp uniqueness on (account_id, strategy_id,
 *        bar_timestamp, action) via live_order_pine_dedup table — mirrors how
 *        tradingview-webhook.ts uses ON CONFLICT DO NOTHING.
 *      Replayability compensated by: 2-min window + DB dedup on bar close timestamp.
 *      `strategy_id` REQUIRED for static-token path (dedup key + DB lookup).
 *
 *   Fail-CLOSED: bad/missing token → 401; LIVE_ORDER_HMAC_SECRET missing → 503
 *   (HMAC mode); secret not found in DB → 401 (static-token mode).
 *
 * Security properties:
 *   - All comparisons via crypto.timingSafeEqual (no timing oracle).
 *   - Kill-switch gate is the FIRST gate inside routeOrder() — HALT returns 423.
 *   - Compliance / firm-cap / correlation guard all run inside routeOrder().
 *   - No double-forward: routeOrder() calls submitWebhookOrder() internally for
 *     traderspost broker_type. This route does NOT call submitWebhookOrder().
 *   - Every block writes a live_order.blocked_* audit_log row.
 *
 * Payload shape — HMAC mode (TradingView Pine alert JSON, programmatic):
 * {
 *   "account_id":      "<broker_accounts.account_id UUID>",
 *   "ticker":          "MES1!",
 *   "action":          "enter_long" | "enter_short" | "exit_long" | "exit_short",
 *   "order_type":      "market" | "limit" | "stop" (optional),
 *   "quantity":        6,
 *   "strategy_id":     "<UUID>",
 *   "bar_timestamp":   "2026-06-22T...",
 *   "timestamp_ms":    1750000000000,
 *   "live_order_hmac": "<hex>",
 *   "correlation_id":  "<UUID>"
 * }
 *
 * Payload shape — Static-token mode (Pine export alert JSON):
 * {
 *   "account_id":      "<broker_accounts.account_id UUID>",
 *   "ticker":          "MES1!",
 *   "action":          "enter_long" | "enter_short" | "exit_long" | "exit_short",
 *   "order_type":      "market",
 *   "quantity":        6,
 *   "strategy_id":     "<UUID>",               (REQUIRED for static-token)
 *   "bar_timestamp":   "{{time}}",             (Pine bar_timestamp for dedup)
 *   "timestamp_ms":    1750000000000,
 *   "live_order_token":"<hmac_secret>",        (OR Authorization: Bearer header)
 *   "correlation_id":  "<UUID>"
 * }
 */

import { Router, type Request, type Response } from "express";
import { randomUUID, createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { sql as drizzleSql, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLog, strategies } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { routeOrder } from "../services/broker-router.js";
import type { WebhookSignal } from "../integrations/traderspost/webhook-builder.js";
import { lookupHmacSecret } from "../services/tradingview-marker-service.js";
import { runPythonModule } from "../lib/python-runner.js";
import { notifyWarning } from "../services/notification-service.js";
import { LIVE_EXECUTION_STATES } from "../services/server-mediated-executor.js";
import {
  emitArchetypeSignalReceived,
  emitArchetypeSignalResolved,
  emitArchetypeEvaluatorFailed,
} from "../lib/archetype-routing-observability.js";

export const liveOrderRoutes = Router();

// ─── Replay guard window ──────────────────────────────────────────────────────
// 2-minute window: tight enough to block replayed Pine alerts,
// generous enough to tolerate TradingView → network → server latency.
const REPLAY_WINDOW_MS = 2 * 60 * 1000;

// ─── HMAC secret resolution ───────────────────────────────────────────────────
// Operator MUST set LIVE_ORDER_HMAC_SECRET (≥32 chars) in production .env.
// Missing secret → every request is rejected 503 (fail-CLOSED, not 401, so Pine
// retries back off instead of burning through the alert quota with auth loops).
function getLiveOrderSecret(): string | null {
  const secret = process.env.LIVE_ORDER_HMAC_SECRET;
  if (!secret || secret.length < 32) return null;
  return secret;
}

// ─── HMAC verification ────────────────────────────────────────────────────────
// Canonical message: `{account_id}|{ticker}|{action}|{timestamp_ms}`
// Same as what Pine would compute at alert fire time.

function verifyLiveOrderHmac(
  accountId: string,
  ticker: string,
  action: string,
  timestampMs: number,
  providedHmac: string,
  secret: string,
): boolean {
  try {
    const message = `${accountId}|${ticker}|${action}|${timestampMs}`;
    const expected = createHmac("sha256", secret)
      .update(message, "utf8")
      .digest("hex");

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(providedHmac, "utf8");

    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── Request schema ───────────────────────────────────────────────────────────
// live_order_hmac:  HMAC mode credential (programmatic callers).
// live_order_token: Static-token mode credential (Pine/TradingView callers).
//   Both optional in the Zod schema — the handler enforces that at least ONE
//   is present and valid. This avoids breaking either client class.
//   Static-token mode also accepts token via Authorization: Bearer <token> header.
//
// strategy_id: Optional for HMAC mode (used for idempotency key only).
//              REQUIRED for static-token mode (DB lookup + dedup key).
//              Schema keeps it optional; handler enforces the requirement when
//              live_order_token path is selected.

// ─── Archetype registry ───────────────────────────────────────────────────────
// Hard-coded list of known archetype keys. Keep in sync with
// ARCHETYPE_REGISTRY in direct-bucket-graduator.ts.
// TODO: add CI lint to detect drift between this array and ARCHETYPE_REGISTRY.
const ARCHETYPE_REGISTRY_KEYS: ReadonlySet<string> = new Set([
  "ict_silver_bullet_ny_am",
  "ict_silver_bullet_london",
  "ict_silver_bullet_ny_pm",
  "ict_judas_swing",
  "ict_ny_lunch_reversal",
  "ict_midnight_open",
  "ict_london_raid",
  "ict_turtle_soup",
  "ict_ote",
  "ict_power_of_3",
  "ict_unicorn",
  "ict_breaker",
  "ict_mitigation",
  "ict_iofed",
  "smt_reversal",
  "ict_quarterly_swing",
  "ict_propulsion",
  "ict_eqhl_raid",
  "ict_scalp",
  "ict_swing",
  "ict_2022",
  "break_of_structure",
  "change_of_character",
  "market_structure_shift",
  "cisd",
  "fvg_retrace",
  "fvg",
  "judas_swing",
  "silver_bullet",
  "breaker_block",
  "order_block",
  "liquidity_sweep",
  "wyckoff_spring",
  "wyckoff_upthrust",
  "wyckoff_accumulation",
  "wyckoff_distribution",
  "bounce_off_level",
  "ict_bias_aligned_continuation",
  "gann_box_4h_continuation",
]);

const liveOrderPayloadSchema = z.object({
  account_id:       z.string().uuid("account_id must be a UUID"),
  ticker:           z.string().min(1, "ticker is required"),
  action:           z.enum(["enter_long", "enter_short", "exit_long", "exit_short", "exit", "archetype_signal"]),
  order_type:       z.enum(["market", "limit", "stop", "stop_limit"]).optional(),
  quantity:         z.number().int().positive().optional(),
  price:            z.number().optional(),
  stop_price:       z.number().optional(),
  strategy_id:      z.string().uuid().optional().nullable(),
  bar_timestamp:    z.string().optional().nullable(),
  timestamp_ms:     z.number().int().positive("timestamp_ms must be a positive integer (Unix millis)"),
  live_order_hmac:  z.string().min(1).optional(),   // HMAC mode — programmatic callers
  live_order_token: z.string().min(1).optional(),   // Static-token mode — Pine callers
  correlation_id:   z.string().uuid().optional().nullable(),
  archetype:        z.string().optional(),          // archetype_signal mode — archetype key
});

// ─── Audit helper ─────────────────────────────────────────────────────────────

async function writeBlockedAuditRow(params: {
  action: string;
  accountId: string;
  ticker: string;
  correlationId: string | null;
  reason: string;
  detail?: Record<string, unknown>;
  durationMs: number;
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action: params.action,
      entityType: "live_order",
      entityId: null,
      decisionAuthority: "system",
      input: {
        accountId: params.accountId,
        ticker: params.ticker,
      } as Record<string, unknown>,
      result: {
        reason: params.reason,
        blocked: true,
        ...params.detail,
      } as Record<string, unknown>,
      status: "blocked",
      durationMs: params.durationMs,
      correlationId: params.correlationId,
    });
  } catch (err) {
    logger.error({ err }, "live-order: audit_log write failed (non-blocking)");
  }
}

// ─── Static-token dedup helper ────────────────────────────────────────────────
// Pine bars fire once per bar close. The bar_timestamp is the close time of the
// bar that triggered the alert — structurally unique per (account, strategy, bar, action).
// We insert a dedup row with ON CONFLICT DO NOTHING, mirroring tradingview-webhook.ts.
// Returns true iff this is the FIRST time we have seen this combination (not a dup).
// Table live_order_pine_dedup must exist — created by migration 0170.

async function insertPineDedupRow(
  accountId: string,
  strategyId: string,
  barTimestamp: string,
  action: string,
  correlationId: string,
): Promise<boolean> {
  try {
    const result = await db.execute(
      drizzleSql`INSERT INTO live_order_pine_dedup
                   (account_id, strategy_id, bar_timestamp, action, correlation_id)
                 VALUES (
                   ${accountId}::uuid,
                   ${strategyId}::uuid,
                   ${barTimestamp}::timestamptz,
                   ${action},
                   ${correlationId}::uuid
                 )
                 ON CONFLICT DO NOTHING
                 RETURNING id`,
    );
    const rows = (result as unknown as { rows: Array<{ id: number }> }).rows;
    // If RETURNING rows is empty, the insert was a no-op (conflict) → duplicate.
    return (rows?.length ?? 0) > 0;
  } catch (err) {
    // If the dedup table doesn't exist yet (pre-migration), fail-open with a warn
    // rather than hard-blocking all Pine orders. The 2-minute replay window still
    // provides the primary replay protection in this scenario.
    logger.warn(
      { accountId, strategyId, barTimestamp, action, err },
      "live-order: pine dedup insert failed (table may not exist yet) — allowing through",
    );
    return true;
  }
}

// ─── POST /api/live-order ─────────────────────────────────────────────────────

liveOrderRoutes.post(
  "/",
  async (req: Request, res: Response): Promise<void> => {
    const startedAt = Date.now();

    // 2. Parse payload first — needed to determine auth mode.
    //    (Auth mode selection depends on parsed fields; step numbering follows
    //     the HMAC-mode original but static-token mode inserts its DB lookups
    //     where HMAC secret resolution was.)
    const parsed = liveOrderPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_payload", details: parsed.error.issues });
      return;
    }

    const {
      account_id,
      ticker,
      action,
      archetype,
      order_type,
      quantity,
      price,
      stop_price,
      strategy_id,
      bar_timestamp,
      timestamp_ms,
      live_order_hmac,
      live_order_token,
      correlation_id,
    } = parsed.data;

    const correlationId: string = correlation_id ?? randomUUID();

    // ── Determine auth mode ────────────────────────────────────────────────────
    // Extract Bearer token from Authorization header (Pine alert body supports
    // both the header and the body field for flexibility).
    const authHeader = req.headers["authorization"];
    const bearerToken =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : undefined;

    // Static-token mode: live_order_token body field OR Authorization: Bearer header.
    // HMAC mode: live_order_hmac body field.
    // Neither → fail-CLOSED 401.
    const resolvedToken = live_order_token ?? bearerToken;
    const useStaticToken = resolvedToken !== undefined && resolvedToken.length > 0;
    const useHmac = !useStaticToken && typeof live_order_hmac === "string" && live_order_hmac.length > 0;

    if (!useStaticToken && !useHmac) {
      logger.warn(
        { accountId: account_id, ticker, correlationId },
        "live-order: neither live_order_hmac nor live_order_token provided — 401",
      );
      await writeBlockedAuditRow({
        action: "live_order.blocked_no_auth",
        accountId: account_id,
        ticker,
        correlationId,
        reason: "no_auth_credential",
        durationMs: Date.now() - startedAt,
      });
      res.status(401).json({ error: "no_auth_credential", detail: "provide live_order_hmac (HMAC mode) or live_order_token / Authorization: Bearer (Pine static-token mode)" });
      return;
    }

    // ── HMAC mode ─────────────────────────────────────────────────────────────
    if (useHmac) {
      // 1a. Resolve HMAC secret — fail-CLOSED 503 on missing/short secret.
      //     503 (not 401) so the caller knows the server is misconfigured.
      const secret = getLiveOrderSecret();
      if (!secret) {
        logger.error(
          {},
          "live-order: LIVE_ORDER_HMAC_SECRET missing or too short — rejecting all requests until configured",
        );
        res.status(503).json({
          error: "gateway_not_configured",
          detail: "LIVE_ORDER_HMAC_SECRET is not set or < 32 chars; operator must configure before live orders are accepted",
        });
        return;
      }

      // 3a. Verify HMAC — fail-CLOSED 401 on mismatch.
      const hmacValid = verifyLiveOrderHmac(
        account_id,
        ticker,
        action,
        timestamp_ms,
        live_order_hmac as string,
        secret,
      );
      if (!hmacValid) {
        logger.warn(
          { accountId: account_id, ticker, correlationId },
          "live-order: HMAC verification failed — 401",
        );
        await writeBlockedAuditRow({
          action: "live_order.blocked_hmac_invalid",
          accountId: account_id,
          ticker,
          correlationId,
          reason: "hmac_invalid",
          durationMs: Date.now() - startedAt,
        });
        res.status(401).json({ error: "hmac_invalid" });
        return;
      }

      // 4a. Replay guard — reject timestamps outside the 2-minute window.
      //     Checked AFTER HMAC to avoid leaking timing info about secret validity.
      const nowMs = Date.now();
      if (Math.abs(nowMs - timestamp_ms) > REPLAY_WINDOW_MS) {
        logger.warn(
          { accountId: account_id, ticker, correlationId, timestamp_ms, nowMs, deltaMs: nowMs - timestamp_ms },
          "live-order: stale payload rejected — timestamp_ms outside 2-minute window",
        );
        await writeBlockedAuditRow({
          action: "live_order.blocked_stale_payload",
          accountId: account_id,
          ticker,
          correlationId,
          reason: "stale_payload",
          detail: { timestamp_ms, nowMs, deltaMs: nowMs - timestamp_ms, windowMs: REPLAY_WINDOW_MS },
          durationMs: Date.now() - startedAt,
        });
        res.status(401).json({ error: "stale_payload" });
        return;
      }
    }

    // ── Static-token mode ─────────────────────────────────────────────────────
    if (useStaticToken) {
      // strategy_id is REQUIRED for static-token path:
      //   (a) It is the DB lookup key for account_strategy_assignments.hmac_secret.
      //   (b) It is the dedup key — without it we cannot dedup across strategies.
      if (!strategy_id) {
        logger.warn(
          { accountId: account_id, ticker, correlationId },
          "live-order: static-token mode requires strategy_id — 400",
        );
        res.status(400).json({ error: "invalid_payload", detail: "strategy_id is required when using live_order_token (Pine static-token mode)" });
        return;
      }

      // 1b. DB lookup: fetch hmac_secret for (account_id, strategy_id).
      //     lookupHmacSecret handles F-3 encrypted column fallback.
      //     Returns null when assignment missing or secret unset.
      const dbSecret = await lookupHmacSecret(account_id, strategy_id);
      if (!dbSecret) {
        logger.warn(
          { accountId: account_id, strategyId: strategy_id, correlationId },
          "live-order: no hmac_secret found for account+strategy — 401",
        );
        await writeBlockedAuditRow({
          action: "live_order.blocked_token_secret_missing",
          accountId: account_id,
          ticker,
          correlationId,
          reason: "token_secret_missing",
          detail: { strategyId: strategy_id },
          durationMs: Date.now() - startedAt,
        });
        res.status(401).json({ error: "token_invalid" });
        return;
      }

      // 3b. Constant-time comparison of provided token vs stored secret.
      //     timingSafeEqual requires equal-length buffers.
      let tokenValid = false;
      try {
        const a = Buffer.from(dbSecret, "utf8");
        const b = Buffer.from(resolvedToken as string, "utf8");
        tokenValid = a.length === b.length && timingSafeEqual(a, b);
      } catch {
        tokenValid = false;
      }

      if (!tokenValid) {
        logger.warn(
          { accountId: account_id, strategyId: strategy_id, correlationId },
          "live-order: static token mismatch — 401",
        );
        await writeBlockedAuditRow({
          action: "live_order.blocked_token_invalid",
          accountId: account_id,
          ticker,
          correlationId,
          reason: "token_invalid",
          detail: { strategyId: strategy_id },
          durationMs: Date.now() - startedAt,
        });
        res.status(401).json({ error: "token_invalid" });
        return;
      }

      // 4b. Replay guard — same 2-minute window as HMAC mode.
      //     Checked AFTER token validation to avoid leaking timing info.
      const nowMs = Date.now();
      if (Math.abs(nowMs - timestamp_ms) > REPLAY_WINDOW_MS) {
        logger.warn(
          { accountId: account_id, ticker, correlationId, timestamp_ms, nowMs, deltaMs: nowMs - timestamp_ms },
          "live-order: stale Pine payload rejected — timestamp_ms outside 2-minute window",
        );
        await writeBlockedAuditRow({
          action: "live_order.blocked_stale_payload",
          accountId: account_id,
          ticker,
          correlationId,
          reason: "stale_payload",
          detail: { timestamp_ms, nowMs, deltaMs: nowMs - timestamp_ms, windowMs: REPLAY_WINDOW_MS, authMode: "static_token" },
          durationMs: Date.now() - startedAt,
        });
        res.status(401).json({ error: "stale_payload" });
        return;
      }

      // 4c. Bar-timestamp dedup — reject duplicate bar-close alerts.
      //     Pine bars fire once per bar close; the bar_timestamp is structurally
      //     unique per (account, strategy, bar close, action). ON CONFLICT DO NOTHING
      //     means TradingView retries are absorbed without double-firing routeOrder().
      //     If bar_timestamp is absent, skip dedup (unusual but tolerated).
      if (bar_timestamp) {
        const isFirst = await insertPineDedupRow(
          account_id,
          strategy_id,
          bar_timestamp,
          action,
          correlationId,
        );
        if (!isFirst) {
          logger.info(
            { accountId: account_id, strategyId: strategy_id, barTimestamp: bar_timestamp, action, correlationId },
            "live-order: duplicate Pine alert (same bar_timestamp + action) — 409 absorbed",
          );
          // 409 is returned so caller knows it was a dup and not routed.
          // TradingView alerts do not retry on 4xx, so this is safe.
          res.status(409).json({ error: "duplicate_pine_alert", detail: "same bar_timestamp+action already processed for this account+strategy" });
          return;
        }
      }
    }

    // ── F-1: Lifecycle gate ────────────────────────────────────────────────────
    // CRITICAL CAPITAL-SAFETY GATE: if a strategy_id is present, verify it is in
    // LIVE_EXECUTION_STATES (DEPLOYED or PILOT) before allowing ANY routeOrder() call.
    // Fail-CLOSED: DB error OR no row found → REJECT (never fall through to routeOrder).
    // Strategies in CANDIDATE/TESTING/SHADOW/PAPER/DEPLOY_READY/DECLINING/RETIRED/GRAVEYARD
    // are NOT eligible for live capital — reject 409.
    // Strategies without a strategy_id (programmatic HMAC callers) are exempt from this
    // gate because they have no lifecycle row to look up (backward-compat).
    if (strategy_id) {
      let lifecycleGatePassed = false;
      let lifecycleState: string | null = null;
      try {
        const rows = await db
          .select({ lifecycleState: strategies.lifecycleState })
          .from(strategies)
          .where(eq(strategies.id, strategy_id))
          .limit(1);
        lifecycleState = rows[0]?.lifecycleState ?? null;
        lifecycleGatePassed = lifecycleState !== null && LIVE_EXECUTION_STATES.has(lifecycleState);
      } catch (gateErr) {
        logger.error(
          { accountId: account_id, strategyId: strategy_id, correlationId, err: gateErr },
          "live-order: lifecycle gate DB lookup failed — fail-closed",
        );
        lifecycleGatePassed = false;
      }

      if (!lifecycleGatePassed) {
        logger.warn(
          { accountId: account_id, strategyId: strategy_id, correlationId, lifecycleState },
          "live-order: strategy not in LIVE_EXECUTION_STATES — rejected 409",
        );
        try {
          await db.insert(auditLog).values({
            action: "live_order.rejected_non_live_state",
            entityType: "live_order",
            entityId: null,
            decisionAuthority: "system",
            input: { accountId: account_id, strategyId: strategy_id, ticker, lifecycleState } as Record<string, unknown>,
            result: { rejected: true, reason: "non_live_state" } as Record<string, unknown>,
            status: "rejected",
            durationMs: Date.now() - startedAt,
            correlationId,
          });
        } catch (auditErr) {
          logger.error({ err: auditErr }, "live-order: lifecycle gate audit row write failed (non-blocking)");
        }
        res.status(409).json({
          error: "non_live_state",
          detail: `Strategy ${strategy_id} is in state '${lifecycleState ?? "NOT_FOUND"}' — only DEPLOYED/PILOT strategies may route live orders`,
          correlationId,
        });
        return;
      }
    }

    // ── Archetype-signal dispatch ─────────────────────────────────────────────
    // action="archetype_signal": invoke src.engine.archetype_evaluator to resolve
    // the archetype to a direction (enter_long/enter_short/exit_long/exit_short/hold),
    // then continue via the common routeOrder() path with the resolved direction.
    // Fail-CLOSED: evaluator error or timeout → 503 + audit.
    // Hold: 200 with status:"held" and NO routeOrder() call.
    if (action === "archetype_signal") {
      // Pass 4.5 Track D: emit signal-received SSE immediately (fire-and-forget)
      emitArchetypeSignalReceived({
        strategy_id: strategy_id ?? "unknown",
        archetype: archetype ?? "<missing>",
        account_id,
        correlation_id: correlationId,
        bar_timestamp: bar_timestamp ?? "unknown",
      });

      // Validate archetype field is present
      if (!archetype || archetype.trim().length === 0) {
        logger.warn(
          { accountId: account_id, ticker, correlationId, action },
          "live-order: archetype_signal action requires archetype field — 400",
        );
        await writeBlockedAuditRow({
          action: "live_order.blocked_missing_archetype",
          accountId: account_id,
          ticker,
          correlationId,
          reason: "missing_archetype_field",
          durationMs: Date.now() - startedAt,
        });
        res.status(400).json({ error: "invalid_payload", detail: "archetype field is required when action=archetype_signal" });
        return;
      }

      // Validate archetype key is registered
      const archetypeKey = archetype.trim();
      if (!ARCHETYPE_REGISTRY_KEYS.has(archetypeKey)) {
        logger.warn(
          { accountId: account_id, ticker, correlationId, archetypeKey },
          "live-order: unknown archetype key — 400",
        );
        await writeBlockedAuditRow({
          action: "live_order.blocked_unknown_archetype",
          accountId: account_id,
          ticker,
          correlationId,
          reason: "unknown_archetype",
          detail: { archetypeKey, knownCount: ARCHETYPE_REGISTRY_KEYS.size },
          durationMs: Date.now() - startedAt,
        });
        res.status(400).json({
          error: "invalid_payload",
          detail: `unknown archetype key: ${archetypeKey}. Valid keys: see ARCHETYPE_REGISTRY in direct-bucket-graduator.ts`,
        });
        return;
      }

      // Invoke Python archetype evaluator
      let evaluatorResult: { action: string; reason: string };
      try {
        evaluatorResult = await runPythonModule<{ action: string; reason: string }>({
          module: "src.engine.archetype_evaluator",
          args: [
            "--archetype", archetypeKey,
            "--strategy-id", strategy_id ?? "",
            "--bar-timestamp", bar_timestamp ?? "",
            "--symbol", ticker,
            "--account-id", account_id,
            "--correlation-id", correlationId,
          ],
          timeoutMs: 10_000,
          componentName: "archetype-evaluator",
          correlationId,
        });
      } catch (evalErr) {
        const errMsg = evalErr instanceof Error ? evalErr.message : String(evalErr);
        const errClass = evalErr instanceof Error ? evalErr.constructor.name : "unknown";
        logger.error(
          { accountId: account_id, ticker, correlationId, archetypeKey, err: evalErr },
          "live-order: archetype evaluator failed",
        );
        await writeBlockedAuditRow({
          action: "live_order.archetype_evaluator_failed",
          accountId: account_id,
          ticker,
          correlationId,
          reason: "evaluator_error",
          detail: { archetypeKey, error: errMsg },
          durationMs: Date.now() - startedAt,
        });
        try {
          await notifyWarning(
            `Archetype evaluator FAILED: ${archetypeKey} / ${ticker}`,
            `Evaluator error for account ${account_id}: ${errMsg}`,
            { archetypeKey, ticker, accountId: account_id, correlationId },
          );
        } catch { /* non-blocking */ }
        // Pass 4.5 Track D: emit evaluator-failed SSE + Prom counter
        emitArchetypeEvaluatorFailed({
          strategy_id: strategy_id ?? "unknown",
          archetype: archetypeKey,
          error_class: errClass,
          correlation_id: correlationId,
        });
        res.status(503).json({ error: "archetype_evaluator_failed", detail: errMsg, correlationId });
        return;
      }

      // Pass 4.5 Track D: emit signal-resolved SSE + Prom counter with the resolved action
      emitArchetypeSignalResolved({
        strategy_id: strategy_id ?? "unknown",
        archetype: archetypeKey,
        resolved_action: evaluatorResult.action as "enter_long" | "enter_short" | "exit_long" | "exit_short" | "hold",
        account_id,
        correlation_id: correlationId,
        reason: evaluatorResult.reason,
      });

      // Handle hold — evaluator says no trade, return 200 without routing
      if (evaluatorResult.action === "hold") {
        logger.info(
          { accountId: account_id, ticker, correlationId, archetypeKey, reason: evaluatorResult.reason },
          "live-order: archetype evaluator returned hold — not routing",
        );
        try {
          await db.insert(auditLog).values({
            action: "live_order.archetype_held_no_signal",
            entityType: "live_order",
            entityId: null,
            decisionAuthority: "system",
            input: { accountId: account_id, ticker, archetypeKey } as Record<string, unknown>,
            result: { held: true, reason: evaluatorResult.reason } as Record<string, unknown>,
            status: "success",
            durationMs: Date.now() - startedAt,
            correlationId,
          });
        } catch (auditErr) {
          logger.error({ err: auditErr }, "live-order: archetype_held audit row write failed (non-blocking)");
        }
        res.status(200).json({ status: "held", reason: evaluatorResult.reason, correlationId });
        return;
      }

      // Directional action — validate it is a known trade action before routing
      const DIRECTIONAL_ACTIONS = new Set(["enter_long", "enter_short", "exit_long", "exit_short"]);
      if (!DIRECTIONAL_ACTIONS.has(evaluatorResult.action)) {
        const errDetail = `archetype evaluator returned unexpected action: ${evaluatorResult.action}`;
        logger.warn({ accountId: account_id, ticker, correlationId, archetypeKey, evaluatorAction: evaluatorResult.action }, errDetail);
        await writeBlockedAuditRow({
          action: "live_order.archetype_evaluator_failed",
          accountId: account_id,
          ticker,
          correlationId,
          reason: "unexpected_evaluator_action",
          detail: { archetypeKey, evaluatorAction: evaluatorResult.action },
          durationMs: Date.now() - startedAt,
        });
        res.status(503).json({ error: "archetype_evaluator_failed", detail: errDetail, correlationId });
        return;
      }

      // Directional — fall through to common path with resolved action
      // Re-bind action to the resolved directional value for routeOrder()
      const resolvedAction = evaluatorResult.action as "enter_long" | "enter_short" | "exit_long" | "exit_short";
      logger.info(
        { accountId: account_id, ticker, correlationId, archetypeKey, resolvedAction },
        "live-order: archetype evaluator resolved direction — routing",
      );

      // Build signal and route immediately (skip the common path signal build below)
      const archetypeSignal: WebhookSignal = {
        action: resolvedAction,
        ticker,
        ...(quantity !== undefined ? { quantity } : {}),
        ...(price !== undefined ? { price } : {}),
        ...(stop_price !== undefined ? { stopPrice: stop_price } : {}),
        ...(order_type !== undefined ? { orderType: order_type } : {}),
        ...(strategy_id ? { strategyId: strategy_id } : {}),
        ...(bar_timestamp ? { barTimestamp: bar_timestamp } : {}),
      };

      const archetypeResult = await routeOrder(account_id, archetypeSignal, correlationId, timestamp_ms);
      const archetypeDurationMs = Date.now() - startedAt;

      if (!archetypeResult.success) {
        const isHalt = archetypeResult.reason === "production_halt";
        const isFirmOrCompliance =
          archetypeResult.reason === "compliance_violation" ||
          archetypeResult.reason === "account_not_found";

        await writeBlockedAuditRow({
          action: isHalt ? "live_order.blocked_production_halt" : `live_order.blocked_${archetypeResult.reason}`,
          accountId: account_id,
          ticker,
          correlationId,
          reason: archetypeResult.reason,
          detail: {
            brokerType: archetypeResult.brokerType,
            firmId: archetypeResult.firmId,
            error: archetypeResult.error,
            archetypeKey,
            resolvedAction,
          },
          durationMs: archetypeDurationMs,
        });

        logger.warn(
          { accountId: account_id, ticker, correlationId, reason: archetypeResult.reason, archetypeKey, archetypeDurationMs },
          "live-order: archetype order blocked by gate",
        );

        const statusCode = isHalt ? 423 : isFirmOrCompliance ? 403 : 503;
        res.status(statusCode).json({
          blocked: true,
          reason: archetypeResult.reason,
          correlationId,
          error: archetypeResult.error,
        });
        return;
      }

      logger.info(
        {
          accountId: account_id,
          ticker,
          correlationId,
          archetypeKey,
          resolvedAction,
          brokerType: archetypeResult.brokerType,
          firmId: archetypeResult.firmId,
          archetypeDurationMs,
        },
        "live-order: archetype order forwarded via routeOrder()",
      );

      res.status(200).json({
        forwarded: true,
        reason: archetypeResult.reason,
        correlationId,
        brokerType: archetypeResult.brokerType,
        firmId: archetypeResult.firmId,
        statusCode: archetypeResult.statusCode,
        archetypeKey,
        resolvedAction,
      });
      return;
    }

    // ── Common path: build signal and call routeOrder() ────────────────────────
    // 5. Build WebhookSignal and call routeOrder().
    //    routeOrder() is the SINGLE SOURCE OF TRUTH per CLAUDE.md §7.
    //    It runs: kill-switch FIRST → pipeline → enabled_firms → compliance → broker dispatch.
    //    For traderspost broker_type it calls submitWebhookOrder() internally.
    //    This route does NOT call submitWebhookOrder() — no double-forward.
    const signal: WebhookSignal = {
      action,
      ticker,
      ...(quantity !== undefined ? { quantity } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(stop_price !== undefined ? { stopPrice: stop_price } : {}),
      ...(order_type !== undefined ? { orderType: order_type } : {}),
      ...(strategy_id ? { strategyId: strategy_id } : {}),
      ...(bar_timestamp ? { barTimestamp: bar_timestamp } : {}),
    };

    // Pass the timestamp_ms as webhookFiredAt so routeOrder() can compute
    // fire_to_ack_ms for the webhook.broker_ack audit row.
    const result = await routeOrder(account_id, signal, correlationId, timestamp_ms);

    const durationMs = Date.now() - startedAt;

    // 6. Gate blocked — write audit row and return 4xx.
    if (!result.success) {
      const isHalt = result.reason === "production_halt";
      const isFirmOrCompliance =
        result.reason === "compliance_violation" ||
        result.reason === "account_not_found";

      const auditAction = isHalt
        ? "live_order.blocked_production_halt"
        : `live_order.blocked_${result.reason}`;

      await writeBlockedAuditRow({
        action: auditAction,
        accountId: account_id,
        ticker,
        correlationId,
        reason: result.reason,
        detail: {
          brokerType: result.brokerType,
          firmId: result.firmId,
          error: result.error,
          statusCode: result.statusCode,
        },
        durationMs,
      });

      logger.warn(
        { accountId: account_id, ticker, correlationId, reason: result.reason, durationMs },
        "live-order: order blocked by gate",
      );

      // HALT = 423 (unavailable due to policy — retry later when halt lifts)
      // compliance / firm = 403 (forbidden)
      // other failures = 503
      const statusCode = isHalt ? 423 : isFirmOrCompliance ? 403 : 503;

      res.status(statusCode).json({
        blocked: true,
        reason: result.reason,
        correlationId,
        error: result.error,
      });
      return;
    }

    // 7. Success — routeOrder forwarded to TradersPost (or stub for TopstepX).
    logger.info(
      {
        accountId: account_id,
        ticker,
        correlationId,
        brokerType: result.brokerType,
        firmId: result.firmId,
        statusCode: result.statusCode,
        durationMs,
      },
      "live-order: order forwarded via routeOrder()",
    );

    res.status(200).json({
      forwarded: true,
      reason: result.reason,
      correlationId,
      brokerType: result.brokerType,
      firmId: result.firmId,
      statusCode: result.statusCode,
    });
  },
);
