/**
 * Offline coverage re-grade — 2026-06-24 evaluator-polish verification.
 *
 * computeCoverageVerdict() is PURE: (rawSpeakerItems, extractionSnapshot) -> verdict.
 * The 14-video benchmark run persisted both inputs into tmp/validate5/*.result.json
 * (`_coverage_speaker_items` + `ideas[0]`). So we can re-grade with the CURRENT comparator
 * code deterministically — no gemma, no dev server, no W4.2 supervisor risk.
 *
 * Prints before (stored coverage_verdict) vs after (re-graded) per video + the delta.
 * Run: npx tsx scripts/offline-regrade-coverage.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computeCoverageVerdict, type SpeakerItem, type ExtractionSnapshot } from "../src/server/lib/extraction-coverage-gate.js";

const DIR = join(process.cwd(), "tmp", "validate5");
const files = readdirSync(DIR).filter((f) => f.endsWith(".result.json")).sort();

let beforeSum = 0;
let afterSum = 0;
let beforePass = 0;
let afterPass = 0;
let n = 0;
const rows: string[] = [];

for (const f of files) {
  const vid = f.replace(".result.json", "");
  const r = JSON.parse(readFileSync(join(DIR, f), "utf8")) as Record<string, unknown>;
  const rawItems = (r._coverage_speaker_items ?? []) as SpeakerItem[];
  const ideas = (r.ideas ?? []) as ExtractionSnapshot[];
  const snapshot = ideas[0] ?? ({} as ExtractionSnapshot);
  const storedVerdict = r.coverage_verdict as { coverage_pct?: number; verdict?: string } | undefined;

  // Skip the harness-drop artifact (0 enumerated items = dev-server drop, the W4.2 gap).
  if (rawItems.length === 0) {
    rows.push(`${vid.padEnd(14)}  [skipped — harness server-drop artifact, 0 speaker_items]`);
    continue;
  }

  const before = storedVerdict?.coverage_pct != null ? storedVerdict.coverage_pct * 100 : NaN;
  const beforeV = storedVerdict?.verdict ?? "?";
  const after = computeCoverageVerdict(rawItems, snapshot);
  const afterPct = after.coverage_pct * 100;

  n++;
  beforeSum += before;
  afterSum += afterPct;
  if (beforeV === "pass") beforePass++;
  if (after.verdict === "pass") afterPass++;

  const delta = afterPct - before;
  const flag = Math.abs(delta) > 0.05 ? (delta > 0 ? "  ↑" : "  ↓ REGRESSION") : "";
  rows.push(
    `${vid.padEnd(14)} before ${before.toFixed(1).padStart(5)} ${beforeV.padEnd(15)} →  after ${afterPct.toFixed(1).padStart(5)} ${after.verdict.padEnd(15)} Δ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}${flag}` +
      (after.missing.length ? `   missing: ${after.missing.join("; ")}` : ""),
  );
}

console.log(rows.join("\n"));
console.log("\n" + "=".repeat(70));
console.log(`AVG coverage:  before ${(beforeSum / n).toFixed(1)}%  →  after ${(afterSum / n).toFixed(1)}%   (Δ${(afterSum / n - beforeSum / n >= 0 ? "+" : "")}${(afterSum / n - beforeSum / n).toFixed(1)})`);
console.log(`PASS count:    before ${beforePass}/${n}  →  after ${afterPass}/${n}`);
