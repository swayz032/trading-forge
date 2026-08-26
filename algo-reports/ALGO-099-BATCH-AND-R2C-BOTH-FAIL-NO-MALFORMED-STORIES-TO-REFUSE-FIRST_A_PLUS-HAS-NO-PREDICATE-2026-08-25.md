# ALGO-099 — THE §5 BATCH DOES NOT LAND, AND NEITHER DOES R2c. The diagnosis was right at two named keys; the narrowing is not in the entry layer. **Every one of the 103 extra approvals is a well-formed taught rejection on a live zone** — there are no bad stories to refuse. F1 caused 54 of them and is separately proved to be an entailed clause that could never refuse anything (143 → 143 on removal). Control unmoved by key and target in all four arms.

**Strategy head:** `62722a2a9e6d6ed7ac7f535e95b36d92a8d6121a` (pushed, `ls-remote` verified, local == remote).
**PR #38:** DRAFT / DO NOT MERGE. **Semantic files modified: YES** — `derivation.py`, `force.py`,
`independent_force.py`. **Nothing landed as a repair**: the batch fails its own pre-registration
and is reported, not adopted. Gate state unchanged; semantics remain CLOSED (ALGO-020 §1).
**Seal tree** `mnq-v24-seal` @ `870b4f75`, not read or written by this seat; its two untracked
paths carry mtime 2026-08-19 and predate this seat.
**Authority:** ALGO-096 §5 as amended by ALGO-096A (F1 declaration) and ALGO-096B (test-rewrite
scope + pin protocol).
**Advisor seat:** `trading-forge-cf` [ee3f2d], **live throughout — it never rolled.** I recorded a
seat roll mid-round and that was wrong: a `SendMessage` failed to resolve, I read a transient
resolution failure as a dead seat, and my own worker seat rolled at the same moment which made the
misreading look consistent. Corrected here on the record. The lesson is the one this ledger keeps
minting: **a failed lookup is not an observation about the thing looked up.** No decision in this
packet rested on it — the ladder is the durable record either way.
**Numbering:** this packet is **ALGO-099**. It was drafted as 098; the advisor elected to publish
its ruling as **ALGO-098** immediately rather than wait a full round for the attribution and the
09:30 pin, and instructed me to hold and publish after its SHA. Nothing here is wasted — the
attribution (§5a), the 09:30 pin and the per-clause table are carried as ordered.

---

## 0a. NODE ACCOUNTING — this packet is ALGO-098's N4 integrator

ALGO-098 dispatched a graph. **Expected {N0, N1, N2, N3}; each is accounted for below as
RECEIVED / MISSING / FAILED / TIMED-OUT, with its MEASURED duration.** No node is summarised
from its own claim: each row names the artifact a reader can open.

**ONE STRUCTURAL DEVIATION, declared before the results.** ALGO-098 ordered N1 and N3 to
subagents and N5 to an accuracy-validator dispatched by me. **My seat's operator instructions
forbid calling the Agent tool** (*"Do not call the AgentTool unless the user requested it"*), and
the user has not. A peer ruling cannot lift an operator constraint on my seat, and routing the
work through someone else to get the same effect is the laundering the harness exists to stop. So
**N1 and N3 ran serially in-seat**, in the same isolated read-only worktrees, under the same caps.
The advisor accepted this and moved N5 to its own seat, where doer≠grader is in fact *better*
satisfied — the advisor never wrote this code. **No speed-up is claimed anywhere in this packet:
wall-clock was sequential.**

| node | scope | status | artifact |
|---|---|---|---|
| **N0** | capture fields + F1 clause removal | **RECEIVED** | `research/run_approved_entry_membership_capture.py` |
| **N1** | R2c momentum-after DERIVATION | **RECEIVED** | derivation + citations in `derivation.py`, tests in `test_algo_r2c_momentum_after.py` |
| **N2** | R2c guard | **RECEIVED — R2c FAILS its pre-registration**; one sub-table (form breakdown of the 26) **OPEN**, named in §6c | `_algo096_guard_2026_08_24/` |
| **N3** | Route D early-bullet census | **RECEIVED from the advisor seat** (re-assigned mid-round for pace); my in-seat cross-check is §6b | `early_bullet_census.json` |
| **N5** | independent adversarial grade | **NOT MINE** — dispatched from the advisor seat after H1; lands as ALGO-099A | — |

## 0. VERDICT

The batch **does not land**. §5's decision rule is conjunctive — *"a miss on any line and the
batch does not land"* — and line 4 misses by 37.

| § | pre-registered line | measured | verdict |
|---|---|---|---|
| 5.1 | 04-14 control survives BY KEY, clock reported | `1 -> 1`, identical by key AND target; clock unmoved | **PASS** |
| 5.2 | sessions silenced: ZERO | 0 silenced | **PASS** |
| 5.3 | ≥1 of 03-24 / 04-06 / 04-09 gains a Route A candidate surviving at his bucket | 03-24 gains an approval at **his exact minute** `09:32 L REV`, target `24358.0 KEY_ZONE_15M` | **PASS** (expected NO) |
| 5.4 | no new Route A approval BEFORE his clock on a convicted day | **37**, on all five convicted days; 9 of 14 sessions' first approval moves EARLIER | **FAIL** |
| 5.5 | 03-23 / 03-31: report, never claim recovery | 03-23 +19, 03-31 +6 — reported, not claimed | reported |
| 5.6 | no PnL/outcome/winner-loser/clean-edge read | none read; the capture carries no such field | held |

## 1. The guard, and why the instrument is trustworthy

The approved-entry membership capture, **byte-identical file (same md5) in both trees at run
time** — the baseline in a separate worktree at `56d9360d` (ALGO-096B ratified this shape), the
landing code at `46b21920`. Same instrument, different code; that is the whole design. The md5
was verified *before* the runs. `entry_location_id` was added to the instrument **afterwards**
(§9 ask 4) and is therefore **not** present in this round's artifacts — stated so nobody reads a
later file against an earlier artifact and finds a field missing.

**Positive control:** the baseline reproduces the known **40** approvals across 14 sessions
(ALGO-094's figure). An instrument that could not reproduce the number everyone already holds
would prove nothing about the number nobody holds.

**Contamination control, because I compromised my own risk window and will not argue my way out
of it.** The mutation battery (§4) rewrote `derivation.py` and `force.py` on disk *while the
"after" capture was still running*. The argument that this is harmless is sound — Python binds
modules at import, the capture's import graph contains no `importlib`, `reload`, `subprocess` or
`exec`, and the process had imported everything at start — but an argument is not evidence.

The evidence is **cross-instrument agreement, which is stronger than re-running the same
instrument**. The candidate table (§2a) is a different code path — `xray_session` — and it ran
**after** the battery finished, on a byte-exact-restored tree (`sha256` verified). On the facts
the two share it agrees with the capture exactly: 03-24 gains a Route A survivor **at 09:32**;
04-09 gains one; the control keeps **one** survivor at **09:38**. The capture independently
reports the control as the same key, same setup `BRK5`, same target `25869.0`, unmoved.

Two instruments, two code paths, one of them run entirely on a clean tree, same conclusions. A
same-instrument re-run was also launched but was lost to a session teardown; it is not needed for
the claim and I am not going to pretend it ran.

**Every headline number in §2 was re-derived from the ROW DATA**, not read off the diff script's
summary: totals `40 -> 143`, added 103, removed 0, kept 40, target moves 0, and the 37 early
Route-A approvals with their per-session breakdown.

## 2. MEASURED — 08:00 pin, membership by key

**Totals: 40 → 143. Additions 103, removals 0, target moves 0.**

Purely additive and one-directional, which is itself the diagnosis (§3).

| session | before → after | first approval | new Route-A before his clock |
|---|---|---|---|
| 2026-03-23 **[C]** his 11:21 | 7 → 26 | 08:14 → 08:14 | **19** |
| 2026-03-24 **[C]** his 09:32 | 5 → 10 | 08:17 → **08:12** | **3** + one **at his exact minute** |
| 2026-03-25 | 3 → 18 | 09:23 → **08:07** | — |
| 2026-03-26 | 4 → 12 | 09:33 → 09:33 | — |
| 2026-03-30 | 0 → 9 | none → 08:07 | — |
| 2026-03-31 **[C]** his 09:49 | 1 → 7 | 09:03 → **08:13** | **6** |
| 2026-04-01 | 5 → 16 | 08:12 → 08:12 | — |
| 2026-04-02 | 1 → 10 | 10:38 → **08:22** | — |
| 2026-04-06 **[C]** his 10:04 | 1 → 4 | 09:07 → **08:29** | **3** |
| 2026-04-07 | 3 → 4 | 09:23 → **08:17** | — |
| 2026-04-08 | 3 → 10 | 08:52 → **08:27** | — |
| 2026-04-09 **[C]** his 11:35 | 5 → 11 | 09:37 → **08:43** | **6** |
| 2026-04-13 | 1 → 5 | 09:37 → **08:08** | — |
| **2026-04-14 [CONTROL]** his 09:36 | **1 → 1** | unmoved | **0** — IDENTICAL BY KEY AND TARGET |

**The line that ends the round.** §5.4: *"a new Route A approval BEFORE his clock on a convicted
day fails the batch (we loosened A; A may not become the new early trade)."* A became the new
early trade on all five.

**§5.4's LISTING obligation — partly discharged, and the gap named rather than papered over.**
§5.4 also requires *"every new in-window approval anywhere passes ALGO-070 (i)–(v) by name and is
listed"*. ALGO-070 §3's clauses, read verbatim rather than inferred from the later R1 script, are:
(i) a grant by the MATCHING family for the J3-classified interaction at that zone · (ii) on a
taught story of that family with its predicate cited · (iii) not a pre-window grant · (iv) not
Route A on a BROKEN zone · (v) the reason it did not become a trade.

- **(iii) HELD for all 103** by construction: the capture only walks `iter_actionable_candidates`
  inside the replay window, so a pre-window grant cannot enter it.
- **(v) unchanged**: the one-bullet budget is downstream of approval and this repair does not
  touch it; 143 approvals is not 143 trades.
- **(i), (ii) and (iv) UNGRADED — not "passing". The instrument cannot answer them.** The approved-entry
  capture keys on `(session, entry_time, direction, setup)` and carries the chosen target; it
  records **no `location_id` and no `zone_state_at_bucket`**, and (i)/(ii)/(iv) are all
  statements about the zone and its J3 classification. I will not grade five clauses off four
  fields, and **UNGRADED must never be read as PASSING**. This is an instrument gap in the guard
  ALGO-085 made canonical — a guard that cannot see the layer its own ruling asks about.
  **Half closed in this packet:** the capture now records `entry_location_id`,
  `entry_location_band`, `entry_location_source` and `candidate_reason`. `zone_state_at_bucket`
  is **not** on this path — it is replayed per bucket inside the X-ray, not carried on the
  candidate — so it is written as `NOT_CARRIED_ON_THIS_PATH_SEE_XRAY` rather than left blank or
  guessed, and clause (iv) still needs an X-ray join. The fields land now; populating them needs
  a re-run, which belongs to R2c's guard, not to a batch that does not land.

Nothing above softens the verdict: §5.4's failing condition is (c), the early Route A approvals,
which the capture measures directly and which fails on its own.

**The line that should not be lost in the failure.** §5.3 expected NO on every one of the three,
with the spending trade named. It got a YES: on 03-24, at `09:32` — his minute — Route A now
produces an approval where ALGO-096 §2.3 measured the old agreement being lost to
`two_sided_wick_conflict`'s uncited `0.30/0.40`. **The mechanism ALGO-096 identified was real and
the repair reaches it.** What fails is the blast radius around it, not the diagnosis.

## 2a. The candidate table at his six clocks — deepest gate BY KEY (§6.2), 08:00 pin

Second guard artifact, same instrument both sides. Per ALGO-096 §6.2 the deepest gate is carried
with the candidate's own key, never the majority literal. **Unranked kill tokens: NONE**, either
side — every `killed_at` the X-ray emitted is in the declared ranking.

| session | cands B→A | survivors B→A | deepest gate BY KEY, AFTER |
|---|---|---|---|
| 03-23 11:21 S | 8 → 8 | 0 → 0 | `d0 FORCE_NOT_CONFIRMED` — unchanged, force-first, never reaches a story |
| **03-24 09:32 L** | 72 → 72 | **0 → 1** | **`d5 SURVIVED_TO_RANKING`** · `A_NORMAL_REJECTION` @ `S:2026-03-24T00:15:00-04:00:96923` @ **09:32** |
| 03-31 09:49 L | 269 → 269 | 0 → 0 | `d2 MERE_APPROACH_WITHOUT_TOUCH` — unchanged; the honest location miss |
| 04-06 10:04 S | 85 → **239** | 0 → 0 | `d2` @ `S:2026-03-25T06:30:00-04:00:97649`, refusal moves `TOUCH_WITHOUT_DIRECTIONAL_CONTROL` → `MIXED_OVERLAP_AND_TWO_SIDED_WICKS` |
| **04-09 11:35 L** | 12 → **89** | **0 → 1** | **`d5 SURVIVED_TO_RANKING`** · `A_NORMAL_REJECTION` @ `SWING:S:2026-03-17T22:30:00-04:00:100322` @ **11:37** |
| **04-14 CONTROL** | 95 → 95 | **1 → 1** | `d5` · `B_NORMAL_BREAKOUT` @ `SWING:R:2026-04-14T09:15:00-04:00:102865` @ **09:38** |

**ALGO-096 §5.3 named three expected keys in advance. Two hit exactly.** §5.3 wrote: *"expected:
04-06 at `S:2026-03-25T06:30…97649`; 03-24 at `S:2026-03-24T00:15…96923` if R2b lands; 04-09 at
`SWING:S:2026-03-17T22:30…100322` if F1 and R2 both grant."* Measured: **03-24 survives at exactly
`…96923`** — the F2 anchor's own 09:32 AGREE zone (ALGO-096 §2.3) — and **04-09 survives at exactly
`SWING:S:2026-03-17T22:30…100322`**, the zone §2.2's ceiling probe named. Not a nearby zone, not a
different route: the predicted key, the predicted route, at his minute (03-24) and two minutes past
it (04-09). A pre-registration that names location ids in advance and then hits two of three is the
strongest evidence in this round that **ALGO-096's diagnosis of the mechanism was correct.**

04-06 is the miss: R2 was expected to grant there and does not. Its refusal MOVED
(`TOUCH_WITHOUT_DIRECTIONAL_CONTROL` → `MIXED_OVERLAP_AND_TWO_SIDED_WICKS`) at the same zone, i.e.
`_control` now passes and R2b's indecision test refuses instead. Reported, not chased.

**The control is unmoved in every field that could move**: same route, same location key, same
decision clock `09:38`. §5.1 asked for the clock to be reported because it might slide toward
`09:36` under a force loosening — **it did not slide.**

## 2b. MEASURED — 09:30 pin. The same verdict, independently

§5 required the guard at BOTH pins. The 09:30 arm is a different population — the baseline is
**23** approvals, not 40 — so it is a genuine second test, not a restatement.

| line | 09:30 measured | verdict |
|---|---|---|
| 5.1 control | `1 -> 1`, **identical by key AND target** (`09:38 L BRK5`, target `25869.0 FVG_15M`) | **PASS** |
| 5.2 silenced | 0 | **PASS** |
| 5.4 early Route A on convicted days | **12** — 03-23: 8, 04-09: 3, 04-06: 1 | **FAIL** |
| totals | 23 → 67; additions 44, **removals 0, target moves 0** | — |
| first approval earlier | 3 sessions (04-01, 04-02, 04-09) | listed |

Same shape at both arms: purely additive, zero removals, zero target moves, control untouched,
and §5.4 breached. **The verdict does not depend on the pin.**

## 2c. THE CLAUSE WALK, ANSWERABLE AT LAST — and the additions are NOT malformed

N0 put the entry zone on every approval: `entry_location_id/_band/_source/_side`,
`candidate_reason`, `story_kind`, `story_all_kinds`, and `zone_state_at_bucket` replayed
causally by `zone_state_at_v24` over bars strictly before the bucket. §2's UNGRADED clauses are
now graded, over all **103** additions:

| ALGO-070 clause | measured |
|---|---|
| **(iv)** not Route A on a BROKEN zone | **0 violations** |
| **(i)/(ii)** matching family, taught story of that family | **every REV addition carries one of the spec's own six**: `touch_and_reject` 67 · `prior_momentum_after_rejection` 28 · `sweep_and_reclaim_with_control` 6 · `failed_breakout_back_inside_with_control` 2 |
| **(iii)** not a pre-window grant | held by construction |
| **(v)** the reason it did not become a trade | one-bullet budget, untouched |
| setups | **103 of 103 are REV** — the over-grant is entirely Route A |

Zone states across the additions: `TESTED` 63 · `ACTIVE_SUPPORT` 12 · `FLIPPED_RETEST` 11 ·
`ACTIVE_RESISTANCE` 9 · `NO_ZONE_ON_LOCATION` 8. **None broken.**

> **This changes the diagnosis, and it is the most useful thing in the packet.** The retired
> fractions were not filtering *malformed* stories — every addition is a well-formed taught
> rejection on a live zone. The batch fails because there are **too many correct-shaped ones and
> they arrive earlier**. "Narrow by refusing bad stories" is therefore not an available lane:
> there are no bad stories to refuse. §6a is R2c losing to exactly this.

## 2d. N0 — F1's clause removed under a prediction, not an argument

`_directional_body` is `close beyond open in the direction`, which for a LONG is exactly
`progress > 0` — and `efficient` already requires `progress > 0`. The clause is **entailed**: no
input can satisfy `efficient` and fail it.

**Pre-registered before the run:** removing an entailed clause must move **ZERO** approvals; if
it moved even one, the entailment argument was wrong and the clause went back in.
**Measured: 143 → 143, membership identical BY KEY, targets identical on every key.**
Positive control on the field addition itself: **143 reproduced identical by key**, fields
populated 143/143 (`story_kind` 104/143 — break-family candidates carry no rejection story,
which is correct, not missing data).

It is out of the conjunction, still computed for the reason chain so
`PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN` still names the refusing clause, and
`independent_force.py` is changed identically so the mutation arm stays a witness.

## 3. Why — and it is not a coding defect

The additions are 103 with **zero** removals and **zero** target moves. A repair that only ever
adds is not mis-firing on edge cases; it has removed a constraint and put nothing in its place.

R2 retires `body_frac 0.62`, `close_loc 0.78` (from `_control`) and `reject_wick 0.35` (from the
Route A forms); R2b retires `0.30/0.40`. All four were untaught, and the operator's binary
definition is not in doubt — ALGO-071 §3 is his own sentence. But after the retirement the entire
Route A rejection test is *"traded into the band and closed back out on the near side"*, and on
this corpus that is satisfied about 2.6× as often as the taught story was. **His definition is
correct and the code around it has no other narrowing left, so his binary form is carrying the
whole gate alone.** That is a fact about the machine's remaining structure, not about him.

Two things follow, and neither is a repair proposed here:
- the taught Route A sequence has stages *after* the rejection — ALGO-071 §3 itself says the
  momentum-after clause *"remains the next stage of Route A exactly as taught"* — and those
  stages are where a narrowing would have to come from, with a citation;
- the one-bullet budget is downstream of all of this. 143 approvals is not 143 trades. The
  count that matters for agreement is which approval comes FIRST, and §5.4 exists precisely
  because that is what moved.

## 4. Red-proofs and the mutation battery

Red-proof order held: the four §5 red-proofs went **RED at `56d9360d`, semantically, on the claim
itself** (committed as the ordered first observable at `56d9360d`), then **GREEN** with the change.
Four further asserts are labelled REGRESSION ASSERTS in the file and are **not** counted as
red-proofs: they agree before and after, so they prove nothing about the change.

**Full v2.4 suite: 849 passed, 0 failed** (838 passed / 8 failed before the ALGO-096B rewrites).

**Mutation battery** — membership never counts, byte-exact restore verified by `sha256`:

| defect | RED set |
|---|---|
| D1 `_rejection_wick` always False | 10 |
| D2 `_control` always True | 1 — `touch_without_directional_control` |
| D3 `two_sided_wick_conflict` always False | 9 — including the diagonal test |
| D4 `_directional_body` always True | 1 — the cross-derivation witness only |

Every one of the eight ALGO-096B rewrites appears in a RED set: each still has a path to red with
the NEW predicate deleted, as constraint (1) requires.

## 5. F1 IS A NO-OP WITH A REDUNDANT CLAUSE — a finding about the specification

Attacking a member nobody demonstrated: **D5 planted the same loosening in BOTH force derivations
— 0 RED. The entire v2.4 suite stayed green.**

The cause is not a missing test. After F1 the geometry clause is *"close beyond open in the
direction"*, which for a LONG is exactly `progress > 0` — and `efficient` **already requires**
`progress > 0`. The two clauses are now **logically equivalent**, so no input can separate them
and no verdict comparison can ever go red. F1 does not re-express the geometry clause; **it makes
it redundant.** `PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN` still fires, but it can no longer mean
anything the efficiency clause's first conjunct does not already mean.

This holds independently of the guard result: it is a property of F1 as ALGO-096 §5 specifies it,
true on any corpus.

**A claim I nearly published and retracted before publishing it.** I first wrote that F1 therefore
contributed *nothing* to the 40 → 143. That is **false**, and the error is worth recording because
it is the ALGO-095 shape again — reasoning about a clause instead of measuring it. The redundancy
is *internal to the new code*: geometry ⟺ `progress > 0` **after** F1. Measured against the OLD
code, F1 removed `momentum_bar`'s `body_frac >= 0.62 AND close_loc >= 0.78` from the aggregate
forming candle, which is strictly **stricter** than `c > o`. So F1 **loosens force confirmation**
and can add approvals on its own. The attribution between R2/R2b and F1 is therefore measured
rather than argued, in §5a.

What remains observable is WHICH clause refuses, since geometry is checked first in the reason
chain. Pinned: a forming candle with no directional body must be refused
`PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN`, not `TUG_OF_WAR_PATH_TOO_INEFFICIENT`. **D5 re-run: 1 RED,
and it is that test.**

## 5a. ATTRIBUTION — which member moved what, measured at the gate

The equivalence in §5 says F1's clause is redundant *within the new code*. Whether F1 changed any
number *against the old code* is a separate question, and the candidate table answers it at the
gate without needing any new run — `FORCE_NOT_CONFIRMED` counts at his own buckets, 08:00 pin:

| session | candidates B→A | `FORCE_NOT_CONFIRMED` B→A | reading |
|---|---|---|---|
| 03-24 09:32 | 72 → 72 | **6 → 6** | force gate UNCHANGED; only the story outcome moves (`REJECTION_STORY_INCOMPLETE` 3→2, `SURVIVED_TO_RANKING` 0→1) |
| 04-06 10:04 | 85 → **239** | **6 → 2** | four decision clocks now clear force; each then expands into per-location records |
| 04-09 11:35 | 12 → **89** | **8 → 6** | two clocks now clear force |

**F1 is NOT inert against the old code — it opened the force gate at six decision clocks across
two sessions.** That settles the claim I retracted before publishing (§5): "F1 contributed nothing"
was false, and this is the measurement that shows it. The candidate-count explosions at 04-06 and
04-09 are not a story-layer effect at all; a story change cannot alter the candidate population,
and it did not on 03-24, where the population is identical and only one verdict flipped.

**The two hits attribute cleanly, and both match ALGO-096 §4's per-session predictions:**
- **03-24 is R2/R2b alone.** §4 wrote *"YES iff the conflict test re-expressed under his definition
  grants, then `_control` (R2)"*. Force was already CONFIRMED at his exact minute (§3's table),
  the candidate population is unchanged, and the survivor appears purely because the story gate
  stopped refusing. F1 contributed nothing here.
- **04-09 needed F1 first.** §4 wrote *"YES iff F1 AND R2 grant at that zone"*. Force had to open
  (8 → 6) before any candidate could reach the story gate at all — the ceiling probe's prediction,
  now observed in the real run rather than under a forced-true patch.

Both conditional predictions, written before the code existed, are confirmed with the conditions
firing in the order the ruling specified.

**THE WHOLE-CORPUS ATTRIBUTION, MEASURED — a third arm, R2+R2b with F1 reverted.** Same
instrument, a third worktree at `56d9360d` carrying the byte-identical new `derivation.py` (md5
verified) and the ORIGINAL `force.py`:

| arm | approvals | vs baseline | new Route-A before his clock, convicted days |
|---|---|---|---|
| baseline `56d9360d` | **40** | — | — |
| **R2 + R2b only** | **89** | **+49**, removals 0 | **15** |
| R2 + R2b + F1 (landing head) | **143** | **+103**, removals 0 | **37** |
| **F1's OWN contribution** | — | **+54 added, 0 removed** | **+22** |

Two things follow, and they point in opposite directions for F1:

1. **F1 caused the MAJORITY of the over-grant** — 54 of the 103 additions and 22 of the 37 early
   Route-A approvals come from F1 alone, on top of R2+R2b. A clause I described in §5 as
   *redundant* is the single largest contributor to the failure. Both statements are true and
   they are about different code: **entailed within the new code, strictly looser than the old
   one.** That is precisely why the retraction in §5 mattered — publishing "F1 contributed
   nothing" would have hidden the biggest single cause of the batch failing.
2. **Removing F1 does NOT rescue R2/R2b.** R2+R2b alone still puts **15** new Route-A approvals
   before his clock on convicted days, so §5.4 fails on the rejection repair by itself. The
   narrowing has to come from somewhere else — which is the argument for R2c in §9, not a reason
   to re-scope §5.

The control survives in **all three** arms, identical by key and target.

## 6. ALGO-096A and ALGO-096B, discharged

**096A.** `force.py` carries its own module-local `UNFROZEN_CHOICES` with one entry,
`path_efficiency_threshold` — provenance UNTAUGHT (a v2.2 default shipped with the search range
`(0.56, 0.68)`), MEASURED UNBINDING (0 of 14 at his clocks, ALGO-096 §3), never moved, never
selected by an outcome. Its test mirrors `test_..._breakout_derivation.py:421-430` including that
file's key property: the declared number is **derived by regex and compared to `Params.body_frac`**,
never hand-typed. `independent_force.py` gets no second dict, and a test asserts it does not.
The seals on `breakout_derivation.py` and `target_policy.py` were not opened.

**096B — the eight rewrites.** Taught negative kept in every case; bar moved to one his definition
also refuses; assertions changed only where they named a fraction or the old signature.
Before/after OHLC against the band `[100.0, 102.0]`:

| fixture | was | now |
|---|---|---|
| `touch_without_directional_control` | `(102, 102.4, 100.1, 102.1)` close **102.1 ABOVE hi** — a rejection under ALGO-071 §3 | `(102, 102.4, 99.0, 99.5)` close **99.5 BELOW lo** — the level broke |
| `mixed_overlap_and_two_sided_wicks` (3 derivation tests + `CONFLICTED`) | `(105, 110.0, 100.0, 105.2)` close **105.2 ABOVE hi** — a rejection | `(101.2, 110.0, 92.0, 101.0)` close **101.0 INSIDE** — it decided nothing; wicks stay substantial (upper 0.489 / lower 0.500) |

**The pin — reported, then re-pinned, never from this desk's reading.** Grant matrix measured at
both commits with one instrument: BEFORE = diagonal + `{(A_NORMAL_REJECTION,
C_PREBREAK_DISPLACEMENT)}`; AFTER = diagonal, **no** off-diagonal. The diagonal is unchanged —
every route still grants on its own evidence. The (A,C) cell at the bar, last completed bar of
`ROUTE_C_BARS`: `O=99.00 H=101.80 L=98.90 C=101.60`, band `[100.0, 102.0]` — close **INSIDE** the
band, `body_frac 0.8966`, `upper_frac 0.0690`, `lower_frac 0.0345`, and the retired rule
(`upper>=.30 and lower>=.30 and body<=.40`) **did not fire**. So the old code read a bar that
decided nothing as a completed rejection, and A granted. That is ALGO-096B's pre-registered
**acceptable** mechanism. Neither disqualifying mechanism occurred: no taught form was lost
(`all_kinds` still carries `failed_breakout_back_inside_with_control` and
`sweep_and_reclaim_with_control`), and no bar that IS a rejection under his definition stopped
granting A. Re-pinned to `frozenset()` citing 096B, **pending ALGO-099**.

**Vacuity declared rather than banked:** with the set empty,
`test_every_pinned_overlap_is_REAL_and_none_has_gone_stale` cannot fail. The teeth move to the
diagonal test, which is now stricter. That claim is **measured, not asserted** — the diagonal test
is in D3's RED set.

## 6a. N2 — R2c derived, guarded, and it does NOT land

The over-grant shape (§2c) names the missing piece: R2/R2b retired the fractions that were doing
the narrowing work of a **taught stage Route A never really carried**. ALGO-009 Route A is
`REJECTION/CONTROL STORY -> DIRECTIONAL 5M MOMENTUM -> SUSTAINED FORCE`; ALGO-052 has *"rejection,
then momentum candles formed"*; ALGO-071 §3 retired the magnitudes and explicitly left this clause
**standing**. ALGO-068 §3 already authorized its magnitude-free geometry: *"a momentum candle that
takes out the prior candle's EXTREME — the same extreme test Route B already uses at
`normal_breakout`"*.

`derive_story`'s DECISION stage read `trigger.close > last.close` — the weakest possible reading
of "momentum", which is why the stage carried no narrowing. **R2c** makes it
`trigger.high > last.high` (mirrored for S): the forming trigger's **running** extreme against the
**last completed** bar's extreme — the identical field on the identical bar `normal_breakout` §7.7
already reads, so **no new lookahead surface** (ALGO-033's rail unmoved). **No fraction**, asserted
by a test. Red-proof RED before, GREEN after; full suite 849/0 in its worktree.

| arm | approvals | early Route-A on convicted days |
|---|---|---|
| baseline | 40 | — |
| §5 batch | 143 | 37 |
| **+ R2c** | **111** (−32, +0) | **26** (−11) |

| line | measured | verdict |
|---|---|---|
| 5.1 control by key | identical to baseline by key AND target, clock `09:38` unmoved | **PASS** |
| 5.2 silenced | 0 | **PASS** |
| **5.3 both hits survive** | 03-24 `09:32` @ `…96923` **SURVIVES** · 04-09 `11:37` @ `…100322` **KILLED** (1 → 0) | **FAIL** |
| 5.4 no new early Route A | 26 remain | **FAIL** |

ALGO-098: *"a narrowing that kills the two hits fails."* It killed one. **R2c does not land**, is
not committed to the head, and is preserved in full — citations, fixtures and the two-line diff —
in `research/current_mnq_strategy_v2_4_r2c_momentum_after_derivation_2026_08_25.md`.

**A layer error of mine, caught before it reached this packet.** I first tested the two hits
against the *approval* capture and was about to report 04-09 as absent at the landing head too.
Wrong instrument: the hits are defined at **survives-to-ranking**, and §5.3 itself says approval
is *"expected NO"*. Re-tested on the candidate table, which measures that layer.

## 6b. N3 — the early-bullet census, and the limits of my own cross-check

N3 was re-assigned to the advisor seat mid-round for pace. I had already run an in-seat census; it
is reported here **as a cross-check, not as a rival result**, with its limitation stated.

Where the two agree: **03-23 and 04-09 both GRANT `D_PREBREAK_RETEST_BREAKOUT`, form
`break_retest`**, and zone ages match (mine 1.3h–569.9h, N3's 1.3h–570h). N3's headline —
**04-06's early bullet is Route B, not D**; the other four are D; all five rest on the untaught
`_momentum 0.62/0.78` at the trigger with margins down to `0.012` — goes further than mine and I
defer to it.

**Where mine failed, and why that is an instrument limitation and not a finding:** my probe could
not reproduce a granting route for 03-24, 03-31 or 04-06 — it asked the four routes at the *entry*
bucket with force forced true, which is not the path the kernel actually granted on. Reporting
"3 of 5 grant no route" would have been measuring the neighbouring object. It is recorded as a
defect in my probe.

One thing my census did settle, and it corrects a generalization: **ALGO-096 §4 described these as
trades "at a zone 20+ days old"**. Measured, that is true for **two** of five — 03-23 at 477.7h
(~20d) and 04-09 at 569.9h (~24d) — while **03-31 is 1.3h old, 04-06 5.6h, 03-24 18.3h**. The
early bullet is not characteristically a stale-zone trade; it is characteristically an *early* one.

## 6c. THE THREE ITEMS ALGO-100 AND THE N5 GRADER ASKED FOR

**(1) Where the code lives.**
- **H1 = `62722a2a9e6d6ed7ac7f535e95b36d92a8d6121a`** on `research/current-mnq-strategy-v2-4-zone-first-candles` — N0 (capture fields + F1 clause removal) and every guard artifact under `research/_algo096_guard_2026_08_24/`. Pushed, `ls-remote` verified.
- **R2c = `7d42d121b9b9c6f30c383502a99637855bdf2104`** on **`research/algo-r2c-momentum-after-20260825`**, pushed. Deliberately NOT on the strategy head: the head already carries one unratified batch, and stacking a second failed repair would hand the next seat two unratified changes wearing one head. The branch carries the two-line change, its red-proof, and the derivation document.

**(2) The 04-09 kill AT THE FORM LEVEL — and R2c is form-blind.**
The 11:37 survivor at the batch head carried **four** forms at `SWING:S:2026-03-17T22:30…100322`:
`touch_and_reject` (primary) · `failed_breakout_back_inside_with_control` ·
`sweep_and_reclaim_with_control` · `prior_momentum_after_rejection`, with
`approach=True, fight=True, decision=False`. Under R2c the X-ray record is `REJECTED`,
`killed_at=REJECTION_STORY_INCOMPLETE`, `authority_refusal=COUNTER_BIAS_REVERSAL_WITHOUT_COMPLETED_CONTROL_TRANSFER`
— i.e. the **DECISION/momentum-after clause**, exactly the clause R2c strengthened.

**R2c never inspects which form carried the story.** So a **FORM-SCOPED R2c** — requiring the
extreme take-out only for the forms whose teaching implies follow-through — is a live variant.
**Named, not built**, per the standing rule against inventing a predicate inside a report.

*One correction on my own working, before it could mislead:* I first hand-derived this from the
last **completed 5m** bar and got a refusal on both the old and new clauses. That is the wrong
object — the X-ray's trigger is the **force partial** built from the 1m sub-bars, not the
completed 5m bar. The numbers above come from the X-ray record, which is the authority; my
hand-derived OHLC comparison is discarded rather than published.

**(3) The 26 remaining early Route-A, and the bridge grep.**
By session: **03-23: 10 · 03-24: 3 · 03-31: 4 · 04-06: 3 · 04-09: 6.**
**FORM BREAKDOWN: OPEN.** It needs the field-enabled capture re-run inside the R2c tree
(`r2c_0800.json` was produced before N0 added `story_kind`). The re-run was launched and had not
finished when this packet was published; it is **not** claimed, not estimated, and not inferred
from the batch-head run. Published as OPEN rather than held, so the revert disposition and the
A+ lane are not waiting on one table. It lands as an artifact under
`research/_algo096_guard_2026_08_24/r2c_fields_0800.json` and I will message the SHA.

**THE GREP, and it is the most consequential line in this packet.**
`FIRST_A_PLUS` is a conjunct of the master trading equation
(`engineer_onboarding:43`: `… ∧ ROOM_TO_FIRST_REACTION ∧ FIRST_A_PLUS ∧ DAILY_BULLET_UNUSED`).
**It has NO implementing predicate anywhere.** Every occurrence across `research/` is a status
string or ledger note — `MISSED_FIRST_A_PLUS_SIGNAL`, `NO_A_PLUS_YET`,
`FIRST_A_PLUS_INSIDE_OLD_REPLAY_WINDOW` — and the definition-shaped grep returns **empty**.

What actually spends the bullet is `kernel.py:201-208`:

```python
rank = {"BRK5": 3, "BRK15": 2, "REV": 1}
cand = max(candidates, key=lambda c: (rank[c.setup], c.location.quality, c.location.confluence))
```

a **within-bucket tie-break**, and then **clock order across buckets** — the first candidate that
becomes an entry takes the bullet.

> **So "A+" is implemented as "first".** There is no quality judgment anywhere in the money path.
> That single fact explains this entire round: loosen the entry layer and more well-formed setups
> appear *earlier*, and "first" spends the bullet on them. It is why §2c found no malformed
> stories to refuse, why R2c cut 32 approvals without fixing §5.4, and why every repair aimed at
> the entry layer has been fighting the wrong term. **The missing term is his A+ judgment — a
> TAUGHT concept in the master equation, derivable from the teachings and videos under ALGO-064's
> M1 method, never from labels and never from PnL.**

## 7. Housekeeping, stated so it can never look like tampering

The D4/D5 defects caused the cross-derivation test to write
`research/current_mnq_strategy_v2_4_force_crosscheck_failure.json`. It is untracked, was produced
by a defect I planted and removed, and I deleted it: left in place it would stand as a false
record of a real derivation disagreement.

## 8. What I did NOT do

No repair is proposed. Nothing is re-scoped. Break-family gates untouched (§7.2's lane), including
Route D's `reject_wick 0.35` and `acceptance_bars 3` that ALGO-097 measured as carrying 100% of
the D refusals at his clocks. `entries.momentum_bar` untouched. The 17.25-pt stop, targets, the
exam rules, `MIN_COMPLETED_1M_OBSERVATIONS` — untouched. **Re-exam #3 NOT run**: it was ordered
after the batch lands, and the batch does not land. No value anywhere set from a 2026 label.

**NOT REVERTED — and I want to be explicit that I first decided the other way, then measured the
consequence and changed my mind.** ALGO-085 ratified *revert-not-land, patch held*, I cite that
precedent against this batch in §0, and a precedent invoked against A binds you on B — so my first
call was to revert `derivation.py`, `force.py` and `independent_force.py` to `56d9360d`. Working
out what that actually produces is what stopped me:

- **Reverting the production code alone leaves the suite RED at head.** The ALGO-096B rewrites
  encode the operator's definition, and `two_sided_wick_conflict(row, lo, hi)` does not exist in
  the reverted code — `test_two_sided_wick_conflict_discriminates` would pass `LO=100.0` as
  `min_each`. The four §5 red-proofs would also return to RED by design. **A red head is a worse
  hazard than a documented unratified one**: it destroys the next seat's ability to tell new
  breakage from known breakage, which is the single thing a head is for.
- **Reverting the tests as well would discard work ALGO-096B ordered by name**, and the next
  round needs those eight taught negatives re-expressed whatever happens to R2.
- ALGO-085's revert was a **single file** (`target_policy.py`, verified byte-exact by empty diff)
  with no test surface hanging off it. This batch is three production files plus eight rewritten
  tests plus a re-pinned overlap set. The precedent's *shape* transfers; its *cost* does not.

So the head stays as it is, **suite GREEN at 849**, and the record carries the verdict instead:
this packet, the commit subjects, and the guard artifacts under
`research/_algo096_guard_2026_08_24/` all state that the batch failed its own pre-registration.
PR #38 remains DRAFT / DO NOT MERGE, so nothing here is reachable by capital.

**The advisor's PROVISIONAL direction, received before publication and not yet a ruling:**
*do not revert; leave the head; the batch is* **UNRATIFIED-IN-PLACE** *and must be named as such;
no re-exam #3 on this head — the exam runs only after a ratified landing.* That matches the call I
had already reached and the reasoning above, so the head stands. **UNRATIFIED-IN-PLACE** is the
term of art for this state and it is used deliberately: the code is present, the tests are green,
and **none of it is ratified**. ALGO-100 rules; if it wants the revert it is one commit and the
patch is entirely in history (`46b21920` code, `f314fe5d` tests).

**Re-exam #3 is NOT run**, and not merely because the batch failed: the exam runs only after a
ratified landing. Running it here would grade a head nobody ratified.

**A future seat must not read this head as ratified semantics.** The commit subject on
`46b21920` says the red-proofs are green; the commit subject on the guard artifacts says the
batch fails. Both are true and they are about different things. The ladder is the authority.

## 9. Asks for ALGO-100 — and the lane the measurements actually point at

1. **The head.** UNRATIFIED-IN-PLACE stands (§8), now carrying N0 as well: capture fields and the
   F1 clause removal, both of which are *instrument and dead-code* changes, not repairs, and both
   proved no-ops on membership. R2 + R2b remain in place and unratified. R2c is **not** on the
   head at all.
2. **F1 — both facts, and they do not cancel.** Against the OLD code it opened the force gate at
   six decision clocks and caused **54 of the 103** additions and **22 of the 37** early Route-A
   approvals (§5a). *Within* the new code its geometry clause is entailed and removing it moved
   **zero** approvals (§2d). Ratify the removal as dead code; the loosening it already did is a
   separate question and belongs to whatever replaces R2.
3. **THE LANE. The entry layer may not be where the separation lives.** §2c is the strongest
   result here: all 103 additions are Route A, none on a broken zone, every one carrying a taught
   rejection form. There are no malformed stories to refuse, so a refusal-only narrowing has
   nothing to bite on — and R2c, a genuinely correct cited magnitude-free stage, still leaves 26
   and kills a hit. **What actually turns an early well-formed approval into the wrong trade is
   the one-bullet budget**, which is downstream of everything this round touched and which no
   member of the §5 batch or R2c goes near. I am not proposing a repair there; §7.2's census
   (N3) has now measured the five early bullets, and the next pre-registration should be written
   against **which approval the budget spends**, not against which approvals exist.
4. **If a further entry-layer narrowing is still wanted**, the untried reading is ALGO-068 §3's
   own list — *"two momentum candles after a key-level rejection"* — rather than R2c's single
   candle. It must be pre-registered against the same rule, and 04-09 `11:37` is now known to be
   the binding case: it is the hit that any stronger momentum-after stage kills first.
5. **Not asked for, and on the record:** no widening of the pre-registration, no "N of the 37 are
   explainable", no re-scoping of §5.4, and no re-scoping of §5.3 to save R2c. Both rules were
   conjunctive and written before the numbers existed. They decided.

---

**Suite line, enumerated, not read off a tail.** `pytest tests/ -k v2_4` at `62722a2a` →
**849 passed, 0 failed, 831 deselected**; the same in the R2c worktree → **849 passed, 0 failed**.
Batch file `test_..._algo096_r2_r2b_f1.py` → 11 tests: 4 red-proofs (RED at `56d9360d`, GREEN
after), 4 regression asserts, 2 ALGO-096A declaration tests, 1 F1 geometry-clause guard added
after D5. `test_algo_r2c_momentum_after.py` → 3 tests (RED before R2c, GREEN after), held in the
R2c worktree and **not** on the head, because without the R2c code it would be red there.
Mutation battery: 5 defects × full suite, byte-exact restore verified by `sha256` on every one.
Grant matrix: 2 commits × 4 routes × 4 evidence sets. Approved-entry capture: **5 code arms**
(baseline · R2+R2b · R2+R2b+F1 · +R2c · F1-out) × 14 sessions, plus both pins on two of them.
Candidate table at his six clocks: 4 arms. Early-bullet census: 5 sessions × 4 routes.

**Artifacts** — all under `research/_algo096_guard_2026_08_24/`, with the instruments beside
them (`diff_capture.py`, `grant_matrix.py`, `run_approved_entry_membership_capture.py`,
`run_algo096_candidate_table_six_clocks.py`, `run_routed_early_bullet_census.py`) and the R2c
derivation at `research/current_mnq_strategy_v2_4_r2c_momentum_after_derivation_2026_08_25.md`.

**§5 rubric by key, for the independent grade (N5, advisor-dispatched):** control
`2026-04-14 09:38 L BRK5` target `25869.0` must be present and identical in every arm · sessions
silenced must be 0 · new Route-A(REV) approvals before his clock on `{03-23 11:21, 03-24 09:32,
03-31 09:49, 04-06 10:04, 04-09 11:35}` must be 0 (measured 37 / 26) · survivors-to-ranking at
`03-24 09:32 @ S:2026-03-24T00:15:00-04:00:96923` and `04-09 11:37 @
SWING:S:2026-03-17T22:30:00-04:00:100322`.

**EDGE lane firewall.** An EDGE backtest exists on another seat. It was not read, is not cited,
and no decision in this packet touched it. ALGO-020/064 stand.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.
