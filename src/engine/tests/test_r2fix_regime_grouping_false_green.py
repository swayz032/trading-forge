"""RATIFY-PACKET false-green closure fix (scope-locked r2fix, 2026-07-16).

DEFECT (HIGH, false-green, challenger-only/advisory): RL regime-conditioned
training was UNCONDITIONALLY dead but silently reported "completed success".
`load_backtest_bar_data()` (src/engine/replay/db_loader.py) returns flat bar
dicts with no `state` sub-dict and no `institutional_regime` key at all — so
every real invocation of `train_regime_conditioned_policies` grouped bars by
a key that is always None, `regime_bars` came out completely empty, every one
of the 6 regimes hit the ordinary "insufficient data" skip path, and the
function returned `{}` — indistinguishable from a genuinely thin-data run.
The CLI's `_any_write_failed = any({}.values())` was vacuously False, so
`sys.exit(0)`, and `quantum-rl-training-runner.ts` recorded a clean
"completed" success + RESET the circuit breaker on every single run.

Scope of this fix (see quantum_rl_agent.py inline comments for the full
design note): CLOSE THE FALSE-GREEN ONLY — distinguish "bars present but the
grouping key is entirely absent" (a real defect) from "bars present, grouped
correctly, but each regime individually has < 100 bars" (legitimate,
non-alarming data scarcity that must keep skipping quietly). Actually wiring
a real per-bar institutional_regime for historical training bars is a
DESIGN DECISION explicitly OUT OF SCOPE here (flagged for operator/architect
review — see the ratify-packet report).

Tests:
  1. Bars present, NO institutional_regime key on any bar → sentinel
     {"status": "regime_grouping_failed", ...} returned, NOT {}.
  2. That sentinel case emits a distinct `quantum_rl.regime_grouping_failed`
     warning audit row (not the misleading per-regime "insufficient_data"
     info rows).
  3. Genuine data scarcity (bars correctly regime-tagged, each regime under
     the 100-bar floor) is UNCHANGED — still returns {} via the ordinary
     per-regime skip path (RED-proof that the fix doesn't over-fire).
  4. build_train_cli_payload(): the grouping-failed sentinel produces the
     DEGRADED exit code 3 (r2fix round-2 refinement) + `regime_grouping_failed:
     true` — non-zero (so the runner never calls _recordRlSuccess / persists
     status="completed", i.e. the false-green stays closed) but DISTINCT from a
     real runtime failure (exit 1) so the runner's code===3 branch surfaces a
     non-paging degraded audit instead of opening the breaker + Discord CRITICAL
     for a documented deferred design gap.
  5. build_train_cli_payload(): a genuine zero-regime clean run (empty dict,
     no sentinel) still exits 0 — the legitimate skip path is not penalized.
  6. build_train_cli_payload(): a per-regime db_write_failed=True (F-1's
     existing contract) still exits 1 (the REAL-incident path, which SHOULD
     page) and is not confused with the new grouping-failed detection
     (mutually exclusive, distinct exit codes, both surfaced honestly).
"""
from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# psycopg2 shim — allows import without a real DB driver in CI
# ---------------------------------------------------------------------------
if "psycopg2" not in sys.modules:
    _psycopg2_mock = types.ModuleType("psycopg2")
    _psycopg2_extras_mock = types.ModuleType("psycopg2.extras")

    class _DictCursor:
        pass

    _psycopg2_extras_mock.DictCursor = _DictCursor  # type: ignore[attr-defined]
    _psycopg2_mock.extras = _psycopg2_extras_mock   # type: ignore[attr-defined]
    _psycopg2_mock.connect = MagicMock()             # type: ignore[attr-defined]
    sys.modules["psycopg2"] = _psycopg2_mock
    sys.modules["psycopg2.extras"] = _psycopg2_extras_mock

# Stub heavy optional packages if not genuinely installed (mirrors the sibling
# Wave 29 Pass C.2 test file's guard — use the real package when present so we
# don't latch PENNYLANE_AVAILABLE=False process-wide for other test files).
import importlib as _importlib  # noqa: E402
_OPTIONAL_PKG_STUBS = ["pennylane", "braket", "braket.aws"]
for _pkg in _OPTIONAL_PKG_STUBS:
    if _pkg not in sys.modules:
        try:
            _importlib.import_module(_pkg)
        except Exception:
            sys.modules[_pkg] = types.ModuleType(_pkg)


@pytest.fixture(autouse=True)
def _restore_db_loader_module():
    """Snapshot/restore sys.modules['src.engine.replay.db_loader'] so the stub
    injected below never leaks into other test files run in the same process
    (same hygiene fix as the sibling Wave 29 Pass C.2 test file)."""
    _key = "src.engine.replay.db_loader"
    _original = sys.modules.get(_key)
    try:
        yield
    finally:
        if _original is not None:
            sys.modules[_key] = _original
        else:
            sys.modules.pop(_key, None)


import os  # noqa: E402
import src.engine.quantum_rl_agent as _rl_agent  # noqa: E402
from src.engine.quantum_rl_agent import (  # noqa: E402
    build_train_cli_payload,
    train_regime_conditioned_policies,
)


def _make_flat_bars_no_regime_key(n: int) -> list[dict]:
    """Mirrors the REAL shape load_backtest_bar_data() returns in production:
    a flat dict with macro_regime/session_type but NO institutional_regime
    key and NO 'state' sub-dict — the exact shape that reproduces the defect."""
    return [
        {
            "daily_ema_20": 4000.0 + i * 0.5,
            "probability_of_ruin_ci_high": 0.2,
            "macro_regime": "neutral",
            "session_type": "rth",
        }
        for i in range(n)
    ]


def _make_regime_tagged_bars(n: int, regime: str) -> list[dict]:
    """Bars correctly grouped by institutional_regime (the legitimate,
    non-buggy shape) — used for the genuine-scarcity contrast test."""
    return [
        {
            "institutional_regime": regime,
            "daily_ema_20": 4000.0 + i * 0.5,
            "probability_of_ruin_ci_high": 0.2,
        }
        for i in range(n)
    ]


def _make_backtest_lookup_conn(backtest_id=99):
    """Minimal fake psycopg2 connection that only needs to answer the
    backtest-id lookup SELECT — neither test scenario below reaches the
    quantum_rl_runs INSERT (both return via an early-skip / early-return
    path before any per-regime training batch runs)."""
    cur = MagicMock()
    cur.__enter__ = MagicMock(return_value=cur)
    cur.__exit__ = MagicMock(return_value=False)
    cur.execute = MagicMock()
    cur.fetchone = MagicMock(return_value={"id": backtest_id})
    conn = MagicMock()
    conn.cursor.return_value = cur
    conn.close = MagicMock()
    return conn


def _call_train_with_bars(bars: list, strategy_id: str = "r2fix-1") -> dict:
    import psycopg2

    psycopg2.connect = MagicMock(return_value=_make_backtest_lookup_conn())  # type: ignore[attr-defined]

    mock_loader = types.ModuleType("src.engine.replay.db_loader")
    mock_loader.load_backtest_bar_data = MagicMock(return_value=bars)  # type: ignore[attr-defined]
    sys.modules["src.engine.replay.db_loader"] = mock_loader

    with patch.object(_rl_agent, "_emit_audit_row"), \
         patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake"}):
        return train_regime_conditioned_policies(
            strategy_id=strategy_id,
            training_epochs=2,
            cpcv_purge=False,
            seed=42,
        )


# ===========================================================================
# Test 1: grouping-failed sentinel returned when bars are present but the
#         grouping key is entirely absent
# ===========================================================================

def test_bars_present_no_regime_key_returns_grouping_failed_sentinel():
    bars = _make_flat_bars_no_regime_key(500)
    result = _call_train_with_bars(bars)

    assert isinstance(result, dict)
    assert result.get("status") == "regime_grouping_failed", (
        f"Expected the false-green sentinel, got: {result!r}"
    )
    assert result["n_bars"] == 500
    assert "reason" in result and result["reason"]
    # Must NOT look like a per-regime results dict (no regime keys, no
    # db_write_failed key that a caller might mistake for a trained regime).
    assert "db_write_failed" not in result


# ===========================================================================
# Test 2: distinct audit row fires (not the misleading per-regime
#         "insufficient_data" rows)
# ===========================================================================

def test_grouping_failed_emits_distinct_audit_row():
    bars = _make_flat_bars_no_regime_key(200)
    audit_calls = []

    def capture_audit(action, entity_type, entity_id, status, result, db_url=None):
        audit_calls.append({"action": action, "status": status, "result": result})

    import psycopg2
    psycopg2.connect = MagicMock(return_value=_make_backtest_lookup_conn())  # type: ignore[attr-defined]
    mock_loader = types.ModuleType("src.engine.replay.db_loader")
    mock_loader.load_backtest_bar_data = MagicMock(return_value=bars)  # type: ignore[attr-defined]
    sys.modules["src.engine.replay.db_loader"] = mock_loader

    with patch.object(_rl_agent, "_emit_audit_row", side_effect=capture_audit), \
         patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake"}):
        train_regime_conditioned_policies(
            strategy_id="r2fix-2",
            training_epochs=2,
            cpcv_purge=False,
            seed=42,
        )

    grouping_audits = [a for a in audit_calls if a["action"] == "quantum_rl.regime_grouping_failed"]
    assert len(grouping_audits) == 1, f"Expected exactly 1 grouping-failed audit row, got: {audit_calls}"
    assert grouping_audits[0]["status"] == "warning"
    assert grouping_audits[0]["result"]["n_bars"] == 200

    # The misleading per-regime "insufficient_data" rows (6x, one per
    # regime) must NOT fire in the grouping-failed case — they'd otherwise
    # mask the real defect as ordinary thin-data skips.
    insufficient_audits = [a for a in audit_calls if a["action"] == "quantum_rl.regime_insufficient_data"]
    assert insufficient_audits == [], (
        "Grouping-failed case must short-circuit before the per-regime "
        f"insufficient_data skip path fires; got: {insufficient_audits}"
    )


# ===========================================================================
# Test 3: RED-proof — genuine per-regime data scarcity is UNCHANGED
# ===========================================================================

def test_genuine_scarcity_still_returns_empty_dict_not_sentinel():
    """Bars ARE correctly regime-tagged, just below the 100-bar floor for
    every regime. This must behave EXACTLY as before the fix: plain {},
    no sentinel, no regime_grouping_failed audit — the legitimate skip path
    must not be disturbed by this change."""
    bars = _make_regime_tagged_bars(50, "COMPRESSION")  # below _REGIME_MIN_BARS=100
    audit_calls = []

    def capture_audit(action, entity_type, entity_id, status, result, db_url=None):
        audit_calls.append({"action": action, "status": status})

    import psycopg2
    psycopg2.connect = MagicMock(return_value=_make_backtest_lookup_conn())  # type: ignore[attr-defined]
    mock_loader = types.ModuleType("src.engine.replay.db_loader")
    mock_loader.load_backtest_bar_data = MagicMock(return_value=bars)  # type: ignore[attr-defined]
    sys.modules["src.engine.replay.db_loader"] = mock_loader

    with patch.object(_rl_agent, "_emit_audit_row", side_effect=capture_audit), \
         patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake"}):
        result = train_regime_conditioned_policies(
            strategy_id="r2fix-3",
            training_epochs=2,
            cpcv_purge=False,
            seed=42,
        )

    assert result == {}, f"Genuine scarcity must still return plain {{}}, got: {result!r}"
    grouping_audits = [a for a in audit_calls if a["action"] == "quantum_rl.regime_grouping_failed"]
    assert grouping_audits == [], "Genuine scarcity must NOT fire the grouping-failed audit"
    insufficient_audits = [a for a in audit_calls if a["action"] == "quantum_rl.regime_insufficient_data"]
    assert len(insufficient_audits) == 6, (
        "All 6 regimes should still emit the ordinary insufficient_data skip audit "
        f"unchanged; got {len(insufficient_audits)}"
    )


# ===========================================================================
# Test 4/5/6: build_train_cli_payload() — the CLI dispatch contract
# ===========================================================================

def test_cli_payload_grouping_failed_exits_degraded_code_3():
    """r2fix round-2 refinement: the grouping-failed known-gap gets a DISTINCT
    exit code 3 (DEGRADED), NOT the exit-1 real-incident path. The runner's
    code===3 branch surfaces it as a non-paging quantum_rl.training_skipped_
    regime_unwired audit + status="skipped_regime_unwired" instead of opening
    the circuit breaker and firing a Discord CRITICAL for a deferred feature.
    Still non-zero (so it never hits _recordRlSuccess → the false-green stays
    closed) but distinct from a real runtime failure (exit 1)."""
    training_results = {
        "status": "regime_grouping_failed",
        "reason": "bars present but no institutional_regime key on any bar",
        "n_bars": 500,
    }
    payload, exit_code = build_train_cli_payload(training_results, "r2fix-4")

    assert exit_code == 3, "Grouping failure is DEGRADED (exit 3) — not clean (0) nor incident (1)"
    assert exit_code != 0, "must never exit 0 — that would re-open the false-green (_recordRlSuccess)"
    assert exit_code != 1, "must not use the exit-1 incident path — that pages the operator for a known gap"
    assert payload["regime_grouping_failed"] is True
    assert payload["results"] == {}, "results key stays a dict for backward-compat"
    assert payload["grouping_failure_detail"]["n_bars"] == 500


def test_cli_payload_genuine_empty_result_exits_zero():
    """A legitimate zero-regime clean run (plain {}, no sentinel) must still
    exit 0 — the fix must not penalize the honest no-data-yet case."""
    payload, exit_code = build_train_cli_payload({}, "r2fix-5")

    assert exit_code == 0
    assert payload["regime_grouping_failed"] is False
    assert payload["write_failures_present"] is False
    assert payload["results"] == {}


def test_cli_payload_write_failure_still_exits_nonzero_and_is_distinct():
    """F-1's existing db_write_failed contract must keep working, and must
    not be confused with the new grouping-failed detection."""
    training_results = {
        "TRENDING": {
            "trained_epochs": 10,
            "final_sharpe": 0.1,
            "final_reward": 0.0,
            "weights_hash": "abc123",
            "dsr_passed": False,
            "db_write_failed": True,
        }
    }
    payload, exit_code = build_train_cli_payload(training_results, "r2fix-6")

    assert exit_code == 1
    assert payload["write_failures_present"] is True
    assert payload["regime_grouping_failed"] is False
    assert payload["results"] == training_results
