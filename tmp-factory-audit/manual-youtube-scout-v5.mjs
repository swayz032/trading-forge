/**
 * V5 — user-provided queries, W23F.T YT filters, full sample.
 */
import { YoutubeTranscript } from "youtube-transcript";

const YT_KEY = process.env.YOUTUBE_DATA_API_KEY;
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY;
const API = "http://127.0.0.1:4000";

// USER-PROVIDED QUERIES (2026-05-19)
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

console.log(`\n══ V5: ${QUERIES.length} USER queries × 50 = ${QUERIES.length * 50} max videos ══\n`);

const all = new Map();
const perQuery = {};
for (const q of QUERIES) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&videoCaption=closedCaption&videoDuration=medium&relevanceLanguage=en&maxResults=50&order=relevance&key=${YT_KEY}`);
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
  perQuery[q] = { returned: (j.items || []).length, added };
  console.log(`  "${q}".padEnd(50)} → ${perQuery[q].returned} returned, ${added} new`);
}
console.log(`Total unique: ${all.size}`);

const scored = [];
for (const v of all.values()) {
  v.score = scoreTitle(v.title);
  if (v.score >= 3) scored.push(v);
}
scored.sort((a,b) => b.score - a.score);
console.log(`\nEligible (score >= 3): ${scored.length}`);
console.log(`\nTop 20 eligible:`);
for (const v of scored.slice(0,20)) {
  console.log(`  +${v.score} | "${v.sourceQuery.slice(0,30).padEnd(30)}" | ${v.title.slice(0,68)}`);
}

console.log(`\n══ Testing ALL ${scored.length} eligible ══\n`);
const successes = [];
let trans_ok = 0, trans_disabled = 0, trans_short = 0, trans_err = 0;
let extract_ok = 0, extract_empty = 0;
const reasonCounts = {};

for (let i = 0; i < scored.length; i++) {
  const v = scored[i];
  const tag = `[${i+1}/${scored.length}]`;
  try {
    const segs = await YoutubeTranscript.fetchTranscript(v.id, { lang: "en" }).catch(() => YoutubeTranscript.fetchTranscript(v.id));
    const transcript = segs.map(s => s.text).join(" ").slice(0, 12000);
    if (transcript.length < 500) { trans_short++; continue; }
    trans_ok++;
    const r = await fetch(`${API}/api/agent/scout-extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: transcript, sourceProvider: "exa", sourceUrl: `https://youtube.com/watch?v=${v.id}`, title: v.title }),
      signal: AbortSignal.timeout(90_000),
    });
    const ext = await r.json();
    if (ext?.extracted && ext.ideas?.length) {
      extract_ok++;
      const idea = ext.ideas[0];
      const paramSummary = Object.keys(idea.entry_params || {}).length ? JSON.stringify(idea.entry_params) : "{}";
      console.log(`${tag} ✅ ${idea.entry_indicator.padEnd(20)} | params=${paramSummary.padEnd(35)} | ${v.title.slice(0,42)}`);
      successes.push({ ...v, indicator: idea.entry_indicator, params: idea.entry_params, concept: idea.concept_name });
    } else {
      extract_empty++;
      const reason = ext?.reason || "unknown";
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
  } catch (e) {
    const m = (e.message || String(e));
    if (m.includes("disabled")) trans_disabled++;
    else trans_err++;
  }
}

console.log(`\n══ SUMMARY ══`);
console.log(`Sampled    : ${all.size} unique videos across ${QUERIES.length} queries`);
console.log(`Eligible   : ${scored.length} (score >= 3)`);
console.log(`Transcripts: ${trans_ok} ok / ${trans_disabled} disabled / ${trans_short} too short / ${trans_err} err`);
console.log(`Extraction : ${extract_ok} success (${(extract_ok/Math.max(trans_ok,1)*100).toFixed(0)}%) / ${extract_empty} empty`);
console.log(`\nEmpty reason breakdown:`);
for (const [r, n] of Object.entries(reasonCounts).sort((a,b) => b[1]-a[1])) console.log(`  ${r.padEnd(35)} ${n}`);

console.log(`\n══ ${successes.length} SUCCESSFUL EXTRACTIONS — per-query attribution ══`);
const byQuery = {};
for (const s of successes) {
  const q = s.sourceQuery;
  (byQuery[q] ||= []).push(s);
}
for (const [q, list] of Object.entries(byQuery)) {
  console.log(`\nFrom "${q}" — ${list.length} extractions:`);
  for (const s of list) console.log(`  ${s.indicator.padEnd(22)} | ${JSON.stringify(s.params).padEnd(40)} | ${s.title.slice(0,52)}`);
}

console.log(`\n══ Per-indicator distribution ══`);
const indCount = {};
for (const s of successes) indCount[s.indicator] = (indCount[s.indicator] || 0) + 1;
for (const [i, n] of Object.entries(indCount).sort((a,b) => b[1]-a[1])) console.log(`  ${i.padEnd(25)} ${n}`);

console.log(`\n══ EXPLICIT PARAMS (highest graduation value) ══`);
const withParams = successes.filter(s => Object.keys(s.params || {}).length > 0);
console.log(`Count with explicit params: ${withParams.length}/${successes.length}`);
for (const s of withParams) {
  console.log(`  ${s.indicator} | ${JSON.stringify(s.params)} | ${s.title.slice(0,50)}`);
}
