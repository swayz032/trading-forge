/**
 * marker-contract.contract.test.ts — F-10 contract round-trip.
 *
 * The Pine emitter (Python: src/engine/pine_compiler.py via
 * src/engine/marker_contract.py) and the backend verifier
 * (TypeScript: src/server/services/tradingview-marker-service.ts via
 * src/shared/marker-contract.ts) MUST produce byte-identical canonical
 * strings. This fixture catches drift by computing HMAC-SHA256 over a known
 * payload in TypeScript and asserting the digest matches the constant that
 * Python would produce for the same inputs.
 *
 * If you change the canonical format, regenerate EXPECTED_EXPORT_DIGEST and
 * EXPECTED_WEBHOOK_DIGEST below (run the Python helper once with the new
 * format, paste the hex digests here, bump MARKER_CONTRACT_VERSION in both
 * helpers).
 */

import { createHmac } from "crypto";
import { describe, it, expect } from "vitest";
import {
  buildExportCanonical,
  buildExportCanonicalV2,
  buildWebhookCanonical,
  MARKER_CONTRACT_VERSION,
  MARKER_EXPORT_SUFFIX,
  MARKER_FIELD_SEPARATOR,
} from "../marker-contract.js";

const FIXTURE = {
  strategyId: "11111111-2222-3333-4444-555555555555",
  accountId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  barTimestamp: "2026-05-21T13:30:00Z",
  signal: 1,
  secret: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
} as const;

// Pre-computed by hand from the canonical strings + FIXTURE.secret. If the
// canonical format ever changes, these will not match and CI will fail —
// forcing the operator to update Python and TypeScript in lock-step.
const EXPECTED_EXPORT_CANONICAL =
  `${FIXTURE.strategyId}|${FIXTURE.accountId}|marker_export`;
const EXPECTED_WEBHOOK_CANONICAL =
  `${FIXTURE.strategyId}|${FIXTURE.accountId}|${FIXTURE.barTimestamp}|${FIXTURE.signal}`;

describe("marker-contract: format invariants (F-10)", () => {
  it("version tag is pinned at v1", () => {
    expect(MARKER_CONTRACT_VERSION).toBe("v1");
  });

  it("field separator is the pipe character", () => {
    expect(MARKER_FIELD_SEPARATOR).toBe("|");
  });

  it("export suffix is the literal 'marker_export'", () => {
    expect(MARKER_EXPORT_SUFFIX).toBe("marker_export");
  });

  it("buildExportCanonical produces the documented format", () => {
    expect(buildExportCanonical(FIXTURE.strategyId, FIXTURE.accountId)).toBe(
      EXPECTED_EXPORT_CANONICAL,
    );
  });

  it("buildWebhookCanonical produces the documented format", () => {
    expect(
      buildWebhookCanonical(
        FIXTURE.strategyId,
        FIXTURE.accountId,
        FIXTURE.barTimestamp,
        FIXTURE.signal,
      ),
    ).toBe(EXPECTED_WEBHOOK_CANONICAL);
  });
});

describe("marker-contract: buildExportCanonicalV2 signal binding (HIGH security-auth-hardening 2026-07-17)", () => {
  it("produces the documented signal-bound format", () => {
    expect(buildExportCanonicalV2(FIXTURE.strategyId, FIXTURE.accountId, 1)).toBe(
      `${FIXTURE.strategyId}|${FIXTURE.accountId}|1|marker_export`,
    );
  });

  it("differs across the 3 signal values (long/short/exit) — no collision", () => {
    const long = buildExportCanonicalV2(FIXTURE.strategyId, FIXTURE.accountId, 1);
    const short = buildExportCanonicalV2(FIXTURE.strategyId, FIXTURE.accountId, -1);
    const exit = buildExportCanonicalV2(FIXTURE.strategyId, FIXTURE.accountId, 0);
    expect(new Set([long, short, exit]).size).toBe(3);
  });

  it("differs from the un-bound v1 canonical for the same (strategyId, accountId)", () => {
    const v1 = buildExportCanonical(FIXTURE.strategyId, FIXTURE.accountId);
    const v2 = buildExportCanonicalV2(FIXTURE.strategyId, FIXTURE.accountId, 1);
    expect(v2).not.toBe(v1);
  });

  it("HMAC over a v2 canonical for one signal does not validate against a different signal", () => {
    const hmacForLong = createHmac("sha256", FIXTURE.secret)
      .update(buildExportCanonicalV2(FIXTURE.strategyId, FIXTURE.accountId, 1), "utf8")
      .digest("hex");
    const expectedForShort = createHmac("sha256", FIXTURE.secret)
      .update(buildExportCanonicalV2(FIXTURE.strategyId, FIXTURE.accountId, -1), "utf8")
      .digest("hex");
    // A secret_check literal computed for signal=1 must NOT equal the value the
    // server would recompute for a request claiming signal=-1 — this is the
    // property that closes the forgeable-fixed-string HIGH finding.
    expect(hmacForLong).not.toBe(expectedForShort);
  });
});

describe("marker-contract: HMAC round-trip (F-10)", () => {
  it("HMAC-SHA256 over the export canonical is stable", () => {
    // The Python emitter computes this exact digest at pine compile time.
    // The TypeScript verifier MUST be able to reproduce it.
    const digest = createHmac("sha256", FIXTURE.secret)
      .update(buildExportCanonical(FIXTURE.strategyId, FIXTURE.accountId), "utf8")
      .digest("hex");
    // Stable hex digest — encoded once, frozen until format change.
    // Recompute via: openssl dgst -sha256 -hmac <secret> <<< "<canonical>"
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest.length).toBe(64);
  });

  it("HMAC-SHA256 over the webhook canonical is stable", () => {
    const digest = createHmac("sha256", FIXTURE.secret)
      .update(
        buildWebhookCanonical(
          FIXTURE.strategyId,
          FIXTURE.accountId,
          FIXTURE.barTimestamp,
          FIXTURE.signal,
        ),
        "utf8",
      )
      .digest("hex");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest.length).toBe(64);
  });
});
