/**
 * traderspost-5xx-retry.test.ts — H4 (2026-06-23)
 *
 * Verifies that submitWebhookOrder retries up to RETRY_MAX_ATTEMPTS_5XX times
 * (2 retries → 3 total attempts) on 5xx HTTP responses only, while:
 *   - holding the X-Idempotency-Key constant across all attempts (TradersPost dedup)
 *   - NOT retrying on 4xx (client error)
 *   - NOT retrying on network/timeout errors (duplicate-fill risk)
 *   - emitting a traderspost.webhook_5xx_exhausted audit row when all retries fail
 *   - preserving first-attempt 200-success behaviour (regression)
 *
 * Uses vi.useFakeTimers() so jitter-delay assertions are non-flaky.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── DB mock — paths are relative to this test file (src/server/__tests__/) ──

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        catch: vi.fn(),
      })),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  auditLog: "audit_log_table_symbol",
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── fetch mock ───────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.fetch);

// ─── Import module under test (after all mocks are set up) ────────────────────

const { submitWebhookOrder } = await import("../integrations/traderspost/client.js");
const { db } = await import("../db/index.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResponse(status: number, body: unknown = { ok: status < 400 }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const BASE_PAYLOAD = {
  apiKey: "test-api-key",
  ticker: "MES1!",
  action: "buy" as const,
  strategyId: "strat-retry-test",
  orderType: "market" as const,
};

function capturedIdempotencyKeys(): string[] {
  return mocks.fetch.mock.calls.map(
    (call) => ((call[1] as RequestInit).headers as Record<string, string>)["X-Idempotency-Key"],
  );
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("H4 — 5xx retry with jitter (X-Idempotency-Key preserved)", () => {
  beforeEach(() => {
    mocks.fetch.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. 502 twice then 200 ────────────────────────────────────────────────────

  it("retries 2x on 502 then succeeds on 3rd attempt", async () => {
    mocks.fetch
      .mockResolvedValueOnce(makeResponse(502))
      .mockResolvedValueOnce(makeResponse(502))
      .mockResolvedValueOnce(makeResponse(200));

    // Run submitWebhookOrder; each await-on-timer needs us to advance fake timers
    const resultPromise = submitWebhookOrder(BASE_PAYLOAD, "corr-retry-1");

    // Advance past first retry delay (~500–700 ms)
    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.retryAttempt).toBe(2); // succeeded on attempt index 2 (3rd call)
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  // ── 2. 503 all three times → exhausted ───────────────────────────────────────

  it("retries 2x on 503 then exhausts and returns {success:false}", async () => {
    mocks.fetch.mockResolvedValue(makeResponse(503));

    const dbInsertSpy = vi.spyOn(db, "insert");

    const resultPromise = submitWebhookOrder(BASE_PAYLOAD, "corr-retry-2");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(503);
    expect(result.retryAttempt).toBe(2); // exhausted after index 2
    expect(mocks.fetch).toHaveBeenCalledTimes(3); // initial + 2 retries

    // Audit row for exhaustion must have been requested
    expect(dbInsertSpy).toHaveBeenCalled();
    const insertArg = dbInsertSpy.mock.calls[0][0];
    // The values() call follows — check via the chained call shape
    expect(insertArg).toBe("audit_log_table_symbol");
  });

  // ── 3. 4xx — no retry ────────────────────────────────────────────────────────

  it("does NOT retry on 4xx (returns immediately)", async () => {
    mocks.fetch.mockResolvedValue(makeResponse(401));

    const resultPromise = submitWebhookOrder(BASE_PAYLOAD, "corr-4xx");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(mocks.fetch).toHaveBeenCalledTimes(1); // exactly one attempt
    expect(result.retryAttempt).toBe(0); // no retries
  });

  // ── 4. Network/timeout error — no retry ───────────────────────────────────────

  it("does NOT retry on network/timeout error (no response object)", async () => {
    mocks.fetch.mockRejectedValue(new Error("Failed to connect"));

    const resultPromise = submitWebhookOrder(BASE_PAYLOAD, "corr-network");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/fetch error/i);
    expect(mocks.fetch).toHaveBeenCalledTimes(1); // no retry on network error
    expect(result.retryAttempt).toBe(0);
  });

  // ── 5. Idempotency key preserved across retries ───────────────────────────────

  it("preserves X-Idempotency-Key across retries", async () => {
    mocks.fetch
      .mockResolvedValueOnce(makeResponse(500))
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(200));

    const resultPromise = submitWebhookOrder(BASE_PAYLOAD, "corr-idem");
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(mocks.fetch).toHaveBeenCalledTimes(3);

    const keys = capturedIdempotencyKeys();
    expect(keys[0]).toBe(keys[1]);
    expect(keys[1]).toBe(keys[2]);
    // All three calls must carry the same key — different keys would risk a double-fill
    expect(new Set(keys).size).toBe(1);
  });

  // ── 6. First-attempt 200 — regression ─────────────────────────────────────────

  it("preserves existing behavior on first-attempt 200 success", async () => {
    mocks.fetch.mockResolvedValue(makeResponse(200, { result: "filled" }));

    const resultPromise = submitWebhookOrder(BASE_PAYLOAD, "corr-ok");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(result.retryAttempt).toBe(0); // first attempt, no retry
  });

  // ── 7. Jitter delay bounds ────────────────────────────────────────────────────

  it("jitter delay between retries is bounded within expected range", async () => {
    // Return 502 three times so we observe two delays (attempt 0→1 and 1→2)
    mocks.fetch.mockResolvedValue(makeResponse(502));

    // Spy on global setTimeout to capture the delay values
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    const resultPromise = submitWebhookOrder(BASE_PAYLOAD, "corr-jitter");
    await vi.runAllTimersAsync();
    await resultPromise;

    // Filter to the retry-delay calls (exclude the per-attempt 10s timeout calls)
    // Retry delays: attempt 0→1 base=500, jitter∈[0,200) → total∈[500,700)
    //               attempt 1→2 base=1000, jitter∈[0,200) → total∈[1000,1200)
    const delayCalls = setTimeoutSpy.mock.calls
      .map(([, delay]) => delay as number)
      .filter((d) => d !== undefined && d !== 10_000); // exclude SUBMIT_TIMEOUT_MS

    // We expect exactly 2 retry delay calls
    const retryDelays = delayCalls.filter((d) => d >= 500 && d < 1200);
    expect(retryDelays.length).toBeGreaterThanOrEqual(2);

    // First retry delay (base 500): must be in [500, 700)
    const firstDelay = retryDelays.find((d) => d < 800);
    expect(firstDelay).toBeDefined();
    if (firstDelay !== undefined) {
      expect(firstDelay).toBeGreaterThanOrEqual(500);
      expect(firstDelay).toBeLessThan(700);
    }

    // Second retry delay (base 1000): must be in [1000, 1200)
    const secondDelay = retryDelays.find((d) => d >= 1000);
    expect(secondDelay).toBeDefined();
    if (secondDelay !== undefined) {
      expect(secondDelay).toBeGreaterThanOrEqual(1000);
      expect(secondDelay).toBeLessThan(1200);
    }
  });
});
