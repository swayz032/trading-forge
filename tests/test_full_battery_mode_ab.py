"""Regression tests for scripts/full-battery-mode-ab.py (roadmap Band E, item E1).

These tests are deliberately lightweight — no vectorbt, no data loads, no live engine calls
(the full battery is compute-heavy and operator-scheduled, per the module docstring). They
verify the surrounding logic that IS testable without the tower:

  1. TestVerdictMathThresholds — compute_verdict() at every threshold boundary
  2. TestAplusRetention          — compute_aplus_retention_pct() matching + empty-set behavior
  3. TestModeAbGovernanceGuard   — build_mode_ab_labels() / validate_mode_ab_labels() contract
  4. TestManifestResume          — spec_id_for() stability + build_work_plan() resume filtering
  5. TestPlainEnglishVerdicts    — every verdict string is a real, human-readable sentence
  6. TestMockedOrchestration     - run_spec_worker() wired end-to-end with run_battery_for_mode
       mocked out (asserts the interface contract, never touches the real engine)

Since scripts/full-battery-mode-ab.py has a hyphenated filename (cannot be `import`ed with a
normal statement), it is loaded via importlib.util.spec_from_file_location — this gives full
coverage of the real implementation (not a hand-copied duplicate that could silently drift from
it, unlike the documented tradeoff in tests/test_filter_ablation.py for its much smaller inline
verdict function).
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

_REPO_ROOT = Path(__file__).parent.parent
_SCRIPT_PATH = _REPO_ROOT / "scripts" / "full-battery-mode-ab.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("full_battery_mode_ab", _SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["full_battery_mode_ab"] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def mab():
    return _load_module()


def _mode(dsr=None, dsr_pass=None, wfe=None, pbo=None, b14_ci_high=None, sharpe=None,
          trade_count=100, error=None):
    return {
        "dsr": dsr, "dsr_pass": dsr_pass, "wfe": wfe, "pbo": pbo,
        "b14_ci_high": b14_ci_high, "sharpe": sharpe, "trade_count": trade_count, "error": error,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 1. Verdict math thresholds
# ─────────────────────────────────────────────────────────────────────────────

class TestVerdictMathThresholds:
    def test_helps_edge_at_exact_dsr_threshold(self, mab):
        """delta_dsr exactly == DSR_EDGE_THRESHOLD (0.05) is HELPS EDGE (>= boundary)."""
        a = _mode(dsr=0.50, sharpe=1.0, wfe=0.80)
        b = _mode(dsr=0.55, sharpe=1.0, wfe=0.80)
        r = mab.compute_verdict(a, b)
        assert r["delta_dsr"] == 0.05
        assert r["verdict"] == mab.VERDICT_HELPS_EDGE

    def test_not_helps_edge_just_below_dsr_threshold(self, mab):
        """delta_dsr just under threshold does NOT count as edge-improved on its own."""
        a = _mode(dsr=0.50, sharpe=1.0, wfe=0.80)
        b = _mode(dsr=0.549, sharpe=1.0, wfe=0.80)  # delta=0.049
        r = mab.compute_verdict(a, b)
        assert r["delta_dsr"] < mab.DSR_EDGE_THRESHOLD
        assert r["verdict"] != mab.VERDICT_HELPS_EDGE

    def test_hurts_at_exact_negative_dsr_threshold(self, mab):
        """delta_dsr exactly == -DSR_EDGE_THRESHOLD is HURTS (<= boundary)."""
        a = _mode(dsr=0.50, sharpe=1.0, wfe=0.80)
        b = _mode(dsr=0.45, sharpe=1.0, wfe=0.80)
        r = mab.compute_verdict(a, b)
        assert r["delta_dsr"] == -0.05
        assert r["verdict"] == mab.VERDICT_HURTS

    def test_helps_survival_only_at_exact_b14_threshold(self, mab):
        """delta_b14_ci_high exactly == -B14_SURVIVAL_IMPROVE_THRESHOLD (0.01) with a flat
        DSR/Sharpe/WFE (no edge signal either direction) -> HELPS SURVIVAL ONLY."""
        a = _mode(dsr=0.50, sharpe=1.0, wfe=0.80, b14_ci_high=0.20)
        b = _mode(dsr=0.50, sharpe=1.0, wfe=0.80, b14_ci_high=0.19)
        r = mab.compute_verdict(a, b)
        assert r["delta_b14_ci_high"] == -0.01
        assert r["verdict"] == mab.VERDICT_HELPS_SURVIVAL_ONLY

    def test_not_survival_improved_just_above_b14_threshold(self, mab):
        """delta_b14_ci_high just short of the threshold does not count as a survival gain."""
        a = _mode(dsr=0.50, sharpe=1.0, wfe=0.80, b14_ci_high=0.20)
        b = _mode(dsr=0.50, sharpe=1.0, wfe=0.80, b14_ci_high=0.195)  # delta=-0.005
        r = mab.compute_verdict(a, b)
        assert r["verdict"] == mab.VERDICT_INDETERMINATE

    def test_hurts_via_negative_sharpe_delta(self, mab):
        """A negative Sharpe delta alone (DSR unavailable) triggers HURTS."""
        a = _mode(dsr=None, sharpe=1.0, wfe=0.80)
        b = _mode(dsr=None, sharpe=0.9, wfe=0.80)
        r = mab.compute_verdict(a, b)
        assert r["verdict"] == mab.VERDICT_HURTS

    def test_starves_trades_triggers_hurts_at_exact_floor_minus_epsilon(self, mab):
        """Trade retention just under TRADE_STARVE_FLOOR_PCT (0.40) triggers HURTS via starvation."""
        a = _mode(dsr=0.50, sharpe=1.0, wfe=0.80, trade_count=100)
        b = _mode(dsr=0.50, sharpe=1.0, wfe=0.80, trade_count=39)  # 0.39 < 0.40
        r = mab.compute_verdict(a, b)
        assert r["trade_retention_pct"] < mab.TRADE_STARVE_FLOOR_PCT
        assert r["verdict"] == mab.VERDICT_HURTS

    def test_exact_starve_floor_is_not_starving(self, mab):
        """Trade retention exactly == TRADE_STARVE_FLOOR_PCT is NOT starving (< strict, not <=)."""
        a = _mode(dsr=0.50, sharpe=1.0, wfe=0.80, trade_count=100)
        b = _mode(dsr=0.50, sharpe=1.0, wfe=0.80, trade_count=40)  # exactly 0.40
        r = mab.compute_verdict(a, b)
        assert r["trade_retention_pct"] == 0.40
        assert r["verdict"] == mab.VERDICT_INDETERMINATE

    def test_indeterminate_below_min_trades_in_mode_a(self, mab):
        a = _mode(dsr=0.50, sharpe=1.0, trade_count=mab.MIN_TRADES_FOR_VERDICT - 1)
        b = _mode(dsr=0.90, sharpe=2.0, trade_count=100)
        r = mab.compute_verdict(a, b)
        assert r["verdict"] == mab.VERDICT_INDETERMINATE
        assert r["delta_dsr"] is None

    def test_indeterminate_at_min_trades_boundary_proceeds(self, mab):
        """Exactly MIN_TRADES_FOR_VERDICT trades in both modes is enough to proceed (not blocked)."""
        a = _mode(dsr=0.50, sharpe=1.0, wfe=0.80, trade_count=mab.MIN_TRADES_FOR_VERDICT)
        b = _mode(dsr=0.60, sharpe=1.2, wfe=0.80, trade_count=mab.MIN_TRADES_FOR_VERDICT)
        r = mab.compute_verdict(a, b)
        assert r["verdict"] == mab.VERDICT_HELPS_EDGE  # delta_dsr=0.10 >= threshold

    def test_indeterminate_on_mode_error(self, mab):
        a = _mode(dsr=0.50, sharpe=1.0)
        b = {"error": "engine blew up", "trade_count": 0}
        r = mab.compute_verdict(a, b)
        assert r["verdict"] == mab.VERDICT_INDETERMINATE
        assert "engine blew up" in r["plain_english"]

    def test_edge_improved_priority_over_survival(self, mab):
        """When BOTH edge and survival improve, HELPS EDGE wins (higher priority)."""
        a = _mode(dsr=0.50, sharpe=1.0, wfe=0.80, b14_ci_high=0.30)
        b = _mode(dsr=0.60, sharpe=1.2, wfe=0.85, b14_ci_high=0.20)
        r = mab.compute_verdict(a, b)
        assert r["verdict"] == mab.VERDICT_HELPS_EDGE

    def test_hurts_wins_over_survival_when_edge_regresses_and_survival_improves(self, mab):
        """A DSR regression is HURTS even if B14 ci_high also improved — helping survival does
        not excuse hurting edge."""
        a = _mode(dsr=0.50, sharpe=1.0, wfe=0.80, b14_ci_high=0.30)
        b = _mode(dsr=0.40, sharpe=1.0, wfe=0.80, b14_ci_high=0.10)
        r = mab.compute_verdict(a, b)
        assert r["verdict"] == mab.VERDICT_HURTS

    @pytest.mark.parametrize(
        "aplus_pct,expect_caveat",
        [
            (79.9, True),
            (80.0, False),  # exactly at floor — NOT a caveat (< strict, matches script logic)
            (80.1, False),
            (None, False),
        ],
    )
    def test_aplus_retention_caveat_threshold(self, mab, aplus_pct, expect_caveat):
        a = _mode(dsr=0.50, sharpe=1.0, wfe=0.80, trade_count=100)
        b = _mode(dsr=0.50, sharpe=1.0, wfe=0.80, trade_count=100)  # flat -> INDETERMINATE
        r = mab.compute_verdict(a, b, aplus_retention_pct=aplus_pct)
        has_caveat = any("A+ retention" in c for c in r["caveats"])
        assert has_caveat is expect_caveat


# ─────────────────────────────────────────────────────────────────────────────
# 2. A+ retention
# ─────────────────────────────────────────────────────────────────────────────

class TestAplusRetention:
    def test_none_when_mode_a_has_no_aplus_trades(self, mab):
        a_trades = [{"PnL": 10.0, "Entry Idx": 1}]  # 2 pts @ MES -> below 14pt A+ bar
        b_trades = [{"PnL": 10.0, "Entry Idx": 1}]
        assert mab.compute_aplus_retention_pct(a_trades, b_trades) is None

    def test_full_retention(self, mab):
        a_trades = [
            {"PnL": 14 * 5, "Entry Idx": 1},
            {"PnL": 20 * 5, "Entry Idx": 2},
        ]
        b_trades = [
            {"PnL": 14 * 5, "Entry Idx": 1},
            {"PnL": 20 * 5, "Entry Idx": 2},
        ]
        assert mab.compute_aplus_retention_pct(a_trades, b_trades) == 100.0

    def test_partial_retention(self, mab):
        a_trades = [
            {"PnL": 14 * 5, "Entry Idx": 1},
            {"PnL": 20 * 5, "Entry Idx": 2},
        ]
        b_trades = [{"PnL": 14 * 5, "Entry Idx": 1}]  # only #1 kept
        assert mab.compute_aplus_retention_pct(a_trades, b_trades) == 50.0

    def test_zero_retention(self, mab):
        a_trades = [{"PnL": 14 * 5, "Entry Idx": 1}]
        b_trades = [{"PnL": 5 * 5, "Entry Idx": 2}]  # different entry key, not A+ anyway
        assert mab.compute_aplus_retention_pct(a_trades, b_trades) == 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 3. Governance guard (mode_ab labels)
# ─────────────────────────────────────────────────────────────────────────────

class TestModeAbGovernanceGuard:
    def test_build_mode_ab_labels_shape(self, mab):
        labels = mab.build_mode_ab_labels("spec123", "A", True)
        assert labels[mab.MODE_AB_MARKER_KEY] is True
        assert labels["mode"] == "A"
        assert labels["overlay_disabled"] is True
        assert labels["persist_to_production"] is False
        assert labels["tf_confluence_overlay_disabled_env"] == "true"

    def test_build_mode_ab_labels_mode_b(self, mab):
        labels = mab.build_mode_ab_labels("spec123", "B", False)
        assert labels["mode"] == "B"
        assert labels["overlay_disabled"] is False
        assert labels["tf_confluence_overlay_disabled_env"] == "false"

    def test_validate_passes_for_well_formed_labels(self, mab):
        labels = mab.build_mode_ab_labels("spec123", "A", True)
        mab.validate_mode_ab_labels(labels)  # must not raise

    def test_validate_rejects_missing_marker(self, mab):
        labels = mab.build_mode_ab_labels("spec123", "A", True)
        del labels[mab.MODE_AB_MARKER_KEY]
        with pytest.raises(ValueError, match="missing required"):
            mab.validate_mode_ab_labels(labels)

    def test_validate_rejects_bad_mode(self, mab):
        labels = mab.build_mode_ab_labels("spec123", "A", True)
        labels["mode"] = "C"
        with pytest.raises(ValueError, match="mode"):
            mab.validate_mode_ab_labels(labels)

    def test_validate_rejects_non_bool_overlay_disabled(self, mab):
        labels = mab.build_mode_ab_labels("spec123", "A", True)
        labels["overlay_disabled"] = "true"  # string, not bool
        with pytest.raises(ValueError, match="overlay_disabled"):
            mab.validate_mode_ab_labels(labels)

    def test_validate_rejects_non_dict(self, mab):
        with pytest.raises(ValueError, match="must be a dict"):
            mab.validate_mode_ab_labels("not a dict")

    def test_governance_label_never_persists_to_production(self, mab):
        assert mab.GOVERNANCE_LABEL["persist_to_production"] is False
        assert mab.GOVERNANCE_LABEL["governance_advisory"] is True


# ─────────────────────────────────────────────────────────────────────────────
# 4. Manifest resume
# ─────────────────────────────────────────────────────────────────────────────

class TestManifestResume:
    def test_spec_id_prefers_explicit_id(self, mab):
        spec = {"id": "my_strategy", "start_date": "2023-01-01"}
        assert mab.spec_id_for(spec) == "my_strategy"

    def test_spec_id_falls_back_to_content_hash(self, mab):
        spec = {"start_date": "2023-01-01", "strategy": {"symbol": "MES"}}
        sid = mab.spec_id_for(spec)
        assert isinstance(sid, str) and len(sid) == 16

    def test_spec_id_is_deterministic(self, mab):
        spec1 = {"start_date": "2023-01-01", "strategy": {"symbol": "MES"}}
        spec2 = {"strategy": {"symbol": "MES"}, "start_date": "2023-01-01"}  # different key order
        assert mab.spec_id_for(spec1) == mab.spec_id_for(spec2)

    def test_build_work_plan_skips_completed(self, mab):
        specs = [{"id": "s1"}, {"id": "s2"}, {"id": "s3"}]
        completed = {"s1": {"spec_id": "s1"}, "s3": {"spec_id": "s3"}}
        pending = mab.build_work_plan(specs, completed)
        assert [s["id"] for s in pending] == ["s2"]

    def test_build_work_plan_empty_completed_returns_all(self, mab):
        specs = [{"id": "s1"}, {"id": "s2"}]
        pending = mab.build_work_plan(specs, {})
        assert len(pending) == 2

    def test_manifest_roundtrip(self, mab, tmp_path):
        manifest_path = tmp_path / "manifest.jsonl"
        result = {
            "spec_id": "s1", "verdict": {"verdict": "HELPS EDGE"},
            "mode_a": {"trade_count": 10}, "mode_b": {"trade_count": 9},
        }
        mab.append_to_manifest(str(manifest_path), result)
        loaded = mab.load_manifest(str(manifest_path))
        assert "s1" in loaded
        assert loaded["s1"]["verdict"]["verdict"] == "HELPS EDGE"

    def test_load_manifest_missing_file_returns_empty(self, mab, tmp_path):
        assert mab.load_manifest(str(tmp_path / "does_not_exist.jsonl")) == {}

    def test_load_manifest_skips_malformed_lines(self, mab, tmp_path):
        manifest_path = tmp_path / "manifest.jsonl"
        manifest_path.write_text(
            'not json\n{"spec_id": "s1", "ok": true}\n\n', encoding="utf-8"
        )
        loaded = mab.load_manifest(str(manifest_path))
        assert list(loaded.keys()) == ["s1"]


# ─────────────────────────────────────────────────────────────────────────────
# 5. Plain-English verdict strings
# ─────────────────────────────────────────────────────────────────────────────

class TestPlainEnglishVerdicts:
    @pytest.mark.parametrize(
        "mode_a,mode_b,expected_prefix",
        [
            (_mode(dsr=0.50, sharpe=1.0, wfe=0.80), _mode(dsr=0.60, sharpe=1.2, wfe=0.85), "HELPS EDGE"),
            (
                _mode(dsr=0.50, sharpe=1.0, wfe=0.80, b14_ci_high=0.30),
                _mode(dsr=0.50, sharpe=1.0, wfe=0.80, b14_ci_high=0.10),
                "HELPS SURVIVAL ONLY",
            ),
            (_mode(dsr=0.50, sharpe=1.0, wfe=0.80), _mode(dsr=0.30, sharpe=0.5, wfe=0.80), "HURTS"),
            (_mode(dsr=0.50, sharpe=1.0, wfe=0.80), _mode(dsr=0.50, sharpe=1.0, wfe=0.80), "INDETERMINATE"),
        ],
    )
    def test_plain_english_starts_with_verdict_word(self, mab, mode_a, mode_b, expected_prefix):
        r = mab.compute_verdict(mode_a, mode_b)
        assert r["plain_english"].startswith(expected_prefix)

    def test_plain_english_is_nonempty_string_for_every_verdict(self, mab):
        r = mab.compute_verdict(_mode(error="boom"), _mode())
        assert isinstance(r["plain_english"], str)
        assert len(r["plain_english"]) > 10


# ─────────────────────────────────────────────────────────────────────────────
# 6. Mocked orchestration (interface contract only — never touches the real engine)
# ─────────────────────────────────────────────────────────────────────────────

class TestMockedOrchestration:
    def test_run_spec_worker_calls_mode_a_then_mode_b(self, mab):
        """run_spec_worker must run Mode A fully before Mode B starts (sequential within a
        worker — this is the correctness property that makes env-var isolation safe; see the
        module docstring). Mocking run_battery_for_mode lets us assert call order + args
        without touching vectorbt/Polars/S3."""
        call_log = []

        def fake_run_battery_for_mode(spec, mode, include_mc, mc_simulations, seed):
            call_log.append(mode)
            base = {"error": None, "dsr": 0.5, "sharpe": 1.0, "wfe": 0.8, "pbo": 0.1,
                     "b14_ci_high": 0.15, "trade_count": 50, "trades": [], "daily_pnls": []}
            return base

        item = {
            "spec": {"id": "s1", "strategy": {"symbol": "MES", "timeframe": "5m"},
                     "start_date": "2023-01-01", "end_date": "2024-01-01"},
            "include_mc": False, "mc_simulations": 1000, "seed": 42,
        }
        with patch.object(mab, "run_battery_for_mode", side_effect=fake_run_battery_for_mode):
            result = mab.run_spec_worker(item)

        assert call_log == ["A", "B"]
        assert result["spec_id"] == "s1"
        assert result["symbol"] == "MES"
        assert "verdict" in result
        assert "mode_a" in result and "mode_b" in result
        # heavy trade lists must be stripped before returning to the parent/manifest
        assert "trades" not in result["mode_a"]
        assert "trades" not in result["mode_b"]

    def test_run_spec_worker_result_is_json_serializable(self, mab):
        def fake_run_battery_for_mode(spec, mode, include_mc, mc_simulations, seed):
            return {"error": None, "dsr": 0.5, "sharpe": 1.0, "wfe": 0.8, "pbo": 0.1,
                    "b14_ci_high": 0.15, "trade_count": 20, "trades": [], "daily_pnls": []}

        item = {
            "spec": {"id": "s2", "strategy": {"symbol": "MNQ", "timeframe": "5m"},
                     "start_date": "2023-01-01", "end_date": "2024-01-01"},
            "include_mc": False, "mc_simulations": 1000, "seed": 42,
        }
        with patch.object(mab, "run_battery_for_mode", side_effect=fake_run_battery_for_mode):
            result = mab.run_spec_worker(item)

        # must round-trip through json (this is exactly what append_to_manifest does)
        serialized = json.dumps(result, default=str)
        restored = json.loads(serialized)
        assert restored["spec_id"] == "s2"

    def test_run_spec_worker_propagates_mode_errors_into_indeterminate_verdict(self, mab):
        def fake_run_battery_for_mode(spec, mode, include_mc, mc_simulations, seed):
            if mode == "B":
                return {"error": "vectorbt exploded", "trade_count": 0, "trades": []}
            return {"error": None, "dsr": 0.5, "sharpe": 1.0, "wfe": 0.8, "pbo": 0.1,
                    "b14_ci_high": 0.15, "trade_count": 20, "trades": [], "daily_pnls": []}

        item = {
            "spec": {"id": "s3", "strategy": {"symbol": "MCL", "timeframe": "5m"},
                     "start_date": "2023-01-01", "end_date": "2024-01-01"},
            "include_mc": False, "mc_simulations": 1000, "seed": 42,
        }
        with patch.object(mab, "run_battery_for_mode", side_effect=fake_run_battery_for_mode):
            result = mab.run_spec_worker(item)

        assert result["verdict"]["verdict"] == mab.VERDICT_INDETERMINATE
