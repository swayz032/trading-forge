/**
 * massive.ts — Deep-scan #16 Wave-1 Track 5 (HIGH #13) regression tests
 *
 * fetchBars() previously had no AbortController/timeout — a hung Massive API
 * response could wedge a symbol's internal backfill indefinitely (the
 * CircuitBreaker wrapper used by callers imposes no deadline of its own).
 *
 * These tests verify:
 *   1. A normal, fast response still resolves with the parsed bars (baseline).
 *   2. A hung fetch is aborted after MASSIVE_FETCH_TIMEOUT_MS and rejects with
 *      a clear, distinguishable timeout error (not a bare AbortError).
 *   3. A genuine 4xx/5xx API error still throws the existing error message
 *      (timeout handling must not swallow real API errors).
 *   4. The custom MASSIVE_FETCH_TIMEOUT_MS env override is respected.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMassiveFetcher } from "./massive.js";

function makeBarsResponse(bars: unknown[]) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve({ bars }),
  };
}

function makeErrorResponse(status: number, statusText: string) {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.reject(new Error("not json")),
  };
}

describe("HIGH #13 — massive.ts fetchBars() timeout (deep-scan #16)", () => {
  const originalEnv = process.env.MASSIVE_FETCH_TIMEOUT_MS;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalEnv === undefined) {
      delete process.env.MASSIVE_FETCH_TIMEOUT_MS;
    } else {
      process.env.MASSIVE_FETCH_TIMEOUT_MS = originalEnv;
    }
  });

  it("resolves normally when the response arrives promptly (baseline unaffected)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(makeBarsResponse([{ timestamp: "2026-01-01T00:00:00Z", open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }]))),
    );

    const fetcher = createMassiveFetcher({ apiKey: "test-key" });
    const result = await fetcher.fetchBars({ symbol: "MES", timeframe: "5min", from: "2026-01-01", to: "2026-01-02" });

    expect(result).toHaveLength(1);
    expect(result[0].close).toBe(1.5);
  });

  it("aborts a hung request after the timeout and rejects with a clear timeout error", async () => {
    // Simulate a hung fetch: the promise only settles when the AbortSignal fires,
    // mirroring real `fetch`'s AbortController integration.
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, opts: { signal: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            const err = new Error("This operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }),
    );

    const fetcher = createMassiveFetcher({ apiKey: "test-key" });
    const fetchPromise = fetcher.fetchBars({ symbol: "MNQ", timeframe: "1min", from: "2026-01-01", to: "2026-01-02" });

    // Attach a rejection handler immediately so advancing timers doesn't trigger
    // an unhandled-rejection warning before we assert on it.
    const assertion = expect(fetchPromise).rejects.toThrow(/timed out after 15000ms/);

    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it("still throws the existing error message for a genuine 4xx/5xx API error (timeout handling doesn't swallow real errors)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(makeErrorResponse(503, "Service Unavailable"))),
    );

    const fetcher = createMassiveFetcher({ apiKey: "test-key" });
    await expect(
      fetcher.fetchBars({ symbol: "MCL", timeframe: "daily", from: "2026-01-01", to: "2026-01-02" }),
    ).rejects.toThrow(/Massive API error: 503 Service Unavailable/);
  });

  it("respects a custom MASSIVE_FETCH_TIMEOUT_MS override", async () => {
    process.env.MASSIVE_FETCH_TIMEOUT_MS = "3000";
    // Re-import so the module re-reads the env var at load time.
    vi.resetModules();
    const { createMassiveFetcher: createMassiveFetcherFresh } = await import("./massive.js");

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, opts: { signal: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }),
    );

    const fetcher = createMassiveFetcherFresh({ apiKey: "test-key" });
    const fetchPromise = fetcher.fetchBars({ symbol: "MES", timeframe: "5min", from: "2026-01-01", to: "2026-01-02" });
    const assertion = expect(fetchPromise).rejects.toThrow(/timed out after 3000ms/);

    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;
  });
});
