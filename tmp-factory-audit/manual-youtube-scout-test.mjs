/**
 * Manual YouTube-driven scout agent test.
 *
 * Mirrors the autonomous scout but with explicit per-video output so we can
 * see what each step produces.
 *
 * Pipeline:
 *   1. Search YouTube for "futures trading strategy" (Google YT Data API)
 *   2. Score titles (positive/negative keywords) → top 5 candidates
 *   3. For each candidate:
 *      a. Fetch transcript (youtube-transcript npm)
 *      b. Send to /api/agent/scout-extract
 *      c. Show extracted strategy
 *      d. Verify via Brave web search (does strategy name exist?)
 *      e. Verify via Reddit JSON API (community discussions?)
 *   4. Summary: how many real strategies found
 */
import { YoutubeTranscript } from "youtube-transcript";

const YT_KEY = process.env.YOUTUBE_DATA_API_KEY;
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY;
const API = "http://127.0.0.1:4000";
const SEARCH_QUERY = "futures trading strategy";

if (!YT_KEY) { console.error("Missing YOUTUBE_DATA_API_KEY"); process.exit(1); }

// ── 1. YouTube search ────────────────────────────────────────────────────
console.log(`\n══ STEP 1: YouTube search "${SEARCH_QUERY}" ══\n`);
const ytUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(SEARCH_QUERY)}&type=video&maxResults=15&order=relevance&key=${YT_KEY}`;
const ytResp = await fetch(ytUrl);
const ytData = await ytResp.json();
const videos = (ytData.items || []).map(v => ({
  id: v.id.videoId,
  title: v.snippet.title,
  channel: v.snippet.channelTitle,
}));
console.log(`Got ${videos.length} videos:`);
for (const v of videos.slice(0,15)) console.log(`  [${v.id}] ${v.title.slice(0,60).padEnd(60)} | ${v.channel}`);

// ── 2. Title scoring (Wave 11 + Pass 21) ─────────────────────────────────
console.log(`\n══ STEP 2: Title scoring ══\n`);
const POS_KEYWORDS = /\b(how to|the rules|tutorial|backtest|exact rules|playbook|template|setup|entry rules|strategy explained|step by step)\b/i;
const NEG_KEYWORDS = /\b(why .* lose|warning|exposed|scam|reaction|podcast|q&a|news|vlog|stop trying|truth about|loser)\b/i;
function scoreTitle(t) {
  let s = 0;
  if (POS_KEYWORDS.test(t)) s += 2;
  if (NEG_KEYWORDS.test(t)) s -= 3;
  return s;
}
const scored = videos.map(v => ({ ...v, score: scoreTitle(v.title) })).sort((a,b) => b.score - a.score);
console.log("Top 5 by title score:");
for (const v of scored.slice(0,5)) console.log(`  score=${v.score >= 0 ? '+' : ''}${v.score} | [${v.id}] ${v.title.slice(0,70)}`);

// ── 3. Per-video extract + verify ────────────────────────────────────────
console.log(`\n══ STEP 3: Per-video transcript + extract + verify ══\n`);
const results = [];
for (const v of scored.slice(0, 5)) {
  console.log(`\n─── [${v.id}] ${v.title.slice(0,70)} ───`);

  // 3a. Transcript fetch
  let transcript = "";
  try {
    const segs = await YoutubeTranscript.fetchTranscript(v.id, { lang: "en" }).catch(async () => YoutubeTranscript.fetchTranscript(v.id));
    transcript = segs.map(s => s.text).join(" ").slice(0, 12000);
    console.log(`  ✓ transcript: ${transcript.length} chars`);
  } catch (e) {
    console.log(`  ✗ transcript fetch failed: ${(e.message || String(e)).slice(0, 100)}`);
    results.push({ ...v, status: "no_transcript" });
    continue;
  }
  if (transcript.length < 500) {
    console.log(`  ✗ transcript too short (${transcript.length} chars) — skipping`);
    results.push({ ...v, status: "transcript_too_short" });
    continue;
  }

  // 3b. Send to /api/agent/scout-extract
  let extracted = null;
  try {
    const r = await fetch(`${API}/api/agent/scout-extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: transcript,
        sourceProvider: "exa",
        sourceUrl: `https://youtube.com/watch?v=${v.id}`,
        title: v.title,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    extracted = await r.json();
    if (extracted?.extracted && extracted.ideas?.length) {
      const idea = extracted.ideas[0];
      console.log(`  ✓ EXTRACTED:`);
      console.log(`     concept     : ${idea.concept_name || '?'}`);
      console.log(`     indicator   : ${idea.entry_indicator || '?'}`);
      console.log(`     params      : ${JSON.stringify(idea.entry_params)}`);
      console.log(`     direction   : ${idea.direction || '?'}`);
      console.log(`     market      : ${idea.market || '?'}`);
      console.log(`     symbols[]   : ${JSON.stringify(idea.symbols)}`);
      console.log(`     confluence  : ${JSON.stringify(idea.confluence_factors)}`);
      console.log(`     src_claim_wr: ${idea.source_claim_win_rate ?? 'null'}`);
      console.log(`     src_claim_R : ${idea.source_claim_avg_r ?? 'null'}`);
    } else {
      console.log(`  ✗ extraction empty: ${extracted?.reason || extracted?.error || 'no strategy detected'}`);
      results.push({ ...v, status: "empty_extraction", reason: extracted?.reason });
      continue;
    }
  } catch (e) {
    console.log(`  ✗ scout-extract failed: ${(e.message || String(e)).slice(0,100)}`);
    results.push({ ...v, status: "extract_error" });
    continue;
  }

  const idea = extracted.ideas[0];
  const conceptName = idea.concept_name;

  // 3c. Web verify (Brave)
  let webHits = 0;
  if (BRAVE_KEY && conceptName) {
    try {
      const q = encodeURIComponent(`${conceptName.replace(/_/g, " ")} futures strategy`);
      const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${q}&count=5`, {
        headers: { "X-Subscription-Token": BRAVE_KEY, "Accept": "application/json" },
      });
      if (r.ok) {
        const j = await r.json();
        webHits = j.web?.results?.length ?? 0;
        console.log(`  ✓ web verify: ${webHits} Brave hits for "${conceptName.replace(/_/g,' ')}"`);
      } else {
        console.log(`  ⚠ web verify HTTP ${r.status}`);
      }
    } catch (e) {
      console.log(`  ⚠ web verify error: ${(e.message || String(e)).slice(0,80)}`);
    }
  }

  // 3d. Reddit verify
  let redditHits = 0;
  if (conceptName) {
    try {
      const q = encodeURIComponent(conceptName.replace(/_/g, " "));
      const r = await fetch(`https://www.reddit.com/r/Daytrading/search.json?q=${q}&restrict_sr=1&sort=relevance&t=all&limit=10`, {
        headers: { "User-Agent": "trading-forge-scout/1.0" },
      });
      if (r.ok) {
        const j = await r.json();
        redditHits = j.data?.children?.length ?? 0;
        console.log(`  ✓ reddit verify: ${redditHits} r/Daytrading posts`);
      } else {
        console.log(`  ⚠ reddit verify HTTP ${r.status}`);
      }
    } catch (e) {
      console.log(`  ⚠ reddit verify error: ${(e.message || String(e)).slice(0,80)}`);
    }
  }

  results.push({ ...v, status: "success", concept: idea.concept_name, indicator: idea.entry_indicator, params: idea.entry_params, webHits, redditHits });
}

// ── 4. Summary ───────────────────────────────────────────────────────────
console.log(`\n══ STEP 4: Summary ══\n`);
console.log(`Videos scored: ${videos.length} | Top 5 attempted: ${results.length}`);
const successful = results.filter(r => r.status === "success");
console.log(`Successful extractions: ${successful.length}/${results.length}`);
console.log("\nPer-video result:");
for (const r of results) {
  const tag = r.status === "success" ? "✅" : "❌";
  console.log(`  ${tag} [${r.id}] status=${r.status} ${r.status === "success" ? `| concept=${r.concept} | web=${r.webHits} reddit=${r.redditHits}` : ''}`);
}

console.log("\n=== Cross-validation verdict ===");
for (const r of successful) {
  const xValid = (r.webHits >= 1 ? 1 : 0) + (r.redditHits >= 1 ? 1 : 0) + 1;
  const verdict = xValid >= 3 ? "✅ 3-LAYER CONFIRMED" : xValid === 2 ? "⚠️  2-layer (would graduate via fast path)" : "❌ youtube-only, no community echo";
  console.log(`  ${r.concept.padEnd(40)} | YT ✓ Web=${r.webHits} Reddit=${r.redditHits} | ${verdict}`);
}
