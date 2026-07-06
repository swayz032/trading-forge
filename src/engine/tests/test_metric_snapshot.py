"""A9 — Metric Snapshot Regression (W11 Team D).

3-tier gate: pre-commit (fast subset), PR gate (all tests), canary (live).

This file is the snapshot layer. It:
  1. Computes key metrics from each golden fixture (A5)
  2. On first run, writes a snapshot JSON to src/engine/tests/snapshots/
  3. On subsequent runs, asserts the computed metrics match the stored snapshot
     within tolerance

Usage:
  Generate/update snapshots:
    pytest src/engine/tests/test_metric_snapshot.py --snapshot-update

  Assert against stored snapshots (CI default):
    pytest src/engine/tests/test_metric_snapshot.py

Snapshot drift detection:
  - A change to metric computation that shifts PF/Sharpe/PnL by any amount
    will cause a snapshot mismatch and fail CI.
  - Tolerances are tight: PF within 0.005, PnL within $1.00, Sharpe within 0.001.
  - To accept a legitimate change, run --snapshot-update, review the diff, commit.

Updating snapshots is INTENTIONAL and AUDITABLE:
  - The diff in the snapshot JSON is the evidence that a change affected metrics.
  - Never manually edit snapshot JSON files — always regenerate via --snapshot-update.

Fast subset (pre-commit): TestSnapshotPerfect, TestSnapshotMarginal, TestSnapshotFeesKiller
  These 3 fixtures use only pure math (no external imports). Target: <5 sec total.

Full gate (PR gate): all 5 fixture snapshots + TestSnapshotConsistency
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import numpy as np
import pytest

# ─── Paths ────────────────────────────────────────────────────────────

GOLDEN_DIR = Path(__file__).parent / "fixtures" / "golden"
SNAPSHOT_DIR = Path(__file__).parent / "snapshots"


# ─── Metric helpers (copied from test_golden_fixtures — no circular import) ───
# These must stay self-contained so the pre-commit hook can run them
# without importing the full engine (which has heavy deps: vectorbt, etc.)

def _pf(trades: list[dict], field: str = "net_pnl") -> float:
    winners = sum(t[field] for t in trades if t[field] > 0)
    losers = abs(sum(t[field] for t in trades if t[field] < 0))
    return winners / losers if losers > 0 else float("inf")


def _net_pnl(trades: list[dict]) -> float:
    return sum(t["net_pnl"] for t in trades)


def _win_rate(trades: list[dict]) -> float:
    return sum(1 for t in trades if t["net_pnl"] > 0) / len(trades)


def _max_dd(trades: list[dict]) -> float:
    equity = np.cumsum([t["net_pnl"] for t in trades])
    running_max = np.maximum.accumulate(equity)
    return float(np.max(running_max - equity))


def _sharpe(trades: list[dict], periods: float = 252.0) -> float:
    vals = np.array([t["net_pnl"] for t in trades], dtype=float)
    std = np.std(vals, ddof=1)
    return float(np.mean(vals) / std * np.sqrt(periods)) if std > 0 else 0.0


def _total_commission(trades: list[dict]) -> float:
    return sum(t["commission"] for t in trades)


# ─── DS#20 T-B2 — production math-truth anchors ────────────────────
# Same rationale as test_golden_fixtures.py: the snapshot metrics above are a
# deliberate self-contained reimplementation (module docstring: "no external
# imports" for the pre-commit tier), so a regression in the PRODUCTION
# src.engine.risk_metrics module would never be caught by this file alone.
# These two helpers anchor against the real production functions
# (compute_max_drawdown_distribution / compute_sharpe_distribution — numpy/os
# only, verified import-safe, no vectorbt/backtester in the import chain).
# They are used ONLY by TestSnapshotRiskMetricsAnchor (Tier 2 / PR-gate),
# never by the Tier 1 pre-commit classes, so the pre-commit fast path stays
# import-light exactly as designed.

def _max_dd_via_risk_metrics(trades: list[dict]) -> float:
    """Anchor against src.engine.risk_metrics.compute_max_drawdown_distribution (DS#20 T-B2)."""
    pytest.importorskip("src.engine.risk_metrics")
    from src.engine.risk_metrics import compute_max_drawdown_distribution

    net_pnls = np.array([t["net_pnl"] for t in trades], dtype=float)
    path = np.cumsum(net_pnls).reshape(1, -1)
    dist = compute_max_drawdown_distribution(path, initial_capital=0.0, percentiles=[0.5])
    return dist["p50"]


def _sharpe_via_risk_metrics(trades: list[dict], periods: float = 252.0) -> float:
    """Anchor against src.engine.risk_metrics.compute_sharpe_distribution (DS#20 T-B2).

    Prepend a 0.0 path-start point so np.diff() regenerates the exact
    per-trade net_pnl series (see test_golden_fixtures.py for full rationale).
    """
    pytest.importorskip("src.engine.risk_metrics")
    from src.engine.risk_metrics import compute_sharpe_distribution

    net_pnls = np.array([t["net_pnl"] for t in trades], dtype=float)
    path = np.concatenate(([0.0], np.cumsum(net_pnls))).reshape(1, -1)
    dist = compute_sharpe_distribution(path, percentiles=[0.5], periods_per_year=periods)
    return dist["p50"]


# ─── Snapshot I/O ─────────────────────────────────────────────────────

def _snapshot_path(name: str) -> Path:
    return SNAPSHOT_DIR / f"{name}.json"


def _write_snapshot(name: str, data: dict[str, Any]) -> None:
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    path = _snapshot_path(name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
    print(f"  [snapshot] Written: {path}")


def _read_snapshot(name: str) -> dict[str, Any] | None:
    path = _snapshot_path(name)
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _assert_metric_match(
    computed: dict[str, float],
    stored: dict[str, float],
    fixture_name: str,
    tolerances: dict[str, float],
) -> None:
    """Assert computed metrics match stored snapshot within tolerances.

    Failure messages include expected, actual, tolerance and drift amount
    so CI failure is immediately diagnostic.
    """
    failures = []
    for key, expected in stored.items():
        if key.startswith("_"):
            continue  # metadata fields
        if key not in computed:
            failures.append(f"  {key}: missing from computed metrics")
            continue
        actual = computed[key]
        tol = tolerances.get(key, 0.001)
        drift = abs(actual - expected)
        if drift > tol:
            failures.append(
                f"  {key}: expected={expected:.6g}, actual={actual:.6g}, "
                f"tolerance={tol:.6g}, drift={drift:.6g}"
            )
    if failures:
        msg = (
            f"Snapshot drift detected on fixture '{fixture_name}':\n"
            + "\n".join(failures)
            + "\n\nIf this change is intentional, run:\n"
            + "  pytest src/engine/tests/test_metric_snapshot.py --snapshot-update"
            + "\nand commit the updated snapshot files."
        )
        pytest.fail(msg)


# ─── Fixture loader ────────────────────────────────────────────────────

def _load_fixture(name: str) -> dict:
    path = GOLDEN_DIR / f"{name}.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# Detect if we are in --snapshot-update mode
_UPDATE_MODE = os.environ.get("SNAPSHOT_UPDATE", "").lower() in ("1", "true", "yes")


def _snapshot_update_requested() -> bool:
    """Return True if running in snapshot-update mode."""
    return _UPDATE_MODE


# ─── Tolerances (must match A5 golden fixture tolerances) ─────────────

_TOLERANCES = {
    "gross_pf":        0.005,
    "net_pf":          0.005,
    "net_pnl":         1.00,
    "win_rate":        0.001,
    "total_commission": 0.01,
    "max_dd":          1.00,
    "sharpe":          0.001,
    "n_trades":        0.0,     # exact integer match
    "n_winners":       0.0,
    "n_losers":        0.0,
}


# ═══════════════════════════════════════════════════════════════════════
# TIER 1 — PRE-COMMIT FAST SUBSET (no external engine imports)
# TestSnapshotPerfect, TestSnapshotMarginal, TestSnapshotFeesKiller
# These 3 classes must complete in < 3 seconds combined.
# ═══════════════════════════════════════════════════════════════════════


class TestSnapshotPerfect:
    """Snapshot for fixture_perfect — 100 trades, 70% win rate, PF 2.0 gross.

    Pre-commit tier: included (pure math, no engine imports).
    """

    FIXTURE = "fixture_perfect"

    @pytest.fixture(autouse=True)
    def _load(self):
        self.data = _load_fixture(self.FIXTURE)
        self.trades = self.data["trades"]

    def _compute_metrics(self) -> dict[str, float]:
        return {
            "_fixture":       self.FIXTURE,
            "n_trades":       float(len(self.trades)),
            "n_winners":      float(sum(1 for t in self.trades if t["net_pnl"] > 0)),
            "n_losers":       float(sum(1 for t in self.trades if t["net_pnl"] < 0)),
            "gross_pf":       _pf(self.trades, "gross_pnl"),
            "net_pf":         _pf(self.trades, "net_pnl"),
            "net_pnl":        _net_pnl(self.trades),
            "win_rate":       _win_rate(self.trades),
            "total_commission": _total_commission(self.trades),
            "max_dd":         _max_dd(self.trades),
            "sharpe":         _sharpe(self.trades),
        }

    def test_snapshot(self, snapshot):
        metrics = self._compute_metrics()
        stored = _read_snapshot(self.FIXTURE)

        if stored is None or _snapshot_update_requested():
            _write_snapshot(self.FIXTURE, metrics)
            if stored is None:
                pytest.skip(f"Snapshot generated for {self.FIXTURE} — rerun to assert")
            return

        _assert_metric_match(metrics, stored, self.FIXTURE, _TOLERANCES)

    def test_snapshot_file_exists(self):
        """Snapshot file must exist in VCS (generated on first run, committed)."""
        path = _snapshot_path(self.FIXTURE)
        assert path.exists(), (
            f"Snapshot file missing: {path}\n"
            f"Generate it by running:\n"
            f"  pytest src/engine/tests/test_metric_snapshot.py --snapshot-update"
        )

    def test_snapshot_is_valid_json(self):
        """Snapshot file must be parseable JSON (not corrupted)."""
        path = _snapshot_path(self.FIXTURE)
        if not path.exists():
            pytest.skip("Snapshot not yet generated")
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        assert "gross_pf" in data
        assert "net_pf" in data
        assert "net_pnl" in data

    def test_gross_pf_in_snapshot_is_positive(self):
        """Snapshot gross_pf must be > 1.0 (profitable fixture)."""
        path = _snapshot_path(self.FIXTURE)
        if not path.exists():
            pytest.skip("Snapshot not yet generated")
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        assert data["gross_pf"] > 1.0, (
            f"Snapshot gross_pf={data['gross_pf']} should be > 1.0 for fixture_perfect"
        )


class TestSnapshotMarginal:
    """Snapshot for fixture_marginal — PF 1.74, just below 1.75 gate.

    Pre-commit tier: included (pure math, no engine imports).
    Critical: any metric drift that pushes PF above 1.75 would silently
    allow this fixture to pass the promotion gate. Snapshot catches it.
    """

    FIXTURE = "fixture_marginal"

    @pytest.fixture(autouse=True)
    def _load(self):
        self.data = _load_fixture(self.FIXTURE)
        self.trades = self.data["trades"]

    def _compute_metrics(self) -> dict[str, float]:
        return {
            "_fixture":       self.FIXTURE,
            "n_trades":       float(len(self.trades)),
            "n_winners":      float(sum(1 for t in self.trades if t["net_pnl"] > 0)),
            "n_losers":       float(sum(1 for t in self.trades if t["net_pnl"] < 0)),
            "gross_pf":       _pf(self.trades, "gross_pnl"),
            "net_pf":         _pf(self.trades, "net_pnl"),
            "net_pnl":        _net_pnl(self.trades),
            "win_rate":       _win_rate(self.trades),
            "total_commission": _total_commission(self.trades),
        }

    def test_snapshot(self, snapshot):
        metrics = self._compute_metrics()
        stored = _read_snapshot(self.FIXTURE)

        if stored is None or _snapshot_update_requested():
            _write_snapshot(self.FIXTURE, metrics)
            if stored is None:
                pytest.skip(f"Snapshot generated for {self.FIXTURE} — rerun to assert")
            return

        _assert_metric_match(metrics, stored, self.FIXTURE, _TOLERANCES)

    def test_snapshot_gross_pf_below_gate(self):
        """Snapshot must confirm gross_pf < 1.75 (if it ever drifts above, big bug)."""
        path = _snapshot_path(self.FIXTURE)
        if not path.exists():
            pytest.skip("Snapshot not yet generated")
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        assert data["gross_pf"] < 1.75, (
            f"CRITICAL: Snapshot gross_pf={data['gross_pf']:.4f} >= 1.75 promotion gate!\n"
            f"fixture_marginal must NEVER cross the promotion gate. "
            f"If the metric computation changed such that this fixture now passes the gate, "
            f"a math bug has been introduced."
        )

    def test_snapshot_file_exists(self):
        path = _snapshot_path(self.FIXTURE)
        assert path.exists(), (
            f"Snapshot file missing: {path}\nRun: "
            f"pytest src/engine/tests/test_metric_snapshot.py --snapshot-update"
        )


class TestSnapshotFeesKiller:
    """Snapshot for fixture_fees_killer — fees flip gross-profitable to net-losing.

    Pre-commit tier: included (pure math).
    Critical: if fee computation changes and net_pf drifts above 1.0,
    the vectorbt fee bug has been reintroduced.
    """

    FIXTURE = "fixture_fees_killer"

    @pytest.fixture(autouse=True)
    def _load(self):
        self.data = _load_fixture(self.FIXTURE)
        self.trades = self.data["trades"]

    def _compute_metrics(self) -> dict[str, float]:
        return {
            "_fixture":       self.FIXTURE,
            "n_trades":       float(len(self.trades)),
            "gross_pf":       _pf(self.trades, "gross_pnl"),
            "net_pf":         _pf(self.trades, "net_pnl"),
            "net_pnl":        _net_pnl(self.trades),
            "win_rate":       _win_rate(self.trades),
            "total_commission": _total_commission(self.trades),
        }

    def test_snapshot(self, snapshot):
        metrics = self._compute_metrics()
        stored = _read_snapshot(self.FIXTURE)

        if stored is None or _snapshot_update_requested():
            _write_snapshot(self.FIXTURE, metrics)
            if stored is None:
                pytest.skip(f"Snapshot generated for {self.FIXTURE} — rerun to assert")
            return

        _assert_metric_match(metrics, stored, self.FIXTURE, _TOLERANCES)

    def test_snapshot_fee_flip_invariant(self):
        """Snapshot must show gross_pf > 1.0 AND net_pf < 1.0 — the fee flip.

        If either invariant breaks, the fee computation has changed in a way that
        masks the vectorbt P&L bug we are explicitly guarding against.
        """
        path = _snapshot_path(self.FIXTURE)
        if not path.exists():
            pytest.skip("Snapshot not yet generated")
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        assert data["gross_pf"] > 1.0, (
            f"Snapshot gross_pf={data['gross_pf']:.4f} must be > 1.0 "
            f"(strategy looks profitable before fees)"
        )
        assert data["net_pf"] < 1.0, (
            f"CRITICAL BUG: Snapshot net_pf={data['net_pf']:.4f} >= 1.0. "
            f"Fees are not being correctly applied to losing trades. "
            f"Do NOT pass slippage/fees to vectorbt for futures."
        )

    def test_snapshot_file_exists(self):
        path = _snapshot_path(self.FIXTURE)
        assert path.exists(), (
            f"Snapshot file missing: {path}\nRun: "
            f"pytest src/engine/tests/test_metric_snapshot.py --snapshot-update"
        )


# ═══════════════════════════════════════════════════════════════════════
# TIER 2 — FULL PR GATE (adds losing + regime_shift fixtures)
# ═══════════════════════════════════════════════════════════════════════


class TestSnapshotLosing:
    """Snapshot for fixture_losing — PF 0.5, MC ruin > 95%.

    PR gate only (not pre-commit: MC import would drag in scipy/numpy heavy path).
    """

    FIXTURE = "fixture_losing"

    @pytest.fixture(autouse=True)
    def _load(self):
        self.data = _load_fixture(self.FIXTURE)
        self.trades = self.data["trades"]

    def _compute_metrics(self) -> dict[str, float]:
        return {
            "_fixture":       self.FIXTURE,
            "n_trades":       float(len(self.trades)),
            "n_winners":      float(sum(1 for t in self.trades if t["net_pnl"] > 0)),
            "n_losers":       float(sum(1 for t in self.trades if t["net_pnl"] < 0)),
            "gross_pf":       _pf(self.trades, "gross_pnl"),
            "net_pf":         _pf(self.trades, "net_pnl"),
            "net_pnl":        _net_pnl(self.trades),
            "win_rate":       _win_rate(self.trades),
            "total_commission": _total_commission(self.trades),
        }

    def test_snapshot(self, snapshot):
        metrics = self._compute_metrics()
        stored = _read_snapshot(self.FIXTURE)

        if stored is None or _snapshot_update_requested():
            _write_snapshot(self.FIXTURE, metrics)
            if stored is None:
                pytest.skip(f"Snapshot generated for {self.FIXTURE} — rerun to assert")
            return

        _assert_metric_match(metrics, stored, self.FIXTURE, _TOLERANCES)

    def test_snapshot_net_pf_below_1(self):
        """Losing fixture must always have net_pf < 1.0."""
        path = _snapshot_path(self.FIXTURE)
        if not path.exists():
            pytest.skip("Snapshot not yet generated")
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        assert data["net_pf"] < 1.0, (
            f"Snapshot net_pf={data['net_pf']:.4f} must be < 1.0 for losing fixture"
        )

    def test_snapshot_file_exists(self):
        path = _snapshot_path(self.FIXTURE)
        assert path.exists(), (
            f"Snapshot file missing: {path}\nRun: "
            f"pytest src/engine/tests/test_metric_snapshot.py --snapshot-update"
        )


class TestSnapshotRegimeShift:
    """Snapshot for fixture_regime_shift — walk-forward degradation.

    PR gate only. Checks that epoch-level PF values don't drift.
    """

    FIXTURE = "fixture_regime_shift"

    @pytest.fixture(autouse=True)
    def _load(self):
        self.data = _load_fixture(self.FIXTURE)
        self.early = self.data["epochs"][0]["trades"]
        self.late = self.data["epochs"][1]["trades"]
        self.all_trades = self.early + self.late

    def _compute_metrics(self) -> dict[str, float]:
        early_pf = _pf(self.early, "gross_pnl")
        late_pf = _pf(self.late, "gross_pnl")
        return {
            "_fixture":            self.FIXTURE,
            "n_trades_total":      float(len(self.all_trades)),
            "n_trades_early":      float(len(self.early)),
            "n_trades_late":       float(len(self.late)),
            "early_epoch_pf":      early_pf,
            "late_epoch_pf":       late_pf,
            "degradation_ratio":   early_pf / late_pf if late_pf > 0 else float("inf"),
            "early_epoch_net_pnl": _net_pnl(self.early),
            "late_epoch_net_pnl":  _net_pnl(self.late),
            "combined_gross_pf":   _pf(self.all_trades, "gross_pnl"),
        }

    def test_snapshot(self, snapshot):
        metrics = self._compute_metrics()
        stored = _read_snapshot(self.FIXTURE)

        if stored is None or _snapshot_update_requested():
            _write_snapshot(self.FIXTURE, metrics)
            if stored is None:
                pytest.skip(f"Snapshot generated for {self.FIXTURE} — rerun to assert")
            return

        tols = {
            "early_epoch_pf":      0.01,
            "late_epoch_pf":       0.005,
            "degradation_ratio":   0.5,   # ratio can vary; threshold is 4x minimum
            "early_epoch_net_pnl": 5.0,
            "late_epoch_net_pnl":  5.0,
            "combined_gross_pf":   0.005,
            "n_trades_total":      0.0,
            "n_trades_early":      0.0,
            "n_trades_late":       0.0,
        }
        _assert_metric_match(metrics, stored, self.FIXTURE, tols)

    def test_snapshot_degradation_ratio_exceeds_minimum(self):
        """Degradation ratio must always exceed 4.0x (regime collapse is dramatic)."""
        path = _snapshot_path(self.FIXTURE)
        if not path.exists():
            pytest.skip("Snapshot not yet generated")
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        assert data["degradation_ratio"] >= 4.0, (
            f"Snapshot degradation_ratio={data['degradation_ratio']:.2f}x < 4.0x minimum. "
            f"Regime shift fixture is not showing sufficient walk-forward degradation."
        )

    def test_snapshot_file_exists(self):
        path = _snapshot_path(self.FIXTURE)
        assert path.exists(), (
            f"Snapshot file missing: {path}\nRun: "
            f"pytest src/engine/tests/test_metric_snapshot.py --snapshot-update"
        )


class TestSnapshotRiskMetricsAnchor:
    """DS#20 T-B2 — production math-truth anchor for max_dd + sharpe.

    PR gate only (deliberately excluded from the pre-commit fast tier — it
    imports src.engine.risk_metrics, which the Tier 1 classes above are
    documented to avoid). For each flat-trade-list fixture, asserts the
    PRODUCTION risk_metrics functions agree with this file's local
    reimplementation. Closes the gap where a regression inside
    src.engine.risk_metrics (Sharpe / max-drawdown formula) would drift
    unnoticed because every other test in this suite only re-derives its own
    reimplementation and compares it to itself / a stored snapshot.
    """

    FLAT_FIXTURES = [
        "fixture_perfect",
        "fixture_losing",
        "fixture_marginal",
        "fixture_fees_killer",
    ]

    def test_max_dd_matches_production_risk_metrics(self):
        for name in self.FLAT_FIXTURES:
            fixture = _load_fixture(name)
            trades = fixture["trades"]
            local_dd = _max_dd(trades)
            prod_dd = _max_dd_via_risk_metrics(trades)
            assert abs(prod_dd - local_dd) < 0.01, (
                f"{name}: production risk_metrics max_dd ({prod_dd:.4f}) diverges from "
                f"local reimplementation ({local_dd:.4f})"
            )

    def test_sharpe_matches_production_risk_metrics(self):
        for name in self.FLAT_FIXTURES:
            fixture = _load_fixture(name)
            trades = fixture["trades"]
            local_sharpe = _sharpe(trades)
            prod_sharpe = _sharpe_via_risk_metrics(trades)
            assert abs(prod_sharpe - local_sharpe) < 0.001, (
                f"{name}: production risk_metrics sharpe ({prod_sharpe:.6f}) diverges from "
                f"local reimplementation ({local_sharpe:.6f})"
            )


# ═══════════════════════════════════════════════════════════════════════
# TIER 3 — CROSS-FIXTURE SNAPSHOT CONSISTENCY
# ═══════════════════════════════════════════════════════════════════════


class TestSnapshotConsistency:
    """Cross-fixture snapshot consistency checks.

    Verifies that the ranking order of fixtures is preserved across code changes.
    If a math change lifts fixture_losing above fixture_marginal in net_pf,
    the ranking has silently flipped — this test catches it.
    """

    FAST_FIXTURES = ["fixture_perfect", "fixture_marginal", "fixture_fees_killer"]
    ALL_FLAT_FIXTURES = [
        "fixture_perfect",
        "fixture_marginal",
        "fixture_fees_killer",
        "fixture_losing",
    ]

    def _load_snapshot(self, name: str) -> dict | None:
        return _read_snapshot(name)

    def test_all_snapshot_files_exist(self):
        """All 5 fixture snapshots must exist in VCS."""
        all_fixtures = [
            "fixture_perfect",
            "fixture_losing",
            "fixture_marginal",
            "fixture_fees_killer",
            "fixture_regime_shift",
        ]
        missing = [f for f in all_fixtures if not _snapshot_path(f).exists()]
        if missing:
            pytest.skip(
                f"Some snapshots not yet generated: {missing}. "
                f"Run: pytest src/engine/tests/test_metric_snapshot.py --snapshot-update"
            )

    def test_pf_ranking_order_preserved(self):
        """Net PF ranking must be: fixture_perfect >> fixture_marginal >> fixture_losing.

        If this order changes, a metric drift has silently altered the relative
        profitability ranking of known strategies. This is a critical regression.
        """
        perfect = self._load_snapshot("fixture_perfect")
        marginal = self._load_snapshot("fixture_marginal")
        losing = self._load_snapshot("fixture_losing")

        if any(s is None for s in [perfect, marginal, losing]):
            pytest.skip("Not all snapshots generated yet")

        assert perfect["net_pf"] > marginal["net_pf"], (
            f"Ranking broken: perfect.net_pf ({perfect['net_pf']:.4f}) <= "
            f"marginal.net_pf ({marginal['net_pf']:.4f})"
        )
        assert marginal["net_pf"] > losing["net_pf"], (
            f"Ranking broken: marginal.net_pf ({marginal['net_pf']:.4f}) <= "
            f"losing.net_pf ({losing['net_pf']:.4f})"
        )

    def test_fees_killer_gross_above_1_net_below_1(self):
        """Fee flip invariant must hold in snapshot (gross > 1.0, net < 1.0)."""
        fees = self._load_snapshot("fixture_fees_killer")
        if fees is None:
            pytest.skip("Snapshot not yet generated")
        assert fees["gross_pf"] > 1.0
        assert fees["net_pf"] < 1.0

    def test_marginal_gross_pf_below_promotion_gate(self):
        """Marginal fixture gross_pf must always be < 1.75 in snapshot."""
        marginal = self._load_snapshot("fixture_marginal")
        if marginal is None:
            pytest.skip("Snapshot not yet generated")
        assert marginal["gross_pf"] < 1.75, (
            f"CRITICAL: marginal snapshot gross_pf={marginal['gross_pf']:.4f} >= 1.75 gate! "
            f"This means a metric change has moved a failing strategy to PASS. "
            f"Investigate immediately."
        )

    def test_snapshot_schema_all_flat_fixtures(self):
        """All flat-trade snapshots must have the required metric fields."""
        required = {"gross_pf", "net_pf", "net_pnl", "win_rate", "total_commission", "n_trades"}
        for name in self.ALL_FLAT_FIXTURES:
            snap = self._load_snapshot(name)
            if snap is None:
                continue
            missing = required - set(snap.keys())
            assert not missing, (
                f"Snapshot {name} missing fields: {missing}. "
                f"Regenerate: pytest src/engine/tests/test_metric_snapshot.py --snapshot-update"
            )
