"""
Strategy Compiler — validates DSL and compiles to backtest-ready config.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from pydantic import ValidationError

from .pattern_library import validate_entry_params
from .strategy_schema import StrategyDSL


def validate_dsl(raw: dict) -> tuple[bool, StrategyDSL | None, list[str]]:
    """
    Validate raw dict against StrategyDSL schema.
    Returns (valid, parsed_model_or_None, list_of_errors)
    """
    try:
        model = StrategyDSL(**raw)
    except ValidationError as exc:
        errors = [
            f"{'.'.join(str(loc) for loc in e['loc'])}: {e['msg']}"
            for e in exc.errors()
        ]
        return False, None, errors

    # Additional pattern library validation
    valid, pattern_errors = validate_entry_params(
        model.entry_indicator, model.entry_params
    )
    if not valid:
        return False, None, pattern_errors

    return True, model, []


def compile_to_backtest(dsl: StrategyDSL) -> dict:
    """
    Compile a validated DSL into a backtest-ready config dict
    that can be passed to the vectorbt engine.

    Maps:
    - entry_type + entry_indicator + entry_params -> vectorbt signal config
    - exit_type + exit_params -> vectorbt exit config
    - stop_loss_atr_multiple -> stop config
    - session_filter -> time filter
    - preferred_regime -> regime gate config
    """
    config: dict[str, Any] = {
        "strategy": {
            "name": dsl.name,
            "symbol": dsl.symbol,
            "timeframe": dsl.timeframe.value,
            "indicators": [
                {
                    "type": dsl.entry_indicator,
                    **dsl.entry_params,
                }
            ],
            "entry_long": dsl.entry_condition if dsl.direction.value in ("long", "both") else "",
            "entry_short": dsl.entry_condition if dsl.direction.value in ("short", "both") else "",
            "exit": _build_exit_rule(dsl),
            "stop_loss": {
                "type": "atr",
                "multiplier": dsl.stop_loss_atr_multiple,
            },
            "position_size": {
                "type": "dynamic_atr",
                "target_risk_dollars": 500,
            },
        },
        "entry_type": dsl.entry_type.value,
        "exit_type": dsl.exit_type.value,
        "exit_params": dsl.exit_params,
        "direction": dsl.direction.value,
    }

    # Take profit
    if dsl.take_profit_atr_multiple is not None:
        config["take_profit"] = {
            "type": "atr_multiple",
            "multiplier": dsl.take_profit_atr_multiple,
        }

    # Max contracts cap
    if dsl.max_contracts is not None:
        config["strategy"]["position_size"]["max_contracts"] = dsl.max_contracts

    # Regime gate
    if dsl.preferred_regime is not None:
        config["regime_gate"] = {
            "enabled": True,
            "preferred_regime": dsl.preferred_regime,
        }

    # Session filter
    if dsl.session_filter is not None:
        config["session_filter"] = {
            "enabled": True,
            "session": dsl.session_filter,
        }

    # Metadata
    config["metadata"] = {
        "schema_version": dsl.schema_version,
        "source": dsl.source,
        "tags": dsl.tags,
    }

    return config


def _build_exit_rule(dsl: StrategyDSL) -> str:
    """Build a human-readable exit rule string from DSL exit config."""
    exit_type = dsl.exit_type.value
    params = dsl.exit_params

    if exit_type == "fixed_target":
        return f"Fixed target at {params.get('target', 'N/A')} points"
    elif exit_type == "trailing_stop":
        return f"Trailing stop at {params.get('trail_atr', params.get('trail_points', 'N/A'))} ATR"
    elif exit_type == "time_exit":
        return f"Time exit after {params.get('bars', params.get('minutes', 'N/A'))} bars"
    elif exit_type == "indicator_signal":
        return f"Exit on indicator signal: {params.get('indicator', 'N/A')}"
    elif exit_type == "atr_multiple":
        return f"Exit at {params.get('multiplier', 'N/A')}x ATR"
    return f"{exit_type} exit"


def diff_strategies(dsl_a: dict, dsl_b: dict) -> dict:
    """
    Compare two strategy DSLs and return structured diff.
    Returns dict with added, removed, changed fields.
    """
    all_keys = set(dsl_a.keys()) | set(dsl_b.keys())
    added: dict[str, Any] = {}
    removed: dict[str, Any] = {}
    changed: dict[str, dict[str, Any]] = {}

    for key in sorted(all_keys):
        in_a = key in dsl_a
        in_b = key in dsl_b

        if in_a and not in_b:
            removed[key] = dsl_a[key]
        elif in_b and not in_a:
            added[key] = dsl_b[key]
        elif dsl_a[key] != dsl_b[key]:
            changed[key] = {"old": dsl_a[key], "new": dsl_b[key]}

    return {"added": added, "removed": removed, "changed": changed}


# ─── CLI entry point for Node subprocess calls ──────────────────────
def _cli_main() -> None:
    """Called when invoked as: python -m src.engine.compiler.compiler --action <action> --input <json>"""
    import argparse
    import os

    parser = argparse.ArgumentParser(description="Strategy Compiler CLI")
    parser.add_argument("--action", required=True, choices=["validate", "compile", "diff"])
    parser.add_argument("--input", help="JSON string input or file path")
    parser.add_argument("--config", help="Alias for --input")
    args = parser.parse_args()

    input_data = args.input or args.config
    if not input_data:
        print(json.dumps({"error": "No input provided"}))
        sys.exit(1)

    try:
        if os.path.isfile(input_data):
            with open(input_data, 'r') as f:
                data = json.load(f)
        else:
            data = json.loads(input_data)
    except Exception as e:
        print(json.dumps({"error": f"Invalid input: {e}"}))
        sys.exit(1)

    if args.action == "validate":
        valid, model, errors = validate_dsl(data)
        result = {
            "valid": valid,
            "errors": errors,
            "compiled": model.model_dump(mode="json") if model else None,
        }
        print(json.dumps(result))

    elif args.action == "compile":
        valid, model, errors = validate_dsl(data)
        if not valid:
            print(json.dumps({"error": "Validation failed", "errors": errors}))
            sys.exit(1)
        backtest_config = compile_to_backtest(model)  # type: ignore[arg-type]
        print(json.dumps(backtest_config))

    elif args.action == "diff":
        if "a" not in data or "b" not in data:
            print(json.dumps({"error": "Diff requires 'a' and 'b' keys"}))
            sys.exit(1)
        result = diff_strategies(data["a"], data["b"])
        print(json.dumps(result))


if __name__ == "__main__":
    _cli_main()
