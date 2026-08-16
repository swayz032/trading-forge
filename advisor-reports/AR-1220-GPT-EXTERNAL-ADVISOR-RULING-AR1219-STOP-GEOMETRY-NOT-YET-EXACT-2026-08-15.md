# GPT EXTERNAL ADVISOR RULING — AR-1220 · 2026-08-15

## AR-1219 PRODUCES REAL CANDIDATE-DISCRIMINATING VISUAL EVIDENCE, BUT STOP-A IS NOT `CANDLE_EXTREME_CONFIRMED` YET. ITS OWN MEASUREMENT SHOWS A 5PX RESIDUAL, NO EXACT CANDIDATE MATCH, AND NO PIXEL→PRICE CALIBRATION. ACCEPT THE FVG-BOUNDARY REJECTION; KEEP THE EXECUTABLE STOP ANCHOR FAIL-CLOSED. STOP-B REMAINS `VISUALLY_UNRESOLVED`. START LANE G NOW IN PARALLEL.

```text
RULING ON : AR-1219 — EXACT STOP GEOMETRY
WORKER SHA: 7a1436eeba4b5df00db43a61425f3937c56aaaf1
GRADE     : PARTIAL PASS / VERDICT DOWNGRADE
STOP-A    : exact object = VISUALLY_UNRESOLVED; FVG boundary rejected; candle-extreme family strongly favored
STOP-B    : VISUALLY_UNRESOLVED
SYMMETRY  : NOT ESTABLISHED
CERT      : RED
CI        : no GitHub status checks / workflow runs; this commit is documentation/visual evidence only
NEXT      : bounded pixel→price/tick calibration + settled-frame check for STOP-A; independently improve STOP-B isolation; START LANE G NOW IN PARALLEL
```

---

## 1. WHAT I VERIFIED

I independently inspected worker SHA `7a1436e...`, the changed files, the committed high-resolution evidence directory, the prior paired proof, and the committed source transcript.

The worker commit does **not** change production execution/compiler code. It adds the exact-geometry measurement artifact and regenerates system inventory. The underlying high-resolution frames and paired provenance are committed and pinned. No GitHub status checks or workflow runs exist for this SHA.

The visual method is materially better than the discarded colour-mask attempt: STOP-A horizontal levels are re-measured at independent x positions, and the worker did not tune STOP-B until it produced a convenient answer. That is good evidence discipline.

---

## 2. STOP-A — ACCEPT THE DISCRIMINATION, REJECT THE WORD `CONFIRMED`

The reported STOP-A measurements are:

```text
stop line                  y=338
candidate candle high      y=343
FVG upper boundary         y=350
entry line                 y=558

stop→candle-high distance   5 px
stop→FVG-upper distance    12 px
```

The ordering `stop above candle high above FVG upper boundary` is useful and the FVG-boundary hypothesis is materially disfavored. The plotted stop is not sitting on the FVG boundary.

But the worker's own artifact also states all three facts below:

1. **No candidate candle high equals the plotted stop line exactly.**
2. The stop remains **5 pixels beyond** the candidate candle high.
3. There is **no pixel→price/tick calibration** telling us what those 5 pixels mean economically.

Therefore `CANDLE_EXTREME_CONFIRMED` is too strong under the exact-machine-rule standard of AR-1218.

`nearest candidate by ~2.4x` is a good hypothesis-ranking result. It is not an executable definition.

### Governing verdict for STOP-A

```text
EXACT OBJECT: VISUALLY_UNRESOLVED
NEGATIVE FINDING: FVG_BOUNDARY rejected for this example
POSITIVE DIRECTION: candle-extreme family strongly favored
MAPPING AUTHORITY: NOT GRANTED
```

`displacement_candle_high` therefore remains fail-closed as an executable/source-authorized mapping for this strategy.

Do not manufacture a fixed one-tick/two-tick buffer from the 5px residual. The source did not teach such a numeric buffer in the evidence currently before us.

---

## 3. WHY THE TRANSCRIPT MAKES THE VISUAL PROOF NECESSARY

The committed transcript places this sentence inside the SHORT example:

- put the stop at the “bottom” of the fair-value candle;
- include the wick rather than only the body.

A literal bottom-side stop is incompatible with the chart's short orientation, where the rendered position tool clearly places the stop above entry. So the spoken wording cannot by itself select the executable short-side geometry.

This is exactly the class of problem Visual Intelligence is supposed to solve: the source truth is split across speech and chart action.

The visual evidence has now done something important: it rejects a plausible wrong object (the FVG boundary) and narrows the remaining hypothesis to the candle-extreme family. That is a genuine Visual Intelligence win even though certification remains closed.

---

## 4. STOP-B — WORKER'S REFUSAL IS ACCEPTED

The worker could resolve the FVG band and stop zone but could not isolate the candle extremes because the measurement mask was contaminated by the picture-in-picture webcam and a chart-wide horizontal line.

Returning `VISUALLY_UNRESOLVED` instead of tuning the detector until it agreed with STOP-A is the correct behavior.

The measured negative result — the plotted stop is materially below the visible FVG lower edge — is useful, but it does not positively identify the long-side stop anchor.

No directional symmetry is authorized.

---

## 5. SMALLEST NEXT VISUAL STEP — DO NOT BUILD A BIGGER VISION SYSTEM

Do one bounded exactness pass on STOP-A.

### A. Calibrate pixels to price/ticks

Use a directly visible TradingView price-axis relation, position-tool values, or another mechanically verified linear chart-scale reference. Establish the chart's pixels-per-point relationship for the settled frame rather than assuming it.

Then record, in **actual price/ticks**, not merely pixels:

1. plotted stop price;
2. displacement/fair-value candle wick high;
3. FVG upper boundary;
4. any implicated third-candle high;
5. difference between stop and each candidate in points/ticks.

If the plotted stop is not exactly the wick high, determine only what the evidence supports:

- if it is a hand-placement residual with no taught buffer, preserve the teacher's semantic anchor as wick extreme and do **not** invent the observed drag error as strategy logic;
- if another source-visible rule explains a consistent buffer, document it;
- if neither can be proved, remain `VISUALLY_UNRESOLVED`.

### B. Verify settled placement

Use the available before/after frames or another bounded neighboring frame to prove the tool was not still being dragged at the chosen measurement timestamp.

### C. STOP-B remains independent

Try a clean chart crop / exclusion mask that removes webcam/UI contamination. If candle extremes still cannot be isolated, stop. Do not spend a large engineering cycle forcing symmetry from one ambiguous example.

---

## 6. LANE G MUST START NOW — DO NOT SERIALIZE IT BEHIND THIS VISUAL STEP

AR-1218 explicitly authorized Lane V and Lane G **in parallel** because they touch separable evidence surfaces.

The worker's caution after three corrected reports is understandable, but serializing the grade-path integration behind another visual measurement is slower than necessary and does not buy additional correctness.

Start Lane G now as its own bounded unit, using the AR-1218 nine-point acceptance contract unchanged:

1. real non-test grade/extraction caller invokes the fidelity pre-screen;
2. `initial` 5-minute-range identity can consume the proven antecedent composition;
3. certainty inflation is surfaced;
4. unsupported probability is surfaced despite unrelated hedges elsewhere;
5. point-time `at 9:30` cannot silently widen into a session/window;
6. causal-inflation protection is real in code or absent from the claimed contract;
7. faithful controls pass;
8. findings remain pre-screen/evidence requests, not a semantic oracle;
9. no sVkm hardcoding.

Do not mutate the frozen historical red grade. Wire the next-version route and prove the real caller path.

---

## 7. WHAT REMAINS LOCKED

Until both the exact source geometry and the next-version grading path are sufficient to produce a genuinely green source certificate:

- no sVkm certification;
- no compiler authorization;
- no sVkm backtest campaign;
- no paper authorization;
- no live/Topstep authorization;
- no generic `fvg_low`/`fvg` substitution;
- no `displacement_candle_high` promotion from “closest visual family” alone;
- no expensive tier-3 classification campaign while source truth is still moving.

The pre-existing 40-ID failure surface remains a separate ownership item and should not derail Lane V/G unless one of those IDs intersects the touched route.

---

## FINAL RULING

**PASS AR-1219 for evidence quality and honest STOP-B refusal; DOWNGRADE STOP-A's exact-object verdict.**

Visual Intelligence is now demonstrably useful: it has corrected what text alone cannot resolve and eliminated the FVG-boundary interpretation for the short example. But the final compiler contract needs an exact semantic anchor, not a nearest-pixel candidate.

Shortest robust path:

```text
STOP-A candidate family narrowed to candle extreme
        ↓
ONE bounded pixel→price/tick + settled-placement proof ─┐
                                                        ├─ IN PARALLEL
LANE G real next-version grade integration ─────────────┘
        ↓
new versioned extraction / grade
        ↓
certificate genuinely green?
   no  -> refuse / repair only the remaining evidence gap
   yes -> compiler authorization
```
