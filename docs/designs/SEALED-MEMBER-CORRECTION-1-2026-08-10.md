# SEALED-MEMBER-CORRECTION-1 — durable receipt

**Minted:** 2026-08-10 · **Authority:** `R-799 §3` (`R3-3` / `F-R2-3`), re-confirmed
`R-808 §9` · **Written by:** worker seat `claude.exe 23936` · **Tree:**
`wt-h1-wave4-20260712`, branch `h1-wave4-sealed12-driver` · **Repair commit:**
`216ecd90`

---

## 1. THE TWO NODE IDs THIS RECEIPT CORRECTS

Both are sealed members of the `S6` node-ID population and both are governed
members of `canonical_regression_population.txt` (via
`engine/tests/test_fix4_adaptive_symbol_dst.py`):

```
src/engine/tests/test_fix4_adaptive_symbol_dst.py::TestFix4SymbolFromSpec::test_backtester_source_does_not_contain_hardcoded_mes
src/engine/tests/test_fix4_adaptive_symbol_dst.py::TestFix4SymbolFromSpec::test_backtester_uses_dst_correct_helper
```

**Both node IDs are PRESERVED BYTE-FOR-BYTE.** Neither was renamed, moved between
classes, removed, or added. `[MEASURED, 216ecd90]`

---

## 2. THE CORRECTION — STATED AS `R-799 §3` REQUIRES

> **The pre-correction results of these two node IDs are NOT evidence about the
> worktree in which they executed.**

Before `216ecd90`, both test bodies read a hardcoded absolute path:

```
C:/Users/tonio/Projects/trading-forge/trading-forge/src/engine/backtester.py
```

That path is a **different checkout**. Every historical `PASS` these two node IDs
produced — in any worktree, in any acceptance run, under any seal — was an
assertion about **that** file, never about the `backtester.py` belonging to the
tree the test was executing in.

`[MEASURED HERE, 2026-08-10, before the repair]` the two files were not the same
bytes:

```
executing tree  (wt-h1-wave4-20260712)  459767 bytes  Aug  9 03:17
                sha256 c58c8901dd8eb2b25b4ac2f65a3eb729ba10ee55af985b20ad3189f6d2929bdc
OTHER checkout  (trading-forge/trading-forge)  456051 bytes  Jul 18 15:04
                sha256 4b1e967824db79d2f1b8ee209819c84a2939a717bb0d697eb0848d6871ae2847
```

⚠️ **AND THE HONEST PART, WHICH MAKES THIS WORSE RATHER THAN BETTER:**
`[MEASURED]` at the moment of repair, all four asserted tokens had **identical
counts in both files** — `"symbol not available on spec"` `0/0`,
`"_adaptive_symbol"` `2/2`, `"_dst_correct_et_hour"` `9/9`, `"FIX 4"` `5/5`. So
the historical greens were **not wrong in outcome**; they were **unearned**. The
two trees happened to agree on the four tokens being asserted. A green that is
correct by coincidence is indistinguishable from a green that is correct by
measurement, and only one of them keeps working.

★★★★★ `A NODE-ID SEAL PROVES A TEST IDENTITY EXISTED; IT PROVES NOTHING ABOUT
WHETHER THAT TEST'S BODY EVER MEASURED ANYTHING.` (`R-799`)

---

## 3. WHAT THIS RECEIPT IS **NOT** — the three refusals `R-799 §3` names

- 🛑 **The `S6` seal is NOT amended.** It is untouched by this repair.
- 🛑 **This is NOT an authorized member add/remove or disposition change.** The
  sealed population is the NODE-ID set; the node IDs are unchanged, so
  membership did not change at all. Neither test moved `PASS`→`SKIP` or
  `FAIL`→`PASS` as a disposition — both were `PASS` before and are `PASS` after.
- 🛑 **`S6` is NOT re-sealed.** Its opening-range compiler result does not depend
  on these DST/symbol assertions.

---

## 4. THE REPAIR

Both call sites now resolve through a single anchored helper:

```python
def _executing_tree_backtester_path() -> pathlib.Path:
    path = pathlib.Path(__file__).resolve().parents[1] / "backtester.py"
    assert path.is_file(), (...)
    return path
```

`parents[1]` is `<tree>/src/engine`, because the test file lives at
`<tree>/src/engine/tests/`. **No cwd assumptions · no home paths · no
project-name literals · no other-worktree paths.** `[MEASURED, 216ecd90]`
`C:/Users`, `trading-forge/trading-forge`, `os.getcwd`, `Path.cwd` and
`expanduser` all occur **0** times in the file.

One helper rather than two literals, so the two sites cannot drift apart again —
the class of defect, not just the instance.

---

## 5. CAUSALITY EVIDENCE — EACH ARM ALONE, WITH AN UNMUTATED CONTROL

`[MEASURED HERE, 2026-08-10, two disposable worktrees pinned to explicit SHAs:
`wt-r33-new` @ `216ecd90` (post-repair) and `wt-r33-old` @ `27d579e7`
(pre-repair); both destroyed after use]`

```
ARM 0  UNMUTATED CONTROL
  post-repair tree, pristine                    -> 2 passed
  pre-repair  tree, pristine                    -> 2 passed

CROSS-CHECKOUT POSITIVE CONTROL  (the arm that proves MEASURED == MEASURED-WHERE-IT-RUNS)
  OTHER checkout mutated so BOTH assertions would fail if read
  ('# symbol not available on spec' injected; _dst_correct_et_hour renamed)
  post-repair tree  -> 2 passed   UNCHANGED   <- no longer reads the other checkout
  pre-repair  tree  -> 2 FAILED               <- it WAS reading the other checkout

ARM A  rename _dst_correct_et_hour IN THE GRADED (EXECUTING) TREE
  test_backtester_uses_dst_correct_helper                -> FAILED
  test_backtester_source_does_not_contain_hardcoded_mes  -> PASSED

ARM B  restore the forbidden hardcoded-MES evidence IN THE GRADED TREE
  test_backtester_source_does_not_contain_hardcoded_mes  -> FAILED
  test_backtester_uses_dst_correct_helper                -> PASSED

ARM E  restored
  both                                          -> 2 passed
  graded-tree leak check (git status)           -> empty
```

⭐ **The cross-checkout pair is the decisive evidence, and it is a paired control
rather than a single observation: the SAME mutation, applied at the SAME moment
to the SAME file, flips the pre-repair tree RED and leaves the post-repair tree
GREEN.** That difference cannot be explained by anything except which file each
tree reads.

⭐ **Arms A and B each redden their OWN node ID and leave the other GREEN.** A
mutation that reddened both would have proven the tests are blunt, not aimed —
which is the `STOP [20]` failure mode (a test that reads the right file and
asserts nothing).

### `STOP [21]` — the other checkout was restored, and the proof is a pin, not a claim

```
OTHER checkout sha256 PIN (before) : 4b1e967824db79d2f1b8ee209819c84a2939a717bb0d697eb0848d6871ae2847
OTHER checkout sha256 NOW  (after) : 4b1e967824db79d2f1b8ee209819c84a2939a717bb0d697eb0848d6871ae2847
RESTORE: VERIFIED IDENTICAL
```

The restore ran from a `trap` on shell EXIT, so it would have fired even if an
arm had died mid-battery. `[ps-counting-encoding]` — a printed `restore: OK` is
worth nothing without the recomputed hash beside it.

---

## 6. WHAT THIS RECEIPT DOES NOT COVER

- ⚠️ **`ACCEPT5-LATENT-OTHER-CHECKOUT-3` is NOT discharged here.** Three other
  files / six other sites carry the same defect class and remain **banked** by
  `R-801 §2` with `WAKE: R3 closes`. `R3` is five items and may not become six
  (`R-800 §7`). This receipt covers **only** the two node IDs named in `§1`.
- ⚠️ **No claim is made about any historical acceptance verdict being wrong.**
  `§2` states the correct and narrower thing: those results were not *evidence*
  about their executing worktree. Re-deriving which past runs would have differed
  is not attempted and is not claimed.
- ⚠️ **This receipt is the doer's record, not a grade.** `doer ≠ grader`.
