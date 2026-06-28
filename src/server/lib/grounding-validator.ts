/**
 * GROUNDING VALIDATOR — the reality-lock (closure, not CP7).
 *
 * The real invariant of the whole system: NO UNVERIFIED CLAIM SURVIVES INTO EXECUTION. CP1-6 verify that
 * extraction HYPOTHESES are self-consistent, explainable, and conserved — but consensus can agree on
 * something WRONG, and explainability ≠ correctness. Correctness depends on TRANSCRIPT-BINDING INTEGRITY:
 * every node that CLAIMS to be explicit must be provably a substring of the transcript. This gate cannot be
 * overridden by model consensus — it is a deterministic transcript↔IR binding check.
 *
 * Rules (per node):
 *   R1 evidence existence  — an explicit node MUST carry an evidence_quote
 *   R2 substring match     — that quote ∈ transcript (exact, or normalized-exact)
 *   R3 span traceability   — the match yields a char offset (timestamp/segment span is an ingestion follow-on)
 *   R4 no orphan nodes     — every node is GROUNDED (explicit+bound) or honestly INFERRED — never neither
 *
 * Inferred nodes (origin compiler_generated/derived) are NOT transcript claims — they are openly compiler-
 * introduced (the explicit-XOR-inferred invariant). They are allowed but COUNTED (inference_rate); strict
 * mode rejects a strategy whose CRITICAL nodes (confirmation/entry/until) are merely inferred, never taught.
 * A node that CLAIMS explicit but whose quote is NOT in the transcript = UNGROUNDED_VIOLATION = HARD REJECT
 * (a fabricated quote — the exact failure this gate exists to stop).
 */

import type { Provenance, StrategyIR } from "./state-machine-ir.js";

export type GroundMethod = "exact" | "normalized" | "none";
export interface GroundResult { grounded: boolean; method: GroundMethod; char_index?: number }

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/** Is `quote` a real substring of `transcript` — exact, else normalized-exact? Deterministic; no model. */
export function groundQuote(quote: string | undefined, transcript: string): GroundResult {
  if (!quote || !quote.trim()) return { grounded: false, method: "none" };
  const exactIdx = transcript.indexOf(quote);
  if (exactIdx >= 0) return { grounded: true, method: "exact", char_index: exactIdx };
  const nQ = normalize(quote), nT = normalize(transcript);
  if (nQ.length >= 3) { const i = nT.indexOf(nQ); if (i >= 0) return { grounded: true, method: "normalized", char_index: i }; }
  return { grounded: false, method: "none" };
}

export type NodeVerdict = "GROUNDED" | "INFERENCE" | "UNGROUNDED_VIOLATION" | "MISSING_EVIDENCE";
export interface NodeGrounding { node: string; origin: Provenance["origin"]; critical: boolean; evidence_quote?: string; method: GroundMethod; verdict: NodeVerdict }
export interface GroundingReport {
  status: "GROUNDED" | "REJECTED";
  rejection_reasons: string[];
  nodes: NodeGrounding[];
  total: number; grounded: number; inference: number; violations: number;
  grounding_pass_rate: number; // grounded / (grounded + violations) — of nodes that claim grounding
  inference_rate: number;      // inference / total
}

const CRITICAL_NODES = new Set(["wait_state.confirmation", "wait_state.until", "entry", "structural_event"]);

function irNodes(ir: StrategyIR): Array<[string, { provenance: Provenance } | null | undefined]> {
  return [
    ["bias", ir.bias], ["structural_event", ir.structural_event], ["execution_context", ir.execution_context],
    ["wait_state.until", ir.wait_state.until], ["wait_state.confirmation", ir.wait_state.confirmation],
    ["wait_state.invalidated_by", ir.wait_state.invalidated_by], ["entry", ir.entry],
  ];
}

/**
 * Validate that every claimed-explicit IR node is transcript-bound. REJECTS on any ungrounded explicit node
 * (fabricated quote) or missing evidence. `opts.strictCriticalInference` also rejects when a CRITICAL node is
 * merely inferred (never taught) — the "no inference preservation into execution for the load-bearing nodes" rule.
 */
export function validateGrounding(ir: StrategyIR, transcript: string, opts?: { strictCriticalInference?: boolean }): GroundingReport {
  const nodes: NodeGrounding[] = [];
  const rejection_reasons: string[] = [];
  let grounded = 0, inference = 0, violations = 0;

  for (const [name, n] of irNodes(ir)) {
    if (!n) continue;
    const p = n.provenance;
    const critical = CRITICAL_NODES.has(name);
    const isExplicit = p.origin === "explicit" || p.origin === "normalized";
    if (isExplicit) {
      if (!p.evidence_quote) { nodes.push({ node: name, origin: p.origin, critical, method: "none", verdict: "MISSING_EVIDENCE" }); violations++; rejection_reasons.push(`${name}: explicit node missing evidence (R1)`); continue; }
      const g = groundQuote(p.evidence_quote, transcript);
      if (g.grounded) { nodes.push({ node: name, origin: p.origin, critical, evidence_quote: p.evidence_quote, method: g.method, verdict: "GROUNDED" }); grounded++; }
      else { nodes.push({ node: name, origin: p.origin, critical, evidence_quote: p.evidence_quote, method: "none", verdict: "UNGROUNDED_VIOLATION" }); violations++; rejection_reasons.push(`${name}: explicit quote NOT in transcript (R2) — "${p.evidence_quote.slice(0, 50)}"`); }
    } else {
      nodes.push({ node: name, origin: p.origin, critical, method: "none", verdict: "INFERENCE" }); inference++;
      if (opts?.strictCriticalInference && critical) rejection_reasons.push(`${name}: CRITICAL node is inferred, never taught (strict)`);
    }
  }

  const total = nodes.length;
  const status = rejection_reasons.length === 0 ? "GROUNDED" : "REJECTED";
  return {
    status, rejection_reasons, nodes, total, grounded, inference, violations,
    grounding_pass_rate: grounded + violations ? grounded / (grounded + violations) : 1,
    inference_rate: total ? inference / total : 0,
  };
}
