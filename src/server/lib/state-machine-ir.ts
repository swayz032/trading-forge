/**
 * STATE-MACHINE IR — Checkpoint 1 (TYPES ONLY; no compiler/execution changes).
 *
 * Replaces the event-centric `event → trade` model (frozen baseline `fidelity-baseline-event-centric`,
 * which fit only 8% of the corpus) with a state machine that represents STATE OVER TIME — because the blind
 * entry-timing taxonomy showed 92% of educators DELAY entry into a wait-state:
 *
 *   S0 Neutral → S1 Bias → S2 Structural Event → S3 Execution Context → S4 Waiting
 *              → S5 Confirmation → S6 Entry → S7 Managed → S8 Exit
 *
 * Every educator instruction CREATES / MODIFIES / CONSUMES state (vs the old flat "trigger, trigger…").
 * `wait_state` is a FIRST-CLASS object so retest / pullback / sweep / reclaim / multi-day waits are DATA,
 * not new primitives. immediate/continuous strategies = the ZERO-WAIT degenerate (`until.kind === "now"`),
 * so the baseline is a strict special case → nothing regresses.
 *
 * Design: docs/designs/state-machine-ir-redesign.md. This file is the SCHEMA — it is imported by NO runtime
 * execution path in Checkpoint 1 (proves "zero replay behavior change"). Checkpoint 2 wires lowering.
 */

import type { CompoundConfirmation } from "./confirmation-compiler.js";
import type { ContextGate } from "./context-gate.js";

// ── Provenance + confidence on EVERY node (operator rule) ──────────────────────
// Distinguishes what the educator EXPLICITLY said from what the compiler/model INFERRED. This is what lets
// the validator ask "are we backtesting on instructions or on assumptions?".
export type Confidence = "explicit" | "inferred";
/**
 * `origin` (CP2 — distinct from `confidence`): HOW the node got here, not just stated-vs-inferred.
 *  - explicit            — educator literally stated it
 *  - normalized          — same meaning, different wording (synonym/umbrella reworded)
 *  - derived             — required COMBINING multiple statements
 *  - compiler_generated  — needed for execution but NEVER stated (timeouts, market-default, zero-wait)
 * On a replay disagreement: a wrong trade from a `compiler_generated` node exonerates the extractor instantly.
 */
export type Origin = "explicit" | "normalized" | "derived" | "compiler_generated";
export interface Provenance {
  transcript_lines?: number[]; // source line refs (forward+reverse traceability)
  evidence_quote?: string;     // verbatim span the node was derived from
  confidence: Confidence;
  origin: Origin;
  inferred: boolean;           // true = compiler/model filled it in, NOT stated by the educator
  because?: string;            // when inferred/derived/compiler-generated, the reasoning (audit trail)
}
export const EXPLICIT = (evidence_quote?: string, transcript_lines?: number[]): Provenance =>
  ({ confidence: "explicit", origin: "explicit", inferred: false, evidence_quote, transcript_lines });
export const NORMALIZED = (because: string, evidence_quote?: string): Provenance =>
  ({ confidence: "explicit", origin: "normalized", inferred: false, because, evidence_quote });
export const DERIVED = (because: string, evidence_quote?: string): Provenance =>
  ({ confidence: "inferred", origin: "derived", inferred: true, because, evidence_quote });
/** Compiler-generated: needed for execution, never stated. The default for baseline-filled defaults. */
export const COMPILER = (because: string): Provenance =>
  ({ confidence: "inferred", origin: "compiler_generated", inferred: true, because });
/** Back-compat alias — INFERRED defaults to compiler_generated origin (baseline fills are compiler-made). */
export const INFERRED = (because: string, evidence_quote?: string): Provenance =>
  ({ confidence: "inferred", origin: "compiler_generated", inferred: true, because, evidence_quote });

export interface IRNode { provenance: Provenance }

// ── Lifecycle states ──────────────────────────────────────────────────────────
export type StateId =
  | "S0_neutral" | "S1_bias" | "S2_structural_event" | "S3_execution_context"
  | "S4_waiting" | "S5_confirmation" | "S6_entry" | "S7_managed" | "S8_exit";

// S1 — bias / direction (state_creator)
export interface BiasNode extends IRNode { kind: "bias"; direction: "long" | "short" | "both"; basis?: string }

// S2 — the structural event (the trigger that ALREADY happened; in the old model this WAS the entry)
export type StructuralEventKind = "bos" | "choch" | "mss" | "sweep" | "displacement" | "breakout" | "reclaim";
export interface StructuralEventNode extends IRNode { kind: "structural_event"; event: StructuralEventKind; level_ref?: string }

// S3 — execution context (the zone/level drawn, where the wait + entry happen)
export type ExecutionZoneKind = "order_block" | "fair_value_gap" | "supply_demand" | "range_edge" | "fib_zone" | "named_level";
export interface ExecutionContextNode extends IRNode { kind: "execution_context"; zone: ExecutionZoneKind; ref?: string; bounds?: { min: number; max: number } }

// S4 — wait predicate (the progression condition). "now" = zero-wait degenerate (immediate/continuous).
export type WaitPredicateKind = "price_reenters" | "retest" | "sweep" | "reclaim" | "close_back_inside" | "tap" | "now";
export interface WaitPredicate extends IRNode { kind: WaitPredicateKind; target_ref?: string }

// Invalidation — cancels THIS pending setup before entry (S2-S5 → S0). Distinct from eligibility (regime).
export interface InvalidationNode extends IRNode { kind: "invalidation"; condition: string }

// S5 — confirmation. The 5 shipped axes (selection / multi-leg / strength / anchor) live INSIDE `compound`
// (re-rooted from confirmation-compiler, MOVED not rewritten). `alternatives` = the OR-operator (the blind-gen
// secondary gap), first-class here.
export interface ConfirmationNode extends IRNode {
  kind: "confirmation";
  compound: CompoundConfirmation | null;
  alternatives?: ConfirmationNode[];
}

// S4 wrapper — the first-class wait-state object. Waiting BEHAVIOR is DATA.
export interface WaitState extends IRNode {
  active: boolean;
  until: WaitPredicate;               // progression condition (zone-return/retest/sweep/reclaim/now)
  confirmation: ConfirmationNode;     // what validates once `until` is met
  invalidated_by?: InvalidationNode;  // cancels the setup before entry
  expires?: string;                   // hard scope (e.g. "session_end")
  timeout_bars?: number;              // soft scope
}

// S6 — entry mechanics
export type OrderType = "market" | "limit" | "stop";
export interface EntryNode extends IRNode { kind: "entry"; order_type: OrderType; at_ref?: string; direction: "long" | "short" | "both" }

// S7/S8 — framework-overlay AUTHORITATIVE. The EDGE IR does NOT populate these (two-stage philosophy, §13);
// the overlay owns stop/TP/sizing. Typed for completeness only.
export interface ManagementNode extends IRNode { kind: "management"; overlay_authoritative: true }
export interface ExitNode extends IRNode { kind: "exit"; overlay_authoritative: true }

// ── The whole machine ─────────────────────────────────────────────────────────
export interface StrategyIR {
  schema_version: "state_machine_v1";
  bias: BiasNode | null;                          // S1
  eligibility: ContextGate[];                     // precondition gate (session/regime — REUSES 3A context_gates)
  structural_event: StructuralEventNode | null;   // S2
  execution_context: ExecutionContextNode | null; // S3
  wait_state: WaitState;                           // S4 (with S5 confirmation inside; until="now" for immediate)
  entry: EntryNode;                               // S6  (S7/S8 overlay-owned, not in the edge IR)
  meta?: Record<string, unknown>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Zero-wait degenerate = the old event-centric model (the event IS the confirmation, no waiting). */
export function isZeroWait(ir: StrategyIR): boolean { return ir.wait_state.until.kind === "now"; }

/** Walk every node with its dotted path (for the validator queries below). */
function walkNodes(ir: StrategyIR): Array<{ at: string; provenance: Provenance }> {
  const out: Array<{ at: string; provenance: Provenance }> = [];
  const add = (at: string, n?: { provenance: Provenance } | null) => { if (n) out.push({ at, provenance: n.provenance }); };
  add("bias", ir.bias);
  add("structural_event", ir.structural_event);
  add("execution_context", ir.execution_context);
  add("wait_state", ir.wait_state);
  add("wait_state.until", ir.wait_state.until);
  add("wait_state.confirmation", ir.wait_state.confirmation);
  add("wait_state.invalidated_by", ir.wait_state.invalidated_by);
  add("entry", ir.entry);
  return out;
}

/** Collect every node carrying an INFERRED value — the "are we backtesting on assumptions?" query. */
export function inferredNodes(ir: StrategyIR): Array<{ at: string; because?: string }> {
  return walkNodes(ir).filter((n) => n.provenance.inferred).map((n) => ({ at: n.at, because: n.provenance.because }));
}

/** Collect compiler-generated nodes — CP2 acceptance: these must be explicitly labeled origin=compiler_generated. */
export function compilerGeneratedNodes(ir: StrategyIR): Array<{ at: string; because?: string }> {
  return walkNodes(ir).filter((n) => n.provenance.origin === "compiler_generated").map((n) => ({ at: n.at, because: n.provenance.because }));
}

/**
 * BRIDGE (Checkpoint 1 acceptance): express the FROZEN event-centric output as a StrategyIR — proving the
 * new schema can represent the baseline, as the zero-wait degenerate. The wait/structural/zone nodes are
 * INFERRED (the old model never captured them), which is exactly the truth and is flagged as such.
 */
export function fromEventCentric(input: {
  compound: CompoundConfirmation | null;
  eligibility?: ContextGate[];
  direction?: "long" | "short" | "both";
}): StrategyIR {
  const direction = input.direction ?? "both";
  return {
    schema_version: "state_machine_v1",
    bias: null,
    eligibility: input.eligibility ?? [],
    structural_event: null,
    execution_context: null,
    wait_state: {
      provenance: INFERRED("event-centric baseline has no explicit wait — entry fires on the event"),
      active: false,
      until: { kind: "now", provenance: INFERRED("zero-wait degenerate: the event IS the confirmation") },
      confirmation: { kind: "confirmation", compound: input.compound, provenance: EXPLICIT() },
    },
    entry: { kind: "entry", order_type: "market", direction, provenance: INFERRED("baseline market-on-event") },
  };
}
