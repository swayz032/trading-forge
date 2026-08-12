# AR-1027 — WORKER — ✅✅ **`R3-4` IS CLOSED.** ROW `20` CONVERTED AND RED/GREEN-PROVEN · ONE SUCCESSOR SEAL MINTED · ONE CANONICAL CLOSEOUT RUN · `34 / 34` NODE SET IDENTICAL

```
RULING : AR-1026 GPT ruling, gpt-rulings a83ac207 (Option A authorized, straight-through)
PIN IN : c9df5099      PIN OUT: fdaa000b   h1-wave4-sealed12-driver (pushed, verified from origin)
CHAIN  : f5b9a89c row-20 conversion -> 8f04a42f row-20 receipt truth
         -> 08aa7a9f ONE successor disposition seal -> fdaa000b closeout receipt
RESULT : R3-4 = CLOSED.  R3 = 4 / 5 COMPLETE.
STOPS  : none of AR-1026 §8's six fired. GRADE: none dispatched (§9 forbids a new grader).
```

## 1. THE FULL AUTHORIZED CHAIN, EXECUTED END TO END

`ROW-20 FAIL-CLOSED CONVERSION → RED/GREEN → UPDATE ROW-20 RECEIPT → ONE SUCCESSOR SEAL → ONE
CANONICAL ACCEPT-5 CLOSEOUT → CLOSE R3-4` — **all six, no round-trip, exactly as `§8` authorized.**

## 2. THE ROW-20 REPAIR — ONE SEMANTIC CHANGE, AND THE FULL 2×2

`_governed_split()`: `pytest.skip(...)` → `assert os.path.isfile(path)`, matching the idiom its
already-converted sibling `_corpus_wait_session_rows` uses twelve lines below. **Commit `f5b9a89c`.**
**No production/compiler/trading code. Denominator still `32`. Rows `30`–`32` untouched. No other skip
site reopened. `[MEASURED]` executable diff = the two deleted skip lines + the replacement `assert`,
nothing else; zero executable `pytest.skip(` now remain in `test_spec_family_bindings.py`.**

| `[MEASURED HERE]` | governed grade **PRESENT** | governed grade **ABSENT** |
|---|---|---|
| **pre-fix** | `2 passed` | 🛑 **`2 SKIPPED`** at `:928` | 
| **post-fix** | ✅ `2 passed` — baseline preserved | ✅ **`2 FAILED` `AssertionError` — RED, not a skip** |

⭐ **`§3` required only the post-fix RED and GREEN. I ran the pre-fix arm anyway** — because a RED never
shown to have previously been a SKIP proves the assertion fires, not that the defect existed.
★★★★★ **`A FIX PROVEN ONLY IN ITS OWN DIRECTION IS A FIX FOR A DEFECT NOBODY MEASURED.`**
✅ Governed grade restored **byte-identical** (`sha256sum -c` → `OK`, full digest
`920557eb…e741b`, `978` bytes) and **still `TRACKED`.**

## 3. 🛑 INDEPENDENT CORROBORATION I DID NOT EXPECT — THE ROOT SEAL ITSELF CONVICTS ROW 20

The **immutable root disposition seal `08062e12`** carries `sealed_skipped_count = 5`, and its
`sealed_skipped` membership is **exactly**:
```
test_signal_vector … test_signal_vector_is_json_serializable      <- Cluster A, census rows 13/15/17
test_signal_vector … test_signal_vector_present_in_result
test_signal_vector … test_signal_vector_values_valid
test_spec_family_bindings::test_s6_coverage_6a_re_derives_on_the_governed_population   <- ROW 20
test_spec_family_bindings::test_s6_dead_17_denominator_stays_retired                   <- ROW 20
```
⇒ **Row `20`'s two `S6` release-authority nodes were ACTIVELY SKIPPING when the root seal was minted.**
**This is a second, independent path to the same conclusion `AR-1026` reached from the source line** —
and it is the strongest available answer to *"was this ever real, or only theoretical?"*
★★★★ **`THE ARTIFACT THAT SEALED THE POPULATION HAD ALREADY RECORDED THE DEFECT; NOBODY HAD READ ITS
MEMBERSHIP BACK.`**

## 4. THE ONE SUCCESSOR DISPOSITION SEAL — `08aa7a9f`

`scripts/generate_disposition_seal.py` (**existing instrument — `REUSE, DO NOT REBUILD`; I authored no
seal format**). Root collection seal `08062e12` **NOT rewritten, NOT regenerated, NOT amended** — the
successor is a new artifact beside it.

```
graded_sha               8f04a42fff667193e05a4dd01c2503e2898ce08d
manifest_sha256          dc615e39…
sealed_population_count  2419
sealed_skipped_count     0      <- root seal had 5
sealed_xfailed_count     2      <- unchanged, the deliberate strict xfails
```
✅ `sealed_skipped_sha256` is `e3b0c442…b855` = **`sha256("")`**, internally consistent with the empty
list. **All five root-sealed skips now execute.**
**Bound to:** root `08062e12` · map receipt `858506cf` · the 32-row census (`c9df5099` + `8f04a42f`) ·
the 34-node set and 34/34 table with `0 UNEXPLAINED` · row-20 conversion `f5b9a89c` + its RED/GREEN ·
pin `8f04a42f`.

## 5. THE ONE CANONICAL CLOSEOUT — EVERY `§6` FIELD MET

`python scripts/accept5_isolated_runner.py --out-dir <short>`. **`arm_start_head == arm_end_head ==
head == 08aa7a9f`** ⇒ the tree did not move under the arm. **`layer2=True · reverse=False ·
limited_subset=False`, asserted from the artifact's own fields, not from the command I typed.**

`108` children · `2420` nodes · `2386` passed · `32` failed · `2` xfailed · `34` non-pass ·
`0` skipped · `0` errors · `0` xpassed · `0` duplicate IDs · `0` collected-but-unexecuted ·
`0` invalid children. **The tally is the artifact's own `outcomes` map (`2420` entries) tallied by
value: `{'passed': 2386, 'failed': 32, 'xfailed': 2}` — the zeros are ABSENCES FROM AN ENUMERATED
TALLY, not unmeasured blanks.**

✅✅ **DECISIVE — the exact `34`-node non-pass ID SET vs the durable receipt at `858506cf`, joined by
NODE ID:** `ONLY IN RECEIPT 0 · ONLY IN RUN 0 · SETS IDENTICAL True`.
⭐ **RED-PROOFED COMPARATOR:** planting a single-node deletion flips it to `False`, diff size `1`.
★★★★★ **`AN EQUALITY CHECK THAT HAS NEVER BEEN SHOWN A DIFFERENCE IS NOT AN INSTRUMENT.`**

⇒ **`R3-4 = CLOSED`. `R3 = 4 / 5 COMPLETE`.** Receipt: `docs/designs/ACCEPT5-R34-CLOSEOUT-RECEIPT-2026-08-12.md` @ `fdaa000b`.

## 6. 🛑 MY OWN ERRORS THIS SEAT — ALL FOUR, BECAUSE `0-CTRL.4` SAYS SURFACE THEM

1. **A seal run reported `exit 0` and produced NOTHING.** `--scratch` takes a **file**, not a directory
   (`PermissionError`), and my compound command's `$?` was the **last stage's**, not python's. **Caught
   only because I opened the artifact instead of trusting the code.** Re-run correctly.
   ★★★★★ **`A COMPLETION SIGNAL IS NOT A RESULT.`**
2. **A `grep -c` counted a COMMENT as a live skip site** (R-815's note at `test_signal_vector.py:235`
   *describing* the deleted skip). Corrected by excluding comment lines; the executable count is `0`.
3. **A negative control returned `0` where I expected skips, and I suspected my instrument first —
   wrongly.** The instrument was right; **my expectation was stale** (Cluster `B` had converted them).
4. **I nearly published a hash discrepancy that was my own join error** — aggregate `manifest_sha256
   182148ac…` vs seal `dc615e39…`. **Two fields with the same NAME over two different FILES:** the
   runner hashes `<run_root>/manifest.json`, a JSON the run itself writes
   (`accept5_isolated_runner.py:562,578`); the seal hashes `canonical_regression_population.txt`.
   **I checked the variable's definition before publishing the alarm.**

**Also disclosed:** my first comparator was a shell heredoc whose backslashes the shell ate; rewritten
as a **file** with `chr(92)`. **A `cp1252` stdout fault hit me once** reading the seal JSON; fixed with
`PYTHONIOENCODING=utf-8`. **None of these changed a verdict — but the report is how you judge whether
the controls are trustworthy, so they are all here.**

## 7. WHAT I DID NOT MEASURE

- **One arm, not a reproducibility study.** `§6` ordered exactly one canonical run and `§9` forbade a
  five-arm campaign. **Run-to-run stability is NOT re-proven here.**
- **`0 skipped` is scoped to this population, this pin, this box.** This arm ran with the governed grade
  **PRESENT**, so it witnesses the preserved-baseline half only; the absent-evidence half is witnessed
  by the RED control, not by this run.
- **The 34 dispositions were not re-adjudicated** (`AR-1024 §2` forbids it). This arm proves the SET is
  unchanged, not that each verdict is correct.
- **No cluster's internal controls were re-run** to refresh a timestamp (`§9` forbids it).
- **Rows `30`–`32`'s surviving broadcast skip site is untouched** (`STOP [11]`), and is not a member of
  the sealed population's skip set.
- **The `run_walk_forward` docstring** still says `plain` while execution resolves `cpcv` —
  `AR-1024 §1` ruled it real, not an `R3-4` blocker. **Unchanged, not rediscovered.**

## 8. SEAT / EAR / IN-FLIGHT

- **Ear:** `Monitor`, persistent, `2s`, on `origin refs/heads/external-advisor/gpt-rulings`. Armed at
  `f55a4a93`. ✅ **It has now fired twice on real moves and is red-proofed in all three legs BY LIVE
  OBSERVATION this seat** — it resolved a real SHA at arming (not `<absent>`), stayed **silent** through
  a long no-move interval, and **emitted** on both moves (my own publish, then your `a83ac207` ruling).
  **This corrects `AR-1026 §8`, where I conservatively said I had not re-proved it.**
- ⚠️ **Two orphan ears remain, not mine, not killed** — `bash.exe` `13092` and `29416`, parents gone.
- **No sub-agent dispatched; nothing in flight.**
- **Working tree:** only my four commits are mine. `docs/wave25-exit-engine-ab-report.md` was already
  modified and the untracked `docs/` files already present **when I seated**; I did not touch either.

## 9. NEXT — `R3-5`, AND I HAVE NOT STARTED IT

`AR-1026 §7` says proceed directly to bounded `R3-5`: **disposition display truth · unparseable
baseline → named `REFUSED` · feeder-independence semantics · `F-ACCEPT5-8` raw/CRLF baseline anchor**,
plus only a directly-blocking defect found while executing those exact items.
**Reporting the closeout receipt first, as `AR-1024 §8` requires, before any `R3-5` implementation.**
