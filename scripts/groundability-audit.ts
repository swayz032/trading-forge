/**
 * GROUNDABILITY AUDIT (2026-06-30) — Stage 1+2 of the semantic-grounding track (operator/GPT: report before code).
 *
 * Reads the persisted n=8 condition vocabulary (docs/designs/condition-vocab-n8-2026-06-30.json — the actual
 * objects the compiler emitted across the corpus), classifies every condition via condition-grounding.ts, and
 * emits the Groundability Coverage report: per-family × per-status counts, the coverage metric, per-transcript
 * coverage, and the explicit list of ungroundable objects (the work queue for evaluator building).
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/groundability-audit.ts
 * Writes: docs/designs/groundability-audit-n8-2026-06-30.md
 */
import { readFileSync, writeFileSync } from "fs";
import { classifyCondition, groundabilityCoverage, type Groundability } from "../src/server/lib/condition-grounding.js";

const vocab: Record<string, Array<{ type: string; object: string }>> =
  JSON.parse(readFileSync("docs/designs/condition-vocab-n8-2026-06-30.json", "utf-8"));

const allObjects = Object.values(vocab).flat().map((c) => c.object);
const overall = groundabilityCoverage(allObjects);

const STATUSES: Groundability[] = ["native", "composite", "needs_new", "ambiguous"];
const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) + "%" : "—");

const lines: string[] = [];
lines.push(`# Groundability audit — n=8 corpus (2026-06-30)`);
lines.push(``);
lines.push(`Stage 1+2 of the semantic-grounding track: every condition object the compiler emitted across the`);
lines.push(`n=8 corpus, classified against the engine's REAL primitives (structure_engine / liquidity-map /`);
lines.push(`indicator-catalog DSL archetypes / killzone / htf_narrative / bias_engine / smt_divergence / DSL`);
lines.push(`bar-comparisons). Statuses: native (evaluator exists) / composite (combinable from existing) /`);
lines.push(`needs_new (no path) / ambiguous (too vague to bind).`);
lines.push(``);
lines.push(`## Overall Groundability Coverage`);
lines.push(``);
lines.push(`**${overall.coverage_pct}%** of ${overall.total} conditions ground to existing engine machinery` +
  ` (native ${overall.by_status.native} + composite ${overall.by_status.composite});` +
  ` needs_new ${overall.by_status.needs_new}, ambiguous ${overall.by_status.ambiguous}.`);
lines.push(``);
lines.push(`## By semantic family`);
lines.push(``);
lines.push(`| family | native | composite | needs_new | ambiguous | total | grounded |`);
lines.push(`|---|---|---|---|---|---|---|`);
for (const [fam, counts] of Object.entries(overall.by_family).sort((a, b) => {
  const tot = (x: Record<Groundability, number>) => STATUSES.reduce((s, k) => s + x[k], 0);
  return tot(b[1]) - tot(a[1]);
})) {
  const total = STATUSES.reduce((s, k) => s + counts[k], 0);
  lines.push(`| ${fam} | ${counts.native} | ${counts.composite} | ${counts.needs_new} | ${counts.ambiguous} | ${total} | ${pct(counts.native + counts.composite, total)} |`);
}
lines.push(``);
lines.push(`## Per transcript`);
lines.push(``);
lines.push(`| transcript | conditions | coverage | needs_new | ambiguous |`);
lines.push(`|---|---|---|---|---|`);
for (const [video, conds] of Object.entries(vocab)) {
  const r = groundabilityCoverage(conds.map((c) => c.object));
  lines.push(`| ${video} | ${r.total} | ${r.coverage_pct}% | ${r.by_status.needs_new} | ${r.by_status.ambiguous} |`);
}
lines.push(``);
lines.push(`## Ungroundable conditions (the explicit work queue — nothing silently dropped)`);
lines.push(``);
lines.push(`### needs_new (${overall.ungrounded.filter((u) => u.status === "needs_new").length})`);
for (const u of overall.ungrounded.filter((x) => x.status === "needs_new"))
  lines.push(`- [${u.family}] ${u.object} — ${classifyCondition(u.object).evaluator}`);
lines.push(``);
const amb = overall.ungrounded.filter((x) => x.status === "ambiguous");
lines.push(`### ambiguous (${amb.length})`);
for (const u of amb.slice(0, 60)) lines.push(`- ${u.object}`);
if (amb.length > 60) lines.push(`- … +${amb.length - 60} more`);
lines.push(``);
lines.push(`## Next (Stage 3 — Ledger F live)`);
lines.push(``);
lines.push(`\`ledgerF(spec)\` (condition-grounding.ts) already enforces: every condition classified exactly once,`);
lines.push(`ungroundable explicitly reported, framework leakage cross-checked. Raising coverage = building the`);
lines.push(`needs_new evaluators + tightening compression on the ambiguous tail (many ambiguous objects are`);
lines.push(`vague predicates that should have folded — a compression refinement, not an evaluator gap).`);
lines.push(``);

writeFileSync("docs/designs/groundability-audit-n8-2026-06-30.md", lines.join("\n"));
console.log(lines.join("\n"));
