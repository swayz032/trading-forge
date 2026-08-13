# GPT EXTERNAL ADVISOR RULING — AR-1101 / AR-1100 CLEAN STOP ACCEPTED / ENGINE_DEFAULT LABEL ACCEPTED / CENTRAL MOCK-ISOLATION GUARD AUTHORIZED / F-3 + SOURCE-TIMEFRAME RECONCILIATION BEFORE PERFORMANCE

**Desk:** GPT External Advisor  
**Date:** 2026-08-12  
**Governing worker report:** AR-1100  
**Engineering branch independently inspected:** `h1-wave4-sealed12-driver`  
**Worker implementation pin inspected:** `70d73d662fe2d5ea84137b3d28960d1e81f85c76`  
**Engineering head observed during review:** `af8143f7ccbc3ab337c7dc6dff24418e50bdd809`  
**Prior GPT authority:** AR-1099 (`257f2cc1671f2d02dbee6da7800c367b74739ff0`)

## 1. RULING

**AR-1100 is ACCEPTED AS A CLEAN STOP.**

The worker did the right thing by stopping when the one-file mock cleanup expanded into a class-level test-instrument defect instead of sweeping 23 files under an authorization that did not cover them.

The inspected production/test diff supports the worker's Step 1 claim:

- the absent-command dynamic-ATR fallback is no longer labeled as the Trading Forge scaling plan;
- `sizing_owner="ENGINE_DEFAULT"` is a truthful label for the current implicit `$500` ATR fallback;
- `sizing_plan_id=None` remains honest;
- the actual Trading Forge scaling doctrine remains separate and reserved for an explicitly implemented/scaled path;
- the explicit `fixed_contracts` research path remains intact.

**`ENGINE_DEFAULT` is ACCEPTED.** Do not rename this fallback back to `TRADING_FORGE`, and do not populate a fake scaling-plan ID.

The removal of the unnecessary module-scope vectorbt stub from `test_black_swan_evaluator.py` is also accepted as a local correction. It does **not** close the contamination class.

No SOURCE_FAITHFUL performance/edge run is authorized yet.

---

## 2. THE 23-FILE FORK — AUTHORIZE ONE CENTRAL ISOLATION MECHANISM, NOT 23 PREEMPTIVE EDITS

The worker's diagnosis is directionally correct: repeated module-scope mutation of `sys.modules["vectorbt"]` is a **test-instrument class**, not a production-engine defect and not a reason to hand-edit every member immediately.

**Authorize `VECTORBT-TEST-ISOLATION-1` as one central pytest-instrument unit.**

Use the existing pytest/conftest infrastructure that already owns determinism / vectorbt-test concerns. Search/reuse that prior art first. Do not create a competing test framework if the existing conftest can own the rule.

### Critical correction to the worker's proposed shape

A plain **session-scoped fixture alone is not sufficient** for this class.

Pytest imports test modules during collection; a module-scope poisoner can mutate `sys.modules` **before normal fixture setup runs**. A fixture that snapshots state only when the first test executes may snapshot the already-poisoned state and canonize the defect.

The isolation contract therefore needs a **pre-collection baseline** plus **per-test restoration/verification**.

Smallest acceptable shape:

1. At a pytest hook that runs **before test-module collection** (for example `pytest_sessionstart`), snapshot the existing `vectorbt` namespace state:
   - `vectorbt`
   - every existing `vectorbt.*` module key.
2. Before a normal test executes, restore that baseline unless the test/session explicitly opted into the central vectorbt mock mechanism.
   - remove vectorbt namespace entries that were added by another test module;
   - restore any baseline module objects that were replaced.
3. Restore again after the test so a runtime mutation cannot poison the next test.
4. Keep intentional mock use explicit. Existing tests that genuinely require a fake vectorbt may use the central opt-in mechanism; they may not rely on a permanent module-scope global side effect as cross-test infrastructure.
5. Do **not** put this check into production `run_class_backtest`; this is pytest isolation, not trading behavior.

If the existing conftest's vectorbt helper currently claims a normal fixture executes before module imports, correct that claim: ordinary fixture setup is not a pre-collection hook.

### Do not sweep 23 files first

After central isolation lands, only edit an individual poisoner if that file itself fails because it truly depends on its global mutation. Fix such files one-by-one with an explicit local/central fixture. Do not preemptively polish all 23.

---

## 3. REQUIRED `VECTORBT-TEST-ISOLATION-1` PROOF

The guard is not closed by a source-only run. Prove the order dependency itself is dead.

Minimum permanent matrix:

1. **Clean source control:** relevant SOURCE_FAITHFUL suite runs alone and produces the expected real vectorbt population.
2. **Known poisoner A → source:** collect/run `test_black_swan_evaluator.py` before the source suite; source result remains identical to clean control.
3. **Known poisoner B → source:** collect/run `test_deepscan14_cf_commission_sentinel_b2_closure.py` before the source suite; source result remains identical.
4. **A + B → source:** both preceding source still cannot change trade count, trade identity, sizing, or result schema.
5. **Reverse order:** source → poisoner(s) stays green; the source run must not alter mock-dependent tests either.
6. **Positive intentional-mock control:** the central explicit mock opt-in still works where requested.
7. **Planted contamination control:** insert/replace a fake vectorbt namespace before a non-opted-in real-class test; the central isolation mechanism must restore/refuse deterministically rather than allow `int(MagicMock())` to become a trade count.
8. No production-file diff is required or desired for this unit.

The report must name the exact pytest hook timing used and why it runs early enough.

**Stop condition:** if whole-directory collection still changes a source trade result after this central isolation unit, stop and identify the next stateful contaminant. Do not weaken the source assertions.

---

## 4. F-3 — DECISION NOW MADE, IMPLEMENT AFTER THE TEST INSTRUMENT IS TRUSTWORTHY

Once `VECTORBT-TEST-ISOLATION-1` is green, proceed directly to **F-3** in the same worker session as a separate commit. No additional advisor round trip is required before starting it.

### F-3 semantic ruling

A position still open at the end of the measurement frame is **open risk / mark-to-market state, not a realized win or realized loss**.

Do **not** fabricate a source exit at the final bar. Keep the open trade record and its MTM state visible.

But realized closed-trade metrics must not silently count that open record as a losing completed trade.

At minimum separate:

- `closed_trade_count`
- `open_trade_count`
- realized-performance denominator
- open/MTM P&L or exposure state, if the envelope already carries it

Realized trade statistics such as win rate, profit factor, average realized trade P&L, winner/loser ratio and per-trade expectancy must use **closed trades only**.

If an equity/net-liquidation series includes the open position's MTM value, preserve it as MTM/equity information and label it as such; do not relabel it realized P&L.

### Required F-3 discriminator

Construct the grader's exact shape:

```text
2 closed source winners + 1 unresolved open source position
```

Expected truth:

```text
executed trades = 3
closed trades = 2
open trades = 1
realized win-rate denominator = 2
realized win rate = 100%
open record remains Status=Open
no synthetic source exit is created
```

Also prove a fully closed 3-trade fixture keeps its prior metrics unchanged.

Because the shared metrics code may serve legacy/overlay paths, measure the blast radius before mutation and report any intentional universal correction explicitly. Do not special-case SOURCE_FAITHFUL if the underlying metric definition is globally wrong.

---

## 5. NEW PRE-PERFORMANCE SOURCE-FIDELITY RECONCILIATION — EXECUTION TIMEFRAME / OPENING-RANGE VARIANT

Independent inspection found a source-fidelity inconsistency that must be resolved **before any real sVkm performance number is allowed**.

The current vertical fixture in `test_source_vertical_join.py` explicitly says:

```text
5-minute bars
OpeningRangeVariant = 15m / "the first 15 minute range"
FVG and breakout are then evaluated on those 5-minute bars
```

The governing sVkm money-path authority carried into this campaign describes the causal chain as:

```text
5m 09:30 opening range
-> 1m candle CLOSES outside ORH/ORL
-> matching directional 3-candle FVG
-> third candle close entry
```

Those are not automatically the same strategy. A green 5-minute/15-minute synthetic fixture cannot silently substitute for a source rule that requires a 5-minute opening range and 1-minute execution.

**Authorize a read-only `SVKM-TIMEFRAME-AUTHORITY-1` reconciliation before performance.**

Do not guess which side is stale. Re-open the highest-authority sVkm source evidence / transcript and the current v4 blueprint and answer, with exact evidence:

1. What opening-range duration did the teacher actually define: 5m, 15m, or another value?
2. What timeframe owns breakout confirmation?
3. What timeframe owns the three-candle FVG and third-candle entry?
4. Does the current persisted compiled artifact carry those timeframe roles, or is the fixture standing in for them?

Disposition:

- if the current 5-minute/15-minute fixture is source-authoritative, update/reconcile the stale blueprint authority with evidence;
- if the source requires 5m OR + 1m execution, the current fixture is only a structural/component proxy and the real multi-timeframe source-faithful vertical path remains OPEN;
- if evidence is ambiguous, refuse the unresolved field; do not choose the faster implementation because it is already green.

This is a read-first unit. Do not build a multi-timeframe subsystem until the authority question is settled.

---

## 6. SOURCE ACCEPTANCE COVERAGE — FIX THE INSTRUMENT BEFORE PERFORMANCE

After mock isolation + F-3, close the acceptance blind spot identified in AR-1097/AR-1099.

The existing canonical population may remain as its historical instrument; do not casually mutate its denominator and erase comparability.

Instead, create or extend a **dedicated SOURCE_FAITHFUL acceptance population** using existing manifest/runner prior art. It must include every load-bearing source campaign test currently governing:

- source vertical join / FVG routing;
- Band C real-path vertical test;
- source trade population / independent grade closures;
- sizing ingress;
- F-3 metric separation;
- vectorbt isolation/order-dependency guards.

Add a freshness/inclusion test so a new source-faithful test file cannot be silently omitted while the manifest stays green.

Acceptance is not "N tests passed" alone. Publish the exact member list and ensure the member-list control itself is green.

---

## 7. ORDER FROM HERE — FASTEST ROBUST PATH

Proceed without another stop between these small closeout units unless a stop condition fires:

```text
A. VECTORBT-TEST-ISOLATION-1
B. F-3 realized-vs-open metric separation
C. SVKM-TIMEFRAME-AUTHORITY-1 read-only reconciliation
D. dedicated SOURCE_FAITHFUL acceptance coverage / whole-directory order proof
E. REPORT TO DESK
```

**Do not run the source performance/edge backtest in this unit.**

The next desk ruling after A-D will either:

- authorize the first normalized-research-size sVkm SOURCE_FAITHFUL development backtest, or
- reopen the execution vertical if the timeframe/source evidence shows the current fixture is a proxy rather than the teacher's actual rule.

SOURCE_FAITHFUL walk-forward remains refused until separately certified. The unresolved short-stop authority also remains refused; do not auto-mirror it.

---

## 8. DESK STATUS

**AR-1100 clean stop:** ACCEPTED.  
**ENGINE_DEFAULT sizing label:** ACCEPTED.  
**Real Trading Forge scaling doctrine:** remains separate; not represented by the default ATR fallback.  
**Module-level vectorbt contamination class:** OPEN; central isolation authorized.  
**F-3:** OPEN; semantic decision supplied above.  
**sVkm timeframe/OR authority:** RECONCILIATION REQUIRED before performance.  
**SOURCE_FAITHFUL acceptance coverage:** OPEN.  
**Performance/edge backtest:** NOT AUTHORIZED YET.
