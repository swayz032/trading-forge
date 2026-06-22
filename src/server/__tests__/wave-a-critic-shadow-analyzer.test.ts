/**
 * wave-a-critic-shadow-analyzer.test.ts
 *
 * Wave A Critic Fix 1 — Shadow Evidence Analyzer availability-key regression suite.
 *
 * Finding #12 (HIGH): The analyzer read `shadow_result.verdict` for availability
 * classification, but composite-shadow-gate.ts writes `verdict: null` for non-available
 * states and stores the classification in `shadow_result.availability`.  Every
 * missing/stale/below_threshold row was silently counted as `evaluated`, inflating
 * the evaluated counter and suppressing the real breakdown counts — potentially
 * triggering premature ACTIVATE_PASS_C verdicts.
 *
 * Fix: read `availability` first; fall back to `verdict` for legacy rows.
 *
 * Test matrix:
 *   4 availability states × 3 conditions = 12 primary fixtures
 *   + 1 malformed-row fixture (availability=available but verdict=null, decision=null)
 *   + backward-compat legacy-row fixture (no availability field)
 *   Total: 14 tests
 */

import { describe, it, expect } from "vitest";
import {
  analyzeShadowEvidence,
  type AuditRow,
  DEFAULT_MIN_SAMPLE,
} from "../lib/shadow-evidence-analyzer.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AS_OF = new Date("2026-06-15T12:00:00.000Z");
const OPTS = { windowDays: 14, minSample: DEFAULT_MIN_SAMPLE, asOf: AS_OF };

/**
 * Build an audit row with the `shadow_result` shape that composite-shadow-gate.ts
 * actually writes.  The key contract:
 *   - `availability` is the primary classification field
 *   - `verdict` is null for missing/stale/below_threshold states
 *   - `verdict` is "HEALTHY"|"MARGINAL"|"UNHEALTHY"|"CRITICAL" when available
 */
function makeAuditRow(
  shadowResultOverride: Record<string, unknown>,
  opts: {
    hardGateOutcome?: "allow" | "block";
    agreement?: boolean | null;
    daysAgo?: number;
  } = {},
): AuditRow {
  const daysAgo = opts.daysAgo ?? 1;
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    action: "composite.shadow_evaluation",
    created_at: new Date(AS_OF.getTime() - daysAgo * 86_400_000),
    result: {
      strategyId: "strat-test",
      hardGateOutcome: opts.hardGateOutcome ?? "allow",
      shadow_result: shadowResultOverride,
      agreement: opts.agreement ?? true,
      weights_version_id: "v1",
      computed_from_n_subsystems: 10,
    },
  };
}

// ─── Fix 1 — availability-key classification ──────────────────────────────────

describe("Fix 1 — shadow_result.availability classification (Finding #12)", () => {
  // ── 4 availability states — basic classification ──────────────────────────

  it("availability=missing → availabilityBreakdown.missing++, isShadowNoOpinion", () => {
    const row = makeAuditRow({
      shadow_decision: "NO_OPINION",
      availability: "missing",
      verdict: null,
    }, { agreement: null });
    const result = analyzeShadowEvidence([row], OPTS);
    expect(result.availabilityBreakdown.missing).toBe(1);
    expect(result.availabilityBreakdown.stale).toBe(0);
    expect(result.availabilityBreakdown.below_threshold).toBe(0);
    expect(result.availabilityBreakdown.evaluated).toBe(0);
    // NO_OPINION rows excluded from denominator
    expect(result.agreements.shadow_no_opinion).toBe(1);
  });

  it("availability=stale → availabilityBreakdown.stale++, isShadowNoOpinion", () => {
    const row = makeAuditRow({
      shadow_decision: "NO_OPINION",
      availability: "stale",
      verdict: null,
    }, { agreement: null });
    const result = analyzeShadowEvidence([row], OPTS);
    expect(result.availabilityBreakdown.stale).toBe(1);
    expect(result.availabilityBreakdown.missing).toBe(0);
    expect(result.availabilityBreakdown.below_threshold).toBe(0);
    expect(result.availabilityBreakdown.evaluated).toBe(0);
    expect(result.agreements.shadow_no_opinion).toBe(1);
  });

  it("availability=below_threshold → availabilityBreakdown.below_threshold++, isShadowNoOpinion", () => {
    const row = makeAuditRow({
      shadow_decision: "NO_OPINION",
      availability: "below_threshold",
      verdict: null,
    }, { agreement: null });
    const result = analyzeShadowEvidence([row], OPTS);
    expect(result.availabilityBreakdown.below_threshold).toBe(1);
    expect(result.availabilityBreakdown.missing).toBe(0);
    expect(result.availabilityBreakdown.stale).toBe(0);
    expect(result.availabilityBreakdown.evaluated).toBe(0);
    expect(result.agreements.shadow_no_opinion).toBe(1);
  });

  it("availability=available + verdict=HEALTHY → availabilityBreakdown.evaluated++", () => {
    const row = makeAuditRow({
      shadow_decision: "WOULD_PROMOTE",
      availability: "available",
      verdict: "HEALTHY",
    }, { hardGateOutcome: "allow", agreement: true });
    const result = analyzeShadowEvidence([row], OPTS);
    expect(result.availabilityBreakdown.evaluated).toBe(1);
    expect(result.availabilityBreakdown.missing).toBe(0);
    expect(result.availabilityBreakdown.stale).toBe(0);
    expect(result.availabilityBreakdown.below_threshold).toBe(0);
  });

  // ── 4 availability states — verdict doesn't match availability (the old bug) ─

  it("OLD BUG: availability=missing but verdict='HEALTHY' — should still classify as missing", () => {
    // Simulate a data anomaly where availability and verdict disagree.
    // availability takes precedence over verdict (Fix 1 contract).
    const row = makeAuditRow({
      shadow_decision: "NO_OPINION",
      availability: "missing",
      verdict: "HEALTHY",  // should be ignored; availability wins
    }, { agreement: null });
    const result = analyzeShadowEvidence([row], OPTS);
    expect(result.availabilityBreakdown.missing).toBe(1);
    expect(result.availabilityBreakdown.evaluated).toBe(0);
  });

  it("OLD BUG: availability=stale but verdict is null — classify as stale (not evaluated)", () => {
    // Pre-fix: verdict=null fell through to the final `else` → evaluated++.
    // Post-fix: availability=stale → stale++.
    const row = makeAuditRow({
      shadow_decision: "NO_OPINION",
      availability: "stale",
      verdict: null,
    }, { agreement: null });
    const result = analyzeShadowEvidence([row], OPTS);
    expect(result.availabilityBreakdown.stale).toBe(1);
    expect(result.availabilityBreakdown.evaluated).toBe(0);
  });

  it("OLD BUG: availability=below_threshold — should NOT count as evaluated", () => {
    // Pre-fix: `shadowVerdict` was never "below_threshold" (it's a ShadowVerdict type),
    // so below_threshold rows always went to `else → evaluated++`.
    // Post-fix: availability=below_threshold → below_threshold++.
    const row = makeAuditRow({
      shadow_decision: "NO_OPINION",
      availability: "below_threshold",
      verdict: null,
    }, { agreement: null });
    const result = analyzeShadowEvidence([row], OPTS);
    expect(result.availabilityBreakdown.below_threshold).toBe(1);
    expect(result.availabilityBreakdown.evaluated).toBe(0);
  });

  // ── 3 verdict states for available rows ──────────────────────────────────

  it("availability=available + verdict=MARGINAL → evaluated, participates in agreement math", () => {
    // NOTE: shadow_decision values are lowercase in the audit row — the analyzer
    // extracts and compares them case-sensitively (would_promote / would_block / allow / block).
    // "would_warn" is not a matrix cell (neither shadowWouldPromote nor shadowWouldBlock).
    const row = makeAuditRow({
      shadow_decision: "would_warn",
      availability: "available",
      verdict: "MARGINAL",
    }, { hardGateOutcome: "allow", agreement: false });  // hard=allow, shadow=warn → disagree
    const result = analyzeShadowEvidence([row], OPTS);
    expect(result.availabilityBreakdown.evaluated).toBe(1);
    expect(result.confusionMatrix.fp).toBe(0);  // no FP; would_warn vs allow is not a matrix cell
  });

  it("availability=available + verdict=UNHEALTHY → evaluated (would_block, hard=allow → FN disagree)", () => {
    // shadow_decision="would_block" (lowercase) — analyzer checks === "would_block"
    const row = makeAuditRow({
      shadow_decision: "would_block",
      availability: "available",
      verdict: "UNHEALTHY",
    }, { hardGateOutcome: "allow", agreement: false });
    const result = analyzeShadowEvidence([row], OPTS);
    expect(result.availabilityBreakdown.evaluated).toBe(1);
    // hard=allow, shadow=would_block → FN (false negative by shadow)
    expect(result.confusionMatrix.fn).toBe(1);
  });

  it("availability=available + verdict=CRITICAL → evaluated (would_block, hard=block → TN agree)", () => {
    // shadow_decision="would_block" (lowercase) — analyzer checks === "would_block"
    const row = makeAuditRow({
      shadow_decision: "would_block",
      availability: "available",
      verdict: "CRITICAL",
    }, { hardGateOutcome: "block", agreement: true });
    const result = analyzeShadowEvidence([row], OPTS);
    expect(result.availabilityBreakdown.evaluated).toBe(1);
    expect(result.confusionMatrix.tn).toBe(1);
  });

  // ── Mixed batch — counts aggregate correctly ──────────────────────────────

  it("mixed batch: 3 missing + 2 stale + 1 below_threshold + 4 available → correct breakdown", () => {
    const rows = [
      ...Array(3).fill(null).map(() => makeAuditRow({ shadow_decision: "NO_OPINION", availability: "missing", verdict: null }, { agreement: null })),
      ...Array(2).fill(null).map(() => makeAuditRow({ shadow_decision: "NO_OPINION", availability: "stale", verdict: null }, { agreement: null })),
      makeAuditRow({ shadow_decision: "NO_OPINION", availability: "below_threshold", verdict: null }, { agreement: null }),
      ...Array(4).fill(null).map(() => makeAuditRow({ shadow_decision: "would_promote", availability: "available", verdict: "HEALTHY" }, { hardGateOutcome: "allow", agreement: true })),
    ];
    const result = analyzeShadowEvidence(rows, OPTS);
    expect(result.availabilityBreakdown.missing).toBe(3);
    expect(result.availabilityBreakdown.stale).toBe(2);
    expect(result.availabilityBreakdown.below_threshold).toBe(1);
    expect(result.availabilityBreakdown.evaluated).toBe(4);
    expect(result.totalAttempts).toBe(10);
    // only 6 NO_OPINION rows excluded from denominator
    expect(result.agreements.shadow_no_opinion).toBe(6);
  });

  // ── Malformed row ─────────────────────────────────────────────────────────

  it("malformed row: availability=available, verdict=null, decision=null → classified as evaluated, excluded from agreement", () => {
    // This is an anomalous row that should NOT blow up or silently misclassify.
    // The analyzer treats it as evaluated (increments evaluated counter) but
    // isShadowNoOpinion=true (because shadowDecision=null) so it doesn't contribute
    // to the agreement/disagreement counts.
    const row = makeAuditRow({
      shadow_decision: null,   // malformed — no decision
      availability: "available",
      verdict: null,           // available but no verdict
    }, { agreement: null });
    const result = analyzeShadowEvidence([row], OPTS);
    // Malformed rows count toward evaluated (not missing/stale/below_threshold)
    expect(result.availabilityBreakdown.evaluated).toBe(1);
    // And they are treated as NO_OPINION (no decision = no opinion)
    expect(result.agreements.shadow_no_opinion).toBe(1);
  });

  // ── Backward-compat: legacy rows with verdict field only (no availability) ─

  it("backward-compat: legacy row with verdict='missing', no availability field → classified as missing", () => {
    // Rows written before composite-shadow-gate.ts Wave 28 Pass B.1 may only have verdict.
    // The backward-compat fallback in the analyzer reads verdict for these rows.
    const row: AuditRow = {
      id: "legacy-bc-1",
      action: "composite.shadow_evaluation",
      created_at: new Date(AS_OF.getTime() - 86_400_000),
      result: {
        strategyId: "strat-legacy",
        hardGateOutcome: "allow",
        shadow_result: {
          shadow_decision: "NO_OPINION",
          // NO `availability` key intentionally — legacy row format
          verdict: "missing",
        },
        agreement: null,
        weights_version_id: "v0",
        computed_from_n_subsystems: 8,
      },
    };
    const result = analyzeShadowEvidence([row], OPTS);
    expect(result.availabilityBreakdown.missing).toBe(1);
    expect(result.availabilityBreakdown.evaluated).toBe(0);
  });

  it("backward-compat: legacy row with verdict='stale', no availability field → classified as stale", () => {
    const row: AuditRow = {
      id: "legacy-bc-2",
      action: "composite.shadow_evaluation",
      created_at: new Date(AS_OF.getTime() - 86_400_000),
      result: {
        strategyId: "strat-legacy",
        hardGateOutcome: "allow",
        shadow_result: {
          shadow_decision: "NO_OPINION",
          verdict: "stale",
        },
        agreement: null,
        weights_version_id: "v0",
        computed_from_n_subsystems: 8,
      },
    };
    const result = analyzeShadowEvidence([row], OPTS);
    expect(result.availabilityBreakdown.stale).toBe(1);
    expect(result.availabilityBreakdown.evaluated).toBe(0);
  });

  // ── Pre-fix regression guard ──────────────────────────────────────────────

  it("PRE-FIX REGRESSION: 50 rows with availability=missing all counted as evaluated (the original bug)", () => {
    // This is what the old code would have produced:
    // availability key ignored, verdict=null fell to `else → evaluated++`.
    // With the fix, all 50 rows should be classified as missing.
    const rows = Array(50).fill(null).map(() =>
      makeAuditRow({
        shadow_decision: "NO_OPINION",
        availability: "missing",
        verdict: null,
      }, { agreement: null }),
    );
    const result = analyzeShadowEvidence(rows, OPTS);
    // Post-fix: all classified as missing
    expect(result.availabilityBreakdown.missing).toBe(50);
    expect(result.availabilityBreakdown.evaluated).toBe(0);
    // All 50 are NO_OPINION → excluded from denominator → sampleSufficient=false
    expect(result.sampleSufficient).toBe(false);
    expect(result.verdict).toBe("PRELIMINARY");
  });

  it("PRE-FIX REGRESSION: 50 stale + 50 available — evaluated count must be 50 not 100", () => {
    // Pre-fix: both groups landed in `evaluated` because stale verdict was never "stale".
    // Post-fix: 50 stale in stale bucket, 50 available in evaluated bucket.
    const staleRows = Array(50).fill(null).map(() =>
      makeAuditRow({
        shadow_decision: "NO_OPINION",
        availability: "stale",
        verdict: null,
      }, { agreement: null }),
    );
    const availableRows = Array(50).fill(null).map(() =>
      makeAuditRow({
        shadow_decision: "would_promote",
        availability: "available",
        verdict: "HEALTHY",
      }, { hardGateOutcome: "allow", agreement: true }),
    );
    const result = analyzeShadowEvidence([...staleRows, ...availableRows], OPTS);
    expect(result.availabilityBreakdown.stale).toBe(50);
    expect(result.availabilityBreakdown.evaluated).toBe(50);
    // Only 50 opinionated rows in denominator (50 stale = NO_OPINION)
    // 50 agree / 50 denominator = 1.0 → ACTIVATE_PASS_C if sampleSufficient
    expect(result.sampleSufficient).toBe(true);
    expect(result.agreementRate).toBeCloseTo(1.0, 2);
  });
});
