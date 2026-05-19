/**
 * V3 — properly test the full 250-video sample.
 *   - Fetch contentDetails.duration (filter out Shorts upfront)
 *   - Try ALL videos with duration >= 3 min (not just top 10)
 *   - Report transcript availability rate across full sample
 *   - Quote actual strategy rules from successful transcripts
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
  "9 21 EMA pullback futures strategy rules",
  "RSI 14 oversold reversal futures rules",
];

// Reuse W23F.S scorer
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
  let s = 0;
  if (POSITIVE_TITLE.test(t)) s += 2;
  if (NUMERIC_PATTERNS.some(re => re.test(t))) s += 3;
  if (INDICATOR_NAME_TITLE.test(t)) s += 3;
  if (NEGATIVE_TITLE.test(t)) s = Math.min(s - 5, -2);
  if (CLICKBAIT_TITLE.test(t)) s = Math.min(s - 5, -2);
  return s;
}

// Parse ISO 8601 duration like "PT4M13S" → seconds
function parseDuration(iso) {
  const m = iso?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || "0") * 3600) + (parseInt(m[2] || "0") * 60) + parseInt(m[3] || "0");
}

console.log(`\n══ V3: ${QUERIES.length} queries × 50 = ${QUERIES.length * 50} max videos ══\n`);

// Step 1: Search
const all = new Map();
for (const q of QUERIES) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=50&order=relevance&key=${YT_KEY}`);
  const j = await r.json();
  for (const v of j.items || []) {
    if (all.has(v.id.videoId)) continue;
    all.set(v.id.videoId, { id: v.id.videoId, title: v.snippet.title.replace(/&#39;/g,"'").replace(/&amp;/g,"&"), channel: v.snippet.channelTitle });
  }
}
console.log(`Unique videos: ${all.size}`);

// Step 2: Get durations (batch up to 50 IDs per call to videos.list)
console.log(`\nFetching durations for ${all.size}...`);
const ids = [...all.keys()];
for (let i = 0; i < ids.length; i += 50) {
  const batch = ids.slice(i, i + 50);
  const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${batch.join(",")}&key=${YT_KEY}`);
  const j = await r.json();
  for (const v of j.items || []) {
    const meta = all.get(v.id);
    if (meta) meta.durationSec = parseDuration(v.contentDetails?.duration);
  }
}

// Step 3: Filter
const scored = [];
let shorts = 0, lowScore = 0;
for (const v of all.values()) {
  v.score = scoreTitle(v.title);
  if ((v.durationSec || 0) < 180) { shorts++; continue; }    // <3 min = Short/teaser
  if (v.score < 3) { lowScore++; continue; }                  // require indicator OR numeric+positive
  scored.push(v);
}
scored.sort((a,b) => b.score - a.score);

console.log(`Filtered: ${shorts} Shorts/<3min + ${lowScore} score<3 = ${scored.length} eligible for transcript test`);
console.log(`\nTop 20 eligible:`);
for (const v of scored.slice(0,20)) console.log(`  +${v.score} | ${Math.round((v.durationSec||0)/60)}min | ${v.title.slice(0,72)}`);

// Step 4: Try EVERY eligible video
console.log(`\n══ Testing ALL ${scored.length} eligible videos ══\n`);
let transcriptOk = 0, transcriptDisabled = 0, transcriptTooShort = 0, transcriptErr = 0;
let extractSuccess = 0, extractEmpty = 0, extractErr = 0;
const successes = [];
const transcriptSamples = [];

for (let i = 0; i < scored.length; i++) {
  const v = scored[i];
  const tag = `[${i+1}/${scored.length}]`;
  try {
    const segs = await YoutubeTranscript.fetchTranscript(v.id, { lang: "en" }).catch(() => YoutubeTranscript.fetchTranscript(v.id));
    const transcript = segs.map(s => s.text).join(" ").slice(0, 12000);
    if (transcript.length < 500) { transcriptTooShort++; console.log(`${tag} ✗ short (${transcript.length}) | ${v.title.slice(0,55)}`); continue; }
    transcriptOk++;

    // Save first 3 transcripts as samples
    if (transcriptSamples.length < 3) transcriptSamples.push({ id: v.id, title: v.title, sample: transcript.slice(0, 600) });

    // Extract
    const r = await fetch(`${API}/api/agent/scout-extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: transcript, sourceProvider: "exa", sourceUrl: `https://youtube.com/watch?v=${v.id}`, title: v.title }),
      signal: AbortSignal.timeout(90_000),
    });
    const ext = await r.json();
    if (ext?.extracted && ext.ideas?.length) {
      extractSuccess++;
      const idea = ext.ideas[0];
      console.log(`${tag} ✅ extracted: ${idea.entry_indicator} | ${v.title.slice(0,50)}`);
      successes.push({ ...v, indicator: idea.entry_indicator, params: idea.entry_params, concept: idea.concept_name, sample: transcript.slice(0, 300) });
    } else {
      extractEmpty++;
      console.log(`${tag} ⚠️  empty (${ext?.reason}) | ${v.title.slice(0,50)}`);
    }
  } catch (e) {
    const m = (e.message || String(e)).slice(0, 60);
    if (m.includes("disabled")) { transcriptDisabled++; console.log(`${tag} ✗ disabled | ${v.title.slice(0,55)}`); }
    else { transcriptErr++; console.log(`${tag} ✗ err: ${m} | ${v.title.slice(0,40)}`); }
  }
}

console.log(`\n══ SUMMARY ══`);
console.log(`Discovery layer:`);
console.log(`  Total sampled : ${all.size}`);
console.log(`  Shorts/<3min  : ${shorts}`);
console.log(`  Score < 3     : ${lowScore}`);
console.log(`  Eligible      : ${scored.length}`);
console.log(`\nTranscript layer (${scored.length} eligible):`);
console.log(`  Available 500+: ${transcriptOk}  (${(transcriptOk/scored.length*100).toFixed(0)}%)`);
console.log(`  Disabled      : ${transcriptDisabled}  (${(transcriptDisabled/scored.length*100).toFixed(0)}%)`);
console.log(`  Too short     : ${transcriptTooShort}`);
console.log(`  Other err     : ${transcriptErr}`);
console.log(`\nExtraction layer (${transcriptOk} viable transcripts):`);
console.log(`  Success       : ${extractSuccess}  (${transcriptOk ? (extractSuccess/transcriptOk*100).toFixed(0) : 0}%)`);
console.log(`  Empty         : ${extractEmpty}`);
console.log(`  Error         : ${extractErr}`);

console.log(`\n══ SUCCESSFUL STRATEGIES (rules I read from transcript) ══`);
for (const s of successes) {
  console.log(`\n──── ${s.title} ────`);
  console.log(`indicator: ${s.indicator} | params: ${JSON.stringify(s.params)}`);
  console.log(`first 300 chars of transcript: "${s.sample}"`);
}
