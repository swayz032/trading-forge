"""R-030 §4 micro-rehearsal — FULL staged loop LIVE on the SPENT 2DXQqwKSwJE, through
the rater seam. Reuses the on-disk transcript (no npx); the ONLY live calls are the
no-tools `claude -p` dispatches. RESUMABLE: skips any dispatch whose artifact exists.
SPENT design-pool video only — NEVER the sealed 12.
"""
import hashlib, importlib.util, json, os, sys

ROOT = r"C:/Users/tonio/Projects/wt-h1-wave4-20260712"
WD = r"C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/d96dba1d-d874-4c26-8026-7ec19a8674ae/scratchpad/microreh"
VID = "2DXQqwKSwJE"
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location("h1_seal_conductor_cli", os.path.join(ROOT, "scripts", "h1_seal_conductor_cli.py"))
cli = importlib.util.module_from_spec(spec); spec.loader.exec_module(cli)


def log(*a): print(*a, flush=True)


# manifest + token (spent 2DX-only; hash != the known spent-16, passes the seal gate).
manifest = {
    "sealed_sha256": hashlib.sha256(VID.encode("utf-8")).hexdigest(),
    "sealed_sha256_method": "sha256 over the newline-joined sorted video_id list.",
    "videos": [{"video_id": VID}],
}
mpath = os.path.join(WD, "manifest.json"); open(mpath, "w", encoding="utf-8").write(json.dumps(manifest))
tpath = os.path.join(WD, "SEAL-GO.token"); open(tpath, "w", encoding="utf-8").write("GO (micro-rehearsal, spent 2DX)")


def _no_net_fetch(vid):
    return {"fetched": False, "final_outcome": "should_have_reused", "error": "network fetch must not run"}


log("=== STAGE plan (reuse on-disk transcript, no network) ===")
code, text = cli.run_stage_plan(WD, manifest_path=mpath, token_path=tpath, fetch_fn=_no_net_fetch)
log("plan exit:", code); log(text[:300])
if code != 0:
    sys.exit(1)

# 5 blind Phase-A draws (resumable: skip existing).
for i in range(cli.certified_reader_identity()["k"]):
    out = os.path.join(WD, "phase_a", VID, f"draw_{i}.json")
    if os.path.exists(out):
        log(f"phase_a draw {i}: exists, skip"); continue
    log(f"=== LIVE phase_a draw {i} ===")
    c, t = cli.run_dispatch(WD, "phase_a", VID, i)
    log(t)
    if c != 0:
        log("HALT on phase_a draw", i, "- stop (resumable: re-run to continue)"); sys.exit(2)

log("=== STAGE phase_a (driver computes consensus) ===")
c, t = cli.run_stage_phase_a(WD, manifest_path=mpath, token_path=tpath)
log("phase_a stage exit:", c); log(t[:400])
if c != 0:
    sys.exit(3)

consensus = json.load(open(cli._emit_path(WD, cli._PHASE_A_EMIT), encoding="utf-8"))
per_video = consensus.get("per_video") or {}
refs = (per_video.get(VID) or {}).get("strategy_refs") or []
log("consensus strategy_refs:", refs)

# Phase-B per consensus strategy (resumable).
for idx, _ref in enumerate(refs):
    out = os.path.join(WD, "phase_b", f"{VID}__s{idx}.json")
    if os.path.exists(out):
        log(f"phase_b s{idx}: exists, skip"); continue
    log(f"=== LIVE phase_b strategy {idx} ===")
    c, t = cli.run_dispatch(WD, "phase_b", VID, idx)
    log(t)
    if c != 0:
        log("HALT on phase_b", idx, "- stop (resumable)"); sys.exit(4)

log("=== STAGE certify (emits REAL rater packets) ===")
c, t = cli.run_stage_certify(WD, manifest_path=mpath, token_path=tpath)
log("certify exit:", c); log(t[:500])
if c != 0:
    sys.exit(5)

pkts = json.load(open(cli._emit_path(WD, cli._RATER_PKT_EMIT), encoding="utf-8"))
log("REAL rater packets emitted:", len(pkts.get("packets") or []))

# Live rater dispatch (rater A) against the REAL emitted packet.
for rid in ("A", "B"):
    out = os.path.join(WD, "raters", f"{rid}.json")
    if os.path.exists(out):
        log(f"rater {rid}: exists, skip"); continue
    log(f"=== LIVE rater {rid} (no-tools, embedded REAL packet, empty system prompt) ===")
    c, t = cli.run_dispatch(WD, "rater", None, rid)
    log(t)
    if c != 0:
        log("HALT on rater", rid, "- stop (resumable)"); sys.exit(6)
    ans = json.load(open(out, encoding="utf-8"))
    log(f"rater {rid} RECEIPT: stage1 items={len(ans.get('stage1') or {})}, stage2 items={len(ans.get('stage2') or {})}")

log("=== ALL RECEIPTS EARNED: phase_a x5 + phase_b + certify + raters A/B — LIVE, no-tools, spent 2DX ===")
