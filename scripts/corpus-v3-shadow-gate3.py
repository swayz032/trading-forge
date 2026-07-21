#!/usr/bin/env python3
"""corpus-v3-shadow-gate3.py — Corpus v3 STEP 5: Gate 3 (bidirectional) + role-change delta capture.

Per docs/designs/corpus-v3-IMPLEMENTATION-PLAN-2026-07-05.md Step 5 + corpus-v3-gate1-respecification
-2026-07-05.md's AND-certification pre-commitment. This script does NOT certify Gate 3 (the dispatching
agent independently re-verifies) — it only computes and reports the numbers.

PAIRED design (both arms run through the IDENTICAL driver + IDENTICAL date window, so any difference is
attributable to the classifier, not to a data-window mismatch across two different historical scripts):
  - v2 arm:  compiled_spec = .claude/worktrees/extraction-100/corpus/specs/<video>.spec.json
             (TF_SEMANTIC_ROLE_CLASSIFIER was NOT set when these were extracted -- topology-only heuristic,
             the CURRENT production/live behavior; source='spec_onboarding' rows in prod mirror this).
  - v3-shadow arm: compiled_spec = .claude/worktrees/extraction-100/docs/replay-results/v3-shadow-specs/
             <video>.spec.json (extracted with TF_SEMANTIC_ROLE_CLASSIFIER=true -- full hybrid classifier,
             rules 1-5 deterministic + gemma rule 6 margin adjudication -- see graph-to-engine.ts Step 5
             wiring committed alongside this script).
  - Both are run via `python -m src.engine.backtester <config.json> --mode single` (the exact production
    CLI a real /api/backtests request drives) with TF_ROLE_DEMOTION_MODE UNSET (Gate 3's "flag OFF" clause
    -- the runtime demotion override plays no part; only the extraction-time classifier does).
  - 14 concepts x 3 symbols (MES/MNQ/MCL) = 42 strategies per arm, matching the frozen role-demotion corpus
    shape (14 families x 3 symbols = 42, confirmed against role-demotion-experiment-run-report.json).

Cross-check (not the primary measurement, a validation): my freshly-run v2-arm zero-trade flags are
compared against docs/replay-results/role-demotion-experiment-run-report.json's frozen "off" arm zero-trade
flags for the 3 known revival families (discount_price_to_buy_from / opening_range_breakout_orb / crossover)
to validate my date window is an equivalent measurement, not a confounded one.

Usage: PYTHONPATH=. TF_ALLOW_FIXED_1=true python scripts/corpus-v3-shadow-gate3.py
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
V3_SPEC_DIR = WORKTREE / "docs/replay-results/v3-shadow-specs"
FROZEN_REPORT = REPO_ROOT / "docs/replay-results/role-demotion-experiment-run-report.json"
OUT_RESULTS = REPO_ROOT / "docs/replay-results/corpus-v3-gate3-shadow-results-2026-07-05.json"
OUT_DELTAS = REPO_ROOT / "docs/replay-results/corpus-v3-role-change-deltas-2026-07-05.json"

# Pinning manifest (verbatim from docs/designs/corpus-v3-IMPLEMENTATION-PLAN-2026-07-05.md)
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

# Known-revival cross-reference (from the frozen role-demotion report's struct_ctx arm; 9 strategies =
# 3 families x 3 symbols). Mapped to video by concept-tag/timeframe correspondence -- ORB has TWO candidate
# videos (jlShztsY3oA + oDLt9zh33LE both tagged ORB/5m); which one the frozen "opening_range_breakout_orb"
# family's v2 compiled_spec actually derived from is NOT independently verifiable from artifacts on disk
# (concept-fingerprint cross-validation may have merged them) -- reported as an open ambiguity, not papered
# over. Both ORB videos are tested independently below.
REVIVAL_FAMILY_TO_VIDEO = {
    "discount_price_to_buy_from": "m-G1ag77aVc",
    "crossover": "snNkQSyWX4k",
    "opening_range_breakout_orb": ["jlShztsY3oA", "oDLt9zh33LE"],  # ambiguous -- both tested
}
SUPPORT_LEVEL_VIDEO = "75DJN5UVQnw"  # "5m_minute_support_level" family per pinning manifest tag (S/R, 5m)

TF_ENGINE = {"1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1hour", "4h": "4hour"}
SYMBOLS = ["MES", "MNQ", "MCL"]

# Generous superset window -- load_ohlcv clips to whatever's actually cached; using the SAME window for
# both arms (v2 and v3-shadow) removes date-range as a confound in this paired comparison.
#
# GATE3-DEFECT-2 FIX (Gate 3 re-run protocol, 2026-07-06) -- DIAGNOSIS (not a data fix; see docs/
# designs/corpus-v3-gate1-respecification-2026-07-05.md "MCL: DIAGNOSE BEFORE FIX"): the original
# 2015-01-01 start swept in 2020-04-20 14:00 ET -> 2020-04-21 09:25 ET, the real, historically-
# documented WTI negative-oil-price event (May 2020 CL contract expiry collapse). Verified directly
# against data_cache/CL/ratio_adj/{1min,5min,15min,30min,1hour,4hour}.parquet: EVERY MCL timeframe has
# zero/negative-price bars, and ALL of them fall exactly inside that ~19.5-hour window (25 bars at
# 30min, 358 at 1min, etc. -- same historical event, different bar granularity). MES/MNQ (ES/NQ) parquet
# files have ZERO such bars at any timeframe -- this is CL-exclusive and matches the well-known fact
# that crude oil futures (not equity-index futures) went negative that day. This is NOT corrupt data --
# it is genuine, correctly-recorded market history that trips the data-quality gate's zero/negative-
# price heuristic (written with equity-index futures in mind, no crude-oil carve-out). The demotion
# experiment (commit 1ab7321-adjacent, role-demotion-experiment-run-report.json) measured
# discount_price_to_buy_from_mcl_30m successfully (n_bars=19506, first trade 2024-07-01) because its
# date window never reached back to April 2020 -- confirming the "harness loads an unneeded date-range"
# hypothesis (reframed from "unneeded TF": both arms already declare the correct per-concept TF; the
# defect was an overly-wide DATE window, not a wrong TF). Fix: move START_DATE past the event with a
# safety margin, preserving ~6 years of history (2020-06-01 -> 2026-07-01) -- still identical across both
# arms, so the paired-comparison confound-removal intent is unchanged; only the crash is resolved.
START_DATE = "2020-06-01"
END_DATE = "2026-07-01"
# GATE3-DEFECT-1 FIX re-stamp (2026-07-06): the winners/losers + _roll_spread_audit_rows_cls
# UnboundLocalError hoist in run_class_backtest() (src/engine/backtester.py) is behaviorally
# byte-identical for any pair that actually trades -- only zero-signal pairs change from
# crash -> clean total_trades=0. Re-stamped to the fixed HEAD; update this value again if this
# script is re-run against a later commit.
ENGINE_SHA_PIN = "5b863aca4662be1c20504a8673952eecb196adc7"


def load_spec_artifact(spec_dir: Path, video: str) -> dict | None:
    p = spec_dir / f"{video}.spec.json"
    if not p.exists():
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def run_backtest(compiled_spec: dict, symbol: str, timeframe_engine: str, name: str) -> dict:
    """Invoke the production CLI exactly as backtest-service.ts would (compiled_spec dispatch path,
    src/engine/backtester.py:7787). TF_ROLE_DEMOTION_MODE is intentionally left UNSET in this process's
    env (Gate 3's frozen "flag OFF" clause)."""
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
    env["TF_ALLOW_FIXED_1"] = "true"  # research-harness measurement only, per task env spec; never a
    # production sizing decision -- Gate 3 measures whether the strategy TRADES (n_trades>0), not P&L
    # sizing, so default fixed_contracts=1 sizing is immaterial to the revival/regression question.
    env.pop("TF_ROLE_DEMOTION_MODE", None)  # Gate 3's frozen "flag OFF" clause -- runtime demotion NEVER
    # applies in this measurement; only the extraction-time classifier (baked into the compiled_spec
    # roles already) does.
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "src.engine.backtester", "--config", cfg_path, "--mode", "single"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            # GATE3-DEFECT-3 FIX (Gate 3 re-run protocol, 2026-07-06): 300s was too tight for
            # sVkmZklJDHI (1m timeframe, the largest dataset -- ~1.9M MCL 1min bars alone over the
            # 2020-06-01..2026-07-01 window per symbol). Envelope-only fix per the protocol ("raise the
            # timeout and/or chunk the load -- NEVER the computation"): raised to 900s (3x) as a uniform
            # generous ceiling for all 14 concepts x 3 symbols x 2 arms; no chunking added since a flat
            # timeout raise is the minimal instrument change and this is an offline research harness, not
            # a production request-latency path.
            timeout=900,
            env=env,
        )
        stdout = proc.stdout.strip()
        last_line = ""
        for line in stdout.splitlines():
            line = line.strip()
            if line:
                last_line = line
        if not last_line:
            return {"error": "no_stdout", "stderr_tail": proc.stderr[-2000:], "returncode": proc.returncode}
        try:
            return json.loads(last_line)
        except json.JSONDecodeError:
            return {"error": "unparseable_stdout", "raw_tail": stdout[-2000:], "stderr_tail": proc.stderr[-2000:]}
    except subprocess.TimeoutExpired:
        return {"error": "timeout"}
    finally:
        Path(cfg_path).unlink(missing_ok=True)


def spine_nonempty(compiled_spec: dict) -> bool:
    spec = compiled_spec.get("spec", compiled_spec)
    conds = spec.get("entry_conditions", [])
    return any(c.get("role") == "spine" for c in conds)


def role_index(compiled_spec: dict) -> dict[str, dict]:
    spec = compiled_spec.get("spec", compiled_spec)
    out = {}
    for c in spec.get("entry_conditions", []) + spec.get("invalidations", []):
        out[c["id"]] = {
            "role": c.get("role"), "object": c.get("object"), "type": c.get("type"),
            "span": c.get("span"), "evidence": c.get("evidence"),
        }
    return out


def diff_roles(v2_roles: dict, v3_roles: dict) -> list[dict]:
    """Pair up v2 vs v3-shadow conditions for role comparison. v2 and v3-shadow are INDEPENDENT extraction
    runs (v2 extracted on an earlier pipeline commit; v3-shadow just now via the Step-5 async classifier
    pass) -- condition ids (`type:object#ordinal`) usually match for single-occurrence objects but are not
    a guaranteed-stable join key across two separate runs. Match PRIMARILY by exact id; for ids present on
    only one side, fall back to a (type, object) match against the other side (ordinal renumbering) before
    concluding the condition was genuinely added/removed by extraction drift (which is reported too, with
    v2_role/v3_role = None on the missing side, so it's visible rather than silently dropped).
    Returns a list of {id, v2_role, v3_role, ref} for every condition where the roles differ.
    """
    by_type_obj_v2: dict[tuple, list[str]] = {}
    for cid, c in v2_roles.items():
        by_type_obj_v2.setdefault((c["type"], c["object"]), []).append(cid)
    by_type_obj_v3: dict[tuple, list[str]] = {}
    for cid, c in v3_roles.items():
        by_type_obj_v3.setdefault((c["type"], c["object"]), []).append(cid)

    matched_v3_ids: set[str] = set()
    out: list[dict] = []
    for cid, v2_c in v2_roles.items():
        if cid in v3_roles:
            v3_c = v3_roles[cid]
            matched_v3_ids.add(cid)
        else:
            candidates = [c for c in by_type_obj_v3.get((v2_c["type"], v2_c["object"]), []) if c not in matched_v3_ids]
            if candidates:
                v3_c = v3_roles[candidates[0]]
                matched_v3_ids.add(candidates[0])
            else:
                v3_c = None
        v2_role = v2_c["role"]
        v3_role = v3_c["role"] if v3_c else None
        if v2_role != v3_role:
            out.append({"id": cid, "v2_role": v2_role, "v3_role": v3_role, "ref": v3_c or v2_c})
    for cid, v3_c in v3_roles.items():
        if cid in matched_v3_ids or cid in v2_roles:
            continue
        candidates = [c for c in by_type_obj_v2.get((v3_c["type"], v3_c["object"]), [])]
        if candidates:
            continue  # already accounted for from the v2-side loop above via type/object fallback
        out.append({"id": cid, "v2_role": None, "v3_role": v3_c["role"], "ref": v3_c})
    return out


def n_trades(result: dict) -> int | None:
    if "error" in result:
        return None
    trades = result.get("trades")
    if trades is None:
        return None
    return len(trades)


def call_status(result: dict) -> str:
    """Classify one run_backtest() call for the VALIDITY block (standing methodology
    requirement, docs/designs/corpus-v3-gate1-respecification-2026-07-05.md "GATE 3 RE-RUN
    PROTOCOL"). Distinguishes a genuine instrument crash/timeout (subprocess died before or
    while printing, or exceeded the timeout -- exactly the GATE3-DEFECT-1/2/3 failure modes)
    from a clean JSON result, INCLUDING a clean JSON result that itself carries an engine-level
    "error" field (e.g. `_empty_result`'s caught-and-reported vectorbt error) -- that is a real,
    successful MEASUREMENT of an unsuccessful backtest, not an instrument crash, so it is tagged
    distinctly ("engine_error:*") rather than folded into "crash:*".
    """
    err = result.get("error")
    if err is None:
        return "ok"
    if err == "timeout":
        return "timeout"
    if err in ("no_stdout", "unparseable_stdout"):
        return f"crash:{err}"
    return f"engine_error:{err}"


def main() -> None:
    missing_v3 = [v for v in CONCEPTS if not (V3_SPEC_DIR / f"{v}.spec.json").exists()]
    if missing_v3:
        print(f"ABORT: waiting on v3-shadow specs for: {missing_v3}", file=sys.stderr)
        sys.exit(2)
    missing_v2 = [v for v in CONCEPTS if not (V2_SPEC_DIR / f"{v}.spec.json").exists()]
    if missing_v2:
        print(f"ABORT: missing v2 baseline specs for: {missing_v2}", file=sys.stderr)
        sys.exit(2)

    with open(FROZEN_REPORT, encoding="utf-8") as f:
        frozen = json.load(f)
    frozen_by_name = {s["name"]: s for s in frozen["per_strategy"]}

    per_concept_spine: dict[str, bool] = {}
    per_pair: dict[str, dict] = {}  # key: "<video>_<symbol>" -> {v2: {...}, v3_shadow: {...}}
    per_pair_status: dict[str, dict] = {}  # key -> {"v2": <call_status>, "v3_shadow": <call_status>}
    role_deltas: list[dict] = []

    for video, (tag, tf_label) in CONCEPTS.items():
        tf_engine = TF_ENGINE[tf_label]
        v2_artifact = load_spec_artifact(V2_SPEC_DIR, video)
        v3_artifact = load_spec_artifact(V3_SPEC_DIR, video)
        per_concept_spine[video] = spine_nonempty(v3_artifact)

        v2_roles = role_index(v2_artifact)
        v3_roles = role_index(v3_artifact)

        for symbol in SYMBOLS:
            key = f"{video}_{symbol}"
            name = f"v3shadow_{video}_{symbol.lower()}_{tf_label}"
            print(f"[{key}] running v2 + v3-shadow backtests ({tf_engine})...", file=sys.stderr)
            v2_result = run_backtest(v2_artifact, symbol, tf_engine, name + "_v2")
            v3_result = run_backtest(v3_artifact, symbol, tf_engine, name + "_v3shadow")
            v2_n = n_trades(v2_result)
            v3_n = n_trades(v3_result)
            per_pair_status[key] = {"v2": call_status(v2_result), "v3_shadow": call_status(v3_result)}
            per_pair[key] = {
                "video": video, "tag": tag, "symbol": symbol, "timeframe": tf_label,
                "v2_n_trades": v2_n, "v2_error": v2_result.get("error"),
                "v3_shadow_n_trades": v3_n, "v3_shadow_error": v3_result.get("error"),
                "v2_zero_trade": (v2_n == 0) if v2_n is not None else None,
                "v3_shadow_zero_trade": (v3_n == 0) if v3_n is not None else None,
            }
            print(f"  v2={v2_n} v3_shadow={v3_n}", file=sys.stderr)

            behavior_changed = (
                v2_n is not None and v3_n is not None and
                ((v2_n == 0) != (v3_n == 0))
            )
            if behavior_changed:
                is_revival = v2_n == 0 and v3_n and v3_n > 0
                is_death = v2_n and v2_n > 0 and v3_n == 0
                for d in diff_roles(v2_roles, v3_roles):
                    ref = d["ref"]
                    role_deltas.append({
                        "strategy": key,
                        "video": video,
                        "symbol": symbol,
                        "timeframe": tf_label,
                        "condition_id": d["id"],
                        "object": ref.get("object"),
                        "type": ref.get("type"),
                        "v2_role": d["v2_role"],
                        "v3_role": d["v3_role"],
                        "transcript_span": ref.get("span"),
                        "evidence_quote": ref.get("evidence"),
                        "is_revival_driving": bool(is_revival),
                        "is_death_driving": bool(is_death),
                    })

    # ── VALIDITY BLOCK (standing methodology requirement, added per the Gate 3 re-run protocol's
    # VALIDITY-BEFORE-VERDICT ordering) — computed and reported BEFORE any revival/regression
    # numbers. A harness that can crash on the transition it is measuring systematically masks
    # the effect under test (zero-signal crashes hide zero->nonzero revivals); this block makes
    # that failure visible instead of letting it read as an ordinary unmeasured/absent pair.
    all_call_statuses = [s for pair in per_pair_status.values() for s in pair.values()]
    _n_crashes = sum(1 for s in all_call_statuses if s.startswith("crash:"))
    _n_timeouts = sum(1 for s in all_call_statuses if s == "timeout")
    _n_engine_errors = sum(1 for s in all_call_statuses if s.startswith("engine_error:"))

    def _pair_clean(key: str) -> bool:
        st = per_pair_status.get(key)
        return bool(st) and st["v2"] == "ok" and st["v3_shadow"] == "ok"

    # All 9 (named) revival pairs measurable: every (family, video, symbol) the revival
    # cross-reference tracks needs BOTH arms clean, or that pair's revival/no-revival verdict
    # cannot be trusted.
    _revival_pair_keys = [
        f"{video}_{symbol}"
        for _family, _video_or_list in REVIVAL_FAMILY_TO_VIDEO.items()
        for video in (_video_or_list if isinstance(_video_or_list, list) else [_video_or_list])
        for symbol in SYMBOLS
    ]
    all_9_revival_pairs_measurable = all(_pair_clean(k) for k in _revival_pair_keys)

    # All v2-traded pairs measurable: every pair where the v2 arm cleanly measured n_trades > 0
    # needs a clean v3-shadow measurement too, or a real regression could be hiding behind a
    # v3-shadow crash -- exactly the masking hazard the METHODOLOGY FREEZE names.
    _v2_traded_keys = [
        k for k, v in per_pair.items()
        if per_pair_status.get(k, {}).get("v2") == "ok"
        and v.get("v2_n_trades") is not None
        and v["v2_n_trades"] > 0
    ]
    all_v2_traded_pairs_measurable = all(_pair_clean(k) for k in _v2_traded_keys)

    validity = {
        "crashes": _n_crashes,
        "exceptions": _n_engine_errors,
        "timeouts": _n_timeouts,
        "all_9_revival_pairs_measurable": all_9_revival_pairs_measurable,
        "all_v2_traded_pairs_measurable": all_v2_traded_pairs_measurable,
        "per_pair_status": per_pair_status,
    }
    _validity_clean = (
        _n_crashes == 0 and _n_timeouts == 0 and _n_engine_errors == 0
        and all_9_revival_pairs_measurable and all_v2_traded_pairs_measurable
    )

    print("\n=== GATE 3 VALIDITY BLOCK (read this FIRST) ===", file=sys.stderr)
    print(json.dumps({k: v for k, v in validity.items() if k != "per_pair_status"}, indent=2, default=str), file=sys.stderr)
    if not _validity_clean:
        print(
            "\n*** VALIDITY FAILED -- per the Gate 3 re-run protocol, the revival/regression numbers "
            "below are QUARANTINED UNREAD. Do not certify against this run. ***",
            file=sys.stderr,
        )
    else:
        print("\nVALIDITY PASSED -- all pairs measured cleanly, 0 crashes/exceptions/timeouts.", file=sys.stderr)

    # ── Revival cross-reference against the frozen report's 9 known struct_ctx revivals ──
    revival_check = {}
    for family, video_or_list in REVIVAL_FAMILY_TO_VIDEO.items():
        videos = video_or_list if isinstance(video_or_list, list) else [video_or_list]
        for video in videos:
            for symbol in SYMBOLS:
                sym_l = symbol.lower()
                tf_label = CONCEPTS[video][1]
                frozen_name = f"{family}_{sym_l}_{tf_label}"
                frozen_entry = frozen_by_name.get(frozen_name)
                pair = per_pair.get(f"{video}_{symbol}")
                revival_check[frozen_name] = {
                    "video_tested": video,
                    "frozen_zero_trade_off": frozen_entry["zero_trade"]["off"] if frozen_entry else None,
                    "frozen_revival_vs_off_struct_ctx": frozen_entry["revival_vs_off"]["struct_ctx"] if frozen_entry else None,
                    "my_v2_zero_trade": pair["v2_zero_trade"] if pair else None,
                    "my_v3_shadow_zero_trade": pair["v3_shadow_zero_trade"] if pair else None,
                    "my_v3_shadow_trades_now": (pair["v3_shadow_zero_trade"] is False) if pair and pair["v3_shadow_zero_trade"] is not None else None,
                }

    n_revival_confirmed = sum(
        1 for v in revival_check.values()
        if v["my_v2_zero_trade"] is True and v["my_v3_shadow_trades_now"] is True
    )

    # ── Regression enumeration: every (video,symbol) that traded in MY v2 run and goes to zero in v3-shadow ──
    regressions = [
        {"key": k, **v} for k, v in per_pair.items()
        if v["v2_zero_trade"] is False and v["v3_shadow_zero_trade"] is True
    ]

    summary = {
        "validity": validity,
        "corpus_version": "v3-shadow-2026-07-05",
        "engine_sha_pin": ENGINE_SHA_PIN,
        "date_window": {"start": START_DATE, "end": END_DATE},
        "n_concepts": len(CONCEPTS),
        "n_strategy_pairs": len(per_pair),
        "support_level_video": SUPPORT_LEVEL_VIDEO,
        "support_level_spine_nonempty": per_concept_spine.get(SUPPORT_LEVEL_VIDEO),
        "per_concept_spine_nonempty": per_concept_spine,
        "revival_cross_reference_9": revival_check,
        "n_revival_confirmed_of_9_named": n_revival_confirmed,
        "n_revival_named_total": len(revival_check),
        "regressions_v2_traded_v3shadow_zero": regressions,
        "n_regressions": len(regressions),
        "per_pair_results": per_pair,
    }
    OUT_RESULTS.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8", newline="\n")

    deltas_out = {
        "corpus_version": "v3-shadow-2026-07-05",
        "generated_by": "scripts/corpus-v3-shadow-gate3.py",
        "note": "Every condition whose role assignment differs (v2 role != v3 classifier role) for every "
                "strategy whose trading behavior CHANGED between v2 and v3-shadow (revival or death). "
                "This is the exact set Gate 1' adjudicates -- Gate 1' adjudication itself is a SEPARATE "
                "dispatch, not run here.",
        "n_strategies_with_behavior_change": len({d["strategy"] for d in role_deltas}),
        "n_role_changes_total": len(role_deltas),
        "n_revival_driving": sum(1 for d in role_deltas if d["is_revival_driving"]),
        "n_death_driving": sum(1 for d in role_deltas if d["is_death_driving"]),
        "role_changes": role_deltas,
    }
    OUT_DELTAS.write_text(json.dumps(deltas_out, indent=2, default=str), encoding="utf-8", newline="\n")

    print("\n=== GATE 3 SHADOW RESULTS SUMMARY ===", file=sys.stderr)
    # "validity" already printed distinctly above (VALIDITY-BEFORE-VERDICT ordering) — excluded
    # here only to avoid a redundant duplicate dump; it is still written in full to OUT_RESULTS.
    print(json.dumps({k: v for k, v in summary.items() if k not in ("per_pair_results", "validity")}, indent=2, default=str)[:6000], file=sys.stderr)
    print(f"\nWrote {OUT_RESULTS}", file=sys.stderr)
    print(f"Wrote {OUT_DELTAS}", file=sys.stderr)


if __name__ == "__main__":
    main()
