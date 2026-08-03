"""Tests for the scaling-schedule survival validation harness.

Covers:
  - Per-tier gate logic: high-breach P&L → FAIL, safe P&L → PASS
  - 5% threshold boundary (exact edge cases)
  - Fail-CLOSED on missing/invalid data
  - Determinism: same seed + inputs → same breach_pct
  - Block-bootstrap path shape and cumulative-sum correctness
  - Tier result schema completeness
  - _write_report produces a readable file
  - CLI smoke test with --synth-daily-pnl (subprocess invocation)

IMPORTANT: We import ONLY from scripts.validate_scaling_schedule and
src.engine.monte_carlo.simulate_firm_survival directly.  We do NOT import
the backtester or vectorbt at any point — bare imports of those modules
HANG pytest collection on this box (WDAC / vectorbt JIT issue per
CLAUDE.md §2 pinned facts).

Run with:
    python -m pytest tests/python/test_validate_scaling_schedule.py -v
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import importlib.util

import numpy as np
import pytest

# ─── Path setup ──────────────────────────────────────────────────────────────
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT))

# ─── Import harness helpers via importlib (scripts/ has no __init__.py) ──────
# We load validate-scaling-schedule.py directly by file path to avoid needing
# scripts/ to be a Python package.  This also ensures we pick up the exact
# file under test without any stale .pyc confusion.
_HARNESS_PATH = _REPO_ROOT / "scripts" / "validate-scaling-schedule.py"

def _load_harness():
    """Load the harness module once and return it."""
    spec = importlib.util.spec_from_file_location(
        "validate_scaling_schedule", _HARNESS_PATH
    )
    mod = importlib.util.module_from_spec(spec)
    # Register under a stable name so sub-imports resolve correctly
    sys.modules.setdefault("validate_scaling_schedule", mod)
    spec.loader.exec_module(mod)
    return mod

_harness = _load_harness()

DEFAULT_TIERS = _harness.DEFAULT_TIERS
_block_bootstrap_paths = _harness._block_bootstrap_paths
_plain_english_breach = _harness._plain_english_breach
_verdict_pill = _harness._verdict_pill
_write_report = _harness._write_report
run_tier_survival = _harness.run_tier_survival


# ─── Fixtures: synthetic P&L distributions ───────────────────────────────────

@pytest.fixture
def rng_fixed() -> np.random.Generator:
    """Reproducible RNG for all tests."""
    return np.random.default_rng(seed=42)


@pytest.fixture
def safe_pnl(rng_fixed) -> np.ndarray:
    """Per-contract daily P&L with positive edge and low variance.

    Mean = +$25/day, std = $50/day.
    At 9 contracts: mean = $225/day, std = $450/day.
    This should safely pass the 5% breach gate for small tiers.
    """
    return rng_fixed.normal(loc=25.0, scale=50.0, size=504)  # 2 years


@pytest.fixture
def risky_pnl(rng_fixed) -> np.ndarray:
    """Per-contract daily P&L with high variance relative to edge.

    Mean = +$1/day, std = $300/day.
    At 50 contracts: mean = $50/day, std = $15,000/day.
    The $2,000 EOD trailing-DD buffer will be hit constantly.
    """
    return rng_fixed.normal(loc=1.0, scale=300.0, size=504)


@pytest.fixture
def tiny_pnl() -> np.ndarray:
    """Per-contract P&L array with only 5 observations (below block_size=10).

    Used to test the fail path when not enough history is available.
    """
    return np.array([10.0, 20.0, -5.0, 15.0, 8.0])


def _mock_sim(breach_frac: float, n_sims: int) -> dict:
    """Build a simulate_firm_survival mock return dict for testing."""
    mask = np.zeros(n_sims, dtype=np.uint8)
    n_breach = int(round(breach_frac * n_sims))
    mask[:n_breach] = 1
    return {
        "firm": "topstep_50k",
        "firm_name": "Topstep 50K",
        "account_size": 50000,
        "num_simulations": n_sims,
        "eval_pass_rate": 0.80,
        "funded_survival_6mo": 0.60,
        "avg_days_to_pass": 30.0,
        "breach_reasons": {
            "trailing_dd": n_breach,
            "daily_loss_limit": 0,
            "never_hit_target": 0,
            "consistency": 0,
        },
        "drawdown_percentiles": {
            "p50": 500.0, "p75": 1000.0, "p90": 1500.0,
            "p95": 1800.0, "p99": 2000.0,
        },
        "consistency_fail_rate": 0.0,
        "granularity": "day",
        "commission_per_side": 0.62,
        "realtime_trailing": False,
        "breach_mask": mask,
    }


# ─── Block-bootstrap path tests ───────────────────────────────────────────────

class TestBlockBootstrapPaths:
    """Verify path construction mechanics."""

    def test_output_shape(self, rng_fixed, safe_pnl):
        paths = _block_bootstrap_paths(
            daily_pnls=safe_pnl,
            n_sims=50,
            n_steps=63,
            block_size=10,
            rng=rng_fixed,
        )
        assert paths.shape == (50, 63), f"Expected (50, 63), got {paths.shape}"

    def test_paths_are_cumulative(self, rng_fixed, safe_pnl):
        """Paths must be cumulative P&L, not per-step P&L."""
        paths = _block_bootstrap_paths(
            daily_pnls=safe_pnl,
            n_sims=20,
            n_steps=30,
            block_size=10,
            rng=rng_fixed,
        )
        # Cumulative P&L means diffs are finite step returns — not all zero
        diffs = np.diff(paths, axis=1)
        assert not np.all(diffs == 0), "Paths appear to not be cumulative"

    def test_determinism(self, safe_pnl):
        """Same seed → identical paths."""
        rng_a = np.random.default_rng(seed=7)
        rng_b = np.random.default_rng(seed=7)
        paths_a = _block_bootstrap_paths(safe_pnl, 100, 63, 10, rng_a)
        paths_b = _block_bootstrap_paths(safe_pnl, 100, 63, 10, rng_b)
        np.testing.assert_array_equal(paths_a, paths_b, err_msg="Paths not deterministic")

    def test_fallback_iid_when_obs_lt_block_size(self, rng_fixed):
        """When n_obs < block_size, should fall back to IID without crashing."""
        tiny = np.array([10.0, 20.0, -5.0, 15.0, 8.0])  # 5 obs, block_size=10
        paths = _block_bootstrap_paths(
            daily_pnls=tiny,
            n_sims=10,
            n_steps=20,
            block_size=10,
            rng=rng_fixed,
        )
        assert paths.shape == (10, 20)

    def test_single_step(self, rng_fixed, safe_pnl):
        """n_steps=1 should produce shape (n_sims, 1)."""
        paths = _block_bootstrap_paths(safe_pnl, 10, 1, 5, rng_fixed)
        assert paths.shape == (10, 1)


# ─── run_tier_survival gate logic tests ───────────────────────────────────────

class TestRunTierSurvivalGateLogic:
    """Core gate logic tests using a mocked simulate_firm_survival."""

    def _run_with_mock(
        self,
        pnl: np.ndarray,
        n_contracts: int,
        breach_frac: float,
        gate_pct: float = 0.05,
        n_sims: int = 100,
    ) -> dict:
        mock_return = _mock_sim(breach_frac, n_sims)
        # Use the _sim_fn injection seam (no patch needed — avoids monte_carlo import
        # and avoids any patch-target string fragility across module-load paths).
        result = run_tier_survival(
            daily_pnls_per_contract=pnl,
            n_contracts=n_contracts,
            n_sims=n_sims,
            n_steps=63,
            block_size=5,
            rng=np.random.default_rng(42),
            firm_key="topstep_50k",
            account_size=50000.0,
            breach_gate_pct=gate_pct,
            trades_per_day=1,
            symbol="MES",
            _sim_fn=lambda **kwargs: mock_return,
        )
        return result

    def test_safe_pnl_passes_gate(self, safe_pnl):
        """A strategy with 3% breach rate passes the 5% gate."""
        result = self._run_with_mock(safe_pnl, n_contracts=9, breach_frac=0.03)
        assert result["passed"] is True, (
            f"Expected PASS with 3% breach, gate 5%. Got: {result}"
        )

    def test_risky_pnl_fails_gate(self, risky_pnl):
        """A strategy with 20% breach rate fails the 5% gate."""
        result = self._run_with_mock(risky_pnl, n_contracts=50, breach_frac=0.20)
        assert result["passed"] is False, (
            f"Expected FAIL with 20% breach, gate 5%. Got: {result}"
        )

    def test_threshold_boundary_just_below_passes(self, safe_pnl):
        """4.9% breach rate is strictly below 5% gate — must PASS.

        We use n_sims=1000 so integer rounding (49/1000 = 0.049) is clearly
        below the gate without rounding to exactly 5%.
        """
        result = self._run_with_mock(safe_pnl, n_contracts=9, breach_frac=0.049, n_sims=1000)
        assert result["passed"] is True, (
            f"Expected PASS with 4.9% breach (just below 5% gate). Got: {result}"
        )

    def test_threshold_boundary_at_gate_fails(self, safe_pnl):
        """Exactly 5.0% breach rate is NOT strictly less than 5% gate — must FAIL."""
        result = self._run_with_mock(safe_pnl, n_contracts=9, breach_frac=0.05)
        assert result["passed"] is False, (
            f"Expected FAIL when breach_pct == gate_pct (0.05). Got: {result}"
        )

    def test_threshold_boundary_just_above_fails(self, safe_pnl):
        """5.1% breach rate is above 5% gate — must FAIL."""
        result = self._run_with_mock(safe_pnl, n_contracts=9, breach_frac=0.051)
        assert result["passed"] is False, (
            f"Expected FAIL with 5.1% breach. Got: {result}"
        )

    def test_custom_gate_pct(self, safe_pnl):
        """Custom gate of 10% should pass a 9% breach rate."""
        result = self._run_with_mock(safe_pnl, n_contracts=9, breach_frac=0.09, gate_pct=0.10)
        assert result["passed"] is True, (
            f"Expected PASS with 9% breach and 10% gate. Got: {result}"
        )

    def test_result_schema_completeness(self, safe_pnl):
        """Result dict must contain all required keys for report writing."""
        result = self._run_with_mock(safe_pnl, n_contracts=9, breach_frac=0.02)
        required_keys = {
            "n_contracts", "breach_pct", "breach_count", "n_sims",
            "passed", "gate_pct", "breach_reasons",
            "drawdown_percentiles", "eval_pass_rate",
            "funded_survival_6mo", "consistency_fail_rate",
        }
        missing = required_keys - set(result.keys())
        assert not missing, f"Missing result keys: {missing}"

    def test_breach_pct_matches_mask_mean(self, safe_pnl):
        """breach_pct must equal breach_mask.mean() from the sim result."""
        frac = 0.07
        n_sims = 200
        result = self._run_with_mock(safe_pnl, n_contracts=9, breach_frac=frac, n_sims=n_sims)
        expected_count = int(round(frac * n_sims))
        # Allow ±1 for rounding
        assert abs(result["breach_count"] - expected_count) <= 1, (
            f"breach_count mismatch: expected ~{expected_count}, got {result['breach_count']}"
        )

    def test_determinism_same_seed(self, safe_pnl):
        """Same seed must produce identical breach_pct across two runs."""
        pnl = safe_pnl.copy()
        # The mock always returns the same breach_frac; we verify that the
        # block-bootstrap path construction (which feeds real paths to the
        # mock) is identical across two runs with the same seed.
        results = []
        for _ in range(2):
            rng = np.random.default_rng(seed=99)
            mock_return = _mock_sim(0.04, 100)
            r = run_tier_survival(
                daily_pnls_per_contract=pnl,
                n_contracts=12,
                n_sims=100,
                n_steps=63,
                block_size=5,
                rng=rng,
                firm_key="topstep_50k",
                account_size=50000.0,
                breach_gate_pct=0.05,
                trades_per_day=1,
                symbol="MES",
                _sim_fn=lambda **kwargs: mock_return,
            )
            results.append(r["breach_pct"])
        assert results[0] == results[1], (
            f"Non-deterministic breach_pct: {results[0]} vs {results[1]}"
        )


# ─── Fail-CLOSED on missing/invalid data ─────────────────────────────────────

class TestFailClosed:
    """Harness must refuse (non-zero exit) rather than emit a fake SAFE."""

    def _call(self, pnl, sim_fn, n_contracts=9, n_sims=10):
        return run_tier_survival(
            daily_pnls_per_contract=pnl,
            n_contracts=n_contracts,
            n_sims=n_sims,
            n_steps=20,
            block_size=5,
            rng=np.random.default_rng(42),
            firm_key="topstep_50k",
            account_size=50000.0,
            breach_gate_pct=0.05,
            trades_per_day=1,
            symbol="MES",
            _sim_fn=sim_fn,
        )

    def test_sim_returns_error_key(self, safe_pnl):
        """If simulate_firm_survival returns {'error': ...}, harness must exit non-zero."""
        with pytest.raises(SystemExit) as exc_info:
            self._call(safe_pnl, sim_fn=lambda **kwargs: {"error": "Unknown firm: bad_firm"})
        assert exc_info.value.code != 0, "Must exit non-zero on error response"

    def test_sim_missing_breach_mask(self, safe_pnl):
        """If breach_mask is absent from sim result, harness must exit non-zero."""
        result_no_mask = _mock_sim(0.03, 10)
        del result_no_mask["breach_mask"]
        with pytest.raises(SystemExit) as exc_info:
            self._call(safe_pnl, sim_fn=lambda **kwargs: result_no_mask)
        assert exc_info.value.code != 0

    def test_sim_non_finite_breach_pct(self, safe_pnl):
        """A NaN breach_mask must force a non-zero exit (non-finite verdict)."""
        result_nan = _mock_sim(0.03, 10)
        result_nan["breach_mask"] = np.array([np.nan] * 10)
        with pytest.raises(SystemExit) as exc_info:
            self._call(safe_pnl, sim_fn=lambda **kwargs: result_nan)
        assert exc_info.value.code != 0

    def test_sim_raises_exception(self, safe_pnl):
        """If simulate_firm_survival raises, harness must exit non-zero."""
        def _raising(**kwargs):
            raise RuntimeError("Simulated GPU OOM")

        with pytest.raises(SystemExit) as exc_info:
            self._call(safe_pnl, sim_fn=_raising)
        assert exc_info.value.code != 0


# ─── _verdict_pill and _plain_english_breach ─────────────────────────────────

class TestVerdictHelpers:
    """Plain-English output helpers."""

    def test_verdict_pill_safe(self):
        pill = _verdict_pill(passed=True, breach_pct=0.03, gate_pct=0.05)
        assert "SAFE" in pill
        assert "3.0%" in pill

    def test_verdict_pill_unsafe(self):
        pill = _verdict_pill(passed=False, breach_pct=0.12, gate_pct=0.05)
        assert "UNSAFE" in pill
        assert "12.0%" in pill

    def test_plain_english_very_low(self):
        text = _plain_english_breach(0.01)
        assert "very low" in text.lower() or "1.0%" in text

    def test_plain_english_near_gate(self):
        text = _plain_english_breach(0.04)
        assert "5%" in text or "4.0%" in text

    def test_plain_english_over_gate(self):
        text = _plain_english_breach(0.08)
        assert "over the 5% gate" in text.lower() or "8.0%" in text

    def test_plain_english_high(self):
        text = _plain_english_breach(0.25)
        assert "high" in text.lower() or "25.0%" in text


# ─── _write_report ────────────────────────────────────────────────────────────

class TestWriteReport:
    """Report writer produces a valid markdown file."""

    def _make_tier_results(self, passed: bool = True) -> list[dict]:
        return [
            {
                "n_contracts": 9,
                "breach_pct": 0.03 if passed else 0.12,
                "breach_count": 30 if passed else 120,
                "n_sims": 1000,
                "passed": passed,
                "gate_pct": 0.05,
                "breach_reasons": {
                    "trailing_dd": 25, "daily_loss_limit": 5,
                    "never_hit_target": 0, "consistency": 0,
                },
                "drawdown_percentiles": {
                    "p50": 400.0, "p75": 900.0, "p90": 1400.0,
                    "p95": 1700.0, "p99": 1950.0,
                },
                "eval_pass_rate": 0.80,
                "funded_survival_6mo": 0.65,
                "consistency_fail_rate": 0.02,
            }
        ]

    def test_report_file_created(self, tmp_path, monkeypatch):
        """Report file must exist after write."""
        monkeypatch.setattr("validate_scaling_schedule.REPORT_DIR", tmp_path)
        tier_results = self._make_tier_results(passed=True)
        out = _write_report(
            tier_results=tier_results,
            symbol="MES",
            n_obs=252,
            n_steps=252,
            n_sims=1000,
            block_size=10,
            seed=42,
            firm_key="topstep_50k",
            account_size=50000.0,
            gate_pct=0.05,
            report_name="test-report",
            per_contract_mean=25.0,
            per_contract_std=80.0,
            data_source="synthetic:test",
        )
        assert out.exists(), f"Expected report at {out}"

    def test_report_contains_tier_verdict(self, tmp_path, monkeypatch):
        """Report must contain the tier contract count and verdict."""
        monkeypatch.setattr("validate_scaling_schedule.REPORT_DIR", tmp_path)
        tier_results = self._make_tier_results(passed=False)
        out = _write_report(
            tier_results=tier_results,
            symbol="MES",
            n_obs=252,
            n_steps=252,
            n_sims=1000,
            block_size=10,
            seed=42,
            firm_key="topstep_50k",
            account_size=50000.0,
            gate_pct=0.05,
            report_name="test-unsafe-report",
            per_contract_mean=1.0,
            per_contract_std=300.0,
            data_source="synthetic:test",
        )
        content = out.read_text(encoding="utf-8")
        assert "9" in content         # tier contract count
        assert "UNSAFE" in content    # verdict when failed

    def test_report_contains_scope_disclosure(self, tmp_path, monkeypatch):
        """Report must contain the follow-up scope disclosure."""
        monkeypatch.setattr("validate_scaling_schedule.REPORT_DIR", tmp_path)
        tier_results = self._make_tier_results(passed=True)
        out = _write_report(
            tier_results=tier_results,
            symbol="MES",
            n_obs=252,
            n_steps=252,
            n_sims=1000,
            block_size=10,
            seed=42,
            firm_key="topstep_50k",
            account_size=50000.0,
            gate_pct=0.05,
            report_name="test-scope-report",
            per_contract_mean=25.0,
            per_contract_std=80.0,
            data_source="synthetic:test",
        )
        content = out.read_text(encoding="utf-8")
        assert "VALIDATES" in content
        assert "does NOT validate" in content
        assert "follow-up" in content.lower()

    def test_report_overall_verdict_all_safe(self, tmp_path, monkeypatch):
        """When all tiers pass, report must say ALL TIERS SAFE."""
        monkeypatch.setattr("validate_scaling_schedule.REPORT_DIR", tmp_path)
        tier_results = self._make_tier_results(passed=True)
        out = _write_report(
            tier_results=tier_results,
            symbol="MES",
            n_obs=252,
            n_steps=252,
            n_sims=1000,
            block_size=10,
            seed=42,
            firm_key="topstep_50k",
            account_size=50000.0,
            gate_pct=0.05,
            report_name="test-all-safe",
            per_contract_mean=25.0,
            per_contract_std=80.0,
            data_source="synthetic:test",
        )
        content = out.read_text(encoding="utf-8")
        assert "ALL TIERS SAFE" in content

    def test_report_overall_verdict_unsafe(self, tmp_path, monkeypatch):
        """When a tier fails, report must say ONE OR MORE TIERS UNSAFE."""
        monkeypatch.setattr("validate_scaling_schedule.REPORT_DIR", tmp_path)
        tier_results = self._make_tier_results(passed=False)
        out = _write_report(
            tier_results=tier_results,
            symbol="MES",
            n_obs=252,
            n_steps=252,
            n_sims=1000,
            block_size=10,
            seed=42,
            firm_key="topstep_50k",
            account_size=50000.0,
            gate_pct=0.05,
            report_name="test-unsafe-overall",
            per_contract_mean=1.0,
            per_contract_std=300.0,
            data_source="synthetic:test",
        )
        content = out.read_text(encoding="utf-8")
        assert "ONE OR MORE TIERS UNSAFE" in content


# ─── CLI smoke test ───────────────────────────────────────────────────────────

class TestCLISmoke:
    """End-to-end subprocess smoke test using --synth-daily-pnl."""

    def test_cli_safe_synthetic_exits_zero(self, tmp_path):
        """Synthetic high-edge P&L should pass all tiers and exit 0."""
        script = str(_REPO_ROOT / "scripts" / "validate-scaling-schedule.py")
        result = subprocess.run(
            [
                sys.executable, script,
                "--synth-daily-pnl", "50.0",
                "--synth-daily-std", "40.0",
                "--synth-n-days", "252",
                "--tiers", "9,12",           # small tiers only for speed
                "--n-sims", "200",
                "--n-steps", "63",
                "--report-name", "cli-smoke-safe",
                "--seed", "42",
            ],
            capture_output=True,
            text=True,
            cwd=str(_REPO_ROOT),
        )
        assert result.returncode == 0, (
            f"Expected exit 0 for high-edge synthetic run.\n"
            f"STDOUT:\n{result.stdout}\n"
            f"STDERR:\n{result.stderr}"
        )
        assert "SAFE" in result.stdout

    def test_cli_risky_synthetic_exits_nonzero(self, tmp_path):
        """Synthetic extremely-risky P&L must FAIL the gate and exit non-zero.

        SWEEP-F7 (R-639 §6.3): this test's name promised a non-zero exit and it
        asserted nothing of the kind. It checked only that
        docs/scaling-validation/cli-smoke-risky.md EXISTED — and that file is
        TRACKED IN GIT, so the assertion was satisfied by a copy committed to
        the repo whether or not this subprocess produced anything at all. The
        exit code, which is the whole subject of the test, was never read.

        The old comment justified that with "a lucky seed" possibly passing.
        The seed is PINNED at 42, so the outcome is deterministic — measured:
        exit 1, "UNSAFE (100.00% breach)" against a 5% gate. Not marginal, and
        not luck.

        The report now goes to an UNTRACKED name that is removed before and
        after, so (a) existence is evidence about THIS run, and (b) the test
        stops rewriting a tracked artifact and dirtying a shared worktree.
        """
        script = str(_REPO_ROOT / "scripts" / "validate-scaling-schedule.py")
        report = _REPO_ROOT / "docs" / "scaling-validation" / "cli-smoke-risky-run.md"
        report.unlink(missing_ok=True)
        try:
            result = subprocess.run(
                [
                    sys.executable, script,
                    "--synth-daily-pnl", "0.5",
                    "--synth-daily-std", "500.0",   # huge variance vs tiny edge
                    "--synth-n-days", "252",
                    "--tiers", "50",                 # top tier only — most likely to breach
                    "--n-sims", "500",
                    "--n-steps", "63",
                    "--report-name", "cli-smoke-risky-run",
                    "--seed", "42",
                ],
                capture_output=True,
                text=True,
                cwd=str(_REPO_ROOT),
            )
            assert result.returncode != 0, (
                f"Expected non-zero exit: a 100% breach rate against a 5% gate must "
                f"fail CLOSED.\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )
            # POSITIVE WITNESS: a non-zero exit alone is also what an ImportError
            # or a bad argument produces. This proves the gate actually ran and
            # reached a verdict, so the exit code means what the name says.
            assert "UNSAFE" in result.stdout, (
                f"Non-zero exit without an UNSAFE verdict — the process failed "
                f"before evaluating the gate, so the exit code is not evidence "
                f"about scaling safety.\nSTDOUT:\n{result.stdout}\n"
                f"STDERR:\n{result.stderr}"
            )
            assert report.exists(), (
                f"Report file must be created regardless of pass/fail.\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )
        finally:
            report.unlink(missing_ok=True)

    def test_cli_no_data_source_exits_nonzero(self):
        """CLI with no data source must exit non-zero (fail-CLOSED)."""
        script = str(_REPO_ROOT / "scripts" / "validate-scaling-schedule.py")
        result = subprocess.run(
            [
                sys.executable, script,
                "--report-name", "cli-no-data",
            ],
            capture_output=True,
            text=True,
            cwd=str(_REPO_ROOT),
        )
        assert result.returncode != 0, (
            "Expected non-zero exit when no data source is provided.\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )

    def test_cli_report_file_created(self):
        """CLI must create report file in docs/scaling-validation/.

        SWEEP-F10 (R-646 §4): this test used `cli-report-existence-test.md`,
        which is TRACKED IN GIT, so every run left a modified tracked file in a
        shared worktree — the report carries a generation timestamp, so the
        content always differs. `git status` is a load-bearing instrument on
        this campaign, and a tree permanently dirty from test runs trains every
        seat to skim past dirty files.

        A TEST WANTS A TEMP FILE AND THIS ONE GRABBED A COMMITTED ONE. The
        report name is now untracked and removed before AND after the run, so
        existence is evidence about THIS run and the tree is left as found.
        """
        script = str(_REPO_ROOT / "scripts" / "validate-scaling-schedule.py")
        report_name = "cli-report-existence-run"
        report_path = _REPO_ROOT / "docs" / "scaling-validation" / f"{report_name}.md"
        report_path.unlink(missing_ok=True)

        try:
            result = subprocess.run(
                [
                    sys.executable, script,
                    "--synth-daily-pnl", "30.0",
                    "--synth-daily-std", "60.0",
                    "--tiers", "9",
                    "--n-sims", "100",
                    "--n-steps", "30",
                    "--report-name", report_name,
                    "--seed", "7",
                ],
                capture_output=True,
                text=True,
                cwd=str(_REPO_ROOT),
            )
            # POSITIVE WITNESS: the file existing proves nothing about WHY it
            # exists unless the run that wrote it also reached a verdict. A
            # crash that happened to leave a partial file would otherwise pass.
            #
            # 🛑 NOT `returncode == 0`: I asserted that first and it was WRONG.
            # `[MEASURED HERE]` this fixture (tier 9, seed 7) is not benign — it
            # returns UNSAFE at an 18.00% breach and the CLI correctly exits 1.
            # The subject of THIS test is that a report is written REGARDLESS of
            # verdict, so the witness must be that a verdict was reached, not
            # that it was a passing one. Asserting exit 0 here would have
            # encoded "the gate must pass" into a file-existence test.
            assert "SAFE" in result.stdout or "UNSAFE" in result.stdout, (
                f"CLI produced no verdict — the report cannot be evidence about "
                f"a run that never evaluated a tier.\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )
            assert report_path.exists(), (
                f"Report file was not created at {report_path}\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )
            assert report_path.stat().st_size > 0, "report file is empty"
        finally:
            report_path.unlink(missing_ok=True)


# ─── Integration: simulate_firm_survival (real, no mock) ─────────────────────

class TestRealSurvivalSimIntegration:
    """Integration tests using the real simulate_firm_survival function.

    These tests do NOT import the backtester — only monte_carlo.py is needed.
    """

    def _build_cumulative_paths(
        self,
        n_sims: int,
        n_steps: int,
        daily_mean: float,
        daily_std: float,
        n_contracts: int,
        seed: int = 0,
    ) -> np.ndarray:
        """Build cumulative-P&L paths directly (no mock, no backtester)."""
        rng = np.random.default_rng(seed)
        step_pnl = rng.normal(
            loc=daily_mean * n_contracts,
            scale=daily_std * n_contracts,
            size=(n_sims, n_steps),
        )
        return np.cumsum(step_pnl, axis=1)

    def test_high_edge_low_vol_passes_gate(self):
        """High-edge, low-vol distribution should pass the 5% breach gate."""
        from src.engine.monte_carlo import simulate_firm_survival

        paths = self._build_cumulative_paths(
            n_sims=1000, n_steps=63,
            daily_mean=40.0, daily_std=30.0,
            n_contracts=9, seed=42,
        )
        result = simulate_firm_survival(
            paths=paths,
            firm_key="topstep_50k",
            account_size=50000.0,
            daily_trades_per_day=1,
            granularity="day",
            symbol="MES",
        )
        breach_pct = float(np.mean(result["breach_mask"]))
        assert breach_pct < 0.05, (
            f"High-edge low-vol strategy should breach < 5% at tier 9. "
            f"Got {breach_pct:.3f}"
        )

    def test_high_vol_no_edge_fails_gate_at_large_tier(self):
        """High-vol, near-zero-edge distribution should breach > 5% at 50 contracts."""
        from src.engine.monte_carlo import simulate_firm_survival

        paths = self._build_cumulative_paths(
            n_sims=1000, n_steps=63,
            daily_mean=0.5, daily_std=250.0,
            n_contracts=50, seed=42,
        )
        result = simulate_firm_survival(
            paths=paths,
            firm_key="topstep_50k",
            account_size=50000.0,
            daily_trades_per_day=1,
            granularity="day",
            symbol="MES",
        )
        breach_pct = float(np.mean(result["breach_mask"]))
        assert breach_pct >= 0.05, (
            f"High-vol near-zero-edge strategy at 50 contracts should breach >= 5%. "
            f"Got {breach_pct:.3f}"
        )

    def test_breach_mask_in_result(self):
        """simulate_firm_survival must return breach_mask key."""
        from src.engine.monte_carlo import simulate_firm_survival

        paths = self._build_cumulative_paths(500, 30, 10.0, 50.0, 9, seed=1)
        result = simulate_firm_survival(
            paths=paths, firm_key="topstep_50k", account_size=50000.0
        )
        assert "breach_mask" in result, (
            "simulate_firm_survival must return breach_mask (hardened 2026-06-22)"
        )
        mask = result["breach_mask"]
        assert mask.shape == (500,), f"Expected breach_mask shape (500,), got {mask.shape}"
        assert mask.dtype in (np.uint8, np.int8, np.bool_), (
            f"breach_mask must be integer/bool dtype, got {mask.dtype}"
        )

    def test_determinism_real_sim(self):
        """Same paths + same seed sequence must produce identical breach_pct."""
        from src.engine.monte_carlo import simulate_firm_survival

        for seed in [0, 13, 99]:
            paths_a = self._build_cumulative_paths(200, 30, 20.0, 80.0, 12, seed=seed)
            paths_b = self._build_cumulative_paths(200, 30, 20.0, 80.0, 12, seed=seed)
            np.testing.assert_array_equal(paths_a, paths_b, err_msg="Paths not deterministic")

            result_a = simulate_firm_survival(
                paths=paths_a, firm_key="topstep_50k", account_size=50000.0
            )
            result_b = simulate_firm_survival(
                paths=paths_b, firm_key="topstep_50k", account_size=50000.0
            )
            np.testing.assert_array_equal(
                result_a["breach_mask"], result_b["breach_mask"],
                err_msg=f"Non-deterministic breach_mask for seed={seed}",
            )

    def test_unknown_firm_returns_error_not_crash(self):
        """Unknown firm_key must return error dict, not raise."""
        from src.engine.monte_carlo import simulate_firm_survival

        paths = self._build_cumulative_paths(10, 10, 0.0, 10.0, 1, seed=0)
        result = simulate_firm_survival(paths=paths, firm_key="nonexistent_firm_xyz")
        assert "error" in result, (
            "Unknown firm_key must return {'error': ...} not raise"
        )
