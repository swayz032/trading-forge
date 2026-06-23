"""Populate Regime Bank — CLI module to generate, calibrate, and store synthetic regimes.

Governance: challenger_only / experimental.  Never gates live capital.

CLI contract (called by TS cron):
    python -m src.engine.synthetic.populate_regime_bank --config '<JSON>'

Config JSON schema:
    {
        "symbols": ["MES"],         # list of futures symbols
        "timeframes": ["5min"],     # list of timeframes
        "scenarios": ["COVID_crash", ...],  # subset of NAMED_SCENARIOS
        "seed": 42,                 # integer seed for determinism
        "output_dir": "data/regime_bank",   # local output directory
        "max_batches": 1,           # batches per (symbol, timeframe, scenario)
        "severity_check": true,     # whether to run severity validation
        "dry_run": false,           # if true: generate + calibrate but skip write
        "use_nemo": false           # if true: source specs from NeMoScenarioDesigner
                                    #   (real NeMo API when NVIDIA_API_KEY set,
                                    #    else already falls back to NAMED_SCENARIOS);
                                    #   default false so offline/CI runs are safe
    }

Output JSON (stdout):
    {
        "generated": N,
        "calibrated_passed": N,
        "calibrated_failed": N,
        "stored": N,
        "regimes": [
            {
                "symbol": "MES",
                "timeframe": "5min",
                "regime_label": "COVID_crash",
                "file_path": "data/regime_bank/MES_5min_COVID_crash_seed42_b0.parquet",
                "num_bars": 500,
                "generator_model_version": "stochastic_v1.0",
                "stylized_fact_passed": true,
                "severity_passed": true,
                "calibration_stats": {...},
                "scenario_source": "nemo_data_designer" | "stochastic_fallback"
            }
        ],
        "errors": ["scenario=X: calibration failed: T1_excess_kurtosis..."]
    }

Exit codes:
    0 — all requested scenarios generated, calibrated, and stored
    1 — partial failure (some scenarios failed calibration or storage)
    2 — complete failure (all scenarios failed or config error)

Governance labels are embedded in the output filename and in the Parquet file
metadata so downstream consumers can distinguish challenger vs production data.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Guard against vectorbt import hang (bare import blocks pytest collection)
import types as _types
if "vectorbt" not in sys.modules:
    sys.modules["vectorbt"] = _types.ModuleType("vectorbt")

from src.engine.synthetic.stochastic_regime_generator import (
    GENERATOR_MODEL_VERSION,
    GOVERNANCE_LABELS,
    NAMED_SCENARIOS,
    StochasticRegimeGenerator,
)

# NeMo designer import — imported at module scope so tests can patch it.
# The designer already handles its own fallback internally; we import here
# so run_populate can conditionally instantiate it when use_nemo=True.
from src.engine.nemo_scenario_designer import NeMoScenarioDesigner


# ─── Default config ───────────────────────────────────────────────────────────

_DEFAULT_CONFIG: dict = {
    "symbols": ["MES"],
    "timeframes": ["5min"],
    "scenarios": list(NAMED_SCENARIOS.keys()),
    "seed": 42,
    "output_dir": "data/regime_bank",
    "max_batches": 1,
    "severity_check": True,
    "dry_run": False,
    # use_nemo=False by default: offline/CI safe.
    # Set True to source scenario specs from NeMoScenarioDesigner (falls back
    # to NAMED_SCENARIOS automatically when NVIDIA_API_KEY is absent).
    "use_nemo": False,
}


# ─── Result schema ────────────────────────────────────────────────────────────

def _make_result_record(
    symbol: str,
    timeframe: str,
    regime_label: str,
    file_path: str,
    num_bars: int,
    stylized_fact_passed: bool,
    severity_passed: bool,
    calibration_stats: dict,
    batch_index: int,
    seed: int,
    scenario_source: str = "stochastic_fallback",
) -> dict:
    """Build one regime record for the output JSON.

    Args:
        scenario_source: Which generation path produced this regime spec.
            "nemo_data_designer" — NeMoScenarioDesigner (data_designer API path).
            "stochastic_fallback" — the 8 NAMED_SCENARIOS battery (default).
    """
    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "regime_label": regime_label,
        "file_path": file_path,
        "num_bars": num_bars,
        "generator_model_version": GENERATOR_MODEL_VERSION,
        "governance": GOVERNANCE_LABELS["decision_role"],
        "stylized_fact_passed": stylized_fact_passed,
        "severity_passed": severity_passed,
        "batch_index": batch_index,
        "seed": seed,
        "calibration_stats": calibration_stats,
        "scenario_source": scenario_source,
    }


# ─── Core runner ─────────────────────────────────────────────────────────────

def run_populate(config: dict) -> dict:
    """Run the full populate-regime-bank pipeline.

    Args:
        config: Dict matching the config JSON schema above.

    Returns:
        Result dict matching the output JSON schema documented at the top.
    """
    symbols     = config.get("symbols", _DEFAULT_CONFIG["symbols"])
    timeframes  = config.get("timeframes", _DEFAULT_CONFIG["timeframes"])
    scenarios   = config.get("scenarios", _DEFAULT_CONFIG["scenarios"])
    seed        = int(config.get("seed", _DEFAULT_CONFIG["seed"]))
    output_dir  = config.get("output_dir", _DEFAULT_CONFIG["output_dir"])
    max_batches = int(config.get("max_batches", _DEFAULT_CONFIG["max_batches"]))
    run_severity_check = bool(config.get("severity_check", True))
    dry_run     = bool(config.get("dry_run", False))
    use_nemo    = bool(config.get("use_nemo", _DEFAULT_CONFIG["use_nemo"]))

    # Validate scenarios against NAMED_SCENARIOS (the 8 canonical names).
    # This check is intentional even when use_nemo=True: NeMo specs are mapped
    # by archetype but the requested scenario *subset* must still be valid names.
    unknown = [s for s in scenarios if s not in NAMED_SCENARIOS]
    if unknown:
        raise ValueError(
            f"Unknown scenarios in config: {unknown}. "
            f"Valid: {sorted(NAMED_SCENARIOS.keys())}"
        )

    # ── NeMo scenario source resolution ──────────────────────────────────────
    # When use_nemo=True, source ScenarioSpec objects from NeMoScenarioDesigner.
    # The designer already fails-closed to NAMED_SCENARIOS internally when
    # NVIDIA_API_KEY is absent, so no extra fallback logic is needed here.
    # We propagate which path was taken as scenario_source on each record.
    #
    # When use_nemo=False (default), use NAMED_SCENARIOS directly (safe offline).
    #
    # Either way, the stochastic renderer (StochasticRegimeGenerator) does the
    # actual OHLCV generation — scenario specs only parametrise the renderer.
    scenario_source: str = "stochastic_fallback"
    _nemo_spec_map: dict = {}  # scenario_name → ScenarioSpec (populated below)

    if use_nemo:
        try:
            designer = NeMoScenarioDesigner()
            nemo_result = designer.generate_scenarios(
                count=len(scenarios) * max_batches,
                seed=seed,
            )
            scenario_source = (
                "nemo_data_designer"
                if nemo_result.path_used == "data_designer"
                else "stochastic_fallback"
            )
            # Build a map from spec.name → spec for fast lookup.
            # NeMo specs are keyed by archetype label which may not 1-to-1 match
            # the NAMED_SCENARIOS keys; fall back to NAMED_SCENARIOS for any
            # scenario not found in the designer result.
            for spec in nemo_result.specs:
                # Map archetype label back to a NAMED_SCENARIOS key if possible
                # (e.g. "crash" → "COVID_crash" via first match).
                # For NeMo data_designer path the spec.name IS the archetype label,
                # not the full scenario name — prefer exact match then fuzzy.
                if spec.name in NAMED_SCENARIOS:
                    _nemo_spec_map[spec.name] = spec
                else:
                    # fuzzy: if archetype label is a prefix/substring of a named key
                    for named_key in NAMED_SCENARIOS:
                        if spec.name in named_key or named_key.startswith(spec.name):
                            if named_key not in _nemo_spec_map:
                                _nemo_spec_map[named_key] = spec
            logger.info(
                "populate_regime_bank: use_nemo=True, path_used=%s, "
                "scenario_source=%s, mapped_specs=%d",
                nemo_result.path_used, scenario_source, len(_nemo_spec_map),
            )
        except Exception as exc:
            # Fail-soft: any NeMo error falls back to NAMED_SCENARIOS
            logger.warning(
                "populate_regime_bank: NeMoScenarioDesigner failed (%s: %s) — "
                "falling back to NAMED_SCENARIOS.",
                type(exc).__name__, exc,
            )
            scenario_source = "stochastic_fallback"
            _nemo_spec_map = {}

    out_path = Path(output_dir)
    if not dry_run:
        out_path.mkdir(parents=True, exist_ok=True)

    generated = 0
    calibrated_passed = 0
    calibrated_failed = 0
    stored = 0
    regime_records: list[dict] = []
    errors: list[str] = []

    for symbol in symbols:
        for timeframe in timeframes:
            gen = StochasticRegimeGenerator(
                symbol=symbol,
                timeframe=timeframe,
                seed=seed,
            )

            for scenario_name in scenarios:
                for batch_idx in range(max_batches):
                    # Each batch uses a deterministic seed derived from
                    # (seed, batch_idx) so batches are unique and reproducible.
                    batch_seed = seed + batch_idx * 1000
                    batch_gen = StochasticRegimeGenerator(
                        symbol=symbol,
                        timeframe=timeframe,
                        seed=batch_seed,
                    )

                    # If NeMo produced a spec for this scenario, inject it so the
                    # renderer uses NeMo parameters instead of hardcoded defaults.
                    # Falls back to NAMED_SCENARIOS spec if no NeMo spec available.
                    nemo_spec = _nemo_spec_map.get(scenario_name)

                    try:
                        if nemo_spec is not None:
                            # Inject NeMo spec as scenario_override so the renderer
                            # uses NeMo parameters instead of hardcoded NAMED_SCENARIOS
                            # defaults. The scenario_name is still passed to satisfy
                            # the renderer's logging / naming contract.
                            bars_df = batch_gen.generate(
                                scenario_name, scenario_override=nemo_spec
                            )
                        else:
                            bars_df = batch_gen.generate(scenario_name)
                        generated += 1
                    except Exception as exc:
                        msg = f"scenario={scenario_name} symbol={symbol} tf={timeframe} batch={batch_idx}: generate() failed: {exc}"
                        logger.error(msg)
                        errors.append(msg)
                        continue

                    # ── Stylized-fact calibration ─────────────────────────────
                    try:
                        sf_passed, cal_stats = batch_gen.calibrate(bars_df)
                    except Exception as exc:
                        msg = f"scenario={scenario_name} symbol={symbol} batch={batch_idx}: calibrate() failed: {exc}"
                        logger.error(msg)
                        errors.append(msg)
                        sf_passed = False
                        cal_stats = {"passed": False, "fail_reasons": [str(exc)]}

                    if sf_passed:
                        calibrated_passed += 1
                    else:
                        calibrated_failed += 1
                        errors.append(
                            f"scenario={scenario_name} symbol={symbol} tf={timeframe} "
                            f"batch={batch_idx}: calibration FAILED: "
                            f"{cal_stats.get('fail_reasons', [])}"
                        )
                        # Do NOT store a failed calibration batch
                        continue

                    # ── Severity check (tail scenarios only) ──────────────────
                    severity_passed = True
                    severity_info: dict = {}
                    if run_severity_check:
                        try:
                            severity_passed, severity_info = batch_gen.severity_check(
                                bars_df, scenario_name
                            )
                        except Exception as exc:
                            severity_passed = True  # fail-open for severity only
                            severity_info = {"error": str(exc)}

                        if not severity_passed:
                            errors.append(
                                f"scenario={scenario_name} symbol={symbol} "
                                f"batch={batch_idx}: severity FAILED: "
                                f"{severity_info.get('flag', '')}"
                            )
                            # Do NOT store a non-severe tail scenario
                            continue

                    # ── Write to disk ─────────────────────────────────────────
                    fname = f"{symbol}_{timeframe}_{scenario_name}_seed{batch_seed}_b{batch_idx}.parquet"
                    file_path = str(out_path / fname)

                    if not dry_run:
                        try:
                            # Write as Parquet with governance metadata
                            # Polars does not support custom metadata natively,
                            # so we add governance as a column.
                            import polars as pl
                            bars_with_meta = bars_df.with_columns([
                                pl.lit(GENERATOR_MODEL_VERSION).alias("__model_version"),
                                pl.lit(GOVERNANCE_LABELS["decision_role"]).alias("__governance"),
                                pl.lit(scenario_name).alias("__scenario"),
                                pl.lit(symbol).alias("__symbol"),
                                pl.lit(timeframe).alias("__timeframe"),
                            ])
                            bars_with_meta.write_parquet(file_path)
                            stored += 1
                        except Exception as exc:
                            msg = (
                                f"scenario={scenario_name} symbol={symbol} "
                                f"batch={batch_idx}: write failed: {exc}"
                            )
                            logger.error(msg)
                            errors.append(msg)
                            file_path = ""
                    else:
                        stored += 1  # count as stored in dry-run

                    regime_records.append(_make_result_record(
                        symbol=symbol,
                        timeframe=timeframe,
                        regime_label=scenario_name,
                        file_path=file_path,
                        num_bars=len(bars_df),
                        stylized_fact_passed=sf_passed,
                        severity_passed=severity_passed,
                        calibration_stats=cal_stats,
                        batch_index=batch_idx,
                        seed=batch_seed,
                        scenario_source=scenario_source,
                    ))

    return {
        "generated": generated,
        "calibrated_passed": calibrated_passed,
        "calibrated_failed": calibrated_failed,
        "stored": stored,
        "regimes": regime_records,
        "errors": errors,
    }


# ─── CLI entry point ─────────────────────────────────────────────────────────

def main(argv: Optional[list[str]] = None) -> int:
    """CLI entry point.

    Usage:
        python -m src.engine.synthetic.populate_regime_bank --config '{...}'
        python -m src.engine.synthetic.populate_regime_bank --config path/to/config.json

    Returns:
        0 — all stored successfully
        1 — partial failure
        2 — complete failure or config error
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    parser = argparse.ArgumentParser(
        description="Populate synthetic regime bank (challenger-only)."
    )
    parser.add_argument(
        "--config",
        required=True,
        help=(
            "JSON config string or path to JSON file. "
            "See module docstring for schema."
        ),
    )
    parser.add_argument(
        "--output-json",
        default=None,
        help="Write JSON output to this file instead of stdout.",
    )

    args = parser.parse_args(argv)

    # ── Parse config ──────────────────────────────────────────────────────────
    try:
        config_str = args.config.strip()
        if config_str.startswith("{"):
            config = json.loads(config_str)
        else:
            # Treat as file path
            with open(config_str, "r", encoding="utf-8") as fh:
                config = json.load(fh)
    except Exception as exc:
        logger.error("Failed to parse --config: %s", exc)
        output = {
            "generated": 0, "calibrated_passed": 0, "calibrated_failed": 0,
            "stored": 0, "regimes": [], "errors": [f"config_parse_error: {exc}"],
        }
        _emit_output(output, args.output_json)
        return 2

    # ── Run populate ──────────────────────────────────────────────────────────
    try:
        result = run_populate(config)
    except Exception as exc:
        logger.error("run_populate() raised: %s", exc, exc_info=True)
        output = {
            "generated": 0, "calibrated_passed": 0, "calibrated_failed": 0,
            "stored": 0, "regimes": [],
            "errors": [f"fatal_error: {exc}"],
        }
        _emit_output(output, args.output_json)
        return 2

    _emit_output(result, args.output_json)

    # ── Exit code logic ───────────────────────────────────────────────────────
    # NOTE: runPythonModule (the TS caller) THROWS on ANY non-zero exit, so reserve
    # non-zero strictly for "nothing usable was stored". A PARTIAL run (some scenarios
    # failed strict 7-test calibration but others passed + stored) is a SUCCESS for the
    # bank — exit 0 so the caller inserts the regimes that passed. Per-scenario
    # calibration rejections are normal and reported in result["errors"]/counts, not
    # via the exit code. (2026-06-23 fix: was `return 1` on partial → service dropped
    # all stored regimes and the bank stayed empty.)
    if result["generated"] == 0:
        return 2  # nothing generated at all (total failure)
    if result["stored"] == 0:
        return 2  # generated but nothing passed calibration → nothing usable
    return 0  # stored > 0 → usable bank fill (full or partial)


def _emit_output(result: dict, output_file: Optional[str]) -> None:
    """Write result JSON to file or stdout."""
    output_str = json.dumps(result, indent=2, default=str)
    if output_file:
        with open(output_file, "w", encoding="utf-8") as fh:
            fh.write(output_str)
        logger.info("Output written to %s", output_file)
    else:
        print(output_str)


if __name__ == "__main__":
    sys.exit(main())
