/**
 * Test the EXACT videos from operator's screenshots.
 * Uses literal title-based searches so we pull the same videos operator saw.
 * Fresh YT key. Live factory.
 */
import { YoutubeTranscript } from "youtube-transcript";

const YT_KEY = "AIzaSyCH3oGu_Pe31UZEorYkpzf8HW-WmWw0E6k";
const API = "http://127.0.0.1:4000";

// Exact titles from operator's YouTube screenshots
const TARGETS = [
  { label: "Ara 4H+15M Fibonacci", q: "EASIEST Trading Strategy 4H 15M Fibonacci Step by Step Ara", channel_hint: "Ara" },
  { label: "JackTrades 4H Pattern", q: "4H Pattern NOBODY Talks About 4H 15M Strategy Omar Agag", channel_hint: "Omar Agag" },
  { label: "Soup Room 4H CRT", q: "4H CRT Model Futures Indices High Probability", channel_hint: "Soup Room" },
  { label: "TTC 4hr Price Action", q: "The Only 4hr Price Action Trading Strategy Ever Need Trading Channel", channel_hint: "Trading Channel" },
  { label: "IBLV Institutional S&D", q: "Master Institutional Supply Demand 7 Minutes Full Trading Guide IBLV", channel_hint: "IBLV" },
  { label: "Nick Drobo $45K SIMPLE", q: "Nick Drobo 45000 14 days SIMPLE strategy", channel_hint: "Nick Drobo" },
  { label: "FVG 4-Hour", q: "Unlock Trading Secrets 4-Hour Fair Value Gap", channel_hint: null },
  { label: "Trade with Pat A+ S&D", q: "Trade with Pat 3 Step A Supply Demand Strategy 79", channel_hint: "Trade with Pat" },
  { label: "BKTraders PROVEN 4-Hour", q: "PROVEN 4-Hour Trading Strategy 85 Win Rate BKTraders", channel_hint: "BKTraders" },
  { label: "TTrades 4-Hour PO3", q: "Trading 4 Hour Power Of Three OHLC TTrades", channel_hint: "TTrades" },
  { label: "Trading Data 15M-1H-4H", q: "Best Trading Strategy Every Day 15M 1H 4H Trading Data", channel_hint: "Trading Data" },
  { label: "Atif Hussain Master 4H", q: "Master The 4H Chart Mastered Trading Atif Hussain", channel_hint: "Atif Hussain" },
];

async function ytSearch(q) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=3&order=relevance&key=${YT_KEY}`;
  const r = await fetch(url);
  if (!r.ok) {
    const e = await r.json();
    return { error: e.error?.message?.slice(0, 100) };
  }
  const j = await r.json();
  return { items: (j.items || []).map(v => ({
    id: v.id.videoId,
    title: v.snippet.title.replace(/&#39;/g, "'").replace(/&amp;/g, "&"),
    channel: v.snippet.channelTitle,
  })) };
}

async function getTranscript(videoId) {
  try {
    const segs = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" })
      .catch(() => YoutubeTranscript.fetchTranscript(videoId));
    return segs.map(s => s.text).join(" ");
  } catch { return null; }
}

console.log("=".repeat(80));
console.log("EXACT SCREENSHOT VIDEOS — full pipeline test");
console.log("=".repeat(80));

const results = [];
for (let i = 0; i < TARGETS.length; i++) {
  const t = TARGETS[i];
  console.log(`\n[${i + 1}/${TARGETS.length}] ${t.label}`);

  const search = await ytSearch(t.q);
  if (search.error) {
    console.log(`  ✗ search failed: ${search.error}`);
    results.push({ ...t, status: "search_failed" });
    continue;
  }
  if (!search.items?.length) {
    console.log(`  ✗ no results`);
    results.push({ ...t, status: "no_results" });
    continue;
  }

  // Pick the best match — prefer channel match if hint provided
  let pick = search.items[0];
  if (t.channel_hint) {
    const hint = t.channel_hint.toLowerCase();
    const match = search.items.find(v => v.channel.toLowerCase().includes(hint));
    if (match) pick = match;
  }
  console.log(`  found: "${pick.title.slice(0, 65)}" (${pick.channel}) [${pick.id}]`);

  const transcript = await getTranscript(pick.id);
  if (!transcript || transcript.length < 500) {
    console.log(`  ✗ transcript unavailable (${transcript?.length ?? 0} chars)`);
    results.push({ ...t, status: "no_transcript", videoId: pick.id, found_title: pick.title });
    continue;
  }
  console.log(`  ✓ transcript: ${transcript.length} chars`);

  try {
    const resp = await fetch(`${API}/api/agent/scout-extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: transcript, sourceProvider: "tavily", sourceUrl: `https://youtube.com/watch?v=${pick.id}`, title: pick.title }),
      signal: AbortSignal.timeout(180_000),
    });
    const j = await resp.json();
    if (j.extracted && j.ideas?.length) {
      console.log(`  ✅ EXTRACTED ${j.ideas.length} ideas:`);
      j.ideas.forEach((idea, k) => console.log(`     [${k}] ${idea.entry_indicator} | dir=${idea.direction}`));
      results.push({ ...t, status: "extracted", videoId: pick.id, found_title: pick.title, ideas: j.ideas });
    } else {
      console.log(`  ✗ ${j.reason || "empty"}`);
      results.push({ ...t, status: j.reason || "empty", videoId: pick.id, found_title: pick.title });
    }
  } catch (e) {
    console.log(`  ✗ ERROR ${e.message?.slice(0, 60)}`);
    results.push({ ...t, status: "exception", videoId: pick.id });
  }
}

console.log("\n" + "=".repeat(80));
console.log("FINAL TABLE");
console.log("=".repeat(80));
results.forEach((r, i) => {
  const tag = r.status === "extracted" ? "✅" : "❌";
  const detail = r.status === "extracted"
    ? `${r.ideas.length} ideas | ${r.ideas.map(x => x.entry_indicator).join(", ")}`
    : r.status;
  console.log(`  ${tag} [${i + 1}] ${r.label.padEnd(30)} ${detail}`);
});

const ok = results.filter(r => r.status === "extracted").length;
console.log(`\n  ${ok}/${results.length} extracted`);
console.log(`  Quota used (est): ~${results.length * 100} units`);

import { writeFileSync } from "node:fs";
writeFileSync("tmp-factory-audit/exact-screenshot-results.json", JSON.stringify(results, null, 2));
