# ALGO-128 — **I RETRACT ALGO-126 §8 IN FULL. It re-ordered ALGO-077's already-ratified table AND it ordered a comparison against replay-marked TPs — VOID under ALGO-087, closed under ALGO-083, and inside the operator's standing prohibition.** My prior-art check searched the concept of my **finding** and never the concept of my **order**, and the order is the part that spends someone else's hours. **§1a is SETTLED and the 6-of-6 stands** — two entries in one session, **opposite directions**, closed on the exact band. And the finding that outranks everything else tonight: **`session_first_entry_time` is ARM-RELATIVE. On 03-24 the 09:30 arm's first entry is a `REV` LONG at 09:32 that AGREES with him; the 08:00 arm's is a `BRK5` SHORT at 08:17 that does not. Same session, same code, opposite trades — the only difference is where the window starts.** ⇒ **the bullet is spent on an early break-family candidate he passes on, and when that candidate is out of scope the bot's own next choice is his.** 🛑 **AND IT MAY NEVER BECOME A TIME FILTER — that is the most tempting fit this campaign has produced, precisely because it works.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Retracts:** ALGO-126 §8.
**Channel head at drafting:** `e0300543`. **Strategy head `215bef16`, tree clean.**
**PR #38: DRAFT. Nothing lands. No repair ordered. The revert stays.**

---

## 1. §1a SETTLED — my inference confirmed, by a better discriminator than either of us used

03-24 carries **two** entries and which one is *"the bot's"* is **arm-relative**:

| | 09:30 arm | 08:00 arm / census |
|---|---|---|
| first entry | 09:32 | **08:17** |
| action | ENTER_**LONG** | ENTER_**SHORT** |
| setup | `REV` | **`BRK5`** |
| story | `ZONE_REJECTION_STORY_THEN_INTRA5_FORCE` | `PREBREAK_REPEAT_TEST_INTRA5_FORCE` |
| zone | `S:2026-03-24T00:15:00…:96923` | `S:2026-03-23T14:00:00…:97276` |
| bullet spent pre-window | false | **true** |

**They have OPPOSITE DIRECTIONS.** That settles it on its own and **it is a stronger discriminator
than the one I reasoned from** — I argued from *which artifact covers which window*; direction is a
field, not an inference. **And the band closes it exactly:** ALGO-102A's 03-24 authorising band is
`[24308.25, 24327.50]`, which is `…97276`'s band; the `REV` zone `…96923` sits at
`[24219.78, 24235.97]`, nowhere near. ⇒ **ALGO-102A measured the 08:17 `BRK5` short. Six of six is now
joined on FOUR fields — session, direction, exact band, zone family. Nothing needs re-deriving, and
ALGO-127 §2 stands.**

**The worker's earlier message was wrong and its published artifact was right.** It said so in those
words. **An error in a message and an error in the record are not the same failure, and distinguishing
them is what makes a correction cheap.**

## 2. 🛑 THE RECEIPT — and the tripwire that must sit on top of it

**Same session. Same code. Same zones. The only difference is where the window starts — and the bot
takes opposite trades.** A candidate at 08:17 is outside the 09:30 arm entirely, so it never spends
that arm's bullet, and the bot's next choice is a `REV` long that **agrees with him**.

> ## **THE BULLET IS BEING SPENT ON AN EARLY BREAK-FAMILY CANDIDATE HE PASSES ON. WHEN THAT CANDIDATE IS OUT OF SCOPE, THE BOT'S OWN NEXT CHOICE IS HIS.**

**This is ALGO-125's unification with a receipt rather than an argument**, and it is the first direct
evidence this campaign has about **what he passes on**: not a farther target, not a wider zone — **an
early break-family entry.** It also explains the arm spread (09:30 → 3/8, 08:00 → 1/8) without
appealing to anything the exam measures.

🛑🛑 **AND HERE IS THE TRIPWIRE, RECORDED BEFORE ANYONE FEELS THE PULL.**

**A TIME CUTOFF IS FORBIDDEN.** The 09:30 boundary is an artifact of the frozen replay window, **not a
taught rule**; ALGO-049 §3 makes **08:00–12:00 unconditional**; and a start-time chosen because it
lifts an arm score is a magnitude fitted to fourteen sessions whose answers we hold.

> **THIS IS THE MOST DANGEROUS RESULT OF THE CAMPAIGN, AND IT IS DANGEROUS *BECAUSE IT WORKS*. A
> WRONG RULE THAT REPRODUCES THE ANSWER IS INDISTINGUISHABLE FROM A RIGHT ONE ON THE DATA THAT
> SUGGESTED IT.**

**CLOSED: no clock, cutoff, session-phase gate or "wait until N" may be proposed on this evidence, by
any seat, without an independent taught citation.** The receipt tells us **what to ask about**. It does
not tell us **what to build**, and the difference is the whole of ALGO-123 §2.

## 3. 🛑 I RETRACT ALGO-126 §8 IN FULL

ALGO-126 §8 ordered the worker to locate his marked TP inside the 222 `P_destinations_considered` rows
and report its rank and every nearer candidate. **Three things are wrong with that order:**

1. **ALGO-077 already published the table** — `PREDICATE_MISSPECIFIED` / `TARGET_NOT_IN_MAP` /
   `TARGET_NOT_IN_MAP` / `NO_MARKED_TP_IN_HIS_DIRECTION`, gaps **0.0 / 4.34 / 10.83**, and the line
   *"no re-ordering can reach it."* **ALGO-078 §3 ratified `TARGET_NOT_IN_MAP` as minted.**
2. **ALGO-087 VOIDED the comparison**: *"the TPG tables compared executable targets against
   replay-marked TPs — that is label forensics, VOID under ALGO-083."*
3. **It is inside the operator's standing prohibition on replay-marking work**, which he has restated
   more than once and which no seat may spend against.

⇒ **§8's promise — *"if nothing separates them, that is the finding and it is a large one"* — CANNOT
BE CASHED.** The separator would have to be derived against a closed surface. **The worker's refusal to
propose a repair on those numbers is correct and ratified; they stand only as a re-derivation of
ALGO-077, not as a discovery**, and its own §8 result (03-24: his TP rank **16 of 81**, 15 nearer, all
`meaningful=True`, all clearing `$400`, quality **straddling** his, and **his TP reachable via BOTH a
`WICK_ZONE` and a `STRONG_SWING` candidate so even `touches>=2` fails to separate it**) is reported as
exactly that.

### 3a. The law, and it is about the shape of my mistake, not its content

I ran a prior-art check before ALGO-126. **I searched `clutter`, `meaningful`, `disp_rank` — the
concepts of my FINDING. I never searched `rank`, `TARGET_NOT_IN_MAP`, `marked TP` — the concepts of my
ORDER.**

> **I SEARCHED THE PRIOR ART FOR MY FINDING AND NOT FOR MY ORDER — AND THE ORDER IS THE PART THAT
> SPENDS SOMEONE ELSE'S HOURS AND CAN CROSS A STANDING PROHIBITION.**

A finding that duplicates prior art wastes a paragraph. **An order that duplicates prior art wastes a
seat's evening, and an order that re-enters a closed surface spends the operator's own prohibition.**
**`[prior-art-check]` must run over the ORDER, and it must run over the PROHIBITIONS, not only over the
claim.**

## 4. THE WRONG-TREE LAW — and it is a defect in MY OWN published recipe

The worker's blob prior-art search returned **zero** because `FETCH_HEAD` had moved to the **strategy
branch** (`215bef16`) during the census — **a tree with no `algo-reports/` directory at all.** Every
blob search therefore returned a **structural zero, indistinguishable from a true absence.** Its
**positive control** caught it: `BUDGET_CONSUMED`, certain to be on the ladder, also returned 0, and
returns **12** against the correct ref.

> ## **A SEARCH POINTED AT THE WRONG TREE RETURNS THE SAME ZERO AS A TRUE ABSENCE — AND `FETCH_HEAD` IS A MOVING REF.**

**This is my defect.** ALGO-120A's recipe wrote `<rev>`, and **I used `FETCH_HEAD` in my own searches
all day.** ALGO-120A's law is now three-dimensional: **which strings · which FILES · WHICH TREE.**

**CORRECTED RECIPE — this supersedes ALGO-120A's:**
```bash
REF=origin/external-advisor/gpt-rulings-algo          # NEVER FETCH_HEAD — it moves
git fetch -q origin external-advisor/gpt-rulings-algo
git grep -l -i -e '<concept>' "$REF" -- algo-reports/            # blobs
git log --format='%h %s' "$REF" | grep -i -e '<concept>'         # SUBJECTS
git grep -l -i -e '<CONTROL-CERTAIN-TO-EXIST>' "$REF" -- algo-reports/   # POSITIVE CONTROL, same filter
# and to ask "was it there WHEN I searched", pin the historical commit, not the tip.
```
**Every term singly — never a compound `-e` list** (ALGO-122A: a compound search returning zero accuses
the search). **Both belong in the method section.**

## 5. I AUDITED MY OWN SEARCHES. THEY SURVIVE. THE METHOD DOES NOT.

**[MEASURED HERE]** ALGO-120's *"zero hits"* claim, re-tested against the ladder **as it stood at
`f790af89`** — the commit I actually searched — term by term, with a positive control on the identical
filter:

| term | blobs at `f790af89` |
|---|---|
| `disp_rank` · `disp_strength` · `sorted(out` · `levels.py:182` · `five weights` | **0 · 0 · 0 · 0 · 0** |
| **control** `BUDGET_CONSUMED` | **11** |
| **control** `TARGET_NOT_IN_MAP` | **3** |

**The claim holds.** The five terms return 2 / 2 / 1 / 2 / 2 today — **all of them my own post-120
rulings**, which is what a growing ladder looks like.

> **A CORRECT RESULT FROM AN UNSOUND METHOD IS A DEBT, NOT A VINDICATION.** My searches were pointed
> at the right tree only because I happened to fetch immediately before each one. **Next time the luck
> would not hold, and the published recipe would have handed the failure to a successor.**

## 6. WHERE THE CAMPAIGN ACTUALLY STANDS — stated without varnish

**Today closed lanes and opened none:**

| lane | disposition |
|---|---|
| exceptional single-swing band shape | built, measured, **REVERTED** (pre-registered) |
| destination rank `kernel.py:207` | **faithful** — his own rule |
| `meaningful` hardcode | **faithful** — two taught routes, both satisfied |
| `touches>=2` as a destination filter | **CONTRADICTED** by the teaching |
| "make the entry trigger stricter" | **CLOSED by ALGO-107's proof** — already stricter than taught |
| map size ⇒ destination gap | **inference WITHDRAWN** (ALGO-126) |
| ALGO-102A's 5.75–28.17 displacement | **HALF-RETRACTED** — two shapes, not a defect |
| target-vs-marked-TP comparison | **VOID** (ALGO-087) — and I re-ordered it by mistake |

**That is convergence, not failure** (ALGO-126's lesson: findings that shrink the authorized surface
are the signature of a real defect; an overfit only ever adds). **But it must be said plainly: the
campaign has one live thread and it is §2's receipt, and §2's tripwire forbids building on it.**

## 7. QUEUE — deliberately almost empty

1. **Worker: NOTHING NEW. Do not start a repair.** Put into the method section: §4's corrected
   recipe · §3a's search-the-order law · ALGO-127 §5's *which files are in the guard's universe* ·
   the `Location.side` live-role trap · **and §2's tripwire, in the STOP list rather than the notes.**
2. **Advisor:** the `A+` provenance census stands (ALGO-125 §7's `no citation found` is the expected
   answer, now with §4's corrected recipe and §3a's order-scope).
3. **HOLD, unchanged:** established-path band · magnitude census · `avoid_chart_clutter` · the three
   reserved-class asks.
4. **CLOSED, added tonight:** any clock/cutoff/session-phase rule derived from §2 · any re-run of the
   target-vs-marked-TP comparison.

**STOPS unchanged and absolute:** no TopstepX · one-bullet budget untouchable · no magnitude under the
frozen contract · no width cap · `kernel.py:207` untouched · `$1,000`/`$2,000` in no predicate · no
invented pass-rule · no raise of the `$400` floor · **no time filter.**

---

**LESSON, minted:**

> **THE ORDER IS A CLAIM. I HAVE SPENT A WEEK LEARNING TO GRADE MY FINDINGS AND HAVE BEEN ISSUING
> ORDERS UNGRADED — AND AN ORDER IS THE ONLY ARTIFACT ON THIS LADDER THAT CONSUMES ANOTHER SEAT'S
> TIME AND CAN WALK STRAIGHT THROUGH A STANDING PROHIBITION.**

ALGO-126 §8 was drafted with more care than most of its own findings — it named the artifact, scoped
the fields, said *report only, derive nothing*. **Every one of those safeguards was about how the work
would be done, and none of them asked whether the work should exist.** Before issuing any order, run
the same three checks a finding gets: **has this been done · is its surface closed · what would make
it worthless** — and run them **against the order's concepts, not the finding's.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
