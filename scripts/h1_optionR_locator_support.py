#!/usr/bin/env python3
"""H1 Option R (recombination) — locator-anchored support over pass-2's conditions.

Per h1-optionR-recombination-preregistration-2026-07-13.md §2:
  - SAME conditions pass-2 extracted (the 195 quote_bearing_rows_for_one_rater_pass
    from the pass-2 design-pool report -- same condition_text/field/video_id).
  - DIFFERENT anchor authority: the band-8 `anchor_locator.locate_anchor`
    (PROPOSE via gemma -> VERIFY by mechanical substring), NOT pass-2's generated
    quote field (which is demoted to scaffolding, §1.2).
  - Support = located / conditions. Report BOTH numbers (§12): gated-comparable
    (over the 194 non-null) AND terminal-equivalent (over all 195, decline=miss).
  - FROZEN bar, UNCHANGED: >=92% support / <=8% miss.
  - spent-16 design pool ONLY. Sealed 12 untouched.

Reuses the pilot's proven mechanism unchanged. Heavy: ~195 gemma locator calls.
"""
import json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src.engine.extraction import anchor_locator as al  # band-8, unchanged

PASS2_REPORT = os.path.join(ROOT, "docs", "replay-results", "h1-scripts",
                            "wave6-pass2-design-pool", "gate2_gate3_report.json")
TDIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run", "transcripts")
OUT_DIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "optionR-locator-support")
os.makedirs(OUT_DIR, exist_ok=True)


def load_transcript(vid):
    d = json.load(open(os.path.join(TDIR, f"{vid}.json"), encoding="utf-8"))
    if isinstance(d, dict):
        if isinstance(d.get("text"), str):
            return d["text"]
        for k in ("transcript", "segments", "content"):
            v = d.get(k)
            if isinstance(v, str):
                return v
            if isinstance(v, list):
                return " ".join(s.get("text", "") if isinstance(s, dict) else str(s) for s in v)
    if isinstance(d, list):
        return " ".join(s.get("text", "") if isinstance(s, dict) else str(s) for s in d)
    return json.dumps(d)


def main():
    rep = json.load(open(PASS2_REPORT, encoding="utf-8"))
    rows = rep["quote_bearing_rows_for_one_rater_pass"]
    print(f"[optionR] conditions to locator-anchor: {len(rows)}", flush=True)

    tx_cache = {}
    results = []
    located_all = 0
    located_nonnull = 0
    nonnull_total = 0

    for i, row in enumerate(rows):
        vid = row["video_id"]
        ct = row.get("condition_text") or ""
        had_quote = bool(row.get("transcript_quote"))  # scaffolding only, for accounting
        if vid not in tx_cache:
            tx_cache[vid] = load_transcript(vid)
        tx = tx_cache[vid]

        # THE recombination: locator anchors the CONDITION TEXT, quote field ignored.
        res = al.locate_anchor(tx, ct)  # default propose_fn = real gemma-local
        located = bool(res.located)
        if located:
            located_all += 1
        if had_quote:
            nonnull_total += 1
            if located:
                located_nonnull += 1

        results.append({
            "video_id": vid,
            "strategy_index": row.get("strategy_index"),
            "field": row.get("field"),
            "condition_text": ct,
            "pass2_quote_had_value": had_quote,
            "locator_located": located,
            "locator_reason": None if located else getattr(res, "reason", None),
            "locator_quote": getattr(res, "quote", None) if located else None,
        })
        if (i + 1) % 10 == 0:
            print(f"[optionR] {i+1}/{len(rows)} located_all={located_all}", flush=True)

    n_all = len(rows)
    miss_all = n_all - located_all
    miss_nonnull = nonnull_total - located_nonnull

    gated = {
        "description": "GATED-comparable locator support -- over the 194 non-null "
                       "(pass-2 quote-bearing) conditions, apples-to-apples with pass-2's gated read.",
        "denominator_nonnull": nonnull_total,
        "located": located_nonnull,
        "miss": miss_nonnull,
        "support_miss_rate": (miss_nonnull / nonnull_total) if nonnull_total else None,
        "floor_met_le_8pct": (miss_nonnull / nonnull_total <= 0.08) if nonnull_total else None,
    }
    terminal = {
        "description": "TERMINAL-EQUIVALENT locator support -- over ALL 195 one-rater-pass "
                       "conditions, locator DECLINE counted as a MISS. The number the fresh-12 "
                       "terminal read reproduces.",
        "denominator_all": n_all,
        "located": located_all,
        "miss": miss_all,
        "support_miss_rate": miss_all / n_all,
        "floor_met_le_8pct": (miss_all / n_all) <= 0.08,
    }

    out = {
        "artifact": "h1-optionR-locator-support",
        "scope": "spent-16 design pool ONLY; sealed-12 UNTOUCHED",
        "prereg": "docs/designs/h1-optionR-recombination-preregistration-2026-07-13.md",
        "anchor_authority": "band-8 anchor_locator.locate_anchor (PROPOSE gemma -> VERIFY mechanical substring)",
        "note": "pass-2 generated quote field DEMOTED to scaffolding; NOT the anchor (§1.2). "
                "SAME condition set as pass-2's gate; DIFFERENT anchor authority.",
        "frozen_bar": ">=92% support / <=8% miss (UNCHANGED, no goalpost motion)",
        "gated_comparable_support": gated,
        "terminal_equivalent_support": terminal,
        "per_condition": results,
    }
    with open(os.path.join(OUT_DIR, "optionR_locator_support_report.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)

    print("=" * 70, flush=True)
    print(f"OPTION R -- locator-anchored support over pass-2's conditions", flush=True)
    print(f"  GATED-comparable (n={nonnull_total}):     miss={gated['support_miss_rate']*100:.1f}% "
          f"floor<=8% MET={gated['floor_met_le_8pct']}", flush=True)
    print(f"  TERMINAL-equivalent (n={n_all}): miss={terminal['support_miss_rate']*100:.1f}% "
          f"floor<=8% MET={terminal['floor_met_le_8pct']}", flush=True)
    print("=" * 70, flush=True)
    print(f"[optionR] report: {os.path.join(OUT_DIR, 'optionR_locator_support_report.json')}", flush=True)


if __name__ == "__main__":
    main()
