/**
 * Operator research request: pull REAL algo trader bot routines from
 * Reddit + YouTube using OUR existing scout pipeline (W23G.8 reddit-cross-extract
 * + W23G.4 transcript-fetch-queue patterns).
 *
 * NO LLM extraction — just dump raw transcripts/posts so operator + Claude
 * can read them directly. Same workflow as claude-direct-extraction.mjs.
 */
import { YoutubeTranscript } from "youtube-transcript";
import { writeFileSync } from "node:fs";

const YT_KEY = process.env.YOUTUBE_DATA_API_KEY;
const USER_AGENT = "trading-forge-research/1.0";

const YT_QUERIES = [
  "algo trading bot morning routine multi timeframe",
  "futures trading 4H bias 15M entry routine",
  "automated futures trading pre-market checklist",
  "ICT 4 hour candle range CRT futures 15 minute entry",
  "MES NQ algo bot daily routine confluence",
];

const REDDIT_QUERIES = [
  { sub: "algotrading", q: "morning routine" },
  { sub: "algotrading", q: "pre market checklist bot" },
  { sub: "algotrading", q: "multi timeframe confluence" },
  { sub: "daytrading", q: "morning routine futures multi timeframe" },
  { sub: "daytrading", q: "4 hour bias 15 minute entry" },
  { sub: "FuturesTrading", q: "algo bot routine" },
  { sub: "FuturesTrading", q: "morning routine multi timeframe" },
];

// ─── YouTube ─────────────────────────────────────────────────────────────────
console.log("Step 1: YouTube search (5 queries)");
const ytSeen = new Map();
for (const q of YT_QUERIES) {
  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}` +
      `&type=video&videoDuration=medium&relevanceLanguage=en&maxResults=10&order=relevance&key=${YT_KEY}`
    );
    const j = await r.json();
    let added = 0;
    for (const v of j.items || []) {
      if (ytSeen.has(v.id.videoId)) continue;
      ytSeen.set(v.id.videoId, {
        id: v.id.videoId,
        title: v.snippet.title.replace(/&#39;/g, "'").replace(/&amp;/g, "&"),
        channel: v.snippet.channelTitle,
        description: (v.snippet.description || "").slice(0, 400),
        query: q,
      });
      added++;
    }
    console.log(`  "${q}" → ${(j.items || []).length} returned, ${added} new`);
  } catch (e) {
    console.log(`  "${q}" → ERROR ${e.message?.slice(0, 60)}`);
  }
}
console.log(`Total unique YouTube videos: ${ytSeen.size}`);

const ytTop = Array.from(ytSeen.values()).slice(0, 12);
console.log("\nStep 2: fetch transcripts (top 12)");
const ytTranscripts = [];
for (let i = 0; i < ytTop.length; i++) {
  const v = ytTop[i];
  try {
    const segs = await YoutubeTranscript.fetchTranscript(v.id, { lang: "en" })
      .catch(() => YoutubeTranscript.fetchTranscript(v.id));
    const text = segs.map(s => s.text).join(" ");
    if (text.length < 500) {
      console.log(`  [${i + 1}] ✗ short (${text.length}) | ${v.title.slice(0, 55)}`);
      continue;
    }
    ytTranscripts.push({
      rank: i + 1,
      videoId: v.id,
      title: v.title,
      channel: v.channel,
      description: v.description,
      query: v.query,
      url: `https://youtube.com/watch?v=${v.id}`,
      transcriptLength: text.length,
      transcript: text.slice(0, 10000),
    });
    console.log(`  [${i + 1}] ✓ ${text.length} chars | ${v.title.slice(0, 55)}`);
  } catch (e) {
    console.log(`  [${i + 1}] ✗ ${(e.message || String(e)).slice(0, 60)} | ${v.title.slice(0, 40)}`);
  }
}

// ─── Reddit (mirrors W23G.8 reddit-cross-extract pattern) ───────────────────
console.log("\nStep 3: Reddit search (7 queries across 3 subs)");
const redditPosts = [];
for (const { sub, q } of REDDIT_QUERIES) {
  try {
    const searchUrl = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(q)}` +
      `&restrict_sr=1&sort=relevance&t=all&limit=10`;
    const r = await fetch(searchUrl, { headers: { "User-Agent": USER_AGENT } });
    if (!r.ok) { console.log(`  r/${sub} "${q}" → HTTP ${r.status}`); continue; }
    const j = await r.json();
    const hits = (j.data?.children || []).map(c => c.data);
    const top = hits.filter(p => (p.ups ?? p.score ?? 0) >= 20).slice(0, 3);
    let added = 0;
    for (const post of top) {
      // pull comments
      try {
        const commentUrl = `https://www.reddit.com/r/${sub}/comments/${post.id}.json?limit=10`;
        const cr = await fetch(commentUrl, { headers: { "User-Agent": USER_AGENT } });
        const cj = await cr.json();
        const comments = (cj[1]?.data?.children || [])
          .filter(c => c.kind === "t1")
          .map(c => c.data)
          .sort((a, b) => (b.ups ?? 0) - (a.ups ?? 0))
          .slice(0, 5)
          .map(c => ({ ups: c.ups, body: (c.body || "").slice(0, 800) }));
        redditPosts.push({
          subreddit: sub,
          query: q,
          title: post.title,
          ups: post.ups ?? post.score,
          url: `https://reddit.com${post.permalink}`,
          selftext: (post.selftext || "").slice(0, 2000),
          comments,
        });
        added++;
      } catch (e) {
        console.log(`    comment fetch failed ${post.id}: ${e.message?.slice(0, 40)}`);
      }
      await new Promise(r => setTimeout(r, 600)); // rate limit
    }
    console.log(`  r/${sub} "${q}" → ${hits.length} hits, ${added} captured`);
    await new Promise(r => setTimeout(r, 600));
  } catch (e) {
    console.log(`  r/${sub} "${q}" → ERROR ${e.message?.slice(0, 60)}`);
  }
}
console.log(`Total Reddit posts captured: ${redditPosts.length}`);

// ─── Dump ────────────────────────────────────────────────────────────────────
const out = {
  generatedAt: new Date().toISOString(),
  youtube: { videoCount: ytTranscripts.length, transcripts: ytTranscripts },
  reddit: { postCount: redditPosts.length, posts: redditPosts },
};
writeFileSync("tmp-factory-audit/algo-routine-research.json", JSON.stringify(out, null, 2));
console.log(`\n✅ Dumped ${ytTranscripts.length} YT transcripts + ${redditPosts.length} Reddit posts to tmp-factory-audit/algo-routine-research.json`);
console.log("Claude will now read and synthesize real practitioner routines.");
