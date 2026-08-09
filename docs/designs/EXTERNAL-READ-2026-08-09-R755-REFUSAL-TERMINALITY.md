# EXTERNAL READ — external `R-755`, 2026-08-09 → adopted as campaign `R-751`

> **BANKED VERBATIM, per campaign `R-751 §10`:** *"An adopted checklist with no carrier cannot
> govern a brief — and a ruling that adopts an unbanked artifact has adopted a memory."*
> This file exists because `R-750 §7` adopted "`R-754`'s eleven-point grader checklist" and that
> read was banked NOWHERE, making the adoption unenforceable. **Banking is now required in the
> adopting ruling.**
>
> **NUMBERING:** external `R-755` → campaign `R-751`. Offset is FOUR. **Name the carrier.**
>
> ⚖️ **STATUS: ADOPTED ON MERIT, NOT ON AUTHORITY.** The desk independently CONFIRMED the
> load-bearing defect at the executable line before adopting (`R-751 §1`, four readings).
> ★ **This is the first external read in four that mis-cited nothing** — the previous three
> ledger "corrections" were rejected at `R-748 §2`, `R-749` and `R-750 §2`. **Provenance is not
> quality in either direction.**

---

## VERBATIM

GPT EXTERNAL ADVISOR RULING — AR-851 IS REPOSITORY-PRESENT, BUT GRADING IS HELD FOR ONE SMALL MONEY-PATH CLOSEOUT

R-755 · 2026-08-09

I CHECKED GITHUB AND THE EXECUTABLE CODE, NOT ONLY THE REPORT.

Verified remote state:
- Repository: swayz032/trading-forge
- Branch: h1-wave4-sealed12-driver
- Remote head: ad0ffb4be2622edd82b56a8a753b86aa7d07081d
- The branch is exactly at that commit.
- It is one commit ahead of base f7aefaa6.
- GitHub reports no CI statuses, so the pytest totals remain worker-measured until independently rerun.

RULING

- The four AR-851 deliverables exist in the repository.
- The rich 94-condition artifact is mechanically derived and identifies exactly one affected condition.
- The executed consumer spies and their neighbour control exist.
- The confirmed-teacher pass-through mutation is genuinely guarded.
- However, behavioral acceptance is NOT yet 4/4.
- Accuracy-validator is NOT authorized yet.
- The state-channel checkpoint remains held and must not be merged or replayed.

I found two connected executable defects at the final public boundary.

1. THE REFUSAL TRACE IS BUILT, THEN OVERWRITTEN

The refusal branch correctly creates:

    spec_trace = [execution_summary_record(EXECUTION_REFUSED)]

But the common governance block later executes:

    result["spec_trace"] = strategy.last_trace

The refused strategy never ran compute(), so strategy.last_trace is still its initialized empty list.

Therefore the public main() path replaces the correct refusal record with [].

The direct strategy tests prove the summary builder works. They do not prove the public backtester returns it.

So §4-1 is green one layer too low.

2. REFUSAL IS NOT TERMINAL

AR-851 correctly found the scoring leak, and the live code confirms it.

A refused result has no "error" key, so it continues into:

- pipeline crisis_results=None;
- full stress testing;
- _rescore_with_crisis;
- forge_score and forge_score_components;
- invariant evaluation;
- optional parity shadow;
- optional B15 parameter analysis.

This is broader than only the two gates named in AR-851.

A strategy cannot simultaneously say:

    execution_status = REFUSED

and publish a performance score or downstream qualification analysis.

D-7 IS NOT DEFERRED. IT IS THE NEXT BLOCKING CLOSEOUT.

FASTEST AUTHORIZED ENGINEERING MOVE

Land one small "refusal terminality" commit before grading.

Required behavior:

1. Use an explicit semantic predicate such as execution_status == REFUSED.

2. Do not add a fake "error" key. A deliberate refusal is not a crash or malformed request.

3. A refused result must bypass every downstream analytical surface:

   - crisis/stress processing;
   - crisis rescoring;
   - forge_score and forge_score_components;
   - invariants;
   - parity shadow;
   - B15 battery;
   - any equivalent performance or qualification postprocessor.

4. Harmless output work may remain:

   - governance labels;
   - refusal payload;
   - backtest ID;
   - schema validation;
   - JSON emission.

5. Preserve the refusal summary already placed in spec_trace. The common governance block must not overwrite it with strategy.last_trace.

6. Explicitly name the omitted downstream products, including:

   forge_score
   forge_score_components
   crisis_results
   invariants
   parity_shadow
   b15_battery

REQUIRED CONTROLS

- Public main.callback with TF_SPEC_TRACE=true returns one EXECUTION_REFUSED summary for the golden strategy, not [].
- Refused execution reaches zero stress, rescore, invariant, parity and B15 consumers.
- The forbidden output keys are absent—not present as None or 0.0.
- An eligible neighbour still reaches legitimate downstream processing.
- Cover both single and walk-forward refusal paths.
- Cover pipeline and full stress modes.
- Mutation: restoring the old "error not in result" behavior must make the tests red.
- Mutation: restoring the spec_trace overwrite must make the public-trace test red.
- Existing trigger-safety and blast-radius tests remain green.
- The two ordered state-channel REDs remain RED.
- No state-channel code enters this commit.

ACCEPTANCE-POPULATION CORRECTION

AR-850 was right: "only two failures" is impossible over the complete 103-file manifest because that population already has 33 failures.

The corrected rule is:

- Focused trigger-safety group: no unexpected failures.
- Pinned state-channel group: exactly the two ordered REDs.
- Full 103-member manifest: failure node-ID membership must equal the immutable f7aefaa6 baseline exactly. Compare members, not counts.

The independent grader must rerun the base and candidate SHAs if the frozen 33-member list is not durably committed.

GRADE ORDER

1. Land refusal terminality and public-trace preservation as one bounded commit.
2. Push and remotely verify the exact SHA.
3. Run the focused controls and exact baseline-membership comparison.
4. Then dispatch accuracy-validator once against that immutable SHA.
5. Resume the state channel only after the independent grade accepts the money-path boundary.

DO NOT

- fix the other 31 baseline failures;
- begin a repository-wide trace census;
- audit every frontend consumer now;
- merge f788c64b;
- invent the breakout rule;
- run edge qualification;
- call a refused zero-score result safe.

FAST-ENGINEERING POSITION

Yes, this is still the fastest engineering path.

Grading ad0ffb4b now would knowingly grade a leaking refusal, force a second grade, and waste time. The faster path is one narrow terminality patch, then one grade.

Simple English:

The worker built almost everything correctly. Two leaks remain at the final doorway:

- the bot writes "REFUSED" and then erases that message;
- the bot refuses the strategy and then scores it anyway.

Fix those two places together. Then grade once. After that, the final state-channel integration can resume.

Distance to the compiler breakthrough: close—one small money-path commit, one independent grade, then the held state-channel landing and final source-to-engine acceptance. This is no longer an architecture search; it is a short, bounded finish.

---

## DESK NOTES ON THIS READ (`R-751`)

- ✅ **DEFECT 1 CONFIRMED BY THE DESK**, four independent readings at `backtester.py`
  (`R-751 §1`): indentation places `:8420` at the same level as the `if`/`elif`/`else` chain ·
  no `return`/`raise` between `:8378` and `:8431` · no `error` key in the refusal dict ·
  `spec_condition_compiler.py:610` initialises `last_trace = []`.
- ✅ **DEFECT 2 was found FIRST by the worker** (`AR-851 §7`, `backtester.py:8498`/`:8560`).
  The read WIDENS it beyond the two gates. ⚠️ **The desk did NOT verify the wider surface list;
  `R-751 §8-3` therefore orders the worker to ENUMERATE MECHANICALLY FROM THE CODE rather than
  work from the read's list** (`[unenumerated-ladder]` — do not inherit a denominator).
- ⭐⭐⭐ **A THIRD, NON-OVERLAPPING PATH exists** `[MEASURED BY GRADED INSTRUMENT — PARTIAL, the
  agent was stopped mid-run]`: `TF_SPEC_TRACE` appears in **no test file anywhere in `src/`**.
  **The defect slipped past NO TEST, not a weak one.**
- ⚠️ **THE READ'S ONE UNVERIFIED CLAIM:** "the pytest totals remain worker-measured until
  independently rerun" is **correct and is the honest limit** — no CI ran on this branch.
