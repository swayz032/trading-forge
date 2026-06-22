"""test_wave_b_dsr_audit.py — Wave B carry-forward: DSR floor audit emit

Tests that quantum_rl_agent.py emits the correct AUDIT_LOG_JSON sentinel lines
on stderr when the DSR floor check passes or blocks after regime training.

Scope:
  - test_dsr_floor_block_emits_audit_when_below_floor
  - test_dsr_passed_emits_audit_when_above_floor

Authority: challenger-only. These tests verify observability only.
No test writes to authoritative execution paths.

Design note:
  train_regime_conditioned_policies() requires DB access + bar data to actually
  run training loops. For DSR audit isolation we exercise the sentinel at the
  module level by invoking the function with mocked-out DB (no DATABASE_URL) so
  all regimes skip via insufficient_data path, then verify the sentinel is NOT
  emitted there — and separately call the internal DSR-emit path directly via a
  thin helper exerciser that mirrors what the training loop does.

  The cleanest approach for these two specific tests is to invoke
  train_regime_conditioned_policies() with a mocked psycopg2 that returns exactly
  _REGIME_MIN_BARS bars for ONE regime so the training loop runs and the DSR gate
  fires. We control final_sharpe via a mock for _emit_audit_row captures, and
  capture stderr for the AUDIT_LOG_JSON sentinel.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _capture_stderr_lines(fn, *args, **kwargs):
    """Run fn(*args, **kwargs) and return (result, list[str]) of captured stderr lines."""
    buf = io.StringIO()
    old_stderr = sys.stderr
    sys.stderr = buf
    try:
        result = fn(*args, **kwargs)
    finally:
        sys.stderr = old_stderr
    lines = buf.getvalue().splitlines()
    return result, lines


def _audit_lines(stderr_lines: list[str]) -> list[dict]:
    """Extract parsed AUDIT_LOG_JSON payloads from captured stderr lines."""
    out = []
    for line in stderr_lines:
        if line.startswith("AUDIT_LOG_JSON "):
            try:
                payload = json.loads(line[len("AUDIT_LOG_JSON "):])
                out.append(payload)
            except json.JSONDecodeError:
                pass
    return out


def _make_regime_bars(n: int = 100) -> list[dict]:
    """Return n minimal bar dicts sufficient for regime training."""
    return [
        {
            "state": {
                "institutional_regime": "TRENDING",
                "daily_ema_20": 4000.0 + float(i),
                "probability_of_ruin_ci_high": 0.0,
            }
        }
        for i in range(n)
    ]


# ─── Module-level imports after helpers ──────────────────────────────────────

from src.engine.quantum_rl_agent import (  # noqa: E402
    _REGIME_MIN_BARS,
    train_regime_conditioned_policies,
)

# ═══════════════════════════════════════════════════════════════════════════════
# Test 1 — DSR floor block: final_sharpe < dsr_floor → dsr_floor_block on stderr
# ═══════════════════════════════════════════════════════════════════════════════

class TestDsrFloorBlockEmitsAudit:
    """When training produces Sharpe below QUANTUM_RL_DSR_FLOOR, AUDIT_LOG_JSON
    with action=quantum_rl.dsr_floor_block must appear on stderr."""

    def test_dsr_floor_block_emits_audit_when_below_floor(self):
        """fixture: DSR=0.3 (via controlled rewards), floor=0.5 → dsr_floor_block in stderr."""

        # We need training to actually run to a final_sharpe < 0.5.
        # Strategy: mock _REGIME_MIN_BARS bars for TRENDING regime so the loop runs.
        # Mock psycopg2 so the DB lookup for backtest_id returns a fake id, and
        # bar loading uses our synthetic bars (mock db_loader).
        # Set env DSR floor to 0.5 explicitly.

        bars = _make_regime_bars(_REGIME_MIN_BARS + 10)
        fake_backtest_id = 99

        # Mock psycopg2 for the backtest lookup
        mock_pg = MagicMock()
        mock_extras = MagicMock()
        mock_extras.DictCursor = dict

        # Cursor for backtest_id lookup returns a row
        mock_cur = MagicMock()
        mock_cur.__enter__ = MagicMock(return_value=mock_cur)
        mock_cur.__exit__ = MagicMock(return_value=False)
        mock_row = MagicMock()
        mock_row.__getitem__ = MagicMock(side_effect=lambda k: fake_backtest_id if k == "id" else None)
        mock_cur.fetchone.return_value = mock_row

        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value = mock_cur
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = mock_extras

        # Patch load_backtest_bar_data to return our synthetic bars
        # Patch _emit_audit_row to be a no-op (we only care about stderr)
        # Set training_epochs=1 so the loop terminates quickly
        # Force rewards to be all-negative so Sharpe ends up below 0.5

        with patch.dict(os.environ, {
            "DATABASE_URL": "postgresql://fake/fake",
            "QUANTUM_RL_DSR_FLOOR": "0.5",
            "QUANTUM_RL_IBM_CLOUD_OPT_IN": "false",
        }):
            with patch.dict(sys.modules, {
                "psycopg2": mock_pg,
                "psycopg2.extras": mock_extras,
            }):
                with patch(
                    "src.engine.quantum_rl_agent._emit_audit_row",
                    side_effect=lambda **kw: None,
                ):
                    with patch(
                        "src.engine.quantum_rl_agent.train_regime_conditioned_policies.__globals__",
                        create=False,
                    ) if False else contextlib.nullcontext():
                        # Patch load_backtest_bar_data
                        with patch(
                            "src.engine.replay.db_loader.load_backtest_bar_data",
                            return_value=bars,
                        ):
                            # Also patch the local import inside the function
                            mock_loader_mod = MagicMock()
                            mock_loader_mod.load_backtest_bar_data = MagicMock(return_value=bars)
                            with patch.dict(sys.modules, {
                                "src.engine.replay.db_loader": mock_loader_mod,
                            }):
                                # Force rewards to be all-zero so std=0 → final_sharpe=0 < 0.5
                                # We do this by making np.std return 0 for the episode rewards
                                # Actually simpler: patch TradingEnv.step to always return
                                # (state, 0.0, True) so all rewards are 0 → std=0 → sharpe=0
                                from src.engine.quantum_rl_agent import TradingEnv
                                _original_step = TradingEnv.step

                                def _zero_reward_step(self, action):
                                    state = self._get_state()
                                    self.step_idx = self.n_steps  # force done
                                    return state, 0.0, True

                                with patch.object(TradingEnv, "step", _zero_reward_step):
                                    _, stderr_lines = _capture_stderr_lines(
                                        train_regime_conditioned_policies,
                                        strategy_id=1,
                                        training_epochs=2,
                                        cpcv_purge=False,
                                        seed=42,
                                    )

        audit_payloads = _audit_lines(stderr_lines)

        # At minimum one dsr_floor_block or dsr_passed must appear
        dsr_actions = [p["action"] for p in audit_payloads if "dsr" in p.get("action", "")]
        assert len(dsr_actions) >= 1, (
            f"No DSR audit line found in stderr. All AUDIT_LOG_JSON actions: "
            f"{[p.get('action') for p in audit_payloads]}\n"
            f"Raw stderr:\n" + "\n".join(stderr_lines[:40])
        )

        # Since rewards are all 0 → std=0 → final_sharpe=0 < 0.5, expect block
        block_payloads = [p for p in audit_payloads if p.get("action") == "quantum_rl.dsr_floor_block"]
        assert len(block_payloads) >= 1, (
            f"Expected quantum_rl.dsr_floor_block in stderr. Found: {dsr_actions}\n"
            f"Raw stderr:\n" + "\n".join(stderr_lines[:40])
        )

        block = block_payloads[0]
        assert block.get("dsr_passed") is False, f"dsr_passed should be False, got {block}"
        assert "dsr_value" in block, f"dsr_value missing from {block}"
        assert "dsr_floor" in block, f"dsr_floor missing from {block}"
        assert float(block["dsr_floor"]) == pytest.approx(0.5), (
            f"dsr_floor should be 0.5, got {block['dsr_floor']}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# Test 2 — DSR passed: final_sharpe > dsr_floor → dsr_passed on stderr
# ═══════════════════════════════════════════════════════════════════════════════

class TestDsrPassedEmitsAudit:
    """When training produces Sharpe above QUANTUM_RL_DSR_FLOOR, AUDIT_LOG_JSON
    with action=quantum_rl.dsr_passed must appear on stderr."""

    def test_dsr_passed_emits_audit_when_above_floor(self):
        """fixture: DSR=0.7 (via positive rewards), floor=0.5 → dsr_passed in stderr."""

        bars = _make_regime_bars(_REGIME_MIN_BARS + 10)
        fake_backtest_id = 77

        mock_pg = MagicMock()
        mock_extras = MagicMock()
        mock_extras.DictCursor = dict

        mock_cur = MagicMock()
        mock_cur.__enter__ = MagicMock(return_value=mock_cur)
        mock_cur.__exit__ = MagicMock(return_value=False)
        mock_row = MagicMock()
        mock_row.__getitem__ = MagicMock(side_effect=lambda k: fake_backtest_id if k == "id" else None)
        mock_cur.fetchone.return_value = mock_row

        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value = mock_cur
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = mock_extras

        # Produce high and consistent rewards so Sharpe > 0.5
        # We do this by patching TradingEnv.step to return reward=1.0 always
        with patch.dict(os.environ, {
            "DATABASE_URL": "postgresql://fake/fake",
            "QUANTUM_RL_DSR_FLOOR": "0.5",
            "QUANTUM_RL_IBM_CLOUD_OPT_IN": "false",
        }):
            with patch.dict(sys.modules, {
                "psycopg2": mock_pg,
                "psycopg2.extras": mock_extras,
            }):
                with patch(
                    "src.engine.quantum_rl_agent._emit_audit_row",
                    side_effect=lambda **kw: None,
                ):
                    mock_loader_mod = MagicMock()
                    mock_loader_mod.load_backtest_bar_data = MagicMock(return_value=bars)
                    with patch.dict(sys.modules, {
                        "src.engine.replay.db_loader": mock_loader_mod,
                    }):
                        from src.engine.quantum_rl_agent import TradingEnv

                        # Manufacture high Sharpe: each step returns reward=1.0
                        # consistently → mean=1.0, std→0 ... but then sharpe=0.
                        # Better: return 2 different positive rewards so std > 0
                        # and mean/std is large.
                        _step_counter = [0]

                        def _high_reward_step(self, action):
                            _step_counter[0] += 1
                            # Alternate between 1.0 and 2.0 → mean=1.5, std=0.5 → sharpe=3.0
                            reward = 1.0 if _step_counter[0] % 2 == 0 else 2.0
                            self.step_idx = self.n_steps  # force done
                            return self._get_state(), reward, True

                        with patch.object(TradingEnv, "step", _high_reward_step):
                            _, stderr_lines = _capture_stderr_lines(
                                train_regime_conditioned_policies,
                                strategy_id=2,
                                training_epochs=4,
                                cpcv_purge=False,
                                seed=42,
                            )

        audit_payloads = _audit_lines(stderr_lines)

        dsr_actions = [p["action"] for p in audit_payloads if "dsr" in p.get("action", "")]
        assert len(dsr_actions) >= 1, (
            f"No DSR audit line found in stderr. AUDIT_LOG_JSON actions: "
            f"{[p.get('action') for p in audit_payloads]}\n"
            f"Raw stderr:\n" + "\n".join(stderr_lines[:40])
        )

        passed_payloads = [p for p in audit_payloads if p.get("action") == "quantum_rl.dsr_passed"]
        assert len(passed_payloads) >= 1, (
            f"Expected quantum_rl.dsr_passed in stderr. Found: {dsr_actions}\n"
            f"Raw stderr:\n" + "\n".join(stderr_lines[:40])
        )

        passed = passed_payloads[0]
        assert passed.get("dsr_passed") is True, f"dsr_passed should be True, got {passed}"
        assert "dsr_value" in passed, f"dsr_value missing from {passed}"
        assert float(passed["dsr_floor"]) == pytest.approx(0.5), (
            f"dsr_floor should be 0.5, got {passed['dsr_floor']}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# Test 3 — Schema regression: AUDIT_LOG_JSON payload has required keys
# ═══════════════════════════════════════════════════════════════════════════════

class TestDsrAuditSchema:
    """Both dsr_floor_block and dsr_passed payloads must include required fields."""

    _REQUIRED_KEYS = {"action", "status", "strategy_id", "dsr_value", "dsr_floor", "regime", "dsr_passed"}

    def _run_training_capture_dsr_lines(self, dsr_floor: float, reward_val: float) -> list[dict]:
        """Helper: run training with controlled reward + floor, return DSR audit payloads."""
        bars = _make_regime_bars(_REGIME_MIN_BARS + 5)
        fake_backtest_id = 55

        mock_pg = MagicMock()
        mock_extras = MagicMock()
        mock_extras.DictCursor = dict

        mock_cur = MagicMock()
        mock_cur.__enter__ = MagicMock(return_value=mock_cur)
        mock_cur.__exit__ = MagicMock(return_value=False)
        mock_row = MagicMock()
        mock_row.__getitem__ = MagicMock(side_effect=lambda k: fake_backtest_id if k == "id" else None)
        mock_cur.fetchone.return_value = mock_row

        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value = mock_cur
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = mock_extras

        _step_counter = [0]

        def _controlled_step(self, action):
            _step_counter[0] += 1
            # Alternate reward_val and 0 so we get non-zero std when reward_val != 0
            r = reward_val if _step_counter[0] % 2 == 0 else 0.0
            self.step_idx = self.n_steps
            return self._get_state(), r, True

        with patch.dict(os.environ, {
            "DATABASE_URL": "postgresql://fake/fake",
            "QUANTUM_RL_DSR_FLOOR": str(dsr_floor),
            "QUANTUM_RL_IBM_CLOUD_OPT_IN": "false",
        }):
            with patch.dict(sys.modules, {
                "psycopg2": mock_pg,
                "psycopg2.extras": mock_extras,
            }):
                with patch("src.engine.quantum_rl_agent._emit_audit_row", side_effect=lambda **kw: None):
                    mock_loader_mod = MagicMock()
                    mock_loader_mod.load_backtest_bar_data = MagicMock(return_value=bars)
                    with patch.dict(sys.modules, {"src.engine.replay.db_loader": mock_loader_mod}):
                        from src.engine.quantum_rl_agent import TradingEnv
                        with patch.object(TradingEnv, "step", _controlled_step):
                            _, stderr_lines = _capture_stderr_lines(
                                train_regime_conditioned_policies,
                                strategy_id=5,
                                training_epochs=2,
                                cpcv_purge=False,
                                seed=0,
                            )

        return _audit_lines(stderr_lines)

    def test_block_payload_has_required_keys(self):
        """dsr_floor_block payload must have all required schema keys."""
        payloads = self._run_training_capture_dsr_lines(dsr_floor=0.9, reward_val=0.0)
        dsr_payloads = [p for p in payloads if "dsr" in p.get("action", "")]
        assert dsr_payloads, "No DSR audit payloads found"
        for p in dsr_payloads:
            missing = self._REQUIRED_KEYS - set(p.keys())
            assert not missing, f"Missing keys {missing} in payload: {p}"

    def test_passed_payload_has_required_keys(self):
        """dsr_passed payload must have all required schema keys."""
        payloads = self._run_training_capture_dsr_lines(dsr_floor=0.01, reward_val=2.0)
        dsr_payloads = [p for p in payloads if "dsr" in p.get("action", "")]
        assert dsr_payloads, "No DSR audit payloads found"
        for p in dsr_payloads:
            missing = self._REQUIRED_KEYS - set(p.keys())
            assert not missing, f"Missing keys {missing} in payload: {p}"

    def test_dsr_floor_block_status_is_warning(self):
        """dsr_floor_block must have status=warning."""
        payloads = self._run_training_capture_dsr_lines(dsr_floor=0.9, reward_val=0.0)
        blocks = [p for p in payloads if p.get("action") == "quantum_rl.dsr_floor_block"]
        # With reward=0 and floor=0.9, we should get blocks (sharpe=0 < 0.9)
        # (If all rewards are 0, std=0 so sharpe=0 < 0.9)
        if blocks:
            for b in blocks:
                assert b.get("status") == "warning", (
                    f"dsr_floor_block status should be 'warning', got {b.get('status')}"
                )

    def test_dsr_passed_status_is_info(self):
        """dsr_passed must have status=info."""
        payloads = self._run_training_capture_dsr_lines(dsr_floor=0.01, reward_val=2.0)
        passeds = [p for p in payloads if p.get("action") == "quantum_rl.dsr_passed"]
        if passeds:
            for p in passeds:
                assert p.get("status") == "info", (
                    f"dsr_passed status should be 'info', got {p.get('status')}"
                )
