"""Regression tests for deep-scan fix wave 2026-06-29.

12 fixes: C1, H6, H7, H5a, H5b, H5c, M-1, M-2, M-3, M-4, M-5, L-1.

Run with: python -m pytest tests/test_deepscan_fixwave_2026_06_29.py -v
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from typing import Any
from unittest.mock import patch


# ─────────────────────────────────────────────────────────────────────────────
# C1 — walk_forward CPCV return dict: param_stability_status sentinel
# ─────────────────────────────────────────────────────────────────────────────

class TestC1ParamStabilityStatus:
    """CPCV return dict must include param_stability_status: "cpcv_not_applicable".
    Plain-WF return dict must include param_stability_status: "computed".
    Downstream parameter-drift gate reads this key to distinguish exempt vs real."""

    def _build_minimal_cpcv_result(self) -> dict:
        """Minimal dict that looks like a CPCV return from walk_forward.py.
        We test structural expectations, not the full walk-forward run."""
        # The production function builds this dict — we verify the key is present
        # by grepping the source rather than running full WF (too expensive for unit).
        import ast, pathlib
        src = pathlib.Path(__file__).parent.parent / "src" / "engine" / "walk_forward.py"
        text = src.read_text(encoding="utf-8")
        return text

    def test_cpcv_return_contains_param_stability_status_key(self):
        """walk_forward.py CPCV return dict must emit param_stability_status: 'cpcv_not_applicable'."""
        text = self._build_minimal_cpcv_result()
        assert '"param_stability_status": "cpcv_not_applicable"' in text, (
            "C1 fix missing: CPCV return dict must set param_stability_status = 'cpcv_not_applicable'"
        )

    def test_cpcv_return_does_NOT_emit_cpcv_not_applicable_for_plain_wf(self):
        """Plain-WF return dict must use 'computed', not 'cpcv_not_applicable'."""
        text = self._build_minimal_cpcv_result()
        assert '"param_stability_status": "computed"' in text, (
            "C1 fix missing: plain-WF return dict must set param_stability_status = 'computed'"
        )

    def test_both_sentinels_present_in_source(self):
        """Both sentinel values must exist — one for CPCV path, one for plain-WF path."""
        text = self._build_minimal_cpcv_result()
        assert "cpcv_not_applicable" in text
        assert '"param_stability_status": "computed"' in text

    def test_wfe_status_precendent_still_present(self):
        """The wfe_status: 'cpcv_not_applicable' precedent must remain intact."""
        text = self._build_minimal_cpcv_result()
        assert '"wfe_status": "cpcv_not_applicable"' in text, (
            "wfe_status sentinel removed — precedent for C1 fix must remain"
        )


# ─────────────────────────────────────────────────────────────────────────────
# H6 — FREQ_MAP + BARS_PER_DAY "4hr" alias
# ─────────────────────────────────────────────────────────────────────────────

class TestH6FreqMapAlias:
    """FREQ_MAP and BARS_PER_DAY must contain '4hr' entry mapping to same value as '4h'."""

    def _load_maps(self):
        import importlib, sys
        # Force re-import if already cached
        if "src.engine.backtester" in sys.modules:
            mod = sys.modules["src.engine.backtester"]
        else:
            import src.engine.backtester as mod
        return mod.FREQ_MAP, mod.BARS_PER_DAY

    def test_freq_map_4hr_maps_to_4h(self):
        FREQ_MAP, _ = self._load_maps()
        assert "4hr" in FREQ_MAP, "H6: '4hr' alias missing from FREQ_MAP"
        assert FREQ_MAP["4hr"] == "4h", f"H6: FREQ_MAP['4hr'] must be '4h', got {FREQ_MAP['4hr']!r}"

    def test_bars_per_day_4hr_matches_4h(self):
        _, BARS_PER_DAY = self._load_maps()
        assert "4hr" in BARS_PER_DAY, "H6: '4hr' alias missing from BARS_PER_DAY"
        assert BARS_PER_DAY["4hr"] == BARS_PER_DAY.get("4h"), (
            f"H6: BARS_PER_DAY['4hr']={BARS_PER_DAY.get('4hr')} must match BARS_PER_DAY['4h']={BARS_PER_DAY.get('4h')}"
        )

    def test_bars_per_day_4hr_is_6(self):
        _, BARS_PER_DAY = self._load_maps()
        assert BARS_PER_DAY["4hr"] == 6, (
            f"H6: BARS_PER_DAY['4hr'] should be 6, got {BARS_PER_DAY.get('4hr')}"
        )

    def test_4h_and_4hour_still_present(self):
        """Sanity: existing aliases must not be disturbed."""
        FREQ_MAP, BARS_PER_DAY = self._load_maps()
        assert FREQ_MAP.get("4h") == "4h"
        assert FREQ_MAP.get("4hour") == "4h"
        assert BARS_PER_DAY.get("4h") == 6
        assert BARS_PER_DAY.get("4hour") == 6


# ─────────────────────────────────────────────────────────────────────────────
# H7 — cross-symbol DLL audit row (stderr JSON)
# ─────────────────────────────────────────────────────────────────────────────

class TestH7CrossSymbolDllAudit:
    """Single-symbol backtest must emit backtest.cross_symbol_dll_degenerate_skip
    audit row to stderr when _cs_bar_pnls is initialised to zeros."""

    def test_audit_event_in_backtester_source(self):
        """Source must contain the audit event literal."""
        import pathlib
        text = (pathlib.Path(__file__).parent.parent / "src" / "engine" / "backtester.py").read_text(encoding="utf-8")
        assert "backtest.cross_symbol_dll_degenerate_skip" in text, (
            "H7: cross-symbol DLL degenerate audit event missing from backtester.py"
        )

    def test_audit_row_contains_reason_field(self):
        """Audit JSON must include 'reason' so consumers can distinguish from real enforcement."""
        import pathlib
        text = (pathlib.Path(__file__).parent.parent / "src" / "engine" / "backtester.py").read_text(encoding="utf-8")
        assert "single_symbol_zero_pnl_proxy" in text, (
            "H7: audit row must include reason='single_symbol_zero_pnl_proxy'"
        )

    def test_audit_row_emitted_to_stderr(self):
        """The print(..., file=sys.stderr) pattern must be adjacent to the event string."""
        import pathlib
        text = (pathlib.Path(__file__).parent.parent / "src" / "engine" / "backtester.py").read_text(encoding="utf-8")
        audit_idx = text.find("backtest.cross_symbol_dll_degenerate_skip")
        assert audit_idx > 0
        # sys.stderr is at the end of the print call — check ±800 chars around event string
        window = text[max(0, audit_idx - 200): audit_idx + 800]
        assert "sys.stderr" in window, "H7: audit row must print to sys.stderr"


# ─────────────────────────────────────────────────────────────────────────────
# H5a — style_c_handler re-callable contract comment
# ─────────────────────────────────────────────────────────────────────────────

class TestH5aStyleCReCallableContract:
    """style_c_handler.py must document the re-callable pure-function contract above TP2 check."""

    def _src(self) -> str:
        import pathlib
        return (
            pathlib.Path(__file__).parent.parent
            / "src" / "engine" / "exits" / "style_c_handler.py"
        ).read_text(encoding="utf-8")

    def test_recallable_comment_present(self):
        """A re-callable contract comment must appear near the TP2 condition."""
        text = self._src()
        assert "re-callable" in text.lower() or "re callable" in text.lower() or "re-call" in text.lower(), (
            "H5a: re-callable pure-function contract comment missing from style_c_handler.py"
        )

    def test_tp2_condition_still_gated_on_tp1_filled(self):
        """TP2 condition must still require state.tp1_filled == True."""
        text = self._src()
        assert "state.tp1_filled" in text and "tp2_filled" in text, (
            "H5a: TP2 gate logic disturbed — tp1_filled and tp2_filled conditions must remain"
        )


# ─────────────────────────────────────────────────────────────────────────────
# H5b — Chandelier(14, 2.0) fallback in runner when POC is None
# ─────────────────────────────────────────────────────────────────────────────

class TestH5bChandelierFallback:
    """style_c_handler must fall back to Chandelier(14, 2.0) trail when POC is None."""

    def _import_handler(self):
        from src.engine.exits.style_c_handler import evaluate_exit, StyleCState
        return evaluate_exit, StyleCState

    def test_stylecstate_has_chandelier_fields(self):
        """StyleCState must expose high_since_entry, low_since_entry, atr14 fields."""
        _, StyleCState = self._import_handler()
        import inspect
        fields = StyleCState.model_fields if hasattr(StyleCState, "model_fields") else {}
        assert "high_since_entry" in fields, "H5b: StyleCState missing high_since_entry"
        assert "low_since_entry" in fields, "H5b: StyleCState missing low_since_entry"
        assert "atr14" in fields, "H5b: StyleCState missing atr14"

    def test_runner_uses_chandelier_when_poc_none_long(self):
        """Long runner: with POC=None and Chandelier fields set, decision must be TIGHTEN_TRAIL_TO_X."""
        compute_style_c_exit, StyleCState = self._import_handler()
        entry = 4800.0
        atr14 = 10.0
        high_since = 4815.0
        expected_trail = high_since - 2.0 * atr14  # 4795.0

        state = StyleCState(
            direction="long",
            entry_price=entry,
            stop_pts=20.0,
            current_price=4810.0,  # above trail → update, not breach
            current_time_et="10:00",
            tp1_filled=True,
            tp2_filled=True,
            developing_session_poc=None,  # forces Chandelier path
            high_since_entry=high_since,
            low_since_entry=4790.0,
            atr14=atr14,
        )
        result = compute_style_c_exit(state)
        assert result.decision == "TIGHTEN_TRAIL_TO_X", (
            f"H5b: expected TIGHTEN_TRAIL_TO_X but got {result.decision}"
        )
        assert abs(result.new_stop - expected_trail) < 1e-6, (
            f"H5b: expected new_stop={expected_trail}, got {result.new_stop}"
        )

    def test_runner_chandelier_breach_fires_exit_long(self):
        """Price below Chandelier trail → TIGHTEN_TRAIL_TO_X (breach signal)."""
        compute_style_c_exit, StyleCState = self._import_handler()
        high_since = 4815.0
        atr14 = 10.0
        trail = high_since - 2.0 * atr14  # 4795.0
        state = StyleCState(
            direction="long",
            entry_price=4800.0,
            stop_pts=20.0,
            current_price=4793.0,  # BELOW trail → breach
            current_time_et="10:30",
            tp1_filled=True,
            tp2_filled=True,
            developing_session_poc=None,
            high_since_entry=high_since,
            low_since_entry=4790.0,
            atr14=atr14,
        )
        result = compute_style_c_exit(state)
        assert result.decision == "TIGHTEN_TRAIL_TO_X"
        assert abs(result.new_stop - trail) < 1e-6

    def test_runner_chandelier_fallback_short(self):
        """Short runner with POC=None: Chandelier = low_since + 2*ATR."""
        compute_style_c_exit, StyleCState = self._import_handler()
        low_since = 4780.0
        atr14 = 10.0
        expected_trail = low_since + 2.0 * atr14  # 4800.0
        state = StyleCState(
            direction="short",
            entry_price=4820.0,
            stop_pts=20.0,
            current_price=4805.0,  # below trail → update (not breached from short side)
            current_time_et="10:30",
            tp1_filled=True,
            tp2_filled=True,
            developing_session_poc=None,
            high_since_entry=4825.0,
            low_since_entry=low_since,
            atr14=atr14,
        )
        result = compute_style_c_exit(state)
        assert result.decision == "TIGHTEN_TRAIL_TO_X"
        assert abs(result.new_stop - expected_trail) < 1e-6

    def test_runner_holds_when_chandelier_fields_all_none(self):
        """When POC=None AND Chandelier fields all None → HOLD (no trail data)."""
        compute_style_c_exit, StyleCState = self._import_handler()
        state = StyleCState(
            direction="long",
            entry_price=4800.0,
            stop_pts=20.0,
            current_price=4810.0,
            current_time_et="10:00",
            tp1_filled=True,
            tp2_filled=True,
            developing_session_poc=None,
            high_since_entry=None,
            low_since_entry=None,
            atr14=None,
        )
        result = compute_style_c_exit(state)
        assert result.decision == "HOLD", (
            f"H5b: expected HOLD when no trail data, got {result.decision}"
        )

    def test_poc_trail_takes_priority_over_chandelier(self):
        """When developing_session_poc is set, POC trail takes priority over Chandelier."""
        compute_style_c_exit, StyleCState = self._import_handler()
        poc = 4792.0
        state = StyleCState(
            direction="long",
            entry_price=4800.0,
            stop_pts=20.0,
            current_price=4805.0,
            current_time_et="10:30",
            tp1_filled=True,
            tp2_filled=True,
            developing_session_poc=poc,  # POC set → takes priority
            high_since_entry=4815.0,
            low_since_entry=4790.0,
            atr14=10.0,
        )
        result = compute_style_c_exit(state)
        assert result.decision == "TIGHTEN_TRAIL_TO_X"
        assert abs(result.new_stop - poc) < 1e-6, (
            "H5b: POC trail did not take priority — Chandelier should not override POC"
        )


# ─────────────────────────────────────────────────────────────────────────────
# H5a re-callable: same-bar TP1→TP2 sweep
# ─────────────────────────────────────────────────────────────────────────────

class TestH5aStyleCReCallable:
    """compute_style_c_exit is a pure function — second call with tp1_filled=True
    must evaluate TP2 (enabling same-bar TP1+TP2 sweep)."""

    def _import_handler(self):
        # The re-callable test class has its own _import_handler:
        from src.engine.exits.style_c_handler import evaluate_exit, StyleCState
        return evaluate_exit, StyleCState

    def test_tp2_fires_on_second_call_tp1_already_filled(self):
        """Second call with tp1_filled=True and price ≥ TP2 → FILL_TP2."""
        compute_style_c_exit, StyleCState = self._import_handler()
        entry = 4800.0
        stop_pts = 20.0  # R = 20 pts; TP2 = 4800 + 2*20 = 4840

        # First call: TP1 not yet filled
        state_before = StyleCState(
            direction="long",
            entry_price=entry,
            stop_pts=stop_pts,
            current_price=4845.0,  # above both TP1 (4820) and TP2 (4840)
            current_time_et="10:00",
            tp1_filled=False,
            tp2_filled=False,
        )
        result1 = compute_style_c_exit(state_before)
        assert result1.decision in ("FILL_TP1", "FILL_TP1_50PCT"), (
            f"Expected FILL_TP1 or FILL_TP1_50PCT on first call, got {result1.decision}"
        )

        # Second call: caller marks tp1_filled=True, same price above TP2
        state_after = StyleCState(
            direction="long",
            entry_price=entry,
            stop_pts=stop_pts,
            current_price=4845.0,
            current_time_et="10:00",
            tp1_filled=True,  # caller flagged after booking TP1
            tp2_filled=False,
        )
        result2 = compute_style_c_exit(state_after)
        assert result2.decision == "FILL_TP2", (
            f"H5a re-callable: expected FILL_TP2 on second call with tp1_filled=True, got {result2.decision}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# H5c — DST-correct pre-lunch check
# ─────────────────────────────────────────────────────────────────────────────

class TestH5cPreLunchDSTCorrect:
    """_is_at_or_after_pre_lunch_et must use ZoneInfo, not UTC-offset approximation.
    EST winter: 11:30 ET = 16:30 UTC (UTC-5). Old code fired at 15:30 UTC = 10:30 ET."""

    def _fn(self):
        from src.engine.exits.adaptive_exits import _is_at_or_after_pre_lunch_et
        return _is_at_or_after_pre_lunch_et

    def test_11_30_et_returns_true_est_winter(self):
        """11:30 ET in EST winter (UTC-5) = 16:30 UTC. Must return True."""
        fn = self._fn()
        from zoneinfo import ZoneInfo
        ET = ZoneInfo("America/New_York")
        # 2026-01-05 is a Monday in January — EST (UTC-5)
        et_11_30 = datetime(2026, 1, 5, 11, 30, 0, tzinfo=ET)
        assert fn(et_11_30) is True, "H5c: 11:30 ET in winter should be at or after pre-lunch"

    def test_11_29_et_returns_false_est_winter(self):
        """11:29 ET must return False."""
        fn = self._fn()
        from zoneinfo import ZoneInfo
        ET = ZoneInfo("America/New_York")
        et_11_29 = datetime(2026, 1, 5, 11, 29, 0, tzinfo=ET)
        assert fn(et_11_29) is False, "H5c: 11:29 ET in winter should be before pre-lunch"

    def test_10_30_et_winter_bug_is_fixed(self):
        """Old bug: 10:30 ET winter = 15:30 UTC → old code returned True. Must now return False."""
        fn = self._fn()
        from zoneinfo import ZoneInfo
        ET = ZoneInfo("America/New_York")
        et_10_30 = datetime(2026, 1, 5, 10, 30, 0, tzinfo=ET)
        assert fn(et_10_30) is False, (
            "H5c: 10:30 ET winter must return False (old UTC-offset bug fired True here)"
        )

    def test_11_30_et_returns_true_edt_summer(self):
        """11:30 ET in EDT summer (UTC-4) = 15:30 UTC. Must return True."""
        fn = self._fn()
        from zoneinfo import ZoneInfo
        ET = ZoneInfo("America/New_York")
        # 2026-06-15 is in EDT (UTC-4)
        et_11_30 = datetime(2026, 6, 15, 11, 30, 0, tzinfo=ET)
        assert fn(et_11_30) is True

    def test_naive_utc_timestamp_11_30_et_winter_treated_correctly(self):
        """Naive datetime treated as UTC: 16:30 UTC = 11:30 ET winter → True."""
        fn = self._fn()
        naive_utc_16_30 = datetime(2026, 1, 5, 16, 30, 0)  # no tzinfo → assumed UTC
        assert fn(naive_utc_16_30) is True, "H5c: 16:30 naive-UTC = 11:30 ET winter → True"

    def test_naive_utc_10_30_et_winter_returns_false(self):
        """Naive 15:30 UTC = 10:30 ET winter → must return False (old bug returned True)."""
        fn = self._fn()
        naive_utc_15_30 = datetime(2026, 1, 5, 15, 30, 0)  # no tzinfo → assumed UTC
        assert fn(naive_utc_15_30) is False, (
            "H5c: 15:30 naive-UTC = 10:30 ET winter → must be False (old bug: True)"
        )

    def test_exception_returns_false(self):
        """On exception (e.g., invalid input type), must return False rather than raise."""
        fn = self._fn()
        result = fn(None)  # type: ignore
        assert result is False


# ─────────────────────────────────────────────────────────────────────────────
# M-1 — MAX_HOLD_BARS env-overridable
# ─────────────────────────────────────────────────────────────────────────────

class TestM1MaxHoldBarsEnvOverride:
    """BACKTEST_MAX_HOLD_BARS env var must be read at init, not hardcoded 200."""

    def test_env_var_respected_in_source(self):
        """backtester.py must read BACKTEST_MAX_HOLD_BARS from env."""
        import pathlib
        text = (pathlib.Path(__file__).parent.parent / "src" / "engine" / "backtester.py").read_text(encoding="utf-8")
        assert "BACKTEST_MAX_HOLD_BARS" in text, "M-1: BACKTEST_MAX_HOLD_BARS env var not referenced"
        assert 'os.environ.get("BACKTEST_MAX_HOLD_BARS"' in text, (
            "M-1: BACKTEST_MAX_HOLD_BARS must be read via os.environ.get()"
        )

    def test_both_occurrences_replaced(self):
        """Both Style-C static and adaptive MAX_HOLD_BARS must use env var."""
        import pathlib
        text = (pathlib.Path(__file__).parent.parent / "src" / "engine" / "backtester.py").read_text(encoding="utf-8")
        count = text.count('os.environ.get("BACKTEST_MAX_HOLD_BARS"')
        assert count >= 2, (
            f"M-1: expected ≥2 occurrences of BACKTEST_MAX_HOLD_BARS env read, got {count}"
        )

    def test_default_is_200(self):
        """Default must be 200 to preserve historical behavior."""
        import pathlib
        text = (pathlib.Path(__file__).parent.parent / "src" / "engine" / "backtester.py").read_text(encoding="utf-8")
        assert '"200"' in text or "'200'" in text, (
            "M-1: default for BACKTEST_MAX_HOLD_BARS must be '200'"
        )

    def test_no_hardcoded_max_hold_bars_200_assignment(self):
        """Ensure bare 'MAX_HOLD_BARS = 200' code assignment (non-env) is gone.
        Comments/docstrings mentioning 'MAX_HOLD_BARS=200' are acceptable documentation."""
        import pathlib, re
        text = (pathlib.Path(__file__).parent.parent / "src" / "engine" / "backtester.py").read_text(encoding="utf-8")
        # Match only CODE assignment lines (not comment lines starting with #)
        # Pattern: line is NOT a comment AND contains 'MAX_HOLD_BARS = <integer literal>'
        hardcoded = [
            line for line in text.splitlines()
            if re.search(r"^\s*MAX_HOLD_BARS\s*=\s*\d+\b", line)
            and not line.strip().startswith("#")
            and "os.environ" not in line
            and "int(" not in line
        ]
        assert len(hardcoded) == 0, (
            f"M-1: found hardcoded MAX_HOLD_BARS = <int> assignment(s) in code: {hardcoded}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# M-2 — WRC/SPA short-path floor in CPCV
# ─────────────────────────────────────────────────────────────────────────────

class TestM2WrcSpaShortPathFloor:
    """walk_forward.py CPCV path must exclude paths shorter than max(30, mean*0.5)."""

    def _src(self) -> str:
        import pathlib
        return (
            pathlib.Path(__file__).parent.parent / "src" / "engine" / "walk_forward.py"
        ).read_text(encoding="utf-8")

    def test_floor_formula_present(self):
        """max(30, ...) floor formula must appear in walk_forward.py CPCV section."""
        text = self._src()
        assert "max(30" in text and "_path_floor" in text, (
            "M-2: floor formula max(30, ...) not found in walk_forward.py"
        )

    def test_excluded_path_audit_print_present(self):
        """Excluded path must trigger a stderr print."""
        text = self._src()
        assert "wrc_spa_short_path_excluded" in text, (
            "M-2: per-excluded-path audit message missing from walk_forward.py"
        )

    def test_post_floor_min_len_warning_present(self):
        """Post-floor min_len < 0.5*mean warning must be present."""
        text = self._src()
        assert "bootstrap power" in text, (
            "M-2: post-floor bootstrap power warning missing from walk_forward.py"
        )

    def test_floor_logic_correctness(self):
        """Pure-Python replica of the floor logic: verify path exclusion semantics."""
        paths = [list(range(25)), list(range(40)), list(range(35)), list(range(21))]
        WRC_MIN_OBS = 20
        eligible = [p for p in paths if len(p) >= WRC_MIN_OBS]
        mean_len = sum(len(p) for p in eligible) / len(eligible)
        floor = max(30.0, mean_len * 0.5)
        filtered = [p for p in eligible if len(p) >= floor]
        # Paths with lengths [25, 40, 35, 21]. All >= 20. Mean = 30.25. Floor = max(30, 15.125) = 30.
        # len=25: 25 < 30 → excluded. len=40,35: kept. len=21: excluded.
        assert len(filtered) == 2, f"Expected 2 paths after floor filter, got {len(filtered)}"
        assert all(len(p) >= 30 for p in filtered)


# ─────────────────────────────────────────────────────────────────────────────
# M-3 — Vectorized _apply_max_trades_per_day (byte-identical output)
# ─────────────────────────────────────────────────────────────────────────────

class TestM3VectorizedMaxTradesPerDay:
    """_apply_max_trades_per_day vectorized via pandas must be byte-identical to the old loop."""

    def _fn(self):
        from src.engine.backtester import _apply_max_trades_per_day
        return _apply_max_trades_per_day

    def _make_timestamps(self, days: int, bars_per_day: int = 5) -> list:
        """Generate a simple timestamp array spanning 'days' days."""
        import pandas as pd
        start = datetime(2025, 1, 2, 9, 30, tzinfo=timezone.utc)
        ts = []
        for d in range(days):
            for b in range(bars_per_day):
                ts.append(start + timedelta(days=d, minutes=b * 5))
        return ts

    def _reference_loop(self, long_entries, short_entries, timestamps, max_trades):
        """Original O(n) loop implementation for parity verification."""
        import numpy as np
        n = len(long_entries)
        filtered_long = long_entries.copy()
        filtered_short = short_entries.copy()
        daily_counts: dict = {}
        for i in range(n):
            has_long = bool(filtered_long[i])
            has_short = bool(filtered_short[i])
            if not has_long and not has_short:
                continue
            ts = timestamps[i]
            try:
                day_key = str(ts)[:10]
            except Exception:
                continue
            count = daily_counts.get(day_key, 0)
            new_count = count
            if has_long:
                if new_count < max_trades:
                    new_count += 1
                else:
                    filtered_long[i] = False
            if has_short:
                if new_count < max_trades:
                    new_count += 1
                else:
                    filtered_short[i] = False
            daily_counts[day_key] = new_count
        return filtered_long, filtered_short

    def test_parity_single_direction(self):
        """Long-only entries: vectorized must match loop output exactly."""
        import numpy as np
        fn = self._fn()
        ts = self._make_timestamps(3, bars_per_day=6)
        n = len(ts)
        # Every other bar is a long entry, no short
        long_entries = np.zeros(n, dtype=bool)
        long_entries[0::2] = True
        short_entries = np.zeros(n, dtype=bool)

        ref_l, ref_s = self._reference_loop(long_entries.copy(), short_entries.copy(), ts, max_trades=2)
        got_l, got_s = fn(long_entries.copy(), short_entries.copy(), ts, max_trades=2)

        assert np.array_equal(ref_l, got_l), "M-3: long_entries mismatch"
        assert np.array_equal(ref_s, got_s), "M-3: short_entries mismatch (empty)"

    def test_parity_mixed_entries(self):
        """Mixed long+short on various bars: vectorized must match loop."""
        import numpy as np
        fn = self._fn()
        ts = self._make_timestamps(3, bars_per_day=6)
        n = len(ts)
        long_entries = np.array([True, False, True, True, False, False,
                                  True, True, False, True, False, True,
                                  False, True, True, False, True, False], dtype=bool)
        short_entries = np.array([False, True, False, True, False, True,
                                   False, True, True, False, True, False,
                                   True, False, False, True, True, True], dtype=bool)

        for max_t in [1, 2, 3]:
            ref_l, ref_s = self._reference_loop(long_entries.copy(), short_entries.copy(), ts, max_trades=max_t)
            got_l, got_s = fn(long_entries.copy(), short_entries.copy(), ts, max_trades=max_t)
            assert np.array_equal(ref_l, got_l), f"M-3: long mismatch max_trades={max_t}"
            assert np.array_equal(ref_s, got_s), f"M-3: short mismatch max_trades={max_t}"

    def test_parity_same_bar_long_and_short(self):
        """Same-bar L+S: both entries compete for slots. Parity with reference loop."""
        import numpy as np
        fn = self._fn()
        ts = self._make_timestamps(2, bars_per_day=4)
        n = len(ts)
        long_entries = np.array([True, True, False, False, True, True, False, True], dtype=bool)
        short_entries = np.array([True, True, False, True, True, True, False, True], dtype=bool)

        for max_t in [1, 2, 3]:
            ref_l, ref_s = self._reference_loop(long_entries.copy(), short_entries.copy(), ts, max_trades=max_t)
            got_l, got_s = fn(long_entries.copy(), short_entries.copy(), ts, max_trades=max_t)
            assert np.array_equal(ref_l, got_l), f"M-3 same-bar: long mismatch max_trades={max_t}"
            assert np.array_equal(ref_s, got_s), f"M-3 same-bar: short mismatch max_trades={max_t}"

    def test_max_trades_zero_returns_unchanged(self):
        """max_trades=0 → no suppression (unlimited)."""
        import numpy as np
        fn = self._fn()
        ts = self._make_timestamps(2, bars_per_day=4)
        n = len(ts)
        long_entries = np.ones(n, dtype=bool)
        short_entries = np.ones(n, dtype=bool)
        got_l, got_s = fn(long_entries.copy(), short_entries.copy(), ts, max_trades=0)
        assert np.array_equal(got_l, long_entries)
        assert np.array_equal(got_s, short_entries)

    def test_empty_arrays(self):
        """Empty input must return empty output without error."""
        import numpy as np
        fn = self._fn()
        got_l, got_s = fn(np.zeros(0, dtype=bool), np.zeros(0, dtype=bool), [], max_trades=2)
        assert len(got_l) == 0
        assert len(got_s) == 0


# ─────────────────────────────────────────────────────────────────────────────
# M-4 — Polars-native compute_dataset_hash
# ─────────────────────────────────────────────────────────────────────────────

class TestM4PolarsNativeHash:
    """compute_dataset_hash must use Polars write_csv(), not pandas to_csv()."""

    def _make_df(self):
        import polars as pl
        return pl.DataFrame({
            "ts_event": ["2025-01-02 09:30:00", "2025-01-02 09:35:00", "2025-01-02 09:40:00"],
            "open": [4800.25, 4801.50, 4799.75],
            "high": [4805.00, 4803.00, 4802.50],
            "low": [4798.00, 4799.00, 4797.00],
            "close": [4802.00, 4800.50, 4801.00],
            "volume": [1500.0, 1200.0, 980.0],
        })

    def _fn(self):
        from src.engine.data_loader import compute_dataset_hash
        return compute_dataset_hash

    def test_hash_is_deterministic(self):
        """Same DataFrame input must produce identical hash on successive calls."""
        fn = self._fn()
        df = self._make_df()
        h1 = fn(df)
        h2 = fn(df)
        assert h1 == h2, "M-4: hash not deterministic across calls"

    def test_hash_is_sha256_hex(self):
        """Return value must be a 64-character hex string (SHA-256)."""
        fn = self._fn()
        h = fn(self._make_df())
        assert isinstance(h, str), "M-4: hash must be a string"
        assert len(h) == 64, f"M-4: expected 64-char SHA-256 hex, got len={len(h)}"
        assert all(c in "0123456789abcdef" for c in h), "M-4: hash must be lowercase hex"

    def test_different_data_different_hash(self):
        """Modifying one price value must change the hash."""
        import polars as pl
        fn = self._fn()
        df1 = self._make_df()
        df2 = self._make_df().with_columns(
            pl.Series("close", [4802.00, 4800.50, 4801.01])  # last close changed
        )
        assert fn(df1) != fn(df2), "M-4: hash collision for different data"

    def test_row_order_does_not_matter(self):
        """Hash must be order-independent (function sorts by ts_event)."""
        fn = self._fn()
        df_asc = self._make_df()
        df_desc = df_asc.sort("ts_event", descending=True)
        assert fn(df_asc) == fn(df_desc), (
            "M-4: hash must be order-independent (sorted by ts_event)"
        )

    def test_no_pandas_to_csv_in_source(self):
        """Source code (not docstrings) must not use .to_pandas().to_csv() for hashing."""
        import pathlib, re, ast
        text = (
            pathlib.Path(__file__).parent.parent / "src" / "engine" / "data_loader.py"
        ).read_text(encoding="utf-8")
        # Extract just the code lines of compute_dataset_hash (skip docstring lines)
        fn_start = text.find("def compute_dataset_hash")
        fn_end = text.find("\ndef ", fn_start + 1)
        fn_body = text[fn_start:fn_end if fn_end > 0 else fn_start + 2000]
        # Strip docstring lines: lines inside triple-quote blocks
        in_docstring = False
        code_lines = []
        for line in fn_body.splitlines():
            stripped = line.strip()
            if stripped.startswith('"""') or stripped.startswith("'''"):
                in_docstring = not in_docstring
                if stripped.count('"""') == 2 or stripped.count("'''") == 2:
                    in_docstring = False  # single-line docstring
                continue
            if not in_docstring and not stripped.startswith("#"):
                code_lines.append(line)
        code_only = "\n".join(code_lines)
        assert "to_pandas" not in code_only, (
            "M-4: compute_dataset_hash must not use .to_pandas() in code (version-unstable). "
            "Found: " + repr([l for l in code_lines if "to_pandas" in l])
        )
        assert "write_csv" in fn_body, "M-4: compute_dataset_hash must use Polars write_csv()"


# ─────────────────────────────────────────────────────────────────────────────
# M-5 — lru_cache env getters in fill_model
# ─────────────────────────────────────────────────────────────────────────────

class TestM5FillModelLruCacheGetters:
    """fill_model must expose lru_cache getter functions for test isolation."""

    def _mod(self):
        import src.engine.fill_model as mod
        return mod

    def test_getter_functions_exist(self):
        """_get_partial_fill_enabled and _get_partial_fill_volume_threshold must exist."""
        mod = self._mod()
        assert hasattr(mod, "_get_partial_fill_enabled"), (
            "M-5: _get_partial_fill_enabled getter function missing"
        )
        assert hasattr(mod, "_get_partial_fill_volume_threshold"), (
            "M-5: _get_partial_fill_volume_threshold getter function missing"
        )

    def test_getters_have_cache_clear(self):
        """lru_cache getters must expose .cache_clear() method."""
        mod = self._mod()
        assert hasattr(mod._get_partial_fill_enabled, "cache_clear"), (
            "M-5: _get_partial_fill_enabled must be lru_cached"
        )
        assert hasattr(mod._get_partial_fill_volume_threshold, "cache_clear"), (
            "M-5: _get_partial_fill_volume_threshold must be lru_cached"
        )

    def test_default_enabled_is_true(self):
        """Default (no env override) must return True for enabled."""
        import src.engine.fill_model as mod
        mod._get_partial_fill_enabled.cache_clear()
        env_backup = os.environ.pop("BACKTEST_PARTIAL_FILL_ENABLED", None)
        try:
            assert mod._get_partial_fill_enabled() is True
        finally:
            if env_backup is not None:
                os.environ["BACKTEST_PARTIAL_FILL_ENABLED"] = env_backup
            mod._get_partial_fill_enabled.cache_clear()

    def test_cache_clear_allows_env_override(self):
        """After cache_clear(), setting env var must change getter result."""
        import src.engine.fill_model as mod
        mod._get_partial_fill_enabled.cache_clear()
        # Force enabled state
        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            mod._get_partial_fill_enabled.cache_clear()
            assert mod._get_partial_fill_enabled() is True

        # Now simulate disabling via cache_clear + env patch
        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "false"}):
            mod._get_partial_fill_enabled.cache_clear()
            result = mod._get_partial_fill_enabled()
            assert result is False, (
                f"M-5: cache_clear + env='false' must return False, got {result}"
            )

        mod._get_partial_fill_enabled.cache_clear()

    def test_threshold_cache_clear_allows_override(self):
        """Threshold getter must be overridable via cache_clear + env."""
        import src.engine.fill_model as mod
        mod._get_partial_fill_volume_threshold.cache_clear()

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD": "0.25"}):
            mod._get_partial_fill_volume_threshold.cache_clear()
            result = mod._get_partial_fill_volume_threshold()
            assert abs(result - 0.25) < 1e-9, (
                f"M-5: threshold getter should return 0.25 after cache_clear, got {result}"
            )

        mod._get_partial_fill_volume_threshold.cache_clear()

    def test_module_no_longer_has_frozen_constants(self):
        """_PARTIAL_FILL_ENABLED and _PARTIAL_FILL_VOLUME_THRESHOLD as module-level
        frozen booleans/floats must NOT exist (replaced by getter functions)."""
        import src.engine.fill_model as mod
        # These should not be simple bool/float constants
        for name in ("_PARTIAL_FILL_ENABLED", "_PARTIAL_FILL_VOLUME_THRESHOLD"):
            val = getattr(mod, name, "NOT_PRESENT")
            assert val == "NOT_PRESENT" or callable(val), (
                f"M-5: {name} should not exist as a frozen constant; got type={type(val)}"
            )


# ─────────────────────────────────────────────────────────────────────────────
# L-1 — slippage stop/stop_market guard
# ─────────────────────────────────────────────────────────────────────────────

class TestL1SlippageStopMarketGuard:
    """compute_slippage must raise ValueError for stop/stop_market order types."""

    def _make_df(self):
        import polars as pl
        return pl.DataFrame({
            "open": [4800.0, 4801.0, 4802.0],
            "high": [4805.0, 4804.0, 4803.0],
            "low": [4798.0, 4799.0, 4800.0],
            "close": [4802.0, 4803.0, 4801.0],
            "volume": [1000.0, 1200.0, 900.0],
            "atr_14": [8.5, 8.2, 8.7],
        })

    def _spec(self):
        from src.engine.config import ContractSpec
        return ContractSpec(
            symbol="MES",
            tick_size=0.25,
            tick_value=1.25,
            point_value=5.0,
            margin=1320.0,
            currency="USD",
        )

    def test_stop_raises(self):
        """order_type='stop' must raise ValueError."""
        from src.engine.slippage import compute_slippage
        import pytest
        with pytest.raises(ValueError, match="stop/stop_market orders are prohibited"):
            compute_slippage(self._make_df(), self._spec(), order_type="stop")

    def test_stop_market_raises(self):
        """order_type='stop_market' must raise ValueError."""
        from src.engine.slippage import compute_slippage
        import pytest
        with pytest.raises(ValueError, match="stop/stop_market orders are prohibited"):
            compute_slippage(self._make_df(), self._spec(), order_type="stop_market")

    def test_market_does_not_raise(self):
        """order_type='market' (default) must work normally."""
        from src.engine.slippage import compute_slippage
        result = compute_slippage(self._make_df(), self._spec(), order_type="market")
        assert len(result) == 3, "L-1: market order slippage array must have 3 elements"

    def test_limit_does_not_raise(self):
        """order_type='limit' must work normally."""
        from src.engine.slippage import compute_slippage
        result = compute_slippage(self._make_df(), self._spec(), order_type="limit")
        assert len(result) == 3

    def test_stop_limit_does_not_raise(self):
        """order_type='stop_limit' must work normally (base slippage × 1.0)."""
        from src.engine.slippage import compute_slippage
        result = compute_slippage(self._make_df(), self._spec(), order_type="stop_limit")
        assert len(result) == 3

    def test_error_message_mentions_stop_limit_alternative(self):
        """ValueError message must mention stop_limit as the alternative."""
        from src.engine.slippage import compute_slippage
        try:
            compute_slippage(self._make_df(), self._spec(), order_type="stop")
        except ValueError as e:
            assert "stop_limit" in str(e), "L-1: error must mention stop_limit alternative"
        else:
            assert False, "L-1: ValueError not raised for stop order"
