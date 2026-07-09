"""Regression tests for scripts/signature-divergence.py — the Signature Divergence Score (SDS)
harness built for the FVG Identity Dispatch Experiment
(docs/designs/fvg-identity-dispatch-experiment-2026-07-05.md, Part C).

These tests validate the SDS MATH itself against synthetic ground-truth fixtures with a KNOWN
answer (collapsed = families behaviorally indistinguishable by construction; separated =
families constructed to trade differently) — never a real backtest or the engine. That keeps
this suite fast and deterministic while still proving the statistic behaves correctly at both
extremes before it is ever trusted on real FVG-experiment data.

Since scripts/signature-divergence.py has a hyphenated filename (cannot be `import`ed with a
normal statement), it is loaded via importlib.util.spec_from_file_location, matching the existing
convention in tests/test_full_battery_mode_ab.py (registers into sys.modules first — required
for its @dataclass-decorated classes to resolve their own module at decoration time).
"""
from __future__ import annotations

import importlib.util
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).parent.parent
_SCRIPT_PATH = _REPO_ROOT / "scripts" / "signature-divergence.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("signature_divergence", _SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["signature_divergence"] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def sds():
    return _load_module()


# ─── Fixture builders (synthetic, deterministic — seeded) ──────────────────────────────────────

def _make_trades(n, entry_hour_mean, hold_mean, r_mean, r_std, rng):
    trades = []
    base = datetime(2026, 1, 5, tzinfo=timezone.utc)
    for i in range(n):
        entry_hour = max(0, min(23, int(rng.gauss(entry_hour_mean, 1.0))))
        entry_ts = base + timedelta(days=i, hours=entry_hour, minutes=rng.randint(0, 59))
        hold = max(5.0, rng.gauss(hold_mean, hold_mean * 0.2))
        exit_ts = entry_ts + timedelta(minutes=hold)
        r = rng.gauss(r_mean, r_std)
        trades.append(
            {
                "entry_ts": entry_ts.isoformat(),
                "exit_ts": exit_ts.isoformat(),
                "pnl": r * 100,
                "risk_points": 10.0,
                "point_value": 10.0,
            }
        )
    return trades


def _collapsed_manifest(n_per_strategy=40, seed=1):
    """Two 'families' whose trade-generation parameters are IDENTICAL — by construction there
    is no real behavioral difference between families, only sampling noise. A correct SDS
    computation must NOT confidently report identity preservation on this fixture."""
    rng = random.Random(seed)
    strategies = {}
    for fam in ("A", "B"):
        for sym in ("MES", "MNQ", "MCL"):
            strategies[f"fam{fam}_{sym}"] = {
                "name": f"concept{fam}_{sym.lower()}_15m",
                "symbol": sym,
                "timeframe": "15m",
                "trades": _make_trades(n_per_strategy, 12, 60, 0.1, 0.5, rng),
            }
    return {"strategies": strategies}


def _separated_manifest(n_per_strategy=40, seed=1):
    """Two families constructed with GENUINELY different entry-time / holding-time / R
    distributions — a correct SDS computation must confidently report separation."""
    rng = random.Random(seed)
    strategies = {}
    for sym in ("MES", "MNQ", "MCL"):
        strategies[f"famA_{sym}"] = {
            "name": f"conceptA_{sym.lower()}_15m",
            "symbol": sym,
            "timeframe": "15m",
            "trades": _make_trades(n_per_strategy, 14, 30, 0.3, 0.4, rng),
        }
    for sym in ("MES", "MNQ", "MCL"):
        strategies[f"famB_{sym}"] = {
            "name": f"conceptB_{sym.lower()}_15m",
            "symbol": sym,
            "timeframe": "15m",
            "trades": _make_trades(n_per_strategy, 9, 120, -0.1, 0.4, rng),
        }
    return {"strategies": strategies}


# ─── derive_family ──────────────────────────────────────────────────────────────────────────────

class TestDeriveFamily:
    def test_strips_symbol_and_timeframe_suffix(self, sds):
        assert sds.derive_family("buying_opportunity_mes_15m", "MES", "15m") == "buying_opportunity"

    def test_different_symbols_same_concept_collapse_to_one_family(self, sds):
        fam_a = sds.derive_family("buying_opportunity_mes_15m", "MES", "15m")
        fam_b = sds.derive_family("buying_opportunity_mnq_15m", "MNQ", "15m")
        fam_c = sds.derive_family("buying_opportunity_mcl_15m", "MCL", "15m")
        assert fam_a == fam_b == fam_c

    def test_missing_symbol_or_timeframe_does_not_crash(self, sds):
        assert sds.derive_family("some_concept", None, None) == "some_concept"


# ─── extract_samples honesty contract (never fabricates missing fields) ────────────────────────

class TestExtractSamples:
    def test_trade_missing_exit_ts_drops_from_holding_only(self, sds):
        entry = {
            "name": "x_mes_5m",
            "symbol": "MES",
            "timeframe": "5m",
            "trades": [
                {"entry_ts": "2026-01-05T14:30:00+00:00", "pnl": 50, "risk_points": 5.0, "point_value": 5.0}
            ],
        }
        s = sds.extract_samples("x", entry)
        assert s.entry_minutes.size == 1
        assert s.holding_minutes.size == 0
        assert s.r_multiples.size == 1

    def test_zero_risk_points_drops_from_r_component_only(self, sds):
        entry = {
            "name": "x_mes_5m",
            "symbol": "MES",
            "timeframe": "5m",
            "trades": [
                {
                    "entry_ts": "2026-01-05T14:30:00+00:00",
                    "exit_ts": "2026-01-05T15:00:00+00:00",
                    "pnl": 50,
                    "risk_points": 0,
                    "point_value": 5.0,
                }
            ],
        }
        s = sds.extract_samples("x", entry)
        assert s.entry_minutes.size == 1
        assert s.holding_minutes.size == 1
        assert s.r_multiples.size == 0

    def test_explicit_family_override_wins_over_derived(self, sds):
        entry = {"name": "buying_opportunity_mes_15m", "symbol": "MES", "timeframe": "15m", "family": "custom_fam", "trades": []}
        s = sds.extract_samples("x", entry)
        assert s.family == "custom_fam"


# ─── SDS math on synthetic ground truth ────────────────────────────────────────────────────────

class TestSdsGroundTruth:
    def test_separated_families_produce_sds_above_one(self, sds):
        manifest = _separated_manifest()
        samples = [sds.extract_samples(sid, e) for sid, e in manifest["strategies"].items()]
        result = sds.compute_sds(samples)
        assert result["sds"] is not None
        assert result["sds"] > 1.0, "genuinely different families must show inter > intra distance"

    def test_collapsed_families_bootstrap_ci_includes_no_change(self, sds):
        """The core false-positive guard for this whole harness: when families are constructed
        with NO real behavioral difference, the bootstrap 90% CI must not confidently exclude
        1.0 (SDS_ROSE_STABLE would be a false positive here)."""
        manifest = _collapsed_manifest()
        report = sds.compute_sds_report(manifest, n_boot=800, seed=1)
        assert report["verdict"] != sds.VERDICT_ROSE_STABLE, (
            "a construction with no real family difference must never report SDS_ROSE_STABLE"
        )

    def test_separated_families_bootstrap_ci_excludes_no_change(self, sds):
        manifest = _separated_manifest()
        report = sds.compute_sds_report(manifest, n_boot=800, seed=1)
        assert report["verdict"] == sds.VERDICT_ROSE_STABLE
        assert report["bootstrap"]["ci_low"] > sds.NO_CHANGE_SDS

    def test_small_n_caveat_present_when_below_threshold(self, sds):
        manifest = _separated_manifest()
        report = sds.compute_sds_report(manifest, n_boot=200, seed=1, small_n_threshold=50)
        assert "SMALL-N CAVEAT" in report["small_n_caveat"]
        assert report["n_strategies"] < 50

    def test_single_family_produces_none_sds_not_a_fabricated_number(self, sds):
        manifest = _separated_manifest()
        only_a = {
            sid: e for sid, e in manifest["strategies"].items() if e["name"].startswith("conceptA")
        }
        samples = [sds.extract_samples(sid, e) for sid, e in only_a.items()]
        result = sds.compute_sds(samples)
        assert result["mean_inter_D"] is None
        assert result["sds"] is None


# ─── Bootstrap self-duplicate-pair exclusion (regression for a real bug found during
#     harness validation: naive resampling let a strategy get compared to an in-resample
#     duplicate of ITSELF, spuriously shrinking mean_intra_D and inflating SDS) ────────────────

class TestBootstrapSelfDuplicateExclusion:
    def test_compute_sds_excludes_self_duplicate_pairs_when_origin_indices_given(self, sds):
        manifest = _collapsed_manifest(n_per_strategy=10)
        samples = [sds.extract_samples(sid, e) for sid, e in manifest["strategies"].items()]
        # Force a resample that duplicates index 0 into position 1 as well.
        resampled = [samples[0], samples[0]] + samples[2:]
        origin = [0, 0] + list(range(2, len(samples)))
        result = sds.compute_sds(resampled, origin_indices=origin)
        pair_ids = {(r["i"], r["j"]) for r in result["pair_details"]}
        assert (samples[0].strategy_id, samples[0].strategy_id) not in pair_ids

    def test_bootstrap_reports_self_duplicate_diagnostic(self, sds):
        manifest = _collapsed_manifest(n_per_strategy=10)
        samples = [sds.extract_samples(sid, e) for sid, e in manifest["strategies"].items()]
        boot = sds.bootstrap_sds(samples, n_boot=200, seed=1)
        assert boot["avg_self_duplicate_pair_frac"] is not None
        assert 0.0 <= boot["avg_self_duplicate_pair_frac"] <= 1.0


# ─── Pairwise distance component honesty (never zero-fills a missing component) ────────────────

class TestPairwiseDistanceHonesty:
    def test_missing_component_on_both_sides_is_skipped_not_zero_filled(self, sds):
        empty_a = sds.StrategySamples("a", "famA", entry_minutes=sds.np.array([]), holding_minutes=sds.np.array([10.0]), r_multiples=sds.np.array([0.5]), n_trades=1)
        empty_b = sds.StrategySamples("b", "famA", entry_minutes=sds.np.array([]), holding_minutes=sds.np.array([12.0]), r_multiples=sds.np.array([0.6]), n_trades=1)
        bounds = {"entry_minutes": (0.0, 1440.0), "holding_minutes": (0.0, 100.0), "r_multiples": (-2.0, 2.0)}
        result = sds.pairwise_distance(empty_a, empty_b, bounds)
        assert result["per_component"]["entry_minutes"]["wasserstein"] is None
        assert result["per_component"]["entry_minutes"]["cosine"] is None
        assert result["D"] is not None, "the other 2 components still have data -> D is still computable"
