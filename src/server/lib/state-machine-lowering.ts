/**
 * STATE-MACHINE LOWERING — Checkpoint 2 (representation, NOT execution).
 *
 * Lowers the existing structured extraction (the "semantic graph" stand-in: entry_sequence + confluences +
 * direction; the fresh transcript→semantic LLM parse is CP6's Gemma multi-pass) into the state-machine IR.
 *
 * CP2 DISCIPLINE: this changes REPRESENTATION only. Execution is untouched — immediate-entry strategies
 * lower to the ZERO-WAIT degenerate whose `confirmation.compound` is byte-identical to what the frozen
 * event-centric compiler produces (parity). Wait-state strategies get a populated `wait_state` in the IR but
 * NOTHING executes it differently yet (that activation is CP3). Every node carries provenance + origin;
 * compiler-filled defaults are labeled origin=compiler_generated.
 */

import { compileConfirmationCompound, type ConfirmationInput } from "./confirmation-compiler.js";
import { scanContextGates } from "./context-gate.js";
import {
  EXPLICIT, COMPILER, type StrategyIR, type WaitPredicate, type WaitPredicateKind,
  type StructuralEventKind, type ExecutionZoneKind,
} from "./state-machine-ir.js";

const stepText = (s: { action?: string | null; rationale?: string | null }) => `${s.action ?? ""} ${s.rationale ?? ""}`;

// wait-language → progression predicate (REPRESENTATION; CP3 activates execution)
const WAIT_PREDICATES: Array<{ kind: WaitPredicateKind; re: RegExp }> = [
  { kind: "retest", re: /\bretest|re-?test\b/i },
  { kind: "reclaim", re: /\breclaim|recover the level|back (?:above|below)\b/i },
  { kind: "sweep", re: /\bsweep|liquidity (?:grab|run)|take (?:out )?(?:the )?(?:high|low|liquidity)\b/i },
  { kind: "close_back_inside", re: /\bback (?:in|inside) (?:the )?(?:range|band)|close back\b/i },
  { kind: "price_reenters", re: /\b(?:come|comes|wait for price to come|return|returns|re-?enter|pull ?back|tap back|trade back into)\b/i },
  { kind: "tap", re: /\btap(?:s| into)?\b/i },
];

const EVENT_KINDS: Array<{ kind: StructuralEventKind; re: RegExp }> = [
  { kind: "choch", re: /\bchange of character|choch\b/i },
  { kind: "mss", re: /\bmarket structure shift|\bmss\b/i },
  { kind: "bos", re: /\bbreak of structure|\bbos\b|breaks? (?:the )?structure\b/i },
  { kind: "displacement", re: /\bdisplacement|displac\w+\b/i },
  { kind: "sweep", re: /\bsweep|liquidity (?:grab|run)\b/i },
  { kind: "breakout", re: /\bbreak ?out|breaks? (?:above|below|out)\b/i },
  { kind: "reclaim", re: /\breclaim\b/i },
];

const ZONE_KINDS: Array<{ zone: ExecutionZoneKind; re: RegExp }> = [
  { zone: "order_block", re: /\border block\b/i },
  { zone: "fair_value_gap", re: /\bfair value gap|\bfvg\b|imbalance\b/i },
  { zone: "supply_demand", re: /\bsupply|demand zone\b/i },
  { zone: "fib_zone", re: /\bfib|optimum|premium|discount|golden pocket\b/i },
  { zone: "range_edge", re: /\brange (?:high|low|edge)|opening range\b/i },
];

const firstMatch = <T>(corpus: string, table: Array<{ re: RegExp } & T>): T | null =>
  table.find((t) => t.re.test(corpus)) ?? null;

export interface LoweringInput extends ConfirmationInput { direction?: "long" | "short" | "both" }

/** Lower extraction → StrategyIR. Immediate ⇒ zero-wait (parity); delayed ⇒ populated wait_state (rep only). */
export function lowerToStateMachineIR(input: LoweringInput): StrategyIR {
  const compoundResult = compileConfirmationCompound(input);
  const steps = input.entry_sequence ?? [];
  const corpus = [input.transcript ?? "", ...steps.map(stepText)].join("\n");
  const ctx = scanContextGates(corpus);
  const direction = input.direction ?? "both";

  // S4 wait predicate — find the step that introduces the wait
  const waitStep = steps.find((s) => WAIT_PREDICATES.some((w) => w.re.test(stepText(s))));
  const waitHit = waitStep ? firstMatch(stepText(waitStep), WAIT_PREDICATES) : null;
  const until: WaitPredicate = waitHit
    ? { kind: waitHit.kind, provenance: EXPLICIT(waitStep ? stepText(waitStep).trim().slice(0, 80) : undefined) }
    : { kind: "now", provenance: COMPILER("no wait language found — zero-wait degenerate (immediate entry)") };

  // S2 structural event (optional)
  const ev = firstMatch(corpus, EVENT_KINDS);
  // S3 execution context (the zone) — prefer a poi/zone gate, else detect from corpus
  const zoneGate = ctx.gates.find((g) => g.type === "zone" || g.type === "poi");
  const zoneHit = firstMatch(corpus, ZONE_KINDS);

  return {
    schema_version: "state_machine_v1",
    bias: input.direction
      ? { kind: "bias", direction, provenance: EXPLICIT(`direction: ${direction}`) }
      : { kind: "bias", direction: "both", provenance: COMPILER("no explicit bias — default both (symmetric futures)") },
    eligibility: ctx.gates.filter((g) => g.type === "session" || g.type === "regime"),
    structural_event: ev
      ? { kind: "structural_event", event: ev.kind, provenance: EXPLICIT() }
      : null,
    execution_context: zoneGate
      ? { kind: "execution_context", zone: (zoneHit?.zone ?? "named_level"), ref: zoneGate.params.level ?? zoneGate.name, provenance: EXPLICIT(zoneGate.evidence_quote) }
      : zoneHit
        ? { kind: "execution_context", zone: zoneHit.zone, provenance: EXPLICIT() }
        : null,
    wait_state: {
      provenance: until.kind === "now" ? COMPILER("zero-wait: event is the confirmation") : EXPLICIT(),
      active: until.kind !== "now",
      until,
      confirmation: { kind: "confirmation", compound: compoundResult.compound, provenance: EXPLICIT() },
    },
    entry: { kind: "entry", order_type: "market", direction, provenance: COMPILER("entry order-type not stated — default market") },
    meta: { lowered_from: "structured_extraction", quarantine_reason: compoundResult.quarantine_reason },
  };
}
