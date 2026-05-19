/**
 * Source URL Verifier — Pass 19 Track E
 *
 * Cross-validation integrity gate. Every source_url submitted to
 * /scout-ideas/pending must be PROVEN real before it counts toward a
 * pending bucket's source_count. Otherwise a malicious/buggy scout (or
 * a hallucinating LLM extractor) could fabricate URLs and falsely
 * graduate strategies.
 *
 * Two checks performed:
 *   1. HEAD reachability — URL must return 2xx (or 3xx that resolves to 2xx).
 *      Stops 404s and DNS failures from counting.
 *   2. Substance match — fetched page body must contain at least one
 *      keyword from the strategy's market/concept/entry_archetype. Stops
 *      real URLs that don't actually discuss the claimed setup.
 *
 * Failure modes:
 *   - HEAD timeout (5s) → 'unreachable'
 *   - HEAD non-2xx → 'http_error'
 *   - GET body too small (< 200 chars) → 'thin_content'
 *   - No keyword match → 'off_topic'
 *
 * The route writes audit_log rows for every rejection. Buckets never
 * see unverified mentions.
 */

import { logger } from "../index.js";

export interface VerifyArgs {
  sourceUrl: string;
  market?: string;
  conceptName?: string;
  entryArchetype?: string;
  thesis?: string;
}

export interface VerifyResult {
  verified: boolean;
  reason?: "unreachable" | "http_error" | "thin_content" | "off_topic" | "verifier_disabled";
  detail?: string;
  fetchedBytes?: number;
}

const HEAD_TIMEOUT_MS = 5_000;
const GET_TIMEOUT_MS = 8_000;
const MIN_BODY_LEN = 200;

/**
 * Build the substance keyword set from the strategy's claimed attributes.
 * The page body must contain ≥1 of these (case-insensitive) to pass.
 */
function buildKeywordSet(args: VerifyArgs): Set<string> {
  const kw = new Set<string>();
  const add = (s: string | undefined) => {
    if (!s) return;
    for (const tok of String(s).toLowerCase().split(/[\s_\-/.,;:!?()]+/)) {
      if (tok.length >= 3) kw.add(tok);
    }
  };
  add(args.market);
  add(args.conceptName);
  add(args.entryArchetype);
  add(args.thesis);
  // Always require a futures-market keyword presence
  kw.add("futures");
  kw.add("trading");
  return kw;
}

/**
 * Verify a source URL is real and matches the strategy thesis.
 * Returns {verified: true} on pass, or {verified: false, reason, detail}.
 *
 * Set SOURCE_VERIFIER_DISABLED=true to bypass (for tests / local-only mode).
 * In production this MUST be enabled.
 */
export async function verifySourceUrl(args: VerifyArgs): Promise<VerifyResult> {
  if (process.env.SOURCE_VERIFIER_DISABLED === "true") {
    return { verified: false, reason: "verifier_disabled", detail: "SOURCE_VERIFIER_DISABLED env flag set — bypass for tests only" };
  }

  // Reject obviously-test URLs early. These domains + path patterns are
  // commonly used in test fixtures and should never count in production.
  const lower = args.sourceUrl.toLowerCase();
  if (lower.includes("example.com") || lower.endsWith("/test") || lower.includes("/smoke-test") || lower.includes("-test-v") || lower.includes("/orb-breakout-mes-smoke") || /\b(test|fake|dummy|fixture)\b/.test(lower)) {
    return { verified: false, reason: "off_topic", detail: "url matches test/fixture pattern" };
  }

  // Step 1: HEAD reachability
  let headStatus = 0;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HEAD_TIMEOUT_MS);
    const res = await fetch(args.sourceUrl, { method: "HEAD", redirect: "follow", signal: ctrl.signal });
    clearTimeout(timer);
    headStatus = res.status;
    if (!res.ok) {
      return { verified: false, reason: "http_error", detail: `HEAD returned ${headStatus}` };
    }
  } catch (err: any) {
    return { verified: false, reason: "unreachable", detail: err?.message ?? String(err) };
  }

  // Step 2: GET body and substance match
  // Pass 21: Reddit blocks generic UAs and returns a tiny anti-bot page. For
  // reddit.com URLs we transparently fetch the .json endpoint (free, no auth)
  // which returns the full post body. Same content, no anti-bot.
  let fetchUrl = args.sourceUrl;
  let isRedditJson = false;
  try {
    const u = new URL(args.sourceUrl);
    if (/(^|\.)reddit\.com$/i.test(u.hostname) && /\/comments\//.test(u.pathname) && !u.pathname.endsWith(".json")) {
      fetchUrl = args.sourceUrl.replace(/\/?$/, ".json");
      isRedditJson = true;
    }
  } catch { /* ignore URL parse failure; fall through with original URL */ }

  let body = "";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GET_TIMEOUT_MS);
    const res = await fetch(fetchUrl, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        // Mozilla-style UA — reddit and many CDNs block the bare "TradingForge/..." UA.
        "user-agent": "Mozilla/5.0 (compatible; TradingForge-Scout/1.0; +https://example.com)",
        "accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { verified: false, reason: "http_error", detail: `GET returned ${res.status}` };
    }
    const raw = await res.text();
    if (isRedditJson) {
      // Reddit JSON: extract title + selftext + comment bodies as plain text
      try {
        const parsed = JSON.parse(raw);
        const collect: string[] = [];
        const walk = (node: any): void => {
          if (!node || typeof node !== "object") return;
          if (Array.isArray(node)) { node.forEach(walk); return; }
          const data = node.data;
          if (data && typeof data === "object") {
            if (typeof data.title === "string") collect.push(data.title);
            if (typeof data.selftext === "string") collect.push(data.selftext);
            if (typeof data.body === "string") collect.push(data.body);
            if (Array.isArray(data.children)) walk(data.children);
            if (data.replies && typeof data.replies === "object") walk(data.replies);
          }
        };
        walk(parsed);
        body = collect.join(" \n ").toLowerCase().slice(0, 50_000);
      } catch {
        body = raw.toLowerCase().slice(0, 50_000);
      }
    } else {
      body = raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .toLowerCase()
        .slice(0, 50_000);
    }
  } catch (err: any) {
    return { verified: false, reason: "unreachable", detail: err?.message ?? String(err) };
  }

  if (body.length < MIN_BODY_LEN) {
    return { verified: false, reason: "thin_content", detail: `body length ${body.length} < ${MIN_BODY_LEN}`, fetchedBytes: body.length };
  }

  const keywords = buildKeywordSet(args);
  let matchCount = 0;
  for (const kw of keywords) {
    if (body.includes(kw)) matchCount++;
    if (matchCount >= 2) break;
  }
  if (matchCount < 2) {
    return { verified: false, reason: "off_topic", detail: `only ${matchCount} keyword matches; need ≥2`, fetchedBytes: body.length };
  }

  logger.info(
    { sourceUrl: args.sourceUrl, headStatus, bodyLen: body.length, matchCount },
    "source-url-verifier: PASSED",
  );
  return { verified: true, fetchedBytes: body.length };
}
