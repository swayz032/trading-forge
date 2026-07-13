/**
 * h1-frontier-designpool.ts — gpt-5.4 WHOLE-JOB design-pool 16 extraction (2026-07-13).
 *
 * The make-or-break measurement: can the birth-certified reader (gpt-5.4) copy
 * faithfully enough to earn the terminal read? Runs the FULL pipeline over the
 * spent-16, governor-walled on the gpt54 200K/day pool (whole job → ~3-4 days;
 * pause-at-wall/resume-tomorrow is the DESIGNED rhythm), fully cached/resumable.
 *
 *   Phase-A: k=5 modal consensus enumeration (production procedure).
 *   Phase-B: per consensus strategy, single-draw condition extraction, scoped by
 *            the strategy's entry/exit summary (errors caught downstream by the
 *            model-free locator + F-2 floor + raters — 5x-ing Phase-B is waste).
 *   Vault:   per-video {enumeration, per_strategy_extractions} for the Python
 *            locator-support measurement (the ≤8% bar) that runs after extraction.
 *
 * Arg: --videos=ID1,ID2  (smoke subset)  |  --max=N  (first N)  | (default: all 16)
 * Run: npx tsx scripts/h1-frontier-designpool.ts
 */
import OpenAI from "openai";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolvePoolPartition, readTodaySpend, recordSpend, readBurstTicket, evaluateWithBurst } from "../src/server/lib/extraction-token-governor";
import { ExtractionResultCache, promptHash, cacheKey } from "../src/server/lib/extraction-result-cache";

const ROOT = process.cwd();
const MODEL = "gpt-5.4";          // birth-certified enumeration + copy brain (whole job)
const POOL = "gpt54" as const;    // 200K/day partition, 50K critique reserve
const K = 5;                       // Phase-A k=5 modal consensus
const POLICY = "k5-modal-v1";

const ALL16 = ["-igpOZs8LsM","0xygpCMwxbQ","2DXQqwKSwJE","4cT8WTyxhYY","CLDEIsNpVRc","DLwVqcLRcfw","E9MzEC_yNoM","IyFioFkRgWo","PVMgOxHUqFA","R5L890juvRw","W7nlnHTUZQU","WEhmadJArQo","ZF8uKPqAu8M","_LS6qcSlDCs","dV7chra4u4Q","kFyD3H6I1I8"];

function envKey(): string {
  const line = readFileSync(`${ROOT}/.env`, "utf8").split(/\r?\n/).find((l) => l.startsWith("OPENAI_API_KEY="));
  const k = line ? line.slice("OPENAI_API_KEY=".length) : "";
  if (!k) throw new Error("OPENAI_API_KEY missing");
  return k;
}
function transcriptText(id: string): string {
  const d = JSON.parse(readFileSync(`${ROOT}/docs/replay-results/h1-scripts/pilot-run/transcripts/${id}.json`, "utf8"));
  if (typeof d?.text === "string") return d.text;
  for (const k of ["transcript", "segments", "content"]) {
    const v = d?.[k];
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map((s: any) => (typeof s === "string" ? s : s?.text ?? "")).join(" ");
  }
  return Array.isArray(d) ? d.map((s: any) => s?.text ?? "").join(" ") : JSON.stringify(d);
}
function strictify(node: any): any {
  if (Array.isArray(node)) return node.map(strictify);
  if (node && typeof node === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(node)) out[k] = strictify(v);
    if (out.type === "object" && out.properties) { out.additionalProperties = false; out.required = Object.keys(out.properties); }
    return out;
  }
  return node;
}
function modeOf(xs: number[]) {
  const f = new Map<number, number>(); xs.forEach((x) => f.set(x, (f.get(x) ?? 0) + 1));
  let best = xs[0], bestN = 0; for (const [v, n] of f) if (n > bestN || (n === bestN && v < best)) { best = v; bestN = n; }
  return { mode: best, modeN: bestN };
}

async function main() {
  const arg = process.argv.slice(2).join(" ");
  let videos = ALL16;
  const vm = arg.match(/--videos=([\w,.\-]+)/); if (vm) videos = vm[1].split(",");
  const mm = arg.match(/--max=(\d+)/); if (mm) videos = ALL16.slice(0, Number(mm[1]));

  const client = new OpenAI({ apiKey: envKey() });
  const enumPrompt = readFileSync(`${ROOT}/src/agents/strategy-enumerator.md`, "utf8");
  const enumSchema = strictify(JSON.parse(readFileSync(`${ROOT}/src/agents/kb/strategy-enumerator-schema.json`, "utf8")));
  const extPrompt = readFileSync(`${ROOT}/src/agents/transcript-extractor-minimal.md`, "utf8");
  const extSchema = strictify(JSON.parse(readFileSync(`${ROOT}/src/agents/kb/transcript-extractor-minimal-schema.json`, "utf8")));
  const enumHash = promptHash(enumPrompt), extHash = promptHash(extPrompt);

  const outDir = `${ROOT}/docs/replay-results/h1-scripts/frontier-designpool`;
  const vaultDir = `${outDir}/vault`;
  mkdirSync(vaultDir, { recursive: true });
  const cache = new ExtractionResultCache(`${outDir}/result-cache`);
  const cap = resolvePoolPartition(POOL);
  // CROSS-RUN daily wall: start from the PERSISTENT ledger (today's real spend),
  // not 0 — this is what makes pause-at-wall/resume-tomorrow hold across runs and
  // protects the free-pool ceiling. Record every call immediately.
  const LEDGER = `${ROOT}/docs/replay-results/h1-scripts/frontier-daily-ledger.json`;
  const now = new Date();
  let spent = readTodaySpend(LEDGER, POOL, now);
  const burst = readBurstTicket(LEDGER, POOL, now);
  console.log(`  [ledger] ${POOL} already spent today: ${spent}/${cap}${burst ? ` | BURST active ($${burst.limitUsd}/${burst.limitTokens}tok, signed: ${burst.signedBy})` : ""}`);

  async function call(system: string, user: string, schema: any, schemaName: string, tx: string): Promise<{ parsed: any; tokens: number; cached: number }> {
    const estimate = Math.ceil(tx.length / 4) + 3500;
    const be = evaluateWithBurst(spent, estimate, cap, burst, now);
    if (!be.allow) throw new Error(`[extraction-token-governor] BLOCKED: ${be.reason}`);
    if (be.mode === "burst") console.log(`    [burst] paid ~${be.projectedPaidTokens} tok ($${be.projectedPaidUsd.toFixed(2)}) — operator-signed`);
    const resp = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name: schemaName, schema, strict: true } },
    });
    const tokens = resp.usage?.total_tokens ?? 0;
    spent += tokens;
    recordSpend(LEDGER, POOL, now, tokens); // persist immediately (before any downstream crash)
    return { parsed: JSON.parse(resp.choices[0]?.message?.content ?? "{}"), tokens, cached: (resp.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0 };
  }

  console.log(`=== gpt-5.4 WHOLE-JOB design-pool: ${videos.length} videos, partition ${cap} ===`);
  const summary: any = { model: MODEL, pool: POOL, partition: cap, videos: {} };

  for (const vid of videos) {
    const tx = transcriptText(vid);
    // ---- PHASE A: k=5 consensus enumeration ----
    const draws: any[] = [];
    for (let i = 0; i < K; i++) {
      const dHash = `${enumHash}__${POLICY}__d${i}`;
      const cd = cache.get<any>(MODEL, vid, dHash);
      if (cd) { draws.push(cd.result); continue; }
      const user = `TRANSCRIPT:\n${tx}\n\nEnumerate the distinct strategies per the three canonical rules. Return ONLY the JSON object.`;
      const { parsed, tokens, cached } = await call(enumPrompt, user, enumSchema, "StrategyEnumeratorOutput", tx);
      cache.put({ key: cacheKey(MODEL, vid, dHash), model: MODEL, videoId: vid, promptHash: dHash, result: parsed, originalTokens: tokens, cachedTokensReported: cached });
      draws.push(parsed);
    }
    const counts = draws.map((d) => (Array.isArray(d?.strategies) ? d.strategies.length : -1));
    const { mode, modeN } = modeOf(counts);
    const consensus = draws.find((d) => (Array.isArray(d?.strategies) ? d.strategies.length : -1) === mode) ?? draws[0];
    const unstable = modeN < 4; // production route: one blind adjudication (flagged; not run here)

    // ---- PHASE B: per consensus strategy, single-draw scoped extraction ----
    const perStrategy: any[] = [];
    const strategies = Array.isArray(consensus?.strategies) ? consensus.strategies : [];
    for (let si = 0; si < strategies.length; si++) {
      const s = strategies[si];
      const scope = { entry_summary: s?.entry_summary ?? "", exit_summary: s?.exit_summary ?? "", name: s?.name ?? `strategy_${si}` };
      const bHash = `${extHash}__phaseB__s${si}`;
      const cb = cache.get<any>(MODEL, vid, bHash);
      let ext: any;
      if (cb) ext = cb.result;
      else {
        const user = `TRANSCRIPT:\n${tx}\n\nSCOPE — extract ONLY this one strategy's conditions (ignore other strategies in the video):\n${JSON.stringify(scope)}\n\nReturn ONLY the JSON object.`;
        const { parsed, tokens, cached } = await call(extPrompt, user, extSchema, "MinimalExtractorOutput", tx);
        cache.put({ key: cacheKey(MODEL, vid, bHash), model: MODEL, videoId: vid, promptHash: bHash, result: parsed, originalTokens: tokens, cachedTokensReported: cached });
        ext = parsed;
      }
      perStrategy.push({ phase_a_scope: scope, extraction: ext });
    }

    const vault = { video_id: vid, phase_a: { counts, mode, mode_n: modeN, unstable, consensus }, phase_b: perStrategy };
    writeFileSync(`${vaultDir}/${vid}.json`, JSON.stringify(vault, null, 1));
    summary.videos[vid] = { enum_counts: counts, mode, mode_n: modeN, unstable, n_strategies: strategies.length, spent_so_far: spent };
    console.log(`  ${vid}: enum=[${counts.join(",")}] mode=${mode}(${modeN}/5)${unstable ? " UNSTABLE" : ""} strategies=${strategies.length} | spent ${spent}/${cap}`);
  }
  writeFileSync(`${outDir}/extraction_summary.json`, JSON.stringify(summary, null, 1));
  console.log(`\nEXTRACTION DONE for ${videos.length} videos. spent ${spent}/${cap}. Vault: ${vaultDir}`);
  console.log("Next: Python locator-support measurement over the vault (the <=8% bar).");
}

main().catch((e) => {
  const msg = String(e?.message ?? e);
  if (/BLOCKED/.test(msg)) { console.log(`\n[GOVERNOR] partition wall hit — pausing, resume tomorrow (designed rhythm):\n${msg}`); process.exit(0); }
  console.error("DESIGNPOOL FAILED:", msg); process.exit(1);
});
