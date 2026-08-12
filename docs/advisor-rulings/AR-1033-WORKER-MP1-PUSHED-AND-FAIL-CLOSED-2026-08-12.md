# AR-1033 — WORKER — MP1 REPAIR PUSHED AND ORIGIN-VERIFIED · DB-AUTHORITY FAIL-OPEN CLOSED RED→GREEN

```
RULING     : AR-1032 (gpt-rulings 0cf17157) §3 push, §4/§5 fail-closed, §10 exit
FINAL SHA  : d2f222531ef973e9e9d651cbfdad948cbbb1772b   origin/h1-wave4-sealed12-driver
REPAIR SHA : 4f5a581582c35407d95bf3143340941d2973cc81   (parent 3be07ddc, UNMODIFIED)
STATE      : both required actions complete. No STOP fired. No grader dispatched (§8).
```

## 1. §3 — THE EXACT REPAIR IS PUSHED, VERIFIED FROM THE REMOTE

`4f5a5815` was pushed **byte-unchanged** — not recreated, not amended, nothing folded in.
All five `§3` checks, re-read from `origin` after `git fetch`:

| check | result |
|---|---|
| SHA resolves on origin | ✅ `git cat-file -t 4f5a5815` → `commit` |
| parent is `3be07ddc` | ✅ `git rev-parse 4f5a5815^` → `3be07ddc043faa82c5a6291345b669aece57e968` |
| production files as claimed | ✅ `src/server/routes/backtests.ts` (+139/−3), `src/engine/backtester.py` (+135/−0) |
| the two MP1 test files present | ✅ `mp1-candidate-ingress.test.ts` (+283), `test_mp1_backtester_ingress.py` (+299) |
| **not** the reverted broad Ruff rewrite | ✅ **0 deletions** in `backtester.py`; the only type annotation on an ADDED line is my own `Optional[dict]` |

⚠️ **ONE INSTRUMENT CORRECTION, MINE.** My first probe for the Ruff rewrite grepped the whole diff
for `dict | None` and returned `1`. That match is a **hunk-header context line**
(`@@ … def _rescore_with_crisis(result: dict, crisis: dict | None, …)`) — pre-existing code, not an
added line. Re-run against added lines only: the rewrite is confirmed absent.
★ `A GREP OVER A DIFF SEES THE CONTEXT TOO; THE HUNK HEADER IS NOT YOUR CHANGE.`

## 2. ⚠️ TWO COMMITS I DID NOT ASK FOR — DISCLOSED BECAUSE §3 SAID "WITHOUT OPPORTUNISTIC EDITS"

**A pre-push hook blocked the push twice:** `SYSTEM-INVENTORY freshness (pre-push)` — exit 1,
*"PUSH BLOCKED — docs/designs/SYSTEM-INVENTORY.md was STALE."* Its prescribed remedy is a commit.

**I did NOT fold this into `4f5a5815`.** It is two separate, isolated commits
(`git commit -o docs/designs/SYSTEM-INVENTORY.md`), touching that one generated file and nothing
else. The pushed branch is therefore four commits, not two:

```
d2f22253  SYSTEM-INVENTORY: regenerate after MP1 fail-closed repair   <- guard
2f9c8afa  MP1: fail closed when the strategy-authority DB read fails  <- §4 repair
144159c5  SYSTEM-INVENTORY: regenerate after MP1 candidate ingress    <- guard
4f5a5815  MP1-CANDIDATE-INGRESS-1: persisted candidate identity ...   <- §3 repair, untouched
3be07ddc  (the pre-MP1 pin)
```

**No `--no-verify` was used at any point.**

### And that guard produced a THIRD independent path onto §1's finding

`SYSTEM-INVENTORY.md` is a generated reachability map, written by no test of mine. Its own
classification of `resolve_row_for_execution` moved across the repair:

```
BEFORE (blob at 3be07ddc)  §7.2 All BUILT-UNREACHABLE
                           "no non-test reference outside its own definition;
                            1 test file(s) do reference it"
AFTER  (blob at d2f22253)  §8. WIRED - has a non-test caller and a static path
                           from an entry point
                           ... and 0 occurrences remain in BUILT-UNREACHABLE
```
`19/19` positive controls pass in both generations. **`AR-1032 §2.5`'s "activation defect, not a
missing candidate system" is now confirmed by an instrument that has no stake in my claim.**

## 3. §4/§5 — THE FAIL-OPEN IS CLOSED

**RED WITNESS, on the real route handler, pre-repair** — `§5` control 1:

```
control 2: AssertionError: expected 202 not to be 202
control 6: AssertionError: expected 'Failed to load strategy from DB'
                                 to be 'strategy_authority_unavailable'
```
★ The first line **is** the fail-open, witnessed rather than argued: strategy-authority read throws
+ request supplies `strategy` ⇒ the route returned **202 and launched the backtest**.

**REPAIR** (`backtests.ts`, the `catch` on the strategy lookup): return **`503
strategy_authority_unavailable`**, before `_acquireBacktestSlot()` and before `runBacktest`/Python.
No retries, no cache, no fallback store, no second manual-strategy path. Legacy status is never
inferred; a request-body `strategy` is never accepted as a substitute.

**`§5` CONTROL SET — 6/6, all in the existing harness, no new framework:**

| # | control | result |
|---|---|---|
| 1 | RED witness: DB throws + request strategy ⇒ pre-fix proceeds | ✅ witnessed (202) |
| 2 | GREEN: same arm ⇒ non-202 `strategy_authority_unavailable`, before slot & spawn | ✅ `runBacktest` spy **not called** |
| 3 | candidate-aware exact match still GREEN | ✅ 202, exact four fields reach `runBacktest` |
| 4 | candidate-aware + request `strategy` still refused | ✅ `409 candidate_authority_conflict` |
| 5 | legacy row, successful read, unchanged | ✅ 202, still honours a request override |
| 6 | DB failure with no provided strategy still refused | ✅ non-202, not weakened |

**Plus one control `§5` did not ask for, because collapsing two states would have been the easy
bug:** a **successful** read returning **no row** still returns `404` and is **not** given the
outage code. `AN OUTAGE IS NOT EVIDENCE OF ABSENCE. IT IS ABSENCE OF EVIDENCE.`

## 4. §10 GREEN SET, AT THE FINAL PIN `d2f22253`

| suite | result |
|---|---|
| `mp1-candidate-ingress.test.ts` (11 MP1 + 2 new fail-closed arms + 2 discriminators) | **13 / 13** |
| `test_mp1_backtester_ingress.py` | **11 / 11** |
| `test_mp1_candidate_receipt.py` + `test_mp1_candidate_persistence.py` (the 25 obligations) | **25 / 25** |
| `npx tsc --noEmit`, whole repo | **0 errors** |
| 7 adjacent backtest suites | **59 / 59** |

**Mutation red-proof (carried from AR-1032 §3, unchanged instrument):** neutering the Python gate
kills 9 of 11; the 2 survivors are the *"proceeds"* assertions, which should survive.

**No dependents on the removed behaviour:** `grep -rn "Failed to load strategy from DB" src/ --include=*.ts`
returns nothing — no test or caller relied on the old fail-open string or path.

## 5. WHAT I STILL HAVE NOT MEASURED

- **No live Postgres, no live `/api/backtests`, no candidate-aware full backtest.** `§6` accepts
  contract-level proof for the DB→route field join and `§7` excludes execution use; I did not
  quietly extend beyond either.
- **`§7` honoured literally:** Python proves the row and then **discards** the returned
  `OpeningRangeExecutionCandidate`. No Opening Range semantics were smuggled in to make the
  validator look useful. Trading behaviour is byte-unchanged.
- **`EDGE-HTF-PASSTHROUGH-AUTHORITY-1` untouched** (`§9[7]` did not fire). The nine-field strategy
  whitelist at `backtests.ts:187-197` is exactly as it was.
- **The fail-closed `catch` is scoped to the whole strategy-lookup try block**, so a throw in the
  `resolvedStrategy` reconstruction — not only in the DB call itself — now also refuses. I judged
  that correct under `§4` ("if the route cannot read the persisted strategy row"), but it is
  marginally broader than "the DB read", and I am naming it rather than letting it pass as exact.
- **No `STOP` fired.** `§9[1]` in particular: the pushed diff matches AR-1032's description, which
  §1 above verifies from origin rather than from my own working tree.

## 6. GRADE

**None dispatched**, per `§8`. Every decisive claim above is mechanical and re-derivable from the
pushed diff plus the listed commands.

## 7. REPRODUCE AT `d2f22253`

```bash
git fetch origin h1-wave4-sealed12-driver && git checkout d2f22253
npx vitest run src/server/routes/__tests__/mp1-candidate-ingress.test.ts
python -m pytest src/engine/tests/test_mp1_backtester_ingress.py \
                 src/engine/tests/test_mp1_candidate_receipt.py \
                 src/engine/tests/test_mp1_candidate_persistence.py -q
npx tsc --noEmit
```

**`§10`'s four conditions are met and the final remote SHA is `d2f22253`.** Handing the close
decision to GPT. The ear stays armed on this branch.
