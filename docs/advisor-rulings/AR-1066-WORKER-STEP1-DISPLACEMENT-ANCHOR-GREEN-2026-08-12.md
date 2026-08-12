# AR-1066 — WORKER — **STEP 1 GREEN: the displacement-candle anchor is minted and `fvg_low` is untouched.** Gap and candle are now independently addressable — proven by the discriminator pair.

```
RULING : AR-1064 (gpt-rulings 1d36573b) SS2 + STEP 1
COMMIT : 64420de6f420eb9a6f48a08c4603ce73a355b0d2   [pushed to origin/h1-wave4-sealed12-driver]
```

## 1. WHAT LANDED

```
fvg_native.displacement_extreme(zone, high, low, direction)
    LONG  -> low[start_idx - 1]
    SHORT -> high[start_idx - 1]

compute_structural_stop(fvg_displacement_low=..., fvg_displacement_high=...,
                        required_anchor="fvg_displacement", source_exact=True)
```

- **`fvg_low` semantics are UNTOUCHED.** A legacy gap-anchored call still resolves to
  `FVGZone.lower` with the framework buffer, and there is a test pinning exactly that.
- **`FVGZone` is NOT widened.** GPT's correction of my AR-1063 SS7.1 suggestion is accepted and
  implemented: `start_idx == candle 3` is already guaranteed, so `start_idx - 1` is
  deterministic. **A test asserts the dataclass field set is unchanged**, so the decision is
  guarded rather than merely intended.
- `displacement_extreme` **RAISES** when `start_idx < 1` instead of indexing to `-1`, which
  would silently return the **last bar of the array** — a plausible-looking price from the
  wrong end of the session.

## 2. THE DISCRIMINATOR PAIR — AR-1064 SS3.1 AND SS3.2

This is the pair that proves the repair is real rather than cosmetic:

| discriminator | result |
|---|---|
| move the displacement candle's wick, hold the gap fixed | **stop MOVES** (6000.00 -> 5997.50) |
| move the gap boundary, hold the displacement wick fixed | **stop does NOT move** (gap 6002.00 -> 6001.00, stop stays 6000.00) |

Plus: commanding `required_anchor="fvg_displacement"` with BOTH levels supplied takes the
candle (6000.00); commanding `"fvg"` with both supplied takes the gap (6002.00). **The two
objects can no longer substitute for each other**, which was the AR-1063 defect.

```
RED  : ImportError on displacement_extreme
GREEN: 12 passed  src/engine/tests/test_fvg_displacement_anchor.py
REGRESSION: 707 passed / 1 failed -- the pre-existing test_wave_b_intrabar_stops failure
            attributed by ablation in AR-1060. ruff pre-commit hook Passed.
```

## 3. SELF-CORRECTION

My first run was **11/12** — my own positive control asserted the literal `"BULLISH"` while
the module constant is `"bullish"`. **The control caught my test, not the code.** Fixed to
compare against the imported constant rather than a hardcoded string.

I am reporting it because a positive control that fails on its own fixture is exactly the
class of thing that gets quietly edited away, and the reason it exists is to fail loudly.

## 4. SHORT SIDE — FAILS CLOSED, AND THE REFUSAL IS THE RIGHT SHAPE

Per AR-1065 the source grants no mirroring authority, so a short commanding this anchor
raises `SourceAnchorUnresolved`. **A test proves the refusal is caused by the absent
high-side level, not by a hard-coded ban** — supplying `fvg_displacement_high` explicitly
resolves correctly. So the geometry is ready and only the *source authority* is missing: if
GPT rules the mirror authorized, the producer supplies the high and the path opens with no
further engine change.

## 5. WHAT REMAINS

- **STEP 2** — carry the *qualifying* FVG identity from the entry evaluation into the stop
  resolver. `displacement_extreme` takes a zone, so the remaining work is transporting
  **which** zone qualified, not recomputing one. This is the same-setup identity requirement
  and it is the next thing I am doing.
- **STEP 4** — the narrow SOURCE_FAITHFUL flag/floor bypass (now authorized by AR-1064 SS5).
- **STEP 5 / STEP 6** — money-path crossing and the end-to-end RED/GREEN + mutation set.

**Not the certification GREEN. No source-faithful backtest run or claimed.**

**Nothing blocking for the operator.**
