/**
 * Brave Search Broker — Pass 20 Track H — Layer 1 Web Discovery
 *
 * Uses Brave's traditional web search API to surface a different result set than Exa.
 * Brave found resources like kraken.com/learn/futures-trading-strategies and
 * NinjaTrader/optimusfutures that Exa's neural search missed — diversity matters.
 *
 * Flow:
 *   1. GET /res/v1/web/search?q=<query>&count=8&country=US
 *   2. For each result: extract title + snippet and call
 *      callOpenAIOrFallback('strategy_name_discoverer') to pull strategy names.
 *      Brave returns short snippets (not full body) but that is enough for name extraction.
 *
 * Design:
 *   - Fail-OPEN: returns [] on any error. Never throws.
 *   - Env var: BRAVE_SEARCH_API_KEY (primary) or BRAVE_API_KEY (legacy alias).
 *   - correlation_id propagated via x-correlation-id on every outbound fetch.
 *   - DO NOT confuse with Brave News API — that returns market-news articles (not strategy
 *     tutorials) and is deprecated for scout use per CLAUDE.md §2b.
 *
 * Per production mandate: does NOT pass slippage/fees to vectorbt — not applicable
 * here (this service does web discovery, not backtesting).
 */

import { logger } from "../index.js";
import { callOpenAIOrFallback } from "./model-router.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BraveDiscoveredStrategy {
  name:              string;
  concept_archetype: string;
  brief_concept:     string;
  source_url:        string;
  source_provider:   "brave";
}

interface BraveWebResult {
  url:         string;
  title:       string;
  description: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveWebResult[];
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BRAVE_SEARCH_BASE = "https://api.search.brave.com/res/v1/web/search";
const FETCH_TIMEOUT     = 20_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBraveApiKey(): string | null {
  // Try both env var spellings — codebase uses both historically.
  // Use || (not ??) so empty string falls through to the next source.
  return process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY || null;
}

/**
 * Parse model output from callOpenAIOrFallback and return an array of strategy items.
 * The model returns JSON: { names: [{name, concept_archetype, brief_concept, source_url}] }
 * Returns [] on any parse/shape failure.
 */
function parseModelOutput(
  raw:       string | null,
  sourceUrl: string,
): Array<Omit<BraveDiscoveredStrategy, "source_provider">> {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.debug({ rawSlice: raw.slice(0, 200) }, "brave-search-broker: model output is not JSON");
    return [];
  }

  const namesIn = (parsed as { names?: unknown }).names;
  if (!Array.isArray(namesIn) || namesIn.length === 0) return [];

  return namesIn
    .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
    .map((n) => ({
      name:              typeof n.name              === "string" ? n.name.trim()                        : "",
      concept_archetype: typeof n.concept_archetype === "string" ? n.concept_archetype.trim()           : "unknown",
      brief_concept:     typeof n.brief_concept     === "string" ? n.brief_concept.trim().slice(0, 150) : "",
      source_url:        typeof n.source_url        === "string" ? n.source_url.trim()                  : sourceUrl,
    }))
    .filter((n) => n.name.length > 0);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run a Brave Search web discovery query for a given trading strategy topic.
 *
 * Returns an array of discovered strategy objects. Returns [] on any failure
 * (network error, API error, empty/malformed result) — NEVER throws.
 * Fail-OPEN: discovery is opportunistic; a Brave API outage must not block the pipeline.
 *
 * @param query          Human-readable query (e.g. "opening range breakout futures strategy")
 * @param correlationId  Optional correlation ID propagated to outbound fetch headers
 */
export async function runBraveDiscovery(
  query:          string,
  correlationId?: string,
): Promise<BraveDiscoveredStrategy[]> {
  const apiKey = getBraveApiKey();
  if (!apiKey) {
    logger.warn("brave-search-broker: BRAVE_SEARCH_API_KEY / BRAVE_API_KEY not set — skipping discovery");
    return [];
  }

  try {
    // ── Step 1: Web search ───────────────────────────────────────────────────
    let webResults: BraveWebResult[] = [];
    try {
      const url = new URL(BRAVE_SEARCH_BASE);
      url.searchParams.set("q",       query);
      url.searchParams.set("count",   "8");
      url.searchParams.set("country", "US");

      const headers: Record<string, string> = {
        "Accept":               "application/json",
        "X-Subscription-Token": apiKey,
      };
      if (correlationId) headers["x-correlation-id"] = correlationId;

      const searchRes = await fetch(url.toString(), {
        method:  "GET",
        headers,
        signal:  AbortSignal.timeout(FETCH_TIMEOUT),
      });

      if (!searchRes.ok) {
        const errText = await searchRes.text().catch(() => "<read failed>");
        logger.warn({ status: searchRes.status, errText }, "brave-search-broker: /web/search failed");
        return [];
      }

      const searchData = await searchRes.json() as BraveSearchResponse;
      webResults = searchData.web?.results ?? [];

      if (webResults.length === 0) {
        logger.info({ query }, "brave-search-broker: /web/search returned 0 results");
        return [];
      }

      logger.info({ query, count: webResults.length }, "brave-search-broker: /web/search completed");
    } catch (err) {
      logger.warn({ err, query }, "brave-search-broker: /web/search threw");
      return [];
    }

    // ── Step 2: Name extraction per result ───────────────────────────────────
    const discovered: BraveDiscoveredStrategy[] = [];

    for (const result of webResults) {
      // Brave returns short snippets — title + description is enough for name extraction.
      const body = [result.title, result.description].filter(Boolean).join("\n\n").trim();
      if (!body) continue;

      try {
        const userPayload = JSON.stringify({
          source_url:       result.url,
          source_provider:  "brave",
          article_markdown: body.slice(0, 8000),
        });

        const raw = await callOpenAIOrFallback("strategy_name_discoverer", [
          { role: "user", content: userPayload },
        ]);

        const names = parseModelOutput(raw, result.url);
        for (const n of names) {
          discovered.push({ ...n, source_provider: "brave" });
        }
      } catch (err) {
        logger.warn({ err, url: result.url }, "brave-search-broker: name extraction threw (non-fatal)");
      }
    }

    logger.info({ query, count: discovered.length }, "brave-search-broker: discovery complete");
    return discovered;
  } catch (err) {
    // Belt-and-suspenders: top-level catch ensures we never propagate.
    logger.error({ err, query }, "brave-search-broker: runBraveDiscovery threw (returning [])");
    return [];
  }
}
