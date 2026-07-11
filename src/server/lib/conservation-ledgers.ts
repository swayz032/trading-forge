/**
 * THREE CONSERVATION LEDGERS (v1.1, 2026-06-29) — isolate failures by stage (operator/GPT).
 *
 * One conservation check can't tell WHERE the loss happened. Three independent ledgers can:
 *   Ledger A — TRANSCRIPT conservation: every clause has exactly one disposition (nothing disappears).
 *   Ledger B — DECISION conservation:   every decision-bearing clause yields >=1 atom (no executable OMISSION).
 *   Ledger C — GRAPH conservation:      every atom is on a path to ENTER or is unreachable-with-justification
 *                                       (no executable loss INSIDE compilation; deps resolve; acyclic).
 *
 * Localization (the payoff):
 *   A pass, B fail            -> the EXTRACTOR missed an atom (decision-bearing clause with no atom).
 *   A pass, B pass, C fail    -> the ASSEMBLER is broken (dangling dep / cycle / unreachable atom).
 *   A fail                    -> the CLAUSE CLASSIFIER dropped a clause (a clause with no disposition).
 *
 * Plus a bidirectional adversarial contract: OMISSION (decision in transcript, no atom) AND HALLUCINATION
 * (atom with no transcript justification). Pure / deterministic / standalone.
 */
import type { DecisionAtom, DecisionGraph } from "./decision-atom.js";
import { canonKey } from "./decision-atom.js";

// ── Ledger A — transcript conservation ────────────────────────────────────────
export type ClauseDisposition =
  | "decision_bearing" | "semantic_only" | "contextual" | "motivational" | "visual_only" | "ignored";
export interface Clause {
  id: string;
  text: string;
  span: { start: number; end: number };
  disposition?: ClauseDisposition; // unset = NOT YET CLASSIFIED = silent loss
  ignore_reason?: string;          // required when disposition === "ignored"
}
export interface LedgerAResult {
  total: number;
  byDisposition: Record<ClauseDisposition, number>;
  unclassified: Clause[];          // no disposition -> SILENT LOSS at the transcript level
  ignoredWithoutReason: Clause[];  // disposition=ignored but no reason -> the escape-hatch guard
  conserved: boolean;
}
const ZERO_DISPO = (): Record<ClauseDisposition, number> => ({
  decision_bearing: 0, semantic_only: 0, contextual: 0, motivational: 0, visual_only: 0, ignored: 0,
});
export function ledgerA(clauses: Clause[]): LedgerAResult {
  const byDisposition = ZERO_DISPO();
  const unclassified: Clause[] = [];
  const ignoredWithoutReason: Clause[] = [];
  for (const c of clauses) {
    if (!c.disposition) { unclassified.push(c); continue; }
    byDisposition[c.disposition]++;
    if (c.disposition === "ignored" && !(c.ignore_reason && c.ignore_reason.trim())) ignoredWithoutReason.push(c);
  }
  return { total: clauses.length, byDisposition, unclassified, ignoredWithoutReason,
    conserved: unclassified.length === 0 && ignoredWithoutReason.length === 0 };
}
export function ledgerAOrThrow(r: LedgerAResult): LedgerAResult {
  if (r.unclassified.length) throw new Error(`ledgerA_violation: ${r.unclassified.length} clause(s) have NO disposition (silent transcript loss)`);
  if (r.ignoredWithoutReason.length) throw new Error(`ledgerA_violation: ${r.ignoredWithoutReason.length} clause(s) ignored WITHOUT a reason (escape-hatch guard)`);
  return r;
}

// ── Ledger B — decision conservation ──────────────────────────────────────────
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
export interface LedgerBResult {
  decisionBearing: number;
  covered: number;
  orphanClauses: Clause[]; // decision_bearing clause cited by NO atom -> executable OMISSION
  conserved: boolean;
}
/** Every decision_bearing clause must be cited by >=1 atom (an atom whose provenance span overlaps the clause). */
export function ledgerB(clauses: Clause[], atoms: DecisionAtom[]): LedgerBResult {
  const spans = atoms.map((a) => a.provenance.transcript_span).filter((s): s is { start: number; end: number } => !!s);
  const decisionClauses = clauses.filter((c) => c.disposition === "decision_bearing");
  const orphanClauses = decisionClauses.filter((c) => !spans.some((s) => overlaps(s, c.span)));
  return { decisionBearing: decisionClauses.length, covered: decisionClauses.length - orphanClauses.length,
    orphanClauses, conserved: orphanClauses.length === 0 };
}
export function ledgerBOrThrow(r: LedgerBResult): LedgerBResult {
  if (r.orphanClauses.length) throw new Error(`ledgerB_violation: ${r.orphanClauses.length} decision-bearing clause(s) produced NO atom (OMISSION) — extractor gap`);
  return r;
}

// ── Ledger C — graph conservation ─────────────────────────────────────────────
export interface LedgerCResult {
  placed: number;
  danglingDeps: Array<{ atom: string; missing: string }>; // depends_on -> non-existent atom
  cyclic: string[];                                        // ids participating in a dependency cycle
  unreachable: DecisionAtom[];                             // not in any ENTER's dependency closure (orphan)
  hasEntry: boolean;
  conserved: boolean;
}
/** Every atom must reach ENTER through the dependency graph; deps must resolve; the graph must be acyclic. */
export function ledgerC(graph: DecisionGraph): LedgerCResult {
  const byId = new Map(graph.atoms.map((a) => [a.id, a]));
  const danglingDeps: Array<{ atom: string; missing: string }> = [];
  for (const a of graph.atoms) for (const d of a.depends_on) if (!byId.has(d)) danglingDeps.push({ atom: a.id, missing: d });

  // cycle detection over depends_on edges (a -> its prerequisites)
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(graph.atoms.map((a) => [a.id, WHITE]));
  const cyclic = new Set<string>();
  const stack: string[] = [];
  const dfs = (id: string) => {
    color.set(id, GRAY); stack.push(id);
    for (const d of byId.get(id)?.depends_on ?? []) {
      if (!byId.has(d)) continue;
      if (color.get(d) === GRAY) { const i = stack.indexOf(d); stack.slice(i).forEach((x) => cyclic.add(x)); }
      else if (color.get(d) === WHITE) dfs(d);
    }
    color.set(id, BLACK); stack.pop();
  };
  for (const a of graph.atoms) if (color.get(a.id) === WHITE) dfs(a.id);

  // reachability: an atom is "placed" if it is an ENTER or in the transitive depends_on closure of some ENTER.
  const entries = graph.atoms.filter((a) => a.type === "ENTER");
  const placedIds = new Set<string>();
  const visit = (id: string) => { if (placedIds.has(id) || !byId.has(id)) return; placedIds.add(id); for (const d of byId.get(id)!.depends_on) visit(d); };
  entries.forEach((e) => visit(e.id));
  const unreachable = graph.atoms.filter((a) => !placedIds.has(a.id));

  return { placed: placedIds.size, danglingDeps, cyclic: [...cyclic], unreachable, hasEntry: entries.length > 0,
    conserved: danglingDeps.length === 0 && cyclic.size === 0 && unreachable.length === 0 && entries.length > 0 };
}
export function ledgerCOrThrow(r: LedgerCResult): LedgerCResult {
  if (!r.hasEntry) throw new Error("ledgerC_violation: graph has NO ENTER atom (no executable terminal)");
  if (r.danglingDeps.length) throw new Error(`ledgerC_violation: ${r.danglingDeps.length} dangling dependency edge(s) — assembler bug`);
  if (r.cyclic.length) throw new Error(`ledgerC_violation: dependency cycle through {${r.cyclic.join(", ")}} — assembler bug`);
  if (r.unreachable.length) throw new Error(`ledgerC_violation: ${r.unreachable.length} atom(s) unreachable from ENTER (extracted but unplaced)`);
  return r;
}

// ── Bidirectional adversarial contract (the recovery-loop signal) ─────────────
// OMISSION: a decision exists in the transcript but no atom captured it (Ledger B catches the STRUCTURAL half;
//           an LLM critic catches SEMANTIC omission where the clause classifier mislabeled a decision as non-decision).
// HALLUCINATION: an atom asserts a decision the transcript does NOT justify (reverse traceability).
export interface AdversarialFinding {
  kind: "omission" | "hallucination";
  ref: string;                 // clause id (omission) or atom id (hallucination)
  span?: { start: number; end: number };
  reason: string;
}
/** Structural half of the hallucination check: an atom whose evidence_quote is NOT present at its declared span. */
export function structuralHallucinations(atoms: DecisionAtom[], transcript: string): AdversarialFinding[] {
  const out: AdversarialFinding[] = [];
  for (const a of atoms) {
    const p = a.provenance;
    const q = (p.evidence_quote ?? "").trim();
    if (!q) { out.push({ kind: "hallucination", ref: a.id, reason: "atom has no evidence_quote (unjustified)" }); continue; }
    const sp = p.transcript_span;
    const slice = sp ? transcript.slice(sp.start, sp.end) : transcript;
    if (!slice.toLowerCase().includes(q.toLowerCase())) {
      out.push({ kind: "hallucination", ref: a.id, span: sp, reason: "evidence_quote not found at declared span (reverse-traceability fail)" });
    }
  }
  return out;
}

export { canonKey };
