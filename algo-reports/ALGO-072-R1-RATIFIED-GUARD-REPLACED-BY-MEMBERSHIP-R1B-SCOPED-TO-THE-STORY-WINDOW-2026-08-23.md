# ALGO-072 — Both new members pass all five clauses: R1 is RATIFIED and the count guard is REPLACED by its membership form for every later repair. R1b is SCOPED so it cannot delete a legitimate flipped-support break. Re-exam #2 runs after R1b.

**Advisor:** Claude (Fable 5), ALGO seat. **Rules on:** the guard-membership artifact at
strategy head `15dfadc7` (`…r1_guard_membership_2026_08_23.json` + the committed pre-R1
evidence `…pre_r1_in_window_grants_e343dba8.json`). **Channel head at drafting:** `b5a45f16`
(ALGO-071, mine). **PR #38: DRAFT / DO NOT MERGE — unchanged.**
**DECISION: R1 RATIFIED (§1) + guard REPLACED (§2) + R1b SCOPED and ORDERED (§3) + SEQUENCE (§4).**

## 1. The disposition, applied as pre-registered [MEASURED HERE at `15dfadc7`]

Found by DIFF against a committed pre-R1 run (not assumed): at `e343dba8` both sessions
have **0** in-window grants; after R1, 04-07 has 2 grant attempts and 04-08 has 1 — the
counter rose by 1 per session (6 → 8). Two quantities, both reported: three attempts, two
counter increments; the counter is what the old guard read, the attempts are what the
clauses test.

| member | clock / bucket | route · form · reason | zone | (i) | (ii) | (iii) | (iv) | (v) |
|---|---|---|---|---|---|---|---|---|
| 04-07 | 09:48, 09:49 / 09:45 | B_NORMAL_BREAKOUT · normal_breakout · FIRST_BREAK_PRINT_THEN_INTRA5_FORCE | `SWING:S:2026-04-06T03:45` [24205.45, 24209.55] STRONG_SWING_DISPLACEMENT | PASS (SHORT at a SUPPORT-role zone = BREAK) | PASS — `normal_breakout()` `breakout_derivation.py:137-171` is ALGO-009 Route B (§7.6 first print is setup only; §7.7 trigger must extend the first print's extreme) | PASS | PASS | PASS — bullet spent 09:23, `executable_in_window=False` |
| 04-08 | 10:57 / 10:55 | same | `R:2026-03-17T20:00` [25020.96, 25039.99] WICK_ZONE, current role S | PASS | PASS | PASS | PASS | PASS — bullet spent 08:52 |

Both member sessions are CENSORED (trader WAIT) — outside the headline numerator and
denominator. **Both pass ⇒ per ALGO-070 §3: R1 STANDS as landed at `a2307c46`.**

## 2. The guard, replaced — for R1 and for every later repair identically

The ALGO-063 §4 count clause is RETIRED. In its place, pre-registered in ALGO-070 §3 and
now in force: **every new in-window grant attempt introduced by a repair is LISTED with
clock and key and must pass (i) matching family for the J3 interaction · (ii) taught story
with predicate cited · (iii) not pre-window · (iv) not Route A on a BROKEN zone · (v)
blocked by the one-bullet budget alone; the no-new-pre-window-grant clause stays as it
was.** A member failing any clause, or UNCLASSIFIED, fails the repair. This is stricter in
kind than the count (it inspects each member) and it is what the count was trying to say.

## 3. R1b — SCOPED, then ORDERED

The worker's coupling note is correct and it exposes an ambiguity in ALGO-069 §4.2:
unscoped origin-side matching would key 04-08's zone (origin R, flipped to support long
before 04-08) as R and delete a legitimate short break of flipped support. ALGO-069's own
text limited the rule to "through FLIPPED_RETEST and a re-break within the R1 visibility
window"; the contract line did not. **Ruling — R1b's origin-side identity applies ONLY to a
break story opened in-session on a zone whose flip / re-break occurs inside the R1
visibility window (`5 × LOOKBACK` from the break bar). A zone whose flip is older than
that window carries its CURRENT role as its identity for every family.** Citation: ALGO-009
exception (2) is a within-session sequence at one level; a level that flipped days ago is,
by the same teaching, simply support now. `origin_side()` at `zone_lifecycle.py:31-40`
supplies the immutable creation polarity; the window decides when it governs.

Red-proof witnesses, both directions: **04-08's member must remain matchable** (old flip →
current role S → short break matches); **03-31's origin-R zone must become matchable to
his LONG break story** inside the window (break 09:35 → flip 09:40 → re-break 09:45 → his
09:49 entry) and NOT outside it; a REJECT story keys on current role in both cases; 04-14
and 03-30 stay GRANTED by membership; the §2 membership guard on any new member; mutation
arms + wiring red-proof re-run. Then the 03-31 T/P/G re-row under R1+R1b (ALGO-069 §4.3:
`TAUGHT_FORM_ABSENT_FROM_DERIVATION` is a legal answer; the convicted REV path may not be
the route).

## 4. Sequence and standing

R1b (this contract) → re-exam #2 PARTIAL, expectation as ALGO-069 §4.4 (03-30 joins by
membership; 03-31 joins only via a taught form; nothing leaves; 04-14 stays; §2 guard
holds) → ALGO-073 rules on it → the band-width rule (ALGO-071 §5.1–2: enumerate the video,
derive with citations, **publish the width BEFORE re-running 03-24** — the worker's own
guard, ratified) → J5 band re-run → R2 (binary rejection, magnitudes retired) → re-exam #3
→ grade (dispatch authorization still with the operator) → FREEZE or another round.

LESSON: a guard that fails on a repair it was not written for is resolved by naming the
members and testing each against the teaching — the count said "something moved", the
members said "three taught break attempts on two days the trader sat out, blocked by the
bullet".

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
