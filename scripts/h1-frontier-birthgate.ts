/**
 * h1-frontier-birthgate.ts — PARALLEL rung-1/1.5 birth gate (2026-07-13).
 *
 * Both OpenAI brains (gpt-5.4-mini rung-1, gpt-5.4 rung-1.5) sit the 6-fixture
 * Phase-A enumeration exam under the AMENDED 3-rule instrument, EVERY call walled
 * by the PROVEN governor (fail-closed). Judged against the re-minted windows.
 * Content-condition survival is Claude's grading seat (separate, downstream) —
 * this driver scores COUNT-IN-WINDOW mechanically and records receipts.
 *
 * Run: npx tsx scripts/h1-frontier-birthgate.ts
 */
import OpenAI from "openai";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolvePoolPartition, assertExtractionBudgetOrThrow } from "../src/server/lib/extraction-token-governor";

const ROOT = process.cwd();
function envKey(): string {
  const line = readFileSync(`${ROOT}/.env`, "utf8").split(/\r?\n/).find((l) => l.startsWith("OPENAI_API_KEY="));
  const k = line ? line.slice("OPENAI_API_KEY=".length) : "";
  if (!k) throw new Error("OPENAI_API_KEY missing from .env");
  return k;
}

const FIXTURES: { id: string; lo: number; hi: number; rule: string }[] = [
  { id: "WEhmadJArQo", lo: 1, hi: 2, rule: "Rule3 compatible" },
  { id: "R5L890juvRw", lo: 2, hi: 2, rule: "Rule2 opposition" },
  { id: "IyFioFkRgWo", lo: 1, hi: 1, rule: "Rule1 breakdown=mention" },
  { id: "4cT8WTyxhYY", lo: 1, hi: 1, rule: "Rule3 filters+Rule1" },
  { id: "E9MzEC_yNoM", lo: 2, hi: 3, rule: "Rule2 sweep separate" },
  { id: "-igpOZs8LsM", lo: 1, hi: 1, rule: "Rule1 others deferred" },
];
const MODELS: { id: string; pool: "mini" | "gpt54"; rung: string }[] = [
  { id: "gpt-5.4-mini", pool: "mini", rung: "rung-1" },
  { id: "gpt-5.4", pool: "gpt54", rung: "rung-1.5" },
];

/**
 * strictify — CALL-TIME transform to OpenAI strict-json-schema shape (every object
 * lists ALL properties in `required` + additionalProperties:false). This is
 * POST-PROCESSING at the call boundary per the schema-is-boundary law — the
 * CANONICAL schema on disk is NEVER edited. Optionality is preserved by the
 * schema's existing nullable ["type","null"] unions, which strict mode honors.
 */
function strictify(node: any): any {
  if (Array.isArray(node)) return node.map(strictify);
  if (node && typeof node === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(node)) out[k] = strictify(v);
    if (out.type === "object" && out.properties) {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties);
    }
    return out;
  }
  return node;
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

async function main() {
  const client = new OpenAI({ apiKey: envKey() });
  const prompt = readFileSync(`${ROOT}/src/agents/strategy-enumerator.md`, "utf8");
  const canonicalSchema = JSON.parse(readFileSync(`${ROOT}/src/agents/kb/strategy-enumerator-schema.json`, "utf8"));
  const schema = strictify(canonicalSchema); // call-time conformance; canonical untouched
  const outDir = `${ROOT}/docs/replay-results/h1-scripts/frontier-birth-gate`;
  mkdirSync(outDir, { recursive: true });

  const report: any = { generated_note: "rung-1/1.5 parallel birth gate", models: {} };

  for (const m of MODELS) {
    const cap = resolvePoolPartition(m.pool);
    let spent = 0; // in-run cumulative (fail-closed accounting; production reads ai_inference_log)
    const rows: any[] = [];
    console.log(`\n=== ${m.rung}: ${m.id} (pool ${m.pool}, partition ${cap}) ===`);
    for (const fx of FIXTURES) {
      const tx = transcriptText(fx.id);
      const estimate = Math.ceil(tx.length / 4) + 3500; // upper-ish estimate for the wall
      assertExtractionBudgetOrThrow({ tokensSpentToday: spent, requestedTokens: estimate, partitionCap: cap });
      let count = -1, tokens = 0, err: string | null = null, note = "";
      try {
        const resp = await client.chat.completions.create({
          model: m.id,
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: `TRANSCRIPT:\n${tx}\n\nEnumerate the distinct strategies per the three canonical rules. Return ONLY the JSON object.` },
          ],
          response_format: { type: "json_schema", json_schema: { name: "StrategyEnumeratorOutput", schema, strict: true } },
        });
        tokens = resp.usage?.total_tokens ?? 0;
        spent += tokens;
        const parsed = JSON.parse(resp.choices[0]?.message?.content ?? "{}");
        count = Array.isArray(parsed?.strategies) ? parsed.strategies.length : -1;
        note = parsed?.enumeration_note ?? "";
        writeFileSync(`${outDir}/enum_${m.id.replace(/\./g, "_")}_${fx.id}.json`, JSON.stringify(parsed, null, 1));
      } catch (e: any) {
        err = String(e?.message ?? e).slice(0, 200);
      }
      const inWindow = count >= fx.lo && count <= fx.hi;
      rows.push({ fixture: fx.id, window: `${fx.lo}-${fx.hi}`, rule: fx.rule, count, in_window: inWindow, tokens, error: err });
      console.log(`  ${fx.id}: count=${count} window=${fx.lo}-${fx.hi} ${inWindow ? "IN" : "OUT"} (${tokens} tok)${err ? " ERR:" + err : ""}`);
    }
    const passed = rows.filter((r) => r.in_window).length;
    report.models[m.id] = { rung: m.rung, pool: m.pool, partition: cap, tokens_spent: spent, count_in_window: `${passed}/6`, rows };
    console.log(`  ${m.id}: COUNT-in-window ${passed}/6, ${spent} tokens spent (partition ${cap})`);
  }

  writeFileSync(`${outDir}/rung1_birthgate_report.json`, JSON.stringify(report, null, 1));
  console.log(`\nreport: ${outDir}/rung1_birthgate_report.json`);
  console.log("NOTE: count-in-window is mechanical; content-condition survival is Claude's grading seat (next step).");
}

main().catch((e) => { console.error("BIRTH GATE FAILED:", e); process.exit(1); });
