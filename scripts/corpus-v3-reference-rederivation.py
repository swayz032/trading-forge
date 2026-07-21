#!/usr/bin/env python3
"""corpus-v3-reference-rederivation.py — Corpus v3 Gate 3, REFERENCE RE-DERIVATION (new critical path).

Per docs/designs/corpus-v3-gate1-respecification-2026-07-05.md "DEFECT 5 + RULINGS", Ruling 2:
Defect 5 (verified 8cd2885 / phase-0 34fabc6) proved `run_class_backtest` never applied the E.3
stop-ceiling / E.5 15:55 time-stop / E.4 DLL-halt guards -- every historical class-path run,
including the frozen role-demotion-experiment-run-report.json's 9-strategy revival reference, was
measured on a guard-less engine. That reference is now invalid; Ruling 2 requires it be RE-DERIVED
on the guard-fixed engine BEFORE any verdict is read. READ ORDER LOCKED: reference -> validity -> verdict.

This script does ONLY the reference re-derivation. It does NOT read or report the classifier Gate 3
verdict (docs/replay-results/corpus-v3-gate3-shadow-results-2026-07-05.json) -- that is a separate,
later, gated read per the calling task's explicit instruction.

Design (mirrors scripts/corpus-v3-shadow-gate3.py's proven pinned-manifest + validity-block pattern,
but the axis under test here is the RUNTIME DEMOTION FLAG, not the classifier):
  - BASELINE arm: v2 compiled_spec (.claude/worktrees/extraction-100/corpus/specs/<video>.spec.json),
    TF_ROLE_DEMOTION_MODE UNSET (production default today).
  - DEMOTION arm: the SAME v2 compiled_spec, TF_ROLE_DEMOTION_MODE=struct_ctx (CONTEXTUAL-only
    runtime demotion -- the arm the original 1ab7321-adjacent experiment measured as dominant).
  - Both invoked via `python -m src.engine.backtester --config <config.json> --mode single`
    (src/engine/backtester.py:7832, the exact production CLI a real /api/backtests request drives,
    compiled_spec dispatch path at line 7985) -- i.e. through run_class_backtest, the NOW-GUARD-FIXED
    path (Defect 4/5/6, commit 8cd2885 / phase-0 34fabc6).
  - 14 concepts x 3 symbols (MES/MNQ/MCL) = 42 strategies -- IDENTICAL pinned manifest to the Gate 3
    shadow run (same CONCEPTS dict, same date window) so this reference and the (separate, later)
    classifier verdict are apples-to-apples on corpus shape.
  - N = the set of strategies that go zero-trade (BASELINE) -> nonzero (DEMOTION). This is the
    RE-DERIVED reference the classifier's Gate 3 (≥(N-1)/N revival) will be checked against.

Usage: PYTHONPATH=. TF_ALLOW_FIXED_1=true python scripts/corpus-v3-reference-rederivation.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
WORKTREE = REPO_ROOT / ".claude/worktrees/extraction-100"
V2_SPEC_DIR = WORKTREE / "corpus/specs"
OUT_RESULTS = REPO_ROOT / "docs/replay-results/corpus-v3-reference-rederivation-2026-07-06.json"
# CHECKPOINT (resumability): the harness's 900s-per-call timeout × 84 calls can run long enough
# for the outer process to be killed by the environment before all 42 pairs finish (observed:
# first attempt was killed mid-run at the 1min-timeframe concept). Append one JSON line per
# COMPLETED pair, flushed immediately, so a killed-and-relaunched run skips already-done pairs
# instead of re-measuring them (idempotent — re-measuring would also be a valid re-run, but
# skipping is faster and avoids wasting the slow 1min-timeframe calls twice).
CHECKPOINT = REPO_ROOT / "docs/replay-results/corpus-v3-reference-rederivation-checkpoint.jsonl"

# Pinning manifest -- IDENTICAL to scripts/corpus-v3-shadow-gate3.py's CONCEPTS dict (same 14-concept
# corpus shape the Gate 3 classifier run uses), so N is directly comparable to that run's denominator.
CONCEPTS: dict[str, tuple[str, str]] = {
    "75DJN5UVQnw": ("S/R", "5m"),
    "jlShztsY3oA": ("ORB", "5m"),
    "c8VLqF0XDR4": ("entry", "15m"),
    "HfZTCZTDfWk": ("bias", "4h"),
    "FqxEKDxemtI": ("BB", "5m"),
    "snNkQSyWX4k": ("MA-x", "5m"),
    "sVkmZklJDHI": ("risk", "1m"),
    "N7uP9V0Iktc": ("EMA", "5m"),
    "KXWRtV2LOVc": ("OB", "5m"),
    "m-G1ag77aVc": ("disc/prem", "30m"),
    "UBvfsImdI2U": ("CRT", "1h"),
    "NMUd0oX_7Pg": ("candle", "5m"),
    "ktkqq7QsN9Q": ("VWAP", "15m"),
    "oDLt9zh33LE": ("ORB", "5m"),
}

# The ORIGINAL frozen "9" (role-demotion-experiment-run-report.json, struct_ctx arm, guard-LESS
# engine) -- 3 families x 3 symbols. ORB has two candidate videos (jlShztsY3oA + oDLt9zh33LE, both
# tagged ORB/5m); per corpus-v3-shadow-gate3.py's documented ambiguity, both are tested here too.
ORIGINAL_9_FAMILY_TO_VIDEO = {
    "discount_price_to_buy_from": "m-G1ag77aVc",
    "crossover": "snNkQSyWX4k",
    "opening_range_breakout_orb": ["jlShztsY3oA", "oDLt9zh33LE"],  # ambiguous -- both tested
}

TF_ENGINE = {"1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1hour", "4h": "4hour"}
SYMBOLS = ["MES", "MNQ", "MCL"]

# IDENTICAL date window to the Gate 3 shadow run (GATE3-DEFECT-2 fix already applied there: avoids
# the 2020-04-20/21 negative-oil-price MCL data-quality trip). Both arms here use the SAME window
# (only the env flag differs), so date-range is not a confound.
START_DATE = "2020-06-01"
END_DATE = "2026-07-01"

# Engine SHA this reference is pinned to (guard-fixed class path). Verified ancestor-equal to
# ENGINE_SHA_PIN="8cd2885" in corpus-v3-shadow-gate3.py (identical diff content, different hash
# because the commit was re-landed onto phase-0 as 34fabc6d).
#
# RE-STAMPED 2026-07-06 (Gate 3 re-run protocol, Defect-6 cycle): HEAD is now
# 75208e156dd6 (d22ea4b MCL-reconciliation fix (Defect 6) + 75208e1 its
# regression test). src/engine/backtester.py content is unchanged between
# d22ea4b and 75208e1 (the second commit only adds a test file) -- this
# reference re-derivation runs against the Defect-6-fixed run_class_backtest.
ENGINE_SHA_PIN = "75208e156dd6 (backtester.py content == d22ea4b, Defect-6 MCL reconciliation fix)"


def load_spec_artifact(video: str) -> dict | None:
    p = V2_SPEC_DIR / f"{video}.spec.json"
    if not p.exists():
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def run_backtest(compiled_spec: dict, symbol: str, timeframe_engine: str, name: str, demotion_mode: str | None) -> dict:
    """Invoke the production CLI exactly as backtest-service.ts would (compiled_spec dispatch path,
    src/engine/backtester.py:7787-ish -> run_class_backtest). `demotion_mode` is None for BASELINE
    (env var left unset) or "struct_ctx" for the DEMOTION arm."""
    config = {
        "compiled_spec": compiled_spec,
        "strategy": {"symbol": symbol, "timeframe": timeframe_engine, "name": name},
        "start_date": START_DATE,
        "end_date": END_DATE,
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tf:
        json.dump(config, tf)
        cfg_path = tf.name
    env = dict(os.environ)
    env["PYTHONPATH"] = str(REPO_ROOT)
    env["TF_ALLOW_FIXED_1"] = "true"  # research-harness measurement only -- this reference measures
    # whether the strategy TRADES (n_trades>0), not P&L sizing, so fixed_contracts=1 default is
    # immaterial to the revival question.
    if demotion_mode is None:
        env.pop("TF_ROLE_DEMOTION_MODE", None)
    else:
        env["TF_ROLE_DEMOTION_MODE"] = demotion_mode
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "src.engine.backtester", "--config", cfg_path, "--mode", "single"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=900,  # same generous envelope as the Gate 3 shadow run (GATE3-DEFECT-3 fix)
            env=env,
        )
        stdout = proc.stdout.strip()
        last_line = ""
        for line in stdout.splitlines():
            line = line.strip()
            if line:
                last_line = line
        if not last_line:
            # Distinguish a GENUINE engine-raised exception (deterministic -- e.g. the
            # backtester's own reconciliation-tolerance check raising ValueError; same
            # class as the FROZEN FINDING's MES-15m/$52.67 precedent) from an opaque
            # instrument crash (segfault, OOM-kill, hang) where stderr carries no Python
            # traceback. A genuine engine exception is a real MEASUREMENT (this pair is
            # INDETERMINATE on this engine/date-window) and should NOT be silently
            # retried forever as if it might succeed next time -- it won't, the inputs
            # are identical every call. An opaque crash MIGHT be transient and is worth
            # retrying on a relaunch.
            stderr_tail = proc.stderr[-3000:]
            if "Traceback (most recent call last):" in proc.stderr:
                # Extract the final exception line (last non-empty line of the traceback)
                last_exc_line = ""
                for line in proc.stderr.splitlines():
                    line = line.strip()
                    if line:
                        last_exc_line = line
                if "RECONCILIATION FAILED" in proc.stderr:
                    err_tag = "reconciliation_failed"
                else:
                    err_tag = "engine_exception"
                return {
                    "error": err_tag, "exception_line": last_exc_line[:500],
                    "stderr_tail": stderr_tail, "returncode": proc.returncode,
                }
            return {"error": "no_stdout", "stderr_tail": stderr_tail, "returncode": proc.returncode}
        try:
            return json.loads(last_line)
        except json.JSONDecodeError:
            return {"error": "unparseable_stdout", "raw_tail": stdout[-2000:], "stderr_tail": proc.stderr[-2000:]}
    except subprocess.TimeoutExpired:
        return {"error": "timeout"}
    finally:
        Path(cfg_path).unlink(missing_ok=True)


def n_trades(result: dict) -> int | None:
    if "error" in result:
        return None
    trades = result.get("trades")
    if trades is None:
        return None
    return len(trades)


def _is_terminal_status(status: str | None) -> bool:
    """True if this arm's checkpointed status should NOT be retried on resume.
    "ok" obviously terminal. "engine_error:*" (reconciliation_failed / engine_exception)
    is ALSO terminal -- these are genuine, deterministic engine-raised findings (same
    inputs will raise the same exception every time; see the jlShztsY3oA_MCL /
    c8VLqF0XDR4_MCL RECONCILIATION FAILED discovery this run), not opaque instrument
    crashes. Only "crash:*" (no_stdout/unparseable_stdout with no traceback) and
    "timeout" are retried -- those MIGHT be transient (resource contention from running
    several pairs in parallel) and are worth another attempt on relaunch."""
    if status is None:
        return False
    return status == "ok" or status.startswith("engine_error:")


def call_status(result: dict) -> str:
    """Same classification convention as corpus-v3-shadow-gate3.py::call_status -- distinguishes a
    genuine instrument crash/timeout from a clean JSON result (including one that itself carries an
    engine-level "error" field, tagged distinctly as engine_error so it isn't folded into "crash")."""
    err = result.get("error")
    if err is None:
        return "ok"
    if err == "timeout":
        return "timeout"
    if err in ("no_stdout", "unparseable_stdout"):
        return f"crash:{err}"
    return f"engine_error:{err}"


def load_arm_checkpoint() -> dict[tuple[str, str, str], dict]:
    """Load already-completed ARMS (not pairs) from the checkpoint file. Arm-level
    granularity (not pair-level) matters because a single 1min-timeframe call takes
    ~700-900s -- close to whatever wall-clock ceiling killed the first monolithic run
    (observed: killed ~25-30min in, mid-pair, at the 1min-timeframe concept). Keying by
    arm lets a Bash invocation be scoped to exactly ONE subprocess.run() call via
    --only-video/--only-symbol/--only-arm, each safely under any per-call time ceiling.
    Returns {(video, symbol, arm): row}."""
    out: dict[tuple[str, str, str], dict] = {}
    if not CHECKPOINT.exists():
        return out
    with open(CHECKPOINT, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                # Defensive: a concurrent parallel writer (multiple --only-video instances
                # appending to the same file to use idle cores) could in principle interleave
                # a partial line. Skip and re-run rather than crash -- the missing arm will
                # just be recomputed on the next pass over this (video, symbol, arm).
                print(f"[checkpoint] WARNING: skipping malformed line: {line[:120]!r}", file=sys.stderr)
                continue
            out[(row["video"], row["symbol"], row["arm"])] = row
    return out


def append_arm_checkpoint(video: str, symbol: str, arm: str, tag: str, tf_label: str, result: dict) -> None:
    row = {
        "video": video, "symbol": symbol, "arm": arm, "tag": tag, "tf_label": tf_label,
        "n_trades": n_trades(result), "error": result.get("error"), "status": call_status(result),
        "exception_line": result.get("exception_line"),  # diagnostic only, for engine_exception/reconciliation_failed
    }
    with open(CHECKPOINT, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, default=str) + "\n")
        f.flush()
        os.fsync(f.fileno())


def run_one_arm(video: str, symbol: str, arm: str, tag: str, tf_label: str) -> None:
    """Run exactly ONE (video, symbol, arm) subprocess.run() call and checkpoint it.
    Used both by the full loop (main()) and by direct CLI invocation
    (--only-video/--only-symbol/--only-arm) for time-bounding a single Bash call to
    one subprocess.run() -- essential for the 1min-timeframe concept where a single
    call takes ~700-900s."""
    v2_artifact = load_spec_artifact(video)
    if v2_artifact is None:
        print(f"ABORT: missing v2 spec for {video}", file=sys.stderr)
        sys.exit(2)
    tf_engine = TF_ENGINE[tf_label]
    name = f"refre_{video}_{symbol.lower()}_{tf_label}_{arm}"
    demotion_mode = None if arm == "baseline" else "struct_ctx"
    print(f"[{video}_{symbol}:{arm}] running ({tf_engine})...", file=sys.stderr)
    result = run_backtest(v2_artifact, symbol, tf_engine, name, demotion_mode=demotion_mode)
    append_arm_checkpoint(video, symbol, arm, tag, tf_label, result)
    print(f"  {arm} n_trades={n_trades(result)} status={call_status(result)}", file=sys.stderr)


def build_pairs_from_arms(arm_map: dict[tuple[str, str, str], dict]) -> tuple[dict[str, dict], dict[str, dict]]:
    """Assemble pair-level per_pair/per_pair_status dicts from whatever arms are
    currently checkpointed. A pair only appears once BOTH its baseline and demotion
    arms are present."""
    per_pair: dict[str, dict] = {}
    per_pair_status: dict[str, dict] = {}
    for video, (tag, tf_label) in CONCEPTS.items():
        for symbol in SYMBOLS:
            b = arm_map.get((video, symbol, "baseline"))
            d = arm_map.get((video, symbol, "demotion"))
            if b is None or d is None:
                continue
            key = f"{video}_{symbol}"
            b_n, d_n = b["n_trades"], d["n_trades"]
            per_pair_status[key] = {"baseline": b["status"], "demotion": d["status"]}
            per_pair[key] = {
                "video": video, "tag": tag, "symbol": symbol, "timeframe": tf_label,
                "baseline_n_trades": b_n, "baseline_error": b["error"],
                "demotion_n_trades": d_n, "demotion_error": d["error"],
                "baseline_zero_trade": (b_n == 0) if b_n is not None else None,
                "demotion_zero_trade": (d_n == 0) if d_n is not None else None,
            }
    return per_pair, per_pair_status


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--only-video", default=None, help="Restrict to one concept video id (time-bounding).")
    parser.add_argument("--only-symbol", default=None, choices=SYMBOLS, help="Restrict to one symbol (requires --only-video).")
    parser.add_argument("--only-arm", default=None, choices=["baseline", "demotion"], help="Restrict to one arm (requires --only-video + --only-symbol).")
    parser.add_argument("--summarize-only", action="store_true", help="Skip running anything; just assemble+write the summary from whatever is checkpointed so far (partial/final report).")
    args = parser.parse_args()

    missing = [v for v in CONCEPTS if not (V2_SPEC_DIR / f"{v}.spec.json").exists()]
    if missing:
        print(f"ABORT: missing v2 specs for: {missing}", file=sys.stderr)
        sys.exit(2)

    if args.only_video is not None:
        if args.only_video not in CONCEPTS:
            print(f"ABORT: unknown video {args.only_video}", file=sys.stderr)
            sys.exit(2)
        tag, tf_label = CONCEPTS[args.only_video]
        symbols = [args.only_symbol] if args.only_symbol else SYMBOLS
        arms = [args.only_arm] if args.only_arm else ["baseline", "demotion"]
        arm_map = load_arm_checkpoint()
        for symbol in symbols:
            for arm in arms:
                existing = arm_map.get((args.only_video, symbol, arm))
                if existing is not None and _is_terminal_status(existing.get("status")):
                    print(f"[{args.only_video}_{symbol}:{arm}] already checkpointed ({existing.get('status')}), skipping", file=sys.stderr)
                    continue
                if existing is not None:
                    print(f"[{args.only_video}_{symbol}:{arm}] RETRYING (previous status={existing.get('status')})", file=sys.stderr)
                run_one_arm(args.only_video, symbol, arm, tag, tf_label)
        return

    arm_map = load_arm_checkpoint()
    per_pair, per_pair_status = build_pairs_from_arms(arm_map)
    if per_pair:
        print(f"[checkpoint] resuming — {len(per_pair)}/42 pairs already completed, skipping those", file=sys.stderr)

    if not args.summarize_only:
        for video, (tag, tf_label) in CONCEPTS.items():
            for symbol in SYMBOLS:
                key = f"{video}_{symbol}"
                # BUGFIX: the previous check (`if key in per_pair: continue`) skipped a pair
                # the moment BOTH arms had ANY result, including a non-"ok" crash/error --
                # which meant a crashed pair (e.g. jlShztsY3oA_MCL / c8VLqF0XDR4_MCL, both
                # RECONCILIATION FAILED) was silently never retried because build_pairs_from_arms
                # doesn't filter by status. Must check both underlying arms' TERMINAL status,
                # not mere presence in per_pair.
                b_status = arm_map.get((video, symbol, "baseline"), {}).get("status")
                d_status = arm_map.get((video, symbol, "demotion"), {}).get("status")
                if _is_terminal_status(b_status) and _is_terminal_status(d_status):
                    print(f"[{key}] skipping (resolved: baseline={b_status}, demotion={d_status})", file=sys.stderr)
                    continue
                for arm in ("baseline", "demotion"):
                    existing = arm_map.get((video, symbol, arm))
                    if existing is not None and _is_terminal_status(existing.get("status")):
                        continue
                    if existing is not None:
                        print(f"[{video}_{symbol}:{arm}] RETRYING (previous status={existing.get('status')})", file=sys.stderr)
                    run_one_arm(video, symbol, arm, tag, tf_label)
                    arm_map = load_arm_checkpoint()  # refresh (cheap; file is small)
        # Rebuild after the loop in case new arms completed
        arm_map = load_arm_checkpoint()
        per_pair, per_pair_status = build_pairs_from_arms(arm_map)

    # ── VALIDITY BLOCK (standing methodology requirement per the Gate 3 re-run protocol) — computed
    # and reported BEFORE any reference/revival numbers.
    all_call_statuses = [s for pair in per_pair_status.values() for s in pair.values()]
    _n_crashes = sum(1 for s in all_call_statuses if s.startswith("crash:"))
    _n_timeouts = sum(1 for s in all_call_statuses if s == "timeout")
    _n_engine_errors = sum(1 for s in all_call_statuses if s.startswith("engine_error:"))

    def _pair_clean(key: str) -> bool:
        st = per_pair_status.get(key)
        return bool(st) and st["baseline"] == "ok" and st["demotion"] == "ok"

    all_pairs_measurable = all(_pair_clean(k) for k in per_pair)
    all_42_present = len(per_pair) == 42

    validity = {
        "crashes": _n_crashes,
        "exceptions": _n_engine_errors,
        "timeouts": _n_timeouts,
        "n_pairs_present": len(per_pair),
        "all_42_pairs_present": all_42_present,
        "all_42_pairs_measurable": all_pairs_measurable and all_42_present,
        "per_pair_status": per_pair_status,
    }
    _validity_clean = (
        _n_crashes == 0 and _n_timeouts == 0 and _n_engine_errors == 0
        and all_pairs_measurable and all_42_present
    )

    print("\n=== REFERENCE RE-DERIVATION VALIDITY BLOCK (read this FIRST) ===", file=sys.stderr)
    print(json.dumps({k: v for k, v in validity.items() if k != "per_pair_status"}, indent=2, default=str), file=sys.stderr)
    if not _validity_clean:
        print(
            "\n*** VALIDITY FAILED -- the reference numbers below are QUARANTINED UNREAD per the same "
            "validity-before-verdict discipline. Do not certify N against this run. ***",
            file=sys.stderr,
        )
    else:
        print("\nVALIDITY PASSED -- all 42 pairs measured cleanly, 0 crashes/exceptions/timeouts.", file=sys.stderr)

    # ── N: baseline zero-trade -> demotion nonzero (the re-derived reference) ──
    reference_set = [
        {"key": k, **v} for k, v in per_pair.items()
        if v["baseline_zero_trade"] is True and v["demotion_zero_trade"] is False
    ]
    N = len(reference_set)

    # ── Which of the ORIGINAL 9 (guard-less-engine reference) still revive here vs dropout ──
    original_9_status = {}
    for family, video_or_list in ORIGINAL_9_FAMILY_TO_VIDEO.items():
        videos = video_or_list if isinstance(video_or_list, list) else [video_or_list]
        for video in videos:
            for symbol in SYMBOLS:
                key = f"{video}_{symbol}"
                pair = per_pair.get(key)
                frozen_name = f"{family}_{symbol.lower()}_{CONCEPTS[video][1]}"
                revives_here = bool(pair and pair["baseline_zero_trade"] is True and pair["demotion_zero_trade"] is False)
                original_9_status[f"{frozen_name}__{video}"] = {
                    "video": video,
                    "baseline_zero_trade": pair["baseline_zero_trade"] if pair else None,
                    "demotion_zero_trade": pair["demotion_zero_trade"] if pair else None,
                    "revives_on_fixed_engine": revives_here,
                    "status": "SURVIVES" if revives_here else "DROPOUT",
                }

    n_survive = sum(1 for v in original_9_status.values() if v["status"] == "SURVIVES")
    n_dropout = sum(1 for v in original_9_status.values() if v["status"] == "DROPOUT")

    low_power = N < 5

    summary = {
        "purpose": "Ruling-2 reference re-derivation ONLY -- NOT the Gate 3 classifier verdict (separate, "
                   "later, gated read). Read order: reference -> validity -> verdict.",
        "validity": validity,
        "engine_sha_pin": ENGINE_SHA_PIN,
        "date_window": {"start": START_DATE, "end": END_DATE},
        "n_concepts": len(CONCEPTS),
        "n_pairs": len(per_pair),
        "N_reference_revival_count": N,
        "N_reference_revival_list": reference_set,
        "low_power": low_power,
        "original_9_cross_check": original_9_status,
        "original_9_n_survive": n_survive,
        "original_9_n_dropout": n_dropout,
        "per_pair_results": per_pair,
    }
    OUT_RESULTS.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8", newline="\n")

    print("\n=== REFERENCE RE-DERIVATION SUMMARY ===", file=sys.stderr)
    print(json.dumps({k: v for k, v in summary.items() if k not in ("per_pair_results", "validity", "N_reference_revival_list", "original_9_cross_check")}, indent=2, default=str), file=sys.stderr)
    print(f"\nN = {N} (LOW_POWER={low_power})", file=sys.stderr)
    print(f"Original 9: {n_survive} SURVIVE / {n_dropout} DROPOUT", file=sys.stderr)
    print(f"\nWrote {OUT_RESULTS}", file=sys.stderr)


if __name__ == "__main__":
    main()
