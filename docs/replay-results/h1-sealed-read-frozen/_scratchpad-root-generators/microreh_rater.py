"""R-031 §3 — re-earn the RATER receipt LIVE on spent 2DXQqwKSwJE: two sequential
stage-scoped no-tools dispatches (stage1 blind roles, then stage2 support), ingestible,
guards passing. Reuses the existing phase_a/phase_b artifacts; re-emits certify to get
output_contract-bearing packets. SPENT video only — NEVER the twelve."""
import hashlib, importlib.util, json, os, sys

ROOT = r"C:/Users/tonio/Projects/wt-h1-wave4-20260712"
WD = r"C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/d96dba1d-d874-4c26-8026-7ec19a8674ae/scratchpad/microreh"
VID = "2DXQqwKSwJE"
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location("h1_seal_conductor_cli", os.path.join(ROOT, "scripts", "h1_seal_conductor_cli.py"))
cli = importlib.util.module_from_spec(spec); spec.loader.exec_module(cli)


def log(*a): print(*a, flush=True)


mpath = os.path.join(WD, "manifest.json")
tpath = os.path.join(WD, "SEAL-GO.token")
if not os.path.exists(mpath):
    manifest = {"sealed_sha256": hashlib.sha256(VID.encode()).hexdigest(),
                "sealed_sha256_method": "sha256 over the newline-joined sorted video_id list.",
                "videos": [{"video_id": VID}]}
    open(mpath, "w", encoding="utf-8").write(json.dumps(manifest))
if not os.path.exists(tpath):
    open(tpath, "w", encoding="utf-8").write("GO (micro-rehearsal, spent 2DX)")

# quarantine the OLD contaminated rater answer (R-031 §a5) if present.
old = os.path.join(WD, "raters", "A.json")
if os.path.exists(old):
    qd = os.path.join(WD, "raters_quarantine"); os.makedirs(qd, exist_ok=True)
    os.replace(old, os.path.join(qd, "A.pre-r031.json")); log("quarantined pre-R-031 rater A answer")

log("=== STAGE certify RE-EMIT (packets now carry output_contract) ===")
c, t = cli.run_stage_certify(WD, manifest_path=mpath, token_path=tpath)
log("certify exit:", c)
if c != 0:
    log(t[:400]); sys.exit(1)
pkts = json.load(open(cli._emit_path(WD, cli._RATER_PKT_EMIT), encoding="utf-8"))["packets"]
log("packets:", len(pkts), "| packet0 has output_contract:", "output_contract" in (pkts[0] if pkts else {}))

# Two sequential stage-scoped dispatches for rater A (the receipt).
for stage in ("stage1", "stage2"):
    log(f"=== LIVE rater A {stage} (no-tools, stage-scoped embed) ===")
    c, t = cli.run_dispatch(WD, "rater", None, "A", rater_stage=stage)
    log(t)
    if c != 0:
        log(f"HALT on rater A {stage}"); sys.exit(2)

store = json.load(open(os.path.join(WD, "raters", "A.json"), encoding="utf-8"))
log("--- RATER RECEIPT (A) ---")
log("stage1 roles:", len(store.get("stage1") or {}), "| sample:", dict(list((store.get("stage1") or {}).items())[:2]))
s2 = store.get("stage2") or {}
log("stage2 support:", len(s2), "| sample:", {k: v.get("support") for k, v in list(s2.items())[:2]})
log("=== RATER RECEIPT EARNED: both stages ingestible, stage-scoped, guards passed ===")
