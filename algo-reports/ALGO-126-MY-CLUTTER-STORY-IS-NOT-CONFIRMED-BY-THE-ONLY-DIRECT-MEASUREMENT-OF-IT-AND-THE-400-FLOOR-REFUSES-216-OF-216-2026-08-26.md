# ALGO-126 — **THE FIRST DIRECT MEASUREMENT OF THE DESTINATION GAP DOES NOT CONFIRM MY CLUTTER STORY, AND WEAKLY RUNS AGAINST IT.** Candidate counts vs the his-to-bot ratio: **122 candidates → 1.36× (the CLOSEST match) · 81 → 7.20× (the worst) · 10 → 2.28×.** I published twice today that a cluttered map drives the destination near. **These three rows do not show that, and I am not going to bury it.** What IS rock-solid: **the `$400` floor refuses NOTHING — 216 of 216 candidates cleared it across four sessions.** And one measured instance is sharper than my whole story: on **03-30 the bot took a `LIQUIDITY_CLUSTER` at 14.50 pt / $435 — the ONE family where `meaningful` is actually COMPUTED — and he traded through it to 33.00 pt.** ⇒ **the predicate is too weak WHERE IT RUNS, not merely absent where it doesn't.** Plus a correction I owe: **ALGO-123 §3's "no new instrument" was WRONG** — `target_policy.py:176` writes to an in-memory object that is never serialised. **`EXISTENCE IS NOT WIRING`, the law I minted this morning, broken by me this afternoon.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Rules on:** the worker's `P_chosen`
answer to ALGO-123 §item-1. **Channel head at drafting:** `11d35c96`. **Strategy head `f132617c`.**
**PR #38: DRAFT. Nothing lands. No repair ordered. The revert stays.**

---

## 1. THE CORRECTION I OWE FIRST

ALGO-123 §3 said the `reference_tp_reward_usd` distribution needed **"no new instrument, no new
number, no code change"** because the field is *"already computed at `target_policy.py:163` and
already stored at `:176`."*

**That is wrong.** `:176` sets `target.reference_tp_reward_usd` on an **in-memory `Target` object that
is never serialised per approval anywhere in `research/`.** I read the assignment, saw a field being
set, and asserted persistence. **The distribution genuinely does need an instrument, and I told the
worker it was free.**

> **`EXISTENCE IS NOT WIRING` — and I minted its second form in ALGO-122's own lesson this morning
> (`WIRED-FOR-SOME-INPUTS IS NOT WIRED`). Here it took a third form: `ASSIGNED IS NOT PERSISTED`.**

The failure has a direction worth naming: **I got it wrong in the direction of promising someone else
free work.** A cost estimate about another seat's labour is a claim like any other, and this desk owed
it the same check it owes a magnitude.

## 2. RATIFIED — the worker's own wrong-population catch, and its law

The worker first read `reference_reward_usd` from
`research/current_mnq_strategy_v2_4_tpg_target_layer_2026_08_23.json` — **222 rows, median
`$22,702`** — and caught it before publishing: those 222 are **`P_destinations_considered`**, the whole
candidate list at his entry clock, **not chosen TPs.**

> **A FIELD NAME MATCHED; THE POPULATION DID NOT.** ⇒ **AN IMPLAUSIBLE MAGNITUDE IS AN ACCUSATION
> AGAINST THE POPULATION BEFORE IT IS A FACT ABOUT THE WORLD.**

`$22,702` at `$30`/pt is **757 points**, absurd on its face — and that absurdity was the only thing
that fired. **This is the fourth population defect this seat-pair has caught in one day** (the three
in the band guard, plus this), and it is the same shape as `[guard-green-for-the-wrong-reason]`.
**Recording a near-miss the reader would never otherwise see is the behaviour, not the error.**

## 3. 🛑 THE PART THAT GOES AGAINST ME

`P_chosen`, arm `taught_0800`, **at his entry clock**, four sessions, produced 2026-08-23 at a
different pin. **[Arithmetic re-derived here, all four `pt × $30` identities check exactly.]**

| session | bot chose | reward | his marked TP | his USD | candidates | cleared `$400` | **his/bot** |
|---|---|---|---:|---:|---:|---:|---:|
| 03-24 | 45.75 pt `KEY_ZONE_15M` | $1,372.50 | 329.25 pt | $9,877.50 | **81** | 81/81 | **7.20×** |
| 03-30 | 14.50 pt `LIQUIDITY_CLUSTER` | $435.00 | 33.00 pt | $990.00 | **10** | 10/10 | **2.28×** |
| 03-31 | 42.25 pt `KEY_ZONE_15M_REFINED…5M` | $1,267.50 | 57.25 pt | $1,717.50 | **122** | 122/122 | **1.36×** |
| 04-14 | 126.00 pt `FVG_15M` | $3,780.00 | none marked | — | **3** | 3/3 | — |

**ALGO-121 §2, ALGO-122A §4 and ALGO-125 §6 all rest on: a cluttered map ⇒ the nearest thing wins ⇒
the destination is too near.** **The session with the MOST candidates produced the CLOSEST match to
him, and the worst gap came from a session with a third fewer.** `n = 3` ratios, so this refutes
nothing — **but it is the only direct measurement of the destination gap this campaign has ever taken,
and it does not support the story I built on top of it.** Publishing it prominently is the whole point
of having taken it.

### 3a. The reframe it forces, and the inference I withdraw

The bot's chosen distance is *"distance to the nearest meaningful thing ahead of entry."* **That is a
property of LOCAL map density at the entry, not of the map's GLOBAL size.** 03-31's 122 candidates
still put something of his nearly first; 03-24's 81 did not.

> **MAP SIZE IS A PROXY THAT DOES NOT TRACK THE THING IT WAS STANDING IN FOR. THE OPERATIVE QUANTITY
> IS NOT HOW MANY ZONES EXIST — IT IS WHETHER THE NEAREST ONE IS A ZONE HE WOULD CARRY.**

⇒ **I WITHDRAW ALGO-121 §2a's inference** that the band build's 40% map reduction is evidence the
destination layer improved. **The 40% is real and measured; the inference from it to the destination
gap is not supported and I should not have drawn it.** Re-exam #5 is consistent with the reduction
having moved the destination layer not at all. **The measured facts in ALGO-121 stand; that one
inference does not.**

## 4. WHAT IS ROCK-SOLID — and it settles ALGO-122A/123 §4 from the exit side

**The `$400` floor refuses nothing: 81/81 · 10/10 · 122/122 · 3/3 = 216 of 216**, by the artifact's own
header. ⇒ **No distance floor is why the destinations are small.** ALGO-123 §4 predicted exactly this
from his stated tiers sitting above both code floors, and it is now measured rather than inferred.
**No change to `min_room_r`, the `$400` floor or the 17.25-pt stop is needed, wanted or authorized** —
and the worker touched none of them.

*(Note against the temptation: 03-30 cleared the floor by **1.17 points**. That is NOT a reason to
raise it. A floor tuned until it excludes the case you dislike is the fit ALGO-123 §2 forbids.)*

## 5. ONE MEASURED INSTANCE, SHARPER THAN THE STORY IT REPLACES

**03-30: the bot chose a `LIQUIDITY_CLUSTER` at 14.50 pt. That is the ONE family where `meaningful` is
genuinely COMPUTED** (`targets.py:286`, `touches >= 2 AND quality >= min_zone_quality`) **rather than
hardcoded `True`. It passed. His marked TP was 33.00 pt — he traded through it.**

Gold fixture `V24G06` says he *does* take the first meaningful reaction and `must_not_do:
skip_nearer_cluster_for_farther_fvg`. **So he did not skip a meaningful one — that cluster was not
meaningful to him, and `touches>=2 AND quality>=0.58` said it was.**

⇒ **The predicate is too weak WHERE IT RUNS, not merely absent where it doesn't.** That is a real
refinement of ALGO-122A, and it is worth more than the hardcode finding because it survives fixing the
hardcode.

🛑 **ONE INSTANCE. NOT A CLASS.** `[instance-not-condition]`: I can name the mechanism — a computed
`meaningful` admitting a reaction he passed — but I have **no enumeration over it** and have not run
one. **`ONE INSTANCE MEASURED.`** Anyone reading this as "the predicate is too weak" as a general claim
is reading past this paragraph.

## 6. THE ORACLE, FIREWALLED — one hit, reported and decided nothing

**03-30's marked TP is 33.00 pt = `$990.00` against his stated lower tier of `$1,000` — within `$10`.**
Reported. **It decided nothing in this ruling and may decide nothing in any future one** (ALGO-123 §2).

**AND A JOIN-KEY WARNING ON MY OWN PRIOR USE OF HIS FIGURES:** he said *"most of my **trades** average
$1,900-2,000"* — **trades are realized outcomes; marked TPs are targets. They are different objects**
and the four rows show why: the marked TPs here are `$9,877` / `$990` / `$1,717`, a range no "average"
describes. **The median-to-median join (66.1 pt ≈ `$1,983` vs his stated band) holds; per-session
joins do not, and I will not make one.**

## 7. SETUP LABELS — the refusal is correct and I ratify it

Measured: **04-14 = `BRK5`** (`FIRST_BREAK_PRINT_THEN_INTRA5_FORCE`, on the **swing** zone `…:102865`)
and **03-24 = `REV`** (`ZONE_REJECTION_STORY_THEN_INTRA5_FORCE`, on an **established** `WICK_ZONE`).
The other four spent the bullet **before** the window, so `entry_family_receipt` does not cover them
and `budget_faithful` records time and action **but not setup** — the census is running at `f132617c`.

**The worker declined to infer the four labels from ALGO-106's census prose. That is correct and it is
the standing rule of this ladder: a report is a CLAIM, and prose is not a field.** ALGO-106's framing
*implies* all five spenders are break-family; **implication is not measurement, this column decides
whether ALGO-102A survives, and it will be taken from a field.**

**The two measured rows already point one way:** the `BRK5` fill against a **swing** zone moved
**further** outside under the ruled band; the `REV` fill was against an **established** zone whose band
never moved. **Both are exactly what ALGO-125 §1's geometry predicts. Two rows. Not four.**

## 8. THE NEXT MEASUREMENT — and the data may already be committed

§3a says the operative quantity is **whether the nearest candidate is one he would carry**. That is
directly measurable and the artifact may already hold it:
`current_mnq_strategy_v2_4_tpg_target_layer_2026_08_23.json` carries **222 `P_destinations_considered`
rows**.

**ORDERED (worker, after ALGO-124 and the setup census — NOT before):** for each session, locate **his
marked TP within that candidate list** and report **its rank by first-contact distance**, together with
the `kind`, `source`, `touches`, `quality` and `meaningful` of **every candidate nearer than his**.
**Report only. Derive nothing, threshold nothing, propose nothing.** This is ALGO-102's "his TP is
rank N" taken **at the entry clock against the full candidate list** — and **what separates his from
the nearer ones is the entire remaining question of this campaign.** If nothing separates them, that
is the finding and it is a large one.

## 9. QUEUE

1. **Worker:** publish ALGO-124 (suite measured at head — correct to wait) · the break-family setup
   census at `f132617c` → the labelled 6-row table · then **§8's nearer-than-his census**.
2. **Advisor:** the `A+` provenance census (ALGO-125 §7's `no citation found` is the expected and
   complete answer).
3. **HOLD:** established-path band · magnitude census · `avoid_chart_clutter` · **the three
   reserved-class asks**.
4. **The `reference_tp_reward_usd` full-distribution instrument: NOT authorized.** §1 says it costs
   real work; §3 says the four rows we already have did not support the story it was meant to test.
   **Build it only if §8 says the question is worth it.**

**STOPS unchanged:** no TopstepX · the one-bullet budget untouchable · no magnitude under the frozen
contract · no width cap · `kernel.py:207` untouched · `$1,000`/`$2,000` in no predicate · no invented
pass-rule · **and no raise of the `$400` floor.**

---

**LESSON, minted:**

> **I MEASURED THE THING MY STORY WAS ABOUT AND THE STORY DID NOT SURVIVE — WHICH MEANS THE STORY HAD
> BEEN LOAD-BEARING FOR HOURS WITHOUT EVER HAVING BEEN TESTED.** ALGO-121, 122A and 125 each built on
> *"clutter ⇒ nearest ⇒ too near"*, each cited real measurements, and **none of them measured the link
> in the middle.**

A chain of correctly-measured facts can carry an untested joint, and **the joint is invisible precisely
because every fact around it has a number attached.** Ask of any causal story: *which link have I
measured, and which am I inferring?* — then measure the inferred one **before** it is three rulings
deep. **The 40% map reduction was true and the conclusion drawn from it was not, and nothing in the
number could have told me.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling. §6 is reported and firewalled.*
