/**
 * E-VALIDATE fast-grade (2026-06-22) — INSTANT re-grade of cached gemma output.
 *
 * The slow part of validation is gemma (≈10-15 inference calls/video on one 8GB GPU). The
 * gate logic (computeCoverageVerdict + checkCompilabilityGate) is PURE. This script re-runs the
 * pure gate on the CACHED gemma output (tmp/validate5/<vid>.result.json, which now carries
 * _coverage_speaker_items + ideas) using the CURRENT code — so a gate-logic fix is graded in
 * milliseconds with no gemma, no server reload, no background wait.
 *
 * Re-run the slow harness ONLY when changing the extraction/enumeration prompts (gemma-side).
 *
 * Usage: tsx scripts/fast-grade.ts
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import {
  computeCoverageVerdict,
  type SpeakerItem,
  type ExtractionSnapshot,
} from "../src/server/lib/extraction-coverage-gate.js";
import { checkCompilabilityGate } from "../src/server/lib/extraction-quality-gate.js";

const DIR = "tmp/validate5";
if (!existsSync(DIR)) {
  console.error(`no cache dir ${DIR} — run scripts/validate-5url-extraction.ts first (slow, one time)`);
  process.exit(1);
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".result.json"));
let pass = 0;
const rows: string[] = [];

for (const f of files) {
  const vid = f.replace(".result.json", "");
  let r: {
    ideas?: Array<Record<string, unknown>>;
    _coverage_speaker_items?: SpeakerItem[];
  };
  try {
    r = JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"));
  } catch {
    rows.push(`${vid}: BAD CACHE`);
    continue;
  }
  const speakerItems = Array.isArray(r._coverage_speaker_items) ? r._coverage_speaker_items : null;
  const idea0 = (r.ideas ?? [])[0] as Record<string, unknown> | undefined;
  if (!idea0) {
    rows.push(`${vid}: no ideas`);
    continue;
  }
  if (!speakerItems) {
    rows.push(`${vid}: cache predates _coverage_speaker_items — re-run slow harness once`);
    continue;
  }

  // Re-grade with CURRENT gate code (pure, instant).
  const verdict = computeCoverageVerdict(speakerItems, idea0 as ExtractionSnapshot);
  const confluence_factors = Array.isArray(idea0.confluences)
    ? (idea0.confluences as Array<{ name?: string }>).map((c) => c?.name ?? "").filter((n) => n.length > 0)
    : [];
  const gate = checkCompilabilityGate(
    {
      entry_indicator: (idea0.entry_indicator as string) ?? null,
      archetype: (idea0.entry_archetype as string) ?? null,
      entry_params: (idea0.entry_params as Record<string, unknown>) ?? null,
      direction: (idea0.direction as string) ?? null,
      timeframe: (idea0.timeframe as string) ?? null,
      confluence_factors,
      coverage_verdict: verdict,
    },
    (idea0.concept_name as string) ?? null,
  );

  const name = (idea0.concept_name as string) ?? (idea0.name as string) ?? "(none)";
  const generic = !name || /^extracted(_strategy)?$/i.test(name);
  const isPass = verdict.verdict === "pass" && gate.compilable && !generic;
  if (isPass) pass++;

  rows.push(
    `${isPass ? "✅ PASS" : "❌ FAIL"}  ${vid}  cov=${verdict.verdict}/${(verdict.coverage_pct * 100).toFixed(0)}% ` +
      `compilable=${gate.compilable} name=${name} ei=${idea0.entry_indicator ?? "null"}` +
      (isPass ? "" : `  [${gate.missing.join(",") || verdict.verdict}]`),
  );
}

console.log(rows.sort().join("\n"));
console.log(`\n=== ${pass} / ${files.length} PASS (target 8) ===`);
