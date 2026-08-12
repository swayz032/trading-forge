# AR-1060 — WORKER — **UNIT B+C and UNIT D GREEN at the unit layer.** Two NEW money-path defects found that would have silently defeated UNIT B at execution. One policy fork needs GPT.

```
RULING : AR-1059 (gpt-rulings 8e9ea5bc) SS4 UNIT B/C/D, SS5 RED->GREEN 3,4,5,6,7,8,9
BASE   : 5958385de1029a20274d3b56c669f551ca3c2589
COMMITS: d894f2e3d1b60ae42d1c69ec8f33af08fb54e057  UNIT B+C
         d5b9f029d3e478a22b460d83d042aa10776177d8  UNIT D
TREE   : C:\Users\tonio\Projects\wt-h1-wave4-20260712   [all measurements MEASURED HERE]
STATUS : NEITHER "A. GREEN" NOR "B. STOP". Partial progress + a fork. Labelled honestly
         rather than forced into one of the two report shapes.
```

## 1. AR-1059's BUFFER FINDING — CONFIRMED BY DIRECT WITNESS, THEN REPAIRED

GPT was right and I had missed it. Reproduced against unmodified code at the pin:

```
teacher taught stop : 6000.0
engine produces     : 5999.25
stop_reason         : fvg
buffer inserted     : 0.75
DEFECT REPRODUCED   : True
```

That is AR-1059 SS2.B's worked example, confirmed. `_compute_buffer()` returns
`sweep_pts * session_adj` unconditionally -- there is no zero path -- so the buffer was
mandatory for every structural stop.

### UNIT B + UNIT C — repair (commit `d894f2e3`)

Reused the existing resolver per AR-1059 SS10 (`NEW GENERIC STOP ENGINE = FORBIDDEN`).
Added to `compute_structural_stop()`:

- `source_exact: bool = False` -> buffer `0.0`, `sweep_aware False`, `buffer_ticks 0`
- `required_anchor: Optional[str] = None` -> binds the stop to the commanded structure
- `SourceAnchorUnresolved` -> raised when the commanded anchor is missing or wrong-side

**Both default to legacy behaviour; a call omitting them is unchanged.**

`GREEN: 16 passed  src/engine/tests/test_source_faithful_stop.py`

| proof | covered |
|---|---|
| RED/GREEN 3 wick | `6000.00` exactly; not body `6001.00`; not `5999.25` |
| RED/GREEN 4 buffer isolation | legacy call still `5999.25`, `buffer 0.75`, `sweep_aware True` |
| RED/GREEN 5 stop mutation | parametrized 3 extremes, each exact |
| RED/GREEN 6 direction | long lower extreme / short upper extreme, `stop_reason=="fvg"` |
| RED/GREEN 7 refuse | missing anchor and wrong-side anchor both RAISE; never `atr_fallback` |
| UNIT C hijack | nearer sweep_wick + OB + swing supplied; `stop_reason` still `"fvg"` |

### UNIT D — whole-position fixed R (commit `d5b9f029`)

Positive control first: `structural_targets.py:115-118` is `tp1 = 1.0R "1R_default"`,
`tp2 = 2.5R "2.5R_default"`, `partial_sizes = (0.33, 0.33, 0.34)` (`:28`, `:151`).
The ladder is real, so the reuse trap is real.

Added `SourceFixedRTarget` + `compute_source_fixed_r_target()` -- a **separate frozen type
with no `tp1`/`tp2`/`tp3`/`partial_sizes`/`runner` fields at all**, not reachable from
`compute_structural_targets()`. Measured off the caller's stop, so a source-exact stop
drives the source target. Refuses on zero-risk basis, non-positive R, wrong-side stop.

`GREEN: 13 passed  src/engine/tests/test_source_fixed_r_target.py`
RED/GREEN 8 (2R exact; 2->3 changes deterministically) and 9 (whole position; asserts the
ladder field names are ABSENT, and that the price equals neither framework default).

### Regression

`502 passed / 1 failed` across the 10 structural-stop suites; `174 passed / 1 failed`
across the 7 target suites. **Same single test both times:**
`test_wave_b_intrabar_stops.py::TestIntrabarsStopsAndTP::test_long_tp_fires_intrabar_even_if_close_falls_back`.

**PRE-EXISTING, attributed by ablation, not asserted:** I restored the pristine file from
`HEAD` (12836 B), ran that exact test -> `1 failed`; restored mine (15799 B) -> `1 failed`.
Identical outcome with the change absent and present.

### Disclosed extra production touch

Removed a pre-existing unused `import numpy as np` from `structural_stops.py`. `np.` has
**0 uses** in both the pristine and modified file, and `ruff --select F401` flags the
pristine file identically -- it had simply never been staged before, so the hook had never
seen it. **Removing it was required to pass the ruff pre-commit hook. Hooks were not
skipped.** Flagged because it is a production-code edit outside the authorized repair.

---

## 2. 🛑 TWO NEW MONEY-PATH DEFECTS — UNIT B IS NOT SUFFICIENT ON ITS OWN

AR-1059 named ONE unstated framework distortion (the buffer). **There are three, in series,
and the other two sit downstream of the resolver, on the execution path.** Fixing the
buffer alone would have produced a source-exact stop that still never executes.

### FINDING 1 — the structural stop is behind a feature flag that DEFAULTS OFF

`backtester.py:2969` `_structural_stop_parity_enabled()`:

```python
return os.environ.get("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", "false").lower() in ("1","true","yes")
```

Its own docstring: *"Default OFF (2026-07-03, operator decision) ... backtests keep their
legacy `atr_at_entry * atr_stop_multiplier` ceiling-clamp behavior BYTE-IDENTICALLY until
the operator opts in."*

And `_resolve_stop_risk_points()` (`:2984+`) consults `structural_stop_map` **only** when
that flag is on; otherwise it returns `atr_fallback_points, "atr_fallback"`.

⇒ **At default configuration the structural stop map is ignored entirely.** A source-exact
FVG stop would be computed, recorded, and then discarded at execution in favour of an ATR
stop. This is the `[never-flag]` shape: **the OFF branch is the wrong route, and it is
silent.**

### FINDING 2 — a per-symbol stop FLOOR widens a stop that is "too tight"

`backtester.py:3035-3060` `_STOP_FLOOR_ENV_MAP` -> **MES floor 6.0 points**
(`STOP_FLOOR_PTS_MES`), applied at `:3248`. The module comment states the precedence
explicitly: *"compute structural/ATR stop -> apply floor (widen up) -> apply ceiling (skip
if over)"*.

⇒ Any taught stop closer than 6.0 pt on MES is **widened to 6.0 pt**. The sVkm stop is the
FVG candle extreme, which on a 1m/5m chart is frequently tighter than 6 points. That is the
same class of silent substitution as the 0.75 buffer, an order of magnitude larger.

*(The 14 pt ceiling also SKIPS a trade whose structural distance exceeds it. For
SOURCE_FAITHFUL a skip is at least loud and non-substituting, so I am not treating it as a
defect -- but it does mean some taught setups will not trade.)*

**Neither finding is a AR-1056 SS8 STOP by my reading:** each is repairable by the same
narrow additive pattern AR-1059 already authorized for the buffer (source-faithful bypasses
it; legacy keeps it byte-identically). Neither requires touching candidate identity, MP1/MP2,
the library-wide DB schema, paper/live order execution, or prop-firm enforcement.

---

## 3. THE ONE FORK I WILL NOT DECIDE ALONE

`BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` is **an explicit operator decision**, not an
accident. Making `SOURCE_FAITHFUL` ignore it is a policy call about an operator-owned
setting, and SS0-CTRL.6 says I may not silently decide policy.

**My recommendation: SOURCE_FAITHFUL bypasses both the flag and the floor; everything else
byte-identical.**

Reasoning: the flag exists to protect *backtest comparability against existing baselines*.
No `SOURCE_FAITHFUL` spec has ever been run, so there is no baseline to protect -- the
bypass cannot re-baseline anything that exists. Whereas leaving the flag authoritative means
the source stop provably never executes, which makes `SOURCE-RISK-HANDOFF-1` unachievable by
construction.

**I have implemented nothing against this fork and will not until GPT rules.**

---

## 4. WHAT IS NOT DONE — HONEST PARTIAL

- **UNIT A** (source-risk contract on `SpecArtifactBody` + producer serialization) — NOT STARTED.
- **UNIT E** (`SOURCE_FAITHFUL` / `TF_OVERLAY_VARIANT` separation) — NOT STARTED.
- **RED/GREEN 1** (end-to-end source transport), **2** (FVG identity / same-setup ownership),
  **10** (quote/span authority), **11** (MP1/MP2/OR non-regression) — NOT DONE.
- **The certification GREEN of AR-1059 SS6 — crossing the real persisted sVkm money path —
  is NOT achieved.** What I have is unit-layer green on the resolver and the target math.
  Per SS6 that is explicitly *not* the load-bearing proof, and I am not claiming it is.
- I did **not** build an FVG-extreme producer. The zero-producer gap from AR-1058 SS3.1 stands.
- I did **not** measure whether the 6.0 pt MES floor actually binds on real sVkm setups; I read
  the constant and the precedence comment, not a trade. The claim "frequently tighter than 6
  points" is **HYPOTHESIS**, not measured.

### 4.1 A SECOND INSTRUMENT AGREES THAT THE PATH IS NOT CROSSED

Regenerating `SYSTEM-INVENTORY.md` (commit `56279f65`, forced by the inventory-freshness
pre-push hook) classifies all three new symbols independently of anything I claim:

```
compute_source_fixed_r_target  -> no non-test reference outside its own definition;
                                  1 test file(s) do reference it
SourceAnchorUnresolved         -> 0
SourceFixedRTarget             -> 0
```

**That is BUILT-UNREACHABLE, and it is the correct state to be in right now** -- the
contracts exist, nothing production calls them yet. I am recording it because it is exactly
the `[dormant-activation]` shape this campaign keeps re-finding, and if a later seat reads
these symbols as "done" the inventory will say otherwise. UNIT A/E and the money-path wiring
are what convert them to WIRED.

## 5. NEXT

Continuing on **UNIT A** (the artifact/transport contract), which does not depend on the SS3
fork. Will not touch the flag or floor until GPT rules.

**Nothing blocking for the operator.**
