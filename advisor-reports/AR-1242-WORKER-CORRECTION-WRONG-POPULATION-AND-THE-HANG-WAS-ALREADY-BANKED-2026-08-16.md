# AR-1242 (WORKER) — CORRECTION TO AR-1241: I USED THE WRONG INSTRUMENT, AND THE HANG WAS ALREADY BANKED · 2026-08-16

```text
RULING : AR-1239 §10.H — self-correction, filed immediately, before you grade AR-1241
PIN    : unchanged, HEAD 857b8f0d539983520d62de66eedba49d4c12f9fc
STOP   : none
```

I filed AR-1241 and then ran the prior-art check I should have run before starting. It convicts
me twice. **Neither correction changes a number in AR-1241; both change what those numbers are
evidence OF.**

---

## 1. 🛑 THE HANG WAS ALREADY IN MEMORY. TWICE. I RE-DISCOVERED IT THE EXPENSIVE WAY.

```text
ops_canonical_acceptance_census_recipe_2026_08_12
  "pytest src/engine/tests (whole directory) HANGS at ~9%. Both trees stalled there for many
   minutes and produced NOTHING. Do not spend a seat on it."

ops_canonical_regression_population_baseline_2026_08_09
  "bare pytest src/engine/tests/ HANGS at 9%"
```

**I spent a large part of this session re-deriving a symptom that was written down twice, in a
directory I am explicitly instructed to grep first.** `worker-execution` §2a-bis says it in the
words this exact failure earned: *a memory you do not consult is indistinguishable from one you
never wrote, and the second discovery of a banked fact costs full price and arrives wearing the
word "finding".* It arrived wearing that word in AR-1240 §3.

**What was genuinely new is narrower than I implied**, and I am restating it at its true scope:
the memory recorded the **symptom and a workaround**. It did not have the cause.

---

## 2. AND THE BANKED ATTRIBUTION WAS WRONG — THIS PART IS A REAL CONTRIBUTION

The memory attributed the hang to *"a cache-stale S3 refresh (missing `AWS_ACCESS_KEY_ID`)"*.

**That is not the cause.** Measured:

```text
src/engine/tests/test_cloud_backend.py::TestIAEWatchdogRunner::test_raises_timeout_if_iae_hangs
reproduced in isolation -> exit 124
root cause: quantum_mc._run_iae_with_watchdog — `while not stop_event.is_set()` exits only when
            the thread FINISHES, so t.join(timeout=max_wait) and its TimeoutError are
            UNREACHABLE in exactly the case the timeout exists for
positive control: a job that COMPLETES returns in 0.0s; the hanging job was still blocked at 6x max_wait
```

I suspect the old attribution was a guess from neighbouring context — `test_cloud_backend.py`
sits early alphabetically, which puts it right at the ~9% mark where the sweep died, and "cloud
backend" reads like S3. **A plausible-sounding cause parked next to a real symptom is how a
wrong mechanism gets obeyed for four months.** The memory is now corrected in place, with the
deselect flag that makes the sweep usable (~6 min).

---

## 3. 🛑 THE CORRECTION THAT MATTERS TO YOU: AR-1241 USED A NON-GOVERNED POPULATION

There is a **governed instrument** for exactly this measurement and I did not use it:

```text
src/engine/tests/canonical_regression_population.txt  — 107 member files
governed as ACCEPT5-INSTRUMENT-1 (R-790 §6)
its clean baseline: 35 failed / 2384 passed / 2 xfailed  @ 88783ad0, ~3 minutes
```

**AR-1241 reported `223 failed / 9030 passed` from a whole-directory sweep.** Both numbers are
real, but they are **different populations with different denominators and they are NOT
comparable to each other or to the governed baseline.** Anyone reading `223 failed` against a
remembered `35 failed` would conclude this lane caused a catastrophe. It did not — the
denominators differ by ~4x.

### What survives, and what I am withdrawing

```text
SURVIVES   zero newly broken / zero newly errored, joined BY NODE ID, with a positive control.
           Both arms ran the identical command on the identical population, so the delta is
           valid ON ITS OWN TERMS and the conclusion "this lane regressed nothing" holds.

WITHDRAWN  any implication that AR-1241 is THE governed §10.H receipt. It is a
           whole-directory sweep delta. The governed instrument is the 107-member manifest and
           I did not run it.
```

★ **A DELTA IS ONLY AS GOVERNED AS ITS POPULATION, AND I NEVER ASKED WHICH POPULATION THE DESK
HAD ALREADY BLESSED.** Same species as `[ranked-by-the-extractor]`: I built my own instrument
when a committed one existed.

### Also independently re-derived rather than read

The same memory prescribes **exactly** the baseline method I invented on the spot — second
worktree at the parent pin, identical command, `git worktree remove --force` after — and
**"compare by FAILURE MEMBERSHIP, never counts"**, which is the lesson I re-learned mid-report
when I caught my own count-only error comparison. All three were already written down.

---

## 4. WHAT I AM NOT DOING

**I am not re-running anything to fix this now.** The governed manifest run is ~3 minutes and I
could produce it — but per your §11 this session should not open new measurement work, and the
honest sequence is: you see the correction first, then the fresh seat runs the governed
instrument as its opening act with a clean read of the ruling. Its own memory also warns the
manifest's membership test is **already RED** (9 files drifted out of it), which is a
disposition question and not a worker's to settle mid-correction.

**Nothing in the repository changed for this report.** No code, no artifact, no re-run. The only
edit is the memory correction in §2, outside the repo.

**Filed before your grade rather than after it**, because a correction that arrives after the
ruling is a correction the ruling already absorbed.
