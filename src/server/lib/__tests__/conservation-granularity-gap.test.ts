/**
 * BREAKTHROUGH DIAGNOSIS (2026-06-29): proves WHY ~90% name-conservation != faithful extraction.
 *
 * Operator/GPT mission: extract 100% of the strategy + STEPS the speaker taught, executably, for backtest.
 * `semantic-conservation.ts` already enforces a real conservation law — but on the WRONG UNIT: it conserves
 * `SpeakerItem` (NAMED TOOLS: "liquidity sweep", "order block"), not DECISION ATOMS (executable rules with
 * order + condition + dependency). This test demonstrates the gap structurally: a strategy can be 100%
 * name-conserved (zero silent loss) while its executable DECISIONS — step order, session condition, the
 * wait-then-confirm dependency — are entirely absent. Names are not decisions; conserving names is not
 * conserving the strategy. => the conserved unit must move DOWN from speaker_item to decision-atom, grounded
 * on transcript clause-spans, with decomposition (not summarization) extraction.
 */
import { describe, it, expect } from "vitest";
import { checkSemanticConservation, conserveOrThrow, type SpeakerItem } from "../semantic-conservation.js";

// The speaker NAMED four tools. This is what the enumerator surfaces + what conservation conserves.
const NAMED_TOOLS: SpeakerItem[] = [
  { name: "london session", verbatim_quote: "we only trade the london session", emphasis_level: "primary" },
  { name: "liquidity sweep", verbatim_quote: "wait for a liquidity sweep of the asian high", emphasis_level: "primary" },
  { name: "order block", verbatim_quote: "mark the order block that caused the sweep", emphasis_level: "primary" },
  { name: "engulfing", verbatim_quote: "only enter after a bullish engulfing on the retest", emphasis_level: "primary" },
];
const COVERED_ALL = NAMED_TOOLS.map((t) => t.name); // the comparator matched every named tool -> all EXECUTED

describe("name-conservation is structurally blind to the executable DECISIONS (the breakthrough gap)", () => {
  it("reports 100% accounted / zero silent loss on the NAMED tools", () => {
    const c = conserveOrThrow(checkSemanticConservation(NAMED_TOOLS, COVERED_ALL));
    expect(c.coverage_pct).toBe(1);        // 100% ACCOUNTED FOR
    expect(c.silent_loss).toHaveLength(0); // nothing vanished
    expect(c.executed).toBe(4);
  });

  it("...yet that 100% carries NO step-order, NO session-condition, NO dependency — the SpeakerItem type cannot hold a decision", () => {
    // The conserved unit's entire surface is {name, verbatim_quote, emphasis_level}. By TYPE it cannot encode:
    const item = NAMED_TOOLS[3] as SpeakerItem & Record<string, unknown>;
    expect(item.sequence_index).toBeUndefined();   // no ORDER (sweep BEFORE retest BEFORE entry)
    expect(item.depends_on).toBeUndefined();        // no DEPENDENCY (engulfing requires the sweep + retest)
    expect(item.condition).toBeUndefined();         // no CONDITION (entry ONLY during london)
    expect(item.atom_type).toBeUndefined();         // no executable TYPE (WAIT vs ENTER vs INVALIDATE)
    // => a strategy that dropped the retest step, or reordered confirmation before the sweep, or lost the
    //    session filter, would STILL score 100% name-conservation. Faithful != name-accounted.
  });

  it("the SAME 100% name-conservation cannot distinguish a COMPLETE strategy from a STEP-INCOMPLETE one", () => {
    // Two different executable strategies that name the identical tool set:
    //   A: london -> wait sweep -> wait retest -> wait engulfing -> ENTER   (complete, 5 ordered decisions)
    //   B: (session dropped) sweep -> ENTER on engulfing                    (retest + session lost, 3 decisions)
    // Both present the same 4 NAMES, so name-conservation is byte-identical and 100% for both.
    const a = checkSemanticConservation(NAMED_TOOLS, COVERED_ALL);
    const b = checkSemanticConservation(NAMED_TOOLS, COVERED_ALL);
    expect(a).toEqual(b);              // identical verdict...
    expect(a.coverage_pct).toBe(1);    // ...both 100% "faithful" by this metric
    // The metric is provably incapable of seeing that B lost two executable decisions. That blindness IS the
    // residual gap between ~90% name-coverage and 100% strategy-faithful extraction.
  });
});
