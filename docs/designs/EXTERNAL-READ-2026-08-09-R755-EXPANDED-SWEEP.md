# EXTERNAL READ — 2026-08-09 — `R-755` — EXPANDED `D-10` CONSUMER SWEEP

> 🛑🛑 **BANKING RECEIPT — READ THIS HEADER BEFORE THE BODY.**
>
> **BANKED IN THE ADOPTING COMMIT**, per `R-751 §10`. `R-754` broke that rule once (`AR-861 §2`
> measured the carrier absent) and this file exists so `R-755` does not repeat it.
> ★★★★★ **`A RULING THAT ADOPTS AN UNBANKED ARTIFACT HAS ADOPTED A MEMORY.`**
>
> 🛑🛑🛑 **THE `AR RULED:` LINE BELOW IS A JOIN KEY, NOT A COURTESY. THIS READ NAMES
> `AR-862 · AR-863`. IT DOES NOT NAME `AR-864`, WHICH LANDED AFTER IT.** `R-755` therefore rules
> `AR-862`+`AR-863` **only** and HOLDS `AR-864`.
> ★★★★★ **`A BURST OF REPORTS DOES NOT INHERIT ONE READ. JOIN ON THE LIST THE READ NAMES, NEVER
> ON ARRIVAL ORDER.`** — operator, 2026-08-09, tenth assertion, verbatim:
> ***"WAIT ON GPT ANYTIME ITS RPEROTS BACK TO BACK."*** **It caught `R-755` in draft: `AR-864` had
> been written into the ruling and was struck before commit.**
>
> **PROVENANCE:** `[RELAYED — OPERATOR-DELIVERED CHAT, TRANSCRIBED BY THE DESK]`. The desk is the
> transcriber and therefore a failure point: **if a clause below disagrees with the operator's
> original message, the operator's message wins.**
> ⚠️ **ZERO AUTHORITY — ORDER CHANGES, AUTHORITY DOES NOT** (`[external-opinion]`).
>
> **WHAT THE DESK RE-DERIVED ITSELF BEFORE ADOPTING (`R-755 §2`, `§3`) — adopted on MEASUREMENT,
> not on this document's say-so:**
> - ✅ **The `14`-call / `9`-caller-file census is EXACT.** The desk re-derived it by MEMBER:
>   `17` raw matches minus two comments (`metrics-registry.ts:786`, `critic-optimizer-service.ts:8`)
>   minus the definition in `backtest-service.ts`. **`AR-862`'s `13` was short by one.**
>   ★★ **`A COUNT CANNOT ADJUDICATE A COUNT` — settled by enumeration, not by authority.**
> - ✅ **The `forgeScore` / `forge_score` casing defect is CONFIRMED at the executable line**
>   (`backtest-service.ts:299` declares `forge_score`; `critic-optimizer-service.ts:2400` is
>   `const rr = replayResult as any;` and `:2402`/`:2859` read `rr?.forgeScore ?? 0`).
>   🛑 **The desk ELEVATED it out of the refusal frame: it fires on the COMPLETED path too, so
>   every legitimate critic replay is scored `0` today.**
> - ✅ **`§4`'s rejection of OPTION B is mechanically settled, not argued:** `:2400`'s `as any` is
>   the literal counter-example to a type-only discriminated-union repair.

---

## VERBATIM TEXT AS RELAYED

GPT EXTERNAL ADVISOR RULING — R-755 · 2026-08-09

DECISION: RATIFY F-8 PRODUCTION FIX · AMEND ITS POSITIVE CONTROL · CONFIRM THE STOP · EXPAND D-10 TO THE MEASURED CONSUMER POPULATION · REJECT SOURCE-LEVEL THROWING · RELEASE WORK IMMEDIATELY

AR RULED: AR-862 · AR-863

REMOTE VERIFIED: h1-wave4-sealed12-driver = 8f7c0d4e651efaf3794511ed258b763efcdff785.

§1 — F-8 IS ACCEPTED, WITH ONE TEST CORRECTION OWED

I inspected the pushed commit and its parent on GitHub.

Confirmed:

- The eligibility query now excludes `BACKTEST_STATUS_REFUSED` permanently, without the 24-hour failed-run window.
- A returned refusal no longer increments the successful-enqueue counter or emits `factory:candidate_backtest_enqueued`.
- The shared production constant is used.
- The parent test really lacked both `asc` and `orderBy`, while production used both. The test therefore threw upstream into the service's catch. Repairing that stale mock was necessary to make the tests reach the money path.

🛑 One required positive control remains incomplete:

`F-8.3` inherits `status: "running"` from the test setup. An awaited `runBacktest()` happy path must return `completed`; R-754 explicitly requires "enqueues and completes."

AMENDMENT: in the next D-10 test commit, make F-8.3 return `status: "completed"` and prove the completed candidate still counts and announces. Do not reopen the production fix or create a separate waiting point.

F-8 production is CLOSED. F-8 acceptance evidence is PARTIAL until that small correction lands.

§2 — AR-862'S STOP WAS CORRECT, BUT ITS CENSUS IS SHORT

At current remote HEAD, production contains exactly 14 direct `runBacktest()` calls across 9 caller files:

- `carter-actions.ts`: 1
- `routes/backtests.ts`: 1
- `agent-service.ts`: 3
- `candidate-backtest-conveyor-service.ts`: 1
- `critic-optimizer-service.ts`: 4
- `evolution-service.ts`: 1
- `lifecycle-service.ts`: 1
- `matrix-backtest-service.ts`: 1
- `shadow-rerun-service.ts`: 1

`backtest-service.ts` is the separate tenth file containing the definition.

Therefore AR-862's "13 call sites across 10 files, plus the definition" is false by one. The next committed census must pin members, not merely a count.

Of the 14 direct calls:

- 4 intentionally consume no metrics:
  - Carter propagates the returned status.
  - `routes/backtests.ts` discards the asynchronous result.
  - Critic child launches at `:2575` and `:3051` discard their results.
- 10 consume or classify the result and are refusal-sensitive:
  - Agent ×3
  - Candidate conveyor ×1
  - Critic replay ×2
  - Evolution ×1
  - Lifecycle ×1
  - Matrix ×1
  - Shadow rerun ×1

Correction to AR-862: N-1 exists at the two replay-result paths, `:2390` and `:2849`. The child calls at `:2575` and `:3051` are inspected, intentionally result-discarding sites—not additional N-1 metric consumers.

There is also a secondary binary branch at `agent-service.ts:2274` that converts the result returned by `runStrategyFromDSL()` into `tested` or `failed`. It belongs to F-7 even though it does not call `runBacktest()` directly.

§3 — THE EXPANDED FINDINGS ARE CONFIRMED

The three worker findings are real. A fourth direct consumer also enters scope.

N-1 — critic replay:

- Both replay paths turn refusal into `replayStatus: "completed"`, `REJECTED`, and score `0`.
- There is an additional completed-path defect at the same lines: `runBacktest()`'s declared/result field is `forge_score`, but the critic reads `forgeScore`. A legitimate completed replay can therefore become zero too.
- Both automatic and manual replay paths must be repaired together.

N-2 — matrix:

- A refusal becomes seven numeric zeroes and `REJECTED`.
- Those fabricated cells enter tier selection, best-combo selection, correlation processing, progress accounting, and final `"completed"` output.
- A refused matrix must expose no numeric cell, best combo, correlation, or completed event.

N-3 — evolution:

- A refusal becomes Sharpe `0`, is compared with the parent, and is persisted as a measured mutation.
- If no mutation wins, the parent can then be retired.
- A refusal must stop evolution before mutation scoring, outcome persistence, child promotion, or parent retirement.

N-4 — lifecycle:

- `lifecycle-service.ts:7001` records every non-skipped result as audit `"success"`.
- More importantly, its eligibility cap expires after 24 hours and does not recognize the durable refused backtest. The same source-level refusal can therefore be requested again every day.
- This is refusal-sensitive and joins D-10. A refusal must be named and terminal for the unchanged strategy/config identity.

These are new findings. They are not hidden F-7–F-10 findings from the grade.

§4 — ARCHITECTURE DECISION: LOCAL SEMANTICS + SHARED CLASSIFIER

OPTION A is adopted, expanded to the measured population.

OPTION B—making the returned object throw when consumers touch absent metrics—is rejected for D-10:

- Throwing converts a deliberate refusal into a failure, which the contract forbids.
- One central exception cannot decide whether the critic must stop ranking, the matrix must terminate, or evolution must avoid retirement.
- Existing `as any` casts defeat a type-only discriminated-union repair.
- Retyping every caller is a larger refactor and is not the fastest path to the compiler breakthrough.

Authorized forcing function:

- One small shared refusal classifier/type guard may be introduced.
- It must use the real `BACKTEST_STATUS_REFUSED`.
- It must return a deliberate classification and never throw.
- Each consumer still owns its correct domain-specific terminal action.
- Add a mechanically re-derived call-site disposition guard covering all 14 direct calls. Every member must be classified as `PROPAGATES`, `DISCARDS`, or `HANDLES_REFUSAL`.
- A new direct caller without a disposition turns the guard red.

This fixes today's consumers and makes the fifteenth caller hard to introduce silently.

§5 — REQUIRED BEHAVIOUR FOR THE EXPANDED WAVE

F-9 + N-1, landed together because they share the critic surface:

- Implicit latest-backtest and explicit-ID evidence must require `completed`.
- Refusal returns named no-evidence, never `[]`, zeroes, or `REJECTED`.
- Automatic and manual replay refusal must not write `replayStatus: "completed"`.
- No refusal enters survivor ranking.
- Completed replay must preserve a nonzero `forge_score` through persistence and ranking. A camel-case test fixture is forbidden because it would memorialize the defect.

N-3 evolution:

- Return a named refusal outcome.
- Do not calculate improvement.
- Do not write `mutationOutcomes`.
- Do not create/promote a child.
- Do not retire the parent.
- Completed mutation remains a positive control.

N-2 matrix:

- A source-level refusal terminates the matrix.
- Do not run remaining combinations after the terminal refusal.
- Persist/return matrix status `refused` with evidence.
- Emit no numeric result cell, best combo, correlation, ranking, or completed SSE.
- A fully completed matrix remains the positive control.

N-4 lifecycle:

- Refusal gets its own named audit outcome, never generic success.
- It must not be retried after 24 hours while the strategy/config identity is unchanged.
- A legitimate completed auto-backtest remains the positive control.

F-10:

- Red-proof reachability first.
- Refusal stops before metric hashing, `metricsPassGate`, status-flip computation, or critical attribution.

F-7:

- Repair all three direct agent paths and the drain branch at `agent-service.ts:2274`.
- `completed`, `refused`, and genuine failure remain three distinct states.
- Refusal must never become `failed`, `failure`, or `"backtest failed"`.

§6 — ORDER AND RELEASE

D-10 now has 8 semantic lanes:

1. F-8 — production CLOSED; completed positive-control correction owed
2. F-9
3. F-10
4. F-7
5. N-1 critic replay
6. N-2 matrix
7. N-3 evolution
8. N-4 lifecycle

Current fan-in: 1 / 8 production lanes.

Fastest safe execution order from here:

1. F-9 + N-1 in one critic commit
2. N-3 evolution
3. N-2 matrix
4. N-4 lifecycle
5. F-10
6. F-7
7. Final D-10 acceptance and exact baseline-membership comparison

F-8.3's completed-positive correction rides the next commit.

No further desk wait is required. The stop is discharged by this ruling.

The original ten controls remain mandatory, with the new consumer-specific controls above added. Report mutation controls and unchanged-code positive controls separately.

§7 — CRITICAL PATH

D-9 still auto-releases only after expanded D-10 is committed, pushed, remotely verified, focused-green, and baseline-equal by failure membership.

D-3 state-channel work remains held until D-10 and D-9 finish. `f788c64b` remains reconciliation input only—never merge, cherry-pick, or replay it.

No extra independent grade is inserted between D-10/D-9 and D-3. The final state-channel grade covers all three. That remains the fastest safe engineering plan.

Plain English: the first surrounding-service repair is done. We found the same refusal bug in four more places, including one that can retire a strategy using fake zero evidence. Fix those consumers once, harden the three weak controls, then resume the final state channel. We are still fast-engineering; the scope widened because leaving known fake evidence behind would make the "breakthrough" untrustworthy.

---

## DESK ANNOTATIONS (do not confuse with the read)

- 🛑 **`§6`'s *"Current fan-in: 1 / 8"* was true when written and is already stale** — `AR-864`
  delivered `F-9`. **`A SNAPSHOT TAKEN MID-MOTION IS NOT A STANDING CONDITION.`**
- ⚠️ **`§2`'s `lifecycle-service.ts:7001` and `AR-862 §4`'s `:6975` are different line citations for
  the same audit-status concern.** **The worker re-derives the line before repairing it; do not
  inherit either number.**
- ✅ **`§1`'s `F-8.3` amendment is ADOPTED** and explicitly must NOT reopen the production fix or
  create a second waiting point (`R-755 §5`).
- 🛑 **`§4`'s disposition guard is accepted ONLY red-proofed at birth** (`R-755 §4`): plant a
  fifteenth fake call site, watch it go red, remove it. **`A GUARD THAT HAS NEVER SEEN THE EVENT IT
  EXISTS FOR IS A HABIT.`**
