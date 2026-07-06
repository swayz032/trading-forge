/**
 * GATE-STRENGTH ITERATION PASS 2 (2026-07-06) — deterministic-layer regression pins.
 *
 * Design: docs/designs/corpus-v3-classifier-iteration-2026-07-06.md
 * Diagnosis (certified Gate 1' independent blind rater): the classifier OVER-CONTEXTUALIZES genuine entry
 * gates — entry-trigger / "wait-for retest -> signal/enter" conditions were demoted to `context` because no
 * deterministic rule escalated the execution-path atom types, so they fell to the gemma margin (which biases
 * toward contextual). Pass 2 widened rule 5's atom-type set to the execution-path atoms and added rule 5b
 * (TRIGGER_LANG), BOTH derived ONLY from the 143 rules-design conditions.
 *
 * This suite is HERMETIC (no gemma / no network) — it pins ONLY the deterministic rules 1-5b via
 * `classifyGateStrengthDeterministic`. The live-gemma held-out agreement measurement lives in the sibling
 * `gate-strength.test.ts`. Every fixture quote below is one of the 143 design-set motivating conditions
 * (cited in gate-strength.ts) or a precedence/no-regression guard — NONE are the held-out snNkQSyWX4k /
 * jlShztsY3oA pairs (tuning to those is memorization, forbidden by the iteration protocol).
 */
import { describe, it, expect } from "vitest";
import { classifyGateStrengthDeterministic } from "../gate-strength.js";
import type { AtomType } from "../decision-atom.js";

const det = (type: AtomType, evidenceQuote: string, object = "") =>
  classifyGateStrengthDeterministic({ type, object, evidenceQuote });

describe("gate-strength iteration pass 2 — execution-path mandatory escalation (rule 5 widening)", () => {
  // The 6 design gold-JUSTIFIED_MANDATORY WAIT_RETEST conditions the pre-fix rules routed to the margin.
  it.each([
    ["We are waiting for price to break below, come back and retest it as resistance before we can"],
    ["wait for a retrace back to the 5 SMA"],
    ["as soon as the key level is tapped and you notice that 15 minute CRT"],
    ["It must reverse right after breaking a high or a low."],
    ["step number three, we're going to wait for the market to retest that high or low of this initial candle"],
    ["we are going to wait for again wait for that retest into that fair value gap."],
  ])("WAIT_RETEST + MANDATORY_LANG -> mandatory: %s", (quote) => {
    expect(det("WAIT_RETEST", quote)).toBe("mandatory");
  });

  it("the other execution-path atom types also escalate under MANDATORY_LANG", () => {
    expect(det("CONFIRM_DIRECTION", "you need to see the close confirm direction")).toBe("mandatory");
    expect(det("ENABLE_ENTRY", "as soon as that fires the entry is armed")).toBe("mandatory");
    expect(det("ENTER", "wait for the retest then you need to enter")).toBe("mandatory");
  });

  it("execution-path atoms WITHOUT any gate language stay ambiguous (margin) — the fix does not blanket-escalate", () => {
    // gold-CONTEXTUAL design WAIT_RETEST narration with no MANDATORY/TRIGGER language -> still routed to gemma.
    expect(det("WAIT_RETEST", "once the market returns to this level.")).toBeNull();
    expect(det("WAIT_RETEST", "Often, they'll retest again just like they did right here.")).toBeNull();
  });
});

describe("gate-strength iteration pass 2 — TRIGGER_LANG directional entry-trigger discourse (rule 5b)", () => {
  // The 3 design gold-JUSTIFIED_MANDATORY conditions carrying entry-trigger discourse outside MANDATORY_LANG.
  it("'that's when you [act]' escalates (FILTER, design gold-mandatory)", () => {
    expect(det("FILTER", "you want to wait for it to close ... the inside line, that's when you go long")).toBe("mandatory");
  });
  it("'I never take X' negative-gate escalates (FILTER, design gold-mandatory)", () => {
    expect(det("FILTER", "I never take calls under VWAP and I never take puts over VWAP.")).toBe("mandatory");
  });
  it("'take puts/calls/long/short' directional action escalates (WAIT_CONFIRMATION, design gold-mandatory)", () => {
    expect(det("WAIT_CONFIRMATION", "then I'm looking to take puts on a VWOP retest, not a pre-market low retest")).toBe("mandatory");
  });
});

describe("gate-strength iteration pass 2 — precedence + no-regression guards", () => {
  it("rule 1 CONTEXT_LANG still wins over the new escalations (scene-setting retest stays contextual)", () => {
    // 'one of many setups' narration on a WAIT_RETEST — must stay contextual, not become mandatory.
    expect(det("WAIT_RETEST", "this is just one of many setups that we can keep our eye on")).toBe("contextual");
  });
  it("rule 4 OPTIONAL_LANG still wins over the new escalations (design gold-OPTIONAL WAIT_RETEST)", () => {
    expect(det("WAIT_RETEST", "You also trade EMA retest sometimes.")).toBe("optional");
  });
  it("rule 3 ALT_LANG still wins over TRIGGER_LANG (interchangeable framing precedence)", () => {
    // 'you can also take puts' — ALT framing must resolve alternative, not mandatory.
    expect(det("WAIT_CONFIRMATION", "you can also take puts here if you prefer")).toBe("alternative");
  });
  it("unchanged rule 5 anchors (WAIT_STRUCTURE / WAIT_BIAS) still escalate", () => {
    expect(det("WAIT_STRUCTURE", "step number one, we are going to wait for a breakout on the fiveminut chart")).toBe("mandatory");
  });
  it("plain non-gate WAIT_STRUCTURE narration remains ambiguous (margin) — no over-escalation", () => {
    expect(det("WAIT_STRUCTURE", "the fair value gap is right there on the chart")).toBeNull();
  });
});
