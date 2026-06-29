/**
 * DECISION-GRAPH CANONICALIZATION + SEMANTIC IDEMPOTENCE (v1.1, 2026-06-29).
 *
 * The missing invariant (operator/GPT): run the compiler TWICE on the same transcript -> the decision graph must
 * be IDENTICAL after canonicalization. Not "similar" — identical. This is what makes reproducibility TESTABLE
 * without replay, and it is the answer to the gemma text-variance we PROVED this session (text varies run-to-run
 * while counts stay stable): canonicalization must ABSORB the text variance so the canonical GRAPH is stable. If
 * two runs canonicalize to different graphs, that is a hard reproducibility defect (under-canonicalization or an
 * extractor that didn't recover the same decisions) — caught BEFORE any replay compute.
 *
 * Canonical identity deliberately DROPS the volatile surface (spans, raw object phrasing, discovery order) and
 * keeps only what makes a decision THE decision: its type, its synonym-folded object, its temporal kind, and its
 * dependency STRUCTURE (as canonical keys, not order-dependent ids). Pure / deterministic / standalone.
 */
import { createHash } from "crypto";
import type { DecisionGraph } from "./decision-atom.js";
import { canonKey } from "./decision-atom.js";

export interface CanonicalAtom {
  key: string;                  // `${type}:${object_canonical}` — order/span/phrasing-independent identity
  temporal_kind: string;
  depends_on: string[];         // SORTED canonical keys of dependencies (order-independent)
}

/** Reduce a graph to its canonical, run-invariant form. Two runs that captured the SAME decisions -> SAME output. */
export function canonicalize(graph: DecisionGraph): CanonicalAtom[] {
  const keyOf = new Map(graph.atoms.map((a) => [a.id, canonKey(a)]));
  const canon = graph.atoms.map((a) => ({
    key: canonKey(a),
    temporal_kind: a.temporal_kind,
    depends_on: [...new Set(a.depends_on.map((d) => keyOf.get(d)).filter((k): k is string => !!k))].sort(),
  }));
  // dedup identical canonical atoms (a decision restated/re-extracted is ONE canonical atom), then sort stably.
  const seen = new Map<string, CanonicalAtom>();
  for (const c of canon) {
    const sig = `${c.key}|${c.temporal_kind}|${c.depends_on.join(",")}`;
    if (!seen.has(sig)) seen.set(sig, c);
  }
  return [...seen.values()].sort((x, y) =>
    x.key < y.key ? -1 : x.key > y.key ? 1 : x.depends_on.join(",").localeCompare(y.depends_on.join(",")));
}

export function canonicalHash(graph: DecisionGraph): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(graph))).digest("hex").slice(0, 16);
}

export interface IdempotenceResult {
  runs: number;
  hashes: string[];
  distinct: number;
  idempotent: boolean;          // all runs canonicalize to ONE hash
  drift?: { a: CanonicalAtom[]; b: CanonicalAtom[] }; // first divergent pair, for diagnosis
}
/** Semantic idempotence check: N extraction runs of the SAME transcript must canonicalize to ONE graph. */
export function checkIdempotence(graphs: DecisionGraph[]): IdempotenceResult {
  const hashes = graphs.map(canonicalHash);
  const distinct = new Set(hashes).size;
  const idempotent = distinct <= 1;
  let drift: IdempotenceResult["drift"];
  if (!idempotent) {
    const firstIdx = hashes.findIndex((h) => h !== hashes[0]);
    drift = { a: canonicalize(graphs[0]), b: canonicalize(graphs[firstIdx]) };
  }
  return { runs: graphs.length, hashes, distinct, idempotent, drift };
}
