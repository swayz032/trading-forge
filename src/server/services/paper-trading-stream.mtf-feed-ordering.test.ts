/**
 * paper-trading-stream.mtf-feed-ordering.test.ts — Campaign M1c F-1 closure
 * (independent accuracy-validator grade, 2026-07-17)
 *
 * The grader found a real (LOW-severity, self-healing) race: handleBar()'s
 * timeframe-resolution + aggregator-feed step needs an async
 * getSessionTimeframe() lookup before it can call feedBar(). Two overlapping
 * handleBar() calls for the SAME symbol (the live WS onBar callback is
 * fire-and-forget, never awaited by its caller) could feed the aggregator
 * OUT OF ARRIVAL ORDER if an earlier bar's lookup is a slow cold cache-miss
 * while a later bar's lookup is a fast warm cache-hit.
 *
 * The fix: mtfFeedLocks, a per-symbol promise-chain lock (mirroring the
 * pre-existing sessionLocks pattern) serializing the resolve+feed step so it
 * always runs in handleBar()-call order regardless of which individual await
 * settles first.
 *
 * This test PROVES the fix closes the race, using manually-controlled
 * deferred promises to force the exact interleaving the grader described
 * (bar 1's lookup resolves AFTER bar 2's), rather than relying on incidental
 * real-timer scheduling. Inspects the REAL timeframe-bar-aggregator.js
 * module's internal state directly (not mocked) via its _testGetAggregatorState
 * seam — the in-progress bucket's `close` field reveals which bar was applied
 * LAST; if the race were unfixed, bar 2 (whose lookup resolves first) would
 * incorrectly be applied before bar 1, leaving bar 1's close as the final
 * value instead of bar 2's.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  _testResetAllAggregatorState,
  _testGetAggregatorState,
} from "../lib/timeframe-bar-aggregator.js";

// ─── Mocks (must come before imports that pull the module under test) ─────────

const mockGetSessionTimeframe = vi.fn();

vi.mock("./volume-profile-service.js", () => ({
  getDevelopingSessionPoc: vi.fn().mockResolvedValue(null),
}));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./paper-execution-service.js", () => ({
  updatePositionPrices: vi.fn().mockResolvedValue(undefined),
  PAPER_EXIT_EVENTS: {},
}));
vi.mock("./paper-signal-service.js", () => ({
  evaluateSignals: vi.fn().mockResolvedValue(undefined),
  updateStateOnly: vi.fn().mockResolvedValue(undefined),
  ATR: vi.fn().mockReturnValue(2.5),
  getSessionTimeframe: (...args: unknown[]) => mockGetSessionTimeframe(...args),
}));
vi.mock("./paper-risk-gate.js", () => ({
  toEasternDateString: (d: Date) => d.toISOString().split("T")[0],
}));

let capturedOnBar: ((bar: Bar) => void) | undefined;
vi.mock("../../data/fetchers/massive.js", () => ({
  createMassiveFetcher: vi.fn().mockReturnValue({
    createWebSocket: vi.fn((_symbols: string[], onBar: (bar: Bar) => void) => {
      capturedOnBar = onBar;
      return { on: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), close: vi.fn() };
    }),
  }),
}));
vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: { getOrCreate: vi.fn().mockReturnValue({ execute: vi.fn((fn: () => unknown) => fn()) }) },
}));
vi.mock("./smt-live-service.js", () => ({
  initSmtBarBufferProvider: vi.fn(),
}));
vi.mock("../db/index.js", () => ({ db: { insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })) } }));
vi.mock("../db/schema.js", () => ({ auditLog: {} }));
vi.mock("../lib/metrics-registry.js", () => ({
  paperStreamLifecycleTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
  auditWriteFailuresTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
}));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));
vi.mock("../lib/feed-gap-classifier.js", () => ({
  classifyFeedGap: vi.fn().mockReturnValue({ classified: false }),
}));

import { startStream, type Bar } from "./paper-trading-stream.js";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function makeBar(timestamp: string, close: number): Bar {
  return { symbol: "MES", timestamp, open: close, high: close, low: close, close, volume: 1 };
}

describe("handleBar mtf-feed-lock — F-1 closure: aggregator feed preserves call order under an out-of-order async race", () => {
  beforeEach(() => {
    _testResetAllAggregatorState();
    mockGetSessionTimeframe.mockReset();
    vi.stubEnv("MASSIVE_API_KEY", "test-key");
  });

  it("bar 1's slow-resolving getSessionTimeframe lookup does not let bar 2 (fast lookup) feed the aggregator first", async () => {
    const bar1 = makeBar("2026-02-02T14:00:00.000Z", 100); // same 5m bucket as bar2
    const bar2 = makeBar("2026-02-02T14:01:00.000Z", 200); // chronologically LATER — must win "close" if order is preserved

    const bar1Lookup = deferred<string>();
    mockGetSessionTimeframe
      .mockImplementationOnce(() => bar1Lookup.promise) // bar 1: held open — simulates a cold cache-miss
      .mockImplementationOnce(() => Promise.resolve("5m")); // bar 2: resolves immediately — simulates a warm cache-hit

    startStream("mtf-ordering-session", ["MES"]);
    expect(capturedOnBar).toBeDefined();

    // Fire bar 1 — its handleBar() call is now blocked on bar1Lookup (not yet resolved).
    capturedOnBar!(bar1);
    await vi.waitFor(() => expect(mockGetSessionTimeframe).toHaveBeenCalledTimes(1));

    // Fire bar 2 before bar 1's lookup resolves. With the mtfFeedLocks fix, bar 2's
    // OWN getSessionTimeframe call is correctly BLOCKED behind bar 1's still-pending
    // chain — it must NOT fire yet (proving the lock serializes the whole resolve+feed
    // step, not just the final feedBar() call). Without the fix, bar 2's immediately-
    // resolvable lookup would race ahead here.
    capturedOnBar!(bar2);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockGetSessionTimeframe).toHaveBeenCalledTimes(1); // bar 2 still blocked on bar 1's lock

    // NOW let bar 1's lookup resolve — this unblocks bar 1's own feed step AND,
    // once that completes, releases the lock for bar 2's chained step.
    bar1Lookup.resolve("5m");
    await vi.waitFor(() => expect(mockGetSessionTimeframe).toHaveBeenCalledTimes(2));

    // Wait for both bars to actually extend the in-progress 5-minute bucket.
    await vi.waitFor(() => {
      const state = _testGetAggregatorState("MES", 5);
      expect(state?.current?.volume).toBe(2); // both bar1 and bar2 have been applied
    });

    const state = _testGetAggregatorState("MES", 5);
    // If call-order was preserved (the fix working): bar1 (close=100) applied
    // first, then bar2 (close=200) applied second -> final close = 200.
    // If the race went the OTHER way (the bug): bar2 applied first, then bar1
    // OVERWRITES it last -> final close would incorrectly be 100.
    expect(state?.current?.close).toBe(200);
    expect(state?.current?.high).toBe(200);
    expect(state?.current?.low).toBe(100);
  });
});
