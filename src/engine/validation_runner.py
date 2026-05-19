"""Validation engine CLI runner — JSON in, JSON out.

Called by the Node.js server via child_process.spawn.
Three modes:
  --mode static    : AST-based code validation against concept spec
  --mode runtime   : Signal DataFrame validation against concept spec
  --mode cross     : Cross-validate a concept (check if spec exists)

Usage:
  python -m src.engine.validation_runner --mode static --config '{"concept":"silver_bullet","source_path":"..."}'
  python -m src.engine.validation_runner --mode cross --config '{"concept":"order_block_scalp"}'
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback


def run_static(config: dict) -> dict:
    """Validate source code against a concept spec."""
    from src.engine.validation import load_spec
    from src.engine.validation.static_validator import validate_static, validate_static_from_code

    concept = config["concept"]
    spec = load_spec(concept)

    if "code" in config:
        result = validate_static_from_code(config["code"], spec)
    elif "source_path" in config:
        result = validate_static(config["source_path"], spec)
    else:
        return {"error": "Either 'code' or 'source_path' required"}

    return {
        "concept": concept,
        "passed": result.passed,
        "errors": result.errors,
        "warnings": result.warnings,
    }


def run_runtime(config: dict) -> dict:
    """Validate strategy signals against a concept spec."""
    import polars as pl
    from src.engine.validation import load_spec
    from src.engine.validation.runtime_validator import validate_runtime

    concept = config["concept"]
    spec = load_spec(concept)

    # Convert bars to DataFrame
    bars = config.get("bars", [])
    if not bars:
        return {"error": "No bars provided for runtime validation"}

    df = pl.DataFrame(bars)
    result = validate_runtime(df, spec)

    return {
        "concept": concept,
        "passed": result.passed,
        "errors": result.errors,
        "warnings": result.warnings,
    }


def run_cross(config: dict) -> dict:
    """Cross-validate a concept — check if spec exists and rules match."""
    from src.engine.validation.cross_validator import cross_validate_concept

    concept = config["concept"]
    proposed_rules = config.get("proposed_rules")

    result = cross_validate_concept(concept, proposed_rules)

    return {
        "concept": result.concept,
        "has_spec": result.has_spec,
        "requires_research": result.requires_research,
        "passed": result.validation_result.passed if result.validation_result else None,
        "errors": result.validation_result.errors if result.validation_result else [],
        "warnings": result.validation_result.warnings if result.validation_result else [],
        "message": result.message,
    }


def run_list_specs(_config: dict) -> dict:
    """List all available concept specs."""
    from src.engine.validation import list_specs
    return {"specs": list_specs()}


def main():
    parser = argparse.ArgumentParser(description="Validation engine runner")
    parser.add_argument("--mode", choices=["static", "runtime", "cross", "list"], required=True)
    parser.add_argument("--config", required=True, help="JSON config string")
    args = parser.parse_args()

    try:
        config_str = args.config
        if os.path.isfile(config_str):
            with open(config_str) as f:
                config_str = f.read()
        config = json.loads(config_str)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON config: {e}"}))
        sys.exit(1)

    try:
        runners = {
            "static": run_static,
            "runtime": run_runtime,
            "cross": run_cross,
            "list": run_list_specs,
        }
        result = runners[args.mode](config)
        print(json.dumps(result))
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
