/**
 * G-1 — the FROZEN REGISTRY of approved `runBacktest()` production callers (R-772 §5).
 *
 * THE IDENTITY SCHEME (contract clause B), stated here because the registry is
 * meaningless without it:
 *
 *     file  ::  enclosing production function  #  ordinal
 *
 *   file     repo-relative, forward slashes.
 *   fn       the nearest ENCLOSING NAMED function/method. An anonymous handler
 *            registered at module scope is named by the registration that installed
 *            it (`backtestRoutes.post(/)`), which is stable and reviewable where
 *            `<module-scope>` would be neither.
 *   ordinal  index in source order among guarded calls IN THAT SAME function.
 *            Only critic-optimizer has repeats (two functions × two calls each).
 *
 * 🛑 NO LINE NUMBERS ANYWHERE IN THE IDENTITY. A pure reformat of a caller file
 * must not redden this guard; if it did, the key would be line-pinning wearing a
 * different name. (Arm 6 executes exactly that.)
 *
 * ⚖️ `evidence` below DOES carry line numbers. It is DOCUMENTATION, not identity —
 * nothing asserts on it. Do not promote it into a key.
 *
 * DISPOSITIONS: clause E requires every entry to record an EXPLICIT disposition.
 * They deliberately do NOT all agree — the invariant is that no caller has an
 * IMPLICIT one. Two entries are `DISCARDS` and that is a recorded fact about
 * today's code, not an endorsement of it (see the note at the bottom).
 */

/** What this call site does with a refusal the engine returns. */
export type RefusalDisposition =
  /** Detects the refusal explicitly and takes a distinct terminal action. */
  | "HANDLES_REFUSAL"
  /** Passes the refused outcome outward without collapsing it into success/failure. */
  | "PROPAGATES"
  /** Does not consume the outcome at all (fire-and-forget). */
  | "DISCARDS";

export interface ApprovedCaller {
  file: string;
  fn: string;
  ordinal: number;
  disposition: RefusalDisposition;
  /** Documentation only — never asserted on, never part of the identity. */
  evidence: string;
}

export const APPROVED_BACKTEST_CALLERS: readonly ApprovedCaller[] = [
  {
    file: "src/server/lib/carter/carter-actions.ts",
    fn: "runBacktestHandler",
    ordinal: 0,
    disposition: "PROPAGATES",
    evidence:
      "carter-actions.ts:182 call; returns `{ backtestId: result.id, status: result.status }` — " +
      "the engine's status flows outward verbatim, with no coercion and no branch that could " +
      "rewrite a refusal into success or failure.",
  },
  {
    file: "src/server/routes/backtests.ts",
    fn: "backtestRoutes.post(/)",
    ordinal: 0,
    disposition: "DISCARDS",
    evidence:
      "backtests.ts:255 fire-and-forget `.then(...).catch(...).finally(...)`; the `.then` body is " +
      'empty but for the comment "Logged internally by runBacktest". The outcome is not consumed ' +
      "here — a client observes it later via GET /api/backtests/:id, i.e. from the DB row, not " +
      "from this call's return value.",
  },
  {
    file: "src/server/services/agent-service.ts",
    fn: "runStrategy",
    ordinal: 0,
    disposition: "HANDLES_REFUSAL",
    evidence:
      "delegates to the shared mapper `mapAgentOutcome` (agent-service.ts:515), whose " +
      "`isExecutionRefused(result)` branch sits at :517 (F-7 / AR-887's one shared mapper).",
  },
  {
    file: "src/server/services/agent-service.ts",
    fn: "runStrategyFromDSL",
    ordinal: 0,
    disposition: "HANDLES_REFUSAL",
    evidence: "same shared mapper `mapAgentOutcome` (:515) / `isExecutionRefused` (:517).",
  },
  {
    file: "src/server/services/agent-service.ts",
    fn: "runClassStrategy",
    ordinal: 0,
    disposition: "HANDLES_REFUSAL",
    evidence: "same shared mapper `mapAgentOutcome` (:515) / `isExecutionRefused` (:517).",
  },
  {
    file: "src/server/services/candidate-backtest-conveyor-service.ts",
    fn: "runCandidateBacktestConveyor",
    ordinal: 0,
    disposition: "HANDLES_REFUSAL",
    evidence:
      "conveyor-service.ts:263 writes the distinct audit action `conveyor.candidate_backtest_refused`; " +
      ":252 records that a refusal is TERMINAL and does not take the skip/retry cooldown path.",
  },
  {
    file: "src/server/services/critic-optimizer-service.ts",
    fn: "replayCandidatesAsync",
    ordinal: 0,
    disposition: "HANDLES_REFUSAL",
    evidence:
      "critic-optimizer-service.ts:2469 call; classified at :2497 by the shared " +
      "`classifyReplayOutcome` (N-1's one shared replay-outcome handler).",
  },
  {
    file: "src/server/services/critic-optimizer-service.ts",
    fn: "replayCandidatesAsync",
    ordinal: 1,
    disposition: "DISCARDS",
    evidence:
      "critic-optimizer-service.ts:2697 — the CHILD auto-backtest, fire-and-forget with only a " +
      "`.catch()` for rejection. A refusal is not a rejection, so it is not observed here.",
  },
  {
    file: "src/server/services/critic-optimizer-service.ts",
    fn: "manualReplayCandidates",
    ordinal: 0,
    disposition: "HANDLES_REFUSAL",
    evidence:
      "critic-optimizer-service.ts:2978 call; classified at :2992 by the same shared " +
      "`classifyReplayOutcome`. (Function spans :2865-:3260.)",
  },
  {
    file: "src/server/services/critic-optimizer-service.ts",
    fn: "manualReplayCandidates",
    ordinal: 1,
    disposition: "DISCARDS",
    evidence:
      "critic-optimizer-service.ts:3208 — the CHILD auto-backtest on the manual path, fire-and-forget " +
      "with only a `.catch()`. Same shape as :2697.",
  },
  {
    file: "src/server/services/evolution-service.ts",
    fn: "evolveStrategy",
    ordinal: 0,
    disposition: "HANDLES_REFUSAL",
    evidence:
      "evolution-service.ts:445 call; `isExecutionRefused(result)` at :461 leaves the iteration " +
      "before any number is derived, and writes `strategy.evolution-mutation-refused`.",
  },
  {
    file: "src/server/services/lifecycle-service.ts",
    fn: "runEvidenceAutoBacktestEnqueue",
    ordinal: 0,
    disposition: "HANDLES_REFUSAL",
    evidence:
      "lifecycle-service.ts:3201 call; `isExecutionRefused(btResult)` at :3220 (D-10 N-4's FIX-3) " +
      "classifies BEFORE any status is derived, replacing the old binary skipped/success ternary.",
  },
  {
    file: "src/server/services/matrix-backtest-service.ts",
    fn: "runNext",
    ordinal: 0,
    disposition: "HANDLES_REFUSAL",
    evidence:
      "matrix-backtest-service.ts:104 call; `isExecutionRefused(result)` at :111 returns before the " +
      "`?? 0` metric coercions below it (D-10 N-2).",
  },
  {
    file: "src/server/services/shadow-rerun-service.ts",
    fn: "rerunOneStrategy",
    ordinal: 0,
    disposition: "HANDLES_REFUSAL",
    evidence: "shadow-rerun-service.ts:242 call; `isExecutionRefused(shadowResult)` at :287.",
  },
];

/**
 * OBSERVATION, RECORDED NOT REPAIRED (R-772 §5 forbids production change in this lane):
 * the two `DISCARDS` critic entries (:2697, :3208) launch CHILD backtests fire-and-forget
 * with only a `.catch()`. A refusal is a resolved promise, not a rejection, so a refused
 * child run is invisible at those two sites. That is a real asymmetry with the sibling
 * calls in the same two functions, which DO classify. It is reported in the AR and left
 * to the desk — recording it explicitly is precisely what clause E exists to force.
 */
