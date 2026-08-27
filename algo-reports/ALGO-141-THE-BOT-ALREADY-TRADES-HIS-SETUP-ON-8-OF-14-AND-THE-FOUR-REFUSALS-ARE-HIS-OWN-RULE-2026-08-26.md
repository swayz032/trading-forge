# ALGO-141 — **THE BOT ALREADY TRADES HIS SETUP ON 8 OF 14 SESSIONS.** **[VERIFIED HERE at the artifact]** `rejections_by_deepest_gate_BY_KEY = {"REACHED_THE_TRADE": 8, "G3_NO_TARGET": 4}`, `G1_NO_FILL 0`, `G2_PAST_LAST_ENTRY 0`. **Measured by walking the production functions and recording what they return — nothing reimplemented.** **AND ALL FOUR REFUSALS ARE HIS OWN RATIFIED RULE:** `TP1_REFERENCE_REWARD_UNDER_400` at **$277.50 · $255.00 · $180.00 · $255.00** — the nearest meaningful reaction was too close to pay $400. **Not a defect. The emitter is doing exactly what he taught.** **G-FORCED-TRUE CEILING: 8 → 9, in memory only — and NOT one-directional: two sessions flip TO a rejection and one flips AWAY, because an earlier break takes the bullet once the floor opens.** ⇒ **opening his own rule buys one session and costs another. There is no free win there.** 🛑 **AND THE LIMIT TRAVELS WITH THE NUMBER: this walk DISAGREES with the 08-21 scorecard on 03-30 and 03-31. Unreconciled. "8 of 14" is a statement about `_analysis_run_day` AT THIS PIN — not yet a statement about the exam's numbers.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `d669f561`.
**Strategy head `dd9c8f20`.** **PR #38: DRAFT. No repair ordered. `status: DIAGNOSTIC ONLY… changes
no file.`**

---

## 1. VERIFIED HERE

```
rejections_by_deepest_gate_BY_KEY      {"REACHED_THE_TRADE": 8, "G3_NO_TARGET": 4}
emitter_reason_families_on_refused…    {"FIRST_REACTION": 8, "TP1_REFERENCE_REWARD_UNDER_400": 4}
sessions_whose_trade_is_a_REJECTION    {"as_built": 8, "with_the_reward_floor_at_zero": 9}
status                                 DIAGNOSTIC ONLY. Records what the production functions
                                       return. Derives nothing, proposes nothing, changes no file.
```

**ALGO-096's procedure, run as written:** deepest gate **BY KEY**, the **emitter's own string** rather
than the gate label, and the **G-forced-TRUE ceiling**. `G1_NO_FILL 0` and `G2_PAST_LAST_ENTRY 0` —
**only one of the three gates bites, and it is the target layer.**

**And the twin caught the worker on the way in:** it imported `build_and_classify` from `targets.py`
and it failed on the signature — **the engine imports the `target_policy` one.** ALGO-122A's warning
about the same-named function is live and it fired on a real attempt.

## 2. THE FOUR REFUSALS ARE HIS OWN RULE, QUOTED AT THE EMITTER

```
03-31 08:02 L   TP1_REFERENCE_REWARD_UNDER_400:277.50:LIQUIDITY_CLUSTER:WICK_ZONE
03-31 08:04 L   TP1_REFERENCE_REWARD_UNDER_400:255.00:LIQUIDITY_CLUSTER:WICK_ZONE
04-01 08:04 S   TP1_REFERENCE_REWARD_UNDER_400:180.00:FVG_15M:FVG_15M_NATIVE_UNMITIGATED
04-13 08:52 L   TP1_REFERENCE_REWARD_UNDER_400:255.00:LIQUIDITY_CLUSTER:WICK_ZONE
```

**`tp_ladder.too_close_rule`, spec §7, RATIFIED BY HIM TODAY:** *"If the planned TP1 display is under
$400 at the frozen 15-MNQ reference size, the immediate entry is not safe."*

> ## **HIS SETUP IS REFUSED FOUR TIMES BY HIS OWN FLOOR, DOING EXACTLY WHAT HE TAUGHT IT TO DO. THAT IS NOT A DEFECT AND IT IS NOT A LANE.**

**And the ceiling is the anti-overfit result of the night.** Forcing the floor to zero moves it
**8 → 9 — one session — and it is not one-directional**: `03-31` and `04-01` flip **to** a rejection,
`04-13` flips **away**, because with the floor open an earlier break takes the bullet first.
**Opening his own ratified rule buys one session and costs another.** **No floor change is proposed,
authorized, or worth proposing** — and the ceiling exists precisely so nobody has to guess that.

## 3. 🛑 WHAT THIS RETIRES — and two of them are mine

**The `0 of 6` / `6 of 6 BRK5` picture was the pinned capture, end to end.** Live at the re-landed
head, **his setup is the trade on 8 of 14.** ⇒ **every framing tonight was built on a frozen file:**

| framing | status |
|---|---|
| *the rank keeps his setup out* | retired |
| *arrival order is the whole answer* | retired **(mine, ALGO-137 §4)** |
| *something downstream drops it* | retired **(mine, ALGO-140 §2)** |
| *0 of 5 / 0 of 6 zone rejections* | **artifact of the pinned capture** |

**ALGO-140's 10-of-14 first-survivor measurement stands** — it was from live runs at both pins. **What
was wrong was the inference I stacked on it**, because I joined it to a *gap column computed against
the stale scorecard.* **A live measurement joined to a stale one inherits the stale one's age, and I
did not say so.**

## 4. THE LIMIT — and it is not a footnote

**This walk trades on `03-30` and `03-31`; the 08-21 scorecard records no entry on either.** Different
pin, possibly a different path — `_analysis_run_day` versus whatever produced the scorecard. **The
worker refused to guess which is authoritative and so do I.**

> **"8 OF 14" IS A STATEMENT ABOUT `_analysis_run_day` AT THIS PIN. IT IS NOT YET A STATEMENT ABOUT
> THE EXAM'S NUMBERS, AND IT MUST NOT BE GIVEN TO ANYONE WITHOUT THAT SENTENCE ATTACHED.**

**A week of ratified semantic change landed between 08-21 and 08-26, so disagreement is EXPECTED
rather than anomalous — but expected is not measured, and I am not converting one into the other.**

**ORDERED, and it is the only remaining job:** reconcile the walk against the exam's own path at this
pin. **Name which function produced the scorecard's `session_first_entry_time`, run both at `dd9c8f20`,
and report the join by key.** **If they agree, `8 of 14` is the campaign's headline. If they disagree,
the disagreement is the finding.** Residual branch required.

## 5. QUEUE

1. **§4's reconciliation. Nothing else.**
2. **Not authorized:** the $400 floor · any repair · the anchor · the rank · a time filter · the
   overlap thread.

---

**LESSON, minted:**

> **FOUR STORIES DIED TONIGHT AND ALL FOUR HAD THE SAME PARENT: A PINNED CAPTURE READ AS A LIVE RESULT. WE DID NOT HAVE FOUR WRONG HYPOTHESES — WE HAD ONE STALE INPUT AND FOUR HONEST READINGS OF IT.**

The rank, arrival order, the lookahead, the downstream drop: each was measured carefully, each was
internally sound, and each was an inference about a system from a file describing a different one.
**The cost was not the wrong answers — it was that every instrument we built was aimed by them.**

> **ASK OF ANY INPUT, BEFORE THE FIRST HYPOTHESIS AND NOT AFTER THE THIRD: WHEN WAS THIS PRODUCED, BY WHICH CODE, AT WHICH PIN — AND WOULD IT LOOK ANY DIFFERENT IF THE THING I AM STUDYING HAD CHANGED?**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling. §2's dollar figures are TP DISPLAY values at the frozen reference size — the planned
object his own rule is defined over — and no realized outcome appears.*
