/**
 * Brave Search Broker Tests — Pass 20 Track H
 *
 * Tests the Brave Search broker service (runBraveDiscovery).
 * All network calls are mocked via vi.stubGlobal('fetch').
 * callOpenAIOrFallback is mocked to return a predictable JSON string.
 * The ../index.js logger dependency is mocked via vi.mock.
 *
 * 5 tests:
 *  1. 200 search → strategies returned with source_provider:'brave'
 *  2. Uses BRAVE_API_KEY fallback when BRAVE_SEARCH_API_KEY is absent
 *  3. 5xx from /web/search → fail-open returns []
 *  4. Empty results array from /web/search → returns []
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

function makeBraveResponse(results: Array<{ url: string; title: string; description: string }>) {
  return makeFetchOk({ web: { results } });
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

describe("runBraveDiscovery", () => {
  beforeEach(() => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "brave-test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("200 search: returns strategies with source_provider='brave'", async () => {
    const { callOpenAIOrFallback } = await import("../services/model-router.js");
    const mockCallModel = vi.mocked(callOpenAIOrFallback);
    mockCallModel.mockResolvedValue(modelJsonResponse([
      { name: "Opening Range Breakout", concept_archetype: "breakout", brief_concept: "Trade first 30-min range break", source_url: "https://kraken.com/learn/orb" },
    ]));

    const fetchMock = vi.fn().mockResolvedValue(makeBraveResponse([
      { url: "https://kraken.com/learn/orb", title: "Opening Range Breakout Strategy", description: "The ORB is a classic futures strategy..." },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const { runBraveDiscovery } = await import("../services/brave-search-broker.js");
    const result = await runBraveDiscovery("opening range breakout futures");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Opening Range Breakout");
    expect(result[0].source_provider).toBe("brave");
    expect(result[0].concept_archetype).toBe("breakout");
    expect(fetchMock).toHaveBeenCalledTimes(1); // single web search call
  });

  it("uses BRAVE_API_KEY fallback when BRAVE_SEARCH_API_KEY is absent", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");    // empty — not set
    vi.stubEnv("BRAVE_API_KEY", "brave-legacy-key");

    const { callOpenAIOrFallback } = await import("../services/model-router.js");
    const mockCallModel = vi.mocked(callOpenAIOrFallback);
    mockCallModel.mockResolvedValue(modelJsonResponse([
      { name: "VWAP Pullback", concept_archetype: "mean_reversion", brief_concept: "Mean reversion to VWAP", source_url: "https://ninjatrader.com/vwap" },
    ]));

    const fetchMock = vi.fn().mockResolvedValue(makeBraveResponse([
      { url: "https://ninjatrader.com/vwap", title: "VWAP Trading Strategies", description: "VWAP pullback methods for futures traders" },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const { runBraveDiscovery } = await import("../services/brave-search-broker.js");
    const result = await runBraveDiscovery("VWAP futures strategy");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("VWAP Pullback");
    expect(result[0].source_provider).toBe("brave");
    // Verify the Authorization header carried the legacy key (check call args)
    const callArgs = fetchMock.mock.calls[0];
    const headers = (callArgs[1] as RequestInit & { headers?: Record<string, string> }).headers ?? {};
    expect((headers as Record<string, string>)["X-Subscription-Token"]).toBe("brave-legacy-key");
  });

  it("5xx from /web/search: fail-open returns []", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchError(429));
    vi.stubGlobal("fetch", fetchMock);

    const { runBraveDiscovery } = await import("../services/brave-search-broker.js");
    const result = await runBraveDiscovery("some query");

    expect(result).toEqual([]);
  });

  it("empty results from /web/search: returns []", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeBraveResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const { runBraveDiscovery } = await import("../services/brave-search-broker.js");
    const result = await runBraveDiscovery("obscure query returns nothing");

    expect(result).toEqual([]);
  });

  it("malformed model response (non-JSON): silently returns [] per fail-open", async () => {
    const { callOpenAIOrFallback } = await import("../services/model-router.js");
    const mockCallModel = vi.mocked(callOpenAIOrFallback);
    mockCallModel.mockResolvedValue("Not valid JSON output from model");

    const fetchMock = vi.fn().mockResolvedValue(makeBraveResponse([
      { url: "https://example.com/strategy", title: "Strategy Article", description: "Some description" },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const { runBraveDiscovery } = await import("../services/brave-search-broker.js");
    const result = await runBraveDiscovery("test query");

    expect(result).toEqual([]);
  });
});
