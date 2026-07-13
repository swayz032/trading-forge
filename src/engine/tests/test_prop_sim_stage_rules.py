from src.engine.prop_sim import simulate_prop_firm


def _daily_records(*pnls: float) -> list[dict]:
    return [
        {"date": f"2026-01-{index + 2:02d}", "pnl": pnl}
        for index, pnl in enumerate(pnls)
    ]


def test_topstep_freezes_combine_window_before_funded_payout_days():
    result = simulate_prop_firm(
        _daily_records(1500, 1500, 2000, 150, 150, 150, 150, 150),
        [],
        "topstep_50k",
    )

    assert result["passed"] is True
    assert result["eval_phase_result"] == {
        "profit_target": 3000,
        "effective_profit_target": 3000.0,
        "best_day_profit": 1500.0,
        "days_to_target": 2,
        "passed": True,
        "reason": "eligible",
        "cost_of_eval": 49,
    }
    assert result["funded_phase_result"]["monthly_net_pnl"] == [2750.0]
    assert result["funded_phase_result"]["payout_eligibility"]["eligible"] is True


def test_topstep_payout_delay_does_not_fail_a_passed_account():
    result = simulate_prop_firm(
        _daily_records(1500, 1500, 500),
        [],
        "topstep_50k",
    )

    assert result["eval_passed"] is True
    assert result["passed"] is True
    payout = result["funded_phase_result"]["payout_eligibility"]
    assert payout["eligible"] is False
    assert payout["reason"] == "minimum_winning_days_not_met"
    assert payout["recoverable"] is True
    assert payout["account_balance"] == 500.0
    assert result["payout_projection"] == 0


def test_mffu_builder_payout_is_funded_only_and_recoverable():
    result = simulate_prop_firm(
        _daily_records(3000, 1300, 1300),
        [
            {"Entry Timestamp": "2026-01-03T10:00:00"},
            {"Entry Timestamp": "2026-01-04T10:00:00"},
        ],
        "mffu_50k",
    )

    assert result["eval_phase_result"]["passed"] is True
    assert result["funded_phase_result"]["monthly_net_pnl"] == [2600.0]
    assert result["funded_phase_result"]["payout_eligibility"]["eligible"] is True
    assert result["funded_phase_result"]["payout_eligibility"]["permitted_request_max"] == 500.0
    assert result["payout_projection"] == 400.0
    assert result["passed"] is True


def test_funded_ledger_resets_after_topstep_combine_pass():
    result = simulate_prop_firm(
        _daily_records(1500, 1500, -1000, -1000),
        [],
        "topstep_50k",
    )

    assert result["eval_passed"] is True
    assert result["days_to_pass_eval"] == 2
    assert result["funded_starting_balance"] == 0.0
    assert result["daily_account_statement"][2]["stage"] == "funded"
    assert result["daily_account_statement"][2]["balance"] == -1000.0
    assert result["trailing_dd_breached"] is True
    assert result["passed"] is False


def test_mffu_funded_lock_is_100_above_the_zero_pnl_start() -> None:
    result = simulate_prop_firm(
        _daily_records(3000, 2100, -2050),
        [],
        "mffu_50k",
    )

    assert result["eval_passed"] is True
    assert result["daily_account_statement"][-1]["stage"] == "funded"
    assert result["daily_account_statement"][-1]["balance"] == 50.0
    assert result["trailing_dd_breached"] is True


def test_payout_projection_uses_one_permitted_topstep_request_not_total_profit() -> None:
    result = simulate_prop_firm(
        _daily_records(1500, 1500, 1000, 1000, 1000, 1000, 1000),
        [],
        "topstep_50k",
    )

    payout = result["funded_phase_result"]["payout_eligibility"]
    assert payout["eligible"] is True
    assert payout["permitted_request_max"] == 2000.0
    assert result["payout_projection"] == 1800.0
    assert result["payout_projection_monthly"] is None
