# ALGO-156 — **OPERATOR: *"DO YOU THINK THE 14 REPLAYS ARE CAUSING ALL THESE PROBLEMS."* ANSWER: THEY CAUSED EVERY MEASUREMENT PROBLEM AND NONE OF THE CODE PROBLEMS — AND HE HAS BEEN SAYING SO SINCE 2026-08-24.** **The replays are 14 sessions of which 6 are RIGHT-CENSORED — they record NO decision at all — leaving 8. Their window is 09:30–12:00. He trades 08:00–12:00. The bot's one bullet is spent before 09:30 on 14 of 14.** ⇒ **the agreement metric built on them has a numerator that is UNREACHABLE BY CONSTRUCTION, and this campaign optimised against it for weeks and REVERTED TWO REPAIRS ON IT.** **🛑 BUT THE MAP FINDING DOES NOT DEPEND ON THEM: `37 a session` is the BOT's own output, and `95.1% / 97.0% unmatched` survives even if his real chart carries five times the levels the replays recorded.** **His own standing instruction — *"labels are DAY-LEVEL scoring refs, not ground truth"* — was correct, and the campaign used them as a scoreboard anyway.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `07570ddb`.
**PR #38: DRAFT. Nothing built.**

---

## 1. WHAT THE REPLAYS ARE, MEASURED

| | |
|---|---|
| sessions | **14** |
| **right-censored — NO trader decision recorded** | **6** (`TRADER_ENDED_PRESENTED_REPLAY_STILL_WAITING`) |
| decided | **8** |
| his marked levels, all 14 sessions | **28 — about 2 a session** |
| replay window | **09:30–12:00** |
| his stated trading window | **08:00–12:00** (his own reassertion, ALGO-049) |
| sessions where the bullet is spent before the window | **14 of 14** |
| `bot_entered_in_window` / `bot_genuinely_declined_in_window` | **0 / 0** |

## 2. WHAT THEY CAUSED — and it is most of the last two weeks

> ## **AN AGREEMENT METRIC WHOSE DENOMINATOR IS HIS 8 UNCENSORED LABELS AND WHOSE NUMERATOR REQUIRES AN IN-WINDOW BOT DECISION THERE ARE NONE OF. IT CANNOT BE NON-ZERO REGARDLESS OF WHAT THE BOT DOES.**

- **ALGO-105's `1/8`, ALGO-124's `0/8`, ALGO-143's `0/8` — the same unreachable zero, read three times as a score.**
- **TWO REPAIRS WERE REVERTED ON IT**, including the band shape he has since confirmed is his.
- **Every "fidelity" number at the 08:00 arm was a measurement of an empty set** reporting `0` instead of `UNDEFINED`.
- **And the four-story collapse of 2026-08-26** — the rank, arrival order, a lookahead, a downstream drop — was a pinned capture read as live, **inside a frame the replays defined.**

**⇒ YES. For every measurement problem this campaign has had, the answer is yes.**

## 3. WHAT THEY DID **NOT** CAUSE — and this is the half that matters now

**None of these touch the replays:**

| finding | source |
|---|---|
| **`avoid_chart_clutter` taught, in `spec.json`, read by NO production code** | code vs spec |
| **`displacement` reading B (`range_expansion`) implemented nowhere** | his gold fixture vs code |
| **0 of 5 exceptional-gate magnitudes cited; the ATR floor inert, 1958/1958** | code vs corpus |
| **`meaningful` hardcoded `True` for the dominant destination family** | code |
| **The bot draws ~37 zones a session** | **the bot's own output** |

🛑 **AND THE HEADLINE SURVIVES A HOSTILE ASSUMPTION.** Suppose the replays under-record his chart
badly and he really marks **10** levels a session rather than 2. **The bot still draws 37, and
`95.1%` / `97.0%` unmatched becomes roughly `73%` / `76%`** — **still hundreds of zones he never
drew, and both paths still over-producing at the same rate.** ⇒ **the map finding is robust to the
replays being wrong by a factor of five.**

**The direction of the error also matters:** thin labels make the bot look WORSE on matching and
**cannot manufacture 480 extra zones.** **The replays can under-state his map. They cannot inflate the
bot's.**

## 4. HE TOLD US THIS ON 2026-08-24

His standing instruction, already in memory: **labels are DAY-LEVEL scoring references, not precision
ground truth** · *"i told you not to take the replays too serious"* · **and he closed replay-marking
questions permanently.** **ALGO-083 voided tick-level label forensics; ALGO-087 voided the
target-vs-marked-TP comparison for exactly this reason.**

> ## **THE CAMPAIGN ACCEPTED THAT THE REPLAYS WERE NOT GROUND TRUTH, THEN BUILT ITS ONLY SCOREBOARD ON THEM ANYWAY — AND SPENT WEEKS DEBUGGING WHY THE SCORE WOULD NOT MOVE.**

**Which is why ALGO-153's overlay worked in one pass:** it uses the same thin labels **to LOCATE, never
to SCORE** — the use he authorised — **and it answered in an afternoon what the scoreboard could not
answer in two weeks.**

## 5. RULED

1. **NO AGREEMENT NUMBER DERIVED FROM THE 08:00 ARM MAY BE CITED AS FIDELITY EVIDENCE.** Restated from
   ALGO-143 and now with its cause named: **the numerator is unreachable, not small.**
2. **The replays remain valid for LOCATION.** Overlays, distance distributions, per-session pictures —
   **anything that puts his marks beside the bot's and lets a human look.**
3. **They are NOT valid as a denominator, a grade, a gate, or a disposition trigger.** ALGO-125 §8 said
   the exam could not judge a reachability change; **§2 says it could not judge anything.**
4. **No new replay is requested and none may be** — collection is closed, and **the fault was never
   the sample size. It was the use.**
5. **Not authorized:** any repair, any threshold, any code.

---

**LESSON, minted:**

> **HE ASKED THE QUESTION TWO WEEKS OF INSTRUMENTS DID NOT: NOT *"WHY IS THE SCORE WRONG"* BUT *"IS THE THING PRODUCING THE SCORE THE PROBLEM."***

Every seat that arrived treated the replays as the fixed point and the bot as the variable. **They were
the only evidence, so they became the standard — and being the only evidence is not the same as being
a standard.** **He told us they were rough references and we heard a caveat instead of a
specification.**

**Ask of any evidence base, before building a metric on it: what is this GOOD for, and did whoever
gave it to me already tell me?**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
