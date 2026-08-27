# ALGO-153 — Deriving "major" and "decisive" from his vocabulary. Held evidence only.

**Reserved channel CLOSED (operator standing order). `no citation found` is terminal: derive, or
record `UNDERIVABLE`. No question is available and none was asked.**

**Method: read the blocks whole.** Every occurrence of `displacement`, `major`, `decisive`,
`drastic`, `expansion` and `range expansion` across `video_evidence.md`, `user_fidelity_gold.json`
and the addendum was extracted **with context and read** — not counted. Positive controls live
(`rejection` 30 · `momentum` 37 · `displacement` 21 · `key level` 11 · `wick` 8); negative control 0.

---

## 1. `major` — **UNDERIVABLE**

**It occurs EXACTLY ONCE in the entire corpus**, in `video_evidence.md` principle 3:

> *"A **major** swing high/low followed by decisive displacement can create a meaningful candidate
> level even before many later retests exist."*

**No definition, no comparison class, no contrast case.** Nothing says what a major swing is
larger than, or what a non-major swing looks like.

**THE SENTENCE THAT WOULD HAVE HAD TO EXIST:** something naming what a major swing is major
*relative to* — the swings around it, the session's range, the prior day — **or a contrast case**
(*"this one is a major swing and that one is not"*). **The corpus contains neither.**

## 2. `decisive` — **UNDERIVABLE**

**Also exactly once, in the same sentence.** It qualifies `displacement`, and the corpus never
says what separates decisive displacement from ordinary displacement.

**THE SENTENCE THAT WOULD HAVE HAD TO EXIST:** the V24G02 treatment applied one level down —
V24G02 separates *displacement* from *momentum*, but nothing separates *decisive* displacement
from *any* displacement.

## 3. `displacement` — **DERIVABLE AS A KIND. UNDERIVABLE AS A MAGNITUDE. AND HIS CORPUS CARRIES TWO READINGS IT NEVER RECONCILES.**

**READING A — TRAVEL AWAY.**
> principle 3: *"Strong displacement **away from** a swing"* · source 6: *"price forms a swing
> high/low and then **moves away drastically**"*

**READING B — RANGE EXPANSION.**
> `V24G02.must_have` = **`separate_momentum_geometry_from_displacement_range_expansion`** ·
> `V24G02` label: *"Every strong move is not displacement. There are strong bullish and bearish
> momentum candles that are not displacement."* · principle 11 lists
> *"**compression/expansion**"* among the things to read at the level.

**Reading B is a real, candle-relative discriminator and it is his:** **momentum is the candle's
GEOMETRY (body, close, direction); displacement is RANGE EXPANSION.** That is why a strong-bodied
candle is not automatically displacement, and it is stated as a `must_have`, not as prose.

🛑 **THE TWO READINGS ARE DIFFERENT OBJECTS AND THE CORPUS NEVER JOINS THEM.** A bar can travel far
without expanding its range, and expand its range without travelling far. **Nothing in held
evidence says which one he means, and the reserved channel is closed.**

**MAGNITUDE: UNDERIVABLE under either reading.** Reading A names no distance and no unit. Reading B
names no expansion ratio and no comparison window. **`ATR` occurs ZERO times in his corpus**, so the
unit the code uses is not his under either reading.

---

## 4. What the code implements, stated beside it — **NEITHER MISMATCH IS A THRESHOLD PROBLEM**

`current_mnq_strategy_v1_fast.py`, pivot construction:

```
R:  disp = (pivot_high - min(low of the NEXT TWO bars)) / ATR
S:  disp = (max(high of the NEXT TWO bars) - pivot_low) / ATR
```

⇒ **The code implements READING A — travel away from the pivot over the two following bars,
normalised by ATR.**

- **It is faithful to reading A's KIND.** *"Moves away drastically"* is travel away, and that is
  what this measures. **This is not a wrong-object finding and is not offered as one.**
- **READING B IS IMPLEMENTED NOWHERE.** `separate_momentum_geometry_from_displacement_range_expansion`
  is a `must_have` in his gold fixtures, and no production module separates range expansion from
  body geometry for this purpose. **That is a taught clause with no implementing line.**
- **The ATR normalisation is his under neither reading** — 0 occurrences, measured, with controls.

## 5. Disposition

| clause | status |
|---|---|
| `major` | **UNDERIVABLE** — one occurrence, no definition, no contrast case |
| `decisive` | **UNDERIVABLE** — one occurrence, same sentence |
| `displacement`, as a KIND | **DERIVABLE, BUT AMBIGUOUS** — two readings, both his, never reconciled |
| `displacement`, as a MAGNITUDE | **UNDERIVABLE** — no distance, no ratio, no window, no unit |
| reading B (`range expansion`) | **TAUGHT AND UNBUILT** — a `must_have` with no implementing line |

**No threshold proposed. No number invented. Nothing chosen for what it does to the fourteen
sessions. No question routed to the operator — the channel is closed and these are recorded as
terminal states, not as pending asks.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision.*
