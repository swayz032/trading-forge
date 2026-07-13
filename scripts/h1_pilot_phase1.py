"""H1 pilot — PHASE 1 driver (conductor-authored; consumes the frozen instrument, does NOT modify it).

Per sealed video: fetch (production youtube-transcript path via scripts/h1-fetch-one.ts)
-> invoke_real_extractor (real gemma, vaulted atomically) -> prepare_video (real anchor-locator gemma
per condition + tier-1 + 3-axis dual-read + two-stage tier-3 packet). Writes durable artifacts under
docs/replay-results/h1-scripts/pilot-run/. One pass per video, read-once (Addendum 2 clause 2); a re-run
replaces a whole video's pass (vault + this driver overwrite atomically).

Run from repo root: python scripts/h1_pilot_phase1.py
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
import os
import pickle
import subprocess
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

# Windows consoles default to cp1252 and crash on emoji in video titles — force UTF-8 with replacement.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import json as _json  # noqa: E402
import urllib.error  # noqa: E402

from src.engine.extraction import anchor_locator as al  # noqa: E402
from src.engine.extraction import extractor_bridge as eb  # noqa: E402
from src.engine.extraction import pilot_conveyor as pc  # noqa: E402

# --- robust PROPOSE seam (NOT an instrument edit; uses prepare_video's documented propose_fn seam) ---
# The frozen anchor_locator._default_propose_fn calls json.loads on gemma's message.content, which
# occasionally comes back EMPTY (gemma4 thinking-only / transient) -> uncaught JSONDecodeError crashes
# the whole video. The locator ALREADY defines the semantics of an unproposable anchor: abstain -> None
# -> UNANCHORED (REASON_LOCATOR_DECLINED). This wrapper calls the instrument's OWN propose function
# byte-for-byte, retrying transient empty/malformed content, and converting a PERSISTENT failure into
# that already-frozen abstain. A real transport/connection error (gemma DOWN) propagates unchanged (the
# genuine tripwire). Parse-failure abstains are counted separately as an infra signal (Law 7 scope).
PROPOSE_ABSTAIN_BY_PARSE_FAILURE = [0]


def robust_propose(transcript: str, condition_text: str):
    last = None
    for _ in range(3):
        try:
            return al._default_propose_fn(transcript, condition_text)
        except _json.JSONDecodeError as exc:  # empty/malformed gemma content -> transient, retry
            last = exc
            continue
        except urllib.error.URLError:  # gemma DOWN -> genuine tripwire, do not swallow
            raise
    PROPOSE_ABSTAIN_BY_PARSE_FAILURE[0] += 1
    print(f"[phase1]   WARN anchor propose abstained after 3 empty/malformed gemma responses "
          f"(last={last}); condition treated as UNANCHORED (honest decline)", flush=True)
    return None

SEALED_PATH = os.path.join(ROOT, "docs", "designs", "h1-sealed-fresh-set-2026-07-12.json")
OUT_DIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run")
VID_DIR = os.path.join(OUT_DIR, "videos")
VAULT_DIR = os.path.join(OUT_DIR, "extraction-vault")
TRANSCRIPT_DIR = os.path.join(OUT_DIR, "transcripts")
PREP_DIR = os.path.join(OUT_DIR, "preps")  # per-video prep checkpoints (resume support)
FETCH_SCRIPT = os.path.join(ROOT, "scripts", "h1-fetch-one.ts")
TAXONOMY_VERSION = "h1-pilot-2026-07-12"

for d in (OUT_DIR, VID_DIR, VAULT_DIR, TRANSCRIPT_DIR, PREP_DIR):
    os.makedirs(d, exist_ok=True)


def fetch_transcript(video_id: str, timeout_s: float = 180.0) -> dict:
    """Production youtube-transcript path via the TS bridge. Cached to disk (read-once)."""
    cache = os.path.join(TRANSCRIPT_DIR, f"{video_id}.json")
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as fh:
            return json.load(fh)
    payload = json.dumps({"video_id": video_id})
    proc = subprocess.run(
        ["npx", "tsx", FETCH_SCRIPT],
        input=payload, capture_output=True, text=True, cwd=ROOT,
        timeout=timeout_s, shell=(os.name == "nt"),
    )
    result = None
    for ln in reversed([l for l in proc.stdout.splitlines() if l.strip()]):
        try:
            result = json.loads(ln)
            break
        except json.JSONDecodeError:
            continue
    if result is None or result.get("error") or not result.get("transcript"):
        raise RuntimeError(
            f"TRANSCRIPT FETCH FAILED video={video_id} rc={proc.returncode} "
            f"err={result.get('error') if result else None} stderr_tail={proc.stderr[-1500:]!r}"
        )
    tmp = cache + f".{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(result, fh)
    os.replace(tmp, cache)
    return result


def jsonable(obj):
    if dataclasses.is_dataclass(obj):
        return {k: jsonable(v) for k, v in dataclasses.asdict(obj).items()}
    if isinstance(obj, dict):
        return {k: jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    return obj


def prep_json_view(prep: dict) -> dict:
    """Human/audit view of one strategy's prep (dataclasses flattened)."""
    outcomes = prep["condition_outcomes"]
    by_outcome: dict = {}
    for o in outcomes:
        by_outcome[o["outcome"]] = by_outcome.get(o["outcome"], 0) + 1
    return {
        "strategy_index": prep["strategy_index"],
        "spine_condition_count": prep["spine_condition_count"],
        "anchor_report": prep["anchor_report"],
        "condition_outcomes": outcomes,
        "outcome_counts": by_outcome,
        "tier1_classified_count": len(prep["tier1_detections"]),
        "tier1_fallthrough_count": len(prep["tier1_fallthroughs"]),
        "unanchored_conditions": jsonable(prep["unanchored_conditions"]),
        "axis3_audit": prep["axis3_audit"],
        "tier3_packet": prep["tier3_packet"],
        "item_span_map": {k: list(v) for k, v in prep["item_span_map"].items()},
        "leak_scan_clean": prep["leak_scan"].clean,
        "provenance": prep["provenance"],
    }


def run() -> None:
    with open(SEALED_PATH, encoding="utf-8") as fh:
        sealed = json.load(fh)
    ids = sealed["sealed_id_list_sorted"]
    meta_by_id = {v["video_id"]: v for v in sealed["videos"]}
    extractor_version = pc.extractor_version_pin(ROOT)
    print(f"[phase1] extractor_version={extractor_version}", flush=True)
    print(f"[phase1] {len(ids)} sealed videos; UNSEAL BEGINS", flush=True)

    failures = []  # (vid, reason)
    for idx, vid in enumerate(ids):
        prep_pkl = os.path.join(PREP_DIR, f"{vid}.pkl")
        if os.path.exists(prep_pkl):
            print(f"[phase1] ({idx+1}/{len(ids)}) {vid} — RESUME: per-video checkpoint present, skip", flush=True)
            continue
        t0 = time.time()
        meta = meta_by_id.get(vid, {})
        print(f"\n[phase1] ({idx+1}/{len(ids)}) {vid} — {meta.get('title','?')}", flush=True)
        try:
            tr = fetch_transcript(vid)
        except Exception as exc:  # fetch throttle / disabled captions — record, keep going
            failures.append((vid, str(exc)[:400]))
            print(f"[phase1]   FETCH FAILED (recorded, continuing): {str(exc)[:200]}", flush=True)
            continue
        transcript = tr["transcript"]
        tsha = hashlib.sha256(transcript.encode("utf-8")).hexdigest()
        print(f"[phase1]   transcript {tr['char_count']} chars outcome={tr.get('final_outcome')}", flush=True)

        extraction = eb.get_or_extract(VAULT_DIR, vid, transcript)
        strategies = extraction.get("strategies") or []
        print(f"[phase1]   extracted {len(strategies)} strategies", flush=True)

        preps = pc.prepare_video(
            extraction, transcript, vid, extractor_version, TAXONOMY_VERSION,
            full_transcript_sha256=tsha, propose_fn=robust_propose,
        )
        strat_views = [prep_json_view(p) for p in preps]
        vid_fallthrough = sum(v["tier1_fallthrough_count"] for v in strat_views)
        vid_classified = sum(v["tier1_classified_count"] for v in strat_views)
        vid_axis2_zero = sum(v["outcome_counts"].get("fallthrough_axis2_zero_content_overlap", 0) for v in strat_views)
        vid_audit = sum(1 for v in strat_views if v["axis3_audit"] and v["axis3_audit"].get("char_span"))
        vid_anchored = sum(v["anchor_report"]["anchored_count"] for v in strat_views)
        vid_unanchored = sum(v["anchor_report"]["unanchored_count"] for v in strat_views)
        vid_spine = sum(v["spine_condition_count"] for v in strat_views)
        adjudications = vid_fallthrough + vid_audit  # Addendum 6/7 per-video aggregate
        row = {
            "video_id": vid, "title": meta.get("title"), "strategies": len(strategies),
            "spine_conditions": vid_spine, "anchored": vid_anchored, "unanchored": vid_unanchored,
            "tier1_classified": vid_classified, "tier1_fallthrough": vid_fallthrough,
            "axis2_zero_content_overlap": vid_axis2_zero, "axis3_audit_items": vid_audit,
            "adjudications_aggregate": adjudications,
        }
        vid_artifact = {
            "video_id": vid, "title": meta.get("title"), "channel": meta.get("channel"),
            "transcript_sha256": tsha, "transcript_char_count": tr["char_count"],
            "transcript_final_outcome": tr.get("final_outcome"),
            "extractor_version": extractor_version, "taxonomy_version": TAXONOMY_VERSION,
            "strategies_extracted": len(strategies), "raw_extraction": extraction,
            "strategies": strat_views, "video_rollup": {k: row[k] for k in (
                "spine_conditions", "anchored", "unanchored", "tier1_classified", "tier1_fallthrough",
                "axis2_zero_content_overlap", "axis3_audit_items", "adjudications_aggregate")},
        }
        # atomic per-video checkpoints: json (audit) + pkl (exact preps for Phase 3 / resume)
        tmpj = os.path.join(VID_DIR, f"{vid}.json.tmp")
        with open(tmpj, "w", encoding="utf-8") as fh:
            json.dump(vid_artifact, fh, indent=2, default=str)
        os.replace(tmpj, os.path.join(VID_DIR, f"{vid}.json"))
        tmpp = prep_pkl + f".{os.getpid()}.tmp"
        with open(tmpp, "wb") as fh:
            pickle.dump({"meta": meta, "preps": preps, "row": row}, fh)
        os.replace(tmpp, prep_pkl)
        print(f"[phase1]   strat={len(strategies)} spine={vid_spine} anchored={vid_anchored} "
              f"unanchored={vid_unanchored} classified={vid_classified} fallthrough={vid_fallthrough} "
              f"axis2zero={vid_axis2_zero} audit={vid_audit} adj={adjudications} "
              f"({time.time()-t0:.0f}s)", flush=True)

    # Assemble from per-video checkpoints (resume-safe).
    all_preps, summary_rows, missing = [], [], []
    for vid in ids:
        prep_pkl = os.path.join(PREP_DIR, f"{vid}.pkl")
        if not os.path.exists(prep_pkl):
            missing.append(vid)
            continue
        with open(prep_pkl, "rb") as fh:
            rec = pickle.load(fh)
        all_preps.append((rec["meta"], rec["preps"]))
        summary_rows.append(rec["row"])

    complete = not missing
    if complete:
        with open(os.path.join(OUT_DIR, "phase1_preps.pkl"), "wb") as fh:
            pickle.dump({"extractor_version": extractor_version, "taxonomy_version": TAXONOMY_VERSION,
                         "all_preps": all_preps, "summary_rows": summary_rows}, fh)
    if failures or missing:
        print(f"[phase1] INCOMPLETE — fetch_failures={[f[0] for f in failures]} missing={missing}", flush=True)
        with open(os.path.join(OUT_DIR, "phase1_INCOMPLETE.json"), "w", encoding="utf-8") as fh:
            json.dump({"completed": [r["video_id"] for r in summary_rows], "missing": missing,
                       "fetch_failures": failures}, fh, indent=2)

    summary = {
        "artifact": "h1-pilot-phase1-summary",
        "sealed_sha256": sealed["sealed_sha256"],
        "extractor_version": extractor_version,
        "n_videos": len(ids),
        "n_completed": len(summary_rows),
        "complete": complete,
        "missing": missing,
        "fetch_failures": [f[0] for f in failures],
        "propose_abstain_by_parse_failure": PROPOSE_ABSTAIN_BY_PARSE_FAILURE[0],
        "rows": summary_rows,
        "totals": {
            "strategies": sum(r["strategies"] for r in summary_rows),
            "spine_conditions": sum(r["spine_conditions"] for r in summary_rows),
            "anchored": sum(r["anchored"] for r in summary_rows),
            "unanchored": sum(r["unanchored"] for r in summary_rows),
            "tier1_classified": sum(r["tier1_classified"] for r in summary_rows),
            "tier1_fallthrough": sum(r["tier1_fallthrough"] for r in summary_rows),
            "axis2_zero_content_overlap": sum(r["axis2_zero_content_overlap"] for r in summary_rows),
            "axis3_audit_items": sum(r["axis3_audit_items"] for r in summary_rows),
            "adjudications_total": sum(r["adjudications_aggregate"] for r in summary_rows),
        },
    }
    with open(os.path.join(OUT_DIR, "phase1_summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2, default=str)
    print("\n[phase1] DONE. summary:", json.dumps(summary["totals"]), flush=True)


if __name__ == "__main__":
    run()
