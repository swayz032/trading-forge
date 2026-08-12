# AR-1029 — WORKER — `R3-5` ALL FOUR ITEMS COMPLETE · `A` `B` `C` `D` EACH RED→GREEN WITH A DISCRIMINATING CONTROL · NO STOP FIRED

```
RULING  : AR-1027 (gpt-rulings 89e4fc2c) + AR-1028 (gpt-rulings b407f623)
PIN     : 1ff32675  origin/h1-wave4-sealed12-driver   (PUSHED, remote-verified)
BATCH   : 4 / 4 COMPLETE -- A, B, C, D. Nothing half-done, nothing deferred.
STOPS   : none fired.   IN FLIGHT: nothing.   GRADER: none owed (AR-1027 §5).
```

**Commits, in landing order:**

| item | commit | what |
|---|---|---|
| `D` | `649af723` | `F-ACCEPT5-8` — baseline anchor identifies the artifact, not one checkout |
| `B` | `4385d3c2` | unreadable/unparseable baseline REFUSES by name instead of crashing |
| `C` | `c6bc6366` | feeder-independence overclaim corrected; architecture untouched |
| `A` | `795dc1f0` | disposition drift line no longer displays `+0/-0` over a live departure |
| — | `1ff32675` | `SYSTEM-INVENTORY` regenerate — **forced by the pre-push gate**, see §5.3 |

---

## 1. PRE-FLIGHT (AR-1027 → `advisor-ruling` §0.-2, seven questions)

**No contradiction found ⇒ executed without a permission round-trip**, as `0-CTRL.1` requires.

1. **SCOPE** — AR-1027 §4 names four items *functionally*, not by path. ⚠️ **I resolved the paths by
   measurement:** all four live in `scripts/acceptance_runner.py` (+ `acceptance_pytest_plugin.py`
   for `C`'s trace). **No production trading, compiler, strategy, risk or P&L code was touched.**
2. **STOP CONDITIONS** — AR-1027 §6's six. Each checked, §3 below.
3. **PROHIBITED** — no RATIFY, no five-arm, no cluster, no census32 re-derivation, no second
   successor seal, no new checker framework, no `33` adjudication. **None approached.**
4. **REQUIRED PROOFS** — per-item RED→GREEN + control. **No grade owed** (AR-1027 §5): nothing
   authority-bearing in production/compiler/trading changed.
5. **MEASURED REPO STATE** — `HEAD` was `fdaa000b`, exactly as AR-1027 §2 / AR-1028 §1 assert.
   `[MEASURED HERE]`
6. **ALREADY LANDED?** — ⭐ **`D` partly had.** A validated dual anchor existed on
   `grade/accept5-instrument-r2-20260810`, **`[MEASURED]` NOT MERGED** into the engineering branch.
   **I adapted it rather than authoring a new one.** `R-796 §4 K-2` had already prescribed this exact
   repair, including a **STOP if the recomputed constants disagreed** with `b71c1641…` / `1b97e38a…`.
   **I recomputed both at source; they agreed; no STOP fired.**
7. **METRIC/GRADE MIX** — none. The ruling asks for mechanical proofs only.

---

## 2. THE FOUR ITEMS

### `D` — `F-ACCEPT5-8`, the raw/CRLF baseline anchor  (`649af723`)

**DEFECT, MEASURED HERE.** The anchor hashed `path.read_bytes()` — the file *as it sat on disk*.
`.gitattributes` declares the path `text eol=lf`, so a conforming checkout materializes LF, but the
approved constant was computed over a working copy carrying **66 CR bytes**. It therefore accepted
exactly one materialization and refused the artifact git actually committed.

```
worktree copy : 6368 bytes, 66 CR   raw sha256 a9f70e2e…  == the approved constant
committed blob: 6302 bytes,  0 CR   raw sha256 5e79f72c…  != the approved constant
```

`git status` reports this **clean**, because it compares NORMALIZED content, which matches the blob
perfectly. **The one tool that would have caught it is blind to it by design.**

**REPAIR** — the dual anchor, both constants **recomputed by me from both materializations**, not
pasted:

```
                       agrees across materializations?
raw sha256   (old)   : False   <-- the defect
blob OID     (new 1) : True    b71c1641…
canonical    (new 2) : True    1b97e38a…
```

Negative controls, computed the same way: a dropped failure moves **both** new anchors; a
**reformat-only** change moves the OID and **not** the canonical digest — which is precisely the
division of labour the two anchors exist for. No `git` subprocess: the OID is pure Python, so this
still anchors in a container or tarball with no `.git`. `--no-filters` is not used (`R-796 §9`).

**RED→GREEN.** `src/engine/tests/test_accept5_baseline_anchor_materialization.py`
- RED: LF materialization refused, `5e79f72c…` vs approved `a9f70e2e…`
- GREEN: LF **and** CRLF both accepted
- ★ **The test is TREE-INDEPENDENT:** before the repair it is RED on *every* checkout, merely on a
  different arm — non-conforming trees fail the LF arm, conforming trees fail the CRLF arm. **It
  cannot go green by accident of where it ran** (`R-799 §5`).
- **CONTROL with positive witness:** a baseline whose `artifact` description is tampered — a field
  **no other preflight step inspects** — is still refused, and **both new anchors name themselves in
  the refusal**, proving the anchor did not go blind to satisfy the first test.

**Canonical evidence was NOT rewritten.** The baseline file is never written to; only tmp_path copies.

### `B` — unparseable/unreadable baseline → named `REFUSED`  (`4385d3c2`)

**DEFECT, MEASURED HERE — worse than a missing guard.** The preflight *already refused* a malformed
baseline correctly. The very next statement then read the same file again, unconditionally:

```python
baseline_problems = validate_baseline_bytes(args.baseline)   # refuses
base = read_baseline(args.baseline)                          # crashes
```

`read_baseline` does a bare `json.loads(path.read_text())` and subscripts `d["failures"]` directly.
**So the instrument that had just decided the baseline was untrustworthy immediately parsed it, died
with a traceback, and never reached its own verdict line.** A missing/permission-denied baseline died
even earlier, at the unguarded `read_bytes()` — before a single refusal printed.

> `A GATE THAT CRASHES INSTEAD OF REFUSING HAS NOT FAILED CLOSED — IT HAS FAILED WITHOUT A VERDICT,
>  AND A CALLER READING THE EXIT CODE CANNOT TELL THAT APART FROM THE INSTRUMENT BEING BROKEN.`

**REPAIR** — three minimal changes: `read_bytes()` guarded → `BASELINE_UNREADABLE`; parse failure →
`BASELINE_UNPARSEABLE` (was untyped prose); and `main()` **fails closed on the authority file**,
emitting `ACCEPTANCE: REFUSED` + exit 1 *before* anything parses it. **Verdict semantics unchanged** —
these problems were already terminal; the gate now *reaches* the outcome it always owed. Downstream
checks are skipped deliberately: they can say nothing trustworthy about a baseline just rejected.
Codes are deterministic tokens, so a caller can branch on *why* without parsing English.

**RED→GREEN.** `test_accept5_unreadable_baseline_refuses.py` — RED both arms died with
`FileNotFoundError` / parse tracebacks and no verdict; GREEN both exit `1`, print `ACCEPTANCE:
REFUSED`, carry their code, no traceback. **CONTROL:** the governed baseline still passes preflight
with zero refusals, so the valid path is behaviorally unchanged. Both arms fail before the `--run`
pytest subprocess launches, so the whole file costs **0.23 s** and never executes the population.

### `C` — feeder-independence semantics  (`c6bc6366`)

**TRACED TO THE IMPLEMENTATION BOUNDARY, as §4C requires.** `acceptance_pytest_plugin` and pytest's
builtin junitxml are separate *implementations* but **not separate measurements**:

- both are pytest plugins registered in the **same process**
- both subscribe to the **same hook**, `pytest_runtest_logreport`
- both serialize at the **same point**, `pytest_sessionfinish`

**They are two SINKS on ONE report stream.** Their agreement is evidence that one sink did not corrupt
what it was handed — serialization and aggregation — **and evidence about nothing else.** Any fault
*upstream of both* is invisible: if the run never happens, both artifacts go stale for the same reason
and agree perfectly. **That is `F-R2-1`, already measured**, and the sibling test says so in its own
words: *"one path read twice, not two paths."*

> `BOTH SIDES OF A CHECK FROM THE SAME LAYER ⇒ AGREEMENT IS NOT EVIDENCE.`

**REPAIR is wording only.** §4C forbids manufacturing independence by adding an implementation to
satisfy the word, so **the architecture is untouched.** Four live sites reworded — **each replacement
asserted unique before substitution, so none silently no-opped** — plus a named
`FEEDER_CROSS_CHECK_SCOPE` the runner now prints beside the self-check, stating what it does *not*
cover.

**PROOF.** `test_accept5_feeder_independence_semantics.py` — the structural trace is **pinned**
(both recorders expose `pytest_runtest_logreport` and `pytest_sessionfinish`, so the shared-stream
claim is measured, not asserted); the scope string must name the exclusion; and a discriminating
control forbids any unqualified independence claim in **live** code.
**RED-PROOFED:** GREEN → reinstate the phrase in a live print line → **RED** → restore → GREEN.

### `A` — disposition display truth  (`795dc1f0`)

**DEFECT, MEASURED HERE.** The disposition site computes **three** departures and *every one refuses
the gate*: `newly`, `no_longer`, `missing_authorized`. **The line a reader scans reported only the
first two.** So a run refusing with `MISSING AUTHORIZED DISPOSITION CHANGE` printed `+0 / -0`
directly above its own refusal. **Not hypothetical — lane `G` refused with exactly that as its SOLE
refusal while both sibling arms displayed `+0 / -0`.**

> `A SUMMARY THAT OMITS ONE OF THE THINGS IT SUMMARIZES IS WRONG IN THE DIRECTION OF REASSURANCE.`

**REPAIR.** All three shown separately — **deliberately not summed**, since they mean different things
and one total would restore the same ambiguity a level up:

```
clean       : +0 / -0 / missing-authorized 0
lane-G case : +0 / -0 / missing-authorized 1
all three   : +1 / -2 / missing-authorized 3
```

**Gate semantics untouched:** the three refusals are unchanged; this function decides presentation only.

**RED→GREEN.** The line was an inline f-string inside `main()`, reachable only by driving a full
acceptance run with a seal. ★ **I extracted it VERBATIM first — a behavior-preserving no-op — so the
test would convict the EXISTING string rather than one I had just written**, and only then repaired it.
RED: `+1 / -2` rendered while three missing-authorized departures stayed invisible. GREEN: each of the
three is individually visible. **CONTROL:** a genuinely clean state still renders the familiar clean
summary and raises no alarm — a display that shouts on a clean run is as useless as one that whispers
on a dirty one.

---

## 3. REGRESSION AND STOP VERIFICATION

**All four new files together: `11 passed in 0.36 s`.**

**Existing instrument test — `test_accept5_stale_run_consumption.py`: `1 passed in 3.03 s`** on a clean
tree. ⚠️ **It first came back RED and I did not accept that at face value** — see §5.2.

**AR-1027 §6 STOPs, each checked:**

| # | condition | result |
|---|---|---|
| 1 | production/compiler/strategy/risk/P&L/money-path semantics | **not touched** — only `scripts/acceptance_runner.py` + 4 new non-governed tests |
| 2 | governed population or sealed 34-node set moves | **UNMOVED** — see below |
| 3 | needs a new runner/checker/grader framework | **no** — one function extraction, no new framework |
| 4 | `F-ACCEPT5-8` closable only by rewriting canonical evidence | **no** — the baseline is never written to |
| 5 | feeder trace exposes a material architecture defect | **no** — a wording/authority defect, exactly as §4C anticipated |
| 6 | cannot be made deterministic without guessing | **no** — every item is deterministic |

**STOP [2], measured with a positive control:**
- `canonical_regression_population.txt` **UNCHANGED** `fdaa000b..HEAD`
- none of the four new test files is a governed member — **and the grep was positive-controlled**
  against a token that must match (`test_fvg_identity_dispatch`), so the four "not a member" results
  are not an empty grep over a wrong path
- **no governed test file was touched at all**

---

## 4. WHAT I DID *NOT* MEASURE — stated plainly

🛑 **I did NOT re-derive the 34-node non-pass set, and I did not run a canonical ACCEPT-5.**
My STOP [2] claim is **structural, not measured end-to-end**: the manifest is unchanged, no governed
test file was touched, and the four added tests are not governed members — therefore the population
cannot have moved. **That is an argument, not a canonical run.** I judged a fresh canonical run to be
exactly the "expensive certification experiment without a SEMANTIC reason" that `0-CTRL.5` forbids and
that AR-1027 §5 declines to authorize. **If GPT wants the measured form instead of the structural one,
that is one canonical arm and I will run it on request.**

Also not measured: whether any *other* consumer outside this repo parses the reworded self-check
lines. I grepped this repo only.

---

## 5. MISTAKES AND FORCED DETOURS — surfaced per `0-CTRL.4`

**5.1 — I mis-measured line endings and said so to the operator.** My first check was
`grep -c $'\r'`, which returned `0`, and I reported the worktree baseline as pure LF. **It is CRLF
(66 CR bytes).** `grep` strips CR as part of line termination, so no line "contains" one — it is
simply the wrong instrument for detecting CRLF. `xxd` on the first bytes (`7b 0d 0a` vs `7b 0a`)
settled it. **The code was fine; the instrument lied — the same class this campaign has been
convicted on ~19 times.** Corrected to the operator in the same session.

**5.2 — I nearly misattributed a RED to my own change.** `test_accept5_stale_run_consumption.py`
failed at "arm 1 produced no artifacts" in 0.31 s, which looked exactly like my item `B` early-exit
firing. **I reproduced the runner invocation directly instead of assuming.** The real cause:
`ACCEPTANCE INSTRUMENT REFUSED - TREE AUTHORITY UNAVAILABLE`, because **my own uncommitted item-`A`
files made the tree dirty** — a designed fail-closed guard doing its job. The same output showed
`[BASELINE] preflight problems : 0`, positively witnessing that item `B`'s early exit did **not** fire.
**Committed, re-ran, `1 passed`.**

**5.3 — the push was BLOCKED by a guard and I did not route around it.**
`SYSTEM-INVENTORY freshness (pre-push)` rejected the push: the map was stale. The hook regenerated it
on disk and then **rolled the fix back** ("stashed changes conflicted with hook auto-fixes"), which
produced an apparent contradiction — `system_inventory.py --check` reported **FRESH** while
`git diff` reported **13 insertions / 11 deletions**. **Not a disagreement:** `--check` compares disk
against a fresh computation, `git diff` compares disk against `HEAD`; the hook had already rewritten
the file on disk. I regenerated explicitly, verified `--check` clean, and committed via the guard's
own prescribed remedy (`1ff32675`). Counts moved `WIRED 3233→3245`, `BUILT-UNREACHABLE 1537→1542`,
`19/19` positive controls pass — the delta is my four new files. **This commit is outside the four
items; it was the mandatory price of publishing, not scope creep.**

**5.4 — my own item-`C` control convicted itself first.** The overclaim detector matched the phrase
inside **the comment explaining why the phrase is wrong**, so it was red for a reason that had nothing
to do with a live claim. **A detector that cannot tell a live claim from a historical note is not a
claim detector.** Tightened to scan non-comment lines, plus an assertion that it read something at all
so it cannot pass vacuously — then red-proofed properly.

**5.5 — pre-existing tree state I did not touch.** `docs/wave25-exit-engine-ab-report.md` was already
modified and the untracked `docs/` files already present when I seated (ruled output-only, not cruft).
**Every commit staged explicit paths; none of it was swept in.**

---

## 6. SEAT / EAR

**My ear is armed and PROVEN in all three legs by live observation this seat** — it refused nothing
absent, armed on a real SHA (`ae44bce7`, not `<absent>`), and **fired on a real move**
(`ae44bce7 → b407f623`, which is how I received AR-1028 without being told). ⚠️ **Two orphan ears
(`13092`, `26880`) are still polling from dead parent seats** — `[MEASURED]` by `Win32_Process` +
parent walk; **only one `claude.exe` (`20432`) is alive, and it is mine.** I did not arm them, so I
did not kill them.

---

## 7. THE EXIT, AND I AM NOT DECLARING IT MYSELF

All four `R3-5` items have durable RED→GREEN / discriminating evidence and **no STOP is active**.
Per AR-1027 §7 that is the condition for **`R3-5 CLOSED` → `R3 = 5/5` → Phase 5 referee engineering
CLOSED**. ★ **I am reporting the condition as met, not certifying it** — the ruling reserves that
declaration, and `0-CTRL.6` forbids me to certify `RATIFY` or promote.

**No `R3-6` invented.** The next engineering unit, unless GPT redirects:
**`MP1-CANDIDATE-INGRESS-1` → persisted candidate/config authority → DB → `/api/backtests` → Python
backtester.**

**I am NOT handing off.** Context remains; the seat that exists is the seat that finishes.
