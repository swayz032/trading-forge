// src/server/lib/connect-wizard-mock.ts — floating broker-connect card, TEST MODE ONLY.
//
// OR-017 §1: "real keys are never persisted in test mode — test mode accepts designated
// fake/test keys only." This module is where that stops being a promise and becomes a
// mechanism. Everything here is pure; the caller persists the result to
// `slumhouse_connect_test` and NEVER to `broker_accounts`.
//
// THE INVERSION THAT MATTERS: this does not try to detect and reject real keys — that is a
// blocklist, and blocklists leak. It ACCEPTS ONLY strings that carry an explicit test marker
// and rejects everything else, including anything that merely looks plausible. A real key
// cannot pass because it does not carry the marker, not because we recognised it as real.
//
// NO LIVE BROKER CALL EXISTS IN THIS LANE. Validation is shape-only and offline.
export type BrokerKind = "topstepx" | "traderspost";
export const BROKER_KINDS: readonly BrokerKind[] = ["topstepx", "traderspost"];

/** Designated test-key prefix. Anything without it is refused, whatever it looks like. */
export const TEST_KEY_PREFIX = "TESTKEY-";

export type ConnectStatus = "pending" | "validated" | "rejected";

export interface MockValidationResult {
  status: ConnectStatus;
  reason: string;
  /** Safe to persist. Null whenever nothing may be stored. */
  storableRef: string | null;
  /** Always safe to render — never contains key material. */
  display: string;
}

const REJECT = (reason: string): MockValidationResult => ({
  status: "rejected",
  reason,
  storableRef: null,
  display: "not connected",
});

/**
 * Shape-only, offline validation of a DESIGNATED TEST key.
 * Returns a storable reference that is a masked marker, never the input.
 */
export function validateTestKey(brokerKind: string, rawKey: unknown): MockValidationResult {
  if (!BROKER_KINDS.includes(brokerKind as BrokerKind)) return REJECT("unknown_broker_kind");
  if (typeof rawKey !== "string") return REJECT("key_not_a_string");

  const key = rawKey.trim();
  if (key.length === 0) return REJECT("key_empty");

  // ALLOWLIST, not blocklist. A real credential fails here because it lacks the marker.
  if (!key.startsWith(TEST_KEY_PREFIX)) return REJECT("not_a_designated_test_key");

  const body = key.slice(TEST_KEY_PREFIX.length);
  if (body.length < 4) return REJECT("test_key_too_short");
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return REJECT("test_key_charset");

  // The stored reference is a MARKER, never the key: even a test key is not echoed to disk,
  // so the persistence path is identical in shape to the real Phase-5 vault flow.
  return {
    status: "validated",
    reason: "test_key_accepted",
    storableRef: `testref:${brokerKind}:${body.slice(0, 4)}`,
    display: `connected (test mode) · ${brokerKind}`,
  };
}

/**
 * Redaction for logs/audit/UI. Never let key material reach a sink.
 * Returns a fixed placeholder — length is not leaked either.
 */
export function redactKey(_raw: unknown): string {
  return "[redacted]";
}

/** Guard for the persistence layer: refuses to hand back anything key-shaped. */
export function assertStorable(ref: string | null): string | null {
  if (ref === null) return null;
  if (!ref.startsWith("testref:")) {
    throw new Error("connect-wizard: refusing to persist a non-testref value");
  }
  if (ref.includes(TEST_KEY_PREFIX)) {
    throw new Error("connect-wizard: refusing to persist a value containing raw key material");
  }
  return ref;
}
