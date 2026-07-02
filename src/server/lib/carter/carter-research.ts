/**
 * carter-research.ts — Carter's GENERAL (non-strategy) research engine.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * GOVERNANCE BOUNDARY (the whole point — do not blur it)
 * ════════════════════════════════════════════════════════════════════════════
 * Web search, Reddit, and research papers in THIS module are for NON-strategy
 * research ONLY — institutional/market/trading/bot/growth questions, sentiment,
 * "how do desks do X", etc. They NEVER source a trading strategy.
 *
 * Strategies enter Trading Forge through EXACTLY ONE door: YouTube → the existing
 * extraction pipeline (`extract_youtube_strategy` → /scout-extract → pending
 * bucket). Nothing in this file deposits a strategy, touches the scout pipeline,
 * or graduates a concept. If you ever find yourself wanting to turn a web/Reddit
 * result into a strategy here, STOP — that is the YouTube lane's job.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Design
 * ════════════════════════════════════════════════════════════════════════════
 * - Provider fan-out runs IN PARALLEL with a per-provider timeout (~8s) and
 *   GRACEFUL per-provider degradation: one provider failing (key missing, HTTP
 *   error, timeout) must NOT fail the whole tool. We collect what succeeds and
 *   report what failed in `providers_failed`.
 * - Total runtime is bounded (~25-30s) so the tool fits a webhook response
 *   window. Parallel.ai deep-research (minutes-long) is OPTIONAL/skippable and
 *   OFF by default so the sync path stays bounded.
 * - Recency lean toward >= 2025 sources where the provider supports date filters.
 * - LLM synthesis is Ollama-first (OLLAMA_HOST / model-router topology) with a
 *   deterministic extractive fallback when the local model is unavailable, so a
 *   voice tool never hard-fails and never burns surprise cloud budget.
 *
 * Mirrors the provider-call pattern in `scripts/institutional-research.mjs`.
 * Leaf logger import (./logger.js) per repo convention — never ../index.js.
 */

import { logger } from "../logger.js";
import { fetchRedditEnrichment } from "../../services/reddit-cross-extract.js";

// ─── Tunables (env-overridable, no magic numbers) ─────────────────────────────

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Per-provider hard timeout — keeps any single provider from eating the window. */
const PROVIDER_TIMEOUT_MS = intEnv("CARTER_RESEARCH_PROVIDER_TIMEOUT_MS", 8_000);
/** Optional Parallel.ai deep-research total budget when explicitly enabled. */
const PARALLEL_TIMEOUT_MS = intEnv("CARTER_RESEARCH_PARALLEL_TIMEOUT_MS", 25_000);
/** Ollama synthesis timeout. */
const SYNTH_TIMEOUT_MS = intEnv("CARTER_RESEARCH_SYNTH_TIMEOUT_MS", 12_000);
/** Max sources retained in the returned brief. */
const MAX_SOURCES = intEnv("CARTER_RESEARCH_MAX_SOURCES", 12);
/** Per-provider result cap. */
const PER_PROVIDER_LIMIT = intEnv("CARTER_RESEARCH_PER_PROVIDER_LIMIT", 6);
/** Recency lean — providers that support date filtering bias to >= this date. */
const RECENCY_SINCE = process.env.CARTER_RESEARCH_SINCE ?? "2025-01-01";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResearchSource {
  title: string;
  url: string;
  provider: string;
  snippet?: string;
  published_at?: string | null;
}

export interface InstitutionalResearchResult {
  question: string;
  brief: string;
  sources: ResearchSource[];
  providers_ok: string[];
  providers_failed: Array<{ provider: string; reason: string }>;
  synthesized_by: "ollama" | "extractive_fallback";
  elapsed_ms: number;
}

/** Injectable dependencies — defaults are the real implementations; tests override. */
export interface ResearchDeps {
  fetchImpl?: typeof fetch;
  /** Ollama-first synthesizer. Returns null on failure → extractive fallback. */
  synthFn?: (question: string, sources: ResearchSource[], fetchImpl: typeof fetch) => Promise<string | null>;
  /** Reddit enrichment fn (general research signal). */
  redditFn?: typeof fetchRedditEnrichment;
  now?: () => number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ollamaBase(): string {
  return process.env.OLLAMA_HOST ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
}

/** Wrap a promise with a timeout that rejects with a typed reason. */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label}_timeout`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function dedupeByUrl(sources: ResearchSource[]): ResearchSource[] {
  const seen = new Set<string>();
  const out: ResearchSource[] = [];
  for (const s of sources) {
    const key = (s.url ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// Provider fetchers — each returns ResearchSource[] or THROWS (caller catches).
// Missing API key throws "no_api_key" so it lands in providers_failed (visible,
// not silent). Mirrors scripts/institutional-research.mjs provider calls.
// ════════════════════════════════════════════════════════════════════════════

/** Brave web search (general web). Recency lean via freshness=py (past year). */
export async function braveWebSearch(
  query: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ResearchSource[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY;
  if (!key) throw new Error("no_api_key");
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(PER_PROVIDER_LIMIT));
  url.searchParams.set("country", "US");
  url.searchParams.set("freshness", "py"); // recency lean: past year (>= 2025-ish)
  const res = await fetchImpl(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`brave_http_${res.status}`);
  const j = (await res.json()) as { web?: { results?: Array<Record<string, unknown>> } };
  return (j.web?.results ?? []).slice(0, PER_PROVIDER_LIMIT).map((r) => ({
    title: String(r.title ?? ""),
    url: String(r.url ?? ""),
    provider: "brave",
    snippet: String(r.description ?? "").slice(0, 400),
    published_at: typeof r.page_age === "string" ? r.page_age : null,
  })).filter((s) => s.url);
}

/**
 * Exa neural search + research-paper category for whitepapers.
 * Runs a general neural query AND a `category: "research paper"` query in
 * parallel (both inside the shared provider timeout), merged + deduped.
 * Recency lean via startPublishedDate.
 */
export async function exaResearchSearch(
  query: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ResearchSource[]> {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("no_api_key");
  const headers = { "x-api-key": key, "Content-Type": "application/json" };

  async function exaQuery(category?: string): Promise<ResearchSource[]> {
    const body: Record<string, unknown> = {
      query,
      numResults: PER_PROVIDER_LIMIT,
      useAutoprompt: true,
      type: "neural",
      startPublishedDate: RECENCY_SINCE,
      contents: { text: { maxCharacters: 600 } },
    };
    if (category) body.category = category;
    const res = await fetchImpl("https://api.exa.ai/search", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new Error(`exa_http_${res.status}`);
    const j = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const tag = category === "research paper" ? "exa_paper" : "exa";
    return (j.results ?? []).map((r) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      provider: tag,
      snippet: String((r.text as string | undefined) ?? "").slice(0, 400),
      published_at: typeof r.publishedDate === "string" ? r.publishedDate : null,
    })).filter((s) => s.url);
  }

  // Both Exa modes; if the paper-category call fails we still keep the neural one.
  const [general, papers] = await Promise.allSettled([exaQuery(), exaQuery("research paper")]);
  const out: ResearchSource[] = [];
  if (general.status === "fulfilled") out.push(...general.value);
  if (papers.status === "fulfilled") out.push(...papers.value);
  // If BOTH failed, surface the failure so it lands in providers_failed.
  if (general.status === "rejected" && papers.status === "rejected") {
    throw general.reason instanceof Error ? general.reason : new Error("exa_failed");
  }
  return dedupeByUrl(out);
}

/** Tavily advanced web search (general web). Recency lean via days window. */
export async function tavilyWebSearch(
  query: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ResearchSource[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("no_api_key");
  const days = Math.max(1, Math.ceil((Date.now() - new Date(RECENCY_SINCE).getTime()) / 86_400_000));
  const res = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: PER_PROVIDER_LIMIT,
      search_depth: "advanced",
      include_answer: false,
      days,
    }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`tavily_http_${res.status}`);
  const j = (await res.json()) as { results?: Array<Record<string, unknown>> };
  return (j.results ?? []).slice(0, PER_PROVIDER_LIMIT).map((r) => ({
    title: String(r.title ?? ""),
    url: String(r.url ?? ""),
    provider: "tavily",
    snippet: String((r.content as string | undefined) ?? "").slice(0, 400),
    published_at: typeof r.published_date === "string" ? r.published_date : null,
  })).filter((s) => s.url);
}

/**
 * Reddit community signal via reddit-cross-extract (free JSON API, no auth;
 * sort=relevance&t=all per pinned fact). Returns the top post (+ comments) as a
 * single research source. Reused as the institutional_research Reddit provider.
 */
export async function redditResearchSource(
  question: string,
  redditFn: typeof fetchRedditEnrichment = fetchRedditEnrichment,
): Promise<ResearchSource[]> {
  // fetchRedditEnrichment is concept-keyed; pass the question as the concept. It
  // fail-softs to null (no upvote-qualifying post) — we surface that as empty.
  const enrich = await redditFn(question, { minUpvotes: 10 });
  if (!enrich) return [];
  return [{
    title: `r/${enrich.subreddit} community discussion (${enrich.upvoteScore} upvotes)`,
    url: enrich.postUrl,
    provider: "reddit",
    snippet: enrich.rawMarkdown.slice(0, 600),
    published_at: null,
  }];
}

/**
 * OPTIONAL Parallel.ai general deep-research. Bounded by PARALLEL_TIMEOUT_MS.
 * Submit → bounded poll. NOT a strategy hunt — a general research task. Only
 * invoked when the caller opts in (includeParallel=true).
 */
export async function parallelGeneralResearch(
  question: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResearchSource[]> {
  const key = process.env.PARALLEL_API_KEY;
  if (!key) throw new Error("no_api_key");
  const deadline = Date.now() + PARALLEL_TIMEOUT_MS;

  const submit = await fetchImpl("https://api.parallel.ai/v1/tasks/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      processor: "base",
      input: `Research this institutional / market / trading-infrastructure question and return cited findings (this is NON-strategy research — do NOT invent a trading strategy): ${question}`,
      output_schema: {
        type: "object",
        properties: {
          findings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                url: { type: "string" },
                summary: { type: "string" },
              },
              required: ["title", "url"],
            },
          },
        },
        required: ["findings"],
      },
    }),
  });
  if (!submit.ok) throw new Error(`parallel_http_${submit.status}`);
  const sub = (await submit.json()) as { run_id?: string; id?: string };
  const runId = sub.run_id ?? sub.id;
  if (!runId) throw new Error("parallel_no_run_id");

  // Bounded poll loop.
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    if (Date.now() >= deadline) break;
    const statusRes = await fetchImpl(`https://api.parallel.ai/v1/tasks/runs/${runId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!statusRes.ok) continue;
    const st = (await statusRes.json()) as { status?: string };
    if (st.status === "failed" || st.status === "cancelled") throw new Error(`parallel_${st.status}`);
    if (st.status !== "completed") continue;
    const resultRes = await fetchImpl(`https://api.parallel.ai/v1/tasks/runs/${runId}/result`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!resultRes.ok) throw new Error(`parallel_result_http_${resultRes.status}`);
    const result = (await resultRes.json()) as { output?: { content?: { output?: string } } };
    const raw = result.output?.content?.output;
    let findings: Array<Record<string, unknown>> = [];
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as { findings?: Array<Record<string, unknown>> };
        findings = Array.isArray(parsed.findings) ? parsed.findings : [];
      } catch { /* leave empty */ }
    }
    return findings.map((f) => ({
      title: String(f.title ?? ""),
      url: String(f.url ?? ""),
      provider: "parallel",
      snippet: String(f.summary ?? "").slice(0, 400),
      published_at: null,
    })).filter((s) => s.url);
  }
  throw new Error("parallel_timeout");
}

// ════════════════════════════════════════════════════════════════════════════
// LLM synthesis — Ollama-first with deterministic extractive fallback.
// ════════════════════════════════════════════════════════════════════════════

function buildExtractiveBrief(question: string, sources: ResearchSource[]): string {
  if (sources.length === 0) {
    return `No sources were retrieved for: "${question}". Every provider was unavailable or returned nothing. Try again shortly or rephrase the question.`;
  }
  const lines = sources.map((s, i) => {
    const snip = (s.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
    return `[${i + 1}] ${s.title} (${s.provider}) — ${snip}${snip ? "…" : ""}`;
  });
  return [
    `Research brief for: "${question}"`,
    `(Local synthesis model unavailable — showing the top cited sources directly.)`,
    "",
    ...lines,
  ].join("\n");
}

/** Default Ollama-first synthesizer. Returns null on any failure. */
export async function ollamaSynthesize(
  question: string,
  sources: ResearchSource[],
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (sources.length === 0) return null;
  const model = process.env.CARTER_RESEARCH_MODEL ?? "deepseek-r1:14b";
  const numbered = sources
    .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${(s.snippet ?? "").slice(0, 500)}`)
    .join("\n\n");
  const system =
    "You are an institutional research analyst. Write a concise, factual, CITED brief that answers the user's question using ONLY the provided sources. Cite inline as [n]. Do not fabricate facts or sources. If the sources are thin, say so. This is general research — never propose a tradeable strategy.";
  const user = `Question: ${question}\n\nSources:\n${numbered}\n\nWrite the brief now.`;
  try {
    const res = await withTimeout(
      fetchImpl(`${ollamaBase()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          options: { temperature: 0.2 },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      }),
      SYNTH_TIMEOUT_MS,
      "ollama_synth",
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { message?: { content?: string } };
    let content = (j.message?.content ?? "").trim();
    // deepseek-r1 emits <think>…</think> reasoning — strip it.
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    return content.length > 0 ? content : null;
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, "carter-research: ollama synth failed");
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════════

/**
 * institutional_research — GENERAL (non-strategy) institutional-grade research.
 * Fans out across Brave + Exa(neural + research papers) + Tavily + Reddit in
 * parallel with per-provider timeouts + graceful degradation, then LLM-
 * synthesizes a cited brief. Parallel.ai is optional/skippable (OFF by default).
 */
export async function institutionalResearch(
  opts: { question: string; includeParallel?: boolean },
  deps: ResearchDeps = {},
): Promise<InstitutionalResearchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const synthFn = deps.synthFn ?? ollamaSynthesize;
  const redditFn = deps.redditFn ?? fetchRedditEnrichment;
  const now = deps.now ?? Date.now;
  const start = now();
  const question = opts.question;

  // Provider tasks — each wrapped with a per-provider timeout. A rejection here
  // is graceful: it lands in providers_failed, never aborts the others.
  type ProviderTask = { name: string; run: () => Promise<ResearchSource[]> };
  const tasks: ProviderTask[] = [
    { name: "brave", run: () => braveWebSearch(question, fetchImpl) },
    { name: "exa", run: () => exaResearchSearch(question, fetchImpl) },
    { name: "tavily", run: () => tavilyWebSearch(question, fetchImpl) },
    { name: "reddit", run: () => redditResearchSource(question, redditFn) },
  ];
  if (opts.includeParallel === true) {
    // Bounded but longer — caller opted into the deep-research path explicitly.
    tasks.push({ name: "parallel", run: () => parallelGeneralResearch(question, fetchImpl) });
  }

  const settled = await Promise.allSettled(
    tasks.map((t) =>
      withTimeout(t.run(), t.name === "parallel" ? PARALLEL_TIMEOUT_MS + 1_000 : PROVIDER_TIMEOUT_MS, t.name)
        .then((sources) => ({ name: t.name, sources }))
        .catch((err) => {
          throw { name: t.name, reason: err instanceof Error ? err.message : String(err) };
        }),
    ),
  );

  const providers_ok: string[] = [];
  const providers_failed: Array<{ provider: string; reason: string }> = [];
  let allSources: ResearchSource[] = [];

  for (const r of settled) {
    if (r.status === "fulfilled") {
      providers_ok.push(r.value.name);
      allSources.push(...r.value.sources);
    } else {
      const reason = r.reason as { name?: string; reason?: string };
      providers_failed.push({ provider: reason?.name ?? "unknown", reason: reason?.reason ?? "error" });
    }
  }

  allSources = dedupeByUrl(allSources).slice(0, MAX_SOURCES);

  // LLM synthesis (Ollama-first) → extractive fallback.
  let brief: string;
  let synthesizedBy: "ollama" | "extractive_fallback";
  const synthesized = await synthFn(question, allSources, fetchImpl).catch(() => null);
  if (synthesized && synthesized.trim().length > 0) {
    brief = synthesized;
    synthesizedBy = "ollama";
  } else {
    brief = buildExtractiveBrief(question, allSources);
    synthesizedBy = "extractive_fallback";
  }

  logger.info(
    { question, providers_ok, providers_failed: providers_failed.map((p) => p.provider), sources: allSources.length, synthesizedBy },
    "carter-research: institutional_research complete",
  );

  return {
    question,
    brief,
    sources: allSources,
    providers_ok,
    providers_failed,
    synthesized_by: synthesizedBy,
    elapsed_ms: now() - start,
  };
}

// NOTE: the former `research_reddit` direct-Reddit-JSON path was retired —
// Reddit's search.json now 403s and the tool moved to the Apify-backed ASYNC
// research service (src/server/services/apify-research-service.ts). The Reddit
// COMMUNITY-SIGNAL provider for institutional_research lives in
// `redditResearchSource` above (reddit-cross-extract) and is unaffected.
