"""THE SEALED-12 TERMINAL READ — the once-only exam (R-034 §5 auto-open).

Authorization: operator SEAL-GO.token (his hand) + his in-session "yes" + R-032 GO
re-armed by R-034 §5 (completed matrix + clean pre-flight). Runs the FROZEN runbook via
the staged CLI on the REAL pinned sealed-12 manifest (4d7b3c29). RESUMABLE (skip-if-
exists) — rate limits interrupt; re-running continues. Any guard HALT -> stop + report,
zero improvisation. The verdict is reported VERBATIM as AR-026.
"""
import importlib.util, os, sys, json

ROOT = r"C:/Users/tonio/Projects/wt-h1-wave4-20260712"
WD = r"C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/d96dba1d-d874-4c26-8026-7ec19a8674ae/scratchpad/SEALED-READ"
sys.path.insert(0, os.path.join(ROOT, "scripts")); sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location("cli", os.path.join(ROOT, "scripts", "h1_seal_conductor_cli.py"))
cli = importlib.util.module_from_spec(spec); spec.loader.exec_module(cli)
import h1_seal_panel_dispatch as pd

os.makedirs(WD, exist_ok=True)


def log(*a): print(*a, flush=True)


def guard(code, text, where):
    if code != 0:
        log(f"!!! HALT at {where}: {text[:400]}")
        sys.exit(10)


# STEP 1 — plan (real pinned manifest + token): Module-A gate + fetch the twelve + emit.
log("=== STEP 1: STAGE plan (real sealed-12; Module-A gate + fetch) ===")
c, t = cli.run_stage_plan(WD)  # defaults = PINNED_SEALED12_MANIFEST + PINNED_TOKEN_PATH
log(t[:600]); guard(c, t, "plan")
plan = json.load(open(cli._emit_path(WD, cli._PLAN_EMIT), encoding="utf-8"))
draws = plan["phase_a_dispatches"]
log(f"plan: {len(draws)} Phase-A draws across {plan['readable_n']}/{plan['sealed_total']} readable videos")

# STEP 2 — the 5 blind Phase-A draws per readable video (resumable).
for d in draws:
    out = os.path.join(WD, "phase_a", d["video_id"], f"draw_{d['draw_index']}.json")
    if os.path.exists(out):
        continue
    log(f"--- Phase-A {d['video_id']} draw {d['draw_index']} ---")
    c, t = cli.run_dispatch(WD, "phase_a", d["video_id"], d["draw_index"]); log(t)
    guard(c, t, f"phase_a {d['video_id']} d{d['draw_index']}")

# STEP 3 — driver computes the consensus.
log("=== STAGE phase_a (driver consensus) ===")
c, t = cli.run_stage_phase_a(WD); log(t[:400]); guard(c, t, "phase_a stage")
consensus = json.load(open(cli._emit_path(WD, cli._PHASE_A_EMIT), encoding="utf-8"))["per_video"]

# STEP 4 — Phase-B per consensus strategy (scoped; resumable).
for vid, pv in consensus.items():
    for idx in range(len(pv.get("strategy_refs") or [])):
        out = os.path.join(WD, "phase_b", f"{vid}__s{idx}.json")
        if os.path.exists(out):
            continue
        log(f"--- Phase-B {vid} s{idx} (scoped) ---")
        c, t = cli.run_dispatch(WD, "phase_b", vid, idx); log(t)
        guard(c, t, f"phase_b {vid} s{idx}")

# STEP 5 — certify (gemma anchoring; emits panels + raters).
log("=== STAGE certify (anchor + emit panels/raters) ===")
c, t = cli.run_stage_certify(WD); log(t[:400]); guard(c, t, "certify")
cids = [p["cid"] for p in json.load(open(cli._emit_path(WD, cli._RATER_PKT_EMIT), encoding="utf-8"))["packets"]]
log(f"certify: {len(cids)} cids")

# STEP 6 — panels per cid (live gpt-5.4; resumable).
for cid in cids:
    if os.path.exists(os.path.join(WD, "panels", f"{cid}.json")):
        continue
    log(f"--- Panel {cid} (gpt-5.4 x3) ---")
    c, t = pd.run_panel_dispatch(WD, cid); log(t)
    guard(c, t, f"panel {cid}")

# STEP 7 — the two blind raters (both stages; resumable).
for rid in ("A", "B"):
    rp = os.path.join(WD, "raters", f"{rid}.json")
    have = json.load(open(rp, encoding="utf-8")) if os.path.exists(rp) else {}
    for stage in ("stage1", "stage2"):
        if stage in have:
            continue
        log(f"--- Rater {rid} {stage} ---")
        c, t = cli.run_dispatch(WD, "rater", None, rid, rater_stage=stage); log(t)
        guard(c, t, f"rater {rid} {stage}")

# STEP 8 — the verdict + re-verify. Reported VERBATIM.
log("=== STAGE verdict (the terminal read; reported verbatim) ===")
c, t = cli.run_stage_verdict(WD)
log("verdict exit:", c)
log(t)
log("=== SEALED-12 TERMINAL READ COMPLETE — report this verdict as AR-026 ===")
