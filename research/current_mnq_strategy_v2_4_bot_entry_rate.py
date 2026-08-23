#!/usr/bin/env python3
"""The bot took a trade in 14 of 14 sessions. It never declines. DIAGNOSTIC ONLY.

[MEASURED 2026-08-22, from the frozen 14-case scorecard]

    sessions                          14
    BOT entered in                    14      <-- every single one
    BOT declined in                    0
    TRADER entered in                  7
    TRADER did not enter in            7

    trader entered  x bot entered      7
    trader entered  x bot did NOT      0
    trader did NOT  x bot entered      7
    trader did NOT  x bot did NOT      0      <-- NOT ONE SESSION where both stood aside

`bot_state_in_window` takes exactly two values across the whole corpus: ENTER_LONG and
ENTER_SHORT. There is no third.

WHY THIS MATTERS MORE THAN THE AGREEMENT FIGURE.

1.  `missed_trader_entries = 0` IS A TAUTOLOGY, not a measurement. A missed entry requires the
    bot to DECLINE where the trader entered. The bot declines nowhere, so the metric is
    structurally incapable of being nonzero on this corpus. It was published as evidence that
    the bot's failure is "one-sided" -- it is, but not because the bot is good at not missing.
    The same holds for `bot_declined_in_window_count = 0`.

2.  THE HEADLINE MEASURES THE WRONG HALF. "6 of 8 exact agreement" is dominated by DIRECTION,
    because the decision of WHETHER to trade is a constant. Of the 7 sessions where the trader
    entered, the bot agreed on 6 -- so the direction model carries real signal. Of the 7 where
    the trader did NOT enter, the bot entered on all 7 -- so the ENTRY-SELECTION model carries
    NO measured signal at all. It is not weak; it is constant, and a constant cannot be scored.

3.  It composes badly with the one-trade budget. The daily bullet guarantees AT MOST one trade
    per session; the authorization layer, as measured, guarantees AT LEAST one. Together they
    guarantee EXACTLY one trade every session, unconditionally.

WHAT THIS IS NOT. It is not a claim that the bot is unprofitable -- no PnL, realized outcome or
winner/loser label is read here or anywhere in this campaign. It is a claim about SELECTIVITY:
the trader passes on half these days and the machine passes on none of them.

A SELECTION CAVEAT I CANNOT RESOLVE FROM THIS EVIDENCE. These 14 sessions were chosen for
review; they are not a random sample of trading days. That biases what fraction of days a
trader would decline in general. It does NOT touch the finding, because the comparison is
WITHIN the same 14 sessions: on the identical days, the trader declined 7 times and the bot
declined 0.

Run: PYTHONPATH=. python -m research.current_mnq_strategy_v2_4_bot_entry_rate
"""
from __future__ import annotations

import io
import json
from pathlib import Path

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC_ONLY. Counts entry decisions. Reads no PnL, no realized outcome and no "
    "winner/loser label. Selects no strategy rule. ALGO-011."
)

SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")
ENTERED = frozenset({"ENTER_LONG", "ENTER_SHORT"})


def measure(scorecard: Path = SCORECARD) -> dict:
    cases = json.load(io.open(scorecard, encoding="utf-8"))["cases"]

    def t_in(c):
        return c["trader_state"] in ENTERED

    def b_in(c):
        return c["bot_state_in_window"] in ENTERED

    n = len(cases)
    bot_entered = sum(1 for c in cases if b_in(c))
    trader_entered = sum(1 for c in cases if t_in(c))
    cross = {
        "trader_entered_bot_entered": sum(1 for c in cases if t_in(c) and b_in(c)),
        "trader_entered_bot_declined": sum(1 for c in cases if t_in(c) and not b_in(c)),
        "trader_declined_bot_entered": sum(1 for c in cases if not t_in(c) and b_in(c)),
        "trader_declined_bot_declined": sum(1 for c in cases if not t_in(c) and not b_in(c)),
    }
    both_agree_direction = sum(
        1 for c in cases if t_in(c) and b_in(c) and c["trader_state"] == c["bot_state_in_window"])

    return {
        "status": DIAGNOSTIC_ONLY,
        "sessions": n,
        "bot_entered": bot_entered,
        "bot_declined": n - bot_entered,
        "trader_entered": trader_entered,
        "trader_declined": n - trader_entered,
        "distinct_bot_states": sorted({c["bot_state_in_window"] for c in cases}),
        "cross_tab": cross,
        "bot_never_declines": bot_entered == n,
        "missed_trader_entries_is_a_tautology": bot_entered == n,
        "why_tautology": (
            "a missed entry requires the bot to DECLINE where the trader entered. The bot "
            "declines in 0 of %d sessions, so the metric cannot be nonzero on this corpus." % n),
        "direction_agreement_when_both_entered":
            f'{both_agree_direction} of {cross["trader_entered_bot_entered"]}',
        "entry_selection_signal": (
            "NONE MEASURABLE. The bot's decision to trade is a constant across all %d sessions, "
            "and a constant cannot be scored. The published agreement figure is carried entirely "
            "by DIRECTION." % n),
        "composes_with_the_one_trade_budget": (
            "the daily bullet guarantees AT MOST one trade per session; this measurement says "
            "the authorization layer guarantees AT LEAST one. Together: exactly one trade every "
            "session, unconditionally."),
        "selection_caveat": (
            "these 14 sessions were chosen for review and are not a random sample of trading "
            "days. That biases the absolute decline rate but NOT this finding, which compares "
            "the two agents WITHIN the identical 14 sessions."),
    }


def main() -> None:
    m = measure()
    print(f'sessions                 : {m["sessions"]}')
    print(f'BOT entered              : {m["bot_entered"]}   declined {m["bot_declined"]}')
    print(f'TRADER entered           : {m["trader_entered"]}   declined {m["trader_declined"]}')
    print(f'distinct bot states      : {m["distinct_bot_states"]}')
    print()
    for k, v in m["cross_tab"].items():
        print(f'  {k:32} {v}')
    print()
    print(f'bot never declines       : {m["bot_never_declines"]}')
    print(f'direction agreement      : {m["direction_agreement_when_both_entered"]}')
    print(f'missed-entries tautology : {m["missed_trader_entries_is_a_tautology"]}')
    print(f'  {m["why_tautology"]}')


if __name__ == "__main__":
    main()
