/**
 * carter-confirm.test.ts — confirmation-token protocol (Wave 5 Task 5.1).
 *
 * Pure crypto, no DB, no network.
 *
 * Cases:
 *   - valid round-trip passes
 *   - expired token rejects
 *   - tampered token rejects
 *   - replayed token rejects on the 2nd verify
 *   - wrong-action rejects
 *   - wrong-params rejects
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  issueConfirmation,
  verifyConfirmation,
  _resetUsedConfirmations,
} from "../../lib/carter/carter-confirm.js";

const SECRET = "test-carter-tools-secret-0123456789abcdef";

beforeEach(() => {
  process.env.CARTER_TOOLS_HMAC_SECRET = SECRET;
  _resetUsedConfirmations();
});

describe("carter-confirm — confirmation-token protocol", () => {
  it("valid round-trip passes", () => {
    const params = { mode: "PAUSED" };
    const { token, expires_in_s } = issueConfirmation("toggle_bot_power", params);
    expect(typeof token).toBe("string");
    expect(expires_in_s).toBe(120);

    const result = verifyConfirmation(token, "toggle_bot_power", params);
    expect(result.ok).toBe(true);
  });

  it("param key order does not matter (canonical hashing)", () => {
    const { token } = issueConfirmation("request_promotion", { strategyId: "s1", toState: "PAPER" });
    // Same fields, different insertion order.
    const result = verifyConfirmation(token, "request_promotion", { toState: "PAPER", strategyId: "s1" });
    expect(result.ok).toBe(true);
  });

  it("expired token rejects (exp in the past)", () => {
    const params = { mode: "PAUSED" };
    // Mint with a TTL that puts exp in the past.
    const { token } = issueConfirmation("toggle_bot_power", params, { ttlSeconds: -10 });
    const result = verifyConfirmation(token, "toggle_bot_power", params);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("tampered token rejects (hmac mismatch)", () => {
    const params = { mode: "PAUSED" };
    const { token } = issueConfirmation("toggle_bot_power", params);
    // Flip the last hex char of the HMAC segment.
    const last = token.slice(-1);
    const flipped = last === "0" ? "1" : "0";
    const tampered = token.slice(0, -1) + flipped;
    const result = verifyConfirmation(tampered, "toggle_bot_power", params);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("hmac_mismatch");
  });

  it("malformed token rejects", () => {
    const result = verifyConfirmation("not-a-real-token", "toggle_bot_power", { mode: "PAUSED" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed_token");
  });

  it("replayed token rejects on the 2nd verify (single-use)", () => {
    const params = { mode: "PAUSED" };
    const { token } = issueConfirmation("toggle_bot_power", params);

    const first = verifyConfirmation(token, "toggle_bot_power", params);
    expect(first.ok).toBe(true);

    const second = verifyConfirmation(token, "toggle_bot_power", params);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("replayed");
  });

  it("wrong-action rejects", () => {
    const params = { mode: "PAUSED" };
    const { token } = issueConfirmation("toggle_bot_power", params);
    const result = verifyConfirmation(token, "self_restart", params);
    expect(result.ok).toBe(false);
    // Action is bound into the HMAC, so a different action fails the hmac check.
    expect(result.reason).toBe("hmac_mismatch");
  });

  it("wrong-params rejects", () => {
    const { token } = issueConfirmation("toggle_bot_power", { mode: "PAUSED" });
    const result = verifyConfirmation(token, "toggle_bot_power", { mode: "ACTIVE" });
    expect(result.ok).toBe(false);
    // Params are bound into the HMAC, so different params fail the hmac check.
    expect(result.reason).toBe("hmac_mismatch");
  });

  it("fails closed when secret is not configured", () => {
    delete process.env.CARTER_TOOLS_HMAC_SECRET;
    const result = verifyConfirmation("anything", "toggle_bot_power", { mode: "PAUSED" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("secret_not_configured");
    expect(() => issueConfirmation("toggle_bot_power", { mode: "PAUSED" })).toThrow();
  });
});
