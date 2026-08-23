# ALGO-069 — R1 verified by this desk; 03-30 recovered by the taught break family; 03-31's residual is a SIDE-IDENTITY question on the lifecycle flip — and the anchor shows 03-31's original "agreement" came from the path ALGO-009 convicted. It may be recovered only by a taught form.

**Advisor:** Claude (Fable 5), ALGO seat. **Rules on:** R1 at strategy head `a2307c46`
(worker's report; the §4 guard measurement still pending). **Channel head at drafting:**
`e2429f90` (ALGO-068, mine). **PR #38: DRAFT / DO NOT MERGE — unchanged.**
**DECISION: R1 VERIFIED, ratification CONDITIONAL on the §4 guard (§1) + RULE the side
identity (§2) + RULE the 03-31 recovery constraint (§3) + ORDER (§4) + SEQUENCE (§5).**

## 1. R1 verified [MEASURED HERE]

- Diff `e343dba8..a2307c46`: `pre_locs` (Route A) unchanged in membership — ACTIVE zones
  only; `brk_locs` = the same active zones PLUS zones in `BROKEN` whose `last_active_bucket`
  is within `BREAK_FAMILY_BROKEN_VISIBILITY = pd.Timedelta(minutes=5 * LOOKBACK)`; the
  break-family loops (B/C/D and BRK15 arming) now read `brk_locs` filtered by
  `x.side == side`. `zone_lifecycle.py` untouched; no threshold moved.
- The nine R1 property tests, run in two `git archive` arenas of my own: **9 passed at
  `a2307c46`; 7 failed / 2 passed at `e343dba8`** — RED→GREEN as claimed, with the two
  invariants passing at both pins as they must.
- Measured effect [RELAYED, consistent with the diff]: 03-30 REFUSED → GRANTED (3 matching);
  03-31 unchanged; 04-14 control GRANTED unchanged. The pre-registered rule was "recover
  NEITHER = design wrong"; one recovered ⇒ the design stands and the residual is a distinct
  semantic, §2. §7 19/19, wiring 9/9, lane 834 [RELAYED].
- **Ratification is CONDITIONAL** on the ALGO-063 §4 guard landing: 08:00-arm
  forbidden-in-window entries ≤ 6 and no new pre-window grant, by membership. Until it
  lands R1 is verified, not ratified; re-exam #2 does not run.
- Two process notes accepted: a failed patch script can leave in-memory edits unlanded
  (verify state after failure, not before it), and the fifth substring-over-prose instance
  (a guard convicting the comment that explains it) — now AST over string constants.

## 2. The 03-31 residual is a SIDE-IDENTITY question, not a visibility one [MEASURED HERE]

`_as_location` (`kernel.py:96-97`) sets `side = z.side` — the zone's CURRENT role after
`zone_state_at_v24`, and v2.4's lifecycle CHANGES the side on a flip (`zone_lifecycle.py:4`
records that the inherited engine did not; `:92`/`:97` set `role = "S"` / `"R"`). On 03-31
both covering zones: origin R → BROKEN (09:35, break up) → FLIPPED_RETEST as S (09:40, price
retests from above) → BROKEN-as-S (09:45, break back down) → he LONGS at 09:49 with price
inside the band. His long break needs `side == "R"`; by 09:45 the zone's current side is S,
so `x.side == side` cannot match. R1 made the zone visible; it correctly did not touch the
flip.

**Ruling — the identity of a break story is the zone's ORIGIN side + the break direction,
and it persists through FLIPPED_RETEST and a re-break within the R1 visibility window.**
The teaching supports exactly this sequence: ALGO-009 exception (2) — *"a real reject/test →
reset → retest/return → breakout attack at the key level"* — and its explicit interaction
vocabulary `SWEEP_RECLAIM_UP` / `BREAK_CLOSE_UP` (ALGO-009 line 77; "sweep/reclaim",
"failed push/reclaim" at 121/127). A broken resistance retested from above is the taught
retest of THAT resistance; a dip back through and reclaim is the taught sweep-reclaim of
THAT resistance. The lifecycle's relabelling to S is its own bookkeeping (a rejection
family may indeed treat it as support) — it must not rename the level out from under a
break story already opened on it. **Route A keeps the CURRENT role** (a rejection at a
flipped zone is a rejection at support); **the break family keys on ORIGIN side** (`Zone`
carries it — `zone_state_at_v24` starts from `role = origin`, `:58`). The lifecycle state
machine remains data; the BROKEN→FLIPPED→BROKEN oscillation stays as it is — the repair is
in what the break family MATCHES on, not in how states are assigned.

## 3. The anchor shows how 03-31 was "agreed" before — and it forbids one recovery route [MEASURED HERE at the F2 anchor `ea6f0940` blob]

| session | old kernel bot state | entry_family_receipt | story_receipt | location |
|---|---|---|---|---|
| 03-30 | ENTER_SHORT @09:47 | REV | ZONE_REJECTION_STORY_THEN_INTRA5_FORCE | `R:2026-03-30T09:15` |
| 03-31 | ENTER_LONG @09:47 | REV | ZONE_REJECTION_STORY_THEN_INTRA5_FORCE | `R:2026-03-31T07:45` |

The old kernel agreed on 03-31 by a **LONG "rejection" at a RESISTANCE** — the reach-and-
close-on-the-acceptable-side path ALGO-009 convicted as H1 (line 86: `_valid_rejection_side`
qualifying on a reach + acceptable-side close "is not by itself proof of the trader's
visible reject/push-away/control-transfer semantics"). ALGO-009 line 297 itself calls Mar 31
"the old Mar31 reclaim item". **So the frozen 5/8's 03-31 membership was produced by the
defect the semantics phase exists to remove.** Ruling: F2 membership is about the DAY, F3 is
about the STORY (ALGO-057). **03-31 may be recovered ONLY through a taught form — exception
(2) / sweep-reclaim / accepted-break-retest at the origin-R level — never by re-admitting
the convicted rejection path.** If no taught form reproduces his 09:49 entry, the exam fails
honestly on 03-31 and the ledger records why; that is a better outcome than a flattering
agreement by a wrong mechanism. (03-30's old REV agreement at a fresh 09:15 resistance is the
same shape; its R1 recovery via the BREAK family on his labelled SUPPORT is a taught story
matching J3 — the exam decides, F3 stands.)

## 4. ORDERS

1. **Guard first:** land and publish the §4 guard measurement for R1 (membership, both
   clauses). R1 ratifies on it.
2. **R1b — origin-side identity for the break family** (a build on R1, same contract):
   the break family and BRK15 arming match on the zone's ORIGIN side; Route A unchanged on
   current role; `zone_lifecycle.py` untouched; no threshold. Red-proofs: a synthetic origin-R
   zone that flips to S and re-breaks must remain matchable to a LONG break story inside the
   visibility window and NOT outside it; a REJECT story on it must key on current role;
   04-14 and 03-30 stay GRANTED by membership; guard clauses by membership; mutation arms.
3. **03-31 T/P/G re-row under R1+R1b:** at his 09:45–09:49 buckets, which taught form the
   break family sees — accepted-break retest (Route D), exception (2) retest-breakout attack,
   or a sweep-reclaim — with (P) the predicate at its line and (G) the 5m bars 09:35–09:49.
   Verdicts from the ALGO-067 taxonomy; `TAUGHT_FORM_ABSENT_FROM_DERIVATION` is a legal and
   likely answer if the derivation has no sweep-reclaim form — then that is the derivation
   repair, cited, not a loosening.
4. Re-exam #2 (PARTIAL) runs after R1 + R1b land with their guards — pre-registered
   expectation updated: 03-30 joins by membership; 03-31 joins ONLY via a taught form (F3),
   else stays lost and is reported as such; nothing leaves; 04-14 stays; forbidden in-window
   ≤ 6; no new pre-window grant.

## 5. Standing

R2 (04-06 control test): forms derivation proceeds in an isolated worktree; magnitudes wait
on operator question #2. 03-24 (location) waits on operator question #1. Grade dispatch
authorization waits on the operator; it is needed only after a passing re-exam.

LESSON: a baseline agreement can be a defect wearing the right direction — check the story
receipt behind every day you are trying to "recover" before you decide how it may be won.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
