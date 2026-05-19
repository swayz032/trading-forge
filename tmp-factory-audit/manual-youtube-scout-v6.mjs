/**
 * V6 — match production filter threshold (score > -3, not >= 3)
 * + verify Novo Legacy + JackTrades videos make it through
 */
import { YoutubeTranscript } from "youtube-transcript";

const YT_KEY = process.env.YOUTUBE_DATA_API_KEY;
const API = "http://127.0.0.1:4000";
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

// W23F.X scorer (clickbait now -3, not -5; no hard floor)
const POSITIVE_TITLE = /(how to|step by step|the rules|complete guide|tutorial|setup|strategy guide|backtested|exact rules|entry and exit|playbook|breaking down|explained|template|blueprint|profitable)/i;
const NEGATIVE_TITLE = /(why .* lose|why .* fail|don.t work|doesn.t work|warning|exposed|scam|truth about|reaction|podcast|interview|q.a|news|recap|vlog|motivation|mindset|story time)/i;
const CLICKBAIT_TITLE = /\b(make \$|made \$|earn(?:ed)? \$|\$\d+ ?(?:a|per) ?day|profit \$|easy money|prints? money|secret strategy|secret method|get rich|millionaire|6.figure|7.figure|life.changing|too easy|magic indicator|holy grail)\b/i;
const INDICATOR_NAME_TITLE = /\b(ema|sma|hma|dema|wma|rsi|macd|adx|atr|bollinger|bb |keltner|donchian|stochastic|stoch |vwap|cci|williams|supertrend|ichimoku|cumulative delta|cvd\b|order flow|volume profile|opening range|liquidity sweeps?|order block|fvg|fair value gap|smt |smc |ict |wyckoff|spring|breaker|silver bullet|judas|optimal trade entry|ote |poc |vah |val |displacement|imbalance|mean reversion|chandelier|fibonacci|fib retrace|pivot point|4h|4 hr|4hr|4 hour|15m|15 min|5m|5 min|1h|1hr|1 hour)\b/i;
const NUMERIC_PATTERNS = [
  /\b\d{1,3}(?:\s*(?:and|\/|&|,)\s*|\s+)\d{1,3}\s+(?:ema|sma|hma|dema|alma|wma)\b/i,
  /\b(?:ema|sma|hma|dema|alma|wma)\s+\d{1,3}(?:\s*(?:and|\/|&|,)\s*|\s+)\d{1,3}\b/i,
  /\b(?:rsi|stoch|stochastic|cci|williams)[- ]?\d{1,3}\b/i,
  /\b\d{1,3}[- ]?(?:minute|min|m|hour|hr|h)\b/i,
  /\b(?:bollinger|keltner|donchian)\s*\d{1,3}\b/i,
];
function scoreTitle(t) {
  let s = 0;
  const pos = POSITIVE_TITLE.test(t);
  const neg = NEGATIVE_TITLE.test(t);
  const num = NUMERIC_PATTERNS.some(re => re.test(t));
  const cb = CLICKBAIT_TITLE.test(t);
  const ind = INDICATOR_NAME_TITLE.test(t);
  if (pos) s += 2;
  if (num) s += 3;
  if (ind) s += 3;
  if (neg) s = Math.min(s - 5, -2);
  if (cb) s -= 3;  // W23F.X — soft penalty, can be offset by indicator+numeric
  return { score: s, pos, neg, num, cb, ind };
}

console.log(`\n══ V6: production-aligned threshold (score > -3) ══\n`);

const all = new Map();
for (const q of QUERIES) {
  // DROP videoCaption filter — try ALL videos, accept some transcript-fetch failures
  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&videoDuration=medium&relevanceLanguage=en&maxResults=50&order=relevance&key=${YT_KEY}`);
  const j = await r.json();
  let added = 0;
  for (const v of j.items || []) {
    if (all.has(v.id.videoId)) continue;
    all.set(v.id.videoId, {
      id: v.id.videoId,
      title: v.snippet.title.replace(/&#39;/g,"'").replace(/&amp;/g,"&"),
      channel: v.snippet.channelTitle,
      sourceQuery: q,
    });
    added++;
  }
  console.log(`  "${q}" → ${(j.items||[]).length} returned, ${added} new`);
}
console.log(`Total unique: ${all.size}`);

const scored = [];
for (const v of all.values()) {
  const s = scoreTitle(v.title);
  v.score = s.score; v.flags = s;
  if (v.score > -3) scored.push(v);  // PRODUCTION THRESHOLD
}
scored.sort((a,b) => b.score - a.score);
console.log(`\nEligible (score > -3): ${scored.length}`);

// Check for Novo Legacy + JackTrades specifically
const novo = scored.find(v => /novo legacy|one 4 hour candle|\$500.*day/i.test(v.title));
const jack = scored.find(v => /jacktrades|4H Pattern Nobody|4H, 15M/i.test(v.title));
console.log(`\n=== Operator-flagged videos check ===`);
console.log(`Novo Legacy "$500/day 4hr": ${novo ? `✅ score=${novo.score} (was rejected in v5)` : '❌ STILL not found in YT API results'}`);
console.log(`JackTrades "4H Pattern":     ${jack ? `✅ score=${jack.score}` : '❌ not in API results'}`);

console.log(`\nTop 25 eligible:`);
for (const v of scored.slice(0, 25)) {
  const f = v.flags;
  console.log(`  ${v.score >= 0 ? '+' : ''}${v.score} | ${f.cb ? 'CB ' : '   '}${f.ind ? 'IND' : '   '} | ${v.title.slice(0,70)}`);
}

console.log(`\n══ Testing top 30 eligible ══\n`);
const toTest = scored.slice(0, 30);
let ok = 0, empty = 0, terr = 0;
const successes = [];
const reasons = {};
for (let i = 0; i < toTest.length; i++) {
  const v = toTest[i];
  const tag = `[${i+1}/${toTest.length}]`;
  try {
    const segs = await YoutubeTranscript.fetchTranscript(v.id, { lang: "en" }).catch(() => YoutubeTranscript.fetchTranscript(v.id));
    const transcript = segs.map(s => s.text).join(" ").slice(0, 12000);
    if (transcript.length < 500) { console.log(`${tag} ✗ short`); continue; }
    const r = await fetch(`${API}/api/agent/scout-extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: transcript, sourceProvider: "exa", sourceUrl: `https://youtube.com/watch?v=${v.id}`, title: v.title }),
      signal: AbortSignal.timeout(120_000),
    });
    const ext = await r.json();
    if (ext?.extracted && ext.ideas?.length) {
      ok++;
      const idea = ext.ideas[0];
      console.log(`${tag} ✅ ${idea.entry_indicator.padEnd(22)} ${JSON.stringify(idea.entry_params).padEnd(40)} | ${v.title.slice(0,40)}`);
      successes.push({ ...v, indicator: idea.entry_indicator, params: idea.entry_params, concept: idea.concept_name });
    } else {
      empty++;
      reasons[ext?.reason || '?'] = (reasons[ext?.reason || '?'] || 0) + 1;
    }
  } catch (e) {
    terr++;
  }
}

console.log(`\n══ SUMMARY ══`);
console.log(`Sampled    : ${all.size}`);
console.log(`Eligible   : ${scored.length}`);
console.log(`Tested     : ${toTest.length}`);
console.log(`Extractions: ${ok} ok / ${empty} empty / ${terr} transcript err`);
console.log(`Yield      : ${(ok/toTest.length*100).toFixed(0)}% of tested, ${(ok/scored.length*100).toFixed(0)}% of eligible`);
console.log(`\nEmpty reasons:`);
for (const [r, n] of Object.entries(reasons).sort((a,b) => b[1]-a[1])) console.log(`  ${r.padEnd(35)} ${n}`);

console.log(`\n══ ${ok} extractions ══`);
for (const s of successes) console.log(`  ${s.indicator.padEnd(22)} | ${JSON.stringify(s.params).padEnd(40)} | ${s.title.slice(0,55)}`);
