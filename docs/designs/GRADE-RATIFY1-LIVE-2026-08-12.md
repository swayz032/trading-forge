# GRADE — RATIFY-1 LIVE EXECUTION CERTIFICATION

**Date:** 2026-08-12
**Grader:** accuracy-validator (independent; doer != grader)
**Mode:** LIVE INDEPENDENT CERTIFICATION — I executed the runs. I am the observer
of the facts, not an auditor of a claim about them.

---

## GRADE TARGET

Live execution certification at **execution pin
`f4e9a9d2711d9bf132efcc4fcb1546da4fcaa060`**.

The claim certified is precisely this, and no more:

> Five sequential executions of the governed ACCEPT-5 population at pin
> `f4e9a9d2`, varying the file-order and node-order axes, produce **identical
> exact node->outcome maps over the full frozen population**, satisfy the
> required file/node ORDER relations per child, and each complete within the
> frozen 600s `[H]` ceiling on an externally-held clock.

This is a certification of **execution identity / order-independence**. It is
**NOT** a statement that the tree is healthy — see LIMITATIONS.

---

## DEMOTED INSTRUMENT

`scripts/ratify1_controls/g_order_identity.py` @ `1155e270` is **DEMOTED**.

**I did NOT import it, run it, read its exit code, or use its `REQUIRED_PROOFS`
set, its `VerifiedArm`, or any of its derivations to reach this verdict.**
`[MEASURED HERE]` My oracle (`parse.py`) imports exactly two repo modules —
`population_successor` (population authority) and `accept5_isolated_population`
(my launch plan) — plus stdlib. The comparator is absent from my evidence path.

Rationale accepted from R4: the root defect was SELF-ATTESTATION. Hashes cannot
prove a mutable artifact was never resealed, because artifact, receipt, manifest
and digest can all move together and remain internally perfect. The repair is not
a better hash — it is moving the trust boundary to an external observer. That is
this grade.

### Authority-use census — independently CORROBORATED

The brief relayed a worker census. `[RELAYED]` is not evidence, so I re-ran it
myself `[MEASURED HERE]`:

| Surface | `g_order_identity` refs | Positive control |
|---|---|---|
| `wt-h1-wave4-20260712` | **9** (8 docs/receipts + its own control harness) | `accept5_isolated_runner` = **13** files |
| `trading-forge/trading-forge` (main) | **0** | tree greppable: 3514 tracked files |
| `runtime-production` | **0** | tree greppable: 3613 tracked files, 4 `package.json` |
| CI workflows, all 3 trees (**8** files) | **0** | `jobs:` matched **8/8** |

⚠️ **The runtime-production null is TRUE but VACUOUS as a statement about the
comparator specifically**: `git ls-files | grep -c accept5` = **0** there. The
entire ACCEPT-5 harness family is absent from that tree, so the comparator's
absence is a consequence of the family being absent — not evidence it was
deliberately excluded from a tree that otherwise uses the harness. Stated
honestly rather than counted as a clean null.

Conclusion `[MEASURED HERE]`: the comparator is **RATIFY-diagnostic only**;
demoting it removes nothing from `runtime-production` or CI.

---

## METHOD

### Worktree

My own exclusive detached worktree, never the worker's:

```
git -C C:\Users\tonio\Projects\wt-h1-wave4-20260712 worktree add \
    C:\Users\tonio\Projects\wt-gradelive-f4e9a9d2 \
    f4e9a9d2711d9bf132efcc4fcb1546da4fcaa060
```

`[MEASURED HERE]` `rev-parse HEAD` = the pin; `status --porcelain` = 0 lines at
creation. No `git stash` was used in any worktree (`refs/stash` is shared).

`[MEASURED HERE]` **The runner executes against MY tree**: `acceptance_runner.py:57`
is `REPO = Path(__file__).resolve().parents[1]` — derived from script location,
not hardcoded. (This campaign has previously been burned by a corpus path
hardcoded into another worktree, so this was checked, not assumed.)

### Launch + timing ownership `[H]`

A driver I wrote (`driver.py`) wraps **each arm** as:

```
grader time.monotonic() start
  -> subprocess.Popen(runner, ...)      # I record the child PID
  -> proc.wait()                        # that exact subprocess
grader time.monotonic() end
  -> persist grader-side elapsed, PID, exit code, pin before/after
```

The certification duration is **my wrapper's interval**. I did **NOT** use, and
do not need, `aggregate.wall_s`, the manifest timing witness, receipt
`elapsed_s`, or JUnit durations. Those may corroborate; they do not own the fact.

> The driver process is the external observer. My conversational turn ending
> mid-arm does not interrupt the driver's monotonic clock — the interval is
> live-measured by a running process, never reconstructed from an artifact.

Arms were launched **strictly sequentially inside one driver process**; no two
arms ever overlapped (proven below). No `--limit`. Artifacts written **outside
the repo**, to scratch.

### Outcome derivation (the oracle)

`[MEASURED HERE]` Outcomes derived **solely from pytest's own
`acceptance-run.xml`** (JUnit). The plugin record `acceptance-run.json`,
`aggregate.json`, `manifest.json` and `receipts/*.json` were **never read** by
the oracle.

JUnit carries `classname`/`name` with **no `file` attribute**, so nodeid recovery
is by **forward** map from the population authority (unambiguous), then inverted:

```
nodeid "a/b/c.py::Cls::Sub::test[p]"
  -> classname "a.b.c.Cls.Sub", name "test[p]"
```

`[MEASURED HERE]` **0 key collisions across all 2419 nodeids**, and 0 unmapped
testcases in every arm — so the inversion is total and lossless.

Outcome classification: `<failure>`->failed, `<error>`->error,
`<skipped type~xfail>`->xfailed, other `<skipped>`->skipped, no child->passed.

### Order witnesses (independent of runner bookkeeping)

- **Node order** = JUnit `<testcase>` document order.
- **File order** = each child's own `testsuite@timestamp`, **not** the runner's
  `ordinal` field. ⚠️ Ties would let a name-based tie-break FABRICATE a canonical
  order (making SAME falsely pass and REVERSE falsely fail), so ties are detected
  and reported: `[MEASURED HERE]` **0 timestamp ties in all five arms**.
- File order is compared against **my own launch plan**
  (`sorted(accept5_isolated_population.build()["children"])`, reversed for
  `--reverse`), not against anything the runner wrote about itself.

`[MEASURED HERE]` Mechanism confirmed by reading the executable line, not assumed:
`accept5_isolation_plugin.py` reverses via `items.reverse()` in
`pytest_collection_modifyitems(trylast=True)`, and records the order witness at
protocol level in `pytest_runtest_logstart`. `_SEQ` is a module global, but each
child is its own interpreter, so no cross-child contamination is possible.

---

## PER-ARM RECEIPTS (driver-owned)

All five: exit **0**, pin `f4e9a9d2` **before and after**, **108** children,
**2419** observed, **0** missing, **0** invented, **0** duplicates, **0**
unmapped, **0** timestamp ties, file order **matches my plan**.

| Arm | Flags | Launch id | Child PID | My monotonic start | My monotonic end | **My elapsed (s)** | <=600s | Exit | Pin before/after | Run root |
|---|---|---|---|---|---|---|---|---|---|---|
| GA | (none) | `GA-882ee5d1eb04` | 20704 | 21:23:02.674821-04:00 | 21:29:56.310464-04:00 | **413.636** | yes | 0 | ok / ok | `isolated-87c146b26919` |
| GB | `--reverse` | `GB-32e7f8979a7a` | 17592 | 21:29:56.402431-04:00 | 21:36:45.302557-04:00 | **408.900** | yes | 0 | ok / ok | `isolated-5af983c9d77a` |
| GC | `--reverse-nodes` | `GC-5e0a139acd5b` | 26260 | 21:36:45.384570-04:00 | 21:42:55.323888-04:00 | **369.939** | yes | 0 | ok / ok | `isolated-cac035bfff00` |
| GD | `--reverse --reverse-nodes` | `GD-e3eb412a61ed` | 26540 | 21:42:55.404276-04:00 | 21:49:37.706762-04:00 | **402.302** | yes | 0 | ok / ok | `isolated-67d86017b32e` |
| GE | (none, repeat) | `GE-061fe29b80ae` | 23744 | 21:49:37.797696-04:00 | 21:57:01.276903-04:00 | **443.479** | yes | 0 | ok / ok | `isolated-94ec7a68a970` |

**Max elapsed 443.479s against the frozen 600.0s ceiling** (~26% headroom).

### Distinct execution — from MY launches, not artifact `run_id`

`[MEASURED HERE]` **5 distinct launch ids**, **5 distinct child PIDs**
`[17592, 20704, 23744, 26260, 26540]`, 5 disjoint output directories. The
evidence that these are five separate executions is that **I performed five
separate launches** — never a `run_id` field an artifact asserts about itself.

### No-overlap proof (my own timestamps)

| Transition | Gap | Sequential |
|---|---|---|
| GA end -> GB start | +0.09s | yes |
| GB end -> GC start | +0.08s | yes |
| GC end -> GD start | +0.08s | yes |
| GD end -> GE start | +0.09s | yes |

Every gap is **positive** — each arm began only after its predecessor's
subprocess had been reaped. The wall-clock property is therefore valid.

---

## PIN / TREE STABILITY

Pin held at `f4e9a9d2711d9bf132efcc4fcb1546da4fcaa060` before and after **all
five** arms `[MEASURED HERE]`.

### The GA working-tree write — two separately proven halves

`[MEASURED HERE]` My driver flagged `tree_unchanged=False` on GA. I neither hid
nor waved this away; I characterised it. **My predicate was over-broad, not the
tree unsound.** The correct claim is NOT "the entire working tree was unchanged".
It is:

**Half 1 — the governed AUTHORITY SURFACE was byte-stable throughout.**
`AUTHORITY_SOURCE_PATHS` = `src`, `scripts`, `tests`, `pyproject.toml`,
`pytest.ini`, `tox.ini`, `setup.cfg`, `conftest.py`, and the two
`docs/replay-results/h1-battery/*.json` authorities.

Proven from digests **my own driver** recorded, not the runner's:

- GA **before** digest `e3b0c442...` == `sha256(b"")` -> status was **empty** ->
  nothing modified anywhere, so the authority surface was clean at entry.
- GA **after** digest `9b141d75...`. I reproduced this by **two independent
  paths**: offline `sha256("M docs/wave25-exit-engine-ab-report.md")` and a live
  recomputation in the worktree — **both match**. Therefore the after-state
  status contained **exactly one entry**, and it is not an authority path.
- GB/GC/GD/GE: before == after == that same single-entry digest.

Hence at **every arm boundary** the full status (a *superset* of the authority
surface) contained **no authority-surface path**. No governed test input, runner
source, plugin source, population authority, execution configuration, or
production engine code was touched.

**Half 2 — one already-classified OUTPUT-ONLY file outside that surface was
written.** `docs/wave25-exit-engine-ab-report.md`, the known
`ACCEPT5-TEST-SIDE-EFFECT-1` (ruled OUTPUT-ONLY, R-807 section 4). It is written by a
governed member on every acceptance run. GA shows it because GA made the one-time
clean->modified transition; GB–GE show no further delta.

`[MEASURED HERE]` Direct confirmation: authority-scoped
`git status --porcelain --untracked-files=all -- <AUTHORITY_SOURCE_PATHS>`
returns `rc=0`, output `''`, while the unrestricted status simultaneously returns
` M docs/wave25-exit-engine-ab-report.md` — the positive control proving the
command works and the null is real, not a broken invocation.

**The output-only report alone does not invalidate GA.** GA stands.

---

## ALL-TEN ORACLE

Exact `node_id -> outcome` maps derived from JUnit, all ten unique pairs.
Certification is on **exact node identity**, never on counts.

| Pair | Outcome diffs | Key sets identical | Node-order relation | Children checked / no-op | File-order relation | Result |
|---|---|---|---|---|---|---|
| GA vs GB | **0** | yes | SAME | 104 / 4 | REVERSE ok | **OK** |
| GA vs GC | **0** | yes | REVERSE | 104 / 4 | SAME ok | **OK** |
| GA vs GD | **0** | yes | REVERSE | 104 / 4 | REVERSE ok | **OK** |
| GA vs GE | **0** | yes | SAME | 104 / 4 | SAME ok | **OK** |
| GB vs GC | **0** | yes | REVERSE | 104 / 4 | REVERSE ok | **OK** |
| GB vs GD | **0** | yes | REVERSE | 104 / 4 | SAME ok | **OK** |
| GB vs GE | **0** | yes | SAME | 104 / 4 | REVERSE ok | **OK** |
| GC vs GD | **0** | yes | SAME | 104 / 4 | REVERSE ok | **OK** |
| GC vs GE | **0** | yes | REVERSE | 104 / 4 | SAME ok | **OK** |
| GD vs GE | **0** | yes | REVERSE | 104 / 4 | REVERSE ok | **OK** |

**PAIRS OK: 10/10. Exact node-outcome differences: 0. `only_A`/`only_B`: 0 in
every pair.**

The node-order property is enforced **per child across the population**, never a
global `bool(varied)`. Where REVERSE is required the check demands both
`a == reversed(b)` **and** `a != b` — so a symmetric/empty sequence cannot
satisfy both relations at once (the R3 empty-sequence false-green). The **4
no-ops per pair** are the 2 governed helper files holding no tests plus 2
single-node children; 0/1-node children are legitimate no-ops, and they are
reported rather than silently absorbed.

Observed distribution, identical in all five arms: **2384 passed / 33 failed /
2 xfailed** — recorded for information, **not** the basis of certification.

---

## FAILURE SET

`[MEASURED HERE]` **33 failed nodes, and the set is IDENTICAL across all five
arms** (frozenset equality on exact node ids, not counts).

| File | Failed nodes |
|---|---|
| `test_a_plus_gate_parity.py` | 18 |
| `test_pnl_accuracy.py` | 4 |
| `test_parameter_jitter_battery.py` | 3 |
| `test_accuracy_fixes.py` | 2 |
| `test_production_hardening_g2a_g2b.py` | 2 |
| `test_apply_trade_management_branching.py` | 1 |
| `test_e2e_backtest.py` | 1 |
| `test_three_fixes.py` | 1 |
| `test_wave_b_intrabar_stops.py` | 1 |

Per the brief these 33 are the expected stable failures and are **out of scope**;
I did **not** adjudicate them. Their invariance across all five arms is itself
part of the order-independence evidence.

---

## METHOD CONTROL (my parser must be able to go RED)

Run on **scratch copies of my own JUnit evidence**. No permanent checker was
added to the repo. **Every mutation was read back from disk before scoring** — a
silently-failed mutation leaves the target pristine and reads as a false GREEN.

| Control | Mutation | Landed on disk | Required reaction | Result |
|---|---|---|---|---|
| C1 | one testcase `failed -> passed` (drop `<failure>`) | verified | outcome map changes and **names that exact node** | **BIT** — exactly 1 diff: `test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_no_entry_quality_bypasses_gate` |
| C2 | one `<testcase>` deleted | verified | population reconciliation goes **RED** | **BIT** — exactly 1 missing: `test_a_plus_gate_parity.py::TestVpShapeScoreFormulaParity::test_d_shape_any_confidence_is_zero` |
| C3 | node order reversed in one child | verified | node-order relation detects | **BIT** — order differs from baseline |

| Control | Mutation | Required reaction | Result |
|---|---|---|---|
| C4 (deferred until after arms, so as not to perturb a live measurement) | plant untracked file in `scripts/`, then in `src/` | authority-surface status must go **RED**, then clean on removal | **BIT** — clean -> `?? scripts/__ctrl_probe.txt` -> both probes -> clean; probes removed, pin intact |

All four controls bit. **A tree-stability check that has never gone red is not an
instrument; this one now has a demonstrated path to red.**

---

## FINDINGS

**No CRITICAL and no HIGH findings. No refutation of the claim was found.** The
honest null is the result here; I did not manufacture defects to look diligent.

### F-LIVE-1 — LOW (grader-side, already corrected in this report)
**Severity:** LOW (over-broad predicate in MY driver, not a defect in the target)
**Claim:** driver emitted `!! ARM GA REFUSED: pin/tree moved`.
**Reality:** the pin never moved; a single OUTPUT-ONLY file outside the authority
surface was written (`ACCEPT5-TEST-SIDE-EFFECT-1`).
**Source of truth:** authority-scoped `git status` (empty) + digest reproduction
of the one-entry status by two independent paths.
**Fix point:** my `driver.py` `tree_state()` digests the whole tree; it should
scope to `AUTHORITY_SOURCE_PATHS`. Scratch-only tool; not repaired in-repo.
**Repro:** `python -c "import hashlib; print(hashlib.sha256(b'M docs/wave25-exit-engine-ab-report.md').hexdigest())"` -> `9b141d75...`

### F-LIVE-2 — INFORMATIONAL
The `runtime-production` null for `g_order_identity` is **vacuous in isolation**
(0 `accept5*` files exist in that tree at all). Reported as a bounded null rather
than counted as a clean absence.

---

## LIMITATIONS — what I did NOT verify, and why

1. **Tree stability is sampled at arm BOUNDARIES, not continuously.** I recorded
   `git status` before and after each arm. A file modified *and reverted* inside
   a single arm is **invisible to my method**. I cannot exclude a transient
   mid-arm mutation. Closing this needs a filesystem watcher, which I did not run.
2. **The population authority is a SINGLE SOURCE.** The expected 2419-key set
   comes from `population_successor.required_population(REPO)`. I did **not**
   independently re-derive the governed population from a second authority. If
   that authority is itself wrong, all five arms would agree with it and with each
   other, and my reconciliation would still read 0 missing / 0 invented.
   Cross-arm agreement is independent of it; the *expected set* is not.
   **Single-source truth = unverifiable by this grade.**
3. **The 33 stable failures were NOT adjudicated** (explicitly out of scope). This
   grade certifies execution identity, **not tree health**. A reader must not
   convert "10/10 pairs OK" into "the suite is green" — it is not; 33 nodes fail
   in every arm.
4. **One machine, one OS, one interpreter** (Windows 11, CPython 3.13.0, pytest
   9.0.3), one data snapshot. Determinism across environments, Python versions or
   hardware is **not** established. The 600s ceiling passed with ~26% headroom on
   *this* box; a loaded machine could breach it.
5. **`[H]` corroboration deliberately unused.** I did not cross-check my wrapper
   interval against runner/manifest/JUnit durations, because doing so would
   re-admit the self-attested value the exercise exists to remove. So I can vouch
   for my own interval, not for whether the runner's internal witness agrees.
6. **`skipped` vs `xfailed` classification** rests on the JUnit `type`/`message`
   containing "xfail". A misclassification would be *consistent across arms*, so
   pairs would still pass; only the reported distribution label would be wrong.
   Population reconciliation is unaffected (both are observed nodes).
7. **XML parsed with stdlib `ElementTree`** (no external-entity hardening). These
   files are produced by my own pytest subprocesses in my own scratch directory,
   so the untrusted-input threat model does not apply; it would if this method
   were pointed at third-party XML.
8. **The comparator was not evaluated.** I did not assess whether
   `g_order_identity.py` would have reached the same verdict, and this grade
   provides **no** evidence about its correctness either way — by design.
9. **Not verified: that the runner cannot self-report falsely.** I bypassed its
   summaries rather than auditing them. My result is independent *of* them; it is
   not a statement *about* them.
10. **The 4 no-op children per pair** (2 empty helpers + 2 single-node files)
    carry a vacuous order property. 104 of 108 children genuinely exercise it.

---

## VERDICT

**PASS — BOUNDED.**

**VERIFIED BAND: 8** (adversarially tested, method controls bit, residual risks
documented). Not 9: limitation 2 (single-source population authority) is a real
unclosed item, and 9 requires zero such gaps. Consistent with this desk's rule
that 7–8 is the realistic ceiling for a maintained production system and that an
agent writing 10 is itself the red flag.

Scope of the band: **corpus** = governed ACCEPT-5 population (108 children /
2419 nodes) · **battery** = 5 arms x 4 order-axis combinations · **engine** =
`accept5_isolated_runner` at pin `f4e9a9d2` · **snapshot** = 2026-08-11 21:23–21:57 -04:00,
one Windows box, CPython 3.13.0 / pytest 9.0.3.

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| RATIFY-1 live execution identity @ `f4e9a9d2` | **8** | **VERIFIED** | 5 self-launched arms; 10/10 pairs at 0 exact node-outcome diffs; identical 2419-key sets; identical 33-node failure set; order relations per child (104/108); 4 method controls bit | boundary-only tree sampling; single-source population authority; 33 failures unadjudicated; single environment |

### Closing enumeration

**1. What I verified, and via which non-overlapping paths.**
- *Population*: (a) my JUnit-derived observed key set; (b) the frozen
  `population_successor` authority, which never touches execution artifacts.
  0 missing / 0 invented in all five arms.
- *Outcome identity*: (a) my JUnit-derived maps; (b) five physically independent
  executions I launched — agreement across five separate processes is not
  reproducible by one instrument reproducing itself.
- *Order*: (a) JUnit `<testcase>` document order; (b) `testsuite@timestamp` for
  the file axis; (c) my own launch plan. The runner's `ordinal`/`node_sequence`
  bookkeeping was used for **none** of it.
- *Timing*: my driver's monotonic interval, external to the runner.
- *Tree*: my own before/after digests, reproduced by two independent paths.

**2. Positive-control witnesses for every absence claim.**
- "0 outcome diffs" -> C1 flipped one testcase; the comparison named that exact node.
- "0 missing / 0 invented" -> C2 deleted one testcase; reconciliation went RED naming it.
- "order relations hold" -> C3 reversed one child; the relation detected it.
- "authority surface clean" -> C4 planted probes in `scripts/` and `src/`; the
  scoped status went RED, then clean on removal.
- "0 comparator refs in CI" -> `jobs:` matched 8/8 workflow files.
- "0 comparator refs in main / runtime-production" -> trees greppable (3514 /
  3613 tracked files); **and the runtime-production null is flagged vacuous.**

**3. Join keys for every "identical / unchanged / matches" claim.**
- Outcome identity: **exact pytest node id** (`path::Class::test[param]`), not counts.
- Population: exact node id against the authority set.
- Failure set: `frozenset` of exact node ids.
- Order: ordered lists of exact node ids / child dir slugs.
- Tree: `sha256` of `git status --porcelain --untracked-files=all` output.
- Pin: full 40-char SHA, before and after each arm.

**4. What I did NOT verify.** See LIMITATIONS 1–10 above — most materially:
mid-arm transient tree changes, the single-source population authority, the 33
unadjudicated failures, and any environment other than this one.
