# ALGO-160 — The width-artifact bracket. Two arms. Measurement only. Terminal.

**Why this exists:** 24 of his 28 marked zones are exactly **one tick**, and his standing
instruction (08-23) is that zone widths are **never** to be read from these lines. So every result
computed from his *bands* needed bracketing against a real width.

**Verified here, not relayed:** widths are `{0.25: 24, 0.75: 1, 1.5: 1, 7.25: 2}` — median `0.25`,
max `7.25`. **`7.25` is the largest and occurs twice; it is not the only non-tick width.** It is
used as the arm precisely because it is the most generous, so the arm is an **upper bound on how
much of the subtractive result is a marking artifact.**

---

## THE TWO ARMS

| | **ARM A — as marked** | **ARM B — every level widened to 7.25 pt** |
|---|---|---|
| his levels the bot has, pad 0.00 | **13 of 28** | **16 of 28** |
| … pad 2.50 | 17 of 28 | 20 of 28 |
| … pad 10.00 | **25 of 28** | **25 of 28** |
| bot zones matching nothing he drew, pad 0.00 | **508 of 522** | **504 of 522** |
| … pad 2.50 | 501 of 522 | 497 of 522 |
| … pad 10.00 | 479 of 522 | 479 of 522 |
| **survives to the map** | **13** | **16** |
| **killed in the collapse stages** | **12** | **10** |
| **killed at the `min_wick` gate** | **3** | **2** |

## WHAT THE BRACKET SAYS

**1. THE ADDITIVE HALF IS UNTOUCHED — and it was already the robust one.** `508 → 504`,
`501 → 497`, `479 → 479`. **~500 of 522 at every combination of arm and pad.** Widening his bands
to their most generous real width changes it by **four zones out of 522.**

**2. THE SUBTRACTIVE HALF SHRINKS BUT SURVIVES: 12 → 10.** **Ten of the twelve are not a width
artifact.** Three of his levels move from "killed" to "kept" under the widest arm; the rest do not.
⇒ *"the collapse discards levels he drew"* stands at **10 of 28**, not 12 — and **that is the
number to quote**, with its arm.

**3. AT PAD 10.00 THE ARMS ARE IDENTICAL — `25 of 28` and `479 of 522` in both.** Once the
tolerance exceeds his largest real band, **his marked width stops carrying any information at all.**
That is the cleanest statement of where the artifact ends.

## 🛑 AND ONE DEFECT IN MY OWN ARM SCRIPT, CAUGHT AND NAMED

The arm run labelled 3 levels **`no_pivot`**. **That label is wrong.** Its `near` set was drawn from
an already **wick-filtered** population, so *"no pivot"* actually meant *"no pivot that passes
`min_wick`."* **Checked against the raw stream: each of those three has exactly one pivot nearby,
and it fails `min_wick`.** ALGO-158's classification — *3 pass no gate, 0 have no pivot* — is the
correct one and is unchanged.

**AND THE MISLABEL EXPOSED SOMETHING WORTH KEEPING:**

> **`min_wick` (0.20) — uncited, and until now unmeasured for impact — kills 3 of his 28 levels
> outright.** It is the gate that loses the three. **A fourth uncited magnitude, and unlike
> `min_disp_atr` (39 of 7,841) and the ATR floor (0 of 1,958), THIS ONE BITES HIM DIRECTLY.**
> Reported, not indicted: an uncited magnitude may still be correct.

## THE FINAL SHAPE OF HIS 28

| | ARM A | ARM B |
|---|---|---|
| killed by `min_wick` | 3 | 2 |
| killed in clustering / dedup / lifecycle / quality | 12 | **10** |
| survive into the map | 13 | 16 |

**No stage indicted. No rule proposed. No threshold, no clutter rule, no A+ predicate, no
merge/dedup change. Nothing chosen for what it does to the fourteen sessions.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision.*
