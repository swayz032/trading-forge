/**
 * GATE 1 — corpus-v3 semantic-role classifier held-out agreement (2026-07-05).
 *
 * Design: docs/designs/corpus-v3-semantic-role-classification-2026-07-05.md (Gate 1)
 * Plan:   docs/designs/corpus-v3-IMPLEMENTATION-PLAN-2026-07-05.md (Step 4)
 *
 * Runs `classifyGateStrength()` on the HELD-OUT 30% ONLY (never seen by the deterministic pattern
 * lists in gate-strength.ts — see docs/replay-results/corpus-v3-heldout-split-2026-07-05.json). Maps
 * classifier output back to the DRI classes for comparison (mandatory<->JUSTIFIED_MANDATORY,
 * optional<->OPTIONAL, alternative<->ALTERNATIVE, contextual<->CONTEXTUAL). UNRESOLVED rows are
 * EXCLUDED from the scored agreement (no clean 4-value target to compare against) and reported
 * separately as an informational, non-scored diagnostic.
 *
 * Stratifies into RULE-COVERED (rules 1-5 fired, `classifyGateStrengthDeterministic` non-null, no
 * network I/O) vs MARGIN / gemma-adjudicated (rules 1-5 ambiguous, `classifyGateStrength` awaited a
 * live gemma4:e4b-it-qat call on the tower Ollama — real network I/O, this suite is intentionally
 * NOT hermetic/offline like the rest of this worktree's lib tests).
 *
 * PRE-REGISTERED pins (operator, both fixed before this file was run against real numbers):
 *   - Overall held-out agreement >= 85%.
 *   - Margin stratum passes iff the 95% binomial (Wilson score) CI LOWER BOUND on margin agreement
 *     STRICTLY EXCEEDS the majority-class baseline computed on the HELD-OUT MARGIN STRATUM ITSELF
 *     (not the full-221 margin stratum, not the held-out set as a whole) — operator pin (ii), the
 *     stricter small-N handling that forces the beat to be demonstrable, not lucky.
 *   - LOW_POWER: if the margin stratum is so small the 95% CI cannot clear the baseline even at 100%
 *     agreement, report LOW_POWER and DO NOT certify — this is the correct outcome, not a failure.
 *
 * Every claim here is scoped: "agreement on the held-out DRI-audited slice," NOT "classifier accuracy."
 * Per grading-integrity discipline this suite is the DOER's self-measurement (CLAIMED, not VERIFIED) —
 * an independent accuracy-validator re-scan is required before this Gate 1 result may be certified.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { classifyGateStrength, classifyGateStrengthDeterministic, type GateStrength } from "../gate-strength.js";
import type { AtomType } from "../decision-atom.js";

interface DriRow {
  video: string;
  condition_id: string;
  type: string;
  object: string;
  classification: "JUSTIFIED_MANDATORY" | "OPTIONAL" | "ALTERNATIVE" | "CONTEXTUAL" | "UNRESOLVED";
  quote: string;
}

const DRI_TO_GS: Record<string, GateStrength | undefined> = {
  JUSTIFIED_MANDATORY: "mandatory",
  OPTIONAL: "optional",
  ALTERNATIVE: "alternative",
  CONTEXTUAL: "contextual",
  // UNRESOLVED intentionally has no mapping — excluded from scoring.
};

/** 95% two-sided Wilson score interval (no external stats lib; z_0.975 = 1.959963984540054). */
function wilsonInterval(successes: number, n: number, z = 1.959963984540054): { lower: number; upper: number } {
  if (n === 0) return { lower: 0, upper: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lower: Math.max(0, (center - margin) / denom), upper: Math.min(1, (center + margin) / denom) };
}

/** Majority-class proportion among a set of DRI classification labels (4-value domain only, no UNRESOLVED). */
function majorityBaseline(labels: string[]): { pct: number; majorityClass: string | null } {
  if (labels.length === 0) return { pct: 0, majorityClass: null };
  const counts: Record<string, number> = {};
  for (const l of labels) counts[l] = (counts[l] ?? 0) + 1;
  let best: string | null = null;
  let bestN = -1;
  for (const [k, v] of Object.entries(counts)) if (v > bestN) { best = k; bestN = v; }
  return { pct: bestN / labels.length, majorityClass: best };
}

const REPO_ROOT = process.cwd();
const DRI_PATH = join(REPO_ROOT, "docs/replay-results/dri-audit-2026-07-05.json");
const SPLIT_PATH = join(REPO_ROOT, "docs/replay-results/corpus-v3-heldout-split-2026-07-05.json");

interface EvalRow {
  key: string;
  dri: DriRow;
  stratum: "rule_covered" | "margin";
  predicted: GateStrength;
  expected: GateStrength | undefined; // undefined for UNRESOLVED (excluded)
  agree: boolean | null; // null for UNRESOLVED (not scored)
}

describe("Gate 1 — corpus-v3 gate-strength held-out agreement (STRATIFIED, live gemma for margin — not hermetic)", () => {
  let heldOut: DriRow[] = [];
  let splitMeta: any;
  let evalRows: EvalRow[] = [];

  beforeAll(async () => {
    const dri = JSON.parse(readFileSync(DRI_PATH, "utf8")) as { full_classification_table_first_pass: DriRow[] };
    splitMeta = JSON.parse(readFileSync(SPLIT_PATH, "utf8"));
    const heldOutKeys = new Set<string>(splitMeta.held_out_keys);
    heldOut = dri.full_classification_table_first_pass.filter((r) => heldOutKeys.has(`${r.video}||${r.condition_id}`));

    for (const r of heldOut) {
      const key = `${r.video}||${r.condition_id}`;
      const atom = { type: r.type as AtomType, object: r.object, evidenceQuote: r.quote };
      const deterministic = classifyGateStrengthDeterministic(atom);
      const predicted = await classifyGateStrength(atom); // full hybrid API — network I/O for margin rows
      const expected = DRI_TO_GS[r.classification];
      evalRows.push({
        key,
        dri: r,
        stratum: deterministic !== null ? "rule_covered" : "margin",
        predicted,
        expected,
        agree: expected === undefined ? null : predicted === expected,
      });
    }
  }, 900_000); // real gemma calls on the margin stratum — generous timeout

  it("loads the pinned held-out split and the 221-condition DRI audit without drift", () => {
    expect(splitMeta.total).toBe(221);
    expect(heldOut.length).toBe(splitMeta.held_out_count);
    expect(heldOut.length).toBeGreaterThan(0);
  });

  it("classifyGateStrength never throws and always returns a value in the 4-value GateStrength domain for every held-out condition", () => {
    const DOMAIN = new Set<GateStrength>(["mandatory", "optional", "alternative", "contextual"]);
    for (const row of evalRows) expect(DOMAIN.has(row.predicted)).toBe(true);
    expect(evalRows.length).toBe(heldOut.length);
  });

  it("Gate 1 — FULL RESULT (overall / rule-covered / margin stratified agreement + binomial CI + baseline + verdict)", () => {
    const scored = evalRows.filter((r) => r.agree !== null);
    const unresolved = evalRows.filter((r) => r.agree === null);

    const overallAgree = scored.filter((r) => r.agree).length;
    const overallPct = scored.length ? overallAgree / scored.length : 0;

    const ruleCovered = scored.filter((r) => r.stratum === "rule_covered");
    const ruleCoveredAgree = ruleCovered.filter((r) => r.agree).length;
    const ruleCoveredPct = ruleCovered.length ? ruleCoveredAgree / ruleCovered.length : 0;

    const margin = scored.filter((r) => r.stratum === "margin");
    const marginAgree = margin.filter((r) => r.agree).length;
    const marginPct = margin.length ? marginAgree / margin.length : 0;
    const marginCi = wilsonInterval(marginAgree, margin.length);

    // Baseline population per operator pin: computed on the HELD-OUT MARGIN STRATUM ITSELF.
    const marginBaseline = majorityBaseline(margin.map((r) => r.dri.classification));
    const bestCaseCi = wilsonInterval(margin.length, margin.length); // 100% agreement CI-lower, for LOW_POWER test

    const lowPower = margin.length > 0 && bestCaseCi.lower <= marginBaseline.pct;
    // The margin-stratum's OWN pre-registered sub-condition (CI-lower strictly exceeds the
    // held-out-margin majority baseline) — reported separately from the combined Gate 1 verdict
    // below, because the two are independent pins per the design (both must hold to certify).
    const marginVerdict: "PASS" | "FAIL" | "LOW_POWER" =
      margin.length === 0 ? "LOW_POWER" : lowPower ? "LOW_POWER" : marginCi.lower > marginBaseline.pct ? "PASS" : "FAIL";

    // COMBINED Gate 1 verdict — BOTH pins must hold: overall held-out agreement >= 85% AND the
    // margin-stratum sub-condition. LOW_POWER on the margin stratum propagates to the combined
    // verdict (documented non-certifying outcome, not a failure) UNLESS the overall floor is also
    // failed, in which case FAIL is the more informative/honest label.
    const overallPasses = overallPct >= 0.85;
    let gate1Verdict: "PASS" | "FAIL" | "LOW_POWER";
    if (overallPasses && marginVerdict === "PASS") gate1Verdict = "PASS";
    else if (overallPasses && marginVerdict === "LOW_POWER") gate1Verdict = "LOW_POWER";
    else gate1Verdict = "FAIL";

    const report = {
      scope: "agreement on the held-out DRI-audited slice (docs/replay-results/dri-audit-2026-07-05.json), NOT classifier accuracy",
      held_out_total: heldOut.length,
      scored_total: scored.length,
      unresolved_excluded: unresolved.length,
      overall: { n: scored.length, agree: overallAgree, pct: round(overallPct), pins_ge_85pct: overallPasses },
      rule_covered: { n: ruleCovered.length, agree: ruleCoveredAgree, pct: round(ruleCoveredPct) },
      margin_gemma_adjudicated: {
        n: margin.length,
        agree: marginAgree,
        pct: round(marginPct),
        ci_95_wilson: { lower: round(marginCi.lower), upper: round(marginCi.upper) },
        held_out_margin_majority_baseline: { pct: round(marginBaseline.pct), majority_class: marginBaseline.majorityClass },
        best_case_ci_lower_at_100pct: round(bestCaseCi.lower),
        margin_sub_condition_verdict: marginVerdict,
      },
      gate1_verdict: gate1Verdict,
    };

    // eslint-disable-next-line no-console
    console.log("\n=== GATE 1 RESULT (corpus-v3 gate-strength, held-out 30%) ===\n" + JSON.stringify(report, null, 2));

    // Structural sanity — always true, never the pass/fail signal.
    expect(report.overall.n + report.unresolved_excluded).toBe(report.held_out_total);
    expect(report.rule_covered.n + report.margin_gemma_adjudicated.n).toBe(report.overall.n);

    // PRE-REGISTERED pins — the actual pass/fail signal. This assertion is intentionally allowed to
    // go RED: Gate 1 is a real measurement, not a formality, and a FAIL here means the classifier
    // does not yet meet the pre-registered bar — that is the correct, honest outcome to report, not
    // something to relax post-hoc. LOW_POWER is the one documented non-failure outcome.
    expect(["PASS", "LOW_POWER"], `Gate 1 verdict was ${gate1Verdict} — overall=${report.overall.pct}, margin_sub=${marginVerdict}`).toContain(gate1Verdict);
  });
});

function round(x: number): number {
  return Math.round(x * 10000) / 10000;
}
