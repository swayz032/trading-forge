"""Signal Vector Tests — A7 (W11 Team B)

Tests that backtester.py emits a correct signal_vector field:
  1. signal_vector is present in result dict
  2. signal_vector has correct length (= n_bars in the data)
  3. signal_vector values are in {-1, 0, 1} only
  4. signal_vector is a list (JSON-serializable)
  5. When entry_long fires → corresponding bars have value 1
  6. When entry_short fires → corresponding bars have value -1
  7. Bars with no signal → value 0
  8. Long takes priority over short on same bar (edge case)
  9. signal_vector determinism: two identical runs produce identical vectors
 10. Integration: run_backtest returns signal_vector for a DSL strategy
"""

import json
from datetime import datetime, timedelta

import numpy as np
import polars as pl
import pytest

# ─── Setup: minimal test helpers ────────────────────────────────────────────


def make_df(n: int = 100) -> pl.DataFrame:
    """Minimal OHLCV DataFrame for tests."""
    close = np.linspace(100, 110, n)
    return pl.DataFrame({
        "close": close,
        "open": close - 0.5,
        "high": close + 1.0,
        "low": close - 1.0,
        "volume": np.ones(n) * 1000,
        "ts_event": [f"2020-01-01T{i:02d}:00:00" for i in range(n)],
        "ts_et":    [f"2020-01-01T{i:02d}:00:00" for i in range(n)],
    })


# ─── Unit tests for signal vector construction logic ─────────────────────────


def _build_signal_vector(long_entries: np.ndarray, short_entries: np.ndarray) -> list[int]:
    """Mirror of the backtester.py A7 signal vector construction logic.

    1 = long entry, -1 = short entry, 0 = no signal.
    Long takes priority over short on the same bar.
    """
    n = len(long_entries)
    signal_vector_np = np.zeros(n, dtype=np.int8)
    signal_vector_np[long_entries.astype(bool)] = 1
    short_only_mask = short_entries.astype(bool) & (~long_entries.astype(bool))
    signal_vector_np[short_only_mask] = -1
    return signal_vector_np.tolist()


class TestSignalVectorConstruction:
    """Unit tests for the A7 signal vector construction logic."""

    def test_values_in_valid_set(self):
        """Signal vector values must be in {-1, 0, 1}."""
        long = np.array([True, False, False, True, False], dtype=bool)
        short = np.array([False, True, False, False, True], dtype=bool)
        vec = _build_signal_vector(long, short)
        for v in vec:
            assert v in {-1, 0, 1}, f"Unexpected value: {v}"

    def test_long_entries_produce_1(self):
        """Bars with long entry → vector value 1."""
        long = np.array([True, False, True, False], dtype=bool)
        short = np.zeros(4, dtype=bool)
        vec = _build_signal_vector(long, short)
        assert vec[0] == 1
        assert vec[2] == 1

    def test_short_entries_produce_minus_1(self):
        """Bars with short entry (and no long) → vector value -1."""
        long = np.zeros(4, dtype=bool)
        short = np.array([False, True, False, True], dtype=bool)
        vec = _build_signal_vector(long, short)
        assert vec[1] == -1
        assert vec[3] == -1

    def test_no_signal_produces_0(self):
        """Bars with no entry → vector value 0."""
        long = np.array([True, False, False], dtype=bool)
        short = np.array([False, False, True], dtype=bool)
        vec = _build_signal_vector(long, short)
        assert vec[1] == 0, "Middle bar should be 0 (no signal)"

    def test_long_priority_over_short_on_same_bar(self):
        """When both long and short fire on same bar, long takes priority (→ 1)."""
        long = np.array([True], dtype=bool)
        short = np.array([True], dtype=bool)
        vec = _build_signal_vector(long, short)
        assert vec[0] == 1, "Long should take priority over short"

    def test_length_equals_input_length(self):
        """Signal vector length must equal the input array length."""
        n = 500
        long = np.zeros(n, dtype=bool)
        short = np.zeros(n, dtype=bool)
        long[10] = True
        short[20] = True
        vec = _build_signal_vector(long, short)
        assert len(vec) == n

    def test_all_zeros_vector(self):
        """All-zeros vector is valid when strategy has no signals."""
        n = 100
        long = np.zeros(n, dtype=bool)
        short = np.zeros(n, dtype=bool)
        vec = _build_signal_vector(long, short)
        assert all(v == 0 for v in vec)
        assert len(vec) == n

    def test_result_is_list(self):
        """Signal vector must be a Python list (JSON-serializable)."""
        long = np.array([True, False], dtype=bool)
        short = np.array([False, True], dtype=bool)
        vec = _build_signal_vector(long, short)
        assert isinstance(vec, list)
        # Verify JSON-serializable (no numpy types)
        json.dumps(vec)  # should not raise

    def test_json_serializable(self):
        """Signal vector values must serialize to JSON as integers."""
        long = np.array([True, False, False, True], dtype=bool)
        short = np.array([False, True, False, False], dtype=bool)
        vec = _build_signal_vector(long, short)
        serialized = json.dumps(vec)
        loaded = json.loads(serialized)
        assert loaded == vec

    def test_determinism_identical_inputs(self):
        """Same inputs → identical signal vector (determinism check)."""
        rng = np.random.RandomState(42)
        long = rng.random(1000) > 0.95
        short = rng.random(1000) > 0.95
        vec1 = _build_signal_vector(long, short)
        vec2 = _build_signal_vector(long, short)
        assert vec1 == vec2, "Signal vector must be deterministic"


# ─── Integration test: run_backtest emits signal_vector ──────────────────────


def _deterministic_ohlcv(n: int = 480) -> pl.DataFrame:
    """`R-799 §5` form `[2]`: a DETERMINISTIC FIXTURE THE TEST CREATES.

    `R-815` Cluster A. These integration tests previously loaded MES bars from S3 and
    converted any data-shaped exception into a `pytest.skip`, so on a box without AWS
    credentials they reported nothing at all — and a genuine `signal_vector` defect
    whose message merely mentioned "data" was absorbed by the same clause.

    The frame is fed through `run_backtest(request, data=...)`, an EXISTING seam that
    PRODUCTION already exercises (`walk_forward.py:178`) — not a test-only backdoor.

    Closes OSCILLATE around their own SMA so `close > sma_5` and `close < sma_5` both
    occur and the emitted vector contains non-zero entries: an all-zero vector would
    satisfy the value-range and JSON assertions VACUOUSLY.

    Bars are laid out as SESSIONS, not one contiguous 5-minute run, so the frame's own
    calendar span satisfies the engine's bar-count sanity check. That check derives its
    span from `ts_event` -- NOT from the request -- whenever `data=` is passed
    (`backtester.py:3690-3698`, "derive date span from actual data"), so a contiguous
    block would ship a standing `Wrong timeframe data?` warning inside a governed test.
    480 bars over a 5-day span -> expected int(5*252/365)*172 = 516, deviation 6.98%,
    inside the 10% tolerance at `backtester.py:2684`.
    """
    bars_per_session = 80                     # 80 * 5min = 6h40m, an RTH-shaped session
    sessions = n // bars_per_session
    ts = [
        datetime(2020, 1, 2, 9, 30) + timedelta(days=d, minutes=5 * b)
        for d in range(sessions)
        for b in range(bars_per_session)
    ]
    # deterministic, no RNG: slow drift + fixed-period oscillation
    closes = [4000.0 + 0.15 * i + 6.0 * float(np.sin(i / 7.0)) for i in range(len(ts))]
    return pl.DataFrame({
        "ts_event": ts,
        "open":   [c - 0.75 for c in closes],
        "high":   [c + 2.50 for c in closes],
        "low":    [c - 2.50 for c in closes],
        "close":  closes,
        "volume": [1000] * n,
    })


class TestBacktesterSignalVectorIntegration:
    """Integration tests: verify backtester.py run_backtest emits signal_vector."""

    @pytest.fixture(autouse=True)
    def _set_determinism(self, monkeypatch):
        """Set determinism env var so results are reproducible."""
        monkeypatch.setenv("DETERMINISM_MODE", "true")

    def _make_config(self) -> dict:
        """Minimal BacktestRequest config for testing."""
        return {
            "strategy": {
                "name": "test_signal_vec",
                "symbol": "MES",
                "timeframe": "5min",
                "indicators": [
                    {"type": "sma", "period": 5},
                    {"type": "atr", "period": 14},
                ],
                "entry_long": "close > sma_5",
                "entry_short": "close < sma_5",
                "exit": "atr_14 > 1.0",
                "stop_loss": {"type": "atr", "multiplier": 2.0},
                "position_size": {"type": "fixed", "fixed_contracts": 1},
            },
            # Bounds match _deterministic_ohlcv()'s own span. NOTE: with data= passed,
            # the engine's bar-count check reads ts_event, not these (backtester.py:3696)
            # -- the fixture's session layout is what satisfies it, not these strings.
            "start_date": "2020-01-02",
            "end_date": "2020-01-07",
            "slippage_ticks": 1,
            "commission_per_side": 0.62,
            "mode": "single",
        }

    def test_signal_vector_present_in_result(self):
        """run_backtest result must contain a 'signal_vector' key."""
        # R-799 §5: a release-authority test may not silently depend on
        # machine-local evidence. An unimportable backtester is a HARD FAILURE,
        # never a skip.
        from src.engine.backtester import run_backtest
        from src.engine.config import BacktestRequest

        config = self._make_config()

        # R-815 Cluster A: the broad `except ... pytest.skip("Data not available")`
        # is DELETED, not narrowed. Data is now a deterministic in-test fixture, so
        # there is no environment condition left for a skip to describe -- any
        # exception here is a real defect and must surface as one.
        request = BacktestRequest(**config)
        result = run_backtest(request, data=_deterministic_ohlcv())

        assert "signal_vector" in result, "signal_vector must be in run_backtest result"

    def test_signal_vector_values_valid(self):
        """signal_vector values must all be in {-1, 0, 1}."""
        # R-799 §5: a release-authority test may not silently depend on
        # machine-local evidence. An unimportable backtester is a HARD FAILURE,
        # never a skip.
        from src.engine.backtester import run_backtest
        from src.engine.config import BacktestRequest

        config = self._make_config()

        # R-815 Cluster A: skip clause DELETED; deterministic fixture supplies the data.
        request = BacktestRequest(**config)
        result = run_backtest(request, data=_deterministic_ohlcv())

        sv = result.get("signal_vector", [])
        assert isinstance(sv, list)
        assert all(v in {-1, 0, 1} for v in sv), "All values must be in {-1, 0, 1}"

    def test_signal_vector_is_json_serializable(self):
        """signal_vector must serialize to JSON without error."""
        # R-799 §5: a release-authority test may not silently depend on
        # machine-local evidence. An unimportable backtester is a HARD FAILURE,
        # never a skip.
        from src.engine.backtester import run_backtest
        from src.engine.config import BacktestRequest

        config = self._make_config()

        # R-815 Cluster A: skip clause DELETED; deterministic fixture supplies the data.
        request = BacktestRequest(**config)
        result = run_backtest(request, data=_deterministic_ohlcv())

        sv = result.get("signal_vector", [])
        # Should not raise
        json.dumps(sv)

    def test_signal_vector_contracts_survive_remote_loader_failure(self, monkeypatch):
        """R-815 Cluster A CLOUD-INDEPENDENCE CONTROL — the guard that keeps the skip gone.

        R-817 §3 (1)(a) RENAME — the identity, not the body. The previous name was
        `test_signal_vector_path_never_reaches_the_remote_loader`, which asserted the
        OPPOSITE of what AR-968 §4 measured: the HTF daily-cache build DOES reach this
        loader, raises, and is caught (see the HONEST SCOPE paragraph below). The body
        always proved the true and narrower property — that the signal_vector contracts
        SURVIVE a hard remote-loader failure — so only the name changed. Renamed BEFORE
        admission to the successor chain, because a node ID that something has joined on
        is no longer free to correct ([accept5-join-keys]; two knowingly-misnamed 6B
        tests are frozen today for exactly that reason).

        Deleting a `pytest.skip` only removes the SYMPTOM. What must stay true is that
        this property no longer depends on a remote read at all. So the remote loader is
        planted to RAISE, and all three asserted properties must still hold.

        Planted at `backtester.load_ohlcv` — the CHOKEPOINT — never at a consumer: a spy
        on a consumer reads zero on both arms and looks like a perfect gate.

        🛑 HONEST SCOPE, MEASURED — this control does NOT claim the engine makes zero S3
        attempts. It does not. `[MEASURED]` the HTF daily-cache build calls the same
        loader and CATCHES the failure, emitting
        `backtest.htf_passthrough_engaged` and running the eligibility gate in
        passthrough. That is a REAL residual environment sensitivity: the engine takes a
        DIFFERENT internal path with and without credentials. It is out of Cluster A's
        scope (tests/evidence only, no production trading-behaviour change) and is
        reported rather than silently absorbed. What this control DOES prove is that the
        asserted signal_vector properties survive a hard remote-loader failure.
        """
        import src.engine.backtester as bt

        def _must_not_be_called(*args, **kwargs):
            raise AssertionError("REMOTE LOADER MUST NOT BE CALLED")

        monkeypatch.setattr(bt, "load_ohlcv", _must_not_be_called)

        from src.engine.config import BacktestRequest

        request = BacktestRequest(**self._make_config())
        result = bt.run_backtest(request, data=_deterministic_ohlcv())

        sv = result.get("signal_vector", [])
        assert "signal_vector" in result
        assert isinstance(sv, list)
        assert all(v in {-1, 0, 1} for v in sv)
        json.dumps(sv)
        # POSITIVE WITNESS that the path actually ran and is not vacuously empty --
        # an all-zero or empty vector would satisfy every assertion above.
        assert any(v != 0 for v in sv), "vector is vacuous; the control proved nothing"


# ─── Cosine similarity parity tests ──────────────────────────────────────────


class TestCosineSimilarityParity:
    """Verify the Python-side signal vectors produce expected cosine similarities.

    These tests verify the Two Sigma property: identical signals → high similarity,
    different signals → low similarity. The cosine computation is in TS (service),
    but we verify the signal vectors we emit are correctly structured for it.
    """

    def _cosine(self, a: list[int], b: list[int]) -> float:
        """Reference cosine similarity implementation (matches TS service)."""
        n = min(len(a), len(b))
        if n == 0:
            return 0.0
        dot = sum(a[i] * b[i] for i in range(n))
        norm_a = sum(a[i] ** 2 for i in range(n)) ** 0.5
        norm_b = sum(b[i] ** 2 for i in range(n)) ** 0.5
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    def test_identical_signals_cosine_above_0_95(self):
        """VERIFICATION: identical signal vectors produce cosine > 0.95."""
        long = np.zeros(10_000, dtype=bool)
        short = np.zeros(10_000, dtype=bool)
        for i in range(0, 10_000, 15):
            long[i] = True
        for i in range(7, 10_000, 23):
            short[i] = True

        vec = _build_signal_vector(long, short)
        sim = self._cosine(vec, vec)
        assert sim > 0.95, f"Expected > 0.95, got {sim:.4f}"

    def test_different_signals_cosine_below_0_5(self):
        """VERIFICATION: different signal vectors produce cosine < 0.5."""
        long_a = np.zeros(10_000, dtype=bool)
        short_b = np.zeros(10_000, dtype=bool)
        for i in range(0, 10_000, 13):
            long_a[i] = True
        for i in range(5, 10_000, 17):
            short_b[i] = True

        vec_a = _build_signal_vector(long_a, np.zeros(10_000, dtype=bool))
        vec_b = _build_signal_vector(np.zeros(10_000, dtype=bool), short_b)
        sim = self._cosine(vec_a, vec_b)
        assert sim < 0.5, f"Expected < 0.5, got {sim:.4f}"
