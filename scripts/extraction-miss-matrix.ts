import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import { computeCoverageVerdict } from "../src/server/lib/extraction-coverage-gate.js";
const CAT: Array<[string, RegExp]> = [
  ["timing",        /\b(\d{1,2}:\d{2}|timing|session|killzone|kill zone|london|new york|\bny\b|asian|open(ing)?|pre-?market|overnight|time of day|first \d+ min)\b/i],
  ["risk_exit",     /\b(stop|target|risk[\s-]?reward|\brr\b|1[\s-]?to[\s-]?\d|trail|break ?even|\bbe\b|partial|profit limit|take[\s-]?profit|scale|position siz)\b/i],
  ["pattern",       /\b(doji|dogee|engulf|wick|pin bar|hammer|tail|candle(stick)?s?|three candle|bullish candl|bearish candl)\b/i],
  ["confluence",    /\b(vwap|fib|fibonacci|order block|\bob\b|fvg|fair value|volume|delta|structure|\bbos\b|choch|liquidit|sweep|support|resistance|s\/r|zone|poc|value area)\b/i],
  ["indicator",     /\b(moving average|\bma\b|\bsma\b|\bema\b|\brsi\b|macd|band|bollinger|standard deviation)\b/i],
];
const files = readdirSync("tmp/validate5").filter(f => f.endsWith(".result.json")).sort();
const matrix: Record<string, Record<string, string[]>> = {};
const catTotals: Record<string, number> = {}; const catVideos: Record<string, Set<string>> = {};
for (const fn of files) {
  const d = JSON.parse(readFileSync("tmp/validate5/"+fn, "utf-8"));
  const vid = fn.replace(".result.json","");
  const si = d._coverage_speaker_items || []; const i0 = (d.ideas||[{}])[0];
  if (!si.length) continue;
  const snap = { concept_name: i0.concept_name, entry_sequence: i0.entry_sequence||[], confluences: i0.confluences||[] };
  const v = computeCoverageVerdict(si, snap as any);
  const miss = [...(v.missing||[]), ...((v as any).shallow||[])];
  if (!miss.length) continue;
  matrix[vid] = {};
  for (const m of miss) {
    let cat = "named_concept";
    for (const [name, re] of CAT) { if (re.test(m)) { cat = name; break; } }
    (matrix[vid][cat] = matrix[vid][cat]||[]).push(m);
    catTotals[cat] = (catTotals[cat]||0)+1;
    (catVideos[cat] = catVideos[cat]||new Set()).add(vid);
  }
}
console.log("=== MISS MATRIX (post-precision-filter) ===");
for (const [vid, cats] of Object.entries(matrix)) console.log(`${vid}: ${Object.keys(cats).map(c=>c+"("+cats[c].length+")").join(" ")}`);
console.log("\n=== CATEGORY RANKING (by video-breadth, then count) ===");
const ranked = Object.keys(catTotals).sort((a,b)=> (catVideos[b].size-catVideos[a].size) || (catTotals[b]-catTotals[a]));
for (const c of ranked) console.log(`${c}\tvideos=${catVideos[c].size}\titems=${catTotals[c]}`);
process.exit(0);
