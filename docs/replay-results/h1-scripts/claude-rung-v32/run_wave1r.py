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


class MappingSchemaError(RuntimeError):
    """R-048 §2: a verdict/disposition mapping read a key ABSENT from the result
    schema. Fail-loud — a missing key must NEVER silently default to a constant
    (the F-1/min_paths disease: a nonexistent `min_paths`, read via `.get()`,
    made the cpcv verdict a constant PASS). One guard kills the whole
    silent-degradation class. A raise here is caught by the runner's per-spec
    try/except -> a VISIBLE ABORTED with signature, not a silent wrong verdict."""


def _req(d: dict, key: str, ctx: str):
    """Strict verdict read (R-048 §2). Absence of `key` RAISES; a PRESENT value is
    returned verbatim (None is a legitimate signal — a MISSING KEY is a schema
    break). Use ONLY for keys the WF class-result contract guarantees; branch
    discriminators that legitimately test optional presence stay on `.get()`."""
    if key not in d:
        raise MappingSchemaError(
            f"R-048 §2 strict-key guard: required verdict key {key!r} absent from "
            f"{ctx} (present keys={sorted(d)}). A verdict mapping must not read a "
            f"missing key and default to a constant — fail-loud instead."
        )
    return d[key]


def _wf_gate_rows(res: dict):
    """Extract per-judge (fired, verdict, receipt) from a WF result, reading the
    REAL keys (grader F-1/F-3: dsr + n_paths live nested in `wf_metadata`, not
    top-level; the CPCV floor is n_paths>=15 per promotion-gate-orchestrator.ts).
    A judge whose stat the class-CPCV path genuinely never computes ->
    ('PATH_GATED', reason) (a PATH property, not a ghost-spec property).

    R-048 §2: every VERDICT-DETERMINING read goes through `_req` — a schema drop
    now RAISES (visible ABORTED) instead of degrading to a silent constant."""
    V_PASS, V_FAIL, V_NE = pl_mod.VERDICT_PASS, pl_mod.VERDICT_FAIL, pl_mod.VERDICT_NOT_EVALUATED
    wfm = res.get("wf_metadata") or {}
    rows = {}

    # walk_forward — fires whenever the WF ran; NOT_EVALUATED when WFE degenerate.
    if wfm:
        wfe = _req(res, "wfe_overall", "wf-result")
        status = _req(res, "wfe_status", "wf-result")
        deg = status == "degenerate_is"
        rows["walk_forward"] = (True, V_NE if deg else (V_PASS if (wfe or 0) >= 0.70 else V_FAIL),
                                {"wfe_overall": wfe, "wfe_status": status, "n_folds": wfm.get("n_folds")})
        # cpcv — FIRES when mode==cpcv; real verdict = n_paths >= the institutional
        # floor 15 (CPCV_MIN_PATHS, promotion-gate-orchestrator.ts). (F-1 fix: was a
        # vacuous `n_folds>=min_paths` where min_paths never exists -> always PASS.
        # R-048 §2: mode + n_paths are now STRICT reads — a schema drop RAISES,
        # never silently skips cpcv or degrades its verdict to a constant.)
        if _req(wfm, "mode", "wf_metadata") == "cpcv":
            n_paths = _req(wfm, "n_paths", "wf_metadata[cpcv]")
            rows["cpcv"] = (True, V_PASS if n_paths >= 15 else V_FAIL,
                            {"n_paths": n_paths, "cpcv_floor": 15, "n_folds": wfm.get("n_folds"), "path_sharpes": res.get("path_sharpes")})
    # pbo — degenerate -> spec-gated (a real degenerate-split property).
    pbo = _req(res, "pbo_overall", "wf-result")
    if pbo is not None and not _req(res, "pbo_degenerate", "wf-result"):
        rows["pbo"] = (True, V_FAIL if pbo > 0.15 else V_PASS, {"pbo_overall": pbo, "p_value": res.get("pbo_overall_p_value")})
    else:
        rows["pbo"] = ("SPEC_GATED", "pbo_degenerate: no IS/OOS split variation to overfit on this spec")
    # bif.
    bif = _req(res, "bif", "wf-result")
    if bif is not None and not _req(res, "bif_computation_error", "wf-result"):
        rows["bif"] = (True, V_FAIL if bif > 4.0 else V_PASS, {"bif": bif, "detail": str(res.get("bif_detail"))[:120]})
    else:
        rows["bif"] = ("SPEC_GATED", "bif_computation_error")
    # slippage_survival.
    ss = res.get("slippage_survival")
    if isinstance(ss, dict) and ss:
        rows["slippage_survival"] = (True, V_NE, {k: ss.get(k) for k in ("breaks_at", "multiples", "pf") if k in ss})
    # dsr — FIRES: computed unconditionally, nested at wf_metadata.dsr/dsr_pass
    # (F-3 fix: was wrongly checked at top-level -> always None -> falsely
    # spec-gated with a statistically-unsound "needs positive Sharpe" reason;
    # DSR accepts any Sharpe sign). SPEC_GATED only when genuinely unavailable.
    # R-048 §2: dsr_unavailable + dsr are STRICT reads (the contract emits both);
    # only when the WF genuinely ran (wfm present) — a no-WF result has no dsr.
    if wfm:
        dsr_unavail = _req(wfm, "dsr_unavailable", "wf_metadata")
        dsr_val = _req(wfm, "dsr", "wf_metadata")
        if dsr_unavail or dsr_val is None:
            rows["dsr"] = ("SPEC_GATED", f"dsr_unavailable (dsr={dsr_val}, dsr_unavailable={dsr_unavail})")
        else:
            dsr_pass = _req(wfm, "dsr_pass", "wf_metadata")
            rows["dsr"] = (True, V_PASS if dsr_pass else V_FAIL, {"dsr": dsr_val, "dsr_pass": dsr_pass})
    # wrc / spa / monte_carlo_ruin — the class-CPCV walk-forward path does NOT
    # compute these (F-4 fix: a PATH-level absence for EVERY spec, not a ghost
    # property). PATH_GATED: their witnessed-firing requirement transfers to a
    # path that computes them (the full run_backtest / promotion path).
    for gate in ("wrc", "spa", "monte_carlo_ruin"):
        rows[gate] = ("PATH_GATED", f"{gate} is not computed in the class-CPCV walk-forward path (path-level absence, all specs)")
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    import hashlib
    import subprocess
    head = subprocess.run(["git", "-C", WT, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    if head != ENGINE_SHA:
        print(f"HALT: engine HEAD {head[:12]} != {ENGINE_SHA[:12]}"); return 1

    # EFFECTIVE-N dedup tuple (R-048 §3). dataset_hash = the CANONICAL hash the
    # bar-cache provenance sidecar stamps (authoritative; identical across the
    # buggy run and this remap re-run -> they collapse to ONE in the denominator).
    prov = os.path.join(WT, "data_cache", "ES", "ratio_adj", "5min.parquet.provenance.json")
    DATASET_HASH = json.load(open(prov, encoding="utf-8"))["dataset_hash"] if os.path.exists(prov) else None
    if DATASET_HASH is None:
        print("HALT: dataset provenance sidecar missing — cannot stamp the effective-N dataset_hash"); return 1
    # config_hash = the experiment config that, WITH the spec+engine+data, defines
    # a deterministic replicate. The remap did NOT change any of these -> the
    # corrected re-run shares the tuple with the buggy run and dedups by construction.
    CONFIG_HASH = hashlib.sha256(json.dumps({
        "runner": "run_walk_forward_class", "wf_start": WF_START, "wf_end": WF_END,
        "embargo_bars": 20, "mode": "cpcv", "cpcv_floor": 15, "symbol": "MES", "timeframe": "5m",
    }, sort_keys=True).encode()).hexdigest()
    epoch = {"engine_sha": ENGINE_SHA, "pid": os.getpid(), "concurrency": 1, "wave": WAVE,
             "bar_source": "S3 ratio-adjusted (dataset_hash-stamped, quality-gated, cached)",
             "dataset_hash": DATASET_HASH, "config_hash": CONFIG_HASH}

    counter = tc_mod.TrialCounter(os.path.join(BATTERY_DIR, "trial-counter.json"), engine_sha_at_zero=ENGINE_SHA)
    ledger = pl_mod.PassageLedger(os.path.join(BATTERY_DIR, "passage-ledger.json"))
    # R-048 §3: annotate the PRE-REMAP buggy rows SUPERSEDED_BY_REMAP (never delete).
    # The distinguisher is the null dedup-tuple slot (config_hash) — only pre-fix
    # rows lack it; every corrected row carries it -> idempotent + re-run-safe.
    # The pre-remap buggy rows used the IDENTICAL experiment (same spec×engine×S3
    # data×WF config) — backfill their true, disk-derived dedup tuple so they
    # COLLAPSE with the corrected re-run in effective_n (double-count solved by
    # pure computation, R-048 §3), only where currently null.
    _pre = lambda r: r.get("config_hash") is None
    n_sup_c = counter.annotate_superseded(wave=WAVE, by="AR-044 (R-048 §3 remap)", predicate=_pre,
                                          backfill_dataset_hash=DATASET_HASH, backfill_config_hash=CONFIG_HASH)
    n_sup_l = ledger.annotate_superseded(wave=WAVE, by="AR-044 (R-048 §3 remap)", predicate=_pre,
                                         backfill_dataset_hash=DATASET_HASH, backfill_config_hash=CONFIG_HASH)
    print(f"R-048 §3: annotated {n_sup_c} counter rows + {n_sup_l} ledger rows SUPERSEDED_BY_REMAP (retained, not deleted)", flush=True)
    # resume: specs FINALIZED in this wave are skipped — EXCEPT superseded rows
    # (the buggy run's finalizations must not block their corrected re-run).
    done = {r["strategy_ref"] for r in counter._doc["runs"]
            if r["wave"] == WAVE and r["outcome"] in ("PASS", "FAIL") and not r.get("superseded_by_remap")}

    specs = _specs()[: args.limit] if args.limit else _specs()
    witnessed, gated = set(), {}  # gated[gate] = (SPEC_GATED|PATH_GATED, reason)
    raw_dir = os.path.join(BATTERY_DIR, "wave1r_raw")
    os.makedirs(raw_dir, exist_ok=True)
    SCOPE = "wave-1R; real S3 ratio-adj bars; tier-b near-ghost; framework-behavior measurement, NOT edge evidence"
    print(f"WAVE-1R on {ENGINE_SHA[:8]} | {len(specs)} specs | FULL scope {WF_START}..{WF_END} | already done: {len(done)}", flush=True)

    for i, (stub, art) in enumerate(specs, 1):
        if stub in done:
            print(f"  [{i}/{len(specs)}] {stub} SKIP (already finalized)", flush=True); continue
        approx = art["approximation_metrics"]["binding_approximation_rate"]
        tid = counter.allocate(wave=WAVE, strategy_ref=stub, spec_hash=art["spec_hash"], engine_sha=ENGINE_SHA,
                               binding_approximation_rate=approx, survivor_eligible=False, run_epoch=epoch, scope_line=SCOPE,
                               dataset_hash=DATASET_HASH, config_hash=CONFIG_HASH)
        t0 = time.time()
        try:
            strat = from_compiled_spec(art, symbol="MES", timeframe="5m", strategy_name=stub)
            res = run_walk_forward_class(strategy=strat, start_date=WF_START, end_date=WF_END, embargo_bars=20)
            # PERSIST the raw WF judge stats (grader lesson: a re-map must never
            # need a re-run) — the slim slice _wf_gate_rows reads.
            if isinstance(res, dict):
                slim = {k: res.get(k) for k in ("wf_metadata", "wfe_overall", "wfe_status", "pbo_overall",
                        "pbo_overall_p_value", "pbo_degenerate", "bif", "bif_computation_error", "bif_detail",
                        "slippage_survival", "path_sharpes")}
                json.dump(slim, open(os.path.join(raw_dir, stub + ".json"), "w", encoding="utf-8"), indent=1, default=str)
            rows = _wf_gate_rows(res) if isinstance(res, dict) else {}
            exit_prov = (art["spec"].get("framework_overlay") or {}).get("exit")
            for gate, info in rows.items():
                if info[0] in ("SPEC_GATED", "PATH_GATED"):
                    gated[gate] = (info[0], info[1])
                    continue
                _fired, verdict, receipt = info
                witnessed.add(gate)
                ledger.record(wave=WAVE, strategy_ref=stub, spec_hash=art["spec_hash"], engine_sha=ENGINE_SHA,
                              gate=gate, received=True, fired=True, verdict=verdict, binding_approximation_rate=approx,
                              inputs_seen=list(receipt.keys()), value=receipt,
                              engaged_features=["real_bar_data(S3_ratio_adj)", "cpcv", "fill_model"],
                              exit_provenance=exit_prov, audit_level="first-passage-full", scope_line=SCOPE)
            counter.finalize(tid, "FAIL")  # receipts, not returns — ghosts fail by design
            print(f"  [{i}/{len(specs)}] {stub} DONE {time.time()-t0:.0f}s | witnessed={sorted(k for k in rows if rows[k][0] is True)} | gated={sorted(k for k in rows if rows[k][0] in ('SPEC_GATED','PATH_GATED'))}", flush=True)
        except Exception as e:
            counter.finalize(tid, "ABORTED", abort_signature=repr(e)[:140])
            print(f"  [{i}/{len(specs)}] {stub} ABORTED {time.time()-t0:.0f}s: {e!r}", flush=True)

    # Tooth-2 (R-043 §4): every un-witnessed unconditional judge is dispositioned
    # with its ACTUAL reason (SPEC_GATED = ghost-spec property, rides forward;
    # PATH_GATED = the class-CPCV path doesn't surface it — NOT "did not fire").
    disp = {}
    for g in ledger.unconditional_gate_names():
        if g in witnessed:
            continue
        if g in gated:
            kind, reason = gated[g]
            disp[g] = f"{kind}: {reason}" + (" [rides forward to first post-WIRE-1 wave]" if kind == "SPEC_GATED" else "")
        elif g == "performance_gate":
            disp[g] = ("PATH_GATED: check_performance_gate FIRES per-OOS-window inside run_class_backtest "
                       "(witnessed on shakedown-1's single-backtest path) but is NOT aggregated into the WF "
                       "top-level result — a runner aggregation boundary, NOT 'did not fire' and NOT a ghost property")
        elif g == "forge_score":
            disp[g] = "PATH_GATED: crisis-veto structurally untestable on the WF class path (crisis_results None)"
        else:
            disp[g] = "PATH_GATED: not surfaced in the class-CPCV walk-forward aggregate result"
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
        "judges_gated_this_wave": disp,  # SPEC_GATED (ghost-spec, rides forward) + PATH_GATED (class-CPCV path doesn't surface it)
        "commissioning_note": "per-judge/per-wave honest commissioning (R-047 §2): SPEC_GATED judges ride forward to the first post-WIRE-1 wave; PATH_GATED judges (e.g. performance_gate fires per-window but isn't aggregated here; wrc/spa/mc not computed on the class-CPCV path) are witnessed on a path that surfaces them, NOT deferred as ghost-properties",
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
