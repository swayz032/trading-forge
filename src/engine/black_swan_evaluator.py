"""Trading Forge — A14 Synthetic Black Swan Evaluator (W19, Pass 2B).

Given a strategy config + N regime records (each containing a synthetic OHLCV
Polars DataFrame), runs the existing backtester against every regime and
computes a survival score.

Design constraints:
  - DO NOT modify backtester.py — only call into run_backtest().
  - Pure function design: evaluate_strategy() is side-effect-free
    (no DB writes, no S3 writes, no hidden state).
  - Futures P&L is computed by the backtester itself (not passed to vectorbt).
    This module only reads max_drawdown from the backtest result dict.
  - Survival rule (strict less-than, consistent with CLAUDE.md perf gates):
    survived = max_drawdown_dollars < prop_firm_cap_dollars
    Drawdown exactly at cap = NOT survived (prop firm would breach you).
  - Per-regime backtester errors count as failed (not survived), never abort
    the full evaluation.
  - Empty regime list → ValueError with clear message.

CLI invocation (via runPythonModule from TypeScript):
    python -m src.engine.black_swan_evaluator
    Input JSON from stdin:
    {
        "strategy_id": "uuid",
        "backtest_id": "uuid",
        "regime_count": 1000,
        "prop_firm_cap_dollars": 2000
    }
    Output JSON to stdout:
    {
        "num_regimes_tested": 1000,
        "num_regimes_survived": 743,
        "survival_rate": 0.743,
        "worst_regime": {"id": "...", "drawdown": 3812.0, "label": "rate_shock"},
        "worst_k": [...],
        "generator_model_version": "v1.0-2026-05-04"
    }

Database interaction:
    This module does NOT connect to the database directly. The TS service layer
    (synthetic-black-swan-service.ts, Pass 3) owns all DB reads/writes.
    When invoked from the CLI, this module fetches regime metadata and OHLCV
    Parquet from S3 via the same DuckDB/httpfs pattern as data_loader.py.

S3 fetch path:
    Each RegimeRecord carries an s3_path field (from the synthetic_regime_bank
    row). This module reads those Parquet files directly via DuckDB/httpfs using
    the same singleton connection as data_loader.py. S3 credentials come from
    the same environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
    AWS_REGION).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import polars as pl

# ─── Backtester import — DO NOT modify backtester.py ──────────────────────────
# run_backtest() accepts `data: Optional[pl.DataFrame]` as a clean injection
# point. Passing data= bypasses load_ohlcv() entirely. This is the canonical
# injection pattern — no monkey-patching required.
#
# For archetype strategies (entry_indicator='archetype:<key>'), we call
# run_class_backtest() instead — which is the class-based equivalent.
from src.engine.backtester import run_backtest, run_class_backtest
from src.engine.config import (
    BacktestRequest,
    IndicatorConfig,
    PositionSizeConfig,
    StopConfig,
    StrategyConfig,
)

# ─── Archetype → Python class path map ───────────────────────────────────────
# Maps archetype key (from entry_indicator='archetype:<key>') to dotted
# Python module path for _load_strategy_class().
# Maintained in sync with ARCHETYPE_PINE_RECIPE in pine_compiler.py.
# Only keys that have a corresponding Python class in src/engine/strategies/
# are listed. Keys without a Python class fall through to DSL fallback.
_ARCHETYPE_TO_CLASS_PATH: dict[str, str] = {
    # ICT time-window archetypes
    "ict_silver_bullet_ny_am":       "src.engine.strategies.silver_bullet.SilverBulletStrategy",
    "ict_silver_bullet_london":      "src.engine.strategies.silver_bullet.SilverBulletStrategy",
    "ict_silver_bullet_ny_pm":       "src.engine.strategies.silver_bullet.SilverBulletStrategy",
    "ict_judas_swing":               "src.engine.strategies.judas_swing.JudasSwingStrategy",
    "ict_ny_lunch_reversal":         "src.engine.strategies.ny_lunch_reversal.NYLunchReversalStrategy",
    "ict_midnight_open":             "src.engine.strategies.midnight_open.MidnightOpenStrategy",
    "ict_london_raid":               "src.engine.strategies.london_raid.LondonRaidStrategy",
    "ict_turtle_soup":               "src.engine.strategies.turtle_soup.TurtleSoupStrategy",
    "ict_ote":                       "src.engine.strategies.ote_strategy.OTEStrategy",
    "ict_power_of_3":                "src.engine.strategies.power_of_3.PowerOf3Strategy",
    "ict_unicorn":                   "src.engine.strategies.unicorn.UnicornStrategy",
    "ict_breaker":                   "src.engine.strategies.breaker.BreakerStrategy",
    "ict_mitigation":                "src.engine.strategies.mitigation.MitigationStrategy",
    "ict_iofed":                     "src.engine.strategies.iofed.IOFEDStrategy",
    # SMC + Scalp/Swing
    "smt_reversal":                  "src.engine.strategies.smt_reversal.SMTReversalStrategy",
    "ict_quarterly_swing":           "src.engine.strategies.quarterly_swing.QuarterlySwingStrategy",
    "ict_propulsion":                "src.engine.strategies.propulsion.PropulsionStrategy",
    "ict_eqhl_raid":                 "src.engine.strategies.eqhl_raid.EqhlRaidStrategy",
    "ict_scalp":                     "src.engine.strategies.ict_scalp.ICTScalpStrategy",
    "ict_swing":                     "src.engine.strategies.ict_swing.ICTSwingStrategy",
    "ict_2022":                      "src.engine.strategies.ict_2022.ICT2022Strategy",
    # Short-form aliases (same classes)
    "judas_swing":                   "src.engine.strategies.judas_swing.JudasSwingStrategy",
    "silver_bullet":                 "src.engine.strategies.silver_bullet.SilverBulletStrategy",
    "breaker_block":                 "src.engine.strategies.breaker.BreakerStrategy",
    # Wave 26 archetypes
    "bounce_off_level":              "src.engine.strategies.bounce_off_level.BounceOffLevelStrategy",
    "ict_bias_aligned_continuation": "src.engine.strategies.ict_bias_aligned_continuation.ICTBiasAlignedContinuationStrategy",
    "gann_box_4h_continuation":      "src.engine.strategies.gann_box_4h_continuation.GannBox4HContinuationStrategy",
    # Structural primitives (no Python class yet — fall through to DSL)
    # "break_of_structure": None,
    # "fvg_retrace": None,
}

_KNOWN_DSL_FALLBACK_ARCHETYPES = {
    # These archetype keys have no Python class; evaluator uses generic SMA DSL.
    # They produce a WARN log so they can be audited.
    "break_of_structure",
    "change_of_character",
    "market_structure_shift",
    "cisd",
    "fvg_retrace",
    "fvg",
    "order_block",
    "liquidity_sweep",
    "wyckoff_spring",
    "wyckoff_upthrust",
    "wyckoff_accumulation",
    "wyckoff_distribution",
}

logger = logging.getLogger(__name__)


# ─── Audit helper (mirrors quantum_rl_agent.py::_emit_audit_row) ─────────────


def _emit_audit_row(
    action: str,
    entity_type: str,
    entity_id: str,
    status: str,
    result: dict,
    db_url: Optional[str] = None,
) -> None:
    """Insert a row into audit_log via psycopg2. Fail-soft — never raises.

    Same shape as the established pattern in quantum_rl_agent.py::_emit_audit_row
    (reused deliberately rather than re-invented): audit_log has no metadata
    column on Railway prod, so extra context is merged into the `result` JSONB.
    """
    _url = db_url or os.environ.get("DATABASE_URL")
    if not _url:
        logger.debug("_emit_audit_row: DATABASE_URL not set — skipping audit for %s", action)
        return
    try:
        import psycopg2

        conn = psycopg2.connect(_url)
        try:
            with conn.cursor() as cur:
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
        # WARN (not DEBUG) so a persistently-broken audit_log path is visible
        # in normal log output, matching the quantum_rl_agent.py Band-E fix.
        logger.warning("_emit_audit_row: failed to insert audit row for %s: %s", action, exc)


# ─── Constants ────────────────────────────────────────────────────────────────

# Default prop-firm drawdown cap (tightest firm: Topstep 50K = $2,000)
DEFAULT_PROP_FIRM_CAP_DOLLARS: float = 2000.0

# Top-K worst regimes returned for diagnostics
BLACK_SWAN_TOP_K: int = 10

# Fallback generator model version when regime records have mixed versions
_UNKNOWN_MODEL_VERSION = "unknown"


# ─── Data Structures ──────────────────────────────────────────────────────────


@dataclass
class RegimeRecord:
    """A single synthetic regime from the bank.

    When running in unit tests, pass ohlcv= directly (bypasses S3).
    When running from the CLI, ohlcv is loaded from s3_path via _fetch_ohlcv().
    """
    id: str
    symbol: str
    timeframe: str
    regime_label: str
    s3_path: str
    num_bars: int
    generator_model_version: str
    ohlcv: Optional[pl.DataFrame] = field(default=None, repr=False)


@dataclass
class RegimeSurvivalResult:
    """Per-evaluation survival result. Returned by evaluate_strategy()."""
    num_regimes_tested: int
    num_regimes_survived: int
    survival_rate: float
    worst_regime: Optional[dict[str, Any]]          # {id, drawdown, label}
    worst_k: list[dict[str, Any]]                   # top BLACK_SWAN_TOP_K worst
    generator_model_version: str
    execution_time_ms: int

    def to_json_dict(self) -> dict[str, Any]:
        """Serialize to the plan-specified JSON output contract."""
        return {
            "num_regimes_tested": int(self.num_regimes_tested),
            "num_regimes_survived": int(self.num_regimes_survived),
            "survival_rate": float(self.survival_rate),
            "worst_regime": self.worst_regime,
            "worst_k": [
                {
                    "id": str(e["id"]),
                    "drawdown": float(e["drawdown"]),
                    "label": str(e["label"]),
                }
                for e in self.worst_k
            ],
            "generator_model_version": str(self.generator_model_version),
        }


# ─── Survival Scoring (pure function) ────────────────────────────────────────


def score_survival(drawdown_dollars: float, cap_dollars: float) -> bool:
    """Determine if a strategy survived a regime.

    Survival = max_drawdown_dollars < cap_dollars (strict less-than).
    Hitting exactly the cap is NOT survived — prop firm would breach the account.

    Args:
        drawdown_dollars: The max drawdown in dollars from run_backtest() output.
            Positive value (e.g., 1500 = $1500 lost from peak). Negative
            values (net gain) are clamped to 0.
        cap_dollars: The prop-firm drawdown cap in dollars.

    Returns:
        True if the strategy survived the regime.
    """
    effective_dd = max(0.0, float(drawdown_dollars))
    return effective_dd < float(cap_dollars)


# ─── S3 Fetch Helper ──────────────────────────────────────────────────────────


def _fetch_ohlcv_from_s3(s3_path: str) -> pl.DataFrame:
    """Fetch a synthetic regime's OHLCV Parquet from S3.

    Uses the same DuckDB singleton connection as data_loader.py so we share
    the httpfs configuration and credential setup.

    Args:
        s3_path: Full S3 path, e.g.
            s3://trading-forge-data/futures/MES/synthetic/crash/<uuid>.parquet

    Returns:
        Polars DataFrame with columns: ts_event, open, high, low, close, volume
    """
    # Import here to reuse the singleton DuckDB connection from data_loader
    from src.engine.data_loader import _get_connection

    con = _get_connection()
    sql = f"""
        SELECT ts_event, open, high, low, close, volume
        FROM read_parquet('{s3_path}')
        ORDER BY ts_event
    """
    pdf = con.execute(sql).fetchdf()
    return pl.from_pandas(pdf)


# ─── BacktestRequest builder ───────────────────────────────────────────────────


def _build_backtest_request(
    strategy_config: dict,
    regime: RegimeRecord,
) -> tuple[BacktestRequest, Optional[Any]]:
    """Build a BacktestRequest (and optional strategy instance) from config + regime.

    Archetype routing (A14 gap fix):
        When strategy_config["entry_indicator"] starts with "archetype:", this
        function looks up the archetype key in _ARCHETYPE_TO_CLASS_PATH and
        returns a (BacktestRequest, strategy_instance) tuple.  evaluate_strategy()
        will call run_class_backtest(strategy_instance, data=ohlcv) instead of the
        generic run_backtest(request, data=ohlcv) fallback.

        For archetype keys NOT in _ARCHETYPE_TO_CLASS_PATH (structural primitives
        with no Python class), a WARNING is logged and the generic SMA DSL
        fallback is returned (strategy_instance=None).  This is a known gap,
        logged for future remediation.

    Uses the regime's date range derived from the OHLCV data to set start/end.
    The actual OHLCV is injected via data= in run_backtest, so start/end are
    placeholders — they are only used when data=None triggers load_ohlcv().
    Since we always pass data=, these are never used to fetch real data.

    Args:
        strategy_config: Strategy DSL config dict.
        regime: RegimeRecord with loaded ohlcv.

    Returns:
        (BacktestRequest, strategy_instance_or_None)
        strategy_instance is non-None when archetype routing is active.
    """
    # Extract date range from the ohlcv data for the request fields
    ohlcv = regime.ohlcv
    if ohlcv is not None and len(ohlcv) > 0 and "ts_event" in ohlcv.columns:
        try:
            first_ts = ohlcv["ts_event"][0]
            last_ts = ohlcv["ts_event"][-1]
            # Convert to date string
            if hasattr(first_ts, "date"):
                start_date = str(first_ts.date())
                end_date = str(last_ts.date())
            else:
                start_date = str(first_ts)[:10]
                end_date = str(last_ts)[:10]
        except Exception:
            start_date = "2020-01-01"
            end_date = "2025-12-31"
    else:
        start_date = "2020-01-01"
        end_date = "2025-12-31"

    # Build indicator configs from DSL
    indicator_configs = []
    for ind in strategy_config.get("indicators", []):
        kwargs: dict[str, Any] = {"type": ind["type"]}
        if "period" in ind:
            kwargs["period"] = int(ind["period"])
        if "fast" in ind:
            kwargs["fast"] = int(ind["fast"])
        if "slow" in ind:
            kwargs["slow"] = int(ind["slow"])
        if "signal" in ind:
            kwargs["signal"] = int(ind["signal"])
        if "std_dev" in ind:
            kwargs["std_dev"] = float(ind["std_dev"])
        indicator_configs.append(IndicatorConfig(**kwargs))

    # Stop loss config
    sl = strategy_config.get("stop_loss", {})
    stop_loss = StopConfig(
        type=sl.get("type", "atr"),
        multiplier=float(sl.get("multiplier", 2.0)),
    )

    # Take profit config (optional)
    tp_raw = strategy_config.get("take_profit")
    take_profit = None
    if tp_raw:
        take_profit = StopConfig(
            type=tp_raw.get("type", "atr"),
            multiplier=float(tp_raw.get("multiplier", 2.0)),
        )

    # Position size config
    ps = strategy_config.get("position_size", {})
    position_size = PositionSizeConfig(
        type=ps.get("type", "dynamic_atr"),
        target_risk_dollars=float(ps.get("target_risk_dollars", 500.0)),
        fixed_contracts=int(ps.get("fixed_contracts", 1)),
    )

    # ── Archetype routing (A14 gap fix) ──────────────────────────────────────
    # Detect archetype strategies by entry_indicator prefix "archetype:<key>".
    # Route them to their Python class via _ARCHETYPE_TO_CLASS_PATH.
    entry_indicator = strategy_config.get("entry_indicator", "")
    archetype_strategy_instance = None

    if entry_indicator.startswith("archetype:"):
        archetype_key = entry_indicator[len("archetype:"):]
        class_path = _ARCHETYPE_TO_CLASS_PATH.get(archetype_key)

        if class_path is not None:
            # Load and instantiate the Python archetype class
            try:
                from src.engine.backtester import _load_strategy_class
                archetype_strategy_instance = _load_strategy_class(class_path)
                # Wire symbol + timeframe from regime (strategy defaults may differ)
                if hasattr(archetype_strategy_instance, "symbol"):
                    archetype_strategy_instance.symbol = regime.symbol
                if hasattr(archetype_strategy_instance, "timeframe"):
                    archetype_strategy_instance.timeframe = regime.timeframe
                logger.debug(
                    "_build_backtest_request: archetype=%s → class=%s",
                    archetype_key, class_path,
                )
            except Exception as exc:
                logger.warning(
                    "_build_backtest_request: failed to load archetype class %s: %s; "
                    "falling back to DSL SMA placeholder",
                    class_path, exc,
                )
                archetype_strategy_instance = None
        elif archetype_key in _KNOWN_DSL_FALLBACK_ARCHETYPES:
            logger.warning(
                "_build_backtest_request: archetype=%s has no Python class "
                "(structural primitive — no backtestable signals); "
                "using generic SMA DSL fallback. This is a known gap: "
                "results will NOT reflect actual archetype behavior.",
                archetype_key,
            )
        else:
            logger.warning(
                "_build_backtest_request: unrecognized archetype key=%s "
                "(not in _ARCHETYPE_TO_CLASS_PATH and not in _KNOWN_DSL_FALLBACK_ARCHETYPES). "
                "Using generic SMA DSL fallback.",
                archetype_key,
            )

    strategy = StrategyConfig(
        name=strategy_config.get("name", "BlackSwanEval"),
        symbol=regime.symbol,
        timeframe=regime.timeframe,
        indicators=indicator_configs,
        # For archetype strategies, entry_long/entry_short/exit are PLACEHOLDERS.
        # evaluate_strategy() will use run_class_backtest() with archetype_strategy_instance
        # instead — the DSL strings below are never evaluated for archetypes.
        # For DSL strategies, these are the real conditions.
        entry_long=strategy_config.get("entry_long", "close crosses_above sma_10"),
        entry_short=strategy_config.get("entry_short", "close crosses_below sma_10"),
        exit=strategy_config.get("exit", "close crosses_below sma_10"),
        stop_loss=stop_loss,
        take_profit=take_profit,
        position_size=position_size,
        overnight_hold=False,
    )

    return BacktestRequest(
        strategy=strategy,
        start_date=start_date,
        end_date=end_date,
        commission_per_side=float(strategy_config.get("commission_per_side", 0.62)),
        slippage_ticks=float(strategy_config.get("slippage_ticks", 1.0)),
    ), archetype_strategy_instance


# ─── Core Evaluator (pure function) ──────────────────────────────────────────


def evaluate_strategy(
    strategy_config: dict,
    regime_records: list[RegimeRecord],
    prop_firm_cap_dollars: float = DEFAULT_PROP_FIRM_CAP_DOLLARS,
) -> RegimeSurvivalResult:
    """Run a strategy against N synthetic regimes and compute survival score.

    This is a pure function: given identical inputs it always produces identical
    outputs. No DB writes, no S3 writes, no hidden state.

    The existing backtester is called via run_backtest(request, data=regime_ohlcv)
    — the clean injection point that bypasses load_ohlcv(). Fill model,
    execution semantics, slippage, and prop-firm cap behavior are all preserved
    exactly because we do not modify backtester.py.

    Survival rule: max_drawdown < prop_firm_cap_dollars (strict less-than).
    Hitting exactly the cap = NOT survived.

    Per-regime backtester errors count as failed (not survived) and do not
    abort the full evaluation — the error is logged at WARNING level.

    Args:
        strategy_config: Strategy DSL config dict matching StrategyConfig schema.
        regime_records: List of RegimeRecord objects. Each must have ohlcv loaded
            (either from S3 or directly injected for testing). Must be non-empty.
        prop_firm_cap_dollars: Prop-firm drawdown cap in dollars. Default $2,000
            (tightest firm: Topstep 50K).

    Returns:
        RegimeSurvivalResult with survival_rate, worst_regime, worst_k.

    Raises:
        ValueError: If regime_records is empty.
    """
    if not regime_records:
        raise ValueError(
            "regime_records is empty — cannot evaluate strategy against zero regimes. "
            "Check that the synthetic_regime_bank has passing rows for this symbol/timeframe."
        )

    start_time = time.monotonic()

    # Per-regime results: (regime_id, label, drawdown, survived, error)
    per_regime: list[dict[str, Any]] = []

    generator_model_version = _UNKNOWN_MODEL_VERSION

    for regime in regime_records:
        # Track the most recent non-unknown model version (all regimes should
        # agree, but use the last observed value to be safe).
        if regime.generator_model_version and regime.generator_model_version != _UNKNOWN_MODEL_VERSION:
            generator_model_version = regime.generator_model_version

        # Ensure OHLCV is loaded
        ohlcv = regime.ohlcv
        if ohlcv is None:
            try:
                ohlcv = _fetch_ohlcv_from_s3(regime.s3_path)
            except Exception as exc:
                logger.warning(
                    "black_swan_evaluator: S3 fetch failed for regime %s (%s): %s — "
                    "counting as not survived",
                    regime.id,
                    regime.regime_label,
                    exc,
                )
                per_regime.append({
                    "id": regime.id,
                    "label": regime.regime_label,
                    "drawdown": float("inf"),
                    "survived": False,
                    "error": str(exc),
                })
                continue

        # Build request + optional archetype strategy instance
        try:
            request, archetype_instance = _build_backtest_request(strategy_config, regime)

            # ── Archetype routing (A14 gap fix) ───────────────────────────────
            # When archetype_instance is non-None, use run_class_backtest() —
            # which dispatches through the strategy's compute() method rather
            # than evaluating a generic SMA DSL expression.  This ensures that
            # bounce_off_level, ict_breaker, etc. are tested with their ACTUAL
            # signal logic, not a placeholder "close crosses_above sma_10".
            if archetype_instance is not None:
                result = run_class_backtest(
                    strategy=archetype_instance,
                    start_date=request.start_date,
                    end_date=request.end_date,
                    slippage_ticks=request.slippage_ticks,
                    commission_per_side=request.commission_per_side,
                    data=ohlcv,
                )
            else:
                # DSL strategy path (original): pass data= to bypass load_ohlcv().
                # This is the canonical injection point from backtester.py.
                result = run_backtest(request, data=ohlcv)

            max_dd = float(result.get("max_drawdown", 0.0))
            survived = score_survival(max_dd, prop_firm_cap_dollars)
            per_regime.append({
                "id": regime.id,
                "label": regime.regime_label,
                "drawdown": max_dd,
                "survived": survived,
                "error": None,
            })
        except Exception as exc:
            # Per-regime error: log, count as not survived, continue
            logger.warning(
                "black_swan_evaluator: backtester failed for regime %s (%s): %s — "
                "counting as not survived",
                regime.id,
                regime.regime_label,
                exc,
            )
            per_regime.append({
                "id": regime.id,
                "label": regime.regime_label,
                "drawdown": float("inf"),
                "survived": False,
                "error": str(exc),
            })

    # ─── Aggregate metrics ────────────────────────────────────────
    num_tested = len(per_regime)
    num_survived = sum(1 for r in per_regime if r["survived"])
    survival_rate = round(num_survived / num_tested, 4) if num_tested > 0 else 0.0

    # ─── Worst-K extraction ───────────────────────────────────────
    # Sort by drawdown descending (highest drawdown = worst regime).
    # Exclude inf entries from worst_k (they had errors, not real drawdowns).
    finite_regime_results = [
        r for r in per_regime if r["drawdown"] != float("inf")
    ]
    sorted_by_dd = sorted(finite_regime_results, key=lambda r: r["drawdown"], reverse=True)

    # Include error regimes at the bottom of worst_k with drawdown=-1 as a sentinel
    # so the diagnostics always reflect the full picture.
    error_entries = [
        {
            "id": r["id"],
            "label": r["regime_label"] if "regime_label" in r else r["label"],
            "drawdown": -1.0,
            "error": r.get("error"),
        }
        for r in per_regime if r["drawdown"] == float("inf")
    ]

    # Build worst_k: top-K finite drawdowns + error entries (capped at K total)
    worst_k_raw = sorted_by_dd[:BLACK_SWAN_TOP_K]
    worst_k = [
        {"id": r["id"], "drawdown": float(r["drawdown"]), "label": str(r["label"])}
        for r in worst_k_raw
    ]
    # Append error entries up to remaining K slots
    remaining_slots = BLACK_SWAN_TOP_K - len(worst_k)
    for err in error_entries[:remaining_slots]:
        worst_k.append({
            "id": err["id"],
            "drawdown": err["drawdown"],
            "label": err["label"],
        })

    # ─── Worst regime (single worst) ─────────────────────────────
    worst_regime: Optional[dict[str, Any]] = None
    if worst_k:
        top = worst_k[0]
        worst_regime = {
            "id": top["id"],
            "drawdown": top["drawdown"],
            "label": top["label"],
        }

    wall_ms = int((time.monotonic() - start_time) * 1000)

    return RegimeSurvivalResult(
        num_regimes_tested=num_tested,
        num_regimes_survived=num_survived,
        survival_rate=float(survival_rate),
        worst_regime=worst_regime,
        worst_k=worst_k,
        generator_model_version=generator_model_version,
        execution_time_ms=wall_ms,
    )


# ─── Timeframe Normalization (CRIT-1b fix, 2026-07-17) ───────────────────────
#
# `strategies.timeframe` uses shorthand aliases ("1m", "5m", "15m", "30m",
# "1h", "4h") while `synthetic_regime_bank.timeframe` uses a different
# convention — verified live 2026-07-17 via
#   SELECT DISTINCT timeframe FROM strategies         → {1m,5m,15m,30m,1h,4h}
#   SELECT DISTINCT timeframe FROM synthetic_regime_bank → {5min}  (23 rows)
# A raw string-equality WHERE clause therefore NEVER matches any live
# strategy, so every A14 evaluation silently fell into the "regime bank
# empty/stale" advisory path — 100% of the time, regardless of FIX 1.
#
# Rather than hardcode a single fixed string mapping (which breaks again the
# moment a future ingestion job writes yet another alias, e.g. "1hour" or
# "60min" for an hourly regime), timeframes are canonicalized to a
# comparable "bar duration" — minutes for intraday, or the "daily" sentinel —
# and the DISTINCT timeframe strings actually present in the bank (per
# symbol) are matched against that canonical duration at query time. This
# keeps working regardless of which literal alias a given bank row happens
# to use, as long as its DURATION matches the strategy's declared timeframe.
_TIMEFRAME_DURATION_MINUTES: dict[str, int] = {
    "1m": 1, "1min": 1,
    "5m": 5, "5min": 5,
    "15m": 15, "15min": 15,
    "30m": 30, "30min": 30,
    "1h": 60, "60min": 60, "1hour": 60,
    "4h": 240, "240min": 240, "4hour": 240,
}
_DAILY_TIMEFRAME_ALIASES = {"1d", "1D", "daily"}


def _canonicalize_timeframe(tf: str) -> Optional[object]:
    """Return a comparable canonical form for a timeframe alias string.

    Returns an int (bar duration in minutes) for intraday timeframes, the
    literal string "daily" for daily aliases, or None if the alias is not
    recognized (caller must treat this as "no coverage", never crash).
    """
    if not tf:
        return None
    if tf in _DAILY_TIMEFRAME_ALIASES:
        return "daily"
    return _TIMEFRAME_DURATION_MINUTES.get(tf)


# ─── DB / Regime Bank Query (for CLI mode) ───────────────────────────────────


def _resolve_bank_timeframe(cur, symbol: str, requested_timeframe: str) -> Optional[str]:
    """Find the literal timeframe string used in synthetic_regime_bank that is
    duration-equivalent to `requested_timeframe` for this symbol.

    Args:
        cur: An open psycopg2 DictCursor (caller owns the connection/cursor).
        symbol: Futures symbol to scope the DISTINCT lookup to.
        requested_timeframe: The strategy's declared timeframe alias (e.g. "5m").

    Returns:
        The literal bank timeframe string to use in the sample query (e.g.
        "5min"), or None when the bank has no duration-equivalent coverage
        for this symbol — a legitimate insufficient-data case, NOT a bug.
    """
    target = _canonicalize_timeframe(requested_timeframe)
    if target is None:
        return None

    cur.execute(
        "SELECT DISTINCT timeframe FROM synthetic_regime_bank WHERE symbol = %s",
        (symbol,),
    )
    for row in cur.fetchall():
        candidate = row["timeframe"]
        if _canonicalize_timeframe(candidate) == target:
            return candidate
    return None


def _query_regime_bank(
    symbol: str,
    timeframe: str,
    regime_count: int,
    strategy_id: str = "",
    backtest_id: str = "",
) -> list[RegimeRecord]:
    """Query the synthetic_regime_bank for passing regimes.

    Samples uniformly across regime_labels (not just the most common label).
    Only fetches rows where stylized_fact_passed = true.

    DB connection: uses psycopg2 with DATABASE_URL env var. The Python engine
    does not use Drizzle ORM (Node-only). All DB writes stay in the TS service.
    This function reads only — no inserts, no updates.

    Args:
        symbol: Futures symbol (MES, MNQ, MCL).
        timeframe: Bar timeframe alias as declared on the strategy (e.g. "5m",
            "1h", "daily"). Normalized internally (see _resolve_bank_timeframe)
            against whatever literal alias the bank actually stores for this
            symbol — the bank is verified to use "5min", not "5m".
        regime_count: Number of regimes to sample.
        strategy_id: UUID string used to seed the sample deterministically.
        backtest_id: UUID string used to seed the sample deterministically.

    Returns:
        List of RegimeRecord objects (without ohlcv pre-loaded — loaded lazily
        from S3 during evaluate_strategy).

    Raises:
        ImportError: If psycopg2 is not installed.
        RuntimeError: If DATABASE_URL is not set.
        ValueError: If no passing regimes found for this symbol/timeframe —
            including the case where the bank has zero duration-equivalent
            coverage after normalization (legitimate insufficient-data, the
            caller degrades to the advisory result rather than crashing).

    Determinism note (2026-05-20):
        Previously used bare ORDER BY random() which produced non-deterministic
        samples across identical inputs, making black swan survival rates
        irreproducible.  Fix: call PostgreSQL setseed() with a value derived
        from (strategy_id, backtest_id, regime_count) before each label sample.
        Two consecutive calls with identical arguments now produce identical rows.
    """
    try:
        import psycopg2
        import psycopg2.extras
    except ImportError as e:
        raise ImportError(
            "psycopg2 is required for database access. "
            "Install with: pip install psycopg2-binary"
        ) from e

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise RuntimeError(
            "DATABASE_URL environment variable is not set. "
            "Required for black_swan_evaluator CLI mode."
        )

    # Uniform sampling across regime_labels.
    # Strategy: get all distinct regime_labels for this symbol/timeframe,
    # then sample regime_count / n_labels rows from each label.
    # Remainder rows are filled from the label with the most available regimes.
    sql_labels = """
        SELECT DISTINCT regime_label
        FROM synthetic_regime_bank
        WHERE symbol = %s
          AND timeframe = %s
          AND stylized_fact_passed = true
        ORDER BY regime_label
    """

    sql_sample = """
        SELECT id, symbol, timeframe, regime_label, s3_path, num_bars,
               generator_model_version
        FROM synthetic_regime_bank
        WHERE symbol = %s
          AND timeframe = %s
          AND regime_label = %s
          AND stylized_fact_passed = true
        ORDER BY random()
        LIMIT %s
    """

    # Compute a deterministic Postgres setseed() float in [0, 1) from the
    # combination of (strategy_id, backtest_id, regime_count).  This makes
    # ORDER BY random() reproducible: two calls with identical inputs yield
    # identical samples.  The label index is mixed in so each label draws from
    # a different (but still deterministic) position in the RNG stream.
    _seed_key = f"{strategy_id}:{backtest_id}:{regime_count}"
    _seed_base = int(hashlib.md5(_seed_key.encode()).hexdigest()[:8], 16)

    def _pg_seed_for_label(label_idx: int) -> float:
        """Return a Postgres-compatible setseed float in (-1, 1] for this label."""
        mixed = (_seed_base + label_idx * 31337) % 10000
        return mixed / 10000.0  # in [0, 1) — Postgres setseed accepts [-1, 1]

    records: list[RegimeRecord] = []

    try:
        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                # CRIT-1b fix (2026-07-17): resolve the strategy's shorthand
                # timeframe alias (e.g. "5m") to whatever literal string the
                # bank actually stores for this symbol (verified live: "5min").
                # A raw string match against the raw `timeframe` param would
                # find zero labels for every real strategy, unconditionally
                # falling into the advisory path below regardless of FIX 1.
                bank_timeframe = _resolve_bank_timeframe(cur, symbol, timeframe)
                if bank_timeframe is None:
                    raise ValueError(
                        f"No stylized-fact-passing regimes found in synthetic_regime_bank "
                        f"for symbol={symbol!r}, timeframe={timeframe!r} "
                        f"(no duration-equivalent bank coverage for this symbol). "
                        f"Run the synthetic_market_simulator generator first."
                    )

                cur.execute(sql_labels, (symbol, bank_timeframe))
                labels = [row["regime_label"] for row in cur.fetchall()]

                if not labels:
                    raise ValueError(
                        f"No stylized-fact-passing regimes found in synthetic_regime_bank "
                        f"for symbol={symbol!r}, timeframe={timeframe!r} "
                        f"(resolved bank timeframe={bank_timeframe!r}). "
                        f"Run the synthetic_market_simulator generator first."
                    )

                per_label = max(1, regime_count // len(labels))
                # Distribute remainder to the first label
                remainder = regime_count - per_label * len(labels)

                for i, label in enumerate(labels):
                    n_this = per_label + (remainder if i == 0 else 0)
                    # Seed Postgres RNG before the ORDER BY random() query so that
                    # identical inputs always produce identical samples.
                    cur.execute("SELECT setseed(%s)", (_pg_seed_for_label(i),))
                    cur.execute(sql_sample, (symbol, bank_timeframe, label, n_this))
                    rows = cur.fetchall()
                    for row in rows:
                        records.append(RegimeRecord(
                            id=str(row["id"]),
                            symbol=str(row["symbol"]),
                            timeframe=str(row["timeframe"]),
                            regime_label=str(row["regime_label"]),
                            s3_path=str(row["s3_path"]),
                            num_bars=int(row["num_bars"]),
                            generator_model_version=str(row["generator_model_version"]),
                            ohlcv=None,  # lazy-loaded from S3 in evaluate_strategy
                        ))
        finally:
            conn.close()
    except ValueError:
        raise
    except Exception as exc:
        raise RuntimeError(f"Database query failed: {exc}") from exc

    if not records:
        raise ValueError(
            f"No regime records returned after sampling "
            f"(symbol={symbol!r}, timeframe={timeframe!r}, count={regime_count}). "
            f"Bank may be empty or sampling failed."
        )

    return records


def _load_strategy_config_from_db(strategy_id: str) -> tuple[dict, str, str]:
    """Load a strategy's DSL config + resolved (symbol, timeframe).

    CRIT-1a fix (2026-07-17): the previous implementation read
    `strategy_cfg.get("symbol", "MES")` / `.get("timeframe", "daily")` off the
    TOP LEVEL of the `config` JSONB column — but live-DB verification found
    0 of 120 strategies have those top-level keys (`SELECT count(*) FROM
    strategies WHERE config ? 'symbol'` → 0). Every real strategy silently
    fell back to the MES/daily default regardless of its actual market or
    timeframe. The real values live on the `strategies.symbol` /
    `strategies.timeframe` DB COLUMNS (verified NOT NULL, always populated).

    Resolution precedence (highest wins):
        1. `strategies.symbol` / `strategies.timeframe` DB columns — the real
           source of truth (confirmed non-null across all live rows).
        2. `config["strategy"]["timeframe"]` / `["symbol"]` nested block —
           matches the resolved DB column on every live row checked, kept as
           a fallback for any row where the DB column is unexpectedly blank.
        3. `config["symbol"]` / `config["timeframe"]` top-level keys — legacy
           fallback; verified 0/120 live rows populate these, kept only for
           forward compatibility with a future writer.
        4. Hardcoded MES/daily default — last resort only, never expected to
           fire on a live row.

    Args:
        strategy_id: UUID string of the strategy.

    Returns:
        (config, symbol, timeframe) — config is the raw 'config' JSONB dict;
        symbol/timeframe are resolved per the precedence above.

    Raises:
        RuntimeError: If strategy not found or DB unavailable.
    """
    try:
        import psycopg2
        import psycopg2.extras
    except ImportError as e:
        raise ImportError(
            "psycopg2 is required for database access."
        ) from e

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL environment variable is not set.")

    sql = """
        SELECT symbol, timeframe, config
        FROM strategies
        WHERE id = %s
        LIMIT 1
    """

    try:
        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(sql, (strategy_id,))
                row = cur.fetchone()
                if row is None:
                    raise RuntimeError(
                        f"Strategy {strategy_id!r} not found in strategies table."
                    )
                config = row["config"]
                if isinstance(config, str):
                    config = json.loads(config)
                if not isinstance(config, dict):
                    config = {}

                nested = config.get("strategy")
                nested = nested if isinstance(nested, dict) else {}

                # Track WHICH precedence tier actually resolved each field —
                # class-prevention fix (2026-07-17, advisor ruling): the CRIT-1a
                # root cause was resolution silently falling through to the
                # hardcoded MES/daily default with zero visibility. Landing the
                # correct precedence order (this wave's fix) is not enough on
                # its own — if a FUTURE row ever has blank DB columns AND blank
                # config.strategy.* AND blank top-level config (e.g. a bad
                # writer, a migration gap, a new strategy source that doesn't
                # populate these fields), that strategy would silently repeat
                # the exact CRIT-1a failure mode with no signal. So the
                # last-resort tier is now LOUD, not silent.
                symbol_source = (
                    "db_column" if row["symbol"]
                    else "nested_config" if nested.get("symbol")
                    else "top_level_config" if config.get("symbol")
                    else "hardcoded_default"
                )
                symbol = (
                    row["symbol"]
                    or nested.get("symbol")
                    or config.get("symbol")
                    or "MES"
                )
                timeframe_source = (
                    "db_column" if row["timeframe"]
                    else "nested_config" if nested.get("timeframe")
                    else "top_level_config" if config.get("timeframe")
                    else "hardcoded_default"
                )
                timeframe = (
                    row["timeframe"]
                    or nested.get("timeframe")
                    or config.get("timeframe")
                    or "daily"
                )

                defaulted_fields = [
                    field
                    for field, source in (
                        ("symbol", symbol_source),
                        ("timeframe", timeframe_source),
                    )
                    if source == "hardcoded_default"
                ]
                if defaulted_fields:
                    logger.warning(
                        "black_swan_evaluator: strategy %s resolved %s via the "
                        "HARDCODED LAST-RESORT default — strategies.symbol/"
                        "timeframe DB columns, config.strategy.*, AND top-level "
                        "config were all blank. This is the exact silent-degrade "
                        "class that made every real strategy invisibly resolve "
                        "to MES/daily pre-CRIT-1a (2026-07-17). resolved "
                        "symbol=%r (source=%s) timeframe=%r (source=%s)",
                        strategy_id, defaulted_fields, symbol, symbol_source,
                        timeframe, timeframe_source,
                    )
                    _emit_audit_row(
                        action="black_swan.strategy_config_defaulted",
                        entity_type="strategy",
                        entity_id=strategy_id,
                        status="warning",
                        result={
                            "defaulted_fields": defaulted_fields,
                            "resolved_symbol": str(symbol),
                            "resolved_timeframe": str(timeframe),
                            "symbol_source": symbol_source,
                            "timeframe_source": timeframe_source,
                        },
                        db_url=db_url,
                    )

                return config, str(symbol), str(timeframe)
        finally:
            conn.close()
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"Strategy config load failed: {exc}") from exc


# ─── CLI Entry Point ──────────────────────────────────────────────────────────


if __name__ == "__main__":
    """CLI entry point for synthetic-black-swan-service.ts subprocess calls.

    Input JSON (stdin or argv[1] file path):
    {
        "strategy_id": "uuid",
        "backtest_id": "uuid",
        "regime_count": 1000,
        "prop_firm_cap_dollars": 2000
    }

    Output JSON to stdout (plan spec):
    {
        "num_regimes_tested": 1000,
        "num_regimes_survived": 743,
        "survival_rate": 0.743,
        "worst_regime": {"id": "...", "drawdown": 3812.0, "label": "rate_shock"},
        "worst_k": [...],
        "generator_model_version": "v1.0-2026-05-04"
    }

    Errors are emitted to stderr; stdout always contains valid JSON.
    On fatal error: exit code 1, stdout contains {"error": "...message..."}.
    """
    # Enable determinism before any numpy/polars imports
    try:
        from src.engine.determinism import enable_determinism
        enable_determinism()
    except ImportError:
        pass

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stderr,
    )

    try:
        # Read input config
        if len(sys.argv) > 1:
            with open(sys.argv[1]) as f:
                cli_config = json.load(f)
        else:
            cli_config = json.load(sys.stdin)

        strategy_id = cli_config.get("strategy_id")
        backtest_id = cli_config.get("backtest_id")
        regime_count = int(cli_config.get("regime_count", 1000))
        prop_firm_cap = float(cli_config.get("prop_firm_cap_dollars", DEFAULT_PROP_FIRM_CAP_DOLLARS))

        if not strategy_id:
            raise ValueError("strategy_id is required in input config")
        if not backtest_id:
            raise ValueError("backtest_id is required in input config")

        logger.info(
            "black_swan_evaluator: starting — strategy=%s backtest=%s regimes=%d cap=$%.0f",
            strategy_id, backtest_id, regime_count, prop_firm_cap,
        )

        # 1. Load strategy config + resolved symbol/timeframe from DB
        #    (CRIT-1a fix: symbol/timeframe now resolved from the strategies
        #    DB columns, not the config JSONB top level — see
        #    _load_strategy_config_from_db docstring for the precedence and
        #    the live-DB verification that motivated the change).
        strategy_cfg, symbol, timeframe = _load_strategy_config_from_db(strategy_id)

        # 2. Query regime bank (strategy_id + backtest_id seed deterministic sampling).
        # F-1 (2026-05-20): NEMO→A14→bank pipeline is structurally disconnected —
        # nemo_scenario_designer.py produces scenarios in-memory but no DB insert path
        # populates synthetic_regime_bank. Safe degradation: if the bank is empty or
        # stale (>90 days since last insert), return advisory mode instead of crashing.
        # TODO (NEMO wiring): wire populate_regime_bank_from_nemo() as a cron that:
        #   1. calls NeMoScenarioDesigner.design_scenarios()
        #   2. passes each scenario through nemo_a14_bridge.translate()
        #   3. invokes synthetic_market_simulator.py in generate mode
        #   4. inserts resulting OHLCV Parquet paths into synthetic_regime_bank
        # Until that cron exists, the bank stays empty and this gate is advisory.
        try:
            regime_records = _query_regime_bank(
                symbol, timeframe, regime_count,
                strategy_id=strategy_id,
                backtest_id=backtest_id,
            )
        except ValueError as bank_err:
            # Bank is empty or has no stylized-fact-passing rows for this symbol/tf.
            logger.warning(
                "black_swan_evaluator: regime bank empty/stale for %s %s — returning advisory result. "
                "Wire NEMO→A14→bank cron to populate. Error: %s",
                symbol, timeframe, bank_err,
            )
            advisory_result = {
                "num_regimes_tested": 0,
                "num_regimes_survived": 0,
                "survival_rate": None,
                "worst_regime": None,
                "worst_k": [],
                "generator_model_version": _UNKNOWN_MODEL_VERSION,
                "advisory": True,
                "gate_passed": None,
                "reason": "regime_bank_stale_or_empty",
            }
            print(json.dumps(advisory_result))
            sys.exit(0)

        logger.info(
            "black_swan_evaluator: loaded %d regime records for %s %s",
            len(regime_records), symbol, timeframe,
        )

        # 3. Evaluate
        result = evaluate_strategy(
            strategy_config=strategy_cfg,
            regime_records=regime_records,
            prop_firm_cap_dollars=prop_firm_cap,
        )

        logger.info(
            "black_swan_evaluator: done — tested=%d survived=%d rate=%.4f time=%dms",
            result.num_regimes_tested,
            result.num_regimes_survived,
            result.survival_rate,
            result.execution_time_ms,
        )

        # 4. Output JSON contract to stdout
        print(json.dumps(result.to_json_dict()))

    except Exception as exc:
        logger.error("black_swan_evaluator: fatal error: %s", exc, exc_info=True)
        error_output = {
            "num_regimes_tested": 0,
            "num_regimes_survived": 0,
            "survival_rate": 0.0,
            "worst_regime": None,
            "worst_k": [],
            "generator_model_version": _UNKNOWN_MODEL_VERSION,
            "error": str(exc),
        }
        print(json.dumps(error_output))
        sys.exit(1)
