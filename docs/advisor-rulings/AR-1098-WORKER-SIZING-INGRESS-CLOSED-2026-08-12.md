# AR-1098 (worker) — `BAND-C-SIZING-INGRESS-1` CLOSED. THE THREE TRADES ARE FINALLY COMPARABLE.

**Governing:** AR-1095 §3, §4, §5 (P1–P6), §9 · **Pin:** `f533aebc` · **Pre-flight:** AR-1096

---

## 1. THE REPAIR — ONE ARGUMENT, AT THE BOUNDARY YOU NAMED

`backtester.py:9586`, the Band C dispatch:

```python
fixed_contracts=(config.get("strategy") or {}).get("fixed_contracts"),
```

`.get()` with no default, so **absent stays `None`** — the documented "no sizing command supplied"
sentinel, never a silent `1`. Your §5.6 held: **nothing was hard-coded inside the source strategy**;
the correction is at the ingress.

### THE MEASURED BEFORE/AFTER, ON THE SAME FIXTURE

```
BEFORE   [0] size=1.0   gross=75.0     <- ATR warmup
         [1] size=15.0  gross=1125.0
         [2] size=15.0  gross=1125.0

AFTER    [0] size=1.0   gross=75.0
         [1] size=1.0   gross=75.0
         [2] size=1.0   gross=75.0
```

Entry `119.0`, risk `7.5`, exit `134.0`, `source_fixed_r_target` on every trade in **both** arms —
the taught geometry never moved. **Identical geometry now produces identical gross P&L**, which is
your §4 Surface 1: the population is size-normalised, so an expectancy number would finally be
measuring the teacher rather than the sizer.

---

## 2. THE §3 OWNERSHIP CONTRACT, ON THE ARTIFACT

`result["sizing"]` now carries `sizing_owner` · `sizing_mode` · `sizing_plan_id` ·
`requested_contracts` · `target_risk_dollars` · `sizing_source` · `executed_contracts`.

Two deliberate choices:

- **`executed_contracts` is read off the TRADE RECORDS, not off the request.** That is GRADE finding
  F-2's lesson applied before it could bite again — ★ `A REQUESTED SIZE IS AN INSTRUCTION, AN
  EXECUTED SIZE IS AN OUTCOME, AND ONLY THE SECOND ONE IS EVIDENCE.` Had these been one field, a
  dropped instruction would have been invisible all over again.
- **`sizing_plan_id` is `None` and a test pins it there.** Prior art (AR-1096 §4):
  `firm_config.SCALING_PLANS` is deliberately EMPTY — R-059 removed size-upgrade ladders as
  **fiction** at Topstep, with a standing prohibition on repopulating it. So no plan id can honestly
  be claimed, and `TRADING_FORGE` in this field names the **default ATR fallback**, not a persisted
  scaling plan. I did not invent a sizing subsystem; I threaded the existing `PositionSizeConfig`.

---

## 3. YOUR §5 PROOF MATRIX — P1–P6 GREEN

`src/engine/tests/test_band_c_sizing_ingress.py`, 13 tests.

| § | proof | state |
|---|---|---|
| P1 | persisted `fixed_contracts=1` reaches the real Band C call | **GREEN** |
| P2 | all three trades size 1; population size-normalised (gross `{75.0}`) | **GREEN** |
| P3 | 1→2 scales quantity and P&L **only** — entry, exit bar, stop, target, risk, exit reason, stop basis and event count all byte-identical | **GREEN** |
| P4 | removing the command NAMES the fallback (`requested_contracts=None`, `sizing_source=engine_default_no_sizing_command_supplied`) | **GREEN** |
| P5 | legacy + `TF_OVERLAY_VARIANT` disclosure, scope stated below | **GREEN** |
| P6 | the result exposes which owner/mode ran | **GREEN** |

**P4 carries a positive control that matters:** with the command removed, the engine reproduces the
**old `[1.0, 15.0, 15.0]` ramp exactly**. So the two arms are genuinely different engines rather
than the same numbers under two labels — and it demonstrates precisely what the dropped instruction
was hiding.

**P3 is the one that answers your §3 architecture question:** sizing and strategy semantics are now
demonstrably orthogonal axes, not one knob.

---

## 4. §5.5 / §9.5 — WHAT I CHANGED FOR LEGACY, DISCLOSED RATHER THAN BURIED

⚠️ **This ingress serves EVERY Band C artifact, not only the source arm.** A legacy or
`TF_OVERLAY_VARIANT` artifact that persists `fixed_contracts` now gets the size it asked for too.
That is the intentional correction your §5.5 permits — **the same previously-ignored persisted
command** — and I am naming it rather than letting it pass as "no change".

**MEASURED:** canonical regression population (107 members) at `f533aebc` vs baseline `66c9a476`:

```
32 failed / 2387 passed / 2 xfailed   (both pins)
ONLY-AT-NEW-PIN:  (empty)
ONLY-AT-BASELINE: (empty)
```

🛑 **AND I AM STATING THE WEAKNESS OF THAT NULL MYSELF.** Per AR-1097 §5, this population
**excludes every source-faithful test file**, and I have not enumerated which of its 107 members
actually drive a Band C run carrying a persisted `fixed_contracts`. So the honest reading is
**"no regression detected by the committed instrument"**, not "no legacy run changed". An empty diff
from a population that may not exercise the changed path is a weak null, and I would rather say so
than let the zero speak louder than its coverage.

---

## 5. STOP CONDITIONS — NONE FIRED

Nothing hard-coded in the source strategy (§5.6) · no new sizing subsystem (§3) · no scaling plan
invented where R-059 says none exists · no performance/edge run · strategy semantics untouched
across the 1→2 arm (P3) · walk-forward refusal untouched.

---

## 6. STATE, AND THE THREE THINGS STILL OPEN

- **200 green** across the nine source suites plus this one, by path.
- **F-4 + grade findings F-1/F-2/F-6 + your §6 boundary: CLOSED** (AR-1097).
- **`BAND-C-SIZING-INGRESS-1`: CLOSED** here.

**AWAITING YOUR RULING, NOT STARTED:**

1. **F-3** — a trade still open when the frame ends counts as a LOSS (`win_rate` 100% → 66.67%).
   Excluding open trades changes legacy metrics too, so it is a money-path semantics decision.
2. **The `vectorbt` mock leak** (AR-1097 §5) — `test_black_swan_evaluator.py` installs a
   `MagicMock` into `sys.modules` at import, session-wide, and `int(MagicMock()) == 1`. Whole-suite
   runs are contaminated. **I am still not reporting a whole-directory green.**
3. **The acceptance population cannot see the source files** — every future source claim is
   otherwise graded by an instrument blind to it.

**Your §7 step 4** (rerun the deterministic population at normalized research size) is effectively
demonstrated by P2 on this fixture, but I am **not** calling that a performance run and **no sVkm
performance/edge backtest has been executed.** Step 5 remains yours to authorize.

**Pin `f533aebc`.**
