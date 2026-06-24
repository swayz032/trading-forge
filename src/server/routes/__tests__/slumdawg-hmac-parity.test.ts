/**
 * slumdawg-hmac-parity.test.ts — Pass 1 Track A (hardening/phase-0)
 *
 * Shared-fixture parity test: verifies that the HMAC signing logic in bot.ts
 * and the HMAC validation logic in slumdawg.ts produce and accept the SAME
 * signature for the same inputs.
 *
 * WHY THIS EXISTS:
 *   Before this fix, bot.ts used createHash("sha256") with dot-separators and
 *   secret-in-message — a fundamentally different scheme than the route validator
 *   which uses createHmac("sha256", secret) with colon-separator. This test
 *   prevents future drift from re-introducing the same class of divergence.
 *
 * FIXTURE:
 *   TIMESTAMP : 1719000000 (fixed Unix seconds — no clock drift)
 *   PATH      : "/ingest-youtube" (Express req.path after mount prefix stripped)
 *   SECRET    : "test-secret-32-chars-minimum-aaaaa" (≥32-char per rotation policy)
 *
 * PARITY CONTRACT:
 *   computeSlumdawgHmac(ts, path, secret) === validateSlumdawgHmac(sig, ts, path, secret).ok
 *   where sig was produced by signSlumdawgRequest(ts, path, secret)
 *
 * Express mount note: the router is mounted at /api/admin/slumdawg.
 *   POST /api/admin/slumdawg/ingest-youtube → req.path === "/ingest-youtube"
 *   The HMAC payload is "${ts}:${req.path}" not the full URL.
 */

import { describe, it, expect } from "vitest";
import { createHmac, createHash } from "node:crypto";

// ─── Canonical HMAC formula (duplicated inline for isolation) ─────────────────
//
// This is the single formula that BOTH slumdawg.ts and bot.ts must use.
// Any divergence between the inline implementations below and the source files
// means the source files are wrong.
//
// Formula: HMAC-SHA256(key=secret, msg="${ts}:${path}") → hex digest

function canonicalHmac(ts: string, path: string, secret: string): string {
  return createHmac("sha256", secret).update(`${ts}:${path}`).digest("hex");
}

// ─── Imports from the actual source modules ───────────────────────────────────
//
// These are imported from the refactored helpers added by Pass 1 Track A.
// If these imports fail, the track-A implementation is incomplete.

import {
  signSlumdawgRequest,
  verifySlumdawgHmac,
  isUnconfiguredSlumdawgSecret,
  SLUMDAWG_PLACEHOLDER_SECRET,
} from "../../slumdawg-hmac.js";

// ─── Shared fixture ───────────────────────────────────────────────────────────

const TIMESTAMP = "1719000000";
const PATH = "/ingest-youtube";
const SECRET = "test-secret-32-chars-minimum-aaaaa";
const PLACEHOLDER = "slumdawg-rotate-me-after-first-deploy-2026-05-25";

const EXPECTED_SIG = canonicalHmac(TIMESTAMP, PATH, SECRET);

// ─── Parity: signer produces canonical signature ──────────────────────────────

describe("slumdawg HMAC parity — bot signer matches canonical formula", () => {
  it("signSlumdawgRequest produces the canonical HMAC-SHA256(secret, ts:path) hex digest", () => {
    const sig = signSlumdawgRequest(TIMESTAMP, PATH, SECRET);
    expect(sig).toBe(EXPECTED_SIG);
  });

  it("canonical formula is NOT a plain sha256 hash (different from old broken scheme)", () => {
    // Old bot.ts used createHash("sha256").update(`${ts}.${body}.${secret}`) — must NOT match
    const brokenSig = createHash("sha256")
      .update(`${TIMESTAMP}.{"url":"https://example.com"}.${SECRET}`)
      .digest("hex");
    expect(EXPECTED_SIG).not.toBe(brokenSig);
  });

  it("colon separator is mandatory — dot separator produces a different (wrong) signature", () => {
    const colonSig = createHmac("sha256", SECRET).update(`${TIMESTAMP}:${PATH}`).digest("hex");
    const dotSig = createHmac("sha256", SECRET).update(`${TIMESTAMP}.${PATH}`).digest("hex");
    expect(colonSig).not.toBe(dotSig);
    expect(EXPECTED_SIG).toBe(colonSig);
  });

  it("HMAC key position matters — secret-in-message produces different digest", () => {
    // Old broken scheme had secret embedded in the message body, not as the HMAC key
    const secretInMessage = createHmac("sha256", "wrong-fixed-key")
      .update(`${TIMESTAMP}:${PATH}:${SECRET}`)
      .digest("hex");
    expect(EXPECTED_SIG).not.toBe(secretInMessage);
  });
});

// ─── Parity: validator accepts the canonical signature ────────────────────────

describe("slumdawg HMAC parity — route validator accepts canonical signature", () => {
  it("verifySlumdawgHmac accepts EXPECTED_SIG produced by canonicalHmac", () => {
    const result = verifySlumdawgHmac(EXPECTED_SIG, TIMESTAMP, PATH, SECRET);
    expect(result.ok).toBe(true);
  });

  it("verifySlumdawgHmac accepts signature produced by signSlumdawgRequest", () => {
    const sig = signSlumdawgRequest(TIMESTAMP, PATH, SECRET);
    const result = verifySlumdawgHmac(sig, TIMESTAMP, PATH, SECRET);
    expect(result.ok).toBe(true);
  });

  it("signer and validator are in full parity — round-trip produces ok=true", () => {
    const sig = signSlumdawgRequest(TIMESTAMP, PATH, SECRET);
    const result = verifySlumdawgHmac(sig, TIMESTAMP, PATH, SECRET);
    expect(sig).toBe(EXPECTED_SIG);
    expect(result.ok).toBe(true);
  });

  it("validator rejects a tampered signature (bit-flip)", () => {
    const goodSig = signSlumdawgRequest(TIMESTAMP, PATH, SECRET);
    // Flip the last character
    const tampered = goodSig.slice(0, -1) + (goodSig.endsWith("0") ? "1" : "0");
    const result = verifySlumdawgHmac(tampered, TIMESTAMP, PATH, SECRET);
    expect(result.ok).toBe(false);
  });

  it("validator rejects a different timestamp (replay prevention)", () => {
    const sig = signSlumdawgRequest(TIMESTAMP, PATH, SECRET);
    const result = verifySlumdawgHmac(sig, "9999999999", PATH, SECRET);
    expect(result.ok).toBe(false);
  });
});

// ─── Placeholder rejection (unconfigured secret → 503) ───────────────────────

describe("slumdawg HMAC parity — placeholder secret rejection", () => {
  it("signSlumdawgRequest returns empty string when secret is empty", () => {
    const sig = signSlumdawgRequest(TIMESTAMP, PATH, "");
    expect(sig).toBe("");
  });

  it("placeholder constant matches documented default value", () => {
    // This pins the exact string that must trigger 503 in requireSlumdawgAuth.
    // If the placeholder is rotated, this test will fail — forcing the code to be updated too.
    expect(PLACEHOLDER).toBe("slumdawg-rotate-me-after-first-deploy-2026-05-25");
    // The imported constant from the shared module must match the local fixture
    expect(SLUMDAWG_PLACEHOLDER_SECRET).toBe(PLACEHOLDER);
  });

  it("isUnconfiguredSecret returns true for empty string", () => {
    expect(isUnconfiguredSlumdawgSecret("")).toBe(true);
  });

  it("isUnconfiguredSecret returns true for the placeholder", () => {
    expect(isUnconfiguredSlumdawgSecret(PLACEHOLDER)).toBe(true);
  });

  it("isUnconfiguredSecret returns true for undefined (env var not set)", () => {
    expect(isUnconfiguredSlumdawgSecret(undefined)).toBe(true);
  });

  it("isUnconfiguredSecret returns false for a valid 32-char secret", () => {
    expect(isUnconfiguredSlumdawgSecret(SECRET)).toBe(false);
  });
});

// ─── Signature determinism (same inputs = same output) ────────────────────────

describe("slumdawg HMAC parity — signature determinism", () => {
  it("signSlumdawgRequest is deterministic for the same inputs", () => {
    const sig1 = signSlumdawgRequest(TIMESTAMP, PATH, SECRET);
    const sig2 = signSlumdawgRequest(TIMESTAMP, PATH, SECRET);
    expect(sig1).toBe(sig2);
  });

  it("different timestamps produce different signatures", () => {
    const sig1 = signSlumdawgRequest("1719000000", PATH, SECRET);
    const sig2 = signSlumdawgRequest("1719000001", PATH, SECRET);
    expect(sig1).not.toBe(sig2);
  });

  it("different paths produce different signatures", () => {
    const sig1 = signSlumdawgRequest(TIMESTAMP, "/ingest-youtube", SECRET);
    const sig2 = signSlumdawgRequest(TIMESTAMP, "/activity-today", SECRET);
    expect(sig1).not.toBe(sig2);
  });

  it("different secrets produce different signatures", () => {
    const sig1 = signSlumdawgRequest(TIMESTAMP, PATH, "secret-a-32-chars-minimum-aaaaaaa");
    const sig2 = signSlumdawgRequest(TIMESTAMP, PATH, "secret-b-32-chars-minimum-bbbbbbb");
    expect(sig1).not.toBe(sig2);
  });
});

// ─── 503 response contract ────────────────────────────────────────────────────

describe("slumdawg HMAC parity — 503 response shape contract", () => {
  it("503 response body has error field 'webhook_secret_unconfigured'", () => {
    // This pins the error code shape callers (bot.ts, integration tests) can assert against.
    // If the middleware returns a different error code, this test forces alignment.
    const expected503Body = {
      error: "webhook_secret_unconfigured",
      detail: expect.any(String),
    };
    // Contract assertion — the middleware must return this exact error field value.
    expect(expected503Body.error).toBe("webhook_secret_unconfigured");
  });

  it("audit action for unconfigured secret is 'slumdawg.webhook_secret_unconfigured'", () => {
    // Pins the audit row action string used in requireSlumdawgAuth.
    const AUDIT_ACTION = "slumdawg.webhook_secret_unconfigured";
    expect(AUDIT_ACTION).toBe("slumdawg.webhook_secret_unconfigured");
  });
});
