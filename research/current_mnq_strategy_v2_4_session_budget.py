#!/usr/bin/env python3
"""The trader's one-A+-trade-per-session budget, as ONE named primitive — ALGO-011 §2.

WHY THIS FILE EXISTS, AND THE CLAIM IT RETRACTS.

ALGO-010 (mine) asserted "the bullet mechanism does not exist", on the strength of a grep
across the import closure that found no `one_trade`, `bullet`, `max_trades` or
`already_traded_today` symbol. The grep was correct and the conclusion was wrong. GPT
refuted it from the repository and I reproduced the refutation:

  1. `current_mnq_strategy_v2_4_engine._analysis_run_day()` — `return` sits INSIDE the
     candidate loop, so historical analysis emits at most one fully approved trade per
     session.
  2. `current_mnq_strategy_v2_4_signal.find_first_actionable_signal()` — returns the FIRST
     fully approved actionable signal.
  3. `current_mnq_strategy_v2_4_shadow_runtime.ShadowRuntime` — `_session_consumed()` reads
     prior DECISION events and `step()` returns `DAILY_BULLET_ALREADY_RESOLVED`.

So the rule is REAL and it is enforced three separate implicit ways. The defect is narrower
and more dangerous than absence: **the invariant is distributed, not shared.** Three
independent implementations can drift, and nothing tests them against one contract.

★ THE LESSON, because this is the second absence claim I have published this session:
  A RULE IMPLEMENTED AS CONTROL FLOW HAS NO NAME TO GREP FOR. `return` inside a loop IS the
  budget. Searching for a vocabulary and concluding absence measures the vocabulary.

This module adds NO trading rule. It names one that already governs execution so tests can
bind every path to it.
"""
from __future__ import annotations

# The trader's frozen rule: one A+ trade per session. Not a tunable.
MAX_FULLY_APPROVED_EXECUTED_TRADES_PER_SESSION = 1

# The paths that must honour it, and HOW each one currently does. Each entry is a claim a
# test can check against the source, so drift in any single path goes red.
ENFORCEMENT_SITES = {
    "historical_analysis": {
        "module": "research.current_mnq_strategy_v2_4_engine",
        "symbol": "_analysis_run_day",
        "mechanism": "RETURN_INSIDE_CANDIDATE_LOOP",
        "note": "The first candidate passing entry + target classification returns the "
                "session result; later candidates are never reached.",
    },
    "signal_path": {
        "module": "research.current_mnq_strategy_v2_4_signal",
        "symbol": "find_first_actionable_signal",
        "mechanism": "FIRST_ACTIONABLE_ONLY",
        "note": "Returns the first fully approved actionable signal for the session.",
    },
    "shadow_runtime": {
        "module": "research.current_mnq_strategy_v2_4_shadow_runtime",
        "symbol": "ShadowRuntime._session_consumed",
        "mechanism": "EXPLICIT_JOURNAL_GUARD",
        "note": "Reads prior DECISION events; step() returns DAILY_BULLET_ALREADY_RESOLVED "
                "once the session is consumed. The only site where the budget is explicit.",
    },
}

# The one legitimate way to see past the budget. Research only.
DIAGNOSTIC_OVERRIDE_FLAG = "enumerate_all_candidates"
DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC_ONLY. The candidate X-ray deliberately enumerates candidates the production "
    "budget would never reach — that is its purpose. It MUST NOT change production behaviour, "
    "and no diagnostic enumeration may be cited as evidence that production 'takes both "
    "directions' or that the one-trade rule is absent. ALGO-011 §2."
)


def budget_for_session() -> int:
    """The number of fully approved trades production may execute in one session."""
    return MAX_FULLY_APPROVED_EXECUTED_TRADES_PER_SESSION


def is_diagnostic_enumeration(**kwargs) -> bool:
    """True only when a caller has explicitly asked to see past the budget."""
    return bool(kwargs.get(DIAGNOSTIC_OVERRIDE_FLAG, False))
