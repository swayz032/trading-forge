"""R-034 p4 — FAITHFUL live receipt through the verdict on spent 2DXQqwKSwJE.
Re-runs Phase-B SCOPED (live claude, now embedding the certified inventory) -> certify
-> LIVE gpt-5.4 panels -> LIVE raters (both stages) -> verdict + re-verify. First
end-to-end run with FAITHFUL inputs + live panels. SPENT video only. Resumable."""
import importlib.util, os, sys, json, shutil

ROOT = r"C:/Users/tonio/Projects/wt-h1-wave4-20260712"
WD = r"C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/d96dba1d-d874-4c26-8026-7ec19a8674ae/scratchpad/microreh_faithful"
SRC = r"C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/d96dba1d-d874-4c26-8026-7ec19a8674ae/scratchpad/microreh"
VID = "2DXQqwKSwJE"
sys.path.insert(0, os.path.join(ROOT, "scripts")); sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location("cli", os.path.join(ROOT, "scripts", "h1_seal_conductor_cli.py"))
cli = importlib.util.module_from_spec(spec); spec.loader.exec_module(cli)


def log(*a): print(*a, flush=True)


# fresh faithful work-dir: reuse the transcript + phase_a draws + consensus (unchanged),
# but REGENERATE phase_b (scoped) + panels + raters + verdict.
if not os.path.exists(WD):
    os.makedirs(os.path.join(WD, "transcripts"), exist_ok=True)
    shutil.copy(os.path.join(SRC, "transcripts", f"{VID}.txt"), os.path.join(WD, "transcripts", f"{VID}.txt"))
    shutil.copytree(os.path.join(SRC, "phase_a"), os.path.join(WD, "phase_a"))
    shutil.copytree(os.path.join(SRC, "emit"), os.path.join(WD, "emit"), dirs_exist_ok=True)
    for f in ("manifest.json", "SEAL-GO.token", "dispatch_record.json", "validity_inputs.json"):
        if os.path.exists(os.path.join(SRC, f)):
            shutil.copy(os.path.join(SRC, f), os.path.join(WD, f))
mp = os.path.join(WD, "manifest.json"); tp = os.path.join(WD, "SEAL-GO.token")

# re-emit phase_a consensus (carries consensus_scopes) — offline, deterministic.
c, t = cli.run_stage_phase_a(WD, manifest_path=mp, token_path=tp); log("phase_a stage:", c)
refs = ((json.load(open(cli._emit_path(WD, cli._PHASE_A_EMIT), encoding="utf-8"))["per_video"].get(VID) or {}).get("strategy_refs")) or []
log("consensus refs:", refs)

# Phase-B SCOPED live (resumable).
for idx in range(len(refs)):
    if os.path.exists(os.path.join(WD, "phase_b", f"{VID}__s{idx}.json")):
        log(f"phase_b s{idx}: exists, skip"); continue
    log(f"=== LIVE phase_b s{idx} (SCOPED — embeds certified inventory) ===")
    c, t = cli.run_dispatch(WD, "phase_b", VID, idx); log(t)
    if c != 0:
        log("HALT phase_b", idx); sys.exit(2)

# certify (regenerate packets from the scoped extractions; live gemma anchoring).
c, t = cli.run_stage_certify(WD, manifest_path=mp, token_path=tp); log("certify:", c, t[:200])
if c != 0:
    sys.exit(3)

# LIVE panels (gpt-5.4) per cid.
import h1_seal_panel_dispatch as pd
cids = [f"{VID}__s{i}" for i in range(len(refs))]
for cid in cids:
    if os.path.exists(os.path.join(WD, "panels", f"{cid}.json")):
        log(f"panel {cid}: exists, skip"); continue
    log(f"=== LIVE panel {cid} (gpt-5.4 x3 axes) ===")
    c, t = pd.run_panel_dispatch(WD, cid); log(t)
    if c != 0:
        log("HALT panel", cid); sys.exit(4)

# LIVE raters (both stages, both raters).
for rid in ("A", "B"):
    if os.path.exists(os.path.join(WD, "raters", f"{rid}.json")):
        st = json.load(open(os.path.join(WD, "raters", f"{rid}.json"), encoding="utf-8"))
        if "stage1" in st and "stage2" in st:
            log(f"rater {rid}: complete, skip"); continue
    for stage in ("stage1", "stage2"):
        log(f"=== LIVE rater {rid} {stage} ===")
        c, t = cli.run_dispatch(WD, "rater", None, rid, rater_stage=stage); log(t)
        if c != 0:
            log("HALT rater", rid, stage); sys.exit(5)

# VERDICT + re-verify.
log("=== VERDICT (faithful inputs + live panels) ===")
c, t = cli.run_stage_verdict(WD, manifest_path=mp, token_path=tp)
log("verdict exit:", c); log(t)
log("=== FAITHFUL THROUGH-VERDICT RECEIPT COMPLETE ===")
