# AR-1240 (WORKER) — G2-A, G2-B, AND THE REASON THE FULL SUITE NEVER FINISHED · 2026-08-16

```text
RULING : AR-1239 §3.1 (G2-A) · §4 (G2-B) · §8 (dead command) · §12 (regression receipt)
PIN    : branch claude/worker1-h1-20260815 · head 857b8f0d539983520d62de66eedba49d4c12f9fc
STOP   : none fired
NEXT   : G2-C (antecedent) and G2-D (real isolated fallback) — see §7 on session state
```

---

## 0. RETRACTIONS FIRST — YOUR §9 IS CORRECT ON BOTH COUNTS

```text
WITHDRAWN  AR-1237 table: "§10.10 invokes isolated Opus = MET"
           The code emits an escalation LIST. No isolated call is performed. A list of work
           to perform is not performance of that work. The row should have read UNRESOLVED.

WITHDRAWN  AR-1238 headline: "PROTECTION TOOLBOX ACTIVATED"
           Correct state: TOOLBOX_SOURCE_REACHABLE yes · MANUAL_ACTIVATOR yes ·
           NATIVE_HOOK_PROTECTION no · FULL TOOLBOX VALIDATED no.
```

Both bodies were honest; **the compression into `MET` and `ACTIVATED` is what outran the
evidence, exactly as you diagnosed.** Nothing in this report uses a strong word that its own
receipt does not carry at the same scope.

---

## 1. G2-A — UNSUPPORTED CERTAINTY / RISK-BENEFIT (§3.1)

**The gap, measured:** `source_fidelity_guard` fired its certainty leg only when the SOURCE
HEDGED. A condition asserting certainty against a source that is simply **silent** emitted
nothing at all. That is how `"confirms the FVG structure and minimizes entry risk"` survived
every gate through AR-1237.

Two new outcomes, **deliberately weaker than the existing one** and kept separate exactly as
§3.1 required — collapsing them would let source silence borrow a contradiction's authority:

```text
UNSUPPORTED_CERTAINTY      condition asserts certainty, evidence carries no clause-attached
                           support, no hedge needed to make the absence visible
UNSUPPORTED_RISK_BENEFIT   condition claims risk reduction / safety benefit with no
                           clause-attached support
CERTAINTY_INFLATION        UNCHANGED — still reserved for an explicitly hedged source
```

**The real row, through the repaired guard:**

```text
"Entering on the closure confirms the FVG structure and minimizes entry risk."
  -> UNSUPPORTED_CERTAINTY    | confirms
  -> UNSUPPORTED_RISK_BENEFIT | minimizes entry risk
```

All five of your named controls are committed, plus two of mine: the bare noun `risk` must
**not** fire the benefit leg (it appears in nearly every trading sentence, so a rule firing on
it would mean nothing), and a hedged source keeps the stronger verdict.

### 🛑 A LIMITATION FOUND WHILE WRITING CONTROL 4, PINNED RATHER THAN WIDENED

`_CLAUSE_SPLIT` breaks on `.!?;` and but/however/although/whereas/while — **not on commas.**
So an unrelated marker and a topic word joined by a comma land in ONE clause, and the
attachment screen reads that as support. My first control 4 failed for exactly this reason and
I initially mistook it for a detector bug.

**I did not widen the splitter.** That would change the verdict of every condition in the
library, and §3.1 authorized two new outcomes — not a re-cut of clause boundaries. It is
committed as a **pinned test that fails if the behaviour ever changes**, so the corpus gets
re-measured rather than silently re-graded.

### Against myself
My appended tests **redefined a `_kinds` helper the file already had**, breaking 16 existing
tests by name collision. I appended without reading the namespace I was appending into.

---

## 2. G2-B — TERM EQUIVALENCE NOW HAS THE OWNER YOU ASSIGNED (§4)

`term_equivalence.py`, consumed **only** by relevance tokenization. Two kinds, and only two:

```text
1. DETERMINISTIC TIMEFRAME MORPHOLOGY — a rule, not a lookup. It covers `7-minute` and
   `forty-five minute` without anyone having written them down.
2. EXPLICIT VERSIONED ABBREVIATIONS — 7 rows, each citing where it is established.
```

**Canonical tokens are ADDED, never substituted.** Normalization can raise a comparison between
texts naming the same concept; it cannot hide a term the gate was already matching on.

**All seven of your controls pass. The two that matter most:**

```text
the six AR-1223 disclaimer misgroundings  STILL FAIL   (they are also the conditions
                                                        normalization helps elsewhere, so this
                                                        is a real test of the boundary)
`imbalance` / `inefficiency` -> NOT equivalent to FVG   (traders call them the same thing;
                                                        they are not in the reviewed table, and
                                                        adding them would be grade-fixing)
```

The ownership boundary is asserted **mechanically**: a test opens `source_fidelity_guard` and
proves it does not import this seam.

### 🛑 A MEASURED CONSEQUENCE I AM NOT BURYING

Normalization raises the score of a condition **and its rivals**, and relevance is RELATIVE.
A near-tie can therefore flip:

```text
entry_sequence[2].action   RED_SOURCE_FIDELITY -> REFUSED_RELEVANCE
                           own 0.278 vs rival 0.297 — against its own sibling FVG condition
```

**I did not tune the margin to reverse it.** Both dispositions are non-accepting, so nothing
became wrongly ACCEPTED — the change is a label, not a safety property.

### THE SAFETY INVARIANT, MEASURED BEFORE AND AFTER BOTH REPAIRS

```text
ACCEPTED before G2-A/B : entry_sequence[0].action, entry_sequence[3].action,
                         stop.rationale, targets[0].rationale
ACCEPTED after  G2-A/B : IDENTICAL, same four
```

**Neither repair promoted anything.** Route grade stays RED, 4/12, stable across all 3 trials.

---

## 3. 🛑 §12 — THE FULL SUITE NEVER FINISHED BECAUSE ONE TEST HANGS FOREVER

**I told you twice it was "still running". That was wrong, and it was wrong because I never
checked.** Sampled properly:

```text
user CPU delta over 20s: 0 seconds
VERDICT: BLOCKED, not slow
```

Collection is fine (**9328 tests collected in 5.4s**), so this is not the known collection-hang
class. The blocking test, named:

```text
src/engine/tests/test_cloud_backend.py::TestIAEWatchdogRunner::test_raises_timeout_if_iae_hangs
reproduced in isolation: exit 124 (timed out)
committed 2026-06-28 in 4d13f353 — SEVEN WEEKS BEFORE THIS LANE. Not mine.
```

### The defect is real production code, and I proved it rather than read it

`quantum_mc._run_iae_with_watchdog` docstring promises *"TimeoutError: if IAE does not complete
within max_wait seconds."* It cannot deliver that:

```python
while not stop_event.is_set():      # stop_event is set ONLY when the thread FINISHES
    ...
    stop_event.wait(watchdog_interval)
t.join(timeout=max_wait)            # <- UNREACHABLE when the job hangs
raise TimeoutError(...)             # <- so is this
```

**`max_wait` never bounds the loop.** Run with a positive control:

```text
POSITIVE CONTROL  job COMPLETES -> returns 'finished' in 0.0s   (harness + function work)
THE DEFECT        job HANGS, max_wait=1 -> after 6.0s: no TimeoutError, still blocked
```

★ **A WATCHDOG THAT CANNOT BOUND A HANG IS NOT A WATCHDOG — and its own test proves it by
hanging.** The unit that exists to stop a hang is the unit that hangs the suite.

**NOT FIXED BY ME.** `quantum_mc` is challenger/quantum code, outside this lane, and AR-1239
authorized none of it. **Yours to assign.**

### With that ONE test deselected the suite runs

Past 64% and climbing at the time of writing, failures accumulating normally. **I quote no
delta number yet** — the run is incomplete, and per your §12 an incomplete run is INCOMPLETE,
never green. It follows in the next report, with the deselection named in the same sentence as
the number so the exclusion can never read as coverage.

---

## 4. §8 — THE ADVERTISED `finish` COMMAND IS NOW REAL

You were right that it was a dead command. Wired to the existing `claude-finish-check` rather
than deleted, because an advertised capability that does not exist is a false claim inside the
tool whose job is checking claims.

```text
scope.ok        : true
changed_paths   : 9, all recognised
out_of_scope    : []
verdict         : STOP — because the tree was dirty with this very fix
```

### THIRD FIELD-NAME MISS OF THIS SESSION, recorded as a pattern

```text
hardFailures     vs  hard_failures      (theater runner — printed a CLEAN GREEN)
allow_prefixes   vs  allowed_prefixes   (finish payload)
allowedPrefixes  vs  allowed_prefixes   (my own "fix" for the above)
```

Every one produced a **plausible** result rather than an obvious crash — one a false green, two
a tidy validation error I could easily have read as *"the finish tool is broken"* instead of
*"I passed the wrong key"*. ★ **The field name is where the lie hides after the code is right.**

---

## 5. AND A THIRD FINDING I CAUGHT BY READING MY OWN COMMIT

`docs/wave25-exit-engine-ab-report.md` appeared in a commit about wiring a toolbox command.

```text
the only change: Run date  2026-05-24 13:29 UTC -> 2026-08-16 06:15 UTC   (this session)
```

**A test in `src/engine/tests` REWRITES A COMMITTED DOCS ARTIFACT AS A SIDE EFFECT.** Nobody
edited it; my regression run regenerated it. So any worker running a full regression silently
dirties the tracked tree — and can sweep the result into an unrelated commit, which is what I
did, using `git add -A`, **the exact pattern the repo's debugging doctrine forbids after
incident `b6de45a`.** Backed out in its own commit. The commit message named one change and the
commit carried two; I found it by reading the file list rather than trusting the message.

---

## 6. NOT DONE, AND NOT CLAIMED

- **G2-C** (antecedent composition) and **G2-D** (the real one-shot isolated fallback with a
  pre-declared selection law and negative controls) — **not started.** D is the one your §3.3
  correctly says is still open, and I am not claiming any part of it.
- G2-E/F/G follow D. **G2-H** blocked on §3 above until the suite completes.
- P1 items beyond §8: the true commit-SHA pin, the packet-manifest interaction, native hook
  install — **not started.**
- Locks untouched: no compiler, PAPER, broker, live, or Worker-2 surface changed.

## 7. SESSION STATE — YOUR §11 IS THE RIGHT CALL

You wrote that after the bounded activation packet the next large Worker-1 reasoning lane
should start in a **fresh** Claude session, with durable state from the ruling and the
repository rather than narrative momentum. **I agree, and I am telling you where I am rather
than pushing on quietly:** this session has run long. Everything above is committed, pushed and
readable from the branch, and G2-C/G2-D are exactly the kind of work that deserves a cold seat
reading the ruling fresh.

**STOPPING for your grade, with the regression delta owed and named.**
