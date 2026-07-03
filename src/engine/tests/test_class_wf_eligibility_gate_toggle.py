"""Regression tests — run_walk_forward_class() eligibility-gate toggle fix.

BACKGROUND (coordinator finding, verified this session): run_walk_forward_class()
hardcoded `skip_eligibility_gate=True` as a LITERAL on every OOS window's
run_class_backtest() call. Because apply_eligibility_gate() (the function that
actually reads TF_CONFLUENCE_OVERLAY_DISABLED, backtester.py's Mode A/B ablation
toggle) was never even CALLED when skip_eligibility_gate=True, the ablation
toggle was silently dead for every class-based (archetype OR Band C
condition-compiled) strategy's walk-forward. E1's Mode A/B harness worked
around this by targeting run_walk_forward() (the DSL-spec path) only.

THE FIX (src/engine/walk_forward.py): `skip_eligibility_gate` is now a real
parameter (default None -> resolves via `_default_class_wf_skip_eligibility_gate()`,
which defaults to True — i.e. IDENTICAL behavior to before for every existing
caller that doesn't pass the new kwarg, or set the new env var). Explicitly
passing `skip_eligibility_gate=False` (or setting
`TF_CLASS_WF_ELIGIBILITY_GATE_ENABLED=true`) makes apply_eligibility_gate()
actually run, restoring the ablation toggle's effect for class-based WF.

THE ORIGINAL "gate kills 90%+ of signals" RATIONALE IS NOT OVERRIDDEN — the
default is untouched. This only adds an opt-in capability.

Run targeted:
    python -m pytest src/engine/tests/test_class_wf_eligibility_gate_toggle.py -v
"""

from __future__ import annotations

from src.engine.walk_forward import _default_class_wf_skip_eligibility_gate

# ─── Env-var-driven default resolution (pure, no mocking needed) ───────────

class TestDefaultResolution:
    def test_default_is_true_when_env_var_unset(self, monkeypatch):
        monkeypatch.delenv("TF_CLASS_WF_ELIGIBILITY_GATE_ENABLED", raising=False)
        assert _default_class_wf_skip_eligibility_gate() is True

    def test_default_is_true_when_env_var_false(self, monkeypatch):
        monkeypatch.setenv("TF_CLASS_WF_ELIGIBILITY_GATE_ENABLED", "false")
        assert _default_class_wf_skip_eligibility_gate() is True

    def test_default_flips_to_false_when_env_var_true(self, monkeypatch):
        monkeypatch.setenv("TF_CLASS_WF_ELIGIBILITY_GATE_ENABLED", "true")
        assert _default_class_wf_skip_eligibility_gate() is False

    def test_default_accepts_1_and_yes_as_true(self, monkeypatch):
        monkeypatch.setenv("TF_CLASS_WF_ELIGIBILITY_GATE_ENABLED", "1")
        assert _default_class_wf_skip_eligibility_gate() is False
        monkeypatch.setenv("TF_CLASS_WF_ELIGIBILITY_GATE_ENABLED", "yes")
        assert _default_class_wf_skip_eligibility_gate() is False


# ─── Plumbing: run_walk_forward_class -> run_class_backtest kwarg capture ──
#
# Monkeypatches run_class_backtest (module-level import in walk_forward.py)
# and load_ohlcv (local import inside the function) to isolate the plumbing
# decision from real data-loading/backtest execution — fast, deterministic,
# no market data dependency.

class TestSkipEligibilityGatePlumbing:
    def _build_synthetic_ohlcv(self, n: int = 400):
        from datetime import datetime, timedelta, timezone

        import numpy as np
        import polars as pl

        start = datetime(2026, 1, 5, 9, 30, tzinfo=timezone.utc)
        ts = [start + timedelta(minutes=5 * i) for i in range(n)]
        rng = np.random.default_rng(11)
        close = 5000 + np.cumsum(rng.normal(0, 1.0, n))
        return pl.DataFrame(
            {
                "ts_event": ts,
                "open": close.astype(float),
                "high": (close + 1.0).astype(float),
                "low": (close - 1.0).astype(float),
                "close": close.astype(float),
                "volume": rng.integers(500, 2000, n).astype(int),
            }
        )

    def _run_with_captured_kwargs(self, monkeypatch, **wf_kwargs) -> dict:
        import polars as pl

        from src.engine.strategy_base import BaseStrategy

        synthetic = self._build_synthetic_ohlcv()

        def _fake_load_ohlcv(symbol, timeframe, start_date, end_date):
            # daily_data path deliberately returns < 200 rows so htf_cache
            # stays None — irrelevant to the plumbing question this test asks.
            if timeframe == "daily":
                return synthetic.head(50)
            return synthetic

        monkeypatch.setattr("src.engine.data_loader.load_ohlcv", _fake_load_ohlcv)

        captured: dict = {}

        def _fake_run_class_backtest(**kwargs):
            captured["skip_eligibility_gate"] = kwargs.get("skip_eligibility_gate")
            return {"total_trades": 0}

        monkeypatch.setattr("src.engine.walk_forward.run_class_backtest", _fake_run_class_backtest)

        class _DummyStrategy(BaseStrategy):
            name = "silver_bullet"  # a REGISTERED playbook name (see next test class)
            symbol = "MES"
            timeframe = "5m"

            def compute(self, df: pl.DataFrame) -> pl.DataFrame:
                return df.with_columns(
                    [
                        pl.lit(False).alias("entry_long"),
                        pl.lit(False).alias("entry_short"),
                        pl.lit(False).alias("exit_long"),
                        pl.lit(False).alias("exit_short"),
                    ]
                )

            def get_params(self) -> dict:
                return {}

            def get_default_config(self) -> dict:
                return {}

        from src.engine.walk_forward import run_walk_forward_class

        run_walk_forward_class(
            strategy=_DummyStrategy(),
            start_date="2026-01-01",
            end_date="2026-01-10",
            n_splits=1,
            **wf_kwargs,
        )
        return captured

    def test_byte_identity_default_run_passes_skip_true(self, monkeypatch):
        """No kwarg, no env var -> skip_eligibility_gate=True, IDENTICAL to the
        pre-fix hardcoded literal. This is the byte-identity contract for
        every existing caller."""
        monkeypatch.delenv("TF_CLASS_WF_ELIGIBILITY_GATE_ENABLED", raising=False)
        captured = self._run_with_captured_kwargs(monkeypatch)
        assert captured["skip_eligibility_gate"] is True

    def test_explicit_kwarg_false_reaches_run_class_backtest(self, monkeypatch):
        captured = self._run_with_captured_kwargs(monkeypatch, skip_eligibility_gate=False)
        assert captured["skip_eligibility_gate"] is False

    def test_env_var_opt_in_reaches_run_class_backtest(self, monkeypatch):
        monkeypatch.setenv("TF_CLASS_WF_ELIGIBILITY_GATE_ENABLED", "true")
        captured = self._run_with_captured_kwargs(monkeypatch)
        assert captured["skip_eligibility_gate"] is False

    def test_explicit_kwarg_true_overrides_env_var(self, monkeypatch):
        """Explicit kwarg always wins over the env-var default."""
        monkeypatch.setenv("TF_CLASS_WF_ELIGIBILITY_GATE_ENABLED", "true")
        captured = self._run_with_captured_kwargs(monkeypatch, skip_eligibility_gate=True)
        assert captured["skip_eligibility_gate"] is True


# ─── Mode A ≠ Mode B: apply_eligibility_gate itself, once actually reachable ─
#
# apply_eligibility_gate() is independently importable without triggering the
# vectorbt-JIT hang (see test_wave_b_intrabar_stops.py's own import guard).
# This proves that ONCE skip_eligibility_gate=False reaches run_class_backtest
# (proven above), the ablation toggle genuinely produces a different gate
# mode for a REGISTERED strategy — the exact mechanism the DSL-spec path
# already relies on.

class TestModeADiffersFromModeBOnceGateIsReachable:
    def test_registered_strategy_mode_label_differs_with_ablation_toggle(self, monkeypatch):
        import numpy as np
        import polars as pl

        from src.engine.backtester import apply_eligibility_gate

        n = 50
        df = pl.DataFrame(
            {
                "close": np.linspace(5000, 5010, n),
                "ts_event": [None] * n,
            }
        )
        entries = np.zeros(n, dtype=bool)
        entries[10] = True
        exits = np.zeros(n, dtype=bool)
        htf_cache = {"2026-01-05": object()}  # non-empty, non-None — clears the passthrough guard

        # Mode A (institutional overlay ON — default, toggle unset).
        monkeypatch.delenv("TF_CONFLUENCE_OVERLAY_DISABLED", raising=False)
        _, _, stats_mode_a = apply_eligibility_gate(
            entries, exits, df, "long", "MES",
            htf_cache=htf_cache, strategy_name="silver_bullet",
        )

        # Mode B (source_entry_only — ablation toggle ON).
        monkeypatch.setenv("TF_CONFLUENCE_OVERLAY_DISABLED", "true")
        _, _, stats_mode_b = apply_eligibility_gate(
            entries, exits, df, "long", "MES",
            htf_cache=htf_cache, strategy_name="silver_bullet",
        )

        assert stats_mode_a["mode"] != stats_mode_b["mode"], (
            "Mode A and Mode B must produce DIFFERENT gate_stats['mode'] for a "
            "registered strategy once the gate is actually reachable — this is "
            "the exact signal Mode A/B comparison depends on."
        )
        assert stats_mode_b["mode"] == "source_entry_only"

    def test_unregistered_strategy_name_passthrough_both_modes_unaffected_by_this_fix(self, monkeypatch):
        """Honesty guard (pre-existing, unchanged behavior): an UNREGISTERED
        strategy name (e.g. a raw spec_conditions:<hash> marker) still
        passes through regardless of the ablation toggle -- this fix does
        NOT make Mode A/B meaningful for unregistered strategy names; that is
        a separate, orthogonal, already-documented limitation."""
        import numpy as np
        import polars as pl

        from src.engine.backtester import apply_eligibility_gate

        n = 50
        df = pl.DataFrame({"close": np.linspace(5000, 5010, n), "ts_event": [None] * n})
        entries = np.zeros(n, dtype=bool)
        entries[10] = True
        exits = np.zeros(n, dtype=bool)
        htf_cache = {"2026-01-05": object()}

        monkeypatch.delenv("TF_CONFLUENCE_OVERLAY_DISABLED", raising=False)
        _, _, stats = apply_eligibility_gate(
            entries, exits, df, "long", "MES",
            htf_cache=htf_cache, strategy_name="spec_conditions:deadbeef1234",
        )
        assert stats["mode"] == "passthrough_strategy_unregistered"
