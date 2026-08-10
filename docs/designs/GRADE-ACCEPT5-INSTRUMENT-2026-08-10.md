# GRADE — `ACCEPT5-INSTRUMENT-1` @ `9b62c4398219d2fa72f50c4372ba90fda3db14ba`

**Grader:** accuracy-validator (independent; `doer != grader`).
**Date:** 2026-08-10.
**Pin graded:** `9b62c4398219d2fa72f50c4372ba90fda3db14ba` ("ACCEPT5 class closure (R-792 §5)").
Doc commit `5bb98fd9` was NOT graded (prose, per charter).
**Worktree:** `C:/Users/tonio/Projects/wt-grade-accept5-20260810` (detached at the pin, created by me,
isolated from the live campaign tree `wt-h1-wave4-20260712`). No write reached the campaign tree.
**Lineage declaration:** I did not design, build, or previously grade this instrument. No prior
ACCEPT5-instrument grade of mine exists in this lineage.

**COMPLETE-AS-OF:** this file is complete at the line `END OF RECEIPT`. If that marker is absent, the
desk banked a partial write (prior incident: a receipt committed at 496 of 596 lines).

---

## VERDICT

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| `ACCEPT5-INSTRUMENT-1` @ `9b62c439` | **7** | **VERIFIED** | 2 pristine full runs (identical totals, both exit 0); 11 refusal arms bite in isolation each with its own clean control; AST class-closure enumeration self-tested on 4 arms; 2 independent feeders reconciled by membership | **1 CRITICAL + 2 HIGH open** — F-1 feeder collection-membership blindness, F-2 unanchored baseline, F-3 PASS→SKIP / xfail silencing |

**Result: `PASS_WITH_BOUNDED_FINDINGS`.**

**The CLAIM AS WRITTEN IS REFUTED at three clauses.** The instrument is nonetheless a genuine advance
and the S6 acceptance result it reports today is corroborated. Band 7, not 8, because a CRITICAL
false-green channel is open on a clause the claim asserts explicitly; band 9 is unreachable with any
open HIGH.

### Claim-by-clause adjudication

| Clause of the verbatim claim | Verdict |
|---|---|
| refuses any NEW failure not in the baseline | **CONFIRMED** [MEASURED HERE] |
| refuses any UNAUTHORIZED GONE | **CONFIRMED** [MEASURED HERE] |
| refuses any MISSING AUTHORIZED GONE | **CONFIRMED** [MEASURED HERE] |
| refuses any sealed-collection member that stops being collected | **REFUTED IN PART** — holds when the plugin feeder is honest; fails when the honest feeder (junit) is the one that knows (F-1) |
| refuses **any** disagreement between its two independent result feeders | **REFUTED** — failure-membership and collection-SIZE disagreement refuse; collection-MEMBERSHIP disagreement does not (F-1) |
| refuses any seal corruption **including an internally-consistent forgery** | **CONFIRMED** [MEASURED HERE] — G2 refused by the out-of-band pinned hash |
| **"It PASSES only on the true S6 state"** | **REFUTED** — three independently demonstrated non-S6 states PASS (F-1, F-2, F-3) |

---

## WHAT HELD (charter items, each measured)

Pristine, unmutated, full population — run TWICE, independently:

```
NOTE: [4] collected/executed/failed/skip/xfail : 2392/2392/31/5/2
[SELF-CHECK] independent feeder (junitxml) cases=2392 failures=31
[7/8] NEW failures : 0   UNAUTHORIZED GONE : 0   MISSING AUTHORIZED GONE : 0
[SEAL] preflight problems : 0   sealed members no longer collected : 0
ACCEPTANCE: PASS      exit 0
```

Both runs identical. **First-principles reconciliation:** baseline `n_failed` 33 − 2 authorized
`ordered_6b_reds` = 31 = measured failures. RECONCILES [MEASURED HERE].

**Charter 2 — every named arm bites ALONE, each with its own pristine control re-scored in its own
directory (control PASS in all 11), each naming its own refusal string:**

| Arm | Verdict | Exact refusal string emitted |
|---|---|---|
| A NEW failure | REFUSED (1) | `1 NEW failure(s) not in the baseline.` |
| B UNAUTHORIZED GONE | REFUSED (1) | `UNAUTHORIZED GONE: 1 baseline failure(s) stopped failing without authorization. Only the 2 ordered_6b_reds may leave the failure set.` |
| C MISSING AUTHORIZED GONE | REFUSED (1) | `MISSING AUTHORIZED GONE: 1 authorized ordered_6b_red(s) did NOT leave the failure set. The S6 result requires GONE to EQUAL the authorized set, not merely be contained in it.` |
| E sealed member uncollected | REFUSED (1) | `SEALED COLLECTION MEMBER MISSING: 1 test(s) that were collected at the sealed commit are no longer collected.` |
| **G2 forged seal (node removed, count corrected, digest RECOMPUTED)** | REFUSED (1) | `SEAL INTEGRITY FAILURE: the sealed population does not match the approved hash pinned in this runner. A seal that recomputes its own digest cannot authorize itself.` |
| G1 wrong `graded_sha` | REFUSED (1) | `... graded_sha '111…' is not the approved sealed commit '08062e12…'.` |
| G3 vacuous (empty) seal | REFUSED (1) | `... collected_population is missing or empty — an empty seal would silently authorize every future run.` |
| G4 no seal supplied | REFUSED (1) | `NO SEALED COLLECTION SUPPLIED: --seal is required.` |
| G5 no junit supplied | REFUSED (1) | `SELF-CHECK IMPOSSIBLE: no junitxml second feeder supplied` |
| G6 naive forgery (count fixed, digest NOT recomputed) | REFUSED (1) | both the self-consistency and the pinned-hash refusals fire |

**Charter 4 — parametrized node IDs:** 612 parametrized node IDs in the live population; **612/612**
reconstructed byte-identically by `_junit_nodeid` from `classname`+`name` [MEASURED HERE].

**Charter 7 — junit reconstruction join key:** 950 class-nested node IDs, **950/950** identical. The
lossy-join hazard is **live in this population**: 2 distinct `(file, final-name)` pairs collide —
`test_walk_forward_wrc_spa_emission.py::test_wrc_spa_values_present_when_sufficient_obs` and
`test_walk_forward_slippage_survival.py::test_slippage_survival_wired_from_aggregate_trades` — and the
current exact-identity reconstruction separates them correctly. The docstring's account of the old −2
delta is CORROBORATED by independent re-measurement.

**Charter 5 — collection errors:** a planted `ModuleNotFoundError` interrupts the whole session
(`pytest_exitstatus: 2`) and refuses on **three independent grounds** (feeder size disagreement,
feeder failure-membership disagreement, collected-but-unexecuted-without-disposition) [MEASURED HERE].
Setup errors are captured by the plugin's `when == "setup" and outcome != "passed"` branch.

**Charter 9 — immutable baseline unchanged:** newest commit touching
`acceptance-baseline-2026-08-09.json` is `186f22cd`, and the blob hash is identical at HEAD and at
`186f22cd` (`b71c164147201f7a42dcd1899402a56ae19a6f32`). Two paths: `git log --` and `git rev-parse
<rev>:<path>`.

**Charter 10 — seal anchor:** `graded_sha` = `08062e12b3e2b59d44eada150c8d8b8653796c90` and the
recomputed sorted-population digest = `63d4b541caf7f0ade8628ac9e2f737ff6f7fdaeec3e12ea653b433e376b2c9b9`,
both matching the constants at `scripts/acceptance_runner.py:67-68`. The artifact contains **0**
occurrences of those constant names — structurally outside. Behaviourally proven by G1/G2.
*Bounded:* "out-of-band" here means *outside the artifact*, not outside the repo — one commit still
changes both.

**Charter 8 — the class-closure claim, independently re-derived.** I did NOT count prints. I parsed
the AST and classified each `print(` as NOTE:-prefixed / coupled to a refusal / pure separator /
the verdict itself. My first tool had two of its own defects (span-only coupling → 11 false positives;
line-number dead-store comparison → a FALSE NULL on exactly the shape I was hunting). I corrected it
and required a 4-arm self-test — 3 plants that must fire, 2 negative controls that must not — to pass
**before any emission**.

Result: **40 `print(` calls; 11 NOTE:-prefixed, 28 coupled to a refusal, 6 carrying no judgement, and
the 2 residual are the final verdict lines themselves.** **The worker's print-level claim SURVIVES my
independent enumeration.** That is a confirmation, not a refutation — see F-4 for why it does not
close the class.

---

## DISCREPANCIES

### Discrepancy F-1: the two feeders are never compared on collection membership — the honest feeder's own answer is computed and discarded
**Severity:** CRITICAL (false positive / silent disagreement)
**Claim:** "REFUSES on ... any disagreement between its two independent result feeders" and "any
sealed-collection member that stops being collected" and "PASSES only on the true S6 state."
**Reality:** the self-check compares **failure membership** and **collection SIZE**. It never compares
**collection membership**. A sealed test that genuinely leaves collection PASSES if the plugin record
still lists it and the size happens to match.

The runner builds the honest answer and throws it away:

```python
j_cases, j_failures = read_junit(Path(run_xml))
n_junit_cases = len(j_cases)
j_cases = set(j_cases)          # <-- acceptance_runner.py:264 — NEVER READ AGAIN
```

**Sources compared:** [plugin `collected`: 2392, contains the sealed test | junit cases: 2392, does
NOT contain it | seal: contains it]
**Source of truth:** junit — it is the feeder produced by pytest itself, and the plugin record is the
one the self-check exists to distrust ("the arm that catches a corrupted result feeder").
**Measured:** `sealed_pop − collected(PLUGIN) = 0` → no refusal. `sealed_pop − collected(JUNIT) = 1`
→ would have refused. Gate exit **0, ACCEPTANCE: PASS**.
**Aggravating:** the runner prints `feeders AGREE on membership and size`. That caption is FALSE in
this state — the feeders disagree on collection membership. A caption is a claim.
The PASS caption also asserts `sealed collection intact`, which is false here.
**Fix point:** `scripts/acceptance_runner.py:264` — replace the dead store with
`only_j = j_cases - collected; only_p = collected - j_cases` and gate on both; then use
`collected & j_cases` (or junit) for the seal check. Two lines.
**Repro:** `python C:/Users/tonio/AppData/Local/Temp/.../scratchpad/arms.py N1_novel_feeder_swap`
(rename one sealed test's `name=` in the junit only; leave the plugin record alone).
**Blast radius:** the seal — the ONLY guard for previously-GREEN tests (F-ACCEPT5-2's whole purpose) —
is fed exclusively by the feeder the design distrusts. Every S6 acceptance decision inherits this.

*Reachability, measured honestly:* the plugin's `collected` is the **PRE-DESELECTION** item list —
a `--deselect`ed test is still recorded as collected [MEASURED HERE: 12 collected / 11 executed /
11 junit cases]. In isolation that is caught twice (size delta, and check (6) undisposed), because a
plugin-only member is necessarily unexecuted. So F-1's realistic trigger is a **wrong or mismatched
plugin record**, not deselection alone — which is precisely the threat model the self-check names, and
is made reachable by ordinary operator error via F-5.

### Discrepancy F-2: the baseline — the artifact that DEFINES what counts as NEW — has no integrity anchor, while the seal has one
**Severity:** HIGH (false positive)
**Claim:** "It PASSES only on the true S6 state."
**Reality:** a REAL new failure is laundered by editing the baseline's `failures` list. The runner
applies no hash pin, no `measured_at_sha` check, and no git check to the baseline.
**Sources compared:** [plugin failures: 32, includes the regression | junit failures: 32, includes it |
baseline: 34, edited to include it | runner: `NEW failures : 0`]
**Source of truth:** git — the committed baseline is `n_failed: 33`, blob `b71c1641`.
**Measured:** gate exit **0, ACCEPTANCE: PASS**, with `measured_at_sha` set to an obviously bogus
`deadbeef…` value that the runner reads at `:133` and never uses.
**Fix point:** `scripts/acceptance_runner.py:133` — `measured_at_sha` is already in hand; pin it (and a
baseline digest) beside `SEAL_APPROVED_*` at `:67-68`. Roughly three lines.
**Repro:** `arms.py N2_novel_baseline_forge`.
**Blast radius:** every NEW/GONE verdict.
**Mitigation, stated fairly:** the campaign's actual control for this is out-of-band git history
(charter item 9), and I verified it HOLDS TODAY — the baseline is byte-identical to `186f22cd`. So
this is a defense-in-depth gap and an asymmetry, not a live corruption. It matters because the claim
asserts the gate itself passes only on the true state, and because the seal received exactly this
protection in the same commit while the baseline did not.

### Discrepancy F-3: PASS → SKIP is STILL invisible, and a regression hidden behind `xfail` is too
**Severity:** HIGH (parity gap)
**Claim:** "PASSES only on the true S6 state."
**Reality:** measured on a **REAL code mutation and a REAL full-population run**, not a record edit.
I added one line — `@pytest.mark.skip(...)` — to a previously-GREEN sealed test
(`src/engine/tests/test_bias_parameter_transmission.py::test_absent_parameters_take_the_documented_default`)
and ran the whole population.

```
NOTE: [4] collected/executed/failed/skip/xfail : 2392/2392/31/6/2   <- skip 5 -> 6, the ONLY trace
[5] baseline-named tests missing from COLLECTION : 0
[6] collected-but-unexecuted : 0 (without allowed disposition: 0)
[7/8] NEW : 0   UNAUTHORIZED GONE : 0   MISSING AUTHORIZED GONE : 0
[SEAL] sealed members no longer collected : 0
ACCEPTANCE: PASS      exit 0
```

The victim is described in-suite as the **positive control** for the neighbouring refusal tests
("Without this the refusal tests are also satisfied by an always-raising path"), so silencing it is a
real loss of discriminating power, not a cosmetic one.

The same hole covers `xfail` [MEASURED HERE on a probe module]: a test whose body is `assert False`
carrying `@pytest.mark.xfail` is recorded `xfailed`, never enters the failure set, stays collected,
and carries an "allowed disposition" — both feeders agree. `strict=True` xpass IS correctly caught as
a failure.
**Source of truth:** the disposition counts. The baseline records `totals_at_baseline.skipped = 3`;
the live population measures 5; nothing compares them, because `base["totals"]` is read at
`acceptance_runner.py:134` and never used.
**Fix point:** `:134` — gate skip/xfail membership (not counts) against a pinned disposition set.
**Repro:** add `@pytest.mark.skip` to any green sealed test; `python scripts/acceptance_runner.py --run`.
**Blast radius:** coverage can be silently retired to zero, one mark at a time, at a permanent
`ACCEPTANCE: PASS`.
**Prior art:** the campaign already recorded this as `F-3` and ordered it become a permanent guard.
**It is still live at this pin** — that is the load-bearing fact here, and it is why I re-measured it
instead of citing the record.

### Discrepancy F-4: the CLASS is not closed — a `print(`-only enumeration is structurally blind to the stronger form of the same defect
**Severity:** MEDIUM (schema drift / method gap)
**Claim (commit message):** "THE CLASS: compute a judgement, print it, never gate on it. Every print
now gates or is prefixed NOTE:."
**Reality:** the print-level rule HOLDS (I verified it independently — 40 prints, all accounted for).
But the class as the commit itself states it is *compute a judgement and never gate on it*, and a
value computed and **never even printed** is a strictly stronger instance that a print-enumeration
cannot see. Live instances at this pin:

| Value | Site | Status |
|---|---|---|
| `j_cases` (junit collection membership) | `:264` | computed, discarded → **F-1** |
| `base["measured_at_sha"]` | `:133` | lifted off disk, never read → **F-2** |
| `base["totals"]` (incl. `skipped: 3`) | `:134` | lifted off disk, never read → **F-3** |
| `seal["manifest_sha256"]`, `seal["manifest_members"]` | seal artifact | never read — **arm N3: falsify both to `0`*64 / 999 and the gate still PASSES** [MEASURED HERE] |
| `rec["pytest_exitstatus"]` | `:255` | printed as `NOTE:`, never gated |
| `rec["xpassed"]` | plugin record | never read by the runner |
| POPULATION DRIFT | `:229` | appended to `notes`, printed, never gates → **F-6** |

**Source of truth:** AST dead-store analysis with statement ordering, self-tested on 3 plants + 2
negative controls.
**Fix point:** the method, not a line — the closure argument must enumerate *unconsumed computed
values*, not `print(` calls. Note the worker's own remediation of the `:318` block (compute → print →
now labelled `NOTE:`) **relabels** the judgement rather than making it bite; the judgement it computes
(`MISSING AUTHORIZED GONE`) is separately gated above, so that instance is genuinely closed, but the
pattern of closing-by-labelling is what leaves the seven rows above.

### Discrepancy F-5: no join key binds the two feeder artifacts to the same run
**Severity:** MEDIUM (parity gap)
**Reality:** `--from-run A --junit B` accepts any pair. `run.json` carries no run id, no timestamp, no
correlation key (only `cwd`/`python`/`platform`/`pytest_exitstatus`); the junit carries a
`timestamp="2026-08-10T10:10:07…"` that the runner never reads. Nothing detects a stale plugin record
paired with a fresh junit.
**Fix point:** emit a run UUID from the plugin, echo it into the junit path or a sidecar, and refuse on
mismatch.
**Blast radius:** turns F-1 from "requires a corrupted feeder" into "requires re-scoring the wrong
pair of files" — an ordinary operator error on the documented scoring path.

### Discrepancy F-6: the gate PASSES while its own output says the comparison is cross-population
**Severity:** LOW
**Reality:** the live manifest has **105** members; the baseline pins **103**. The runner emits
`NOTE: POPULATION DRIFT: … Failure membership is being compared across DIFFERENT populations` and
then PASSES. This is present in BOTH pristine runs and in the accepted S6 result.
**Fix point:** `:228-233` — decide whether drift is acceptable and either gate it or pin the delta by
member name. A NOTE that says "your comparison may not mean what you think" should not ride under a
green verdict unexamined.

### Discrepancy F-7: the plugin records the pre-deselection item list
**Severity:** LOW (latent)
**Reality:** `pytest_collection_modifyitems` records `items` before `-k`/`-m`/`--deselect` filtering
[MEASURED HERE: 12 collected / 11 executed / 11 junit cases under `--deselect`]. So `collected` means
"items pytest considered", not "tests pytest kept". Today this is caught by check (6) and the size
check. It is recorded because the **seal check — the collection guard — consumes exactly this list.**

---

## MANDATORY COVERAGE SECTION

### 1. What I verified, and via which two-plus non-overlapping paths

| Claim | Path A | Path B |
|---|---|---|
| Pristine state PASSES | full population run #1 (exit 0) | full population run #2, independent invocation, identical totals 2392/2392/31/5/2 |
| S6 arithmetic is real | runner output `NEW=0 / GONE=2` | first-principles: baseline 33 − 2 authorized = 31 = measured failures |
| Seal is anchored out-of-band | read the constants at `acceptance_runner.py:67-68`; 0 occurrences in the artifact | behavioural: G1 (wrong sha) and G2 (recomputed digest) both REFUSED |
| Seal digest is honest | recomputed sha256 over sorted population == stored == pinned | G6 (naive forgery) refused by BOTH the self-consistency and the pinned check |
| Baseline unchanged | `git log --` newest commit = `186f22cd` | `git rev-parse HEAD:<path>` == `git rev-parse 186f22cd:<path>` == `b71c1641…` |
| junit reconstruction is exact | 612/612 parametrized + 950/950 class-nested reconstruct identically | set difference plugin↔junit collection membership = 0 both directions on the pristine run |
| Print-level class closure | AST enumeration (40 prints) with a 4-arm self-test | manual read of each of the 20 v1-flagged sites against the source |
| `j_cases` is dead | AST dead-store detector (statement-ordered) | literal grep: 3 textual references, none after `:264` |
| F-1 is a real false green | arms harness → exit 0 / ACCEPTANCE: PASS | direct set arithmetic: `sealed − plugin = 0` vs `sealed − junit = 1` |
| F-3 is a real false green | REAL code mutation + REAL full-population run → exit 0 | disposition probe module reproducing the skip AND xfail mechanics in both feeders |

### 2. Positive-control witnesses for every absence claim

- "The gate does not refuse X" (F-1, F-2, F-3, N3) — each arm ran in a fresh directory where the
  **unmutated control was re-scored first and PASSED**, so the PASS is attributable to the mutation and
  not to a broken harness. Controls: 12/12 PASS.
- "Every print gates or is NOTE:" — my enumerator **refuses to emit** unless a planted non-gating
  judgement print goes RED, a planted dead store goes RED, a planted self-consuming rebind goes RED,
  **and** a genuinely-gating print + a genuinely-live store stay GREEN. All 5 controls correct.
- "No dead stores" (v1's answer) — **falsified by my own control**: v1 could not fire on `x = set(x)`,
  the exact shape present. I treat v1's "0" as a FALSE NULL, not a result.
- "The instrument catches collection loss" — arm E (sealed member removed from BOTH feeders) REFUSED,
  proving the seal check has a path to red before I claimed F-1 evades it.
- My hardcoded first victim node ID did not exist; my own assertion caught it before any measurement
  was reported. Fixed by enumerating real green sealed tests from the pristine record.

### 3. Join keys checked for every "identical / unchanged / matches" claim

- Baseline unchanged → **git blob SHA** `b71c164147201f7a42dcd1899402a56ae19a6f32`, compared at two revs.
- Seal identity → `graded_sha` string equality against the runner constant; population identity →
  sha256 over `"\n".join(sorted(pop))`.
- Feeder agreement → **exact pytest node ID** (`file::Class::name[param]`), both directions, not counts.
- Manifest ↔ seal → `manifest_sha256` recomputed from bytes (`2c728e35…`) — matches, though **the
  runner never checks it** (F-4/N3).
- Pristine repeatability → the full disposition tuple `2392/2392/31/5/2`, not just the verdict.
- Sealed vs collected → set difference in BOTH directions (0 and 0), not `len()`.

### 4. What I did NOT verify

- **The correctness of the 31 residual failures.** I verified membership identity against the baseline;
  I did not read a single failing test to confirm it *should* fail. Out of charter.
- **`generate_collection_seal.py` end-to-end.** I verified its OUTPUT (digests recompute, `graded_sha`
  resolves to a real commit, manifest digest matches) but did NOT re-run it against a worktree pinned at
  `08062e12` to confirm the sealed population is reproducible from that tree. **The seal's 2392 members
  are therefore single-source: I checked internal consistency and the out-of-band pin, not independent
  regeneration.** Per desk rule that is "single-source truth" and should be closed by one regeneration run.
- **Whether the S6 code change itself is correct.** I graded the *gate*, not S6. A gate that correctly
  reports a wrong state is out of scope here.
- **Cross-platform behaviour.** Everything measured on Windows / Python 3.13.0 / pytest 9.0.3. The junit
  reconstruction leans on `classname` having no `file` attribute; a pytest upgrade that emits `file=`
  takes the other branch of `_junit_nodeid`, which I did NOT exercise.
- **Concurrency.** I did not test two runners against one out-dir, or the `--run` path under a dirty tree.
- **The `--run` subprocess return code.** `subprocess.run(cmd, cwd=REPO)` at `:244` discards its exit
  status; I observed a missing-artifact case would raise rather than pass, but I did not exhaustively
  enumerate pytest exit codes 3/4/5 through the full gate.
- **`docs/wave25-exit-engine-ab-report.md`** was rewritten by each population run, as the brief warned;
  reverted, and `git status --porcelain` is empty at the time of writing. My grading worktree is clean
  apart from this receipt.
- **Anything about the live campaign tree.** I never wrote to `wt-h1-wave4-20260712`.

### Instrument log (my own errors, disclosed)

1. My v1 class-closure tool produced **11 false-positive print violations** (span-only coupling) and a
   **FALSE NULL on dead stores** (line-number comparison, blind to `x = set(x)` — the exact shape I was
   hunting). Both found by reading my output against the source. Corrected, then self-tested.
2. My first mutation victim was a node ID I invented rather than enumerated; my own assertion caught it.
3. My first PASS→SKIP plant did not land — the guard assertion fired before the write, so the run that
   followed was an unmodified-tree run. I detected it via `git status` and re-ran with the plant
   verified by `git diff` **before** launching. The stray run is reported above as the second pristine
   control rather than discarded.
4. I piped a pytest invocation through `tail`, so the shell's `PYTEST EXIT: 0` was `tail`'s status, not
   pytest's. The value I relied on came from the plugin's recorded `pytest_exitstatus: 2`. Flagging it
   because this desk has been convicted on piped exit codes before.
5. A refusal string containing an em-dash killed a print under cp1252; re-run under `PYTHONIOENCODING=utf-8`.

### Recommendation

Use the instrument — it is a real gate and it bites on every class the charter named. But:
1. **Narrow the claim.** Delete "any disagreement between its two independent result feeders" and
   "PASSES only on the true S6 state" until F-1 is fixed; both are refuted as written.
2. **Fix F-1** (two lines at `:264`). It is the cheapest CRITICAL I have seen on this campaign.
3. **Close F-3** — already ordered by the campaign, still open at this pin.
4. **Stop closing the class by labelling.** The closure argument must enumerate unconsumed computed
   values, not `print(` calls; four of the seven rows in F-4 are anchors already sitting in hand.

END OF RECEIPT
