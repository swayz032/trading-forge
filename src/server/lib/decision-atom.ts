/**
 * DECISION ATOM — the EXECUTABLE layer BENEATH SpeakerItem (v1.1 architecture, 2026-06-29).
 *
 * Operator/GPT correction: do NOT replace SpeakerItem. SpeakerItem is the SEMANTIC-CONCEPT layer (named tools,
 * terminology, attribution). DecisionAtom is the PROGRAM-EXECUTION layer. One SpeakerItem COMPILES to many atoms:
 *   "liquidity sweep"  ->  WAIT_STRUCTURE -> VERIFY_STRUCTURE -> WAIT_RETEST -> WAIT_CONFIRMATION
 * Pipeline:  Transcript -> Clause -> SpeakerItem -> DecisionAtom -> Decision Graph -> Executable IR (StrategyIR).
 *
 * An atom is a finer-grained IR node: it reuses the IR's `Provenance` (span + origin + confidence) and maps to
 * an S0-S8 lifecycle state. The atom GRAPH is the general intermediate; it assembles INTO the canonical
 * single-path `StrategyIR`. Pure / deterministic / standalone (zero production wiring).
 */
import { createHash } from "crypto";
import type { Provenance, StateId } from "./state-machine-ir.js";

/** The executable-decision vocabulary. One SpeakerItem -> many atoms. Each maps to an S0-S8 lifecycle state. */
export type AtomType =
  | "WAIT_SESSION"       // S3 — gate: inside a session window (condition)
  | "FILTER"             // S3 — gate: regime / instrument / bias precondition (condition)
  | "WAIT_BIAS"          // S1 — directional bias established
  | "WAIT_STRUCTURE"     // S2 — a structural event must OCCUR (sweep/MSS/BOS/displacement)
  | "VERIFY_STRUCTURE"   // S2 — the structural event's validity is confirmed
  | "WAIT_RETEST"        // S4 — wait-state progression (pullback / retest / reclaim)
  | "WAIT_CONFIRMATION"  // S5 — a confirmation event (engulfing / close-back-inside)
  | "CONFIRM_DIRECTION"  // S5 — the confirmation establishes/agrees direction
  | "ENABLE_ENTRY"       // S5 — entry becomes armed
  | "ENTER"             // S6 — execute entry (TERMINAL of the executable path)
  | "INVALIDATE"         // S7 — invalidation cancels the pending setup
  | "EXCEPTION"          // branch — alternate path ("unless ...")
  | "RESET"              // back to S0 — setup invalidated, restart
  | "EXIT_HINT";         // S8 — exit guidance (mostly framework-overlay-owned)

/**
 * Events OCCUR (edge-triggered: fire once at a bar — "liquidity sweep", "engulfing closes").
 * Conditions REMAIN TRUE (level-triggered: gate every bar while held — "after London open", "sweep completed").
 * Execution engines treat these differently; keeping them separate removes ambiguity in deterministic compilation.
 */
export type TemporalKind = "event" | "condition";

/**
 * A PREDICATE refines a decision NODE's satisfaction — it is NOT its own graph node. The over-extraction finding
 * (2026-06-29): gemma fragments ONE decision ("confirmation means displacement + body-close + follow-through")
 * into many atoms. Those sub-features are predicates UNDER the node, not separate state transitions. The
 * semantic compression layer lifts them here so the graph spine threads decision nodes, not predicate noise.
 */
export interface Predicate {
  kind: string;              // the predicate's atom type before compression (e.g. "VERIFY_STRUCTURE")
  object: string;
  object_canonical: string;
  provenance: Provenance;
}

export interface DecisionAtom {
  /** Canonical id `${type}:${object_canonical}#${ordinal}` — the SAME decision from two runs gets the SAME id. */
  id: string;
  type: AtomType;
  temporal_kind: TemporalKind;
  /** The decision's object, near-verbatim ("liquidity sweep of the asian high"). */
  object: string;
  /** Synonym/umbrella-folded object — drives canonical identity + semantic idempotence. */
  object_canonical: string;
  /** FIRST-CLASS dependency edges: atom ids that must be satisfied BEFORE this atom (enables graph proofs). */
  depends_on: string[];
  /** Span + origin + confidence — reused IR node model; reverse-traceable to the transcript. */
  provenance: Provenance;
  /** Supporting predicates folded in by the compression layer (sub-features of THIS decision; preserved, not deleted). */
  predicates?: Predicate[];
  /** OPTIONAL — the SpeakerItem this atom compiled from. Session/timing/exception atoms may have NO parent. */
  parent_speaker_item?: string;
}

/** The decision graph = atoms + their first-class dependency edges. Assembles INTO StrategyIR. */
export interface DecisionGraph {
  atoms: DecisionAtom[];
}

// ── Atom -> IR lifecycle state (the bridge; the decision graph IS the S0-S8 machine) ──────────────
const ATOM_STATE: Record<AtomType, StateId> = {
  WAIT_SESSION: "S3_execution_context", FILTER: "S3_execution_context",
  WAIT_BIAS: "S1_bias",
  WAIT_STRUCTURE: "S2_structural_event", VERIFY_STRUCTURE: "S2_structural_event",
  WAIT_RETEST: "S4_waiting",
  WAIT_CONFIRMATION: "S5_confirmation", CONFIRM_DIRECTION: "S5_confirmation", ENABLE_ENTRY: "S5_confirmation",
  ENTER: "S6_entry",
  INVALIDATE: "S7_managed", EXCEPTION: "S7_managed", RESET: "S0_neutral", EXIT_HINT: "S8_exit",
};
export const atomToState = (t: AtomType): StateId => ATOM_STATE[t];

/** ENTER is the terminal of an executable path. Graph conservation (Ledger C) requires every atom to reach one. */
export const isTerminalAtom = (a: DecisionAtom): boolean => a.type === "ENTER";

// ── Canonical object normalization (synonym / umbrella fold) — the idempotence keystone ──────────
const UMBRELLA = /\b(strategy|setup|model|system|method|the|a|an|of|on|for|your|my|some|that|this)\b/gi;
const SYNONYMS: Array<[RegExp, string]> = [
  [/\b(liquidity )?sweep|stop ?run|raid|grab\b/gi, "sweep"],
  [/\border ?block|ob\b/gi, "order_block"],
  [/\bfair ?value ?gap|fvg|imbalance\b/gi, "fvg"],
  [/\bmarket ?structure ?shift|mss|change of character|choch\b/gi, "mss"],
  [/\bbreak ?of ?structure|bos\b/gi, "bos"],
  [/\bengulf(ing)?\b/gi, "engulfing"],
  [/\bretest|pull ?back|mitigation\b/gi, "retest"],
  [/\blondon( open| session)?\b/gi, "london"],
  [/\bnew york|ny( open| session)?\b/gi, "new_york"],
];
/** Fold a decision's object to a canonical key so two runs that captured the same decision match. */
export function canonObject(s: string): string {
  let t = (s || "").toLowerCase().replace(/_/g, " ");   // snake_case -> spaces so "session_high" === "session high"
  for (const [re, to] of SYNONYMS) t = t.replace(re, to);
  return t.replace(UMBRELLA, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Stable atom id. ordinal disambiguates genuine duplicates of the SAME (type, canonical object). */
export function atomId(type: AtomType, objectCanonical: string, ordinal = 0): string {
  return `${type}:${objectCanonical}#${ordinal}`;
}

/** Order-independent canonical key (no ordinal) — the identity used for idempotence + dependency canonicalization. */
export const canonKey = (a: Pick<DecisionAtom, "type" | "object_canonical">): string => `${a.type}:${a.object_canonical}`;

export const sha12 = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 12);
