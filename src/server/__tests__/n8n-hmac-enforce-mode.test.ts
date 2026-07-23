/**
 * n8n F-3 (deep-scan re-verify 2026-07-06) — HMAC enforce-mode default is now durable.
 *
 * getHmacEnforceMode() previously defaulted to "warn" unconditionally (a 7-day 2026-05-21 transition
 * window that is long over), so an unsigned/wrong-sig POST to /api/n8n/execution-log was accepted even
 * with N8N_WEBHOOK_SECRET set. The fix defaults to ENFORCE when a secret is configured, WARN only when
 * unset (verifyN8nHmac itself fail-closes in prod for an unset secret). This pins that contract.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
vi.hoisted(() => { process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1:1/unused"; });
import { getHmacEnforceMode } from "../routes/n8n-tracking.js";

const SAVED_MODE = process.env.N8N_HMAC_ENFORCE_MODE;
const SAVED_SECRET = process.env.N8N_WEBHOOK_SECRET;

function restore(key: string, val: string | undefined): void {
  if (val === undefined) delete process.env[key];
  else process.env[key] = val;
}

describe("n8n HMAC enforce-mode default (F-3)", () => {
  afterEach(() => {
    restore("N8N_HMAC_ENFORCE_MODE", SAVED_MODE);
    restore("N8N_WEBHOOK_SECRET", SAVED_SECRET);
  });

  it("explicit N8N_HMAC_ENFORCE_MODE=enforce → 'enforce'", () => {
    process.env.N8N_HMAC_ENFORCE_MODE = "enforce";
    expect(getHmacEnforceMode()).toBe("enforce");
  });

  it("explicit N8N_HMAC_ENFORCE_MODE=warn → 'warn' (still respected even with a secret set)", () => {
    process.env.N8N_HMAC_ENFORCE_MODE = "warn";
    process.env.N8N_WEBHOOK_SECRET = "a-configured-secret";
    expect(getHmacEnforceMode()).toBe("warn");
  });

  it("unset mode + secret configured → 'enforce' (a set secret MUST be enforced, not fail-open)", () => {
    delete process.env.N8N_HMAC_ENFORCE_MODE;
    process.env.N8N_WEBHOOK_SECRET = "a-configured-secret";
    expect(getHmacEnforceMode()).toBe("enforce");
  });

  it("unset mode + no secret → 'warn' (cannot enforce without a secret; verifyN8nHmac fail-closes in prod)", () => {
    delete process.env.N8N_HMAC_ENFORCE_MODE;
    delete process.env.N8N_WEBHOOK_SECRET;
    expect(getHmacEnforceMode()).toBe("warn");
  });

  it("unrecognized explicit value + no secret → 'warn' (falls through to the secret-based default)", () => {
    process.env.N8N_HMAC_ENFORCE_MODE = "bogus";
    delete process.env.N8N_WEBHOOK_SECRET;
    expect(getHmacEnforceMode()).toBe("warn");
  });
});
