/**
 * traderspost-idempotency-fallback.test.ts — F-3 (2026-06-23)
 *
 * When barTimestamp is ABSENT, the old fallback was:
 *   `${strategyId}-${ticker}-${action}`  (static — same key every call)
 *
 * TradersPost treats all same-direction entries sharing that key as duplicates,
 * so only the first call would ever route. The fix: append randomUUID() so each
 * bar-timestamp-less call is unique.
 *
 * When barTimestamp IS present, the key remains deterministic (SHA-256 over the
 * five-field tuple) — that path is not changed.
 *
 * Tests use direct import of the real `submitWebhookOrder` with the outbound
 * fetch mocked (no real HTTP) and verify the idempotency key shape sent in the
 * X-Idempotency-Key header.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── UUID regex (RFC 4122 v4) ─────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Mocks ────────────────────────────────────────────────────────────────────

const capturedHeaders: string[] = [];

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.fetch);

vi.mock("../../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Import module under test ─────────────────────────────────────────────────

const { submitWebhookOrder, buildDeterministicIdempotencyKey } = await import(
  "../integrations/traderspost/client.js"
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOkResponse(): Response {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const BASE_PAYLOAD = {
  apiKey: "test-api-key",
  ticker: "MES1!",
  action: "buy" as const,    // TradersPostAction is "buy"|"sell"|"exit"|"cancel"
  strategyId: "strat-aaa",
  orderType: "market" as const,
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("F-3 — non-bar-scoped idempotency fallback uses randomUUID", () => {
  beforeEach(() => {
    capturedHeaders.length = 0;
    mocks.fetch.mockClear();
    mocks.fetch.mockResolvedValue(makeOkResponse());
  });

  // ── F-3.1: Fallback key is NOT the old static form ────────────────────────

  it("F-3.1: when idempotencyInputs is omitted, key is NOT just 'strategyId-ticker-action'", async () => {
    await submitWebhookOrder(BASE_PAYLOAD, "corr-1");

    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    const key = (init.headers as Record<string, string>)["X-Idempotency-Key"];

    // Old broken static key would be "strat-aaa-MES1!-buy" (no UUID)
    expect(key).not.toBe("strat-aaa-MES1!-buy");
  });

  // ── F-3.2: Fallback key ends with a valid UUID v4 ─────────────────────────

  it("F-3.2: when idempotencyInputs is omitted, key ends with a UUID v4 suffix", async () => {
    await submitWebhookOrder(BASE_PAYLOAD, "corr-2");

    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    const key = (init.headers as Record<string, string>)["X-Idempotency-Key"];

    // Key must be "strat-aaa-MES1!-enter_long-<uuid>"
    const parts = key.split("-");
    // UUID v4 has 5 groups (8-4-4-4-12), so key parts: strat + aaa + MES1! + enter_long + uuid-groups
    // Easier: last 5 dash-segments re-joined form the UUID
    const uuidPart = parts.slice(-5).join("-");
    expect(UUID_RE.test(uuidPart)).toBe(true);
  });

  // ── F-3.3: Two calls without barTs produce DIFFERENT keys ─────────────────

  it("F-3.3: two calls without idempotencyInputs produce different idempotency keys (no static dedup)", async () => {
    await submitWebhookOrder(BASE_PAYLOAD, "corr-3a");
    await submitWebhookOrder(BASE_PAYLOAD, "corr-3b");

    const key1 = ((mocks.fetch.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>)["X-Idempotency-Key"];
    const key2 = ((mocks.fetch.mock.calls[1] as [string, RequestInit])[1].headers as Record<string, string>)["X-Idempotency-Key"];

    expect(key1).not.toBe(key2);
  });

  // ── F-3.4: With idempotencyInputs, key remains deterministic (SHA-256) ────

  it("F-3.4: with idempotencyInputs present, same inputs always produce the same SHA-256 key", async () => {
    const inputs = {
      accountId: "acct-1",
      strategyId: "strat-aaa",
      ticker: "MES1!",
      action: "enter_long" as const,
      barTs: "2026-06-23T09:30:00Z",
    };

    await submitWebhookOrder(BASE_PAYLOAD, "corr-4a", inputs);
    await submitWebhookOrder(BASE_PAYLOAD, "corr-4b", inputs);

    const key1 = ((mocks.fetch.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>)["X-Idempotency-Key"];
    const key2 = ((mocks.fetch.mock.calls[1] as [string, RequestInit])[1].headers as Record<string, string>)["X-Idempotency-Key"];

    expect(key1).toBe(key2);
    // Must be a 64-char hex SHA-256 (not a UUID)
    expect(/^[0-9a-f]{64}$/.test(key1)).toBe(true);
  });

  // ── F-3.5: buildDeterministicIdempotencyKey still returns stable SHA-256 ──

  it("F-3.5: buildDeterministicIdempotencyKey returns the same SHA-256 for the same inputs", () => {
    const inputs = {
      accountId: "acct-1",
      strategyId: "strat-aaa",
      ticker: "MES1!",
      action: "enter_long" as const,
      barTs: "2026-06-23T09:30:00Z",
    };
    const k1 = buildDeterministicIdempotencyKey(inputs);
    const k2 = buildDeterministicIdempotencyKey(inputs);
    expect(k1).toBe(k2);
    expect(/^[0-9a-f]{64}$/.test(k1)).toBe(true);
  });

  // ── F-3.6: Key prefix still encodes strategyId-ticker-action ──────────────

  it("F-3.6: fallback key starts with strategyId-ticker-action prefix (for log triage)", async () => {
    await submitWebhookOrder(BASE_PAYLOAD, "corr-6");

    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    const key = (init.headers as Record<string, string>)["X-Idempotency-Key"];

    expect(key.startsWith("strat-aaa-MES1!-buy-")).toBe(true);
  });
});
