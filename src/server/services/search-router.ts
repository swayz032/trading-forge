/**
 * Search Router — unified strategy-hunt search across providers.
 *
 * Replaces the per-workflow scout calls (5G-brave, 5H-reddit, 5I-tavily) with
 * one endpoint that fans out, fuses, and dedupes across:
 *   Brave  — web freshness + Goggles for quant-bias ranking
 *   Tavily — research-friendly aggregator with finance topic
 *   Exa    — neural / semantic ("strategies that worked in low-VIX regimes")
 *   Parallel — concurrent multi-source aggregator with built-in dedupe
 *
 * The router intentionally does NOT call Reddit — that path stays in n8n via
 * the Reddit MCP because OAuth makes a backend call awkward.
 *
 * Two-tier cost strategy:
 *   depth="basic" (default) — fan-out scout, all 100% free tier
 *     Tavily basic (1 credit), Exa search-only, no contents enrichment
 *   depth="advanced" — deep research, Wave 4 5K/5L/5O workflows
 *     Tavily advanced (2 credits, chunks_per_source:3), Exa contents+highlights+summary
 *
 * Provider weighting (rawScore is per-provider; we normalize per-result):
 *   exa      : 1.30  — best for thesis-style queries
 *   parallel : 1.15  — already deduped, so ranks higher
 *   tavily   : 1.00  — baseline
 *   brave    : 0.90  — freshness over relevance (1.05 with quant goggle)
 */

import { logger } from "../lib/logger.js";
import { db } from "../db/index.js";
import { systemJournal } from "../db/schema.js";
import { sql } from "drizzle-orm";
import { CircuitBreakerRegistry, CircuitOpenError } from "../lib/circuit-breaker.js";
import { readFileSync, existsSync } from "fs";
import { resolve as pathResolve } from "path";

export interface SearchOptions {
  intent: string;            // e.g. "trend-following", "mean-reversion"
  query: string;             // user-facing keyword query
  regime?: string;           // e.g. "low-vix", "trending", "ranging"
  market?: string;           // e.g. "ES", "NQ", "CL"
  maxResults?: number;       // per-provider cap, default 10
  depth?: "basic" | "advanced"; // default "basic" — controls cost/quality tier
  timeRange?: "day" | "week" | "month" | "year"; // recency filter (Tavily/Brave)
  includeDomains?: string[]; // whitelist (Tavily/Parallel/Exa)
  excludeDomains?: string[]; // blacklist (Tavily/Parallel/Exa)
  category?: "research paper" | "financial report" | "news" | "company"; // Exa category filter
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: "brave" | "tavily" | "exa" | "parallel";
  rawScore: number;          // provider-native score (0-1 or arbitrary)
  fusedScore?: number;       // post-fusion final score
  highlights?: string[];     // extracted matching snippets (advanced mode)
  publishedDate?: string;    // ISO date if available
}

const PROVIDER_WEIGHTS: Record<SearchResult["source"], number> = {
  exa: 1.3,
  parallel: 1.15,
  tavily: 1.0,
  brave: 0.9,
};

const DEFAULT_MAX_PER_PROVIDER = 10;
const FETCH_TIMEOUT_MS = 15_000;
// Advanced tier (Tavily raw_content + chunks_per_source, Exa contents) needs more time.
const ADVANCED_FETCH_TIMEOUT_MS = 45_000;

// Spam domains we always want to filter out from strategy hunts.
const ALWAYS_EXCLUDE_DOMAINS = ["pinterest.com", "facebook.com", "instagram.com", "tiktok.com"];

// ─── Brave Goggle (inline, comment-stripped) ─────────────────────────────────
// Brave accepts the goggle definition inline via the `goggles` query param.
// The full file with comments is ~3.6KB which Brave rejects with HTTP 422 —
// Brave URL-param limit is ~2KB for the goggle. We strip comments and blanks
// at load time to compress the active rules into a small payload.
let braveGoggleBody: string | null = null;
function loadBraveGoggle(): string | null {
  if (braveGoggleBody !== null) return braveGoggleBody || null;
  const customPath = process.env.BRAVE_QUANT_GOGGLE_PATH;
  const defaultPath = pathResolve(
    process.cwd(),
    "config/brave-goggles/trading-forge-quant.goggle",
  );
  const path = customPath ?? defaultPath;
  try {
    if (!existsSync(path)) {
      braveGoggleBody = "";
      logger.info({ path }, "search-router: brave goggle file not found, skipping");
      return null;
    }
    const raw = readFileSync(path, "utf-8");
    // Strip ALL non-rule lines (comments, blanks, header metadata). The
    // header metadata is purely cosmetic for Goggle UI listings — useless
    // when passing inline. This gets us under Brave's ~1500 char URL-param
    // limit while preserving every actual boost/downrank/discard rule.
    const compact = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.startsWith("$"))
      .join("\n");
    if (compact.length > 1500) {
      logger.warn(
        { path, originalLength: raw.length, compactLength: compact.length },
        "search-router: brave goggle > 1500 chars after strip; Brave may reject inline. Reduce rules.",
      );
    }
    braveGoggleBody = compact;
    logger.info(
      { path, originalLength: raw.length, compactLength: compact.length, rules: compact.split("\n").length },
      "search-router: brave goggle loaded (rules-only compact)",
    );
    return compact;
  } catch (err) {
    logger.warn({ err, path }, "search-router: failed to load brave goggle");
    braveGoggleBody = "";
    return null;
  }
}

// ─── Adapters ─────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

async function braveAdapter(opts: SearchOptions): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return [];

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", buildQueryString(opts));
  url.searchParams.set("count", String(opts.maxResults ?? DEFAULT_MAX_PER_PROVIDER));
  // 5x more snippet text per result — free upgrade, applies to every tier
  url.searchParams.set("extra_snippets", "true");
  // Pull discussions/faq/news/videos inline so ONE goggle-biased call returns
  // 5 source types (web pages, forum threads, FAQs, news articles, videos).
  // Brave's Video and News APIs don't support goggles directly — by including
  // them in result_filter on the goggle-applied web search, we get the bias
  // applied across all source types in a single request.
  url.searchParams.set("result_filter", "web,discussions,faq,news,videos");
  url.searchParams.set("text_decorations", "false");
  url.searchParams.set("safesearch", "off");
  url.searchParams.set("summary", "1"); // free LLM-summary key
  // Recency
  if (opts.timeRange) {
    const fmap: Record<string, string> = { day: "pd", week: "pw", month: "pm", year: "py" };
    url.searchParams.set("freshness", fmap[opts.timeRange] ?? "pm");
  } else {
    url.searchParams.set("freshness", "pm"); // default past month
  }
  // Quant Goggle for permanent quant-bias ranking — boosts academic + quant
  // sources, downranks content farms. Brave's URL-param goggle limit is small
  // (< ~700 chars including encoding overhead), so inline only works for tiny
  // goggles. Default path: hosted gist URL (works via `goggles` param even
  // though Brave's UI submission requires github.com/gitlab.com domain).
  // Set BRAVE_GOGGLE_INLINE=1 to opt into the experimental inline path.
  const goggleUrl = process.env.BRAVE_QUANT_GOGGLE_URL;
  const useInline = process.env.BRAVE_GOGGLE_INLINE === "1";
  if (useInline) {
    const goggleBody = loadBraveGoggle();
    if (goggleBody) url.searchParams.set("goggles", goggleBody);
  } else if (goggleUrl) {
    url.searchParams.set("goggles", goggleUrl);
  }

  const res = await fetchWithTimeout(
    url.toString(),
    { headers: { "X-Subscription-Token": apiKey, Accept: "application/json" } },
    FETCH_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`brave HTTP ${res.status}`);
  const json: any = await res.json();

  // Pull web + discussions + faq + news + videos arrays (single goggle-applied call)
  const buckets: any[][] = [
    json?.web?.results ?? [],
    json?.discussions?.results ?? [],
    json?.faq?.results ?? [],
    json?.news?.results ?? [],
    json?.videos?.results ?? [],
  ];

  const out: SearchResult[] = [];
  for (const bucket of buckets) {
    bucket.forEach((r: any, idx: number) => {
      const extras: string[] = Array.isArray(r.extra_snippets) ? r.extra_snippets : [];
      const snippet = [r.description ?? r.snippet ?? "", ...extras].filter(Boolean).join(" ").slice(0, 1500);
      out.push({
        title: String(r.title ?? ""),
        url: String(r.url ?? ""),
        snippet,
        source: "brave",
        rawScore: 1 - idx / Math.max(bucket.length, 1),
        publishedDate: r.age ?? r.published ?? undefined,
      });
    });
  }
  return out;
}

async function tavilyAdapter(opts: SearchOptions): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  const isAdvanced = opts.depth === "advanced";
  const body: Record<string, unknown> = {
    query: buildQueryString(opts),
    search_depth: isAdvanced ? "advanced" : "basic", // 1 credit basic, 2 credit advanced
    topic: "finance", // free quality boost — Tavily has a finance topic we never used
    max_results: Math.min(opts.maxResults ?? DEFAULT_MAX_PER_PROVIDER, 20),
    include_answer: isAdvanced ? "advanced" : false,
    include_raw_content: isAdvanced ? "markdown" : false,
    time_range: opts.timeRange ?? "month",
  };
  // chunks_per_source is advanced-only (3x snippet text per result)
  if (isAdvanced) body.chunks_per_source = 3;
  // Whitelist/blacklist when caller specifies
  if (opts.includeDomains?.length) body.include_domains = opts.includeDomains.slice(0, 300);
  if (opts.excludeDomains?.length || ALWAYS_EXCLUDE_DOMAINS.length) {
    body.exclude_domains = [...new Set([...(opts.excludeDomains ?? []), ...ALWAYS_EXCLUDE_DOMAINS])];
  }

  const timeout = isAdvanced ? ADVANCED_FETCH_TIMEOUT_MS : FETCH_TIMEOUT_MS;
  const res = await fetchWithTimeout(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    timeout,
  );
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`tavily HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 100)}` : ""}`);
  }
  const json: any = await res.json();
  const items: any[] = json?.results ?? [];
  return items.map((r) => ({
    title: String(r.title ?? ""),
    url: String(r.url ?? ""),
    // raw_content is the full markdown when advanced+include_raw_content; fall back to content
    snippet: String(r.raw_content ?? r.content ?? r.snippet ?? "").slice(0, 1500),
    source: "tavily" as const,
    rawScore: typeof r.score === "number" ? r.score : 0.5,
    publishedDate: r.published_date ?? undefined,
  }));
}

async function exaAdapter(opts: SearchOptions): Promise<SearchResult[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return [];

  const isAdvanced = opts.depth === "advanced";
  // 18-month freshness for academic/quant papers
  const eighteenMonthsAgo = new Date(Date.now() - 540 * 86400_000).toISOString();

  const body: Record<string, unknown> = {
    query: buildQueryString(opts),
    numResults: opts.maxResults ?? DEFAULT_MAX_PER_PROVIDER,
    type: "auto", // 2026 default; replaces deprecated "neural"
    startPublishedDate: eighteenMonthsAgo,
    excludeDomains: [...new Set([...(opts.excludeDomains ?? []), ...ALWAYS_EXCLUDE_DOMAINS])],
  };
  // Free category filter — kills 90% of generic blog spam
  if (opts.category) body.category = opts.category;
  if (opts.includeDomains?.length) body.includeDomains = opts.includeDomains.slice(0, 300);

  // Contents enrichment — costs $1/1k pages PER content type
  // Only enable on advanced tier (deep research workflows)
  if (isAdvanced) {
    body.contents = {
      text: { maxCharacters: 2000, verbosity: "compact" },
      highlights: {
        numSentences: 3,
        highlightsPerUrl: 4,
        query: "entry rule exit rule stop loss sharpe ratio backtest results",
      },
      summary: {
        query: `Extract for ${opts.intent || "trading strategy"}: thesis, entry, exit, risk rules, market, timeframe, reported sharpe/profit factor.`,
      },
    };
  }

  const exaTimeout = isAdvanced ? ADVANCED_FETCH_TIMEOUT_MS : FETCH_TIMEOUT_MS;
  const res = await fetchWithTimeout(
    "https://api.exa.ai/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(body),
    },
    exaTimeout,
  );
  if (!res.ok) throw new Error(`exa HTTP ${res.status}`);
  const json: any = await res.json();
  const items: any[] = json?.results ?? [];
  return items.map((r) => {
    const highlights: string[] = Array.isArray(r.highlights) ? r.highlights : [];
    const snippet = String(r.summary || highlights.join(" ... ") || r.text || r.snippet || "").slice(0, 1500);
    return {
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      snippet,
      source: "exa" as const,
      rawScore: typeof r.score === "number" ? r.score : 0.7,
      highlights: highlights.length > 0 ? highlights : undefined,
      publishedDate: r.publishedDate ?? r.published_date ?? undefined,
    };
  });
}

async function parallelAdapter(opts: SearchOptions): Promise<SearchResult[]> {
  const apiKey = process.env.PARALLEL_API_KEY;
  if (!apiKey) return [];

  // /v1/search ONLY accepts search_queries — verified live 2026-04-29.
  // (objective, source_policy, max_results, excerpt_settings are Task API fields,
  // NOT search.) For richer Parallel features use the Task API in 5K workflow.
  // Multi-query fan-out gives 3x candidate diversity per call (no extra cost).
  const queries = [
    buildQueryString(opts),
    `${opts.intent} backtest results ${opts.market ?? ""}`.trim(),
    opts.regime ? `${opts.intent} academic paper ${opts.regime}`.trim() : `${opts.intent} academic paper futures`,
  ].filter(Boolean);

  const body = { search_queries: queries };

  const res = await fetchWithTimeout(
    "https://api.parallel.ai/v1/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(body),
    },
    FETCH_TIMEOUT_MS,
  );
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`parallel HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 100)}` : ""}`);
  }
  const json: any = await res.json();
  const items: any[] = json?.results ?? [];
  return items.map((r, idx) => {
    const excerpts: string[] = Array.isArray(r.excerpts) ? r.excerpts : [];
    return {
      title: String(r.title ?? r.name ?? ""),
      url: String(r.url ?? r.link ?? ""),
      snippet: excerpts.join(" ").slice(0, 1500) || String(r.snippet ?? r.summary ?? r.content ?? ""),
      source: "parallel" as const,
      rawScore: typeof r.score === "number" ? r.score : 1 - idx / Math.max(items.length, 1),
      publishedDate: r.publish_date ?? r.published_date ?? undefined,
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildQueryString(opts: SearchOptions): string {
  const parts = [opts.query, opts.intent];
  if (opts.market) parts.push(opts.market);
  if (opts.regime) parts.push(`regime:${opts.regime}`);
  return parts.filter(Boolean).join(" ");
}

function urlHash(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    // Strip trailing slash, normalize host, ignore query for dedup
    return `${u.host}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return rawUrl.toLowerCase();
  }
}

function fuseResults(perProvider: SearchResult[][]): SearchResult[] {
  const byKey = new Map<string, SearchResult>();
  for (const list of perProvider) {
    for (const r of list) {
      if (!r.url) continue;
      const key = urlHash(r.url);
      const weight = PROVIDER_WEIGHTS[r.source];
      const fused = r.rawScore * weight;
      const existing = byKey.get(key);
      if (!existing || (existing.fusedScore ?? 0) < fused) {
        byKey.set(key, { ...r, fusedScore: fused });
      } else {
        // Boost when multiple providers agree
        existing.fusedScore = (existing.fusedScore ?? 0) + 0.05 * weight;
      }
    }
  }
  return [...byKey.values()].sort((a, b) => (b.fusedScore ?? 0) - (a.fusedScore ?? 0));
}

async function applyGraveyardFilter(results: SearchResult[]): Promise<SearchResult[]> {
  if (results.length === 0) return results;
  try {
    const rows = await db.execute(sql`
      SELECT DISTINCT (strategy_params->>'url') AS url
      FROM ${systemJournal}
      WHERE source = 'openclaw'
        AND strategy_params->>'url' IS NOT NULL
        AND created_at > now() - interval '90 days'
    `);
    const seen = new Set<string>(
      (rows as any[])
        .map((r) => urlHash(String((r as any).url ?? "")))
        .filter((s) => s.length > 0),
    );
    return results.filter((r) => !seen.has(urlHash(r.url)));
  } catch (err) {
    logger.warn({ err }, "search-router: graveyard filter skipped (table missing or query failed)");
    return results;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function strategyHunt(opts: SearchOptions): Promise<{
  query: string;
  depth: "basic" | "advanced";
  totalRaw: number;
  totalFused: number;
  totalAfterGraveyard: number;
  perProvider: Record<string, { count: number; ok: boolean; error?: string }>;
  results: SearchResult[];
}> {
  const queryString = buildQueryString(opts);
  const depth = opts.depth ?? "basic";
  const cb = CircuitBreakerRegistry.get("search-router", { failureThreshold: 5, cooldownMs: 30_000 });
  if (cb.currentState === "OPEN") {
    throw new CircuitOpenError("search-router", new Date(), 30_000);
  }

  const adapters = [
    { name: "brave", fn: braveAdapter },
    { name: "tavily", fn: tavilyAdapter },
    { name: "exa", fn: exaAdapter },
    { name: "parallel", fn: parallelAdapter },
  ] as const;

  const settled = await Promise.allSettled(adapters.map((a) => a.fn(opts)));

  const perProvider: Record<string, { count: number; ok: boolean; error?: string }> = {};
  const lists: SearchResult[][] = [];

  settled.forEach((res, idx) => {
    const name = adapters[idx].name;
    if (res.status === "fulfilled") {
      perProvider[name] = { count: res.value.length, ok: true };
      lists.push(res.value);
    } else {
      perProvider[name] = { count: 0, ok: false, error: String(res.reason?.message ?? res.reason) };
      logger.warn({ provider: name, err: res.reason }, "search-router: provider failed");
    }
  });

  const totalRaw = lists.reduce((sum, l) => sum + l.length, 0);
  const fused = fuseResults(lists);
  const filtered = await applyGraveyardFilter(fused);

  logger.info(
    {
      query: queryString,
      depth,
      totalRaw,
      totalFused: fused.length,
      totalAfterGraveyard: filtered.length,
      perProvider,
    },
    "search-router: strategyHunt complete",
  );

  return {
    query: queryString,
    depth,
    totalRaw,
    totalFused: fused.length,
    totalAfterGraveyard: filtered.length,
    perProvider,
    results: filtered,
  };
}
