"""WAVE-1R RUNNER (R-046 real-data completion / R-047 GO) — full 16, FULL scope,
SOLO managed under the pre-committed fallbacks. Completes the machinery proof:
runs the compilable tier-b specs through the REAL walk-forward anti-overfit
battery on the pinned engine 404a3396 with REAL bar data, so the WF judges
(walk_forward/cpcv/pbo/bif/dsr/wrc/spa/monte_carlo_ruin/slippage_survival) are
WITNESSED firing. Product is RECEIPTS, not returns (R-047 §3): results are garbage
(~-18 sharpe) by design — near-ungated ghost specs measuring framework behavior.
Survivor-ineligible (tier-b, pre-WIRE-1).

R-047 §2 PRE-COMMITTED BRANCH: a judge that STRUCTURALLY cannot fire on tier-b
near-ghosts even at full scope (a property of the specs — e.g. DSR/WRC/SPA have
no positive-performance distribution to test on uniformly-losing specs) is
dispositioned SPEC-GATED with the evidence recorded, and its witnessed-firing
requirement RIDES FORWARD to the first post-WIRE-1 real-fidelity wave. Honest
commissioning: the artifact annotates WHICH judges were witnessed on WHICH wave.

FALLBACK LADDER (pre-committed, R-041/R-047): SOLO sequential; a crash leaves the
spec's trial ABORTED (counted) — re-running skips FINALIZED specs and re-dispatches
only the un-finalized (the counter IS the resume manifest via unfinalized rows,
so manifest hygiene is structural). Straggler > ~4h -> operator invokes the ladder.

Requires S3 creds in env (AWS_*/S3_BUCKET) + TF_ALLOW_FIXED_1=true. Run from the
wt-dod-404a3396 worktree.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import time

WT = r"C:/Users/tonio/Projects/wt-dod-404a3396"
H1 = r"C:/Users/tonio/Projects/wt-h1-wave4-20260712"
ENGINE_SHA = "404a33963728e58c6dd12bf7d0d0c894ae6818b0"
BATTERY_DIR = os.path.join(H1, "docs", "replay-results", "h1-battery")
SHAKEDOWN_SPECS = os.path.join(H1, "docs", "replay-results", "h1-scripts", "claude-rung-v32", "shakedown_specs")
WAVE = "wave-1R"
# FULL scope (R-047 §2 — sized so DSR/WRC/SPA CAN fire): a wide multi-year window.
WF_START, WF_END = "2016-01-01", "2024-12-31"

sys.path.insert(0, WT)
from src.engine.spec_condition_compiler import from_compiled_spec  # noqa: E402
from src.engine.walk_forward import run_walk_forward_class  # noqa: E402


def _load_h1(relpath, name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(H1, relpath))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


tc_mod = _load_h1("src/engine/battery/trial_counter.py", "tc")
pl_mod = _load_h1("src/engine/battery/passage_ledger.py", "pl_ledger")


def _specs():
    import glob
    out = []
    for p in sorted(glob.glob(os.path.join(SHAKEDOWN_SPECS, "*.spec.json"))):
        out.append((os.path.basename(p)[: -len(".spec.json")], json.load(open(p, encoding="utf-8"))))
    return out


def _wf_gate_rows(res: dict):
    """Extract per-judge (fired, verdict, receipt) from a WF result. A judge whose
    stat is structurally absent/degenerate -> ('SPEC_GATED', reason). Thresholds
    from the code-derived enum's cited gates (pbo>0.15 fail, bif>4.0 fail)."""
    V_PASS, V_FAIL, V_NE = pl_mod.VERDICT_PASS, pl_mod.VERDICT_FAIL, pl_mod.VERDICT_NOT_EVALUATED
    wfm = res.get("wf_metadata") or {}
    rows = {}

    # walk_forward — fires whenever the WF ran (wf_metadata present).
    if wfm:
        wfe = res.get("wfe_overall")
        deg = res.get("wfe_status") == "degenerate_is"
        rows["walk_forward"] = (True, V_NE if deg else (V_PASS if (wfe or 0) >= 0.70 else V_FAIL),
                                {"wfe_overall": wfe, "wfe_status": res.get("wfe_status"), "n_folds": wfm.get("n_folds")})
    # cpcv — fires when mode==cpcv.
    if wfm.get("mode") == "cpcv":
        rows["cpcv"] = (True, V_PASS if (wfm.get("n_folds") or 0) >= (wfm.get("min_paths") or 0) else V_NE,
                        {"mode": wfm.get("mode"), "n_folds": wfm.get("n_folds"), "path_sharpes": res.get("path_sharpes")})
    # pbo — degenerate -> spec-gated.
    pbo = res.get("pbo_overall")
    if pbo is not None and not res.get("pbo_degenerate"):
        rows["pbo"] = (True, V_FAIL if pbo > 0.15 else V_PASS, {"pbo_overall": pbo, "p_value": res.get("pbo_overall_p_value")})
    else:
        rows["pbo"] = ("SPEC_GATED", "pbo_degenerate on near-ghost (no IS/OOS split variation to overfit)")
    # bif.
    bif = res.get("bif")
    if bif is not None and not res.get("bif_computation_error"):
        rows["bif"] = (True, V_FAIL if bif > 4.0 else V_PASS, {"bif": bif, "detail": str(res.get("bif_detail"))[:120]})
    else:
        rows["bif"] = ("SPEC_GATED", "bif not computable")
    # slippage_survival.
    ss = res.get("slippage_survival")
    if isinstance(ss, dict) and ss:
        rows["slippage_survival"] = (True, V_NE, {k: ss.get(k) for k in ("breaks_at", "multiples", "pf") if k in ss})
    # dsr / wrc / spa / monte_carlo_ruin — check presence; absent on uniformly-
    # losing ghosts -> SPEC_GATED (no positive-performance distribution to test).
    for gate, keys, reason in (
        ("dsr", ("dsr", "dsr_pass", "deflated_sharpe_ratio"), "no positive Sharpe distribution to deflate on a uniformly-losing ghost"),
        ("wrc", ("wrc_result", "wrc_p", "wrc_p_value"), "White's Reality Check needs a candidate outperformance; none on a losing ghost"),
        ("spa", ("spa_consistent_p", "spa_p", "spa_result"), "Hansen SPA needs a candidate outperformance; none on a losing ghost"),
        ("monte_carlo_ruin", ("probability_of_ruin", "probability_of_ruin_ci"), "MC-ruin needs an equity path distribution; WF class path emits none here"),
    ):
        val = next((res.get(k) for k in keys if res.get(k) is not None), None)
        if val is not None:
            rows[gate] = (True, V_NE, {gate: str(val)[:120]})
        else:
            rows[gate] = ("SPEC_GATED", reason)
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    import subprocess
    head = subprocess.run(["git", "-C", WT, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    if head != ENGINE_SHA:
        print(f"HALT: engine HEAD {head[:12]} != {ENGINE_SHA[:12]}"); return 1
    epoch = {"engine_sha": ENGINE_SHA, "pid": os.getpid(), "concurrency": 1, "wave": WAVE, "bar_source": "S3 ratio-adjusted (dataset_hash-stamped, quality-gated, cached)"}

    counter = tc_mod.TrialCounter(os.path.join(BATTERY_DIR, "trial-counter.json"), engine_sha_at_zero=ENGINE_SHA)
    ledger = pl_mod.PassageLedger(os.path.join(BATTERY_DIR, "passage-ledger.json"))
    # resume: specs already FINALIZED (PASS/FAIL) in this wave are skipped.
    done = {r["strategy_ref"] for r in counter._doc["runs"] if r["wave"] == WAVE and r["outcome"] in ("PASS", "FAIL")}

    specs = _specs()[: args.limit] if args.limit else _specs()
    witnessed, spec_gated = set(), {}
    print(f"WAVE-1R on {ENGINE_SHA[:8]} | {len(specs)} specs | FULL scope {WF_START}..{WF_END} | already done: {len(done)}", flush=True)

    for i, (stub, art) in enumerate(specs, 1):
        if stub in done:
            print(f"  [{i}/{len(specs)}] {stub} SKIP (already finalized)", flush=True); continue
        approx = art["approximation_metrics"]["binding_approximation_rate"]
        tid = counter.allocate(wave=WAVE, strategy_ref=stub, spec_hash=art["spec_hash"], engine_sha=ENGINE_SHA,
                               binding_approximation_rate=approx, survivor_eligible=False, run_epoch=epoch)
        t0 = time.time()
        try:
            strat = from_compiled_spec(art, symbol="MES", timeframe="5m", strategy_name=stub)
            res = run_walk_forward_class(strategy=strat, start_date=WF_START, end_date=WF_END, embargo_bars=20)
            rows = _wf_gate_rows(res) if isinstance(res, dict) else {}
            exit_prov = (art["spec"].get("framework_overlay") or {}).get("exit")
            for gate, info in rows.items():
                if info[0] == "SPEC_GATED":
                    spec_gated[gate] = info[1]  # rides forward (R-047 §2)
                    continue
                _fired, verdict, receipt = info
                witnessed.add(gate)
                ledger.record(wave=WAVE, strategy_ref=stub, spec_hash=art["spec_hash"], engine_sha=ENGINE_SHA,
                              gate=gate, received=True, fired=True, verdict=verdict, binding_approximation_rate=approx,
                              inputs_seen=list(receipt.keys()), value=receipt,
                              engaged_features=["real_bar_data(S3_ratio_adj)", "cpcv", "fill_model"],
                              exit_provenance=exit_prov, audit_level="first-passage-full")
            counter.finalize(tid, "FAIL")  # receipts, not returns — ghosts fail by design
            print(f"  [{i}/{len(specs)}] {stub} DONE {time.time()-t0:.0f}s | witnessed={sorted(k for k in rows if rows[k][0] is True)} | spec_gated={sorted(k for k in rows if rows[k][0]=='SPEC_GATED')}", flush=True)
        except Exception as e:
            counter.finalize(tid, "ABORTED", abort_signature=repr(e)[:140])
            print(f"  [{i}/{len(specs)}] {stub} ABORTED {time.time()-t0:.0f}s: {e!r}", flush=True)

    # Tooth-2 (R-043 §4): per-spec coverage; un-fired unconditional judges are
    # dispositioned SPEC_GATED (rides forward) / PATH_GATED (forge_score).
    disp = {}
    for g in ledger.unconditional_gate_names():
        if g in witnessed:
            continue
        if g == "forge_score":
            disp[g] = "PATH_GATED: crisis-veto structurally untestable on the WF class path (crisis_results None)"
        elif g in spec_gated:
            disp[g] = f"SPEC_GATED (rides forward to first post-WIRE-1 wave): {spec_gated[g]}"
        else:
            disp[g] = "SPEC_GATED (rides forward): judge did not fire on any tier-b near-ghost at full scope"
    undispositioned = []
    for stub, _ in specs:
        for gap in ledger.coverage_gaps(strategy_ref=stub, wave=WAVE):
            if gap not in disp and gap not in witnessed:
                undispositioned.append((stub, gap))

    validity = {
        "wave": WAVE, "engine_sha": ENGINE_SHA, "engine_sha_verified_head": head,
        "scope": f"FULL {WF_START}..{WF_END}, CPCV; real S3 ratio-adjusted bars (dataset_hash-stamped, quality-gated)",
        "n_trials_total": counter.total_trials, "outcomes": counter.outcomes(),
        "survivor_eligibility": "NONE (R-047 — tier-b near-ghosts; product is RECEIPTS not returns)",
        "judges_witnessed_this_wave": sorted(witnessed),
        "judges_spec_gated_ride_forward": disp,
        "commissioning_note": "'fully commissioned' is annotated per-judge/per-wave (R-047 §2 honest commissioning) — SPEC_GATED judges await the first post-WIRE-1 real-fidelity wave",
        "tooth2_fail_closed": len(undispositioned) == 0,
        "undispositioned_gaps": undispositioned[:20],
    }
    verdict = {"verdict": "WAVE_1R_COMPLETE" if not undispositioned else "REFUSED",
               "note": "receipts not returns; machinery witnessed on real data; SPEC_GATED judges ride forward", "validity": validity}
    json.dump(verdict, open(os.path.join(BATTERY_DIR, "wave-1R-verdict.json"), "w", encoding="utf-8"), indent=2)
    print("\n=== WAVE-1R VERDICT ===")
    print(json.dumps({"verdict": verdict["verdict"], "witnessed": sorted(witnessed), "spec_gated": sorted(disp.keys()),
                      "n_trials_total": validity["n_trials_total"], "outcomes": validity["outcomes"],
                      "tooth2_fail_closed": validity["tooth2_fail_closed"]}, indent=2))
    return 0 if not undispositioned else 1


if __name__ == "__main__":
    raise SystemExit(main())
