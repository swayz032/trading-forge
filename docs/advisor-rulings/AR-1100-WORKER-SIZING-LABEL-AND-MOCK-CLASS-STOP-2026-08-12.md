# AR-1100 (worker) — STEP 1 DONE. STEP 2 IS A CLASS OF 23, NOT A FILE — STOPPING ON THE FORK.

**Governing:** AR-1099 §2, §3, §8, §10 · **Pin:** `70d73d66`

---

## 1. YOUR §2 CORRECTION — ACCEPTED, AND I VERIFIED IT RATHER THAN TAKING IT

I claimed the empty `SCALING_PLANS` meant Trading Forge has no scaling plan. **Measured, you are
right and I was wrong:**

- **`CLAUDE.md:15`** — *"**Contract pyramid** — base 9 MES / 9 MNQ / 18 MCL → risk-cap-bounded
  ceiling, 50-micro final cap; +3 per tier via proven-trades ramp … Growth is primarily
  HORIZONTAL."*
- **`docs/scaling-plan-baby-mode.md`** exists and defines it: *"Size from the BUFFER, not the account
  label"*, base/ramp/caps/payout-aware re-sizing, horizontal replication.

R-059 retired **one fictional mechanism** (a Topstep account auto-upgrading 50K→100K→150K on
profit). The doctrine itself is alive.

★ **`AN EMPTY REGISTRY MEANT ONE MECHANISM WAS RETIRED, NOT THAT THE DISCIPLINE DOES NOT EXIST —
AND I TURNED THE FIRST INTO THE SECOND.`**

⚠️ One thing that same doc says, relevant to your §5 Surface B: *"Backtester sizes **statically** —
it does NOT play the pyramid out over a run; no harness threads profit forward across folds"* →
*"we cannot yet **prove** a scaling schedule on real data."* So Surface B is not merely unwired; its
validation harness is itself an open unit.

---

## 2. STEP 1 — DONE

`sizing_owner` for the absent-command fallback is now **`ENGINE_DEFAULT`**. `sizing_mode`,
`sizing_plan_id=None` and `sizing_source` unchanged; `TRADING_FORGE_SCALING` is left **reserved**.
The test that asserted `== "TRADING_FORGE"` now asserts `== "ENGINE_DEFAULT"` **and** `!=
"TRADING_FORGE"`, with the old assertion and my faulty reasoning quoted in its docstring rather than
deleted. 13/13 green.

---

## 3. STEP 2 — 🛑 STOPPING. THE MOCK LEAK IS A CLASS OF 23 FILES, AND YOUR §8 SCOPED ONE.

I removed the stub from `test_black_swan_evaluator.py` as authorized. **Its stated premise is
measurably dead:**

```
$ grep -nE '^import vectorbt|^from vectorbt' src/engine/backtester.py      -> NO MATCHES
$ python -c "import src.engine.black_swan_evaluator, sys; print('vectorbt' in sys.modules)"
False
```

backtester's vectorbt import is lazy and in-function **by design**, so there is no JIT hang to guard.
31/31 green afterwards, in 1.9s, no hang.

**But your §8.5 acceptance test — "run the relevant source suite under whole-directory collection" —
STILL FAILS.** Measured after the removal:

```
next culprit: test_deepscan14_cf_commission_sentinel_b2_closure.py:46
    _install_vbt_mock()      # module scope; assigns sys.modules[mod] through a VARIABLE
```

⚠️ **My first enumeration missed it** because it greps the literal string `"vectorbt"` next to
`sys.modules`, and that file assigns through a loop variable. **The class enumerated by CAPABILITY
(imports vectorbt · uses MagicMock/ModuleType · touches sys.modules) is 23 files.**

### 🛑 AND THIS CLASS WAS ALREADY CONVICTED ONCE

`test_wave_a_pbo_fail_closed.py:15-20` carries deep-scan B's comment, verbatim:

> *"the old module-level `sys.modules.setdefault("vectorbt", MagicMock())` was unnecessary here AND
> leaked a PERMANENT vectorbt stub into sys.modules that poisoned later same-process tests needing
> REAL vectorbt (e.g. test_pnl_accuracy commission math → 3 spurious failures when this file ran
> before it)."*

**Same mechanism, same remedy, same file family — one member closed, the condition never
enumerated.** That is the named pattern on this desk, and it has now cost two separate
investigations.

### WHAT I DID AND THEN UNDID — DISCLOSED, NOT TIDIED

I removed the stub from **7 further files** and measured them green (157 passed, no hangs) — then
**reverted all 7**, because:

1. your §8 authorized **one** file, and 7 more is a sweep (§0 closes `SWEEP-*` lanes);
2. touching them surfaced **unrelated pre-existing lint** (`E702`, `F841`, `I001`) that the hook then
   demanded I fix — polishing files this unit has no business in;
3. **closing 8 of 23 still fails your acceptance test**, so the cost bought nothing.

★ **`FIXING A MAJORITY OF A CLASS BUYS NOTHING WHEN THE ACCEPTANCE TEST IS ALL-OR-NOTHING.`**

### MY RECOMMENDATION — ONE GUARD, NOT 23 EDITS

Do **not** authorize 23 file edits. A single session-scoped `conftest.py` guard can make the whole
class impossible: snapshot `sys.modules["vectorbt"]`, and **refuse (loudly) when a test executes a
real class backtest while `vectorbt` resolves to a mock**. That converts a silent `int(MagicMock())
== 1` into a named error, is one file, and cannot rot as new test files are added. ⚠️ It is
*test-instrument* work, not production, and I have **not** built it — it is a design choice on a
surface you own.

---

## 4. ONE FORCED CLEANUP, DISCLOSED

To land the authorized change, the pre-commit hook required me to clear **pre-existing** lint in that
same file: three `F841` unused-variable assignments and import ordering. I removed the unused
assignments (the calls remain) and let ruff sort the imports. **That is unrelated cleanup I did not
choose** — it was the price of committing the authorized edit, and I am naming it rather than
letting it ride inside the diff.

---

## 5. STEP 3 (F-3) NOT STARTED

Your §10 orders Step 3 after Step 2, and Step 2 has forked. F-3 is untouched: an unresolved trade
still counts as a closed loss and still drags `win_rate` 100% → 66.67%. **I did not start it**
rather than run it on an instrument you have not yet ruled trustworthy.

---

## 6. MEASURED STATE

- **Source suites (10 files, BY PATH): `200 passed`.**
- **Canonical population: `32 failed / 2387 passed / 2 xfailed`, member-list diff EMPTY both
  directions** vs `66c9a476`.
- 🛑 **WHOLE-DIRECTORY COLLECTION: STILL CONTAMINATED. I am not reporting a whole-suite green, and
  the 200 above is a by-path number.**
- **No performance/edge run. None authorized. None attempted.**

**Awaiting your ruling on the mock-class fork before Step 3. Pin `70d73d66`.**
