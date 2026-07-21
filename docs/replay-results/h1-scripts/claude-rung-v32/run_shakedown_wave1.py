"""SHAKEDOWN WAVE-1 RUNNER (R-041 §3 / R-042 §6 / R-043 §4 Tooth-2 / R-045).

Runs the honestly-labeled PIPELINE-SHAKEDOWN over the compilable design-pool
(tier-b) specs on the PINNED engine 404a3396, wiring the two ratified instruments
(trial-counter + passage-ledger) and enforcing the R-043 Tooth-2 FAIL-CLOSED
coverage invariant: NO wave verdict is emitted unless `coverage_gaps()` is empty
for every strategy OR every gap is explicitly dispositioned in the validity block.

CROSS-TREE (worktree-session + epoch law): the ENGINE is imported from the
pinned-404a3396 worktree (sys.path); the INSTRUMENTS (pure-stdlib) are loaded by
path from the h1-wave4 build tree — they carry no engine dependency, so no
sys.path conflict. Specs are produced on h1-wave4 and travel as hash-stamped
compiled_spec dicts.

★ ENVIRONMENT-HONEST SCOPING (no silent caps): there is NO local bar data, so the
anti-overfit WALK-FORWARD battery (walk_forward/cpcv/dsr/pbo/bif/wrc/spa) + the
prop-survival + promotion gates CANNOT run here — `run_walk_forward_class` loads
from disk. This wave runs the PROVEN synthetic-bar `run_class_backtest` path
(the Packet-2 DoD path), witnessing the judges that fire there
(performance_gate, forge_score). The WF/prop/promotion judges are DISPOSITIONED
as data-gated in the validity block (Tooth-2) — witnessed-firing for them awaits
the real-bar-data dispatch. This wave's real deliverables (R-041 §3) — counter
from zero, ledger exercised with real engagement receipts, Tooth-2 proven,
ops rhythm — are met; NO survivor eligibility (R-041 §3).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from datetime import UTC, datetime, timedelta

WT = r"C:/Users/tonio/Projects/wt-dod-404a3396"
H1 = r"C:/Users/tonio/Projects/wt-h1-wave4-20260712"
ENGINE_SHA = "404a33963728e58c6dd12bf7d0d0c894ae6818b0"
STAGING = os.path.join(H1, "docs", "replay-results", "h1-scripts", "claude-rung-designpool", "staging_v32")
BATTERY_DIR = os.path.join(H1, "docs", "replay-results", "h1-battery")

sys.path.insert(0, WT)  # pinned-404a3396 engine
import numpy as np  # noqa: E402
import polars as pl  # noqa: E402
from src.engine.spec_condition_compiler import from_compiled_spec  # noqa: E402
from src.engine.backtester import run_class_backtest  # noqa: E402


def _load_h1_module(relpath: str, name: str):
    """Load a pure-stdlib instrument module from the h1-wave4 tree by path (no
    engine import, so no sys.path collision with the pinned worktree)."""
    spec = importlib.util.spec_from_file_location(name, os.path.join(H1, relpath))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # register BEFORE exec so @dataclass can resolve its module
    spec.loader.exec_module(mod)
    return mod


tc_mod = _load_h1_module("src/engine/battery/trial_counter.py", "tc")
pl_mod = _load_h1_module("src/engine/battery/passage_ledger.py", "pl_ledger")
# NOTE: specs are produced on h1-wave4 SEPARATELY (spec_producer needs h1-wave4's
# src.engine, which would collide with the pinned worktree's src.engine bound
# above). This runner only LOADS the pre-produced .spec.json (hash-stamped,
# cross-tree provenance-safe).
SHAKEDOWN_SPECS = os.path.join(H1, "docs", "replay-results", "h1-scripts", "claude-rung-v32", "shakedown_specs")

WAVE = "shakedown-1"
# The judges that CANNOT fire without real bar data (WF-battery / prop / promotion),
# dispositioned data-gated (Tooth-2). Unconditional battery gates that need the
# walk-forward path are here; the conditional promotion/prop gates are simply
# absent (not an alarm — conditional).
DATA_GATED_DISPOSITION = "data-gated: no local bar data; requires the walk_forward real-data dispatch (witnessed-firing deferred)"


def _synth_bars(n=2400, seed=11):
    rng = np.random.default_rng(seed)
    start = datetime(2026, 1, 5, 9, 30, tzinfo=UTC)
    ts = [start + timedelta(minutes=5 * i) for i in range(n)]
    close = 5000 + np.cumsum(rng.normal(0, 1.5, n))
    return pl.DataFrame({
        "ts_event": ts,
        "open": (close + rng.normal(0, 0.4, n)).astype(np.float64),
        "high": (close + rng.uniform(0.25, 2.0, n)).astype(np.float64),
        "low": (close - rng.uniform(0.25, 2.0, n)).astype(np.float64),
        "close": close.astype(np.float64),
        "volume": rng.integers(500, 3000, n).astype(np.int64),
    })


def _compilable_specs(limit=None):
    """Load the pre-produced tier-b compilable-futures .spec.json (survivor-
    ineligible shakedown corpus). Hash-stamped, produced on h1-wave4."""
    import glob
    out = []
    for path in sorted(glob.glob(os.path.join(SHAKEDOWN_SPECS, "*.spec.json"))):
        art = json.load(open(path, encoding="utf-8"))
        stub = os.path.basename(path)[: -len(".spec.json")]
        out.append((stub, art))
    return out[:limit] if limit else out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="subset of compilable specs (default: all)")
    args = ap.parse_args()

    # F-2: RUNTIME-VERIFY the engine SHA (epoch law) — fail loud if the worktree
    # HEAD has moved/diverged from the pinned SHA, never a self-attested string.
    import subprocess
    head = subprocess.run(["git", "-C", WT, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    if head != ENGINE_SHA:
        print(f"HALT: pinned-engine worktree HEAD {head[:12]} != ENGINE_SHA {ENGINE_SHA[:12]} — epoch mismatch")
        return 1
    epoch = {"engine_sha": ENGINE_SHA, "pid": os.getpid(), "concurrency": 1, "wave": WAVE, "bar_source": "synthetic"}

    os.makedirs(BATTERY_DIR, exist_ok=True)
    # ONE artifact forever (R-042 pin 1): zero_point stamped on 404a3396 at first allocate.
    counter = tc_mod.TrialCounter(os.path.join(BATTERY_DIR, "trial-counter.json"), engine_sha_at_zero=ENGINE_SHA)
    ledger = pl_mod.PassageLedger(os.path.join(BATTERY_DIR, "passage-ledger.json"))

    bars = _synth_bars()
    start_date = bars["ts_event"][0].strftime("%Y-%m-%d")
    end_date = bars["ts_event"][-1].strftime("%Y-%m-%d")
    specs = _compilable_specs(args.limit)
    print(f"shakedown-1 on engine {ENGINE_SHA[:8]} | {len(specs)} compilable specs | synthetic bars {start_date}..{end_date}\n")

    for stub, art in specs:
        approx = art["approximation_metrics"]["binding_approximation_rate"]
        tid = counter.allocate(wave=WAVE, strategy_ref=stub, spec_hash=art["spec_hash"],
                               engine_sha=ENGINE_SHA, binding_approximation_rate=approx, survivor_eligible=False,
                               run_epoch=epoch)
        try:
            strategy = from_compiled_spec(art, symbol="MES", timeframe="5m", strategy_name=stub)
            res = run_class_backtest(strategy, start_date, end_date, data=bars, use_performance_gate=True)
            ran = isinstance(res, dict)
            metrics = {k: res.get(k) for k in ("total_return", "sharpe_ratio", "profit_factor", "total_trades")} if ran else {}
            # TRUE verdicts read from the engine's own keys (the false-green the
            # ledger exists to prevent): performance gate -> `gate_rejections`
            # (non-empty = REJECTED) + `tier`; forge/crisis -> `gate_result.passed`.
            gate_rejections = (res.get("gate_rejections") or []) if ran else []
            gate_result = (res.get("gate_result") or {}) if ran else {}
            perf_pass = bool(ran and not gate_rejections)
            exit_prov = (art["spec"].get("framework_overlay") or {}).get("exit")
            # performance_gate judge (WITNESSED firing, TRUE verdict + rejection reasons visible)
            ledger.record(wave=WAVE, strategy_ref=stub, spec_hash=art["spec_hash"], engine_sha=ENGINE_SHA,
                          gate="performance_gate", received=True, fired=ran,
                          verdict=(pl_mod.VERDICT_PASS if perf_pass else pl_mod.VERDICT_FAIL) if ran else pl_mod.VERDICT_NOT_EVALUATED,
                          binding_approximation_rate=approx,
                          inputs_seen=["gate_rejections", "tier", *metrics.keys()],
                          value={"gate_rejections": gate_rejections, "tier": res.get("tier") if ran else None, "metrics": metrics},
                          engaged_features=["fill_model", "synthetic_bars(no-local-data)"],
                          exit_provenance=exit_prov, audit_level="first-passage-full")
            # forge_score is NOT recorded as a witnessed pass/fail here (grader
            # F-1): on the run_class_backtest path `crisis_results` is always
            # None, so its crisis-veto verdict is STRUCTURALLY untestable (can
            # only return passed=True) — an implausibly-uniform 16/16 PASS is the
            # vacuous-witness tripwire. It is DISPOSITIONED path-gated below, not
            # claimed as a firing. The raw forge_score is still surfaced on the
            # performance_gate row's value for the record.
            outcome = "PASS" if perf_pass else "FAIL"
            counter.finalize(tid, outcome)
            print(f"  {stub:16s} perf_gate={outcome} (tier={res.get('tier') if ran else '?'}) n_trades={metrics.get('total_trades')} approx={approx}")
        except Exception as e:
            counter.finalize(tid, "ABORTED", abort_signature=repr(e)[:120])
            print(f"  {stub:16s} ABORTED: {e!r}")

    # ── R-043 Tooth-2: FAIL-CLOSED coverage invariant ──────────────────────────
    # Every unconditional judge must have a FIRED row per strategy, OR the gap is
    # dispositioned. The WF-battery judges are data-gated here -> dispositioned.
    _witnessed = {"performance_gate"}
    _FORGE_PATH_GATED = ("forge_score's crisis-veto is STRUCTURALLY untestable on the "
                         "run_class_backtest path (crisis_results always None -> passed can only be True); "
                         "witnessed-firing awaits the crisis-scenario path")
    dispositions = {}
    for g in ledger.unconditional_gate_names():
        if g in _witnessed:
            continue
        dispositions[g] = _FORGE_PATH_GATED if g == "forge_score" else DATA_GATED_DISPOSITION
    undispositioned = []
    for stub, _art in specs:
        for gap in ledger.coverage_gaps(strategy_ref=stub, wave=WAVE):
            if gap not in dispositions:
                undispositioned.append((stub, gap))

    validity = {
        "wave": WAVE, "engine_sha": ENGINE_SHA, "engine_sha_verified_head": head,  # runtime git rev-parse (F-2)
        "trial_counter_zero_point_engine": counter._doc.get("engine_sha_at_zero"),
        "n_trials": counter.total_trials, "outcomes": counter.outcomes(),
        "survivor_eligibility": "NONE (R-041 §3 shakedown)",
        "scope_line": "shakedown; per-spec binding-approx on each trial; framework-behavior measurement, NOT edge evidence",
        "engagement_sweep": {"fill_model": "engaged", "bar_source": "synthetic (no local bar data)", "eligibility_gate": "default"},
        "coverage_dispositions": dispositions,
        "coverage_disposition_reason": "no local bar data -> the walk-forward anti-overfit battery + prop/promotion judges cannot fire here; witnessed-firing deferred to the real-data dispatch. Counter/ledger/Tooth-2/ops-rhythm + performance_gate ARE exercised.",
        "tooth2_fail_closed": len(undispositioned) == 0,
        "undispositioned_gaps": undispositioned,
    }

    if undispositioned:
        verdict = {"verdict": "REFUSED", "reason": "Tooth-2 fail-closed: undispositioned coverage gaps",
                   "undispositioned": undispositioned, "validity": validity}
        print("\n=== WAVE VERDICT: REFUSED (Tooth-2 fail-closed) ===")
    else:
        verdict = {"verdict": "SHAKEDOWN_COMPLETE",
                   "note": "machinery proven; NO survivor eligibility; anti-overfit judges data-gated (dispositioned)",
                   "validity": validity}
        print("\n=== WAVE VERDICT: SHAKEDOWN_COMPLETE (survivor-ineligible; coverage dispositioned) ===")

    json.dump(verdict, open(os.path.join(BATTERY_DIR, "shakedown-wave1-verdict.json"), "w", encoding="utf-8", newline="\n"), indent=2)
    print(json.dumps({"verdict": verdict["verdict"], "n_trials": validity["n_trials"], "outcomes": validity["outcomes"],
                      "tooth2_fail_closed": validity["tooth2_fail_closed"], "engine": ENGINE_SHA[:8]}, indent=2))
    return 0 if not undispositioned else 1


if __name__ == "__main__":
    raise SystemExit(main())
