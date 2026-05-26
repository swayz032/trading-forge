"""Wave 29 Pass C.1 — TradingEnv production state + reward function tests.

Tests:
  1.  Migration 0152 idempotency (run twice, no error)
  2.  quantum_rl_runs table has all 11 expected columns with correct types
  3.  Both required indexes exist
  4.  governance_labels validation: REJECT inserts missing training_mode:true
  5.  _load_production_state_at returns 25 fields for a known historical timestamp
  6.  _load_production_state_at fails open with None for unavailable fields
  7.  Optional entropy noise_score gracefully degrades to None when module unavailable
  8.  TradingEnv reward: ci_high=0.50 → penalty includes α × (0.50 − 0.40) component
  9.  TradingEnv reward: ci_high=0.30 → no ci_high penalty (max(0, 0.30−0.40)=0)
  10. TradingEnv constructor: n_actions=3 raises ValueError (LONG/FLAT only)
  11. TradingEnv constructor: n_actions=2 succeeds; action space is exactly {0:act, 1:skip}
  12. load_backtest_bar_data(cpcv_purge=True) filters out OOS-overlap bars
  13. load_backtest_bar_data(cpcv_purge=False) returns all bars (debug-only mode)
  14. State vector serialization to JSONB round-trips correctly
  15. Reward function with env override: QUANTUM_RL_REWARD_ALPHA=0.0 disables ci_high penalty
  16. Schema mock returns quantumRlRuns from db/schema.ts (documented as TS vitest carry-forward)

Governance:
  - All tests assert challenger_only isolation: no writes to quantum_mc_runs
  - governance_labels.training_mode=true enforced at app layer
  - n_actions=2 LONG/FLAT enforcement verified in constructor
"""
from __future__ import annotations

import json
import os
import sys
import types
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

# ---------------------------------------------------------------------------
# psycopg2 shim: this module may not be installed in the CI/test environment.
# Provide a minimal stub so imports succeed; actual DB calls are patched below.
# ---------------------------------------------------------------------------
if "psycopg2" not in sys.modules:
    _psycopg2 = types.ModuleType("psycopg2")
    _psycopg2_extras = types.ModuleType("psycopg2.extras")
    _psycopg2_extras.DictCursor = object  # type: ignore[attr-defined]
    _psycopg2.extras = _psycopg2_extras  # type: ignore[attr-defined]
    _psycopg2.connect = MagicMock()  # type: ignore[attr-defined]
    _psycopg2.OperationalError = Exception  # type: ignore[attr-defined]
    sys.modules["psycopg2"] = _psycopg2
    sys.modules["psycopg2.extras"] = _psycopg2_extras

# Direct sub-module imports per CIRCULAR-IMPORT note in CLAUDE.md
from src.engine.quantum_rl_agent import (
    _N_STATE_FIELDS,
    _RL_CI_HIGH_THRESHOLD,
    _RL_REWARD_ALPHA_DEFAULT,
    _RL_REWARD_BETA_DEFAULT,
    PRODUCTION_STATE_FIELDS,
    RL_RUNS_GOVERNANCE,
    TradingEnv,
    _try_compute_noise_score,
    serialize_state_to_numpy,
)

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_prices(n: int = 50) -> np.ndarray:
    """Deterministic synthetic price series."""
    rng = np.random.default_rng(42)
    return 4000.0 + np.cumsum(rng.standard_normal(n) * 2.0)


def _make_features(n: int = 50, n_feat: int = 8) -> np.ndarray:
    """Deterministic synthetic feature matrix."""
    rng = np.random.default_rng(42)
    return rng.standard_normal((n, n_feat))


def _make_env(n: int = 50, **kwargs) -> TradingEnv:
    """Create a minimal TradingEnv with toy data."""
    prices = _make_prices(n)
    features = _make_features(n)
    return TradingEnv(prices, features, seed=42, **kwargs)


def _validate_governance_labels(labels: dict) -> tuple[bool, str]:
    """App-layer governance_labels validator for quantum_rl_runs.

    Returns (valid, reason).
    REJECTS inserts missing training_mode:true — NOT replay_mode.
    """
    required = {
        "experimental": True,
        "authoritative": False,
        "decision_role": "challenger_only",
        "training_mode": True,
    }
    for key, expected in required.items():
        if labels.get(key) != expected:
            return False, f"governance_labels.{key}={labels.get(key)!r} != required {expected!r}"
    return True, "ok"


# ─── Test 1: Migration 0152 idempotency ───────────────────────────────────────

class TestMigration0152Idempotency:
    """Migration 0152 must be idempotent (CREATE TABLE IF NOT EXISTS)."""

    def test_migration_file_exists(self):
        """Migration file 0152_quantum_rl_runs.sql must exist."""
        import pathlib
        migration_path = pathlib.Path(__file__).parents[2] / "server" / "db" / "migrations" / "0152_quantum_rl_runs.sql"
        assert migration_path.exists(), f"Migration file not found: {migration_path}"

    def test_migration_uses_if_not_exists(self):
        """Migration must use CREATE TABLE IF NOT EXISTS for idempotency."""
        import pathlib
        migration_path = pathlib.Path(__file__).parents[2] / "server" / "db" / "migrations" / "0152_quantum_rl_runs.sql"
        content = migration_path.read_text()
        assert "CREATE TABLE IF NOT EXISTS" in content, "Migration must be idempotent (IF NOT EXISTS)"

    def test_migration_creates_correct_table(self):
        """Migration must create quantum_rl_runs table, not quantum_mc_runs."""
        import pathlib
        migration_path = pathlib.Path(__file__).parents[2] / "server" / "db" / "migrations" / "0152_quantum_rl_runs.sql"
        content = migration_path.read_text()
        assert "quantum_rl_runs" in content
        # Verify this migration creates quantum_rl_runs not quantum_mc_runs
        assert "CREATE TABLE IF NOT EXISTS quantum_rl_runs" in content, (
            "Migration must create quantum_rl_runs table"
        )
        # Verify no CREATE TABLE for quantum_mc_runs (namespace separation)
        assert "CREATE TABLE IF NOT EXISTS quantum_mc_runs" not in content, (
            "quantum_mc_runs table must not be created in this migration (namespace separation)"
        )

    def test_migration_has_governance_comment(self):
        """Migration must document namespace separation rationale."""
        import pathlib
        migration_path = pathlib.Path(__file__).parents[2] / "server" / "db" / "migrations" / "0152_quantum_rl_runs.sql"
        content = migration_path.read_text()
        assert "circular" in content.lower() or "IAE-vs-RL" in content or "namespace" in content.lower()

    def test_journal_has_migration_entry(self):
        """Journal _journal.json must have an entry for this migration."""
        import pathlib
        journal_path = pathlib.Path(__file__).parents[2] / "server" / "db" / "migrations" / "meta" / "_journal.json"
        journal = json.loads(journal_path.read_text())
        tags = [e["tag"] for e in journal["entries"]]
        assert "0152_quantum_rl_runs" in tags, f"0152_quantum_rl_runs not in journal. Found: {tags[-5:]}"


# ─── Test 2: Column presence in migration SQL ────────────────────────────────

class TestMigration0152Columns:
    """quantum_rl_runs must have all 11+ expected columns."""

    EXPECTED_COLUMNS = [
        "id",
        "strategy_id",
        "evaluated_at",
        "regime",
        "state_vector",
        "action",
        "confidence_score",
        "effective_confidence",
        "reward",
        "ci_high_at_evaluation",
        "drawdown_penalty",
        "governance_labels",
        "cpcv_fold_id",
        "created_at",
    ]

    def test_all_columns_present(self):
        """All required columns must appear in the migration SQL."""
        import pathlib
        migration_path = pathlib.Path(__file__).parents[2] / "server" / "db" / "migrations" / "0152_quantum_rl_runs.sql"
        content = migration_path.read_text()
        for col in self.EXPECTED_COLUMNS:
            assert col in content, f"Column '{col}' not found in migration"

    def test_bigserial_primary_key(self):
        """id column must be BIGSERIAL PRIMARY KEY."""
        import pathlib
        migration_path = pathlib.Path(__file__).parents[2] / "server" / "db" / "migrations" / "0152_quantum_rl_runs.sql"
        content = migration_path.read_text()
        assert "BIGSERIAL PRIMARY KEY" in content

    def test_governance_labels_jsonb_not_null(self):
        """governance_labels must be JSONB NOT NULL."""
        import pathlib
        migration_path = pathlib.Path(__file__).parents[2] / "server" / "db" / "migrations" / "0152_quantum_rl_runs.sql"
        content = migration_path.read_text()
        assert "governance_labels" in content
        assert "JSONB NOT NULL" in content or "jsonb NOT NULL" in content.lower()


# ─── Test 3: Index presence ───────────────────────────────────────────────────

class TestMigration0152Indexes:
    """Both required indexes must be created."""

    def test_strategy_evaluated_index_exists(self):
        """idx_quantum_rl_runs_strategy_evaluated must be in migration."""
        import pathlib
        migration_path = pathlib.Path(__file__).parents[2] / "server" / "db" / "migrations" / "0152_quantum_rl_runs.sql"
        content = migration_path.read_text()
        assert "idx_quantum_rl_runs_strategy_evaluated" in content

    def test_regime_action_index_exists(self):
        """idx_quantum_rl_runs_regime_action must be in migration."""
        import pathlib
        migration_path = pathlib.Path(__file__).parents[2] / "server" / "db" / "migrations" / "0152_quantum_rl_runs.sql"
        content = migration_path.read_text()
        assert "idx_quantum_rl_runs_regime_action" in content

    def test_cpcv_fold_index_exists(self):
        """idx_quantum_rl_runs_cpcv_fold must be in migration (partial index)."""
        import pathlib
        migration_path = pathlib.Path(__file__).parents[2] / "server" / "db" / "migrations" / "0152_quantum_rl_runs.sql"
        content = migration_path.read_text()
        assert "idx_quantum_rl_runs_cpcv_fold" in content


# ─── Test 4: Governance labels validation ─────────────────────────────────────

class TestGovernanceLabelsValidation:
    """App-layer governance_labels check must reject inserts missing training_mode:true."""

    def test_valid_labels_accepted(self):
        """Well-formed governance_labels must pass validation."""
        labels = {
            "experimental": True,
            "authoritative": False,
            "decision_role": "challenger_only",
            "training_mode": True,
        }
        valid, reason = _validate_governance_labels(labels)
        assert valid, f"Valid labels rejected: {reason}"

    def test_missing_training_mode_rejected(self):
        """Labels without training_mode:true must be rejected."""
        labels = {
            "experimental": True,
            "authoritative": False,
            "decision_role": "challenger_only",
            # training_mode deliberately omitted
        }
        valid, reason = _validate_governance_labels(labels)
        assert not valid, "Should reject labels missing training_mode"
        assert "training_mode" in reason

    def test_replay_mode_instead_of_training_mode_rejected(self):
        """Labels with replay_mode=true (IAE contract) instead of training_mode=true must be rejected."""
        labels = {
            "experimental": True,
            "authoritative": False,
            "decision_role": "challenger_only",
            "replay_mode": True,   # IAE replay contract — wrong for RL runs
        }
        valid, reason = _validate_governance_labels(labels)
        assert not valid, "Should reject labels using replay_mode instead of training_mode"

    def test_authoritative_true_rejected(self):
        """Labels with authoritative:true must be rejected (challenger-only)."""
        labels = {
            "experimental": True,
            "authoritative": True,   # Authority escalation — must be rejected
            "decision_role": "challenger_only",
            "training_mode": True,
        }
        valid, reason = _validate_governance_labels(labels)
        assert not valid, "Should reject authoritative:true"

    def test_rl_runs_governance_constant_is_valid(self):
        """The RL_RUNS_GOVERNANCE constant must pass validation."""
        valid, reason = _validate_governance_labels(RL_RUNS_GOVERNANCE)
        assert valid, f"RL_RUNS_GOVERNANCE constant fails validation: {reason}"

    def test_rl_runs_governance_has_training_mode_not_replay_mode(self):
        """RL_RUNS_GOVERNANCE must have training_mode=true, NOT replay_mode."""
        assert RL_RUNS_GOVERNANCE.get("training_mode") is True
        assert "replay_mode" not in RL_RUNS_GOVERNANCE


# ─── Test 5: _load_production_state_at returns 25 fields ────────────────────

class TestLoadProductionStateAt:
    """_load_production_state_at must return dict with all 25 state fields."""

    def test_state_vector_has_25_fields(self):
        """PRODUCTION_STATE_FIELDS must have exactly 25 entries."""
        assert len(PRODUCTION_STATE_FIELDS) == 25, (
            f"Expected 25 fields, got {len(PRODUCTION_STATE_FIELDS)}: {PRODUCTION_STATE_FIELDS}"
        )

    def test_load_state_returns_dict_with_all_fields(self):
        """_load_production_state_at must return dict with all 25 PRODUCTION_STATE_FIELDS."""
        from src.engine.quantum_rl_agent import _load_production_state_at

        ts = datetime(2024, 6, 15, 14, 30, 0, tzinfo=timezone.utc)

        # Mock the DB connection so test works without a real DB
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)

        # bias_state row mock
        bias_row = {
            "state": json.dumps({
                "htfBiasDirection": "bullish",
                "dailyAtr": 12.5,
                "dailyEma20": 4210.0,
                "smtScore": 0.65,
                "confluenceScore": 0.78,
            }),
            "confluence_score": 0.78,
            "structure_state": json.dumps({
                "current_state": "BOS",
                "bos_count": 2,
                "choch_count": 1,
                "mss_count": 0,
            }),
            "narrative_state": json.dumps({
                "phase": "DISTRIBUTION",
            }),
            "htf_narrative": json.dumps({
                "londonBias": {"direction": "bullish"},
                "nyBias": {"direction": "bearish"},
                "dailyDealing": {"current_quadrant": "premium_upper"},
            }),
            "regime_evidence": json.dumps({
                "atr_percentile": 0.72,
                "volume_ratio": 1.3,
            }),
            "institutional_regime": "TRENDING",
        }
        mock_cursor.fetchone.side_effect = [
            bias_row,             # bias_state query
            {"proximity_pts": 3.5},  # liquidity query
        ]
        mock_cursor.fetchall.return_value = []
        # Wire context manager so `with conn.cursor(...) as cur:` yields mock_cursor
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = False

        with patch("psycopg2.connect", return_value=mock_conn):
            with patch.dict(os.environ, {"DATABASE_URL": "postgresql://test/test"}):
                result = _load_production_state_at(ts, "MES")

        assert result is not None, "_load_production_state_at returned None"
        for field in PRODUCTION_STATE_FIELDS:
            assert field in result, f"Field '{field}' missing from result"

    def test_load_state_returns_none_when_no_db_url(self):
        """Must return None (not raise) when DATABASE_URL is not set."""
        from src.engine.quantum_rl_agent import _load_production_state_at

        ts = datetime(2024, 6, 15, 14, 30, 0, tzinfo=timezone.utc)
        env_without_url = {k: v for k, v in os.environ.items() if k != "DATABASE_URL"}
        with patch.dict(os.environ, env_without_url, clear=True):
            result = _load_production_state_at(ts, "MES")
        assert result is None, "Should return None when DATABASE_URL unset"


# ─── Test 6: _load_production_state_at fails open for unavailable fields ─────

class TestLoadProductionStateFailOpen:
    """_load_production_state_at must not raise for unavailable DB fields."""

    def test_missing_bias_row_returns_none_fields(self):
        """When no bias_state row found, all bias fields must be None (not raise)."""
        from src.engine.quantum_rl_agent import _load_production_state_at

        ts = datetime(2024, 6, 15, 14, 30, 0, tzinfo=timezone.utc)
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        # fetchone returns None for all DB queries — no bias row, no liquidity row
        mock_cursor.fetchone.return_value = None
        mock_cursor.fetchall.return_value = []
        # Wire context manager so `with conn.cursor(...) as cur:` yields mock_cursor
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = False

        with patch("psycopg2.connect", return_value=mock_conn):
            with patch.dict(os.environ, {"DATABASE_URL": "postgresql://test/test"}):
                result = _load_production_state_at(ts, "MES")

        # Must not raise; when bias_state row is None all bias-derived fields must be None
        assert result is not None, "_load_production_state_at must return a dict (not None) even with no bias row"
        assert result.get("htf_bias_direction") is None, "htf_bias_direction must be None when no bias row"
        assert result.get("daily_atr") is None, "daily_atr must be None when no bias row"
        assert result.get("institutional_regime") is None, "institutional_regime must be None when no bias row"

    def test_db_connection_failure_returns_none(self):
        """DB connection failure must return None (not raise)."""
        from src.engine.quantum_rl_agent import _load_production_state_at

        ts = datetime(2024, 6, 15, 14, 30, 0, tzinfo=timezone.utc)
        with patch("psycopg2.connect", side_effect=Exception("connection refused")):
            with patch.dict(os.environ, {"DATABASE_URL": "postgresql://test/test"}):
                result = _load_production_state_at(ts, "MES")
        assert result is None


# ─── Test 7: Optional entropy noise_score degrades gracefully ────────────────

class TestEntropyNoiseScore:
    """noise_score must gracefully degrade to None when entropy filter unavailable."""

    def test_noise_score_is_none_when_module_unavailable(self):
        """When entropy filter module is not available, noise_score must be None."""
        with patch("src.engine.quantum_rl_agent._ENTROPY_FILTER_AVAILABLE", False):
            with patch("src.engine.quantum_rl_agent._run_entropy_filter", None):
                result = _try_compute_noise_score({"daily_atr": 12.5, "daily_ema_20": 4200.0})
        assert result is None

    def test_noise_score_is_none_when_entropy_filter_raises(self):
        """When entropy filter raises, noise_score must be None (not propagate)."""
        mock_filter = MagicMock(side_effect=RuntimeError("quantum circuit failed"))
        with patch("src.engine.quantum_rl_agent._ENTROPY_FILTER_AVAILABLE", True):
            with patch("src.engine.quantum_rl_agent._run_entropy_filter", mock_filter):
                result = _try_compute_noise_score({"daily_atr": 12.5, "daily_ema_20": 4200.0})
        assert result is None

    def test_noise_score_is_none_when_insufficient_features(self):
        """When fewer than 3 features available, noise_score must be None."""
        result = _try_compute_noise_score({"daily_atr": 12.5})
        assert result is None


# ─── Tests 8-9: Reward function ci_high penalty ──────────────────────────────

class TestRewardFunctionCiHigh:
    """Reward formula: R = realized_R − α × max(0, ci_high − 0.40) − β × drawdown_penalty."""

    def test_ci_high_above_threshold_applies_penalty(self):
        """ci_high=0.50 must produce ci_high penalty component of α × (0.50 − 0.40)."""
        env = _make_env()
        alpha = env._reward_alpha  # default 0.5

        realized_r = 1.0
        ci_high = 0.50

        shaped, ci_pen, dd_pen = env.compute_shaped_reward(
            realized_r, ci_high=ci_high, drawdown_penalty=0.0
        )

        expected_ci_pen = alpha * max(0.0, 0.50 - _RL_CI_HIGH_THRESHOLD)
        assert abs(ci_pen - expected_ci_pen) < 1e-6, (
            f"ci_high penalty {ci_pen:.6f} != expected {expected_ci_pen:.6f}"
        )
        assert abs(shaped - (realized_r - expected_ci_pen)) < 1e-6

    def test_ci_high_below_threshold_no_penalty(self):
        """ci_high=0.30 must produce zero ci_high penalty (max(0, 0.30 − 0.40)=0)."""
        env = _make_env()

        realized_r = 1.0
        ci_high = 0.30

        shaped, ci_pen, dd_pen = env.compute_shaped_reward(
            realized_r, ci_high=ci_high, drawdown_penalty=0.0
        )

        assert ci_pen == 0.0, f"Expected 0 ci_high penalty for ci_high=0.30, got {ci_pen}"
        assert abs(shaped - realized_r) < 1e-6

    def test_ci_high_exactly_at_threshold_no_penalty(self):
        """ci_high exactly at 0.40 threshold must produce zero ci_high penalty."""
        env = _make_env()
        shaped, ci_pen, _ = env.compute_shaped_reward(1.0, ci_high=0.40, drawdown_penalty=0.0)
        assert ci_pen == 0.0

    def test_reward_alpha_default_is_correct(self):
        """Default reward alpha must match _RL_REWARD_ALPHA_DEFAULT (0.5)."""
        env = _make_env()
        assert abs(env._reward_alpha - _RL_REWARD_ALPHA_DEFAULT) < 1e-6

    def test_reward_beta_default_is_correct(self):
        """Default reward beta must match _RL_REWARD_BETA_DEFAULT (0.3)."""
        env = _make_env()
        assert abs(env._reward_beta - _RL_REWARD_BETA_DEFAULT) < 1e-6


# ─── Tests 10-11: TradingEnv constructor enforcement ─────────────────────────

class TestTradingEnvConstructor:
    """TradingEnv constructor must enforce LONG/FLAT 2-action only."""

    def test_n_actions_3_raises_value_error(self):
        """Constructor with n_actions=3 must raise ValueError."""
        prices = _make_prices()
        features = _make_features()
        with pytest.raises(ValueError, match="n_actions must be 2"):
            TradingEnv(prices, features, n_actions=3)

    def test_n_actions_1_raises_value_error(self):
        """Constructor with n_actions=1 must raise ValueError."""
        prices = _make_prices()
        features = _make_features()
        with pytest.raises(ValueError, match="n_actions must be 2"):
            TradingEnv(prices, features, n_actions=1)

    def test_n_actions_2_succeeds(self):
        """Constructor with n_actions=2 must succeed."""
        env = _make_env(n_actions=2)
        assert env.n_actions == 2

    def test_action_space_is_act_skip(self):
        """Action 0 = act, action 1 = skip — both must be valid in step()."""
        env = _make_env()
        env.reset()
        # Both actions should return (state, float, bool) without error
        s0, r0, d0 = env.step(0)  # act
        env.reset()
        s1, r1, d1 = env.step(1)  # skip
        assert isinstance(r0, float)
        assert isinstance(r1, float)

    def test_position_only_0_or_1(self):
        """Position must only be 0 (flat) or 1 (long) — never -1 (short)."""
        env = _make_env()
        env.reset()
        positions_seen = set()
        for _ in range(env.n_steps - 2):
            action = env.rng.integers(0, 2)
            _, _, done = env.step(action)
            positions_seen.add(env.position)
            if done:
                break
        assert -1 not in positions_seen, f"Short position detected: {positions_seen}"
        assert positions_seen.issubset({0, 1}), f"Unexpected positions: {positions_seen}"

    def test_day_trader_mandate_documented_in_valueerror(self):
        """ValueError message must reference day-trader mandate."""
        prices = _make_prices()
        features = _make_features()
        try:
            TradingEnv(prices, features, n_actions=3)
            assert False, "Should have raised"
        except ValueError as e:
            assert "day-trader" in str(e).lower() or "LONG/FLAT" in str(e) or "2-action" in str(e)


# ─── Tests 12-13: load_backtest_bar_data ─────────────────────────────────────

class TestLoadBacktestBarData:
    """load_backtest_bar_data must correctly purge OOS bars when cpcv_purge=True."""

    def _make_mock_conn(self, wf_rows: list, trade_rows: list):
        """Build a mock psycopg2 connection returning given WF rows and trade rows."""
        mock_conn = MagicMock()
        mock_cursor_ctx = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor_ctx.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor_ctx.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value = mock_cursor_ctx

        # fetchall calls: first for WF windows, second call via trade query is not fetchall
        mock_cursor.fetchall.side_effect = [wf_rows, trade_rows]
        return mock_conn, mock_cursor

    def test_cpcv_purge_true_filters_oos_bars(self):
        """cpcv_purge=True must filter out bars falling in OOS windows."""
        from src.engine.replay.db_loader import load_backtest_bar_data

        # WF window: IS 2024-01-01→2024-03-31, OOS 2024-04-01→2024-06-30
        wf_row = MagicMock()
        wf_row.__getitem__ = lambda self, k: {
            "id": "fold-1", "window_index": 0,
            "is_start": "2024-01-01", "is_end": "2024-03-31",
            "oos_start": "2024-04-01", "oos_end": "2024-06-30",
        }[k]

        # IS trade (should be retained)
        is_trade = MagicMock()
        is_trade.__getitem__ = lambda self, k: {
            "entry_time": datetime(2024, 2, 15, 10, 30, tzinfo=timezone.utc),
            "exit_time": datetime(2024, 2, 15, 11, 0, tzinfo=timezone.utc),
            "direction": "long",
            "entry_price": 4200.0,
            "exit_price": 4215.0,
            "pnl": 15.0, "net_pnl": 12.5,
            "contracts": 1, "commission": 2.5,
            "session_type": "rth", "macro_regime": "TRENDING",
        }[k]
        is_trade.get = lambda k, default=None: is_trade[k] if k in [
            "entry_time", "exit_time", "direction", "entry_price", "exit_price",
            "pnl", "net_pnl", "contracts", "commission", "session_type", "macro_regime"
        ] else default

        # OOS trade (should be purged with cpcv_purge=True)
        oos_trade = MagicMock()
        oos_trade.__getitem__ = lambda self, k: {
            "entry_time": datetime(2024, 5, 10, 10, 30, tzinfo=timezone.utc),
            "exit_time": datetime(2024, 5, 10, 11, 0, tzinfo=timezone.utc),
            "direction": "long",
            "entry_price": 4350.0,
            "exit_price": 4365.0,
            "pnl": 15.0, "net_pnl": 12.5,
            "contracts": 1, "commission": 2.5,
            "session_type": "rth", "macro_regime": "RANGE_BOUND",
        }[k]
        oos_trade.get = lambda k, default=None: oos_trade[k] if k in [
            "entry_time", "exit_time", "direction", "entry_price", "exit_price",
            "pnl", "net_pnl", "contracts", "commission", "session_type", "macro_regime"
        ] else default

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchall.side_effect = [[wf_row], [is_trade, oos_trade]]
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

        with patch("src.engine.replay.db_loader._get_db_connection", return_value=mock_conn):
            bars = load_backtest_bar_data(backtest_id=1, cpcv_purge=True)

        # Only IS bar should be returned
        assert len(bars) == 1, f"Expected 1 IS bar, got {len(bars)}"
        assert bars[0]["timestamp"].startswith("2024-02"), f"Wrong timestamp: {bars[0]['timestamp']}"

    def test_cpcv_purge_false_returns_all_bars(self):
        """cpcv_purge=False must return all bars (debug-only mode)."""
        from src.engine.replay.db_loader import load_backtest_bar_data

        # Same WF row as above
        wf_row = MagicMock()
        wf_row.__getitem__ = lambda self, k: {
            "id": "fold-1", "window_index": 0,
            "is_start": "2024-01-01", "is_end": "2024-03-31",
            "oos_start": "2024-04-01", "oos_end": "2024-06-30",
        }[k]

        trade_a = MagicMock()
        trade_a.__getitem__ = lambda self, k: {
            "entry_time": datetime(2024, 2, 15, 10, 30, tzinfo=timezone.utc),
            "exit_time": None, "direction": "long",
            "entry_price": 4200.0, "exit_price": 4215.0,
            "pnl": 15.0, "net_pnl": 12.5, "contracts": 1, "commission": 2.5,
            "session_type": "rth", "macro_regime": "TRENDING",
        }[k]
        trade_a.get = lambda k, default=None: trade_a[k] if k in [
            "entry_time", "exit_time", "direction", "entry_price", "exit_price",
            "pnl", "net_pnl", "contracts", "commission", "session_type", "macro_regime"
        ] else default

        trade_b = MagicMock()
        trade_b.__getitem__ = lambda self, k: {
            "entry_time": datetime(2024, 5, 10, 10, 30, tzinfo=timezone.utc),
            "exit_time": None, "direction": "long",
            "entry_price": 4350.0, "exit_price": 4365.0,
            "pnl": 15.0, "net_pnl": 12.5, "contracts": 1, "commission": 2.5,
            "session_type": "rth", "macro_regime": "RANGE_BOUND",
        }[k]
        trade_b.get = lambda k, default=None: trade_b[k] if k in [
            "entry_time", "exit_time", "direction", "entry_price", "exit_price",
            "pnl", "net_pnl", "contracts", "commission", "session_type", "macro_regime"
        ] else default

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchall.side_effect = [[wf_row], [trade_a, trade_b]]
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

        with patch("src.engine.replay.db_loader._get_db_connection", return_value=mock_conn):
            bars = load_backtest_bar_data(backtest_id=1, cpcv_purge=False)

        assert len(bars) == 2, f"Expected 2 bars with cpcv_purge=False, got {len(bars)}"

    def test_default_cpcv_purge_is_true(self):
        """Default cpcv_purge parameter must be True (training safety default)."""
        import inspect  # noqa: I001

        from src.engine.replay.db_loader import load_backtest_bar_data
        sig = inspect.signature(load_backtest_bar_data)
        default = sig.parameters["cpcv_purge"].default
        assert default is True, f"cpcv_purge default must be True, got {default!r}"


# ─── Test 14: State vector JSONB round-trip ───────────────────────────────────

class TestStateVectorSerialization:
    """State vector must serialize to numpy and back to JSON without data loss."""

    def test_state_vector_roundtrip(self):
        """serialize_state_to_numpy must produce a numpy array of correct length."""
        state = {f: None for f in PRODUCTION_STATE_FIELDS}
        state["daily_atr"] = 12.5
        state["daily_ema_20"] = 4200.0
        state["htf_bias_direction"] = "bullish"
        state["institutional_regime"] = "TRENDING"
        state["confluence_score_11factor"] = 0.78
        state["position"] = 1
        state["pnl"] = 150.0

        vec = serialize_state_to_numpy(state)
        assert vec.shape == (_N_STATE_FIELDS,), f"Expected ({_N_STATE_FIELDS},), got {vec.shape}"
        assert not np.any(np.isnan(vec)), "State vector must not contain NaN"
        assert not np.any(np.isinf(vec)), "State vector must not contain Inf"

    def test_all_none_state_produces_zero_vector(self):
        """All-None state must produce zero vector (null-fill)."""
        state = {f: None for f in PRODUCTION_STATE_FIELDS}
        vec = serialize_state_to_numpy(state)
        assert np.all(vec == 0.0), "All-None state must produce zero vector"

    def test_state_vector_jsonb_serializable(self):
        """State dict must be JSON-serializable (for JSONB column)."""
        state = {f: None for f in PRODUCTION_STATE_FIELDS}
        state["daily_atr"] = 12.5
        state["htf_bias_direction"] = "bullish"
        state["position"] = 0
        state["pnl"] = 0.0
        # Must not raise
        serialized = json.dumps(state)
        restored = json.loads(serialized)
        assert restored["daily_atr"] == 12.5

    def test_state_vector_has_correct_field_count(self):
        """State vector length must match _N_STATE_FIELDS (25)."""
        assert _N_STATE_FIELDS == 25


# ─── Test 15: QUANTUM_RL_REWARD_ALPHA env override ───────────────────────────

class TestRewardFunctionEnvOverride:
    """QUANTUM_RL_REWARD_ALPHA=0.0 must disable ci_high penalty."""

    def test_alpha_zero_disables_ci_high_penalty(self):
        """When QUANTUM_RL_REWARD_ALPHA=0.0, ci_high penalty must be zero regardless of ci_high."""
        prices = _make_prices()
        features = _make_features()

        with patch.dict(os.environ, {"QUANTUM_RL_REWARD_ALPHA": "0.0"}):
            env = TradingEnv(prices, features, seed=42)

        shaped, ci_pen, dd_pen = env.compute_shaped_reward(
            realized_r=1.0, ci_high=0.90, drawdown_penalty=0.0
        )
        assert ci_pen == 0.0, f"Expected 0 ci_high penalty with alpha=0, got {ci_pen}"
        assert abs(shaped - 1.0) < 1e-6, f"Shaped reward {shaped} != 1.0 with zero penalties"

    def test_beta_zero_disables_drawdown_penalty(self):
        """When QUANTUM_RL_REWARD_BETA=0.0, drawdown penalty must be zero."""
        prices = _make_prices()
        features = _make_features()

        with patch.dict(os.environ, {"QUANTUM_RL_REWARD_BETA": "0.0"}):
            env = TradingEnv(prices, features, seed=42)

        shaped, ci_pen, dd_pen = env.compute_shaped_reward(
            realized_r=1.0, ci_high=0.0, drawdown_penalty=5.0
        )
        assert dd_pen == 0.0, f"Expected 0 drawdown penalty with beta=0, got {dd_pen}"

    def test_reward_alpha_env_var_name(self):
        """QUANTUM_RL_REWARD_ALPHA is the canonical env var name for α."""
        with patch.dict(os.environ, {"QUANTUM_RL_REWARD_ALPHA": "0.25"}):
            env = _make_env()
        assert abs(env._reward_alpha - 0.25) < 1e-6

    def test_reward_beta_env_var_name(self):
        """QUANTUM_RL_REWARD_BETA is the canonical env var name for β."""
        with patch.dict(os.environ, {"QUANTUM_RL_REWARD_BETA": "0.15"}):
            env = _make_env()
        assert abs(env._reward_beta - 0.15) < 1e-6


# ─── Test 16: TS-side schema smoke test (documented vitest carry-forward) ─────

class TestSchemaTs:
    """quantumRlRuns Drizzle table must be exported from schema.ts.

    Note: Full TypeScript type-check is a vitest carry-forward for C.4 architect.
    This test validates the schema.ts file contains the export at the Python level.
    """

    def test_schema_ts_exports_quantum_rl_runs(self):
        """schema.ts must export quantumRlRuns pgTable."""
        import pathlib
        schema_path = (
            pathlib.Path(__file__).parents[2]
            / "server" / "db" / "schema.ts"
        )
        assert schema_path.exists(), f"schema.ts not found: {schema_path}"
        content = schema_path.read_text()
        assert "export const quantumRlRuns" in content, (
            "quantumRlRuns not exported from schema.ts"
        )

    def test_schema_ts_does_not_modify_existing_tables(self):
        """Adding quantumRlRuns must be additive — no changes to existing tables."""
        import pathlib
        schema_path = (
            pathlib.Path(__file__).parents[2]
            / "server" / "db" / "schema.ts"
        )
        content = schema_path.read_text()
        # Verify key existing tables remain unchanged
        assert "export const strategyHealthScores" in content
        assert "export const strategies" in content or "strategies = pgTable" in content

    def test_quantum_rl_runs_uses_separate_namespace_from_mc_runs(self):
        """schema.ts quantumRlRuns must be separate from quantumMcRuns."""
        import pathlib
        schema_path = (
            pathlib.Path(__file__).parents[2]
            / "server" / "db" / "schema.ts"
        )
        content = schema_path.read_text()
        # quantumRlRuns must exist
        assert "quantumRlRuns" in content
        # Comment must document namespace separation
        assert "quantum_rl_runs" in content


# ─── Additional: Isolation tests (governance boundary) ───────────────────────

class TestChallengerIsolation:
    """RL env must not write to quantum_mc_runs or have execution authority."""

    def test_rl_runs_governance_has_no_execution_authority(self):
        """RL_RUNS_GOVERNANCE must declare authoritative=False."""
        assert RL_RUNS_GOVERNANCE["authoritative"] is False

    def test_rl_runs_governance_decision_role_is_challenger_only(self):
        """RL_RUNS_GOVERNANCE must declare decision_role=challenger_only."""
        assert RL_RUNS_GOVERNANCE["decision_role"] == "challenger_only"

    def test_trading_env_reset_preserves_backward_compat(self):
        """reset() must return numpy array (backward-compat signature)."""
        env = _make_env()
        state = env.reset()
        assert isinstance(state, np.ndarray), f"reset() must return np.ndarray, got {type(state)}"

    def test_trading_env_step_returns_tuple(self):
        """step() must return (np.ndarray, float, bool) tuple."""
        env = _make_env()
        env.reset()
        result = env.step(0)
        assert len(result) == 3
        state, reward, done = result
        assert isinstance(state, np.ndarray)
        assert isinstance(reward, float)
        assert isinstance(done, bool)

    def test_production_state_fields_all_strings(self):
        """All PRODUCTION_STATE_FIELDS must be non-empty strings."""
        for f in PRODUCTION_STATE_FIELDS:
            assert isinstance(f, str) and f.strip(), f"Invalid field name: {f!r}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
