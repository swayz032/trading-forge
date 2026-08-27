# ALGO-146 — **HE ASKED *"so non of that in in my specd"* AND THE ANSWER IS THREE DIFFERENT THINGS, ONE OF WHICH IS OUR ERROR.** **[MEASURED HERE] (1) The ladder IS in his files** — `direct_trader_rules.tp_ladder.labels = [TP1, TP2, TP3_OR_NEXT_MEANINGFUL_REACTION]`, `multiple_directional_tps_allowed: true`, plus three hash-bound screenshots. **(2) It is NOT in `spec.json`, the file the code loads** — `tp_ladder` `TP2` `TP3` `multi_target` `ladder` all **0 hits**, positive control `target` **7**. **(3) 🛑 AND IT IS NOT IN THE SPECIFICATION DOCUMENT WE WROTE HIM. §7 cites `tp_ladder` FIVE TIMES — `allowed_destination_families` · `farther_target_cannot_be_chosen…` · `too_close_rule` · `no_blind_rollover` · `processed_rollover_rule` — AND NEVER ONCE STATES THAT A LADDER EXISTS.** **We transcribed a multi-target rule set into a single-target section while citing its name five times. That is the exact defect the document was built to prevent, committed inside the document.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `10807df3`.
**PR #38: DRAFT.**

---

## 1. THE THREE ANSWERS  **[MEASURED HERE]**

| where | is the ladder there? |
|---|---|
| **his evidence files** | **YES** — `tp_ladder.labels = [TP1, TP2, TP3_OR_NEXT_MEANINGFUL_REACTION]` · `multiple_directional_tps_allowed: true` · `multi_target_screenshot_evidence[2]` *"TP1, TP2 and TP3"* · hash-bound screenshots `[6][7][8]` |
| **`spec.json`** (loaded by the code) | **NO** — `tp_ladder` 0 · `TP2` 0 · `TP3` 0 · `multiple_directional` 0 · `multi_target` 0 · `ladder` 0. **Positive control `target` = 7, so the search discriminates.** |
| **`MNQ-STRATEGY-SPECIFICATION.md`** (ours, ratified by him) | **NO — and this one is ours** |

## 2. 🛑 THE DOCUMENT CITES THE LADDER FIVE TIMES AND NEVER DESCRIBES IT

`MNQ-STRATEGY-SPECIFICATION.md` §7, verbatim citations:
```
[direct_trader_rules.tp_ladder.allowed_destination_families]
[tp_ladder.farther_target_cannot_be_chosen_merely_for_more_profit]
[tp_ladder.too_close_rule]
[tp_ladder.no_blind_rollover]
[tp_ladder.processed_rollover_rule]
```
**Five references to a structure named `tp_ladder`, and the section reads as *"how to pick THE
target"* — singular.** `TP2` appears once, inside a citation to a *superseded* clause.
**`TP3` appears zero times. `multiple_directional_tps_allowed` appears zero times.**

> ## **WE QUOTED FIVE RULES *ABOUT* THE LADDER AND NEVER WROTE DOWN THAT THERE IS A LADDER.**

**And that is why §7 passed his read.** Everything we showed him **was correct** — `no_blind_rollover`,
`too_close_rule`, `processed_rollover_rule` are all his, all accurately transcribed. **He confirmed
what was on the page. The missing line was not on the page to be confirmed.**

⇒ **ALGO-136's ratification of §7 is narrower than it looked: he ratified the target RULES as shown,
not a single-target reading of them.** **Recorded, and §7 needs the ladder added and re-shown to him
before it carries `RATIFIED` on this point.**

## 3. WHY THIS IS THE SHARPEST INSTANCE OF THE DAY

**The document exists to stop private re-derivation** (ALGO-132 §3). **Its method is: cite every line,
mark the uncitable `UNSPECIFIED`.** Both were followed here — **five citations, all accurate, all
resolvable.**

> **A DOCUMENT CAN BE CORRECT LINE BY LINE AND WRONG IN ITS SHAPE. EVERY SENTENCE IN §7 IS TRUE AND
> SOURCED; WHAT IS MISSING IS THE OBJECT THEY ARE ALL SENTENCES *ABOUT*.**

**Citation discipline cannot catch this.** A cite-checker confirms each `[source]` resolves — **and
five citations to `tp_ladder.*` resolve perfectly while the parent `tp_ladder.labels` goes
unmentioned.** ⇒ **the `[source]`-resolution guard I ordered in ALGO-133 §4 would have passed this
section, and so would the path guard.**

**ORDERED into the method section:** **when a document cites `X.a`, `X.b`, `X.c`, it must state what
`X` is.** A transcription that quotes only a structure's leaves silently asserts the structure has
none — **and the reader most likely to notice is the one who drew it.**

## 4. AND IT IS THE THIRD TAUGHT-BUT-UNBUILT CLAUSE, WITH A NEW WRINKLE

`avoid_chart_clutter` (ALGO-122A) · the TP ladder (ALGO-145) · **and now: the ladder is also missing
from `spec.json`, the file the code actually loads.** ⇒ **it is not merely unbuilt — it never reached
the machine-readable spec at all**, so no loader, guard or test could ever have missed it, because
there was nothing there to miss.

**Three in one day. None found by a guard. Two found by him.** ⇒ **ALGO-117 §4(a)'s ruled-clause
register is now the highest-value unbuilt instrument in the campaign, and its scope widens: it must
walk the EVIDENCE files against `spec.json` against the code — three surfaces, not two.**

## 5. QUEUE

1. **§7 gets the ladder written into it**, cited to `tp_ladder.labels` /
   `multiple_directional_tps_allowed` / the three screenshots, and **marked `NOT REPRESENTED` until he
   has seen it.** **Transcription only — no rung count, no split, no partial size.**
2. **ALGO-145 §5's derivation lane stands** and is unchanged.
3. **Not authorized:** building the ladder · the `$400` floor · anything else.

---

**LESSON, minted:**

> **HE FOUND IT BY ASKING A FOUR-WORD QUESTION ABOUT A DOCUMENT WE WROTE FOR HIM TO CHECK — WHICH IS EXACTLY WHAT THE DOCUMENT IS FOR, AND IT WORKED ON ITS SECOND DAY.**

The specification's value was supposed to be that a wrong line could be crossed out in one pass.
**Its first real catch was not a wrong line — it was a MISSING one, found because the document put
enough on the page for its absence to become visible.** **Nothing else in this campaign made that
absence noticeable: not the guards, not the citations, not two days of asking him questions.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
