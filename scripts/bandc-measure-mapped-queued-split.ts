/**
 * bandc-measure-mapped-queued-split.ts — Band C measurement CLI.
 *
 * Reports the REAL mapped/queued split across the full sample corpus,
 * comparing Band B's archetype-only routing against Band C's
 * archetype + condition-family-compiler routing. Dry-run only (no DB writes,
 * no playbook registration side effects — reads specs, computes routing
 * decisions, prints a summary table).
 *
 * Usage: DATABASE_URL=<placeholder> npx tsx scripts/bandc-measure-mapped-queued-split.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { matchArchetype } from "../src/server/lib/spec-archetype-matcher.js";
import { compileBindingPlan } from "../src/server/lib/spec-family-bindings.js";

const SAMPLES_DIR =
  "C:\\Users\\tonio\\Projects\\trading-forge\\trading-forge\\.claude\\worktrees\\extraction-100\\tmp\\generalization";

function main() {
  const files = readdirSync(SAMPLES_DIR).filter((f) => f.endsWith(".spec.json"));

  let archetypeMapped = 0;
  let conditionCompiled = 0;
  let stillQueued = 0;

  const rows: Array<{ file: string; outcome: string; detail: string }> = [];

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(SAMPLES_DIR, file), "utf-8"));
    const spec = raw.spec;
    const match = matchArchetype(spec.entry_conditions ?? []);

    if (match.matched) {
      archetypeMapped += 1;
      rows.push({ file, outcome: "ARCHETYPE_MAPPED", detail: `archetype:${match.archetypeKey}` });
      continue;
    }

    const plan = compileBindingPlan({
      entry_conditions: spec.entry_conditions,
      invalidations: spec.invalidations,
      entry_trigger_id: spec.entry_trigger_id,
    });

    if (plan.compiled) {
      conditionCompiled += 1;
      rows.push({
        file,
        outcome: "CONDITION_COMPILED",
        detail: `spine ${plan.spineBound}/${plan.spineTotal} bound, approx=${plan.approximationUsed}`,
      });
    } else {
      stillQueued += 1;
      const reasons = plan.queueReasons.map((r) => r.reason).join(",") || "no_binding_plan";
      rows.push({ file, outcome: "NEEDS_ARCHETYPE", detail: reasons });
    }
  }

  console.log("=== Band C mapped/queued measurement (real CLI output) ===\n");
  for (const r of rows) {
    console.log(`${r.file.padEnd(24)} ${r.outcome.padEnd(20)} ${r.detail}`);
  }

  const total = files.length;
  console.log("\n=== Summary ===");
  console.log(`Total samples:            ${total}`);
  console.log(`Archetype-mapped (Band B): ${archetypeMapped}`);
  console.log(`Condition-compiled (Band C, NEW): ${conditionCompiled}`);
  console.log(`Still queued to needs_archetype: ${stillQueued}`);
  console.log(`\nBand B baseline was 6 mapped / ${total - archetypeMapped >= 0 ? total - archetypeMapped : "?"} queued (archetype-only).`);
  console.log(
    `Band C result: ${archetypeMapped + conditionCompiled} executable (${archetypeMapped} archetype + ${conditionCompiled} condition-compiled) / ${stillQueued} still queued.`,
  );
}

main();
