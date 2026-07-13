from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Mapping


_RULES_PATH = Path(__file__).resolve().parents[1] / "shared" / "firm-stage-rules.json"


def _load_stage_rules() -> dict[str, Any]:
    with _RULES_PATH.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict) or not isinstance(payload.get("firms"), dict):
        raise ValueError(f"Invalid firm stage rule book: {_RULES_PATH}")
    return payload


FIRM_STAGE_RULES: dict[str, Any] = _load_stage_rules()


def get_firm_rules(firm_key: str) -> Mapping[str, Any]:
    firm = FIRM_STAGE_RULES["firms"].get(firm_key)
    if not isinstance(firm, dict):
        valid = ", ".join(sorted(FIRM_STAGE_RULES["firms"]))
        raise ValueError(f"Unknown firm_key '{firm_key}'. Valid: {valid}.")
    return firm


def get_stage_rules(firm_key: str, stage: str) -> Mapping[str, Any]:
    rules = get_firm_rules(firm_key).get(stage)
    if not isinstance(rules, dict):
        raise ValueError(f"Firm '{firm_key}' has no '{stage}' stage rules.")
    return rules


def topstep_effective_profit_target(best_day_profit: float) -> float:
    evaluation = get_stage_rules("topstep_50k", "evaluation")
    consistency = evaluation["consistency"]
    if not isinstance(consistency, dict) or consistency.get("mode") != "dynamic_profit_target":
        raise ValueError("Topstep evaluation consistency must use dynamic_profit_target.")
    return max(
        float(evaluation["profit_target"]),
        max(float(best_day_profit), 0.0) / float(consistency["ratio"]),
    )


def trailing_drawdown_floor(
    stage_rules: Mapping[str, Any],
    high_water_mark: float,
    starting_balance: float,
) -> float:
    """Return the stage-specific trailing-drawdown floor.

    ``trailing_lock_floor_offset`` is the canonical lock contract. A value of
    zero means lock at the starting balance (Topstep); Builder's value of 100
    means lock at $100 above the stage's starting balance. ``locks_at_start``
    remains a compatibility fallback for rule books produced before schema v3.
    """
    max_drawdown = float(stage_rules["max_drawdown"])
    trailing_floor = float(high_water_mark) - max_drawdown
    lock_offset = stage_rules.get("trailing_lock_floor_offset")
    if lock_offset is None:
        if not stage_rules.get("locks_at_start", False):
            return trailing_floor
        lock_offset = 0.0
    return min(trailing_floor, float(starting_balance) + float(lock_offset))


def evaluate_topstep_combine(daily_pnls: Iterable[float]) -> dict[str, Any]:
    pnl_by_day = [float(pnl) for pnl in daily_pnls]
    evaluation = get_stage_rules("topstep_50k", "evaluation")
    best_day_profit = max([0.0, *pnl_by_day])
    total_profit = sum(pnl_by_day)
    effective_profit_target = topstep_effective_profit_target(best_day_profit)
    trading_days = len(pnl_by_day)

    if trading_days < int(evaluation["min_trading_days"]):
        reason = "minimum_trading_days_not_met"
        passed = False
    elif total_profit < effective_profit_target:
        reason = "effective_profit_target_not_met"
        passed = False
    else:
        reason = "eligible"
        passed = True

    return {
        "passed": passed,
        "reason": reason,
        "recoverable": True,
        "trading_days": trading_days,
        "total_profit": total_profit,
        "best_day_profit": best_day_profit,
        "effective_profit_target": effective_profit_target,
    }


def evaluate_topstep_combine_until_pass(daily_pnls: Iterable[float]) -> dict[str, Any]:
    """Evaluate only the evaluation window ending at the first Combine pass."""
    pnl_by_day = [float(pnl) for pnl in daily_pnls]
    result = evaluate_topstep_combine([])
    for passed_day in range(1, len(pnl_by_day) + 1):
        result = evaluate_topstep_combine(pnl_by_day[:passed_day])
        if result["passed"]:
            return {**result, "passed_day": passed_day}
    return {**result, "passed_day": None}


def _payout_result(
    *,
    eligible: bool,
    reason: str,
    total_profit: float,
    best_day_profit: float,
    qualifying_days: int,
    consistency_ratio: float | None,
    account_state: Mapping[str, Any] | None = None,
    requested_amount: float | None = None,
    permitted_request_max: float | None = None,
    next_account_state: Mapping[str, Any] | None = None,
    eligible_for_live_transition: bool = False,
) -> dict[str, Any]:
    return {
        "eligible": eligible,
        "reason": reason,
        "recoverable": True,
        "total_profit": total_profit,
        "best_day_profit": best_day_profit,
        "qualifying_days": qualifying_days,
        "consistency_ratio": consistency_ratio,
        "account_balance": (
            float(account_state["account_balance"])
            if account_state is not None
            else None
        ),
        "approved_payout_count": (
            int(account_state["approved_payout_count"])
            if account_state is not None
            else None
        ),
        "requested_amount": requested_amount,
        "permitted_request_max": permitted_request_max,
        "next_account_state": dict(next_account_state) if next_account_state else None,
        "eligible_for_live_transition": eligible_for_live_transition,
    }


def _normalize_payout_account_state(
    account_state: Mapping[str, Any] | None,
) -> tuple[dict[str, Any] | None, str | None]:
    """Validate the account/cycle state required for a payout decision.

    Daily P&L alone cannot determine a valid payout: Topstep caps a request by
    current balance, and both firms have rules that reset at an approved payout.
    Returning a reason instead of guessing keeps callers fail-closed.
    """
    if account_state is None:
        return None, "account_state_required"
    if not isinstance(account_state, Mapping):
        return None, "invalid_account_state"

    try:
        account_balance = float(account_state["account_balance"])
        approved_payout_count = int(account_state.get("approved_payout_count", 0))
    except (KeyError, TypeError, ValueError):
        return None, "invalid_account_state"
    if account_balance < 0 or approved_payout_count < 0:
        return None, "invalid_account_state"

    raw_prior_balance = account_state.get("balance_after_last_payout")
    balance_after_last_payout = (
        None if raw_prior_balance is None else float(raw_prior_balance)
    )
    if approved_payout_count > 0 and balance_after_last_payout is None:
        return None, "previous_payout_balance_required"
    if balance_after_last_payout is not None and balance_after_last_payout < 0:
        return None, "invalid_account_state"

    account_stage = str(account_state.get("account_stage", "funded"))
    if account_stage not in {"funded", "live"}:
        return None, "invalid_account_stage"
    raw_cycle_hours = account_state.get("cycle_elapsed_hours")
    cycle_elapsed_hours = (
        None if raw_cycle_hours is None else float(raw_cycle_hours)
    )
    if cycle_elapsed_hours is not None and cycle_elapsed_hours < 0:
        return None, "invalid_account_state"

    return {
        "account_balance": account_balance,
        "balance_after_last_payout": balance_after_last_payout,
        "approved_payout_count": approved_payout_count,
        "account_stage": account_stage,
        "cycle_elapsed_hours": cycle_elapsed_hours,
    }, None


def _next_payout_account_state(
    account_state: Mapping[str, Any],
    requested_amount: float,
) -> dict[str, Any]:
    """Return the post-approval account snapshot; caller resets its P&L window."""
    post_payout_balance = float(account_state["account_balance"]) - requested_amount
    return {
        "account_balance": round(post_payout_balance, 2),
        "balance_after_last_payout": round(post_payout_balance, 2),
        "approved_payout_count": int(account_state["approved_payout_count"]) + 1,
        "account_stage": account_state["account_stage"],
        "cycle_elapsed_hours": 0.0,
    }


def evaluate_payout_eligibility(
    firm_key: str,
    daily_pnls: Iterable[float],
    *,
    payout_path: str | None = None,
    requested_amount: float | None = None,
    traded_days: Iterable[bool] | None = None,
    dll_opted_in: bool = False,
    account_state: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    pnl_by_day = [float(pnl) for pnl in daily_pnls]
    trade_day_flags = list(traded_days) if traded_days is not None else None
    if trade_day_flags is not None and len(trade_day_flags) != len(pnl_by_day):
        raise ValueError("traded_days must have one entry per daily P&L value.")

    total_profit = sum(pnl_by_day)
    best_day_profit = max([0.0, *pnl_by_day])
    consistency_ratio = best_day_profit / total_profit if total_profit > 0 else None
    normalized_state, state_error = _normalize_payout_account_state(account_state)
    if state_error:
        return _payout_result(
            eligible=False,
            reason=state_error,
            total_profit=total_profit,
            best_day_profit=best_day_profit,
            qualifying_days=0,
            consistency_ratio=consistency_ratio,
        )
    assert normalized_state is not None

    if firm_key == "topstep_50k":
        if normalized_state["account_stage"] != "funded":
            return _payout_result(
                eligible=False,
                reason="unsupported_payout_stage",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=0,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=requested_amount,
            )
        payout = get_stage_rules(firm_key, "payout")
        selected_path = payout_path or str(payout["default_path"])
        paths = payout["paths"]
        if not isinstance(paths, dict) or selected_path not in paths:
            raise ValueError(f"Unknown Topstep payout path '{selected_path}'.")
        path = paths[selected_path]
        if not isinstance(path, dict):
            raise ValueError(f"Invalid Topstep payout path '{selected_path}'.")

        cap = path["payout_cap"]
        payout_cap = float(cap["with_dll"] if dll_opted_in else cap["base"])
        balance_cap = float(payout["account_balance_fraction"]) * float(
            normalized_state["account_balance"]
        )
        permitted_request_max = max(0.0, min(payout_cap, balance_cap))
        minimum_request = float(payout["minimum_request"])
        payout_request = None if requested_amount is None else float(requested_amount)
        if payout_request is not None and payout_request < minimum_request:
            return _payout_result(
                eligible=False,
                reason="minimum_payout_not_met",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=0,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        if payout_request is not None and payout_request > payout_cap:
            return _payout_result(
                eligible=False,
                reason="payout_cap_exceeded",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=0,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        if payout_request is not None and payout_request > balance_cap:
            return _payout_result(
                eligible=False,
                reason="payout_balance_cap_exceeded",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=0,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )

        winning_days_required = path.get("minimum_winning_days")
        if winning_days_required is not None:
            qualifying_days = sum(
                pnl >= float(path["minimum_winning_day_profit"])
                for pnl in pnl_by_day
            )
            if qualifying_days < int(winning_days_required):
                return _payout_result(
                    eligible=False,
                    reason="minimum_winning_days_not_met",
                    total_profit=total_profit,
                    best_day_profit=best_day_profit,
                    qualifying_days=qualifying_days,
                    consistency_ratio=consistency_ratio,
                    account_state=normalized_state,
                    requested_amount=payout_request,
                    permitted_request_max=permitted_request_max,
                )
            if (
                path.get("positive_net_profit_since_last_payout_required") is True
                and normalized_state["approved_payout_count"] > 0
                and float(normalized_state["account_balance"])
                <= float(normalized_state["balance_after_last_payout"])
            ):
                return _payout_result(
                    eligible=False,
                    reason="positive_net_profit_since_last_payout_required",
                    total_profit=total_profit,
                    best_day_profit=best_day_profit,
                    qualifying_days=qualifying_days,
                    consistency_ratio=consistency_ratio,
                    account_state=normalized_state,
                    requested_amount=payout_request,
                    permitted_request_max=permitted_request_max,
                )
            if permitted_request_max < minimum_request:
                return _payout_result(
                    eligible=False,
                    reason="payout_balance_cap_below_minimum",
                    total_profit=total_profit,
                    best_day_profit=best_day_profit,
                    qualifying_days=qualifying_days,
                    consistency_ratio=consistency_ratio,
                    account_state=normalized_state,
                    requested_amount=payout_request,
                    permitted_request_max=permitted_request_max,
                )
            return _payout_result(
                eligible=True,
                reason="eligible",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=qualifying_days,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
                next_account_state=(
                    _next_payout_account_state(normalized_state, payout_request)
                    if payout_request is not None
                    else None
                ),
            )

        if trade_day_flags is None:
            return _payout_result(
                eligible=False,
                reason="traded_days_required",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=0,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        qualifying_days = sum(bool(day) for day in trade_day_flags)
        if qualifying_days < int(path["minimum_trading_days"]):
            return _payout_result(
                eligible=False,
                reason="minimum_trading_days_not_met",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=qualifying_days,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        if total_profit <= 0:
            return _payout_result(
                eligible=False,
                reason="positive_net_profit_required",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=qualifying_days,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        if permitted_request_max < minimum_request:
            return _payout_result(
                eligible=False,
                reason="payout_balance_cap_below_minimum",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=qualifying_days,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        if consistency_ratio is not None and consistency_ratio > float(path["maximum_consistency_ratio"]):
            return _payout_result(
                eligible=False,
                reason="consistency_target_not_met",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=qualifying_days,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        return _payout_result(
            eligible=True,
            reason="eligible",
            total_profit=total_profit,
            best_day_profit=best_day_profit,
            qualifying_days=qualifying_days,
            consistency_ratio=consistency_ratio,
            account_state=normalized_state,
            requested_amount=payout_request,
            permitted_request_max=permitted_request_max,
            next_account_state=(
                _next_payout_account_state(normalized_state, payout_request)
                if payout_request is not None
                else None
            ),
        )

    if firm_key == "mffu_50k":
        if normalized_state["account_stage"] != "funded":
            return _payout_result(
                eligible=False,
                reason="unsupported_payout_stage",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=0,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=requested_amount,
            )
        payout = get_stage_rules(firm_key, "payout")
        minimum_request = float(payout["minimum_request"])
        maximum_request = float(payout["maximum_request"])
        payout_request = None if requested_amount is None else float(requested_amount)
        account_balance = float(normalized_state["account_balance"])
        payout_buffer = float(payout["payout_buffer"])
        permitted_request_max = max(
            0.0,
            min(maximum_request, account_balance - payout_buffer),
        )
        cycle_elapsed_hours = normalized_state.get("cycle_elapsed_hours")
        if cycle_elapsed_hours is None:
            return _payout_result(
                eligible=False,
                reason="payout_cycle_time_evidence_required",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=0,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        if cycle_elapsed_hours < float(payout["minimum_hours_since_cycle_start"]):
            return _payout_result(
                eligible=False,
                reason="payout_cycle_wait_not_met",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=0,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        if normalized_state["approved_payout_count"] >= int(payout["sim_payouts_to_live"]):
            return _payout_result(
                eligible=False,
                reason="sim_payout_limit_reached",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=0,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        if trade_day_flags is None:
            return _payout_result(
                eligible=False,
                reason="traded_days_required",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=0,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        qualifying_days = sum(
            pnl > float(payout["qualifying_day_minimum_profit"]) and traded
            for pnl, traded in zip(pnl_by_day, trade_day_flags)
        )
        cycle_profit_from_state = (
            account_balance
            if normalized_state["approved_payout_count"] == 0
            else account_balance - float(normalized_state["balance_after_last_payout"])
        )
        if abs(total_profit - cycle_profit_from_state) > 0.01:
            return _payout_result(
                eligible=False,
                reason="payout_cycle_profit_state_mismatch",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=qualifying_days,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        if account_balance < payout_buffer:
            return _payout_result(
                eligible=False,
                reason="payout_buffer_not_met",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=qualifying_days,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        if normalized_state["approved_payout_count"] == 0:
            first_payout_required_balance = payout_buffer + float(
                payout["first_payout_profit_above_buffer"]
            )
            if account_balance < first_payout_required_balance:
                return _payout_result(
                    eligible=False,
                    reason="first_payout_profit_requirement_not_met",
                    total_profit=total_profit,
                    best_day_profit=best_day_profit,
                    qualifying_days=qualifying_days,
                    consistency_ratio=consistency_ratio,
                    account_state=normalized_state,
                    requested_amount=payout_request,
                    permitted_request_max=permitted_request_max,
                )
        else:
            profit_since_last_payout = account_balance - float(
                normalized_state["balance_after_last_payout"]
            )
            if profit_since_last_payout < float(
                payout["subsequent_payout_minimum_profit_since_last_payout"]
            ):
                return _payout_result(
                    eligible=False,
                    reason="subsequent_payout_profit_requirement_not_met",
                    total_profit=total_profit,
                    best_day_profit=best_day_profit,
                    qualifying_days=qualifying_days,
                    consistency_ratio=consistency_ratio,
                    account_state=normalized_state,
                    requested_amount=payout_request,
                    permitted_request_max=permitted_request_max,
                )
        if payout_request is not None and payout_request < minimum_request:
            return _payout_result(
                eligible=False,
                reason="minimum_payout_not_met",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=qualifying_days,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        if payout_request is not None and payout_request > maximum_request:
            return _payout_result(
                eligible=False,
                reason="payout_cap_exceeded",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=qualifying_days,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        if (
            payout.get("payout_buffer_must_remain_after_request") is True
            and payout_request is not None
            and payout_request > permitted_request_max
        ):
            return _payout_result(
                eligible=False,
                reason="payout_buffer_must_remain_after_request",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=qualifying_days,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        if qualifying_days < int(payout["minimum_qualifying_days"]):
            return _payout_result(
                eligible=False,
                reason="minimum_qualifying_days_not_met",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=qualifying_days,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        if consistency_ratio is not None and consistency_ratio > float(payout["maximum_consistency_ratio"]):
            return _payout_result(
                eligible=False,
                reason="consistency_target_not_met",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=qualifying_days,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        if permitted_request_max < minimum_request:
            return _payout_result(
                eligible=False,
                reason="payout_buffer_must_remain_after_request",
                total_profit=total_profit,
                best_day_profit=best_day_profit,
                qualifying_days=qualifying_days,
                consistency_ratio=consistency_ratio,
                account_state=normalized_state,
                requested_amount=payout_request,
                permitted_request_max=permitted_request_max,
            )
        return _payout_result(
            eligible=True,
            reason="eligible",
            total_profit=total_profit,
            best_day_profit=best_day_profit,
            qualifying_days=qualifying_days,
            consistency_ratio=consistency_ratio,
            account_state=normalized_state,
            requested_amount=payout_request,
            permitted_request_max=permitted_request_max,
            next_account_state=(
                _next_payout_account_state(normalized_state, payout_request)
                if payout_request is not None
                else None
            ),
            eligible_for_live_transition=(
                int(normalized_state["approved_payout_count"]) + 1
                >= int(payout["sim_payouts_to_live"])
            ),
        )

    raise ValueError(f"Unknown firm_key '{firm_key}'.")
