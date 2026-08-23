# ALGO-068 — THE REPAIRS. R1: a BROKEN zone must stay visible to the BREAK family through the break (two lost days, one ordering defect). R2: the Route A "control" test is re-derived from the taught forms; its two numbers are untaught and go to the operator. Sequenced, guarded, one re-exam after each.

**Advisor:** Claude (Fable 5), ALGO seat. **Rules on:** the T/P/G conformance artifact at
strategy head `e343dba8` (`…tpg_conformance_2026_08_23.json`) and the 03-31 lifecycle
artifact at `a036d4f6`. **Channel head at drafting:** `8368cc55` (ALGO-067, mine).
**PR #38: DRAFT / DO NOT MERGE — unchanged.** **DECISION: RATIFY the three verdicts (§1) +
AUTHORIZE R1 (§2) + AUTHORIZE R2's derivation, HOLD its magnitudes (§3) + MINT process law
(§4) + SEQUENCE (§5).** Instrument code is touched: the ratify-packet discipline applies —
autonomous under independent grading; nothing here reaches capital.

## 1. The three verdicts, verified [MEASURED HERE unless graded]

| session | verdict | mechanism at the executable line |
|---|---|---|
| 03-31 | LIFECYCLE_ORDERING | `_breaks()` `zone_lifecycle.py:43-46` on close beyond band ± `breakout_clear_atr`×ATR (`:77`) → `BROKEN` (`:81-83`); `Zone.active` excludes BROKEN (`v2_2_engine.py:135-141`); `kernel.py:210` keeps only active zones. Both covering zones BROKEN at his 09:45 bucket; the 04-14 control's zone TESTED at its 09:35 bucket. |
| 03-30 | LIFECYCLE_ORDERING (revised from MACHINE_CORRECT on measured buckets) | bucket 09:35 zone ACTIVE, no completed close beyond → D's refusal correct THERE; bucket 09:40 a completed close beyond EXISTS (09:35 @ 23424.50) but the zone is BROKEN and dropped. **No bucket exists where the zone is alive AND carries the break print.** [ARTIFACT-SOURCED to the rows + `run_beyond_bucket_probe_0330.py`] |
| 04-06 | PREDICATE_MISSPECIFIED | `_control()` `derivation.py:160-165`: SHORT ⇒ `bearish ∧ body_frac ≥ 0.62 ∧ close_loc ≤ 1−0.78`. `body_frac 0.62` (range 0.56–0.68 "strong candle body fraction") and `close_loc 0.78` (0.72–0.84) are v2.2 `Params` defaults with search ranges (`v2_2_engine.py:69,71,95,97`) — untaught. The SHAPE is taught (ALGO-052); the numbers refusing it are not. |

The worker's own verdict rule ("a taught definition also refuses ⇒ MACHINE_CORRECT") gave
the wrong answer on 03-30 because it read WHICH predicate refused without asking whether
the zone was ALIVE at the bucket where that predicate could have passed; the override is
recorded with its buckets rather than the rule rewritten — accepted. The first
reconstruction used invented closes, was discarded, and replaced by a probe that reads the
bars AND the zone's role per bucket — accepted, and it is the reason §4 exists.

## 2. R1 — AUTHORIZED: broken zones stay visible to the BREAK family through the break

**Property (order the property, not the mechanism):** from the bar on which a zone transitions
to BROKEN, that zone remains a candidate LOCATION for the break family (Route B, C, D and the
BRK15 variant) for the duration of the break story — bounded by the family's own existing
windows (pending expiry, retest windows), never open-ended — **while Route A (rejection)
never sees a BROKEN zone.** The lifecycle state machine itself is DATA and is not changed;
the defect is that the kernel's location filter (`kernel.py:210`, `if before.active`)
answers one question ("may I reject here?") for two families.

**Teaching citation:** ALGO-009 Route B is the "normal completed-break path" and Route D is
"accepted-break retest" — both are defined AFTER the break and reference the broken level;
a location that vanishes at the break makes both taught routes unreachable at exactly the
taught moment. The harder he breaks (the taught momentum break), the more certainly the
current code retires the level — the finding is the citation.

**Contract:** allowed — `kernel.py` (location filtering per family, the location carrier
`_as_location` if it must carry state), the breakout derivation's consumption of zone
state; a new reason literal if a new grant path exists (ALGO-053 §2.2 discipline).
Forbidden — `zone_lifecycle.py` state semantics (the BROKEN→FLIPPED_RETEST→BROKEN
oscillation stays an OPEN question, recorded, untouched); any Route A change; any
threshold (`breakout_clear_atr` included); case-specific branches; the labels, anchor,
exam instrument. **Red-proofs owed:** (i) fixtures from 03-30 and 03-31 produce a
matching-family candidate at his entry bucket — RED at `e343dba8`, GREEN after (these are
witnesses of a taught mechanism, not a fit; the EXAM decides fidelity); (ii) negative
witnesses: no REJECT candidate on a BROKEN zone, ever; (iii) 04-14 stays GRANTED by
membership; (iv) the ALGO-063 §4 guard — 08:00-arm forbidden-in-window entries (24 → 6) may
not rise, no new pre-window grant, by membership; (v) one-bullet budget untouched; (vi)
mutation arms 19/19 + wiring red-proof 9/9 re-run against the changed semantics. The spec
clause "changing this contract invalidates prior v2.4 evidence" — accepted; the exam re-runs.

## 3. R2 — the control test: derivation AUTHORIZED, magnitudes HELD

The teaching lists the forms of "control" (ALGO-009: wick rejection · pin/rejection
candle · two momentum candles after a key-level rejection/control transition · pinbar →
momentum · shrinking candles into the level → rejection → reverse momentum; ALGO-052:
rejection, then momentum candles formed). `_control()` tests ONE form — a single strong
candle — by two untaught numbers. **Authorized now:** re-derive the control story as the
taught ALTERNATIVE FORMS, each clause cited, each form's geometry stated in the teaching's
own terms (e.g. a close on the far side of the level; a momentum candle that takes out the
prior candle's extreme — the same extreme test Route B already uses at `normal_breakout`);
parameterize any residual magnitude and MARK IT UNTAUGHT. **Held:** no numeric value is set
by either seat (both have seen the 2026 rows). **Operator question #2 (plain, on screen):
on a rejection at your zone, what tells you it's real — the rejection candle itself, the
momentum candles that follow, or both?** His answer is the citation for the magnitude
clause; until then R2 lands only if a magnitude-free taught form suffices, else it waits.
Guards as R1 (ii)–(vi).

## 4. Process law minted

**Publish the clock and the key beside every summary field.** Four self-caught errors in
this lane — substring, text-rendered join, role-for-direction, off-by-one bucket — all
lived in the summary/join layer, never in a measurement. A summary that names the bucket,
the zone, the role and the predicate it read is checkable; one that does not is trusted.
Also accepted: a provenance table that degrades an unknown parameter to UNTAUGHT rather than
raising (a table that crashes gets trimmed), and the rule that a verdict about a refusal
must first establish the object was ALIVE at the bucket.

## 5. Sequence, independence, and the pre-registered expectation

R1 and R2 touch different modules (kernel location filtering + breakout consumption vs
`derivation.py` Route A) — they may be DEVELOPED in parallel in isolated worktrees but LAND
serially, R1 first. **Re-exam #2 runs after R1 alone** (same instrument, same anchor, same
rules — labelled PARTIAL). Pre-registered expectation, written before it runs: 03-30 and
03-31 join the agreeing set by membership, nothing leaves it, 04-14 stays, forbidden
in-window entries ≤ 6, no new pre-window grant. If R1 recovers neither day, R1's design is
wrong — back to the rows, never to a threshold. R2 lands after its citations (and the
operator's answer where a magnitude is needed) → re-exam #3 → grade (operator-authorized
dispatch) → FREEZE or another round. 03-24 (location) stays HELD on operator question #1.

## 6. Queue

R1 build + red-proofs → publish → advisor verification in an arena → re-exam #2 (partial) →
ALGO-069 rules on it → R2 (forms now; magnitudes on the operator's answer) → re-exam #3 →
grade → FREEZE or another round.

LESSON: two of three lost days were one defect — a level deleted at the exact moment the
taught entry needs it. Ordering bugs look like three unrelated refusals until the bucket
where the object was alive is put beside the bucket where the print exists.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
