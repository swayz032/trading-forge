from __future__ import annotations

from src.engine.firm_stage_rules import (
    evaluate_payout_eligibility,
    evaluate_topstep_combine,
    evaluate_topstep_combine_until_pass,
)


def test_topstep_combine_needs_two_trading_days() -> None:
    one_day = evaluate_topstep_combine([3000.0])

    assert one_day["passed"] is False
    assert one_day["effective_profit_target"] == 6000.0
    assert one_day["reason"] == "minimum_trading_days_not_met"


def test_topstep_combine_passes_after_two_balanced_days() -> None:
    result = evaluate_topstep_combine([1500.0, 1500.0])

    assert result["passed"] is True
    assert result["effective_profit_target"] == 3000.0


def test_topstep_combine_spike_raises_target_without_breaching_account() -> None:
    result = evaluate_topstep_combine([2000.0, 1000.0])

    assert result["passed"] is False
    assert result["effective_profit_target"] == 4000.0
    assert result["reason"] == "effective_profit_target_not_met"
    assert result["recoverable"] is True


def test_topstep_combine_best_day_survives_a_losing_day() -> None:
    result = evaluate_topstep_combine([2000.0, -500.0, 2000.0, 500.0])

    assert result["best_day_profit"] == 2000.0
    assert result["effective_profit_target"] == 4000.0
    assert result["passed"] is True


def test_topstep_combine_freezes_at_the_first_passing_day() -> None:
    result = evaluate_topstep_combine_until_pass([1500.0, 1500.0, 5000.0, -1000.0])

    assert result["passed"] is True
    assert result["passed_day"] == 2
    assert result["best_day_profit"] == 1500.0
    assert result["effective_profit_target"] == 3000.0


def test_topstep_standard_payout_requires_five_150_dollar_winning_days() -> None:
    result = evaluate_payout_eligibility(
        "topstep_50k",
        [150.0, 150.0, 150.0, 150.0, 150.0],
        payout_path="standard",
        account_state={"account_balance": 2500.0},
    )

    assert result["eligible"] is True
    assert result["recoverable"] is True


def test_topstep_standard_first_payout_is_exempt_from_since_last_profit_test() -> None:
    result = evaluate_payout_eligibility(
        "topstep_50k",
        [150.0, 150.0, 150.0, 150.0, 150.0, -1000.0],
        payout_path="standard",
        account_state={"account_balance": 2500.0},
    )

    assert result["eligible"] is True


def test_topstep_standard_subsequent_payout_requires_positive_balance_growth() -> None:
    result = evaluate_payout_eligibility(
        "topstep_50k",
        [150.0, 150.0, 150.0, 150.0, 150.0],
        payout_path="standard",
        account_state={
            "account_balance": 2000.0,
            "balance_after_last_payout": 2000.0,
            "approved_payout_count": 1,
        },
    )

    assert result["eligible"] is False
    assert result["reason"] == "positive_net_profit_since_last_payout_required"


def test_topstep_payout_cap_uses_voluntary_dll_account_context() -> None:
    pnls = [1000.0, 1000.0, 1000.0, 1000.0, 1000.0]
    base = evaluate_payout_eligibility(
        "topstep_50k",
        pnls,
        payout_path="standard",
        requested_amount=3000.0,
        account_state={"account_balance": 8000.0},
    )
    dll_opted_in = evaluate_payout_eligibility(
        "topstep_50k",
        pnls,
        payout_path="standard",
        requested_amount=3000.0,
        dll_opted_in=True,
        account_state={"account_balance": 8000.0},
    )

    assert base["reason"] == "payout_cap_exceeded"
    assert dll_opted_in["eligible"] is True


def test_topstep_consistency_payout_is_recoverable_not_a_breach() -> None:
    result = evaluate_payout_eligibility(
        "topstep_50k",
        [450.0, 300.0, 250.0],
        payout_path="consistency",
        traded_days=[True, True, True],
        account_state={"account_balance": 3000.0},
    )

    assert result["eligible"] is False
    assert result["reason"] == "consistency_target_not_met"
    assert result["recoverable"] is True


def test_topstep_consistency_payout_requires_trade_day_evidence() -> None:
    result = evaluate_payout_eligibility(
        "topstep_50k",
        [100.0, 100.0, 100.0],
        payout_path="consistency",
        account_state={"account_balance": 3000.0},
    )

    assert result["eligible"] is False
    assert result["reason"] == "traded_days_required"


def test_mffu_builder_payout_is_separate_from_evaluation() -> None:
    result = evaluate_payout_eligibility(
        "mffu_50k",
        [1300.0, 1300.0],
        requested_amount=500.0,
        traded_days=[True, True],
        account_state={"account_balance": 2600.0, "cycle_elapsed_hours": 48.0},
    )

    assert result["eligible"] is True
    assert result["recoverable"] is True


def test_mffu_builder_payout_keeps_buffer_after_requested_payout() -> None:
    result = evaluate_payout_eligibility(
        "mffu_50k",
        [1300.0, 1300.0],
        requested_amount=600.0,
        traded_days=[True, True],
        account_state={"account_balance": 2600.0, "cycle_elapsed_hours": 48.0},
    )

    assert result["eligible"] is False
    assert result["reason"] == "payout_buffer_must_remain_after_request"


def test_payout_evaluator_fails_closed_without_account_state() -> None:
    result = evaluate_payout_eligibility(
        "topstep_50k",
        [150.0, 150.0, 150.0, 150.0, 150.0],
        payout_path="standard",
    )

    assert result["eligible"] is False
    assert result["reason"] == "account_state_required"


def test_topstep_request_is_limited_by_half_current_account_balance() -> None:
    result = evaluate_payout_eligibility(
        "topstep_50k",
        [500.0, 500.0, 500.0, 500.0, 500.0],
        payout_path="standard",
        requested_amount=2000.0,
        account_state={"account_balance": 2500.0},
    )

    assert result["eligible"] is False
    assert result["reason"] == "payout_balance_cap_exceeded"
    assert result["permitted_request_max"] == 1250.0


def test_topstep_subsequent_request_uses_account_balance_not_window_profit() -> None:
    result = evaluate_payout_eligibility(
        "topstep_50k",
        [200.0, 200.0, 200.0, 200.0, 200.0],
        payout_path="standard",
        requested_amount=1800.0,
        account_state={
            "account_balance": 4000.0,
            "balance_after_last_payout": 3000.0,
            "approved_payout_count": 1,
            "cycle_elapsed_hours": 48.0,
        },
    )

    assert result["eligible"] is True
    assert result["next_account_state"]["account_balance"] == 2200.0


def test_mffu_subsequent_cycle_uses_since_last_payout_balance() -> None:
    result = evaluate_payout_eligibility(
        "mffu_50k",
        [250.0, 250.0],
        requested_amount=500.0,
        traded_days=[True, True],
        account_state={
            "account_balance": 2600.0,
            "balance_after_last_payout": 2100.0,
            "approved_payout_count": 1,
            "cycle_elapsed_hours": 48.0,
        },
    )

    assert result["eligible"] is True


def test_mffu_rejects_a_cycle_pnl_slice_that_disagrees_with_account_state() -> None:
    result = evaluate_payout_eligibility(
        "mffu_50k",
        [250.0, 250.0],
        requested_amount=500.0,
        traded_days=[True, True],
        account_state={"account_balance": 2600.0, "cycle_elapsed_hours": 48.0},
    )

    assert result["eligible"] is False
    assert result["reason"] == "payout_cycle_profit_state_mismatch"


def test_mffu_fifth_approved_sim_payout_flags_live_transition() -> None:
    result = evaluate_payout_eligibility(
        "mffu_50k",
        [250.0, 250.0],
        requested_amount=500.0,
        traded_days=[True, True],
        account_state={
            "account_balance": 2600.0,
            "balance_after_last_payout": 2100.0,
            "approved_payout_count": 4,
            "cycle_elapsed_hours": 48.0,
        },
    )

    assert result["eligible"] is True
    assert result["eligible_for_live_transition"] is True


def test_mffu_payout_requires_cycle_time_evidence() -> None:
    result = evaluate_payout_eligibility(
        "mffu_50k", [1300.0, 1300.0], traded_days=[True, True],
        account_state={"account_balance": 2600.0},
    )
    assert result["reason"] == "payout_cycle_time_evidence_required"
    assert result["permitted_request_max"] == 500.0


def test_mffu_payout_enforces_48_hour_wait() -> None:
    result = evaluate_payout_eligibility(
        "mffu_50k", [1300.0, 1300.0], traded_days=[True, True],
        account_state={"account_balance": 2600.0, "cycle_elapsed_hours": 47.99},
    )
    assert result["reason"] == "payout_cycle_wait_not_met"
    assert result["permitted_request_max"] == 500.0
