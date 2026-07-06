/**
 * CORPUS V3 — HELD-OUT SPLIT (Step 2, 2026-07-05)
 *
 * Deterministic, reproducible 70/30 split of the 221 DRI-audited conditions
 * (docs/replay-results/dri-audit-2026-07-05.json -> full_classification_table_first_pass)
 * per docs/designs/corpus-v3-IMPLEMENTATION-PLAN-2026-07-05.md Step 2 + the operator's
 * runtime instruction: sha256(condition_id) low-byte mod 10 < 3 -> held-out.
 *
 * NO RNG. Bucket assignment is a pure function of condition_id text — re-running this
 * script on the same input JSON always reproduces the identical split.
 *
 * ONLY the rules-design (70%) set may inform gate-strength.ts's deterministic pattern
 * lists. The held-out (30%) set is untouchable until Gate 1 (gate-strength.test.ts) runs.
 *
 * Known non-uniqueness note (disclosed, not hidden): condition_id is NOT globally unique
 * across videos (5 of 221 rows share a condition_id with one other row from a different
 * video — e.g. "WAIT_STRUCTURE:vwap#0" appears in both N7uP9V0Iktc and ktkqq7QsN9Q). The
 * task instruction specifies sha256(condition_id) literally, so those 5 duplicate pairs
 * are forced into the SAME bucket (10/221 rows, 4.5%). This is a minor, disclosed
 * deviation-risk from a perfectly i.i.d. split — not corrected, per the literal
 * instruction to hash condition_id (not video+condition_id).
 *
 * Usage: npx tsx scripts/corpus-v3-heldout-split.ts
 */
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const IN_PATH = join("docs/replay-results", "dri-audit-2026-07-05.json");
const OUT_PATH = join("docs/replay-results", "corpus-v3-heldout-split-2026-07-05.json");

type Classification = "JUSTIFIED_MANDATORY" | "OPTIONAL" | "ALTERNATIVE" | "CONTEXTUAL" | "UNRESOLVED";

interface DriRow {
  video: string;
  condition_id: string;
  type: string;
  object: string;
  classification: Classification;
  quote: string;
  rationale?: string;
}

/** The FIXED deterministic split function. sha256(condition_id) low-byte mod 10 < 3 -> held-out. */
export function isHeldOut(conditionId: string): boolean {
  const digest = createHash("sha256").update(conditionId).digest();
  const lowByte = digest[digest.length - 1]; // low byte of the digest
  return lowByte % 10 < 3;
}

function main() {
  const raw = JSON.parse(readFileSync(IN_PATH, "utf8")) as {
    full_classification_table_first_pass: DriRow[];
  };
  const rows = raw.full_classification_table_first_pass;
  if (rows.length !== 221) {
    console.error(`WARNING: expected 221 DRI-labeled conditions, found ${rows.length}`);
  }

  const heldOut: DriRow[] = [];
  const rulesDesign: DriRow[] = [];
  for (const r of rows) (isHeldOut(r.condition_id) ? heldOut : rulesDesign).push(r);

  const perClass = (set: DriRow[]) => {
    const counts: Record<string, number> = {};
    for (const r of set) counts[r.classification] = (counts[r.classification] ?? 0) + 1;
    return counts;
  };

  const key = (r: DriRow) => `${r.video}||${r.condition_id}`;

  const out = {
    generated_at: new Date().toISOString(),
    source_file: IN_PATH,
    method: "sha256(condition_id) low-byte mod 10 < 3 -> held-out (no RNG, deterministic, reproducible)",
    total: rows.length,
    held_out_count: heldOut.length,
    rules_design_count: rulesDesign.length,
    held_out_pct: Math.round((heldOut.length / rows.length) * 1000) / 1000,
    per_class_counts: {
      held_out: perClass(heldOut),
      rules_design: perClass(rulesDesign),
      total: perClass(rows),
    },
    // video||condition_id composite keys so downstream consumers (gate-strength.test.ts) can
    // unambiguously look each row back up even where bare condition_id repeats across videos.
    held_out_keys: heldOut.map(key).sort(),
    rules_design_keys: rulesDesign.map(key).sort(),
    duplicate_condition_id_note:
      "5 condition_id values repeat across 2 videos each (10/221 rows, 4.5%); the split function hashes " +
      "condition_id literally per instruction, so each duplicate pair lands in the SAME bucket together.",
  };

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`  total=${out.total}  held_out=${out.held_out_count} (${(out.held_out_pct * 100).toFixed(1)}%)  rules_design=${out.rules_design_count}`);
  console.log(`  held_out per-class:`, out.per_class_counts.held_out);
  console.log(`  rules_design per-class:`, out.per_class_counts.rules_design);
}

main();
