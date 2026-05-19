/**
 * reddit-cross-extract.ts — W23G.8 Reddit cross-extract enrichment
 *
 * When YouTube extraction returns no parametric DSL for a high-promise video
 * (title_score >= 5), the runner can fall back to Reddit JSON API and use a
 * top post + top 5 comments as a SECONDARY extraction source. Reddit posts
 * often state explicit rules YouTube creators only show on-screen.
 *
 * Hard constraints (CLAUDE.md §2b "Pinned facts"):
 *   - Reddit JSON API only — Apify / trudax / scraper-lite BANNED
 *   - `sort=relevance&t=all` mandatory (else off-topic popular noise)
 *   - User-Agent header set on every request (Reddit rate-limits anonymous UAs)
 *   - Subreddit whitelist enforced: futurestrading / daytrading / algotrading
 *   - Upvote threshold >= 50 (community signal-quality bar)
 *
 * Returns null when:
 *   - No posts found for concept
 *   - All posts below upvote threshold
 *   - Post outside whitelisted subs
 *   - Reddit HTTP error (429, 5xx, network) — caller treats as "no enrichment available"
 */

export interface RedditEnrichmentResult {
  source: "reddit";
  conceptName: string;
  rawMarkdown: string;    // post body + top-5 comments concatenated as markdown
  upvoteScore: number;
  postUrl: string;
  subreddit: string;
}

export interface RedditEnrichmentOpts {
  minUpvotes?: number;
  allowedSubreddits?: string[];
  fetchFn?: typeof fetch;
}

const DEFAULT_ALLOWED_SUBS = ["futurestrading", "daytrading", "algotrading"];
const DEFAULT_MIN_UPVOTES = 50;
const USER_AGENT = "trading-forge-scout/1.0";

/**
 * Fetch the top Reddit post (+ top 5 comments) for `conceptName` across the
 * whitelisted subreddits. Returns concatenated markdown ready to be fed back
 * into `scout-extract` as a SECONDARY source.
 *
 * Pure helper — no DB, no audit; caller emits audit events.
 */
export async function fetchRedditEnrichment(
  conceptName: string,
  opts?: RedditEnrichmentOpts,
): Promise<RedditEnrichmentResult | null> {
  const minUpvotes = opts?.minUpvotes ?? DEFAULT_MIN_UPVOTES;
  const allowedSubs = (opts?.allowedSubreddits ?? DEFAULT_ALLOWED_SUBS).map((s) => s.toLowerCase());
  const fetchFn = opts?.fetchFn ?? fetch;

  const human = conceptName.replace(/_/g, " ").trim();
  if (!human) return null;
  const q = encodeURIComponent(`${human} futures`);

  // Step 1 — search each whitelisted sub for the concept. Find the highest-upvote
  // post that clears the threshold AND is in a whitelisted sub.
  type Candidate = {
    subreddit: string;
    postId: string;
    upvotes: number;
    title: string;
    selftext: string;
    permalink: string;
  };
  let best: Candidate | null = null;

  for (const sub of allowedSubs) {
    const searchUrl =
      `https://www.reddit.com/r/${sub}/search.json` +
      `?q=${q}&restrict_sr=1&sort=relevance&t=all&limit=10`;
    let searchJson: any;
    try {
      const res = await fetchFn(searchUrl, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) continue; // 429 / 5xx → silently skip this sub
      searchJson = await res.json();
    } catch {
      continue; // network error → skip this sub
    }
    const children: any[] = searchJson?.data?.children ?? [];
    for (const child of children) {
      const d = child?.data ?? {};
      const childSub = String(d.subreddit ?? "").toLowerCase();
      if (!allowedSubs.includes(childSub)) continue; // enforce whitelist on result-side
      const ups = Number(d.ups ?? d.score ?? 0);
      if (!Number.isFinite(ups) || ups < minUpvotes) continue;
      const postId = String(d.id ?? "");
      if (!postId) continue;
      const cand: Candidate = {
        subreddit: childSub,
        postId,
        upvotes: ups,
        title: String(d.title ?? ""),
        selftext: String(d.selftext ?? ""),
        permalink: String(d.permalink ?? `/r/${childSub}/comments/${postId}/`),
      };
      if (!best || cand.upvotes > best.upvotes) best = cand;
    }
  }

  if (!best) return null;

  // Step 2 — fetch the top hit's comments tree
  const commentsUrl =
    `https://www.reddit.com/r/${best.subreddit}/comments/${best.postId}.json?limit=20`;
  let commentJson: any;
  try {
    const res = await fetchFn(commentsUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      // Couldn't fetch comments — return post-only enrichment (still useful).
      return buildResult(best, [], conceptName);
    }
    commentJson = await res.json();
  } catch {
    return buildResult(best, [], conceptName);
  }

  // Reddit comments JSON is [postListing, commentListing]; defensively check.
  const commentChildren: any[] =
    (Array.isArray(commentJson) && commentJson[1]?.data?.children) || [];
  const comments: Array<{ score: number; body: string; author: string }> = [];
  for (const c of commentChildren) {
    const d = c?.data ?? {};
    if (c?.kind !== "t1") continue; // skip "more" placeholders + non-comment kinds
    const score = Number(d.score ?? 0);
    const body = String(d.body ?? "").trim();
    if (!body || body === "[deleted]" || body === "[removed]") continue;
    comments.push({ score, body, author: String(d.author ?? "unknown") });
  }
  comments.sort((a, b) => b.score - a.score);
  const top5 = comments.slice(0, 5);

  return buildResult(best, top5, conceptName);
}

function buildResult(
  best: { subreddit: string; postId: string; upvotes: number; title: string; selftext: string; permalink: string },
  topComments: Array<{ score: number; body: string; author: string }>,
  conceptName: string,
): RedditEnrichmentResult {
  const parts: string[] = [];
  parts.push(`# ${best.title}`);
  parts.push("");
  if (best.selftext.trim().length > 0) {
    parts.push(best.selftext.trim());
    parts.push("");
  }
  if (topComments.length > 0) {
    parts.push("## Comments");
    parts.push("");
    for (const c of topComments) {
      parts.push(`**u/${c.author} (${c.score} points)**`);
      parts.push("");
      parts.push(c.body);
      parts.push("");
    }
  }
  const postUrl = best.permalink.startsWith("http")
    ? best.permalink
    : `https://www.reddit.com${best.permalink}`;

  return {
    source: "reddit",
    conceptName,
    rawMarkdown: parts.join("\n").trim(),
    upvoteScore: best.upvotes,
    postUrl,
    subreddit: best.subreddit,
  };
}
