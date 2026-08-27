# ALGO-140 — **HIS SETUP IS THE FIRST THING TO SURVIVE RANKING ON 10 OF 14 SESSIONS. NOT LAST — FIRST.** **[VERIFIED HERE at both artifacts, from runs at both pins, no pinned file read]** pre-band `a355507d`: **`REV` 10 · `BRK5` 4**. Re-landed: **`REV` 9 · `BRK5` 5**. Ten of those rejections survive ranking between **08:02 and 08:22.** ⇒ **His setup is not losing a race and is not arriving late. It arrives FIRST on most sessions and is discarded somewhere AFTER ranking.** **THIS REFUTES MY ALGO-137 §4 BRANCH 1 AND THE WORKER'S OWN "arrival order is the whole answer" — which it retracted itself, against its own prior message.** **And it reports the band at 10 → 9 against its own re-land: slightly worse, stated plainly.** **THE LAYER IS LOCATED. THE CAUSE IS NOT, AND NAMING IT NOW WOULD BE THE GATE-LABEL ERROR ONE LEVEL UP.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `ca63f431`.
**Strategy head `39bd2d47`.** **PR #38: DRAFT. No repair ordered. Nothing touched.**

---

## 1. VERIFIED HERE — I opened both artifacts and counted

`..._algo138_live_first_survivor_PREBAND_a355507d.json` · `..._algo138_live_first_survivor_RELAND.json`
— **`evidence_grade: ARTIFACT-SOURCED from the X-ray`, in the artifacts.**

| pin | first to survive ranking |
|---|---|
| **pre-band `a355507d`** | **`REV` 10 · `BRK5` 4** |
| **re-landed** | **`REV` 9 · `BRK5` 5** |

**Pre-band, the ten `REV` first-survivor clocks:** `08:02 · 08:04 · 08:07 · 08:07 · 08:12 · 08:12 ·
08:17 · 08:17 · 08:19 · 08:22`. **The four `BRK5`:** `08:14 · 08:17 · 09:37 · 09:38`.

**These are runs at both pins. No pinned capture was read.** ⇒ **the earlier *"5/5 BRK5 at identical
clocks"* is unrepresentative of BOTH pins — neither reproduces it — and the worker said so against its
own report.**

## 2. THE FINDING, AND ITS LAYER

**[worker's measurement, scoped as it scoped it: joined to the 08-21 scorecard's
`session_first_entry_time`, at the PRE-BAND pin only — the re-land gaps were NOT computed and are
NOT implied]**

| first to survive ranking | sessions | gap to the session's actual entry |
|---|---|---|
| **a BREAK** | 4 | **3 of 4 have a ZERO-minute gap — it survives and it IS the trade** |
| **a REJECTION** | 10 | **0 of 8 measurable have a zero gap** — `+8 · +30 · +45 · +60 · +66 · +71 · +85 · +139` min |
| **a REJECTION, and nothing was ever entered** | **2** | `03-30` survived 08:07 · `03-31` survived 08:02 — **NO ENTRY ALL SESSION** |

> ## **A BREAK THAT SURVIVES RANKING BECOMES THE TRADE. A REJECTION THAT SURVIVES RANKING DOES NOT.**

⇒ **The mechanism is located to the layer BETWEEN `SURVIVED_TO_RANKING` AND THE RECORDED ENTRY.** And
the two `08:02` / `08:29` rows from ALGO-139 §2 stop being anomalies needing a stale-pin story —
**they are the normal case.**

## 3. TWO REFUTATIONS, AND ONE OF THEM IS THE WORKER'S OWN

**ALGO-137 §4 branch 1 — mine — is refuted.** I wrote that if his setup was not yet available the
answer was arrival order and no clause repaired it. **It is available, it is first, and a clause
does reach it.**

**And the worker retracted its own line from two messages earlier** — *"the trade is simply the first
route that qualifies in time… break routes qualify earlier"* — **which I had ratified into ALGO-137
§4 as the route.** It refuted the thing I had just adopted from it, against its own prior message,
**in the same message that delivered the measurement.**

> **A SEAT THAT RETRACTS ITS OWN ADOPTED HYPOTHESIS IN THE MESSAGE THAT DELIVERS THE DATA IS WORTH
> MORE THAN ONE THAT IS RIGHT MORE OFTEN.** Three of tonight's four collapses were caught this way
> **before publication**, and the fourth — mine — reached the operator because I published first.

## 4. THE BAND: 10 → 9 — reported against its own author's work, and NOT read as a verdict

**Three sessions changed:** `03-26` REV→BRK5 · `04-13` REV→BRK5 · `04-09` BRK5→REV. **Net −1.**

**I am not calling this a verdict on the band and neither should anyone else.** `n = 14`, three
sessions moved, **two one way and one the other.** **A net of one session on a fourteen-session sample
is not a direction** — and ALGO-125 §8 already ruled that this class of change cannot be dispositioned
on a scoreboard that small. **It is reported because it is against the reporter's own re-land, which
is exactly when a number is most likely to be softened.**

## 5. 🛑 THE CAUSE IS NOT NAMED, AND THE REASON IS PRECISE

The worker declined to name it: *"naming it now would be the gate-label error one level up — pointing
at a layer instead of a literal, on a majority read."* **Ratified, and it is the sharpest application
of `[gate-label-not-subreason]` this campaign has produced** — the law was minted about a *label*
standing in for a *sub-reason*; **this extends it to a LAYER standing in for a GATE.**

**ALGO-139 §3's order is unchanged and is now the whole job:** emitter's reason field, not the gate
label · **deepest gate BY KEY, never by majority** · **G-forced-TRUE ceiling** · residual branch.
**ALGO-138's 140 `REJECTION_STORY_INCOMPLETE` / exactly-one `FORCE_NOT_CONFIRMED`-per-session stands
as reported and is still not the cause.**

**SCOPE, stated so nobody overreads §2:** `SURVIVED_TO_RANKING` is the X-ray's view and ALGO-096's
evaluation-order difference bounds it. **The gap column is honest against the pre-band pin and the
08-21 scorecard, and against nothing else.**

## 6. QUEUE

1. **Item 2, and it is now the entire remaining job:** what discards a rejection between ranking and
   entry. **Emitter reasons by key, deepest gate by key, G-forced-TRUE ceiling, residual branch.**
2. **Not authorized:** any repair · the anchor · the rank · a time filter · the overlap thread · **and
   no conclusion about the band from §4.**

---

**LESSON, minted:**

> **FOR A WEEK THIS CAMPAIGN ASKED WHY HIS SETUP NEVER WINS, AND THE ANSWER IS THAT IT USUALLY WINS AND IS THEN THROWN AWAY. EVERY REPAIR WE BUILT — THE BAND, THE RANK, THE MAP — WAS AIMED AT HELPING IT ARRIVE, AND IT WAS ALREADY ARRIVING FIRST ON TEN OF FOURTEEN.**

The question shape did the damage: *"why does the break win?"* presumes a contest at the front, so
every instrument was pointed there. **Nobody measured what happens to a candidate AFTER it wins** —
because winning was assumed to be the end of the story. **Ask, of any pipeline: what is the last stage
I have actually observed, and what have I assumed about everything downstream of it?**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
