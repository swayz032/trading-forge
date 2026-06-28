/**
 * DECISION PROVENANCE — Checkpoint 5 (tracing BELIEFS, not code).
 *
 * The non-negotiable invariant (operator, elevated above everything):
 *   EVERY executable decision is EITHER explicit (transcript evidence + spans) OR inferred (compiler
 *   justification). NO THIRD CATEGORY. The system never silently invents strategy logic.
 *
 * `labelOf` collapses a node's Provenance into that binary and THROWS if a node is neither well-formed
 * (explicit-without-evidence or inferred-without-justification) — making the invariant a mechanized
 * assertion, not a guideline. `buildDecisionRecord` answers the six "why did we believe…" questions for an
 * emitted trade, each backed by its node's evidence/justification + a confidence — the explainable-replay
 * substrate. Bidirectional: forward (setup→entry) and reverse (entry→setup→transcript) chains.
 *
 * Pure / deterministic. Builds on CP2 `origin` and CP4 confirmation provenance.
 */

import type { Provenance, StrategyIR, Confidence } from "./state-machine-ir.js";
import { COMPILER } from "./state-machine-ir.js";
import type { ConfirmationResult } from "./confirmation-evaluator.js";

export type DecisionLabel =
  | { kind: "explicit"; evidence: string; transcript_lines?: number[]; confidence: Confidence }
  | { kind: "inferred"; justification: string };

export class ProvenanceInvariantError extends Error {}

/** The invariant, mechanized: explicit ⇒ must carry evidence; inferred ⇒ must carry justification. No third. */
export function labelOf(p: Provenance, at: string): DecisionLabel {
  const isExplicit = p.origin === "explicit" || p.origin === "normalized";
  if (isExplicit) {
    if (!p.evidence_quote) throw new ProvenanceInvariantError(`${at}: explicit node has NO transcript evidence (invariant violation)`);
    return { kind: "explicit", evidence: p.evidence_quote, transcript_lines: p.transcript_lines, confidence: p.confidence };
  }
  if (!p.because) throw new ProvenanceInvariantError(`${at}: inferred node has NO justification (invariant violation)`);
  return { kind: "inferred", justification: p.because };
}

/** Node confidence from origin (extraction uncertainty). Distinct from execution confidence (did the predicate fire). */
export function confidenceOf(p: Provenance): number {
  switch (p.origin) {
    case "explicit": return 0.97;
    case "normalized": return 0.9;
    case "derived": return 0.72;
    case "compiler_generated": return 0.6;
  }
}

interface IRNodeLike { provenance: Provenance }
function irNodes(ir: StrategyIR): Array<[string, IRNodeLike | null | undefined]> {
  return [
    ["bias", ir.bias], ["structural_event", ir.structural_event], ["execution_context", ir.execution_context],
    ["wait_state", ir.wait_state], ["wait_state.until", ir.wait_state.until],
    ["wait_state.confirmation", ir.wait_state.confirmation], ["wait_state.invalidated_by", ir.wait_state.invalidated_by],
    ["entry", ir.entry],
  ];
}

/** Enforce the invariant across the whole IR. Returns the explicit/inferred split; throws on any violation. */
export function assertProvenanceInvariant(ir: StrategyIR): { explicit: number; inferred: number } {
  let explicit = 0, inferred = 0;
  for (const [at, n] of irNodes(ir)) { if (!n) continue; (labelOf(n.provenance, at).kind === "explicit" ? explicit++ : inferred++); }
  return { explicit, inferred };
}

// ── Decision record (the six questions) ────────────────────────────────────────
export interface DecisionStep { question: string; answer: string; node: string; label: DecisionLabel; confidence: number }
export interface DecisionRecord {
  entry_bar: number | null;
  steps: DecisionStep[];
  forward_chain: string[];  // setup → … → entry (transcript-ordered)
  reverse_chain: string[];  // entry → … → setup (click-a-trade view)
  explicit_count: number;
  inferred_count: number;
}

/** Answer the six "why did we believe…" questions for an emitted trade, each evidence-or-inference backed. */
export function buildDecisionRecord(ir: StrategyIR, entry_bar: number | null, confirmation?: ConfirmationResult): DecisionRecord {
  const steps: DecisionStep[] = [];
  const add = (question: string, answer: string, node: string, p: Provenance) =>
    steps.push({ question, answer, node, label: labelOf(p, node), confidence: confidenceOf(p) });

  // Q1 — why did we think a setup existed?
  if (ir.structural_event) add("setup_existed", ir.structural_event.event, "structural_event", ir.structural_event.provenance);
  else if (ir.bias) add("setup_existed", `bias ${ir.bias.direction}`, "bias", ir.bias.provenance);

  // Q2 — why did we think it was still valid? (invalidation not triggered) — honest when no invalidation modeled
  if (ir.wait_state.invalidated_by) add("still_valid", `no invalidation (${ir.wait_state.invalidated_by.condition})`, "wait_state.invalidated_by", ir.wait_state.invalidated_by.provenance);
  else add("still_valid", "no invalidation modeled — ASSUMED valid", "wait_state.invalidated_by", COMPILER("educator stated no pre-entry invalidation; compiler assumes the setup stays valid"));

  // Q3 — why did we think waiting completed?
  add("waiting_completed", `until: ${ir.wait_state.until.kind}`, "wait_state.until", ir.wait_state.until.provenance);

  // Q4 — why did we think confirmation happened?
  add("confirmation_happened", confirmation ? `passed via [${confirmation.contributors.join(", ")}]` : "confirmation node", "wait_state.confirmation", ir.wait_state.confirmation.provenance);

  // Q5 — why did we think entry was legal? (eligibility precondition + entry mechanics)
  add("entry_legal", `eligibility ${ir.eligibility.length ? "gated" : "open"}; entry ${ir.entry.order_type}`, "entry", ir.entry.provenance);

  // Q6 — why did we think confidence was sufficient? (execution-side, from the confirmation contributors)
  const execConf = confirmation ? Math.min(0.99, 0.5 + 0.15 * confirmation.contributors.length) : 0.5;
  steps.push({
    question: "confidence_sufficient",
    answer: confirmation ? `${confirmation.contributors.length} contributing axes${confirmation.blocked_by.length ? `, blocked_by [${confirmation.blocked_by.join(", ")}]` : ""}` : "n/a",
    node: "confirmation_result",
    label: confirmation ? { kind: "inferred", justification: "execution-side confidence derived from contributing axes" } : { kind: "inferred", justification: "no confirmation result supplied" },
    confidence: execConf,
  });

  const explicit_count = steps.filter((s) => s.label.kind === "explicit").length;
  const forward = steps.map((s) => `${s.node}: ${s.answer}`);
  return { entry_bar, steps, forward_chain: forward, reverse_chain: [...forward].reverse(), explicit_count, inferred_count: steps.length - explicit_count };
}

// ── Provenance / conservation dashboard (richer than coverage_pct) ──────────────
export interface ProvenanceDashboard {
  transcript_units: number; represented: number; dropped: number; unused: number; // from semantic conservation
  ir_explicit: number; ir_inferred: number;                                        // from the IR invariant
  honesty_ratio: number;  // ir_explicit / (ir_explicit + ir_inferred) — how much is TAUGHT vs compiler-filled
}
export function provenanceDashboard(ir: StrategyIR, conservation: { total: number; executed: number; normalized: number; ignored: number; silent_loss: unknown[] }): ProvenanceDashboard {
  const inv = assertProvenanceInvariant(ir);
  const denom = inv.explicit + inv.inferred;
  return {
    transcript_units: conservation.total,
    represented: conservation.executed + conservation.normalized,
    dropped: conservation.ignored,
    unused: conservation.silent_loss.length,
    ir_explicit: inv.explicit,
    ir_inferred: inv.inferred,
    honesty_ratio: denom ? inv.explicit / denom : 0,
  };
}
