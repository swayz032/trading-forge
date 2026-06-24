/**
 * strategies-patch-lifecycle-hmac.test.ts — Pass 5 Track C
 *
 * Source-code analysis tests verifying HMAC guard on PATCH /:id/lifecycle.
 * No DB or service calls — pure static analysis of the route handler source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STRATEGIES_PATH = resolve(process.cwd(), "src/server/routes/strategies.ts");

describe("Pass 5 Track C — PATCH /:id/lifecycle HMAC guard", () => {
  it("checks ADMIN_PROMOTE_HMAC_SECRET env var", () => {
    const src = readFileSync(STRATEGIES_PATH, "utf8");
    expect(src).toContain("ADMIN_PROMOTE_HMAC_SECRET");
  });

  it("uses createHmac from node:crypto", () => {
    const src = readFileSync(STRATEGIES_PATH, "utf8");
    expect(src).toContain("createHmac");
  });

  it("uses timingSafeEqual to prevent timing attacks", () => {
    const src = readFileSync(STRATEGIES_PATH, "utf8");
    expect(src).toContain("timingSafeEqual");
  });

  it("returns 401 when ADMIN_PROMOTE_HMAC_SECRET is missing", () => {
    const src = readFileSync(STRATEGIES_PATH, "utf8");
    expect(src).toContain("admin_promote_hmac_not_configured");
    expect(src).toContain("res.status(401)");
  });

  it("returns 401 when timestamp or signature is missing/wrong type", () => {
    const src = readFileSync(STRATEGIES_PATH, "utf8");
    expect(src).toContain("hmac_required");
  });

  it("enforces 60 second timestamp drift limit", () => {
    const src = readFileSync(STRATEGIES_PATH, "utf8");
    expect(src).toContain("60_000");
    expect(src).toContain("timestamp_drift_exceeded");
  });

  it("signs payload as timestamp:strategyId:fromState:toState", () => {
    const src = readFileSync(STRATEGIES_PATH, "utf8");
    expect(src).toContain("`${timestamp}:${strategyId}:${fromState}:${toState}`");
  });

  it("returns 401 on HMAC mismatch", () => {
    const src = readFileSync(STRATEGIES_PATH, "utf8");
    expect(src).toContain("hmac_verification_failed");
  });

  it("does NOT have a NODE_ENV bypass around the HMAC secret check", () => {
    const src = readFileSync(STRATEGIES_PATH, "utf8");
    // The HMAC secret check block must NOT short-circuit based on NODE_ENV
    const secretCheckIdx = src.indexOf("ADMIN_PROMOTE_HMAC_SECRET");
    const secretCheckBlock = src.slice(secretCheckIdx, secretCheckIdx + 400);
    // The block that checks the secret must not branch on NODE_ENV
    expect(secretCheckBlock).not.toContain("NODE_ENV");
  });

  it("imports createHmac, timingSafeEqual from node:crypto", () => {
    const src = readFileSync(STRATEGIES_PATH, "utf8");
    expect(src).toContain('from "node:crypto"');
    expect(src).toContain("createHmac");
    expect(src).toContain("timingSafeEqual");
  });
});
