# ALGO-123 — **THE OPERATOR VOLUNTEERED A SECOND TARGET TIER, UNPROMPTED, AND IT IS NEW.** Verbatim: *"MOST OF MY TRADES AVEARGE $1900-2000 AND IF NOT THEY AREE $1000."* The upper tier **restates** a figure this ladder already holds — his median marked target measures **66.1 pt = $1,983**, inside his stated band. **The `$1,000` tier has no prior art in any held surface** (searched, with a positive control). At the frozen 15-MNQ reference that is **33.33 pt = 1.93R** against the 17.25-pt stop, and it sits **above** the bot's realised median (`$620`) and **above** the code's own `structural_min_room` (`$776`). ⇒ **The bot's typical destination is below even his floor case.** 🛑 **AND IT IS AN ORACLE, NEVER A RULE.** The rule form — promote TP2 when TP1 is small — **was already built and RETIRED twice** (`supersedes_older_clauses[4]`, `examples_of_superseded_interpretations[1]`). Encoding `$1,000`/`$2,000` would re-tread a retired clause and violate `farther_target_cannot_be_chosen_merely_for_more_profit`. **The one legitimate use is a read-out on a planned-side observable the code already stores for free at `target_policy.py:176`.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `176c95d5`.
**Source:** the operator, to this desk, 2026-08-26, **unprompted and unsolicited.** **This is a fact
about his own practice that no artifact records — reserved class. It is captured here verbatim and
IT IS NEVER TO BE ASKED AGAIN**, in any form, by any seat. **PR #38: DRAFT. Nothing lands. No repair
ordered. The worker's contract is untouched.**

---

## 1. What he said, and what is actually new in it

> *"YES CAUSE MOST OF MY TRADES AVEARGE $1900-2000 AND IF NOT THEY AREE $1000"*

At the frozen 15-MNQ reference (`$2/pt × 15 = $30/pt`), against the frozen **17.25-pt** stop:

| | USD | points | R |
|---|---:|---:|---:|
| **his upper tier** | **1,900 – 2,000** | **63.33 – 66.67** | **3.67 – 3.86** |
| held median marked target (ALGO-117 §5) | 1,983 | 66.10 | 3.83 |
| **his lower tier — NEW** | **1,000** | **33.33** | **1.93** |
| `structural_min_room` = `min_room_r 1.50 × stop` | 776 | 25.88 | 1.50 |
| bot realised median | 620 | 20.68 | 1.20 |
| taught `$400` TP1 floor | 400 | 13.33 | 0.77 |
| held complete trade, `verified_video_evidence[5]` | 4,140 | 138.00 | 8.00 |

**THE UPPER TIER IS NOT A SECOND PATH AND I WILL NOT PRESENT IT AS ONE.** ALGO-117 §5 already recorded
that the 66.1-pt median matched *"his own stated figure to within $16"* — so he had stated ~$2,000
before. **A restatement by the same source is corroboration of memory, not independent confirmation**
(`[second-reader-anchoring]`, `[same-layer-agreement]`). What it does establish is that his figure is
**stable across two separate occasions**, which is worth exactly that much and no more.

**THE `$1,000` TIER IS NEW.** Searched `unified_fidelity_evidence_registry`,
`trader_fidelity_addendum` and `user_fidelity_gold` for `1000` / `1,000` / `1900` / `TP2` /
`TAKE PROFIT ZONE 2` / `average`, **with a positive control** (`400` → 8 hits, so the search works).
**No lower-tier figure exists in any held surface.**

**AND THE DISTRIBUTION IS WIDER THAN TWO POINTS.** `verified_video_evidence[5]` is a complete,
tape-verified MNQ trade at 15 contracts: entry 19005.50, stop 18988.25 (**17.25 exactly**), target
19143.50 = **138.00 pt = $4,140**. ⇒ **his two figures are MODES, not BOUNDS**, and any check built on
them must be a distribution check, never a range test.

## 2. 🛑 WHY THIS MAY NOT BECOME A RULE — the rule form is already retired, twice

The obvious move is *"if TP1 is small, take TP2."* **This campaign already built that and threw it out:**

- `conflict_resolution.examples_of_superseded_interpretations[1]`: **`automatic_1_5R_close_TP1_rollover_to_TP2`** — superseded.
- `supersedes_older_clauses[4]`: *"The earlier 2026-08-20 clause that **automatically promoted TP2 whenever TP1 fell inside `Params.min_room_r * Params.stop`** at the actual entry clock."* — superseded.

And the standing teaching forbids it directly: **`farther_target_cannot_be_chosen_merely_for_more_profit: true`** · `no_blind_rollover` · *"targets remain the next meaningful reaction/liquidity/zone destination, **not fixed R**"* (`video_evidence` #7/#12). Rollover is permitted on **one** path only — `processed_rollover_rule`, where the near reaction has been **causally processed**.

> **A NUMBER THE TRADER STATES ABOUT HIS OUTCOMES IS EVIDENCE ABOUT WHETHER WE ARE RIGHT. IT IS NOT
> AN INSTRUCTION ABOUT WHAT TO AIM AT. THE MOMENT IT SELECTS A DESTINATION IT HAS STOPPED BEING
> EVIDENCE AND STARTED BEING A FIT** — and it would be a fit to the one number in the campaign the
> operator will notice us hitting, which makes it the most seductive overfit available to us.

## 3. THE LEGITIMATE USE — a free, planned-side, high-resolution observable

**ORDERED, as a reported diagnostic:** the distribution of **`target.reference_tp_reward_usd`** across
every approval in the fourteen sessions.

**Why this exact field and no other:**
1. **It already exists.** `target_policy.py:163` computes it, `:176` stores it on the Target. **No new
   instrument, no new number, no code change.**
2. **It is entirely on the PLANNED side of the firewall.** `reference_tp_reward_usd` is the *planned
   TP1 display at the frozen reference size* — **the same object the ratified `$400` rule is already
   defined over**. It contains **no realized outcome, no win/loss, no PnL.** The `$620` in §1's table
   is a realised figure and stays fenced; **the diagnostic does not use it.**
3. **It has vastly more resolution than the exam.** ALGO-117 §4(c) ruled the 8-session exam
   underpowered as an iteration instrument and ordered iteration against structural observables.
   **This is one, and it is now anchored to a figure he has stated twice.**

**AND THE CONSTRAINTS, which are the whole of it:**
- **DIAGNOSTIC ONLY. Never a gate, never a selector, never an acceptance threshold.**
- **No clause may be chosen, kept, tuned or rejected because it moves this distribution.** It is read
  *after* a change is justified on fidelity grounds, never as the justification.
- **Reported as a distribution against his two modes**, not as a pass/fail against a range — §1's
  138-pt trade proves the range test would be wrong.
- If a future seat finds itself reaching for `$1,000` or `$2,000` inside a predicate, **that is the
  tripwire: stop, and re-read this section.**

**What it buys us tonight:** after re-exam #5, we will be able to say whether the band repair moved the
*planned* destination distribution toward his modes **without having consulted a single outcome** — the
first time this campaign has had a high-resolution read on the destination layer that is both his and
firewalled.

## 4. WHAT IT ALREADY TELLS US, stated carefully

His **lower** tier is **$1,000 / 33.33 pt / 1.93R**. The code's own `structural_min_room` is
**$776 / 25.88 pt / 1.50R**, and the taught TP1 floor is **$400 / 13.33 pt / 0.77R**.

⇒ **Both of the code's distance constraints sit BELOW his floor case.** That is not a contradiction —
they are floors, and a floor below his worst case is doing nothing rather than doing harm. **But it
means neither constraint can be the reason the bot's destinations are small.** It is consistent with
ALGO-122A: **the destinations are small because the map is cluttered, not because a floor is wrong.**
**No change to `min_room_r` or `$400` is authorized, contemplated, or needed** — and I record that
explicitly because "his floor is $1,000, so raise ours" is precisely the fit §2 forbids.

## 5. QUEUE — one diagnostic added, nothing else moves

1. **ACTIVE, worker, unchanged:** band build · five-bucket partition · **(d) empty** · re-exam #5 ·
   ALGO-121 §3a lifecycle count · entry-displacement re-run. **Plus: report the
   `reference_tp_reward_usd` distribution.** It is one field already on the object. **Reported, not
   gated. If it costs more than a few lines, skip it and say so — it must not delay the build.**
2–4. **Unchanged** (ALGO-122A §6): narrowed magnitude census · the `avoid_chart_clutter` question
   *after* re-exam #5 · established-path band · **the two reserved-class asks.**

**STOPS unchanged and absolute:** no TopstepX of any kind · no magnitude under the frozen contract ·
**no change to `min_room_r`, `$400`, or the 17.25-pt stop** · no width cap · `kernel.py:207` untouched ·
**and `$1,000` / `$2,000` may not appear in any predicate, ever.**

---

**LESSON, minted:**

> **THE OPERATOR'S OWN NUMBERS ARE THE MOST DANGEROUS DATA THIS CAMPAIGN CAN HOLD, BECAUSE THEY ARE
> SIMULTANEOUSLY THE BEST EVIDENCE WE HAVE AND THE MOST TEMPTING THING TO FIT TO.**

The discipline that separates the two is **which side of the decision they sit on**: a number that
*reads out* whether we got closer is evidence; the same number *inside a predicate* is a fit — and it
would be a fit whose success we would be least able to doubt, because he told us the answer. **His
figures go in the report. They do not go in the code.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling. §1's `$620` and `138 pt` are reported for scale and decided nothing; the ordered
diagnostic reads a PLANNED field only.*
