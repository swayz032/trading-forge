"""TDD tests for A1 — Determinism Enforcement.

Verification gate (per plan): run same backtest fixture 10 times in CI mode;
assert byte-equality of output JSON across all 10 runs.

Test structure:
1. Unit tests for determinism.py module (env vars, enable_determinism, assert_deterministic, canonicalize_result).
2. Integration test: 10 identical synthetic backtest runs → byte-equal canonical JSON.
3. Threadpoolctl integration test.
4. env var propagation test.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timedelta
from typing import Any

import numpy as np
import polars as pl
import pytest

# ─── Unit: env var application ───────────────────────────────────────────────

class TestEnvVarApplication:
    """Env vars must be set at module import time."""

    def test_mkl_cbwr_set(self):
        assert os.environ.get("MKL_CBWR") == "COMPATIBLE", (
            "MKL_CBWR must be COMPATIBLE for FP rounding determinism"
        )

    def test_openblas_num_threads_set(self):
        assert os.environ.get("OPENBLAS_NUM_THREADS") == "1", (
            "OPENBLAS_NUM_THREADS must be 1 to prevent reduction-order drift"
        )

    def test_blis_num_threads_set(self):
        assert os.environ.get("BLIS_NUM_THREADS") == "1", (
            "BLIS_NUM_THREADS must be 1"
        )

    def test_omp_num_threads_set(self):
        assert os.environ.get("OMP_NUM_THREADS") == "1", (
            "OMP_NUM_THREADS must be 1 to prevent OpenMP parallel reduction drift"
        )

    def test_all_four_vars_present(self):
        """All 4 vars must be set together — one missing = nondeterminism leak."""
        from src.engine.determinism import _DETERMINISM_ENV_VARS
        for key, expected in _DETERMINISM_ENV_VARS.items():
            assert os.environ.get(key) == expected, f"{key} mismatch"


# ─── Unit: assert_deterministic ──────────────────────────────────────────────

class TestAssertDeterministic:
    def test_passes_when_vars_set(self):
        from src.engine.determinism import assert_deterministic
        # conftest autouse fixture has already called enable_determinism()
        # so all vars are set — should not raise
        assert_deterministic()

    def test_raises_when_var_missing(self, monkeypatch):
        from src.engine.determinism import assert_deterministic
        monkeypatch.delenv("MKL_CBWR", raising=False)
        with pytest.raises(RuntimeError, match="MKL_CBWR"):
            assert_deterministic()

    def test_raises_when_var_wrong(self, monkeypatch):
        from src.engine.determinism import assert_deterministic
        monkeypatch.setenv("OPENBLAS_NUM_THREADS", "4")
        with pytest.raises(RuntimeError, match="OPENBLAS_NUM_THREADS"):
            assert_deterministic()


# ─── Unit: enable_determinism ────────────────────────────────────────────────

class TestEnableDeterminism:
    def test_idempotent(self):
        """Calling enable_determinism twice should not raise."""
        from src.engine.determinism import enable_determinism
        enable_determinism(seed=42)
        enable_determinism(seed=42)

    def test_seeds_numpy_global_rng(self):
        from src.engine.determinism import enable_determinism
        enable_determinism(seed=99)
        a = np.random.rand(5)
        enable_determinism(seed=99)
        b = np.random.rand(5)
        np.testing.assert_array_equal(a, b, err_msg="numpy global RNG not deterministic after re-seed")

    def test_threadpoolctl_available(self):
        """threadpoolctl must be importable — hard fail if missing."""
        import threadpoolctl  # noqa: F401


# ─── Unit: canonicalize_result ───────────────────────────────────────────────

class TestCanonicalizeResult:
    def test_sorts_dict_keys(self):
        from src.engine.determinism import canonicalize_result
        r1 = canonicalize_result({"b": 1, "a": 2})
        r2 = canonicalize_result({"a": 2, "b": 1})
        assert r1 == r2

    def test_sorts_nested_dict_keys(self):
        from src.engine.determinism import canonicalize_result
        r1 = canonicalize_result({"x": {"b": 1, "a": 2}})
        r2 = canonicalize_result({"x": {"a": 2, "b": 1}})
        assert r1 == r2

    def test_rounds_floats(self):
        from src.engine.determinism import canonicalize_result
        r = canonicalize_result({"v": 1.23456789})
        data = json.loads(r)
        assert data["v"] == round(1.23456789, 6)

    def test_handles_nan(self):
        from src.engine.determinism import canonicalize_result
        r = canonicalize_result({"v": float("nan")})
        assert '"NaN"' in r

    def test_handles_inf(self):
        from src.engine.determinism import canonicalize_result
        r1 = canonicalize_result({"v": float("inf")})
        r2 = canonicalize_result({"v": float("-inf")})
        assert '"Inf"' in r1
        assert '"-Inf"' in r2

    def test_handles_list(self):
        from src.engine.determinism import canonicalize_result
        r = canonicalize_result([1, 2.5, "hello"])
        parsed = json.loads(r)
        assert parsed == [1, 2.5, "hello"]

    def test_empty_dict(self):
        from src.engine.determinism import canonicalize_result
        assert canonicalize_result({}) == "{}"


# ─── Unit: result_hash ────────────────────────────────────────────────────────

class TestResultHash:
    def test_same_dict_same_hash(self):
        from src.engine.determinism import result_hash
        assert result_hash({"a": 1, "b": 2}) == result_hash({"b": 2, "a": 1})

    def test_different_dict_different_hash(self):
        from src.engine.determinism import result_hash
        assert result_hash({"a": 1}) != result_hash({"a": 2})

    def test_hash_is_64_hex_chars(self):
        from src.engine.determinism import result_hash
        h = result_hash({"x": 42})
        assert len(h) == 64
        int(h, 16)  # must be valid hex


# ─── Integration: 10x replay byte-equality ──────────────────────────────────

def _make_synthetic_ohlcv(n: int = 200, seed: int = 7) -> pl.DataFrame:
    """Create synthetic OHLCV data with a fixed seed for reproducible fixture."""
    rng = np.random.Generator(np.random.PCG64(seed))
    base = 4500.0
    returns = rng.normal(0, 0.002, n)
    closes = base * np.cumprod(1 + returns)
    highs = closes * (1 + np.abs(rng.normal(0, 0.001, n)))
    lows = closes * (1 - np.abs(rng.normal(0, 0.001, n)))
    opens = np.roll(closes, 1)
    opens[0] = base
    dates = [datetime(2024, 1, 1) + timedelta(minutes=15 * i) for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open":   opens.tolist(),
        "high":   highs.tolist(),
        "low":    lows.tolist(),
        "close":  closes.tolist(),
        "volume": [int(x) for x in rng.integers(10000, 50000, n)],
    })


def _run_deterministic_backtest_fixture() -> dict[str, Any]:
    """Run a minimal deterministic backtest fixture and return a result dict.

    This fixture exercises the core numpy/polars computation path:
    - ATR computation (uses rolling std)
    - EMA crossover signals
    - Trade P&L with slippage (manual, not vectorbt)
    - Summary metrics (Sharpe, win_rate, profit_factor)

    The computation must be identical across runs when determinism is enabled.
    """
    from src.engine.determinism import enable_determinism, assert_deterministic
    enable_determinism(seed=42)
    assert_deterministic()

    df = _make_synthetic_ohlcv(n=200, seed=7)
    closes = df["close"].to_numpy()
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()

    # ATR (true range, 14-bar EMA)
    prev_close = np.roll(closes, 1)
    prev_close[0] = closes[0]
    tr = np.maximum(highs - lows, np.maximum(np.abs(highs - prev_close), np.abs(lows - prev_close)))
    alpha = 2.0 / (14 + 1)
    atr = np.zeros(len(tr))
    atr[0] = tr[0]
    for i in range(1, len(tr)):
        atr[i] = alpha * tr[i] + (1 - alpha) * atr[i - 1]

    # EMA crossover signals (9/21)
    def ema(arr, span):
        a = 2.0 / (span + 1)
        result = np.zeros_like(arr)
        result[0] = arr[0]
        for i in range(1, len(arr)):
            result[i] = a * arr[i] + (1 - a) * result[i - 1]
        return result

    fast = ema(closes, 9)
    slow = ema(closes, 21)
    entries = (fast[:-1] < slow[:-1]) & (fast[1:] >= slow[1:])
    exits  = (fast[:-1] > slow[:-1]) & (fast[1:] <= slow[1:])
    entries = np.concatenate([[False], entries])
    exits  = np.concatenate([[False], exits])

    # Simulate trades (next-bar fill) — manual P&L, NOT vectorbt
    CONTRACT_MULTIPLIER = 5.0   # MES
    TICK_VALUE = 12.50
    TICK_SIZE = 0.25
    COMMISSION_PER_SIDE = 0.62  # standard non-alpha firm
    SLIPPAGE_TICKS = 1          # 1 tick per side

    trades_pnl = []
    in_trade = False
    entry_price = 0.0
    entry_bar = 0

    for i in range(1, len(closes)):
        if not in_trade and entries[i]:
            # Next-bar fill convention: fill at next bar's open + slippage
            fill_price = closes[i] + SLIPPAGE_TICKS * TICK_SIZE
            entry_price = fill_price
            entry_bar = i
            in_trade = True
        elif in_trade and (exits[i] or i == len(closes) - 1):
            exit_price = closes[i] - SLIPPAGE_TICKS * TICK_SIZE
            # Futures P&L: manually computed, NOT passed to vectorbt
            gross_pnl = (exit_price - entry_price) * CONTRACT_MULTIPLIER / TICK_SIZE * TICK_VALUE
            commission = COMMISSION_PER_SIDE * 2  # round-trip
            net_pnl = gross_pnl - commission
            trades_pnl.append(net_pnl)
            in_trade = False

    if not trades_pnl:
        return {
            "trade_count": 0,
            "total_pnl": 0.0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "sharpe": 0.0,
            "atr_last": float(atr[-1]),
        }

    arr = np.array(trades_pnl)
    winners = arr[arr > 0]
    losers = arr[arr < 0]
    gross_win = float(winners.sum()) if len(winners) > 0 else 0.0
    gross_loss = float(np.abs(losers).sum()) if len(losers) > 0 else 0.0
    profit_factor = gross_win / gross_loss if gross_loss > 0 else float("inf")

    # Sharpe (annualized, daily grouping by 26 bars = ~6.5h day on 15min)
    daily_pnl = arr  # use trade-by-trade as proxy
    sharpe = 0.0
    if len(daily_pnl) > 1 and np.std(daily_pnl) > 0:
        sharpe = float(np.mean(daily_pnl) / np.std(daily_pnl) * np.sqrt(252))

    return {
        "trade_count":   int(len(arr)),
        "total_pnl":     float(arr.sum()),
        "win_rate":      float((arr > 0).mean()),
        "profit_factor": profit_factor,
        "sharpe":        sharpe,
        "atr_last":      float(atr[-1]),
        "max_drawdown":  float(np.min(np.minimum.accumulate(np.cumsum(arr)) - np.cumsum(arr))),
    }


class TestDeterministicReplay10x:
    """Core verification gate: 10 identical runs must produce byte-equal JSON."""

    def test_10x_canonical_json_byte_equality(self):
        """Run fixture 10 times; assert all canonical JSON outputs are identical."""
        from src.engine.determinism import canonicalize_result, result_hash

        results = [_run_deterministic_backtest_fixture() for _ in range(10)]
        canonical_outputs = [canonicalize_result(r) for r in results]
        hashes = [result_hash(r) for r in results]

        # All canonical strings must be byte-equal
        first = canonical_outputs[0]
        for i, c in enumerate(canonical_outputs[1:], start=1):
            assert c == first, (
                f"Run {i+1} produced different output from run 1.\n"
                f"Run 1: {first[:200]}\n"
                f"Run {i+1}: {c[:200]}\n"
                "DETERMINISM FAILURE: identical inputs produced different outputs."
            )

        # All hashes must be identical
        first_hash = hashes[0]
        for i, h in enumerate(hashes[1:], start=1):
            assert h == first_hash, (
                f"Run {i+1} hash differs from run 1: {h} vs {first_hash}"
            )

        # Sanity: result is non-trivial
        result_dict = results[0]
        assert result_dict["trade_count"] > 0, "Fixture produced zero trades — test is vacuous"

    def test_result_trade_count_positive(self):
        """Fixture must produce at least one trade (otherwise test is vacuous)."""
        result = _run_deterministic_backtest_fixture()
        assert result["trade_count"] > 0

    def test_pnl_is_finite(self):
        """P&L must be finite (no NaN/Inf from division errors)."""
        result = _run_deterministic_backtest_fixture()
        assert np.isfinite(result["total_pnl"]), "total_pnl is not finite"
        assert np.isfinite(result["sharpe"]) or result["trade_count"] <= 1, (
            "sharpe is not finite"
        )


# ─── threadpoolctl integration ───────────────────────────────────────────────

class TestThreadpoolctlIntegration:
    def test_threadpool_limits_applied(self):
        """threadpoolctl must show thread limits of 1 after enable_determinism."""
        from threadpoolctl import threadpool_info
        from src.engine.determinism import enable_determinism
        enable_determinism(seed=42)
        info = threadpool_info()
        for pool in info:
            assert pool.get("num_threads", 1) <= 1, (
                f"Thread pool {pool.get('user_api', '?')} has "
                f"{pool.get('num_threads')} threads; expected 1.\n"
                f"Full pool info: {pool}"
            )


# ─── env var propagation verification ────────────────────────────────────────

class TestEnvVarPropagation:
    def test_env_vars_visible_in_subprocess(self):
        """Env vars set by determinism module must be visible to child processes.

        This exercises the contract that python-runner.ts uses
        env: { ...process.env } — which means our vars must be in the parent
        process environment. We verify via subprocess.check_output.
        """
        import subprocess
        py = sys.executable
        script = (
            "import os, json; "
            "print(json.dumps({"
            "'MKL_CBWR': os.environ.get('MKL_CBWR'),"
            "'OPENBLAS_NUM_THREADS': os.environ.get('OPENBLAS_NUM_THREADS'),"
            "'BLIS_NUM_THREADS': os.environ.get('BLIS_NUM_THREADS'),"
            "'OMP_NUM_THREADS': os.environ.get('OMP_NUM_THREADS')"
            "}))"
        )
        child_env = dict(os.environ)
        # Simulate what python-runner.ts does: spread parent env into child
        out = subprocess.check_output([py, "-c", script], env=child_env, text=True)
        data = json.loads(out.strip())
        assert data["MKL_CBWR"] == "COMPATIBLE"
        assert data["OPENBLAS_NUM_THREADS"] == "1"
        assert data["BLIS_NUM_THREADS"] == "1"
        assert data["OMP_NUM_THREADS"] == "1"
