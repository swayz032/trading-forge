/**
 * apify-research-service.ts — Carter's REAL Apify-backed research (Reddit + Instagram).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * GOVERNANCE BOUNDARY (same as carter-research.ts — do not blur it)
 * ════════════════════════════════════════════════════════════════════════════
 * This is NON-strategy research ONLY — sentiment, community discussion, market /
 * bot / growth questions. It NEVER sources a trading strategy. Strategies enter
 * Trading Forge through EXACTLY ONE door: YouTube → the extraction pipeline.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Why ASYNC (fire-then-fetch-later)
 * ════════════════════════════════════════════════════════════════════════════
 * An Apify scrape takes ~30-90s — far too long for a 20-second voice tool. So
 * Carter FIRES the scrape (instant POST), gets a runId back, and returns
 * immediately with a "scan started" note. A fire-and-forget background poller
 * watches the run; when it SUCCEEDS the poller fetches the dataset, builds a
 * BOUNDED concise summary, and stores it in carter_memory (kind='research').
 * Carter pulls the result later via `get_research_result`.
 *
 * Storage model (carter_memory rows, source='apify'):
 *   - PENDING marker written synchronously at fire time:
 *       { platform, topic, status:'running', runId, startedAtIso }
 *   - COMPLETED marker written by the poller on SUCCEEDED:
 *       { platform, topic, status:'completed', headline, items:[…], completedAtIso }
 *   - FAILED marker on FAILED / ABORTED / TIMED-OUT / timeout:
 *       { platform, topic, status:'failed', reason, … }
 *
 * The latest row per topic is the authoritative state (newest-first query).
 *
 * Apify async flow (verified live 2026-06-29):
 *   1. POST  /v2/acts/<actorId>/runs?token=<TOKEN>      → { data:{ id, defaultDatasetId, status } }
 *   2. GET   /v2/actor-runs/<runId>?token=<TOKEN>       → { data:{ status, defaultDatasetId } }
 *   3. GET   /v2/datasets/<datasetId>/items?token=<TOKEN>&clean=true&limit=10 → [ …items ]
 *
 * Token: APIFY_REDDIT_TOKEN (fallback APIFY_API_KEY). NEVER hardcoded.
 *
 * Actor inputs (verified live):
 *   Reddit    — trudax~reddit-scraper-lite:
 *     { searches:[topic], type:"posts", sort:"relevance", time:"all",
 *       maxItems:8, maxPostCount:8, skipComments:true, proxy:{useApifyProxy:true} }
 *     items: { title, communityName/parsedCommunityName, url, body, upVotes,
 *              numberOfComments, username, createdAt, dataType:"post" }
 *   Instagram — apify~instagram-scraper:
 *     ⚠ `searchType:"hashtag"` SEARCH mode returns HASHTAG METADATA, not posts.
 *        The working input is directUrls to the hashtag (or profile) page:
 *     { directUrls:["https://www.instagram.com/explore/tags/<tag>/"],
 *       resultsType:"posts", resultsLimit:8, proxy:{useApifyProxy:true} }
 *     items: { caption, ownerUsername, ownerFullName, url, likesCount,
 *              commentsCount, timestamp, type }
 *
 * Fail-soft throughout: a slow / failed Apify run NEVER throws into the route or
 * a cron — the background poller swallows everything and stores a failed marker.
 * Bounded outputs (voice agent): summaries cap item count + field lengths.
 *
 * Leaf logger import (./logger via ../lib/logger.js) per repo convention.
 */

import { logger } from "../lib/logger.js";
import { insertMemory, queryMemories } from "../lib/carter/carter-memory-store.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { notifyInfo } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { ollamaSynthesize } from "../lib/carter/carter-research.js";

// ─── Tunables (env-overridable, no magic numbers) ─────────────────────────────

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Total time the background poller will watch a run before giving up. */
const POLL_TIMEOUT_MS = intEnv("APIFY_RESEARCH_POLL_TIMEOUT_MS", 240_000); // ~4 min
/** Gap between status polls. */
const POLL_INTERVAL_MS = intEnv("APIFY_RESEARCH_POLL_INTERVAL_MS", 10_000); // ~10 s
/** Per-HTTP-call timeout (start / status / dataset fetch). */
const HTTP_TIMEOUT_MS = intEnv("APIFY_RESEARCH_HTTP_TIMEOUT_MS", 15_000);
/** Max items pulled from the dataset. */
const DATASET_LIMIT = intEnv("APIFY_RESEARCH_DATASET_LIMIT", 10);
/** Max items retained in the BOUNDED stored summary (voice agent). */
const SUMMARY_ITEM_CAP = intEnv("APIFY_RESEARCH_SUMMARY_ITEM_CAP", 6);

const APIFY_BASE = "https://api.apify.com/v2";
const REDDIT_ACTOR = "trudax~reddit-scraper-lite";
const INSTAGRAM_ACTOR = "apify~instagram-scraper";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResearchPlatform = "reddit" | "instagram";
export type InstagramSearchType = "hashtag" | "user";

export interface ResearchItem {
  title: string;
  url: string;
  score: number;
  snippet: string;
  author?: string | null;
}

export interface StartResearchResult {
  started: boolean;
  platform?: ResearchPlatform;
  topic?: string;
  runId?: string;
  note?: string;
  error?: string;
}

/** Injectable dependencies — defaults are the real implementations; tests override. */
export interface ApifyDeps {
  fetchImpl?: typeof fetch;
  /** Override the fire-and-forget poller (tests pass a no-op to avoid real timers). */
  runPoll?: (args: PollArgs) => Promise<void>;
  /** Override the sleep used between polls (tests pass an instant resolver). */
  sleepFn?: (ms: number) => Promise<void>;
  nowIso?: () => string;
}

export interface PollArgs {
  runId: string;
  datasetId: string;
  platform: ResearchPlatform;
  topic: string;
  fetchImpl?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  nowIso?: () => string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function apifyToken(): string | undefined {
  return process.env.APIFY_REDDIT_TOKEN || process.env.APIFY_API_KEY;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clip(s: unknown, max: number): string {
  const str = typeof s === "string" ? s : s == null ? "" : String(s);
  const oneLine = str.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

async function safeAudit(
  action: string,
  status: "success" | "failure",
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await insertAuditRowSafe({
      action,
      entityType: "carter_research",
      status,
      decisionAuthority: "voice_agent",
      correlationId: null,
      input: payload,
    });
  } catch {
    /* audit is best-effort — never throw */
  }
}

/** Build the Apify actor input body for a platform + topic. */
export function buildActorInput(
  platform: ResearchPlatform,
  topic: string,
  searchType: InstagramSearchType = "hashtag",
): { actorId: string; input: Record<string, unknown> } {
  if (platform === "reddit") {
    return {
      actorId: REDDIT_ACTOR,
      input: {
        searches: [topic],
        type: "posts",
        sort: "relevance",
        time: "all",
        maxItems: 8,
        maxPostCount: 8,
        skipComments: true,
        proxy: { useApifyProxy: true },
      },
    };
  }
  // Instagram — directUrls to the hashtag / profile page (search mode returns
  // hashtag metadata, NOT posts; confirmed live 2026-06-29).
  return {
    actorId: INSTAGRAM_ACTOR,
    input: {
      directUrls: [instagramDirectUrl(topic, searchType)],
      resultsType: "posts",
      resultsLimit: 8,
      proxy: { useApifyProxy: true },
    },
  };
}

/** Sanitize a topic into an Instagram hashtag-page or profile URL. */
export function instagramDirectUrl(topic: string, searchType: InstagramSearchType): string {
  const t = (topic ?? "").trim();
  if (searchType === "user") {
    const u = t.replace(/^@/, "").replace(/[^a-zA-Z0-9._]/g, "").toLowerCase();
    return `https://www.instagram.com/${u}/`;
  }
  const tag = t.replace(/^#/, "").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
  return `https://www.instagram.com/explore/tags/${tag}/`;
}

/** Normalize raw Apify dataset items into bounded ResearchItem[] (top N). */
export function normalizeItems(platform: ResearchPlatform, raw: unknown[]): ResearchItem[] {
  const items: ResearchItem[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (items.length >= SUMMARY_ITEM_CAP) break;
    const o = (r ?? {}) as Record<string, unknown>;
    // Skip Apify error/empty-data sentinel rows.
    if (o.error != null && o.title == null && o.caption == null) continue;

    if (platform === "reddit") {
      const url = typeof o.url === "string" ? o.url : "";
      if (!url) continue;
      const community =
        (typeof o.communityName === "string" && o.communityName) ||
        (typeof o.parsedCommunityName === "string" && `r/${o.parsedCommunityName}`) ||
        "";
      items.push({
        title: clip(o.title, 120) || "(untitled post)",
        url,
        score: Number(o.upVotes ?? 0) || 0,
        snippet: clip(o.body, 160) || clip(community, 60),
        author: typeof o.username === "string" ? o.username : null,
      });
    } else {
      const url = typeof o.url === "string" ? o.url : "";
      if (!url) continue;
      const owner = typeof o.ownerUsername === "string" ? o.ownerUsername : null;
      items.push({
        title: clip(o.caption, 120) || (owner ? `@${owner}` : "(no caption)"),
        url,
        score: Number(o.likesCount ?? 0) || 0,
        snippet: clip(o.caption, 160) || (typeof o.ownerFullName === "string" ? o.ownerFullName : ""),
        author: owner,
      });
    }
  }
  return items;
}

function buildHeadline(platform: ResearchPlatform, topic: string, items: ResearchItem[]): string {
  const label = platform === "reddit" ? "Reddit post" : "Instagram post";
  if (items.length === 0) return `No ${label}s found for "${topic}".`;
  const top = items[0];
  const unit = platform === "reddit" ? "upvotes" : "likes";
  return `${items.length} ${label}${items.length === 1 ? "" : "s"} on "${topic}" — top: "${clip(
    top.title,
    80,
  )}" (${top.score} ${unit}).`;
}

// ─── Apify HTTP calls (each fail-soft via thrown Error caught by callers) ──────

async function startRun(
  actorId: string,
  input: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<{ id: string; defaultDatasetId: string; status: string }> {
  const token = apifyToken();
  if (!token) throw new Error("apify_token_missing");
  const res = await fetchImpl(`${APIFY_BASE}/acts/${actorId}/runs?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`apify_start_http_${res.status}`);
  const j = (await res.json()) as { data?: { id?: string; defaultDatasetId?: string; status?: string } };
  const d = j.data ?? {};
  if (!d.id || !d.defaultDatasetId) throw new Error("apify_start_no_run_id");
  return { id: d.id, defaultDatasetId: d.defaultDatasetId, status: String(d.status ?? "READY") };
}

async function getRunStatus(
  runId: string,
  fetchImpl: typeof fetch,
): Promise<{ status: string; defaultDatasetId: string | null }> {
  const token = apifyToken();
  if (!token) throw new Error("apify_token_missing");
  const res = await fetchImpl(`${APIFY_BASE}/actor-runs/${runId}?token=${token}`, {
    method: "GET",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`apify_status_http_${res.status}`);
  const j = (await res.json()) as { data?: { status?: string; defaultDatasetId?: string } };
  return {
    status: String(j.data?.status ?? "UNKNOWN"),
    defaultDatasetId: j.data?.defaultDatasetId ?? null,
  };
}

async function fetchDatasetItems(datasetId: string, fetchImpl: typeof fetch): Promise<unknown[]> {
  const token = apifyToken();
  if (!token) throw new Error("apify_token_missing");
  const res = await fetchImpl(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&clean=true&limit=${DATASET_LIMIT}`,
    { method: "GET", signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`apify_dataset_http_${res.status}`);
  const j = (await res.json()) as unknown;
  return Array.isArray(j) ? j : [];
}

// ─── Background poller (fire-and-forget — NEVER throws) ────────────────────────

const TERMINAL_FAIL = new Set(["FAILED", "ABORTED", "TIMED-OUT", "TIMED_OUT"]);

/**
 * Polls a started run until it SUCCEEDS (then fetches + stores a bounded summary)
 * or fails / times out (then stores a failed marker). Swallows every error so a
 * slow / failed Apify run can never crash the route or a cron.
 */
export async function pollRunAndStore(args: PollArgs): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const sleepFn = args.sleepFn ?? realSleep;
  const nowIso = args.nowIso ?? (() => new Date().toISOString());
  const { runId, datasetId, platform, topic } = args;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  try {
    while (Date.now() < deadline) {
      await sleepFn(POLL_INTERVAL_MS);
      let statusInfo: { status: string; defaultDatasetId: string | null };
      try {
        statusInfo = await getRunStatus(runId, fetchImpl);
      } catch (err) {
        // Transient status-check failure — keep polling until the deadline.
        logger.debug(
          { err: err instanceof Error ? err.message : String(err), runId },
          "apify-research: status poll error (will retry)",
        );
        continue;
      }
      const { status } = statusInfo;

      if (status === "SUCCEEDED") {
        const dsId = statusInfo.defaultDatasetId ?? datasetId;
        let items: ResearchItem[] = [];
        try {
          const raw = await fetchDatasetItems(dsId, fetchImpl);
          items = normalizeItems(platform, raw);
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), runId, platform, topic },
            "apify-research: dataset fetch failed after SUCCEEDED",
          );
          await storeFailed(platform, topic, runId, "dataset_fetch_failed", nowIso());
          return;
        }
        const headline = buildHeadline(platform, topic, items);
        // Synthesize the scraped posts into a HUMAN-LIKE findings brief — the whole
        // point is to tell the operator what people are saying, not dump links. Local
        // LLM (CARTER_RESEARCH_MODEL); null on failure → inbox falls back to the headline.
        const summary =
          items.length > 0
            ? await ollamaSynthesize(
                `What are people on ${platform} actually saying about "${topic}"? Give me the findings: the main themes, the problems they hit, what's working, and the useful takeaways — in plain English, like a sharp colleague briefing me. Cite posts inline as [n].`,
                items.map((it) => ({ title: it.title, url: it.url, snippet: it.snippet, provider: platform })),
              ).catch((e) => {
                logger.warn({ err: e instanceof Error ? e.message : String(e) }, "apify-research: synth threw");
                return null;
              })
            : null;
        logger.info(
          { platform, topic, model: process.env.CARTER_RESEARCH_MODEL ?? "(default)", summaryLen: summary ? summary.length : 0 },
          "apify-research: synth done",
        );
        await insertMemory({
          kind: "research",
          topic,
          content: JSON.stringify({
            platform,
            topic,
            status: "completed",
            runId,
            headline,
            summary: summary && summary.trim().length > 0 ? summary.trim() : undefined,
            items,
            completedAtIso: nowIso(),
          }),
          source: "apify",
        });
        await safeAudit("carter_research.completed", "success", {
          platform,
          topic,
          runId,
          itemCount: items.length,
        });
        // Discord ping so the operator gets it on their phone even when away — the
        // report itself lives in the Carter inbox. Fail-soft (never block the poller).
        try {
          notifyInfo(
            `Carter · ${platform} research ready`,
            appendFamilyGradePostscript(
              `"${topic}" — ${headline}`,
              `Carter finished researching ${platform} on "${topic}".`,
              "Open the Carter inbox in the Office to read the full report.",
            ),
          );
        } catch (e) {
          logger.warn({ err: e instanceof Error ? e.message : String(e) }, "apify-research: discord notify failed (non-fatal)");
        }
        logger.info({ platform, topic, runId, itemCount: items.length }, "apify-research: completed");
        return;
      }

      if (TERMINAL_FAIL.has(status)) {
        await storeFailed(platform, topic, runId, `run_${status.toLowerCase()}`, nowIso());
        return;
      }
      // READY / RUNNING → keep polling.
    }
    // Deadline reached without SUCCEEDED.
    await storeFailed(platform, topic, runId, "poll_timeout", nowIso());
  } catch (err) {
    // Last-resort guard — the poller must NEVER throw.
    logger.error(
      { err: err instanceof Error ? err.message : String(err), runId, platform, topic },
      "apify-research: poller crashed (swallowed)",
    );
    try {
      await storeFailed(platform, topic, runId, "poller_exception", nowIso());
    } catch {
      /* give up silently */
    }
  }
}

async function storeFailed(
  platform: ResearchPlatform,
  topic: string,
  runId: string,
  reason: string,
  completedAtIso: string,
): Promise<void> {
  await insertMemory({
    kind: "research",
    topic,
    content: JSON.stringify({ platform, topic, status: "failed", runId, reason, completedAtIso }),
    source: "apify",
  }).catch(() => null);
  await safeAudit("carter_research.failed", "failure", { platform, topic, runId, reason });
}

// ════════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════════

/**
 * startAndStoreResearch — fire the Apify scrape (instant), write a PENDING marker,
 * launch the fire-and-forget poller, and return immediately. Carter pulls the
 * result later via get_research_result.
 *
 * On start failure → { started:false, error }. Fail-soft throughout.
 */
export async function startAndStoreResearch(
  opts: { platform: ResearchPlatform; topic: string; searchType?: InstagramSearchType },
  deps: ApifyDeps = {},
): Promise<StartResearchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const platform = opts.platform;
  const topic = (opts.topic ?? "").trim();
  const searchType: InstagramSearchType = opts.searchType === "user" ? "user" : "hashtag";

  if (!topic) return { started: false, error: "topic_required" };
  if (platform !== "reddit" && platform !== "instagram") {
    return { started: false, error: "invalid_platform" };
  }
  if (!apifyToken()) {
    logger.warn({ platform, topic }, "apify-research: APIFY token not configured");
    return { started: false, error: "apify_token_missing" };
  }

  // 1. Start the run (instant POST).
  let run: { id: string; defaultDatasetId: string; status: string };
  try {
    const { actorId, input } = buildActorInput(platform, topic, searchType);
    run = await startRun(actorId, input, fetchImpl);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ err: error, platform, topic }, "apify-research: start failed");
    await safeAudit("carter_research.failed", "failure", { platform, topic, reason: `start_${error}` });
    return { started: false, error };
  }

  // 2. Write the PENDING marker synchronously so get_research_result sees "running".
  await insertMemory({
    kind: "research",
    topic,
    content: JSON.stringify({
      platform,
      topic,
      status: "running",
      runId: run.id,
      startedAtIso: nowIso(),
    }),
    source: "apify",
  }).catch((err) => {
    logger.warn({ err, platform, topic }, "apify-research: running-marker insert failed (non-fatal)");
    return null;
  });

  await safeAudit("carter_research.started", "success", { platform, topic, runId: run.id });

  // 3. Fire-and-forget the poller — do NOT await it.
  const runPoll = deps.runPoll ?? pollRunAndStore;
  void Promise.resolve(
    runPoll({
      runId: run.id,
      datasetId: run.defaultDatasetId,
      platform,
      topic,
      fetchImpl,
      sleepFn: deps.sleepFn,
      nowIso,
    }),
  ).catch((err) => {
    logger.error({ err, platform, topic }, "apify-research: poller launch failed (swallowed)");
  });

  logger.info({ platform, topic, runId: run.id }, "apify-research: scan started");
  return {
    started: true,
    platform,
    topic,
    runId: run.id,
    note: "Scan started — ~1 to 2 minutes. Ask me for it in a bit or I'll bring it up.",
  };
}

/**
 * getLatestResearch — read the LATEST carter_memory research row per topic.
 * Bounded; parses the stored JSON content into a voice-friendly shape.
 */
export async function getLatestResearch(
  opts: { topic?: string },
  deps: { queryFn?: typeof queryMemories } = {},
): Promise<{
  count: number;
  results: Array<{
    topic: string | null;
    platform: ResearchPlatform | null;
    status: string;
    headline?: string;
    items?: ResearchItem[];
    note: string;
  }>;
  note?: string;
}> {
  const queryFn = deps.queryFn ?? queryMemories;
  const topic = typeof opts.topic === "string" && opts.topic.trim() !== "" ? opts.topic.trim() : null;

  const rows = await queryFn({ kind: "research", topic, limit: 30 });
  if (!rows || rows.length === 0) {
    return { count: 0, results: [], note: "no research yet" };
  }

  // Rows are newest-first — keep the FIRST (latest) row seen per topic.
  const seen = new Set<string>();
  const results: Array<{
    topic: string | null;
    platform: ResearchPlatform | null;
    status: string;
    headline?: string;
    summary?: string;
    items?: ResearchItem[];
    note: string;
  }> = [];

  for (const r of rows) {
    const key = r.topic ?? `__null__:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(r.content) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const status = typeof parsed.status === "string" ? parsed.status : "unknown";
    const platform =
      parsed.platform === "reddit" || parsed.platform === "instagram"
        ? (parsed.platform as ResearchPlatform)
        : null;

    let note: string;
    if (status === "running") {
      note = "Still scraping — check back in a minute.";
    } else if (status === "completed") {
      note = "Research ready. NON-strategy research only — never a strategy source.";
    } else if (status === "failed") {
      note = `Scan did not complete (${typeof parsed.reason === "string" ? parsed.reason : "unknown"}). Try again.`;
    } else {
      note = "Unknown research state.";
    }

    results.push({
      topic: r.topic ?? (typeof parsed.topic === "string" ? parsed.topic : null),
      platform,
      status,
      ...(typeof parsed.headline === "string" ? { headline: parsed.headline } : {}),
      ...(typeof parsed.summary === "string" ? { summary: parsed.summary } : {}),
      ...(Array.isArray(parsed.items) ? { items: (parsed.items as ResearchItem[]).slice(0, SUMMARY_ITEM_CAP) } : {}),
      note,
    });

    if (results.length >= 10) break; // bounded for voice
  }

  return { count: results.length, results };
}

// ════════════════════════════════════════════════════════════════════════════
// Carter voice-agent handlers (spread into the canonical maps)
// ════════════════════════════════════════════════════════════════════════════

/** research_reddit (GREEN action) — fire an async Reddit scrape. */
async function researchRedditHandler(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as { topic?: string };
  if (!p.topic || typeof p.topic !== "string") {
    return { error: "topic is required" };
  }
  return startAndStoreResearch({ platform: "reddit", topic: p.topic });
}

/** research_instagram (GREEN action) — fire an async Instagram scrape. */
async function researchInstagramHandler(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as { topic?: string; searchType?: string };
  if (!p.topic || typeof p.topic !== "string") {
    return { error: "topic is required" };
  }
  const searchType: InstagramSearchType = p.searchType === "user" ? "user" : "hashtag";
  return startAndStoreResearch({ platform: "instagram", topic: p.topic, searchType });
}

/** get_research_result (GREEN read) — pull the latest stored research per topic. */
async function getResearchResultHandler(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as { topic?: string };
  const topic = typeof p.topic === "string" ? p.topic : undefined;
  return getLatestResearch({ topic });
}

/** Spread into CARTER_ACTION_HANDLERS (carter-actions.ts). */
export const CARTER_APIFY_RESEARCH_ACTION_HANDLERS: Record<string, (params: unknown) => Promise<unknown>> = {
  research_reddit: researchRedditHandler,
  research_instagram: researchInstagramHandler,
};

/** Spread into CARTER_READ_HANDLERS (carter-reads.ts). */
export const CARTER_APIFY_RESEARCH_READ_HANDLERS: Record<string, (params: unknown) => Promise<unknown>> = {
  get_research_result: getResearchResultHandler,
};
