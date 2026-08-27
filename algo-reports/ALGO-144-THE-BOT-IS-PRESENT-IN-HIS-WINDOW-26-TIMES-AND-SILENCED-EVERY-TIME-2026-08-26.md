# ALGO-144 — **THE BOT IS NOT ABSENT FROM HIS WINDOW. IT IS PRESENT 26 TIMES AND SILENCED EVERY TIME.** **[VERIFIED HERE at the aggregate keys] `total_decisions_in_window = 26` and `in_window_entries_the_budget_forbids = 26` — IDENTICAL. Every single in-window decision the bot makes is forbidden by a budget already spent before 09:30, on all 14 sessions.** **AND THE AGREEMENT NUMERATOR IS STRUCTURALLY ZERO ON BOTH ITS TERMS:** `agreement_definition = "AGREE + BOTH_DECLINED"` with `bot_entered_in_window_count 0` · `bot_genuinely_declined_in_window_count 0` · `both_declined_count 0` · `bot_unavailable_in_window_count 14`. ⇒ **THE 08:00 AGREEMENT METRIC CANNOT BE NON-ZERO REGARDLESS OF WHAT THE BOT DOES — unreachable by construction, not empirically small.** **The gap is between the window he says he trades and the window his evidence covers, and only he can close it.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `5373d5df`.
**Strategy head `406a629b`.** **PR #38: DRAFT. Nothing built. Nothing authorized.**

---

## 1. VERIFIED HERE — every key read at the artifact

```
total_decisions_in_window                          26
in_window_entries_the_budget_forbids               26     <-- IDENTICAL
sessions_whose_bullet_was_spent_before_the_window  14
bot_unavailable_in_window_count                    14
bot_entered_in_window_count                         0
bot_genuinely_declined_in_window_count              0
both_declined_count                                 0
agreement_definition            "AGREE + BOTH_DECLINED, from _mismatch_class only"
agreement_decided_cases                            0/8
uncensored_case_count                               8
missed_trader_entry_count                           7
bot_traded_at_all_in_the_session_count             14
total_decisions_through_window_end                113
```

> ## **26 IN-WINDOW DECISIONS. 26 FORBIDDEN. THE BOT FINDS SETUPS INSIDE HIS SESSION AND IS BARRED FROM EVERY ONE OF THEM, BECAUSE THE DAY'S SINGLE TRADE WAS SPENT BEFORE THE WINDOW OPENED — ON ALL FOURTEEN SESSIONS.**

**And the numerator is dead on both terms.** `AGREE` needs an in-window bot entry: **0.**
`BOTH_DECLINED` needs a genuine in-window bot decline: **0.** The bot is `unavailable` on **14 of 14**,
which is neither. ⇒ **the worker's statement is exact and stronger than my "structurally blind":
the metric's numerator is UNREACHABLE BY CONSTRUCTION.**

**The denominator is HIS (8 uncensored labels). The numerator is the BOT'S. They are measured in
windows that do not overlap.**

## 2. WHAT THIS IS NOT

**It is not a defect in the one-trade budget.** `maximum_one_strategy_trade_per_session` is **his**,
frozen, and ratified today. **Untouched and untouchable.**

**It is not a defect in the exam.** The exam measures agreement inside the replay window, which is
what it was built to do and what the evidence supports.

**It is not evidence that the 8-of-14 trades are RIGHT.** *"Unscoreable"* is not *"fine"* — the worker
refused that inference explicitly and I ratify the refusal. **Whether those trades are his is his to
judge, and it is precisely the two open questions already with him.**

> ## **IT IS A GAP BETWEEN TWO WINDOWS: HE SAYS HE TRADES 08:00–12:00 (his own reassertion, ALGO-049, prior art ALGO-025 §3, enforced at `v2_2_engine.py:43-44`). HIS RECORDED EVIDENCE BEGINS AT 09:30. THE BOT SPENDS THE DAY'S ONE TRADE IN THE 90 MINUTES HIS EVIDENCE DOES NOT COVER.**

**Neither side is wrong. Nothing in the code or the corpus can close it, because it is a fact about
where his evidence was captured versus where he says he trades.** ⇒ **reserved class.**

## 3. AND IT EXPLAINS THE CAMPAIGN'S SHAPE

**Every fidelity number this campaign has reported at the 08:00 arm was a numerator that could not
move.** ALGO-105's `1/8`, ALGO-124's `0/8` after the band, tonight's `0/8` — **all three were the same
unreachable zero, read three times as a score.**

**And it reframes ALGO-125 §5 precisely.** *"Selection and order are the same operation"* is true, but
the operative consequence is narrower than I wrote it: **the budget is spent early, so the bot's 26
in-window setups — the ones that could be compared to him — are all forbidden.** **The bot is not
choosing badly inside his window. It never gets to choose there at all.**

## 4. RATIFIED — the verification, and the refusal that came with it

**The worker verified my three values against its own artifact before letting my ruling stand on
them**, having refuted four things earlier tonight. **It found the aggregate keys that make the
finding stronger than I stated it, and reported that rather than accepting my weaker version.**

**And its line is the better one:** *"my `DIFFER` was one broken predicate; yours is a metric that has
been reporting `0` for a numerator that was never reachable — same shape, and yours had been running
for weeks."*

> **`IS THIS A MEASURED ABSENCE, OR AN ABSENT MEASUREMENT?` — a broken join predicate and an
> unreachable numerator are the same defect at two scales, and both report as a result.**

## 5. QUEUE — nothing, and both open items are his

1. **The ALGO-142 question:** under `$400`, price has NOT worked through the near reaction — **stand
   down, or take the next one?** His corpus answers both ways.
2. **§2's gap:** the bot spends the day's trade in a window his evidence does not cover. **Only he can
   say whether that is what he does.**
3. **Not authorized:** the budget · the `$400` floor · `target_policy.py:115` ·
   `PROCESSED_REACTION_REASONS` · the anchor · the rank · a time filter (rail 11) · the overlap thread.
   **And no 08:00-arm agreement number may be cited as fidelity evidence by anyone, ever again.**

---

**LESSON, minted:**

> **WE SPENT WEEKS IMPROVING A NUMBER WHOSE NUMERATOR WAS ZERO BY CONSTRUCTION. EVERY REPAIR WAS SCORED AGAINST IT, TWO WERE REVERTED ON IT, AND IT COULD NOT HAVE MOVED FOR ANY OF THEM.**

The metric was not broken and the code was not broken. **The two were measured over windows that do
not intersect, and nothing in either object records that fact** — the exam reports `0/8` with no field
saying *"the subject was never present."* **A composite metric should assert its own numerator is
reachable before it reports a value, and none of ours does.**

**Ask of any score before optimising against it: what would the best possible system score here, and
have I checked that it is not zero?**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
