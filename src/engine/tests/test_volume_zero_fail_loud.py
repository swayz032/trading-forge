"""test_volume_zero_fail_loud.py — Wave 27.5 Pass D.3 (M1)

Tests for the ZeroVolumeOnTradeCriticalBar fail-loud guard in data_loader.py.

Covers:
  - Normal bar (volume > 0) → returns False (fast path, no error)
  - Zero-vol bar + fail_loud=true (default) → raises ZeroVolumeOnTradeCriticalBar
  - Zero-vol bar + fail_loud=false (env=false) → returns True (silent skip)
  - Backward-compat: env var "false" triggers silent skip (legacy behavior)
  - Audit callback invoked with correct payload on zero-vol detection
  - Audit callback exception does not propagate (non-blocking)
  - Raise path: exception fields are populated correctly
  - Multiple actions (stop_trigger, tp1_trigger, entry_fill) all guarded
"""

import pytest

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _import_guard():
    """Import the guard and exception from data_loader."""
    from src.engine.data_loader import (
        ZeroVolumeOnTradeCriticalBar,
        check_zero_volume_trade_critical,
    )
    return ZeroVolumeOnTradeCriticalBar, check_zero_volume_trade_critical


def _set_fail_loud(value: str | None, monkeypatch):
    """Set or unset the BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD env var."""
    if value is None:
        monkeypatch.delenv("BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD", raising=False)
    else:
        monkeypatch.setenv("BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD", value)


# ─── Fast path ────────────────────────────────────────────────────────────────

class TestNormalBar:
    def test_nonzero_volume_returns_false(self, monkeypatch):
        """Normal bar (volume > 0) must return False immediately without side effects."""
        _ZeroVol, check = _import_guard()
        _set_fail_loud("true", monkeypatch)  # Even with fail-loud enabled

        result = check(100.0, "2026-01-02T09:30:00", "MES", "stop_trigger")
        assert result is False

    def test_large_volume_returns_false(self, monkeypatch):
        """Sanity: large volume returns False."""
        _ZeroVol, check = _import_guard()
        _set_fail_loud(None, monkeypatch)  # Default

        result = check(999_999.0, "2026-01-02T09:30:00", "NQ", "tp1_trigger")
        assert result is False


# ─── Fail-loud path (institutional default) ──────────────────────────────────

class TestFailLoudRaise:
    def test_zero_vol_fail_loud_raises(self, monkeypatch):
        """Default env (fail_loud=true): volume=0 must raise ZeroVolumeOnTradeCriticalBar."""
        ZeroVol, check = _import_guard()
        _set_fail_loud("true", monkeypatch)

        with pytest.raises(ZeroVol):
            check(0.0, "2026-01-01T09:30:00", "MES", "stop_trigger")

    def test_zero_vol_default_env_raises(self, monkeypatch):
        """Unset env var defaults to fail-loud (institutional default)."""
        ZeroVol, check = _import_guard()
        _set_fail_loud(None, monkeypatch)  # No env var — defaults to "true"

        with pytest.raises(ZeroVol):
            check(0.0, "2026-07-04T09:30:00", "NQ", "entry_fill")

    def test_exception_fields_populated(self, monkeypatch):
        """Raised exception carries bar_timestamp, symbol, attempted_action."""
        ZeroVol, check = _import_guard()
        _set_fail_loud("true", monkeypatch)

        ts = "2026-11-27T09:30:00"
        sym = "MCL"
        action = "tp1_trigger"

        with pytest.raises(ZeroVol) as exc_info:
            check(0.0, ts, sym, action)

        exc = exc_info.value
        assert exc.bar_timestamp == ts
        assert exc.symbol == sym
        assert exc.attempted_action == action
        assert sym in str(exc)
        assert action in str(exc)

    def test_all_trade_critical_actions_raise(self, monkeypatch):
        """stop_trigger / tp1_trigger / tp2_trigger / entry_fill all raise on vol=0."""
        ZeroVol, check = _import_guard()
        _set_fail_loud("true", monkeypatch)

        actions = ["stop_trigger", "tp1_trigger", "tp2_trigger", "entry_fill"]
        for action in actions:
            with pytest.raises(ZeroVol, match=action):
                check(0.0, "2026-01-01T09:30:00", "MES", action)


# ─── Backward-compat: fail-loud disabled ─────────────────────────────────────

class TestFailLoudDisabled:
    def test_zero_vol_env_false_returns_true_no_raise(self, monkeypatch):
        """env=false: volume=0 returns True (caller should skip bar), does not raise."""
        ZeroVol, check = _import_guard()
        _set_fail_loud("false", monkeypatch)

        result = check(0.0, "2026-01-01T09:30:00", "MES", "stop_trigger")
        assert result is True  # Caller-should-skip signal

    def test_zero_vol_env_false_case_insensitive(self, monkeypatch):
        """env var comparison is case-insensitive — 'FALSE' / 'False' work."""
        ZeroVol, check = _import_guard()
        for val in ("FALSE", "False", "false"):
            _set_fail_loud(val, monkeypatch)
            result = check(0.0, "2026-01-01T09:30:00", "NQ", "tp1_trigger")
            assert result is True, f"Expected True for env={val!r}"


# ─── Audit callback ───────────────────────────────────────────────────────────

class TestAuditCallback:
    def test_audit_callback_called_on_zero_vol(self, monkeypatch):
        """Audit callback receives correct action name and payload on zero-vol detection."""
        ZeroVol, check = _import_guard()
        _set_fail_loud("false", monkeypatch)  # Use non-raise path to capture callback

        calls = []

        def cb(action, payload):
            calls.append((action, payload))

        check(0.0, "2026-01-02T09:30:00", "MES", "stop_trigger", audit_callback=cb)

        assert len(calls) == 1
        action, payload = calls[0]
        assert action == "backtest.zero_volume_trade_critical_raised"
        assert payload["symbol"] == "MES"
        assert payload["attempted_action"] == "stop_trigger"
        assert payload["bar_timestamp"] == "2026-01-02T09:30:00"

    def test_audit_callback_exception_non_blocking(self, monkeypatch):
        """Audit callback that raises must NOT propagate — guard still raises ZeroVol."""
        ZeroVol, check = _import_guard()
        _set_fail_loud("true", monkeypatch)

        def bad_cb(action, payload):
            raise RuntimeError("DB unavailable")

        # The ZeroVolumeOnTradeCriticalBar should still be raised despite callback failure
        with pytest.raises(ZeroVol):
            check(0.0, "2026-01-02T09:30:00", "MCL", "tp2_trigger", audit_callback=bad_cb)

    def test_audit_callback_not_called_on_normal_bar(self, monkeypatch):
        """Audit callback is NOT invoked when volume > 0 (fast path)."""
        _ZeroVol, check = _import_guard()
        _set_fail_loud("true", monkeypatch)

        calls = []

        def cb(action, payload):
            calls.append((action, payload))

        check(50.0, "2026-01-02T09:30:00", "MES", "stop_trigger", audit_callback=cb)

        assert calls == [], "Callback must not fire on normal bar"
