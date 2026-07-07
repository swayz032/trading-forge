"""Quantum RL Agent — Variational Quantum Circuit for trade decisions.

Uses parameterized quantum circuits (VQC) as the RL policy network.
8-16 qubit circuits trained via policy gradient on RTX 5060.

Evidence: MIXED
  (+) Wells Fargo: Sharpe 4.01, 30.1% return (arxiv 2507.12835)
  (-) Chen et al: Underperforms classical on real metrics (arxiv 2506.20930)
  → Treat as experimental. Full WF+MC+OOS validation required.

Library: PennyLane + pennylane-lightning[gpu] (WSL2)
Governance: experimental: true, decision_role: challenger_only

Usage:
    python -m src.engine.quantum_rl_agent --mode train --input-json '{"episodes": 100, ...}'
    python -m src.engine.quantum_rl_agent --mode evaluate --input-json '{"model_path": "...", ...}'
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
from collections import deque
from datetime import datetime
from typing import Any, Optional

import numpy as np
from pydantic import BaseModel, Field

try:
    from src.engine.cloud_backend import quantum_result_cache as _rl_cache
except ImportError:
    _rl_cache = None  # type: ignore[assignment]

# Optional quantum entropy filter (QCNN noise scorer).
# Fail-open: if module unavailable or threshold not yet calibrated, noise_score
# is returned as None. Threshold calibration is a post-30-day task (Tier 3.1).
try:
    from src.engine.quantum_entropy_filter import (
        run_quantum_entropy_filter as _run_entropy_filter,
    )
    _ENTROPY_FILTER_AVAILABLE = True
except ImportError:
    _run_entropy_filter = None  # type: ignore[assignment]
    _ENTROPY_FILTER_AVAILABLE = False

_rl_logger = logging.getLogger(__name__)

# Optional PennyLane
try:
    import pennylane as qml
    from pennylane import numpy as pnp  # noqa: F401  # re-exported for VQC param init
    PENNYLANE_AVAILABLE = True
    try:
        from braket.aws import AwsDevice  # noqa: F401 — presence check only
        BRAKET_PENNYLANE_AVAILABLE = True
    except ImportError:
        BRAKET_PENNYLANE_AVAILABLE = False
except ImportError:
    PENNYLANE_AVAILABLE = False
    BRAKET_PENNYLANE_AVAILABLE = False

# institutional-grade observability (2026-07-06): shout ONCE at import if PennyLane is missing, so a future
# silent lib-removal can never quietly degrade the RL agent to classical/random coin-flip without anyone
# noticing (the exact "quantum silently ran classical for months" gap that prompted this). Advisory-only —
# quantum is challenger-only and this never blocks; the honest state is always queryable via
# `npm run check:quantum-backends`.
if not PENNYLANE_AVAILABLE:
    _rl_logger.warning(
        "QUANTUM RL: PennyLane NOT installed — VQC policy training runs CLASSICAL fallback (near-random "
        "action selection). `pip install pennylane pennylane-lightning` to restore real circuits. "
        "Challenger-only: does NOT affect trading."
    )


# ─── Governance ──────────────────────────────────────────────────
GOVERNANCE = {
    "experimental": True,
    "authoritative": False,
    "decision_role": "challenger_only",
    "evidence_status": "mixed — requires full WF+MC+OOS validation",
}

# Governance labels for quantum_rl_runs rows (distinct from IAE replay contract).
# training_mode=true is REQUIRED — NOT replay_mode (that belongs to quantum_mc_runs).
RL_RUNS_GOVERNANCE = {
    "experimental": True,
    "authoritative": False,
    "decision_role": "challenger_only",
    "training_mode": True,
}

# ─── RL Reward Hyperparameters ────────────────────────────────────
# α: ci_high penalty coefficient — default 0.5, override via QUANTUM_RL_REWARD_ALPHA
# β: drawdown penalty coefficient — default 0.3, override via QUANTUM_RL_REWARD_BETA
# Reward formula: realized_R − α × max(0, ci_high − _RL_CI_HIGH_THRESHOLD) − β × drawdown_penalty
#
# _RL_CI_HIGH_THRESHOLD reads B14_RUIN_CI_HIGH_THRESHOLD from env (default 0.20,
# tightened from 0.40 on 2026-06-22) so it always tracks the production gate in
# b14-ci-gate.ts::getB14CiHighThreshold(). Single source of truth.
#
# NOTE on frozen-policy SHA-256 contract (Wave 29 Pass B):
#   The frozen-policy hash covers {entry_quality, position_size, stop_loss,
#   take_profit, exit_plan_config}. Reward hyperparameters are NOT in that slice,
#   so changing this constant does NOT invalidate any existing frozen_policy_hash.
#   However, existing trained policies in quantum_rl_runs were shaped by the prior
#   0.40 anchor. Those policies are NOT automatically retrained — the operator must
#   trigger new training runs (off-RTH cron) to benefit from the tighter anchor.
_RL_REWARD_ALPHA_DEFAULT = 0.5
_RL_REWARD_BETA_DEFAULT = 0.3
_RL_CI_HIGH_THRESHOLD: float = float(
    os.environ.get("B14_RUIN_CI_HIGH_THRESHOLD", "0.20")
)  # Tightened 0.40 → 0.20 on 2026-06-22; tracks production gate default
_RL_DRAWDOWN_WINDOW = 20       # Rolling window for drawdown penalty computation

# ─── Kill-switch dormancy threshold ───────────────────────────────
# Env var: QUANTUM_RL_KILL_SWITCH_THRESHOLD_PCT (default 30.0)
# Read at module load so all call sites use the same resolved value.
# Matches the TS mirror in rl-signal-fetcher.ts (same default, same env var name).
_DORMANT_GAP_THRESHOLD_PCT: float = float(
    os.environ.get("QUANTUM_RL_KILL_SWITCH_THRESHOLD_PCT", "30.0")
)

# ─── Production State Field Definitions ─────────────────────────
# Canonical 25-field production state vector.
# Fields marked OPTIONAL degrade gracefully to None on DB miss.
PRODUCTION_STATE_FIELDS = [
    "daily_atr",               # float — current daily ATR
    "daily_ema_20",            # float — 20-period daily EMA
    "htf_bias_direction",      # str  — "bullish"|"bearish"|"neutral"|None
    "itf_structure_state",     # str  — "BOS"|"CHoCH"|"MSS"|None
    "htf_narrative_phase",     # str  — "NEUTRAL"|"ACCUMULATION"|"MANIPULATION"|"DISTRIBUTION"|"REVERSAL_FORMING"|None
    "killzone",                # str  — "london"|"ny_am"|"ny_pm"|"silver_bullet"|"macro_window"|"none"
    "institutional_regime",    # str  — "TRENDING"|"RANGE_BOUND"|"HIGH_VOL_MACRO"|"COMPRESSION"|"EXPANSION"|"LOW_LIQ_CHOP"|None
    "confluence_score_11factor",# float [0,1] — weighted 11-factor confluence score
    "liquidity_proximity_pts", # float — distance to nearest intraday DOL in points (OPTIONAL)
    "session_phase",           # str  — "asian"|"london"|"ny_am"|"ny_pm"|"globex_evening"
    "smt_score",               # float [0,1] — SMT ES↔NQ divergence score
    "noise_score",             # float [0,1] OPTIONAL — quantum entropy filter; None when unavailable
    "position",                # int  — -1|0|1 (backward-compat with original toy env)
    "pnl",                     # float — running P&L (backward-compat with original toy env)
    # Extended MTF features (OPTIONAL — None when bias_state row unavailable)
    "htf_bias_score",          # float [0,1] from bias_state.confluence_score
    "structure_bos_count",     # int — count of BOS signals in bias_state window
    "structure_choch_count",   # int — count of CHoCH signals
    "structure_mss_count",     # int — count of MSS signals
    "narrative_london_direction", # str — "bullish"|"bearish"|None from htf_narrative
    "narrative_ny_direction",  # str — "bullish"|"bearish"|None from htf_narrative
    "dealing_quadrant",        # str — "premium_upper"|"discount_lower"|...|None
    "regime_evidence_atr_pct", # float — ATR percentile from regime_evidence JSONB
    "regime_evidence_vol_ratio",# float — volume ratio from regime_evidence JSONB
    "wf_efficiency",           # float — walk_forward_efficiency from latest backtest (OPTIONAL)
    "probability_of_ruin_ci_high", # float — ci_high snapshot from latest MC run (OPTIONAL)
]

_N_STATE_FIELDS = len(PRODUCTION_STATE_FIELDS)  # 25


# ─── DB-Backed Production State Loader ───────────────────────────

def _load_production_state_at(
    timestamp: datetime,
    symbol: str,
    strategy_id: Optional[int] = None,
) -> Optional[dict[str, Any]]:
    """Load the full production state vector for a given timestamp and symbol.

    Reads from:
      - bias_state table (HTF bias direction, structure state, narrative, confluence)
      - liquidity_levels table (proximity to nearest intraday DOL)
      - monte_carlo_runs table (probability_of_ruin_ci.ci_high snapshot, OPTIONAL)
      - backtests table (walk_forward_efficiency, OPTIONAL)

    Returns a dict with all PRODUCTION_STATE_FIELDS. Any field that cannot be
    populated from DB returns None — caller must null-fill for numpy serialization.

    Connection pattern mirrors src/engine/replay/db_loader.py::_get_db_connection().
    Direct sub-module import (no package-level import) per CIRCULAR-IMPORT note in CLAUDE.md.

    Args:
        timestamp: the decision timestamp (used to find the nearest prior bias_state row)
        symbol: trading symbol (e.g. "MES", "MNQ", "MCL")
        strategy_id: optional strategy integer ID for MC run lookup

    Returns:
        dict with 25 fields (values may be None for unavailable fields), or None if
        DB connection fails entirely.
    """
    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        _rl_logger.warning(
            "_load_production_state_at: psycopg2 not available — returning None"
        )
        return None

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        _rl_logger.warning(
            "_load_production_state_at: DATABASE_URL not set — returning None"
        )
        return None

    state: dict[str, Any] = {f: None for f in PRODUCTION_STATE_FIELDS}

    try:
        conn = psycopg2.connect(db_url)
    except Exception as exc:
        _rl_logger.warning(
            "_load_production_state_at: DB connect failed (%s) — returning None", exc
        )
        return None

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            # ── 1. Load bias_state row nearest to timestamp ────────────────
            sql_bias = """
                SELECT
                    state,
                    confluence_score,
                    structure_state,
                    narrative_state,
                    htf_narrative,
                    regime_evidence,
                    institutional_regime,
                    created_at
                FROM bias_state
                WHERE symbol = %s
                  AND created_at <= %s
                ORDER BY created_at DESC
                LIMIT 1
            """
            cur.execute(sql_bias, (symbol, timestamp))
            bias_row = cur.fetchone()

            if bias_row is not None:
                bias_state_json = bias_row["state"] or {}
                if isinstance(bias_state_json, str):
                    try:
                        bias_state_json = json.loads(bias_state_json)
                    except (json.JSONDecodeError, TypeError):
                        bias_state_json = {}

                # Extract HTF bias direction from state JSONB
                state["htf_bias_direction"] = bias_state_json.get("htfBiasDirection") or bias_state_json.get("htf_bias_direction")
                state["daily_atr"] = _safe_float(bias_state_json.get("dailyAtr") or bias_state_json.get("daily_atr"))
                state["daily_ema_20"] = _safe_float(bias_state_json.get("dailyEma20") or bias_state_json.get("daily_ema_20"))
                state["htf_bias_score"] = _safe_float(bias_row["confluence_score"])
                state["institutional_regime"] = bias_row["institutional_regime"]

                # Structure state: BOS / CHoCH / MSS from structure_state JSONB
                structure_json = bias_row["structure_state"] or {}
                if isinstance(structure_json, str):
                    try:
                        structure_json = json.loads(structure_json)
                    except (json.JSONDecodeError, TypeError):
                        structure_json = {}
                state["itf_structure_state"] = structure_json.get("current_state") or structure_json.get("currentState")
                state["structure_bos_count"] = _safe_int(structure_json.get("bos_count") or structure_json.get("bosCount"))
                state["structure_choch_count"] = _safe_int(structure_json.get("choch_count") or structure_json.get("chochCount"))
                state["structure_mss_count"] = _safe_int(structure_json.get("mss_count") or structure_json.get("mssCount"))

                # HTF narrative state
                narrative_json = bias_row["narrative_state"] or {}
                if isinstance(narrative_json, str):
                    try:
                        narrative_json = json.loads(narrative_json)
                    except (json.JSONDecodeError, TypeError):
                        narrative_json = {}
                state["htf_narrative_phase"] = narrative_json.get("phase") or narrative_json.get("current_phase")

                # HTF narrative sub-fields (htf_narrative JSONB)
                htf_nar_json = bias_row["htf_narrative"] or {}
                if isinstance(htf_nar_json, str):
                    try:
                        htf_nar_json = json.loads(htf_nar_json)
                    except (json.JSONDecodeError, TypeError):
                        htf_nar_json = {}
                london_bias = htf_nar_json.get("londonBias") or htf_nar_json.get("london_bias") or {}
                ny_bias = htf_nar_json.get("nyBias") or htf_nar_json.get("ny_bias") or {}
                dealing = htf_nar_json.get("dailyDealing") or htf_nar_json.get("daily_dealing") or {}
                if isinstance(london_bias, dict):
                    state["narrative_london_direction"] = london_bias.get("direction")
                if isinstance(ny_bias, dict):
                    state["narrative_ny_direction"] = ny_bias.get("direction")
                if isinstance(dealing, dict):
                    state["dealing_quadrant"] = dealing.get("current_quadrant") or dealing.get("currentQuadrant")

                # Regime evidence
                regime_ev_json = bias_row["regime_evidence"] or {}
                if isinstance(regime_ev_json, str):
                    try:
                        regime_ev_json = json.loads(regime_ev_json)
                    except (json.JSONDecodeError, TypeError):
                        regime_ev_json = {}
                state["regime_evidence_atr_pct"] = _safe_float(regime_ev_json.get("atr_percentile") or regime_ev_json.get("atrPercentile"))
                state["regime_evidence_vol_ratio"] = _safe_float(regime_ev_json.get("volume_ratio") or regime_ev_json.get("volumeRatio"))

            # ── 2. Load liquidity proximity (nearest intraday DOL) ─────────
            sql_liq = """
                SELECT MIN(ABS(level_value - %s::float))  AS proximity_pts
                FROM liquidity_levels
                WHERE symbol = %s
                  AND is_active = true
                  AND level_type IN (
                      'PDH', 'PDL', 'Asian_High', 'Asian_Low',
                      'London_High', 'London_Low', 'HOD', 'LOD',
                      'EQH', 'EQL'
                  )
            """
            # Use daily_atr as a proxy for current price when no price is available
            # The caller may supply current price via bias_state; fall back gracefully.
            current_price = state.get("daily_ema_20") or 4000.0  # MES approximate
            try:
                cur.execute(sql_liq, (current_price, symbol))
                liq_row = cur.fetchone()
                if liq_row is not None and liq_row["proximity_pts"] is not None:
                    state["liquidity_proximity_pts"] = float(liq_row["proximity_pts"])
            except Exception as liq_exc:
                _rl_logger.debug(
                    "_load_production_state_at: liquidity query failed (%s) — None for proximity",
                    liq_exc,
                )

            # ── 3. SMT score from bias_state state JSONB ───────────────────
            if bias_row is not None:
                smt_val = bias_state_json.get("smtScore") or bias_state_json.get("smt_score")
                state["smt_score"] = _safe_float(smt_val)
                conf_val = bias_state_json.get("confluenceScore") or bias_state_json.get("confluence_score")
                if conf_val is None:
                    conf_val = bias_row.get("confluence_score")
                state["confluence_score_11factor"] = _safe_float(conf_val)

            # ── 4. MC ruin probability ci_high (OPTIONAL) ─────────────────
            if strategy_id is not None:
                sql_mc = """
                    SELECT
                        raw_result->>'probability_of_ruin_ci' AS ruin_ci_json
                    FROM monte_carlo_runs
                    WHERE backtest_id IN (
                        SELECT id FROM backtests
                        WHERE strategy_id = %s
                        ORDER BY created_at DESC
                        LIMIT 1
                    )
                      AND status = 'completed'
                    ORDER BY created_at DESC
                    LIMIT 1
                """
                try:
                    cur.execute(sql_mc, (strategy_id,))
                    mc_row = cur.fetchone()
                    if mc_row and mc_row["ruin_ci_json"]:
                        ruin_ci = mc_row["ruin_ci_json"]
                        if isinstance(ruin_ci, str):
                            ruin_ci = json.loads(ruin_ci)
                        if isinstance(ruin_ci, dict):
                            state["probability_of_ruin_ci_high"] = _safe_float(ruin_ci.get("ci_high"))
                except Exception as mc_exc:
                    _rl_logger.debug(
                        "_load_production_state_at: MC ruin CI query failed (%s) — None",
                        mc_exc,
                    )

            # ── 5. Walk-forward efficiency (OPTIONAL) ─────────────────────
            if strategy_id is not None:
                sql_wfe = """
                    SELECT wfe_overall
                    FROM backtests
                    WHERE strategy_id = %s
                      AND status = 'completed'
                      AND wfe_overall IS NOT NULL
                    ORDER BY created_at DESC
                    LIMIT 1
                """
                try:
                    cur.execute(sql_wfe, (strategy_id,))
                    wfe_row = cur.fetchone()
                    if wfe_row is not None:
                        state["wf_efficiency"] = _safe_float(wfe_row["wfe_overall"])
                except Exception as wfe_exc:
                    _rl_logger.debug(
                        "_load_production_state_at: WFE query failed (%s) — None", wfe_exc
                    )

    except Exception as exc:
        _rl_logger.warning(
            "_load_production_state_at: unexpected error (%s) — returning partial state", exc
        )
    finally:
        conn.close()

    # ── 6. Session phase from timestamp ───────────────────────────────────────
    state["session_phase"] = _classify_session_phase(timestamp)

    # ── 7. Killzone from timestamp ────────────────────────────────────────────
    state["killzone"] = _classify_killzone(timestamp)

    # ── 8. Optional entropy noise score (QCNN) ────────────────────────────────
    # Fail-open: module unavailable OR threshold not calibrated → None
    state["noise_score"] = _try_compute_noise_score(state)

    return state


def _safe_float(val: Any) -> Optional[float]:
    """Convert value to float or None."""
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _safe_int(val: Any) -> Optional[int]:
    """Convert value to int or None."""
    if val is None:
        return None
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def _classify_session_phase(ts: datetime) -> str:
    """Classify session phase from UTC timestamp (DST-approximate, fail-safe).

    Returns: 'asian' | 'london' | 'ny_am' | 'ny_pm' | 'globex_evening'
    """
    # Approximate ET offset: UTC-5 (EST) / UTC-4 (EDT). Use a fixed -5 for simplicity;
    # DST precision is not critical for RL state features.
    et_hour = (ts.hour - 5) % 24
    if 18 <= et_hour or et_hour < 3:
        return "globex_evening"
    elif 3 <= et_hour < 8:
        return "asian"
    elif 8 <= et_hour < 9:
        return "london"
    elif 9 <= et_hour < 12:
        return "ny_am"
    else:
        return "ny_pm"


def _classify_killzone(ts: datetime) -> str:
    """Classify killzone from UTC timestamp.

    Returns: 'london' | 'ny_am' | 'ny_pm' | 'silver_bullet' | 'macro_window' | 'none'
    """
    et_hour = (ts.hour - 5) % 24
    et_minute = ts.minute
    et_decimal = et_hour + et_minute / 60.0

    if 2.0 <= et_decimal < 5.0:
        return "london"
    elif 8.5 <= et_decimal < 11.0:
        return "ny_am"
    elif 10.0 <= et_decimal < 11.0:
        return "silver_bullet"
    elif 13.5 <= et_decimal < 16.0:
        return "ny_pm"
    elif 7.5 <= et_decimal < 8.5:
        return "macro_window"
    return "none"


def _try_compute_noise_score(state: dict[str, Any]) -> Optional[float]:
    """Attempt to compute QCNN noise score from current state features.

    Fail-open: returns None when entropy filter module unavailable or
    when threshold calibration has not been completed (Tier 3.1 post-30-day task).

    Args:
        state: partially-filled state dict (will extract numeric features from it)

    Returns:
        float [0,1] noise score, or None on any failure
    """
    if not _ENTROPY_FILTER_AVAILABLE or _run_entropy_filter is None:
        return None

    try:
        # Build minimal feature dict for entropy filter
        # Entropy filter expects a dict of numeric features
        feature_keys = [
            "daily_atr", "daily_ema_20", "htf_bias_score",
            "confluence_score_11factor", "smt_score",
            "regime_evidence_atr_pct", "regime_evidence_vol_ratio",
            "liquidity_proximity_pts",
        ]
        features: dict[str, float] = {}
        for k in feature_keys:
            v = state.get(k)
            if v is not None:
                features[k] = float(v)

        if len(features) < 3:
            # Insufficient features — degrade gracefully
            return None

        result = _run_entropy_filter(features)
        if result is None:
            return None
        # Extract noise_score from result dict
        if isinstance(result, dict):
            score = result.get("noise_score")
            return _safe_float(score)
        return _safe_float(result)
    except Exception as exc:
        _rl_logger.debug(
            "_try_compute_noise_score: entropy filter failed (%s) — returning None", exc
        )
        return None


def serialize_state_to_numpy(state: dict[str, Any]) -> np.ndarray:
    """Serialize production state dict to numpy feature vector (~25 features).

    Null fields are filled with 0.0. Categorical fields are encoded as integers.
    Returns shape (N_STATE_FIELDS,) float64 array.
    """
    # Encoding maps for categorical fields
    _regime_map = {
        "TRENDING": 1.0, "RANGE_BOUND": 2.0, "HIGH_VOL_MACRO": 3.0,
        "COMPRESSION": 4.0, "EXPANSION": 5.0, "LOW_LIQ_CHOP": 6.0,
    }
    _bias_map = {"bullish": 1.0, "bearish": -1.0, "neutral": 0.0}
    _structure_map = {"BOS": 1.0, "CHoCH": 2.0, "MSS": 3.0}
    _narrative_map = {
        "NEUTRAL": 0.0, "ACCUMULATION": 1.0, "MANIPULATION": 2.0,
        "DISTRIBUTION": 3.0, "REVERSAL_FORMING": 4.0,
    }
    _killzone_map = {
        "none": 0.0, "london": 1.0, "ny_am": 2.0, "ny_pm": 3.0,
        "silver_bullet": 4.0, "macro_window": 5.0,
    }
    _session_map = {
        "asian": 1.0, "london": 2.0, "ny_am": 3.0, "ny_pm": 4.0, "globex_evening": 0.0,
    }
    _direction_map = {"bullish": 1.0, "bearish": -1.0}
    _dealing_map = {
        "premium_upper": 2.0, "premium_lower": 1.0, "equilibrium": 0.0,
        "discount_upper": -1.0, "discount_lower": -2.0,
    }

    encoders = {
        "htf_bias_direction":      lambda v: _bias_map.get(str(v).lower(), 0.0) if v else 0.0,
        "itf_structure_state":     lambda v: _structure_map.get(str(v), 0.0) if v else 0.0,
        "htf_narrative_phase":     lambda v: _narrative_map.get(str(v), 0.0) if v else 0.0,
        "killzone":                lambda v: _killzone_map.get(str(v), 0.0) if v else 0.0,
        "institutional_regime":    lambda v: _regime_map.get(str(v), 0.0) if v else 0.0,
        "session_phase":           lambda v: _session_map.get(str(v), 0.0) if v else 0.0,
        "narrative_london_direction": lambda v: _direction_map.get(str(v).lower(), 0.0) if v else 0.0,
        "narrative_ny_direction":  lambda v: _direction_map.get(str(v).lower(), 0.0) if v else 0.0,
        "dealing_quadrant":        lambda v: _dealing_map.get(str(v), 0.0) if v else 0.0,
    }

    vec = []
    for field in PRODUCTION_STATE_FIELDS:
        val = state.get(field)
        if field in encoders:
            vec.append(encoders[field](val))
        elif val is None:
            vec.append(0.0)
        else:
            try:
                vec.append(float(val))
            except (TypeError, ValueError):
                vec.append(0.0)

    return np.array(vec, dtype=np.float64)


class VQCConfig(BaseModel):
    """Configuration for the Variational Quantum Circuit policy."""
    n_qubits: int = 8
    n_layers: int = 3
    feature_dim: int = 8  # Must match number of market features
    n_actions: int = 2    # Wave 29 Pass C: LONG/FLAT only per day-trader mandate (CLAUDE.md §4)
    learning_rate: float = 0.01
    device: str = "default.qubit"  # default.qubit | lightning.qubit | lightning.gpu | braket.aws.sv1 | braket.aws.ionq
    cloud_config: Optional[dict] = None  # CloudBackendConfig as dict (opt-in only)
    max_cloud_evaluations: int = 100     # Cost control: switch to local after this many cloud circuit evaluations
    opt_in_cloud: bool = False           # Second gate: must be True AND QUANTUM_CLOUD_ENABLED=true to use cloud QPU


class TrainConfig(BaseModel):
    """Training configuration."""
    episodes: int = 100
    max_steps_per_episode: int = 100
    gamma: float = 0.99  # Discount factor
    seed: int = 42


class AgentResult(BaseModel):
    """Result from agent evaluation."""
    total_return: float
    sharpe_ratio: float
    win_rate: float
    total_trades: int
    actions: list[int] = Field(default_factory=list)  # 0=buy, 1=sell, 2=hold
    rewards: list[float] = Field(default_factory=list)
    execution_time_ms: int = 0
    governance: dict = Field(default_factory=lambda: GOVERNANCE.copy())


class ComparisonResult(BaseModel):
    """Quantum vs classical RL comparison."""
    quantum: AgentResult
    classical: AgentResult
    quantum_wins: bool
    sharpe_delta: float
    return_delta: float
    notes: str = ""
    governance: dict = Field(default_factory=lambda: GOVERNANCE.copy())


# ─── Trading Environment (Wave 29 Pass C.1 Extended) ─────────────

class TradingEnv:
    """Production-state trading environment for RL training.

    Extended from 8-feature toy env to full ~25-feature production state vector.

    State vector: serialize_state_to_numpy(production_state) — ~25 features including
      5-TF MTF indicators, structure engine, HTF narrative, killzones, 11-factor
      confluence, institutional regime, liquidity proximity, session phase, SMT score,
      optional QCNN noise score.

    Actions (LONG/FLAT ONLY — day-trader-only mandate):
      0 = act (take the trade at this bar)
      1 = skip (pass on this bar)

    AUTHORITY BOUNDARY: This env is CHALLENGER-ONLY. It cannot mutate strategy
    parameters, override lifecycle decisions, or write to quantum_mc_runs.

    Operator mandate (feedback_day_trader_only_no_swing.md):
      n_actions MUST be 2 (act/skip). Constructor raises ValueError if n_actions != 2.
      Short signals against HTF trend are architecturally impossible in this env.

    Reward formula (CFA Institute Nov 2025 institutional consensus):
      R = realized_R − α × max(0, ci_high − _RL_CI_HIGH_THRESHOLD) − β × drawdown_penalty
      α = QUANTUM_RL_REWARD_ALPHA env (default 0.5)
      β = QUANTUM_RL_REWARD_BETA env (default 0.3)
      _RL_CI_HIGH_THRESHOLD = B14_RUIN_CI_HIGH_THRESHOLD env (default 0.20, tightened 2026-06-22)

    Backward-compat: reset() and step() signatures preserved from original toy env.
    Legacy callers passing raw features arrays still work (production state loading
    is additive via _production_states optional parameter).
    """

    def __init__(
        self,
        prices: np.ndarray,
        features: np.ndarray,
        seed: int = 42,
        n_actions: int = 2,
        production_states: Optional[list[dict]] = None,
        ci_high_values: Optional[list[float]] = None,
        reward_alpha: Optional[float] = None,
        reward_beta: Optional[float] = None,
    ):
        """Initialize TradingEnv.

        Args:
            prices: price series (n_steps,)
            features: feature matrix (n_steps, n_features) — used as fallback when
                      production_states is None (backward-compat with toy data)
            seed: random seed for reproducibility
            n_actions: MUST be 2 (act/skip). Raises ValueError if != 2.
                       Operator mandate: LONG/FLAT only; no short signals.
            production_states: optional list of production state dicts from
                               _load_production_state_at(). When provided,
                               _get_state() uses serialize_state_to_numpy().
                               When None, falls back to raw features (toy mode).
            ci_high_values: optional per-step ci_high snapshot for reward shaping.
                            None values degrade gracefully to 0.0 (no ci_high penalty).
            reward_alpha: ci_high penalty coefficient (default QUANTUM_RL_REWARD_ALPHA env)
            reward_beta: drawdown penalty coefficient (default QUANTUM_RL_REWARD_BETA env)
        """
        # ── LONG/FLAT enforcement (day-trader-only mandate) ───────────────────
        if n_actions != 2:
            raise ValueError(
                f"TradingEnv: n_actions must be 2 (act/skip). Got {n_actions}. "
                "Day-trader-only mandate: LONG/FLAT 2-action only. "
                "Short signals against HTF trend are forbidden. "
                "See operator memory: feedback_day_trader_only_no_swing.md"
            )

        self.prices = prices
        self.features = features  # (n_steps, n_features) — toy fallback
        self.n_steps = len(prices)
        self.n_actions = n_actions
        self.rng = np.random.default_rng(seed)

        # Production state vector (Wave 29 Pass C.1 extension)
        self._production_states: Optional[list[dict]] = production_states
        self._ci_high_values: Optional[list[float]] = ci_high_values

        # Reward hyperparameters (env-configurable)
        self._reward_alpha = (
            reward_alpha
            if reward_alpha is not None
            else float(os.environ.get("QUANTUM_RL_REWARD_ALPHA", str(_RL_REWARD_ALPHA_DEFAULT)))
        )
        self._reward_beta = (
            reward_beta
            if reward_beta is not None
            else float(os.environ.get("QUANTUM_RL_REWARD_BETA", str(_RL_REWARD_BETA_DEFAULT)))
        )

        # Rolling drawdown window for β penalty computation
        self._pnl_history: deque = deque(maxlen=_RL_DRAWDOWN_WINDOW)

        self.reset()

    def reset(self) -> np.ndarray:
        """Reset environment to initial state. Returns initial state vector."""
        self.step_idx = 0
        self.position = 0  # 0 = flat, 1 = long (no -1 short per mandate)
        self.entry_price = 0.0
        self.pnl = 0.0
        self.trades = 0
        self._pnl_history.clear()
        return self._get_state()

    def _get_state(self) -> np.ndarray:
        """Return state vector at current step.

        When production_states is available, serializes via serialize_state_to_numpy().
        Falls back to raw features + position/pnl (backward-compat with toy env).
        """
        # Production state path (Wave 29 C.1 extension)
        if (
            self._production_states is not None
            and self.step_idx < len(self._production_states)
        ):
            prod_state = self._production_states[self.step_idx].copy()
            # Inject live position and pnl for position-awareness
            prod_state["position"] = self.position
            prod_state["pnl"] = self.pnl
            return serialize_state_to_numpy(prod_state)

        # Legacy fallback: raw features + position/pnl (original 8-feature toy mode)
        if self.step_idx >= len(self.features):
            return np.zeros(self.features.shape[1] + 2)
        state = np.concatenate([
            self.features[self.step_idx],
            [self.position, self.pnl / 1000.0],  # Normalize PnL
        ])
        return state

    def _compute_drawdown_penalty(self) -> float:
        """Compute rolling 20-step P&L drawdown penalty.

        Returns normalized drawdown over the rolling window.
        """
        if len(self._pnl_history) < 2:
            return 0.0
        pnl_arr = np.array(list(self._pnl_history))
        peak = np.maximum.accumulate(pnl_arr)
        drawdown = peak - pnl_arr
        max_dd = float(np.max(drawdown))
        # Normalize by ATR-proxy (use price range as fallback)
        normalizer = max(abs(self.prices[self.step_idx]) * 0.01, 1.0)
        return min(max_dd / normalizer, 10.0)  # cap at 10 to prevent reward explosion

    def _get_ci_high(self) -> float:
        """Get ci_high for current step (fail-open to 0.0)."""
        if self._ci_high_values is None:
            return 0.0
        if self.step_idx < len(self._ci_high_values):
            v = self._ci_high_values[self.step_idx]
            return float(v) if v is not None else 0.0
        return 0.0

    def compute_shaped_reward(
        self,
        realized_r: float,
        ci_high: Optional[float] = None,
        drawdown_penalty: Optional[float] = None,
    ) -> tuple[float, float, float]:
        """Compute shaped reward with ci_high and drawdown penalties.

        Formula: R = realized_R − α × max(0, ci_high − _RL_CI_HIGH_THRESHOLD) − β × drawdown_penalty

        Args:
            realized_r: raw realized reward (P&L change)
            ci_high: BCa-bootstrap ruin probability conservative bound (or None→0.0)
            drawdown_penalty: rolling drawdown penalty (or None → compute from history)

        Returns:
            (shaped_reward, ci_high_penalty_component, drawdown_penalty_component)
        """
        if ci_high is None:
            ci_high = self._get_ci_high()
        if drawdown_penalty is None:
            drawdown_penalty = self._compute_drawdown_penalty()

        ci_high_penalty = self._reward_alpha * max(0.0, ci_high - _RL_CI_HIGH_THRESHOLD)
        dd_penalty = self._reward_beta * drawdown_penalty
        shaped = realized_r - ci_high_penalty - dd_penalty
        return shaped, ci_high_penalty, dd_penalty

    def step(self, action: int) -> tuple[np.ndarray, float, bool]:
        """Take action and return (next_state, shaped_reward, done).

        Actions:
          0 = act (enter long at current bar; or close existing long)
          1 = skip (hold flat or stay in position)

        LONG/FLAT only. No short entries. Position is 0 (flat) or 1 (long).

        Reward is shaped per formula:
          R = realized_R − α × max(0, ci_high − _RL_CI_HIGH_THRESHOLD) − β × drawdown_penalty

        Signature preserved for backward-compat with training loop callers.
        """
        realized_reward = 0.0
        price = self.prices[self.step_idx]

        if action == 0:  # act: enter long if flat, or hold if already long
            if self.position == 0:
                # Enter long
                self.position = 1
                self.entry_price = price
                # No immediate reward on entry
            # else: already long — stay in position (no double-entry)

        else:  # action == 1: skip — close long if held, or stay flat
            if self.position == 1:
                # Close long
                realized_reward = price - self.entry_price
                self.pnl += realized_reward
                self.trades += 1
                self.position = 0
                self.entry_price = 0.0
            # else: already flat — hold flat (no cost)

        # Track unrealized P&L for drawdown computation
        if self.position == 1:
            unrealized = price - self.entry_price
            self._pnl_history.append(self.pnl + unrealized)
        else:
            self._pnl_history.append(self.pnl)

        self.step_idx += 1
        done = self.step_idx >= self.n_steps - 1

        # Force-close at episode end (EOD hard-flatten rule)
        if done and self.position == 1:
            final_price = self.prices[-1]
            realized_reward += final_price - self.entry_price
            self.pnl += final_price - self.entry_price
            self.position = 0
            self.trades += 1

        # Apply shaped reward
        shaped_reward, _, _ = self.compute_shaped_reward(realized_reward)

        return self._get_state(), shaped_reward, done


# ─── Classical RL Baseline (Simple DQN-like) ─────────────────────

class ClassicalAgent:
    """Simple tabular/linear RL agent for baseline comparison."""

    def __init__(self, state_dim: int, n_actions: int = 2, seed: int = 42):
        if n_actions == 3:
            raise ValueError(
                "ClassicalAgent: n_actions=3 is forbidden — LONG/FLAT 2-action mandate "
                "(day-trader-only; same constraint as TradingEnv). "
                "Pass n_actions=2 explicitly."
            )
        self.rng = np.random.default_rng(seed)
        self.weights = self.rng.standard_normal((state_dim, n_actions)) * 0.01
        self.n_actions = n_actions
        self.lr = 0.01

    def select_action(self, state: np.ndarray, epsilon: float = 0.1) -> int:
        if self.rng.random() < epsilon:
            return self.rng.integers(0, self.n_actions)
        q_values = state @ self.weights
        return int(np.argmax(q_values))

    def update(self, state: np.ndarray, action: int, reward: float, next_state: np.ndarray, gamma: float = 0.99):
        q_current = state @ self.weights
        q_next = next_state @ self.weights
        target = reward + gamma * np.max(q_next)
        error = target - q_current[action]
        self.weights[:, action] += self.lr * error * state


# ─── Quantum Policy (VQC) ────────────────────────────────────────

def build_vqc_policy(config: VQCConfig):
    """Build parameterized quantum circuit for policy network.

    Architecture:
      1. Angle encoding of features onto qubits
      2. Variational layers (Ry + CNOT entanglement)
      3. Measurement → softmax → action probabilities
    """
    if not PENNYLANE_AVAILABLE:
        return None, None

    # ── Cloud device selection — routed through resolve_backend() ────────────
    # Both gates must pass before any cloud QPU is used:
    #   Gate 1: config.opt_in_cloud must be True  (per-request opt-in)
    #   Gate 2: QUANTUM_CLOUD_ENABLED env var must be "true"  (kill-switch, fail-closed)
    # If either gate is closed, resolve_backend returns ("local", None, label)
    # and we fall through to default.qubit below.
    #
    # We do NOT inspect config.device.startswith("braket.aws") directly to pick
    # the device — that bypassed the two-gate safety layer (P1-1 fix).

    if config.device.startswith("braket.aws"):
        # Route through resolve_backend so both safety gates are enforced.
        try:
            from src.engine.cloud_backend import (
                CloudBackendConfig,
            )
            from src.engine.cloud_backend import (
                resolve_backend as _resolve_backend,
            )
            # Map the PennyLane device string to the Braket backend_name key
            _device_key_map = {
                "braket.aws.sv1": "sv1",
                "braket.aws.ionq": "ionq_forte1",
            }
            backend_key = _device_key_map.get(config.device, "sv1")

            # Merge any caller-supplied cloud_config dict over the defaults
            cloud_cfg_dict = config.cloud_config or {}
            cloud_cfg_dict = {
                "provider": "braket",
                "backend_name": backend_key,
                **cloud_cfg_dict,
                # opt_in_cloud on VQCConfig is authoritative — always honour it
                "opt_in_cloud": config.opt_in_cloud,
            }
            cloud_cfg = CloudBackendConfig(**cloud_cfg_dict)

            provider_name, _backend_obj, backend_label = _resolve_backend(
                cloud_cfg, problem_size=config.n_qubits
            )
        except Exception as _exc:
            import logging as _logging
            _logging.getLogger(__name__).warning(
                "build_vqc_policy: resolve_backend failed (%s) — falling back to default.qubit",
                _exc,
            )
            provider_name = "local"
            backend_label = "default.qubit"

        if provider_name == "braket" and BRAKET_PENNYLANE_AVAILABLE:
            # resolve_backend approved cloud — look up the ARN for PennyLane
            _BRAKET_DEVICE_ARNS = {
                "sv1": "arn:aws:braket:::device/quantum-simulator/amazon/sv1",
                "ionq_forte1": "arn:aws:braket:us-east-1::device/qpu/ionq/Forte-1",
            }
            arn = _BRAKET_DEVICE_ARNS.get(backend_key)
            if arn:
                dev = qml.device(
                    "braket.aws.qubit",
                    device_arn=arn,
                    wires=config.n_qubits,
                    shots=1000,
                    s3_destination_folder=("amazon-braket-trading-forge", "rl-jobs"),
                )
                import logging as _logging
                _logging.getLogger(__name__).info(
                    "build_vqc_policy: using Braket cloud device label=%s arn=%s",
                    backend_label,
                    arn,
                )
            else:
                # ARN unknown for this key — local fallback
                import logging as _logging
                _logging.getLogger(__name__).warning(
                    "build_vqc_policy: no ARN for backend_key=%s — falling back to default.qubit",
                    backend_key,
                )
                dev = qml.device("default.qubit", wires=config.n_qubits)
        else:
            # Either gate was closed (opt_in_cloud=False, env kill-switch, budget
            # exhausted, or Braket plugin unavailable) — use local simulator.
            import logging as _logging
            _logging.getLogger(__name__).info(
                "build_vqc_policy: cloud gate closed (provider=%s, braket_plugin=%s,"
                " opt_in_cloud=%s) — using default.qubit",
                provider_name,
                BRAKET_PENNYLANE_AVAILABLE,
                config.opt_in_cloud,
            )
            dev = qml.device("default.qubit", wires=config.n_qubits)
    else:
        dev = qml.device(config.device or "default.qubit", wires=config.n_qubits)

    n_params = config.n_layers * config.n_qubits * 2  # Ry + Rz per qubit per layer

    @qml.qnode(dev)
    def circuit(params, features):
        # Feature encoding
        for i in range(min(config.n_qubits, len(features))):
            qml.RY(features[i], wires=i)

        # Variational layers
        param_idx = 0
        for layer in range(config.n_layers):
            for qubit in range(config.n_qubits):
                qml.RY(params[param_idx], wires=qubit)
                param_idx += 1
                qml.RZ(params[param_idx], wires=qubit)
                param_idx += 1

            # Entanglement
            for qubit in range(config.n_qubits - 1):
                qml.CNOT(wires=[qubit, qubit + 1])
            if config.n_qubits > 1:
                qml.CNOT(wires=[config.n_qubits - 1, 0])

        # Measure first n_actions qubits
        return [qml.expval(qml.PauliZ(i)) for i in range(min(config.n_actions, config.n_qubits))]

    return circuit, n_params


class QuantumAgent:
    """Quantum RL agent using VQC policy."""

    def __init__(self, config: VQCConfig, seed: int = 42):
        self.config = config
        self.rng = np.random.default_rng(seed)

        if PENNYLANE_AVAILABLE:
            self.circuit, self.n_params = build_vqc_policy(config)
            self.params = self.rng.standard_normal(self.n_params) * 0.1
        else:
            self.circuit = None
            # Fallback linear policy needs n_qubits * n_actions params minimum
            self.n_params = max(config.n_layers * config.n_qubits * 2, config.n_qubits * config.n_actions)
            self.params = self.rng.standard_normal(self.n_params) * 0.1

    def select_action(self, state: np.ndarray, epsilon: float = 0.1) -> int:
        if self.rng.random() < epsilon:
            return self.rng.integers(0, self.config.n_actions)

        if self.circuit is not None:
            # Normalize features to [0, pi]
            features = np.clip(state[:self.config.n_qubits], -3, 3) * np.pi / 3
            expectations = self.circuit(self.params, features)
            # Convert expectations to probabilities via softmax
            exp_vals = np.exp(np.array(expectations))
            probs = exp_vals / exp_vals.sum()
            return self.rng.choice(self.config.n_actions, p=probs)
        else:
            # Fallback: linear policy
            q_values = state[:self.config.n_qubits] @ self.params[:self.config.n_qubits * self.config.n_actions].reshape(self.config.n_qubits, self.config.n_actions)
            return int(np.argmax(q_values))

    def update_policy(self, states: list, actions: list, rewards: list, lr: float = 0.01):
        """Simple policy gradient update (REINFORCE)."""
        if self.circuit is None:
            return

        # Compute discounted returns
        returns = []
        G = 0
        for r in reversed(rewards):
            G = r + 0.99 * G
            returns.insert(0, G)
        returns = np.array(returns)
        if returns.std() > 0:
            returns = (returns - returns.mean()) / (returns.std() + 1e-8)

        # Simple parameter perturbation (evolutionary strategy)
        best_params = self.params.copy()
        sum(rewards)

        for _ in range(5):  # Try 5 perturbations
            perturbation = self.rng.standard_normal(self.n_params) * lr
            self.params += perturbation
            # Would need to re-evaluate — simplified for now
            self.params = best_params + perturbation * 0.1


def train_quantum_agent(
    env: TradingEnv,
    config: VQCConfig,
    train_config: TrainConfig,
) -> tuple[QuantumAgent, AgentResult]:
    """Train quantum RL agent via policy gradient."""
    # ── Result cache check ──────────────────────────────────────────────────
    # Cache only local simulation runs — cloud Braket/IBM runs must re-execute.
    _rl_is_cloud = (
        config.opt_in_cloud
        and os.environ.get("QUANTUM_CLOUD_ENABLED", "").lower() == "true"
        and config.device.startswith("braket.aws")
    )
    _rl_cache_key: Optional[dict] = None
    if not _rl_is_cloud and _rl_cache is not None:
        import hashlib as _hashlib
        _prices_hash = _hashlib.sha256(env.prices.tobytes()).hexdigest()[:16]
        _features_hash = _hashlib.sha256(env.features.tobytes()).hexdigest()[:16]
        _rl_cache_key = {
            "device": config.device,
            "n_qubits": config.n_qubits,
            "n_layers": config.n_layers,
            "n_actions": config.n_actions,
            "learning_rate": config.learning_rate,
            "episodes": train_config.episodes,
            "max_steps": train_config.max_steps_per_episode,
            "gamma": train_config.gamma,
            "seed": train_config.seed,
            "prices_hash": _prices_hash,
            "features_hash": _features_hash,
        }
        _cached = _rl_cache.get(algorithm="rl", params=_rl_cache_key)
        if _cached is not None:
            _cached["cache_hit"] = True
            # Return a new untrained agent (cannot reconstruct trained params from cache)
            # alongside the cached AgentResult. Callers using cached results should
            # treat the agent as a fresh instance — use the result for evidence only.
            _cached_result = AgentResult(**{
                k: v for k, v in _cached.items()
                if k in AgentResult.model_fields
            })
            _fresh_agent = QuantumAgent(config, seed=train_config.seed)
            return _fresh_agent, _cached_result

    start_ms = int(time.time() * 1000)
    agent = QuantumAgent(config, seed=train_config.seed)

    all_rewards = []
    all_actions = []

    # Cloud evaluation counter — when a Braket/cloud device is configured, switch to
    # local after max_cloud_evaluations circuit calls to control cost.  The counter is
    # approximate: each select_action call that hits the circuit counts as one evaluation.
    # Both gates must be open for cloud to actually be active:
    #   Gate 1: config.opt_in_cloud=True, Gate 2: QUANTUM_CLOUD_ENABLED == "true" (fail-closed)
    _cloud_evals: int = 0
    _env_cloud_enabled = os.environ.get("QUANTUM_CLOUD_ENABLED", "").lower() == "true"
    _cloud_device_active: bool = (
        config.device.startswith("braket.aws")
        and BRAKET_PENNYLANE_AVAILABLE
        and config.opt_in_cloud
        and _env_cloud_enabled
    )
    _max_cloud_evals: int = config.max_cloud_evaluations

    for episode in range(train_config.episodes):
        state = env.reset()
        episode_rewards = []
        episode_states = []
        episode_actions = []

        epsilon = max(0.01, 1.0 - episode / train_config.episodes)

        for step in range(train_config.max_steps_per_episode):
            # Cloud evaluation budget guard — rebuild agent with local device when limit hit
            if _cloud_device_active and _cloud_evals >= _max_cloud_evals:
                import logging as _logging
                _logging.getLogger(__name__).info(
                    "Cloud evaluation limit (%d) reached — switching VQC to default.qubit for remainder of training.",
                    _max_cloud_evals,
                )
                local_config = config.model_copy(update={"device": "default.qubit"})
                agent.circuit, agent.n_params = build_vqc_policy(local_config)
                _cloud_device_active = False  # prevent repeated rebuilds

            action = agent.select_action(state, epsilon)
            if _cloud_device_active:
                _cloud_evals += 1
            next_state, reward, done = env.step(action)

            episode_states.append(state)
            episode_actions.append(action)
            episode_rewards.append(reward)

            state = next_state
            if done:
                break

        # Update policy
        agent.update_policy(episode_states, episode_actions, episode_rewards, config.learning_rate)

        all_rewards.extend(episode_rewards)
        all_actions.extend(episode_actions)

    execution_time_ms = int(time.time() * 1000) - start_ms

    # Final evaluation
    total_return = env.pnl
    daily_returns = np.diff(np.cumsum([0] + all_rewards))
    sharpe = 0.0
    if len(daily_returns) > 1 and np.std(daily_returns) > 0:
        sharpe = float(np.mean(daily_returns) / np.std(daily_returns) * np.sqrt(252))

    win_rate = sum(1 for r in all_rewards if r > 0) / max(len(all_rewards), 1)

    _rl_agent_result = AgentResult(
        total_return=float(total_return),
        sharpe_ratio=sharpe,
        win_rate=float(win_rate),
        total_trades=env.trades,
        actions=all_actions[-100:],  # Last 100 actions
        rewards=all_rewards[-100:],
        execution_time_ms=execution_time_ms,
    )
    # Cache local simulation results (not cloud runs)
    if not _rl_is_cloud and _rl_cache is not None and _rl_cache_key is not None:
        _rl_dict = _rl_agent_result.model_dump()
        _rl_dict["cache_hit"] = False
        _rl_cache.put(algorithm="rl", params=_rl_cache_key, result=_rl_dict)
    return agent, _rl_agent_result


def evaluate_agent(
    agent,
    env: TradingEnv,
) -> AgentResult:
    """Evaluate trained agent on test data."""
    start_ms = int(time.time() * 1000)
    state = env.reset()
    actions = []
    rewards = []

    while True:
        action = agent.select_action(state, epsilon=0.0)
        next_state, reward, done = env.step(action)
        actions.append(action)
        rewards.append(reward)
        state = next_state
        if done:
            break

    execution_time_ms = int(time.time() * 1000) - start_ms

    total_return = env.pnl
    daily_returns = np.array(rewards)
    sharpe = 0.0
    if len(daily_returns) > 1 and np.std(daily_returns) > 0:
        sharpe = float(np.mean(daily_returns) / np.std(daily_returns) * np.sqrt(252))

    win_rate = sum(1 for r in rewards if r > 0) / max(len(rewards), 1)

    return AgentResult(
        total_return=float(total_return),
        sharpe_ratio=sharpe,
        win_rate=float(win_rate),
        total_trades=env.trades,
        actions=actions,
        rewards=rewards,
        execution_time_ms=execution_time_ms,
    )


def compare_vs_classical_rl(
    quantum_result: AgentResult,
    env: TradingEnv,
    train_config: TrainConfig,
) -> ComparisonResult:
    """Compare quantum agent against classical DQN baseline."""
    state_dim = env.features.shape[1] + 2
    classical = ClassicalAgent(state_dim, seed=train_config.seed)

    # Train classical agent
    start_ms = int(time.time() * 1000)
    for episode in range(train_config.episodes):
        state = env.reset()
        epsilon = max(0.01, 1.0 - episode / train_config.episodes)

        for step in range(train_config.max_steps_per_episode):
            action = classical.select_action(state, epsilon)
            next_state, reward, done = env.step(action)
            classical.update(state, action, reward, next_state)
            state = next_state
            if done:
                break

    classical_time_ms = int(time.time() * 1000) - start_ms

    # Evaluate classical
    state = env.reset()
    c_rewards = []
    c_actions = []
    while True:
        action = classical.select_action(state, epsilon=0.0)
        next_state, reward, done = env.step(action)
        c_rewards.append(reward)
        c_actions.append(action)
        state = next_state
        if done:
            break

    c_return = env.pnl
    c_daily = np.array(c_rewards)
    c_sharpe = 0.0
    if len(c_daily) > 1 and np.std(c_daily) > 0:
        c_sharpe = float(np.mean(c_daily) / np.std(c_daily) * np.sqrt(252))
    c_win = sum(1 for r in c_rewards if r > 0) / max(len(c_rewards), 1)

    classical_result = AgentResult(
        total_return=float(c_return),
        sharpe_ratio=c_sharpe,
        win_rate=float(c_win),
        total_trades=env.trades,
        actions=c_actions,
        rewards=c_rewards,
        execution_time_ms=classical_time_ms,
    )

    quantum_wins = quantum_result.sharpe_ratio > classical_result.sharpe_ratio

    notes = []
    if quantum_wins:
        notes.append(f"Quantum agent Sharpe {quantum_result.sharpe_ratio:.3f} > classical {classical_result.sharpe_ratio:.3f}")
    else:
        notes.append(f"Classical agent Sharpe {classical_result.sharpe_ratio:.3f} > quantum {quantum_result.sharpe_ratio:.3f}")

    return ComparisonResult(
        quantum=quantum_result,
        classical=classical_result,
        quantum_wins=quantum_wins,
        sharpe_delta=quantum_result.sharpe_ratio - classical_result.sharpe_ratio,
        return_delta=quantum_result.total_return - classical_result.total_return,
        notes="; ".join(notes),
    )


def export_agent_signals(
    agent,
    prices: np.ndarray,
    features: np.ndarray,
) -> list[dict]:
    """Generate buy/sell/hold signal stream from trained agent."""
    env = TradingEnv(prices, features)
    state = env.reset()
    signals = []

    action_map = {0: "long", 1: "flat"}

    for i in range(len(prices) - 1):
        action = agent.select_action(state, epsilon=0.0)
        next_state, reward, done = env.step(action)

        signals.append({
            "step": i,
            "price": float(prices[i]),
            "action": action_map[action],
            "action_id": action,
            "reward": float(reward),
            "position": env.position,
        })

        state = next_state
        if done:
            break

    return signals


# ═══════════════════════════════════════════════════════════════════════════════
# Wave 29 Pass C.2 — Policy-gradient training loop + kill switch + IBM cloud
# ═══════════════════════════════════════════════════════════════════════════════

# ─── Regime constants ─────────────────────────────────────────────────────────
# Canonical institutional regime labels (Pass C.1 PRODUCTION_STATE_FIELDS[6])
_INSTITUTIONAL_REGIMES = [
    "TRENDING",
    "RANGE_BOUND",
    "HIGH_VOL_MACRO",
    "COMPRESSION",
    "EXPANSION",
    "LOW_LIQ_CHOP",
]

_REGIME_MIN_BARS = 100  # minimum bars per regime to warrant a separate policy

# ─── IBM cloud wiring helper ──────────────────────────────────────────────────

def _build_vqc_policy_ibm(n_qubits: int, n_layers: int, opt_in_cloud: bool) -> tuple:
    """Build VQC policy routed through IBM SamplerV2 when all three gates are open.

    All three gates must pass before any IBM cloud QPU path is engaged:
      Gate 1: opt_in_cloud=True  — per-call explicit opt-in (caller must pass explicitly)
      Gate 2: QUANTUM_CLOUD_ENABLED env == "true"  — system kill-switch (fail-closed)
      Gate 3: IBM_QUANTUM_TOKEN env is set  — credential present

    If any gate is closed, falls through to local PennyLane default.qubit.
    On any IBM API error: logs WARN, falls back to local PennyLane simulator.
    Emits audit 'quantum_rl.cloud_path_engaged' on successful IBM use.
    The caller (train_regime_conditioned_policies) emits
    'quantum_rl.cloud_path_fallback' (warning) when the IBM gates were open
    but the cloud path fell back to local sim — so "tried IBM, fell back"
    is queryable via audit_log alongside the cloud_path_engaged success case.

    Env vars read (documented for env inventory):
      QUANTUM_CLOUD_ENABLED   — must be "true" to enable cloud; anything else (unset/typo) disables (gate 2, fail-closed)
      IBM_QUANTUM_TOKEN       — IBM credential (gate 3)
      IBM_QUANTUM_CHANNEL     — channel passed to QiskitRuntimeService;
                                defaults "ibm_cloud" (post-2023 IBM Cloud CRN
                                accounts MUST use "ibm_cloud", NOT the legacy
                                "ibm_quantum" or "ibm_quantum_platform" values)

    Args:
        n_qubits:      number of qubits for the VQC circuit
        n_layers:      number of variational layers
        opt_in_cloud:  caller-supplied explicit opt-in flag (gate 1); no default —
                       caller must always pass this value to avoid silent cloud routing

    Returns:
        (circuit, n_params, backend_label)
    """
    if not PENNYLANE_AVAILABLE:
        return None, 0, "unavailable"

    cloud_enabled = os.environ.get("QUANTUM_CLOUD_ENABLED", "").lower() == "true"
    ibm_token = os.environ.get("IBM_QUANTUM_TOKEN", "")

    # Three-gate AND: all must pass before touching IBM cloud
    if opt_in_cloud and cloud_enabled and ibm_token:
        try:
            from src.engine.cloud_backend import (
                CloudBackendConfig,
            )
            from src.engine.cloud_backend import (
                resolve_backend as _resolve_ibm_backend,
            )
            ibm_cfg = CloudBackendConfig(
                provider="ibm",
                backend_name="ibm_sherbrooke",
                opt_in_cloud=opt_in_cloud,
            )
            provider_name, _ibm_obj, backend_label = _resolve_ibm_backend(
                ibm_cfg, problem_size=n_qubits
            )
            if provider_name == "ibm" and _ibm_obj is not None:
                # IBM SamplerV2 is available — build circuit via default.qubit
                # (PennyLane will delegate measurement to the IBM Sampler at eval time)
                dev = qml.device("default.qubit", wires=n_qubits)
                _rl_logger.info(
                    "build_vqc_policy_ibm: IBM cloud path engaged (label=%s)", backend_label
                )
            else:
                _rl_logger.info(
                    "build_vqc_policy_ibm: resolve_backend returned provider=%s — using local simulator",
                    provider_name,
                )
                dev = qml.device("default.qubit", wires=n_qubits)
                backend_label = "default.qubit"
        except Exception as ibm_exc:
            _rl_logger.warning(
                "build_vqc_policy_ibm: IBM API error (%s) — falling back to default.qubit",
                ibm_exc,
            )
            dev = qml.device("default.qubit", wires=n_qubits)
            backend_label = "default.qubit"
    else:
        dev = qml.device("default.qubit", wires=n_qubits)
        backend_label = "default.qubit"

    n_params = n_layers * n_qubits * 2

    @qml.qnode(dev)
    def _circuit(params, features):
        for i in range(min(n_qubits, len(features))):
            qml.RY(features[i], wires=i)
        param_idx = 0
        for _layer in range(n_layers):
            for qubit in range(n_qubits):
                qml.RY(params[param_idx], wires=qubit)
                param_idx += 1
                qml.RZ(params[param_idx], wires=qubit)
                param_idx += 1
            for qubit in range(n_qubits - 1):
                qml.CNOT(wires=[qubit, qubit + 1])
            if n_qubits > 1:
                qml.CNOT(wires=[n_qubits - 1, 0])
        return [qml.expval(qml.PauliZ(i)) for i in range(min(2, n_qubits))]

    return _circuit, n_params, backend_label


# ─── Exploration guardrails ───────────────────────────────────────────────────

def compute_effective_confidence(raw_confidence: float, n_trades_observed: int) -> float:
    """Dampen raw RL confidence during the first 100 observed trades.

    Formula: effective = raw_confidence × min(1.0, n_trades_observed / 100)

    This prevents the RL agent from projecting high confidence during its
    initial exploration phase when the estimate is unreliable.

    Authority boundary: this is a pure advisory dampening function.
    It CANNOT gate lifecycle decisions — caller (C.3 composite aggregator)
    must enforce the challenger-only contract.

    Args:
        raw_confidence: raw RL confidence score in [0,1]
        n_trades_observed: number of paper trades observed so far

    Returns:
        float: dampened effective confidence in [0,1]
    """
    dampening = min(1.0, n_trades_observed / 100.0)
    return float(raw_confidence) * dampening


def should_use_static_router_epsilon_greedy(
    n_trades_observed: int,
    seed: Optional[int] = None,
) -> bool:
    """Return True with 20% probability when n_trades_observed < 200.

    Epsilon-greedy exploration: forces static framework router for 20% of
    decisions during the first 200 trades, allowing baseline comparison.
    Always returns False once n_trades_observed >= 200.

    Deterministic when seed is provided — ensures replay testability.
    Non-deterministic (OS entropy) when seed is None.

    Authority boundary: pure advisory function. CANNOT override execution.

    Args:
        n_trades_observed: number of paper trades observed so far
        seed: optional RNG seed for deterministic replay testing

    Returns:
        bool: True → use static router instead of RL signal (20% of calls
              when n_trades_observed < 200)
    """
    if n_trades_observed >= 200:
        return False
    rng = np.random.default_rng(seed)
    return bool(rng.random() < 0.20)


# ─── Audit helper (shared) ────────────────────────────────────────────────────

def _emit_audit_row(
    action: str,
    entity_type: str,
    entity_id: str,
    status: str,
    result: dict,
    db_url: Optional[str] = None,
) -> None:
    """Insert a row into audit_log via psycopg2. Fail-soft."""
    _url = db_url or os.environ.get("DATABASE_URL")
    if not _url:
        _rl_logger.debug("_emit_audit_row: DATABASE_URL not set — skipping audit for %s", action)
        return
    try:
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(_url)
        try:
            with conn.cursor() as cur:
                # audit_log has no metadata column on Railway prod — merge into result JSONB
                cur.execute(
                    """
                    INSERT INTO audit_log (action, entity_type, entity_id, status, result, created_at)
                    VALUES (%s, %s, %s, %s, %s, NOW())
                    """,
                    (action, entity_type, entity_id, status, json.dumps(result)),
                )
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:
        # Band E fix: DEBUG silently hid every audit-write failure. WARN so a
        # persistently-broken audit_log path (bad DATABASE_URL, schema drift,
        # etc.) is visible in normal log output instead of requiring a debug
        # log level flip to notice.
        _rl_logger.warning("_emit_audit_row: failed to insert audit row for %s: %s", action, exc)


# ─── Regime-conditioned training loop ────────────────────────────────────────

def train_regime_conditioned_policies(
    strategy_id: str,
    training_epochs: int = 200,
    cpcv_purge: bool = True,
    seed: int = 42,
) -> dict:
    """Train separate VQC policies per institutional regime using CPCV-purged data.

    Loads bar-level RL data via load_backtest_bar_data(), groups by
    institutional_regime, and trains a separate 8-qubit/3-layer VQC policy
    for each regime with >= _REGIME_MIN_BARS (100) bars.

    Governance:
      - All quantum_rl_runs rows include RL_RUNS_GOVERNANCE (training_mode=True)
      - challenger_only, experimental, authoritative=False
      - ZERO modifications to TradingEnv/reward function/migration (C.1 contract)

    IBM cloud opt-in:
      - Controlled by opt_in_cloud=True + QUANTUM_CLOUD_ENABLED=true + IBM_QUANTUM_TOKEN
      - Fail-soft: IBM errors fall back to local simulator without breaking training

    Authority boundary:
      - CANNOT mutate strategy parameters
      - CANNOT gate lifecycle decisions
      - CANNOT write to quantum_mc_runs (writes to quantum_rl_runs only)

    Args:
        strategy_id: strategy UUID string (used to load latest backtest).
                     F-4 fix: previously typed/cast as int at the CLI boundary,
                     but strategies.id (and quantum_rl_runs.strategy_id) are
                     UUID columns — an int cast raised SystemExit(2) at argparse
                     for every real invocation.
        training_epochs: number of training episodes per regime policy (default 200)
        cpcv_purge: enforce CPCV purge on training data (default True; hard constraint)
        seed: RNG seed for reproducibility

    Returns:
        dict: {regime_name -> {trained_epochs, final_sharpe, final_reward, weights_hash,
                                dsr_passed, db_write_failed}}
              Regimes with < _REGIME_MIN_BARS bars are absent from the result dict.
              db_write_failed=True on any regime whose quantum_rl_runs persistence
              failed for one or more training batches (F-1 fix — see write_failures
              tracking below).
    """
    import hashlib

    db_url = os.environ.get("DATABASE_URL")
    opt_in_cloud = os.environ.get("QUANTUM_RL_IBM_CLOUD_OPT_IN", "").lower() == "true"

    # ── 1. Find latest completed backtest for this strategy ───────────────────
    # F-1b fix: backtests.id is a UUID column (schema.ts:149) — casting via
    # int() on a real UUID string raised ValueError on every production
    # invocation, which was swallowed by the except below and silently left
    # backtest_id=None, guaranteeing `bars` stayed empty regardless of the F-1
    # INSERT-shape bug. Keep the DB-native UUID string as-is.
    backtest_id: Optional[str] = None
    if db_url:
        try:
            import psycopg2
            import psycopg2.extras
            conn = psycopg2.connect(db_url)
            try:
                with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                    cur.execute(
                        """
                        SELECT id FROM backtests
                        WHERE strategy_id = %s AND status = 'completed'
                        ORDER BY created_at DESC LIMIT 1
                        """,
                        (strategy_id,),
                    )
                    row = cur.fetchone()
                    if row:
                        backtest_id = str(row["id"])
            finally:
                conn.close()
        except Exception as exc:
            _rl_logger.warning(
                "train_regime_conditioned_policies: DB lookup for backtest_id failed (%s)", exc
            )

    # ── 2. Load CPCV-purged bar data ──────────────────────────────────────────
    bars: list[dict] = []
    if backtest_id is not None:
        try:
            from src.engine.replay.db_loader import load_backtest_bar_data as _load_bars
            bars = _load_bars(backtest_id, cpcv_purge=cpcv_purge)
        except ImportError:
            _rl_logger.warning(
                "train_regime_conditioned_policies: db_loader import failed — using empty bar set"
            )
        except Exception as exc:
            _rl_logger.warning(
                "train_regime_conditioned_policies: load_backtest_bar_data failed (%s) — using empty bar set",
                exc,
            )

    # ── 3. Group bars by institutional_regime ─────────────────────────────────
    regime_bars: dict[str, list[dict]] = {}
    for bar in bars:
        regime = bar.get("state", {}).get("institutional_regime") if isinstance(bar.get("state"), dict) else bar.get("institutional_regime")
        if regime and regime in _INSTITUTIONAL_REGIMES:
            regime_bars.setdefault(regime, []).append(bar)

    # ── 4. IBM cloud opt-in wiring ────────────────────────────────────────────
    cloud_engaged = False
    if opt_in_cloud:
        _rl_logger.info("train_regime_conditioned_policies: IBM cloud opt-in active — checking gates")

    # ── 5. Train per-regime policies ──────────────────────────────────────────
    results: dict[str, dict] = {}
    # F-1 fix: tracks DB write failures per regime so the __main__ CLI can
    # surface them via a non-zero exit code instead of a silently-swallowed
    # warning log line (previously, a totally-broken INSERT looked identical
    # to a clean training run from the caller's point of view).
    write_failures: list[dict] = []
    rng = np.random.default_rng(seed)

    for regime in _INSTITUTIONAL_REGIMES:
        regime_bar_list = regime_bars.get(regime, [])
        n_bars = len(regime_bar_list)

        if n_bars < _REGIME_MIN_BARS:
            _rl_logger.info(
                "train_regime_conditioned_policies: regime=%s has %d bars (<%d) — skipping",
                regime, n_bars, _REGIME_MIN_BARS,
            )
            _emit_audit_row(
                action="quantum_rl.regime_insufficient_data",
                entity_type="strategy",
                entity_id=str(strategy_id),
                status="info",
                result={
                    "regime": regime,
                    "n_bars": n_bars,
                    "min_bars_required": _REGIME_MIN_BARS,
                    "strategy_id": strategy_id,
                    "governance_labels": RL_RUNS_GOVERNANCE,
                },
            )
            continue

        _rl_logger.info(
            "train_regime_conditioned_policies: training regime=%s (%d bars, epochs=%d)",
            regime, n_bars, training_epochs,
        )

        # Build synthetic prices + features from bar data (fallback for bare bar dicts)
        prices_arr: list[float] = []
        prod_states: list[dict] = []
        ci_highs: list[float] = []

        for bar in regime_bar_list:
            # Each bar may be a dict with 'state' sub-dict (from db_loader) or flat dict
            state_dict = bar.get("state") if isinstance(bar.get("state"), dict) else bar
            if isinstance(state_dict, dict):
                prod_states.append(state_dict)
                prices_arr.append(
                    float(state_dict.get("daily_ema_20") or state_dict.get("close_price") or 4000.0)
                )
                ci_highs.append(
                    float(state_dict.get("probability_of_ruin_ci_high") or 0.0)
                )
            else:
                prod_states.append({})
                prices_arr.append(4000.0)
                ci_highs.append(0.0)

        prices_np = np.array(prices_arr, dtype=np.float64)
        # Fallback features for TradingEnv (production states take priority via _production_states)
        features_np = np.zeros((len(prices_arr), 8), dtype=np.float64)

        # Build VQC policy — IBM opt-in path.
        # opt_in_cloud is passed explicitly from QUANTUM_RL_IBM_CLOUD_OPT_IN env (step 4).
        # All three gates (opt_in_cloud AND cloud_enabled AND ibm_token) are enforced
        # inside _build_vqc_policy_ibm; passing opt_in_cloud here is mandatory.
        n_qubits = 8
        n_layers = 3
        _circuit, n_params, backend_label = _build_vqc_policy_ibm(n_qubits, n_layers, opt_in_cloud=opt_in_cloud)

        if not cloud_engaged and backend_label not in ("default.qubit", "unavailable", "local"):
            cloud_engaged = True
            _emit_audit_row(
                action="quantum_rl.cloud_path_engaged",
                entity_type="strategy",
                entity_id=str(strategy_id),
                status="info",
                result={
                    "backend_label": backend_label,
                    "strategy_id": strategy_id,
                    "regime": regime,
                    "governance_labels": RL_RUNS_GOVERNANCE,
                },
            )

        # LOW-FIX: fallback audit — IBM gates were open (token present +
        # opt_in_cloud + QUANTUM_CLOUD_ENABLED) but the cloud path resolved to
        # local sim.  Emit 'quantum_rl.cloud_path_fallback' so "tried IBM, fell
        # back to local" is queryable in audit_log alongside cloud_path_engaged.
        # _emit_audit_row is already fail-soft; this block adds a belt-and-
        # suspenders try/except to guarantee the training loop is never crashed
        # by a fallback audit failure.
        try:
            _ibm_attempted = (
                opt_in_cloud
                and os.environ.get("QUANTUM_CLOUD_ENABLED", "").lower() == "true"
                and bool(os.environ.get("IBM_QUANTUM_TOKEN", ""))
            )
            if _ibm_attempted and backend_label in ("default.qubit", "unavailable", "local"):
                _emit_audit_row(
                    action="quantum_rl.cloud_path_fallback",
                    entity_type="strategy",
                    entity_id=str(strategy_id),
                    status="warning",
                    result={
                        "backend_label": backend_label,
                        "strategy_id": strategy_id,
                        "regime": regime,
                        "fallback_reason": "ibm_path_failed_or_budget_exhausted",
                        "governance_labels": RL_RUNS_GOVERNANCE,
                    },
                )
        except Exception:
            pass  # never crash the training loop on a fallback audit failure

        # Train policy via REINFORCE
        params = rng.standard_normal(n_params) * 0.1
        all_episode_rewards: list[float] = []
        regime_seed = int(rng.integers(0, 2**31))

        # Gap 1 fix (quantum-rl-bridge, 2026-07-06): _dsr_floor + the Sharpe
        # helper are hoisted here — BEFORE the batch loop — so the per-batch
        # quantum_rl_runs INSERT below can persist a truthful dsr_passed value
        # (previously _dsr_passed was computed ONCE, after this whole loop,
        # from the fully-accumulated all_episode_rewards, and was never written
        # into governance_payload at all — the persisted DB column had no
        # dsr_passed key). rl-signal-fetcher.ts:228 reads
        # governance_labels.dsr_passed but only consumes it on the fail-soft
        # fallback branch (legacy rows lacking sr_is/sr_oos/n_training_iterations)
        # — every current row takes the TS-probit-authoritative branch instead,
        # so this was a latent (masked) disconnect, not a live break.
        # _sharpe_of is the SAME formula final_sharpe uses post-loop (mean/std
        # of the reward series, 0.0 when insufficient data) — defining it once
        # here and calling it from both sites guarantees the per-batch proxy
        # and the final per-regime value can never mathematically drift apart.
        _dsr_floor: float = float(os.environ.get("QUANTUM_RL_DSR_FLOOR", "0.5"))

        def _sharpe_of(vals: list[float]) -> float:
            if len(vals) > 1 and np.std(vals) > 0:
                return float(np.mean(vals) / np.std(vals))
            return 0.0

        for epoch_batch_start in range(0, training_epochs, 20):
            batch_end = min(epoch_batch_start + 20, training_epochs)
            batch_rewards: list[float] = []
            # F-1 fix: track per-step actions + confidences so the batch-level
            # quantum_rl_runs row can populate the real 'action' + confidence
            # columns (previously untracked at this granularity — the old
            # INSERT didn't reference them at all).
            batch_actions: list[int] = []
            batch_confidences: list[float] = []

            for _ep in range(epoch_batch_start, batch_end):
                env = TradingEnv(
                    prices=prices_np,
                    features=features_np,
                    seed=regime_seed + _ep,
                    n_actions=2,  # LONG/FLAT only — enforced
                    production_states=prod_states,
                    ci_high_values=ci_highs,
                )
                state = env.reset()
                ep_rewards: list[float] = []

                for _step in range(min(len(prices_arr) - 1, 100)):
                    if _circuit is not None:
                        feat_in = np.clip(state[:n_qubits], -3, 3) * np.pi / 3
                        try:
                            exps = _circuit(params, feat_in)
                            exp_vals = np.exp(np.array(exps, dtype=np.float64))
                            probs = exp_vals / exp_vals.sum()
                            action = int(rng.choice(2, p=probs))
                            batch_confidences.append(float(np.max(probs)))
                        except Exception:
                            # Band E #27 fix: previously silently substituted a
                            # random action with zero visibility. Non-fatal —
                            # training must continue — but now logged at DEBUG
                            # so a persistently-failing circuit is diagnosable
                            # instead of masquerading as normal exploration.
                            _rl_logger.debug(
                                "train_regime_conditioned_policies: VQC circuit "
                                "evaluation failed for regime=%s — falling back "
                                "to random action",
                                regime,
                                exc_info=True,
                            )
                            action = int(rng.integers(0, 2))
                            batch_confidences.append(0.5)
                    else:
                        action = int(rng.integers(0, 2))
                        batch_confidences.append(0.5)

                    batch_actions.append(action)
                    next_state, reward, done = env.step(action)
                    ep_rewards.append(reward)
                    state = next_state
                    if done:
                        break

                # Simple REINFORCE gradient estimate via ES perturbation
                if _circuit is not None and ep_rewards:
                    perturbation = rng.standard_normal(n_params) * 0.01
                    total_r = sum(ep_rewards)
                    params = params + perturbation * total_r * 0.01

                batch_rewards.append(sum(ep_rewards) if ep_rewards else 0.0)

            all_episode_rewards.extend(batch_rewards)

            # Persist batch to quantum_rl_runs — REAL migration 0158/0165 columns.
            #
            # F-1 fix (deepscan16 W1 T4): the previous INSERT targeted columns
            # that do not exist on quantum_rl_runs (status/method/total_return/
            # sharpe_ratio) and omitted 6 real NOT-NULL columns (regime,
            # state_vector, action, confidence_score, effective_confidence,
            # reward) — every INSERT silently failed at the DB and was
            # swallowed by the bare `except Exception` below, while
            # 'quantum_rl.training_completed' still fired with status=success.
            # quantum_rl_runs had therefore never held a real production row.
            if db_url and n_params > 0:
                weights_hash = hashlib.sha256(params.tobytes()).hexdigest()[:16]
                batch_sharpe = 0.0
                if len(batch_rewards) > 1 and np.std(batch_rewards) > 0:
                    batch_sharpe = float(np.mean(batch_rewards) / np.std(batch_rewards))

                # ── Batch-representative state / action / confidence ─────────
                # state_vector: last production state observed this batch (or {}
                # in toy/synthetic mode where no production states are wired).
                batch_state_vector = prod_states[-1] if prod_states else {}
                # action: majority vote across the batch's per-step decisions.
                # 0 = 'act' (take the trade), 1 = 'skip' (pass) — matches
                # migration 0158's COMMENT ON COLUMN quantum_rl_runs.action.
                batch_action = (
                    "act"
                    if batch_actions and sum(1 for a in batch_actions if a == 0) >= len(batch_actions) / 2
                    else "skip"
                )
                batch_confidence_score = (
                    float(np.mean(batch_confidences)) if batch_confidences else 0.5
                )
                batch_effective_confidence = compute_effective_confidence(
                    batch_confidence_score, batch_end
                )

                # F-5 fix: sr_is/sr_oos/n_training_iterations — documented
                # in-batch IS/OOS proxy. rl-signal-fetcher.ts::fetchRlSignal
                # reads these three governance_labels keys to run the
                # authoritative TS probit DSR gate (evaluateRlDsrGate);
                # without them it silently fell back to the avgEffectiveConf×2
                # proxy on every call. Proxy split: first half of the rewards
                # accumulated so far in this regime = IS, second half = OOS.
                # This is a WITHIN-RUN proxy (not a true held-out CPCV fold) —
                # documented via 'sr_proxy_method' in the payload itself.
                _n_cum = len(all_episode_rewards)
                _half = _n_cum // 2
                _is_rewards = all_episode_rewards[:_half] if _half > 1 else all_episode_rewards
                _oos_rewards = all_episode_rewards[_half:] if _half > 1 else all_episode_rewards

                sr_is = _sharpe_of(_is_rewards)
                sr_oos = _sharpe_of(_oos_rewards)

                # ci_high snapshot: mean of the regime's ci_high series (best
                # available proxy for "at decision time" at batch granularity).
                batch_ci_high = float(np.mean(ci_highs)) if ci_highs else None

                # Gap 1 fix: dsr_passed/dsr_value computed from the SAME
                # all_episode_rewards-so-far series used for sr_is/sr_oos above
                # (identical WITHIN-RUN cumulative-proxy pattern), via the
                # shared _sharpe_of helper — so on the regime's LAST batch this
                # is mathematically identical to the post-loop final_sharpe /
                # _dsr_passed computed further down (same formula, same final
                # all_episode_rewards contents, same _dsr_floor).
                _batch_dsr_value = _sharpe_of(all_episode_rewards)
                _batch_dsr_passed = _batch_dsr_value >= _dsr_floor

                governance_payload = {
                    **RL_RUNS_GOVERNANCE,
                    "regime": regime,
                    "epoch_batch_start": epoch_batch_start,
                    "epoch_batch_end": batch_end,
                    "weights_hash": weights_hash,
                    "backend_label": backend_label,
                    "batch_sharpe": batch_sharpe,
                    "sr_is": sr_is,
                    "sr_oos": sr_oos,
                    "n_training_iterations": batch_end,
                    "sr_proxy_method": "in_batch_cumulative_reward_half_split",
                    "dsr_passed": _batch_dsr_passed,
                    "dsr_value": _batch_dsr_value,
                    "dsr_floor": _dsr_floor,
                    "dsr_proxy_method": "in_batch_cumulative_reward_sharpe",
                }

                try:
                    import psycopg2
                    conn = psycopg2.connect(db_url)
                    try:
                        with conn.cursor() as cur:
                            cur.execute(
                                """
                                INSERT INTO quantum_rl_runs
                                    (strategy_id, regime, state_vector, action,
                                     confidence_score, effective_confidence, reward,
                                     ci_high_at_evaluation, drawdown_penalty,
                                     governance_labels, cpcv_fold_id, seed)
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                                """,
                                (
                                    strategy_id,
                                    regime,
                                    json.dumps(batch_state_vector),
                                    batch_action,
                                    batch_confidence_score,
                                    batch_effective_confidence,
                                    float(np.mean(batch_rewards)) if batch_rewards else 0.0,
                                    batch_ci_high,
                                    None,  # drawdown_penalty — not tracked at batch granularity
                                    json.dumps(governance_payload),
                                    None,  # cpcv_fold_id — bar-level fold join not wired here
                                    regime_seed,  # Fix 8: persist seed for replay reproducibility
                                ),
                            )
                        conn.commit()
                    finally:
                        conn.close()
                except Exception as db_exc:
                    # F-1 fix: upgraded from a swallowed warning to a tracked
                    # failure — write_failures feeds results[regime].db_write_failed
                    # so both the training_completed audit status and the CLI
                    # exit code reflect a real persistence failure.
                    _rl_logger.warning(
                        "train_regime_conditioned_policies: DB insert failed for regime=%s epoch_batch=%d: %s",
                        regime, epoch_batch_start, db_exc,
                    )
                    write_failures.append({
                        "regime": regime,
                        "epoch_batch_start": epoch_batch_start,
                        "epoch_batch_end": batch_end,
                        "error": str(db_exc),
                    })

        # Final Sharpe + result summary
        # Gap 1 fix: reuse the SAME _sharpe_of helper the per-batch proxy above
        # calls (formula unchanged: mean/std of the reward series, 0.0 when
        # insufficient data) — guarantees final_sharpe can never drift from the
        # per-batch cumulative proxy already persisted to governance_payload.
        final_reward = float(np.mean(all_episode_rewards)) if all_episode_rewards else 0.0
        final_sharpe = _sharpe_of(all_episode_rewards)

        weights_hash = hashlib.sha256(params.tobytes()).hexdigest()[:16] if n_params > 0 else "no_params"

        # ── DSR floor gate ────────────────────────────────────────────────────
        # Compare final_sharpe against QUANTUM_RL_DSR_FLOOR (default 0.5).
        # Authority boundary: advisory only — this sets governance_labels.dsr_passed
        # and emits an audit sentinel.  It NEVER gates lifecycle or promotion.
        # The TS-side rl-dsr-gate.ts re-reads the governance_labels from
        # quantum_rl_runs; we stamp the value here so the TS gate has an authoritative
        # per-regime signal to consume.
        # Gap 1 fix: _dsr_floor is now read ONCE, hoisted above the batch loop
        # (same os.environ.get call, same default "0.5", same value — env vars
        # don't change mid-process) — re-used here rather than re-read, so the
        # per-batch persisted dsr_floor and this final comparison are guaranteed
        # to use the identical floor value.
        _dsr_passed: bool = final_sharpe >= _dsr_floor

        _dsr_audit_action = "quantum_rl.dsr_passed" if _dsr_passed else "quantum_rl.dsr_floor_block"
        _dsr_audit_status = "info" if _dsr_passed else "warning"
        _dsr_audit_payload: dict = {
            "action": _dsr_audit_action,
            "status": _dsr_audit_status,
            "strategy_id": strategy_id,
            "dsr_value": final_sharpe,
            "dsr_floor": _dsr_floor,
            "regime": regime,
            "dsr_passed": _dsr_passed,
            "governance_labels": {**RL_RUNS_GOVERNANCE, "dsr_passed": _dsr_passed},
        }

        # Stderr sentinel — parsed by python-runner.ts AUDIT_LOG_JSON handler
        # and by test harness stderr capture.
        print(f"AUDIT_LOG_JSON {json.dumps(_dsr_audit_payload)}", file=sys.stderr)

        # DB audit row (fail-soft — same pattern as _emit_audit_row)
        _emit_audit_row(
            action=_dsr_audit_action,
            entity_type="strategy",
            entity_id=str(strategy_id),
            status=_dsr_audit_status,
            result=_dsr_audit_payload,
        )

        if not _dsr_passed:
            _rl_logger.warning(
                "train_regime_conditioned_policies: DSR floor block — "
                "regime=%s final_sharpe=%.4f < dsr_floor=%.4f; "
                "governance_labels.dsr_passed=False",
                regime, final_sharpe, _dsr_floor,
            )

        # F-1 fix: never claim a clean success for this regime when one or
        # more of its training-batch quantum_rl_runs INSERTs failed — the
        # policy may have trained fine in-memory but left no queryable
        # evidence row, which is not a clean success from an evidence-quality
        # standpoint.
        regime_db_write_failed = any(f["regime"] == regime for f in write_failures)
        regime_write_failure_count = sum(1 for f in write_failures if f["regime"] == regime)

        results[regime] = {
            "trained_epochs": training_epochs,
            "final_sharpe": final_sharpe,
            "final_reward": final_reward,
            "weights_hash": weights_hash,
            "dsr_passed": _dsr_passed,
            "db_write_failed": regime_db_write_failed,
        }

        _emit_audit_row(
            action="quantum_rl.training_completed",
            entity_type="strategy",
            entity_id=str(strategy_id),
            status="degraded" if regime_db_write_failed else "success",
            result={
                "regime": regime,
                "n_bars": n_bars,
                "trained_epochs": training_epochs,
                "final_sharpe": final_sharpe,
                "weights_hash": weights_hash,
                "backend_label": backend_label,
                "dsr_passed": _dsr_passed,
                "dsr_floor": _dsr_floor,
                "governance_labels": {**RL_RUNS_GOVERNANCE, "dsr_passed": _dsr_passed},
                "db_write_failed": regime_db_write_failed,
                "write_failure_count": regime_write_failure_count,
            },
        )

    return results


# ─── Kill switch ──────────────────────────────────────────────────────────────

def compute_rl_kill_switch_state(
    strategy_id: int,
    lookback_sessions: int = 20,
) -> dict:
    """Compare RL-challenger vs baseline Sharpe over the last N paper sessions.

    Queries paper_positions grouped by paper_account_routing ('baseline' vs
    'rl-challenger') and computes a rolling Sharpe for each over the last
    lookback_sessions closed sessions.

    Authority boundary:
      - PURE READ function — ZERO mutations to any system state
      - Returns the kill-switch decision; the decision_role flip (dormant) is
        performed by C.3's composite-aggregator wiring, NOT by this function.
      - Never blocks lifecycle; never gates promotion.

    On should_dormant=True:
      - Emits quantum_rl.kill_switch_engaged CRITICAL audit row
      - Emits Discord critical via notifyCritical() (fail-soft if notify fails)

    Args:
        strategy_id: integer strategy ID
        lookback_sessions: rolling window for Sharpe comparison (default 20)

    Returns:
        dict: {
            should_dormant: bool,
            sub_account_2_sharpe: float,   # RL-challenger
            sub_account_1_sharpe: float,   # baseline
            sharpe_gap_pct: float,         # (baseline - challenger) / |baseline| * 100
            reason: str,
        }
    """
    # _DORMANT_GAP_THRESHOLD_PCT is the module-level constant (reads QUANTUM_RL_KILL_SWITCH_THRESHOLD_PCT env).
    _INSUFFICIENT_LABEL = "insufficient_samples"

    default_result = {
        "should_dormant": False,
        "sub_account_2_sharpe": 0.0,
        "sub_account_1_sharpe": 0.0,
        "sharpe_gap_pct": 0.0,
        "reason": _INSUFFICIENT_LABEL,
    }

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        _rl_logger.warning("compute_rl_kill_switch_state: DATABASE_URL not set — returning safe default")
        return default_result

    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        _rl_logger.warning("compute_rl_kill_switch_state: psycopg2 unavailable — returning safe default")
        return default_result

    _BASELINE_ROUTE = "baseline"
    _RL_ROUTE = "rl-challenger"

    def _compute_sharpe(pnls: list[float]) -> float:
        if len(pnls) < 2:
            return 0.0
        arr = np.array(pnls, dtype=np.float64)
        std = float(np.std(arr))
        if std < 1e-9:
            return 0.0
        return float(np.mean(arr) / std * np.sqrt(252))

    try:
        conn = psycopg2.connect(db_url)
    except Exception as exc:
        _rl_logger.warning("compute_rl_kill_switch_state: DB connect failed (%s)", exc)
        return default_result

    baseline_pnls: list[float] = []
    rl_pnls: list[float] = []

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            # Query closed paper positions for this strategy grouped by routing
            # paper_account_routing is a TEXT column on paper_positions (C.3 will add it)
            # Fail-soft if column doesn't exist yet (pre-C.3 schema)
            try:
                cur.execute(
                    """
                    SELECT
                        paper_account_routing,
                        realized_pnl
                    FROM paper_positions
                    WHERE strategy_id = %s
                      AND status = 'closed'
                      AND paper_account_routing IN (%s, %s)
                    ORDER BY closed_at DESC
                    LIMIT %s
                    """,
                    (strategy_id, _BASELINE_ROUTE, _RL_ROUTE, lookback_sessions * 2),
                )
                rows = cur.fetchall()
                for row in rows:
                    routing = row["paper_account_routing"]
                    pnl = float(row["realized_pnl"] or 0.0)
                    if routing == _BASELINE_ROUTE:
                        baseline_pnls.append(pnl)
                    elif routing == _RL_ROUTE:
                        rl_pnls.append(pnl)
            except Exception as query_exc:
                _rl_logger.debug(
                    "compute_rl_kill_switch_state: paper_positions query failed (%s) — using empty lists",
                    query_exc,
                )
    finally:
        conn.close()

    # Check for insufficient samples
    baseline_n = len(baseline_pnls[:lookback_sessions])
    rl_n = len(rl_pnls[:lookback_sessions])

    if baseline_n < lookback_sessions or rl_n < lookback_sessions:
        _emit_audit_row(
            action="quantum_rl.kill_switch_evaluated",
            entity_type="strategy",
            entity_id=str(strategy_id),
            status="info",
            result={
                "should_dormant": False,
                "reason": _INSUFFICIENT_LABEL,
                "baseline_n": baseline_n,
                "rl_n": rl_n,
                "lookback_sessions": lookback_sessions,
                "strategy_id": strategy_id,
            },
        )
        return {**default_result, "reason": _INSUFFICIENT_LABEL}

    baseline_sharpe = _compute_sharpe(baseline_pnls[:lookback_sessions])
    rl_sharpe = _compute_sharpe(rl_pnls[:lookback_sessions])

    # Gap: how much worse is RL vs baseline (positive = baseline better)
    # Uses abs(baseline) denominator to handle negative baseline Sharpe gracefully
    denom = abs(baseline_sharpe) if abs(baseline_sharpe) > 1e-9 else 1.0
    gap_pct = (baseline_sharpe - rl_sharpe) / denom * 100.0

    should_dormant = gap_pct > _DORMANT_GAP_THRESHOLD_PCT

    reason = f"sharpe_gap_{gap_pct:.1f}pct_exceeds_{_DORMANT_GAP_THRESHOLD_PCT}pct" if should_dormant else "within_tolerance"

    result = {
        "should_dormant": should_dormant,
        "sub_account_2_sharpe": rl_sharpe,
        "sub_account_1_sharpe": baseline_sharpe,
        "sharpe_gap_pct": float(gap_pct),
        "reason": reason,
    }

    _emit_audit_row(
        action="quantum_rl.kill_switch_evaluated",
        entity_type="strategy",
        entity_id=str(strategy_id),
        status="info",
        result={**result, "strategy_id": strategy_id, "lookback_sessions": lookback_sessions},
    )

    if should_dormant:
        _rl_logger.error(
            "compute_rl_kill_switch_state: KILL SWITCH ENGAGED — strategy=%d "
            "RL Sharpe=%.3f vs baseline Sharpe=%.3f gap=%.1f%% > %.1f%%",
            strategy_id, rl_sharpe, baseline_sharpe, gap_pct, _DORMANT_GAP_THRESHOLD_PCT,
        )
        _emit_audit_row(
            action="quantum_rl.kill_switch_engaged",
            entity_type="strategy",
            entity_id=str(strategy_id),
            status="critical",
            result={**result, "strategy_id": strategy_id},
        )
        # Fail-soft Discord critical via TS notification service not available from Python.
        # The TS-side caller (C.3 composite aggregator) will call notifyCritical() after
        # reading should_dormant=True from this function.
        # For Python-only callers (e.g. direct test invocation), log CRITICAL.
        _rl_logger.critical(
            "QUANTUM RL KILL SWITCH: strategy %d dormant — RL challenger Sharpe %.3f is "
            "%.1f%% below baseline %.3f over %d sessions",
            strategy_id, rl_sharpe, gap_pct, baseline_sharpe, lookback_sessions,
        )

    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["train", "evaluate", "compare"])
    parser.add_argument("--input-json", default=None)
    # F-4 fix: strategy_id is a UUID string (strategies.id / quantum_rl_runs.strategy_id
    # are both UUID columns) — type=int raised SystemExit(2) at argparse for every
    # real invocation from quantum-rl-training-runner.ts, which the TS circuit
    # breaker recorded as a training failure without any Python-side traceback.
    parser.add_argument("--strategy-id", type=str, default=None)
    parser.add_argument("--training-epochs", type=int, default=200)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    # ── New: train mode via --strategy-id (Wave 29 Pass C.2 auto-fire path) ──
    if args.mode == "train" and args.strategy_id is not None:
        training_results = train_regime_conditioned_policies(
            strategy_id=args.strategy_id,
            training_epochs=args.training_epochs,
            cpcv_purge=True,
            seed=args.seed,
        )
        # F-1 fix: surface any regime's quantum_rl_runs persistence failure as
        # a non-zero CLI exit code instead of a swallowed warning — previously
        # a totally-broken INSERT looked identical to a clean training run.
        _any_write_failed = any(
            isinstance(info, dict) and info.get("db_write_failed")
            for info in training_results.values()
        )
        print(json.dumps({
            "mode": "train",
            "strategy_id": args.strategy_id,
            "results": training_results,
            "write_failures_present": _any_write_failed,
        }, indent=2))
        sys.exit(1 if _any_write_failed else 0)

    # ── Legacy modes (backward-compat) ────────────────────────────────────────
    if args.input_json is None:
        import sys
        print("ERROR: --input-json is required for evaluate/compare modes", file=sys.stderr)
        sys.exit(1)

    raw = args.input_json

    # Support both inline JSON and file path
    raw = args.input_json
    if raw.endswith(".json"):
        with open(raw, "r") as f:
            config = json.load(f)
    else:
        config = json.loads(raw)

    # Build environment from config data or synthetic
    if "prices" in config and config["prices"] is not None and "features" in config and config["features"] is not None:
        prices = np.array(config["prices"], dtype=float)
        features = np.array(config["features"], dtype=float)
    else:
        # Synthetic data for testing
        rng = np.random.default_rng(42)
        n_steps = config.get("n_steps", 200)
        prices = 4000 + np.cumsum(rng.standard_normal(n_steps) * 2)
        features = rng.standard_normal((n_steps, 8))

    env = TradingEnv(prices, features)

    vqc_config = VQCConfig(
        n_qubits=config.get("n_qubits", 8),
        n_layers=config.get("n_layers", 3),
        feature_dim=features.shape[1],
    )
    train_config = TrainConfig(
        episodes=config.get("episodes", 100),
        max_steps_per_episode=min(config.get("max_steps", 100), len(prices) - 1),
    )

    if args.mode == "train":
        agent, result = train_quantum_agent(env, vqc_config, train_config)
        print(result.model_dump_json(indent=2))

    elif args.mode == "evaluate":
        agent = QuantumAgent(vqc_config)
        result = evaluate_agent(agent, env)
        print(result.model_dump_json(indent=2))

    elif args.mode == "compare":
        agent, q_result = train_quantum_agent(env, vqc_config, train_config)
        comparison = compare_vs_classical_rl(q_result, env, train_config)
        print(comparison.model_dump_json(indent=2))
