/**
 * deepscan-fixwave-relay-ip-sanitize.test.ts
 *
 * Deep-Scan fix-wave 2026-07-10, Fix 2 + Fix 3.
 *
 * `railway-relay/server.js` is the ONE component in the tower-relay tunnel that
 * terminates the real inbound TCP connection. `scripts/tower-relay-client.cjs`
 * (`proxyRequest`) replays whatever headers the relay hands it verbatim into a
 * fresh loopback `http.request()` on the tower — so anything the relay does not
 * sanitize reaches Express looking exactly as trustworthy as a value Express
 * minted itself. Pre-fix, the relay forwarded the client-supplied
 * `x-forwarded-for` header untouched, which let an attacker rotate it to bypass
 * `src/server/routes/slumhouse/admin.ts`'s brute-force lockout (a fresh header
 * value = a fresh bucket, every time) and left every relay caller sharing
 * `rate-limit.ts`'s single `127.0.0.1` bucket.
 *
 * This test exercises `railway-relay/ip-sanitize.js::sanitizeAndStampHeaders()`
 * directly — the exact function `server.js` calls before framing a request over
 * the WS tunnel to the tower.
 */
import { describe, it, expect } from "vitest";
import {
  RELAY_VERIFIED_IP_HEADER,
  normalizeRemoteAddress,
  sanitizeAndStampHeaders,
} from "../../../railway-relay/ip-sanitize.js";

describe("railway-relay/ip-sanitize.js — trusted-client-IP stamping (deep-scan fix-wave 2026-07-10)", () => {
  it("strips a client-supplied x-forwarded-for and replaces it with the socket peer", () => {
    const req = {
      headers: { "x-forwarded-for": "203.0.113.7, 1.2.3.4" }, // attacker-supplied, multi-hop-looking
      socket: { remoteAddress: "10.0.0.5" },
    };
    const out = sanitizeAndStampHeaders(req);
    expect(out["x-forwarded-for"]).toBeUndefined();
    expect(out[RELAY_VERIFIED_IP_HEADER]).toBe("10.0.0.5");
  });

  it("discards a pre-emptively spoofed copy of our own verified-ip header — never appends, always overwrites", () => {
    const req = {
      headers: { [RELAY_VERIFIED_IP_HEADER]: "9.9.9.9" }, // attacker tries to set our header directly
      socket: { remoteAddress: "10.0.0.5" },
    };
    const out = sanitizeAndStampHeaders(req);
    expect(out[RELAY_VERIFIED_IP_HEADER]).toBe("10.0.0.5");
    expect(out[RELAY_VERIFIED_IP_HEADER]).not.toBe("9.9.9.9");
  });

  it("two requests with DIFFERENT attacker-supplied x-forwarded-for but the SAME real socket peer produce the SAME stamped IP", () => {
    // This is the exact bypass this fix closes: pre-fix, admin.ts::clientKey() read
    // raw x-forwarded-for, so rotating this header minted a fresh brute-force bucket
    // per request. Post-fix, the relay never lets that value survive at all.
    const reqA = {
      headers: { "x-forwarded-for": "1.1.1.1" },
      socket: { remoteAddress: "10.0.0.5" },
    };
    const reqB = {
      headers: { "x-forwarded-for": "2.2.2.2" },
      socket: { remoteAddress: "10.0.0.5" },
    };
    const outA = sanitizeAndStampHeaders(reqA);
    const outB = sanitizeAndStampHeaders(reqB);
    expect(outA[RELAY_VERIFIED_IP_HEADER]).toBe(outB[RELAY_VERIFIED_IP_HEADER]);
    expect(outA[RELAY_VERIFIED_IP_HEADER]).toBe("10.0.0.5");
  });

  it("two requests from DIFFERENT real socket peers produce DIFFERENT stamped IPs (rate-limit granularity is preserved when the peer differs)", () => {
    const reqA = { headers: {}, socket: { remoteAddress: "10.0.0.5" } };
    const reqB = { headers: {}, socket: { remoteAddress: "10.0.0.6" } };
    const outA = sanitizeAndStampHeaders(reqA);
    const outB = sanitizeAndStampHeaders(reqB);
    expect(outA[RELAY_VERIFIED_IP_HEADER]).not.toBe(outB[RELAY_VERIFIED_IP_HEADER]);
  });

  it("does not mutate the original req.headers object", () => {
    const originalHeaders = { "x-forwarded-for": "1.1.1.1", "content-type": "application/json" };
    const req = { headers: originalHeaders, socket: { remoteAddress: "10.0.0.5" } };
    sanitizeAndStampHeaders(req);
    // Original object is untouched — only the returned copy is sanitized.
    expect(originalHeaders["x-forwarded-for"]).toBe("1.1.1.1");
  });

  it("preserves unrelated headers", () => {
    const req = {
      headers: { "content-type": "application/json", authorization: "Bearer xyz" },
      socket: { remoteAddress: "10.0.0.5" },
    };
    const out = sanitizeAndStampHeaders(req);
    expect(out["content-type"]).toBe("application/json");
    expect(out["authorization"]).toBe("Bearer xyz");
  });

  it("normalizeRemoteAddress strips the IPv4-mapped IPv6 prefix", () => {
    expect(normalizeRemoteAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeRemoteAddress("203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeRemoteAddress("::1")).toBe("::1");
  });

  it("normalizeRemoteAddress falls back to 'unknown' for a missing/undefined socket address", () => {
    expect(normalizeRemoteAddress(undefined)).toBe("unknown");
    expect(normalizeRemoteAddress("")).toBe("unknown");
  });

  it("missing socket falls back to 'unknown' rather than throwing", () => {
    const req = { headers: {} };
    const out = sanitizeAndStampHeaders(req as any);
    expect(out[RELAY_VERIFIED_IP_HEADER]).toBe("unknown");
  });
});
