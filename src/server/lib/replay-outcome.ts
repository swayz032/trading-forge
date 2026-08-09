/**
 * The ONE shared critic replay-outcome handler — D-10 `N-1` (R-757 §4).
 *
 * Both critic replay paths (`replayCandidatesAsync`, the automatic one, and
 * `manualReplayCandidates`, the manual one) previously carried near-identical
 * transcriptions of the same decision, and `R-755`/`R-756`/`R-757` each found a
 * defect that had been copied into both. R-757 §4 collapses the decision to one
 * place and requires a per-caller delegation spy proving both reach it.
 *
 * ─── WHY THIS IS PURE ────────────────────────────────────────────────────────
 *
 * It decides; it does not act. No db, no SSE, no logging, no throwing. It returns
 * the exact column patch its caller should persist, so the DECISION is unit-testable
 * without a database and the caller keeps ownership of its own effects. This mirrors
 * `backtest-refusal.ts`'s deliberate stance: classification and action are different
 * jobs, and one central actor cannot know what each consumer must do next.
 *
 * ─── THE THREE OUTCOMES, AND WHY "INVALID" IS NOT "COMPLETED" ────────────────
 *
 *   refused    the engine declined to execute. No metrics exist, by construction.
 *   invalid    the engine COMPLETED but returned no usable score. This is NOT a
 *              measured zero and must never be ranked.
 *   completed  a real, finite score. It is persisted EXACTLY as measured — including
 *              a genuine 0, which is a measurement like any other.
 *
 * The distinction between `invalid` and a measured `0` is the entire content of
 * R-757 §3 defect 2:
 *
 *   `FIXING THE KEY WHILE KEEPING THE COERCION FIXES THE SPELLING OF THE LIE, NOT
 *    THE LIE.`
 *
 * ─── AND WHY EVERY PATCH WRITES ITS NULLS EXPLICITLY ─────────────────────────
 *
 * In drizzle, OMITTING a column from `.set()` means LEAVE THE EXISTING VALUE — it
 * does not mean "absent". The refusal branch this replaces omitted tier and both
 * scores under a comment asserting they were absent, so a candidate that had
 * previously completed kept its real tier and score beside `replayStatus:"refused"`.
 *
 *   `A COMMENT ASSERTING AN ABSENCE THAT ITS OWN STATEMENT DOES NOT CREATE
 *    DOCUMENTS THE CORRECT DESIGN WHILE SHIPPING THE WRONG ONE.`
 */

import { isExecutionRefused, refusalEvidence } from "./backtest-refusal.js";

/** The `critic_candidates` columns every outcome writes. Nulls are always explicit. */
export interface ReplayOutcomePatch {
  replayStatus: string;
  replayBacktestId: string | null;
  replayTier: string | null;
  replayForgeScore: string | null;
  actualCompositeScore: string | null;
}

export type ReplayOutcome =
  | {
      kind: "refused";
      patch: ReplayOutcomePatch;
      /** Only keys the result actually carried. Nothing is invented. */
      evidence: Record<string, unknown>;
      rankingEligible: false;
    }
  | {
      kind: "invalid";
      patch: ReplayOutcomePatch;
      /** Machine-readable cause, for the audit trail. */
      reason: "forge_score_absent" | "forge_score_non_finite";
      rankingEligible: false;
    }
  | {
      kind: "completed";
      patch: ReplayOutcomePatch;
      tier: string;
      /** The measured score, unchanged. A finite 0 stays 0. */
      forgeScore: number;
      rankingEligible: true;
    };

/** The status string a completed-but-unscoreable replay is filed under. */
export const REPLAY_STATUS_INVALID = "invalid_result";

function backtestIdOf(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const id = (result as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

/**
 * Classify a `runBacktest()` result into the one outcome its caller must persist.
 *
 * Accepts `unknown` deliberately — both call sites hold the result as `any`, and a
 * narrowly-typed parameter would be erased at exactly the sites with the defects.
 * NEVER THROWS: a malformed or null result classifies as `invalid`, which is the
 * conservative answer (no score, no ranking) rather than a crash.
 */
export function classifyReplayOutcome(result: unknown): ReplayOutcome {
  const replayBacktestId = backtestIdOf(result);

  if (isExecutionRefused(result)) {
    return {
      kind: "refused",
      evidence: refusalEvidence(result),
      rankingEligible: false,
      patch: {
        replayStatus: "refused",
        replayBacktestId,
        // EXPLICIT, not omitted — see the header note on drizzle omission semantics.
        replayTier: null,
        replayForgeScore: null,
        actualCompositeScore: null,
      },
    };
  }

  const raw = (typeof result === "object" && result !== null)
    ? (result as Record<string, unknown>).forge_score
    : undefined;

  if (raw === undefined || raw === null) {
    return {
      kind: "invalid",
      reason: "forge_score_absent",
      rankingEligible: false,
      patch: {
        replayStatus: REPLAY_STATUS_INVALID,
        replayBacktestId,
        replayTier: null,
        replayForgeScore: null,
        actualCompositeScore: null,
      },
    };
  }

  // `Number("")` is 0 and `Number([])` is 0 — both are coercions, not measurements,
  // so anything not already a number is rejected rather than converted.
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return {
      kind: "invalid",
      reason: "forge_score_non_finite",
      rankingEligible: false,
      patch: {
        replayStatus: REPLAY_STATUS_INVALID,
        replayBacktestId,
        replayTier: null,
        replayForgeScore: null,
        actualCompositeScore: null,
      },
    };
  }

  const tierRaw = (result as Record<string, unknown>).tier;
  const tier = typeof tierRaw === "string" ? tierRaw : "REJECTED";

  return {
    kind: "completed",
    tier,
    forgeScore: raw,
    rankingEligible: true,
    patch: {
      replayStatus: "completed",
      replayBacktestId,
      replayTier: tier,
      replayForgeScore: String(raw),
      actualCompositeScore: String(raw),
    },
  };
}
