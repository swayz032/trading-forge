/**
 * Wave 28 Pass B.3 — Shadow Evidence Analyzer tests
 *
 * Tests the pure-functional analyzeShadowEvidence() core.
 * No DB, no I/O, no Date.now() — fully deterministic.
 */

import { describe, it, expect } from "vitest";
import {
  analyzeShadowEvidence,
  buildMarkdownReport,
  AGREEMENT_ACTIVATE_THRESHOLD,
  AGREEMENT_INCONCLUSIVE_THRESHOLD,
  DEFAULT_MIN_SAMPLE,
  type AuditRow,
} from "../lib/shadow-evidence-analyzer.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_DATE = new Date("2026-06-10T12:00:00.000Z");
const WINDOW_DAYS = 14;

function makeRow(
  overrides: Partial<{
    strategyId: string;
    hardGateOutcome: "allow" | "block";
    shadowDecision: "would_promote" | "would_block" | "NO_OPINION";
    agreement: boolean | null;
    weightsVersionId: string;
    shadowVerdict: string;
    daysAgo: number;
  }> = {},
): AuditRow {
  const daysAgo = overrides.daysAgo ?? 1;
  const created_at = new Date(BASE_DATE.getTime() - daysAgo * 24 * 60 * 60 * 1000);

  const shadowDecision = overrides.shadowDecision ?? "would_promote";
  const isNoOpinion = shadowDecision === "NO_OPINION";

  return {
    id: crypto.randomUUID(),
    action: "composite.shadow_evaluation",
    created_at,
    result: {
      strategyId: overrides.strategyId ?? "strat-1",
      hardGateOutcome: overrides.hardGateOutcome ?? "allow",
      shadow_result: {
        shadow_decision: isNoOpinion ? "NO_OPINION" : shadowDecision,
        verdict: overrides.shadowVerdict ?? "evaluated",
      },
      agreement: overrides.agreement ?? (!isNoOpinion),
      weights_version_id: overrides.weightsVersionId ?? "v1",
      computed_from_n_subsystems: 10,
    },
  };
}

function makeRows(
  n: number,
  overrides: Parameters<typeof makeRow>[0] = {},
): AuditRow[] {
  return Array.from({ length: n }, () => makeRow(overrides));
}

const DEFAULT_OPTS = {
  windowDays: WINDOW_DAYS,
  minSample: DEFAULT_MIN_SAMPLE,
  asOf: BASE_DATE,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("analyzeShadowEvidence — core verdict logic", () => {
  it("empty rows → PRELIMINARY", () => {
    const result = analyzeShadowEvidence([], DEFAULT_OPTS);

    expect(result.verdict).toBe("PRELIMINARY");
    expect(result.totalAttempts).toBe(0);
    expect(result.sampleSufficient).toBe(false);
    expect(result.agreementRate).toBe(0);
  });

  it("below min-sample (49 rows, all agreeing) → PRELIMINARY", () => {
    const rows = makeRows(49, { hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true });
    const result = analyzeShadowEvidence(rows, DEFAULT_OPTS);

    expect(result.verdict).toBe("PRELIMINARY");
    expect(result.totalAttempts).toBe(49);
    expect(result.sampleSufficient).toBe(false);
    // agreement rate is high but irrelevant — PRELIMINARY dominates
    expect(result.agreementRate).toBeCloseTo(1.0, 2);
  });

  it("50 rows, 45 agree → agreement_rate = 0.90 → ACTIVATE_PASS_C", () => {
    const agreeRows = makeRows(45, { hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true });
    const disagreeRows = makeRows(5, {
      hardGateOutcome: "allow",
      shadowDecision: "would_block",
      agreement: false,
    });
    const rows = [...agreeRows, ...disagreeRows];

    const result = analyzeShadowEvidence(rows, DEFAULT_OPTS);

    expect(result.verdict).toBe("ACTIVATE_PASS_C");
    expect(result.totalAttempts).toBe(50);
    expect(result.sampleSufficient).toBe(true);
    expect(result.agreementRate).toBeCloseTo(0.9, 3);
  });

  it("50 rows, 40 agree → agreement_rate = 0.80 → INCONCLUSIVE", () => {
    const agreeRows = makeRows(40, { hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true });
    const disagreeRows = makeRows(10, {
      hardGateOutcome: "block",
      shadowDecision: "would_promote",
      agreement: false,
    });
    const rows = [...agreeRows, ...disagreeRows];

    const result = analyzeShadowEvidence(rows, DEFAULT_OPTS);

    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.agreementRate).toBeCloseTo(0.8, 3);
    expect(result.sampleSufficient).toBe(true);
  });

  it("50 rows, 30 agree → agreement_rate = 0.60 → REVISE_COMPOSITE", () => {
    const agreeRows = makeRows(30, { hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true });
    const disagreeRows = makeRows(20, {
      hardGateOutcome: "allow",
      shadowDecision: "would_block",
      agreement: false,
    });
    const rows = [...agreeRows, ...disagreeRows];

    const result = analyzeShadowEvidence(rows, DEFAULT_OPTS);

    expect(result.verdict).toBe("REVISE_COMPOSITE");
    expect(result.agreementRate).toBeCloseTo(0.6, 3);
    expect(result.sampleSufficient).toBe(true);
  });
});

describe("analyzeShadowEvidence — shadow_no_opinion excluded from denominator", () => {
  it("50 total, 10 no_opinion, 35 agree out of 40 opinionated → 0.875 → ACTIVATE_PASS_C", () => {
    // 40 opinionated rows: 35 agree, 5 disagree
    const agreeRows = makeRows(35, { hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true });
    const disagreeRows = makeRows(5, {
      hardGateOutcome: "allow",
      shadowDecision: "would_block",
      agreement: false,
    });
    const noOpinionRows = makeRows(10, {
      hardGateOutcome: "allow",
      shadowDecision: "NO_OPINION",
      agreement: null,
    });

    const rows = [...agreeRows, ...disagreeRows, ...noOpinionRows];

    const result = analyzeShadowEvidence(rows, DEFAULT_OPTS);

    expect(result.totalAttempts).toBe(50);
    expect(result.agreements.shadow_no_opinion).toBe(10);
    // denominator = 50 - 10 = 40
    // agreement_rate = 35 / 40 = 0.875
    expect(result.agreementRate).toBeCloseTo(0.875, 3);
    // denominator = 40 < min_sample 50 → PRELIMINARY (not sufficient sample)
    expect(result.sampleSufficient).toBe(false);
    expect(result.verdict).toBe("PRELIMINARY");
  });

  it("no_opinion excluded: 60 total, 10 no_opinion, 45 agree out of 50 opinionated → 0.90 → ACTIVATE", () => {
    const agreeRows = makeRows(45, { hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true });
    const disagreeRows = makeRows(5, {
      hardGateOutcome: "allow",
      shadowDecision: "would_block",
      agreement: false,
    });
    const noOpinionRows = makeRows(10, {
      hardGateOutcome: "allow",
      shadowDecision: "NO_OPINION",
      agreement: null,
    });

    const rows = [...agreeRows, ...disagreeRows, ...noOpinionRows];
    const result = analyzeShadowEvidence(rows, DEFAULT_OPTS);

    expect(result.totalAttempts).toBe(60);
    expect(result.agreements.shadow_no_opinion).toBe(10);
    // denominator = 60 - 10 = 50 (exactly meets min_sample)
    expect(result.agreementRate).toBeCloseTo(0.9, 3);
    expect(result.sampleSufficient).toBe(true);
    expect(result.verdict).toBe("ACTIVATE_PASS_C");
  });
});

describe("analyzeShadowEvidence — weights version drift", () => {
  it("2 distinct weights_version_ids → WEIGHTS_DRIFT_DETECTED flag", () => {
    const v1Rows = makeRows(30, {
      hardGateOutcome: "allow",
      shadowDecision: "would_promote",
      agreement: true,
      weightsVersionId: "v1",
    });
    const v2Rows = makeRows(20, {
      hardGateOutcome: "allow",
      shadowDecision: "would_promote",
      agreement: true,
      weightsVersionId: "v2",
    });

    const rows = [...v1Rows, ...v2Rows];
    const result = analyzeShadowEvidence(rows, DEFAULT_OPTS);

    expect(result.weightsVersionDrift).toBe(true);
    expect(result.weightsVersionIds).toHaveLength(2);
    expect(result.weightsVersionIds).toContain("v1");
    expect(result.weightsVersionIds).toContain("v2");
    expect(result.verdictFlags).toContain("WEIGHTS_DRIFT_DETECTED");
  });

  it("single weights_version_id → no drift", () => {
    const rows = makeRows(50, {
      hardGateOutcome: "allow",
      shadowDecision: "would_promote",
      agreement: true,
      weightsVersionId: "v1",
    });

    const result = analyzeShadowEvidence(rows, DEFAULT_OPTS);

    expect(result.weightsVersionDrift).toBe(false);
    expect(result.weightsVersionIds).toHaveLength(1);
    expect(result.verdictFlags).not.toContain("WEIGHTS_DRIFT_DETECTED");
  });
});

describe("analyzeShadowEvidence — confusion matrix", () => {
  it("correctly builds 2x2 confusion matrix from fixture set", () => {
    // TP: hard=allow, shadow=would_promote (10 rows)
    const tpRows = makeRows(10, { hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true });
    // TN: hard=block, shadow=would_block (8 rows)
    const tnRows = makeRows(8, { hardGateOutcome: "block", shadowDecision: "would_block", agreement: true });
    // FP: hard=block, shadow=would_promote (4 rows)
    const fpRows = makeRows(4, { hardGateOutcome: "block", shadowDecision: "would_promote", agreement: false });
    // FN: hard=allow, shadow=would_block (3 rows)
    const fnRows = makeRows(3, { hardGateOutcome: "allow", shadowDecision: "would_block", agreement: false });
    // NO_OPINION: excluded from matrix (5 rows)
    const noOpRows = makeRows(5, { hardGateOutcome: "allow", shadowDecision: "NO_OPINION", agreement: null });

    const rows = [...tpRows, ...tnRows, ...fpRows, ...fnRows, ...noOpRows];
    const result = analyzeShadowEvidence(rows, DEFAULT_OPTS);

    expect(result.confusionMatrix.tp).toBe(10);
    expect(result.confusionMatrix.tn).toBe(8);
    expect(result.confusionMatrix.fp).toBe(4);
    expect(result.confusionMatrix.fn).toBe(3);
    expect(result.agreements.shadow_no_opinion).toBe(5);
    expect(result.totalAttempts).toBe(30);
  });
});

describe("analyzeShadowEvidence — window filtering", () => {
  it("rows outside the window are excluded", () => {
    // 14 rows strictly within the 14-day window (daysAgo 1..14 inclusive → created_at >= windowStart)
    const inWindowRows = Array.from({ length: 14 }, (_, i) =>
      makeRow({ daysAgo: i + 1, hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true })
    );
    // 10 rows outside window (daysAgo 15..24, all > windowDays=14)
    const outOfWindowRows = Array.from({ length: 10 }, (_, i) =>
      makeRow({ daysAgo: 15 + i, hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true })
    );

    const rows = [...inWindowRows, ...outOfWindowRows];
    const result = analyzeShadowEvidence(rows, DEFAULT_OPTS);

    expect(result.totalAttempts).toBe(14);
  });
});

describe("buildMarkdownReport", () => {
  it("produces a machine-readable JSON block and verdict pill", () => {
    const rows = makeRows(50, { hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true });
    const result = analyzeShadowEvidence(rows, DEFAULT_OPTS);
    const report = buildMarkdownReport(result, "2026-06-10");

    expect(report).toContain("```json");
    expect(report).toContain("ACTIVATE_PASS_C");
    expect(report).toContain("agreement_rate");
    expect(report).toContain("# Shadow Evidence Analysis — 2026-06-10");
  });

  it("PRELIMINARY report contains waiting recommendation", () => {
    const rows = makeRows(10, { hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true });
    const result = analyzeShadowEvidence(rows, DEFAULT_OPTS);
    const report = buildMarkdownReport(result, "2026-06-10");

    expect(report).toContain("PRELIMINARY");
    expect(report).toContain("Accumulate more data");
  });

  it("WEIGHTS_DRIFT_DETECTED appears in report when drift detected", () => {
    const v1 = makeRows(25, { hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true, weightsVersionId: "abc" });
    const v2 = makeRows(25, { hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true, weightsVersionId: "xyz" });
    const result = analyzeShadowEvidence([...v1, ...v2], DEFAULT_OPTS);
    const report = buildMarkdownReport(result, "2026-06-10");

    expect(report).toContain("WEIGHTS_DRIFT_DETECTED");
    expect(report).toContain("Mixed epoch");
  });
});

describe("threshold boundary conditions", () => {
  it("exactly at ACTIVATE threshold (85%) → ACTIVATE_PASS_C", () => {
    // 50 rows: 42.5 is not integer — use 43/50 = 0.86 ≥ 0.85
    const agreeRows = makeRows(43, { hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true });
    const disagreeRows = makeRows(7, { hardGateOutcome: "allow", shadowDecision: "would_block", agreement: false });
    const result = analyzeShadowEvidence([...agreeRows, ...disagreeRows], DEFAULT_OPTS);

    expect(result.verdict).toBe("ACTIVATE_PASS_C");
    expect(result.agreementRate).toBeGreaterThanOrEqual(AGREEMENT_ACTIVATE_THRESHOLD);
  });

  it("just below ACTIVATE threshold (84%) → INCONCLUSIVE", () => {
    // 50 rows: 42/50 = 0.84
    const agreeRows = makeRows(42, { hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true });
    const disagreeRows = makeRows(8, { hardGateOutcome: "allow", shadowDecision: "would_block", agreement: false });
    const result = analyzeShadowEvidence([...agreeRows, ...disagreeRows], DEFAULT_OPTS);

    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.agreementRate).toBeLessThan(AGREEMENT_ACTIVATE_THRESHOLD);
    expect(result.agreementRate).toBeGreaterThanOrEqual(AGREEMENT_INCONCLUSIVE_THRESHOLD);
  });

  it("exactly at INCONCLUSIVE threshold (70%) → INCONCLUSIVE", () => {
    // 50 rows: 35/50 = 0.70
    const agreeRows = makeRows(35, { hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true });
    const disagreeRows = makeRows(15, { hardGateOutcome: "allow", shadowDecision: "would_block", agreement: false });
    const result = analyzeShadowEvidence([...agreeRows, ...disagreeRows], DEFAULT_OPTS);

    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.agreementRate).toBeCloseTo(0.7, 3);
  });

  it("just below INCONCLUSIVE threshold (69%) → REVISE_COMPOSITE", () => {
    // 100 rows: 69/100 = 0.69
    const agreeRows = makeRows(69, { hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true });
    const disagreeRows = makeRows(31, { hardGateOutcome: "allow", shadowDecision: "would_block", agreement: false });
    const result = analyzeShadowEvidence([...agreeRows, ...disagreeRows], DEFAULT_OPTS);

    expect(result.verdict).toBe("REVISE_COMPOSITE");
    expect(result.agreementRate).toBeCloseTo(0.69, 2);
    expect(result.agreementRate).toBeLessThan(AGREEMENT_INCONCLUSIVE_THRESHOLD);
  });
});

describe("analyzeShadowEvidence — per-strategy breakdown", () => {
  it("tracks per-strategy agreement counts", () => {
    const s1Agree = makeRows(10, { strategyId: "strat-A", hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true });
    const s1Disagree = makeRows(2, { strategyId: "strat-A", hardGateOutcome: "allow", shadowDecision: "would_block", agreement: false });
    const s2Agree = makeRows(8, { strategyId: "strat-B", hardGateOutcome: "allow", shadowDecision: "would_promote", agreement: true });

    const rows = [...s1Agree, ...s1Disagree, ...s2Agree];
    const result = analyzeShadowEvidence(rows, DEFAULT_OPTS);

    const stratA = result.perStrategy.find(s => s.strategyId === "strat-A");
    const stratB = result.perStrategy.find(s => s.strategyId === "strat-B");

    expect(stratA).toBeDefined();
    expect(stratA!.total).toBe(12);
    expect(stratA!.agreements).toBe(10);
    expect(stratA!.agreementRate).toBeCloseTo(10 / 12, 3);

    expect(stratB).toBeDefined();
    expect(stratB!.total).toBe(8);
    expect(stratB!.agreements).toBe(8);
    expect(stratB!.agreementRate).toBeCloseTo(1.0, 3);
  });
});

describe("analyzeShadowEvidence — availability breakdown", () => {
  it("classifies missing/stale/below_threshold/evaluated correctly", () => {
    const missingRows = makeRows(3, { shadowDecision: "would_promote", shadowVerdict: "missing" } as Parameters<typeof makeRow>[0]);
    const staleRows = makeRows(2, { shadowDecision: "would_promote", shadowVerdict: "stale" } as Parameters<typeof makeRow>[0]);
    const belowRows = makeRows(4, { shadowDecision: "would_promote", shadowVerdict: "below_threshold" } as Parameters<typeof makeRow>[0]);
    const evalRows = makeRows(5, {
      hardGateOutcome: "allow",
      shadowDecision: "would_promote",
      agreement: true,
    });

    // The missing/stale/below_threshold rows will set shadow_no_opinion because verdict is non-evaluated
    const rows = [...missingRows, ...staleRows, ...belowRows, ...evalRows];
    const result = analyzeShadowEvidence(rows, DEFAULT_OPTS);

    expect(result.availabilityBreakdown.missing).toBe(3);
    expect(result.availabilityBreakdown.stale).toBe(2);
    expect(result.availabilityBreakdown.below_threshold).toBe(4);
    expect(result.availabilityBreakdown.evaluated).toBe(5);
  });
});
