/**
 * evidence-completeness.test.ts — deep-scan #15 FIX M1
 *
 * Unit coverage for the shared PAPER → DEPLOY_READY evidence-completeness roll-up
 * accounting. Proves a "malformed" (broken-producer) gate status counts as
 * INCOMPLETE — the core M1 fix — while genuine passes stay "complete".
 */

import { describe, it, expect } from "vitest";
import {
  isIncompleteEvidenceStatus,
  slippageEvidenceBucket,
  bifEvidenceBucket,
} from "../evidence-completeness.js";

describe("isIncompleteEvidenceStatus — INCOMPLETE predicate (FIX M1)", () => {
  it("counts malformed as INCOMPLETE (the M1 fix)", () => {
    expect(isIncompleteEvidenceStatus("malformed")).toBe(true);
  });

  it("counts every legacy* variant as INCOMPLETE", () => {
    for (const s of ["legacy_null", "legacy_proceed", "legacy_unavailable"]) {
      expect(isIncompleteEvidenceStatus(s)).toBe(true);
    }
  });

  it("counts data_unavailable (infra read failure) as INCOMPLETE", () => {
    expect(isIncompleteEvidenceStatus("data_unavailable")).toBe(true);
  });

  it("does NOT count genuine-pass buckets as INCOMPLETE", () => {
    for (const s of ["complete", "clean", "disabled", "insufficient_sample"]) {
      expect(isIncompleteEvidenceStatus(s)).toBe(false);
    }
  });
});

describe("slippageEvidenceBucket — status → bucket (FIX M1)", () => {
  it("malformed → INCOMPLETE 'malformed' bucket (was silently 'complete')", () => {
    const bucket = slippageEvidenceBucket("malformed");
    expect(bucket).toBe("malformed");
    expect(isIncompleteEvidenceStatus(bucket)).toBe(true);
  });

  it("legacy_null → its existing incomplete bucket", () => {
    const bucket = slippageEvidenceBucket("legacy_null");
    expect(bucket).toBe("legacy_null");
    expect(isIncompleteEvidenceStatus(bucket)).toBe(true);
  });

  it("genuine passes → 'complete' (does not change per-gate decision)", () => {
    for (const s of ["clean", "disabled", "insufficient_sample", "warn_breaks_at_above_block"]) {
      const bucket = slippageEvidenceBucket(s);
      expect(bucket).toBe("complete");
      expect(isIncompleteEvidenceStatus(bucket)).toBe(false);
    }
  });

  it("a malformed slippage row pushes a 2-legacy stack to the >=3-incomplete threshold", () => {
    // Two prior legacy gates + one malformed slippage = 3 incomplete → block.
    const statuses = ["legacy_null", "legacy_proceed", slippageEvidenceBucket("malformed")];
    const incompleteCount = statuses.filter(isIncompleteEvidenceStatus).length;
    expect(incompleteCount).toBe(3);
    expect(incompleteCount >= 3).toBe(true);

    // Contrast: the OLD (buggy) accounting booked malformed as "complete" → only 2.
    const buggy = ["legacy_null", "legacy_proceed", "complete"];
    expect(buggy.filter(isIncompleteEvidenceStatus).length).toBe(2);
  });
});

describe("bifEvidenceBucket — status → bucket (FIX M1 identical-pattern hardening)", () => {
  it("legacyNull → 'legacy_null' (incomplete)", () => {
    const bucket = bifEvidenceBucket(true, "bif.legacy_null_pre_wave3");
    expect(bucket).toBe("legacy_null");
    expect(isIncompleteEvidenceStatus(bucket)).toBe(true);
  });

  it("genuine pass reasons → 'complete'", () => {
    for (const r of ["bif.clean", "bif.warn_above_warn_threshold", "bif.cpcv_unmeasured"]) {
      const bucket = bifEvidenceBucket(false, r);
      expect(bucket).toBe("complete");
      expect(isIncompleteEvidenceStatus(bucket)).toBe(false);
    }
  });

  it("forward-safe: an explicit malformed/producer-error reason → INCOMPLETE 'malformed'", () => {
    expect(bifEvidenceBucket(false, "bif.malformed_wrong_key")).toBe("malformed");
    expect(bifEvidenceBucket(false, "bif.producer_error")).toBe("malformed");
    expect(isIncompleteEvidenceStatus(bifEvidenceBucket(false, "bif.shape_drift"))).toBe(true);
  });
});
