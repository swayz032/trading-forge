/**
 * STAGE 1 GENERALIZATION TEST (2026-06-24) — do the deterministic Layer 3A/3B/3C.1 extractors
 * (session / direction / params) generalize to UNSEEN videos, or are they overfit to the 14?
 *
 * Pulls fresh strategy-video transcripts the pipeline has never seen (excludes ALL 15 known IDs),
 * runs the PURE transcript-side extractors, and reports distributions + misfire signals. No gemma,
 * no server — this isolates the heuristics I wrote against the benchmark (the real overfit risk).
 * Run: DATABASE_URL=... npx tsx scripts/generalization-deterministic.ts
 */
import "dotenv/config";
import { extractSessionFromTranscript } from "../src/server/lib/session-filter.js";
import { classifyDirectionFromTranscript } from "../src/server/lib/direction-parity.js";
import { detectIndicator, scanIndicatorParams } from "../src/server/lib/indicator-params.js";
import { YoutubeTranscript } from "youtube-transcript";

const KEY = process.env.YOUTUBE_DATA_API_KEY;
if (!KEY) { console.error("YOUTUBE_DATA_API_KEY missing"); process.exit(1); }

// ALL 15 already-analyzed IDs (the validate5 working set) — exclude every one.
const KNOWN = new Set([
  "rf_EQvubKlk","FqxEKDxemtI","UBvfsImdI2U","z3Qn3fBoe2I","iU8ww5MC2FQ","SY2jXlW9bt4","gddYspvW0_w",
  "ktkqq7QsN9Q","N7uP9V0Iktc","75DJN5UVQnw","sZFdrxdVTMk","2LnFWQ10-0E","D1Ipi8Cfl8o","W7nlnHTUZQU","BY0yNPjwdK8",
]);

const QUERIES = [
  "day trading strategy futures tutorial",
  "ICT order block entry strategy explained",
  "opening range breakout strategy day trading",
  "liquidity sweep trading strategy tutorial",
  "VWAP trading strategy explained",
  "scalping strategy futures step by step",
  "supply and demand trading strategy",
  "fair value gap entry strategy",
  "moving average trading strategy tutorial",
  "breakout pullback trading strategy",
];
const POS = /(strategy|setup|how to|tutorial|explained|step by step|guide|entry|system)/i;
const NEG = /(news|recap|vlog|podcast|reaction|q&a|live stream|prop firm review|got funded|payout)/i;

async function discover(target: number): Promise<Array<{ id: string; title: string }>> {
  const found = new Map<string, string>();
  for (const q of QUERIES) {
    if (found.size >= target) break;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=20&relevanceLanguage=en&q=${encodeURIComponent(q)}&key=${KEY}`;
    const res = await fetch(url);
    if (!res.ok) { console.error(`search "${q}": ${res.status}`); continue; }
    const data = (await res.json()) as { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string } }> };
    for (const it of data.items ?? []) {
      const id = it.id?.videoId; const title = (it.snippet?.title ?? "").replace(/&#39;/g, "'");
      if (!id || KNOWN.has(id) || found.has(id)) continue;
      if (!POS.test(title) || NEG.test(title)) continue;
      found.set(id, title);
    }
  }
  return [...found].slice(0, target).map(([id, title]) => ({ id, title }));
}

(async () => {
  const vids = await discover(30);
  console.log(`Discovered ${vids.length} unseen candidates. Fetching transcripts…\n`);
  const rows: string[] = [];
  const dirHist: Record<string, number> = {};
  let withTranscript = 0, sessionFound = 0, paramFound = 0, indicatorFound = 0;

  for (const { id, title } of vids) {
    let transcript = "";
    try {
      const items = await YoutubeTranscript.fetchTranscript(id);
      transcript = items.map((i: { text: string }) => i.text).join(" ");
    } catch {
      rows.push(`NO-TRANSCRIPT ${id}  ${title.slice(0, 50)}`);
      continue;
    }
    if (transcript.length < 500) { rows.push(`SHORT-TRANSCRIPT ${id} (${transcript.length}c)`); continue; }
    withTranscript++;

    const session = extractSessionFromTranscript(transcript);
    const dir = classifyDirectionFromTranscript(transcript);
    const ind = detectIndicator(transcript);
    const params = ind ? scanIndicatorParams(transcript) : null;
    if (session?.region || session?.start) sessionFound++;
    if (ind) indicatorFound++;
    if (params?.source === "TRANSCRIPT_EXPLICIT") paramFound++;
    dirHist[dir.class] = (dirHist[dir.class] ?? 0) + 1;

    rows.push(
      `${id}  sess=${(session?.region ?? session?.start ? (session?.region ?? "") + (session?.start ? " " + session?.start : "") : "—").padEnd(14)} ` +
        `dir=${dir.class.padEnd(24)} conf=${dir.confidence.toFixed(2)} ` +
        `ind=${(ind ?? "—").padEnd(10)} params=${params?.params ? JSON.stringify(params.params) : "—"}  ${title.slice(0, 44)}`,
    );
  }

  const sortHist = (h: Record<string, number>) =>
    Object.entries(h).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${String(v).padStart(2)} × ${k}`).join("\n");

  console.log(rows.join("\n"));
  console.log("\n=== AGGREGATE (deterministic extractors on UNSEEN videos) ===");
  console.log(`transcripts fetched: ${withTranscript}/${vids.length}`);
  console.log(`session detected:    ${sessionFound}/${withTranscript}  (${withTranscript ? Math.round((sessionFound / withTranscript) * 100) : 0}%)`);
  console.log(`indicator detected:  ${indicatorFound}/${withTranscript}`);
  console.log(`explicit params:     ${paramFound}/${indicatorFound || 1} of indicator-bearing`);
  console.log("\ndirection class distribution:\n" + sortHist(dirHist));
  console.log(
    "\nOVERFIT CHECK: if EVERY video is BIDIRECTIONAL_EXPLICIT or session=100%, the heuristics are " +
      "over-firing (too liberal). A healthy spread across classes + a <100% session rate = generalizing.",
  );
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
