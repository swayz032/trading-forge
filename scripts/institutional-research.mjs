#!/usr/bin/env node
/**
 * Institutional Edge Research — unified web/YouTube/Reddit research API.
 *
 * The `institutional-edge-researcher` subagent invokes this script to
 * gather FRESH 2025-2026 evidence on institutional trading desk practices.
 * Hard rule: all returned items must include publication date AND source
 * URL. The agent filters for ≥2025; this script reports dates as-is and
 * marks items missing a date as `published_at: null`.
 *
 * Reuses API keys from .env (do not hardcode):
 *   BRAVE_SEARCH_API_KEY    — Brave web search
 *   EXA_API_KEY             — Exa neural search + /contents extraction
 *   TAVILY_API_KEY          — Tavily (alt deep-research)
 *   PARALLEL_API_KEY        — Parallel.ai deep-research tasks
 *   YOUTUBE_DATA_API_KEY    — YouTube Data API v3
 *
 * Subcommands:
 *   search   <query> [--source brave|exa|tavily] [--since YYYY-MM-DD] [--limit N]
 *   youtube  <query> [--since YYYY-MM-DD] [--limit N]            (search videos)
 *   transcript <videoId|url>                                     (fetch transcript via npm)
 *   reddit   <subreddit> <query> [--limit N]                     (free JSON API)
 *   contents <url>                                               (Exa /contents extract)
 *   research <query> [--depth shallow|deep] [--since YYYY-MM-DD] (multi-source)
 *
 * Output: JSON to stdout with shape:
 *   { source, query, items: [{ title, url, snippet, published_at, score }], cited_at }
 *
 * Stderr is for human-readable progress logs. Stdout is parseable JSON only.
 *
 * Usage examples:
 *   node scripts/institutional-research.mjs search "deflated sharpe 2026 quant fund" --since 2025-01-01
 *   node scripts/institutional-research.mjs youtube "lopez de prado overfitting 2026" --limit 5
 *   node scripts/institutional-research.mjs transcript dQw4w9WgXcQ
 *   node scripts/institutional-research.mjs reddit algotrading "kill switch institutional latency"
 *   node scripts/institutional-research.mjs research "walk forward methodology institutional" --depth deep
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ─── env loader ──────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, ".env");
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs.readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
}

const env = loadEnv();
const BRAVE_KEY = env.BRAVE_SEARCH_API_KEY;
const EXA_KEY = env.EXA_API_KEY;
const TAVILY_KEY = env.TAVILY_API_KEY;
const PARALLEL_KEY = env.PARALLEL_API_KEY;
const YT_KEY = env.YOUTUBE_DATA_API_KEY;

const log = (...args) => console.error("[research]", ...args);
const out = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");

// ─── date utilities ──────────────────────────────────────────────
function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function isAfter(iso, sinceIso) {
  if (!iso || !sinceIso) return true; // keep items missing a date; caller filters
  return new Date(iso) >= new Date(sinceIso);
}

// ─── Brave Search ────────────────────────────────────────────────
async function braveSearch(query, { since, limit = 10 } = {}) {
  if (!BRAVE_KEY) throw new Error("BRAVE_SEARCH_API_KEY not set");
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(limit, 20)));
  if (since) {
    const days = Math.max(1, Math.ceil((Date.now() - new Date(since).getTime()) / 86_400_000));
    url.searchParams.set("freshness", days <= 7 ? "pw" : days <= 31 ? "pm" : "py");
  }
  const res = await fetch(url, { headers: { "X-Subscription-Token": BRAVE_KEY, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Brave ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const items = (j.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description ?? "",
    published_at: parseDate(r.page_age ?? r.age),
    score: null,
  }));
  return items.filter((i) => isAfter(i.published_at, since));
}

// ─── Exa Search + Contents ───────────────────────────────────────
async function exaSearch(query, { since, limit = 10 } = {}) {
  if (!EXA_KEY) throw new Error("EXA_API_KEY not set");
  const body = {
    query,
    numResults: Math.min(limit, 25),
    useAutoprompt: true,
    type: "neural",
  };
  if (since) body.startPublishedDate = since;
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": EXA_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Exa ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return (j.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.text?.slice(0, 400) ?? "",
    published_at: parseDate(r.publishedDate),
    score: r.score ?? null,
  }));
}

async function exaContents(url) {
  if (!EXA_KEY) throw new Error("EXA_API_KEY not set");
  const res = await fetch("https://api.exa.ai/contents", {
    method: "POST",
    headers: { "x-api-key": EXA_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ urls: [url], text: { maxCharacters: 8000 } }),
  });
  if (!res.ok) throw new Error(`Exa /contents ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const r = j.results?.[0];
  if (!r) return null;
  return { title: r.title, url: r.url, text: r.text, published_at: parseDate(r.publishedDate) };
}

// ─── Tavily Search ───────────────────────────────────────────────
async function tavilySearch(query, { since, limit = 10 } = {}) {
  if (!TAVILY_KEY) throw new Error("TAVILY_API_KEY not set");
  const body = {
    api_key: TAVILY_KEY,
    query,
    max_results: Math.min(limit, 20),
    search_depth: "advanced",
    include_answer: false,
  };
  if (since) {
    const days = Math.ceil((Date.now() - new Date(since).getTime()) / 86_400_000);
    body.days = Math.max(1, days);
  }
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return (j.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content?.slice(0, 400) ?? "",
    published_at: parseDate(r.published_date),
    score: r.score ?? null,
  }));
}

// ─── YouTube Data API v3 ─────────────────────────────────────────
async function youtubeSearch(query, { since, limit = 10 } = {}) {
  if (!YT_KEY) throw new Error("YOUTUBE_DATA_API_KEY not set");
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", String(Math.min(limit, 25)));
  url.searchParams.set("order", "relevance");
  if (since) url.searchParams.set("publishedAfter", new Date(since).toISOString());
  url.searchParams.set("key", YT_KEY);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return (j.items ?? []).map((i) => ({
    title: i.snippet?.title ?? "",
    url: `https://www.youtube.com/watch?v=${i.id?.videoId}`,
    snippet: i.snippet?.description ?? "",
    published_at: parseDate(i.snippet?.publishedAt),
    channel: i.snippet?.channelTitle ?? null,
    video_id: i.id?.videoId ?? null,
    score: null,
  }));
}

// ─── YouTube transcript (via npm package) ────────────────────────
async function youtubeTranscript(videoIdOrUrl) {
  const id = videoIdOrUrl.includes("watch?v=")
    ? new URL(videoIdOrUrl).searchParams.get("v")
    : videoIdOrUrl.includes("youtu.be/")
      ? videoIdOrUrl.split("youtu.be/")[1].split(/[?&#]/)[0]
      : videoIdOrUrl;
  let mod;
  try { mod = await import("youtube-transcript"); }
  catch (e) {
    throw new Error(
      "youtube-transcript not installed. Run: cd " + PROJECT_ROOT + " && npm i youtube-transcript",
    );
  }
  const YoutubeTranscript = mod.YoutubeTranscript ?? mod.default?.YoutubeTranscript ?? mod.default;
  if (!YoutubeTranscript?.fetchTranscript) throw new Error("youtube-transcript export shape unexpected");
  const segs = await YoutubeTranscript.fetchTranscript(id);
  return {
    video_id: id,
    url: `https://www.youtube.com/watch?v=${id}`,
    segments: segs,
    text: segs.map((s) => s.text).join(" "),
  };
}

// ─── Reddit (free JSON API, no auth) ─────────────────────────────
async function redditSearch(subreddit, query, { limit = 10 } = {}) {
  const url = new URL(`https://www.reddit.com/r/${subreddit}/search.json`);
  url.searchParams.set("q", query);
  url.searchParams.set("restrict_sr", "1");
  url.searchParams.set("sort", "relevance");  // pinned-fact per CLAUDE.md §2b
  url.searchParams.set("t", "all");
  url.searchParams.set("limit", String(Math.min(limit, 25)));
  const res = await fetch(url, { headers: { "User-Agent": "trading-forge-research/1.0" } });
  if (!res.ok) throw new Error(`Reddit ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return (j.data?.children ?? []).map((c) => ({
    title: c.data?.title ?? "",
    url: `https://www.reddit.com${c.data?.permalink ?? ""}`,
    snippet: (c.data?.selftext ?? "").slice(0, 400),
    published_at: c.data?.created_utc ? new Date(c.data.created_utc * 1000).toISOString() : null,
    subreddit: c.data?.subreddit,
    score: c.data?.score ?? null,
    num_comments: c.data?.num_comments ?? null,
  }));
}

// ─── Aggregated multi-source research ────────────────────────────
async function multiResearch(query, { since, depth = "shallow", limit = 10 } = {}) {
  const tasks = [];
  if (BRAVE_KEY) tasks.push(braveSearch(query, { since, limit }).then((r) => ({ source: "brave", items: r })).catch((e) => ({ source: "brave", error: String(e) })));
  if (EXA_KEY) tasks.push(exaSearch(query, { since, limit }).then((r) => ({ source: "exa", items: r })).catch((e) => ({ source: "exa", error: String(e) })));
  if (depth === "deep" && TAVILY_KEY) tasks.push(tavilySearch(query, { since, limit }).then((r) => ({ source: "tavily", items: r })).catch((e) => ({ source: "tavily", error: String(e) })));
  if (YT_KEY) tasks.push(youtubeSearch(query, { since, limit: Math.min(limit, 5) }).then((r) => ({ source: "youtube", items: r })).catch((e) => ({ source: "youtube", error: String(e) })));
  const results = await Promise.all(tasks);
  return {
    query,
    since: since ?? null,
    depth,
    sources: results,
    cited_at: new Date().toISOString(),
  };
}

// ─── CLI ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[k] = v;
    } else args._.push(a);
  }
  return args;
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);
  const since = args.since ?? null;
  const limit = args.limit ? parseInt(args.limit, 10) : 10;

  try {
    if (cmd === "search") {
      const query = args._[0];
      if (!query) throw new Error("search requires <query>");
      const source = args.source ?? "exa";
      const fn = { brave: braveSearch, exa: exaSearch, tavily: tavilySearch }[source];
      if (!fn) throw new Error(`unknown --source ${source}`);
      const items = await fn(query, { since, limit });
      out({ source, query, since, items, cited_at: new Date().toISOString() });
    } else if (cmd === "youtube") {
      const query = args._[0];
      if (!query) throw new Error("youtube requires <query>");
      const items = await youtubeSearch(query, { since, limit });
      out({ source: "youtube", query, since, items, cited_at: new Date().toISOString() });
    } else if (cmd === "transcript") {
      const id = args._[0];
      if (!id) throw new Error("transcript requires <videoId|url>");
      const result = await youtubeTranscript(id);
      out({ source: "youtube-transcript", ...result, cited_at: new Date().toISOString() });
    } else if (cmd === "reddit") {
      const [subreddit, query] = args._;
      if (!subreddit || !query) throw new Error("reddit requires <subreddit> <query>");
      const items = await redditSearch(subreddit, query, { limit });
      out({ source: "reddit", subreddit, query, items, cited_at: new Date().toISOString() });
    } else if (cmd === "contents") {
      const url = args._[0];
      if (!url) throw new Error("contents requires <url>");
      const result = await exaContents(url);
      out({ source: "exa-contents", url, result, cited_at: new Date().toISOString() });
    } else if (cmd === "research") {
      const query = args._[0];
      if (!query) throw new Error("research requires <query>");
      const result = await multiResearch(query, { since, depth: args.depth ?? "shallow", limit });
      out(result);
    } else {
      console.error(`Usage:
  node scripts/institutional-research.mjs <command> [args] [flags]

Commands:
  search   <query>            [--source brave|exa|tavily] [--since YYYY-MM-DD] [--limit N]
  youtube  <query>            [--since YYYY-MM-DD] [--limit N]
  transcript <videoId|url>
  reddit   <subreddit> <query> [--limit N]
  contents <url>
  research <query>            [--depth shallow|deep] [--since YYYY-MM-DD] [--limit N]

API keys required (all from .env):
  BRAVE_SEARCH_API_KEY, EXA_API_KEY, TAVILY_API_KEY, YOUTUBE_DATA_API_KEY

Hard rule: institutional-edge-researcher agent should pass --since 2025-01-01
to enforce freshness. Items without publication date are kept; agent filters
in post-processing.`);
      process.exit(2);
    }
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
}

main();
