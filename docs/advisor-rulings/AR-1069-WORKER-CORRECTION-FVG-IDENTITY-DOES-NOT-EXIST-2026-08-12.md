# AR-1069 — WORKER — **CORRECTION TO MY OWN HANDOFF.** AR-1068 §5 is right: the qualifying FVG identity does **not** exist at `_h_fvg`/`_eval_fvg`. It is destroyed there. My AR-1067 §3 understated STEP 2 and would have cost the next seat a search for something that is not there.

```
RULING : AR-1068 (gpt-rulings 06d63e2b) §5 and §6
CORRECTS: AR-1067 §3 (my handoff note)
TREE   : C:\Users\tonio\Projects\wt-h1-wave4-20260712   [MEASURED HERE at 64420de6]
SCOPE  : record correction only. No code written. No new unit started.
```

## 1. WHAT I CLAIMED, AND WHY IT WAS WRONG

AR-1067 §3 told the next seat:

> *"the FVG entry condition is evaluated at `spec_condition_compiler.py:1291 _h_fvg` /
> `:1478 _eval_fvg`. **That is where the qualifying zone identity exists** and where it must be
> captured... the remaining work is transporting **which** zone qualified, not recomputing one."*

**That is FALSE.** I inferred it from the call graph — `_eval_fvg` calls the native detector,
and `FVGResult` carries `zones`, so I concluded the identity was in hand. **I never opened the
return statement.** `[i-measured]`, again: I read the neighbouring object.

## 2. THE EXECUTABLE LINES

`spec_condition_compiler.py:1478-1486`:

```python
def _eval_fvg(self, open_, high, low, close) -> np.ndarray:
    ...
    result = compute_fvg_signal(open_, high, low, close)
    return result.any_active          # <-- zones DISCARDED here
```

`spec_condition_compiler.py:1291-1294`:

```python
def _h_fvg(self, b, ctx) -> np.ndarray:
    if ctx["fvg_signal"] is None:
        ctx["fvg_signal"] = self._eval_fvg(...)
    return ctx["fvg_signal"]          # <-- a boolean array, nothing else
```

**`FVGResult.zones` is computed and thrown away at the return.** Only `any_active` survives,
and nothing downstream ever holds a zone. There is no identity to transport.

### 2.1 And `any_active` is the wrong predicate anyway

`any_active[i]` is True iff **any still-unfilled bullish OR bearish zone** is active as of bar
`i` — including one formed much earlier in the session. The sVkm rule requires the FVG whose
**third candle is the current qualifying candle**, on the **breakout side**. So the existing
signal would admit entries the teacher never sanctioned. **AR-1068 §5 is correct that STEP 2 is
a semantic build, not a transport job.**

### 2.2 The EMA-slope finding is confirmed in the same docstring

AR-1068 §6 is corroborated by `_eval_fvg`'s own words:

> *"directional FVG selection (long vs short) is out of scope for this experiment; direction is
> still decided the same way as every other spec (`self.spec['direction']` + the EMA-slope proxy
> for 'both')"*

⇒ **On the current path the breakout side does not choose direction — an EMA-slope proxy does.**
`[MEASURED]`, and it is exactly what the blueprint forbids for this source.

## 3. THE CORRECTED PICTURE FOR THE NEXT SEAT

| my AR-1067 §3 said | measured reality |
|---|---|
| qualifying zone identity exists at `_h_fvg` | **it does not** — discarded at `_eval_fvg`'s return |
| remaining work is transport | **remaining work is capture + causal qualification + transport** |
| `displacement_extreme` just needs the zone handed to it | true, but **nothing currently produces a zone to hand it** |

**What is still true from AR-1067 and worth keeping:**
- `spec_condition_compiler.py:2357` is **trace-only** (`except Exception: pass`) — not an
  execution path. Do not mistake it for one.
- `_resolve_stop_risk_points` (`backtester.py:2984`) takes **no config/spec/mode**, has exactly
  **4 call sites** (`993, 1097, 1392, 1925`), while `_apply_trade_management` (`:1188`) **does**
  receive `spec` and already threads `exit_policy` — still the right plumbing precedent.
- Engineering head `64420de6`, GPT branch head at this writing `06d63e2b`.

## 4. WHY I AM FILING THIS RATHER THAN LETTING THE NEXT SEAT FIND IT

A handoff note is read as settled ground. Mine pointed at a specific file and line and said the
hard part was already done there. The next seat would have opened `_h_fvg`, found a boolean
array, and had to work out whether I was wrong or they were looking in the wrong place —
which is the expensive failure mode, because **my sentence carried more authority than my
evidence did.**

★ **`A HANDOFF NOTE IS AN INSTRUMENT. AN UNMEASURED CLAIM INSIDE ONE IS A FALSE READING THE
NEXT SEAT CANNOT AUDIT.`**

**No code was written for this AR. AR-1068 §10's bounded order stands unchanged and is the
next worker's assignment. Nothing blocking for the operator.**
