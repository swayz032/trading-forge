#!/usr/bin/env python3
"""How often the bot stands aside, measured rather than assumed. DIAGNOSTIC ONLY.

★ THE FINDING THIS FILE WAS BUILT AROUND HAS BEEN OVERTAKEN BY A REPAIR, AND THE NUMBERS BELOW
ARE THE OLD KERNEL'S. Its title used to be a verdict — "The bot trades EVERY session, it never
declines" — and that was true of every kernel measured up to 2026-08-23. ALGO-047 then
discharged §9.2 and ordered the derivation layer and the four-route WAIT-by-default state
machine wired in as the kernel's entry authority. Re-measured end-to-end at the 08:00 window
immediately after that wiring:

    bot traded at all in the session        14 -> 13    (it stood aside for a whole session)
    bot GENUINELY DECLINED in-window         0 ->  1     (the constant is no longer constant)
    total decisions through window end      87 -> 45
    in-window entries the budget forbids    24 ->  6
    headline agreement (decided cases)      1/8 -> 1/8   (UNCHANGED)

WHAT THAT DOES AND DOES NOT SHOW. The measured defect this phase existed to kill — an entry
decision that is a CONSTANT and therefore carries no information — is gone: the machine can now
refuse. It does NOT show that it refuses on the right sessions. The headline did not move, and
one case moved to BOT_ONLY_ENTRY_UNCENSORED_DECLINE — the bot taking an in-window trade the
trader really declined — which is not a flattering direction. Whether the brain is FAITHFUL is
the dual-window exam's question under its own pre-registration, not this census's.

The historical measurement is kept verbatim below, because the tautology argument in it is what
made the current numbers meaningful and deleting it would erase the reason they can be trusted.

[MEASURED 2026-08-23 ON THE PRE-WIRING KERNEL, budget-faithful join, after the ALGO-020 F-1
 repair — SUPERSEDED AS A DESCRIPTION OF THE CURRENT KERNEL]

    sessions                                14
    bot traded AT ALL in the session        14      <-- every single one, unconditionally
    bot ENTERED inside the audited window    7
    bot GENUINELY DECLINED in-window         0      <-- not once
    bot UNAVAILABLE in-window                7      <-- bullet already spent pre-window
    trader entered                           7

    trader entered  x bot entered      5     trader declined x bot entered      2
    trader entered  x bot unavailable  2     trader declined x bot unavailable  5
    trader entered  x bot declined     0     trader declined x bot declined     0

THREE BOT STATES, NOT TWO, AND THE THIRD IS THE POINT. `BUDGET_CONSUMED_BEFORE_WINDOW` is NOT
a decline -- the bot traded, just earlier than the window being audited. Conflating it with
"declined" scores a bot trade as agreement and moves the headline 5/8 -> 6/8 in the bot's
favour. I made exactly that mistake while writing the F-1 repair and the census caught it.

WHAT SURVIVES FROM THE REFUTED VERSION, and it is the core finding: the bot takes a trade in
14 of 14 sessions while the trader takes one in 7. It never stands aside. ALGO-020 section 1
item 3 ruled this binding, and the budget-faithful join confirms it at the session level.

WHAT CHANGED, and it sharpens rather than softens:

1.  `missed_trader_entries = 0` IS NO LONGER A TAUTOLOGY -- it was one only because the refuted
    window join credited the bot with entries its own budget forbade. Under the repair the
    metric is reachable and FIRES TWICE on real data (2026-03-23, 2026-04-09).

2.  DIRECTION IS NOT THE PROBLEM. When the bot is actually available in-window and the trader
    trades, it picks the same direction **5 of 5**. The earlier "6 of 7" included 2026-04-09 as
    an opposite-direction error; budget-faithfully the bot was not there at all, so that is a
    MISS, not a wrong call.

3.  SO THE FAILURE IS TIMING AND SELECTIVITY, NOT DIRECTION. The bot fires once a day come what
    may, and in half the sessions it fires before the window the trader was working in. The
    entry-SELECTION model still carries no measurable signal: what varies in-window is only
    whether the single trade had already been spent, which is a clock artifact and not a
    judgement about the setup.

WHAT THIS IS NOT. Not a claim about profitability -- no PnL, realized outcome or winner/loser
label is read here or anywhere in this campaign. It is a claim about SELECTIVITY.

SELECTION CAVEAT I CANNOT RESOLVE: these 14 sessions were chosen for review and are not a
random sample. That biases the absolute decline rate but not this finding, which compares both
agents WITHIN the identical 14 sessions.

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
#: The bot spent its one trade before the window opened. NOT a decline.
UNAVAILABLE = "BUDGET_CONSUMED_BEFORE_WINDOW"


def measure(scorecard: Path = SCORECARD) -> dict:
    cases = json.load(io.open(scorecard, encoding="utf-8"))["cases"]

    def t_in(c):
        return c["trader_state"] in ENTERED

    def b_state(c):
        """THREE states, not two. ALGO-020 F-1: unavailable is not declined."""
        b = c["bot_state_in_window"]
        if b in ENTERED:
            return "ENTERED"
        if b == UNAVAILABLE:
            return "UNAVAILABLE"
        return "DECLINED"

    def traded_at_all(c):
        return ((c.get("budget_faithful") or {}).get("session_first_action") in ENTERED)

    n = len(cases)
    entered = sum(1 for c in cases if b_state(c) == "ENTERED")
    declined = sum(1 for c in cases if b_state(c) == "DECLINED")
    unavailable = sum(1 for c in cases if b_state(c) == "UNAVAILABLE")
    session_traded = sum(1 for c in cases if traded_at_all(c))
    trader_entered = sum(1 for c in cases if t_in(c))

    cross = {}
    for t in (True, False):
        for b in ("ENTERED", "DECLINED", "UNAVAILABLE"):
            key = f'trader_{"entered" if t else "declined"}_bot_{b.lower()}'
            cross[key] = sum(1 for c in cases if t_in(c) == t and b_state(c) == b)

    both_entered = [c for c in cases if t_in(c) and b_state(c) == "ENTERED"]
    same_dir = sum(1 for c in both_entered
                   if c["trader_state"] == c["bot_state_in_window"])

    return {
        "status": DIAGNOSTIC_ONLY,
        "sessions": n,
        "bot_traded_at_all_in_the_session": session_traded,
        "bot_entered_in_window": entered,
        "bot_genuinely_declined_in_window": declined,
        "bot_unavailable_in_window": unavailable,
        "trader_entered": trader_entered,
        "trader_declined": n - trader_entered,
        "distinct_bot_states": sorted({c["bot_state_in_window"] for c in cases}),
        "cross_tab": cross,
        "bot_never_declines": declined == 0,
        "bot_trades_every_session": session_traded == n,
        "missed_trader_entries_is_a_tautology": session_traded == n and unavailable == 0,
        "kernel_entry_authority": (
            "the derivation layer + four-route WAIT-by-default state machine, wired as the "
            "kernel's entry authority by ALGO-047. Before that wiring these same fields "
            "measured a bot that entered in 14 of 14 sessions and declined in 0."),
        "why_tautology": (
            "a missed entry requires the bot to be absent where the trader entered. Under the "
            "REFUTED window join the bot appeared to enter in all %d sessions, so the metric "
            "could not be nonzero. The budget-faithful join makes it reachable: the bullet is "
            "spent pre-window in %d sessions and MISSED_TRADER_ENTRY now fires on real data."
            % (n, unavailable)),
        "direction_agreement_when_both_entered": f"{same_dir} of {len(both_entered)}",
        # DERIVED FROM THE COUNTS, NOT ASSERTED. These two fields used to state
        # "unconditionally" and "AT LEAST one" as flat prose. That was a measured fact about
        # the pre-ALGO-047 kernel which the wiring falsified, and a hard-coded sentence would
        # have gone on asserting it while the numbers beside it disagreed - the exact shape of
        # a report table that outlives its instrument.
        "entry_selection_signal": (
            ("NONE MEASURABLE: the bot trades in all %d sessions, so what varies in-window is "
             "only WHETHER IT HAD ALREADY SPENT the trade - a clock artifact, not a judgement "
             "about the setup." % n) if session_traded == n else
            ("REACHABLE: the bot stands aside in %d of %d sessions and genuinely declines "
             "in-window in %d, so the entry decision is no longer a constant. Whether it "
             "declines on the RIGHT sessions is a fidelity question the exam answers, not "
             "this census." % (n - session_traded, n, declined))),
        "composes_with_the_one_trade_budget": (
            "the daily bullet guarantees AT MOST one trade per session. %s In %d of %d "
            "sessions the trade lands OUTSIDE the audited window." % (
                ("The authorization layer also guarantees AT LEAST one, so: exactly one trade "
                 "every session, unconditionally.") if session_traded == n else
                ("The authorization layer no longer guarantees AT LEAST one: in %d of %d "
                 "sessions no entry was authorized at all." % (n - session_traded, n)),
                unavailable, n)),
        "selection_caveat": (
            "these 14 sessions were chosen for review and are not a random sample of trading "
            "days. That biases the absolute decline rate but NOT this finding, which compares "
            "the two agents WITHIN the identical 14 sessions."),
    }


def main() -> None:
    m = measure()
    print(f'sessions                        : {m["sessions"]}')
    print(f'bot traded at all in the session: {m["bot_traded_at_all_in_the_session"]}')
    print(f'bot ENTERED in-window           : {m["bot_entered_in_window"]}')
    print(f'bot GENUINELY DECLINED in-window: {m["bot_genuinely_declined_in_window"]}')
    print(f'bot UNAVAILABLE in-window       : {m["bot_unavailable_in_window"]}')
    print(f'TRADER entered                  : {m["trader_entered"]}   '
          f'declined {m["trader_declined"]}')
    print(f'distinct bot states             : {m["distinct_bot_states"]}')
    print()
    for k, v in m["cross_tab"].items():
        print(f'  {k:38} {v}')
    print()
    print(f'bot trades every session        : {m["bot_trades_every_session"]}')
    print(f'bot never genuinely declines    : {m["bot_never_declines"]}')
    print(f'direction agreement (both in)   : {m["direction_agreement_when_both_entered"]}')
    print(f'missed-entries still a tautology: {m["missed_trader_entries_is_a_tautology"]}')
    print(f'  {m["why_tautology"]}')


if __name__ == "__main__":
    main()
