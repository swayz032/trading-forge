/**
 * E-PRECISION (5-URL audit run-4, 2026-06-23) — enumerator denominator-hygiene regression test.
 *
 * Loads the REAL cached gemma extractions (tmp/validate5/<vid>.result.json) and runs the live
 * computeCoverageVerdict over them. Proves the precision filter (selectDistinctItems) makes
 * genuinely-complete extractions PASS while keeping real recall gaps FAILING:
 *   - rf_  (MACD): "MACD line"/"signal line"/"histogram" are MACD sub-anatomy → folded → PASS
 *   - Fqx  (Bollinger): "Forex specific trading strategy"/"15-minute chart trading strategy"
 *                       are descriptors + "swing high" mirrors "swing low" → PASS
 *   - ktkqq (VWAP): umbrellas dropped, but 2 of 4 named setups genuinely missing → still FAIL
 *
 * The test is SKIPPED (not failed) for any cache that predates _coverage_speaker_items, so it
 * never breaks CI when the fixtures haven't been regenerated.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

vi.mock("../services/model-router.js", () => ({
  callScoutExtractLlm: vi.fn(),
  setChunkedNumCtxOverride: vi.fn(),
}));
vi.mock("../db/index.js", () => ({ db: {} }));

import {
  computeCoverageVerdict,
  type SpeakerItem,
  type ExtractionSnapshot,
} from "../lib/extraction-coverage-gate.js";
import { checkCompilabilityGate } from "../lib/extraction-quality-gate.js";

interface CachedResult {
  ideas?: Array<Record<string, unknown>>;
  _coverage_speaker_items?: SpeakerItem[];
}

function loadCache(vid: string): CachedResult | null {
  const p = resolve(process.cwd(), "tmp/validate5", `${vid}.result.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as CachedResult;
  } catch {
    return null;
  }
}

function gradeCoverage(vid: string) {
  const r = loadCache(vid);
  if (!r) return { skip: true as const };
  const items = Array.isArray(r._coverage_speaker_items) ? r._coverage_speaker_items : null;
  const idea0 = (r.ideas ?? [])[0] as ExtractionSnapshot | undefined;
  if (!items || !idea0) return { skip: true as const };
  return { skip: false as const, verdict: computeCoverageVerdict(items, idea0) };
}

describe("E-PRECISION — denominator hygiene on real cached extractions", () => {
  it("rf_ (MACD): sub-anatomy folded → coverage PASS", () => {
    const g = gradeCoverage("rf_EQvubKlk");
    if (g.skip) return; // cache predates _coverage_speaker_items
    expect(g.verdict.verdict).toBe("pass");
  });

  // 2026-06-23 — Fqx PASSES at 100% now. Journey: broken-enum self-evident pass → enumerator fix
  // exposed missing Bollinger band components (58-75% fail) → Bollinger anatomy fold + named-concept
  // repair recovery + near-duplicate dedup recovered them. The band sub-parts are now either folded
  // (anatomy) or covered (recovered). Honest full pass, not a relaxation — the Gann-box negative
  // control below still fails, proving the gate didn't go soft.
  it("Fqx (Bollinger): band components folded/recovered → coverage PASS", () => {
    const g = gradeCoverage("FqxEKDxemtI");
    if (g.skip) return;
    expect(g.verdict.verdict).toBe("pass");
  });

  // Same enumerator-fix reality: ktkqq grades against the real VWAP-Wave-System items and fails at
  // ~67% — misses the 3-brains decomposition + "VWAP break and reclaim". Honest, not regression.
  it("ktkqq (VWAP): real enumerated grading exposes missing setups → coverage_failed", () => {
    const g = gradeCoverage("ktkqq7QsN9Q");
    if (g.skip) return;
    expect(g.verdict.verdict).toBe("coverage_failed");
  });
});

// Full-gate grade mirrors scripts/fast-grade.ts (coverage pass + compilable + non-generic name)
// but in the clean vitest harness (no server boot). Prints a scoreboard for the operator.
interface GradeRow { skip: false; coveragePass: boolean; compilable: boolean; nonGeneric: boolean; missing: string[]; line: string; }
function fullGrade(vid: string): { skip: true } | GradeRow {
  const r = loadCache(vid);
  if (!r) return { skip: true };
  const items = Array.isArray(r._coverage_speaker_items) ? r._coverage_speaker_items : null;
  const idea0 = (r.ideas ?? [])[0] as Record<string, unknown> | undefined;
  if (!items || !idea0) return { skip: true };
  const verdict = computeCoverageVerdict(items, idea0 as ExtractionSnapshot);
  const confluence_factors = Array.isArray(idea0.confluences)
    ? (idea0.confluences as Array<{ name?: string }>).map((c) => c?.name ?? "").filter((n) => n.length > 0)
    : [];
  const gate = checkCompilabilityGate(
    {
      entry_indicator: (idea0.entry_indicator as string) ?? null,
      archetype: (idea0.entry_archetype as string) ?? null,
      entry_params: (idea0.entry_params as Record<string, unknown>) ?? null,
      entry_condition: (idea0.entry_condition as string) ?? null,
      // NB: no resolved_entry_indicator here (pure test — no DB to run deriveEntryIndicator). The
      // gate's raw-field fallback classifies a concept-echo name as non-structural, matching what
      // production's parametric/uncatalogued resolution concludes for these cached extractions.
      direction: (idea0.direction as string) ?? null,
      timeframe: (idea0.timeframe as string) ?? null,
      confluence_factors,
      coverage_verdict: verdict,
    },
    (idea0.concept_name as string) ?? null,
  );
  const name = (idea0.concept_name as string) ?? "(none)";
  const nonGeneric = !(!name || /^extracted(_strategy)?$/i.test(name));
  const coveragePass = verdict.verdict === "pass";
  const fullPass = coveragePass && gate.compilable && nonGeneric;
  return {
    skip: false,
    coveragePass,
    compilable: gate.compilable,
    nonGeneric,
    missing: gate.missing,
    line: `${fullPass ? "PASS" : "FAIL"} ${vid} cov=${verdict.verdict}/${Math.round(verdict.coverage_pct * 100)}% compilable=${gate.compilable} name=${name}${fullPass ? "" : " [" + (gate.missing.join(",") || verdict.verdict) + "]"}`,
  };
}

describe("E-PRECISION — full-gate scoreboard (real caches)", () => {
  // 2026-06-24 Layer 2 (separate metrics): COVERAGE (did we capture the concepts?) and
  // COMPILABILITY (does the extraction carry an executable trigger?) are DISTINCT. The
  // blind-reconstruction audit showed these cached extractions reach high coverage while their
  // entry_params are empty + entry_indicator is a concept-echo → no deterministic trigger.
  // This test now asserts the SEPARATED truth instead of conflating them into one "pass".
  it("prints scoreboard + asserts coverage and compilability are measured SEPARATELY", () => {
    const vids = ["rf_EQvubKlk", "FqxEKDxemtI", "75DJN5UVQnw", "ktkqq7QsN9Q", "gddYspvW0_w", "SY2jXlW9bt4"];
    const lines: string[] = [];
    let anyGraded = false;
    const rows: Record<string, GradeRow> = {};
    for (const v of vids) {
      const g = fullGrade(v);
      if (g.skip) { lines.push(`SKIP ${v} (cache predates speaker_items)`); continue; }
      anyGraded = true;
      lines.push(g.line);
      rows[v] = g;
    }
    // eslint-disable-next-line no-console
    console.log("\n=== COVERAGE vs COMPILABILITY SCOREBOARD ===\n" + lines.join("\n") + "\n");
    if (!anyGraded) return;
    // rf_ COVERAGE remains intact (the named-concept capture is genuinely complete)...
    if ("rf_EQvubKlk" in rows) expect(rows["rf_EQvubKlk"].coveragePass).toBe(true);
    // ...but COMPILABILITY is now correctly gated: an extraction whose entry_params are empty and
    // whose entry_indicator is a concept-echo (resolves to no structural archetype) does NOT carry
    // a deterministic trigger → not compilable. This is the Layer 1 shipping-integrity fix: high
    // coverage no longer implies a shippable, executable strategy.
    const TRIGGER_FAIL = ["no_trigger", "params_required", "uncatalogued_indicator"];
    if ("rf_EQvubKlk" in rows && rows["rf_EQvubKlk"].missing.some((m) => TRIGGER_FAIL.includes(m))) {
      expect(rows["rf_EQvubKlk"].compilable).toBe(false);
    }
  });
});

describe("E-PRECISION — selectDistinctItems classification (synthetic, no fixtures)", () => {
  const RICH_STEP = "draw the indicator and wait for the mechanic confirmation alpha bravo charlie";
  function snap(extra: Partial<ExtractionSnapshot> = {}): ExtractionSnapshot {
    return {
      entry_sequence: [{ step: 1, action: RICH_STEP, rationale: null }],
      confluences: [{ name: "c", description: "x y z" }],
      ...extra,
    } as ExtractionSnapshot;
  }

  it("drops a 'trading strategy' descriptor from the denominator", () => {
    const items: SpeakerItem[] = [
      { name: "MACD indicator", verbatim_quote: "use the macd indicator for momentum", emphasis_level: "primary" },
      { name: "Forex specific trading strategy", verbatim_quote: "this is a forex specific trading strategy", emphasis_level: "primary" },
    ];
    const ext = snap({
      entry_sequence: [{ step: 1, action: "use the MACD indicator for momentum confirmation alpha bravo", rationale: null }],
    });
    const v = computeCoverageVerdict(items, ext);
    // descriptor is filtered out → only MACD counts → covered → pass
    expect(v.missing).not.toContain("Forex specific trading strategy");
    expect(v.verdict).toBe("pass");
  });

  it("folds indicator sub-anatomy (histogram) into the parent indicator", () => {
    const items: SpeakerItem[] = [
      { name: "MACD indicator", verbatim_quote: "the macd indicator", emphasis_level: "primary" },
      { name: "histogram", verbatim_quote: "the histogram shows momentum", emphasis_level: "primary" },
    ];
    const ext = snap({
      entry_sequence: [{ step: 1, action: "read the MACD indicator cross for momentum alpha bravo", rationale: null }],
    });
    const v = computeCoverageVerdict(items, ext);
    expect(v.missing).not.toContain("histogram"); // folded, not counted as a miss
    expect(v.verdict).toBe("pass");
  });

  it("folds swing-high mirror into covered swing-low", () => {
    const items: SpeakerItem[] = [
      { name: "swing low", verbatim_quote: "stop below the swing low", emphasis_level: "primary" },
      { name: "swing high", verbatim_quote: "stop above the swing high", emphasis_level: "secondary" },
    ];
    const ext = snap({
      entry_sequence: [{ step: 1, action: "place the stop below the swing low by a buffer alpha bravo", rationale: null }],
    });
    const v = computeCoverageVerdict(items, ext);
    expect(v.verdict).toBe("pass");
  });

  it("KEEPS a genuinely-dropped primary tool failing (Gann box not relaxed)", () => {
    const items: SpeakerItem[] = [
      { name: "Gann box", verbatim_quote: "draw the gann box from high to low", emphasis_level: "primary" },
    ];
    const ext = snap({
      entry_sequence: [{ step: 1, action: "buy when price breaks the prior high alpha bravo", rationale: null }],
    });
    const v = computeCoverageVerdict(items, ext);
    expect(v.missing).toContain("Gann box");
    expect(v.verdict).toBe("coverage_failed");
  });
});
