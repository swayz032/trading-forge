/**
 * Manual YouTube scout test v2 — production-grade.
 *
 * v1 issues:
 *   - Only 15 videos pulled (50 max per search)
 *   - Only 1 search query ("futures trading strategy")
 *   - Local OLD title scorer (no W23F.S clickbait/indicator)
 *   - Only top 5 tested
 *
 * v2 fixes:
 *   - 5 diverse concept queries × 50 results = 250 videos sampled
 *   - W23F.S production scorer (clickbait -5, indicator +3, numeric +3)
 *   - Top 10 by score tested for extraction
 *   - Quota: 5 searches × 100 units = 500 units (5% of 10K daily budget)
 *
 * Pipeline:
 *   1. 5 concept-targeted YouTube searches (50 results each)
 *   2. W23F.S production-grade scoring (clickbait downweight + indicator upweight)
 *   3. Dedup + take top 10 globally
 *   4. Per-video: transcript → extract → web verify → reddit verify
 *   5. Final summary with family distribution + 3-layer cross-validation
 */
import { YoutubeTranscript } from "youtube-transcript";

const YT_KEY = process.env.YOUTUBE_DATA_API_KEY;
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY;
const API = "http://127.0.0.1:4000";

const QUERIES = [
  "ICT order block strategy futures day trading",
  "Wyckoff spring pattern futures entry rules",
  "Bollinger Bands futures mean reversion strategy",
  "MACD divergence futures day trading setup",
  "volume profile POC fade futures strategy",
];

if (!YT_KEY) { console.error("Missing YOUTUBE_DATA_API_KEY"); process.exit(1); }

// ── W23F.S production scorer (mirrors src/server/services/autonomous-scout-runner.ts) ──
const POSITIVE_TITLE = /(how to|step by step|the rules|complete guide|tutorial|setup|strategy guide|backtested|exact rules|entry and exit|playbook|breaking down|explained|template|blueprint|profitable)/i;
const NEGATIVE_TITLE = /(why .* lose|why .* fail|don.t work|doesn.t work|warning|exposed|scam|truth about|reaction|podcast|interview|q.a|news|recap|vlog|motivation|mindset|story time)/i;
const CLICKBAIT_TITLE = /\b(make \$|made \$|earn(?:ed)? \$|\$\d+ ?(?:a|per) ?day|profit \$|easy money|prints? money|secret strategy|secret method|get rich|millionaire|6.figure|7.figure|life.changing|too easy|magic indicator|holy grail)\b/i;
const INDICATOR_NAME_TITLE = /\b(ema|sma|hma|dema|wma|rsi|macd|adx|atr|bollinger|bb |keltner|donchian|stochastic|stoch |vwap|cci|williams|supertrend|ichimoku|cumulative delta|cvd\b|order flow|volume profile|opening range|liquidity sweeps?|order block|fvg|fair value gap|smt |smc |ict |wyckoff|spring|breaker|silver bullet|judas|optimal trade entry|ote |poc |vah |val |displacement|imbalance|mean reversion|chandelier|fibonacci|fib retrace|pivot point)\b/i;
const NUMERIC_PATTERNS = [
  /\b\d{1,3}(?:\s*(?:and|\/|&|,)\s*|\s+)\d{1,3}\s+(?:ema|sma|hma|dema|alma|wma)\b/i,
  /\b(?:ema|sma|hma|dema|alma|wma)\s+\d{1,3}(?:\s*(?:and|\/|&|,)\s*|\s+)\d{1,3}\b/i,
  /\b(?:rsi|stoch|stochastic|cci|williams)[- ]?\d{1,3}\b/i,
  /\b\d{1,3}[- ]?(?:minute|min|m)\s+(?:orb|opening range|breakout|squeeze)\b/i,
  /\b(?:bollinger|keltner|donchian)\s*\d{1,3}\b/i,
];
function scoreTitle(t) {
  let score = 0;
  const pos = POSITIVE_TITLE.test(t);
  const neg = NEGATIVE_TITLE.test(t);
  const num = NUMERIC_PATTERNS.some(re => re.test(t));
  const clickbait = CLICKBAIT_TITLE.test(t);
  const indicator = INDICATOR_NAME_TITLE.test(t);
  if (pos) score += 2;
  if (num) score += 3;
  if (indicator) score += 3;
  if (neg) score = Math.min(score - 5, -2);
  if (clickbait) score = Math.min(score - 5, -2);
  return { score, pos, neg, num, clickbait, indicator };
}

// ── 1. Multi-query search ──
console.log(`\n══ STEP 1: ${QUERIES.length} concept-targeted YouTube searches (50 results each = ${QUERIES.length * 50} max videos) ══\n`);
const allVideos = new Map(); // id → video meta
for (const q of QUERIES) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=50&order=relevance&key=${YT_KEY}`;
  const r = await fetch(url);
  const j = await r.json();
  const found = (j.items || []).length;
  console.log(`  "${q.slice(0,55).padEnd(55)}" → ${found} videos`);
  for (const v of j.items || []) {
    if (allVideos.has(v.id.videoId)) continue;
    allVideos.set(v.id.videoId, {
      id: v.id.videoId,
      title: v.snippet.title.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"'),
      channel: v.snippet.channelTitle,
      query: q,
    });
  }
}
console.log(`Total unique videos: ${allVideos.size}`);

// ── 2. Score ALL videos via W23F.S production scorer ──
console.log(`\n══ STEP 2: W23F.S production scoring on all ${allVideos.size} ══\n`);
const scored = [];
for (const v of allVideos.values()) {
  const s = scoreTitle(v.title);
  scored.push({ ...v, ...s });
}
scored.sort((a, b) => b.score - a.score);
console.log("Score distribution:");
const bucket = {};
for (const v of scored) {
  const b = v.score >= 5 ? "5+" : v.score >= 3 ? "3-4" : v.score >= 0 ? "0-2" : v.score >= -3 ? "-3 to -1" : "-4 or below";
  bucket[b] = (bucket[b] || 0) + 1;
}
for (const [b, n] of Object.entries(bucket)) console.log(`  ${b.padEnd(15)} ${n} videos`);

console.log("\nTop 15 by score:");
for (const v of scored.slice(0, 15)) {
  const flags = `${v.clickbait?'CB':'  '} ${v.indicator?'IND':'   '} ${v.num?'NUM':'   '} ${v.pos?'POS':'   '} ${v.neg?'NEG':'   '}`;
  console.log(`  +${v.score.toString().padStart(2)} | [${flags}] | ${v.title.slice(0, 65)}`);
}

// ── 3. Test top 10 ──
const topN = scored.slice(0, 10);
console.log(`\n══ STEP 3: Extract + verify top 10 (filtering score >= 0) ══\n`);
const results = [];
for (const v of topN) {
  if (v.score < 0) { console.log(`\nSKIP score<0: ${v.title.slice(0,60)}`); continue; }
  console.log(`\n─── [${v.id}] score=+${v.score} | ${v.title.slice(0,65)} ───`);

  // 3a. Transcript
  let transcript = "";
  try {
    const segs = await YoutubeTranscript.fetchTranscript(v.id, { lang: "en" }).catch(async () => YoutubeTranscript.fetchTranscript(v.id));
    transcript = segs.map(s => s.text).join(" ").slice(0, 12000);
    console.log(`  ✓ transcript: ${transcript.length} chars`);
  } catch (e) {
    console.log(`  ✗ transcript: ${(e.message || String(e)).slice(0,80)}`);
    results.push({ ...v, status: "no_transcript" });
    continue;
  }
  if (transcript.length < 500) { console.log(`  ✗ too short (${transcript.length})`); results.push({...v, status:"too_short"}); continue; }

  // 3b. Extract
  let extracted = null;
  try {
    const r = await fetch(`${API}/api/agent/scout-extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: transcript, sourceProvider: "exa", sourceUrl: `https://youtube.com/watch?v=${v.id}`, title: v.title }),
      signal: AbortSignal.timeout(120_000),
    });
    extracted = await r.json();
    if (extracted?.extracted && extracted.ideas?.length) {
      const idea = extracted.ideas[0];
      console.log(`  ✓ EXTRACT: ${idea.concept_name} | ind=${idea.entry_indicator} | params=${JSON.stringify(idea.entry_params)} | dir=${idea.direction} | mkt=${idea.market}`);
    } else {
      console.log(`  ✗ empty: ${extracted?.reason}`);
      results.push({ ...v, status: "empty", reason: extracted?.reason });
      continue;
    }
  } catch (e) {
    console.log(`  ✗ extract err: ${(e.message || String(e)).slice(0,80)}`);
    results.push({ ...v, status: "error" });
    continue;
  }
  const idea = extracted.ideas[0];

  // 3c. Web verify
  let webHits = 0;
  if (BRAVE_KEY && idea.concept_name) {
    try {
      const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(idea.concept_name.replace(/_/g, " ") + " futures strategy")}&count=5`, { headers: { "X-Subscription-Token": BRAVE_KEY, "Accept": "application/json" } });
      if (r.ok) { const j = await r.json(); webHits = j.web?.results?.length ?? 0; }
    } catch {}
  }
  // 3d. Reddit verify
  let redditHits = 0;
  if (idea.concept_name) {
    try {
      const r = await fetch(`https://www.reddit.com/r/Daytrading/search.json?q=${encodeURIComponent(idea.concept_name.replace(/_/g, " "))}&restrict_sr=1&sort=relevance&t=all&limit=10`, { headers: { "User-Agent": "trading-forge-scout/2.0" } });
      if (r.ok) { const j = await r.json(); redditHits = j.data?.children?.length ?? 0; }
    } catch {}
  }
  console.log(`  ✓ web=${webHits} reddit=${redditHits}`);
  results.push({ ...v, status: "success", concept: idea.concept_name, indicator: idea.entry_indicator, params: idea.entry_params, webHits, redditHits });
}

// ── 4. Summary ──
console.log(`\n══ STEP 4: Summary ══`);
const ok = results.filter(r => r.status === "success");
console.log(`Tested: ${results.length} | Success: ${ok.length}/${results.length} (${(ok.length/results.length*100).toFixed(0)}%)`);
console.log("\n3-layer verdicts:");
let confirmed3 = 0, confirmed2 = 0, yt_only = 0;
for (const r of ok) {
  const layers = 1 + (r.webHits >= 1 ? 1 : 0) + (r.redditHits >= 1 ? 1 : 0);
  const v = layers === 3 ? '✅ 3-LAYER' : layers === 2 ? '⚠️  2-LAYER' : '❌ YT-only';
  if (layers === 3) confirmed3++; else if (layers === 2) confirmed2++; else yt_only++;
  console.log(`  ${v} ${r.concept.padEnd(45)} | ${r.indicator.padEnd(20)} | YT✓ web=${r.webHits} reddit=${r.redditHits}`);
}
console.log(`\nFinal: ${confirmed3} 3-layer + ${confirmed2} 2-layer + ${yt_only} YT-only = ${ok.length} would graduate`);
