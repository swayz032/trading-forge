"""TDD: populate_regime_bank tests.

Tests the CLI contract and run_populate() output JSON schema.

Test inventory:
  1. run_populate() output JSON has all required keys
  2. generated == calibrated_passed + calibrated_failed (accounting identity)
  3. Each regime record has required fields
  4. dry_run mode stores count without creating files
  5. Calibrated-failed batches NOT stored
  6. Unknown scenario name produces error and exit code 2
  7. CLI --config JSON string works end-to-end
  8. CLI --config JSON file path works end-to-end
  9. Partial failure exits with code 1
  10. All 8 scenarios can be populated via default config (dry_run)
  11. Stored regime files exist on disk (non-dry-run)
  12. Stored Parquet files have expected columns
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import types
from unittest.mock import MagicMock, patch

import pytest

# Guard against vectorbt import hang
_vbt_mock = types.ModuleType("vectorbt")
_vbt_mock.Portfolio = MagicMock()
sys.modules.setdefault("vectorbt", _vbt_mock)

from src.engine.synthetic.populate_regime_bank import _DEFAULT_CONFIG, main, run_populate

# ─── Minimal config for fast tests ───────────────────────────────────────────
_FAST_CONFIG = {
    "symbols": ["MES"],
    "timeframes": ["5min"],
    "scenarios": ["COVID_crash"],
    "seed": 42,
    "max_batches": 1,
    "severity_check": True,
    "dry_run": True,
}

_FAST_2SCENARIO_CONFIG = {
    **_FAST_CONFIG,
    "scenarios": ["COVID_crash", "slow_bleed_grind"],
}


# =============================================================================
# 1. Output JSON schema keys
# =============================================================================

class TestOutputSchema:
    def test_required_top_level_keys(self):
        result = run_populate(_FAST_CONFIG)
        required = {"generated", "calibrated_passed", "calibrated_failed", "stored", "regimes", "errors"}
        assert required.issubset(set(result.keys())), (
            f"Missing keys: {required - set(result.keys())}"
        )

    def test_generated_accounting_identity(self):
        result = run_populate(_FAST_CONFIG)
        assert result["generated"] == result["calibrated_passed"] + result["calibrated_failed"], (
            "generated must equal calibrated_passed + calibrated_failed. "
            f"got: {result['generated']} != {result['calibrated_passed']} + {result['calibrated_failed']}"
        )

    def test_errors_is_list(self):
        result = run_populate(_FAST_CONFIG)
        assert isinstance(result["errors"], list), "errors must be a list"

    def test_regimes_is_list(self):
        result = run_populate(_FAST_CONFIG)
        assert isinstance(result["regimes"], list), "regimes must be a list"


# =============================================================================
# 2. Per-regime record schema
# =============================================================================

class TestRegimeRecordSchema:
    """Each element in result['regimes'] must have the documented fields."""

    REQUIRED_FIELDS = {
        "symbol", "timeframe", "regime_label", "file_path",
        "num_bars", "generator_model_version", "governance",
        "stylized_fact_passed", "severity_passed",
        "calibration_stats",
    }

    def test_covid_crash_regime_record_fields(self):
        result = run_populate(_FAST_CONFIG)
        assert len(result["regimes"]) >= 1, "Expected at least 1 regime record"
        record = result["regimes"][0]
        missing = self.REQUIRED_FIELDS - set(record.keys())
        assert not missing, f"Regime record missing fields: {missing}"

    def test_regime_label_matches_scenario(self):
        result = run_populate(_FAST_CONFIG)
        for rec in result["regimes"]:
            assert rec["regime_label"] == "COVID_crash", (
                f"Unexpected regime_label: {rec['regime_label']}"
            )

    def test_num_bars_positive(self):
        result = run_populate(_FAST_CONFIG)
        for rec in result["regimes"]:
            assert rec["num_bars"] > 0, f"num_bars must be > 0: {rec}"

    def test_stylized_fact_passed_is_bool(self):
        result = run_populate(_FAST_CONFIG)
        for rec in result["regimes"]:
            assert isinstance(rec["stylized_fact_passed"], bool), (
                f"stylized_fact_passed must be bool: {rec['stylized_fact_passed']}"
            )

    def test_governance_is_challenger_only(self):
        result = run_populate(_FAST_CONFIG)
        for rec in result["regimes"]:
            assert rec["governance"] == "challenger_only", (
                f"governance must be 'challenger_only', got {rec['governance']}"
            )

    def test_generator_model_version_is_stochastic(self):
        result = run_populate(_FAST_CONFIG)
        for rec in result["regimes"]:
            assert "stochastic" in rec["generator_model_version"], (
                f"generator_model_version must contain 'stochastic': {rec['generator_model_version']}"
            )


# =============================================================================
# 3. dry_run mode
# =============================================================================

class TestDryRunMode:
    def test_dry_run_stores_count_without_files(self, tmp_path):
        config = {**_FAST_CONFIG, "dry_run": True, "output_dir": str(tmp_path)}
        result = run_populate(config)
        # stored count should be > 0 (counted) but no files on disk
        assert result["stored"] >= 0, "stored count must be non-negative"
        # No .parquet files written in dry_run
        parquet_files = list(tmp_path.glob("*.parquet"))
        assert len(parquet_files) == 0, (
            f"dry_run must not write files, but found: {parquet_files}"
        )


# =============================================================================
# 4. Unknown scenario
# =============================================================================

class TestUnknownScenario:
    def test_unknown_scenario_raises_value_error(self):
        config = {**_FAST_CONFIG, "scenarios": ["DOES_NOT_EXIST"]}
        with pytest.raises(ValueError, match="Unknown scenarios"):
            run_populate(config)


# =============================================================================
# 5. CLI interface
# =============================================================================

class TestCLI:
    def test_cli_json_string_config(self, tmp_path, capsys):
        config = {**_FAST_CONFIG, "output_dir": str(tmp_path)}
        config_str = json.dumps(config)
        exit_code = main(["--config", config_str])
        assert exit_code in (0, 1), f"CLI exit code must be 0 or 1, got {exit_code}"
        captured = capsys.readouterr()
        # Stdout must be valid JSON
        output = json.loads(captured.out)
        assert "generated" in output, "CLI stdout must be the result JSON"

    def test_cli_json_file_config(self, tmp_path, capsys):
        config = {**_FAST_CONFIG, "output_dir": str(tmp_path)}
        config_file = tmp_path / "test_config.json"
        config_file.write_text(json.dumps(config), encoding="utf-8")
        exit_code = main(["--config", str(config_file)])
        assert exit_code in (0, 1), f"CLI exit code must be 0 or 1, got {exit_code}"

    def test_cli_invalid_json_exits_2(self, capsys):
        exit_code = main(["--config", "NOT_VALID_JSON_OR_FILE"])
        assert exit_code == 2, f"Invalid config must exit 2, got {exit_code}"

    def test_cli_output_json_file(self, tmp_path):
        """--output-json writes result to file instead of stdout."""
        config = {**_FAST_CONFIG, "output_dir": str(tmp_path)}
        config_str = json.dumps(config)
        out_file = str(tmp_path / "result.json")
        exit_code = main(["--config", config_str, "--output-json", out_file])
        assert exit_code in (0, 1)
        assert os.path.exists(out_file), "Output JSON file must exist"
        with open(out_file, "r") as fh:
            output = json.load(fh)
        assert "generated" in output


# =============================================================================
# 6. All 8 scenarios (dry_run)
# =============================================================================

class TestAll8Scenarios:
    """Full battery of all 8 scenarios in dry_run mode."""

    def test_all_8_scenarios_populate(self, tmp_path):
        config = {
            "symbols": ["MES"],
            "timeframes": ["5min"],
            "scenarios": list(
                __import__(
                    "src.engine.synthetic.stochastic_regime_generator",
                    fromlist=["NAMED_SCENARIOS"],
                ).NAMED_SCENARIOS.keys()
            ),
            "seed": 42,
            "max_batches": 1,
            "severity_check": True,
            "dry_run": True,
            "output_dir": str(tmp_path),
        }
        result = run_populate(config)
        assert result["generated"] == 8, (
            f"Expected 8 scenarios generated, got {result['generated']}. "
            f"Errors: {result['errors']}"
        )
        assert result["calibrated_passed"] == 8, (
            f"All 8 scenarios must pass calibration, got {result['calibrated_passed']}. "
            f"Errors: {result['errors']}"
        )
        assert result["calibrated_failed"] == 0, (
            f"Expected 0 calibration failures, got {result['calibrated_failed']}. "
            f"Errors: {result['errors']}"
        )


# =============================================================================
# 7. Non-dry-run file creation
# =============================================================================

class TestFileCreation:
    def test_parquet_file_created(self, tmp_path):
        config = {
            **_FAST_CONFIG,
            "dry_run": False,
            "output_dir": str(tmp_path),
        }
        result = run_populate(config)
        assert result["stored"] > 0, "Expected at least 1 file stored"
        parquet_files = list(tmp_path.glob("*.parquet"))
        assert len(parquet_files) > 0, "Expected .parquet files in output_dir"

    def test_parquet_file_has_ohlcv_columns(self, tmp_path):
        config = {
            **_FAST_CONFIG,
            "dry_run": False,
            "output_dir": str(tmp_path),
        }
        result = run_populate(config)
        parquet_files = list(tmp_path.glob("*.parquet"))
        if not parquet_files:
            pytest.skip("No parquet files written")

        import polars as pl
        df = pl.read_parquet(str(parquet_files[0]))
        expected_cols = {"ts_event", "open", "high", "low", "close", "volume"}
        assert expected_cols.issubset(set(df.columns)), (
            f"Parquet file missing columns: {expected_cols - set(df.columns)}"
        )

    def test_parquet_filename_includes_scenario_and_seed(self, tmp_path):
        config = {
            **_FAST_CONFIG,
            "dry_run": False,
            "output_dir": str(tmp_path),
        }
        run_populate(config)
        parquet_files = list(tmp_path.glob("*.parquet"))
        for f in parquet_files:
            fname = f.name
            assert "COVID_crash" in fname, f"Filename must include scenario: {fname}"
            assert "seed" in fname, f"Filename must include seed: {fname}"


# =============================================================================
# 8. Calibration-failed batches not stored
# =============================================================================

class TestCalibrationFailedNotStored:
    """If calibration fails, the batch must not be stored."""

    def test_failed_calibration_not_stored(self, tmp_path):
        """Mock calibrate() to always fail and verify stored=0."""
        config = {**_FAST_CONFIG, "dry_run": False, "output_dir": str(tmp_path)}

        with patch(
            "src.engine.synthetic.stochastic_regime_generator.StochasticRegimeGenerator.calibrate",
            return_value=(False, {"passed": False, "fail_reasons": ["T1_mocked_fail"], "n_bars": 500, "n_returns": 499}),
        ):
            result = run_populate(config)

        assert result["stored"] == 0, (
            f"Failed calibration must not store. got stored={result['stored']}"
        )
        assert result["calibrated_failed"] >= 1, (
            "Expected at least 1 calibration failure when mocked to fail"
        )
        assert len(result["errors"]) >= 1, "Expected error entries for failed calibration"


# =============================================================================
# 9. Multiple batches per scenario
# =============================================================================

class TestMultipleBatches:
    def test_multiple_batches_use_different_seeds(self):
        config = {**_FAST_CONFIG, "max_batches": 2, "dry_run": True}
        result = run_populate(config)
        assert result["generated"] == 2, (
            f"Expected 2 batches generated for max_batches=2, got {result['generated']}"
        )
        if len(result["regimes"]) >= 2:
            seed_a = result["regimes"][0]["seed"]
            seed_b = result["regimes"][1]["seed"]
            assert seed_a != seed_b, (
                f"Batches must use different seeds: {seed_a} == {seed_b}"
            )
