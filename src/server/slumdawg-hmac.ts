/**
 * slumdawg-hmac.ts — Pass 1 Track A (hardening/phase-0)
 *
 * Shared HMAC helpers for the Slumdawg ingest authentication scheme.
 * Both src/server/routes/slumdawg.ts (validator) and src/discord/bot.ts (signer)
 * import from this single module. A shared module is the only reliable way to
 * prevent signer/validator drift — any change to the formula is automatically
 * reflected on both sides.
 *
 * FORMULA:
 *   HMAC-SHA256(key=secret, message="${ts}:${path}") → hex digest
 *
 *   where:
 *     ts   = Unix epoch seconds as decimal string (e.g. "1719000000")
 *     path = req.path inside the slumdawg router (e.g. "/ingest-youtube")
 *            Express strips the "/api/admin/slumdawg" mount prefix before
 *            handing the request to the router, so path starts with "/".
 *
 * PLACEHOLDER:
 *   "slumdawg-rotate-me-after-first-deploy-2026-05-25"
 *   Any route protected by requireSlumdawgAuth hard-503s when the live secret
 *   matches this value — same behaviour as when it is unset.
 *
 * INVARIANTS:
 *   - HMAC key = secret (not embedded in message)
 *   - Separator = colon (not dot)
 *   - No body content in the signed payload (unlike the old broken bot.ts scheme)
 *   - Algorithm = SHA-256
 *   - Output = lowercase hex
 */

import { createHmac, timingSafeEqual } from "node:crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

export const SLUMDAWG_PLACEHOLDER_SECRET =
  "slumdawg-rotate-me-after-first-deploy-2026-05-25";

// ─── isUnconfiguredSlumdawgSecret ─────────────────────────────────────────────

/**
 * Returns true when the secret is absent or is the documented placeholder.
 * A 503 is the correct response when this returns true — no auth bypass.
 */
export function isUnconfiguredSlumdawgSecret(
  secret: string | undefined,
): boolean {
  if (!secret || secret.length === 0) return true;
  if (secret === SLUMDAWG_PLACEHOLDER_SECRET) return true;
  return false;
}

// ─── signSlumdawgRequest ──────────────────────────────────────────────────────

/**
 * Compute the HMAC signature for a Slumdawg request.
 *
 * @param ts     Unix epoch seconds as a decimal string (caller obtains via
 *               String(Math.floor(Date.now() / 1000)))
 * @param path   The request path as seen by the router, e.g. "/ingest-youtube".
 *               Must start with "/" — do NOT include the mount prefix.
 * @param secret The SLUMDAWG_WEBHOOK_SECRET value. Returns "" when empty
 *               so callers can guard on falsy before including the header.
 * @returns      Lowercase hex HMAC-SHA256 digest, or "" if secret is empty.
 */
export function signSlumdawgRequest(
  ts: string,
  path: string,
  secret: string,
): string {
  if (!secret) return "";
  return createHmac("sha256", secret).update(`${ts}:${path}`).digest("hex");
}

// ─── verifySlumdawgHmac ───────────────────────────────────────────────────────

/**
 * Verify a Slumdawg HMAC signature in constant time.
 *
 * @param headerValue  The X-Slumdawg-Signature header value.
 * @param ts           The X-Slumdawg-Timestamp header value (decimal seconds string).
 * @param path         req.path as seen by the slumdawg router (e.g. "/ingest-youtube").
 * @param secret       The live SLUMDAWG_WEBHOOK_SECRET (caller must ensure it is configured).
 *
 * @returns { ok: true } on match, { ok: false, reason_code: string } on failure.
 *
 * NOTE: callers must check isUnconfiguredSlumdawgSecret BEFORE calling this function.
 *       This function assumes a valid secret is provided.
 */
export function verifySlumdawgHmac(
  headerValue: string | undefined,
  ts: string,
  path: string,
  secret: string,
): { ok: true } | { ok: false; reason_code: string } {
  if (!headerValue || typeof headerValue !== "string" || headerValue.length === 0) {
    return { ok: false, reason_code: "missing_header" };
  }

  const expected = signSlumdawgRequest(ts, path, secret);

  if (headerValue.length !== expected.length) {
    return { ok: false, reason_code: "signature_mismatch" };
  }

  try {
    const ok = timingSafeEqual(
      Buffer.from(headerValue, "hex"),
      Buffer.from(expected, "hex"),
    );
    return ok ? { ok: true } : { ok: false, reason_code: "signature_mismatch" };
  } catch {
    return { ok: false, reason_code: "signature_mismatch" };
  }
}
