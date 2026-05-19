/**
 * Exa Broker Tests — Pass 20 Track H
 *
 * Tests the Exa broker service (runExaDiscovery).
 * All network calls are mocked via vi.stubGlobal('fetch').
 * callOpenAIOrFallback is mocked to return a predictable JSON string.
 * The ../index.js logger dependency is mocked via vi.mock.
 *
 * 5 tests:
 *  1. 200 search + 200 contents → strategies returned with source_provider:'exa'
 *  2. 200 search + 200 contents, multiple results → strategies from multiple pages
 *  3. 5xx from /search → fail-open returns []
 *  4. /search returns empty results array → returns []
 *  5. Malformed model response (non-JSON) → silently returns [] (fail-open)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("../index.js", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../services/model-router.js", () => ({
  callOpenAIOrFallback: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFetchOk(data: unknown) {
  return {
    ok:     true,
    status: 200,
    json:   () => Promise.resolve(data),
    text:   () => Promise.resolve(JSON.stringify(data)),
  };
}

function makeFetchError(status: number) {
  return {
    ok:     false,
    status,
    json:   () => Promise.reject(new Error("not json")),
    text:   () => Promise.resolve(`HTTP ${status}`),
  };
}

function makeFetchQueue(responses: Array<() => ReturnType<typeof makeFetchOk>>) {
  let i = 0;
  return vi.fn().mockImplementation(() => {
    const factory = responses[Math.min(i, responses.length - 1)];
    i++;
    return Promise.resolve(factory());
  });
}

function modelJsonResponse(names: Array<{
  name: string;
  concept_archetype: string;
  brief_concept: string;
  source_url: string;
}>) {
  return JSON.stringify({ names });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("runExaDiscovery", () => {
  beforeEach(() => {
    vi.stubEnv("EXA_API_KEY", "exa-test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("200 search + 200 contents: returns strategies with source_provider='exa'", async () => {
    const { callOpenAIOrFallback } = await import("../services/model-router.js");
    const mockCallModel = vi.mocked(callOpenAIOrFallback);
    mockCallModel.mockResolvedValue(modelJsonResponse([
      { name: "Opening Range Breakout", concept_archetype: "breakout", brief_concept: "Trade breakout of first 30-min range", source_url: "https://example.com/orb" },
    ]));

    const fetchMock = makeFetchQueue([
      () => makeFetchOk({
        results: [
          { id: "r1", url: "https://example.com/orb", title: "Opening Range Breakout Futures", score: 0.9 },
        ],
      }),
      () => makeFetchOk({
        results: [
          { url: "https://example.com/orb", title: "ORB Article", text: "The opening range breakout strategy...", summary: "Strategy for trading the first 30-min range" },
        ],
      }),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { runExaDiscovery } = await import("../services/exa-broker.js");
    const result = await runExaDiscovery("opening range breakout futures");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Opening Range Breakout");
    expect(result[0].source_provider).toBe("exa");
    expect(result[0].concept_archetype).toBe("breakout");
    expect(fetchMock).toHaveBeenCalledTimes(2); // /search + /contents
  });

  it("200 search + 200 contents, multiple results: extracts names across pages", async () => {
    const { callOpenAIOrFallback } = await import("../services/model-router.js");
    const mockCallModel = vi.mocked(callOpenAIOrFallback);
    // Return different strategy per page
    mockCallModel
      .mockResolvedValueOnce(modelJsonResponse([
        { name: "VWAP Pullback", concept_archetype: "mean_reversion", brief_concept: "Buy VWAP touch in trend", source_url: "https://site1.com" },
      ]))
      .mockResolvedValueOnce(modelJsonResponse([
        { name: "ICT Silver Bullet", concept_archetype: "smart_money", brief_concept: "ICT SMT divergence entry", source_url: "https://site2.com" },
      ]));

    const fetchMock = makeFetchQueue([
      () => makeFetchOk({
        results: [
          { id: "r1", url: "https://site1.com", title: "VWAP Pullback Strategies", score: 0.88 },
          { id: "r2", url: "https://site2.com", title: "ICT Smart Money Concepts", score: 0.85 },
        ],
      }),
      () => makeFetchOk({
        results: [
          { url: "https://site1.com", text: "VWAP pullback trading strategy...", summary: "VWAP mean reversion approach" },
          { url: "https://site2.com", text: "ICT silver bullet entry model...", summary: "Smart money divergence play" },
        ],
      }),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { runExaDiscovery } = await import("../services/exa-broker.js");
    const result = await runExaDiscovery("futures trading strategies");

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name)).toContain("VWAP Pullback");
    expect(result.map((r) => r.name)).toContain("ICT Silver Bullet");
    expect(result.every((r) => r.source_provider === "exa")).toBe(true);
  });

  it("5xx from /search: fail-open returns []", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchError(503));
    vi.stubGlobal("fetch", fetchMock);

    const { runExaDiscovery } = await import("../services/exa-broker.js");
    const result = await runExaDiscovery("some strategy query");

    expect(result).toEqual([]);
  });

  it("empty results from /search: returns []", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchOk({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { runExaDiscovery } = await import("../services/exa-broker.js");
    const result = await runExaDiscovery("obscure query returns nothing");

    expect(result).toEqual([]);
  });

  it("malformed model response (non-JSON): silently returns [] per fail-open", async () => {
    const { callOpenAIOrFallback } = await import("../services/model-router.js");
    const mockCallModel = vi.mocked(callOpenAIOrFallback);
    // Model returns non-JSON garbage
    mockCallModel.mockResolvedValue("This is not JSON at all !!!!");

    const fetchMock = makeFetchQueue([
      () => makeFetchOk({
        results: [{ id: "r1", url: "https://example.com/test", title: "Some Article", score: 0.7 }],
      }),
      () => makeFetchOk({
        results: [{ url: "https://example.com/test", text: "Some content", summary: "Some summary" }],
      }),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { runExaDiscovery } = await import("../services/exa-broker.js");
    const result = await runExaDiscovery("test query");

    // No throw, graceful empty
    expect(result).toEqual([]);
  });
});
