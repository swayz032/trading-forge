/**
 * Parallel Broker Tests — Pass 20
 *
 * Tests the Parallel.ai broker service (runParallelDiscovery).
 * All network calls are mocked via vi.stubGlobal('fetch').
 * The ../index.js logger dependency is mocked via vi.mock.
 *
 * 5 tests:
 *  1. Submit success — returns task ID, polls to completion, returns strategies
 *  2. Poll completion — second poll returns completed result
 *  3. Poll timeout (simulated via task "failed" status) — returns []
 *  4. Empty result — completed but no strategies array → []
 *  5. Malformed result — non-array strategies → []
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Module mocks (must be before any import of the module under test) ───────

vi.mock("../index.js", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Import module under test AFTER mock setup ───────────────────────────────

// Dynamic import in each test to get a fresh module per test (vi.resetModules()).

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFetchResponse(data: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

function completedWithStrategies(strategies: unknown[]) {
  return makeFetchResponse({
    id:     "task-123",
    status: "completed",
    result: { output: { content: { strategies } } },
  });
}

function fetchQueue(responses: Array<() => ReturnType<typeof makeFetchResponse>>) {
  let i = 0;
  return vi.fn().mockImplementation(() => {
    const factory = responses[Math.min(i, responses.length - 1)];
    i++;
    return Promise.resolve(factory());
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("runParallelDiscovery", () => {
  beforeEach(() => {
    vi.stubEnv("PARALLEL_API_KEY", "test-key-abc");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("submit success: returns strategies when Parallel.ai completes on first poll", async () => {
    const expectedStrategies = [
      { name: "Opening Range Breakout", concept: "Enter on 30-min ORB break", entry_rule: "Buy breakout of high", exit_rule: "Trail stop", source_url: "https://tradingsim.com/orb", timeframe: "5m" },
      { name: "VWAP Pullback", concept: "Mean reversion to VWAP", entry_rule: "Buy VWAP touch", exit_rule: "Exit on close below VWAP", source_url: "https://tradingsim.com/vwap", timeframe: "15m" },
    ];

    // Parallel broker (Pass 20) uses a 2-endpoint pattern:
    //   1. POST /tasks/runs         — submit  → returns run_id
    //   2. GET  /tasks/runs/:id     — status poll → "completed"
    //   3. GET  /tasks/runs/:id/result — fetch actual result
    // So 3 fetch calls for "completes on first status poll".
    const stub = fetchQueue([
      () => makeFetchResponse({ id: "task-001" }),                                 // submit
      () => makeFetchResponse({ id: "task-001", status: "completed" }),           // status poll → completed
      () => completedWithStrategies(expectedStrategies),                          // result fetch
    ]);
    vi.stubGlobal("fetch", stub);

    // Stub setTimeout to avoid 10s waits (sleep() is POLL_INTERVAL_MS apart)
    vi.stubGlobal("setTimeout", (fn: () => void) => { fn(); return 0 as any; });

    const { runParallelDiscovery } = await import("../services/parallel-broker.js");
    const result = await runParallelDiscovery("opening range breakout futures");

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Opening Range Breakout");
    expect(result[1].name).toBe("VWAP Pullback");
    expect(result[0].source_url).toBe("https://tradingsim.com/orb");
    expect(stub).toHaveBeenCalledTimes(3); // submit + status poll + result fetch
  });

  it("poll completion: first poll running → second poll completed", async () => {
    // Flow:
    //   1. POST /tasks/runs  — submit     → run_id
    //   2. GET  /tasks/runs/:id — poll 1  → "running"
    //   3. GET  /tasks/runs/:id — poll 2  → "completed"
    //   4. GET  /tasks/runs/:id/result    → strategies
    // = 4 fetch calls total
    const stub = fetchQueue([
      () => makeFetchResponse({ id: "task-002" }),
      () => makeFetchResponse({ id: "task-002", status: "running" }),
      () => makeFetchResponse({ id: "task-002", status: "completed" }),
      () => completedWithStrategies([
        { name: "ICT Silver Bullet", concept: "ICT SMT setup", source_url: "https://example.com/ict", timeframe: "15m" },
      ]),
    ]);
    vi.stubGlobal("fetch", stub);
    vi.stubGlobal("setTimeout", (fn: () => void) => { fn(); return 0 as any; });

    const { runParallelDiscovery } = await import("../services/parallel-broker.js");
    const result = await runParallelDiscovery("ICT futures strategy");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("ICT Silver Bullet");
    expect(stub).toHaveBeenCalledTimes(4); // submit + 2 status polls + result fetch
  });

  it("poll timeout: task returns failed status → returns []", async () => {
    const stub = fetchQueue([
      () => makeFetchResponse({ id: "task-003" }),
      () => makeFetchResponse({ id: "task-003", status: "failed" }),
    ]);
    vi.stubGlobal("fetch", stub);
    vi.stubGlobal("setTimeout", (fn: () => void) => { fn(); return 0 as any; });

    const { runParallelDiscovery } = await import("../services/parallel-broker.js");
    const result = await runParallelDiscovery("obscure query");

    expect(result).toEqual([]);
  });

  it("empty result: completed task with empty strategies array → []", async () => {
    const stub = fetchQueue([
      () => makeFetchResponse({ id: "task-004" }),
      () => completedWithStrategies([]),
    ]);
    vi.stubGlobal("fetch", stub);
    vi.stubGlobal("setTimeout", (fn: () => void) => { fn(); return 0 as any; });

    const { runParallelDiscovery } = await import("../services/parallel-broker.js");
    const result = await runParallelDiscovery("empty query");

    expect(result).toEqual([]);
  });

  it("malformed result: completed task with non-array strategies → []", async () => {
    const stub = fetchQueue([
      () => makeFetchResponse({ id: "task-005" }),
      () => makeFetchResponse({
        id:     "task-005",
        status: "completed",
        result: { output: { content: { strategies: "not-an-array" } } },
      }),
    ]);
    vi.stubGlobal("fetch", stub);
    vi.stubGlobal("setTimeout", (fn: () => void) => { fn(); return 0 as any; });

    const { runParallelDiscovery } = await import("../services/parallel-broker.js");
    const result = await runParallelDiscovery("malformed query");

    expect(result).toEqual([]);
  });
});
