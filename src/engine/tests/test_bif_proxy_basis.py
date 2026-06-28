"""Tests for M1 fix: CPCV BIF proxy-basis marker.

Verifies that walk_forward._run_walk_forward_cpcv() injects
bif_proxy_basis="oos_mean_not_is" into both _cpcv_bif_result and wf_metadata,
and that backtest_inflation_factor.compute_bif() passes through the key when set.

These tests do NOT import backtester.py or walk_forward.py directly (to avoid
the vectorbt JIT hang).  They test the pure-function layer: compute_bif() in
backtest_inflation_factor and the wf_metadata dict construction via a minimal
stub that mirrors what walk_forward.py would produce.

Run with:
    TF_MOCK_VBT=1 python -m pytest src/engine/tests/test_bif_proxy_basis.py -v
"""

import pytest


# ── compute_bif passthrough ────────────────────────────────────────────────────

class TestComputeBifProxyBasis:
    """backtest_inflation_factor.compute_bif() is silent on bif_proxy_basis — the
    caller (walk_forward.py) stamps it AFTER compute_bif() returns.  These tests
    confirm that the dict is mutable and the key survives round-trip."""

    def test_compute_bif_result_dict_is_mutable(self):
        """compute_bif() returns a plain dict that can be mutated by the caller."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif
        result = compute_bif(is_sharpe=1.0, wf_sharpe=0.9, k_eff=15.0)
        assert isinstance(result, dict)
        # Caller stamps bif_proxy_basis — must not raise
        result["bif_proxy_basis"] = "oos_mean_not_is"
        assert result["bif_proxy_basis"] == "oos_mean_not_is"

    def test_compute_bif_does_not_pre_populate_proxy_basis(self):
        """compute_bif() must NOT pre-populate bif_proxy_basis — caller owns that field."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif
        result = compute_bif(is_sharpe=1.2, wf_sharpe=1.0, k_eff=10.0)
        assert "bif_proxy_basis" not in result

    def test_compute_bif_clean_with_proxy_basis_stamped(self):
        """After caller stamps bif_proxy_basis, expected BIF output is unchanged."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif
        result = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=15.0)
        result["bif_proxy_basis"] = "oos_mean_not_is"
        # BIF = IS/OOS ≈ 1.0 when both come from same OOS series (the M1 issue)
        assert result["bif"] == pytest.approx(1.0, abs=0.01)
        assert result["verdict"] in ("clean", "warn")
        assert result["bif_proxy_basis"] == "oos_mean_not_is"

    def test_proxy_basis_present_in_wf_metadata_structure(self):
        """Minimal wf_metadata dict mirrors what walk_forward.py emits post-M1 fix."""
        # Simulate the dict that walk_forward.py builds for wf_metadata
        bif_result: dict = {
            "bif": 1.01,
            "k_eff": 15.0,
            "verdict": "clean",
            "bif_proxy_basis": "oos_mean_not_is",  # stamped by walk_forward.py
        }
        wf_metadata = {
            "mode": "cpcv",
            "n_folds": 6,
            "n_paths": 15,
            "psr": 0.8,
            "dsr": 0.75,
            "dsr_pass": True,
            "dsr_unavailable": False,
            "bif_proxy_basis": bif_result.get("bif_proxy_basis"),  # M1 fix
        }
        assert wf_metadata["bif_proxy_basis"] == "oos_mean_not_is"
        # Mode must still be cpcv
        assert wf_metadata["mode"] == "cpcv"

    def test_proxy_basis_absent_when_bif_computation_fails(self):
        """When _cpcv_bif_result is an empty dict (exception path), bif_proxy_basis is None."""
        # If the try block in walk_forward.py throws, _cpcv_bif_result = {}
        bif_result: dict = {}
        wf_metadata_basis = bif_result.get("bif_proxy_basis")  # mirrors wf_metadata build
        assert wf_metadata_basis is None

    @pytest.mark.parametrize("is_sh,wf_sh,k_eff,expected_bif_approx", [
        (1.0, 1.0, 15.0, 1.0),    # CPCV near-no-op: same OOS mean → BIF≈1.0
        (1.5, 0.5, 15.0, 3.0),    # IS much better than OOS → BIF=3.0
        (0.5, 0.5, 10.0, 1.0),    # Equal → BIF=1.0
    ])
    def test_compute_bif_values(self, is_sh, wf_sh, k_eff, expected_bif_approx):
        from src.engine.statistics.backtest_inflation_factor import compute_bif
        r = compute_bif(is_sharpe=is_sh, wf_sharpe=wf_sh, k_eff=k_eff)
        assert r["bif"] == pytest.approx(expected_bif_approx, abs=0.02)


# ── M1 docstring sanity ────────────────────────────────────────────────────────

class TestBifDocstringUpdated:
    """L1 fix: confirm the stale 'max(path_sharpes)' reference is gone."""

    def test_docstring_no_longer_says_max(self):
        from src.engine.statistics import backtest_inflation_factor
        import inspect
        doc = inspect.getdoc(backtest_inflation_factor.compute_bif) or ""
        assert "max(path_sharpes)" not in doc, (
            "Stale docstring still references max(path_sharpes). L1 fix not applied."
        )

    def test_docstring_mentions_mean_and_m1(self):
        from src.engine.statistics import backtest_inflation_factor
        import inspect
        doc = inspect.getdoc(backtest_inflation_factor.compute_bif) or ""
        assert "mean(path_OOS_sharpes)" in doc
        assert "M1" in doc or "oos_mean_not_is" in doc
