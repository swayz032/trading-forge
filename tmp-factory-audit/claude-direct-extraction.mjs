/**
 * Same n8n/scout-runner workflow steps 1-4. STOPS before GPT-5 extraction.
 * Dumps transcripts to JSON file — Claude (me) reads them in the next response
 * and extracts strategies manually. We compare to what GPT-5 extracted from the
 * same content to see where GPT-5 is failing.
 */
import { YoutubeTranscript } from "youtube-transcript";
import { writeFileSync } from "node:fs";

const YT_KEY = process.env.YOUTUBE_DATA_API_KEY;
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

// Same scoring as production autonomous-scout-runner.ts (post W23F.X)
const POSITIVE = /(how to|step by step|the rules|complete guide|tutorial|setup|strategy guide|backtested|exact rules|entry and exit|playbook|breaking down|explained|template|blueprint|profitable)/i;
const NEGATIVE = /(why .* lose|why .* fail|don.t work|doesn.t work|warning|exposed|scam|truth about|reaction|podcast|interview|q.a|news|recap|vlog|motivation|mindset|story time)/i;
const CLICKBAIT = /\b(make \$|made \$|earn(?:ed)? \$|\$\d+ ?(?:a|per) ?day|profit \$|easy money|prints? money|secret strategy|secret method|get rich|millionaire|6.figure|7.figure|life.changing|too easy|magic indicator|holy grail)\b/i;
const INDICATOR = /\b(ema|sma|hma|dema|wma|rsi|macd|adx|atr|bollinger|bb |keltner|donchian|stochastic|stoch |vwap|cci|williams|supertrend|ichimoku|cumulative delta|cvd\b|order flow|volume profile|opening range|liquidity sweeps?|order block|fvg|fair value gap|smt |smc |ict |wyckoff|spring|breaker|silver bullet|judas|optimal trade entry|ote |poc |vah |val |displacement|imbalance|mean reversion|chandelier|fibonacci|fib retrace|pivot point|4h|4 hr|4hr|4 hour|15m|15 min|5m|5 min|1h|1hr|1 hour)\b/i;
const NUM = [
  /\b\d{1,3}(?:\s*(?:and|\/|&|,)\s*|\s+)\d{1,3}\s+(?:ema|sma|hma|dema|alma|wma)\b/i,
  /\b(?:ema|sma|hma|dema|alma|wma)\s+\d{1,3}(?:\s*(?:and|\/|&|,)\s*|\s+)\d{1,3}\b/i,
  /\b(?:rsi|stoch|stochastic|cci|williams)[- ]?\d{1,3}\b/i,
  /\b\d{1,3}[- ]?(?:minute|min|m|hour|hr|h)\b/i,
  /\b(?:bollinger|keltner|donchian)\s*\d{1,3}\b/i,
];
function score(t) {
  let s = 0;
  if (POSITIVE.test(t)) s += 2;
  if (NUM.some(re => re.test(t))) s += 3;
  if (INDICATOR.test(t)) s += 3;
  if (NEGATIVE.test(t)) s = Math.min(s - 5, -2);
  if (CLICKBAIT.test(t)) s -= 3;
  return s;
}

console.log("Step 1: search YouTube (8 queries, NO caption filter, just duration+lang)");
const all = new Map();
for (const q of QUERIES) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&videoDuration=medium&relevanceLanguage=en&maxResults=50&order=relevance&key=${YT_KEY}`);
  const j = await r.json();
  let added = 0;
  for (const v of j.items || []) {
    if (all.has(v.id.videoId)) continue;
    all.set(v.id.videoId, {
      id: v.id.videoId,
      title: v.snippet.title.replace(/&#39;/g,"'").replace(/&amp;/g,"&"),
      channel: v.snippet.channelTitle,
      query: q,
    });
    added++;
  }
  console.log(`  "${q}" → ${(j.items||[]).length} returned, ${added} new`);
}
console.log(`Total unique: ${all.size}`);

console.log("\nStep 2+3: score + filter (threshold > -3 = production)");
const eligible = [];
for (const v of all.values()) {
  v.score = score(v.title);
  if (v.score > -3) eligible.push(v);
}
eligible.sort((a, b) => b.score - a.score);
console.log(`Eligible: ${eligible.length}`);

// Take top 20 — manageable for Claude to read
const top = eligible.slice(0, 20);
console.log(`\nStep 4: fetch transcripts for top 20`);
const transcripts = [];
for (let i = 0; i < top.length; i++) {
  const v = top[i];
  try {
    const segs = await YoutubeTranscript.fetchTranscript(v.id, { lang: "en" }).catch(() => YoutubeTranscript.fetchTranscript(v.id));
    const text = segs.map(s => s.text).join(" ");
    if (text.length < 500) { console.log(`  [${i+1}] ✗ short (${text.length}) | ${v.title.slice(0,55)}`); continue; }
    transcripts.push({
      rank: i + 1,
      videoId: v.id,
      title: v.title,
      channel: v.channel,
      sourceQuery: v.query,
      score: v.score,
      url: `https://youtube.com/watch?v=${v.id}`,
      transcriptLength: text.length,
      transcript: text.slice(0, 8000), // first 8K — same as scout-extract's first pass
    });
    console.log(`  [${i+1}] ✓ ${text.length} chars | ${v.title.slice(0,55)}`);
  } catch (e) {
    console.log(`  [${i+1}] ✗ ${(e.message||String(e)).slice(0,60)} | ${v.title.slice(0,40)}`);
  }
}

// Write to JSON so Claude can read in next response
writeFileSync("tmp-factory-audit/claude-transcripts.json", JSON.stringify(transcripts, null, 2));
console.log(`\nStep 5: dumped ${transcripts.length} transcripts to tmp-factory-audit/claude-transcripts.json`);
console.log("Claude will now read each transcript and extract strategies manually (no GPT-5 call).");
