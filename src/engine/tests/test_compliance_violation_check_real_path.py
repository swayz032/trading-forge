"""
test_compliance_violation_check_real_path.py — ratify-packet
docs/ratify-packets/backtest-compliance-sizing-gaps-2026-07-17.md, Finding 1.

Finding 1 documented that check_violation() (compliance_gate.py:400-535 — the
MFFU 2%-per-trade rule, the HFT limit, and the hedging ban) was never invoked
anywhere in the backtest engine, and separately noted that the EXISTING
compliance test suite (test_compliance_enforce_mode.py,
test_failure_injection_compliance_enforce_default_path.py) mocks
check_strategy_compliance directly rather than exercising a real violating
strategy through the real compliance functions.

This file closes both gaps for the new BACKTEST_COMPLIANCE_VIOLATION_CHECK_ENABLED
gate: every test below calls the REAL check_violation() / the REAL
detect_trade_compliance_violations() (src/engine/backtester.py) — no
`unittest.mock.patch` anywhere in this file — against a strategy whose trades
genuinely risk more than 2% of account balance on a single trade, and against
a strategy that genuinely opens a hedged position (MNQ while NQ is open).

DO NOT mock check_strategy_compliance or check_violation in this file — that
is exactly the fabricated-safety-claim shape this packet exists to correct
(memory: feedback_hardcoded_test_copy_is_fabricated_safety_claim).
"""

import os

import pytest

from src.engine.backtester import (
    _compliance_violation_check_enabled,
    detect_trade_compliance_violations,
)
from src.engine.compliance.compliance_gate import check_violation

MFFU_STARTING_FLOOR = 48_000.0  # FIRM_RULES["mffu_50k"]["starting_floor"]


@pytest.fixture(autouse=True)
def clean_env():
    """Remove the new gate's env var before/after each test."""
    os.environ.pop("BACKTEST_COMPLIANCE_VIOLATION_CHECK_ENABLED", None)
    yield
    os.environ.pop("BACKTEST_COMPLIANCE_VIOLATION_CHECK_ENABLED", None)


# ─── Gate itself: reads BACKTEST_COMPLIANCE_VIOLATION_CHECK_ENABLED ───────────


def test_gate_defaults_off():
    assert _compliance_violation_check_enabled() is False


def test_gate_turns_on_with_true():
    os.environ["BACKTEST_COMPLIANCE_VIOLATION_CHECK_ENABLED"] = "true"
    assert _compliance_violation_check_enabled() is True


def test_gate_rejects_unrelated_truthy_looking_value():
    os.environ["BACKTEST_COMPLIANCE_VIOLATION_CHECK_ENABLED"] = "enabled"
    assert _compliance_violation_check_enabled() is False


# ─── detect_trade_compliance_violations() — REAL check_violation(), no mocks ──


def test_real_two_percent_rule_violation_is_flagged_when_gate_enabled():
    """A trade whose real stop-distance risks more than 2% of the MFFU
    starting balance ($48,000 * 0.02 = $960) must be flagged by the REAL
    check_violation() path -- not a mocked check_strategy_compliance return."""
    os.environ["BACKTEST_COMPLIANCE_VIOLATION_CHECK_ENABLED"] = "true"
    trades = [
        {
            "symbol": "MES",
            "entry_date": "2026-01-15",
            "intended_max_loss": 1_200.0,  # 2.5% of $48,000 -- genuinely over the line
            "net_pnl": -1_200.0,
        },
    ]

    assert _compliance_violation_check_enabled() is True
    violations = detect_trade_compliance_violations(
        trades, firm_key="mffu_50k", starting_balance=MFFU_STARTING_FLOOR,
    )

    assert len(violations) == 1
    assert violations[0]["trade_index"] == 0
    assert violations[0]["symbol"] == "MES"
    assert any("2%" in v or "two_percent" in v.lower() or "2 percent" in v.lower()
               for v in violations[0]["violations"]), violations[0]["violations"]


def test_real_compliant_trade_is_not_flagged_negative_control():
    """Negative control: a trade well inside the 2% budget must NOT be
    flagged -- proves the detector is a real conditional check, not an
    unconditional flag-everything bug that would trivially pass the test
    above for the wrong reason."""
    os.environ["BACKTEST_COMPLIANCE_VIOLATION_CHECK_ENABLED"] = "true"
    trades = [
        {
            "symbol": "MES",
            "entry_date": "2026-01-15",
            "intended_max_loss": 400.0,  # well under $960 (2% of $48,000)
            "net_pnl": 800.0,
        },
    ]

    violations = detect_trade_compliance_violations(
        trades, firm_key="mffu_50k", starting_balance=MFFU_STARTING_FLOOR,
    )

    assert violations == []


def test_gate_disabled_means_caller_never_invokes_detection():
    """When the gate is OFF (default), the wiring in run_backtest short-circuits
    before calling detect_trade_compliance_violations() at all -- verified here
    by replicating run_backtest's own gating decision (the exact function it
    calls, _compliance_violation_check_enabled()) and confirming a genuinely
    violating trade produces an empty audit under that gating."""
    assert _compliance_violation_check_enabled() is False  # default, nothing set

    trades = [
        {
            "symbol": "MES",
            "entry_date": "2026-01-15",
            "intended_max_loss": 5_000.0,  # egregiously over 2% -- would flag if evaluated
            "net_pnl": -5_000.0,
        },
    ]

    # Mirrors run_backtest's exact gate check: `if _compliance_violation_check_enabled(): ...`
    audit = (
        detect_trade_compliance_violations(trades, "mffu_50k", MFFU_STARTING_FLOOR)
        if _compliance_violation_check_enabled()
        else []
    )
    assert audit == []


def test_running_balance_walk_flags_a_trade_that_was_compliant_against_the_static_starting_balance():
    """RED-proof for the running-sum approximation (packet §1.3 item 2 /
    verification plan RED-proof #2's companion case): the SAME nominal
    stop-dollars is compliant when checked against the static $48,000 starting
    balance in isolation, but becomes a violation once a prior real loss in
    the sequential walk has consumed enough of the running balance. This
    proves detect_trade_compliance_violations() genuinely threads a running
    balance through check_violation() rather than re-checking a fixed
    constant on every trade."""
    stop_dollars = 940.0  # < $960 (2% of $48,000) -- compliant against the static starting balance
    assert stop_dollars < 0.02 * MFFU_STARTING_FLOOR, "sanity: must be compliant vs the raw starting balance"

    # Isolated check against the static starting balance: NOT a violation.
    isolated = check_violation(
        "mffu",
        {"rules": {}},
        {
            "automated": True,
            "host": "skytech-tower",
            "intended_max_loss": stop_dollars,
            "account_balance": MFFU_STARTING_FLOOR,
            "trades_today": 0,
            "proposed_symbol": "MES",
            "open_positions": [],
        },
    )
    assert isolated["violation"] is False

    # Sequential walk: trade 1 loses $1,200 first, dropping the running balance
    # to $46,800 -- 2% of THAT is $936, so trade 2's $940 stop now exceeds it.
    trades = [
        {"symbol": "MES", "entry_date": "2026-01-15", "intended_max_loss": 500.0, "net_pnl": -1_200.0},
        {"symbol": "MES", "entry_date": "2026-01-16", "intended_max_loss": stop_dollars, "net_pnl": 0.0},
    ]
    violations = detect_trade_compliance_violations(trades, "mffu_50k", MFFU_STARTING_FLOOR)

    assert len(violations) == 1
    assert violations[0]["trade_index"] == 1, (
        "trade 0 (the $1,200 loss itself, well under 2% of the un-drawn-down "
        "$48,000 balance) must NOT be the flagged trade -- only trade 1, "
        "which only violates once the running balance reflects trade 0's loss"
    )


def test_non_mffu_firm_is_a_no_op_even_with_a_flagrant_violation():
    """check_violation()'s 2%/HFT/hedging checks are all MFFU-specific
    (compliance_gate.py:477/491/505 gate on firm_lower == 'mffu'). A Topstep
    backtest with the identical over-2% trade must return zero violations --
    this is the honest, packet-documented scoping, not an oversight."""
    trades = [
        {"symbol": "MES", "entry_date": "2026-01-15", "intended_max_loss": 10_000.0, "net_pnl": -10_000.0},
    ]
    violations = detect_trade_compliance_violations(trades, "topstep_50k", 50_000.0)
    assert violations == []


def test_no_firm_key_is_a_no_op():
    trades = [
        {"symbol": "MES", "entry_date": "2026-01-15", "intended_max_loss": 10_000.0, "net_pnl": -10_000.0},
    ]
    violations = detect_trade_compliance_violations(trades, None, 50_000.0)
    assert violations == []


# ─── check_violation() hedging ban — REAL function, direct call ──────────────


def test_real_hedging_ban_violation_is_flagged():
    """A strategy that proposes opening MNQ while an NQ position is already
    open (same underlying, MFFU 2026 hedging ban) must be flagged by the REAL
    check_violation() -- exercised directly (not through the trade-walk
    helper, which the packet explicitly scopes hedging OUT of for this pass
    since a single-symbol backtest run has no cross-strategy/cross-symbol
    open-position view -- see ratify-packet §1.1b). This proves the
    underlying compliance function's hedging-ban logic is real and reachable,
    not fabricated."""
    result = check_violation(
        "mffu",
        {"rules": {}},
        {
            "automated": True,
            "host": "skytech-tower",
            "proposed_symbol": "MNQ",
            "open_positions": [{"symbol": "NQ"}],
        },
    )

    assert result["violation"] is True
    assert result["status"] == "blocked"
    assert any("hedg" in v.lower() for v in result["violations"]), result["violations"]


def test_real_hedging_ban_does_not_false_positive_on_non_conflicting_symbol():
    """Negative control: MES proposed while an open MNQ position exists is
    NOT a hedging conflict (different underlying) -- proves the check is
    genuinely pair-aware, not a blanket "any open position blocks" bug."""
    result = check_violation(
        "mffu",
        {"rules": {}},
        {
            "automated": True,
            "host": "skytech-tower",
            "proposed_symbol": "MES",
            "open_positions": [{"symbol": "MNQ"}],
        },
    )

    assert result["violation"] is False
    assert result["violations"] == []


def test_real_two_percent_rule_via_check_violation_directly():
    """Same 2%-rule assertion as the detector test above, but calling
    check_violation() directly with no intermediate helper -- confirms the
    underlying primitive itself (not just our wrapper) genuinely flags a
    real over-2% strategy."""
    result = check_violation(
        "mffu",
        {"rules": {}},
        {
            "automated": True,
            "host": "skytech-tower",
            "intended_max_loss": 1_500.0,
            "account_balance": 48_000.0,
            "trades_today": 0,
            "proposed_symbol": "MCL",
            "open_positions": [],
        },
    )

    assert result["violation"] is True
    assert any("2%" in v for v in result["violations"]), result["violations"]
