"""B15 Parameter Robustness Battery — QuantForgeAnalytics 2026-05-16 institutional spec.

Three metrics test perturbation-fragility, which Optuna plateau variance alone
cannot catch (a strategy can have a narrow Optuna plateau but still be fragile
under real-world slippage and parameter drift):

  SDR (Sharpe Degradation Ratio)  >= 0.85
      avg(perturbed_sharpe) / base_sharpe
      when all numeric params are jittered ±20% independently

  PSI (Parameter Sensitivity Index)  <= 0.05
      avg |Δsharpe| per 1-unit change across each parameter's valid range
      averaged across all numeric params

  RWS (Rolling Window Stability)  <= 0.20
      std-dev of per-6-month-window Sharpe across the full equity curve

Source: docs/research-raw/yt01-99pct-fail.json (QuantForgeAnalytics transcript)
        + Noel T SQX workflow (docs/research-raw/op03.json)

HARD RULE: Never pass slippage/fees to vectorbt for futures.
           Compute P&L manually via run_backtest() which does this correctly.

NOTE: All perturbation runs call src.engine.backtester.run_backtest() directly
      (not via subprocess) to reuse the existing engine without duplication.

FACTOR ABLATION MODE — used to gather evidence before promoting a confluence
factor (e.g. market_structure_aligned from W25.2) to a standalone hard gate.
Run via:
    python -m src.engine.robustness.b15_battery \
        --strategy=<id> --ablation-factor=market_structure_aligned

The ablation runs the full B15 battery TWICE:
  1. with_factor  — factor evaluates normally (standard battery run).
  2. without_factor — factor evaluator stubbed to always-satisfied; its weight
     is kept constant so the confluence score denominator is unchanged and
     comparisons are apples-to-apples.

Delta metrics (with minus without) tell you the marginal edge of the factor.
A factor is deemed statistically meaningful when:
    delta_sharpe > 0.2  AND  delta_pf > 0.1

This is advisory evidence gathering, NOT a hard gate — the gate lives at PAPER
→ DEPLOY_READY (B15 full battery). Factor ablation must be run by the operator
before any confluence factor is promoted to a standalone hard gate.

SMC context (Wave 25 Pass 2 — Inst-8):
    W25.2 published StructureState (BOS/CHoCH/MSS) to bias_state.structure_state
    JSONB. W25.1 consumes this as factor "market_structure_aligned" in
    confluence-score.ts.  SMC structure is practitioner-consensus but not yet
    research-corroborated as a standalone edge (mindmathmoney 2026, chartinglens
    2026, general SMC literature).  Run ablation BEFORE promoting this factor to
    a standalone hard gate.
"""

from __future__ import annotations

import copy
import math
import random
from typing import Any

# ─── Default thresholds per QuantForgeAnalytics 2026-05-16 spec ───────────────
DEFAULT_SDR_THRESHOLD = 0.85
DEFAULT_PSI_THRESHOLD = 0.05
DEFAULT_RWS_THRESHOLD = 0.20

DEFAULT_PARAMS = {
    "sdr_threshold": DEFAULT_SDR_THRESHOLD,
    "psi_threshold": DEFAULT_PSI_THRESHOLD,
    "rws_threshold": DEFAULT_RWS_THRESHOLD,
    "n_perturbations": 20,
    "jitter_pct": 0.20,
    "sweep_points": 5,
    "window_months": 6,
    "seed": 42,
}


# ─── Parameter discovery ──────────────────────────────────────────────────────

def _extract_numeric_params(strategy_dsl: dict) -> dict[str, float]:
    """Extract all numeric leaf values from a strategy DSL dict.

    Descends into nested dicts and lists, collecting (dot-path, value) pairs
    for every int/float found. String, bool, and None fields are skipped.
    """
    result: dict[str, float] = {}

    def _recurse(obj: Any, prefix: str) -> None:
        if isinstance(obj, dict):
            for k, v in obj.items():
                _recurse(v, f"{prefix}.{k}" if prefix else k)
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                _recurse(v, f"{prefix}[{i}]")
        elif isinstance(obj, bool):
            # bool is subclass of int — skip booleans explicitly
            pass
        elif isinstance(obj, (int, float)):
            result[prefix] = float(obj)

    _recurse(strategy_dsl, "")
    return result


def _set_nested(dsl: dict, dotpath: str, value: float) -> None:
    """Set a value at a dotpath in a nested dict, modifying dsl in-place.

    Handles paths like 'strategy.stop_loss.multiplier' and
    'strategy.indicators[0].period'.
    """
    import re
    parts = re.split(r"[.\[]", dotpath)
    parts = [p.rstrip("]") for p in parts if p]

    obj: Any = dsl
    for part in parts[:-1]:
        if isinstance(obj, list):
            idx = int(part)
            obj = obj[idx]
        else:
            obj = obj[part]

    last = parts[-1]
    if isinstance(obj, list):
        obj[int(last)] = value
    else:
        obj[last] = value


def _apply_jitter(
    dsl: dict,
    param_paths: list[str],
    jitter_pct: float,
    rng: random.Random,
) -> tuple[dict, dict[str, float]]:
    """Return a deep-copied DSL with all param_paths jittered by ±jitter_pct.

    Returns (jittered_dsl, {path: new_value}).
    """
    jittered = copy.deepcopy(dsl)
    applied: dict[str, float] = {}

    numeric_orig = _extract_numeric_params(dsl)
    for path in param_paths:
        orig = numeric_orig.get(path)
        if orig is None:
            continue
        factor = 1.0 + rng.uniform(-jitter_pct, jitter_pct)
        new_val = orig * factor
        # Preserve int type for integer params (period, etc.)
        orig_from_dsl = _get_nested(dsl, path)
        if isinstance(orig_from_dsl, int):
            new_val = max(1, round(new_val))
        try:
            _set_nested(jittered, path, new_val)
            applied[path] = new_val
        except (KeyError, IndexError, TypeError):
            # Path no longer navigable after deepcopy — skip
            pass

    return jittered, applied


def _get_nested(dsl: dict, dotpath: str) -> Any:
    """Read a value from a nested dict by dotpath."""
    import re
    parts = re.split(r"[.\[]", dotpath)
    parts = [p.rstrip("]") for p in parts if p]
    obj: Any = dsl
    for part in parts:
        if isinstance(obj, list):
            obj = obj[int(part)]
        else:
            obj = obj[part]
    return obj


# ─── Backtest runner wrapper ──────────────────────────────────────────────────

def _run_backtest_for_dsl(dsl: dict) -> float | None:
    """Run a single backtest for the given DSL and return its Sharpe ratio.

    Returns None if the backtest fails or produces an invalid result.
    Reuses src.engine.backtester.run_backtest() — no engine duplication.
    """
    try:
        from src.engine.backtester import run_backtest
        from src.engine.config import BacktestRequest
        result = run_backtest(BacktestRequest.model_validate(dsl))
        if "error" in result:
            return None
        # Prefer OOS Sharpe from walk-forward; fall back to full-sample Sharpe
        oos = result.get("oos_metrics") or {}
        sharpe = oos.get("sharpe_ratio") or result.get("sharpe_ratio")
        if sharpe is None or not math.isfinite(float(sharpe)):
            return None
        return float(sharpe)
    except Exception:
        return None


# ─── SDR ──────────────────────────────────────────────────────────────────────

def compute_sdr(
    strategy_dsl: dict,
    base_backtest_result: dict,
    n_perturbations: int = 20,
    jitter_pct: float = 0.20,
    seed: int = 42,
) -> dict:
    """Sharpe Degradation Ratio — ±20% parameter jitter battery.

    Args:
        strategy_dsl: Full DSL dict (same shape as BacktestRequest config).
        base_backtest_result: Result dict from the base (un-jittered) backtest.
        n_perturbations: How many independently-jittered perturbation runs.
        jitter_pct: Fraction by which each param is jittered (0.20 = ±20%).
        seed: RNG seed for deterministic jitter.

    Returns:
        {
            sdr: float,                       # avg(perturbed) / base; 0.0 if base <= 0
            base_sharpe: float,
            perturbations: [{params, sharpe}],
            valid_perturbations: int,
            failed_perturbations: int,
        }
    """
    oos = base_backtest_result.get("oos_metrics") or {}
    base_sharpe_raw = oos.get("sharpe_ratio") or base_backtest_result.get("sharpe_ratio") or 0.0
    base_sharpe = float(base_sharpe_raw)

    numeric_params = _extract_numeric_params(strategy_dsl)
    param_paths = list(numeric_params.keys())

    rng = random.Random(seed)
    perturbations: list[dict] = []
    sharpe_values: list[float] = []
    failed = 0

    for _ in range(n_perturbations):
        jittered_dsl, applied_params = _apply_jitter(
            strategy_dsl, param_paths, jitter_pct, rng
        )
        sharpe = _run_backtest_for_dsl(jittered_dsl)
        entry: dict = {"params": applied_params}
        if sharpe is not None:
            entry["sharpe"] = sharpe
            sharpe_values.append(sharpe)
        else:
            entry["sharpe"] = None
            failed += 1
        perturbations.append(entry)

    if not sharpe_values:
        # All runs failed — treat as worst case
        avg_perturbed = 0.0
        sdr = 0.0
    else:
        avg_perturbed = sum(sharpe_values) / len(sharpe_values)
        if base_sharpe > 0:
            sdr = avg_perturbed / base_sharpe
        elif base_sharpe < 0:
            # Negative base Sharpe: ratio inverts meaning — clamp to 0.0
            sdr = 0.0
        else:
            sdr = 1.0  # Zero base — treat as perfectly stable (degenerate case)

    return {
        "sdr": round(sdr, 4),
        "base_sharpe": round(base_sharpe, 4),
        "perturbations": perturbations,
        "valid_perturbations": len(sharpe_values),
        "failed_perturbations": failed,
    }


# ─── PSI ──────────────────────────────────────────────────────────────────────

def compute_psi(
    strategy_dsl: dict,
    base_backtest_result: dict,
    sweep_points: int = 5,
) -> dict:
    """Parameter Sensitivity Index — avg |Δsharpe| per unit change.

    For each numeric param, sweep through sweep_points evenly-spaced values
    across [base * 0.5, base * 1.5] and compute |ΔSharpe| per unit change.
    Average across all params.

    Args:
        strategy_dsl: Full DSL dict.
        base_backtest_result: Base backtest result.
        sweep_points: Number of sweep values per parameter (min 2 for slope).

    Returns:
        {
            psi: float,                          # avg |ΔSharpe| / unit across all params
            by_parameter: {path: avg_abs_delta}, # per-param sensitivity
        }
    """
    sweep_points = max(2, sweep_points)

    numeric_params = _extract_numeric_params(strategy_dsl)

    by_parameter: dict[str, float] = {}

    for path, orig_val in numeric_params.items():
        if orig_val == 0:
            # Cannot sweep around zero meaningfully — skip
            continue

        lo = orig_val * 0.5
        hi = orig_val * 1.5
        step = (hi - lo) / (sweep_points - 1) if sweep_points > 1 else 0

        sweep_sharpes: list[float] = []
        sweep_values: list[float] = []

        orig_from_dsl = _get_nested(strategy_dsl, path)
        for i in range(sweep_points):
            val = lo + i * step
            if isinstance(orig_from_dsl, int):
                val = max(1, round(val))

            modified = copy.deepcopy(strategy_dsl)
            try:
                _set_nested(modified, path, val)
            except (KeyError, IndexError, TypeError):
                continue

            sharpe = _run_backtest_for_dsl(modified)
            if sharpe is not None:
                sweep_sharpes.append(sharpe)
                sweep_values.append(float(val))

        if len(sweep_sharpes) < 2:
            # Not enough data points for this param
            continue

        # Compute |ΔSharpe| / |Δparam| across consecutive sweep points
        abs_slopes: list[float] = []
        for i in range(1, len(sweep_sharpes)):
            d_sharpe = abs(sweep_sharpes[i] - sweep_sharpes[i - 1])
            d_param = abs(sweep_values[i] - sweep_values[i - 1])
            if d_param > 0:
                abs_slopes.append(d_sharpe / d_param)

        if abs_slopes:
            by_parameter[path] = round(sum(abs_slopes) / len(abs_slopes), 6)

    if not by_parameter:
        psi = 0.0
    else:
        psi = sum(by_parameter.values()) / len(by_parameter)

    return {
        "psi": round(psi, 6),
        "by_parameter": by_parameter,
    }


# ─── RWS ──────────────────────────────────────────────────────────────────────

def compute_rws(
    backtest_result: dict,
    window_months: int = 6,
) -> dict:
    """Rolling Window Stability — std-dev of per-window Sharpe.

    Slices the equity curve into consecutive window_months-month windows
    and computes Sharpe per window. Returns the std-dev of those Sharpes.

    Args:
        backtest_result: Backtest result containing equity_curve and/or
                         monthly_returns.
        window_months: Window size in months (default 6).

    Returns:
        {
            rws: float,                    # std-dev of window Sharpes
            monthly_sharpes: [{month, sharpe}],
            window_sharpes: [float],
            n_windows: int,
        }
    """
    # ── Extract monthly returns ───────────────────────────────────────────────
    monthly_returns_raw = backtest_result.get("monthly_returns") or {}

    # monthly_returns can be dict {YYYY-MM: return} or list of floats
    if isinstance(monthly_returns_raw, dict):
        months_sorted = sorted(monthly_returns_raw.keys())
        returns_series = [float(monthly_returns_raw[m]) for m in months_sorted]
        month_keys = months_sorted
    elif isinstance(monthly_returns_raw, list):
        returns_series = [float(x) for x in monthly_returns_raw]
        month_keys = [str(i) for i in range(len(returns_series))]
    else:
        returns_series = []
        month_keys = []

    # Fallback: derive monthly returns from equity_curve if monthly_returns absent
    if not returns_series:
        equity_curve = backtest_result.get("equity_curve") or []
        if isinstance(equity_curve, dict):
            # Could be {date: equity} — flatten to list
            eq_sorted = sorted(equity_curve.items())
            equity_vals = [float(v) for _, v in eq_sorted]
        elif isinstance(equity_curve, list):
            equity_vals = [float(v) for v in equity_curve]
        else:
            equity_vals = []

        if len(equity_vals) >= 2:
            # Approximate monthly returns: chunk into 21-bar "months" (trading days)
            bars_per_month = 21
            # Each return needs both a start and an end observation. With N
            # observations, the final valid end index is N-1.
            n_months = (len(equity_vals) - 1) // bars_per_month
            for i in range(n_months):
                start_eq = equity_vals[i * bars_per_month]
                end_eq = equity_vals[(i + 1) * bars_per_month]
                if start_eq != 0:
                    returns_series.append((end_eq - start_eq) / abs(start_eq))
                else:
                    returns_series.append(0.0)
            month_keys = [str(i) for i in range(len(returns_series))]

    if not returns_series:
        return {
            "rws": 0.0,
            "monthly_sharpes": [],
            "window_sharpes": [],
            "n_windows": 0,
        }

    monthly_sharpes = [
        {"month": month_keys[i], "sharpe": r} for i, r in enumerate(returns_series)
    ]

    # ── Window Sharpe computation ─────────────────────────────────────────────
    n = len(returns_series)
    window_sharpes: list[float] = []

    if n < window_months:
        # Not enough data — single window
        sharpe = _sharpe_from_monthly_returns(returns_series)
        window_sharpes = [sharpe]
    else:
        for start in range(0, n - window_months + 1, window_months):
            window = returns_series[start:start + window_months]
            if len(window) < 2:
                continue
            sharpe = _sharpe_from_monthly_returns(window)
            if math.isfinite(sharpe):
                window_sharpes.append(sharpe)

    if len(window_sharpes) < 2:
        rws = 0.0
    else:
        mean = sum(window_sharpes) / len(window_sharpes)
        variance = sum((s - mean) ** 2 for s in window_sharpes) / (len(window_sharpes) - 1)
        rws = math.sqrt(variance)

    return {
        "rws": round(rws, 4),
        "monthly_sharpes": monthly_sharpes,
        "window_sharpes": [round(s, 4) for s in window_sharpes],
        "n_windows": len(window_sharpes),
    }


def _sharpe_from_monthly_returns(returns: list[float]) -> float:
    """Annualized Sharpe from monthly returns (annualization factor = sqrt(12))."""
    if len(returns) < 2:
        return 0.0
    n = len(returns)
    mean = sum(returns) / n
    variance = sum((r - mean) ** 2 for r in returns) / (n - 1)
    std = math.sqrt(variance) if variance > 0 else 0.0
    if std == 0:
        return 0.0
    return (mean / std) * math.sqrt(12)


# ─── Orchestrator ─────────────────────────────────────────────────────────────

def run_b15_battery(
    strategy_dsl: dict,
    base_backtest_result: dict,
    params: dict | None = None,
) -> dict:
    """Run the full B15 Parameter Robustness Battery.

    Orchestrates SDR + PSI + RWS, evaluates pass/fail per institutional thresholds,
    and returns a single structured result.

    Args:
        strategy_dsl: Full DSL dict (BacktestRequest config shape).
        base_backtest_result: Already-completed base backtest result.
        params: Override dict for any of DEFAULT_PARAMS keys.

    Returns:
        {
            sdr: float,
            psi: float,
            rws: float,
            passed: bool,                 # True only when ALL 3 thresholds met
            thresholds: {sdr, psi, rws},
            failures: [str],              # Human-readable reason per failed metric
            sdr_detail: {...},
            psi_detail: {...},
            rws_detail: {...},
        }
    """
    cfg = {**DEFAULT_PARAMS, **(params or {})}

    sdr_detail = compute_sdr(
        strategy_dsl,
        base_backtest_result,
        n_perturbations=int(cfg["n_perturbations"]),
        jitter_pct=float(cfg["jitter_pct"]),
        seed=int(cfg["seed"]),
    )
    psi_detail = compute_psi(
        strategy_dsl,
        base_backtest_result,
        sweep_points=int(cfg["sweep_points"]),
    )
    rws_detail = compute_rws(
        base_backtest_result,
        window_months=int(cfg["window_months"]),
    )

    sdr = sdr_detail["sdr"]
    psi = psi_detail["psi"]
    rws = rws_detail["rws"]

    thresholds = {
        "sdr": float(cfg["sdr_threshold"]),
        "psi": float(cfg["psi_threshold"]),
        "rws": float(cfg["rws_threshold"]),
    }

    failures: list[str] = []
    if sdr < thresholds["sdr"]:
        failures.append(
            f"SDR {sdr:.4f} < {thresholds['sdr']} — strategy is perturbation-fragile"
        )
    if psi > thresholds["psi"]:
        failures.append(
            f"PSI {psi:.6f} > {thresholds['psi']} — at least one param is hypersensitive"
        )
    if rws > thresholds["rws"]:
        failures.append(
            f"RWS {rws:.4f} > {thresholds['rws']} — rolling window Sharpe is unstable"
        )

    return {
        "sdr": sdr,
        "psi": psi,
        "rws": rws,
        "passed": len(failures) == 0,
        "thresholds": thresholds,
        "failures": failures,
        "sdr_detail": sdr_detail,
        "psi_detail": psi_detail,
        "rws_detail": rws_detail,
    }


# ─── Factor Ablation ──────────────────────────────────────────────────────────

# Significance thresholds for factor marginal edge (advisory; not a hard gate).
# A factor clears the bar when BOTH conditions are met in a real ablation run.
ABLATION_DELTA_SHARPE_THRESHOLD = 0.20
ABLATION_DELTA_PF_THRESHOLD = 0.10


def _extract_pf(backtest_result: dict) -> float:
    """Extract profit factor from a backtest result, preferring OOS metrics."""
    oos = backtest_result.get("oos_metrics") or {}
    pf = oos.get("profit_factor") or backtest_result.get("profit_factor") or 1.0
    try:
        val = float(pf)
    except (TypeError, ValueError):
        val = 1.0
    return val if math.isfinite(val) else 1.0


def _extract_sharpe(backtest_result: dict) -> float:
    """Extract Sharpe from a backtest result, preferring OOS metrics."""
    oos = backtest_result.get("oos_metrics") or {}
    sharpe = oos.get("sharpe_ratio") or backtest_result.get("sharpe_ratio") or 0.0
    try:
        val = float(sharpe)
    except (TypeError, ValueError):
        val = 0.0
    return val if math.isfinite(val) else 0.0


def _extract_max_dd(backtest_result: dict) -> float:
    """Extract max drawdown from a backtest result (positive number = loss depth)."""
    oos = backtest_result.get("oos_metrics") or {}
    dd = oos.get("max_drawdown") or backtest_result.get("max_drawdown") or 0.0
    try:
        val = float(dd)
    except (TypeError, ValueError):
        val = 0.0
    return val if math.isfinite(val) else 0.0


def _build_ablation_metrics(b15_result: dict, base_backtest_result: dict) -> dict:
    """Collect the 5 ablation-reportable metrics from a B15 run."""
    return {
        "sdr": b15_result["sdr"],
        "psi": b15_result["psi"],
        "rws": b15_result["rws"],
        "sharpe": _extract_sharpe(base_backtest_result),
        "pf": _extract_pf(base_backtest_result),
        "max_dd": _extract_max_dd(base_backtest_result),
    }


def run_b15_ablation(
    strategy_dsl: dict,
    base_backtest_result: dict,
    factor_name: str,
    ablated_backtest_result: dict | None = None,
    params: dict | None = None,
) -> dict:
    """Factor-level ablation on top of the B15 battery.

    Runs the full B15 battery TWICE:
      1. with_factor  — standard battery run using base_backtest_result.
      2. without_factor — battery run using ablated_backtest_result, which
         represents performance when the named factor is always treated as
         satisfied (stub returns True, weight unchanged).

    The caller is responsible for producing ablated_backtest_result by running
    the backtest engine with the named factor stubbed. When ablated_backtest_result
    is None, this function raises ValueError (operator must supply both runs).

    Args:
        strategy_dsl:            Full DSL dict.
        base_backtest_result:    Base (factor active) backtest result dict.
        factor_name:             Confluence factor being ablated, e.g.
                                 "market_structure_aligned".
        ablated_backtest_result: Backtest result with factor always-satisfied.
                                 Must be pre-computed externally — this function
                                 does NOT invoke the factor stub itself.
        params:                  Override dict for DEFAULT_PARAMS keys.

    Returns:
        {
            "factor_ablated": str,
            "with_factor": {sdr, psi, rws, sharpe, pf, max_dd},
            "without_factor": {sdr, psi, rws, sharpe, pf, max_dd},
            "delta": {sdr, psi, rws, sharpe, pf, max_dd},
            "marginal_edge_significant": bool,
            "with_factor_b15": <full run_b15_battery result>,
            "without_factor_b15": <full run_b15_battery result>,
        }

    Raises:
        ValueError: When ablated_backtest_result is None (both runs required).
    """
    if ablated_backtest_result is None:
        raise ValueError(
            f"ablated_backtest_result is required for factor ablation of "
            f"'{factor_name}'. Run the backtest engine with the factor stubbed to "
            "always-satisfied and pass that result here."
        )

    # Run B15 battery for both scenarios
    with_b15 = run_b15_battery(strategy_dsl, base_backtest_result, params=params)
    without_b15 = run_b15_battery(strategy_dsl, ablated_backtest_result, params=params)

    with_metrics = _build_ablation_metrics(with_b15, base_backtest_result)
    without_metrics = _build_ablation_metrics(without_b15, ablated_backtest_result)

    # Delta: with_factor − without_factor (positive = factor adds value)
    delta: dict = {}
    for key in with_metrics:
        with_val = with_metrics[key]
        without_val = without_metrics[key]
        try:
            delta[key] = round(float(with_val) - float(without_val), 6)
        except (TypeError, ValueError):
            delta[key] = None

    delta_sharpe = delta.get("sharpe") or 0.0
    delta_pf = delta.get("pf") or 0.0

    marginal_edge_significant = bool(
        delta_sharpe > ABLATION_DELTA_SHARPE_THRESHOLD
        and delta_pf > ABLATION_DELTA_PF_THRESHOLD
    )

    return {
        "factor_ablated": factor_name,
        "with_factor": with_metrics,
        "without_factor": without_metrics,
        "delta": delta,
        "marginal_edge_significant": marginal_edge_significant,
        "with_factor_b15": with_b15,
        "without_factor_b15": without_b15,
    }
