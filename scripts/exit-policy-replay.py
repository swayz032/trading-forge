#!/usr/bin/env python3
"""
EXIT POLICY REPLAY (layer4-replay, 2026-07-02) — counterfactual exit axis.

Answers: "does OUR exit/trade-management overlay actually help OUR strategies?"

Method: replay IDENTICAL entry signals under three exit policies and compare.
The overlay is FROZEN — this is a measurement instrument, not parameter tuning.

Exit Policies:
  A "naked"        — entry + 15:55 ET session-EOD flatten ONLY.  No stop, no TP.
  B "stop_only"    — initial ATR stop + 15:55 ET flatten.  No TP, no partials, no trail.
  C "full_overlay" — current frozen production overlay (Style C 33/33/34 partials).
                     DEFAULT — zero code-path change vs normal backtest.

DLL circuit breaker and firm kill-switch are NOT part of the experiment. They operate
at the entry-signal layer (apply_dll_halt) and remain active in ALL policies.

Per-trade metrics added beyond normal backtest output:
  capture_ratio             = realized_pnl / mfe  (how much of the favorable move was captured)
  stop_out_of_winners_rate  = fraction of stopped trades whose price reached >= 1R
                              favorable before session EOD (stopped winners)

Output packet (file + stdout JSON):
  governance_labels: {replay_mode: True, exit_policy_replay: True}
  per_policy: {naked, stop_only, full_overlay}
    - sharpe, profit_factor, max_drawdown, total_return, total_trades, win_rate
    - capture_ratio_mean, stop_out_of_winners_rate
    - daily_pnls (for B14 firm-survival MC)
  archetype: "mean_reversion" | "momentum" | "other"
  comparison: {naked_vs_full, stop_only_vs_full}
    - sharpe_delta, pf_delta, capture_ratio_delta

Hard constraints:
  - Fail-closed on missing/ambiguous data
  - Deterministic under DETERMINISM_MODE
  - Futures P&L computed in engine (never passed to vectorbt)
  - Results carry distinct replay_mode=True label — NOT written to production tables
  - Run with TF_ALLOW_FIXED_1=true, firm_key=topstep_50k, DATA_CACHE_TTL_SECONDS set

Usage (tower, with AWS creds):
  PYTHONPATH=. TF_ALLOW_FIXED_1=true DATA_CACHE_TTL_SECONDS=86400 \\
    python scripts/exit-policy-replay.py \\
      --strategy-class src.engine.strategies.mitigation.MitigationStrategy \\
      --start 2023-01-01 --end 2025-12-01

  # Corpus sweep (all roster strategies):
  PYTHONPATH=. TF_ALLOW_FIXED_1=true DATA_CACHE_TTL_SECONDS=86400 \\
    python scripts/exit-policy-replay.py \\
      --corpus --start 2023-01-01 --end 2025-12-01
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import statistics
import subprocess
import sys

# ── Constants (mirrors overlay-delta-corpus.py / overlay-attribution.py) ──────
MES_POINT_VALUE = 5.0
MIN_N = 20  # below this trade count, metrics are LOW_N and excluded from corpus means

# Playbook roster — these strategies are registered and feel the full overlay.
ROSTER = [
    "ote", "ict_swing", "propulsion", "power_of_3", "quarterly_swing", "silver_bullet",
    "breaker", "eqhl_raid", "london_raid", "judas_swing", "mitigation",
    "ny_lunch_reversal", "midnight_open", "iofed", "ict_scalp",
]

# Strategy archetype map: derive from strategy spec field if available, else use this table.
# "mean_reversion" = fades, reversals, mitigation, lunch-reversal
# "momentum"       = breakouts, raids, propulsion, trend following
ARCHETYPE_HINTS: dict[str, str] = {
    "mitigation": "mean_reversion",
    "ny_lunch_reversal": "mean_reversion",
    "midnight_open": "mean_reversion",
    "eqhl_raid": "mean_reversion",
    "ote": "mean_reversion",
    "silver_bullet": "mean_reversion",
    "breaker": "mean_reversion",
    "london_raid": "momentum",
    "judas_swing": "momentum",
    "propulsion": "momentum",
    "power_of_3": "momentum",
    "quarterly_swing": "momentum",
    "ict_swing": "momentum",
    "iofed": "momentum",
    "ict_scalp": "other",
}


# ── Replay governance labels (never write these runs to production backtest tables) ──
GOVERNANCE_LABELS = {
    "replay_mode": True,
    "exit_policy_replay": True,
    "layer": "layer4",
    "instrument": "counterfactual_exit_axis",
}


def _run_policy(
    strategy_class_path: str,
    policy: str,
    start: str,
    end: str,
) -> dict:
    """Run one backtest under a specific exit_policy. Returns the result dict or error."""
    from src.engine.backtester import run_class_backtest

    module_path, class_name = strategy_class_path.rsplit(".", 1)
    try:
        cls = getattr(importlib.import_module(module_path), class_name)
        strategy = cls()
    except Exception as exc:
        return {"error": f"load {strategy_class_path}: {exc}", "exit_policy": policy}

    try:
        result = run_class_backtest(
            strategy=strategy,
            start_date=start,
            end_date=end,
            slippage_ticks=1.0,
            commission_per_side=0.62,
            firm_key="topstep_50k",
            skip_eligibility_gate=False,
            max_trades_per_day=2,
            use_performance_gate=False,
            exit_policy=policy,
        )
    except Exception as exc:
        return {"error": f"run_class_backtest policy={policy}: {exc}", "exit_policy": policy}

    return result


def _compute_mae_mfe_metrics(trades: list[dict], point_value: float = MES_POINT_VALUE) -> dict:
    """Compute capture_ratio and stop_out_of_winners_rate from per-trade MAE/MFE.

    capture_ratio:
        realized_pnl / mfe per trade (how much of the favorable move was captured).
        Clamped to [0, inf]. Trades with mfe=0 are excluded from the mean.

    stop_out_of_winners_rate:
        Fraction of trades that were stopped out AND whose price subsequently moved
        >= 1R favorably before EOD. Measures how often we're stopped out of a winner.
        Uses mfe >= risk_points as the "would have been profitable" proxy.
    """
    if not trades:
        return {
            "capture_ratio_mean": None,
            "capture_ratio_median": None,
            "stop_out_of_winners_rate": None,
            "n_trades": 0,
        }

    capture_ratios = []
    stop_out_but_winner_count = 0
    stop_out_count = 0

    for t in trades:
        pnl = float(t.get("PnL", t.get("pnl", 0)) or 0)
        mfe = t.get("mfe")
        mae = t.get("mae")  # noqa: F841 — reserved for future MAE-specific metrics
        risk_pts = float(t.get("risk_points", 0) or 0)
        exit_reason = str(t.get("exit_reason", "") or "")

        # capture_ratio: skip trades with mfe=0 or mfe=None (division by zero)
        if mfe is not None and float(mfe) > 0:
            ratio = pnl / float(mfe)
            capture_ratios.append(max(0.0, ratio))  # clamp: can't capture < 0 of MFE

        # stop_out_of_winners_rate: was this a stop-out AND did price later reach 1R?
        if exit_reason in ("stop_loss", "stop"):
            stop_out_count += 1
            if mfe is not None and risk_pts > 0:
                # MFE in $ / (contracts * point_value) ~ price points
                # We compare MFE (dollar) vs risk in dollar terms too
                # risk_points is in price-units; mfe is in $ — normalize:
                size = float(t.get("Size", t.get("size", 1)) or 1)
                mfe_points = float(mfe) / max(size * point_value, 1e-9)
                if mfe_points >= risk_pts:
                    stop_out_but_winner_count += 1

    stop_out_of_winners_rate = (
        round(stop_out_but_winner_count / stop_out_count, 4)
        if stop_out_count > 0 else None
    )

    return {
        "capture_ratio_mean": round(statistics.mean(capture_ratios), 4) if capture_ratios else None,
        "capture_ratio_median": round(statistics.median(capture_ratios), 4) if capture_ratios else None,
        "stop_out_of_winners_rate": stop_out_of_winners_rate,
        "stop_out_count": stop_out_count,
        "stop_out_winner_count": stop_out_but_winner_count,
        "n_trades": len(trades),
        "n_with_mfe": len(capture_ratios),
    }


def _scalar_summary(result: dict, policy: str) -> dict:
    """Extract comparison-relevant scalars from a run_class_backtest result dict."""
    if result.get("error"):
        return {"exit_policy": policy, "error": result["error"]}
    trades = result.get("trades", [])
    mae_mfe = _compute_mae_mfe_metrics(trades)
    return {
        "exit_policy": policy,
        "error": None,
        "sharpe": result.get("sharpe_ratio"),
        "profit_factor": result.get("profit_factor"),
        "max_dd": result.get("max_drawdown"),
        "total_return": result.get("total_return"),
        "trade_count": result.get("total_trades", 0),
        "win_rate": result.get("win_rate"),
        "avg_rr": result.get("avg_rr"),
        "daily_pnls": result.get("daily_pnls", []),
        **mae_mfe,
    }


def _comparison(full: dict, other: dict, label: str) -> dict:
    """Compute delta vector: other_policy minus full_overlay (positive = other is better)."""
    def g(d: dict, k: str) -> float:
        return (d.get(k) or 0.0) if not d.get("error") else 0.0
    n_full = full.get("trade_count") or 0
    n_other = other.get("trade_count") or 0
    return {
        "label": label,
        "sharpe_delta": round(g(other, "sharpe") - g(full, "sharpe"), 4),
        "pf_delta": round(g(other, "profit_factor") - g(full, "profit_factor"), 4),
        "dd_delta": round(g(other, "max_dd") - g(full, "max_dd"), 6),
        "capture_ratio_delta": (
            round(g(other, "capture_ratio_mean") - g(full, "capture_ratio_mean"), 4)
            if full.get("capture_ratio_mean") is not None and other.get("capture_ratio_mean") is not None
            else None
        ),
        "trade_retention_pct": round(100 * n_other / n_full, 1) if n_full else None,
        "n_full_overlay": n_full,
        f"n_{label.split('_')[0]}": n_other,
    }


def _verdict(full: dict, naked: dict, stop_only: dict) -> str:
    """KEEP/LOOSEN/INDETERMINATE verdict for the full overlay vs counterfactuals.

    KEEP if: full_overlay Sharpe > naked Sharpe AND full_overlay PF > stop_only PF
    LOOSEN if: full_overlay is worse than BOTH counterfactuals
    INDETERMINATE if: mixed or any policy errored
    """
    if full.get("error") or naked.get("error") or stop_only.get("error"):
        return "INDETERMINATE"
    full_sharpe = full.get("sharpe") or 0.0
    naked_sharpe = naked.get("sharpe") or 0.0
    stop_pf = stop_only.get("profit_factor") or 0.0
    full_pf = full.get("profit_factor") or 0.0
    beats_naked = full_sharpe > naked_sharpe
    beats_stop = full_pf > stop_pf
    if beats_naked and beats_stop:
        return "KEEP"
    if not beats_naked and not beats_stop:
        return "LOOSEN"
    return "INDETERMINATE"


def _detect_archetype(strategy_class_path: str) -> str:
    """Derive strategy archetype from class spec or hint table."""
    name = strategy_class_path.split(".")[-1].lower().replace("strategy", "").strip("_")
    for roster_name, archetype in ARCHETYPE_HINTS.items():
        if roster_name in name or name in roster_name:
            return archetype
    # Try to read strategy.archetype if defined
    try:
        module_path, class_name = strategy_class_path.rsplit(".", 1)
        cls = getattr(importlib.import_module(module_path), class_name)
        inst = cls()
        if hasattr(inst, "archetype") and inst.archetype:
            return str(inst.archetype).lower()
    except Exception:
        pass
    return "other"


def run_single(
    strategy_class_path: str,
    start: str,
    end: str,
    verbose: bool = True,
) -> dict:
    """Run all three exit policies for one strategy. Returns comparison packet."""
    archetype = _detect_archetype(strategy_class_path)
    if verbose:
        print(f"[exit-policy-replay] {strategy_class_path} ({archetype})", flush=True)

    results = {}
    for policy in ("naked", "stop_only", "full_overlay"):
        if verbose:
            print(f"  [{policy}] running ...", flush=True)
        raw = _run_policy(strategy_class_path, policy, start, end)
        results[policy] = raw
        if verbose:
            err = raw.get("error")
            n = raw.get("total_trades", 0) if not err else "ERR"
            sh = raw.get("sharpe_ratio", "ERR") if not err else err[:80]
            print(f"  [{policy}] trades={n} sharpe={sh}", flush=True)

    # Fail-closed: if full_overlay errored, can't produce a valid comparison
    if results["full_overlay"].get("error"):
        return {
            "strategy": strategy_class_path,
            "archetype": archetype,
            "status": "ERROR",
            "error": results["full_overlay"]["error"],
            "governance_labels": GOVERNANCE_LABELS,
        }

    naked_s = _scalar_summary(results["naked"], "naked")
    stop_s = _scalar_summary(results["stop_only"], "stop_only")
    full_s = _scalar_summary(results["full_overlay"], "full_overlay")

    verdict = _verdict(full_s, naked_s, stop_s)

    packet = {
        "strategy": strategy_class_path,
        "archetype": archetype,
        "window": f"{start}..{end}",
        "status": "OK",
        "governance_labels": GOVERNANCE_LABELS,
        "verdict": verdict,
        "per_policy": {
            "naked": naked_s,
            "stop_only": stop_s,
            "full_overlay": full_s,
        },
        "comparison": {
            "naked_vs_full": _comparison(full_s, naked_s, "naked_vs_full"),
            "stop_only_vs_full": _comparison(full_s, stop_s, "stop_only_vs_full"),
        },
        "low_n": (results["full_overlay"].get("total_trades") or 0) < MIN_N,
    }
    return packet


def _discover_class(name: str) -> str | None:
    """Find the Strategy class path for a roster name."""
    mod_path = f"src.engine.strategies.{name}"
    try:
        mod = importlib.import_module(mod_path)
    except Exception:
        return None
    import inspect
    for attr in dir(mod):
        obj = getattr(mod, attr)
        if (inspect.isclass(obj) and attr.endswith("Strategy")
                and obj.__module__ == mod_path and not inspect.isabstract(obj)):
            return f"{mod_path}.{attr}"
    return None


def _run_corpus_subprocess(cls_path: str, start: str, end: str) -> dict:
    """Run one corpus entry as a subprocess to isolate engine state."""
    cmd = [
        sys.executable, "scripts/exit-policy-replay.py",
        "--strategy-class", cls_path,
        "--start", start,
        "--end", end,
        "--json",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=7200, env=os.environ.copy())
    out = r.stdout
    brace = out.find("{")
    if brace < 0:
        return {"strategy": cls_path, "status": "ERROR", "error": (r.stderr or out)[-400:]}
    try:
        return json.loads(out[brace:])
    except json.JSONDecodeError:
        return {"strategy": cls_path, "status": "ERROR", "error": out[-400:]}


def run_corpus(start: str, end: str, out_path: str) -> int:
    """Corpus sweep: run all ROSTER strategies and aggregate."""
    rows = []
    for name in ROSTER:
        cls = _discover_class(name)
        if not cls:
            rows.append({"strategy": name, "status": "NO_CLASS"})
            print(f"[{name}] NO_CLASS", flush=True)
            continue
        print(f"[{name}] running exit-policy-replay ...", flush=True)
        row = _run_corpus_subprocess(cls, start, end)
        row["strategy_name"] = name
        rows.append(row)
        ok = row.get("status") == "OK"
        if ok:
            v = row.get("verdict", "?")
            pp = row.get("per_policy", {})
            full = pp.get("full_overlay", {})
            naked = pp.get("naked", {})
            delta_sh = round((full.get("sharpe") or 0) - (naked.get("sharpe") or 0), 4)
            low_n = " LOW_N" if row.get("low_n") else ""
            print(f"[{name}] {v} | dSharpe(full-naked)={delta_sh}{low_n}", flush=True)
        else:
            print(f"[{name}] ERROR: {row.get('error', '')[:160]}", flush=True)

    ok_rows = [r for r in rows if r.get("status") == "OK"]
    usable = [r for r in ok_rows if not r.get("low_n")]
    agg_src = usable if usable else ok_rows

    def _agg(key: str, policy: str) -> dict | None:
        vals = [
            r["per_policy"][policy].get(key)
            for r in agg_src
            if r.get("per_policy", {}).get(policy, {}).get(key) is not None
        ]
        if not vals:
            return None
        return {
            "mean": round(statistics.mean(vals), 4),
            "median": round(statistics.median(vals), 4),
            "n": len(vals),
        }

    summary = {
        "window": f"{start}..{end}",
        "strategies_attempted": len(ROSTER),
        "ok": len(ok_rows),
        f"usable_for_aggregate (n>={MIN_N})": len(usable),
        "verdicts": {v: sum(1 for r in ok_rows if r.get("verdict") == v) for v in ("KEEP", "LOOSEN", "INDETERMINATE")},
        "aggregate_by_policy": {
            policy: {
                "sharpe": _agg("sharpe", policy),
                "profit_factor": _agg("profit_factor", policy),
                "max_dd": _agg("max_dd", policy),
                "capture_ratio_mean": _agg("capture_ratio_mean", policy),
                "stop_out_of_winners_rate": _agg("stop_out_of_winners_rate", policy),
            }
            for policy in ("naked", "stop_only", "full_overlay")
        },
        "governance_labels": GOVERNANCE_LABELS,
        "note": (
            "LOW_N strategies (n<20) excluded from aggregate means. "
            "full_overlay = production default (zero change). "
            "naked/stop_only = counterfactual only — do not use for promotion decisions."
        ),
    }
    report = {"summary": summary, "strategies": rows}
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, indent=1)
    print("\n=== CORPUS SUMMARY ===")
    print(json.dumps(summary, indent=1))
    print(f"\nfull report: {out_path}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Exit Policy Replay — counterfactual exit axis (layer4-replay 2026-07-02)"
    )
    ap.add_argument("--strategy-class", default=None,
                    help="Dotted path e.g. src.engine.strategies.mitigation.MitigationStrategy")
    ap.add_argument("--corpus", action="store_true",
                    help="Sweep all ROSTER strategies (subprocess-per-strategy)")
    ap.add_argument("--start", default="2023-01-01")
    ap.add_argument("--end", default="2025-12-01")
    ap.add_argument("--out", default="docs/designs/exit-policy-replay-{strategy}.json",
                    help="Output file path ({strategy} substituted with class name)")
    ap.add_argument("--corpus-out", default="docs/designs/exit-policy-corpus-2026-07-02.json")
    ap.add_argument("--json", action="store_true", help="Emit machine-readable JSON to stdout")
    args = ap.parse_args()

    if args.corpus:
        return run_corpus(args.start, args.end, args.corpus_out)

    if not args.strategy_class:
        print("ERROR: --strategy-class or --corpus required", file=sys.stderr)
        return 1

    packet = run_single(args.strategy_class, args.start, args.end, verbose=not args.json)

    if args.json:
        print(json.dumps(packet, indent=1, default=str))
        return 0

    # Human-readable summary
    pp = packet.get("per_policy", {})
    print(f"\n=== EXIT POLICY REPLAY — {args.strategy_class} ({args.start} → {args.end}) ===")
    print(f"Archetype: {packet.get('archetype', 'other')}")
    print(f"Verdict:   {packet.get('verdict', 'N/A')}")
    print()
    print(f"{'metric':<28}{'naked':>16}{'stop_only':>16}{'full_overlay':>16}")
    print("-" * 76)
    for metric in ("trade_count", "sharpe", "profit_factor", "max_dd", "total_return",
                   "capture_ratio_mean", "stop_out_of_winners_rate"):
        vals = {p: pp.get(p, {}).get(metric) for p in ("naked", "stop_only", "full_overlay")}
        row = f"  {metric:<26}" + "".join(f"{str(v):>16}" for v in vals.values())
        print(row)
    print()
    comp = packet.get("comparison", {})
    for label, c in comp.items():
        print(f"  {label}: dSharpe={c.get('sharpe_delta')} dPF={c.get('pf_delta')} "
              f"dCapture={c.get('capture_ratio_delta')}")
    print()
    print(f"governance_labels: {packet.get('governance_labels', {})}")
    print("(replay_mode=True — results NOT written to production backtest tables)")

    # Write JSON output
    strat_short = args.strategy_class.split(".")[-1].lower().replace("strategy", "")
    out_path = args.out.replace("{strategy}", strat_short)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(packet, f, indent=1, default=str)
    print(f"\nfull report: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
