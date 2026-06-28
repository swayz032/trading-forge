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
  COMPILER, SPAN, DERIVED, type Provenance, type StrategyIR, type WaitPredicate, type WaitPredicateKind,
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

// invalidation = CANCELS the setup BEFORE entry (distinct from a managing stop-loss). Tight matcher.
const INVALIDATION_RE = /\bno trade (?:if|unless|when|until)\b|\binvalidat\w*|setup (?:is )?(?:void|dead|invalid)|cancel(?:s|led)? the setup|if (?:price |it )?closes? (?:back )?(?:below|above)[^.]{0,40}(?:no trade|invalid|cancel|skip)/i;

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

/** SPAN-NATIVE binding: locate `candidate` in the TRANSCRIPT (exact → flexible word-gap) and return a real
 * transcript slice. NEVER returns generated text — only what is provably in the transcript. */
function locateTranscriptSpan(transcript: string, candidate: string): { start: number; end: number; quote: string } | null {
  const c = (candidate || "").trim();
  if (!transcript || c.length < 3) return null;
  const exact = transcript.indexOf(c);
  if (exact >= 0) return { start: exact, end: exact + c.length, quote: c };
  const words = c.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1).slice(0, 8);
  if (words.length < 1) return null;
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^a-z0-9]{1,12}"), "i");
  const m = transcript.match(re);
  return m && m.index != null ? { start: m.index, end: m.index + m[0].length, quote: m[0] } : null;
}
/** Span-native explicit provenance, or `null` if the candidate is NOT in the transcript (caller infers). */
const spanProv = (transcript: string, candidate: string): Provenance | null => {
  const s = locateTranscriptSpan(transcript, candidate);
  return s ? SPAN(s.quote, s.start, s.end) : null;
};
/** First regex match located AS A TRANSCRIPT SPAN (not the paraphrased corpus). */
const spanByRegex = (transcript: string, re: RegExp): Provenance | null => {
  const m = transcript.match(re);
  return m && m.index != null ? SPAN(m[0], m.index, m.index + m[0].length) : null;
};

const SPAN_STOPWORDS = new Set(["the","a","an","to","of","and","or","for","with","that","this","then","you","your","it","is","are","be","on","in","at","as","we","i","my","will","can","want","just","one","up","down"]);
/** MAXIMAL-SPAN binding (maximal span capture): when the FULL candidate is not a verbatim transcript slice,
 * bind to the LONGEST contiguous content-word run from the candidate that IS provably in the transcript
 * (≥2 content words, or one distinctive ≥6-char word). Span-native + honest — returns a REAL transcript
 * slice, never generated text. Recovers a PARAPHRASED confirmation ("...engulfs THE PREVIOUS candle" vs the
 * transcript's "...engulfs THIS candle") as a grounded node instead of forcing it to DERIVED inference. */
function locateMaximalSpan(transcript: string, candidate: string): { start: number; end: number; quote: string } | null {
  const full = locateTranscriptSpan(transcript, candidate);
  if (full) return full;
  if (!transcript) return null;
  const words = (candidate || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 12);
  for (let len = Math.min(words.length, 8); len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const seq = words.slice(i, i + len);
      const content = seq.filter((w) => !SPAN_STOPWORDS.has(w) && w.length > 1);
      const specific = content.length >= 2 || content.some((w) => w.length >= 6); // honest: never bind on a lone generic word
      if (!specific) continue;
      const re = new RegExp(seq.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^a-z0-9]{1,12}"), "i");
      const m = transcript.match(re);
      if (m && m.index != null) return { start: m.index, end: m.index + m[0].length, quote: m[0] };
    }
  }
  return null;
}
/** Span-native provenance via maximal span capture, or null if no specific verbatim run exists (caller infers). */
const maximalSpanProv = (transcript: string, candidate: string): Provenance | null => {
  const s = locateMaximalSpan(transcript, candidate);
  return s ? SPAN(s.quote, s.start, s.end) : null;
};

/** Lower extraction → StrategyIR, SPAN-NATIVE: every explicit node's evidence is a real transcript slice,
 * else the node is honestly DERIVED/COMPILER (inference). No paraphrase ever enters as "explicit". */
export function lowerToStateMachineIR(input: LoweringInput): StrategyIR {
  const compoundResult = compileConfirmationCompound(input);
  const steps = input.entry_sequence ?? [];
  const transcript = input.transcript ?? "";
  const corpus = [transcript, ...steps.map(stepText)].join("\n");
  const ctx = scanContextGates(corpus);
  const direction = input.direction ?? "both";

  // S4 wait — TRANSCRIPT-FIRST: a wait phrase found in the transcript binds to a span; one found only in the
  // paraphrased steps is DERIVED (honest inference); none → zero-wait.
  const twHit = WAIT_PREDICATES.map((w) => ({ w, m: transcript.match(w.re) })).find((x) => x.m && x.m.index != null);
  const stepWait = steps.find((s) => WAIT_PREDICATES.some((w) => w.re.test(stepText(s))));
  const until: WaitPredicate = twHit
    ? { kind: twHit.w.kind, provenance: SPAN(twHit.m![0], twHit.m!.index!, twHit.m!.index! + twHit.m![0].length) }
    : stepWait
      ? { kind: firstMatch(stepText(stepWait), WAIT_PREDICATES)!.kind, provenance: DERIVED("wait stated in extraction steps; no verbatim transcript span") }
      : { kind: "now", provenance: COMPILER("no wait language — zero-wait degenerate (immediate entry)") };

  const invalStep = steps.find((s) => INVALIDATION_RE.test(stepText(s)));
  const invalSpan = invalStep ? spanByRegex(transcript, INVALIDATION_RE) : null;

  const ev = firstMatch(corpus, EVENT_KINDS);
  const evProv = ev ? spanByRegex(transcript, ev.re) : null;        // span if the event word is IN the transcript
  const zoneGate = ctx.gates.find((g) => g.type === "zone" || g.type === "poi");
  const zoneHit = firstMatch(corpus, ZONE_KINDS);
  const zoneProv = zoneGate ? (spanProv(transcript, zoneGate.evidence_quote || "") ?? (zoneHit ? spanByRegex(transcript, zoneHit.re) : null))
    : zoneHit ? spanByRegex(transcript, zoneHit.re) : null;

  const primaryLeg = compoundResult.compound?.legs.find((l) => l.order === compoundResult.compound!.primary_order);
  // maximal span capture: bind confirmation to the largest provable verbatim transcript run from the leg
  // (recovers paraphrased confirmation as grounded instead of inferred — the controlled-rig INFERENCE_DISAGREEMENT fix)
  const confProv = compoundResult.compound
    ? (maximalSpanProv(transcript, primaryLeg?.evidence_quote || "") ?? DERIVED("confirmation compiled from extraction; no verbatim transcript span"))
    : COMPILER(`no confirmation compiled (${compoundResult.quarantine_reason ?? "unknown"})`);

  return {
    schema_version: "state_machine_v1",
    // bias direction is a CLASSIFICATION (from direction_class), not a quote → honestly DERIVED, never explicit
    bias: input.direction
      ? { kind: "bias", direction, provenance: DERIVED(`direction from extraction direction_class: ${direction}`) }
      : { kind: "bias", direction: "both", provenance: COMPILER("no explicit bias — default both (symmetric futures)") },
    eligibility: ctx.gates.filter((g) => g.type === "session" || g.type === "regime"),
    structural_event: ev
      ? { kind: "structural_event", event: ev.kind, provenance: evProv ?? DERIVED(`event '${ev.kind}' from extraction; no verbatim transcript span`) }
      : null,
    execution_context: zoneGate || zoneHit
      ? { kind: "execution_context", zone: (zoneHit?.zone ?? "named_level"), ref: zoneGate?.params.level ?? zoneGate?.name, provenance: zoneProv ?? DERIVED("zone from extraction; no verbatim transcript span") }
      : null,
    wait_state: {
      provenance: until.kind === "now" ? COMPILER("zero-wait: event is the confirmation") : until.provenance,
      active: until.kind !== "now",
      until,
      confirmation: { kind: "confirmation", compound: compoundResult.compound, provenance: confProv },
      ...(invalStep ? { invalidated_by: { kind: "invalidation" as const, condition: stepText(invalStep).trim().slice(0, 80), provenance: invalSpan ?? DERIVED("invalidation from extraction; no verbatim transcript span") } } : {}),
    },
    entry: { kind: "entry", order_type: "market", direction, provenance: COMPILER("entry order-type not stated — default market") },
    meta: { lowered_from: "structured_extraction", quarantine_reason: compoundResult.quarantine_reason },
  };
}
