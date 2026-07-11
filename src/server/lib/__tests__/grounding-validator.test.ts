/**
 * Grounding validator — the reality-lock. Deterministic transcript↔IR binding; model consensus cannot override.
 * The real invariant: no claimed-explicit node survives unless its quote is provably in the transcript.
 */
import { describe, it, expect } from "vitest";
import { groundQuote, validateGrounding } from "../grounding-validator.js";
import { EXPLICIT, COMPILER, type StrategyIR, type ConfirmationNode } from "../state-machine-ir.js";

const transcript = "first we wait for a break of structure, then price comes back to the order block, and we enter on a bullish engulfing candle.";

const ir = (overrides: Partial<StrategyIR> = {}): StrategyIR => ({
  schema_version: "state_machine_v1", bias: null, eligibility: [],
  structural_event: { kind: "structural_event", event: "bos", provenance: EXPLICIT("break of structure") },
  execution_context: { kind: "execution_context", zone: "order_block", provenance: EXPLICIT("comes back to the order block") },
  wait_state: {
    provenance: EXPLICIT("price comes back"), active: true,
    until: { kind: "price_reenters", provenance: EXPLICIT("price comes back to the order block") },
    confirmation: { kind: "confirmation", compound: null, provenance: EXPLICIT("bullish engulfing candle") } as ConfirmationNode,
  },
  entry: { kind: "entry", order_type: "market", direction: "long", provenance: COMPILER("market default — not stated") },
  ...overrides,
});

describe("groundQuote — deterministic substring binding", () => {
  it("exact substring → grounded(exact)", () => expect(groundQuote("break of structure", transcript)).toMatchObject({ grounded: true, method: "exact" }));
  it("normalized (punctuation/case) substring → grounded(normalized)", () => expect(groundQuote("Break Of Structure!!", transcript).grounded).toBe(true));
  it("not in transcript → not grounded", () => expect(groundQuote("fibonacci golden pocket", transcript).grounded).toBe(false));
  it("empty quote → not grounded", () => expect(groundQuote(undefined, transcript).grounded).toBe(false));
});

describe("validateGrounding — the hard reject gate", () => {
  it("★ all explicit nodes transcript-bound → GROUNDED; market-default entry is honest INFERENCE", () => {
    const r = validateGrounding(ir(), transcript);
    expect(r.status).toBe("GROUNDED");
    expect(r.grounded).toBeGreaterThanOrEqual(4); // event/zone/until/confirmation all bound
    expect(r.inference).toBe(1);                   // entry (market default) — counted, not rejected
    expect(r.grounding_pass_rate).toBe(1);
  });

  it("★ a FABRICATED explicit quote (not in transcript) → REJECTED (UNGROUNDED_VIOLATION)", () => {
    const bad = ir({ structural_event: { kind: "structural_event", event: "sweep", provenance: EXPLICIT("liquidity sweep of the asian high") } });
    const r = validateGrounding(bad, transcript);
    expect(r.status).toBe("REJECTED");
    expect(r.nodes.find((n) => n.node === "structural_event")?.verdict).toBe("UNGROUNDED_VIOLATION");
    expect(r.rejection_reasons.join()).toMatch(/NOT in transcript/);
  });

  it("★ an explicit node with NO evidence → REJECTED (MISSING_EVIDENCE, R1)", () => {
    const bad = ir({ execution_context: { kind: "execution_context", zone: "order_block", provenance: { confidence: "explicit", origin: "explicit", inferred: false } } });
    expect(validateGrounding(bad, transcript).status).toBe("REJECTED");
  });

  it("★ strict mode rejects when a CRITICAL node is merely inferred (never taught)", () => {
    const inferredConfirm = ir({ wait_state: { ...ir().wait_state, confirmation: { kind: "confirmation", compound: null, provenance: COMPILER("assumed a confirmation") } as ConfirmationNode } });
    expect(validateGrounding(inferredConfirm, transcript).status).toBe("GROUNDED");                 // lenient: inference allowed
    expect(validateGrounding(inferredConfirm, transcript, { strictCriticalInference: true }).status).toBe("REJECTED"); // strict: critical inference blocked
  });

  it("metrics: grounding_pass_rate + inference_rate are reported", () => {
    const r = validateGrounding(ir(), transcript);
    expect(r.inference_rate).toBeGreaterThan(0);
    expect(r.inference_rate).toBeLessThan(1);
  });
});
