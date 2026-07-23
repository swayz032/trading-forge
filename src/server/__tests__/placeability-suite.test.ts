/**
 * PLACEABILITY REGRESSION SUITE (2026-06-24 Layer 2).
 *
 * Runs the deterministic placeability scorer across all benchmark caches and prints a scoreboard +
 * failure-reason histogram + direction-label histogram. This operationalizes the blind-reconstruction
 * finding as a repeatable metric (the LLM blind pass remains the semantic ground-truth check + the
 * SOURCE_VAGUE/garbled-trigger detector that field-completeness cannot see).
 *
 * Coverage / Placeability / Compilability are measured SEPARATELY here (operator Layer 2). The
 * histograms tell Layer 3 exactly what to fix and in what order.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
vi.hoisted(() => {
  process.env.DATABASE_URL ||= "postgresql://x:x@localhost:5432/x";
});
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { scorePlaceability, type PlaceabilityFailureReason } from "../lib/placeability-score.js";
import { extractSessionFromTranscript } from "../lib/session-filter.js";
import { classifyDirectionFromTranscript } from "../lib/direction-parity.js";
import { scanIndicatorParams } from "../lib/indicator-params.js";
import { computeCoverageVerdict, type SpeakerItem, type ExtractionSnapshot } from "../lib/extraction-coverage-gate.js";

const CACHE_DIR = join(process.cwd(), "tmp", "validate5");
const VIDS = [
  "rf_EQvubKlk", "gddYspvW0_w", "FqxEKDxemtI", "N7uP9V0Iktc", "75DJN5UVQnw", "sZFdrxdVTMk",
  "UBvfsImdI2U", "2LnFWQ10-0E", "z3Qn3fBoe2I", "iU8ww5MC2FQ", "SY2jXlW9bt4", "D1Ipi8Cfl8o",
  "W7nlnHTUZQU", "ktkqq7QsN9Q",
];
const HAS_BENCHMARK_CACHE = VIDS.every((vid) =>
  existsSync(join(CACHE_DIR, `${vid}.result.json`)) && existsSync(join(CACHE_DIR, `${vid}.transcript.txt`)),
);

// deriveEntryIndicator lives in the DB-coupled graduator — load it dynamically after setting a
// dummy DATABASE_URL so this pure-data test can run without a real DB.
let deriveEntryIndicator: (cn: string, fb: string | null, llm?: string | null) => string | null;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://x:x@localhost:5432/x";
  const grad = await import("../services/direct-bucket-graduator.js");
  deriveEntryIndicator = grad.deriveEntryIndicator;
});

function loadCache(vid: string): Record<string, unknown> | null {
  const p = join(CACHE_DIR, `${vid}.result.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe.skipIf(!HAS_BENCHMARK_CACHE)("PLACEABILITY regression suite — Coverage vs Placeability vs Compilability", () => {
  it("scores all benchmark caches + prints failure-reason histogram", () => {
    const rows: string[] = [];
    const failureHist: Record<string, number> = {};
    const dirHist: Record<string, number> = {};
    let placeableCount = 0;
    let graded = 0;
    const TRIGGER_FAIL: PlaceabilityFailureReason[] = ["NO_TRIGGER", "PARAMS_REQUIRED", "UNCATALOGUED_INDICATOR"];
    let triggerFailButPlaceable = 0;

    for (const vid of VIDS) {
      const r = loadCache(vid);
      if (!r) { rows.push(`SKIP ${vid} (no cache)`); continue; }
      const idea0 = (r.ideas as ExtractionSnapshot[] | undefined)?.[0];
      const items = r._coverage_speaker_items as SpeakerItem[] | undefined;
      if (!idea0 || !items || items.length === 0) { rows.push(`SKIP ${vid} (no idea/items — harness drop)`); continue; }
      graded++;

      const i = idea0 as Record<string, unknown>;
      const resolved = deriveEntryIndicator(
        (i.concept_name as string) ?? "",
        null,
        (i.entry_indicator as string) ?? null,
      );
      const cov = computeCoverageVerdict(items, idea0);
      // Layer 3A: recover the structured session from the transcript (the extractor left it null).
      const tPath = join(CACHE_DIR, `${vid}.transcript.txt`);
      const transcript = existsSync(tPath) ? readFileSync(tPath, "utf8") : "";
      const sessionWindow = extractSessionFromTranscript(transcript);
      const directionEvidence = classifyDirectionFromTranscript(transcript); // Layer 3B
      // Layer 3C.1: recover explicit params from the transcript when the extraction has none.
      const llmParams = (i.entry_params as Record<string, unknown>) ?? {};
      let effectiveParams = llmParams;
      if (Object.keys(llmParams).length === 0) {
        const scanned = scanIndicatorParams(transcript, (i.entry_indicator as string) ?? (i.concept_name as string));
        if (scanned.source === "TRANSCRIPT_EXPLICIT" && scanned.params) effectiveParams = scanned.params;
      }
      const verdict = scorePlaceability({
        direction: (i.direction as string) ?? null,
        direction_evidence: directionEvidence,
        entry_indicator: (i.entry_indicator as string) ?? null,
        archetype: (i.entry_archetype as string) ?? null,
        resolved_entry_indicator: resolved,
        entry_condition: (i.entry_condition as string) ?? null,
        entry_type: (i.entry_type as string) ?? null,
        entry_params: effectiveParams,
        entry_sequence: (i.entry_sequence as Array<{ action?: string; rationale?: string | null }>) ?? null,
        confluences: (i.confluences as Array<{ name?: string; description?: string }>) ?? null,
        session_filter: (i.session_filter as string) ?? null,
        session_window: sessionWindow,
        risk_rules: (i.risk_rules as string) ?? null,
      });

      if (verdict.placeable) placeableCount++;
      if (verdict.placeable && verdict.failure_reasons.some((r) => TRIGGER_FAIL.includes(r))) triggerFailButPlaceable++;
      for (const reason of verdict.failure_reasons) failureHist[reason] = (failureHist[reason] ?? 0) + 1;
      dirHist[verdict.direction_class ?? verdict.direction_label] = (dirHist[verdict.direction_class ?? verdict.direction_label] ?? 0) + 1;

      rows.push(
        `${verdict.placeable ? "PLACEABLE  " : "NOT-PLACE  "} ${vid.padEnd(13)} ` +
          `cov=${Math.round(cov.coverage_pct * 100)}%`.padEnd(8) +
          ` place=${String(verdict.placeability_score).padStart(3)}/100 ` +
          `dir=${(verdict.direction_class ?? "—").padEnd(26)} ` +
          `[${verdict.failure_reasons.join(",") || "—"}]`,
      );
    }

    const sortHist = (h: Record<string, number>) =>
      Object.entries(h).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${String(v).padStart(2)} × ${k}`).join("\n");

    // eslint-disable-next-line no-console
    console.log(
      "\n=== PLACEABILITY SCOREBOARD (deterministic) ===\n" + rows.join("\n") +
        `\n\nplaceable: ${placeableCount}/${graded}` +
        "\n\n=== FAILURE-REASON HISTOGRAM (Layer 3 roadmap) ===\n" + (sortHist(failureHist) || "  (none)") +
        "\n\n=== DIRECTION-LABEL HISTOGRAM ===\n" + (sortHist(dirHist) || "  (none)") + "\n",
    );

    expect(graded).toBe(14);
    // INVARIANT (trigger hard-fail): a trigger-failure reason can NEVER coexist with placeable=true.
    expect(triggerFailButPlaceable).toBe(0);
    // Layer 3A landed: session recovered from transcripts (was 14/14 SESSION_MISSING at Layer 2
    // baseline; now ≤2 — rf_/75DJ carry no clear session cue). This is the deterministic proof that
    // structured session extraction closes the universal session gap.
    expect(failureHist["SESSION_MISSING"]).toBeLessThanOrEqual(2);
    // Layer 3B landed: evidence-based direction replaced the 14/14 DIRECTION_AMBIGUOUS catch-all.
    // The residual is now split into the two precise enums; the unresolved-parity count is bounded
    // well below the Layer-2 baseline of 14 (operator escalation rule: revisit prompt only if >25%).
    expect(failureHist["DIRECTION_AMBIGUOUS"] ?? 0).toBe(0); // old catch-all is gone
    const dirResidual = (failureHist["INSUFFICIENT_DIRECTIONAL_PARITY"] ?? 0) + (failureHist["NO_DIRECTION_EVIDENCE"] ?? 0);
    expect(dirResidual).toBeLessThanOrEqual(7); // < 50% — deterministic 3B resolved the majority
    // Layer 3C.1: explicit params recovered from transcripts (was 7 PARAMS_REQUIRED at 3B; now ≤5 —
    // gdd/Fqx recovered. Residual = source-vague params (rf_/N7uP/ktkqq) + non-parametric misclassified
    // (2LnFWQ/D1Ipi8) — neither fixable by param-scanning or a prompt change).
    expect(failureHist["PARAMS_REQUIRED"] ?? 0).toBeLessThanOrEqual(5);
    // Placeable after Layers 3A (session) + 3B (direction) + 3C.1 (param recovery) = 7/14 (was 5 at
    // the Layer 2 baseline). The remaining 7 are the irreducible-by-deterministic-means set: source-
    // vague params (rf_/N7uP/ktkqq), non-parametric misclassified (2LnFWQ/D1Ipi8), and uncatalogued
    // archetypes needing synthesis (SY2/W7nln — Layer 3C.3). Bump as 3C.3 / defaults-policy land.
    expect(placeableCount).toBe(7);
  });
});
