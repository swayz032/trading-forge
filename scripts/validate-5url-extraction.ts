/**
 * E-VALIDATE (2026-06-22) — 5-URL extraction validation harness.
 *
 * Runs the FULL new extraction pipeline (windowed-enum -> recall -> depth-coverage ->
 * repair -> name/route) on real YouTube source URLs via the isolated :4099 instance's
 * scout-extract endpoint (extract-only — NO library persistence). For each URL it saves the
 * transcript (ground truth) + the structured result and prints a summary so the operator
 * can do the field-by-field manual audit that IS the gate.
 *
 * Usage: tsx scripts/validate-5url-extraction.ts [vid1 vid2 ...]
 *   default URLs = the 4 distinct library source URLs (+ pass a 5th to make 5).
 */
import { YoutubeTranscript } from "youtube-transcript";
import { writeFileSync, mkdirSync } from "fs";
import { Agent, setGlobalDispatcher } from "undici";

// The scout-extract route sends NO response headers until the ENTIRE gemma pipeline
// (recall + windowed-enum + repair, ~10-15 inference calls) completes. undici's DEFAULT
// headersTimeout is 5 min — so a cold-GPU first call on a heavy video (Gann box) gets its
// socket killed at 5 min with a bare "fetch failed", BEFORE the 9-min AbortSignal below.
// Raise both timeouts past the abort ceiling so the AbortSignal is the only real deadline.
setGlobalDispatcher(new Agent({ headersTimeout: 1_320_000, bodyTimeout: 1_320_000 }));

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const GEMMA = process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL ?? "gemma4:e2b";

// Re-warm gemma before EACH video. Back-to-back heavy extractions let gemma's keep_alive lapse
// or evict under VRAM pressure → the next video gets `model_unavailable`. A 1-token warm with a
// 30m keep_alive pins it hot between videos. Best-effort: a warm failure never aborts the run.
async function warmGemma(): Promise<void> {
  try {
    await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: GEMMA, prompt: "ok", stream: false, keep_alive: "30m", options: { num_predict: 1 } }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch { /* best-effort warm */ }
}

const API = process.env.VALIDATE_API ?? "http://localhost:4099";
const DEFAULT_VIDS = ["iU8ww5MC2FQ", "N7uP9V0Iktc", "UBvfsImdI2U", "z3Qn3fBoe2I"];
const vids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_VIDS;

mkdirSync("tmp/validate5", { recursive: true });

interface CoverageVerdict {
  verdict?: string;
  coverage_pct?: number;
  covered?: string[];
  shallow?: string[];
  missing?: string[];
}
interface ExtractResp {
  extracted?: boolean;
  reason?: string;
  ideas?: Array<Record<string, unknown>>;
  coverage_verdict?: CoverageVerdict;
  compilability_results?: Array<{ ideaIndex: number; compilable: boolean }>;
}

for (const vid of vids) {
  let title = "";
  try {
    const o = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${vid}&format=json`);
    if (o.ok) title = ((await o.json()) as { title?: string }).title ?? "";
  } catch { /* non-fatal */ }

  let transcript = "";
  try {
    const it = await YoutubeTranscript.fetchTranscript(vid);
    transcript = it.map((x) => x.text).join(" ").replace(/\s+/g, " ").trim();
  } catch (e) {
    console.log(`\n===== ${vid} — TRANSCRIPT FETCH FAILED: ${(e as Error).message?.slice(0, 100)} =====`);
    continue;
  }
  writeFileSync(`tmp/validate5/${vid}.transcript.txt`, `TITLE: ${title}\n\n${transcript}`);

  await warmGemma(); // pin gemma hot before this video's extraction (anti-eviction)

  let r: ExtractResp;
  try {
    const resp = await fetch(`${API}/api/agent/scout-extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        markdown: transcript,
        sourceProvider: "tavily",
        sourceUrl: `https://youtube.com/watch?v=${vid}`,
        title,
      }),
      signal: AbortSignal.timeout(1_200_000),
    });
    r = (await resp.json()) as ExtractResp;
  } catch (e) {
    console.log(`\n===== ${vid} — EXTRACT FAILED: ${(e as Error).message?.slice(0, 100)} =====`);
    continue;
  }
  writeFileSync(`tmp/validate5/${vid}.result.json`, JSON.stringify(r, null, 2));

  const cv = r.coverage_verdict ?? {};
  const idea0 = (r.ideas ?? [])[0] ?? {};
  console.log(`\n===== ${vid} — ${title} =====`);
  console.log(`transcript_chars: ${transcript.length}`);
  console.log(`extracted: ${r.extracted}${r.reason ? ` (reason: ${r.reason})` : ""}`);
  console.log(`concept_name: ${idea0.concept_name ?? idea0.name ?? "(none)"}  entry_indicator: ${idea0.entry_indicator ?? "(null)"}  direction: ${idea0.direction ?? "(none)"}`);
  console.log(`coverage: verdict=${cv.verdict} pct=${((cv.coverage_pct ?? 0) * 100).toFixed(0)}% | covered=${(cv.covered ?? []).length} shallow=${(cv.shallow ?? []).length} missing=${(cv.missing ?? []).length}`);
  console.log(`  COVERED: ${JSON.stringify(cv.covered ?? [])}`);
  console.log(`  SHALLOW: ${JSON.stringify(cv.shallow ?? [])}`);
  console.log(`  MISSING: ${JSON.stringify(cv.missing ?? [])}`);
  console.log(`compilable: ${JSON.stringify((r.compilability_results ?? []).map((c) => c.compilable))}`);
  console.log(`entry_sequence steps: ${Array.isArray(idea0.entry_sequence) ? (idea0.entry_sequence as unknown[]).length : 0}  confluences: ${Array.isArray(idea0.confluences) ? (idea0.confluences as unknown[]).length : 0}`);
}

console.log("\n=== DONE — transcripts + results saved to tmp/validate5/ ===");
