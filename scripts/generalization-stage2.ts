/**
 * STAGE 2 GENERALIZATION (2026-06-24) — full GEMMA pipeline on UNSEEN videos.
 *
 * Answers the highest-information questions: does the FULL extraction stack generalize (not just the
 * deterministic layers)? false-compilation rate? uncatalogued-archetype frequency? quarantine
 * correctness? Runs the real pipeline (windowed-enum → recall → coverage → repair → name/route →
 * compilability gate) via an isolated extract-only instance, scores each result, prints aggregates.
 *
 * RESUMABLE: freezes the unseen ID set to disk; per-video results are checkpointed. Re-run skips
 * completed videos — so a mid-run interruption is a non-event (this is the real stabilizer, not W4.2).
 *
 * Usage: VALIDATE_API=http://localhost:4098 DATABASE_URL=... npx tsx scripts/generalization-stage2.ts
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { Agent, setGlobalDispatcher } from "undici";
import { YoutubeTranscript } from "youtube-transcript";
import { scorePlaceability } from "../src/server/lib/placeability-score.js";
import { deriveEntryIndicator } from "../src/server/services/direct-bucket-graduator.js";

setGlobalDispatcher(new Agent({ headersTimeout: 1_320_000, bodyTimeout: 1_320_000 }));
const API = process.env.VALIDATE_API ?? "http://localhost:4098";
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const GEMMA = process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL ?? "gemma4:e2b";
const KEY = process.env.YOUTUBE_DATA_API_KEY;
const OUT = "tmp/generalization";
mkdirSync(OUT, { recursive: true });

const KNOWN = new Set([
  "rf_EQvubKlk","FqxEKDxemtI","UBvfsImdI2U","z3Qn3fBoe2I","iU8ww5MC2FQ","SY2jXlW9bt4","gddYspvW0_w",
  "ktkqq7QsN9Q","N7uP9V0Iktc","75DJN5UVQnw","sZFdrxdVTMk","2LnFWQ10-0E","D1Ipi8Cfl8o","W7nlnHTUZQU","BY0yNPjwdK8",
]);
const QUERIES = [
  "day trading strategy futures tutorial","ICT order block entry strategy explained",
  "opening range breakout strategy day trading","liquidity sweep trading strategy tutorial",
  "VWAP trading strategy explained","supply and demand trading strategy",
  "fair value gap entry strategy","moving average trading strategy tutorial",
];
const POS = /(strategy|setup|how to|tutorial|explained|step by step|guide|entry|system)/i;
const NEG = /(news|recap|vlog|podcast|reaction|q&a|live stream|prop firm review|got funded|payout)/i;

async function frozenIds(target: number): Promise<string[]> {
  const idsPath = join(OUT, "frozen-ids.json");
  if (existsSync(idsPath)) return JSON.parse(readFileSync(idsPath, "utf8"));
  const found = new Map<string, string>();
  for (const q of QUERIES) {
    if (found.size >= target) break;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=20&relevanceLanguage=en&q=${encodeURIComponent(q)}&key=${KEY}`;
    const r = await fetch(url); if (!r.ok) continue;
    const d = (await r.json()) as { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string } }> };
    for (const it of d.items ?? []) {
      const id = it.id?.videoId; const t = it.snippet?.title ?? "";
      if (!id || KNOWN.has(id) || found.has(id) || !POS.test(t) || NEG.test(t)) continue;
      found.set(id, t);
    }
  }
  const ids = [...found.keys()].slice(0, target);
  writeFileSync(idsPath, JSON.stringify(ids, null, 2));
  return ids;
}

async function warmGemma() {
  try {
    await fetch(`${OLLAMA}/api/generate`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: GEMMA, prompt: "ok", stream: false, keep_alive: "30m", options: { num_predict: 1 } }),
      signal: AbortSignal.timeout(180_000) });
  } catch { /* best-effort */ }
}

interface Res { extracted?: boolean; ideas?: Array<Record<string, unknown>>; coverage_verdict?: { verdict?: string; coverage_pct?: number };
  compilability_results?: Array<{ compilable?: boolean; missing?: string[] }>; quarantined_count?: number; }

(async () => {
  const ids = await frozenIds(25);
  console.log(`Stage 2: ${ids.length} frozen unseen IDs. API=${API}\n`);
  for (const id of ids) {
    const rp = join(OUT, `${id}.result.json`);
    if (existsSync(rp)) { console.log(`SKIP (done) ${id}`); continue; }
    let transcript = "";
    try { transcript = (await YoutubeTranscript.fetchTranscript(id)).map((i: { text: string }) => i.text).join(" "); }
    catch { writeFileSync(rp, JSON.stringify({ _error: "no_transcript" })); console.log(`NO-TRANSCRIPT ${id}`); continue; }
    if (transcript.length < 500) { writeFileSync(rp, JSON.stringify({ _error: "short_transcript" })); console.log(`SHORT ${id}`); continue; }
    writeFileSync(join(OUT, `${id}.transcript.txt`), transcript);
    await warmGemma();
    try {
      const resp = await fetch(`${API}/api/agent/scout-extract`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown: transcript, sourceUrl: `https://youtube.com/watch?v=${id}`, sourceProvider: "tavily", title: id }),
        signal: AbortSignal.timeout(540_000) });
      const body = await resp.json();
      writeFileSync(rp, JSON.stringify(body, null, 2));
      console.log(`EXTRACTED ${id}  (${resp.status})`);
    } catch (e) {
      writeFileSync(rp, JSON.stringify({ _error: String((e as Error).message) }));
      console.log(`FAIL ${id}: ${(e as Error).message}`);
    }
  }

  // ── Score ──
  const KNOWN_PARAM = new Set(["ema_crossover","sma_crossover","macd_crossover","rsi_reversal","bollinger_breakout","keltner_squeeze","donchian_breakout","atr_breakout","vwap_fade","vwap_reversion","connors_rsi2","event_driven_fade","overnight_drift","liquidity_sweep_breakout","session_open_breakout"]);
  let n = 0, extracted = 0, coveragePass = 0, compilable = 0, quarantined = 0, placeable = 0, falseCompile = 0;
  const archHist: Record<string, number> = {};
  const rows: string[] = [];
  for (const id of ids) {
    const rp = join(OUT, `${id}.result.json`);
    if (!existsSync(rp)) continue;
    const r = JSON.parse(readFileSync(rp, "utf8")) as Res & { _error?: string };
    if (r._error) { rows.push(`${id.padEnd(13)} ERROR ${r._error}`); continue; }
    n++;
    const i = (r.ideas ?? [])[0] ?? {};
    const cov = r.coverage_verdict?.verdict === "pass";
    const comp = r.compilability_results?.[0]?.compilable === true;
    const quar = (r.quarantined_count ?? 0) > 0;
    if (r.extracted) extracted++;
    if (cov) coveragePass++;
    if (comp) compilable++;
    if (quar) quarantined++;
    const resolved = deriveEntryIndicator((i.concept_name as string) ?? "", null, (i.entry_indicator as string) ?? null) ?? "";
    const archKind = resolved.startsWith("archetype:") ? "archetype" : resolved.startsWith("uncatalogued:") ? "uncatalogued" : KNOWN_PARAM.has(resolved) ? "parametric" : "other";
    archHist[archKind] = (archHist[archKind] ?? 0) + 1;
    const pv = scorePlaceability({
      direction: (i.direction as string) ?? null, entry_indicator: (i.entry_indicator as string) ?? null,
      archetype: (i.entry_archetype as string) ?? null, resolved_entry_indicator: resolved,
      entry_condition: (i.entry_condition as string) ?? null, entry_type: (i.entry_type as string) ?? null,
      entry_params: (i.entry_params as Record<string, unknown>) ?? null,
      entry_sequence: (i.entry_sequence as Array<{ action?: string }>) ?? null,
      confluences: (i.confluences as Array<{ name?: string }>) ?? null,
      session_filter: (i.session_filter as string) ?? null,
      session_window: (i.session_window as never) ?? null,
      direction_evidence: i.direction_class ? { class: i.direction_class as never, confidence: (i.direction_confidence as number) ?? 0.5, evidence: [] } : null,
      risk_rules: (i.risk_rules as string) ?? null,
    });
    if (pv.placeable) placeable++;
    // FALSE COMPILATION = engine says compilable but there's no real trigger (Layer 1 should make this 0)
    const triggerFail = pv.failure_reasons.some((x) => ["NO_TRIGGER","PARAMS_REQUIRED","UNCATALOGUED_INDICATOR"].includes(x));
    if (comp && triggerFail) falseCompile++;
    rows.push(`${id.padEnd(13)} cov=${cov ? "pass" : (r.coverage_verdict?.verdict ?? "?")} comp=${comp} quar=${quar} arch=${archKind.padEnd(12)} place=${pv.placeable} ${comp && triggerFail ? "⚠FALSE-COMPILE" : ""}`);
  }
  const pct = (x: number) => `${n ? Math.round((x / n) * 100) : 0}%`;
  console.log("\n=== STAGE 2 PER-VIDEO ===\n" + rows.join("\n"));
  console.log("\n=== STAGE 2 AGGREGATE (unseen, full pipeline) ===");
  console.log(`scored:                ${n}`);
  console.log(`extracted:             ${extracted} (${pct(extracted)})`);
  console.log(`coverage pass:         ${coveragePass} (${pct(coveragePass)})  ← extraction completeness`);
  console.log(`compilable:            ${compilable} (${pct(compilable)})`);
  console.log(`quarantined:           ${quarantined} (${pct(quarantined)})  ← gate refused incomplete`);
  console.log(`placeable:             ${placeable} (${pct(placeable)})`);
  console.log(`FALSE COMPILATIONS:    ${falseCompile} (${pct(falseCompile)})  ← MUST be ~0 (Layer 1 gate)`);
  console.log("\narchetype routing frequency:\n" + Object.entries(archHist).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`  ${String(v).padStart(2)} × ${k}`).join("\n"));
  console.log(`\nuncatalogued frequency tells you whether 3C.3 archetype synthesis is a production problem or a benchmark one.`);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
