/**
 * Real factory test against operator's screenshot videos.
 * Uses operator's 2nd YouTube API key (fresh quota).
 * Tests live factory with all 4 W23H postmortem fix waves loaded.
 */
import { YoutubeTranscript } from "youtube-transcript";
import { writeFileSync } from "node:fs";

const YT_KEY = "AIzaSyCH3oGu_Pe31UZEorYkpzf8HW-WmWw0E6k"; // operator's 2nd key
const API = "http://127.0.0.1:4000";

// The 8 operator-curated queries from W23F.V
const QUERIES = [
  "futures trading strategies rules",
  "futures 4 hr strategy",
  "futures 15min strategy",
  "futures 5min strategy",
  "futures 1hr strategy",
  "futures indicators",
  "futures trading A+ setups",
  "futures trend trading strategy",
];

async function ytSearch(q, order = "relevance") {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}` +
    `&type=video&videoDuration=medium&relevanceLanguage=en&maxResults=10&order=${order}&key=${YT_KEY}`;
  const r = await fetch(url);
  if (!r.ok) {
    const e = await r.json();
    console.log(`  API error for "${q}":`, e.error?.message?.slice(0, 100));
    return [];
  }
  const j = await r.json();
  return (j.items || []).map(v => ({
    id: v.id.videoId,
    title: v.snippet.title.replace(/&#39;/g, "'").replace(/&amp;/g, "&"),
    channel: v.snippet.channelTitle,
    description: (v.snippet.description || "").slice(0, 300),
    query: q,
  }));
}

async function getTranscript(videoId) {
  try {
    const segs = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" })
      .catch(() => YoutubeTranscript.fetchTranscript(videoId));
    return segs.map(s => s.text).join(" ");
  } catch {
    return null;
  }
}

console.log("=".repeat(80));
console.log("OPERATOR-VIDEO FACTORY TEST — 8 operator queries × fresh YT key");
console.log("Wave 23H + 4 postmortem fix waves LIVE in API");
console.log("=".repeat(80));

// Step 1: discover via 8 keywords (just 1 order each — economy mode = 8 calls = 800 quota units)
console.log("\nSTEP 1 — Discovery (1 order × 8 keywords = 800 quota units)");
const allVideos = new Map();
for (const q of QUERIES) {
  const hits = await ytSearch(q, "relevance");
  let added = 0;
  for (const v of hits) {
    if (allVideos.has(v.id)) continue;
    allVideos.set(v.id, v);
    added++;
  }
  console.log(`  "${q}" → ${hits.length} returned, ${added} new`);
}
console.log(`Total unique: ${allVideos.size}`);

// Step 2: title scoring (mirror W23F.X soft logic) — pick top 15
const POSITIVE = /(how to|step by step|the rules|tutorial|setup|strategy guide|backtested|exact rules|entry and exit|playbook|breaking down|explained|template|blueprint|profitable|proven)/i;
const NEGATIVE = /(why .* lose|why .* fail|don.t work|doesn.t work|warning|exposed|scam|truth about|reaction|podcast|interview|q.a|news|recap|vlog|motivation|mindset|story time)/i;
const CLICKBAIT = /\b(make \$|made \$|earn(?:ed)? \$|\$\d+ ?(?:a|per) ?day|profit \$|easy money|prints? money|secret strategy|get rich|millionaire|life.changing|magic indicator|holy grail)\b/i;
const INDICATOR = /\b(ema|sma|rsi|macd|atr|bollinger|vwap|cvd|order flow|volume profile|opening range|liquidity|order block|fvg|fair value gap|smt|smc|ict|wyckoff|spring|breaker|silver bullet|judas|fibonacci|supply.demand|crt|power of (?:3|three)|4h|4 hr|15m|15 min|5m|5 min|1h|1hr)\b/i;
function score(t) {
  let s = 0;
  if (POSITIVE.test(t)) s += 2;
  if (INDICATOR.test(t)) s += 3;
  if (NEGATIVE.test(t)) s = Math.min(s - 5, -2);
  if (CLICKBAIT.test(t)) s -= INDICATOR.test(t) ? 1 : 3;
  return s;
}
const scored = Array.from(allVideos.values()).map(v => ({ ...v, score: score(v.title) }));
scored.sort((a, b) => b.score - a.score);
const top = scored.slice(0, 15);
console.log(`\nSTEP 2 — Top 15 by title score:`);
top.forEach((v, i) => console.log(`  [${i + 1}] +${v.score} ${v.title.slice(0, 65)} (${v.channel})`));

// Step 3: fetch transcripts
console.log(`\nSTEP 3 — Fetching transcripts (top 15)...`);
const withTranscripts = [];
for (let i = 0; i < top.length; i++) {
  const v = top[i];
  process.stdout.write(`  [${i + 1}/${top.length}] ${v.id} ${v.title.slice(0, 50)}... `);
  const t = await getTranscript(v.id);
  if (!t || t.length < 500) {
    console.log(`✗ ${t?.length ?? 0} chars`);
    continue;
  }
  withTranscripts.push({ ...v, transcript: t });
  console.log(`✓ ${t.length} chars`);
}

// Step 4: extract via live factory
console.log(`\nSTEP 4 — Extract via /api/agent/scout-extract (${withTranscripts.length} candidates)...`);
const results = [];
for (let i = 0; i < withTranscripts.length; i++) {
  const v = withTranscripts[i];
  process.stdout.write(`  [${i + 1}] ${v.title.slice(0, 55)}... `);
  try {
    const resp = await fetch(`${API}/api/agent/scout-extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: v.transcript,
        sourceProvider: "tavily",
        sourceUrl: `https://youtube.com/watch?v=${v.id}`,
        title: v.title,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const j = await resp.json();
    if (j.extracted && j.ideas?.length) {
      const ind = j.ideas[0].entry_indicator;
      const dir = j.ideas[0].direction;
      console.log(`✓ EXTRACTED ${j.ideas.length} ideas | ${ind} | dir=${dir}`);
      results.push({ ...v, extracted: true, idea_count: j.ideas.length, ideas: j.ideas });
    } else {
      console.log(`✗ ${j.reason || "empty"}`);
      results.push({ ...v, extracted: false, reason: j.reason });
    }
  } catch (e) {
    console.log(`✗ ERROR ${e.message?.slice(0, 50)}`);
    results.push({ ...v, extracted: false, reason: "exception" });
  }
}

// Summary
console.log("\n" + "=".repeat(80));
console.log("SUMMARY");
console.log("=".repeat(80));
const extracted = results.filter(r => r.extracted);
console.log(`  Videos discovered:       ${allVideos.size}`);
console.log(`  Top-scored:              ${top.length}`);
console.log(`  Transcripts fetched:     ${withTranscripts.length}`);
console.log(`  Extracted to DSL:        ${extracted.length}/${withTranscripts.length}`);

console.log("\nExtracted indicator distribution:");
const indCount = new Map();
extracted.forEach(r => r.ideas.forEach(i => {
  indCount.set(i.entry_indicator, (indCount.get(i.entry_indicator) || 0) + 1);
}));
[...indCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${k.padEnd(35)} ${n}`));

console.log("\nReject reasons:");
const rejCount = new Map();
results.filter(r => !r.extracted).forEach(r => {
  rejCount.set(r.reason || "?", (rejCount.get(r.reason || "?") || 0) + 1);
});
[...rejCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${k.padEnd(35)} ${n}`));

writeFileSync("tmp-factory-audit/operator-videos-test-results.json", JSON.stringify(results, null, 2));
console.log(`\n✓ Results: tmp-factory-audit/operator-videos-test-results.json`);
console.log(`✓ Quota used (est): ~800 units (8 search calls)`);
