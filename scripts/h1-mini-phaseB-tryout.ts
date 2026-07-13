/**
 * h1-mini-phaseB-tryout.ts — the MINI's copy-typing qualifier (2026-07-13).
 *
 * The mini failed the JUDGMENT exam (Phase-A enumeration). Copying is a different
 * skill. The role-split contingency (gpt-5.4 enumerates, mini copies) needs
 * evidence the mini is strong at Phase-B. This is that probe:
 *   - Scope = gpt-5.4's CERTIFIED consensus enumerations (birth vault), NOT the
 *     mini's own Phase-A (it's disqualified from judgment).
 *   - The mini extracts each strategy's conditions (Phase-B) on the 6 birth videos.
 *   - Judged MECHANICALLY (no raters, no measurement pass): the Python locator
 *     anchor-rate + F-2 floor + WEh variant-B present + -igp FVG endpoints. The
 *     model-free instruments are the judges — they do not care which brain erred.
 * Runs on the mini's OWN pool (2.5M/day, barely touched) — zero contention with
 * the gpt-5.4 design-pool. Governor-walled + cached like everything else.
 */
import OpenAI from "openai";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolvePoolPartition, readTodaySpend, recordSpend, evaluateWithBurst } from "../src/server/lib/extraction-token-governor";
import { ExtractionResultCache, promptHash, cacheKey } from "../src/server/lib/extraction-result-cache";

const ROOT = process.cwd();
const MODEL = "gpt-5.4-mini";
const POOL = "mini" as const;
const BIRTH6 = ["WEhmadJArQo", "R5L890juvRw", "IyFioFkRgWo", "4cT8WTyxhYY", "E9MzEC_yNoM", "-igpOZs8LsM"];

function envKey(): string {
  const line = readFileSync(`${ROOT}/.env`, "utf8").split(/\r?\n/).find((l) => l.startsWith("OPENAI_API_KEY="));
  const k = line ? line.slice("OPENAI_API_KEY=".length) : ""; if (!k) throw new Error("no key"); return k;
}
function transcriptText(id: string): string {
  const d = JSON.parse(readFileSync(`${ROOT}/docs/replay-results/h1-scripts/pilot-run/transcripts/${id}.json`, "utf8"));
  if (typeof d?.text === "string") return d.text;
  for (const k of ["transcript", "segments", "content"]) { const v = d?.[k]; if (typeof v === "string") return v; if (Array.isArray(v)) return v.map((s: any) => (typeof s === "string" ? s : s?.text ?? "")).join(" "); }
  return Array.isArray(d) ? d.map((s: any) => s?.text ?? "").join(" ") : JSON.stringify(d);
}
function strictify(node: any): any {
  if (Array.isArray(node)) return node.map(strictify);
  if (node && typeof node === "object") { const o: any = {}; for (const [k, v] of Object.entries(node)) o[k] = strictify(v); if (o.type === "object" && o.properties) { o.additionalProperties = false; o.required = Object.keys(o.properties); } return o; }
  return node;
}
/** gpt-5.4's certified consensus enumeration for a birth video (the scope source). */
function certifiedEnum(vid: string): any[] {
  const p = `${ROOT}/docs/replay-results/h1-scripts/frontier-birth-gate/consensus_gpt-5_4_${vid}.json`;
  if (!existsSync(p)) return [];
  const c = JSON.parse(readFileSync(p, "utf8")).canonical;
  return Array.isArray(c?.strategies) ? c.strategies : [];
}

async function main() {
  const client = new OpenAI({ apiKey: envKey() });
  const extPrompt = readFileSync(`${ROOT}/src/agents/transcript-extractor-minimal.md`, "utf8");
  const extSchema = strictify(JSON.parse(readFileSync(`${ROOT}/src/agents/kb/transcript-extractor-minimal-schema.json`, "utf8")));
  const extHash = promptHash(extPrompt);
  const outDir = `${ROOT}/docs/replay-results/h1-scripts/mini-phaseB-tryout`;
  const vaultDir = `${outDir}/vault`; mkdirSync(vaultDir, { recursive: true });
  const cache = new ExtractionResultCache(`${outDir}/result-cache`);
  const cap = resolvePoolPartition(POOL);
  const LEDGER = `${ROOT}/docs/replay-results/h1-scripts/frontier-daily-ledger.json`;
  const now = new Date();
  let spent = readTodaySpend(LEDGER, POOL, now);
  console.log(`=== MINI Phase-B tryout (pool ${POOL}, partition ${cap}, spent ${spent}) ===`);

  const summary: any = { model: MODEL, videos: {} };
  for (const vid of BIRTH6) {
    const tx = transcriptText(vid);
    const strategies = certifiedEnum(vid);
    const perStrategy: any[] = [];
    for (let si = 0; si < strategies.length; si++) {
      const s = strategies[si];
      const scope = { entry_summary: s?.entry_summary ?? "", exit_summary: s?.exit_summary ?? "", name: s?.name ?? `strategy_${si}` };
      const bHash = `${extHash}__miniB__s${si}`;
      const cb = cache.get<any>(MODEL, vid, bHash);
      let ext: any;
      if (cb) ext = cb.result;
      else {
        const estimate = Math.ceil(tx.length / 4) + 3500;
        const be = evaluateWithBurst(spent, estimate, cap, null, now); // mini: free-only, no burst
        if (!be.allow) throw new Error(`[governor] BLOCKED: ${be.reason}`);
        const resp = await client.chat.completions.create({
          model: MODEL,
          messages: [{ role: "system", content: extPrompt }, { role: "user", content: `TRANSCRIPT:\n${tx}\n\nSCOPE — extract ONLY this one strategy's conditions:\n${JSON.stringify(scope)}\n\nReturn ONLY the JSON object.` }],
          response_format: { type: "json_schema", json_schema: { name: "MinimalExtractorOutput", schema: extSchema, strict: true } },
        });
        const t = resp.usage?.total_tokens ?? 0; spent += t; recordSpend(LEDGER, POOL, now, t);
        ext = JSON.parse(resp.choices[0]?.message?.content ?? "{}");
        cache.put({ key: cacheKey(MODEL, vid, bHash), model: MODEL, videoId: vid, promptHash: bHash, result: ext, originalTokens: t, cachedTokensReported: (resp.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0 });
      }
      perStrategy.push({ scope, extraction: ext });
    }
    writeFileSync(`${vaultDir}/${vid}.json`, JSON.stringify({ video_id: vid, phase_b: perStrategy }, null, 1));
    summary.videos[vid] = { n_strategies: strategies.length, spent };
    console.log(`  ${vid}: ${strategies.length} strategies copied | spent ${spent}/${cap}`);
  }
  writeFileSync(`${outDir}/mini_extraction_summary.json`, JSON.stringify(summary, null, 1));
  console.log(`\nMINI Phase-B DONE. spent ${spent}/${cap}. Next: Python mechanical judges (locator anchor-rate + F-2 + variant-B + FVG-endpoints).`);
}
main().catch((e) => { const m = String(e?.message ?? e); if (/BLOCKED/.test(m)) { console.log(`[governor] wall: ${m}`); process.exit(0); } console.error("MINI TRYOUT FAILED:", m); process.exit(1); });
