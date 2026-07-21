#!/usr/bin/env python3
"""
FILTER ABLATION -- LEAVE-ONE-FILTER-OUT (layer4-ablation 2026-07-02)

Measures the marginal OOS DSR contribution of each eligibility gate layer
by running a walk-forward grid:

  Baseline:   full overlay ON                  -> OOS DSR_baseline
  Layer L:    overlay ON except layer L vetoes  -> OOS DSR_L

  DELTA_DSR = DSR_L - DSR_baseline

  Verdict taxonomy (threshold = 0.05):
    CONTRIBUTING  DELTA_DSR <= -0.05  removal degraded OOS DSR; layer earns its place
    DEAD_WEIGHT   |DELTA_DSR| < 0.05  marginal contribution not significant; curve-fit candidate
    HARMFUL       DELTA_DSR >= +0.05  removal improved OOS DSR; layer may be counterproductive
    INDETERMINATE error / insufficient data

Starting hypothesis (operator): the NO_TRADE playbook layer does ~99% of signal
cutting on tested archetypes. This grid confirms or refutes rigorously.

GOVERNANCE: Results are RESEARCH-ONLY. Verdicts inform UNFREEZING decisions
after profitable baselines exist. Never auto-applied. Never persisted to
production tables. Every output row carries governance_advisory=true.

OVERLAY IS FROZEN. This harness is measurement only, not tuning.

Usage (tower, with AWS creds + TF_ALLOW_FIXED_1=true + DATA_CACHE_TTL_SECONDS):
  PYTHONPATH=. python scripts/filter-ablation-cpcv.py \\
    --strategy-class src.engine.strategies.ote.OTEStrategy \\
    --start 2023-01-01 --end 2025-12-01 \\
    --firm topstep_50k

Resume a partial run:
  PYTHONPATH=. python scripts/filter-ablation-cpcv.py \\
    --strategy-class src.engine.strategies.ote.OTEStrategy \\
    --start 2023-01-01 --end 2025-12-01 \\
    --resume --manifest docs/designs/filter-ablation-ote-manifest.json

Test single layer:
  PYTHONPATH=. python scripts/filter-ablation-cpcv.py \\
    --strategy-class src.engine.strategies.ote.OTEStrategy \\
    --start 2023-01-01 --end 2025-12-01 \\
    --layers no_trade,kill_zone

See docs/filter-ablation-runbook.md for full operator guide.
"""
from __future__ import annotations

import argparse
import importlib
import importlib.util
import json
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

# ─── Constants ────────────────────────────────────────────────────────────────

# DELTA_DSR threshold: |delta| < this -> DEAD_WEIGHT; delta <= -this -> CONTRIBUTING;
# delta >= +this -> HARMFUL. Bailey-Lopez de Prado standard.
DSR_CONTRIBUTING_THRESHOLD = 0.05

# Walk-forward window count for OOS aggregation per ablation run.
# 5 windows gives enough folds to compute DSR without full CPCV compute cost.
N_WF_WINDOWS = 5

# Fraction of each window that is in-sample (used as warmup only; OOS is the rest).
IS_RATIO = 0.6

# Skip DSR computation if fewer than this many OOS trades across all windows.
# Too few trades make DSR unreliable.
MIN_OOS_TRADES = 5

# Governance metadata attached to every output record.
GOVERNANCE_LABEL: dict = {
    "governance_advisory": True,
    "ablation_marker": True,
    "persist_to_production": False,
    "authority": (
        "research_only -- verdicts inform UNFREEZING decisions "
        "after profitable baselines exist; never auto-applied; overlay remains FROZEN"
    ),
}


# ─── Engine imports (PYTHONPATH=. required) ───────────────────────────────────

def _ensure_engine_imports():
    """Fail fast with a clear message if PYTHONPATH is not set."""
    try:
        from src.engine.ablation_layers import ABLATION_LAYER_MAP, ABLATION_LAYER_NAMES
        return ABLATION_LAYER_MAP, ABLATION_LAYER_NAMES
    except ImportError as exc:
        sys.exit(
            f"FATAL: cannot import engine modules -- run with PYTHONPATH=. "
            f"(e.g. PYTHONPATH=. python scripts/filter-ablation-cpcv.py ...) [{exc}]"
        )


# ─── Single backtest with env isolation ───────────────────────────────────────

def _run_single_bt(
    strategy_cls,
    start_date: str,
    end_date: str,
    firm_key: str,
    disabled_layer: str | None = None,
) -> dict:
    """Run one backtest with overlay ON and optionally one layer disabled.

    Sets TF_OVERLAY_DISABLE_LAYERS before the call and restores env afterward.
    Overlay is always ON (TF_CONFLUENCE_OVERLAY_DISABLED=false) so the gate runs
    in full and only the specified layer's veto is suppressed.

    Returns result dict with at least: total_trades, daily_pnls, gate_stats.
    On error: {"error": str}.
    """
    from src.engine.backtester import run_class_backtest

    # Capture and isolate env vars
    prev_overlay = os.environ.get("TF_CONFLUENCE_OVERLAY_DISABLED")
    prev_disable = os.environ.get("TF_OVERLAY_DISABLE_LAYERS")

    try:
        os.environ["TF_CONFLUENCE_OVERLAY_DISABLED"] = "false"
        if disabled_layer:
            os.environ["TF_OVERLAY_DISABLE_LAYERS"] = disabled_layer
        else:
            os.environ.pop("TF_OVERLAY_DISABLE_LAYERS", None)

        result = run_class_backtest(
            strategy=strategy_cls(),
            start_date=start_date,
            end_date=end_date,
            slippage_ticks=1.0,
            commission_per_side=0.62,
            firm_key=firm_key,
            skip_eligibility_gate=False,   # gate must be ON for ablation to matter
            max_trades_per_day=2,
            use_performance_gate=False,
        )
        return result
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
    finally:
        # Restore env precisely
        os.environ.pop("TF_CONFLUENCE_OVERLAY_DISABLED", None)
        os.environ.pop("TF_OVERLAY_DISABLE_LAYERS", None)
        if prev_overlay is not None:
            os.environ["TF_CONFLUENCE_OVERLAY_DISABLED"] = prev_overlay
        if prev_disable is not None:
            os.environ["TF_OVERLAY_DISABLE_LAYERS"] = prev_disable


# ─── Walk-forward ablation runner ────────────────────────────────────────────

def _run_wf_ablation(
    strategy_class_path: str,
    start_date: str,
    end_date: str,
    firm_key: str,
    disabled_layer: str | None = None,
) -> dict:
    """Run N-window walk-forward ablation for one layer configuration.

    Splits the date range into N_WF_WINDOWS equal periods. For each period,
    runs run_class_backtest on the OOS portion. Pools OOS daily_pnls across
    all windows and computes DSR via cross_validation.deflated_sharpe_ratio.

    Returns dict with: dsr, dsr_pass, total_trades, oos_sharpe, oos_pnl_days,
    and optionally gate_stats (from the last window). On failure: {"error": ...}.
    """
    import numpy as np
    from src.engine.cross_validation import deflated_sharpe_ratio

    # Load strategy class
    module_path, class_name = strategy_class_path.rsplit(".", 1)
    try:
        mod = importlib.import_module(module_path)
        cls = getattr(mod, class_name)
    except Exception as exc:  # noqa: BLE001
        return {
            "error": f"load error: {exc}",
            "dsr": None, "dsr_pass": None, "total_trades": 0,
        }

    # Build walk-forward windows (date boundaries only)
    try:
        start_dt = date.fromisoformat(start_date)
        end_dt = date.fromisoformat(end_date)
        total_days = (end_dt - start_dt).days
        if total_days < 60:
            return {
                "error": f"date range too short ({total_days} days, min 60)",
                "dsr": None, "dsr_pass": None, "total_trades": 0,
            }
        window_days = max(total_days // N_WF_WINDOWS, 1)
        is_days = int(window_days * IS_RATIO)
        if is_days >= window_days:
            is_days = window_days - 1

        windows = []
        for i in range(N_WF_WINDOWS):
            w_start = start_dt + timedelta(days=i * window_days)
            oos_start = w_start + timedelta(days=is_days)
            oos_end = (
                end_dt if i == N_WF_WINDOWS - 1
                else w_start + timedelta(days=window_days)
            )
            if oos_start >= oos_end or oos_start >= end_dt:
                continue
            windows.append((str(oos_start), str(min(oos_end, end_dt))))
    except Exception as exc:  # noqa: BLE001
        return {
            "error": f"window split error: {exc}",
            "dsr": None, "dsr_pass": None, "total_trades": 0,
        }

    all_oos_pnls: list[float] = []
    total_trades = 0
    gate_stats_last: dict = {}
    window_errors = 0

    for win_idx, (oos_start, oos_end) in enumerate(windows):
        r = _run_single_bt(cls, oos_start, oos_end, firm_key, disabled_layer=disabled_layer)
        if r.get("error"):
            print(
                f"    window {win_idx + 1}/{len(windows)} error: {r['error'][:120]}",
                file=sys.stderr,
            )
            window_errors += 1
            continue
        pnls = r.get("daily_pnls", [])
        all_oos_pnls.extend(float(p) for p in pnls)
        total_trades += int(r.get("total_trades", 0))
        gate_stats_last = r.get("gate_stats", {})

    if not all_oos_pnls or total_trades < MIN_OOS_TRADES:
        return {
            "error": (
                f"insufficient OOS data: trades={total_trades} "
                f"(min {MIN_OOS_TRADES}), pnl_days={len(all_oos_pnls)}, "
                f"window_errors={window_errors}/{len(windows)}"
            ),
            "dsr": None, "dsr_pass": None, "total_trades": total_trades,
            "gate_stats_last": gate_stats_last,
        }

    # Compute OOS Sharpe from pooled daily P&Ls
    arr = np.array(all_oos_pnls, dtype=float)
    std = float(np.std(arr, ddof=1))
    if std <= 0:
        return {
            "error": "zero standard deviation in OOS P&Ls",
            "dsr": None, "dsr_pass": None, "total_trades": total_trades,
        }

    oos_sharpe = float(np.mean(arr) / std * np.sqrt(252))

    # DSR via cross_validation (consumes battery output signature: dsr, significant)
    try:
        dsr_result = deflated_sharpe_ratio(
            observed_sharpe=oos_sharpe,
            n_trials=max(N_WF_WINDOWS, 1),
            n_observations=max(len(all_oos_pnls), 2),
        )
        dsr_val = dsr_result.get("dsr")
        # cross_validation uses "significant" not "passes"; normalise to dsr_pass
        # so this output survives rebase onto the phase-0 battery which uses dsr_pass.
        dsr_pass = bool(dsr_result.get("significant", False))
    except Exception as exc:  # noqa: BLE001
        return {
            "error": f"DSR computation failed: {exc}",
            "dsr": None, "dsr_pass": False, "total_trades": total_trades,
        }

    return {
        "dsr": dsr_val,
        "dsr_pass": dsr_pass,
        "total_trades": total_trades,
        "oos_sharpe": round(oos_sharpe, 4),
        "oos_pnl_days": len(all_oos_pnls),
        "window_errors": window_errors,
        "gate_stats_last": gate_stats_last,
        "error": None,
    }


# ─── Verdict computation ──────────────────────────────────────────────────────

def _compute_verdict(
    dsr_baseline: float | None,
    dsr_layer: float | None,
    trades_baseline: int,
    trades_layer: int,
    layer_name: str,
) -> dict:
    """Compute ablation verdict for one layer removal.

    Threshold = DSR_CONTRIBUTING_THRESHOLD (0.05).

    DELTA_DSR = DSR_L - DSR_baseline  (positive = removal improved DSR)
      CONTRIBUTING  delta <= -threshold  layer degrades OOS DSR if removed
      DEAD_WEIGHT   |delta| < threshold  marginal contribution
      HARMFUL       delta >= +threshold  layer hurts OOS DSR
      INDETERMINATE insufficient data
    """
    if dsr_baseline is None or dsr_layer is None:
        return {
            "verdict": "INDETERMINATE",
            "delta_dsr": None,
            "delta_trades": trades_layer - trades_baseline if trades_baseline else None,
            "reason": (
                f"baseline_dsr={dsr_baseline}, layer_dsr={dsr_layer} -- "
                "one or both runs produced no valid DSR"
            ),
        }

    delta = round(dsr_layer - dsr_baseline, 4)
    delta_trades = trades_layer - trades_baseline

    if delta >= DSR_CONTRIBUTING_THRESHOLD:
        verdict = "HARMFUL"
        reason = (
            f"removing '{layer_name}' IMPROVED OOS DSR by {delta:+.4f} -- "
            f"this layer may be counterproductive; re-examine its criteria"
        )
    elif delta <= -DSR_CONTRIBUTING_THRESHOLD:
        verdict = "CONTRIBUTING"
        reason = (
            f"removing '{layer_name}' DEGRADED OOS DSR by {abs(delta):.4f} (delta={delta:+.4f}) -- "
            f"layer earns its place; keep it"
        )
    else:
        verdict = "DEAD_WEIGHT"
        reason = (
            f"|DELTA_DSR|={abs(delta):.4f} < {DSR_CONTRIBUTING_THRESHOLD} threshold -- "
            f"removing '{layer_name}' has marginal OOS impact; candidate for relaxation"
        )

    return {
        "verdict": verdict,
        "delta_dsr": delta,
        "delta_trades": delta_trades,
        "trade_delta_pct": (
            round(100 * delta_trades / max(trades_baseline, 1), 1)
            if trades_baseline else None
        ),
        "reason": reason,
    }


# ─── Manifest helpers (resumability) ─────────────────────────────────────────

def _load_manifest(manifest_path: str | None) -> dict:
    if not manifest_path:
        return {}
    p = Path(manifest_path)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def _save_manifest(manifest_path: str | None, data: dict) -> None:
    if not manifest_path:
        return
    Path(manifest_path).write_text(json.dumps(data, indent=1, default=str), encoding="utf-8", newline="\n")


# ─── NO_TRADE hypothesis check ───────────────────────────────────────────────

def _check_no_trade_hypothesis(gate_stats: dict) -> dict:
    """Analyze gate_stats from a full-period baseline to evaluate the hypothesis.

    Starting hypothesis: the NO_TRADE playbook layer does ~99% of signal cutting.
    This function counts rejections per canonical layer and checks if NO_TRADE
    is the dominant rejector (>= 90% threshold for confirmed).
    """
    from src.engine.ablation_layers import reason_to_layer

    long_skip = gate_stats.get("long", {}).get("skipped_signals", []) or []
    short_skip = gate_stats.get("short", {}).get("skipped_signals", []) or []
    all_skipped = list(long_skip) + list(short_skip)

    layer_counts: dict[str, int] = {}
    for srec in all_skipped:
        r = srec.get("reason", "") if isinstance(srec, dict) else ""
        canon = reason_to_layer(r) or r[:40] or "unknown"
        layer_counts[canon] = layer_counts.get(canon, 0) + 1

    total_skipped = sum(layer_counts.values())
    no_trade_count = layer_counts.get("no_trade", 0)
    no_trade_pct = round(100 * no_trade_count / max(total_skipped, 1), 1)
    confirmed = no_trade_pct >= 90

    return {
        "hypothesis": "NO_TRADE playbook layer does ~99% of signal cutting",
        "no_trade_rejections": no_trade_count,
        "total_rejections": total_skipped,
        "no_trade_pct": no_trade_pct,
        "top_layers_by_rejection": sorted(layer_counts.items(), key=lambda kv: -kv[1])[:5],
        "confirmed": confirmed,
        "note": (
            f"CONFIRMED: NO_TRADE accounts for {no_trade_pct}% of rejections (threshold >= 90%)"
            if confirmed else
            f"REFUTED: NO_TRADE accounts for only {no_trade_pct}% of rejections "
            f"-- hypothesis was ~99%; other layers carry more signal cutting than expected"
        ),
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    ABLATION_LAYER_MAP, ABLATION_LAYER_NAMES = _ensure_engine_imports()

    ap = argparse.ArgumentParser(
        description=(
            "Filter ablation: leave-one-filter-out OOS DSR grid (layer4-ablation 2026-07-02). "
            "See docs/filter-ablation-runbook.md."
        )
    )
    ap.add_argument(
        "--strategy-class", required=True,
        help="dotted class path, e.g. src.engine.strategies.ote.OTEStrategy",
    )
    ap.add_argument("--start", default="2023-01-01")
    ap.add_argument("--end", default="2025-12-01")
    ap.add_argument(
        "--out",
        default="docs/designs/filter-ablation-cpcv-{strategy}-{ts}.json",
        help="output path; {strategy} and {ts} are substituted",
    )
    ap.add_argument(
        "--manifest", default=None,
        help="path to resumable manifest file (default: auto-derived from --out)",
    )
    ap.add_argument(
        "--resume", action="store_true",
        help="resume from existing manifest, skipping already-completed runs",
    )
    ap.add_argument("--firm", default="topstep_50k")
    ap.add_argument(
        "--layers", default=None,
        help=(
            "comma-separated canonical layer names to test "
            f"(default: all {len(ABLATION_LAYER_NAMES)} layers). "
            f"Known: {','.join(ABLATION_LAYER_NAMES)}"
        ),
    )
    args = ap.parse_args()

    strategy_class = args.strategy_class
    strategy_short = strategy_class.rsplit(".", 1)[-1].lower().replace("strategy", "").strip("_")
    ts = time.strftime("%Y%m%d_%H%M%S")

    out_path = args.out.replace("{strategy}", strategy_short).replace("{ts}", ts)
    manifest_path = args.manifest or out_path.replace(".json", "_manifest.json")

    # Validate requested layers
    if args.layers:
        test_layers = [x.strip() for x in args.layers.split(",") if x.strip()]
        unknown = [la for la in test_layers if la not in ABLATION_LAYER_MAP]
        if unknown:
            print(
                f"ERROR: unknown layer name(s): {unknown}\n"
                f"Known layers: {list(ABLATION_LAYER_NAMES)}",
                file=sys.stderr,
            )
            return 1
    else:
        test_layers = list(ABLATION_LAYER_NAMES)

    manifest = _load_manifest(manifest_path) if args.resume else {}

    print(f"Filter ablation: {strategy_class}", flush=True)
    print(f"  Window : {args.start} -> {args.end}", flush=True)
    print(f"  Firm   : {args.firm}", flush=True)
    print(f"  Layers : {test_layers}", flush=True)
    print(f"  WF windows per run: {N_WF_WINDOWS}", flush=True)
    print(f"  DSR threshold: {DSR_CONTRIBUTING_THRESHOLD}", flush=True)
    if args.resume:
        print(f"  Resuming from manifest: {manifest_path}", flush=True)

    # ── Step 1: Baseline (all layers ON) ──────────────────────────────────────
    baseline_key = "__baseline__"
    if args.resume and baseline_key in manifest:
        print("[baseline] RESUMED from manifest", flush=True)
        baseline = manifest[baseline_key]
    else:
        print("[baseline] running (all layers ON)...", flush=True)
        t0 = time.time()
        baseline = _run_wf_ablation(
            strategy_class, args.start, args.end, args.firm, disabled_layer=None
        )
        elapsed = round(time.time() - t0, 1)
        manifest[baseline_key] = baseline
        _save_manifest(manifest_path, manifest)
        if baseline.get("error"):
            print(f"[baseline] WARNING: {baseline['error']}", flush=True)
        else:
            print(
                f"[baseline] DSR={baseline.get('dsr')}, "
                f"dsr_pass={baseline.get('dsr_pass')}, "
                f"trades={baseline.get('total_trades')}, "
                f"sharpe={baseline.get('oos_sharpe')}, "
                f"elapsed={elapsed}s",
                flush=True,
            )

    dsr_baseline = baseline.get("dsr")
    trades_baseline = baseline.get("total_trades", 0)

    # ── Step 2: Per-layer ablation ────────────────────────────────────────────
    layer_rows: list[dict] = []

    for layer_name in test_layers:
        layer_key = f"layer__{layer_name}"

        if args.resume and layer_key in manifest:
            print(f"[{layer_name}] RESUMED from manifest", flush=True)
            layer_result = manifest[layer_key]
        else:
            print(
                f"[{layer_name}] running (disabled_layer={layer_name})...",
                flush=True,
            )
            t0 = time.time()
            layer_result = _run_wf_ablation(
                strategy_class, args.start, args.end, args.firm,
                disabled_layer=layer_name,
            )
            elapsed = round(time.time() - t0, 1)
            manifest[layer_key] = layer_result
            _save_manifest(manifest_path, manifest)

            if layer_result.get("error"):
                print(
                    f"[{layer_name}] WARNING: {layer_result['error'][:120]}",
                    flush=True,
                )
            else:
                print(
                    f"[{layer_name}] DSR={layer_result.get('dsr')}, "
                    f"trades={layer_result.get('total_trades')}, "
                    f"elapsed={elapsed}s",
                    flush=True,
                )

        verdict = _compute_verdict(
            dsr_baseline,
            layer_result.get("dsr"),
            trades_baseline,
            layer_result.get("total_trades", 0),
            layer_name,
        )

        row: dict = {
            "layer": layer_name,
            "layer_prefix": ABLATION_LAYER_MAP[layer_name],
            "dsr_with_layer_disabled": layer_result.get("dsr"),
            "dsr_pass_with_layer_disabled": layer_result.get("dsr_pass"),
            "trades_with_layer_disabled": layer_result.get("total_trades", 0),
            "oos_sharpe_with_layer_disabled": layer_result.get("oos_sharpe"),
            "error": layer_result.get("error"),
            **verdict,
        }
        layer_rows.append(row)

        print(
            f"  -> verdict={verdict['verdict']}, "
            f"delta_dsr={verdict.get('delta_dsr')}, "
            f"delta_trades={verdict.get('delta_trades')}",
            flush=True,
        )

    # ── Step 3: NO_TRADE hypothesis check (full-period gate_stats) ────────────
    print("[no_trade_check] running full-period backtest for gate_stats...", flush=True)
    gate_check_key = "__gate_check__"

    if args.resume and gate_check_key in manifest:
        print("[no_trade_check] RESUMED from manifest", flush=True)
        gate_check = manifest[gate_check_key]
    else:
        try:
            mod_path, cls_name = strategy_class.rsplit(".", 1)
            mod = importlib.import_module(mod_path)
            cls = getattr(mod, cls_name)
            gc_result = _run_single_bt(cls, args.start, args.end, args.firm, disabled_layer=None)
            gate_check = {
                "total_trades": gc_result.get("total_trades"),
                "gate_stats": gc_result.get("gate_stats", {}),
                "error": gc_result.get("error"),
            }
        except Exception as exc:  # noqa: BLE001
            gate_check = {"error": str(exc), "gate_stats": {}}
        manifest[gate_check_key] = gate_check
        _save_manifest(manifest_path, manifest)

    no_trade_hypothesis = _check_no_trade_hypothesis(gate_check.get("gate_stats", {}))
    print(f"[no_trade_check] {no_trade_hypothesis['note']}", flush=True)

    # ── Step 4: Summary ───────────────────────────────────────────────────────
    verdict_counts: dict[str, int] = {}
    for row in layer_rows:
        v = row.get("verdict", "INDETERMINATE")
        verdict_counts[v] = verdict_counts.get(v, 0) + 1

    summary = {
        "strategy": strategy_class,
        "window": f"{args.start}..{args.end}",
        "firm": args.firm,
        "baseline_dsr": dsr_baseline,
        "baseline_dsr_pass": baseline.get("dsr_pass"),
        "baseline_trades": trades_baseline,
        "baseline_oos_sharpe": baseline.get("oos_sharpe"),
        "baseline_error": baseline.get("error"),
        "layers_tested": test_layers,
        "wf_windows_per_run": N_WF_WINDOWS,
        "dsr_threshold": DSR_CONTRIBUTING_THRESHOLD,
        "verdict_counts": verdict_counts,
        "no_trade_hypothesis": no_trade_hypothesis,
    }

    report: dict = {
        **GOVERNANCE_LABEL,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "summary": summary,
        "baseline": {
            "dsr": baseline.get("dsr"),
            "dsr_pass": baseline.get("dsr_pass"),
            "total_trades": baseline.get("total_trades"),
            "oos_sharpe": baseline.get("oos_sharpe"),
            "error": baseline.get("error"),
        },
        "layer_ablations": layer_rows,
    }

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    Path(out_path).write_text(json.dumps(report, indent=1, default=str), encoding="utf-8", newline="\n")

    # ── Console summary ───────────────────────────────────────────────────────
    print(f"\n{'=' * 68}")
    print(f"FILTER ABLATION SUMMARY -- {strategy_short.upper()}")
    print(f"{'=' * 68}")
    print(f"Baseline DSR : {dsr_baseline}  (dsr_pass={baseline.get('dsr_pass')})")
    print(f"Baseline trades : {trades_baseline}")
    print(f"\n{'Layer':<22} {'Verdict':<15} {'DELTA_DSR':>10}  {'DELTA_T':>8}")
    print(f"{'-' * 60}")
    for row in layer_rows:
        ddr = f"{row.get('delta_dsr'):+.4f}" if row.get("delta_dsr") is not None else "N/A"
        dt = str(row.get("delta_trades", "N/A"))
        print(
            f"  {row['layer']:<20} {row.get('verdict', '?'):<15} {ddr:>10}  {dt:>8}"
        )
    print(f"\n{'Verdict counts:'} {verdict_counts}")
    print(f"\nNO_TRADE hypothesis: {no_trade_hypothesis['note']}")
    print(f"\nFull report: {out_path}")
    print(f"GOVERNANCE: {GOVERNANCE_LABEL['authority']}")
    print(f"{'=' * 68}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
