# EXACT STOP-GEOMETRY MEASUREMENT — AR-1218 §5 LANE V

**Verdict vocabulary is AR-1218's.** STOP-A and STOP-B were measured **independently**; symmetry
was NOT assumed and is NOT concluded.

| example | verdict |
|---|---|
| **STOP-A** (short, `00:12:55`, frame `467de65a…b72a`) | **`CANDLE_EXTREME_CONFIRMED`** — with a stated residual |
| **STOP-B** (buy, `00:17:14`, frame `00480d5e…edc0`) | **`VISUALLY_UNRESOLVED`** — my instrument could not isolate the candle extremes |

⇒ **DIRECTIONAL SYMMETRY IS NOT ESTABLISHED.** AR-1218 §5 permits concluding it only if *both*
measured examples support the same rule. One of them does not resolve, so it stays open.

---

## 1. METHOD — AND WHY IT IS DIFFERENT FROM THE INSTRUMENT I DISCARDED

AR-1212 §4 records a colour-mask instrument I threw away because it returned `STOP-A = LONG`,
contradicting the tool's own label — it had matched the page background.

This one does not guess thresholds. It **samples the actual pixel column** through the position
tool and reports every colour transition, so the zone boundaries are read off the image rather
than assumed. Levels were then re-measured at several independent x positions; a level that
moves between them is not a level.

---

## 2. STOP-A — THE MEASUREMENT

Vertical transitions at `x = 1100`, confirmed at `x = 1000` and `x = 1200`:

```
STOP line (top edge of the stop zone)   y = 338      (338 at x=1000, 1100, 1200)
FVG rectangle upper boundary            y = 350      (350 at x=1000, 1100)
FVG rectangle lower boundary            y = 491
ENTRY line                              y = 558
displacement candle (x 918..935) HIGH   y = 343      (strict ink threshold <80)
displacement candle              LOW    y = 562
```

Lower `y` = higher price.

### 2.1 The discrimination

```
|stop − candle HIGH|      = |338 − 343| =  5 px
|stop − FVG upper bound|  = |338 − 350| = 12 px
```

**The plotted stop is nearest the candle extreme by a factor of ~2.4**, and the ordering is
unambiguous and reproducible: `stop (338)` is above `candle high (343)`, which is above
`FVG upper boundary (350)`.

**No candle in the frame has a high at 338** (measured tops in the region: 302, 178, 201, 228,
343, and two rectangle-edge artifacts at 350/353). So the stop matches **no** candidate exactly.

### 2.2 The residual, stated rather than smoothed away

The stop sits **≈5 px beyond** the candle's high. That is *consistent with the teaching* — the
teacher says to place it beyond the candle **including the wick**, and he drags the tool by hand,
so a small overshoot is expected. **But I did not convert pixels to price**, so I cannot say
whether 5 px is one tick or several. That conversion is the one thing that would turn "nearest
candidate" into "exact object", and I did not manufacture it.

### 2.3 What it discriminates *against*

A stop at the **FVG gap boundary** would sit at `y = 350`. The plotted stop is 12 px away, on the
other side of the candle high. **The generic `fvg` gap-boundary reading is not what this chart
shows.**

---

## 3. STOP-B — `VISUALLY_UNRESOLVED`, AND WHY

Zone boundaries resolved cleanly at `x = 900`:

```
FVG band            y = 500..509
dark boundary line  y = 510..511
STOP zone (grey)    y = 512..552
STOP line           y ≈ 553          (long: stop BELOW entry)
```

**But the candle extremes did not.** The ink mask returned lows clamped at `y ≈ 996` across many
columns and repeated highs at exactly `y = 511` — i.e. it was capturing the **picture-in-picture
webcam overlay** at the bottom of the frame and a **chart-wide horizontal line**, not candle
bodies.

**So I cannot compare STOP-B's plotted stop against its candle candidates**, and I am not going to
tune the mask until it produces a number I can quote. `VISUALLY_UNRESOLVED` is the honest verdict.

What *is* measured for STOP-B: the stop is ~42 px **below** the FVG band's lower edge — so it is
**not** at the FVG boundary either. That is a negative result, not a positive identification.

---

## 4. WHAT THIS BEARS ON — AND WHAT IT DOES NOT AUTHORIZE

**AR-1138 §3.2 left `displacement_candle_high` FAIL-CLOSED for want of short-side source
authority.** STOP-A is a **short**, and this is the first measurement placing its stop at the
displacement candle's high rather than the gap boundary. **That is squarely the missing
short-side evidence.**

🛑 **It does not authorize the mapping.** It is *visual* evidence with a 5 px unexplained
residual and no pixel→price conversion, and its partner example did not resolve. Promoting it to
source authority is GPT's ruling (AR-1212 §3), not mine.

**No primitive was manufactured. `fvg_low` still must not compile as generic `fvg`. Short-side
symmetry stays fail-closed.**

---

## 5. LIMITATIONS

- No pixel→price conversion, so "nearest candidate" is not "exact tick match".
- STOP-B's candle extremes unmeasured (§3).
- Cursor/tool-handle position (§5 item 7) not separately located — the tool's drawn zones were
  used instead, which is what the levels actually are.
- Third-candle high/low candidates (§5 item 6) were not isolated for STOP-B for the same reason
  its candles were not; for STOP-A no candle high other than 343 lies near the stop.
- Single frame per example. A drag still in progress would look identical to a settled placement;
  `00:12:55` was chosen because it is after the wick explanation ends at `00:12:49`.
