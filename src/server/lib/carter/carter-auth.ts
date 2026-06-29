/**
 * carter-auth.ts — HMAC verification for the Carter ElevenLabs post-call webhook.
 *
 * ElevenLabs signs post-call webhooks with the `ElevenLabs-Signature` header in
 * the documented form:
 *
 *   ElevenLabs-Signature: t=<unix_seconds>,v0=<hex_hmac_sha256>
 *
 * where the HMAC is computed as HMAC-SHA256(secret, `${t}.${rawBody}`) — i.e. the
 * signed string is the unix-seconds timestamp, a literal ".", then the EXACT raw
 * request body bytes (verify BEFORE JSON.parse — re-serialized JSON will not match).
 * (Format confirmed 2026-06-28 against the ElevenLabs post-call-webhook docs /
 * SDK `constructEvent` scheme; this re-implements that scheme so we don't take a
 * new dependency.)
 *
 * Fail-CLOSED: any malformed header, missing parts, length mismatch, digest
 * mismatch, or stale timestamp (outside the tolerance window) returns invalid.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TOLERANCE_SECONDS = 30 * 60; // 30 minutes — matches ElevenLabs SDK

export interface ElevenLabsSignatureResult {
  valid: boolean;
  reason?: string;
  timestamp?: number;
}

/**
 * Verify an ElevenLabs-Signature header against the raw request body.
 *
 * @param rawBody    The exact raw request body (string or Buffer) — NOT re-serialized JSON.
 * @param sigHeader  The `ElevenLabs-Signature` header value (`t=...,v0=...`).
 * @param secret     The shared webhook secret (CARTER_POST_CALL_WEBHOOK_SECRET).
 * @param opts.toleranceSeconds  Max allowed clock skew (default 30 min). Pass 0 to disable.
 * @param opts.nowSeconds        Override "now" (testing only).
 */
export function verifyElevenLabsSignature(
  rawBody: string | Buffer,
  sigHeader: string | string[] | undefined,
  secret: string | undefined,
  opts?: { toleranceSeconds?: number; nowSeconds?: number },
): ElevenLabsSignatureResult {
  if (!secret) return { valid: false, reason: "secret_not_configured" };
  const header = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  if (!header || typeof header !== "string") return { valid: false, reason: "missing_signature_header" };

  // Parse the comma-separated `t=...,v0=...` pairs (order-independent).
  let t: string | undefined;
  let v0: string | undefined;
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (k === "t") t = val;
    else if (k === "v0") v0 = val;
  }
  if (!t || !v0) return { valid: false, reason: "malformed_signature_header" };

  const ts = Number(t);
  if (!Number.isFinite(ts) || ts <= 0) return { valid: false, reason: "invalid_timestamp" };

  const tolerance = opts?.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (tolerance > 0) {
    const now = opts?.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > tolerance) {
      return { valid: false, reason: "stale_timestamp", timestamp: ts };
    }
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");

  const expBuf = Buffer.from(expected, "utf8");
  const provBuf = Buffer.from(v0, "utf8");
  if (expBuf.length !== provBuf.length) return { valid: false, reason: "signature_mismatch", timestamp: ts };
  const ok = timingSafeEqual(expBuf, provBuf);
  return ok ? { valid: true, timestamp: ts } : { valid: false, reason: "signature_mismatch", timestamp: ts };
}

/** Build a valid ElevenLabs-Signature header (used by tests + smoke tooling). */
export function buildElevenLabsSignature(
  rawBody: string | Buffer,
  secret: string,
  tsSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  const hmac = createHmac("sha256", secret).update(`${tsSeconds}.${body}`, "utf8").digest("hex");
  return `t=${tsSeconds},v0=${hmac}`;
}
