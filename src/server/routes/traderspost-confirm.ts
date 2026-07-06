/**
 * traderspost-confirm.ts — Option B (deep-scan A): TradersPost order-status webhook consumer.
 *
 * POST /api/traderspost/order-status  (mounted BEFORE the /api auth gate — external callback).
 *
 * Receives TradersPost's outbound order-confirmation callback and stamps
 * production_trades.traderspost_confirmed_at (migration 0197). That "confirmed" count becomes a
 * GENUINELY independent reconciliation leg vs the server-side "sent" count, closing the loop the
 * reconciliation-service F-7 GAP docstring describes.
 *
 * SAFE-BY-DEFAULT: this endpoint only STAMPS a confirmation timestamp (no order flow, no money
 * movement). It is inert until TradersPost is configured to POST here AND real orders flow; the
 * recon side stays proxy-mode until RECON_TRADERSPOST_CONFIRM_INDEPENDENT=true is set post go-live.
 *
 * SECURITY (deep-scan Security S-1): once RECON_TRADERSPOST_CONFIRM_INDEPENDENT=true the confirmed
 * count is a live reconciliation input, so a forged POST could defeat the breach detector. In
 * production+independent mode the shared secret is therefore MANDATORY — see the 503 guard below
 * (mirrors admin-frozen-policy-override's secret-required-in-production pattern).
 *
 * CORRELATION (deep-scan Architecture F-1 / Observability #5): every audit row carries a
 * correlation_id (inbound header → matched production_trades row → minted fallback) and a real
 * entityId from the matched row, so a confirmation can be joined back to the bar→handler→DB chain.
 *
 * ⚠ PAYLOAD MAPPING — OPERATOR MUST VERIFY: TradersPost's callback must carry the
 * traderspost_webhook_id we sent at submit (our deterministic idempotency key). The exact field
 * name depends on TradersPost's callback schema — this accepts the common aliases; confirm against
 * https://traderspost.io/docs/webhooks#order-callbacks and adjust `extractWebhookId` before enabling.
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { productionTrades } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";

/** Extract our traderspost_webhook_id from the callback body. Exported for testing + easy
 *  operator adjustment once the real TradersPost field name is confirmed. */
export function extractWebhookId(body: Record<string, unknown>): string | null {
  for (const k of ["webhook_id", "webhookId", "external_id", "externalId", "reference"]) {
    const v = body[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

/** S-1: in production, when the confirmed leg is a live independent reconciliation input
 *  (RECON_TRADERSPOST_CONFIRM_INDEPENDENT=true), the shared secret is mandatory — an unauthenticated
 *  endpoint would let anyone who can guess a traderspost_webhook_id forge a confirmation and defeat
 *  the sent-vs-confirmed breach detector. Exported for testing. */
export function traderspostConfirmSecretRequired(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.RECON_TRADERSPOST_CONFIRM_INDEPENDENT === "true"
  );
}

// Exported for direct unit testing (repo's supertest-free convention).
export async function handleTradersPostOrderStatus(
  req: { body?: unknown; header: (name: string) => string | undefined },
  res: { status: (c: number) => { json: (b: unknown) => unknown } },
): Promise<unknown> {
  const expectedSecret = process.env.TRADERSPOST_CONFIRM_SECRET;

  // S-1 structural production guard: refuse to run unauthenticated while feeding a live independent
  // recon leg, rather than trusting operator discipline to have set the secret.
  if (traderspostConfirmSecretRequired() && !expectedSecret) {
    logger.error(
      "traderspost-confirm: RECON_TRADERSPOST_CONFIRM_INDEPENDENT=true in production but " +
        "TRADERSPOST_CONFIRM_SECRET is unset — refusing (503) to avoid an unauthenticated confirm leg",
    );
    await insertAuditRowSafe({
      action: "traderspost.order_confirm_misconfigured",
      entityType: "production_trade",
      entityId: null,
      decisionAuthority: "system",
      input: {} as Record<string, unknown>,
      result: { reason: "secret_required_in_production" } as Record<string, unknown>,
      status: "error",
      correlationId: randomUUID(),
    });
    return res.status(503).json({ error: "traderspost_confirm_secret_required_in_production" });
  }

  // Optional shared-secret gate — enforced whenever TRADERSPOST_CONFIRM_SECRET is configured.
  if (expectedSecret) {
    const provided = req.header("X-TradersPost-Confirm-Secret");
    if (provided !== expectedSecret) {
      await insertAuditRowSafe({
        action: "traderspost.order_confirm_unauthorized",
        entityType: "production_trade",
        entityId: null,
        decisionAuthority: "system",
        input: {} as Record<string, unknown>,
        result: { reason: "bad_secret" } as Record<string, unknown>,
        status: "error",
        correlationId: randomUUID(),
      });
      return res.status(401).json({ error: "invalid_traderspost_confirm_secret" });
    }
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const webhookId = extractWebhookId(body);
  if (!webhookId) {
    return res.status(400).json({ error: "missing_webhook_id" });
  }

  // Correlation: prefer an inbound X-Correlation-Id, else the matched row's own correlation_id
  // (joins the confirm back to the originating bar→handler→DB chain), else mint one so the audit
  // row is never un-correlatable.
  const inboundCorrelationId = req.header("X-Correlation-Id") ?? null;

  try {
    // Idempotent stamp: set confirmed_at ONLY once, ONLY on a matching not-yet-confirmed row.
    const updated = await db
      .update(productionTrades)
      .set({ traderspostConfirmedAt: sql`now()` })
      .where(
        and(
          eq(productionTrades.traderspostWebhookId, webhookId),
          isNull(productionTrades.traderspostConfirmedAt),
        ),
      )
      .returning({ id: productionTrades.id, correlationId: productionTrades.correlationId });

    const matched = updated.length > 0;
    let rowId: number | null = matched ? updated[0].id : null;
    let rowCorrelationId: string | null = matched ? (updated[0].correlationId ?? null) : null;
    let alreadyConfirmed = false;
    if (!matched) {
      // distinguish idempotent replay (row exists, already confirmed) from unknown id
      const existing = await db
        .select({ id: productionTrades.id, correlationId: productionTrades.correlationId })
        .from(productionTrades)
        .where(eq(productionTrades.traderspostWebhookId, webhookId))
        .limit(1);
      alreadyConfirmed = existing.length > 0;
      if (alreadyConfirmed) {
        rowId = existing[0].id;
        rowCorrelationId = existing[0].correlationId ?? null;
      }
    }

    const correlationId = inboundCorrelationId ?? rowCorrelationId ?? randomUUID();

    await insertAuditRowSafe({
      action: matched
        ? "traderspost.order_confirmed"
        : alreadyConfirmed
          ? "traderspost.order_confirm_idempotent_skip"
          : "traderspost.order_confirm_no_match",
      entityType: "production_trade",
      entityId: rowId != null ? String(rowId) : null,
      decisionAuthority: "system",
      input: { webhookId } as Record<string, unknown>,
      result: { matched, alreadyConfirmed } as Record<string, unknown>,
      status: matched || alreadyConfirmed ? "success" : "warning",
      correlationId,
    });

    // Always 200 for matched + idempotent replays (avoid TradersPost retry storms). A no-match
    // is also 200 (a 5xx would make TradersPost hammer us) but flagged in the body + a warn audit.
    return res.status(200).json({ ok: true, matched, alreadyConfirmed });
  } catch (err) {
    logger.error({ err, webhookId }, "traderspost-confirm: stamp failed");
    await insertAuditRowSafe({
      action: "traderspost.order_confirm_error",
      entityType: "production_trade",
      entityId: null,
      decisionAuthority: "system",
      input: { webhookId } as Record<string, unknown>,
      result: {} as Record<string, unknown>,
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      correlationId: inboundCorrelationId ?? randomUUID(),
    });
    return res.status(500).json({ error: "confirm_stamp_failed" });
  }
}

export const tradersPostConfirmRouter = Router();
tradersPostConfirmRouter.post("/order-status", (req: Request, res: Response) => {
  void handleTradersPostOrderStatus(req, res);
});
