# ALGO-121 — **THE DESTINATION RANK IS FAITHFUL. THE MAP WAS THE DEFECT — AND TONIGHT'S BAND BUILD IS ALREADY REPAIRING IT.** I read the held teaching instead of theorising about the rank, and it **refutes the framing of my own ALGO-120 §7.** `tp_ladder.normal_rule` and gold fixture `V24G06` both teach **"the FIRST meaningful physical reaction owns TP"**, with `must_not_do: skip_nearer_cluster_for_farther_fvg` and `farther_target_cannot_be_chosen_merely_for_more_profit: true`. **So rank-0 is his rule.** The bot's destinations are wrong not because it ranks wrongly but because **"meaningful" is unenforced and the map carries ~62 zones per session where he carries a handful.** ⇒ **The entry repair and the exit repair are the same repair**, and **[MEASURED HERE from the worker's own captures] the band build cuts the authorized map 865 → 522 (−39.7%), swing zones 578 → 235 (−59.3%), with the ESTABLISHED set identical BY KEY in 14 of 14 sessions.** One thing to report and **not** to fix tonight: the ruled band's width is **unbounded above by construction** and its tail now runs **p95 65.25 pt, max 124.25 pt** against his 4–32-pt demonstration.

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `62351ba9`.
**Measured from:** `research/current_mnq_strategy_v2_4_algo119_map_BEFORE_a355507d.json` and
`..._algo119_map_AFTER_2026_08_26.json`, produced by the worker, **re-read and re-computed here by
this desk — the totals block was not taken on trust.** **PR #38: DRAFT. Nothing lands from this desk.**
**The build is NOT paused, capped, or re-scoped by this ruling.**

---

## 1. FIRST — I read the destination teaching, and it refutes my own §7's framing

ALGO-120 §7 said *"the deficit is destination selection"* and named `kernel.py:205/207` as **"the exit
half, and the larger of the two."** That sentence implies **the rank is unfaithful**. **It is not.**
`direct_trader_rules.tp_ladder`, held in
`current_mnq_strategy_v2_4_trader_fidelity_addendum_2026_08_20.json`, verbatim:

```
labels:                      TP1, TP2, TP3_OR_NEXT_MEANINGFUL_REACTION
allowed_destination_families: STRUCTURAL_SR_REACTION · LIQUIDITY_REACTION_CLUSTER
                              · ACTIVE_15M_FVG_MIDPOINT
normal_rule:   "Use the FIRST MEANINGFUL PHYSICAL REACTION as TP1 when the planned TP display
                is $400 or more at the frozen 15-MNQ reference size..."
too_close_rule:"If the planned TP1 display is under $400 ... the immediate entry is NOT SAFE."
no_blind_rollover: "An untouched under-$400 TP1 may not be automatically skipped just because
                    a farther TP2 exists."
farther_target_cannot_be_chosen_merely_for_more_profit: true
```

And gold fixture **`V24G06_FIRST_REACTION_LIQUIDITY_BEFORE_FVG`**, his label verbatim:

> *"The liquidity cluster appeared before the FVG, price reacted there and did not need to trade into
> the farther FVG. **Whichever meaningful reaction area appears first owns TP.**"*
> `must_have: nearer_liquidity_cluster_owns_tp_when_before_fvg` ·
> **`must_not_do: skip_nearer_cluster_for_farther_fvg`**

> **HIS RULE *IS* RANK-0. The bot ranks correctly over the wrong set.**

**The defect is that `meaningful` is a predicate the map does not enforce.** `[RELAYED, ALGO-117 §5 /
ALGO-102]` his marked targets sit at rank **4/7/17** with median **5.5 traded through** — that is not
evidence he reaches past the first meaningful reaction; **it is evidence that 5.5 of the bot's
candidates are not meaningful reactions at all.**

## 1a. 🛑 CORRECTION I OWE ON MY OWN §7 — it must not be read as "aim farther"

ALGO-120 §7's arithmetic (his 66.1-pt destination breaks even at **20.7%**, the bot's 20.68-pt at
**45.5%**, and it wins **42%**) is correct, firewalled, and decided nothing. **But published beside
the words "the largest single lever", it paves a road the teaching explicitly closes:**
`farther_target_cannot_be_chosen_merely_for_more_profit: true`. **A farther target chosen because the
breakeven maths is friendlier is precisely the overfit the operator warned against this afternoon,
and my own §7 laid the paving stones.** Stated plainly, and it binds this desk:

> **DISTANCE IS A CONSEQUENCE OF MEANINGFULNESS, NEVER A REASON FOR IT.**
> If his destination is farther, it is because the nearer candidates were not meaningful — never
> because farther pays better. Exactly parallel to ALGO-111 §2: **the 4–32-pt spread is
> corroboration, not the source.**

⇒ **Queue item 3 is re-specified.** It is **not** "change the rank." It is **"derive and enforce
`meaningful`"** — the predicate that turns ~62 candidates into his handful. The rank at
`kernel.py:207` stays untouched. **This narrows the queue and removes a lever; it does not add one.**

---

## 2. AND THE MAP REPAIR IS ALREADY MEASURABLE — tonight, from his sentence alone
**[MEASURED HERE — I re-read both capture artifacts and recomputed every figure below from `rows`, not from the `totals` block]**

| | BEFORE `a355507d` | AFTER (ruled band) | Δ |
|---|---|---|---|
| authorized map, 14 sessions | **865** | **522** | **−343 (−39.7%)** |
| swing zones | **578** | **235** | **−343 (−59.3%)** |
| established zones | **287** | **287** | **0** |
| per session (mean) | **61.8** | **37.3** | −24.5 |
| per session (range) | 50 – 69 | 24 – 48 | — |

🛑 **THE CONTROL IS PERFECT, AND IT IS MEMBERSHIP, NOT CARDINALITY.** I compared the **established
zone ID sets** session by session: **0 of 14 differ.** Not "the counts match" — *the same keys*. The
change is confined to the exceptional single-swing family exactly as ALGO-119 scoped it, and the
whole `−343` is that family. **This is the discriminating check that an equal-totals comparison
cannot make, and it passes.**

⇒ **The band shape, taken from one sentence of his with no magnitude added, removes 40% of the map.**
That is the first mechanical movement this campaign has produced toward *"he carries a handful"*.
**It is a large step and it is not the whole distance — 37.3 zones per session is still not a
handful, and this desk will not call it one.**

### 2a. Why this is the breakthrough shape, and why it cannot be an overfit

**The entry defect and the exit defect were never two problems.** `[RELAYED, ALGO-102A]` the bot
fills **5.75–28.17 pt beyond its own authorising band, 6 of 6** — a 5-pt band cannot contain a real
entry. `[RELAYED, ALGO-102]` it takes rank-0 of a cluttered set. **Both are the same 5-pt-band
defect**: too narrow to hold an entry, and too numerous to make "first" mean "first meaningful."
**One shape change from his own sentence attacks both**, and it adds **no degrees of freedom** —
there is no parameter here to search. **That is the whole anti-overfit argument, and tonight it has
its first measurement.**

**NEXT MEASUREMENT, and it is cheap:** re-run ALGO-102A's entry-to-band displacement on the same six
sessions against the AFTER map. **Pre-registered prediction, recorded before the run: fills that sat
5.75–28.17 pt outside a ~5-pt band should now sit INSIDE a ~32-pt band.** If they do not, the entry
story is wrong and I want that on the record in advance.

---

## 3. WHAT I WILL NOT DO ABOUT THE WIDTH TAIL — and why reporting it is the whole duty
**[MEASURED HERE, `rows[].width`, swing zones only]**

| | n | min | p25 | median | p75 | p95 | max |
|---|---|---|---|---|---|---|---|
| **BEFORE** | 578 | 2.00 | 3.27 | **5.07** | 6.81 | 8.42 | 11.67 |
| **AFTER** | 235 | 7.00 | 20.00 | **32.50** | 43.25 | **65.25** | **124.25** |

His demonstration measures **4–32 pt** (ALGO-089/111). **The median lands at 32.5 — the top of it —
and the upper tail leaves it entirely: 65 pt at p95, 124 pt at maximum, which is 7× the frozen
17.25-pt stop.** The cause is structural and was visible in the a-priori table: `min_wick 0.20` is a
**lower** bound on the wick fraction. **There is no upper bound, so `width` can reach the full bar
range** — and a 150-pt 15m bar hands you a 124-pt "zone".

🛑 **I AM NOT CAPPING IT, AND NEITHER IS THE WORKER.** A cap read off this distribution would be a
**new magnitude chosen from the data it is meant to judge** — the exact move ALGO-119 §3.6 says to
stop for, and the exact thing the operator warned against four hours ago. **`AN UNBOUNDED
CONSEQUENCE OF A FAITHFUL SHAPE IS A FINDING, NOT A LICENCE TO ADD A NUMBER.`**

**What may legitimately decide it, and nothing else:** a clause of his that bounds a zone's width; an
existing frozen contract magnitude that already reaches this surface; or a derivation. **`$400` is a
*floor on TP distance*, not a *cap on zone width* — different object, and it must not be borrowed.**
**If none exists, the honest close is `no citation found in the surfaces named` and the tail is
reported, not repaired.**

### 3a. The consequence that IS mechanical, and my own bucket (c) will catch it

The a-priori `IDENTITY_DECISIONS` moved `zone.mid` to the band midpoint — correctly, because the
level price is now an **edge**. But `mid` is consumed as a band-**interior** reclaim/away threshold
(`zone_lifecycle.py:91`). **On a 5-pt band that threshold sat 2.5 pt from the level; on a 124-pt band
it sits 62 pt from it.** ⇒ **the lifecycle semantics now scale with band width, and no one derived
that.** It is not a reason to stop — it is **exactly what ALGO-120 §5 bucket (c) LIFECYCLE was
written to surface**, and it is the first evidence the partition was the right ask. **Report it by
key in the packet.**

---

## 4. QUEUE — amended in one place, narrowed everywhere else

1. **ACTIVE, unchanged:** finish ALGO-119 + the five-bucket partition → re-exam #5. **(d) QUALITY
   MOVE must be empty.** Add **§3a's lifecycle count** and **§2a's entry-displacement re-run** to the
   reported observables. Neither is a gate; both are reported.
2. **NEXT, unchanged:** provenance census of the five weights at `levels.py:97-99` and the absent
   swing-path threshold. **Provenance only.**
3. **RE-SPECIFIED — this is the amendment.** ~~"the destination rank at `kernel.py:205`"~~ →
   **"derive `meaningful`"**: the predicate that separates a destination he would carry from map
   clutter, from the held teaching only — `STRUCTURAL_SR_REACTION` · `LIQUIDITY_REACTION_CLUSTER` ·
   `ACTIVE_15M_FVG_MIDPOINT`, the `$400` floor's **BLOCK-not-roll** semantics, `no_blind_rollover`,
   and `processed_rollover_rule`. **The rank at `kernel.py:207` is NOT to be touched — it is
   faithful.** Derivation to this desk before any code.
4. **NEW, and it is free:** the width tail's provenance search (§3) — one census, `no citation found`
   is a complete and expected answer. **No cap is authorized under any outcome.**
5. **HOLD, unchanged:** established-path band · the M1/AST/seven-weight census · **the two
   reserved-class asks, his to answer.**

**STOPS, unchanged and absolute:** no TopstepX connection of any kind, broker-paper included · no
magnitude under the frozen contract · **no width cap** · no new number in the band build.

---

**LESSON, minted, and it is a correction of my own reasoning from four hours ago:**

> **BEFORE RULING THAT A MECHANISM IS UNFAITHFUL, READ THE TEACHING FOR THAT MECHANISM. I REASONED
> FROM AN OUTCOME GAP TO A BROKEN RANK, AND THE HELD EVIDENCE SAID THE RANK WAS HIS RULE AND THE
> INPUT SET WAS THE DEFECT.**

An outcome gap tells you *something* upstream is wrong; **it never tells you which layer**, and the
layer it *suggests* is the one whose numbers you happen to have measured. The teaching was sitting in
a file this campaign has held since **2026-08-20**. **Cheap to read, and it removed a lever from the
queue instead of adding one** — which is the direction a correct finding usually moves a campaign,
and the direction an overfit never does.

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling. ALGO-120 §7's arithmetic is restated in §1a only to fence it.*
