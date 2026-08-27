# T3 — `touch with mixed/doji control -> WAIT_OR_NO_TRADE`, formalized. S3 step 1.

**Committed BEFORE any census or guard number is read.** ALGO-100B §3.1 makes the sequencing the
integrity mechanism: the clause is chosen from the teaching, written down, and committed; only
then does anything measure it. No T3 guard has been run at the time of this commit. If the
committed clause kills either hit, the lane closes **honest-partial** — the answer is not a
re-fit of this document.

**On numbers:** every decimal appearing here (`0.62`, `0.78`, `0.35`, `0.30`, `0.40`) is a
**citation of a RETIRED magnitude**, quoted to identify what was removed. **T3 introduces no
constant of any kind.**

---

## 1. The taught clause

> **`touch with mixed/doji control -> WAIT_OR_NO_TRADE`** — `video_evidence.md:113`, in the
> **Explicit refusals** list.

Restated twice more in rank-1/2 sources:

> `RECLAIM_REQUIRES_HOLD`: *"**Directional control**/defense/hold must confirm; **a doji reclaim
> alone is not an A+ trade**."* — `video_evidence.md:82`, restated `engineer_onboarding.md:61`.

S1 established that this is the one taught A+ gate with no surviving implementation: it lived
only inside `_control`'s `body_frac 0.62` / `close_loc 0.78` and `two_sided_wick_conflict`'s
`0.30`/`0.40`. ALGO-071 §3 was right that those magnitudes are untaught constructions; **the
clause they implemented is taught**, and retiring the first without re-expressing the second is
what the guard measured as 40 → 143.

## 2. What the teaching is actually about: CONTROL

The operative noun in both citations is **control**, and the teaching names exactly two ways it
fails — the bar is **mixed**, or it is **doji**, i.e. it shows no directional resolution. That
grammar decides the shape of the formalization: a **disjunction of two named failure modes**,
each independently sufficient to refuse. Not a score, not a weighted total, and neither half able
to compensate for the other — which is what a mandatory gate means.

## 3. The candidates, and why the obvious one is REFUTED

S1 named three magnitude-free readings. ALGO-100B suggested `C1 ∨ C2` as the plain reading of
"mixed/doji". **That is refuted here, on teaching grounds, before any measurement.**

| | expression | verdict |
|---|---|---|
| **C1** | `body < upper_wick AND body < lower_wick` | **ADOPTED** as `MIXED` |
| **C2** | `body < max(upper_wick, lower_wick)` | **REFUTED** — see below |
| **C3** | close fails to finish beyond the bar's own midpoint in the traded direction | **ADOPTED** as `NO_DIRECTIONAL_CONTROL` |

**(a) `C1 ∨ C2` is not a disjunction — it collapses to C2.** Anything smaller than *both* wicks
is smaller than the *larger* wick, so `C1 ⟹ C2` and `C1 ∨ C2 ≡ C2`. Stated because it means the
"stricter-wins" tiebreak would silently have decided the entire clause rather than broken a tie.

**(b) C2 refuses the hammer — the archetypal rejection candle this strategy is built on.** A
rejection wick is *by definition* large relative to the body. `body < max(wick)` therefore fires
on exactly the shape that `_rejection_wick` and T5 exist to **accept**, and adopting it would
refuse `touch_and_reject` wholesale. **Stricter-wins is the right tiebreak between two clauses
that both fit the teaching; it is not a licence to adopt one that contradicts another teaching.**
C2 is out, and it is out for a reason that no guard number could have supplied.

## 4. THE COMMITTED CLAUSE

> **T3 refuses iff `MIXED ∨ NO_DIRECTIONAL_CONTROL`**, evaluated on the **completed** bar the
> rejection story is read on (ALGO-033's split — never the forming trigger):
>
> - **`MIXED`** = `body < upper_wick` **AND** `body < lower_wick`
>   — neither side won the bar. This is "mixed" in the teaching's own word, and a true doji at a
>   zone satisfies it too.
> - **`NO_DIRECTIONAL_CONTROL`** = the close fails to finish beyond the bar's own midpoint in the
>   traded direction: `close <= (high + low) / 2` for a **long**, `close >= (high + low) / 2` for
>   a **short**.
>
> `body = |close - open|`, `upper_wick = high - max(open, close)`, `lower_wick = min(open, close) - low`.

**OHLC against OHLC. No constant, no fraction, no threshold** — ALGO-071 §3's standard
(*"OHLC against the band, no fraction"*) applied to the candle instead of the band.

**Why the midpoint is not a smuggled magnitude.** It is not a chosen level; it is the bar's own
geometric centre, derived entirely from that bar's own high and low. There is no value to tune:
`(high+low)/2` has no free parameter, and no search range exists over it. Contrast `close_loc
0.78`, which is a *position on* that range and could have been `0.72` or `0.84` — which is
exactly why the spec shipped it with a search range and why ALGO-071 §3 retired it.

## 5. Hand-checked against the shapes the teaching cares about — BEFORE any guard

| fixture | shape | T3 | required by |
|---|---|---|---|
| `(100, 101, 99, 100.05)` | **doji** at the zone | **REFUSED** (MIXED: 0.05 < 0.95 and < 1.0) | T3 "doji control" |
| `(101.2, 110, 92, 101.0)` | **mixed**, both wicks large | **REFUSED** (MIXED) | T3 "mixed control" |
| `(100, 101, 95, 100.8)` | **hammer / pin** — long lower wick, closes up | **PASSES** (C1 false: upper wick 0.2 < body 0.8; close 100.8 > mid 98) | T5 — must NOT be refused |
| `(101.6, 103.5, 101.5, 103.2)` | the ALGO-071 §5.3 **clean thin-wick rejection** | **PASSES** (C1 false; close 103.2 > mid 102.5) | ALGO-071 §5.3 fixture 1 |

The hammer and the §5.3 fixture are the two that matter most: **a T3 that killed either would be
refuted by the teachings before any guard ran.** Both pass.

## 6. Where it goes, and what it does NOT do

T3 is evaluated at the **story control step** — the place `_control` occupied — on the last
completed bar of the rejection story. It **replaces nothing else**:

- the band geometry of a rejection (ALGO-071 §3's *"traded into the band and closed back out on
  the near side"*) is R2's clause and stays exactly as R2 defines it;
- the reclaim **hold/defense** requirement stays `_defended`;
- Route A's momentum and force stages are untouched — R2c is **not** in this batch;
- no break-family gate is touched.

T3 answers one question only, the one the teaching asks: **did anybody take control of that bar?**

## 7. Pre-registration this document is bound by

Written here so it cannot be adjusted after the numbers arrive:

1. The clause is **§4 exactly as written**. If the guard is disappointing, the clause does not
   move — the lane closes honest-partial and the reserved-class ask (a live demonstration of a
   mixed-control refusal) goes to the operator. **Never a fraction re-fit.**
2. The bullet must land on **`S:2026-03-24T00:15:00-04:00:96923` @ 09:32** and
   **`SWING:S:2026-03-17T22:30:00-04:00:100322` @ 11:37**. If T3 kills either, T3 is **refuted**.
3. The 04-14 control must survive **by key and target**.
4. Sessions silenced: **ZERO**.
5. Expected direction, stated in advance so it can be wrong: T3 should cut hard into
   `touch_and_reject` and `prior_momentum_after_rejection` — the populations a control-quality
   gate bites — **without** R2c's 04-09 kill, because T3 reads the **completed rejection bar**,
   not the forming trigger's follow-through. That difference is the whole reason to expect a
   different outcome from R2c's.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this formalization.
