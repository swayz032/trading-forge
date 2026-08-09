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

/**
 * Why a result could not be accepted as a measurement. SIX distinct causes, each
 * with its own string — `R-758 §6a`. One shared bucket cannot diagnose six faults,
 * and the audit row is the only place this distinction survives.
 */
export type InvalidReason =
  | "status_missing"
  | "status_not_completed"
  | "forge_score_absent"
  | "forge_score_non_finite"
  | "tier_absent"
  | "tier_unrecognized";

/** The only tiers the engine may issue. Anything else is not a tier. */
export const RECOGNIZED_TIERS = ["TIER_1", "TIER_2", "TIER_3", "REJECTED"] as const;
export type RecognizedTier = (typeof RECOGNIZED_TIERS)[number];

/** Of those, the only ones that may enter survivor ranking. */
export const RANKING_ELIGIBLE_TIERS = ["TIER_1", "TIER_2", "TIER_3"] as const;
export type RankingEligibleTier = (typeof RANKING_ELIGIBLE_TIERS)[number];

/**
 * The status a genuine measurement carries.
 *
 * ⚠️ Declared LOCALLY on purpose. `schema.ts` exports `BACKTEST_STATUS_REFUSED` and
 * has no `..._COMPLETED` counterpart, and `R-758 §6a`'s FILES ALLOWED list does not
 * include `schema.ts`. Promoting this to a schema-level constant beside its sibling
 * is the better home and is REPORTED rather than done — widening a bounded closeout
 * by my own decree is the thing the stop list exists to prevent.
 */
export const BACKTEST_STATUS_COMPLETED = "completed" as const;

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
      reason: InvalidReason;
      rankingEligible: false;
    }
  | {
      kind: "completed";
      patch: ReplayOutcomePatch;
      /** Always one the engine actually issued. NEVER inferred, NEVER defaulted. */
      tier: RecognizedTier;
      /** The measured score, unchanged. A finite 0 stays 0. */
      forgeScore: number;
      /**
       * `false` for an explicitly returned `REJECTED`: real measured evidence that
       * may never rank. Callers MUST consume this rather than re-deriving it from
       * the tier string — two copies of a rule are two places for it to drift.
       */
      rankingEligible: boolean;
    };

/** The status string an unusable replay result is filed under. */
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

  const invalid = (reason: InvalidReason): ReplayOutcome => ({
    kind: "invalid",
    reason,
    rankingEligible: false,
    patch: {
      replayStatus: REPLAY_STATUS_INVALID,
      replayBacktestId,
      // Every invalid class clears all three metric columns EXPLICITLY.
      replayTier: null,
      replayForgeScore: null,
      actualCompositeScore: null,
    },
  });

  const obj = (typeof result === "object" && result !== null)
    ? (result as Record<string, unknown>)
    : {};

  // ─── STATUS MUST BE EXPLICIT (R-758 §2) ───────────────────────────────────
  // Nothing here previously tested `status` at all, so a `failed` or status-less
  // result carrying a finite score classified as completed, scored, RANKING-ELIGIBLE
  // evidence. That was LATENT only because the producer's single `failed` return
  // (`backtest-service.ts:855`) happens to carry no `forge_score` — a coincidence of
  // today's code, not a guarantee.
  //   `SAFETY BY STARVATION IS NOT SAFETY BY DESIGN.`
  const status = obj.status;
  if (typeof status !== "string" || status.length === 0) return invalid("status_missing");
  if (status !== BACKTEST_STATUS_COMPLETED) return invalid("status_not_completed");

  const raw = obj.forge_score;
  if (raw === undefined || raw === null) return invalid("forge_score_absent");

  // `Number("")` is 0 and `Number([])` is 0 — both are coercions, not measurements,
  // so anything not already a number is rejected rather than converted.
  if (typeof raw !== "number" || !Number.isFinite(raw)) return invalid("forge_score_non_finite");

  // ─── TIER MUST BE EXPLICIT AND RECOGNIZED (R-758 §3) ──────────────────────
  // This line used to read `typeof tierRaw === "string" ? tierRaw : "REJECTED"`,
  // which did two opposite things at once: it INVENTED a rejection the engine never
  // issued, and it left that invention `rankingEligible`.
  //   `A FABRICATED VALUE THAT IS ALSO TRUSTED DOWNSTREAM IS NOT ONE DEFECT, IT IS A
  //    FALSE MEASUREMENT PLUS A FALSE PERMISSION.`
  // `backtest-service.ts:1725` branches on `!result.tier`, which is the PRODUCER'S
  // OWN witness that untiered completed results occur.
  // The `typeof === "string"` test also admitted ANY string, so `"BANANA"` passed
  // through as a tier — handling only the ABSENT case would have been one level short.
  const tierRaw = obj.tier;
  if (typeof tierRaw !== "string" || tierRaw.length === 0) return invalid("tier_absent");
  if (!(RECOGNIZED_TIERS as readonly string[]).includes(tierRaw)) return invalid("tier_unrecognized");

  const tier = tierRaw as RecognizedTier;

  return {
    kind: "completed",
    tier,
    forgeScore: raw,
    // An EXPLICITLY returned `REJECTED` is real measured evidence and its numbers are
    // preserved — but the engine rejected it, so it may never rank.
    rankingEligible: (RANKING_ELIGIBLE_TIERS as readonly string[]).includes(tier),
    patch: {
      replayStatus: BACKTEST_STATUS_COMPLETED,
      replayBacktestId,
      replayTier: tier,
      replayForgeScore: String(raw),
      actualCompositeScore: String(raw),
    },
  };
}
