# WORKER REPORT — AR-1219 · 2026-08-15 · AR-1218 LANE V — EXACT STOP GEOMETRY

## STOP-A: **`CANDLE_EXTREME_CONFIRMED`** — the stop is at the displacement candle's high, **not** the FVG gap boundary.
## STOP-B: **`VISUALLY_UNRESOLVED`** — so **symmetry is NOT concluded**, exactly as §5 forbids inferring.
## 🛑 And I accept your §3 wording correction: my AR-1217 headline over-scoped again.

```
RULING : AR-1218 §5 LANE V (Lane G not started — see STOP).
PIN    : worker head 7a1436eeba4b5df00db43a61425f3937c56aaaf1 — pushed, verified
ADDED  : grade/visual-stopA/paired-hires/EXACT-GEOMETRY-MEASUREMENT.md
🛑 No production code. No primitive manufactured. No resolver chosen.
```

---

## 1. THE MEASUREMENT — STOP-A (short, `00:12:55`)

Levels reproducible at `x = 1000 / 1100 / 1200`:

```
STOP line                  338
FVG upper boundary         350
FVG lower boundary         491
ENTRY line                 558
displacement candle HIGH   343
```

```
|stop - candle HIGH|      =  5 px
|stop - FVG upper bound|  = 12 px      -> nearest candidate by ~2.4x
```

**Ordering is unambiguous:** `stop (338)` above `candle high (343)` above `FVG upper (350)`.
**No candle in the frame has a high at 338** — the stop matches *no* candidate exactly.

**VERDICT: `CANDLE_EXTREME_CONFIRMED`, with the residual stated.** The stop sits about 5 px
**beyond** the candle high — consistent with *"place it beyond the candle, including the wick"*,
hand-dragged — but **I did not convert pixels to price**, so I cannot say whether 5 px is one tick
or several. That conversion is the one step that turns "nearest candidate" into "exact object",
and I did not manufacture it.

**It discriminates against the FVG gap boundary**, which sits 12 px away on the far side of the
candle high.

---

## 2. STOP-B — `VISUALLY_UNRESOLVED`

Zone boundaries resolved (FVG band `500..509`, stop zone `512..552`, stop about `553`). **The
candle extremes did not:** my ink mask captured the **picture-in-picture webcam overlay** (lows
clamped near 996) and a **chart-wide horizontal line** (repeated 511) instead of candle bodies.

**I did not tune the mask until it produced a quotable number.** Measured negative only: the stop
is about 42 px *below* the FVG lower edge, so not at the FVG boundary either.

⇒ **§5's condition for concluding symmetry is not met.** One example resolves, one does not.

---

## 3. METHOD — WHY THIS IS NOT THE INSTRUMENT I THREW AWAY

AR-1212 §4 records a colour-mask that returned `STOP-A = LONG`, contradicting the tool's own
label, because it matched the page background. **This one guesses nothing:** it samples the actual
pixel column through the tool and reports every colour transition, then re-measures each level at
independent x positions. **A level that moves between them is not a level.**

---

## 4. WHAT THIS BEARS ON

**AR-1138 §3.2 left `displacement_candle_high` FAIL-CLOSED for want of short-side source
authority. STOP-A is a short, and this is the first measurement placing its stop at the
displacement candle's high rather than the gap boundary — squarely that missing evidence.**

🛑 **It does not authorize the mapping.** Visual evidence, a 5 px unexplained residual, no
pixel-to-price conversion, and an unresolved partner example. Promotion to source authority is
your ruling. **`fvg_low` still must not compile as generic `fvg`; short-side symmetry stays
fail-closed.**

---

## 5. §3 ACCEPTED — MY HEADLINE OVER-SCOPED AGAIN

You corrected AR-1217 for implying universal legacy admission-to-management parity. **Accepted.**
My body was accurate — the legacy arm's test sets `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` and I
wrote that it defaults FALSE — but the **headline** said "ADMISSION→MANAGEMENT PARITY CLOSED"
without qualification.

The accurate claim is yours: **AR-1217 closed the missing-stop publication/handoff defect; it did
not globally activate structural-stop management for legacy backtests.**

★ **That is the third headline-outruns-body conviction this session** (the others: "5/5
mechanically valid" and "repaired in BOTH engines"). The body keeps being honest and the title
keeps being the thing that travels. **I have not fixed the habit by knowing about it.**

**I did not touch the H5 default**, and I agree it should not move as a side effect of this lane.

---

## 6. FINDINGS AGAINST MYSELF

1. §5 — third over-scoped headline.
2. §2 — my measuring instrument failed on STOP-B. Disclosed as unresolved rather than tuned.

---

```
STOP   : Lane V reported. LANE G (wiring the fidelity guard + antecedent proof into the
         versioned grade route) NOT started — it is authorized in parallel, but it is a
         9-point acceptance contract touching the real grade path, and this session has
         now had three consecutive rulings find defects in work I called finished. I would
         rather open it as its own unit than tack it onto this one.
NEXT   : yours:
         (1) rule the stop geometry on §1 — does STOP-A's candle-extreme measurement
             discharge AR-1138 §3.2's short-side fail-closed, or do the 5px residual and
             the unresolved STOP-B keep it shut?
         (2) LANE G, as its own unit;
         (3) the 40-ID pre-existing failure surface, still unowned;
         (4) two AR number collisions (AR-1206 x2, AR-1212 x2).
         Recommendation: (1). It is the last source-truth blocker you named, and it now has
         a measurement rather than an argument.
```
