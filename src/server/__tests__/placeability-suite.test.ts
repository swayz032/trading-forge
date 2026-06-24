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
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { scorePlaceability, type PlaceabilityFailureReason } from "../lib/placeability-score.js";
import { computeCoverageVerdict, type SpeakerItem, type ExtractionSnapshot } from "../lib/extraction-coverage-gate.js";

const CACHE_DIR = join(process.cwd(), "tmp", "validate5");
const VIDS = [
  "rf_EQvubKlk", "gddYspvW0_w", "FqxEKDxemtI", "N7uP9V0Iktc", "75DJN5UVQnw", "sZFdrxdVTMk",
  "UBvfsImdI2U", "2LnFWQ10-0E", "z3Qn3fBoe2I", "iU8ww5MC2FQ", "SY2jXlW9bt4", "D1Ipi8Cfl8o",
  "W7nlnHTUZQU", "ktkqq7QsN9Q",
];

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

describe("PLACEABILITY regression suite — Coverage vs Placeability vs Compilability", () => {
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
      const verdict = scorePlaceability({
        direction: (i.direction as string) ?? null,
        entry_indicator: (i.entry_indicator as string) ?? null,
        archetype: (i.entry_archetype as string) ?? null,
        resolved_entry_indicator: resolved,
        entry_condition: (i.entry_condition as string) ?? null,
        entry_type: (i.entry_type as string) ?? null,
        entry_params: (i.entry_params as Record<string, unknown>) ?? null,
        entry_sequence: (i.entry_sequence as Array<{ action?: string; rationale?: string | null }>) ?? null,
        confluences: (i.confluences as Array<{ name?: string; description?: string }>) ?? null,
        session_filter: (i.session_filter as string) ?? null,
        risk_rules: (i.risk_rules as string) ?? null,
      });

      if (verdict.placeable) placeableCount++;
      if (verdict.placeable && verdict.failure_reasons.some((r) => TRIGGER_FAIL.includes(r))) triggerFailButPlaceable++;
      for (const reason of verdict.failure_reasons) failureHist[reason] = (failureHist[reason] ?? 0) + 1;
      dirHist[verdict.direction_label] = (dirHist[verdict.direction_label] ?? 0) + 1;

      rows.push(
        `${verdict.placeable ? "PLACEABLE  " : "NOT-PLACE  "} ${vid.padEnd(13)} ` +
          `cov=${Math.round(cov.coverage_pct * 100)}%`.padEnd(8) +
          ` place=${String(verdict.placeability_score).padStart(3)}/100 ` +
          `dir=${verdict.direction_label.padEnd(24)} ` +
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
    // Layer 2 baseline (deterministic, field-completeness): the universal gaps are session + direction.
    expect(failureHist["SESSION_MISSING"]).toBe(14); // session is NEVER extracted today → Layer 3 priority
    expect(failureHist["DIRECTION_AMBIGUOUS"]).toBe(14); // all direction:both → needs the 5-direction model
    // Documented current state (deterministic field-completeness only — the LLM grader is stricter
    // because it knows session-anchored strategies are NOT placeable without the session). Bump
    // deliberately as Layer 3 lands.
    expect(placeableCount).toBe(5);
  });
});
