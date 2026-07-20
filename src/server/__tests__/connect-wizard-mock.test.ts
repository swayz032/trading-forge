// src/server/__tests__/connect-wizard-mock.test.ts — broker-connect card, TEST MODE ONLY.
// The load-bearing claim under test: a REAL broker key cannot be persisted by this lane.
// It is enforced by an ALLOWLIST (explicit test marker required), not by trying to recognise
// real keys — blocklists leak, and "we didn't think of that format" is how credentials land
// in the wrong table.
import { describe, it, expect } from "vitest";
import {
  BROKER_KINDS,
  TEST_KEY_PREFIX,
  validateTestKey,
  redactKey,
  assertStorable,
} from "../lib/connect-wizard-mock.js";

describe("only designated TEST keys are accepted", () => {
  it("accepts a properly marked test key for each supported broker", () => {
    for (const kind of BROKER_KINDS) {
      const r = validateTestKey(kind, `${TEST_KEY_PREFIX}abcd1234`);
      expect(r.status).toBe("validated");
      expect(r.storableRef).toMatch(/^testref:/);
    }
  });

  // The whole point: these are all plausible-looking credentials and every one is refused.
  //
  // NOTE: the vendor-shaped fixtures are ASSEMBLED AT RUNTIME rather than written as string
  // literals. GitHub push protection correctly blocked an earlier version of this file whose
  // literal matched the Stripe key pattern — a test fixture that trips a real secret scanner
  // is itself a hazard, and the fix is to stop writing key-shaped literals, never to click
  // the "allow this secret" bypass. Concatenation keeps the runtime value realistic while
  // leaving no scannable pattern in source.
  it("REJECTS anything without the test marker — including realistic-looking keys", () => {
    const vendorShaped = [
      ["sk", "live", "0".repeat(24)].join("_"),              // card-processor shaped
      ["eyJhbGciOiJIUzI1NiJ9", "cGF5bG9hZA", "c2ln"].join("."), // JWT shaped
      ["tp", "live", "9f8c7b6a5d4e3f2a1b0c"].join("_"),      // traderspost-ish
      ["topstepx", "prod", "key", "abcdef123456"].join("_"),
      ["AKIA", "IOSFODNN7", "EXAMPLE"].join(""),             // cloud-provider shaped
      "1234-5678-9012-3456",
      "TESTKEY",            // marker-ish but not the marker
      "testkey-abcd1234",   // wrong case — marker is exact
      "NOPE-abcd1234",      // right shape, wrong marker
    ];
    for (const key of vendorShaped) {
      const r = validateTestKey("topstepx", key);
      expect(r.status).toBe("rejected");
      expect(r.storableRef).toBeNull();
    }
  });

  it("rejects unknown brokers, non-strings, empties and bad charsets", () => {
    expect(validateTestKey("ninjatrader", `${TEST_KEY_PREFIX}abcd`).reason).toBe("unknown_broker_kind");
    expect(validateTestKey("topstepx", null).reason).toBe("key_not_a_string");
    expect(validateTestKey("topstepx", 12345).reason).toBe("key_not_a_string");
    expect(validateTestKey("topstepx", "   ").reason).toBe("key_empty");
    expect(validateTestKey("topstepx", `${TEST_KEY_PREFIX}ab`).reason).toBe("test_key_too_short");
    expect(validateTestKey("topstepx", `${TEST_KEY_PREFIX}abc$%^&`).reason).toBe("test_key_charset");
  });
});

describe("key material never reaches a sink", () => {
  it("the storable ref does not contain the key body beyond a 4-char stub", () => {
    const secret = `${TEST_KEY_PREFIX}supersecretvalue9999`;
    const r = validateTestKey("topstepx", secret);
    expect(r.storableRef).toBe("testref:topstepx:supe");
    expect(r.storableRef).not.toContain("secretvalue");
    expect(r.storableRef).not.toContain(TEST_KEY_PREFIX);
  });

  it("the display string never contains key material", () => {
    const r = validateTestKey("traderspost", `${TEST_KEY_PREFIX}abcd1234`);
    expect(r.display).not.toContain("abcd1234");
    expect(r.display).not.toContain(TEST_KEY_PREFIX);
  });

  it("redactKey leaks nothing — not even length", () => {
    expect(redactKey("TESTKEY-abcd")).toBe("[redacted]");
    expect(redactKey("sk_live_very_long_real_secret_value")).toBe("[redacted]");
    expect(redactKey(null)).toBe("[redacted]");
  });
});

describe("assertStorable — last line before the DB", () => {
  it("passes a genuine testref through", () => {
    expect(assertStorable("testref:topstepx:abcd")).toBe("testref:topstepx:abcd");
    expect(assertStorable(null)).toBeNull();
  });

  it("THROWS rather than persisting anything that is not a testref", () => {
    expect(() => assertStorable("sk_live_realkey")).toThrow(/refusing to persist/);
    expect(() => assertStorable("abcd1234")).toThrow(/refusing to persist/);
  });

  it("THROWS if raw key material somehow rides along", () => {
    expect(() => assertStorable(`testref:topstepx:${TEST_KEY_PREFIX}abcd`)).toThrow(/raw key material/);
  });
});
