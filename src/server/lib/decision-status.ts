/**
 * DECISION STATUS — the epistemic/execution type foundation (GPT's "Unknown as a first-class feature" +
 * "execution must be binary"). The state-machine IR already IS the decision graph (S0–S8 nodes, the 3-way
 * Activation/Context/Trigger split, per-node grounding). What was MISSING is two distinctions:
 *
 *  1. EPISTEMIC STATUS (extraction layer — confidence lives HERE): a node was present-or-null, with no way to
 *     say "the educator definitely had a decision here but never verbalized it." UNKNOWN ≠ null.
 *  2. EXECUTION RESOLUTION (execution layer — BINARY, no confidence): the runtime must resolve each condition
 *     to one of four outcomes, never "probably / 0.63". A deterministic backtest cannot resolve uncertainty
 *     without inventing behavior the educator never specified.
 *
 * Pure / deterministic / standalone (zero production wiring).
 */

import type { Origin } from "./state-machine-ir.js";

/** Epistemic status of an extracted decision (extraction-layer). These are DIFFERENT meanings, not one "null". */
export type EpistemicStatus =
  | "KNOWN"        // explicitly taught + grounded to a transcript span
  | "UNKNOWN"      // the educator DEFINITELY had a decision here but never verbalized it (≠ null/no-decision)
  | "VISUAL_ONLY"  // the decision exists but its referent is on the CHART — the transcript can't carry it
  | "FRAMEWORK"    // owned by framework-overlay (stop/tp/risk) — not extraction's job
  | "IMPLIED";     // a default/inference the engine CAN run, but not taught (faithfulness debt)

/** Execution-layer resolution. BINARY-ish — NEVER a confidence float. Confidence belongs to extraction. */
export type ExecutionResolution = "TRUE" | "FALSE" | "UNKNOWN" | "UNOBSERVABLE";
//  TRUE/FALSE   — the engine resolved the condition deterministically on the bar data
//  UNKNOWN      — a required decision was never extracted → the engine cannot resolve it without guessing
//  UNOBSERVABLE — the condition needs data/context the engine doesn't have (e.g. a chart-visual referent)

/** Map IR provenance origin → epistemic status. (origin alone can't yield UNKNOWN — that needs the
 *  "a decision should exist here but didn't compile" judgment, supplied by the caller via `decisionExpected`.) */
export function epistemicFromOrigin(origin: Origin | undefined, opts: { present: boolean; decisionExpected: boolean; frameworkOwned?: boolean } ): EpistemicStatus {
  if (opts.frameworkOwned) return "FRAMEWORK";
  if (opts.present) return origin === "explicit" || origin === "normalized" ? "KNOWN" : "IMPLIED";
  // absent: distinguish "a decision was expected but not extracted" (UNKNOWN) from "no decision" (IMPLIED default)
  return opts.decisionExpected ? "UNKNOWN" : "IMPLIED";
}

/**
 * The NO-GUESS rule (GPT's hardest push): a strategy is faithfully executable ONLY if every REQUIRED condition
 * resolves to TRUE or FALSE. Any required condition that is UNKNOWN or UNOBSERVABLE → the engine would have to
 * invent behavior the educator never specified → refuse to emit an executable strategy (or mark it partial).
 */
export function isFaithfullyExecutable(requiredResolutions: ExecutionResolution[]): boolean {
  return requiredResolutions.length > 0 && requiredResolutions.every((r) => r === "TRUE" || r === "FALSE");
}

/** Why a strategy is not faithfully executable — the required conditions the engine can't resolve. */
export function unresolvableRequired(named: Array<{ name: string; resolution: ExecutionResolution }>): string[] {
  return named.filter((c) => c.resolution === "UNKNOWN" || c.resolution === "UNOBSERVABLE").map((c) => c.name);
}

/**
 * DECISION COVERAGE (GPT) = executable decisions / expected educator decisions. Distinct from field coverage:
 * "20% of decisions extracted" vs "95% extracted, one rule wrong" are vastly different replay diagnoses.
 */
export function decisionCoverage(input: { executable: number; expected: number }): { coverage: number; executable: number; expected: number } {
  const coverage = input.expected > 0 ? input.executable / input.expected : 1;
  return { coverage, executable: input.executable, expected: input.expected };
}
