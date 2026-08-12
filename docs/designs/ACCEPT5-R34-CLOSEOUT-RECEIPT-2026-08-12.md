# `ACCEPT5-R34-CLOSEOUT-RECEIPT-1` — the ONE canonical closeout under the successor disposition contract

**Authority:** GPT ruling `AR-1026 §6`–`§7` (`external-advisor/gpt-rulings` `a83ac207`).
**Successor disposition seal:** `acceptance-disposition-seal-8f04a42f.json`, committed `08aa7a9f`.
**Durable authority-map receipt:** `858506cf`. **Row-20 conversion:** `f5b9a89c`.
**Arm pin:** `08aa7a9f` — `arm_start_head == arm_end_head == head == 08aa7a9f`
⇒ `[MEASURED]` **the tree did not move under the arm.**

## 1. THE INVOCATION — CANONICAL, NO MODIFIERS

```bash
python scripts/accept5_isolated_runner.py --out-dir C:\Users\tonio\a5close
```
✅ **No `--reverse`, no `--reverse-nodes`, no `--limit`, no `--no-layer2`** — and this is asserted from
the artifact's own fields, not from the command I typed: `layer2 = True` · `reverse = False` ·
`limited_subset = False`. ★ **`A FLAG I DID NOT PASS IS A CLAIM; THE ARTIFACT'S OWN FIELD IS THE
EVIDENCE.`** Wall clock `6.3 min` serial, `108 / 108` children executed.

## 2. THE STRUCTURAL BASELINE — EVERY FIELD `AR-1026 §6` NAMED

| field | required | `[MEASURED HERE]` | |
|---|---:|---:|---|
| children | `108` | `108` | ✅ |
| nodes | `2420` | `2420` | ✅ |
| passed | `2386` | `2386` | ✅ |
| failed | `32` | `32` | ✅ |
| xfailed | `2` | `2` | ✅ |
| **non-pass total** | `34` | `34` | ✅ |
| skipped | `0` | `0` | ✅ |
| errors | `0` | `0` | ✅ |
| xpassed | `0` | `0` | ✅ |
| duplicate node IDs | `0` | `0` | ✅ |
| collected-but-unexecuted | `0` | `0` | ✅ |
| invalid / refused children | `0` | `0` | ✅ |

**The outcome tally is the artifact's own `outcomes` map, `2420` entries, tallied by value:**
`{'passed': 2386, 'failed': 32, 'xfailed': 2}`. **There is no `skipped`, `error` or `xpassed` key —
their zero is an ABSENCE FROM AN ENUMERATED TALLY, not an unmeasured blank.**

## 3. ✅✅ THE DECISIVE CHECK — THE EXACT `34`-NODE SET IS IDENTICAL, AND THE COMPARATOR DISCRIMINATES

`AR-1026 §6` requires the non-pass **ID SET** — not its count — to be identical to the durable receipt.
Joined by **NODE ID**, path separators normalised, against `§3` of
`ACCEPT5-POSTREPAIR-AUTHORITY-MAP-RECEIPT-2026-08-12.md` @ `858506cf`:

```
receipt IDs parsed : 34
closeout non-pass  : 34
ONLY IN RECEIPT    : 0
ONLY IN RUN        : 0
SETS IDENTICAL     : True
POSITIVE CONTROL (drop 1 node from the run set) -> identical? False | diff size 1
```
⭐ **THE POSITIVE CONTROL IS THE POINT.** A comparator that reports `IDENTICAL` on every input reports
nothing. **Planting a single-node deletion flips it to `False` with diff size `1`** ⇒ it discriminates.
★★★★★ **`AN EQUALITY CHECK THAT HAS NEVER BEEN SHOWN A DIFFERENCE IS NOT AN INSTRUMENT.`**

⚠️ **INSTRUMENT NOTE, DISCLOSED:** the first comparator was written as a shell heredoc and the shell ate
its backslashes (`SyntaxError`). **Rewritten as a FILE, with the backslash built via `chr(92)` so no
shell layer can touch it.** `[ps-counting-encoding]`: prefer the form with fewest layers between you
and the thing.

## 4. 🛑 A HASH I ALMOST REPORTED AS A DISCREPANCY, AND IT WAS MY JOIN ERROR

The aggregate reports `manifest_sha256 = 182148ac…`; the successor disposition seal reports
`manifest_sha256 = dc615e39…`. **These are NOT the same object and it is not a movement:**

```
dc615e39…  sha256 of  src/engine/tests/canonical_regression_population.txt   (the seal's field)
182148ac…  sha256 of  <run_root>/manifest.json                               (the runner's field,
                                                                              accept5_isolated_runner.py:562,578
                                                                              -- a JSON the run itself writes)
```
⇒ **Two fields with the same NAME over two different FILES.** ★★★★ **`I READ THE NEIGHBOURING OBJECT
AGAIN — AND THIS TIME I CHECKED THE VARIABLE'S DEFINITION BEFORE PUBLISHING THE ALARM.`**
**Population identity is proven directly by the `34`-node set equality in `§3`, which is stronger than
any manifest hash.**

## 5. VERDICT

**Every gate `AR-1026 §6` named is MET, and none of `§8`'s six STOP conditions fired** — in particular
`[5]` (*the canonical closeout moves any unrelated node or population unexpectedly*) is `[MEASURED]`
**not** fired: `0` nodes moved in either direction.

⇒ **`R3-4 = CLOSED`.** ⇒ **`R3 = 4 / 5 COMPLETE`.**

## 6. WHAT THIS RECEIPT DOES **NOT** ESTABLISH

- **It does not re-adjudicate the `34` non-pass nodes.** Their dispositions are `AR-1024`'s, accepted
  `34 / 34` with `0 UNEXPLAINED`; this arm proves the SET is unchanged, not that each verdict is right.
- **It is one arm, not a reproducibility study.** `AR-1026 §6` ordered exactly one canonical run and
  forbade a five-arm campaign; **no second arm was run, so run-to-run stability is not re-proven here.**
- **`0 skipped` is scoped to this population at this pin on this box.** The row-20 conversion makes a
  MISSING governed grade fail rather than skip; **this arm ran with the grade PRESENT**, so it
  witnesses the preserved-baseline half. The absent-evidence half is witnessed by the RED control in
  census `§14.2`, not by this run.
- **Rows `30`–`32`'s surviving broadcast skip site is untouched and out of scope** (`STOP [11]`); it is
  not a member of this sealed population's skip set.
