# ALGO-124 — **The band was built, measured, and REVERTED.** Re-exam #5 fails the binding clause: the 09:30 arm is identical by membership, but **04-14 leaves the deployed 08:00 arm, 1/8 → 0/8.** The control zone survives by key — what moved is the CLOCK, and the early bullet is measured a third time. Plus the geometric finding that outranks the exam number: **his band grows on the side price came FROM, never the side it goes TO**, so it cannot catch a break-family fill by construction. And three defects in my own guard, all surfaced by ALGO-120's mandatory residual.

**Strategy head:** `215bef16` — **PUSHED, remote-verified** (`git ls-remote` → `215bef16…`), code pushed BEFORE this report. The REVERT is `f132617c`; `215bef16` adds only the break-family census evidence of §4a and touches no semantic file.
**Semantic file modified:** YES, then **REVERTED** — `research/current_mnq_strategy_v2_4_levels.py`
is **byte-identical to `a355507d`** (`git diff --quiet` against the pre-band pin, verified, not
assumed). **PR #38: DRAFT / DO NOT MERGE.** **Gate:** FREEZE remains BLOCKED. **No question went
to the operator. Both reserved-class asks remain drafted and UNSENT.**
**Rules read:** ALGO-117 @ `eca7c7f2` · ALGO-119 @ `f790af89` · ALGO-120 @ `8911369e` ·
ALGO-120A @ `62351ba9` · ALGO-121 @ `42b7bf50` · ALGO-122/122A · ALGO-123 @ `41675e99`.

---

## 1. THE DISPOSITION FIRED AND I EXECUTED IT WITHOUT ARGUMENT

ALGO-119 §7, pre-registered **before** the exam ran: *"nothing leaves and the control holds → the
batch STAYS; **anything leaves → REVERT in one commit, plainly**."*

**Something left.** The revert is `f132617c`. No clause was re-expressed to rescue it, no
threshold was touched, and the cause below is offered as a **diagnosis**, never as an argument to
keep the batch.

## 2. RE-EXAM #5 — by MEMBERSHIP, against the pre-band pin

| arm | before | after | agreeing before | agreeing after | lost | gained |
|---|---|---|---|---|---|---|
| **09:30 baseline** | 3/8 | **3/8** | 03-24, 03-30, 04-14 | 03-24, 03-30, 04-14 | **none** | none |
| **08:00 taught (deployed)** | 1/8 | **0/8** | 04-14 | — | **04-14** | none |

The 09:30 arm's class census is **identical in every cell**. The F2 anchor sha256 is unchanged
(`508123125cf…`); `F2_lost_vs_anchor_taught_0800` grows by `04-14`. `A1` FAIL→FAIL, `F2`
FAIL→FAIL, **zero agreements gained anywhere.** FREEZE stays BLOCKED — 08:00–12:00 is
unconditional and there is no 09:30-deployed fallback (ALGO-049 §3).

## 3. THE CAUSE, NAMED TO THE KEY — AND IT IS NOT THE BAND SHAPE

**The control zone SURVIVES.** `SWING:R:2026-04-14T09:15:00-04:00:102865` exists at **both** pins.
Band `[25714.67, 25717.83]` → `[25678.00, 25716.25]`, with its wick extreme still an exact edge.
Nothing was deleted, mis-drawn or displaced.

**What moved is the CLOCK.**

| | before | after |
|---|---|---|
| `bot_window_status` | `FIRST_A_PLUS_INSIDE_OLD_REPLAY_WINDOW` | `FIRST_A_PLUS_PRECEDES_OLD_REPLAY_WINDOW` |
| `bot_state_in_window` | `ENTER_LONG` @ 09:38, BRK5, on `…:102865` | `BUDGET_CONSUMED_BEFORE_WINDOW` |
| `decisions_through_window_end` | 1 | **5** |
| `decisions_in_window` | 1 | 3 |

Wider bands are **reachable earlier**, so the one-bullet budget is spent before the window opens.
**This is the early-bullet mechanism ALGO-105 named and priced at two agreements, measured here a
third time and now by a change that touched only zone GEOMETRY.** The batch did not break the
control; it fed the constraint the campaign already knows is binding.

## 4. THE FINDING THAT OUTRANKS THE EXAM NUMBER — ALGO-121 §4's PREDICTION, RESOLVED

ALGO-121 §4 pre-registered: fills measured **5.75–28.17 pt outside** a ~5-pt band (ALGO-102A,
6 of 6) **should sit INSIDE** a ~32-pt band. Re-measured at both pins against **the same
authorising zone by key**:

| session | dir | bot fill | authorising family | old band | old | ruled band | new |
|---|---|---|---|---|---|---|---|
| 03-23 | S | 24,429.00 | **ESTABLISHED** | w 9.48 | below 14.76 | **unchanged** | below 14.76 |
| 03-24 | S | 24,333.25 | **ESTABLISHED** | w 19.25 | above 5.75 | **unchanged** | above 5.75 |
| 03-31 | L | 23,383.25 | **ESTABLISHED** | w 11.42 | below 9.44 | **unchanged** | below 9.44 |
| 04-06 | S | 24,278.50 | SWING | w 3.84 | below 10.83 | `[24256.50, 24291.25]` w 34.75 | **INSIDE** |
| 04-09 | L | 25,056.25 | SWING | w 6.06 | above 20.47 | **zone removed by the ruled band** | — |
| 04-14 | L | 25,746.00 | SWING | w 3.16 | above 28.17 | `[25678.00, 25716.25]` w 38.25 | **above 29.75 — FURTHER OUT** |

**Three of the six were authorised by ESTABLISHED zones whose bands the build never touches** —
a case-level confirmation of the scope control that is strictly stronger than comparing zone-ID
sets. Of the three SWING-authorised: **one moved INSIDE, one had its zone removed, one moved
FURTHER OUTSIDE.** The prediction is **1 confirmed / 1 refuted / 1 unmeasurable**, and the reason
is geometric rather than statistical:

> ### HIS BAND GROWS ON THE SIDE PRICE CAME FROM, NEVER THE SIDE IT GOES TO.
>
> A resistance zone is `[close, high]`, so **all** of its new width lies BELOW the level. A long
> fill above that level gains nothing — on 04-14 the band's `hi` actually moved *down* 1.58 pt
> and the displacement grew. A support zone mirrors it. So the ruled band widens toward the
> approach and not toward the break, and **a break-family fill cannot be brought inside it by
> this construction at any width.** Rejection-family fills, which sit on the approach side, are
> exactly the ones it catches — 04-06 is that case.

This is a statement about the SHAPE, and it holds independently of the exam. **The entry
displacement is not a band-width problem, and widening will never fix it.**

### 4a. THE SETUP COLUMN THIS DESK ASKED FOR — and it retires ALGO-102A's reading

Measured at `f132617c`, not inferred from ruling prose: the arm artifacts give the two in-window
entries, and `run_break_family_bullet_census_2026_08_26` gives the four session-first entries that
spend the bullet before the window (those four carry no `entry_family_receipt`, because that field
covers in-window entries only, and `budget_faithful` records the session-first entry's time and
action but **not** its setup).

| session | dir | setup | granting route | reason literal | authorising zone family |
|---|---|---|---|---|---|
| 03-23 | S | **BRK5** | Route D · prebreak_repeat_test | `PREBREAK_REPEAT_TEST_INTRA5_FORCE` | ESTABLISHED |
| 03-24 | S | **BRK5** | Route D · prebreak_repeat_test | `PREBREAK_REPEAT_TEST_INTRA5_FORCE` | ESTABLISHED |
| 03-31 | L | **BRK5** | Route D · break_retest | `ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE` | ESTABLISHED |
| 04-06 | S | **BRK5** | Route B · normal_breakout | `FIRST_BREAK_PRINT_THEN_INTRA5_FORCE` | SWING |
| 04-09 | L | **BRK5** | Route D · break_retest | `ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE` | SWING |
| 04-14 | L | **BRK5** | — (in-window) | `FIRST_BREAK_PRINT_THEN_INTRA5_FORCE` | SWING |

**SIX OF SIX ARE BREAK-FAMILY.** The join is verified on three independent fields — session,
direction, and the zone family, which matches §4's table row for row; the census clocks also
reproduce ALGO-106's published 187 / 75 / 46 / 57 / 118 minutes.

> **ALGO-102A MEASURED BREAK-FAMILY FILLS AGAINST A REJECTION-SHAPED BAND.** A break entry is
> by definition a fill on the far side of the level from the rejection wick, and his band lives
> entirely on the wick side. **"The bot never enters at the level it is trading, 6 of 6" is
> therefore the arithmetic of the two shapes meeting, not evidence of a defect** — and the 5.75
> to 28.17 points is a measure of how far past a level a break carries, which is a property of
> the market and of the taught bar sequence (ALGO-033: story on the completed bar, entry on the
> forming trigger), not of the location layer.

ALGO-102A's *other* half is untouched and still bites: **his** fill lands INSIDE a his-rule band
on 5 of 5 measurable, and 3 of 13 measured entries put a 17.25-point stop inside the authorising
band. Those are rejection-side observations and this finding does not reach them.

## 5. THE STRUCTURAL OBSERVABLES — reported, none of them a target

**Map, at the 09:30 anchor, 14 frozen sessions.** Authorized locations **865 → 522 (−39.7%)**;
swing zones **578 → 235 (−59.3%)**; **established 287 → 287, identical BY KEY on 14 of 14
sessions**; mean **61.8 → 37.3 per session**. *Neither figure is a target, and no band was chosen,
tuned or preferred because of what it does to them.* **37.3 is still not "a handful" and this
packet does not claim it is.**

**Width tail, ALGO-121 §3 — REPORTED, NOT CAPPED.** Swing band width median **5.07 → 32.50 pt**,
p75 43.25, **p95 65.25, max 124.25**. His demonstration is 4–32 pt, so the median lands at its top
and the tail leaves it. **No cap is authorized and none was written**; a cap read off this
distribution would be a new magnitude chosen from the data meant to judge it. The `$400` floor is
a floor on TP *distance* and was not borrowed. Cause is structural: `min_wick 0.20` is a LOWER
bound only, so width can reach the full bar range. `no citation found in the surfaces named`.

**ALGO-121 §3a, lifecycle scaling — measured.** `zone.mid` is the band-INTERIOR reclaim threshold
at `zone_lifecycle.py:91`. Its distance from the level goes **0.00 → 16.25 pt median, 62.13 max**
(it was exactly 0.00 before, because the symmetric band was centred ON the level). **The lifecycle
semantics scale with band width and nobody derived that.** Bucket **(c)** counts it: **143 keys by
key — 80 ADDED, 63 REMOVED.**

**Bucket partition, ALGO-120 §5 — HOLDS.** 518 changed keys, each in exactly one bucket:

| bucket | | n |
|---|---|---|
| (a) | established-overlap drop | **209** |
| (b) | rank displacement | **151** |
| (c) | lifecycle | **143** (80 added, 63 removed) |
| (d) | **quality move** | **0** |
| (e) | residual | **15** |

**(d) IS EMPTY.** The join refactor moved no band-independent quality input for any zone present
at both pins, so **re-exam #5 read the band and only the band.** The 15 residuals are all a single
named class: `confluence` `0 → 1` on a key present at both pins — an FVG overlap computed FROM
`lo`/`hi`, so the ruled band gains it by construction. It is a real selection effect (confluence
is a rank term at `levels.py`'s greedy pass and at `kernel.py:207`) and **ALGO-120's five buckets
do not name it**, so the residual carries it with its reason. **The taxonomy has that one gap and
the residual is what exposed it.**

## 6. THREE DEFECTS IN MY OWN GUARD — every one found by the residual, none by review

**(i) My first `(d)` field set included `confluence`.** (d) fired on 15 keys and I was one step
from reporting your positive control as breached. `confluence` is `overlap(lo, hi, fvg…)` — a
function OF the band. **A positive control whose field set includes a field the change is supposed
to move is not a control, it is an alarm wired to the thing you are testing.**

**(ii) `Location.side` is the LIVE ROLE, not the creation polarity — and 355 of 865 zones
disagree.** `zone_lifecycle` does `replace(zone, side=role)` on a break or flip; `origin_side()`
exists precisely to recover the original from the id. My differ joined on `side`, so for every
flipped zone it drew the **MIRRORED** band. Fixing it to `origin_side` moved **32 keys out of (a),
75 out of (b), 25 out of (c)** — the attribution was wrong at a third of the changed set while
every bucket count looked plausible.

**(iii) Production dedups by the LIVE role and recomputes confluence on the ruled band.** My (b)
probe used the origin and the stale confluence, leaving 77 keys unattributed in the residual.
Mirroring production exactly cleared them.

**The positive control I should have had from the first line, now in place:** every reconstructed
band must have the pivot level as an exact edge — **503 of 503 do.** Two of these three were
invisible to the bucket counts and visible only because ALGO-120 made the residual mandatory.
**A four-bucket taxonomy would have absorbed all three silently.**

> **A GUARD THAT RECONSTRUCTS AN OBJECT MUST ASSERT THE RECONSTRUCTION, NOT ONLY THE COMPARISON.**

And the one that generalises past this packet:

> **A FIELD THAT THE CHANGE IS SUPPOSED TO MOVE CANNOT SIT INSIDE THE CONTROL THAT PROVES THE
> CHANGE MOVED NOTHING ELSE.**

## 7. WHAT THE BUILD WAS, WHILE IT STOOD — `64e3f465`, now reverted

The exceptional single-swing band became **`[wick extreme, close]` of the pivot's own source
candle** on its marked 15m — his sentence (ALGO-073 §1, ruled §2) at an executable line for the
first time. The existing join at `levels.py:76-86` was **split out and USED, never duplicated**;
its `except Exception: return 0.5` is **gone**, replaced by
`V24_PIVOT_SOURCE_BAR_JOIN_FAILED` and `V24_REJECTION_BAND_DEGENERATE`.

**NO NEW MAGNITUDE, AND IT IS PROVED RATHER THAN ASSERTED.** Every admitted pivot has already
passed `wick >= p.min_wick`, and `wick` is measured from the BODY EDGE, so
`close − low >= 0.20 × range > 0` on the support side and `high − close >= 0.20 × range > 0` on the
resistance side. **A zero-width band is unreachable, so no floor is required** — and the degenerate
branch still raises, so a later change to that filter fails loudly instead of drawing a zero-width
zone. Pinned as a test over 2,000 random admitted bars.

**The join had been silently firing in the TESTS for its whole life.** All twelve fixtures in
`tests/test_current_mnq_strategy_v2_4_levels.py` passed an EMPTY 15m frame, so every one had been
asserting against a fabricated `close_away = 0.5`. Six went RED the moment the join failed loudly.

**ALGO-122A's convergence, recorded as an observation and not as a claim:** `avoid_chart_clutter`
is a taught policy flag whose only reader is a test asserting the JSON says `True`, and this band —
derived from the shape of a zone, with no magnitude added — is the first thing that acts on it.
Two independently taught clauses converging on the same correction is the strongest anti-overfit
evidence available here. **It does not follow that the band satisfies the policy.**

## 8. WHAT IS KEPT, AND WHAT IS NOT

**Reverted:** `current_mnq_strategy_v2_4_levels.py` (byte-identical to `a355507d`),
`tests/…_band_shape.py` removed, `tests/…_levels.py` restored.
**Kept, because it is the record and not the change:** the a-priori fixture table (`f88979b6`,
committed BEFORE the build), both map captures, the band guard artifact, and the three re-exam #5
artifacts under `…_algo119_reexam5_*`. **The build is recoverable in one `git revert` of
`f132617c`** if this desk re-authorizes it.

**Not done, and named rather than skipped quietly:** ALGO-123's `reference_tp_reward_usd`
distribution. The tree is back at the pre-band pin, so that distribution would describe the old
map; it is a few lines at whichever pin this desk names.

## 9. FOR ALGO-125

1. **The band is not refuted — the bullet is.** The 09:30 arm held perfectly by membership; the
   only casualty is a session whose bot entry moved EARLIER. Every band-shaped repair will hit
   this same wall while one bullet is spendable from 08:00.
2. **§4 is the reason widening cannot be the answer to entry displacement.** The shape puts the
   width on the approach side. That is a fact about his rule, not about this implementation.
3. **The seven-plus-one undeclared weights and the five-weight swing composite sat upstream of
   every number in this packet**, and a result in either direction is partly theirs.

---

**Enumerated.** 1 semantic module changed and reverted · 1 a-priori table (6 fixtures) · 1 new
test file (14 tests, removed with the revert) · 1 legacy test file repaired and restored · 2 new
diagnostic instruments · 5 committed artifacts · 3 commits (`f88979b6`, `64e3f465`, `f132617c`).
Guard: 518 changed keys, partition holds, (d) empty, 503/503 reconstructed bands verified against
their pivot level. **Suite, `PYTHONPATH=. python -m pytest tests/ -q`, measured at BOTH heads:
at the band head `64e3f465` → 1725 passed / 7 failed; at the reverted head `f132617c` →
1711 passed / 7 failed.** The 14-test difference is exactly the band-shape file the revert
removes (1725 − 14 = 1711), and the FAILURE SET IS THE SAME SEVEN **BY MEMBERSHIP** at both
heads — `engine_final` gold lifecycle, deepscan ×2, eligibility ×4 — the seven the worker
handover §7 documents as pre-existing and outside this lane. `PYTHONPATH=. python -m pytest -q`
(default testpaths `src/engine/tests` + `tests/python`) → **7597 passed, 34 skipped, 0 failed**.
**Neither canonical command yields the `923 passed, 0 failed` carried in ALGO-116's and
ALGO-117's headers.** That figure names no command and no population and I could not reproduce it
at either pin. **I nearly published this finding wrong**: my first draft said the figure "stands in
the sunset documents' headers", and it does not — `git grep` finds `923` in no sunset document,
and the one apparent hit is the interior of a price key (`…96923`). It lives on the LADDER, not in
the pack the join guard covers, which is why that guard could never have caught it. Reported, not
resolved — and the near-miss is recorded rather than tidied away, because a bare number searched
across a corpus is nearly all noise and this one was.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.
