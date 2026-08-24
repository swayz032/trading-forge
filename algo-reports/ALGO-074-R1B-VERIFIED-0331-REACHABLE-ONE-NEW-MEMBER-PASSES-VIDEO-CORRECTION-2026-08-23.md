# ALGO-074 — R1b verified by this desk: 03-31's level is now REACHABLE, 04-08's flipped-support break survives, the one new member passes every clause. A fact this desk relayed in ALGO-064 is corrected: the held video IS a 2025-04-11 replay. The 03-31 re-row and re-exam #2 are authorized.

**Advisor:** Claude (Fable 5), ALGO seat. **Rules on:** R1b at strategy head `2e165b62`.
**Channel head at drafting:** `6a490c8c` (ALGO-073, mine). **PR #38: DRAFT / DO NOT MERGE —
unchanged.** **DECISION: R1b RATIFIED (§1) + guard PASSED (§2) + CORRECTION (§3) + AUTHORIZE
(§4).**

## 1. R1b verified [MEASURED HERE]

- Diff `15dfadc7..2e165b62`, `kernel.py`: `_break_side(z, flipped_at, ts)` returns
  `origin_side(z)` ONLY when `flipped_at is not None and ts - flipped_at <=
  BREAK_FAMILY_BROKEN_VISIBILITY` — a flip WITNESSED in-session (`flipped_at[loc.id] = ts`
  recorded in the bucket loop) inside the R1 window; otherwise the current role. Only
  `brk_locs` receives `_as_break_location(...)`; `pre_locs` (Route A) still receives
  `_as_location(loc, before)` — the origin shape cannot reach Route A. No new constant
  [worker's AST test; consistent with the diff — the window is the R1 `Timedelta`].
- The eight scope tests run in my own arenas: **8 passed at `2e165b62`; 7 failed / 1 passed
  at `15dfadc7`** — RED→GREEN as claimed.
- Behavioural effect [ARTIFACT-SOURCED to the updated J16 artifact; consistent with the
  captures below]: 03-31 `NO_CANDIDATE_OF_THE_MATCHING_FAMILY → REFUSED (3 matching)` — the
  location is reachable, the story is not yet granted; 03-30 and 04-14 GRANTED unchanged;
  04-06 and 03-24 unchanged.

## 2. The membership guard, over all fourteen sessions [MEASURED HERE from the committed captures]

I re-derived the in-window grant set from `…in_window_grants_pre_r1b_a2307c46.json` and
`…in_window_grants_post_r1b.json` (both committed, plus `run_capture_in_window_grants.py`):
**13 → 14 grants; REMOVED by R1b: none — 04-08's flipped-support break survives exactly as
ALGO-072 §3 required; ADDED: exactly one.**

| member | clock / bucket | route · form · reason | zone | clauses |
|---|---|---|---|---|
| 04-01 | 09:52 / 09:50, LONG | D_PREBREAK_RETEST_BREAKOUT · break_retest · ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE | `R:2026-04-01T06:30` [24087.13, 24093.62] WICK_ZONE | (i) LONG at an origin-R zone = BREAK, break family — PASS · (ii) `break_retest()` `breakout_derivation.py:174-208` is ALGO-009 Route D — PASS · (iii) in-window — PASS · (iv) not Route A — PASS · (v) bullet spent 08:12, `executable_in_window=False` — PASS [RELAYED for (v); the capture carries no budget field] |

04-01 is a CENSORED case (trader WAIT) — outside the headline. **Guard PASSED.** §7 19/19,
wiring 9/9, lane 842 [RELAYED].

## 3. Correction on the record — this desk relayed a wrong fact in ALGO-064 §2.2

ALGO-064 §2.2 stated "no held video of the Apr-2025 replay sessions". The worker enumerated
custody item 5 and its crosshair reads **Fri 11 Apr '25** — MNQ 5m on FXReplay, custody hash
verified against the registry (`7dbc51c72d8b638a…`). The receipt's silence had been read as
absence; **unknown was the honest answer.** The other blocker in that section — no 2025 bar
data in custody — still stands and still kills the quantitative arm. Two drawn key level
zones measured off that tape: ~18,769.5–18,796.3 (~27 pts) and ~18,593–18,667.5 (~74.5 pts).
With the six screenshots (4/8/19/22/30/32), the held teaching spans ~4 to ~75 points — **no
single width exists, which is exactly what ALGO-073 rules: the width is not a constant, it
is [wick extreme, close] of the rejection candle.** The enumeration continues as
verification of that rule.

## 4. AUTHORIZED

1. **03-31 T/P/G re-row under R1+R1b** at his 09:45–09:49 buckets: which taught form the
   break family now sees among the 3 matching candidates and what refused each —
   accepted-break retest (Route D), exception (2) retest-breakout attack, or a
   sweep-reclaim; predicate at its line; the 5m bars 09:35–09:49. `TAUGHT_FORM_ABSENT_FROM_
   DERIVATION` is a legal answer and then it is the derivation repair; the convicted REV path
   may not be the route (ALGO-069 §3).
2. **Re-exam #2 PARTIAL** immediately after, same instrument, same anchor, same rules.
   Expectation, pre-registered (ALGO-069 §4.4, ALGO-072 §4): 03-30 joins by membership;
   03-31 joins only via a taught form, else stays lost and is reported as such; nothing
   leaves; 04-14 stays; the membership guard holds; no new pre-window grant.
3. Then the J5-band step per ALGO-073 §4.2 (publish the five bands before re-running 03-24),
   then R2, then re-exam #3, then the grade (dispatch authorization still with the operator),
   then FREEZE or another round.

LESSON: a receipt that says "unenumerated" is not a receipt that says "absent" — and the
same desk that minted that law for graders relayed the opposite for a video.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
