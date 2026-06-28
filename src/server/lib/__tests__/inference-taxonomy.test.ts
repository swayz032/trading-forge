/**
 * Inference taxonomy — permanent (non-linguistic) vs fixable (extraction gap), data-driven by corpus priors.
 * Confirmation grounds at 13% across 38 videos → non-linguistic by nature (don't chase verbatim);
 * event/zone/until ground at 87-100% → inference there is a real, fixable extraction gap.
 */
import { describe, it, expect } from "vitest";
import { classifyInference, classifyInferenceModality, analyzeInference, CORPUS_GROUNDING_PRIORS } from "../inference-taxonomy.js";
import type { TradeGrounding } from "../uncertainty-propagation.js";

describe("classifyInference — why is a node inferred?", () => {
  it("★ confirmation (13% corpus grounding) → PERMANENT_NON_LINGUISTIC (don't chase verbatim)", () => {
    expect(classifyInference("wait_state.confirmation")).toBe("PERMANENT_NON_LINGUISTIC");
  });
  it("★ event/zone/until (87-100% corpus grounding) → FIXABLE_EXTRACTION_GAP (worth capturing)", () => {
    expect(classifyInference("structural_event")).toBe("FIXABLE_EXTRACTION_GAP");
    expect(classifyInference("execution_context")).toBe("FIXABLE_EXTRACTION_GAP");
    expect(classifyInference("wait_state.until")).toBe("FIXABLE_EXTRACTION_GAP");
  });
  it("priors are overridable as the corpus grows", () => {
    expect(classifyInference("wait_state.confirmation", { "wait_state.confirmation": 0.8 })).toBe("FIXABLE_EXTRACTION_GAP");
  });
});

describe("analyzeInference — direct effort at what can actually be reduced", () => {
  it("★ confirmation-only inference → all PERMANENT; fixable_density 0 (verbatim capture won't help)", () => {
    const g: TradeGrounding = { grounding_class: "INFERENCE_DEPENDENT", trade_confidence: 0.72, span_bound: ["structural_event", "execution_context", "wait_state.until"], inference_dependencies: ["wait_state.confirmation"] };
    const a = analyzeInference(g);
    expect(a.permanent).toEqual(["wait_state.confirmation"]);
    expect(a.fixable).toEqual([]);
    expect(a.fixable_density).toBe(0);                 // nothing here is worth chasing — it's representational
    expect(a.inference_density).toBeCloseTo(0.25, 2);  // 1 of 4 edge nodes inferred
  });

  it("★ until inferred → FIXABLE (a real extraction gap worth closing)", () => {
    const g: TradeGrounding = { grounding_class: "INFERENCE_DEPENDENT", trade_confidence: 0.6, span_bound: ["structural_event", "execution_context"], inference_dependencies: ["wait_state.until", "wait_state.confirmation"] };
    const a = analyzeInference(g);
    expect(a.fixable).toEqual(["wait_state.until"]);          // until usually grounds → fixable
    expect(a.permanent).toEqual(["wait_state.confirmation"]); // confirmation is permanent
    expect(a.fixable_density).toBeCloseTo(0.25, 2);           // 1 of 4 edge nodes is fixable-inferred
  });

  it("fully grounded → no inference, densities 0", () => {
    const g: TradeGrounding = { grounding_class: "FULLY_GROUNDED", trade_confidence: 0.97, span_bound: ["structural_event", "execution_context", "wait_state.until", "wait_state.confirmation"], inference_dependencies: [] };
    const a = analyzeInference(g);
    expect(a.inference_density).toBe(0);
    expect(a.fixable_density).toBe(0);
  });

  it("priors reflect the measured corpus (confirmation under-linguified in THIS corpus — scoped, not universal)", () => {
    expect(CORPUS_GROUNDING_PRIORS["wait_state.confirmation"]).toBeLessThan(0.4);
    expect(CORPUS_GROUNDING_PRIORS.execution_context).toBeGreaterThan(0.8);
  });
});

describe("inference MODALITY — perceptual (judgment) vs structural (imposed rule)", () => {
  it("★ confirmation = PERCEPTUAL operator (visual judgment over price); rest = STRUCTURAL rules", () => {
    expect(classifyInferenceModality("wait_state.confirmation")).toBe("PERCEPTUAL");
    expect(classifyInferenceModality("wait_state.until")).toBe("STRUCTURAL");
    expect(classifyInferenceModality("entry")).toBe("STRUCTURAL");
  });

  it("★ analyzeInference splits perceptual vs structural + sets dominant_modality", () => {
    const perceptualOnly: TradeGrounding = { grounding_class: "INFERENCE_DEPENDENT", trade_confidence: 0.72, span_bound: ["structural_event", "execution_context", "wait_state.until"], inference_dependencies: ["wait_state.confirmation"] };
    const a = analyzeInference(perceptualOnly);
    expect(a.perceptual).toEqual(["wait_state.confirmation"]);
    expect(a.structural).toEqual([]);
    expect(a.dominant_modality).toBe("PERCEPTUAL");

    const structuralToo: TradeGrounding = { grounding_class: "INFERENCE_DEPENDENT", trade_confidence: 0.6, span_bound: ["structural_event", "execution_context"], inference_dependencies: ["wait_state.until", "wait_state.confirmation"] };
    const b = analyzeInference(structuralToo);
    expect(b.structural).toEqual(["wait_state.until"]);
    expect(b.perceptual).toEqual(["wait_state.confirmation"]);
    expect(b.dominant_modality).toBe("STRUCTURAL"); // a missing structural rule is the higher-attribution-risk class
  });
});
