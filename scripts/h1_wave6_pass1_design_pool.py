"""H1 Wave-6 Pass-1 — DESIGN-POOL measurement driver (Gates 2 & 3 only).

Per the frozen packet (docs/designs/h1-wave6-pass1-quote-as-you-extract-PACKET-2026-07-12.md
§3, Gates 2-3): re-runs the UPGRADED extractor (transcript-extractor-minimal.md +
transcript-extractor-minimal-schema.json, both edited by this pass) over the spent-16
gold regression corpus's ALREADY-CACHED transcripts (no re-fetch, no anchor-locator,
no tier-1/tier-3 classification — those are explicitly OUT of scope per packet §4).

Writes to a NEW vault dir (docs/replay-results/h1-scripts/wave6-pass1-design-pool/) —
NEVER touches docs/replay-results/h1-scripts/pilot-run/ (the frozen gold regression
corpus / spent-16 artifacts must stay untouched, per the campaign's read-once law).

Outputs:
  - extraction-vault/{video_id}.json  — raw upgraded-extractor output per video
  - gate2_gate3_report.json           — coverage counts (Gate 2) + mechanical
                                         substring-check results (Gate 3 pre-filter)

Gate 3's one-rater semantic pass is NOT automated here (it is a judgment call) — this
script prints every mechanically-surviving (quote, condition-text) pair for manual
one-rater review; the rating itself is recorded separately.

Run from repo root: python scripts/h1_wave6_pass1_design_pool.py
"""
from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from src.engine.extraction import extractor_bridge as eb  # noqa: E402
from src.engine.extraction.pilot_conveyor import extract_spine_condition_texts  # noqa: E402

PILOT_TRANSCRIPT_DIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run", "transcripts")
PILOT_PHASE1_SUMMARY = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run", "phase1_summary.json")
OUT_DIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "wave6-pass1-design-pool")
VAULT_DIR = os.path.join(OUT_DIR, "extraction-vault")

for d in (OUT_DIR, VAULT_DIR):
    os.makedirs(d, exist_ok=True)


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().lower()


# Condition-bearing fields per the packet's schema addition: entry_sequence[] and
# confluences[] carry REQUIRED transcript_quote; stop and targets[] carry OPTIONAL
# (nullable) transcript_quote. This walks every quote-bearing slot (whether or not
# it is populated) for the mechanical substring check + one-rater review list.
def iter_quote_bearing_conditions(strategy: dict):
    entry_seq = strategy.get("entry_sequence") or []
    if isinstance(entry_seq, list):
        for i, step in enumerate(entry_seq):
            if not isinstance(step, dict):
                continue
            yield {
                "field": f"entry_sequence[{i}]", "quote": step.get("transcript_quote"),
                "condition_text": step.get("action"), "nullable": False,
            }

    confluences = strategy.get("confluences") or []
    if isinstance(confluences, list):
        for i, c in enumerate(confluences):
            if not isinstance(c, dict):
                continue
            yield {
                "field": f"confluences[{i}]", "quote": c.get("transcript_quote"),
                "condition_text": c.get("description"), "nullable": False,
            }

    stop = strategy.get("stop")
    if isinstance(stop, dict) and stop.get("anchor") is not None:
        yield {
            "field": "stop", "quote": stop.get("transcript_quote"),
            "condition_text": stop.get("rationale") or stop.get("anchor"), "nullable": True,
        }

    targets = strategy.get("targets") or []
    if isinstance(targets, list):
        for i, t in enumerate(targets):
            if not isinstance(t, dict):
                continue
            yield {
                "field": f"targets[{i}]", "quote": t.get("transcript_quote"),
                "condition_text": t.get("rationale") or t.get("type"), "nullable": True,
            }


def run() -> None:
    video_ids = sorted(
        vid[:-5] for vid in os.listdir(PILOT_TRANSCRIPT_DIR) if vid.endswith(".json")
    )
    print(f"[pass1-design-pool] {len(video_ids)} cached spent-16 transcripts found", flush=True)

    with open(PILOT_PHASE1_SUMMARY, encoding="utf-8") as fh:
        baseline_summary = json.load(fh)
    baseline_by_video = {r["video_id"]: r for r in baseline_summary["rows"]}
    baseline_total = baseline_summary["totals"]["spine_conditions"]

    per_video_rows = []
    quote_bearing_rows = []  # for Gate 3
    failures = []

    for idx, vid in enumerate(video_ids):
        print(f"\n[pass1-design-pool] ({idx+1}/{len(video_ids)}) {vid}", flush=True)
        with open(os.path.join(PILOT_TRANSCRIPT_DIR, f"{vid}.json"), encoding="utf-8") as fh:
            tr = json.load(fh)
        transcript = tr["transcript"]

        vault_path = os.path.join(VAULT_DIR, f"{vid}.json")
        if os.path.exists(vault_path):
            print(f"[pass1-design-pool]   RESUME: vault present, skip re-extraction", flush=True)
            with open(vault_path, encoding="utf-8") as fh:
                extraction = json.load(fh)["extraction"]
        else:
            try:
                extraction = eb.invoke_real_extractor(transcript, f"{vid}-wave6-pass1")
            except eb.RealExtractorError as exc:
                failures.append((vid, str(exc)[:500]))
                print(f"[pass1-design-pool]   EXTRACTION FAILED (recorded, continuing): {str(exc)[:300]}", flush=True)
                continue
            eb.save_extraction(VAULT_DIR, vid, extraction, {"seed": 42, "temperature": 0.1, "model": "gemma4:e4b-it-qat", "pass": "wave6-pass1"})

        strategies = extraction.get("strategies") or []
        n_spine = 0
        n_quote_present = 0
        n_quote_mech_pass = 0
        tnorm = norm(transcript)

        for sidx, strat in enumerate(strategies):
            if not isinstance(strat, dict):
                continue
            spine = extract_spine_condition_texts(strat, sidx)
            n_spine += len(spine)

            for qc in iter_quote_bearing_conditions(strat):
                q = qc["quote"]
                row = {
                    "video_id": vid, "strategy_index": sidx, "strategy_name": strat.get("name"),
                    "field": qc["field"], "transcript_quote": q, "condition_text": qc["condition_text"],
                    "nullable": qc["nullable"],
                }
                if q:
                    n_quote_present += 1
                    mech_pass = norm(q) in tnorm
                    row["mechanical_substring_pass"] = mech_pass
                    if mech_pass:
                        n_quote_mech_pass += 1
                else:
                    row["mechanical_substring_pass"] = None  # null quote — only valid if nullable
                    if not qc["nullable"]:
                        row["VIOLATION"] = "required transcript_quote is null/missing"
                quote_bearing_rows.append(row)

        baseline_row = baseline_by_video.get(vid, {})
        baseline_spine = baseline_row.get("spine_conditions", "?")
        row = {
            "video_id": vid, "strategies": len(strategies), "spine_conditions_pass1": n_spine,
            "spine_conditions_baseline": baseline_spine,
            "quote_bearing_slots": n_quote_present, "quote_mechanical_pass": n_quote_mech_pass,
        }
        per_video_rows.append(row)
        print(f"[pass1-design-pool]   strategies={len(strategies)} spine_pass1={n_spine} "
              f"(baseline={baseline_spine}) quote_slots={n_quote_present} mech_pass={n_quote_mech_pass}", flush=True)

    total_pass1 = sum(r["spine_conditions_pass1"] for r in per_video_rows)
    worst_strategy_note = None
    # per-strategy guard: need per-strategy baseline counts too — derive from pilot video jsons
    per_strategy_baseline = {}
    pilot_videos_dir = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run", "videos")
    for vid in video_ids:
        vp = os.path.join(pilot_videos_dir, f"{vid}.json")
        if not os.path.exists(vp):
            continue
        with open(vp, encoding="utf-8") as fh:
            vart = json.load(fh)
        for s in vart.get("strategies", []):
            key = f"{vid}::s{s['strategy_index']}"
            per_strategy_baseline[key] = s["spine_condition_count"]

    per_strategy_pass1 = {}
    for vid in video_ids:
        vault_path = os.path.join(VAULT_DIR, f"{vid}.json")
        if not os.path.exists(vault_path):
            continue
        with open(vault_path, encoding="utf-8") as fh:
            extraction = json.load(fh)["extraction"]
        for sidx, strat in enumerate(extraction.get("strategies") or []):
            if not isinstance(strat, dict):
                continue
            key = f"{vid}::s{sidx}"
            per_strategy_pass1[key] = len(extract_spine_condition_texts(strat, sidx))

    per_strategy_deltas = []
    for key, base_count in per_strategy_baseline.items():
        p1_count = per_strategy_pass1.get(key, 0)
        pct_retained = (p1_count / base_count * 100) if base_count else None
        per_strategy_deltas.append({
            "strategy": key, "baseline_conditions": base_count, "pass1_conditions": p1_count,
            "pct_retained": pct_retained, "loses_over_50pct": (pct_retained is not None and pct_retained < 50.0),
        })

    total_quote_slots = sum(r["quote_bearing_slots"] for r in per_video_rows)
    total_mech_pass = sum(r["quote_mechanical_pass"] for r in per_video_rows)

    report = {
        "artifact": "h1-wave6-pass1-design-pool-gate2-gate3-report",
        "scope": "spent-16 gold regression corpus ONLY (never the fresh Wave-6 sealed set)",
        "extractor_files_measured": [
            "src/agents/transcript-extractor-minimal.md",
            "src/agents/kb/transcript-extractor-minimal-schema.json",
        ],
        "n_videos": len(video_ids),
        "n_extraction_failures": len(failures),
        "extraction_failures": failures,
        "gate2_coverage": {
            "baseline_total_spine_conditions": baseline_total,
            "pass1_total_spine_conditions": total_pass1,
            "floor_required": round(0.9 * baseline_total),
            "floor_met": total_pass1 >= round(0.9 * baseline_total),
            "per_video": per_video_rows,
            "per_strategy_guard": per_strategy_deltas,
            "any_strategy_loses_over_50pct": any(d["loses_over_50pct"] for d in per_strategy_deltas),
        },
        "gate3_mechanical_prefilter": {
            "total_quote_bearing_slots_with_quote": total_quote_slots,
            "mechanical_substring_pass": total_mech_pass,
            "mechanical_substring_fail": total_quote_slots - total_mech_pass,
            "mechanical_pass_rate": (total_mech_pass / total_quote_slots) if total_quote_slots else None,
        },
        "quote_bearing_rows_for_one_rater_pass": quote_bearing_rows,
    }
    with open(os.path.join(OUT_DIR, "gate2_gate3_report.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(report, fh, indent=2, default=str)

    print("\n" + "=" * 70)
    print(f"GATE 2 — coverage: baseline={baseline_total} pass1={total_pass1} "
          f"floor(90%)={round(0.9*baseline_total)} MET={report['gate2_coverage']['floor_met']}")
    print(f"GATE 2 — per-strategy guard: any strategy lost >50%? "
          f"{report['gate2_coverage']['any_strategy_loses_over_50pct']}")
    print(f"GATE 3 — mechanical pre-filter: {total_mech_pass}/{total_quote_slots} pass "
          f"({report['gate3_mechanical_prefilter']['mechanical_pass_rate']:.1%})" if total_quote_slots else "GATE 3 — no quote-bearing slots found")
    print(f"[pass1-design-pool] report written: {os.path.join(OUT_DIR, 'gate2_gate3_report.json')}")
    print("=" * 70)


if __name__ == "__main__":
    run()
