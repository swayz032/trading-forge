/**
 * Replay failure taxonomy — turns "Replay FAIL" into "FAIL because X". Fixed precedence:
 * data → compiler → extraction → visual → framework → source → unknown (deeper cause never mislabeled).
 */
import { describe, it, expect } from "vitest";
import { classifyReplayFailure, dominantFailureClass, type ReplayFailureContext } from "../replay-failure-taxonomy.js";

const ctx = (over: Partial<ReplayFailureContext> = {}): ReplayFailureContext => ({
  demonstrated_bars_available: true, determinism_pass: true, completeness_missed: false,
  evidence_mode: "TRANSCRIPT_ONLY", framework_divergence: false, source_ambiguous: false, ...over,
});

describe("classifyReplayFailure — precedence", () => {
  it("★ no data → DATA_REPLAY_LIMIT (ruled out first, like EXECUTION_DROP)", () =>
    expect(classifyReplayFailure(ctx({ demonstrated_bars_available: false, determinism_pass: false })).failure_class).toBe("DATA_REPLAY_LIMIT"));

  it("★ not executable → COMPILER_DEFECT (Gate 1.5) — even if other flags set", () =>
    expect(classifyReplayFailure(ctx({ determinism_pass: false, completeness_missed: true, evidence_mode: "VISUAL_REQUIRED" })).failure_class).toBe("COMPILER_DEFECT"));

  it("★ executable but a rule was dropped → EXTRACTION_MISS (Gate 1.75)", () =>
    expect(classifyReplayFailure(ctx({ completeness_missed: true, evidence_mode: "VISUAL_REQUIRED" })).failure_class).toBe("EXTRACTION_MISS"));

  it("★ executable + complete + chart-referential → VISUAL_DEPENDENCY", () =>
    expect(classifyReplayFailure(ctx({ evidence_mode: "VISUAL_REQUIRED" })).failure_class).toBe("VISUAL_DEPENDENCY"));

  it("★ entry fine but overlay diverged → FRAMEWORK_MISMATCH", () =>
    expect(classifyReplayFailure(ctx({ framework_divergence: true })).failure_class).toBe("FRAMEWORK_MISMATCH"));

  it("★ faithful extraction of a vague source → EDUCATOR_AMBIGUITY", () =>
    expect(classifyReplayFailure(ctx({ source_ambiguous: true })).failure_class).toBe("EDUCATOR_AMBIGUITY"));

  it("nothing identifiable → UNKNOWN (explicit bucket, never default-blame)", () =>
    expect(classifyReplayFailure(ctx()).failure_class).toBe("UNKNOWN"));

  it("each class carries an engineering direction", () =>
    expect(classifyReplayFailure(ctx({ evidence_mode: "VISUAL_REQUIRED" })).directs).toMatch(/multimodal/i));
});

describe("dominantFailureClass — directs the next investment", () => {
  it("★ corpus dominated by VISUAL_DEPENDENCY → that's the dominant class (→ invest multimodal)", () => {
    const r = dominantFailureClass(["VISUAL_DEPENDENCY", "VISUAL_DEPENDENCY", "COMPILER_DEFECT", "VISUAL_DEPENDENCY"]);
    expect(r.dominant).toBe("VISUAL_DEPENDENCY");
    expect(r.counts.VISUAL_DEPENDENCY).toBe(3);
  });
  it("empty → null", () => expect(dominantFailureClass([]).dominant).toBeNull());
});
