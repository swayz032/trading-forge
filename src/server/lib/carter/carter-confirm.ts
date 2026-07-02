/**
 * carter-confirm.ts — confirmation-token protocol for Carter YELLOW actions.
 *
 * YELLOW actions are risky-but-reversible (pause the bot, restart, trigger an
 * n8n workflow, run quantum, request a promotion). They follow a two-call
 * voice protocol:
 *
 *   1. Carter calls `propose_<x>` → reads back a human summary aloud + holds a
 *      short-lived single-use token (minted here via `issueConfirmation`).
 *   2. The operator says "confirm" out loud.
 *   3. Carter calls `confirm_<x>` with the token → `verifyConfirmation` gates the
 *      underlying service call.
 *
 * SECURITY MODEL (fail-CLOSED):
 *   - The token is an HMAC-SHA256 over `${action}|${stableStringify(params)}|${exp}`
 *     keyed by CARTER_TOOLS_HMAC_SECRET (the same secret the tools-plane Bearer auth
 *     uses). A token is ONLY valid if:
 *       (a) the HMAC verifies against the SUPPLIED action+params and the token's exp
 *           (so tampering with action, params, or exp invalidates it),
 *       (b) the bound action matches the action being confirmed,
 *       (c) the bound paramsHash matches the supplied params,
 *       (d) it has not expired (120s default TTL),
 *       (e) it has not already been used (in-memory single-use set).
 *   - No secret configured → verify returns ok:false (never opens), issue throws.
 *
 * This module has NO database and NO heavy imports — only node:crypto — so it is
 * safe to import from the carter-actions handler module without dragging the
 * Express bootstrap graph into tests.
 */

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/** Default confirmation token lifetime. */
export const CONFIRMATION_TTL_SECONDS = 120;

// ─── Pure helpers ──────────────────────────────────────────────────────────────

/** Deterministic, key-sorted JSON so the same params always hash identically. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function getSecret(): string | undefined {
  return process.env.CARTER_TOOLS_HMAC_SECRET;
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

// ─── Single-use replay guard ────────────────────────────────────────────────────
// Keyed by the token's HMAC (unique per token). In-memory by design — confirmations
// are seconds-lived and process-local; a restart invalidating pending tokens is the
// safe direction (operator just re-proposes).
const _usedTokens = new Set<string>();

/** Test-only: clear the single-use set between cases. */
export function _resetUsedConfirmations(): void {
  _usedTokens.clear();
}

// ─── issueConfirmation ──────────────────────────────────────────────────────────

export interface IssuedConfirmation {
  token: string;
  summary_hint: string;
  expires_in_s: number;
}

/**
 * Mint a single-use confirmation token bound to (action, params).
 *
 * @throws if CARTER_TOOLS_HMAC_SECRET is not configured (fail-CLOSED — we cannot
 *         sign, so we must not pretend a confirmation is available).
 */
export function issueConfirmation(
  action: string,
  params: object,
  opts: { nowSeconds?: number; ttlSeconds?: number } = {},
): IssuedConfirmation {
  const secret = getSecret();
  if (!secret) throw new Error("carter_confirm_secret_not_configured");

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds ?? CONFIRMATION_TTL_SECONDS;
  const exp = now + ttl;

  const canonical = stableStringify(params);
  const paramsHash = sha256Hex(canonical);
  const hmac = createHmac("sha256", secret)
    .update(`${action}|${canonical}|${exp}`, "utf8")
    .digest("hex");

  const payload = b64urlEncode(JSON.stringify({ action, paramsHash, exp }));
  const token = `${payload}.${hmac}`;

  return {
    token,
    summary_hint: `Confirm to execute "${action}". This token expires in ${ttl} seconds and is single-use.`,
    expires_in_s: ttl,
  };
}

// ─── verifyConfirmation ─────────────────────────────────────────────────────────

export interface VerifyConfirmationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verify a confirmation token against the action + params being executed.
 *
 * Passes ONLY when: hmac valid, action matches, paramsHash matches, not expired,
 * not already used. Marks the token used on success (single-use). Never throws.
 */
export function verifyConfirmation(
  token: string,
  action: string,
  params: object,
  opts: { nowSeconds?: number } = {},
): VerifyConfirmationResult {
  const secret = getSecret();
  if (!secret) return { ok: false, reason: "secret_not_configured" };
  if (!token || typeof token !== "string") return { ok: false, reason: "missing_token" };

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed_token" };
  const payloadPart = token.slice(0, dot);
  const hmacPart = token.slice(dot + 1);

  let decoded: { action?: unknown; paramsHash?: unknown; exp?: unknown };
  try {
    decoded = JSON.parse(b64urlDecode(payloadPart));
  } catch {
    return { ok: false, reason: "malformed_token" };
  }
  const exp = Number(decoded.exp);
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed_token" };

  const canonical = stableStringify(params);

  // Recompute the HMAC over the SUPPLIED action+params and the token's exp.
  // Any tampering with action, params, or exp produces a mismatch here.
  const expectedHmac = createHmac("sha256", secret)
    .update(`${action}|${canonical}|${exp}`, "utf8")
    .digest("hex");
  const expBuf = Buffer.from(expectedHmac, "utf8");
  const provBuf = Buffer.from(hmacPart, "utf8");
  if (expBuf.length !== provBuf.length || !timingSafeEqual(expBuf, provBuf)) {
    return { ok: false, reason: "hmac_mismatch" };
  }

  // HMAC valid → bound claims are authentic. Cross-check defensively.
  if (decoded.action !== action) return { ok: false, reason: "action_mismatch" };
  if (decoded.paramsHash !== sha256Hex(canonical)) return { ok: false, reason: "params_mismatch" };

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (exp <= now) return { ok: false, reason: "expired" };

  if (_usedTokens.has(hmacPart)) return { ok: false, reason: "replayed" };
  _usedTokens.add(hmacPart);
  return { ok: true };
}
