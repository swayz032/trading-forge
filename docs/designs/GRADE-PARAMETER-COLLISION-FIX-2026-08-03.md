# GRADE — AR-747 "THE PARAMETER COLLISION IS REAL, REPRODUCED, AND FIXED"

**Grader:** accuracy-validator (independent; doer != grader)
**Date:** 2026-08-03
**Mode:** ADVERSARIAL GRADE — dispatched to **REFUTE**, not to confirm.
**Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712`, branch `h1-wave4-sealed12-driver`
**Subject commit (pinned):** `f73d2726bcd7b01b44840e0d7033fed8e1c7c55b`

## VERDICT

| Axis | Band | Status | One line |
|---|---|---|---|
| **RED's authenticity** | **8/10** | `VERIFIED` | The refutation FAILED. The fixture did **not** manufacture the collision — I reproduced it with **zero patch on `_h_structure`**. |
| **Fix's sufficiency** | **6/10** | `VERIFIED` | Shape-correct, red-proofed both directions, reuse guard bites — but it **cannot produce a correct value** with the shipping evaluator, and ships 3 latent hazards. |
| **OVERALL** | **7/10** | `VERIFIED` | **PARTIALLY CONFIRMED.** Reproduced: yes. "Real": only as a *latent* channel defect. "Fixed": only the cache key, not the channel. |

**CLAIMED band:** AR-747 §8 requests `APPROVAL_REQUESTED` and does not self-assign a number (correct — the doer may not certify its own work).

### HEAD MOVED DURING THIS GRADE — declared
HEAD moved `f73d2726` → **`684cba21`** mid-grade. **All three graded blobs are byte-identical
to the pin** (`git hash-object` in the worktree == `git rev-parse f73d2726:<path>`):

| file | blob at `f73d2726` and in worktree |
|---|---|
| `src/engine/spec_family_bindings.py` | `31b9c17b834cb17f65f95a804fcef01844e0a8cd` |
| `src/engine/spec_condition_compiler.py` | `e93d26d0d9d12a775d951f91bb4f96972f69cc48` |
| `src/engine/tests/test_parameter_collision.py` | `ab334a25284192c15177b1f7af72d2a2557c2f4b` |

`src/engine/tests/test_session_role_adversarial_fence.py` **DID change** mid-grade
(`92d191fa` pinned → `d81e52c2` worktree — a sibling repaired the §6.2 env leak while I
worked). **Every §6.2 figure below is measured against the PINNED blob `92d191fa`.**
Dirty files recorded and left untouched: `test_synthetic_market_simulator.py`,
`test_session_role_adversarial_fence.py`, `AGENT-LOGS.md`, `docs/designs/AGENT-REPORTS.md`,
`docs/A12-AUDIT-REPORT.md`, `docs/wave25-exit-engine-ab-report.md`,
`docs/scaling-validation/cli-report-existence-test.md`, 2 replay-results JSON.

### LINEAGE — declared
I did not design, build, or previously grade AR-747, `ConditionBinding.parameters`, or
`_h_structure`. I **do** hold lineage on the adjacent surface: my 08-03
`parameter_channel_absence` grade measured `ConditionBinding` as *10 fields / 0 numeric* and
surfaced the live `indicator-params.ts` channel that AR-747's own docstring now cites. This
commit adds the 11th field — the direct successor to an absence I measured. My judgment that
"the channel is still severed at the evaluator" therefore re-measures my own prior territory.
**Re-derived here from current artifacts (P1, P6a), not recalled.**

---

## 1. THE LOAD-BEARING CLAIM — ATTACKED HARDEST, REFUTATION FAILED

> AR-747 §3: *"THE RED IS THE ENGINE'S, NOT MY PATCH'S — my monkeypatch WRAPS `_h_structure`
> and DELEGATES TO THE ORIGINAL, so the caching decision under test is production's,
> unmodified."*

**`MEASURED HERE` — CONFIRMED.** Three sub-questions, answered separately.

**(a) Does the wrapper genuinely delegate?** Yes, by reading the executable lines.
`original_handler = SpecConditionStrategy._h_structure` is captured at
`test_parameter_collision.py:112`, **before** `monkeypatch.setattr` at `:129`. The wrapper
body (`:114-120`) performs three assignments and `return original_handler(self, b, ctx)`.
No cache logic exists in the wrapper.

**(b) Does it alter the caching decision?** **No — and I proved it without trusting the read.**
I built a fixture that installs **no patch on `_h_structure` at all** (scratchpad
`av_path2_no_wrapper.py`). Only `_eval_wait_structure` is replaced, with a call-counter that
returns a *different* array per invocation — so "both conditions got the same array" becomes a
pure readout of production's caching decision with zero test code between binding and handler:

```
-- NO WRAPPER ON _h_structure ANYWHERE --
PRE-FIX  handler (parent 28a72de9 body), params set : 1 evaluation, IDENTICAL_ARRAYS=True
POST-FIX handler (committed f73d2726 body), params  : 2 evaluations, IDENTICAL_ARRAYS=False
POST-FIX handler, NO parameters (production today)  : 1 evaluation, IDENTICAL_ARRAYS=True
```

The collision appears pre-fix and vanishes post-fix **with no wrapper anywhere**. The fixture
did not manufacture the caching behaviour.

**(c) Would the collision occur without the wrapper, given a parameterized binding?**
**The cache-sharing: YES** (row 1 above). **The observable value divergence: NO** — and this is
the honest boundary the headline does not draw. See F-1.

**Second path — pre-fix reconstruction.** A pytest plugin (`av_prefix_plugin.py`) reinstalls the
parent commit's `_h_structure` body **in memory** (no worktree write), with an anchor assert
that refuses to run if the committed body is not the post-fix one. This rebuilds the exact tree
the doer red-proofed: `parameters` field present at `f73d2726`, handler at `28a72de9`. Name-level
verdicts, not counts:

| test | PRE-FIX | POST-FIX |
|---|---|---|
| `test_the_two_periods_actually_produce_different_signals` | PASSED | PASSED |
| `test_both_conditions_are_actually_dispatched` | PASSED | PASSED |
| `test_two_same_family_conditions_..._must_evaluate_differently` | **FAILED** | PASSED |
| `test_identical_periods_still_share_one_computation` | PASSED | PASSED |
| `test_reversing_condition_order_changes_the_shared_value` | **FAILED** | PASSED |

**The RED is authentic.** The two named REDs fail pre-fix and pass post-fix, by name.

---

## 2. DISCREPANCIES

### Discrepancy F-1: the fix cannot produce a correct value — "FIXED" overstates its scope
**Severity:** CRITICAL (claim-scope / silent disagreement between headline and docstring)
**Claim:** AR-747 headline — *"THE PARAMETER COLLISION IS REAL, REPRODUCED, AND FIXED."*
**Reality:** `MEASURED HERE`. Post-fix, with **production's real `_eval_wait_structure`** (no
evaluator patch), two conditions carrying `("period",10)` and `("period",200)`:

```
taught periods         : fast=10  slow=200  (DIFFERENT, carried in b.parameters)
real evaluator ran     : 2 time(s)      <-- was 1 before the fix
arrays IDENTICAL       : True
bars where they differ : 0 of 200
fast True-count / slow : 90 / 90
```

`_eval_wait_structure(n, df)` ignores parameters entirely, so the re-key converts **one
computation into N identical computations**. The correctness benefit exists *only* paired with
a parameter-consuming evaluator, which production does not have. Today all keys are `None`
(F-2 census) so the cost is zero; the moment a producer populates `parameters` **before** an
evaluator reads them, this change is a **pure performance regression with zero correctness
benefit** — N× the structure evaluation, same answer.
**Sources compared:** [headline "FIXED" | test docstring `:17-24`, which *is* correctly scoped
("the parameter-CONSUMING evaluator is supplied by monkeypatch, in this file only") | P1 runtime]
**Source of truth:** the runtime measurement and the test's own docstring. The headline is the
outlier — the source file is more honest than the report.
**Fix point:** `docs/designs/AGENT-REPORTS.md` AR-747 headline — restate as *"the parameter-losing
cache is re-keyed; the channel remains severed at the evaluator."* No code change required.
**Repro:** `python <scratchpad>/av_path3_sufficiency.py` (P1 block).
**Blast radius:** the desk's ordering decision. Reading "FIXED" as "a taught number now reaches
the evaluator correctly" would justify wiring a producer next — which would ship F-1's
regression. The correct next step is the *evaluator*, not a producer.

### Discrepancy F-2: the RED and the GREEN are not the same test population
**Severity:** HIGH (receipt integrity — unreconciled count)
**Claim:** AR-747 §3 `2 failed, 2 passed` → §4 `5 passed`, framed as *"'THE SAME UNCHANGED
COMMAND' IS LITERALLY TRUE."*
**Reality:** `MEASURED HERE`. `2 + 2 = 4`; the committed file holds **5** tests. My pre-fix
reconstruction over the committed file yields **`2 failed, 3 passed`**, not `2 failed, 2 passed`.
Corroborated independently: §3's verbatim block prints `[POSITIVE CONTROL]` and
`[EXECUTION WITNESS]` but **not** `[REUSE GUARD]` — under `-s` that print is unconditional, so
`test_identical_periods_still_share_one_computation` **was not in the RED run**. It was added
with the repair.
**Sources compared:** [§3 stated `2 failed, 2 passed` | committed file = 5 tests | my pre-fix run
= `2 failed, 3 passed` | absent `[REUSE GUARD]` line in §3]
**Source of truth:** my reconstruction. The command was identical; the **population was not**.
**Fix point:** AR-747 §3/§4 — state that the reuse guard was added with the repair and that the
pre-fix result over the final file is `2 failed, 3 passed`.
**Repro:** `python -m pytest src/engine/tests/test_parameter_collision.py -q -p no:cacheprovider -p av_prefix_plugin`
**Blast radius:** low in effect — I measured the added test **green in both states**, so the
RED→GREEN story survives. But it is an unreconciled count in the same sentence that claims
literal sameness, and the reuse guard's docstring assertion *"green before AND after the repair
by design"* was **never measured by the doer**. I measured it: `[REUSE GUARD] ... [10]` pre-fix.

### Discrepancy F-3: three live citations point at the wrong lines in the shipped file
**Severity:** MEDIUM (caption-is-a-claim; one instance ships inside production source)
**Claim:** AR-747 §5, `test_parameter_collision.py:30`, and `spec_condition_compiler.py:1140`
all cite **`:1215-1217`** as the flag-OFF `_eval_wait_structure(n, df)` call site.
**Reality:** `MEASURED HERE` (AST). At `f73d2726` there are exactly **2** `_eval_wait_structure`
call sites: line **531** (enforced) and line **1237** (flag-OFF ladder, guard at `:1235`).
Lines `1215-1217` sit inside the **WAIT_BIAS composition-bundle** block
(`if bias_result is None: bias_result = compute_bias_signal(...)`). These are the **parent
commit's** line numbers, stale by ~20 lines because the patch inserted 21 lines above them.
**Sources compared:** [§5 text `:1215-1217` | in-source comment `:1140` "(see :1215-1217)" |
test docstring `:30` | AST call-site census = `{531, 1237}` | `grep -n` = same 2 sites]
**Source of truth:** the AST census (two non-overlapping instruments agree).
**Fix point:** `src/engine/spec_condition_compiler.py:1140` — a production source comment
containing a wrong self-reference is the one that must be corrected at the emitter.
**Repro:** `sed -n '1213,1219p;1235,1238p' src/engine/spec_condition_compiler.py`
**Blast radius:** the next reader sent to "fix the flag-OFF twin" lands in the WAIT_BIAS block.

### Discrepancy F-4: "hashability preserved" is unenforced — a non-scalar value raises inside `_h_structure`
**Severity:** HIGH (latent; new surface, fails deep in `compute()` not at the boundary)
**Claim:** field docstring — *"The immutable shape keeps the invariant instead of spending it"*;
AR-747 §2 — *"hash(binding) WITH parameters set : ok"*.
**Reality:** `MEASURED HERE`. The annotation is `tuple[tuple[str, object], ...]` — `object`
admits lists, dicts and sets. Construction **succeeds**; the raise lands later:

| `parameters` | `hash(binding)` | `b.parameters not in cache` |
|---|---|---|
| `None` | OK | OK |
| `(("period",10),)` | OK | OK |
| `(("levels",[1,2]),)` | **TypeError: unhashable type: 'list'** | **TypeError: unhashable type: 'list'** |
| `(("cfg",{"a":1}),)` | **TypeError: unhashable type: 'dict'** | **TypeError** |
| `(("s",{1,2}),)` | **TypeError: unhashable type: 'set'** | **TypeError** |

The doer measured **one** value shape (a scalar int) and generalized to "hashability preserved".
`frozen=True` does not validate hashability at construction — a producer emitting
`{"levels": [4500, 4520]}` (an entirely natural taught parameter) constructs cleanly and then
crashes at `spec_condition_compiler.py:530` mid-`compute()`.
**Sources compared:** [docstring invariant claim | §2's one-shape measurement | my 5-shape probe]
**Source of truth:** the 5-shape probe.
**Fix point:** `src/engine/spec_family_bindings.py:794` — annotate
`tuple[tuple[str, Hashable], ...] | None` and add a `__post_init__` hash probe so the failure
lands at construction with the offending key named.
**Repro:** `python <scratchpad>/av_path3_sufficiency.py` (P4 block).
**Blast radius:** every future parameter producer. Exactly the "loaded trap, not an absent one"
class the docstring invokes R-679 §1 to avoid — one level up.

### Discrepancy F-5: `to_dict`'s "OMIT-WHEN-EMPTY" caption is false for the empty case
**Severity:** MEDIUM (latent; the caption invokes the very law it breaks)
**Claim:** `spec_family_bindings.py:833` — *"OMIT-WHEN-EMPTY. A binding with no parameters
serialises byte-identically to before this field existed."*
**Reality:** `MEASURED HERE`. The executable line is `if self.parameters is not None` — that is
**omit-when-None**, not omit-when-empty.

```
parameters=None            -> 10 keys, 'parameters' present=False   (byte-identical: True)
parameters=()              -> 11 keys, 'parameters' present=True, value={}   <-- emits {}
parameters=(("period",20),)-> 11 keys, value={'period': 20}
json byte-identity () vs None : False        () serialises as: null, "parameters": {}}
```

An extractor emitting `()` for "I found no parameters" — the natural encoding — adds
`"parameters": {}` to **every** binding. That is precisely the re-seal hazard the comment cites
AR-739 §1 to avoid.
**Source of truth:** the executable line + the runtime probe.
**Fix point:** `src/engine/spec_family_bindings.py:837` — either `if self.parameters:` or rename
the caption to OMIT-WHEN-NONE.
**Repro:** `python <scratchpad>/av_path3_sufficiency.py` (P5 block).

### Discrepancy F-6: cache-key equality is un-normalized (coercion, ordering, None-vs-empty)
**Severity:** LOW-MEDIUM (latent shape defect in the new key)
**Claim (brief's question 1):** *can two DIFFERENT taught parameter sets collide onto one key?*
**Reality:** `MEASURED HERE` — **yes, via Python `==`/`hash` coercion.** Live dict probes:

```
d[(("period",10),)] = "SMA(10) array"; (("period",10.0),) in d -> True, returns 'SMA(10) array'
d2[(("period",1),)] = "SMA(1) array" ; (("period",True),)  in d2 -> True, returns 'SMA(1) array'
int 0 vs bool False -> SAME CACHE SLOT: True
```

Harmless for integral periods (`10` and `10.0` mean the same MA). The shape matters once values
are heterogeneous — numpy scalars, bools, or any type whose `__eq__` conflates distinct meanings.
**Inverse direction, also measured:** `(("a",1),("b",2))` vs `(("b",2),("a",1))` are **distinct**
slots, and `None` vs `()` are **distinct** slots — same meaning, redundant recompute. There is no
`sorted()` / canonicalization on the key.
**Fix point:** `src/engine/spec_condition_compiler.py:528` — key on
`tuple(sorted((k, type(v).__name__, v) for k, v in (b.parameters or ())))`.
**Blast radius:** correctness only under heterogeneous value types; performance under
nondeterministic producer ordering.

### Discrepancy F-7 (INFO): `ctx["wait_structure"]` is now a write-only dead slot, and its comment names the wrong object
**Severity:** INFO
`MEASURED HERE`: after the patch, `ctx["wait_structure"]` has **one write** (`:1135`) and
**zero readers** — in this file or any other under `src/` (grep positive-controlled with
`last_per_condition_bool`, which *does* appear outside the file). AR-747 §7 discloses this and
leaves it deliberately; **confirmed harmless.** However the new comment at `:1137-1138` says the
slot *"the flag-OFF inline ladder still uses"* — the ladder uses the **local** `wait_structure`
(`:1236-1238`), never the ctx entry. One word wrong about which object is in play.

---

## 3. WHAT THE DOER GOT RIGHT — CONFIRMED INDEPENDENTLY

**C-1. "Behaviour is unchanged for every binding that exists today."** `MEASURED HERE`, two
populations, both positive-controlled.
*Path A — key census:* 36 real compiled specs → **366 bindings examined, cache-key distribution
`{'None': 366}`, 0 non-None.** Positive control: planted one parameterised binding into a real
compiled plan → detector fired on **1**.
*Path B — runtime reuse on real specs:* 15 sealed specs carrying **2 to 10** executed
WAIT_STRUCTURE/VERIFY_STRUCTURE spine conditions each. **Every one: exactly 1 evaluator call,
cache keys `{None}`, and all conditions received the same array object (`same-object=True`).**
The single shared entry is still computed exactly once. **CONFIRMED.**

**C-2. The reuse guard bites.** `MEASURED HERE` — law 5, every check owes a path to red. I
installed a shape-preserving **no-cache** `_h_structure` (the exact over-broad "fix" §4 says the
guard exists to catch), with an anchor assert against a silent no-op mutant:

```
[AV MUTANT] _h_structure replaced with a NO-CACHE body (always recompute).
[REUSE GUARD] evaluator invocations for two identical SMA(10) conditions: [10, 10]
E  AssertionError: ... the evaluator ran 2 times - the cache was removed rather than re-keyed
1 failed, 4 passed
CONTROL (no mutant): 5 passed
```
The guard is not decorative. **CONFIRMED.**

**C-3. `to_dict` omits when `None`, byte-identically.** `MEASURED HERE` — 10 keys, `parameters`
absent, JSON byte-identical to the pre-field baseline. **CONFIRMED** (the `()` case is F-5).

**C-4. "It cannot reach a sealed artifact."** `MEASURED HERE` — **deep**, not top-level. All 18
`*.spec.json` walked to max nesting depth 4, 34 distinct keys total: `parameters`, `bindings`,
`invalidation_bindings`, `condition_id`, `bindable`, `session_zone`, `primitive` all present in
**0/18**. Positive control: injected a binding blob at depth 2 of a real artifact copy → detector
fired on **6/7** target keys. The absence is measured, not a dead detector. **CONFIRMED.**

**C-5. §5's flag-OFF claim.** `MEASURED HERE` at the executable line, two instruments agreeing
(AST census + `grep -n`): exactly **2** `_eval_wait_structure` call sites; the flag-OFF one is
`self._eval_wait_structure(n, df)` — **no binding argument**. **CONFIRMED** (line number is F-3).

**C-6. §6.2's env-leak root cause — CONFIRMED VERBATIM at the pinned blob.**
At `92d191fa`, `test_session_role_adversarial_fence.py`:
```
:823        os.environ["TF_SESSION_ROLE_RESOLVER_ENABLED"] = flag
:858    os.environ["TF_SESSION_ROLE_RESOLVER_ENABLED"] = "true"
:696/:748   monkeypatch.setenv / monkeypatch.delenv     <- the correct convention, same file
```
Bare assignments, no cleanup — exactly as §6.2 states, at exactly the lines it names.
**Reachable under pytest:** `_report()` (`:820`) is called by `test_emit_report` (`:868-871`),
not only by `__main__`. **`MEASURED HERE`.**

---

## 4. THE ORDER-DEPENDENCE CLAIM — INDEPENDENTLY VERIFIED AND QUANTIFIED

The brief ordered this verified rather than accepted. Forward/reverse experiment using the
**pinned** fence blob:

| arm | command | result |
|---|---|---|
| A | `test_spec_family_bindings.py` alone | **339 passed, 0 failed** |
| B | `fence_PINNED.py` **then** `test_spec_family_bindings.py` | **5 failed, 424 passed** |
| C | `test_spec_family_bindings.py` **then** `fence_PINNED.py` | **2 failed, 427 passed** |

**Within-experiment control:** 2 of B's 5 failures (`test_tuning_sources_are_actually_loaded`,
`test_corpus_is_disjoint_from_every_tuning_source`) belong to the fence file and fail in **both**
orders — they isolate the order-dependent set. The remaining **3**, all in
`test_spec_family_bindings.py`, flip on collection order alone:

- `test_wait_session_binds_on_recognized_keyword`
- `test_s1_flag_off_is_the_null_hypothesis_at_the_same_production_boundary`
- `test_s7_flag_off_byte_identity_over_the_full_26_row_population`

**AR-747 §6.2 named the count (3), the mechanism, the two lines, and one of the three tests by
name. All four specifics CONFIRMED.** `MEASURED HERE`.

**SCOPING, per the brief's standing order:** every figure in this grade comes from a
**single-file or explicitly-ordered** pytest invocation. I make **no whole-suite green claim**,
and none of my numbers depends on one.

---

## 5. THE DESK'S QUESTION — ANSWERED

> *At `:1215-1217`, is the `ConditionBinding` in scope at all?* (A refusal is about to be ordered
> there and its placement depends on this.)

**`MEASURED HERE` (AST) — YES, decisively. And the line is `:1237`, not `:1215-1217` (F-3).**

```
_eval_wait_structure call sites (AST, whole file): 2
  line 531 : self._eval_wait_structure(ctx['n'], ctx['df'])
  line 1237: self._eval_wait_structure(n, df)          <- the flag-OFF site

Flag-OFF call site line 1237. Enclosing for-loops: 1
  for b in spine_bindings:            (lines 1155-1255)
LOOP-BOUND NAMES LIVE AT THE CALL SITE: ['b']
>>> ConditionBinding in scope at the flag-OFF call site: True
Guarding test at line 1235: `b.type in ('WAIT_STRUCTURE', 'VERIFY_STRUCTURE')`
```

`b` is not merely in scope — it is **read on the branch guard one line above the call that drops
it**. A refusal, an assertion, or the binding pass-through can be placed at `:1237` with **zero
plumbing**: no signature change upstream, no new parameter threading. AR-747 §5's argument for
deferring is about *risk appetite on the shipping path*, not about reachability. The desk should
know the mechanical cost is one argument.

---

## 6. COVERAGE

### 6.1 What I verified, and via which two-plus non-overlapping paths
| Claim | Path A | Path B | Path C |
|---|---|---|---|
| Wrapper delegates / does not alter caching | line-by-line read of `:112-130` | **wrapper-free replication** (no `_h_structure` patch at all) | pre-fix reconstruction via in-memory plugin |
| RED is authentic | pre-fix handler reinstalled, name-level verdicts | wrapper-free PATH 2 (1 eval / identical arrays pre-fix) | — |
| Fix insufficiency (F-1) | production evaluator + call counter | array equality + per-bar diff count (0/200) | — |
| Every binding keys to `None` | 366-binding compiled census | 15 real sealed specs, runtime eval counter | same-object identity check |
| Flag-OFF site drops the binding | AST call-site census | `grep -n` census | enclosing-scope AST walk |
| `parameters` cannot reach a sealed artifact | deep key walk (depth 4) over 18 artifacts | top-level key count (7/7 on all 18) | — |
| §6.2 env leak | pinned-blob read at `:823`/`:858` | forward/reverse order experiment | reachability trace `_report`→`test_emit_report` |
| Reuse guard bites | shape-preserving no-cache mutant | anchor-assert against silent no-op | control run (5 passed) |

**Instrument independence:** I did not treat re-running the doer's pytest as a second path. The
committed-state `5 passed` run appears once, as a control for my mutants — never as evidence.

### 6.2 Positive-control witnesses, WITH VALUES
| Absence claimed | Control planted | Control's measured value |
|---|---|---|
| 0/366 bindings have non-`None` parameters | one `dataclasses.replace(..., parameters=(("period",999),))` into a real compiled plan | detector fired on **1** binding |
| 0/18 sealed artifacts contain binding content | binding blob injected at depth 2 of a real artifact copy | detector fired on **6/7** target keys |
| no external reader of `ctx["wait_structure"]` | same grep for `last_per_condition_bool` | **5** hits outside the file |
| reuse guard would catch cache deletion | no-cache `_h_structure` mutant | guard went **RED**, `[10, 10]` |
| pre-fix mutant actually landed | anchor assert on `inspect.getsource` | refuses to run unless `wait_structure_cache` present pre-mutation and absent post |
| 3 order-dependent failures are real | reversed collection order | **0** failures in arm C vs **3** in arm B |
| SMA(10) vs SMA(200) gates differ | the file's own control | **100 of 200** bars |

### 6.3 Join keys checked for every "identical / unchanged" claim
- **Blob OID** for all 4 subject files, worktree vs `f73d2726` — 3 identical, 1 (fence) **changed
  mid-grade and re-measured at the pin**. This is the join key that saved the grade: my first
  read of `§6.2` was against the *repaired* worktree file and would have published a false
  refutation of a correct finding.
- **Test node-id name**, not count, for every pre-fix/post-fix comparison.
- **`(spec artifact, condition_id)`** for the per-condition array comparisons.
- **Array object identity (`is`)**, not just `array_equal`, for "one shared entry".
- **Commit ancestry** (`merge-base --is-ancestor`) for the fence-file history.

### 6.4 What I did NOT verify
1. **No database, no SSE, no audit_log, no correlation_id trace.** Nothing in this change touches
   those hops; no P&L or sizing math is involved, so no first-principles reconciliation applies.
2. **The doer's `307 → 307` and `339` regression figures — not reproduced.** I measured `339
   passed` for `test_spec_family_bindings.py` alone, which corroborates one of them, but I did not
   rebuild the 18-file blast radius or the 10-file pinned set. My regression evidence is the
   366-binding census plus the 15 real-spec runtime check, which is a *different* and narrower
   claim than "no test moved".
3. **The other 8 cache carriers** named `[UNENUMERATED]` in AR-747 §7 — not examined. They are in
   the same latent state, and F-4/F-5/F-6 would apply to each if the same field is reused.
4. **Whether any *future* producer would emit unhashable or `()` parameters** — F-4 and F-5 are
   MEASURED mechanisms on a currently-unreachable path. I state the mechanism, not a live incident.
5. **The composition-bundle interaction** (AR-747 §7, carried from R-678 §6) — untouched.
6. **`src/server/lib/indicator-params.ts`** — the TS-side shape the docstring says this field must
   eventually receive. Not re-measured this pass; I rely on my own 08-03 finding, which is
   `RELAYED` here, not `MEASURED HERE`.
7. **No whole-suite run of `src/engine/tests/`** — deliberately. A sibling is mutating
   `test_synthetic_market_simulator.py` and the suite is proven order-dependent (§4). Any suite
   figure would be uninterpretable.

---

## 7. RECOMMENDATION TO THE DESK

1. **Do not read "FIXED" as "the channel works."** F-1: the next correct step is the *evaluator*,
   not a parameter producer. Wiring a producer first ships an N× regression for zero benefit.
2. **The flag-OFF refusal is cheap — `b` is in scope at `:1237`** (§5). Order it if wanted; the
   argument against is risk appetite, not mechanics.
3. **Close F-4 before anything writes `parameters`** — `Hashable` annotation + `__post_init__`
   probe. It is a 3-line change and it converts a mid-`compute()` TypeError into a boundary error.
4. **Correct the three `:1215-1217` citations** (F-3), starting with the one inside
   `spec_condition_compiler.py:1140` — fix at the emitter, not in the report.
5. **F-2 and F-5 are caption corrections**, not code defects. Both belong in the AR/source, not
   in a new lane.
6. The doer's §6 self-convictions are **verified correct and were valuable** — §6.2 in particular
   is a genuine, precisely-reported finding that I confirmed on all four of its specifics.
