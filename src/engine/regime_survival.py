"""
Harsh-regime survival auto-test for Wave 23 promotion gates.

Runs a strategy through 4 fixed historical stress regimes. Returns per-regime
expectancy_R, PF, Sharpe, and a composite verdict.

PHASE STATE: SOFT advisory in Phase 0 — does NOT block promotion.
When 90 days of paper activation data have accumulated (W24 cron flips the
REGIME_SURVIVAL_PHASE env var to "hard"), each failing regime will block TESTING→PAPER.

DESIGN CONSTRAINTS:
- Never pass slippage/fees to vectorbt for futures — P&L computed manually (production mandate).
- Deterministic: same inputs → same outputs; no nondeterministic sources.
- Fail-closed on data absence: if S3 data is missing for a regime window, that regime is
  flagged as "data_unavailable" and counted as a failure (conservative).
- Hit-rate-agnostic: gate logic never references win_rate as a threshold.
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# ── Phase control ────────────────────────────────────────────────────────────
# "advisory" = soft, never blocks promotion (Phase 0 default).
# "hard"     = blocks TESTING→PAPER if any regime fails.
# Flipped by W24 cron after 90 days of activation data.
_REGIME_SURVIVAL_PHASE = os.environ.get("REGIME_SURVIVAL_PHASE", "advisory")

# ── Fixed harsh-regime windows ───────────────────────────────────────────────
# These 4 windows represent known stress regimes. They are LOCKED — never adjust
# retroactively. Adding new regimes requires a new named constant + W24+ ticket.
HARSH_REGIMES: list[tuple[str, str, str]] = [
    # (name, start_date, end_date)
    ("covid_2020",           "2020-02-01", "2020-04-30"),
    ("fed_pivot_2022",       "2022-01-01", "2022-06-30"),
    ("yen_carry_2024",       "2024-08-01", "2024-08-31"),
    ("apr_vol_spike_2025",   "2025-04-01", "2025-04-30"),
]

# Per-regime pass criteria (hit-rate-agnostic):
#   expectancy_R >= 0 (positive expectancy, even slightly, is survival)
#   PF >= 1.0 (breakeven or better)
#   min_trades >= 5 (need at least 5 trades to produce a signal)
_MIN_TRADES_PER_REGIME = 5
_MIN_EXPECTANCY_R = 0.0   # Survival = any positive R expectancy in crisis
_MIN_PF = 1.0             # Breakeven or better


def _compute_regime_stats(trades: list[dict]) -> dict:
    """Compute per-regime expectancy_R, PF, and Sharpe from a trade list.

    Args:
        trades: List of trade dicts from run_backtest(). Must contain keys:
            "PnL" (float), "risk_dollars_per_contract" (float), "Size" (float).

    Returns:
        dict with keys: expectancy_r, pf, sharpe (proxy), trade_count, passed, failure_reason.
    """
    if not trades:
        return {
            "expectancy_r": None,
            "pf": None,
            "sharpe": None,
            "trade_count": 0,
            "passed": False,
            "failure_reason": "no_trades",
        }

    pnls = [float(t.get("PnL", 0.0)) for t in trades]
    risks = [
        float(t.get("risk_dollars_per_contract", 0.0)) * float(t.get("Size", 1.0))
        for t in trades
    ]

    trade_count = len(pnls)
    if trade_count < _MIN_TRADES_PER_REGIME:
        return {
            "expectancy_r": None,
            "pf": None,
            "sharpe": None,
            "trade_count": trade_count,
            "passed": False,
            "failure_reason": f"insufficient_trades_{trade_count}_min_{_MIN_TRADES_PER_REGIME}",
        }

    avg_pnl = sum(pnls) / trade_count
    valid_risks = [r for r in risks if r > 0]
    avg_risk = sum(valid_risks) / len(valid_risks) if valid_risks else None

    if avg_risk is None or avg_risk == 0:
        expectancy_r = None
    else:
        expectancy_r = avg_pnl / avg_risk

    # Profit factor
    gross_profit = sum(p for p in pnls if p > 0)
    gross_loss = abs(sum(p for p in pnls if p < 0))
    pf = gross_profit / gross_loss if gross_loss > 0 else float("inf")

    # Sharpe proxy: annualised on per-trade PnL (not calendar-day — regime windows too short)
    try:
        import math
        mean_pnl = avg_pnl
        if trade_count > 1:
            variance = sum((p - mean_pnl) ** 2 for p in pnls) / (trade_count - 1)
            std_pnl = math.sqrt(variance) if variance > 0 else 0.0
            # Annualise assuming 252 trading days × 1.5 trades/day = 378 trades/year
            sharpe_proxy = (mean_pnl / std_pnl) * math.sqrt(378) if std_pnl > 0 else 0.0
        else:
            sharpe_proxy = 0.0
    except Exception:
        sharpe_proxy = 0.0

    # Determine pass/fail (hit-rate-agnostic)
    failure_reasons: list[str] = []
    if expectancy_r is None:
        failure_reasons.append("no_valid_risk_data")
    elif expectancy_r < _MIN_EXPECTANCY_R:
        failure_reasons.append(f"expectancy_r_{expectancy_r:.3f}_below_{_MIN_EXPECTANCY_R}")
    if pf < _MIN_PF:
        failure_reasons.append(f"pf_{pf:.3f}_below_{_MIN_PF}")

    passed = len(failure_reasons) == 0

    return {
        "expectancy_r": round(expectancy_r, 4) if expectancy_r is not None else None,
        "pf": round(pf, 4) if pf != float("inf") else None,
        "sharpe": round(sharpe_proxy, 4),
        "trade_count": trade_count,
        "passed": passed,
        "failure_reason": "; ".join(failure_reasons) if failure_reasons else None,
    }


def run_harsh_regime_survival(
    strategy_config: dict[str, Any],
    run_backtest_fn: Any | None = None,
) -> dict[str, Any]:
    """Run strategy through 4 fixed harsh-regime windows.

    Args:
        strategy_config: Strategy config dict (matches StrategyConfig schema).
            Must include: name, symbol, timeframe, indicators, entry_long, entry_short,
            exit, stop_loss, position_size.
        run_backtest_fn: Callable — the run_backtest() function from backtester.py.
            When None (unit-test mode), uses _mock_run_backtest if injected via
            the REGIME_SURVIVAL_MOCK_FN thread-local (test only). In production, always
            provided by the caller (lifecycle-service via runPythonModule).

    Returns:
        {
            "regimes": {
                "covid_2020": {
                    "expectancy_r": float | None,
                    "pf": float | None,
                    "sharpe": float | None,
                    "trade_count": int,
                    "passed": bool,
                    "failure_reason": str | None,
                    "data_status": "ok" | "data_unavailable"
                },
                ... (4 regimes total)
            },
            "all_passed": bool,
            "regimes_failed": [str],   # names of failing regimes
            "phase": "advisory" | "hard",
            "would_block": bool,       # True only when phase=="hard" AND not all_passed
        }
    """
    if run_backtest_fn is None:
        try:
            from src.engine.backtester import run_backtest as _rb
            run_backtest_fn = _rb
        except ImportError as e:
            logger.error("regime_survival: could not import run_backtest: %s", e)
            return _error_result(f"import_error: {e}")

    regime_results: dict[str, dict] = {}
    regimes_failed: list[str] = []

    for regime_name, start_date, end_date in HARSH_REGIMES:
        try:
            from src.engine.config import BacktestRequest, StrategyConfig

            # Build a BacktestRequest for this regime window.
            # Use single mode — no walk-forward (window too short for 5-fold WF).
            # commission_per_side: MES micro default 0.62 (never passed to vectorbt).
            try:
                strat = StrategyConfig(**strategy_config)
            except Exception as schema_err:
                logger.warning(
                    "regime_survival: StrategyConfig validation failed for %s: %s",
                    regime_name, schema_err,
                )
                regime_results[regime_name] = {
                    "expectancy_r": None,
                    "pf": None,
                    "sharpe": None,
                    "trade_count": 0,
                    "passed": False,
                    "failure_reason": f"strategy_config_invalid: {schema_err}",
                    "data_status": "config_error",
                }
                regimes_failed.append(regime_name)
                continue

            request = BacktestRequest(
                strategy=strat,
                start_date=start_date,
                end_date=end_date,
                mode="single",
                max_trades_per_day=2,
                commission_per_side=0.62,
            )

            bt_result = run_backtest_fn(request)

            trades = bt_result.get("trades", [])
            stats = _compute_regime_stats(trades)
            stats["data_status"] = "ok"
            regime_results[regime_name] = stats

            if not stats["passed"]:
                regimes_failed.append(regime_name)

        except FileNotFoundError as e:
            # S3 data not available for this regime window — fail-closed.
            logger.warning("regime_survival: data unavailable for %s: %s", regime_name, e)
            regime_results[regime_name] = {
                "expectancy_r": None,
                "pf": None,
                "sharpe": None,
                "trade_count": 0,
                "passed": False,
                "failure_reason": f"data_unavailable: {e}",
                "data_status": "data_unavailable",
            }
            regimes_failed.append(regime_name)

        except Exception as exc:
            logger.error(
                "regime_survival: unexpected error for regime %s: %s",
                regime_name, exc, exc_info=True,
            )
            regime_results[regime_name] = {
                "expectancy_r": None,
                "pf": None,
                "sharpe": None,
                "trade_count": 0,
                "passed": False,
                "failure_reason": f"backtest_error: {exc}",
                "data_status": "error",
            }
            regimes_failed.append(regime_name)

    all_passed = len(regimes_failed) == 0
    phase = _REGIME_SURVIVAL_PHASE
    would_block = (phase == "hard") and (not all_passed)

    return {
        "regimes": regime_results,
        "all_passed": all_passed,
        "regimes_failed": regimes_failed,
        "phase": phase,
        "would_block": would_block,
    }


def _error_result(reason: str) -> dict[str, Any]:
    """Return a structured error result when the whole survival run fails to initialize."""
    return {
        "regimes": {},
        "all_passed": False,
        "regimes_failed": [r[0] for r in HARSH_REGIMES],
        "phase": _REGIME_SURVIVAL_PHASE,
        "would_block": _REGIME_SURVIVAL_PHASE == "hard",
        "error": reason,
    }


# ── CLI entry point (invoked by runPythonModule in lifecycle-service.ts) ─────
if __name__ == "__main__":
    import json
    import sys

    # Accept config via --config file path (matches python-runner.ts pattern).
    config_path: str | None = None
    argv = sys.argv[1:]
    for i, arg in enumerate(argv):
        if arg == "--config" and i + 1 < len(argv):
            config_path = argv[i + 1]
            break

    if config_path:
        with open(config_path, encoding="utf-8") as _f:
            _config = json.load(_f)
    else:
        _config = json.load(sys.stdin)

    _action = _config.get("action", "run_harsh_regime_survival")
    _strategy_config = _config.get("strategy_config", {})

    if _action == "run_harsh_regime_survival":
        try:
            from src.engine.backtester import run_backtest as _rb
            _result = run_harsh_regime_survival(_strategy_config, run_backtest_fn=_rb)
        except ImportError as _e:
            _result = _error_result(f"backtester_import_error: {_e}")
    else:
        _result = _error_result(f"unknown_action: {_action}")

    print(json.dumps(_result))
    sys.exit(0)
