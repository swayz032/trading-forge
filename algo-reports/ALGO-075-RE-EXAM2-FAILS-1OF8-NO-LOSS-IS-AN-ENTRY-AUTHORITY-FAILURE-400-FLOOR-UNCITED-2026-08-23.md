# ALGO-075 — RE-EXAM #2 FAILS 1/8: NOT ONE OF THE FOUR LOSSES IS AN ENTRY-AUTHORITY FAILURE

**Strategy head:** `1c83cbbf28f2487ab888867459094bf158dfdae2` (pushed, `ls-remote` verified)
**Prior head:** `2e165b62` → `cfd44005` (03-31 T/P/G re-row) → `1c83cbbf` (re-exam #2 + attribution)
**PR #38:** DRAFT / DO NOT MERGE
**Semantic production files modified in this packet:** NONE. `kernel.py`, `candidate_xray.py`,
`breakout_derivation.py`, `entry_authority.py` and `target_policy.py` are untouched. Everything
landed here is a new diagnostic module, its artifact, or its guards.
**Gate state:** freeze BLOCKED (unchanged). Re-exam #2 verdict FAIL.
**Suite:** enumerated, `pytest tests/` → **1601 passed, 7 failed**. Failure set compared by
MEMBERSHIP against `cfd44005`: **zero added by this packet**; two apparent removals are
arena-only artifacts of running from a `git archive`. All 7 pre-existing and unrelated
(deepscan freq-map aliases ×2, eligibility-gate stop ceiling ×4, engine-final gold lifecycle ×1).
The runbook's own pinned failure-count test passes at 7, which is the documented baseline.

---

## 1. Ruling item (1) — the 03-31 T/P/G re-row

R1b made the location reachable, so the row rests on a predicate rather than an absence. At his
09:45 bucket, on the J5 WICK_ZONE band `23430.71–23441.29` that covers his line `23436.625` with
gap 0.0, the **3 matching candidates reach all four taught break forms and every one refuses**:

| T — taught form | P — refusal at its line | rests on | taught? |
|---|---|---|---|
| Route B `normal_breakout` | `NOT_THE_FOLLOWING_BAR` | bar ordering (§7.6/§7.7) | **yes** |
| Route C `prebreak_displacement` | `THIRD_CANDLE_LOST_CONTROL` | control direction (§7.9) | **yes** |
| Route D exception 2 `repeat_test` | `NO_PRIOR_TEST` | a rejection-wick candle before the last bar (§7.10/§7.11) | **yes** |
| Route D `break_retest` | `NOT_ACCEPTED` | **`acceptance_bars = 3`** | **NO — unfrozen** |

**G — the bars**, band-relative (`beyond` = close above band hi):

```
09:30  O23382.25 H23459.50 L23378.75 C23458.00  body 0.938  upwick 0.019  beyond=True   first break print
09:35  O23458.00 H23460.50 L23402.75 C23444.50  body 0.234  upwick 0.043  beyond=True   still accepted
09:40  O23443.75 H23470.00 L23407.00 C23418.00  body 0.409  upwick 0.417  beyond=False  back below, 0.42 rejection wick
09:45  O23416.75 H23531.50 L23416.75 C23531.25  body 0.998  upwick 0.002  beyond=True   his trigger, close at the high
```

**Sensitivity measured at his own trigger, not asserted:** `acceptance_bars` 1 → valid,
2 → valid, 3 → `BREAK_NOT_ACCEPTED_BEFORE_RETEST`. The run 09:30+09:35 is exactly two; 09:40
breaks it. **The accepted-break retest — one of the three forms ALGO-069 named legal for this
session — is REACHED and refuses solely on the unfrozen magnitude.**

Exception 2 is worth one line: its only rejection-wick candle is 09:40 (upper wick 0.417 ≥
`reject_wick` 0.35), which §7.11 excludes by construction because a prior test needs room for a
reset after it. `reject_wick` never decides that row.

**Two verdicts are published, not one.** Under the LITERAL ALGO-067 rule ("any taught definition
also refuses ⇒ MACHINE_CORRECT_PER_TEACHING") this is machine-correct, because B and C refuse on
taught grounds. Per FORM it is **PREDICATE_MISSPECIFIED**, because those are different forms from
the one his entry matches. That coarseness already produced the wrong answer on 03-30 and the
failure is recorded in `run_tpg_conformance_three_sessions.py`. Both readings are in the artifact
so you rule on the real disagreement rather than on my choice of rule.

**No repair landed.** `acceptance_bars` 3→2 recovers this session, which is exactly why I did not
move it: R3 (silent ⇒ stricter) was pre-registered and selected 3 from a measured sensitivity
with no outcome input. Re-selecting it because 2 recovers an agreement case is choosing an
unfrozen magnitude by agreement. The convicted REV path is unused and absent from executable code.

**A defect in my own module was found and fixed before publication.** The first selector filtered
on "has refusals" and took `sorted(bands)[0]` — collecting all 3786 session records and picking
the LOWEST band, a zone 478 points from his line. Every downstream number changed silently and
the sensitivity inverted to `NO_VALID_RETEST` at all three values. Nothing was red because
nothing asserted WHICH object was measured. Guards now pin the object first: **6 of 10 go red**
against the restored broken selector; module restored byte-exact (`e9e0320e71ef455f`), artifact
identical but for `runtime_seconds`.

---

## 2. Ruling item (2) — re-exam #2 PARTIAL

Same instrument, anchor, rules. **Both arms 1/8. VERDICT FAIL. Freeze BLOCKED.**

Membership against the frozen 5/8 anchor, both arms identical:
lost `{03-24, 03-30, 03-31, 04-06}`; held `{04-14}`; **gained none, newly lost none.**

Against your pre-registered expectation:

| clause | result |
|---|---|
| 03-30 joins by membership | **FAILED — it did not join** |
| 03-31 joins only via a taught form, else stays lost and is reported | held (stays lost; §1 is the report) |
| nothing leaves | held |
| 04-14 stays | held (AGREE, both arms) |
| no new pre-window grant | held |

---

## 3. Why 03-30 did not join — and the finding that matters more than the miss

**I reported after R1 that 03-30 was "recovered to GRANTED". That was true of the ENTRY-AUTHORITY
STORY at candidate ranking, and the exam counts FULLY-APPROVED IN-WINDOW entries.** Two gates sit
between those objects:

```
iter_actionable_candidates  ->  one_minute_entry  ->  build_and_classify
   (entry authority: R1/R1b)      (1m fill)            (target / reward policy)
```

`SURVIVED_TO_RANKING` is the first arrow only. I reported stage 1 as if it were stage 3 — the
neighbouring-object error again, and re-exam #2 is what convicted it.

So I traced every lost session through the pipeline the exam actually runs, **per arm**, with
04-14 as positive control:

| session | baseline 09:30 | taught 08:00 |
|---|---|---|
| 03-24 | `NO_ACTIONABLE_CANDIDATE` | `BULLET_SPENT_BEFORE_WINDOW` (08:17) |
| 03-30 | **TARGET GATE**, reward 112.50 | **TARGET GATE**, reward 112.50 |
| 03-31 | `NO_ACTIONABLE_CANDIDATE` | `BULLET_SPENT_BEFORE_WINDOW` (09:03) |
| 04-06 | `NO_ACTIONABLE_CANDIDATE` | `BULLET_SPENT_BEFORE_WINDOW` (09:07) |
| **04-14** *(control)* | `APPROVED_IN_WINDOW` ✓ | `APPROVED_IN_WINDOW` ✓ |

**NOT ONE loss in either arm is attributed to entry authority.** R1 and R1b act on stage 1, so no
amount of entry-authority repair can move this headline — which is precisely why 1/8 did not move
although both repairs are real, ratified and independently verified by you.

The arm context is load-bearing and **my first run of this trace omitted it**, showing five
APPROVED entries for 03-24 at 08:17–08:34 — candidates the 09:30 arm cannot see. That is the same
error class twice in one packet. A guard now pins the discriminator (03-24: 0 candidates at
09:30, 6 at 08:00); if the context is ever dropped, both collapse to one number and it goes red.

---

## 4. THE $400 TARGET FLOOR HAS NO CITATION I CAN FIND — asking for a ruling

`TP_GAP_REFERENCE_USD = 400.0` (`target_policy.py:38`) is the sole gate killing 03-30 in **both**
arms, at reward `112.50`. It also kills 03-24's sixth candidate at `382.50` and 03-31's second at
`397.50` — **two of the three refusals within 5% of the line.**

Its docstring asserts it as *"the trader's direct TP-display entry-gap rule"* — a claim of taught
provenance. **Surfaces searched:** the v2.3 spec JSON, the video-evidence docs, all repo `*.md` /
`*.json` / `*.txt`, **both** ruling branches (`gpt-rulings-algo`, `gpt-rulings`), and the
introducing commit `42c53c6c` (subject only, no body, no ruling id). **No citation.**

**POSITIVE CONTROL for that absence claim:** the same search DOES surface ALGO-004's
`17.25 points × 15 MNQ × $2/point = $517.50`. So `TP_GAP_REFERENCE_CONTRACTS = 15` and the
`$2`/point value ARE grounded, and the search would have found a `$400` citation had one existed
in those surfaces. It is also **not** declared in `UNFROZEN_CHOICES`, unlike `acceptance_bars`
which at least self-declares. For scale: the frozen stop at that same reference size is `$517.50`,
so `$400` is 0.77× risk — not a round R-multiple, which makes an implicit derivation unlikely too.

**Two candidate repairs are now on the table and NEITHER is mine to land**, because each would
recover lost sessions and both quantities are unfrozen:

1. `acceptance_bars` 3 → 2 (recovers 03-31's taught form)
2. the `$400` floor (recovers 03-30, and is within 5% on two more)

Selecting either by whether it recovers an agreement case is outcome selection wearing a
citation. **Reserved to you.**

---

## 5. Ruling item (3) — the five J5 bands, published BEFORE the 03-24 coverage re-run

| session | tf | rejection candle | band | width | wick used vs opposite |
|---|---|---|---|---|---|
| 03-24 | 15m | 09:30 | `24173.75 – 24317.00` | 143.25 | upper 61.5 vs 33.5 |
| 03-30 | 5m | 09:35 | `23424.50 – 23467.75` | 43.25 | upper 4.0 vs 14.0 |
| 03-31 | 5m | 09:35 | `23402.75 – 23444.50` | 41.75 | lower 41.75 vs 2.5 |
| 04-06 | 15m | 09:45 | **ERROR** — see below | — | — |
| 04-14 | 5m | 09:30 | `25655.75 – 25718.25` | 62.50 | lower 0.5 vs 8.75 |

**MY FIRST DERIVATION WAS WRONG AND LOOKED FINE.** Keying the rejection wick off the role at his
ENTRY gave five bands, **none** covering his line, three with the role-implied wick SMALLER than
the opposite one, and a zero-width band on 04-06. It was caught only because I published BOTH
wicks instead of the one the role implied.

The operator's own definition resolves it: *"a candle that does not break the level"* is a
statement about the **close**. So the rejection wick is the one that **penetrates** the level with
the close on the far side. **03-31 proves the distinction:** its role at his entry is RESISTANCE,
but at 09:35 price had already broken above, so the level was acting as SUPPORT — a 41.75-point
lower wick to 23402.75 closing back at 23444.50. *The role at marking and the role at entry are
different facts.*

**Two caveats, published rather than smoothed:**
1. `band_covers_his_line` is now **TRUE BY CONSTRUCTION** — a band from a penetrating wick through
   the level to a close on the far side always contains the level. It is a self-check on the
   derivation and is **NOT** evidence that any location gap is closed. 03-24's coverage question
   is answered by the coverage re-run, which has not been done.
2. Widths **41.75–143.25 pts** sit ABOVE the held teaching span of ~4–75, and 03-24's 143.25 is
   ~2× the widest measured teaching example (74.5). Flagged, not reconciled.

**04-06 ERRORS rather than returning a band.** Its marked 15m candle is
`O24329.25 H24418.00 L24326.50 C24418.00` — the high tops out **3.625 points BELOW his line
24421.625**, so the candle never touches the level and no rejection wick exists. The marking
metadata does not identify a rejection candle there, and your rule cannot be applied to 04-06
from held data.

---

## 6. What I did not do, and what I need

- **Did not** land either candidate repair (§4). Both are unfrozen magnitudes that recover cases.
- **Did not** re-run 03-24's coverage — the bands are published first, as ruled.
- **Did not** touch R2, which is next in your order after the bands.

**Asks:** (a) rule on `acceptance_bars` 3 vs 2; (b) rule on the `$400` floor — whether it stands
as an undeclared derivation, is re-declared in `UNFROZEN_CHOICES`, or is repaired; (c) confirm
whether the per-form or literal reading of ALGO-067 governs, given they disagree on 03-31; (d)
confirm 04-06's band is genuinely underivable from held data rather than a marking-metadata
defect I should chase.

Artifacts: `current_mnq_strategy_v2_4_tpg_0331_rerow_2026_08_23.json`,
`..._exam2_loss_attribution_2026_08_23.json`, `..._j5_bands_five_sessions_2026_08_23.json`,
`..._exam_dual_window_2026_08_23.json` and both arm artifacts — all committed at `1c83cbbf`.

---

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.
