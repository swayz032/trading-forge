/**
 * carter-webhook.ts — Wave 1 Task 1.5
 *
 * POST /api/carter/webhook — ElevenLabs post-call transcription webhook sink.
 *
 * ElevenLabs calls this server-to-server after a Carter conversation ends, with
 * its own HMAC in the `ElevenLabs-Signature` header. It is therefore mounted
 * BEFORE the Bearer authMiddleware in index.ts (like /api/health) — the HMAC IS
 * the auth. The router brings its own `express.raw` body parser so we verify the
 * signature over the EXACT raw bytes (re-serialized JSON would not match).
 *
 * On a valid signature we append one immutable audit_log row:
 *   action = "carter.conversation_logged", status = "info",
 *   decision_authority = "voice_agent"
 * carrying the conversation id / summary / transcript. audit_log has NO `payload`
 * column — we use `input` + `result` JSONB. Invalid/missing signature → 401.
 *
 * decision_authority is a free-text column (no DB CHECK / enum — confirmed via
 * migration 0032 + schema.ts), so "voice_agent" is accepted as-is; no migration
 * and no audit-log-helper allow-list change is required.
 */
import express, { Router, type Request, type Response } from "express";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { logger } from "../lib/logger.js";
import { verifyElevenLabsSignature } from "../lib/carter/carter-auth.js";

interface TranscriptTurn { role?: string; message?: string }

function extractRaw(req: Request): string {
  const b = (req as Request & { body?: unknown }).body;
  if (Buffer.isBuffer(b)) return b.toString("utf8");
  if (typeof b === "string") return b;
  // Fallback (should not happen with express.raw): re-serialize. Signature will
  // then likely fail — which is the correct fail-closed behavior.
  return b == null ? "" : JSON.stringify(b);
}

export async function postCarterWebhook(req: Request, res: Response): Promise<void> {
  const rawBody = extractRaw(req);
  const sigHeader = req.headers["elevenlabs-signature"] as string | string[] | undefined;
  const secret = process.env.CARTER_POST_CALL_WEBHOOK_SECRET;

  const verdict = verifyElevenLabsSignature(rawBody, sigHeader, secret);
  if (!verdict.valid) {
    logger.warn({ reason: verdict.reason }, "carter-webhook: signature verification failed — 401");
    // Best-effort security audit row (different action — never the success action).
    await insertAuditRowSafe({
      action: "carter.webhook_rejected",
      entityType: "carter_conversation",
      entityId: null,
      decisionAuthority: "voice_agent",
      input: { reason: verdict.reason } as Record<string, unknown>,
      result: { rejected: true } as Record<string, unknown>,
      status: "failure",
    }).catch(() => undefined);
    res.status(401).json({ error: "invalid_signature", reason: verdict.reason });
    return;
  }

  // Parse the JSON payload AFTER signature verification.
  let payload: Record<string, unknown> = {};
  try {
    payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  } catch {
    res.status(400).json({ error: "invalid_json" });
    return;
  }

  const type = typeof payload.type === "string" ? (payload.type as string) : undefined;
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const analysis = (data.analysis ?? {}) as Record<string, unknown>;

  const conversationId = typeof data.conversation_id === "string" ? data.conversation_id : null;
  const agentId = typeof data.agent_id === "string" ? data.agent_id : null;
  const summary = typeof analysis.transcript_summary === "string" ? analysis.transcript_summary : null;
  const transcript = Array.isArray(data.transcript) ? (data.transcript as TranscriptTurn[]) : [];

  const ok = await insertAuditRowSafe({
    action: "carter.conversation_logged",
    entityType: "carter_conversation",
    entityId: conversationId,
    decisionAuthority: "voice_agent",
    status: "info",
    input: {
      type: type ?? "post_call_transcription",
      conversationId,
      agentId,
      eventTimestamp: payload.event_timestamp ?? null,
    } as Record<string, unknown>,
    result: {
      summary,
      turnCount: transcript.length,
      transcript,
      callSuccessful: analysis.call_successful ?? null,
    } as Record<string, unknown>,
  });

  if (!ok) {
    logger.error({ conversationId }, "carter-webhook: audit_log write failed");
    // 200 anyway — ElevenLabs must not retry-storm on our DB hiccup; the warn is
    // already logged. Returning 5xx would trigger redelivery against a dead DB.
  }

  logger.info({ conversationId, turnCount: transcript.length }, "carter-webhook: conversation logged");
  res.status(200).json({ ok: true });
}

export const carterWebhookRouter = Router();
// Own raw-body parser (accept any content-type ElevenLabs sends; cap at 5mb).
carterWebhookRouter.post("/", express.raw({ type: "*/*", limit: "5mb" }), postCarterWebhook);
