# EXTERNAL READ — 2026-08-09 — `R-754` — GRADE ACCEPTED AT BAND 6; LIVE REFUSAL CONSUMERS CLOSE BEFORE THE STATE CHANNEL

> 🛑🛑 **BANKING RECEIPT — READ THIS HEADER BEFORE THE BODY.**
>
> **WHY THIS FILE EXISTS:** `R-754 §3` adopted this read *"VERBATIM BY REFERENCE"* and required
> *"its ten controls, in full"* — **and did not bank it.** `AR-861 §2` measured the carrier absent
> (`git ls-files | grep 754` EMPTY; `find docs/designs -iname "*754*"` EMPTY) **with a positive
> control proving the search shape finds a banked read** (`EXTERNAL-READ-2026-08-09-R752-TS-REFUSAL.md`).
> **The worker was right and the defect is the desk's.** `R-751 §10` had already made banking
> **BINDING in the adopting ruling**, and `R-754` did neither that nor the `[UNBANKED — NOT RELIED ON]`
> alternative.
>
> ★★★★★ **`AN ADOPTED CHECKLIST WITH NO CARRIER CANNOT GOVERN A BRIEF — A RULING THAT ADOPTS AN
> UNBANKED ARTIFACT HAS ADOPTED A MEMORY.`** ★★★ **`A REFERENCE IS A PROMISE THAT AN ARTIFACT
> EXISTS, AND NOBODY CHECKS A PROMISE WRITTEN IN THE IMPERATIVE.`**
>
> **WHAT THIS BANKING IS, AND IS NOT:** it is a **DEBT DISCHARGE**, not a ruling. **No decision is
> made here and none is changed** — `R-754`'s dispositions stand exactly as committed at `ba1f5e85`.
> ⇒ **`[wait-on-gpt]` is not engaged: banking an artifact the desk already adopted introduces no new
> decision to wait on.**
>
> **PROVENANCE, STATED RATHER THAN GLOSSED — THIS MATTERS FOR HOW MUCH THE FILE IS WORTH:**
> `[RELAYED — OPERATOR-DELIVERED CHAT, TRANSCRIBED BY THE DESK]`. It arrived as operator-relayed
> chat (the measured channel — **not** the `external-advisor/gpt-rulings` branch, which went stale
> 2026-08-02). **The desk is the transcriber, so the desk is a failure point:** if a clause below
> disagrees with the operator's original message, **the operator's message wins.**
> ⚠️ **ZERO AUTHORITY — ORDER CHANGES, AUTHORITY DOES NOT** (`[external-opinion]`). This text is
> adjudicated **on merit**. `R-754` adopted `§1`–`§6` **on the desk's own measurement** and
> **OVERRULED `§7`** (monitors) because it echoed our own stale onboarding file.
> ★★★★★ **`A STALE CARRIER FED TO AN EXTERNAL READER COMES BACK WEARING EXTERNAL AUTHORITY — AN
> ECHO IS NOT A SECOND PATH.`**
>
> **THE TEN CONTROLS THE WORKER COULD NOT READ ARE `§3`'s `REQUIRED CONTROLS` LIST BELOW — they are
> the ten bullets, and four of them are POSITIVE controls (`completed` still works).** 🛑 **Report the
> two classes SEPARATELY; never as one `10/10 green`** (`R-754 §3` amendment 3).

---

## VERBATIM TEXT AS RELAYED

GPT EXTERNAL ADVISOR RULING — R-754 · GRADE ACCEPTED AT BAND 6; LIVE REFUSAL CONSUMERS CLOSE BEFORE THE STATE CHANNEL

I read the complete 725-line grade and checked its load-bearing findings against GitHub.

[MEASURED FROM GITHUB]
Current remote head: 6ae9c056c00472e535dd334b8316909e2da12ce0
Graded pin: 16224ef5cf8bc03ed47f3fd524a18e32a0d25004
Receipt: docs/designs/GRADE-TRIGGER-SAFETY-2026-08-09.md
Receipt blob is unchanged from commit 10507df5.
The nine commits after the graded pin modify documentation only; `src/` is unchanged.

§1 — VERDICT

RATIFIED: `PASS_WITH_BOUNDED_FINDINGS`, band 6.

Do not re-run this grade.

The correct claim is narrower than "terminal end to end":

- Python refusal: verified.
- TypeScript backtest-service refusal: verified.
- No capital/trades/metrics/promotion: verified.
- Entire surrounding pipeline terminality: REFUTED.

The system is safe from trading invented rules, but a refused strategy can still be repeatedly scheduled or misreported by downstream consumers.

§2 — TWO CARRIER CORRECTIONS

1. The plain retirement summary saying "three follow-ups" is incomplete. The grade contains ten findings.

2. The latest handover's correction against grade item (H) is rejected.

`shadow-divergence-writer.ts` does call `compareShadowToBacktest` when a baseline exists. But when `expected_signals` is absent, `loadExpectedSignals()` returns `[]` and the writer returns `baseline_missing` before that call.

Therefore the grade's actual statement stands:

- checker surface: fail-closed;
- writer's missing-baseline surface: fail-open;
- refused rows still cannot become baselines because the loader requires `status="completed"`.

Also strike the handover's sentence saying the refusal is "terminal end-to-end." It is terminal only through `backtest-service.ts`.

§3 — NEXT WORK: D-10 REFUSAL-CONSUMER TERMINALITY SWEEP

AUTHORIZED to a fresh worker seat.

Close `F-7`–`F-10` as one bounded semantic wave. No state-channel work in this wave.

ORDER:

1. `F-8` — candidate conveyor, first because it compounds.
2. `F-9` — critic evidence resolver.
3. `F-10` — shadow rerun.
4. `F-7` — latent agent caller carrying the same binary-status defect.

REQUIRED BEHAVIOUR:

- `F-8`: a `refused` backtest is terminal eligibility evidence. It must be excluded from the candidate query and must never increment the successful-enqueue counter or emit `candidate_backtest_enqueued`.
- `F-9`: both implicit "latest backtest" resolution and explicit backtest IDs must require `completed`. A refused row must produce a named no-evidence outcome—never `[]`, `0`, or zeroed metrics.
- `F-10`: a refused shadow rerun must stop before metric hashing, `metricsPassGate`, status-flip calculation, and critical-severity attribution. Preserve it as a named execution-refusal event.
- `F-7`: map `completed`, `refused`, and genuine failure separately. A refusal must never become `failed`, `failure`, or `"backtest failed"`.

Before editing, mechanically enumerate every production `runBacktest()` consumer and every binary `completed`/not-completed status branch. If a fifth refusal-sensitive consumer exists, STOP and report it; do not silently expand.

REQUIRED CONTROLS:

- Red-first reproduction for each finding.
- Mutation restoring each original defect must turn its control red.
- Candidate with no prior terminal row still enqueues and completes.
- Refused candidate never receives a second successful enqueue.
- Completed critic evidence still works.
- Refused critic evidence carries no fabricated metrics.
- Completed shadow rerun still computes its comparison.
- Refused shadow rerun never reports a metric regression.
- Ordinary agent failure still records a genuine failure.
- Refusal records its real evidence and no fake error.

§4 — D-9 FOLLOWS AUTOMATICALLY

When D-10 is committed, pushed, remotely verified, and green, the same fresh worker may close:

- `F-1`: CONTROL B must assert returned AND persisted `completed`.
- `F-3`: an executing test must read the real production `BACKTEST_STATUS_REFUSED`; a hardcoded schema mock is insufficient.
- `F-4`: a bare `{execution_status:"REFUSED"}` must not persist as a valid refusal.

For `F-4`:

- `entry_eligible` must be explicitly carried—never defaulted.
- A real refusal object with condition ID, disposition and reason is required.
- Malformed refusal data is a named protocol failure, not a source refusal.
- It must still reach no metrics, transaction, trades, scoring or promotion.
- The complete live Python envelope must remain a valid persisted refusal.

§5 — STATE CHANNEL

`D-3` remains HELD until D-10 and D-9 are delivered.

After both closeouts pass:

- resume from `f788c64b` by reconciliation;
- do not merge, cherry-pick or replay that checkpoint;
- it predates the load-bearing eligibility boundary and the new refusal semantics;
- use a fresh seat for the state-channel build.

No separate independent grade is required between D-10/D-9 and state-channel coding. The final state-channel grade must cover all three together. This is the fastest safe route.

§6 — DEFERRED GRADE HYGIENE

Before the next independent grade—not before the current money-path work:

- `F-2`: make the 103-member baseline reproducible without the untracked grade artifact.
- `F-6`: stop the acceptance test from rewriting a tracked report.
- `F-5`: low, pre-existing vacuity; parked.
- Proposed `D-7`: closed and struck; the live refusal carries no `forge_score`.

§7 — SEAT AND MONITORS

AR-859's retirement and ear disarm are accepted.

All monitors remain disarmed. Arm nothing. The one-ear exception expired when the grade receipt landed.

Plain English: the bot now refuses safely, but three surrounding services still do dumb things with that refusal. Fix those small consumers, harden the three weak controls, then finish the state channel. That remains the fastest engineering path to the compiler breakthrough.

---

## DESK ANNOTATIONS ON THIS TEXT (do not confuse with the read)

- 🛑 **`§7` IS OVERRULED** by `R-754 §5` — the operator reversed `NO MONITORS` first-hand to the
  `R-754` seat, and this read's monitor instruction was an **echo of our own stale
  `advisor-onboarding §4a`**, not an independent finding. **One ear per seat is now live and
  required.**
- ⚠️ **`§3`'s *"AUTHORIZED to a fresh worker seat"* was NARROWED at `R-754 §4`:** the retirement of
  `claude.exe 3160` is lifted for `D-10`/`D-9` **only**, on a census showing exactly two live
  `claude.exe`. 🛑 **`D-3` still requires a genuinely fresh seat, per `§5` above.**
- ⚠️ **`§1`'s remote-head line (`6ae9c056`) is a TIMESTAMP, not a standing condition** — HEAD has
  moved several times since. `A SHA IN A CONTRACT IS A TIMESTAMP` (`R-750 §3`).
- ✅ **`§2`'s item-`(H)` correction was INDEPENDENTLY RE-MEASURED by the desk before adoption**
  (`R-754 §2`, executable lines `:143`/`:176`/`:183` plus `loader:124`) — **adopted on the desk's own
  measurement, not on the read's authority.**
