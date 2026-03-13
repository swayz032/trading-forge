"""Crisis stress testing engine — re-runs strategies against historical crises.

Degrades market conditions (3x spreads, 50% fill rates, 2x slippage) and
checks if any scenario breaches prop firm drawdown limits.

Usage:
    python -m src.engine.stress_test --config '{"backtest_id":"...","strategy":{...}}'
"""

from __future__ import annotations

import json
import sys
import time
from typing import Optional

import polars as pl

from src.engine.config import (
    BacktestRequest,
    CrisisScenario,
    StressTestRequest,
)


def get_default_scenarios() -> list[CrisisScenario]:
    """Return all 8 historical crisis scenarios with stress parameters."""
    return [
        CrisisScenario(
            name="2008 Financial Crisis",
            start_date="2008-09-01",
            end_date="2008-12-31",
            spread_multiplier=3.0,
            fill_rate=0.50,
            slippage_multiplier=2.0,
        ),
        CrisisScenario(
            name="2010 Flash Crash",
            start_date="2010-04-15",
            end_date="2010-06-15",
            spread_multiplier=3.0,
            fill_rate=0.50,
            slippage_multiplier=2.0,
        ),
        CrisisScenario(
            name="2015 China Devaluation",
            start_date="2015-08-01",
            end_date="2015-09-30",
            spread_multiplier=3.0,
            fill_rate=0.50,
            slippage_multiplier=2.0,
        ),
        CrisisScenario(
            name="2018 Volmageddon",
            start_date="2018-01-15",
            end_date="2018-03-31",
            spread_multiplier=3.0,
            fill_rate=0.50,
            slippage_multiplier=2.0,
        ),
        CrisisScenario(
            name="COVID Crash",
            start_date="2020-02-01",
            end_date="2020-04-30",
            spread_multiplier=3.0,
            fill_rate=0.50,
            slippage_multiplier=2.0,
        ),
        CrisisScenario(
            name="Meme/Archegos 2021",
            start_date="2021-01-15",
            end_date="2021-04-15",
            spread_multiplier=3.0,
            fill_rate=0.50,
            slippage_multiplier=2.0,
        ),
        CrisisScenario(
            name="2022 Rate Shock",
            start_date="2022-06-01",
            end_date="2022-10-31",
            spread_multiplier=3.0,
            fill_rate=0.50,
            slippage_multiplier=2.0,
        ),
        CrisisScenario(
            name="2023 SVB Crisis",
            start_date="2023-03-01",
            end_date="2023-04-15",
            spread_multiplier=3.0,
            fill_rate=0.50,
            slippage_multiplier=2.0,
        ),
    ]


def _run_crisis_backtest(
    strategy_config: dict,
    scenario: CrisisScenario,
    data: Optional[pl.DataFrame] = None,
) -> dict:
    """Run a single backtest with degraded crisis conditions.

    Modifies slippage and uses the scenario's fill_rate for reduced fills.
    """
    try:
        from src.engine.backtester import run_backtest
        from src.engine.config import BacktestRequest

        # Build a modified backtest request with crisis parameters
        request = BacktestRequest(
            strategy=strategy_config,
            start_date=scenario.start_date,
            end_date=scenario.end_date,
            slippage_ticks=1.0 * scenario.slippage_multiplier,
            commission_per_side=4.50,
            mode="single",
        )

        result = run_backtest(request, data=data, fill_rate=scenario.fill_rate)
        return {
            "name": scenario.name,
            "passed": True,  # Will be checked against DD limit later
            "max_drawdown": result.get("max_drawdown", 0),
            "total_return": result.get("total_return", 0),
            "sharpe_ratio": result.get("sharpe_ratio", 0),
            "total_trades": result.get("total_trades", 0),
        }
    except Exception as e:
        # If backtest fails (e.g., missing deps, no data), mark as error
        return {
            "name": scenario.name,
            "passed": False,
            "max_drawdown": 0,
            "total_return": 0,
            "sharpe_ratio": 0,
            "total_trades": 0,
            "error": str(e),
        }


def run_stress_test(
    request: StressTestRequest,
    data_override: Optional[pl.DataFrame] = None,
) -> dict:
    """Run strategy against all crisis scenarios.

    Args:
        request: Stress test configuration
        data_override: If provided, use this data for all scenarios
            (useful for testing without S3 access)

    Returns:
        Dict with passed, scenarios, failed_scenarios, execution_time_ms
    """
    start_time = time.perf_counter()

    scenarios = request.scenarios if request.scenarios else get_default_scenarios()

    scenario_results = []
    failed_scenarios = []

    for scenario in scenarios:
        result = _run_crisis_backtest(
            request.strategy,
            scenario,
            data=data_override,
        )

        # Hard rule: drawdown > prop firm max → FAIL
        if result["max_drawdown"] > request.prop_firm_max_dd:
            result["passed"] = False
            failed_scenarios.append(scenario.name)
        elif "error" in result:
            failed_scenarios.append(scenario.name)

        scenario_results.append(result)

    elapsed_ms = int((time.perf_counter() - start_time) * 1000)

    return {
        "passed": len(failed_scenarios) == 0,
        "scenarios": scenario_results,
        "failed_scenarios": failed_scenarios,
        "execution_time_ms": elapsed_ms,
    }


# ─── CLI Entry Point ─────────────────────────────────────────────

def main():
    """CLI: python -m src.engine.stress_test --config <json>"""
    import argparse
    import os

    parser = argparse.ArgumentParser(description="Crisis Stress Test Engine")
    parser.add_argument("--config", required=True, help="JSON config string or file path")
    parser.add_argument("--stress-id", default=None, help="Stress test run ID")
    args = parser.parse_args()

    config_input = args.config
    if os.path.isfile(config_input):
        with open(config_input) as f:
            config = json.load(f)
    else:
        config = json.loads(config_input)

    from src.engine.config import StrategyConfig

    request = StressTestRequest(
        backtest_id=config.get("backtest_id", "cli"),
        strategy=StrategyConfig(**config["strategy"]),
        prop_firm_max_dd=config.get("prop_firm_max_dd", 2000.0),
    )

    result = run_stress_test(request)

    if args.stress_id:
        result["stress_id"] = args.stress_id

    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
