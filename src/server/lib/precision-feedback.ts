/**
 * PRECISION FEEDBACK (v1.1, 2026-06-29) — multi-signal atom noise scoring (operator/GPT).
 *
 * Tests the falsifiable hypothesis: is ATOM POLLUTION the dominant cause of low EdgeRecall? (ER ∝ AtomPurity.)
 * Disconnected != noise (framework / contextual filters / alternative branches are legitimately off-spine), so
 * we do NOT use raw connectivity. Instead a multi-signal score over:
 *   C — connectivity (can it reach ENTER?)        — weak signal
 *   R — role over-production (a type produced many times) — generic-cluster signal
 *   S — semantic redundancy (near-duplicate atom)  — strong signal
 *   G — generic / low-information object            — low-content signal
 * Framework + branch atoms get their OWN categories and are never "noise". We CLASSIFY, never prune — the
 * "active graph" (core + branch) is what the compiler re-runs on; framework + likely_noise stay in the ledger.
 * Pure / deterministic / standalone.
 */
import type { DecisionAtom } from "./decision-atom.js";
import type { CompiledGraph } from "./graph-compiler.js";

export type PrecisionTag = "core" | "branch" | "framework" | "likely_noise";

const FRAMEWORK_OBJ = /\b(risk|reward|stop|target|profit|size|sizing|position|lot|pips?)\b/i;
const GENERIC = /^(price|candle|structure|movement|level|levels|action|trade|trading|market|entry|setup|the|a|condition|time ?frame|state|direction|move|thing)$/;

export function classifyPrecision(compiled: CompiledGraph): Map<string, PrecisionTag> {
  const atoms = compiled.atoms;
  const typeCount: Record<string, number> = {};
  for (const a of atoms) typeCount[a.type] = (typeCount[a.type] ?? 0) + 1;
  const branchIds = new Set<string>();
  compiled.orBranches.flat().forEach((id) => branchIds.add(id));
  compiled.edges.filter((e) => e.role === "exception").forEach((e) => branchIds.add(e.from));
  const firstSeen = new Set<string>();
  const tag = new Map<string, PrecisionTag>();
  for (const a of atoms) {
    if (FRAMEWORK_OBJ.test(a.object) || a.type === "EXIT_HINT") { tag.set(a.id, "framework"); continue; }
    if (branchIds.has(a.id)) { tag.set(a.id, "branch"); continue; }
    const key = `${a.type}:${a.object_canonical}`;
    const redundant = firstSeen.has(key); firstSeen.add(key);
    let noise = 0;
    // C (connectivity) DELIBERATELY EXCLUDED: in a noise-broken spine it is circular — real atoms are also
    // disconnected, so C flags real decisions (operator/GPT: "disconnected != noise"). Re-add only when the
    // spine is reliable. Score on S (redundancy), G (generic/low-info), R (role over-production) only.
    if (redundant) noise += 2;                                                      // S — near-duplicate (strong)
    const toks = a.object_canonical.split(" ").filter((w) => w.length >= 3);
    if (toks.length <= 1 || GENERIC.test(a.object_canonical)) noise += 1;           // G — generic / low-content
    if ((typeCount[a.type] ?? 0) > 4) noise += 1;                                   // R — over-produced type
    tag.set(a.id, noise >= 2 ? "likely_noise" : "core");
  }
  return tag;
}

/** The active-graph atom set for the feedback re-compile: core + branch (framework + likely_noise NOT deleted). */
export function activeAtoms(atoms: DecisionAtom[], tags: Map<string, PrecisionTag>): DecisionAtom[] {
  return atoms.filter((a) => { const t = tags.get(a.id); return t === "core" || t === "branch"; });
}
