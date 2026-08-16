# AR-1241 (WORKER) — §10.H FULL-SUITE DELTA, CLOSED · 2026-08-16

```text
RULING : AR-1239 §10.H / §12 — completed full-suite delta against a baseline, by node ID
PIN    : HEAD 857b8f0d539983520d62de66eedba49d4c12f9fc
         BASELINE a4901583c28eccf02b5d8b8d33a0ea62519de0bd (this session's starting head)
STOP   : none
NEXT   : G2-C / G2-D, and per your §11 they should start in a fresh session
```

This is the receipt AR-1240 said it owed. It is a follow-up, not a new lane.

---

## 1. THE RESULT

```text
                     BASELINE a4901583      HEAD 857b8f0d
failed                      223                  223
passed                     8959                 9030        (+71)
skipped                      41                   41
xfailed                       3                    3
errors                       33                   33
deselected                    1                    1
wall clock                5m54s                5m59s
```

### Joined BY NODE ID, not by totals

AR-1217 was rejected for comparing totals, because *N fixed and N broken* is indistinguishable
from *nothing changed*. So both sets are joined on the test id:

```text
FAILED  set identical : True    newly broken 0    newly fixed 0
ERROR   set identical : True    newly errored 0   gone 0
```

**VERDICT: ZERO NEWLY BROKEN, ZERO NEWLY ERRORED.** The 223 failures and 33 errors are
pre-existing at the head this session started from and are untouched by this lane.

### The diff is proven able to detect a change

```text
POSITIVE CONTROL — plant one fake id into the compared set:
  NEWLY ERROR with planted id: 1 -> ['src/engine/tests/test_planted::test_control']
  control PASS
```

Without that, `identical: True` is a claim about my comparison, not about the runs.

### A second, independent corroboration of the +71

```text
8959 -> 9030 = +71 passed
test_batch_locator + test_opus_phase1_route + test_term_equivalence  =  63
AR-1239 §3.1 controls appended to test_source_fidelity_guard.py      =   8
                                                                       ---
                                                                        71   exact
```

The entire passed delta is accounted for by tests this lane added. **Nothing else moved**, and
no failure appears in any suite this lane touched (`batch_locator`, `opus_phase1_route`,
`term_equivalence`, `source_fidelity_guard`, `evidence_relevance`, `span_collision`,
`anchor_locator`).

---

## 2. METHOD, AND THE TWO THINGS THAT MAKE IT ADMISSIBLE

1. **Identical command on both sides**, including the identical single `--deselect`. The
   exclusion therefore CANCELS out of the delta rather than hiding inside one side of it.
2. **The baseline was a real checkout**, not a reconstruction: a detached worktree at
   `a4901583`, verified to contain **none** of this lane's new modules before it ran. Worktree
   removed after the measurement; `git worktree list` is clean.

---

## 3. 🛑 WHAT THIS RECEIPT DOES **NOT** COVER

```text
src/engine/tests/test_cloud_backend.py::TestIAEWatchdogRunner::test_raises_timeout_if_iae_hangs
```

**DESELECTED ON BOTH SIDES. It is not covered by any number above.** It is the AR-1240 §3
defect — `quantum_mc._run_iae_with_watchdog` cannot bound a hang, so its own test hangs the
suite indefinitely. Naming it here in the same section as the numbers, because an exclusion
reported anywhere other than beside the result eventually reads as coverage.

Also not covered: this is a LOCAL run. **GitHub still exposes no status contexts and no
workflow runs at this head, so none of it is CI.**

### An honest correction to my own first attempt at this receipt

My first delta compared failures by node id but **errors by COUNT ONLY** (33 vs 33) — the exact
weakness AR-1217 was rejected for, reproduced by me one report after citing it. `-rf` never
emits error ids. I re-ran **both** sides with `-rEf` rather than publish a leg I already knew
was weak. The 33-vs-33 count was in fact correct, but it was not evidence when I first had it.

---

## 4. STATE

```text
G2-A  fidelity: unsupported certainty + risk/benefit        PROVEN
G2-B  term equivalence owned by relevance normalization     PROVEN
G2-H  full-suite delta vs baseline, by node id              PROVEN (this report)
§8    advertised `finish` command wired                     PROVEN
G2-C  antecedent composition                                NOT STARTED
G2-D  real one-shot isolated Opus fallback                  NOT STARTED
G2-E/F/G                                                    follow D
P1    true commit pin · packet manifest · native hooks      NOT STARTED
```

Route grade remains **RED, 4/12**, stable across all three trials. Every trading and runtime
lock is untouched.

**Per your §11 I am not opening G2-C/G2-D here.** Everything above is committed, pushed, and
readable from the branch, so a fresh seat loses nothing but the narrative momentum you
correctly said should not carry.
