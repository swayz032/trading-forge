/**
 * GATE 1.5 — SEMANTIC DETERMINISM CHECK (the missing middle between extraction-parity and backtest-correctness).
 *
 * The operator's distinction (2026-06-28): Gate 1 (extraction parity vs golden) proves "Gemma reproduces my
 * format," NOT "a dumb engine can execute this without a human." Those are different claims. This gate answers
 * the one that actually matters for backtesting:
 *
 *     "If extraction is 100%, can the engine execute the strategy without a human touching anything?"
 *
 * It scores each EXECUTABLE field of the compiled IR as PRESENT / IMPLIED / MISSING / AMBIGUOUS, and enforces
 * the operator's pass rule: **0 MISSING and 0 AMBIGUOUS** on extraction-owned fields. IMPLIED passes the
 * EXECUTABILITY gate (a default/inference is runnable) but is surfaced as FAITHFULNESS DEBT ("Implied ≠
 * what-was-taught"), so the two questions stay separate.
 *
 * Architecture-aware: per the two-stage DSL (§13), stop_loss / take_profit / risk_model are
 * framework-overlay-AUTHORITATIVE — the edge IR is designed NOT to carry them. Those are reported
 * FRAMEWORK_OWNED (satisfied by construction), NOT scored as extraction gaps. Scoring them as MISSING would be
 * a false-fail on fields extraction deliberately doesn't own.
 *
 * Pure / deterministic / standalone (zero production wiring).
 */

import type { StrategyIR } from "./state-machine-ir.js";

export type FieldStatus = "PRESENT" | "IMPLIED" | "MISSING" | "AMBIGUOUS" | "FRAMEWORK_OWNED";

export interface FieldScore { field: string; status: FieldStatus; owner: "extraction" | "framework"; detail: string }
export interface DeterminismReport {
  fields: FieldScore[];
  determinism_pass: boolean;       // operator's rule: 0 MISSING and 0 AMBIGUOUS among extraction-owned fields
  missing: string[];
  ambiguous: string[];
  faithfulness_debt: string[];     // IMPLIED extraction fields — executable but inferred, not taught (NOT a gate failure)
  framework_owned: string[];       // stop/tp/risk — satisfied by overlay, not an extraction gap
}

const fromOrigin = (p: { origin?: string } | null | undefined): "PRESENT" | "IMPLIED" | "MISSING" => {
  if (!p || !p.origin) return "MISSING";
  if (p.origin === "explicit" || p.origin === "normalized") return "PRESENT";
  return "IMPLIED"; // derived | compiler_generated → an inference/default the engine can run, but not taught
};

/** Score the compiled IR for executable determinism. */
export function scoreDeterminism(ir: StrategyIR): DeterminismReport {
  const fields: FieldScore[] = [];
  const add = (field: string, status: FieldStatus, owner: "extraction" | "framework", detail: string) =>
    fields.push({ field, status, owner, detail });

  // 1. direction — the engine must know long/short/both. (Default "both" is compiler_generated → IMPLIED, still runnable.)
  add("direction", ir.bias ? fromOrigin(ir.bias.provenance) : "MISSING", "extraction", ir.bias ? `direction=${ir.bias.direction}` : "no bias node");

  // 2. setup / execution_context — WHERE the setup is valid. Present-but-no-ref = AMBIGUOUS (engine can't resolve
  //    the zone); absent = IMPLIED (a context-free trigger is runnable but over-fires — flagged, not blocked).
  if (ir.execution_context) {
    const ec = ir.execution_context;
    const resolvable = !!ec.ref || !!ec.bounds;
    add("setup_context", resolvable ? fromOrigin(ec.provenance) : "AMBIGUOUS", "extraction",
      resolvable ? `zone=${ec.zone} ref=${ec.ref ?? "bounds"}` : `zone=${ec.zone} but NO concrete ref/bounds — engine can't resolve`);
  } else {
    add("setup_context", "IMPLIED", "extraction", "no execution context — trigger-only (runnable, may over-fire)");
  }

  // 3. entry_trigger — THE critical field: WHAT fires the entry. Three executable shapes:
  //    (a) a compiled confirmation compound; (b) zero-wait where the structural event IS the trigger;
  //    else MISSING (waiting for a confirmation that never compiled = not backtestable).
  const conf = ir.wait_state.confirmation;
  const hasAlternatives = (conf.alternatives?.length ?? 0) > 0;
  if (conf.compound) {
    add("entry_trigger", hasAlternatives ? "AMBIGUOUS" : fromOrigin(conf.provenance), "extraction",
      hasAlternatives ? "unresolved OR-alternatives — engine can't choose a branch" : "confirmation compound present");
  } else if (ir.wait_state.until.kind === "now" && ir.structural_event) {
    add("entry_trigger", fromOrigin(ir.structural_event.provenance), "extraction", `zero-wait: event '${ir.structural_event.event}' is the trigger`);
  } else {
    add("entry_trigger", "MISSING", "extraction",
      `no executable trigger — confirmation did not compile (${(ir.meta?.quarantine_reason as string) ?? "no compound"}) and not zero-wait (until=${ir.wait_state.until.kind})`);
  }

  // 4. session/time filter — present→PRESENT; absent→IMPLIED (always-on is a runnable default).
  const sessionGate = ir.eligibility.find((g) => g.type === "session");
  add("session_filter", sessionGate ? "PRESENT" : "IMPLIED", "extraction", sessionGate ? `session gate: ${sessionGate.name}` : "no session filter — always-on (runnable default)");

  // 5. invalidation — setup-cancel before entry. Absent→IMPLIED (the framework stop is the risk backstop).
  const inval = ir.wait_state.invalidated_by;
  add("invalidation", inval ? fromOrigin(inval.provenance) : "IMPLIED", "extraction", inval ? `invalidated_by: ${inval.condition}` : "no setup-invalidation — framework stop is the backstop");

  // 6-8. stop_loss / take_profit / risk_model — FRAMEWORK-OWNED (overlay-authoritative; not an extraction gap).
  add("stop_loss", "FRAMEWORK_OWNED", "framework", "framework-overlay authoritative (structural ATR stop)");
  add("take_profit", "FRAMEWORK_OWNED", "framework", "framework-overlay authoritative (Style C / adaptive)");
  add("risk_model", "FRAMEWORK_OWNED", "framework", "framework-overlay authoritative (risk-derived pyramid)");

  const extraction = fields.filter((f) => f.owner === "extraction");
  const missing = extraction.filter((f) => f.status === "MISSING").map((f) => f.field);
  const ambiguous = extraction.filter((f) => f.status === "AMBIGUOUS").map((f) => f.field);
  const faithfulness_debt = extraction.filter((f) => f.status === "IMPLIED").map((f) => f.field);
  const framework_owned = fields.filter((f) => f.status === "FRAMEWORK_OWNED").map((f) => f.field);

  return {
    fields,
    determinism_pass: missing.length === 0 && ambiguous.length === 0, // operator's rule
    missing, ambiguous, faithfulness_debt, framework_owned,
  };
}
