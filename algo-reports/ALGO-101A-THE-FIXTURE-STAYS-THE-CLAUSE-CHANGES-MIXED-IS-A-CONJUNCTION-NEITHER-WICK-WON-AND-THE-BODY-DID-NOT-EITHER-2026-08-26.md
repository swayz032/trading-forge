# ALGO-101A — **The fixture STAYS; the clause changes.** The worker's a-priori check fired exactly as §4 intended: T3′ refuses the ALGO-071 §5.3 clean thin-wick rejection, a bar that won **with its body**. Reading (1) — move the inconvenient fixture to another clause's list — is REFUSED as the goalpost move §6 exists to forbid. Reading (2) — close the lane — is premature, because **T3′ and C1 are each one HALF of the same taught sentence**. "Mixed" is a **conjunction**: *neither wick won* **AND** *the body did not win either* — which is the retired predicate's own docstring, with the magnitudes replaced by comparisons. Authorized as **T3″**, and it is genuinely the last.

**Advisor:** Claude (Fable 5), ALGO seat — `trading-forge-49`. **Amends:** ALGO-101 §3 only.
**Ruled on:** the worker's a-priori fixture check — **no guard was run, nothing is contaminated,
no result was seen.** **Channel head at drafting:** `17e0c345`. **Main head:** `c62bb561e015`.
**PR #38: DRAFT / DO NOT MERGE.** Strategy head `abce4155`; sunset pack committed `b81eed6c`
(878/0, handover guard 12/12).

## 1. The conflict, verified at the tick [MEASURED HERE]

`(O 101.6 · H 103.5 · L 101.5 · C 103.2)` against band `[100, 102]`: **body 1.60 of a 2.00 range
(80%), closing at the very top**, upper wick 0.30, lower wick 0.10. It traded into the band and
closed decisively above it. **That is a maximally decisive rejection — it simply won with its
body instead of with a wick.** T3′ fires `NOT_WON` (`lower 0.10 <= upper 0.30`) and refuses it.
The worker is right, and it found this from the ruling's own required fixture list before running
anything.

## 2. Reading (1) is REFUSED — a fixture is not moved because a clause fails it

The argument that §5.3's bar "is about the band, not about control quality" is not absurd, but
adopting it would mean **relocating a required fixture the moment a clause failed it**, which is
precisely what §6 forbids and what an overfitter's path looks like from outside. And it is wrong
on the merits: **a control-quality gate that refuses a bar which closed 80% body at the top of its
range is broken regardless of which list the bar came from.** The fixture stays in T3's list.

## 3. Why (2) is premature — C1 and T3′ are the two halves of one sentence

The retired implementation's own docstring states the taught semantic exactly:
> *"Both wicks substantial and the body small: the bar argues with itself."*

That is a **conjunction of two failures**. The magnitude-bound `two_sided_wick_conflict(min_each,
max_body)` encoded both halves with numbers. **C1 kept only the body half** (`body < both wicks`)
and convicted a bar whose wick won by 1.67×. **T3′ kept only the wick half** (`lower <= upper`)
and convicts a bar whose body won by 5×. **Each is one half of the same sentence, and each fails
on the side it dropped.** The fix is not a third idea; it is the sentence.

## 4. RULED — **T3″**, magnitude-free, and it is the last expression of this clause

> **T3″ refuses iff `MIXED ∨ NO_DIRECTIONAL_CONTROL`**, on the completed story bar
> (ALGO-033 placement unchanged), where for a **LONG** at support:
> - **`MIXED`** = `lower_wick <= upper_wick` **AND** `body <= max(upper_wick, lower_wick)`
>   — *neither side won the contest, and the body did not win it either: the bar argues with
>   itself.* Mirrored for a SHORT (`upper_wick <= lower_wick AND body <= max(...)`).
> - **`NO_DIRECTIONAL_CONTROL`** = unchanged: `close <= (high+low)/2` for a long, mirrored.
>
> `body = |close - open|`, `upper_wick = high - max(open, close)`, `lower_wick = min(open,close) - low`.
> Ties refuse (stricter-wins), on both conjuncts. **OHLC against OHLC; no constant, no fraction.**

**This is the retired predicate with its magnitudes replaced by comparisons** — the same move
ALGO-071 §3 made for the band (*"OHLC against the band, no fraction"*), applied to the candle.

**Required a-priori check BEFORE any guard, on ALGO-101 §3's fixture list, unchanged and
un-relocated:** doji → REFUSE · opposing-wick-dominant spinning top → REFUSE · wrong side of the
midpoint → REFUSE · hammer → PASS · contested rejection (dominant rejection wick + substantial
opposing wick) → PASS · **ALGO-071 §5.3 clean thin-wick → PASS**. Publish the seven-row table
(the six fixtures + his 03-24 09:25 bar) **before** the guard. **If T3″ conflicts with any
required fixture a priori, the lane CLOSES — do not correct it a third time.**

## 5. The guard and the guard-rails — unchanged from ALGO-101 §3, restated for the record

Control by key **and** target · sessions silenced **ZERO** · the bullet lands on
`…96923@09:32` **and** `…100322@11:37` still survives to ranking · **the approval count is
REPORTED, NOT REQUIRED** (ALGO-100D: the flood is the clutter map, not the story gate — a packet
arguing success *because* the count fell is refused) · every number states its horizon.

**THE HARD GUARD, restated and tightened.** We are three expressions into one clause. Each
correction has been forced by an a-priori shape rather than by a result — C2 by the hammer, C1 by
the §5.3 fixture and his contested bar, T3′ by §5.3 again — and **no expression has ever been
selected by which one passes his trades.** That is the only thing separating this from fitting,
and it holds only while the corrections keep arriving before the measurements. **So: T3″ is the
last. If it fails the guard, the story-control lane CLOSES, the residual goes to the one
reserved-class operator ask (a live demonstration of a rejection he takes versus a mixed touch he
refuses), and no fourth reading is authorized by anyone.** The 14 sessions may falsify T3″; they
may never select it.

## 6. Recorded, unrelated to the above

The original T3's **09:30 arm** landed: **39 approvals** (baseline 23, batch head 67) — same
verdict as the 08:00 arm; honest-partial stands and T3-as-expressed is not adjusted. The
**sunset pack is COMMITTED at `b81eed6c`** with all five files at repo root, stale heads corrected
in seven places, the handover guard passing 12/12 and the suite at 878/0 — **the operator's
post-sunset insurance now exists in the repo as well as on this ladder (ALGO-100E).**

LESSON: two clauses can each cite the teaching correctly, each be magnitude-free, and each be
wrong — because each implemented **half** of the taught sentence and dropped the half that
covered the other shape. **When a clause fails an a-priori fixture, ask which half of its own
sentence it dropped before asking whether the fixture belongs.**

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.
