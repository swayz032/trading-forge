# AR-1072 — WORKER — **STEP 5+4 PARTIAL (AR-1068 §10 NEXT UNIT 3).** The narrow `source_risk_mode` is threaded into `run_class_backtest` and binds at three of the points that change source semantics. 🛑 **IT IS PROVEN *WIRED*, NOT PROVEN *EFFECTIVE* — no class backtest ran, and I will not call routing an execution proof.** ⚖️ **TWO QUESTIONS FOR YOU AT §6.**

```
RULING  : AR-1068 (gpt-rulings 06d63e2b) §7, §8, §10 NEXT UNIT 3
TREE    : C:\Users\tonio\Projects\wt-h1-wave4-20260712        [MEASURED HERE]
PIN OUT : bcbf4f98   [MEASURED] pushed, re-read from origin
COMMITS : b1251087 STEP 5+4 · bcbf4f98 SYSTEM-INVENTORY
TOUCHED : src/engine/backtester.py  ← FIRST PRODUCTION MONEY-PATH FILE THIS LANE HAS EDITED
```

---

## 1. WHAT LANDED

**One parameter.** `run_class_backtest(..., source_risk_mode: Optional[str] = None)`, carried
from `compiled_spec.spec.source_risk.mode`. §7 asked for a **durable persisted contract** rather
than the existing env-only global `TF_CONFLUENCE_OVERLAY_DISABLED` — ★ **an environment switch is
a property of the MACHINE; the ownership of a strategy's risk is a property of the ARTIFACT.**

Derived once into `_source_faithful`, consumed at exactly three points:

| point | behaviour under `SOURCE_FAITHFUL` | why |
|---|---|---|
| **eligibility gate** (`apply_eligibility_gate`) | **bypassed**, reusing the gate's OWN existing bypass branch | §7 "existing eligibility overlay leak" — the 7-layer A+ overlay deletes source entries *before* performance is measured |
| **E.3 house stop ceiling + E.5 15:55 ET flatten** | **unreachable** — moved into the `else` of a mode branch | §8: a house-risk violation "may not silently delete or tighten the source trade" |
| **Style-C exit engine** | 🛑 **REFUSES** | §7's exact failure: a fixed-2R strategy run through Style-C machinery and then labelled SOURCE_FAITHFUL |

**An unrecognised mode string also REFUSES** — a typo must not silently buy back the entire
overlay by falling through to legacy.

### 1.1 Why the exit engine REFUSES instead of substituting

The source's whole-position fixed-R target is **not yet consumed by this path**. There were three
options and two of them are lies: running Style C anyway is the mislabel §7 names; substituting
some other engine is invention. **The third is to refuse and make the missing wiring visible.**
★ **`THE OFF BRANCH IS WHERE THE DEFECT LIVES — OFF MUST REFUSE, NEVER FALL BACK.`**

## 2. PROOF, AND ITS EXACT BOUNDARY

🛑 **`run_class_backtest` needs market data and THIS BOX HAS NONE.** That is a documented trap
here: a spy inside a data-less backtest reads **zero on both arms**, which looks identical to a
perfect gate. So I did not build one.

- ✅ **PROVEN BY EXECUTION** — the mode validation and the Style-C refusal sit immediately after
  `spec = CONTRACT_SPECS[symbol]`, **before any data load**, so those tests call the real
  production function and observe its real behaviour.
- ✅ **PROVEN STRUCTURALLY** — the two bypasses, by parsing the real source with `ast` and
  asserting branch shape (`_apply_dsl_stop_loss_and_time_stop` absent from the source arm and
  **present in the legacy arm** — the second half matters: without it I could have disarmed
  E.3/E.5 for every existing strategy and the test would still be green).
- 🛑 **NOT PROVEN** — that any trade population actually changed. **That is STEP 6.**

**12 tests. Six ablations, all biting:** delete the Style-C refusal → 2 RED · delete the
mode validation → 1 · revert the eligibility bypass → 1 · let E.3/E.5 run on the source arm → 2 ·
default the mode to `SOURCE_FAITHFUL` → 2 · drop the disclosure → 1. **Restored: 12 passed.**
**100 passed** across the whole source-risk suite set.

**A positive control guards the three refusal tests:** legacy `None` must reach the gate and fail
**later, with a different error**. Without it, all three refusal tests would pass on a function
that rejected everything.

## 3. ⚠️ LEGACY IS NOT BYTE-IDENTICAL — ONE RESPECT, DECLARED

Every legacy branch is unchanged, **but the output gains two additive disclosure keys**:
`dsl_guards.source_faithful_bypassed` (empty list on every legacy run) and
`result["source_risk_mode"]` (`None`). **I checked for exact-schema consumers before adding them**
and found one apparent risk, which turned out to be something else — see §5.

## 4. REGRESSION — MEASURED, NOT ASSUMED

`test_production_hardening_g2a_g2b.py` shows **2 failures**. I baselined them: swapped in the
`HEAD` copy of `backtester.py`, re-ran, got **the same two test names**, swapped mine back, same
two. **Pre-existing. Not mine.** I have not investigated them — outside this scope.

## 5. ADJACENT FINDING — A GUARD THAT CANNOT FAIL (reported, not fixed)

`src/engine/tests/test_dsl_guards_blackout_dll_metrics.py:32` reads:

```python
assert self._REQUIRED_KEYS == set(dsl_guards_meta.keys())
```

which looks like an exact-key-set guard on production's `_cls_dsl_guards_meta` — exactly what my
new key would break. **It is not.** The test **builds its own dict literal in the test body** and
asserts against that. It passes no matter what production does.

**Two independent confirmations that it is a replica, not a guard:** it stayed green with my new
key added, **and** its `_REQUIRED_KEYS` names `blackout_skips` / `cross_symbol_dll_halts`, which
are **not in production's initializer at all** — the "required" set already disagrees with the
object it claims to govern. ★ **`A TEST THAT RE-IMPLEMENTS WHAT IT NAMES IS A MIRROR, AND A
MIRROR NEVER REPORTS A CRACK.`** **Not fixed — out of scope, and `SWEEP-*` lanes are closed.**

## 6. ⚖️ TWO QUESTIONS I WILL NOT ANSWER FOR MYSELF

**(a) E.4 — the DLL halt — still suppresses entries on the source arm.** §7's SOURCE_FAITHFUL
list does not name it, so **I did not widen an authorized bypass on my own judgement.** But it
*does* delete source entries, so the trade population is still not fully the teacher's. I pinned
this as a test so the limitation is on the record rather than in a footnote. **Is E.4 in or out?**

**(b) AR-1070 §4 is still unruled** — I mapped `displacement_candle_low` only and left
`displacement_candle_high` unmapped (§4 says both; §12 says keep short fail-closed). **UNIT 3 now
sits on top of that.** One line either way.

## 7. NOT DONE

- **The exact source stop command and fixed-R target command are still not consumed** by the class
  path. `_resolve_stop_risk_points` still takes no config/spec/mode (4 call sites). **This is the
  remaining half of UNIT 3**, and it is what would let the Style-C refusal become a Style-C
  *replacement*.
- **STEP 6 / NEXT UNIT 4 — UNSTARTED.** The production-path RED→GREEN and the 21 discriminators.
- **STEP 2B is still BUILT-UNREACHABLE** — `source_entry_events.py` has no production caller;
  nothing yet joins it to this mode.
- **Entry timing (§9)** — untouched. The N+1-close convention still stands and is not yet
  separated into decision-timing vs fill model.
- **The bounded short-side visual question** — not run.

## 8. NEXT

Continuing into the remaining half of UNIT 3 — threading the mode to the stop/target commands so
the source stop and whole-position fixed-R actually bind — unless you rule otherwise on §6.
