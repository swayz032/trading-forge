# ALGO-103 — T3′′ does everything a control-quality gate can: **both hits and the control survive by key, nothing is silenced, and it refuses the mixed/doji stories it was written to refuse.** It does not make his 03-24 entry the day's first approval, and the thing that beats him there is **`08:17 S BRK5` — a BASELINE approval, break-family, outside T3′′'s authority entirely.** Reported against §3's acceptance, not against the approval count.

**Strategy head:** `6ea8f16a` (pushed, `ls-remote` verified). **Batch head under test:** `ee4eac59`
on `research/algo-t3-redproofs-20260826` — **unmerged, nothing landed.**
**PR #38:** DRAFT / DO NOT MERGE. **Semantic files modified on the strategy head: NONE.**
**Authority:** ALGO-101 §3 as amended by ALGO-101A (T3′′ authorized, last expression).
**Suite:** 860 passed, 0 failed in the batch tree.

**HORIZONS, stated once and applied throughout** (ALGO-100D): every **membership** number is at
`as_of=replay_end` (`run_approved_entry_membership_capture.py:72`); every **survives-to-ranking**
number is at `as_of=None`, the full session (`run_algo096_candidate_table_six_clocks.py:104`).
Both verified at the line.

---

## 0. VERDICT AGAINST §3, LINE BY LINE

| line | measured | verdict |
|---|---|---|
| control survives BY KEY | `2026-04-14 09:38 L BRK5` target `25869.0`, **identical to baseline at BOTH pins**; survives to ranking at `SWING:R:2026-04-14T09:15…102865` | **PASS** |
| sessions silenced | **0** at both pins | **PASS** |
| **(ii-a)** 03-24 `…96923@09:32` | **his candidate SURVIVES T3′′** — present as an approval and as the session's only survivor to ranking | **T3′′ PRESERVES IT** |
| **(ii-a)** *bullet lands* on it | **NO** — the day's first approval is `08:17 S BRK5` | **FAIL, and §1 shows why it is not T3′′'s** |
| **(ii-b)** 04-09 `…100322@11:37` survives to ranking | **SURVIVES** | **PASS** |
| approval count | 08:00 `143 → 91` (−52, +0); 09:30 `23 → 47`. **REPORTED, NOT ARGUED** — §3 clause 4 | reported |
| new early Route-A on convicted days | 37 → **16** | reported |
| a-priori fixture table | **7/7, no conflict** (§2) | **PASS** |
| mutation battery | 9 defects, **every one RED, no gaps** (§4) | **PASS** |

**T3′′ is not refuted by anything it governs.** The one failing line fails on an object it has no
authority over, and that object is measured and named in §1 rather than asserted.

## 1. THE BULLET-BLOCKER, MEASURED — and it predates every repair

§3's (ii-a) asks that the bullet **land** on his `09:32`. It does not. The day's first approval
under T3′′ is:

> **`2026-03-24 08:17 S BRK5`** — and it is **one of the five approvals in the 40 BASELINE.**

Three facts, each measured, that together put it outside this batch's reach:

1. **It is not something the batch created.** It exists at `56d9360d`, before R2, R2b, F1 or T3′′.
   The batch *did* add an earlier one — `08:12 S REV` — and **T3′′ refused that one** (§3).
2. **It is not a Route A story.** It is `BRK5`, break-family. **T3′′ only refuses Route A
   rejection stories**; it never evaluates a break candidate. There is no expression of T3′′,
   however written, that could refuse `08:17`.
3. **T3′′ removed everything on that day it *could* remove.** Of the ten batch-head approvals on
   03-24, T3′′ refused the two Route A stories that failed control (`08:12`, `09:37`) and left the
   five baseline BRK5s and the two `touch_and_reject` stories that passed it.

**So (ii-a) is unsatisfiable by any story-control clause on 03-24.** That is not a plea to widen
the rule — the rule was conjunctive and it decided — it is the measurement of *which layer* the
remaining obstacle lives in, and it agrees exactly with ALGO-100D (the flood's cause is the
destination/clutter map) and ALGO-102 (the map admits a median 64 locations per session).

## 2. THE A-PRIORI TABLE — published before the guard ran, six required fixtures UNCHANGED and UN-RELOCATED

ALGO-101A §4 made this the gate: if T3′′ conflicted with any required fixture a priori, the lane
closed with no third correction. **It conflicted with none.**

| fixture | required | T3′′ | decided by |
|---|---|---|---|
| doji | REFUSE | refuses | `not_won` ∧ `body_small` |
| opposing-wick-dominant spinning top | REFUSE | refuses | `not_won` ∧ `body_small` |
| wrong side of midpoint | REFUSE | refuses | `NO_DIRECTIONAL_CONTROL` (`not_won` FALSE — isolated) |
| hammer | PASS | passes | `lower 5.50 > upper 0.20` |
| **ALGO-071 §5.3 clean thin-wick** | PASS | **passes** | **the BODY conjunct** (`body 1.60 > max(0.30, 0.10)`) |
| contested rejection | PASS | passes | `lower 10.40 > upper 5.40` |
| **his 03-24 09:25 bar** | PASS | **passes** | **the WICK conjunct** (`lower 25.50 > upper 15.25`) |

**The two bars that each refuted a one-sided reading are saved by DIFFERENT conjuncts**, and a
test asserts precisely that. So neither half is dead weight, and no one-sided reading can pass
this suite again.

## 3. PER-APPROVAL T3′′ VERDICTS (ordered by ALGO-100C §3)

**03-24 — the ten batch-head approvals:**

| clock | dir/setup | story kind | T3′′ |
|---|---|---|---|
| 08:12 | S REV | `prior_momentum_after_rejection` | **REFUSED** |
| 08:17 · 08:18 · 08:32 · 08:33 · 08:34 | S BRK5 | — | survives *(break family — not T3′′'s to judge)* |
| 08:27 · 08:28 | L REV | `touch_and_reject` | survives |
| **09:32** | **L REV** | `touch_and_reject` | **SURVIVES — HIS** |
| 09:37 | S REV | `touch_and_reject` | **REFUSED** |

**04-09 — the eleven approvals:** T3′′ refuses `08:43`, `09:28`, `09:29` (all `touch_and_reject`
Route A) and leaves `09:44`, `09:53`, `10:17` plus the five BRK5s including the `11:27`/`11:28`
SHORTs on his own zone. **A clause that refuses three of his day's earlier Route A approvals
while sparing the break-family shorts is a finding either way**, and it is the finding: T3′′
bites exactly where it has authority and nowhere else.

## 4. MUTATION BATTERY — and a third isolation error, found and fixed

Nine defects, membership never counts, byte-exact restore verified by `sha256` on every arm:

| defect | RED | | defect | RED |
|---|---|---|---|---|
| M1 `NOT_WON` dropped | 3 | | M6 short mirror removed | 1 |
| M2 `BODY_SMALL` dropped | 2 | | M7 `DIRECTIONAL` disabled | 1 |
| M3 MIXED disabled entirely | 3 | | M8 `DIRECTIONAL` tie flipped | 1 |
| M4 `NOT_WON` tie flipped | 1 | | M9 T3′′ short-circuited | 7 |
| M5 `BODY_SMALL` tie flipped | 1 | | **gaps** | **none** |

**The first run had M3, M4 and M5 at 0 RED**: the doji and spinning-top fixtures close **below**
their own midpoints, so `NO_DIRECTIONAL_CONTROL` was refusing them and **MIXED was never
load-bearing in any test — it could have been deleted with nothing going red.** Three new
fixtures close **above** their midpoint so the directional half passes them and MIXED alone
refuses: one per conjunct, one per tie. All are **tick-aligned quarters**, because a tie fixture
asserting `==` on values like `102.6 − 102.0` fails on float representation — a fixture defect
wearing a code defect's costume.

**This is the third time in this round that a fixture was decided by a clause other than the one
under test** (T3's bars closing inside the band, the tie bars caught by MIXED, and now MIXED's
own bars caught by the directional half). It is now asserted inside every test rather than
assumed, and it is recorded as a standing law rather than a one-off.

## 5. WHAT T3′′ IS, in one line

`MIXED = (rejection_wick ≤ opposing_wick) ∧ (body ≤ max(upper_wick, lower_wick))`, plus
`NO_DIRECTIONAL_CONTROL = the close fails to finish past the bar's own midpoint`; refuses on
either; ties refuse on all three; the rejection side is **below** for a long at support and
**above** for a short at resistance. **OHLC against OHLC — no constant, no fraction, no
threshold**, asserted by an AST scan of the landed clause. It is the retired predicate's own
sentence — *"Both wicks substantial AND the body small: the bar argues with itself"* — with its
magnitudes replaced by comparisons: the ALGO-071 §3 move applied to the candle instead of the band.

## 6. WHAT I DID NOT DO

No re-fit, no threshold, no fourth reading. **The clause is exactly as ALGO-101A authorized it**
and I did not touch it after seeing a number. No fixture was revised after a result — the three
new isolation fixtures were added *before* the guard, to close mutation gaps, and the six
required fixtures are unchanged and un-relocated. R2c is not in this batch. Break-family gates,
`entries.py`, `breakout_derivation.py`, `target_policy.py`, the 17.25-pt stop, targets and the
exam rules are untouched. **Nothing is landed on the strategy head, and re-exam #3 is not run** —
it runs only after a passing guard.

## 7. ASKS FOR ALGO-104

1. **Does (ii-a) failing on a baseline break-family approval close this lane, or does it hand the
   remaining distance to the map lane?** T3′′ preserves both hits, holds the control by key at
   both pins, silences nothing, and refuses only what it governs. I am **not** proposing to
   soften (ii-a) — it was conjunctive and it decided. But the object that beats him at `08:17`
   is a `BRK5` from the 40 baseline, and no story-control clause can reach it.
2. **The `08:17 S BRK5` itself is now the sharpest single question on 03-24** — a break-family
   approval 75 minutes before his own entry, on the untouched baseline. It is named here, not
   opened.
3. **Known defect carried forward, not fixed:** `V24_TARGET_DISTANCE_LT_REACTION_CONTACT`
   (`target_policy.py:157-161`) **raises instead of declining** — verified at the line at this
   desk. Recorded in the runbook, kill/heartbeat and the handover's open queue with the literal,
   the session (2023-04-03) and the census warning that a crashed session is not a no-trade
   decision.

---

**Suite line, enumerated.** `pytest tests/ -k v2_4` in the batch tree → **860 passed, 0 failed,
831 deselected**; 14 tests in the T3 file. Mutation battery: 9 defects × full suite, `sha256`
restore verified on each. A-priori table: 7 fixtures × the committed clause, computed and
published before the guard. Captures: 3 code arms × 2 pins × 14 sessions. Candidate table: his
six clocks at `as_of=None`. Strategy head `6ea8f16a`, batch `ee4eac59`, red-proof history
`3ebebf4a`, R2c `7d42d121` — all unmerged except the head, which carries no batch semantics.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.
