"""TIER-(a) INTEGER RECEIPT (R-037 §3 / R-042 §6 / R-043 §5) — derive the CLEAN-
STRATEGY count from disk, verify-from-artifact (never from memory; AR-028's
"between 9 and 13" is a bound, not the pin). Deterministic rollup replay from the
persisted sealed-read WD (same machinery RECOMPUTE ran under R-035; the token is
READ-only verified, never touched/written). The read is SPENT + FINAL — this is a
registration-time rollup derivation of the already-final verdict, not a new read.

Tier-(a) integer = sum over videos of `n_clean_strategies` (a strategy is clean
iff terminal_read_grade==CLEAN; cert->video rollup, sealed_read_driver.py:3023).

TWO-PATH CHECK (feedback_two_path_derivation): the derived rollup MUST match the
known-final verdict (clean_videos=9, n_videos=11, fraction=0.8182). If it does,
this is the same final rollup and the n_clean_strategies sum is the legitimate
tier-(a) pin. Disagreement = ALARM, not a pin.
"""
import importlib.util
import json
import os
import sys

ROOT = r"C:/Users/tonio/Projects/wt-h1-wave4-20260712"
WD = r"C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/d96dba1d-d874-4c26-8026-7ec19a8674ae/scratchpad/SEALED-READ"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location("cli", os.path.join(ROOT, "scripts", "h1_seal_conductor_cli.py"))
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)

import tempfile
out_dir = tempfile.mkdtemp(prefix="tier-a-rollup-")
driver = cli.SealedReadDriver()

# Replicate _drive_full_sealed_read's driver.run_verdict call to capture the
# STRUCTURED verdict (the CLI wrapper only returns printed text).
dispatch_record = cli._load_dispatch_record(WD)
validity_inputs = cli._load_validity_inputs(WD)
source_attrition = cli._load_source_attrition(WD)

composed = driver.run_verdict(
    cli.PINNED_SEALED12_MANIFEST,
    mode="sealed",
    out_dir=os.path.join(out_dir, "sealed"),
    token_path=cli.PINNED_TOKEN_PATH,
    live_phase_a_draw_fn=cli._make_conductor_phase_a_draw_fn(WD),
    live_phase_b_fn=cli._make_conductor_phase_b_fn(WD),
    live_panel_fn=cli._make_conductor_panel_fn(WD),
    rater_fn=cli._make_conductor_rater_fn(WD),
    dispatch_record=dispatch_record,
    propose_fn=None,
    source_attrition=source_attrition,
    dispatch_retry_total=cli._scan_dispatch_retry_total(WD),
    **validity_inputs,
)

if not composed.get("ok"):
    print("HALT: seal gate refused —", composed.get("halt_reason")); sys.exit(1)

verdict = composed["verdict"]
vu = verdict["video_unit"]
per_video = vu["per_video"]

print("=== derived video-unit rollup ===", flush=True)
print(f"verdict: {verdict.get('verdict')}")
print(f"clean_videos={vu['clean_videos']}  n_videos={vu['n_videos']}  fraction={vu['video_clean_fraction']}")
print("--- per-video ---")
tier_a = 0
total_strategies = 0
for r in per_video:
    print(f"  {r['video_id']:16s} n_strategies={r['n_strategies']} n_clean_strategies={r['n_clean_strategies']} clean_video={r['clean']}")
    tier_a += r["n_clean_strategies"]
    total_strategies += r["n_strategies"]

print("\n=== TIER-(a) DERIVATION ===")
print(f"TIER_A_CLEAN_STRATEGY_COUNT = {tier_a}  (sum of n_clean_strategies)")
print(f"total_strategies = {total_strategies}   clean_videos = {vu['clean_videos']}   n_videos = {vu['n_videos']}")

# TWO-PATH CHECK against the known-final verdict.
ok_frac = str(vu["video_clean_fraction"]).startswith("0.8182")
ok_cv = vu["clean_videos"] == 9
ok_nv = vu["n_videos"] == 11
print("\n=== TWO-PATH CHECK vs known-final verdict (9/11, 0.8182) ===")
print(f"clean_videos==9: {ok_cv}   n_videos==11: {ok_nv}   fraction==0.8182: {ok_frac}")
if ok_frac and ok_cv and ok_nv:
    print(f"MATCH — the derived rollup IS the final verdict's. TIER-(a) PIN = {tier_a}")
    receipt = {
        "artifact": "h1-tier-a-clean-strategy-receipt",
        "derivation": "sum(n_clean_strategies) over the cert->video rollup, replayed deterministically from the persisted sealed-read WD",
        "tier_a_clean_strategy_count": tier_a,
        "total_strategies": total_strategies,
        "clean_videos": vu["clean_videos"],
        "n_videos": vu["n_videos"],
        "video_clean_fraction": vu["video_clean_fraction"],
        "two_path_match_final_verdict": True,
        "per_video": [{"video_id": r["video_id"], "n_strategies": r["n_strategies"], "n_clean_strategies": r["n_clean_strategies"], "clean_video": r["clean"]} for r in per_video],
        "provenance": "verify-from-disk (R-037 §3); read is SPENT+FINAL; token read-only verified, never touched",
    }
    recpath = os.path.join(ROOT, "docs", "replay-results", "h1-battery", "tier-a-clean-strategy-receipt.json")
    os.makedirs(os.path.dirname(recpath), exist_ok=True)
    json.dump(receipt, open(recpath, "w", encoding="utf-8"), indent=2)
    print("receipt ->", recpath)
else:
    print("!!! ALARM: derived rollup does NOT match the final verdict — NOT a pin. HALT.")
    sys.exit(1)
