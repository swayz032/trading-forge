# `ACCEPT5-R35-CLOSEOUT-RECEIPT-1` — the ONE final canonical arm certifying `R3-5`

**Authority:** GPT ruling `AR-1029 §4`–`§7` (`external-advisor/gpt-rulings` `ac75c9b6`).
**Compared against:** the accepted `R3-4` canonical receipt at `fdaa000b` and the durable
authority-map receipt `858506cf` (`ACCEPT5-POSTREPAIR-AUTHORITY-MAP-RECEIPT-2026-08-12.md §3`).
**Arm pin:** `1ff32675` — `arm_start_head == arm_end_head == head == 1ff32675`
⇒ `[MEASURED]` **the tree did not move under the arm.**

## 1. THE INVOCATION — CANONICAL, NO MODIFIERS

```bash
python scripts/accept5_isolated_runner.py --out-dir C:\Users\tonio\a5\out
```

✅ **No `--reverse`, no `--reverse-nodes`, no `--limit`, no `--no-layer2`, no second arm** — and this
is asserted from **the artifact's own fields**, not from the command I typed:

```
layer2 = True   ·   reverse = False   ·   limited_subset = False
reverse_nodes = False   ·   ownership_blind = False
```

★ **`A FLAG I DID NOT PASS IS A CLAIM; THE ARTIFACT'S OWN FIELD IS THE EVIDENCE.`**

Wall clock `380.9 s` (`6.3 min`) serial, `108 / 108` children executed — the same cost as the `R3-4`
arm, as `AR-1029 §2` predicted.

## 2. THE STRUCTURAL BASELINE — EVERY FIELD `AR-1029 §5` NAMED

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

Cross-check on the same artifact: the `nodes` field (`2420`) and the `outcomes` map length (`2420`)
agree, so the count is not one field asserting about another.

## 3. ✅✅ THE DECISIVE CHECK — THE EXACT `34`-NODE SET IS IDENTICAL, AND THE COMPARATOR DISCRIMINATES

Joined by **NODE ID**, path separators normalised, against `§3` of the durable authority map
`858506cf`:

```
receipt IDs parsed : 34
arm non-pass       : 34
ONLY IN RECEIPT    : 0
ONLY IN RUN        : 0
SETS IDENTICAL     : True
POSITIVE CONTROL (drop 1 node from the run set) -> identical? False | diff size 1
```

⭐ **THE POSITIVE CONTROL IS THE POINT.** A comparator that reports `IDENTICAL` on every input reports
nothing. Planting a single-node deletion flips it to `False` with diff size `1` ⇒ it discriminates.
★★★★★ **`AN EQUALITY CHECK THAT HAS NEVER BEEN SHOWN A DIFFERENCE IS NOT AN INSTRUMENT.`**

## 4. `AR-1029 §6` STOP CONDITIONS — EACH CLEARED

| # | condition | result |
|---|---|---|
| 1 | any structural count changes unexpectedly | **none changed** — `§2`, all twelve |
| 2 | the exact 34-node non-pass ID set differs | **identical** — `§3`, both directions `0` |
| 3 | canonical valid baseline refused by the new anchor/refusal logic | **not refused** — no `BASELINE_UNREADABLE` / `BASELINE_UNPARSEABLE` / `BASELINE INTEGRITY` / `ACCEPTANCE: REFUSED` / `INSTRUMENT REFUSED` / `Traceback` anywhere in the arm log, **and the grep was positive-controlled** against a token that must appear |
| 4 | runner crashes, ambiguous verdict, or cannot name the tree | **exit `0`**, and its first log line names the tree: `HEAD 1ff32675… \| children 108 \| order canonical` |
| 5 | an R3-5 repair forces a governed production/compiler/trading semantic change | **none** — `scripts/acceptance_runner.py` + four non-governed tests only |

**No STOP fired.**

## 5. INSTRUMENT NOTES, DISCLOSED

Three of my own invocation errors, none of which touched the result but all of which cost attempts:

1. **The first launch never ran.** I wrote the log to `C:\` root — `Permission denied`, exit `1`.
   Corrected to a short writable path under the user profile.
2. **My comparator's discovery filter was wrong**, requiring a `duplicates` key the aggregate does not
   have (it is `duplicate_nodes`, an int, and `children` / `collected_but_unexecuted` are ints too,
   not lists). **I inspected the artifact's real schema rather than guessing again**, then corrected
   the comparator to the actual fields.
3. **Two different path-translation behaviours in one shell.** Git Bash rewrites a bare `/c/...`
   argument into a Windows path, but *not* one quoted inside `python -c "..."`. The same path
   therefore resolved in the comparator and raised `FileNotFoundError` in the inspection command.

⚠️ The comparator was written **as a FILE with the separator built via `chr(92)`**, because the
`R3-4` closeout's first attempt was a shell heredoc and the shell ate its backslashes.
`[ps-counting-encoding]`: prefer the form with fewest layers between you and the thing.

🛑 **The `manifest_sha256` field names two different files** (runner = its own generated
`manifest.json`; seal = `canonical_regression_population.txt`). **A mismatch there is NOT a movement**
and was not treated as one. Population identity is proven directly by the `34`-node set equality in
`§3`, which is stronger than any manifest hash.

## 6. VERDICT

The one final canonical arm **matches the accepted `R3-4` authority state exactly** and **no STOP
fired**. Under `AR-1029 §7` this receipt discharges the closure condition:

**`R3-5 = CLOSED` · `R3 = 5 / 5 CLOSED` · `PHASE 5 REFEREE ENGINEERING = CLOSED`**

There is no `R3-6`. The next unit is **`MP1-CANDIDATE-INGRESS-1` → persisted candidate/config
authority → DB → `/api/backtests` → Python backtester** — the money path.
