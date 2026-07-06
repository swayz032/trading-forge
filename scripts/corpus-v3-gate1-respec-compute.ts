/**
 * Corpus v3 — Gate 1 RE-SPECIFICATION computations (2026-07-05), per the LOCKED
 * docs/designs/corpus-v3-gate1-respecification-2026-07-05.md (main tree). Pre-registered BEFORE
 * this script ran. Uses the EXISTING classifier (gate-strength.ts) unmodified — NO tuning, NO new
 * gemma calls (pure deterministic-routing + label comparison).
 *
 * COMPUTE 1 — human-vs-gold-on-margin: the empirical threshold the classifier's known margin
 * CI-lower (54.42%) must clear. Restricted to the 71 inter-rater-subsample conditions, intersected
 * with classifyGateStrengthDeterministic's MARGIN routing (i.e. rules 1-5 do NOT resolve them).
 *
 * COMPUTE 2 — overfit diagnostic: rule coverage on the 143 rules-design conditions vs the held-out
 * 17.1% (12/70), both computed on the SAME denominator convention (non-UNRESOLVED-gold rows only,
 * matching how Gate 1 itself reported rule_covered.n=12 over scored_total=70, not held_out_total=78).
 */
import { readFileSync } from "fs";
import { classifyGateStrengthDeterministic } from "../src/server/lib/gate-strength.js";
import type { AtomType } from "../src/server/lib/decision-atom.js";

interface DriRow {
  video: string; condition_id: string; type: string; object: string;
  classification: "JUSTIFIED_MANDATORY" | "OPTIONAL" | "ALTERNATIVE" | "CONTEXTUAL" | "UNRESOLVED";
  quote: string;
}

const dri = JSON.parse(readFileSync("docs/replay-results/dri-audit-2026-07-05.json", "utf8")) as {
  full_classification_table_first_pass: DriRow[];
  full_classification_table_second_pass_subsample: DriRow[];
  inter_rater_agreement: { compared: number; agree: number; disagree: number; agreement_rate: number };
};
const split = JSON.parse(readFileSync("docs/replay-results/corpus-v3-heldout-split-2026-07-05.json", "utf8"));

const gold = dri.full_classification_table_first_pass;
const secondSubsample = dri.full_classification_table_second_pass_subsample;
const goldByKey = new Map(gold.map((r) => [`${r.video}||${r.condition_id}`, r]));

function wilsonInterval(successes: number, n: number, z = 1.959963984540054): { lower: number; upper: number } {
  if (n === 0) return { lower: 0, upper: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lower: Math.max(0, (center - margin) / denom), upper: Math.min(1, (center + margin) / denom) };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTE 1 — human-vs-gold-on-margin
// ─────────────────────────────────────────────────────────────────────────────
console.log("=".repeat(80));
console.log("COMPUTE 1 — human-vs-gold-on-margin");
console.log("Gold construction: SINGLE-RATER FIRST-PASS (full_classification_table_first_pass) —");
console.log("NOT adjudicated, NOT majority-reconciled. (established context, restated per pre-reg §)");
console.log("=".repeat(80));

if (secondSubsample.length !== 71 || dri.inter_rater_agreement.compared !== 71) {
  console.log(`WARNING: expected 71 inter-rater conditions, found subsample=${secondSubsample.length} compared=${dri.inter_rater_agreement.compared}`);
}

type Row = { key: string; gold: DriRow; second: DriRow; goldRouting: "rule_covered" | "margin" };
const rows: Row[] = [];
for (const s of secondSubsample) {
  const key = `${s.video}||${s.condition_id}`;
  const g = goldByKey.get(key);
  if (!g) { console.log(`  MISSING gold match for ${key}`); continue; }
  // Routing determined on the GOLD (first-pass) quote/type — the SAME input convention Gate 1 used
  // when it classified held-out rows (classifyGateStrengthDeterministic ran on the gold row, not a
  // second independent rater's own excerpt). Documented explicitly: this is a methodological choice,
  // not specified verbatim in the pre-reg. Quote text differs between passes for 39/71 conditions
  // (same condition_id, different rater-selected excerpt) — sensitivity check follows below.
  const det = classifyGateStrengthDeterministic({ type: g.type as AtomType, object: g.object, evidenceQuote: g.quote });
  rows.push({ key, gold: g, second: s, goldRouting: det !== null ? "rule_covered" : "margin" });
}

const margin = rows.filter((r) => r.goldRouting === "margin");
console.log(`\nTotal inter-rater conditions matched to gold: ${rows.length}`);
console.log(`Routed MARGIN (rules 1-5 do not resolve, using GOLD/first-pass quote+type): ${margin.length}`);
console.log(`Routed RULE-COVERED: ${rows.length - margin.length}`);

// Exclude UNRESOLVED on EITHER side (can't score agreement against a class outside the 4-value domain).
const DOMAIN = new Set(["JUSTIFIED_MANDATORY", "OPTIONAL", "ALTERNATIVE", "CONTEXTUAL"]);
const marginScorable = margin.filter((r) => DOMAIN.has(r.gold.classification) && DOMAIN.has(r.second.classification));
const marginUnresolvedExcluded = margin.length - marginScorable.length;
const marginAgree = marginScorable.filter((r) => r.gold.classification === r.second.classification).length;
const humanVsGoldOnMarginRate = marginScorable.length ? marginAgree / marginScorable.length : NaN;
const marginCi = wilsonInterval(marginAgree, marginScorable.length);
const bestCaseCi = wilsonInterval(marginScorable.length, marginScorable.length);

console.log(`\nMargin subset (gold routing) UNRESOLVED-excluded (either side): ${marginUnresolvedExcluded}`);
console.log(`Margin subset SCORABLE N: ${marginScorable.length}`);
console.log(`  agree: ${marginAgree}  human-vs-gold-on-margin rate: ${(humanVsGoldOnMarginRate * 100).toFixed(2)}%`);
console.log(`  95% Wilson CI: [${(marginCi.lower * 100).toFixed(2)}%, ${(marginCi.upper * 100).toFixed(2)}%]`);
console.log(`  best-case (100% agree) CI-lower: ${(bestCaseCi.lower * 100).toFixed(2)}% (LOW_POWER check)`);

const CLASSIFIER_MARGIN_CI_LOWER = 0.5442; // known, from the certified Gate 1 run
const KNOWN_N_FOR_LOW_POWER = marginScorable.length < 5; // operator's own low-N judgment call, reported not decided here
console.log(`\nLOCKED CRITERION: classifier margin CI-lower (${(CLASSIFIER_MARGIN_CI_LOWER*100).toFixed(2)}%) >= human-vs-gold-on-margin (${(humanVsGoldOnMarginRate*100).toFixed(2)}%) ?`);
if (marginScorable.length === 0) {
  console.log("VERDICT: LOW_POWER — zero scorable margin conditions in the inter-rater subsample. Cannot compute a threshold.");
} else {
  const verdict = CLASSIFIER_MARGIN_CI_LOWER >= humanVsGoldOnMarginRate ? "GATE 1 PASSES (re-specified)" : "GATE 1 STAYS FAILED";
  console.log(`VERDICT: ${verdict}  (${(CLASSIFIER_MARGIN_CI_LOWER*100).toFixed(2)}% ${CLASSIFIER_MARGIN_CI_LOWER >= humanVsGoldOnMarginRate ? ">=" : "<"} ${(humanVsGoldOnMarginRate*100).toFixed(2)}%)`);
  if (KNOWN_N_FOR_LOW_POWER) console.log("  NOTE: N is small — report point estimate with the wide CI above, do not over-interpret precision.");
}

// Sensitivity check: what if routing used the SECOND-pass rater's own quote instead of gold's?
console.log("\n--- Sensitivity check: routing computed on SECOND-PASS quote instead of gold quote ---");
const rows2: Row[] = [];
for (const s of secondSubsample) {
  const key = `${s.video}||${s.condition_id}`;
  const g = goldByKey.get(key);
  if (!g) continue;
  const det = classifyGateStrengthDeterministic({ type: s.type as AtomType, object: s.object, evidenceQuote: s.quote });
  rows2.push({ key, gold: g, second: s, goldRouting: det !== null ? "rule_covered" : "margin" });
}
const margin2 = rows2.filter((r) => r.goldRouting === "margin");
const marginScorable2 = margin2.filter((r) => DOMAIN.has(r.gold.classification) && DOMAIN.has(r.second.classification));
const marginAgree2 = marginScorable2.filter((r) => r.gold.classification === r.second.classification).length;
const rate2 = marginScorable2.length ? marginAgree2 / marginScorable2.length : NaN;
console.log(`  margin N=${marginScorable2.length}, agree=${marginAgree2}, rate=${(rate2*100).toFixed(2)}%`);
console.log(`  routing agreement between the two conventions: ${rows.filter((r,i)=>r.goldRouting===rows2[i]?.goldRouting).length}/${rows.length} identical`);

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTE 2 — overfit diagnostic (design-set coverage vs held-out 17.1%)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(80));
console.log("COMPUTE 2 — overfit diagnostic: rule coverage, design set (143) vs held-out (70 scored)");
console.log("=".repeat(80));

const fullDri = dri.full_classification_table_first_pass;
const heldOutKeys = new Set<string>(split.held_out_keys);
const designSet = fullDri.filter((r) => !heldOutKeys.has(`${r.video}||${r.condition_id}`));
console.log(`design set total: ${designSet.length} (expect 143)`);

const designNonUnresolved = designSet.filter((r) => DOMAIN.has(r.classification));
let designCovered = 0;
for (const r of designNonUnresolved) {
  const det = classifyGateStrengthDeterministic({ type: r.type as AtomType, object: r.object, evidenceQuote: r.quote });
  if (det !== null) designCovered++;
}
const designCoverageRate = designCovered / designNonUnresolved.length;
console.log(`design-set non-UNRESOLVED N: ${designNonUnresolved.length} (143 - 12 UNRESOLVED = 131 expected)`);
console.log(`design-set rule-covered: ${designCovered}/${designNonUnresolved.length} = ${(designCoverageRate*100).toFixed(2)}%`);

// also report the raw all-143 denominator version for full transparency
let designCoveredAll143 = 0;
for (const r of designSet) {
  const det = classifyGateStrengthDeterministic({ type: r.type as AtomType, object: r.object, evidenceQuote: r.quote });
  if (det !== null) designCoveredAll143++;
}
console.log(`(diagnostic, all-143-denominator incl. UNRESOLVED: ${designCoveredAll143}/${designSet.length} = ${(100*designCoveredAll143/designSet.length).toFixed(2)}%)`);

const HELD_OUT_COVERAGE_RATE = 12 / 70; // certified Gate 1 figure
console.log(`\nheld-out rule coverage (certified Gate 1 figure): 12/70 = ${(HELD_OUT_COVERAGE_RATE*100).toFixed(2)}%`);
const ratio = designCoverageRate / HELD_OUT_COVERAGE_RATE;
console.log(`design-set coverage / held-out coverage ratio: ${ratio.toFixed(2)}x`);
console.log(`OVERFIT FLAG: ${ratio >= 2 ? "YES — design-set coverage is >=2x held-out; rules likely overfit the design split" : ratio >= 1.5 ? "BORDERLINE — some overfit signal, not extreme" : "NO strong overfit signal by this ratio heuristic"}`);

// Rule-covered stratum CI (10/12), quoted-with-CI per the ruling.
const ruleCoveredCi = wilsonInterval(10, 12);
console.log(`\nRule-covered stratum (held-out, N=12): 10/12 = 83.33%, 95% Wilson CI [${(ruleCoveredCi.lower*100).toFixed(2)}%, ${(ruleCoveredCi.upper*100).toFixed(2)}%] (WIDE — N=12)`);
