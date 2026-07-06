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
 * ⚠ PAYLOAD MAPPING — OPERATOR MUST VERIFY: TradersPost's callback must carry the
 * traderspost_webhook_id we sent at submit (our deterministic idempotency key). The exact field
 * name depends on TradersPost's callback schema — this accepts the common aliases; confirm against
 * https://traderspost.io/docs/webhooks#order-callbacks and adjust `extractWebhookId` before enabling.
 */
import { Router, type Request, type Response } from "express";
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

// Exported for direct unit testing (repo's supertest-free convention).
export async function handleTradersPostOrderStatus(
  req: { body?: unknown; header: (name: string) => string | undefined },
  res: { status: (c: number) => { json: (b: unknown) => unknown } },
): Promise<unknown> {
  // Optional shared-secret gate — only enforced when TRADERSPOST_CONFIRM_SECRET is configured.
  const expectedSecret = process.env.TRADERSPOST_CONFIRM_SECRET;
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
      });
      return res.status(401).json({ error: "invalid_traderspost_confirm_secret" });
    }
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const webhookId = extractWebhookId(body);
  if (!webhookId) {
    return res.status(400).json({ error: "missing_webhook_id" });
  }

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
      .returning({ id: productionTrades.id });

    const matched = updated.length > 0;
    let alreadyConfirmed = false;
    if (!matched) {
      // distinguish idempotent replay (row exists, already confirmed) from unknown id
      const existing = await db
        .select({ id: productionTrades.id })
        .from(productionTrades)
        .where(eq(productionTrades.traderspostWebhookId, webhookId))
        .limit(1);
      alreadyConfirmed = existing.length > 0;
    }

    await insertAuditRowSafe({
      action: matched
        ? "traderspost.order_confirmed"
        : alreadyConfirmed
          ? "traderspost.order_confirm_idempotent_skip"
          : "traderspost.order_confirm_no_match",
      entityType: "production_trade",
      entityId: null,
      decisionAuthority: "system",
      input: { webhookId } as Record<string, unknown>,
      result: { matched, alreadyConfirmed } as Record<string, unknown>,
      status: matched || alreadyConfirmed ? "success" : "warning",
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
    });
    return res.status(500).json({ error: "confirm_stamp_failed" });
  }
}

export const tradersPostConfirmRouter = Router();
tradersPostConfirmRouter.post("/order-status", (req: Request, res: Response) => {
  void handleTradersPostOrderStatus(req, res);
});
