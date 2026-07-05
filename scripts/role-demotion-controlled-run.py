#!/usr/bin/env python3
"""role-demotion-controlled-run.py — THE CONTROLLED RUN for the Hard-Constraint Demotion
Experiment (docs/designs/hard-constraint-demotion-experiment-2026-07-05.md, Sections 3-6).

REUSES, DOES NOT REBUILD: imports `simulate_measurement_trades` + the timeframe/lookback constants
+ `derive_family` directly from `scripts/fvg-experiment-controlled-run.py` (via importlib, same
technique `composition-experiment-controlled-run.py` and `or-branches-experiment-controlled-run.py`
already use) — so the measurement instrument (fixed 1.5xATR stop / 3.0xATR target / 60-bar
time-stop bracket) and the data loading path (`src.engine.data_loader.load_ohlcv`) are
BYTE-IDENTICAL across every prior experiment and this one — required for comparability.

SIX ARMS, ONE ENV VAR (TF_ROLE_DEMOTION_MODE): off, struct_conf, struct_alt, struct_ctx,
struct_all, exec_all. Unlike the OR-branches / composition experiments, NO per-strategy eligibility
targeting is needed — every strategy in the 42-strategy / 14-family corpus
(docs/designs/dri-audit-42-strategies-corpus.json, ×3-symbol fan-out over exactly the 14 videos in
docs/replay-results/dri-audit-2026-07-05.json) has >=1 audited condition, so all 42 are in scope for
ALL arms (there is no "non-target control" subset in this experiment — see the conjunction-depth
script's mediator-gate report for the per-strategy/per-arm depth breakdown that IS the eligibility
signal here).

Computes, per (strategy, arm):
  - n_entry_signals, zero_trade (bool)
  - firing_rate: rolling 100-bar-block signal count (mean per block) + overall per-100-bar rate,
    reported both per-strategy and aggregated per-instrument (symbol) — spec Section 4/5.
  - trades (via simulate_measurement_trades) for the SDS / paired-delta instruments downstream.
  - revival (0 -> >0 relative to "off") per structural/exec arm.

Byte-identical proof (spec's flag-gated requirement): for EVERY strategy, "off" mode (explicit env
var) must produce IDENTICAL entry_long/entry_short arrays to the SAME strategy built with
TF_ROLE_DEMOTION_MODE entirely UNSET — verified per strategy, violations collected and reported
(must be empty).

Outputs manifests in the SAME `{strategies: {...}}` shape signature-divergence.py /
composition-paired-delta.py already consume, one manifest per arm, so the existing statistical
instruments can be run directly on this experiment's output with zero changes.

Usage (tower, PYTHONPATH=. + AWS creds from .env):
  PYTHONPATH=. TF_ALLOW_FIXED_1=true python scripts/role-demotion-controlled-run.py \\
      --strategies docs/designs/dri-audit-42-strategies-corpus.json \\
      --out-dir docs/replay-results/role-demotion-manifests \\
      --report-out docs/replay-results/role-demotion-experiment-run-report.json
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.engine.data_loader import load_ohlcv  # noqa: E402
from src.engine.indicators.core import compute_atr  # noqa: E402
from src.engine.spec_condition_compiler import from_compiled_spec  # noqa: E402

# ─── Reuse (not rebuild) the increment-1 rig's measurement bracket + constants ─────────────────
_fvg_rig_spec = importlib.util.spec_from_file_location(
    "fvg_experiment_controlled_run", REPO_ROOT / "scripts" / "fvg-experiment-controlled-run.py"
)
assert _fvg_rig_spec is not None and _fvg_rig_spec.loader is not None
_fvg_rig = importlib.util.module_from_spec(_fvg_rig_spec)
_fvg_rig_spec.loader.exec_module(_fvg_rig)

simulate_measurement_trades = _fvg_rig.simulate_measurement_trades
TIMEFRAME_LOOKBACK_DAYS = _fvg_rig.TIMEFRAME_LOOKBACK_DAYS
DEFAULT_LOOKBACK_DAYS = _fvg_rig.DEFAULT_LOOKBACK_DAYS
GLOBAL_END_DATE = _fvg_rig.GLOBAL_END_DATE
TF_TO_LOADER = _fvg_rig.TF_TO_LOADER
ATR_PERIOD = _fvg_rig.ATR_PERIOD
derive_family = _fvg_rig.derive_family

ARMS: tuple[str, ...] = ("off", "struct_conf", "struct_alt", "struct_ctx", "struct_all", "exec_all")
FIRING_BLOCK_SIZE: int = 100  # spec §4/§5: "rolling 100-bar blocks, per-instrument normalized"


def _lookback_start(timeframe: str) -> str:
    from datetime import datetime, timedelta

    days = TIMEFRAME_LOOKBACK_DAYS.get(timeframe, DEFAULT_LOOKBACK_DAYS)
    end = datetime.strptime(GLOBAL_END_DATE, "%Y-%m-%d")
    start = end - timedelta(days=days)
    return start.strftime("%Y-%m-%d")


def compute_firing_rate(entry_long: np.ndarray, entry_short: np.ndarray, block_size: int = FIRING_BLOCK_SIZE) -> dict:
    """Rolling `block_size`-bar-block firing rate (spec §4/§5). Non-overlapping blocks (a
    partition, not a sliding window) — cheap, deterministic, and equivalent in the mean to a
    sliding-window rate for a uniform-frequency signal; the LAST partial block (if any) is
    included as-is (its own signal count, not padded) since dropping it would silently discard
    real trailing bars."""
    signals = (entry_long | entry_short).astype(np.int64)
    n = len(signals)
    if n == 0:
        return {"n_bars": 0, "n_blocks": 0, "mean_signals_per_block": None, "overall_rate_per_100_bars": None}
    block_counts = [int(signals[i : i + block_size].sum()) for i in range(0, n, block_size)]
    overall_rate = float(signals.sum()) / n * block_size
    return {
        "n_bars": n,
        "n_blocks": len(block_counts),
        "mean_signals_per_block": float(np.mean(block_counts)),
        "overall_rate_per_100_bars": overall_rate,
    }


def run_one_strategy_one_arm(entry: dict, df, atr: np.ndarray, arm: str) -> dict:
    strat = entry["strategy"]
    compiled_spec = entry["compiled_spec"]
    name = strat["name"]
    symbol = strat["symbol"]
    timeframe = strat["timeframe"]

    prior = os.environ.get("TF_ROLE_DEMOTION_MODE")
    os.environ["TF_ROLE_DEMOTION_MODE"] = arm
    try:
        strategy = from_compiled_spec(compiled_spec, symbol=symbol, timeframe=timeframe, strategy_name=name)
        conjunction_depth = strategy.conjunction_depth()
        out = strategy.compute(df)
        entry_long = out["entry_long"].to_numpy()
        entry_short = out["entry_short"].to_numpy()
        trades = simulate_measurement_trades(df, entry_long, entry_short, atr)
    finally:
        if prior is None:
            os.environ.pop("TF_ROLE_DEMOTION_MODE", None)
        else:
            os.environ["TF_ROLE_DEMOTION_MODE"] = prior

    n_signals = int(entry_long.sum() + entry_short.sum())
    firing = compute_firing_rate(entry_long, entry_short)
    return {
        "name": name,
        "symbol": symbol,
        "timeframe": timeframe,
        "family": derive_family(name, symbol, timeframe),
        "conjunction_depth": conjunction_depth,
        "n_entry_signals": n_signals,
        "zero_trade": n_signals == 0,
        "firing": firing,
        "trades": trades,
        "entry_long": entry_long,
        "entry_short": entry_short,
    }


def _off_mode_env_unset(entry: dict, df, atr: np.ndarray) -> dict:
    """Byte-identical proof helper: build the SAME strategy with TF_ROLE_DEMOTION_MODE entirely
    ABSENT from the environment (not merely set to "off") — the strictest form of "default OFF"
    proof."""
    strat = entry["strategy"]
    compiled_spec = entry["compiled_spec"]
    name = strat["name"]
    symbol = strat["symbol"]
    timeframe = strat["timeframe"]

    prior = os.environ.pop("TF_ROLE_DEMOTION_MODE", None)
    try:
        strategy = from_compiled_spec(compiled_spec, symbol=symbol, timeframe=timeframe, strategy_name=name)
        out = strategy.compute(df)
        entry_long = out["entry_long"].to_numpy()
        entry_short = out["entry_short"].to_numpy()
    finally:
        if prior is not None:
            os.environ["TF_ROLE_DEMOTION_MODE"] = prior

    return {"entry_long": entry_long, "entry_short": entry_short}


def _load_checkpoint(path: Path) -> dict[str, dict]:
    """Loads a JSONL checkpoint (one strategy's full result per line) into
    {name: record}. Crash-tolerant: a truncated final line (process killed
    mid-write) is skipped, not fatal."""
    done: dict[str, dict] = {}
    if not path.exists():
        return done
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue  # truncated last line from a prior kill — skip, not fatal
            name = rec.get("name")
            if name:
                done[name] = rec
    return done


def _append_checkpoint(path: Path, rec: dict) -> None:
    """Appends ONE strategy's full result as a single JSON line and flushes +
    fsyncs immediately — so a kill anywhere after this call preserves this
    strategy's result. This is what makes the run resumable/crash-tolerant
    (the earlier version only wrote manifests/report at the very END of the
    loop, so a kill at strategy 19/42 lost all 19 strategies' work)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, default=str))
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())


def _build_outputs_from_checkpoint(checkpoint: dict[str, dict], out_dir: Path, report_out: Path, n_total: int) -> dict:
    """Rebuilds the final manifests-per-arm + run-report from WHATEVER is in the
    checkpoint right now — safe to call after a partial run; safe to call again
    after more strategies are appended. Never recomputes anything (pure read +
    reshape of already-computed per-strategy records)."""
    manifests: dict[str, dict[str, dict]] = {arm: {} for arm in ARMS}
    per_strategy_report: list[dict] = []
    byte_identical_violations: list[str] = []

    for name, rec in checkpoint.items():
        per_strategy_report.append(rec)
        if rec.get("error"):
            continue
        if not rec.get("off_matches_env_unset", True):
            byte_identical_violations.append(name)
        for arm in ARMS:
            frag = rec.get("manifest_fragment", {}).get(arm)
            if frag:
                manifests[arm][name] = frag

    out_dir.mkdir(parents=True, exist_ok=True)
    for arm in ARMS:
        out_path = out_dir / f"manifest-{arm}.json"
        out_path.write_text(json.dumps({"strategies": manifests[arm]}, default=str), encoding="utf-8")

    per_symbol: dict[str, dict] = {}
    for rec in per_strategy_report:
        if rec.get("error"):
            continue
        sym = rec["symbol"]
        per_symbol.setdefault(sym, {arm: {"firing_rates": [], "n_zero_trade": 0, "n_revival": 0, "n": 0} for arm in ARMS})
        for arm in ARMS:
            bucket = per_symbol[sym][arm]
            bucket["n"] += 1
            rate = rec["firing"][arm]["overall_rate_per_100_bars"]
            if rate is not None:
                bucket["firing_rates"].append(rate)
            if rec["zero_trade"][arm]:
                bucket["n_zero_trade"] += 1
            if arm != "off" and rec["revival_vs_off"].get(arm):
                bucket["n_revival"] += 1

    per_symbol_summary: dict[str, dict] = {}
    for sym, arms_data in per_symbol.items():
        per_symbol_summary[sym] = {}
        for arm, bucket in arms_data.items():
            rates = bucket["firing_rates"]
            per_symbol_summary[sym][arm] = {
                "n_strategies": bucket["n"],
                "mean_firing_rate_per_100_bars": (float(np.mean(rates)) if rates else None),
                "n_zero_trade": bucket["n_zero_trade"],
                "n_revival_vs_off": bucket["n_revival"],
            }

    corpus_wide: dict[str, dict] = {}
    for arm in ARMS:
        rates = [rec["firing"][arm]["overall_rate_per_100_bars"] for rec in per_strategy_report if not rec.get("error") and rec["firing"][arm]["overall_rate_per_100_bars"] is not None]
        n_zero = sum(1 for rec in per_strategy_report if not rec.get("error") and rec["zero_trade"][arm])
        n_revival = sum(1 for rec in per_strategy_report if not rec.get("error") and arm != "off" and rec["revival_vs_off"].get(arm))
        corpus_wide[arm] = {
            "mean_firing_rate_per_100_bars": (float(np.mean(rates)) if rates else None),
            "n_zero_trade": n_zero,
            "n_revival_vs_off": (n_revival if arm != "off" else None),
        }

    n_ok = sum(1 for r in per_strategy_report if not r.get("error"))
    report = {
        "n_total": n_total,
        "n_checkpointed": len(checkpoint),
        "n_ok": n_ok,
        "n_errors": len(checkpoint) - n_ok,
        "n_remaining": n_total - len(checkpoint),
        "arms": list(ARMS),
        "n_byte_identical_violations": len(byte_identical_violations),
        "byte_identical_violations": byte_identical_violations,
        "corpus_wide": corpus_wide,
        "per_symbol": per_symbol_summary,
        "per_strategy": per_strategy_report,
    }
    report_out.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--strategies", default="docs/designs/dri-audit-42-strategies-corpus.json")
    ap.add_argument("--out-dir", default="docs/replay-results/role-demotion-manifests")
    ap.add_argument("--report-out", default="docs/replay-results/role-demotion-experiment-run-report.json")
    ap.add_argument("--checkpoint", default="docs/replay-results/role-demotion-checkpoint.jsonl")
    ap.add_argument("--limit", type=int, default=None, help="cap total corpus size considered (for smoke tests)")
    ap.add_argument("--max-new", type=int, default=None, help="process at most this many NOT-YET-checkpointed strategies this invocation, then stop (bounds per-invocation wall-clock)")
    ap.add_argument("--finalize-only", action="store_true", help="skip computation entirely; just rebuild manifests+report from the existing checkpoint")
    args = ap.parse_args()

    corpus = json.loads(Path(args.strategies).read_text(encoding="utf-8"))
    entries = corpus
    if args.limit:
        entries = entries[: args.limit]

    out_dir = Path(args.out_dir)
    checkpoint_path = Path(args.checkpoint)
    checkpoint = _load_checkpoint(checkpoint_path)

    if args.finalize_only:
        report = _build_outputs_from_checkpoint(checkpoint, out_dir, Path(args.report_out), len(entries))
        print(
            f"finalize-only: {report['n_checkpointed']}/{report['n_total']} checkpointed "
            f"({report['n_ok']} ok, {report['n_errors']} errors, {report['n_remaining']} remaining)\n"
            f"wrote manifests to {out_dir}, report to {args.report_out}",
            file=sys.stderr,
        )
        return 0

    todo = [e for e in entries if e["strategy"]["name"] not in checkpoint]
    print(
        f"role-demotion-controlled-run: {len(entries)} strategies total, {len(checkpoint)} already checkpointed, "
        f"{len(todo)} remaining, {len(ARMS)} arms each",
        file=sys.stderr,
    )
    if args.max_new is not None:
        todo = todo[: args.max_new]
        print(f"this invocation will process at most {len(todo)} NEW strategies (--max-new={args.max_new})", file=sys.stderr)

    data_cache: dict[tuple[str, str], Any] = {}

    for idx, entry in enumerate(todo):
        strat = entry["strategy"]
        name = strat["name"]
        symbol = strat["symbol"]
        timeframe = strat["timeframe"]
        t0 = time.time()

        rec: dict[str, Any] = {"name": name, "symbol": symbol, "timeframe": timeframe}
        try:
            key = (symbol, timeframe)
            if key not in data_cache:
                start = _lookback_start(timeframe)
                data_cache[key] = load_ohlcv(symbol, TF_TO_LOADER.get(timeframe, timeframe), start, GLOBAL_END_DATE)
            df = data_cache[key]
            atr = compute_atr(df, ATR_PERIOD).to_numpy()

            arm_results: dict[str, dict] = {}
            for arm in ARMS:
                arm_results[arm] = run_one_strategy_one_arm(entry, df, atr, arm)

            # Byte-identical proof: "off" (explicit) vs env-var-entirely-unset.
            unset_result = _off_mode_env_unset(entry, df, atr)
            off_matches_unset = (
                arm_results["off"]["entry_long"].tolist() == unset_result["entry_long"].tolist()
                and arm_results["off"]["entry_short"].tolist() == unset_result["entry_short"].tolist()
            )

            manifest_fragment = {
                arm: {
                    "name": name,
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "family": arm_results[arm]["family"],
                    "trades": arm_results[arm]["trades"],
                }
                for arm in ARMS
            }

            rec.update(
                {
                    "n_bars": len(df),
                    "off_matches_env_unset": off_matches_unset,
                    "conjunction_depth": {arm: arm_results[arm]["conjunction_depth"] for arm in ARMS},
                    "n_entry_signals": {arm: arm_results[arm]["n_entry_signals"] for arm in ARMS},
                    "zero_trade": {arm: arm_results[arm]["zero_trade"] for arm in ARMS},
                    "revival_vs_off": {
                        arm: bool(arm_results["off"]["zero_trade"] and not arm_results[arm]["zero_trade"])
                        for arm in ARMS
                        if arm != "off"
                    },
                    "firing": {arm: arm_results[arm]["firing"] for arm in ARMS},
                    "manifest_fragment": manifest_fragment,
                    "elapsed_seconds": round(time.time() - t0, 2),
                    "error": None,
                }
            )
        except Exception as exc:  # noqa: BLE001 — one bad strategy must not kill the batch
            rec["error"] = f"{type(exc).__name__}: {exc}"
            rec["traceback"] = traceback.format_exc()[-2000:]
            rec["elapsed_seconds"] = round(time.time() - t0, 2)

        _append_checkpoint(checkpoint_path, rec)
        checkpoint[name] = rec
        print(
            f"  [{idx + 1}/{len(todo)} this-run | {len(checkpoint)}/{len(entries)} total] {name}: "
            f"{rec.get('error') or 'OK'} ({rec['elapsed_seconds']}s)",
            file=sys.stderr,
        )

    report = _build_outputs_from_checkpoint(checkpoint, out_dir, Path(args.report_out), len(entries))
    print(
        f"\nthis run processed {len(todo)} new strategies. "
        f"cumulative: {report['n_checkpointed']}/{report['n_total']} checkpointed "
        f"({report['n_ok']} ok, {report['n_errors']} errors, {report['n_remaining']} remaining)\n"
        f"byte-identical violations={report['n_byte_identical_violations']} (must be 0)\n"
        f"wrote {len(ARMS)} manifests to {out_dir}, report to {args.report_out}\n"
        f"checkpoint: {checkpoint_path}",
        file=sys.stderr,
    )
    if report["n_remaining"] > 0:
        print(f"\n{report['n_remaining']} strategies remain — re-run the same command to continue (checkpoint resumes automatically).", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
