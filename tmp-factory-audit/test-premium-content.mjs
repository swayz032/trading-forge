/**
 * Operator test (2026-05-20): pull the 7 high-value videos from operator's
 * YouTube search screenshots + run each through the FULL Wave 23H factory
 * pipeline. Report per-video: extracted YES/NO + entry_indicator + reason.
 *
 * Pattern: same workflow as autonomous-scout-runner — YouTube search to find
 * the exact video, transcript fetch, POST /api/agent/scout-extract, capture
 * raw outcome. No graduator side-effects (this is read-only audit).
 */
import "dotenv/config";
import { YoutubeTranscript } from "youtube-transcript";

const YT_KEY = process.env.YOUTUBE_DATA_API_KEY;
const API = process.env.TRADING_FORGE_API_URL ?? "http://127.0.0.1:4000";
const USER_AGENT = "trading-forge-research/1.0";

// Operator-flagged high-value videos from the YouTube screenshots
const TARGETS = [
  { label: "Fibonacci 4H+15M", q: "The EASIEST Trading Strategy 4H 15M Fibonacci Step by Step Ara", expect_archetype: "ict_ote / fibonacci" },
  { label: "JackTrades 4H Pattern", q: "The 4H Pattern NOBODY Talks About 4H 15M Strategy Omar Agag", expect_archetype: "ict_ote OR fvg_retrace" },
  { label: "Soup Room 4H CRT", q: "4H CRT Model Futures Indices High Probability Model Soup Room", expect_archetype: "ict_turtle_soup (CRT)" },
  { label: "Trading Channel 4hr Price Action", q: "The Only 4hr Price Action Trading Strategy You Will Ever Need Full Tutorial", expect_archetype: "any price-action" },
  { label: "IBLV Supply & Demand", q: "Master Institutional Supply Demand In 7 Minutes Full Trading Guide IBLV", expect_archetype: "order_block" },
  { label: "Nick Drobo $45K SIMPLE", q: "Nick Drobo $45000 in 14 days using this SIMPLE strategy", expect_archetype: "any" },
  { label: "FVG 4-Hour", q: "Unlock Trading Secrets 4-Hour Fair Value Gap", expect_archetype: "fvg_retrace" },
];

async function searchYouTube(q) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&videoDuration=medium&relevanceLanguage=en&maxResults=3&order=relevance&key=${YT_KEY}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.items || []).map(v => ({
    id: v.id.videoId,
    title: v.snippet.title.replace(/&#39;/g, "'").replace(/&amp;/g, "&"),
    channel: v.snippet.channelTitle,
    description: (v.snippet.description || "").slice(0, 300),
  }));
}

async function getTranscript(videoId) {
  try {
    const segs = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" })
      .catch(() => YoutubeTranscript.fetchTranscript(videoId));
    return segs.map(s => s.text).join(" ");
  } catch (e) {
    return null;
  }
}

async function extractStrategy(markdown, sourceUrl, title) {
  const resp = await fetch(`${API}/api/agent/scout-extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      markdown,
      sourceProvider: "tavily",
      sourceUrl,
      title,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) return { error: `HTTP ${resp.status}` };
  return resp.json();
}

console.log("=".repeat(80));
console.log("OPERATOR PREMIUM-CONTENT TEST — 7 high-value videos from YouTube screenshots");
console.log("=".repeat(80));

const results = [];
for (let i = 0; i < TARGETS.length; i++) {
  const t = TARGETS[i];
  console.log(`\n[${i + 1}/7] ${t.label}`);
  console.log(`  expected archetype: ${t.expect_archetype}`);
  console.log(`  searching: "${t.q.slice(0, 60)}..."`);

  const hits = await searchYouTube(t.q);
  if (hits.length === 0) {
    console.log(`  ✗ NO VIDEO FOUND (search returned nothing)`);
    results.push({ ...t, found: false, error: "no_search_results" });
    continue;
  }
  const hit = hits[0];
  console.log(`  ✓ found: "${hit.title.slice(0, 60)}" (${hit.channel}) [${hit.id}]`);

  const transcript = await getTranscript(hit.id);
  if (!transcript || transcript.length < 500) {
    console.log(`  ✗ transcript unavailable (${transcript?.length ?? 0} chars)`);
    results.push({ ...t, found: true, videoId: hit.id, title: hit.title, error: "no_transcript" });
    continue;
  }
  console.log(`  ✓ transcript: ${transcript.length} chars`);

  const extracted = await extractStrategy(transcript, `https://youtube.com/watch?v=${hit.id}`, hit.title);
  if (extracted.error) {
    console.log(`  ✗ scout-extract HTTP error: ${extracted.error}`);
    results.push({ ...t, found: true, videoId: hit.id, error: extracted.error });
    continue;
  }

  if (extracted.extracted === false || (Array.isArray(extracted.ideas) && extracted.ideas.length === 0)) {
    console.log(`  ✗ NOT EXTRACTED — empty_reason: ${extracted.empty_reason ?? "?"} (${extracted.empty_reason_detail ?? ""})`);
    results.push({ ...t, found: true, videoId: hit.id, extracted: false, empty_reason: extracted.empty_reason });
    continue;
  }

  const ideas = extracted.ideas || [];
  console.log(`  ✓ EXTRACTED ${ideas.length} ideas:`);
  ideas.forEach((idea, k) => {
    const conf = idea.confirming_indicators?.length ?? 0;
    const biasTf = idea.bias_timeframe ?? null;
    const dir = idea.direction;
    const regimes = idea.preferred_regimes?.join(",") ?? idea.preferred_regime ?? "?";
    console.log(`    [${k}] ${idea.entry_indicator || "<null>"} | dir=${dir} | confluence=${conf} | bias_tf=${biasTf || "-"} | regimes=${regimes}`);
  });
  results.push({
    ...t,
    found: true,
    videoId: hit.id,
    title: hit.title,
    extracted: true,
    idea_count: ideas.length,
    ideas: ideas.map(i => ({
      entry_indicator: i.entry_indicator,
      direction: i.direction,
      confluence: i.confirming_indicators?.length ?? 0,
      bias_tf: i.bias_timeframe,
      regimes: i.preferred_regimes,
    })),
  });
}

console.log("\n" + "=".repeat(80));
console.log("SUMMARY");
console.log("=".repeat(80));
const found = results.filter(r => r.found).length;
const extracted = results.filter(r => r.extracted).length;
const withConfluence = results.filter(r => r.extracted && r.ideas?.some(i => i.confluence >= 2)).length;
const withMtf = results.filter(r => r.extracted && r.ideas?.some(i => i.bias_tf)).length;
console.log(`  Targets:                  7`);
console.log(`  Found via YouTube:        ${found}/7`);
console.log(`  Extracted to DSL:         ${extracted}/7`);
console.log(`  With confluence (≥2):     ${withConfluence}/7`);
console.log(`  With MTF (bias_tf set):   ${withMtf}/7`);

console.log("\nPer-target outcome:");
results.forEach((r, i) => {
  const status = r.extracted ? "✓ EXTRACT" : r.error ? `✗ ${r.error}` : `✗ ${r.empty_reason || "empty"}`;
  console.log(`  [${i + 1}] ${status.padEnd(25)} ${r.label}`);
});

// Persist for later inspection
import { writeFileSync } from "node:fs";
writeFileSync("tmp-factory-audit/premium-content-test-results.json", JSON.stringify(results, null, 2));
console.log(`\n✓ Results written to tmp-factory-audit/premium-content-test-results.json`);
