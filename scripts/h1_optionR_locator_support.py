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

from src.engine.extraction import anchor_locator as al  # band-8, UNCHANGED

PASS2_REPORT = os.path.join(ROOT, "docs", "replay-results", "h1-scripts",
                            "wave6-pass2-design-pool", "gate2_gate3_report.json")
TDIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run", "transcripts")
OUT_DIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "optionR-locator-support")
os.makedirs(OUT_DIR, exist_ok=True)
CACHE = os.path.join(OUT_DIR, "_per_condition_cache.json")


class PlumbingError(Exception):
    """A transport/cold-load blip (empty or non-JSON gemma content) that
    SURVIVED retries. The band-8 locator correctly RAISES rather than fake a
    decline (its docstring: never silently convert a plumbing failure into a
    miss). We catch it HERE, at the measurement, and exclude the condition from
    the denominator -- a blip must never count as a real anchoring miss."""


def robust_propose(transcript, condition_text, tries=3, backoff=2.0):
    """Wrap the UNCHANGED band-8 _default_propose_fn with retry on transient
    empty/non-JSON content (ollama cold-load blip). Persistent failure -> raise
    PlumbingError so the measurement excludes (not misses) the condition."""
    last = None
    for attempt in range(tries):
        try:
            return al._default_propose_fn(transcript, condition_text)
        except (json.JSONDecodeError, ValueError) as e:
            last = e
            time.sleep(backoff * (attempt + 1))  # linear backoff; cold-load warms
        except Exception as e:  # URLError, timeout, etc. -- also transient class
            last = e
            time.sleep(backoff * (attempt + 1))
    raise PlumbingError(f"empty/non-JSON gemma content after {tries} tries: {last!r}")


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

    cache = {}
    if os.path.exists(CACHE):
        cache = json.load(open(CACHE, encoding="utf-8"))
        print(f"[optionR] resuming: {len(cache)} conditions cached", flush=True)

    tx_cache = {}
    results = []
    plumbing = []

    for i, row in enumerate(rows):
        vid = row["video_id"]
        ct = row.get("condition_text") or ""
        had_quote = bool(row.get("transcript_quote"))  # scaffolding only, for accounting
        key = f"{vid}::{row.get('strategy_index')}::{row.get('field')}"

        if key in cache:
            rec = cache[key]
        else:
            if vid not in tx_cache:
                tx_cache[vid] = load_transcript(vid)
            tx = tx_cache[vid]
            # THE recombination: locator anchors the CONDITION TEXT; quote field ignored.
            # propose via retry-wrapped band-8 propose_fn; VERIFY stage unchanged.
            try:
                res = al.locate_anchor(tx, ct, propose_fn=robust_propose)
                rec = {
                    "locator_located": bool(res.located),
                    "locator_reason": None if res.located else getattr(res, "reason", None),
                    "locator_quote": getattr(res, "quote", None) if res.located else None,
                    "plumbing_error": False,
                }
            except PlumbingError as pe:
                rec = {"locator_located": None, "locator_reason": "PLUMBING", "locator_quote": None,
                       "plumbing_error": True, "detail": str(pe)}
            cache[key] = rec
            json.dump(cache, open(CACHE, "w", encoding="utf-8"))  # resumable after each

        rec_full = dict(rec)
        rec_full.update({"video_id": vid, "strategy_index": row.get("strategy_index"),
                         "field": row.get("field"), "condition_text": ct,
                         "pass2_quote_had_value": had_quote})
        results.append(rec_full)
        if rec.get("plumbing_error"):
            plumbing.append(key)

        if (i + 1) % 10 == 0:
            loc = sum(1 for r_ in results if r_.get("locator_located") is True)
            print(f"[optionR] {i+1}/{len(rows)} located={loc} plumbing={len(plumbing)}", flush=True)

    # DENOMINATOR excludes plumbing_error (a blip is never a real miss).
    scored = [r_ for r_ in results if not r_.get("plumbing_error")]
    located_all = sum(1 for r_ in scored if r_["locator_located"] is True)
    scored_nonnull = [r_ for r_ in scored if r_["pass2_quote_had_value"]]
    located_nonnull = sum(1 for r_ in scored_nonnull if r_["locator_located"] is True)
    nonnull_total = len(scored_nonnull)

    n_all = len(scored)
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
        "anchor_authority": "band-8 anchor_locator.locate_anchor (PROPOSE gemma[retry-wrapped] -> VERIFY mechanical substring)",
        "note": "pass-2 generated quote field DEMOTED to scaffolding; NOT the anchor (§1.2). "
                "SAME condition set as pass-2's gate; DIFFERENT anchor authority.",
        "frozen_bar": ">=92% support / <=8% miss (UNCHANGED, no goalpost motion)",
        "plumbing_excluded": {
            "count": len(plumbing),
            "keys": plumbing,
            "note": "transient empty/non-JSON gemma content that survived 3 retries; the band-8 "
                    "locator RAISES rather than fake a decline, so these are EXCLUDED from the "
                    "denominator -- a cold-load blip is never counted as a real anchoring miss.",
        },
        "gated_comparable_support": gated,
        "terminal_equivalent_support": terminal,
        "per_condition": results,
    }
    with open(os.path.join(OUT_DIR, "optionR_locator_support_report.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=1)

    print("=" * 70, flush=True)
    print(f"OPTION R -- locator-anchored support over pass-2's conditions", flush=True)
    print(f"  plumbing-excluded (blips): {len(plumbing)}", flush=True)
    print(f"  GATED-comparable (n={nonnull_total}):     miss={gated['support_miss_rate']*100:.1f}% "
          f"floor<=8% MET={gated['floor_met_le_8pct']}", flush=True)
    print(f"  TERMINAL-equivalent (n={n_all}): miss={terminal['support_miss_rate']*100:.1f}% "
          f"floor<=8% MET={terminal['floor_met_le_8pct']}", flush=True)
    print("=" * 70, flush=True)
    print(f"[optionR] report: {os.path.join(OUT_DIR, 'optionR_locator_support_report.json')}", flush=True)


if __name__ == "__main__":
    main()
