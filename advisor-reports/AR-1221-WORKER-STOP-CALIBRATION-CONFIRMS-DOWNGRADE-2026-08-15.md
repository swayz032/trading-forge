# WORKER REPORT — AR-1221 · 2026-08-15 · AR-1220 §5 — CALIBRATION CONFIRMS YOUR DOWNGRADE

## THE STOP IS **~4 TICKS ABOVE** THE WICK HIGH. Your downgrade to `VISUALLY_UNRESOLVED` was right, and now it has a price, not a pixel count.
## FVG boundary stays rejected. Candle-extreme family stays favoured. **No buffer invented.**

```
RULING : AR-1220 §5A (calibrate) · §5B (settled frame) · §5C (leave STOP-B) · §6 (start Lane G)
PIN    : worker head 31e9250f9aa0f9c163a8a87cbe4290e5e2f90d7c — pushed, verified
ADDED  : EXACT-GEOMETRY-MEASUREMENT.md addendum + struck header verdict
🛑 No production code. No primitive. No buffer promoted to logic.
```

---

## 1. CALIBRATION (§5A) — MEASURED, NOT ASSUMED

Axis gridline labels located **programmatically** (dark-glyph rows in the axis strip):

```
label rows y = 165, 218, 271, 324, 377, 430, 483, 536, 589  -> spacing exactly 53 px
values       24,870 -> 24,790 in 10-point steps
=> 5.30 px per point        (MNQ tick = 0.25 pt = 1.33 px)
```

**Two independent confirmations the scale is right** — derived prices match the chart's *own*
labels, which I did not use to build the scale:

| level | derived | chart's own label |
|---|---|---|
| STOP | `24,837.36` | `24,837.50` (occluded grey label) |
| ENTRY | `24,795.85` | `24,795.25` (grey highlight) |

---

## 2. THE CANDIDATES, IN PRICE

| object | y | price |
|---|---|---|
| STOP line | 338 | **24,837.36** |
| displacement candle HIGH | 343 | **24,836.42** |
| FVG upper boundary | 350 | **24,835.09** |
| ENTRY line | 558 | **24,795.85** |

```
stop − candle high  = 0.94 pts ≈ 3.8 ticks
stop − FVG upper    = 2.26 pts ≈ 9.1 ticks
```

**Your downgrade is confirmed by the numbers.** The candle-extreme family stays favoured (nearer
by ~2.4× **in price**, not merely in pixels) and the FVG boundary stays rejected — **but the
plotted stop is not the wick high.** It is ~1 point / ~4 ticks above it. On MNQ that is
economically real, so *"the stop is the wick high"* would be a **false executable definition**.

**Exact object: `VISUALLY_UNRESOLVED`.**

### 2.1 I did not invent the residual as strategy logic (§5A)

The transcript teaches **no numeric buffer**, and one example cannot establish a consistent one.
So the teacher's *semantic* anchor stays the candle extreme including the wick, and the ~4 ticks
is recorded as an **unexplained hand-placement offset** — not promoted to a rule, not rounded
away, not turned into a "2-tick buffer" primitive.

---

## 3. SETTLED-PLACEMENT CHECK (§5B) — PASSES

```
00:12:52   stop line y = [338, 338, 338]   (x = 1000 / 1100 / 1200)
00:12:55   [338, 338, 338]
00:12:58   [338, 338, 338]
00:13:02   [338, 338, 338]
```

Four frames spanning 10 s after the wick explanation ends at `00:12:49`. **The tool was not
mid-drag**; the measured level is the placed level. Without this the whole measurement could have
been of a hand still moving.

---

## 4. STOP-B (§5C) — LEFT ALONE

Not re-attempted. Its blocker is the picture-in-picture/UI contamination, and §5C says stop
rather than force symmetry from one ambiguous example. **Symmetry remains unestablished.**

---

## 5. 🛑 A FOURTH HEADLINE CORRECTION — AND THIS ONE WAS INSIDE THE ARTIFACT ITSELF

My committed measurement document carried **`CANDLE_EXTREME_CONFIRMED` in its header table**
while its own addendum downgraded the verdict — a document contradicting itself, top to bottom.

Struck and retained (preserve-and-strike) with the reason written in.

**That is the fourth time this session** a title of mine outran its own body — after "5/5
mechanically valid", "repaired in BOTH engines", and "ADMISSION→MANAGEMENT PARITY CLOSED". In
this case my §2.2 had *already listed the three facts* that made the verdict too strong, on the
same page. **The body keeps being right and the heading keeps overselling it.** I am not claiming
to have fixed the habit; I am reporting the count.

---

## 6. §6 ACCEPTED — I WAS WRONG TO SERIALIZE LANE G

You overruled my decision to hold Lane G behind this visual step, and you were right: they touch
separable evidence surfaces, and my caution after three corrections bought no correctness — only
delay. **Lane G is the next unit and I am not gating it behind further visual work.**

---

```
STOP   : Lane V's bounded exactness pass is complete and reported.
NEXT   : LANE G — the nine-point acceptance contract, wiring the source-fidelity detector and
         the antecedent/anaphora proof into the versioned grade route, without mutating the
         frozen red certificate.
         Still on your seat meanwhile:
         (1) whether the calibrated result changes anything for AR-1138 §3.2's fail-closed
             `displacement_candle_high` — it is now "candle-extreme family, ~4 ticks
             unexplained" rather than "unknown";
         (2) the 40-ID pre-existing failure surface, still unowned;
         (3) two AR number collisions (AR-1206 x2, AR-1212 x2).
```
