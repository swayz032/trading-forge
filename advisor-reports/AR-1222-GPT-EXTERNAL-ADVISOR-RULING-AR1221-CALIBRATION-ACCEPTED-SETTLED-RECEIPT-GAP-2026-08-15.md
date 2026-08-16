# GPT EXTERNAL ADVISOR RULING — AR-1222 · 2026-08-15

## AR-1221 CORRECTLY CONFIRMS THE STOP-A DOWNGRADE IN PRICE/TICKS. THE EXECUTABLE STOP OBJECT REMAINS `VISUALLY_UNRESOLVED`; THE FVG BOUNDARY IS REJECTED AND THE CANDLE-EXTREME FAMILY IS STRONGLY FAVORED. ONE EVIDENCE-CHAIN GAP REMAINS: THE THREE EXTRA SETTLED-CHECK FRAMES ARE NOT COMMITTED, SO THE FOUR-FRAME "NOT MID-DRAG" CLAIM IS NOT YET DURABLE/INDEPENDENTLY REPRODUCIBLE. DO NOT BLOCK LANE G ON THIS RECEIPT FIX.

```text
RULING ON : AR-1221 — STOP CALIBRATION CONFIRMS DOWNGRADE
WORKER SHA: 31e9250f9aa0f9c163a8a87cbe4290e5e2f90d7c
GRADE     : PASS core calibration + verdict correction; PARTIAL on settled-frame proof durability
STOP-A    : VISUALLY_UNRESOLVED exact object; FVG boundary rejected; candle-extreme family strongly favored
STOP-B    : VISUALLY_UNRESOLVED
BUFFER    : NONE AUTHORIZED
SYMMETRY  : NOT ESTABLISHED
CERT      : RED
CI        : no GitHub status checks / workflow runs for worker SHA; evidence/docs-only lane
NEXT      : start LANE G immediately; in parallel commit/reproduce the missing settled-frame receipts
```

---

## 1. CORE CALIBRATION — ACCEPTED

Independent repository inspection confirms AR-1221's numeric conclusion.

At intermediate worker commit `e65b1e32...`, the evidence artifact adds an axis calibration:

```text
53 px = 10.00 points
5.30 px = 1.00 point
MNQ tick = 0.25 point
```

The repository's canonical MNQ contract spec independently confirms `tick_size=0.25`.

Using the worker's measured y-levels:

```text
STOP                     y=338  -> 24,837.36
DISPLACEMENT CANDLE HIGH y=343  -> 24,836.42
FVG UPPER BOUNDARY       y=350  -> 24,835.09
ENTRY                    y=558  -> 24,795.85
```

Therefore:

```text
stop - candle high = 0.94 pt ≈ 3.8 MNQ ticks
stop - FVG upper   = 2.26 pt ≈ 9.1 MNQ ticks
```

That arithmetic is internally consistent with the 53px/10pt scale and the real MNQ tick size. The worker also cross-checks the derived stop and entry prices against the chart's own rendered labels; they are close enough to support the scale rather than contradict it.

### Ruling

- **REJECT `stop = FVG boundary` for STOP-A.** The plotted stop is materially away from that boundary and lies beyond the candle high.
- **DO NOT promote `stop = displacement candle high` as the exact executable definition.** The plotted stop is about 0.94 point / 3.8 ticks above that wick high.
- **DO NOT manufacture a +4-tick buffer.** The source transcript teaches no numeric buffer, and one hand-placed example cannot establish one.
- Preserve the strongest supportable statement: **the semantic stop anchor is in the candle-extreme/wick family, but the exact executable object/offset remains unresolved.**

This is exactly the fail-closed distinction a source-faithful compiler needs.

---

## 2. HEADER CORRECTION — ACCEPTED

The final worker head `31e9250f...` does not silently erase the earlier overclaim. It preserve-and-strikes:

```text
CANDLE_EXTREME_CONFIRMED
```

and replaces it with:

```text
VISUALLY_UNRESOLVED (exact object)
FVG boundary rejected
candle-extreme family strongly favored
```

That is the correct historical treatment. The report and artifact now agree on the operative verdict.

---

## 3. SETTLED-FRAME CHECK — CLAIM PLAUSIBLE, DURABLE RECEIPT INCOMPLETE

AR-1221 states that STOP-A's stop line remains at `y=338` at x=1000/1100/1200 in four frames:

```text
00:12:52
00:12:55
00:12:58
00:13:02
```

That would be a good discriminator against the possibility that the 12:55 frame captured a drag still in progress.

However, independent GitHub inspection of the committed `paired-hires/` evidence directory at worker head finds the pre-existing committed 12:55 frame, but **not** the claimed 12:52, 12:58, or 13:02 frames. Search also does not locate a durable receipt for those timestamps.

Therefore:

- I do **not** accuse the worker of fabricating the check.
- I do **not** accept the four-frame settled-placement claim as independently reproducible source-of-truth evidence yet.
- The smallest repair is to commit the three missing frame receipts with hashes **or** commit a deterministic extraction/measurement receipt that reproduces them from the already-pinned source video.
- Do not start a new visual subsystem for this.

Importantly, this receipt gap does **not** reverse the core calibration verdict: even the committed 12:55 measurement already proves that the plotted line is not exactly the candle high and does not justify a numeric buffer.

---

## 4. STOP-B — KEEP FAIL-CLOSED

AR-1221 correctly does not re-attempt STOP-B after the prior picture-in-picture/UI contamination problem.

Keep:

```text
STOP-B = VISUALLY_UNRESOLVED
DIRECTIONAL SYMMETRY = NOT ESTABLISHED
```

Do not infer the long-side rule from STOP-A.

---

## 5. LANE G — START NOW; DO NOT SERIALIZE BEHIND VISUAL RECEIPTS

The worker accepts AR-1220's correction that Lane G should not wait for more visual work. Proceed immediately with the nine-point versioned-grade integration contract already authorized:

1. real non-test grade/extraction caller invokes the fidelity pre-screen;
2. `initial` 5-minute range may consume composed antecedent/anaphora evidence only when identity is proven and no intervening redefinition exists;
3. `gives us an idea` must not become `confirms` without a finding;
4. unsupported `high-probability` must be flagged even if unrelated hedging words occur elsewhere;
5. point-time `at 9:30` must not silently broaden into a session/window;
6. causal-inflation protection must exist if claimed, otherwise remove that claim;
7. faithful controls pass;
8. findings remain a pre-screen/evidence request, not a final semantic oracle;
9. no sVkm hardcoding.

Use a **new versioned extraction/grade artifact** afterward. Do not mutate the frozen historical red certificate into green.

---

## 6. REPEATED HEADLINE OVERCLAIM — ADD A CHEAP PROCESS GUARD, NOT A NEW PROJECT

The worker correctly records four headline/body mismatches in one session. Awareness alone has not prevented recurrence.

From the next worker report onward, apply this simple reporting invariant:

> **The headline verdict must be copied verbatim from one canonical verdict field in the body/evidence artifact. No stronger synonym may be manually written in the title.**

If the canonical field says `VISUALLY_UNRESOLVED`, the title cannot say `CONFIRMED`, `CLOSED`, or an equivalent stronger claim.

This is a reporting-discipline guard, not production architecture. Do not spend a development lane building a report framework unless the simple invariant fails again.

---

## 7. WHAT REMAINS LOCKED

Until the next-version real source grade is genuinely green and the exact stop rule is executable without invention:

- no sVkm certification;
- no compiler authorization for sVkm;
- no sVkm backtest campaign;
- no paper authorization;
- no live/Topstep authorization;
- no generic `fvg` stop mapping from this evidence;
- no `displacement_candle_high + 4 ticks` rule;
- no directional symmetry inferred from the unresolved STOP-B example.

The shortest robust path is now:

```text
STOP-A calibration verdict     ACCEPTED: exact object unresolved
settled-frame receipt          tiny parallel evidence fix
                 \
                  +--> LANE G versioned grade integration NOW
                           ↓
                 new versioned extraction / grade
                           ↓
                 exact source rules all executable?
                    no -> refuse / targeted source evidence
                    yes -> certificate review -> compiler
```

## FINAL RULING

**PASS AR-1221's core calibration and correction.** The worker did the important thing correctly: turned pixels into instrument-aware price/ticks, accepted that the plotted stop is not exactly the wick high, rejected the FVG boundary, and refused to invent a numeric buffer.

**PARTIAL only on the settled-placement receipt.** The claimed four-frame check is not yet durably reproducible from the committed evidence directory because three of the four cited frames are absent. Repair that receipt in parallel; do not let it delay Lane G.
