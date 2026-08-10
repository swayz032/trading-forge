# GRADE — S6 EXECUTION ACTIVATION · `a2527e61` · 2026-08-10

**Grader:** `accuracy-validator`, independent seat. **Doer:** worker seat `claude.exe 33036` (AR-920).
**Lineage declaration:** I did not design, build, or previously grade this work. My prior grade in this
lineage is `GRADE-TRIGGER-SAFETY-2026-08-09.md` (D-8 `16224ef5`), a *different* commit and a *different*
surface; the trigger-safety suite reappears here only as one of four transitioned fixtures, and I
re-derived it from current artifacts rather than from that grade.

## VERDICT

> ## `PASS_WITH_BOUNDED_FINDINGS` — **VERIFIED band 7**
> Three findings, **zero CRITICAL, zero HIGH**: two LOW caption defects and one MEDIUM defect in the
> *acceptance apparatus* (not in the delivery). **The central claims survived adversarial attack,
> including deliberate failure injection into production.**

**No CLAIMED band to reconcile against.** AR-920 §9 explicitly refused to self-grade
(*"I DO NOT GRADE THIS … the BAND is the desk's"*) `[ARTIFACT-SOURCED]`. That is the correct posture and
removes the doer-graded auto-downgrade.

**Why 7 and not 9.** Band 9 requires independent re-scan **plus** failure injection **plus** zero open
HIGHs. I performed independent re-scan and failure injection `[MEASURED HERE]`, and there are no open
HIGHs — but **acceptance term `D` (tsc exit 0, TS parity 15/15) is UNVERIFIABLE by me**: `node_modules`
is absent from a fresh worktree, so one of the seven acceptance terms carries **no** independent
witness. An acceptance argument with an unmeasured term cannot be certified at 9. Band 10 is
unreachable by construction.

**Scope of this band:** commit `a2527e61` only · the 105-member canonical population · the
103-member immutable baseline `acceptance-baseline-2026-08-09.json` · CPython 3.13.0 on this box ·
no market data, no TS toolchain.

---

## §1 — CLAIM-BY-CLAIM

| # | Claim (verbatim from AR-920) | Verdict | Evidence grade |
|---|---|---|---|
| 1 | ACCEPT-5: NEW=0, GONE = exactly the two ordered 6B reds **by name** | **CONFIRMED** | `MEASURED HERE` — re-derived with my own instrument |
| 2 | S6 14/14 green; 12B fan-out suite 7/7 green | **CONFIRMED** | `MEASURED HERE` — 21/21, collection asserted |
| 3a | 15 trigger-safety tests candidate-aware **by fixture only**, no safety assertion weakened | **CONFIRMED** | `MEASURED HERE` — AST assertion diff |
| 3b | Migration guard migrated only the bare OPENING_RANGE half; `LEVEL_CONSTRUCTION` + five `_MUST_STAY_REFUSED` rows untouched | **CONFIRMED** | `MEASURED HERE` — byte-identity + AST |
| 4 | No default, no primary, no `candidates[0]`, no timeframe inference, no runtime selection in production | **CONFIRMED (scoped)** | `MEASURED HERE` — sweep + dynamic reach + live probe |
| 5 | `SEAM-COMPLETE, CONSUMER-UNWIRED`: `build_execution_instances` has no non-test production caller | **CONFIRMED** | `MEASURED HERE` — with positive control |
| 6 | 103-baseline NOT touched; 104→105 REGENERATED from the suite's own derivation, exactly one member added | **CONFIRMED** (caption defect F-1) | `MEASURED HERE` — generator re-run, raw blobs |
| — | Acceptance term `D`: tsc exit 0, TS parity 15/15 | **NOT VERIFIED** | toolchain absent — see §4 |

---

## §2 — THE HIGHEST-VALUE ATTACK: TEST-REPLICA. **REFUTED.**

The dispatch named the campaign's worst false-green class: a suite that re-implements or mocks the
module it claims to exercise. **It is not present here** `[MEASURED HERE]`.

**The one-grep test.** Both suites monkeypatch, but the patch is a **delegating spy**, not a mock:

```python
# src/engine/tests/test_opening_range_execution_fanout.py:50-58
real = compute_opening_range_state
def spy(definition, variant, bars, **kw):
    calls.append(variant.duration_minutes)
    return real(definition, variant, bars, **kw)      # <- PRODUCTION STILL RUNS
monkeypatch.setattr("src.engine.opening_range_adapter.compute_opening_range_state", spy, raising=True)
```

Neither suite defines its own `compute_opening_range_state`, `opening_range_adapter`, or
`build_execution_instances`. `[MEASURED HERE]`

**Decisive experiment — I broke production and re-ran.** Harness: byte-safe (`read_bytes`/`write_bytes`),
**anchor count asserted `== 1`** (a no-op mutation fabricates a hole), **collection intact asserted
`== 21`** (an unparseable mutant reads exactly like an uncaught one), auto-revert verified byte-equal.

| Arm | Mutation | Collection | RED | Reading |
|---|---|---|---|---|
| Control | none | 21 | **0** | 21/21 green |
| A | `compute_opening_range_state` raises | 21 | **7** | production adapter is genuinely exercised |
| B | `build_execution_instances` returns empty | 21 | **4** | always-empty fan-out is caught |
| C | forbidden shape `opening_range_candidate=candidates[0]` | 21 | **5** | reproduces AR-920 §3 **exactly** |
| D | unfreeze `BreakoutAmbiguityVerdict` | 1 | **1** | B017 swap still discriminates |

**Mutation A reddened `test_flag_off_the_candidate_aware_instance_gates_on_the_real_window`**
`[MEASURED HERE]` — so the **flag-OFF** route also reaches the real adapter, not just the enforced one.

**Mutation C independently reproduces AR-920 §3's "5 of 7 fan-out arms RED"** `[MEASURED HERE]`. The two
survivors are structurally correct: arm 3 calls `from_compiled_spec` directly (never the fan-out) and
arm 4 returns before the comprehension. The doer's red-proof was real, not a description.

**Every test that stayed green under a mutation was checked for standing** — none claims the property
the mutation broke. No replica found.

---

## §3 — FINDINGS

### Discrepancy F-1: AR-920 §6.1's line-ending caption is INVERTED
**Severity:** LOW (caption / receipt defect — law 12, *a caption is a claim*)
**Claim:** `"CRLF preserved (128 CRLF / 0 bare LF)"`
**Reality:** the manifest is **pure LF at every commit examined** — `0 CRLF`.
**Sources compared:** raw `git cat-file blob` at three SHAs | working-tree bytes | `core.autocrlf`

| SHA | bytes | CRLF | bare LF |
|---|---|---|---|
| baseline `f8273f41` | 6138 | **0** | 126 |
| parent `a2527e61~1` | 6204 | **0** | 127 |
| pin `a2527e61` | 6256 | **0** | 128 |

**Source of truth:** the raw blob. `core.autocrlf=false` `[MEASURED HERE]`, so the checkout is *not*
smudged and the working-tree read agrees with the blob — my instrument is not the one lying. (I applied
my own standing rule here: *when a control fires against a well-captioned file, suspect the control
first.* I checked the control; the control is sound.)
**The substantive claim is TRUE and I verified it to the byte:** 6204 → 6256 = **+52 bytes** = exactly
`engine/tests/test_opening_range_execution_fanout.py` (51 chars) + one `\n`. **No mass rewrite occurred.**
Only the LABEL is inverted.
**Fix point:** `docs/designs/AGENT-REPORTS.md` AR-920 §6.1 — correct to `0 CRLF / 128 LF`.
**Repro:** `git cat-file blob a2527e61:src/engine/tests/canonical_regression_population.txt` piped to a
byte counter (`b.count(b'\r\n')` vs `b.count(b'\n')`) — never `grep -c $'\r$'`, which lies on pure-LF files.
**Blast radius:** a future seat that re-measures reads `0 CRLF`, concludes a mass line-ending rewrite
happened, and opens a false regression against a clean file. Costs a reader, not the money path.

### Discrepancy F-2: the two retired 6B reds now carry names asserting the OPPOSITE of reality
**Severity:** LOW–MEDIUM (stale caption on a now-passing permanent guard)
**Claim:** implicit — the two tests are simply "retired reds" and need no attention.
**Reality:** both **PASS** at the pin `[MEASURED HERE]`, which is correct (their assertions are
*positive*: `assert binding.bindable is True and binding.primitive is not None`). **But their NAMES now
state falsehoods:**

- `test_no_production_binding_routes_to_the_opening_range_adapter_yet` — production **does** route
  (`spec_condition_compiler.py:950`, AR-920 §7 ROW 1).
- `test_no_typed_opening_range_output_contract_exists_in_production` — the contract **does** exist.

**Source of truth:** the file's own docstring, which mints the rule and records a prior rename for
*exactly this reason* (`R-736 §3`): *"`A CAPTION IS A CLAIM`, and a test whose name asserts something
untrue is a false claim that every future reader would trust."* `[ARTIFACT-SOURCED]` The desk renamed
this very test once before on this ground; the commit that finally made the names false did not rename
them, and AR-920 lists this under neither §6 (unplanned changes) nor §8 (not measured).
**Fix point:** `src/engine/tests/test_opening_range_conformance.py:571` and `:608` — rename both.
⚠️ **Any rename must be joined against the baseline first:** these two node IDs are literally the
`ordered_6b_reds` members. Renaming them is safe **only because** they are no longer in the failure set;
the same rename before this commit would have manufactured a false `GONE`.
**Blast radius:** documentation//reader only. No money-path effect.

### Discrepancy F-3: two canonical-population members silently SKIP in any clean checkout, and ACCEPT-5 is structurally blind to it
**Severity:** MEDIUM — **against the acceptance APPARATUS, not against `a2527e61`**
**Claim:** baseline `totals_at_baseline: {failed:33, passed:2300, skipped:3, xfailed:2}`
**Reality:** re-running **the same 103 members at the same SHA `f8273f41`** in a fresh worktree gives
`33 failed, 2298 passed, **5 skipped**, 2 xfailed` `[MEASURED HERE]`.
**Sources compared:** baseline artifact `skipped:3` | my re-run at base SHA `skipped:5` | my run at pin `skipped:5`
**Source of truth:** both are correct *for their environment*. The 2 extra skips are
`test_spec_family_bindings.py:901`, gated on
`docs/replay-results/blind-readjudication/blind-second-judge-LOCKED.json`, which **is not tracked in git
and does not exist in a fresh worktree** `[MEASURED HERE]` (`git ls-files --error-unmatch` → exit 1;
positive control: sibling files under `docs/replay-results/` **are** returned by `git ls-files`).
**The structural gap:** ACCEPT-5's criterion is *failure MEMBERSHIP only* (`how_to_use`: "COMPARE
MEMBERS, NEVER COUNTS"). **A PASS → SKIP transition is therefore invisible to it** — a member could stop
providing coverage entirely and ACCEPT-5 would still report `NEW = 0`.
**This does NOT impugn `a2527e61`:** skip membership is **identical at base and pin** — 5 and 5, the same
4 sites, the same counts `[MEASURED HERE]`. The commit introduced **zero** skip drift.
**Fix point:** the acceptance criterion — record skip MEMBERSHIP in the baseline alongside failure
membership; and either track the gating artifact or make the skip loud.
**Repro:** `skipcensus.py` (§5), run in a worktree at `f8273f41` and at `a2527e61`, diff by
`(file, reason)`. ⚠️ *Strip the absolute worktree path from the reason first — it is embedded in the
skip message and my first set-diff reported a false difference because of it. That was my instrument, not a defect.*
**Blast radius:** any future delivery could silence up to N population members without ACCEPT-5 noticing.

---

## §4 — WHAT I VERIFIED, AND HOW (two-plus non-overlapping paths per claim)

**CLAIM 1 — ACCEPT-5.** Independently re-derived. I never read or ran the doer's script.
- *Path A (execution):* my own manifest resolution → my own pytest invocation → my own node-ID parser →
  set-diff against the baseline's committed `failures` list.
  **Result: `NEW = []`, `GONE` = exactly the 2, `GONE == ordered_6b_reds` BY MEMBER: `True`.** 31 failed,
  2350 passed, 128.56s. `[MEASURED HERE]`
- *Path B (git object DB — genuinely different instrument):* the manifest **at the baseline SHA** vs **at
  the pin**: **2 members ADDED, 0 REMOVED.** The population is a strict **superset**, so `GONE` **cannot**
  be a population artifact. `[MEASURED HERE]` This is the specific attack the dispatch asked for, and it
  fails against the delivery — the arithmetic holds.
- *Path C (baseline validation):* I re-ran the **103 members at the baseline SHA `f8273f41`** in a
  separate worktree. My failure set is **SET-IDENTICAL to the baseline's 33** — zero on either side.
  `[MEASURED HERE]` **The baseline artifact is reproducible by an instrument that did not create it.**
- *Join keys checked:* pytest **node ID** (normalised: backslash→slash, truncated at `src/engine/`) for
  the failure sets; **file path** for the manifest. The dispatch's concern that these two join keys
  differ is real but **harmless here**, precisely because path-set is a superset and node-set is exact.
- *Named-member check:* the 2 GONE tests **still exist** at the pin (`def` count = 1 each) and were **not**
  renamed away — their disappearance from the failure set is a genuine RED→GREEN flip. `[MEASURED HERE]`

**CLAIM 2 — 14/14 and 7/7.** `--collect-only` = **21 tests** (14 + 7); full run **21 passed, exit 0**.
Every mutation run re-asserted collection `== 21`, so no result of mine rests on a suite that silently
failed to collect. `[MEASURED HERE]` (Note: the dispatch's "39/39" does not match this population; the
reproducible figure is **21**.)

**CLAIM 3 — the four transitions.** Two independent paths:
- *Path A — complete removal enumeration:* every `-` line in the whole commit matching
  `assert|raises|pytest.fail|MUST_STAY` = **14 lines**, each read individually. `[MEASURED HERE]`
- *Path B — AST assertion diff* (catches a weakening done by editing a constant on a continuation line,
  which a grep misses): unparsed every `ast.Assert` and every `raises(...)` context, per function,
  parent vs pin. **Result:** `test_trigger_safety_refusal.py` — **0 functions removed**, 3 added, and
  only **2** surviving functions changed any assertion, both **strengthened**:
  - `pytest.raises(Exception)` → `pytest.raises(dataclasses.FrozenInstanceError)`;
  - `sum(...) == 7` → `len(bindable) == 8` **plus** `len(opening_range) == 1` **plus**
    `len([b for b in bindable if b.type != 'OPENING_RANGE_DEFINITION']) == 7`.
  **The 15 safety assertions do not appear in the diff at all.** `[MEASURED HERE]`
  `test_family_meta_enforcement.py`: **no surviving function changed any assertion.**
- *Migration guard:* exactly one function changed — **3 assertions lost, 9 gained**. The 3 lost
  (`unsupported is True`, `primitive is None`, `unbound_reason == "..."`) were **falsified by the
  activation itself**; the 9 gained include the anti-fallback clause and five binding-level assertions
  proving it **BINDS**, not merely declares. `LEVEL_CONSTRUCTION` assertions: untouched.
- *`_MUST_STAY_REFUSED`:* extracted the block from parent and pin blobs — **byte-identical**, 925 bytes
  each, **5 rows** each. `[MEASURED HERE]`
- *B017 red-proof:* green → **RED on unfreeze** → green on revert. **The narrowing is not vacuous.**
  `[MEASURED HERE]`

**CLAIM 4 — no default / no selection in production.** Three paths:
- *Static sweep* of all non-test `src/**.py` for `candidates[0]`, `candidate[0]`,
  `opening_range_candidates[`: the only opening-range hits are **comments** forbidding the shape. The
  four live `candidates[0]` hits are in unrelated subsystems (`structural_stops`, `structural_targets`,
  `cuopt_helpers`, `adaptive_exits`) — a different concept, outside this boundary. `[MEASURED HERE]`
- *Dynamic reach* (law 2): enumerated `importlib` / `__import__` / `import_module` in production —
  3 real dynamic loaders exist, but the string `opening_range_execution_fanout` appears **nowhere**
  except the test's own import. No hidden caller. `[MEASURED HERE]`
- *Live probe (mine, not theirs):* drove production directly with `opening_range_candidate=None` on a
  spec that **does** teach an opening range. **Result: raises `FamilyMetaEnforcementError`, ZERO adapter
  calls, NO published column.** Positive control on the same probe: with a candidate →
  `shape=(45,)`, `n_true=30`, `all_true=False` (a **real per-bar gate**, not a constant-True fallback),
  adapter called once with duration `15`. `[MEASURED HERE]`
- *Public-boundary check (the D-8 lesson — "terminal" refuted one hop outside the fixed file):* AST-walked
  `compute()` (lines 1865–2215) and `_dispatch_enforced` (1277–1290) — **ZERO `try` blocks in either**.
  The refusal is **not swallowed**; it propagates out of the public boundary. `[MEASURED HERE]`
- *`gates=True`:* resolved at **runtime**, not read from the diff — `FamilyMeta.gates` default is `True`
  and the new entry does not override it. `[MEASURED HERE]`

**CLAIM 5 — no production caller.** Absence claim, **with its positive control**:
- `build_execution_instances` → references are its own `def`, its own `__all__`, the SYSTEM-INVENTORY
  doc, and **one test file**. **Zero non-test production callers.** `[MEASURED HERE]`
- **Positive control:** the identical grep for `from_compiled_spec` returns **5 files including 2
  non-test production modules** (`backtester.py`, `spec_condition_compiler.py`). **The method finds
  production references when they exist**, so the zero is a real absence, not a broken query.
  `[MEASURED HERE]`
- Corroborated by SYSTEM-INVENTORY row 2 listing it as unreferenced. `[ARTIFACT-SOURCED]`

**CLAIM 6 — manifest regenerated, baseline untouched.** Three paths:
- *Generator re-run:* imported the committed `_regression_population(_SCAN_ROOT, _CLOSURE_TARGETS)` and
  compared to the committed manifest — **105 == 105, SET EQUAL `True`, ORDER IDENTICAL `True`**, zero on
  either side. **Not hand-edited.** `[MEASURED HERE]`
- *Diff shape:* `1 insertion, 0 deletions`, exactly one added member. `[MEASURED HERE]`
- *Baseline immutability:* `git show --stat a2527e61 -- docs/replay-results/` is **empty**, and the
  baseline's last-touching commit `186f22cd` **predates** the pin. `[MEASURED HERE]`

**Structural corroboration nobody claimed, which I checked because it is cheap and decisive:**
per-production-file removed-line counts — `spec_condition_compiler.py` **REMOVED = 0 / ADDED = 210**,
`family_meta_enforcement.py` **0 / 7**, fan-out **0 / 122 (new)**. **A purely additive diff makes
"gates untouched" and "else-sink byte-identical" structurally impossible to violate in those files.**
Only the two mirrored binding files delete anything (`spec_family_bindings.py` −18/+21,
`spec-family-bindings.ts` −7/+7), and I read both diffs in full: the Python and TS edits are exactly
parallel. `[MEASURED HERE]`

**Independent reproduction of a defect the doer DECLARED:** my own population run re-stamped
`docs/wave25-exit-engine-ab-report.md` (`Run date: 2026-05-24 13:29 UTC` → `2026-08-10 04:39 UTC`),
confirming AR-920 §6.3's "banked, not fixed" generator defect from a second tree. `[MEASURED HERE]`

---

## §5 — REPRODUCTION

Isolated worktree (never the shared tree; two live seats + a stashing `pre-commit` hook there):

```
git -C C:/Users/tonio/Projects/wt-h1-wave4-20260712 worktree add --detach \
    C:/Users/tonio/Projects/wt-grade-s6-2026-08-10 a2527e61
git -C C:/Users/tonio/Projects/wt-h1-wave4-20260712 worktree add --detach \
    C:/Users/tonio/Projects/wt-grade-s6-BASE-2026-08-10 f8273f41
```

Scripts (scratchpad, not committed): `mutate.py` (A/B/C + control) · `accept5.py` (ACCEPT-5
re-derivation) · `skipcensus.py` (skip membership) · `assert_diff.py` (AST assertion diff) ·
`refusal_probe.py` (live no-candidate probe). All pytest runs from the worktree ROOT (these suites are
CWD-sensitive). No `| head` / `| tail` on any relied-upon result; real process exits captured into
variables.

---

## §6 — COVERAGE (MANDATORY)

### 6.1 What I verified, and via which two-plus non-overlapping paths
See §4. Summary of path pairs:

| Claim | Path A | Path B | Path C |
|---|---|---|---|
| ACCEPT-5 | my own pytest re-derivation | git object DB manifest diff (0 removals) | baseline reproduced set-identical at base SHA |
| suites green | `--collect-only` | full run + collection asserted in every mutant | failure injection (4 mutants) |
| transitions | complete removal enumeration | AST assertion diff | byte-identity of `_MUST_STAY_REFUSED` |
| no selection | static sweep | dynamic-reach enumeration | live production probe + AST no-swallow |
| no caller | grep with positive control | SYSTEM-INVENTORY row | dynamic-import string sweep |
| manifest | generator re-run (set + order) | diff shape +1/−0 | raw blob byte deltas (+52) |

⚠️ **Honest limit on path independence:** my ACCEPT-5 re-derivation and the doer's both ultimately run
**pytest** on the same population. The resolution, invocation, parsing and set-diff are mine, but the
*execution engine* is shared. The genuinely non-overlapping second path for "GONE is not a population
artifact" is the **git object DB** analysis (Path B), which touches no test runner at all.

### 6.2 Positive-control witnesses for every absence claim I make
| Absence claimed | Positive control | Result |
|---|---|---|
| no production caller of `build_execution_instances` | same grep for `from_compiled_spec` | finds 2 production modules — method works |
| no dynamic caller | 3 real `importlib` loaders enumerated in production | method sees dynamic machinery; module name absent |
| gating artifact untracked | `git ls-files docs/replay-results/h1-battery/` | returns tracked siblings — query works |
| no `try` swallowing the refusal | AST walk returns Try counts | reports `0` for both functions, non-null instrument |
| mutations actually bit | unmutated control 21/21 + collection `== 21` in every arm | no mutant read as "uncaught" through a parse failure |
| adapter spy can observe calls | with-candidate arm records `[15]` | probe is not blind |

### 6.3 Join keys checked for every "identical / unchanged / matches" claim
- **failure sets** → pytest **node ID**, normalised (`\`→`/`, truncate at `src/engine/`). Baseline vs
  my base-SHA run: set-identical. Baseline vs pin: NEW `[]`, GONE 2.
- **population membership** → manifest **file path**, comment-stripped, CRLF-normalised.
- **`_MUST_STAY_REFUSED`** → **raw bytes** of the extracted block (925 == 925), plus row count 5 == 5.
- **assertions** → `ast.unparse` string, keyed by **enclosing function name**, compared as multisets.
- **manifest** → both **set** equality and **order** equality (order checked separately; a set-equal but
  reordered file would be a silent rewrite).
- **line endings** → raw blob `b.count(b'\r\n')` vs `b.count(b'\n')`, per file, **never** a `grep -c`.
- **skip sites** → `(file, reason)`; ⚠️ the reason embeds an absolute path, which faked a difference on
  my first pass until I accounted for it.

### 6.4 What I did NOT verify, and why
1. **Acceptance term `D` — `tsc --noEmit` exit 0, and TS parity 15/15.** `node_modules` is **absent** in a
   fresh worktree; `npx --no-install tsc` resolved to an unrelated global stub and exited 1.
   **This is a real hole in my result, and it is the reason this is band 7 rather than 9.** The TS mirror
   edit is 7 lines and I read it against its Python counterpart — they are exactly parallel — but
   *reading a diff is not compiling it.* **`RELAYED` from AR-920, uncorroborated.**
2. **ACCEPT-1 (54/54) and ACCEPT-3 (136/136) as named partitions.** I did not reconstruct the doer's
   partition. **Mitigation, which I consider strong:** every opening-range / S6 / transitioned test file
   is a member of the 105-population, and my full-population run shows **zero failures in any of them**
   `[MEASURED HERE]` — all 31 remaining failures are pre-existing, in 10 unrelated files. So the
   *underlying* property holds even though the *stated counts* are unreproduced.
3. **The SYSTEM-INVENTORY scanner itself.** I confirmed the grep-level facts behind §7 ROW 1 / ROW 2
   independently, but I did **not** audit the scanner's logic. Its 532-entry section is `RELAYED`.
4. **Whether `spec_condition_compiler.py:950` is REACHABLE on a real production path.** I confirmed the
   call exists and that the tests reach it. The delivery itself declares
   `SEAM-COMPLETE, CONSUMER-UNWIRED`, and I verified the *gap* (claim 5) rather than closing it.
   **This activation is NOT demonstrated reachable from any production entry point** — that is the
   delivery's own stated position and my measurement agrees with it.
5. **DST changeover · half-day session · gapped frame · non-1m timeframe.** Carried limits, never
   acceptance terms. Not measured here either.
6. **Behaviour on real market data.** This box has no market data (`opening_range_adapter` was exercised
   only against the taught synthetic session bars).
7. **The `B017` class elsewhere in the repo.** One instance fixed; I did not sweep for others.
8. **Whether the 31 pre-existing failures are individually benign.** Out of scope by `R-751 §9`
   ("explicitly NOT to be fixed"); I verified only that their membership is unchanged.
9. **The two GONE tests' future behaviour.** They pass now; I did not assess whether they will keep
   discriminating (F-2 concerns their names, not their assertions).

### 6.5 Tree integrity
- Graded entirely in `wt-grade-s6-2026-08-10` (detached at `a2527e61`) and `wt-grade-s6-BASE-2026-08-10`
  (detached at `f8273f41`). **No commit, checkout, reset, or index operation in the shared tree.**
- All five mutations reverted and verified **byte-equal** to the original.
- ⚠️ **The shared tree's HEAD MOVED mid-grade:** `a29c38f0` → `83c08048` (a live sibling seat, 00:33).
  I re-derived it at the end rather than trusting my start-of-run reading. **`83c08048` is docs-only**
  (`HANDOVER-ADVISOR-2026-08-04.md`, +12/−3); `git diff --name-only a29c38f0 83c08048 -- src/
  docs/replay-results/` is **EMPTY** `[MEASURED HERE]`. **Nothing I graded moved.** My pin is
  unaffected — this grade describes `a2527e61` exactly.
- Residual in my worktree: ` M docs/wave25-exit-engine-ab-report.md`, a **timestamp-only** re-stamp
  written by my own population run — the declared generator defect, reproduced, not introduced.

---

**COMPLETE AS OF this line.** Written in one pass at
`C:/Users/tonio/Projects/wt-grade-s6-2026-08-10/docs/designs/GRADE-S6-ACTIVATION-2026-08-10.md`.
Uncommitted by design — this worktree is a grading scratch tree, not a landing target.
