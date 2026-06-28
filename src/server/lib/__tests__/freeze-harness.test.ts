/**
 * Hard-freeze harness — turns a confounded comparison into a controlled one.
 * The core property: a SEMANTIC verdict (span failure / inference disagreement) is UNREACHABLE until
 * version-drift and execution-drop are ruled out — exactly the de-confounding the operator demanded.
 */
import { describe, it, expect } from "vitest";
import { captureManifest, verifyNoDrift, classifyDisagreement, sha256, type NodeObservation } from "../freeze-harness.js";

const m = (over: Partial<Parameters<typeof captureManifest>[0]> = {}) => captureManifest({
  backend_commit: "abc123", backend_dirty: false, backend_uptime: 100, model_digest: "gemma4:e2b:5.1B:Q4",
  transcripts: { v1: "first we wait for the retest" }, ...over,
});

describe("manifest + drift", () => {
  it("captureManifest hashes each transcript", () => {
    const man = m();
    expect(man.transcript_hashes.v1).toBe(sha256("first we wait for the retest"));
  });
  it("no change → no drift (frozen)", () => expect(verifyNoDrift(m(), m()).ok).toBe(true));
  it("★ commit change → drift", () => expect(verifyNoDrift(m(), m({ backend_commit: "def456" })).drift.join()).toMatch(/backend_commit/));
  it("★ backend RESTARTED mid-run (uptime decreased) → drift", () => expect(verifyNoDrift(m({ backend_uptime: 500 }), m({ backend_uptime: 12 })).drift.join()).toMatch(/RESTARTED/));
  it("★ dirty code → drift (uncommitted = freeze-invalid)", () => expect(verifyNoDrift(m({ backend_dirty: true }), m({ backend_dirty: true })).ok).toBe(false));
  it("unknown commit → drift (not freeze-observable — the old version:'dev' state)", () => expect(verifyNoDrift(m({ backend_commit: "unknown" }), m({ backend_commit: "unknown" })).ok).toBe(false));
  it("transcript change → drift", () => expect(verifyNoDrift(m(), m({ transcripts: { v1: "different" } })).drift.join()).toMatch(/transcript v1/));
});

describe("classifyDisagreement — ATTRIBUTION ORDER (the de-confounder)", () => {
  const base: NodeObservation = { node: "confirmation", manual_present: true, manual_quote_in_transcript: true, pipeline_present: false, pipeline_span_bound: false, pipeline_execution_ok: true };

  it("★ version drift OVERRIDES everything → VERSION_INCONSISTENCY (no semantic claim allowed)", () => {
    expect(classifyDisagreement(base, /*versionDrift*/ true)).toBe("VERSION_INCONSISTENCY");
  });

  it("★ execution drop (coverage_failed) → EXECUTION_DROP, NOT span failure — even with a verbatim quote", () => {
    // THIS is the psH/l-2 case: I found the confirmation verbatim, but the run was coverage_failed.
    expect(classifyDisagreement({ ...base, pipeline_execution_ok: false }, false)).toBe("EXECUTION_DROP");
  });

  it("★ SPAN_FAILURE only when clean+frozen: verbatim phrase present, pipeline produced NOTHING", () => {
    expect(classifyDisagreement({ ...base, pipeline_execution_ok: true, pipeline_present: false }, false)).toBe("SPAN_FAILURE");
  });

  it("★ INFERENCE_DISAGREEMENT: clean+frozen, pipeline HAS the node but didn't bind it (paraphrased)", () => {
    expect(classifyDisagreement({ ...base, pipeline_present: true, pipeline_span_bound: false }, false)).toBe("INFERENCE_DISAGREEMENT");
  });

  it("both bound → AGREE", () => {
    expect(classifyDisagreement({ ...base, pipeline_present: true, pipeline_span_bound: true }, false)).toBe("AGREE");
  });

  it("annotator didn't extract it either → AGREE (nothing to compare)", () => {
    expect(classifyDisagreement({ ...base, manual_present: false }, false)).toBe("AGREE");
  });

  it("★ the psH/l-2 confirmation mismatch is correctly NON-attributable as a span failure (it was execution_drop)", () => {
    // Demonstrates: my earlier 'pipeline missed linguistic confirmation' claim is REFUTED by the classifier —
    // those runs were coverage_failed → EXECUTION_DROP, so no span-failure conclusion is permitted.
    const psH: NodeObservation = { node: "confirmation", manual_present: true, manual_quote_in_transcript: true, pipeline_present: true, pipeline_span_bound: false, pipeline_execution_ok: false };
    expect(classifyDisagreement(psH, false)).toBe("EXECUTION_DROP");
    expect(classifyDisagreement(psH, false)).not.toBe("SPAN_FAILURE");
  });
});
