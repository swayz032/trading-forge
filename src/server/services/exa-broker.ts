/**
 * Exa Broker — Pass 20 Track H — Layer 1 Web Discovery
 *
 * Uses Exa's neural search + /contents pre-cleaning pipeline:
 *   1. POST /search  — neural search returns 8 on-topic result URLs
 *   2. POST /contents — fetches pre-cleaned text + Exa-generated summaries for each URL
 *   3. callOpenAIOrFallback('strategy_name_discoverer') — extracts strategy names from body
 *
 * Design:
 *   - Fail-OPEN: returns [] on any error. Never throws.
 *   - Exa pre-cleans content (strips nav menus, boilerplate) — better signal/noise than raw scraping.
 *   - correlation_id propagated via x-correlation-id header on every outbound fetch.
 *
 * Per production mandate: does NOT pass slippage/fees to vectorbt — not applicable
 * here (this service does web discovery, not backtesting).
 */

import { logger } from "../index.js";
import { callOpenAIOrFallback } from "./model-router.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExaDiscoveredStrategy {
  name:              string;
  concept_archetype: string;
  brief_concept:     string;
  source_url:        string;
  source_provider:   "exa";
}

interface ExaSearchResult {
  id:    string;
  url:   string;
  title: string;
  score: number;
}

interface ExaSearchResponse {
  results?: ExaSearchResult[];
}

interface ExaContentItem {
  url:     string;
  title?:  string;
  text?:   string;
  summary?: string;
}

interface ExaContentsResponse {
  results?: ExaContentItem[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const EXA_API_BASE   = "https://api.exa.ai";
const FETCH_TIMEOUT  = 30_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getExaApiKey(): string | null {
  return process.env.EXA_API_KEY ?? null;
}

function fetchHeaders(apiKey: string, correlationId?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key":    apiKey,
  };
  if (correlationId) h["x-correlation-id"] = correlationId;
  return h;
}

/**
 * Parse model output from callOpenAIOrFallback and return an array of strategy items.
 * The model is expected to return JSON: { names: [{name, concept_archetype, brief_concept, source_url}] }
 * Returns [] on any parse/shape failure.
 */
function parseModelOutput(
  raw:       string | null,
  sourceUrl: string,
): Array<Omit<ExaDiscoveredStrategy, "source_provider">> {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.debug({ rawSlice: raw.slice(0, 200) }, "exa-broker: model output is not JSON");
    return [];
  }

  const namesIn = (parsed as { names?: unknown }).names;
  if (!Array.isArray(namesIn) || namesIn.length === 0) return [];

  return namesIn
    .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
    .map((n) => ({
      name:              typeof n.name              === "string" ? n.name.trim()                          : "",
      concept_archetype: typeof n.concept_archetype === "string" ? n.concept_archetype.trim()             : "unknown",
      brief_concept:     typeof n.brief_concept     === "string" ? n.brief_concept.trim().slice(0, 150)   : "",
      source_url:        typeof n.source_url        === "string" ? n.source_url.trim()                    : sourceUrl,
    }))
    .filter((n) => n.name.length > 0);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run an Exa neural-search + contents pipeline for a given trading strategy query.
 *
 * Returns an array of discovered strategy objects. Returns [] on any failure
 * (network error, API error, empty/malformed result) — NEVER throws.
 * Fail-OPEN: discovery is opportunistic; an Exa outage must not block the pipeline.
 *
 * @param query          Human-readable query (e.g. "opening range breakout futures strategy")
 * @param correlationId  Optional correlation ID propagated to outbound fetch headers
 */
export async function runExaDiscovery(
  query:          string,
  correlationId?: string,
): Promise<ExaDiscoveredStrategy[]> {
  const apiKey = getExaApiKey();
  if (!apiKey) {
    logger.warn("exa-broker: EXA_API_KEY not set — skipping discovery");
    return [];
  }

  try {
    // ── Step 1: Neural search ────────────────────────────────────────────────
    let searchResults: ExaSearchResult[] = [];
    try {
      const searchRes = await fetch(`${EXA_API_BASE}/search`, {
        method:  "POST",
        headers: fetchHeaders(apiKey, correlationId),
        body:    JSON.stringify({
          query,
          numResults:     8,
          useAutoprompt:  true,
          type:           "neural",
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });

      if (!searchRes.ok) {
        const errText = await searchRes.text().catch(() => "<read failed>");
        logger.warn({ status: searchRes.status, errText }, "exa-broker: /search failed");
        return [];
      }

      const searchData = await searchRes.json() as ExaSearchResponse;
      searchResults = searchData.results ?? [];

      if (searchResults.length === 0) {
        logger.info({ query }, "exa-broker: /search returned 0 results");
        return [];
      }

      logger.info({ query, count: searchResults.length }, "exa-broker: /search completed");
    } catch (err) {
      logger.warn({ err, query }, "exa-broker: /search threw");
      return [];
    }

    const urls = searchResults.map((r) => r.url).filter(Boolean);

    // ── Step 2: Fetch pre-cleaned content + summaries ────────────────────────
    let contentItems: ExaContentItem[] = [];
    try {
      const contentsRes = await fetch(`${EXA_API_BASE}/contents`, {
        method:  "POST",
        headers: fetchHeaders(apiKey, correlationId),
        body:    JSON.stringify({
          urls,
          text:    true,
          summary: { query: "extract systematic trading strategy name and concept" },
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });

      if (!contentsRes.ok) {
        const errText = await contentsRes.text().catch(() => "<read failed>");
        logger.warn({ status: contentsRes.status, errText }, "exa-broker: /contents failed");
        // Degrade gracefully: fall through to name extraction with titles only
      } else {
        const contentsData = await contentsRes.json() as ExaContentsResponse;
        contentItems = contentsData.results ?? [];
        logger.info({ count: contentItems.length }, "exa-broker: /contents completed");
      }
    } catch (err) {
      logger.warn({ err }, "exa-broker: /contents threw — falling back to title-only extraction");
      // contentItems stays [] — we degrade to title-only below
    }

    // ── Step 3: Name extraction per result ───────────────────────────────────
    const discovered: ExaDiscoveredStrategy[] = [];

    // Build a map of url → content for easy lookup
    const contentByUrl = new Map<string, ExaContentItem>();
    for (const item of contentItems) {
      if (item.url) contentByUrl.set(item.url, item);
    }

    for (const result of searchResults) {
      const content = contentByUrl.get(result.url);
      const body = [
        content?.summary ?? "",
        content?.text?.slice(0, 6000) ?? "",
        result.title,
      ]
        .filter(Boolean)
        .join("\n\n")
        .trim();

      if (!body) continue;

      try {
        const userPayload = JSON.stringify({
          source_url:      result.url,
          source_provider: "exa",
          article_markdown: body.slice(0, 8000),
        });

        const raw = await callOpenAIOrFallback("strategy_name_discoverer", [
          { role: "user", content: userPayload },
        ]);

        const names = parseModelOutput(raw, result.url);
        for (const n of names) {
          discovered.push({ ...n, source_provider: "exa" });
        }
      } catch (err) {
        logger.warn({ err, url: result.url }, "exa-broker: name extraction threw (non-fatal)");
      }
    }

    logger.info({ query, count: discovered.length }, "exa-broker: discovery complete");
    return discovered;
  } catch (err) {
    // Belt-and-suspenders: top-level catch ensures we never propagate.
    logger.error({ err, query }, "exa-broker: runExaDiscovery threw (returning [])");
    return [];
  }
}
