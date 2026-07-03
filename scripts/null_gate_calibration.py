#!/usr/bin/env python3
"""Null-strategy gate calibration harness (Layer 4 research conveyor, item 2).

PURPOSE:
  Measures the gate battery's false-pass rate (noise floor) by running N strategies
  with ZERO predictive content through the EXACT same gates real strategies face.
  A "pass" in the gate battery only has meaning if we know how many null strategies
  would also pass by chance.

WHAT THIS MEASURES:
  The gate battery (WF/CPCV + DSR + PBO + WRC/SPA + B14) is a statistical filter.
  Even under H0 (no edge), some fraction of strategies pass due to:
  - Multiple-testing (15 CPCV paths, each a "trial")
  - DSR's sqrt(2 ln N) correction that may be understated (deepscan9 finding)
  - PBO degenerate path when CPCV IS Sharpes are unavailable (cpcv_is_sharpe_unavailable)
  - WRC/SPA requiring minimum observations that nulls may not meet
  - B14 Monte Carlo with reduced sensitivity at low trade counts

  This script quantifies each gate's false-pass rate empirically.

STANDING RULE (from docs/gate-battery-calibration.md):
  Population-scale passes only count above this floor.
  If 200 strategies are evaluated and the null false-pass rate is 15%, then
  200 × 0.15 = 30 expected chance passes. Only strategies beyond those 30 matter.

USAGE:
  # Smoke test (2-3 nulls, synthetic data, no S3 needed):
  TF_ALLOW_FIXED_1=true python scripts/null_gate_calibration.py --smoke --n 3

  # Full calibration batch (N=100, real S3 data, slow):
  TF_ALLOW_FIXED_1=true python scripts/null_gate_calibration.py --n 100 --seed 42

  # Resume from manifest (skips already-completed nulls):
  TF_ALLOW_FIXED_1=true python scripts/null_gate_calibration.py --n 100 --manifest null_manifest.jsonl

  # Monte Carlo B14 gate (extra compute, ~5min per null):
  TF_ALLOW_FIXED_1=true python scripts/null_gate_calibration.py --n 100 --include-mc

OUTPUTS:
  - null_calibration_report.json   : Per-gate false-pass rates + binomial CI + noise floor
  - null_manifest.jsonl            : Per-null result records (resumable)

MARKER:
  All null runs are tagged with governance_labels["null_calibration"]=True following
  the replay_mode precedent. The guard module validates this before any persistence.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path

# ─── Set required env var early ──────────────────────────────────────────────
# TF_ALLOW_FIXED_1 must be set before importing config.py or BacktestRequest.
if os.environ.get("TF_ALLOW_FIXED_1", "").lower() != "true":
    print(
        "WARNING: TF_ALLOW_FIXED_1 not set. Null strategies use fixed_contracts=1. "
        "Set TF_ALLOW_FIXED_1=true or pass --allow-fixed-1.",
        file=sys.stderr,
    )

import numpy as np

# ─── Gate names and ordering ─────────────────────────────────────────────────

GATE_NAMES = [
    "wf_cpcv_paths",    # At least 1 CPCV path completed (any OOS trades produced)
    "dsr",              # Deflated Sharpe Ratio gate (dsr_pass == True)
    "pbo",              # Probability of Backtest Overfitting (pbo_overall <= 0.5)
    "wrc",              # White's Reality Check (wrc_result.passed)
    "spa",              # Hansen's SPA (spa_result.passed)
    "full_battery",     # All non-MC gates pass simultaneously
    "b14_mc",           # Monte Carlo B14 survival gate (optional, slow)
]


# ─── Binomial CI (Wilson score interval) ─────────────────────────────────────

def wilson_ci(k: int, n: int, confidence: float = 0.95) -> tuple[float, float]:
    """Wilson score confidence interval for a binomial proportion.

    More accurate than Wald (normal approximation) for rare events and small N.
    Returns (lower, upper) bounds for the true false-pass rate p.

    Args:
        k: Number of successes (false passes).
        n: Total trials.
        confidence: Confidence level (default 0.95 = 95% CI).

    Returns:
        (lower, upper) confidence interval bounds in [0, 1].

    Reference: Wilson (1927), score interval for proportion.
    Implementation: does NOT require scipy — pure math.
    """
    if n == 0:
        return (0.0, 1.0)

    # z for confidence level: 1.96 for 95%, 1.645 for 90%
    # Use lookup for common levels; otherwise use approximation.
    _z_map = {0.90: 1.6449, 0.95: 1.9600, 0.99: 2.5758}
    z = _z_map.get(confidence, 1.9600)

    p_hat = k / n
    z2 = z * z
    denominator = 1 + z2 / n

    center = (p_hat + z2 / (2 * n)) / denominator
    margin = (z / denominator) * math.sqrt(
        p_hat * (1 - p_hat) / n + z2 / (4 * n * n)
    )

    lower = max(0.0, center - margin)
    upper = min(1.0, center + margin)
    return (lower, upper)


# ─── Synthetic OHLCV generator (smoke test only, no S3 needed) ───────────────

def _make_synthetic_ohlcv(
    n_days: int = 252,
    symbol: str = "MES",
    bars_per_day: int = 78,   # 5m bars, 09:30–15:55 ET
    seed: int = 0,
):  # returns polars.DataFrame (imported inside body)
    """Generate synthetic OHLCV data for smoke testing.

    Produces a random-walk price series matching the schema of load_ohlcv():
        ts_event (datetime), open, high, low, close, volume

    Timestamps are RTH-like (09:30–15:55 ET zone, 5m bars on weekdays).
    Prices are a random walk centered at 5000 (MES-like).

    Args:
        n_days: Number of trading days to simulate.
        symbol: Symbol name (affects starting price).
        bars_per_day: Bars per trading day (default 78 = 5m RTH).
        seed: RNG seed for reproducibility.

    Returns:
        Polars DataFrame with schema matching load_ohlcv() output.
    """
    import polars as pl

    rng = np.random.default_rng(np.random.PCG64DXSM(seed))

    # Starting prices per symbol
    start_prices = {"MES": 5000.0, "MNQ": 17500.0, "MCL": 75.0}
    start_price = start_prices.get(symbol, 5000.0)

    n_bars = n_days * bars_per_day

    # Random walk: each bar's close = prev close + noise
    increments = rng.normal(0.0, start_price * 0.0002, n_bars)  # 0.02% std/bar
    close_prices = start_price + np.cumsum(increments)
    close_prices = np.maximum(close_prices, start_price * 0.5)  # floor at 50% of start

    # Open = previous close (with small gap noise)
    open_prices = np.empty_like(close_prices)
    open_prices[0] = start_price
    open_prices[1:] = close_prices[:-1] + rng.normal(0, start_price * 0.0001, n_bars - 1)

    # High/low around open-close range
    bar_range = np.abs(close_prices - open_prices) + np.abs(rng.normal(0, start_price * 0.0003, n_bars))
    high_prices = np.maximum(open_prices, close_prices) + bar_range * rng.uniform(0.2, 0.8, n_bars)
    low_prices = np.minimum(open_prices, close_prices) - bar_range * rng.uniform(0.2, 0.8, n_bars)
    low_prices = np.maximum(low_prices, 1.0)

    volume = rng.integers(50, 2000, n_bars).astype(np.float64)

    # Build RTH timestamps: start from 2023-01-03 (first trading day of 2023)
    # 09:30 ET = 14:30 UTC (winter, UTC-5)
    timestamps = []
    dt = datetime(2023, 1, 3, 14, 30, 0)  # 2023-01-03 09:30 ET in UTC
    day_count = 0
    while day_count < n_days:
        for b in range(bars_per_day):
            bar_dt = dt + timedelta(minutes=b * 5)
            timestamps.append(bar_dt)
        # Advance to next weekday
        dt += timedelta(days=1)
        while dt.weekday() >= 5:  # skip Saturday (5) and Sunday (6)
            dt += timedelta(days=1)
        day_count += 1

    timestamps = timestamps[:n_bars]

    df = pl.DataFrame({
        "ts_event": timestamps,
        "open": open_prices.tolist(),
        "high": high_prices.tolist(),
        "low": low_prices.tolist(),
        "close": close_prices.tolist(),
        "volume": volume.tolist(),
    })

    # ts_event as datetime (no timezone; the backtester handles tz internally)
    df = df.with_columns(pl.col("ts_event").cast(pl.Datetime("us")))

    return df


# ─── Battery runner ───────────────────────────────────────────────────────────

def run_battery_for_null(
    spec: dict,
    synthetic_data=None,
    include_mc: bool = False,
    mc_simulations: int = 10_000,
) -> dict:
    """Run the full gate battery against a single null strategy spec.

    Args:
        spec: Null strategy spec from generate_null_spec(). Includes
            _null_calibration_meta key which is used but stripped before
            passing to BacktestRequest.
        synthetic_data: Optional pre-built Polars DataFrame. When provided,
            skips S3 data loading (smoke test path). When None, loads from S3.
        include_mc: Whether to run Monte Carlo (B14 gate). Slow (~5min/null).
        mc_simulations: Number of MC simulations when include_mc=True.

    Returns:
        dict with:
            gate_results: {gate_name: "pass"|"fail"|"skip"|"degenerate"}
            full_battery_pass: bool (all non-MC gates pass)
            b14_pass: bool|None (None when include_mc=False)
            raw_metrics: raw wf_metadata from walk_forward
            null_meta: the _null_calibration_meta from the spec
            elapsed_seconds: float
            error: str|None (if the run failed)
    """
    from src.engine.null_calibration_guard import (
        build_null_calibration_labels,
        validate_null_calibration_labels,
    )

    meta = spec.get("_null_calibration_meta", {})
    null_seed = meta.get("null_seed", 0)
    strategy_index = meta.get("strategy_index", 0)

    # Build governance labels with required marker
    governance_labels = build_null_calibration_labels(
        null_seed=null_seed,
        strategy_index=strategy_index,
        extra={"symbol": meta.get("symbol"), "timeframe": meta.get("timeframe")},
    )
    # Validate before any persistence (fail-closed)
    validate_null_calibration_labels(governance_labels)

    # Strip meta key → clean BacktestRequest dict
    clean_spec = {k: v for k, v in spec.items() if not k.startswith("_")}

    start_t = time.time()
    result = {
        "gate_results": {g: "skip" for g in GATE_NAMES},
        "full_battery_pass": False,
        "b14_pass": None,
        "raw_metrics": {},
        "null_meta": meta,
        "governance_labels": governance_labels,
        "elapsed_seconds": 0.0,
        "error": None,
    }

    try:
        from src.engine.config import BacktestRequest
        request = BacktestRequest.model_validate(clean_spec)

        from src.engine.walk_forward import run_walk_forward
        wf_result = run_walk_forward(
            request,
            data=synthetic_data,
            wf_mode="cpcv",
        )

        wf_meta = wf_result.get("wf_metadata", {})
        oos_metrics = wf_result.get("oos_metrics", {})

        result["raw_metrics"] = {
            "oos_total_trades": oos_metrics.get("total_trades", 0),
            "oos_sharpe": oos_metrics.get("sharpe_ratio"),
            "wf_metadata": wf_meta,
        }

        gate_results = result["gate_results"]

        # Gate 1: WF/CPCV — did any paths complete with trades?
        total_trades = oos_metrics.get("total_trades", 0)
        gate_results["wf_cpcv_paths"] = "pass" if total_trades > 0 else "fail"

        # Gate 2: DSR
        # IMPORTANT: wf_meta["dsr"] is a FLOAT (the test statistic value).
        # The pass flag is at wf_meta["dsr_pass"] (separate top-level key).
        dsr_pass = wf_meta.get("dsr_pass")
        dsr_unavailable = wf_meta.get("dsr_unavailable", False)
        if dsr_pass is None:
            gate_results["dsr"] = "skip" if dsr_unavailable else "degenerate"
        else:
            gate_results["dsr"] = "pass" if bool(dsr_pass) else "fail"

        # Gate 3: PBO
        # pbo_overall is at the TOP LEVEL of wf_result, not inside wf_meta.
        # pbo_degenerate_reason IS inside wf_meta (survives backtest-service persistence).
        pbo_val = wf_result.get("pbo_overall")
        pbo_deg_reason = wf_meta.get("pbo_degenerate_reason")
        if pbo_deg_reason:
            gate_results["pbo"] = "degenerate"
        elif pbo_val is None:
            gate_results["pbo"] = "skip"
        else:
            # PBO > 0.5 → overfit → fail
            gate_results["pbo"] = "pass" if float(pbo_val) <= 0.5 else "fail"

        # Gate 4: WRC — at the TOP LEVEL of wf_result (not inside wf_meta).
        wrc_raw = wf_result.get("wrc_result")
        wrc = wrc_raw if isinstance(wrc_raw, dict) else {}
        if not wrc.get("available", True):
            gate_results["wrc"] = "skip"
        elif wrc.get("passed") is True:
            gate_results["wrc"] = "pass"
        elif wrc.get("passed") is False:
            gate_results["wrc"] = "fail"
        else:
            gate_results["wrc"] = "skip"

        # Gate 5: SPA — at the TOP LEVEL of wf_result (not inside wf_meta).
        spa_raw = wf_result.get("spa_result")
        spa = spa_raw if isinstance(spa_raw, dict) else {}
        if not spa.get("available", True):
            gate_results["spa"] = "skip"
        elif spa.get("passed") is True:
            gate_results["spa"] = "pass"
        elif spa.get("passed") is False:
            gate_results["spa"] = "fail"
        else:
            gate_results["spa"] = "skip"

        # Full battery: all non-MC gates must explicitly pass (not skip/degenerate)
        non_mc_gates = ["wf_cpcv_paths", "dsr", "pbo", "wrc", "spa"]
        full_pass = all(gate_results[g] == "pass" for g in non_mc_gates)
        gate_results["full_battery"] = "pass" if full_pass else "fail"
        result["full_battery_pass"] = full_pass

        # Optional Gate 6: Monte Carlo B14
        if include_mc and total_trades >= 30:
            try:
                trades_pnl = [
                    float(t.get("PnL", t.get("pnl", 0)))
                    for t in wf_result.get("trades", [])
                ]
                daily_pnls = wf_result.get("daily_pnls", [])

                from src.engine.config import MonteCarloRequest
                from src.engine.monte_carlo import run_monte_carlo
                mc_req = MonteCarloRequest(
                    backtest_id=f"null_cal_{strategy_index}_seed{null_seed}",
                    num_simulations=mc_simulations,
                    method="block_bootstrap",
                    firms=["topstep_50k"],
                    seed=null_seed + strategy_index,
                    use_gpu=False,
                    avg_trades_per_day=float(max(total_trades, 1)) / max(len(daily_pnls) / 252, 1),
                )
                equity_curve = list(wf_result.get("equity_bars", wf_result.get("equity_curve", [])))
                mc_result = run_monte_carlo(mc_req, trades_pnl, daily_pnls, equity_curve)

                firm_surv = mc_result.get("firm_survival", {}).get("topstep_50k", {})
                # B14 gate: ci_high >= 0 means funded survival lower bound is non-negative
                ci_high = firm_surv.get("ci_high")
                if ci_high is not None:
                    b14_pass = float(ci_high) >= 0.0
                    gate_results["b14_mc"] = "pass" if b14_pass else "fail"
                    result["b14_pass"] = b14_pass
                else:
                    gate_results["b14_mc"] = "skip"
            except Exception as mc_exc:
                gate_results["b14_mc"] = "skip"
                result["b14_mc_error"] = str(mc_exc)
        elif include_mc:
            gate_results["b14_mc"] = "skip"  # Not enough trades for MC

    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        result["traceback"] = traceback.format_exc()
        for gate in GATE_NAMES:
            result["gate_results"][gate] = "error"
        print(f"  ERROR for null {strategy_index}: {exc}", file=sys.stderr)

    result["elapsed_seconds"] = time.time() - start_t
    return result


# ─── Calibration report ───────────────────────────────────────────────────────

def compute_calibration_report(
    results: list[dict],
    n_population: int = 200,
    confidence: float = 0.95,
) -> dict:
    """Compute the calibration report from collected null run results.

    Computes per-gate false-pass rates with Wilson CI and noise floor projection
    for a population of n_population real strategies.

    Args:
        results: List of dicts from run_battery_for_null().
        n_population: Population size to project noise floor onto (default 200).
        confidence: CI confidence level (default 0.95).

    Returns:
        dict with:
            n_nulls: total null runs
            n_complete: runs without error
            per_gate: {gate_name: {passes, trials, rate, ci_lower, ci_upper, noise_floor_projection}}
            full_battery: {passes, trials, rate, ci_lower, ci_upper, noise_floor_projection}
            b14_mc: {passes, trials, rate, ci_lower, ci_upper, noise_floor_projection}
            degenerate_counts: {gate_name: count of degenerate results}
            skip_counts: {gate_name: count of skipped results}
            noise_floor_note: human-readable interpretation
            generated_at: ISO timestamp
    """
    n_nulls = len(results)
    n_errors = sum(1 for r in results if r.get("error") is not None)
    n_complete = n_nulls - n_errors

    per_gate_stats: dict = {}
    degenerate_counts: dict = {g: 0 for g in GATE_NAMES}
    skip_counts: dict = {g: 0 for g in GATE_NAMES}

    for gate in GATE_NAMES:
        passes = 0
        trials = 0  # Only count non-skip, non-degenerate, non-error results

        for r in results:
            if r.get("error"):
                continue
            val = r["gate_results"].get(gate, "skip")
            if val == "degenerate":
                degenerate_counts[gate] += 1
            elif val == "skip":
                skip_counts[gate] += 1
            elif val in ("pass", "fail"):
                trials += 1
                if val == "pass":
                    passes += 1

        rate = passes / trials if trials > 0 else 0.0
        ci_lo, ci_hi = wilson_ci(passes, trials, confidence)
        noise_floor = rate * n_population
        noise_floor_hi = ci_hi * n_population

        per_gate_stats[gate] = {
            "passes": passes,
            "trials": trials,
            "rate": round(rate, 4),
            f"ci_{int(confidence*100)}_lower": round(ci_lo, 4),
            f"ci_{int(confidence*100)}_upper": round(ci_hi, 4),
            "noise_floor_projection": {
                "population": n_population,
                "expected_chance_passes": round(noise_floor, 1),
                "expected_chance_passes_upper": round(noise_floor_hi, 1),
            },
        }

    # Full battery (combined gates)
    fb_stats = per_gate_stats.get("full_battery", {})

    # Noise floor interpretation
    fb_rate = fb_stats.get("rate", 0.0)
    fb_noise = fb_rate * n_population
    if fb_stats.get("trials", 0) == 0:
        note = "INSUFFICIENT DATA: no null runs produced evaluable full-battery results."
    elif fb_rate < 0.05:
        note = (
            f"Full-battery false-pass rate = {fb_rate:.1%} ({fb_stats['passes']}/{fb_stats['trials']} nulls). "
            f"At N={n_population} strategies: expect {fb_noise:.1f} chance passes. "
            f"Battery is reasonably selective. Passes beyond {math.ceil(fb_noise)} are meaningful."
        )
    elif fb_rate < 0.15:
        note = (
            f"Full-battery false-pass rate = {fb_rate:.1%} ({fb_stats['passes']}/{fb_stats['trials']} nulls). "
            f"At N={n_population} strategies: expect {fb_noise:.1f} chance passes. "
            f"Moderate noise floor. Consider gate tightening before population-scale evaluation."
        )
    else:
        note = (
            f"ELEVATED: Full-battery false-pass rate = {fb_rate:.1%} ({fb_stats['passes']}/{fb_stats['trials']} nulls). "
            f"At N={n_population} strategies: expect {fb_noise:.1f} chance passes. "
            f"Gate battery has low discrimination power. Review DSR n_trials, PBO degenerate handling, "
            f"and WRC/SPA minimum observation requirements before running population-scale evaluation."
        )

    return {
        "n_nulls": n_nulls,
        "n_errors": n_errors,
        "n_complete": n_complete,
        "per_gate": per_gate_stats,
        "full_battery": fb_stats,
        "degenerate_counts": degenerate_counts,
        "skip_counts": skip_counts,
        "ci_confidence": confidence,
        "n_population_projection": n_population,
        "noise_floor_note": note,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "gate_battery_version": "2026-07-02",  # bump when gates change, triggers re-calibration
    }


# ─── Manifest (resumable batch) ───────────────────────────────────────────────

def load_manifest(manifest_path: str) -> dict[int, dict]:
    """Load completed null run records from a JSONL manifest file.

    Returns a dict mapping strategy_index → result record.
    """
    completed: dict[int, dict] = {}
    path = Path(manifest_path)
    if not path.exists():
        return completed

    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                idx = rec.get("null_meta", {}).get("strategy_index")
                if idx is not None:
                    completed[idx] = rec
            except json.JSONDecodeError:
                pass
    return completed


def append_to_manifest(manifest_path: str, result: dict) -> None:
    """Append a single result record to the JSONL manifest."""
    with open(manifest_path, "a", encoding="utf-8") as f:
        # Serialize removing traceback to keep manifest clean
        clean = {k: v for k, v in result.items() if k != "traceback"}
        f.write(json.dumps(clean) + "\n")


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Null-strategy gate calibration harness"
    )
    parser.add_argument("--n", type=int, default=100,
                        help="Number of null strategies to run (default: 100)")
    parser.add_argument("--seed", type=int, default=42,
                        help="Generator seed (default: 42)")
    parser.add_argument("--smoke", action="store_true",
                        help="Smoke test: use synthetic data, run 3 nulls, skip S3")
    parser.add_argument("--n-smoke", type=int, default=3,
                        help="Number of nulls in smoke mode (default: 3)")
    parser.add_argument("--start-date", default="2023-01-01",
                        help="Backtest start date (default: 2023-01-01)")
    parser.add_argument("--end-date", default="2024-12-31",
                        help="Backtest end date (default: 2024-12-31)")
    parser.add_argument("--manifest", default="null_manifest.jsonl",
                        help="Manifest path for resumable batches (default: null_manifest.jsonl)")
    parser.add_argument("--report-out", default="null_calibration_report.json",
                        help="Report output path (default: null_calibration_report.json)")
    parser.add_argument("--allow-fixed-1", action="store_true",
                        help="Set TF_ALLOW_FIXED_1=true (required)")
    parser.add_argument("--include-mc", action="store_true",
                        help="Include Monte Carlo B14 gate (slow, ~5min/null)")
    parser.add_argument("--mc-sims", type=int, default=10_000,
                        help="Monte Carlo simulations when --include-mc (default: 10000)")
    parser.add_argument("--population", type=int, default=200,
                        help="Population size for noise floor projection (default: 200)")
    args = parser.parse_args()

    if args.allow_fixed_1:
        os.environ["TF_ALLOW_FIXED_1"] = "true"

    # Enforce required env var
    if os.environ.get("TF_ALLOW_FIXED_1", "").lower() != "true":
        print(
            "ERROR: TF_ALLOW_FIXED_1=true is required. "
            "Pass --allow-fixed-1 or set the env var.",
            file=sys.stderr,
        )
        sys.exit(1)

    n_nulls = args.n_smoke if args.smoke else args.n

    # Smoke mode setup
    synthetic_data = None
    if args.smoke:
        print(f"SMOKE MODE: generating {n_nulls} nulls with synthetic data", file=sys.stderr)
        # Generate 1 year of synthetic 5m MES data (no S3 needed)
        synthetic_data = _make_synthetic_ohlcv(n_days=252, symbol="MES", seed=args.seed)
        print(f"  Synthetic data: {len(synthetic_data)} bars", file=sys.stderr)

    # Generate null specs
    from scripts.generate_null_strategies import generate_null_specs
    specs = generate_null_specs(
        n=n_nulls,
        seed=args.seed,
        start_date=args.start_date,
        end_date=args.end_date,
        smoke=args.smoke,
    )

    # Load existing manifest (resume)
    completed = load_manifest(args.manifest) if not args.smoke else {}
    print(f"Found {len(completed)} already-completed nulls in manifest", file=sys.stderr)

    all_results = list(completed.values())

    for i, spec in enumerate(specs):
        idx = spec.get("_null_calibration_meta", {}).get("strategy_index", i)

        if idx in completed:
            print(f"  null {idx:04d}: already completed (skipping)", file=sys.stderr)
            continue

        symbol = spec.get("_null_calibration_meta", {}).get("symbol", "?")
        tf = spec.get("_null_calibration_meta", {}).get("timeframe", "?")
        print(f"  null {idx:04d}/{n_nulls-1} ({symbol} {tf})...", file=sys.stderr, end="", flush=True)

        result = run_battery_for_null(
            spec,
            synthetic_data=synthetic_data,
            include_mc=args.include_mc,
            mc_simulations=args.mc_sims,
        )

        elapsed = result.get("elapsed_seconds", 0)
        fb = result.get("full_battery_pass", False)
        err = result.get("error")

        if err:
            print(f" ERROR in {elapsed:.1f}s: {err[:80]}", file=sys.stderr)
        else:
            gates = result.get("gate_results", {})
            gate_summary = " | ".join(
                f"{g}:{v[0].upper()}" for g, v in gates.items()
                if g != "b14_mc"
            )
            print(f" {'PASS' if fb else 'fail'} [{elapsed:.1f}s] {gate_summary}", file=sys.stderr)

        all_results.append(result)

        if not args.smoke:
            append_to_manifest(args.manifest, result)

    # Compute and write report
    report = compute_calibration_report(
        all_results,
        n_population=args.population,
    )

    report_text = json.dumps(report, indent=2)

    if args.smoke:
        # Smoke: print summary to stdout, don't write file
        print("\n=== SMOKE CALIBRATION REPORT ===")
        print(f"Nulls run: {report['n_complete']}/{report['n_nulls']}")
        print(f"Errors:    {report['n_errors']}")
        print("")
        print("Per-gate results:")
        for gate, stats in report["per_gate"].items():
            trials = stats.get("trials", 0)
            if trials == 0:
                print(f"  {gate:20s}: NO TRIALS (all skip/degenerate)")
            else:
                passes = stats.get("passes", 0)
                rate = stats.get("rate", 0)
                ci_key_lo = f"ci_{int(report['ci_confidence']*100)}_lower"
                ci_key_hi = f"ci_{int(report['ci_confidence']*100)}_upper"
                lo = stats.get(ci_key_lo, 0)
                hi = stats.get(ci_key_hi, 1)
                print(f"  {gate:20s}: {passes}/{trials} pass  rate={rate:.1%}  95%CI=[{lo:.1%},{hi:.1%}]")
        print("")
        print(f"Noise floor note: {report['noise_floor_note']}")
        print("")
        print("Degenerate counts:", report["degenerate_counts"])
        print("Skip counts:", report["skip_counts"])
    else:
        Path(args.report_out).write_text(report_text, encoding="utf-8")
        print(f"\nCalibration report written to {args.report_out}", file=sys.stderr)
        print(report["noise_floor_note"])


if __name__ == "__main__":
    main()
