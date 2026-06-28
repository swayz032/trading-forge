/**
 * Fidelity Phase 1 re-run: apply the confirmation-compiler to the frozen 6 + emit enriched compiled
 * payloads (old logic + the compiled confirmation predicate) for re-grading. Reports disposition.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { compileConfirmation } from "../src/server/lib/confirmation-compiler.js";
import { extractSessionFromTranscript } from "../src/server/lib/session-filter.js";

const SIX: Array<{ id: string; dir: string }> = [
  { id: "O9czLS8lv4U", dir: "tmp/generalization" },
  { id: "yAMaiOI9cmc", dir: "tmp/generalization" },
  { id: "sv-ixHXUTSQ", dir: "tmp/generalization" },
  { id: "TMVHO4sgo70", dir: "tmp/generalization" },
  { id: "2u9oYfx5xdY", dir: "tmp/generalization" },
  { id: "iU8ww5MC2FQ", dir: "tmp/validate5" },
];
const OUT = "C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/3bf52c13-bffa-4488-95b7-d0ad5f0a1463/scratchpad/fidelity";
mkdirSync(OUT, { recursive: true });

for (const { id, dir } of SIX) {
  const rp = join(dir, `${id}.result.json`);
  const tp = join(dir, `${id}.transcript.txt`);
  if (!existsSync(rp)) { console.log(`${id}: no result`); continue; }
  const idea = (JSON.parse(readFileSync(rp, "utf8")).ideas ?? [])[0] ?? {};
  const transcript = existsSync(tp) ? readFileSync(tp, "utf8") : "";
  const r = compileConfirmation({
    transcript,
    entry_sequence: idea.entry_sequence,
    confluences: (idea.confluences ?? []).map((c: { name?: string }) => c?.name ?? ""),
    direction_class: idea.direction_class ?? idea.direction,
  });
  if (r.compiled) {
    console.log(`${id.padEnd(13)} COMPILE  ${r.compiled.kind.padEnd(16)} level=${String(r.compiled.level_ref).padEnd(18)} conf=${r.compiled.confluence ?? "-"}`);
    console.log(`              scl=${r.scl} edge=${r.edge_specificity} pred=${r.predicate_specificity} legs=${r.multi_leg_gap}`);
    console.log(`              quote: "${r.compiled.evidence_quote.slice(0, 110)}"`);
    // enriched payload for re-grade = original compiled logic + the explicit confirmation predicate
    const enriched = { ...idea, _phase1_confirmation: r.compiled };
    writeFileSync(join(OUT, `${id}.enriched.json`), JSON.stringify({
      concept_name: idea.concept_name, direction: idea.direction, direction_class: idea.direction_class,
      timeframe: idea.timeframe, session_window: extractSessionFromTranscript(transcript), entry_indicator: idea.entry_indicator,
      entry_sequence: idea.entry_sequence, confluences: (idea.confluences ?? []).map((c: { name?: string }) => c?.name),
      PHASE1_CONFIRMATION_TRIGGER: r.compiled,
    }, null, 2));
  } else {
    console.log(`${id.padEnd(13)} QUARANTINE  ${r.quarantine_reason}`);
  }
}
