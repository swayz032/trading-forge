/**
 * live-order-token-scope.test.ts — CRIT (security-auth-hardening 2026-07-17)
 * format-invariant + cross-language parity fixture.
 *
 * The Pine emitter (Python: src/engine/pine_compiler.py via
 * src/engine/live_order_token_scope.py) and the backend verifier
 * (TypeScript: src/server/routes/live-order.ts via
 * src/shared/live-order-token-scope.ts) MUST produce byte-identical
 * canonical strings for the archetype tf_gateway scoped token. This fixture
 * hardcodes the SAME expected literal in both this file and
 * src/engine/tests/test_live_order_token_scope_parity.py — if either
 * language's canonical builder drifts from the documented format, that
 * language's test fails, catching drift the same way marker-contract's F-10
 * fixture does.
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import {
  buildArchetypeGatewayScopeCanonical,
  LIVE_ORDER_ARCHETYPE_SCOPE_SUFFIX,
  LIVE_ORDER_TOKEN_SCOPE_VERSION,
} from "../live-order-token-scope.js";

const FIXTURE = {
  accountId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  action: "archetype_signal",
  secret: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
} as const;

// MUST stay byte-identical to the literal hardcoded in
// test_live_order_token_scope_parity.py — this is the cross-language
// drift-detection mechanism.
const EXPECTED_CANONICAL =
  "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee|archetype_signal|live_order_archetype_scope";

describe("live-order-token-scope: format invariants (CRIT security-auth-hardening 2026-07-17)", () => {
  it("version tag is pinned at v1", () => {
    expect(LIVE_ORDER_TOKEN_SCOPE_VERSION).toBe("v1");
  });

  it("scope suffix is the literal 'live_order_archetype_scope'", () => {
    expect(LIVE_ORDER_ARCHETYPE_SCOPE_SUFFIX).toBe("live_order_archetype_scope");
  });

  it("buildArchetypeGatewayScopeCanonical produces the documented format", () => {
    expect(buildArchetypeGatewayScopeCanonical(FIXTURE.accountId, FIXTURE.action)).toBe(
      EXPECTED_CANONICAL,
    );
  });

  it("cross-language fixture: canonical matches the literal hardcoded on the Python side", () => {
    // If src/engine/live_order_token_scope.py's build_archetype_gateway_scope_canonical
    // ever drifts from this exact format, its own parity test
    // (test_live_order_token_scope_parity.py) fails against this SAME literal.
    expect(EXPECTED_CANONICAL).toBe(
      `${FIXTURE.accountId}|${FIXTURE.action}|${LIVE_ORDER_ARCHETYPE_SCOPE_SUFFIX}`,
    );
  });

  it("different account_id produces a different canonical (no collision)", () => {
    const other = buildArchetypeGatewayScopeCanonical("bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", FIXTURE.action);
    expect(other).not.toBe(EXPECTED_CANONICAL);
  });

  it("different action produces a different canonical (no collision)", () => {
    const other = buildArchetypeGatewayScopeCanonical(FIXTURE.accountId, "enter_long");
    expect(other).not.toBe(EXPECTED_CANONICAL);
  });
});

describe("live-order-token-scope: HMAC round-trip (CRIT security-auth-hardening 2026-07-17)", () => {
  it("HMAC-SHA256 over the scope canonical is stable and 64 hex chars", () => {
    const digest = createHmac("sha256", FIXTURE.secret)
      .update(buildArchetypeGatewayScopeCanonical(FIXTURE.accountId, FIXTURE.action), "utf8")
      .digest("hex");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("scoped token for archetype_signal differs from the raw secret", () => {
    const scoped = createHmac("sha256", FIXTURE.secret)
      .update(buildArchetypeGatewayScopeCanonical(FIXTURE.accountId, FIXTURE.action), "utf8")
      .digest("hex");
    expect(scoped).not.toBe(FIXTURE.secret);
  });

  it("scoped token differs across different actions (binding is action-specific)", () => {
    const scopedArchetypeSignal = createHmac("sha256", FIXTURE.secret)
      .update(buildArchetypeGatewayScopeCanonical(FIXTURE.accountId, "archetype_signal"), "utf8")
      .digest("hex");
    const scopedEnterLong = createHmac("sha256", FIXTURE.secret)
      .update(buildArchetypeGatewayScopeCanonical(FIXTURE.accountId, "enter_long"), "utf8")
      .digest("hex");
    expect(scopedArchetypeSignal).not.toBe(scopedEnterLong);
  });
});
