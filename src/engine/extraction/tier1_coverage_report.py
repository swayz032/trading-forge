"""H1 tier-1 coverage / overfit / birth-gate harness (spec §7).

Materializes the frozen 143-design / 78-held-out condition-text split from the
authoritative artifacts, runs the tier-1 layer over both, and emits every number
the pre-registration asks for:

  - per-detector birth-fixture pass (fires-on-pos ∧ silent-on-neg, spec §3.2)
  - tier1_coverage(design_143) and tier1_coverage(heldout_78) per-family + layer
  - overfit_ratio = coverage(143)/coverage(78), checked vs the ≤1.85× tripwire
  - held-out false-fire (precision) spot-check on narration negatives

MATERIALIZATION SOURCES (authoritative, not invented):
  - docs/replay-results/corpus-v3-heldout-split-2026-07-05.json
      -> rules_design_keys (143) + held_out_keys (78); method
         "sha256(condition_id) low-byte mod 10 < 3 -> held-out" (deterministic).
  - docs/replay-results/dri-audit-2026-07-05.json
      -> full_classification_table_first_pass (221 rows, each with the trader's
         verbatim `quote`). Split keys `video||condition_id` join onto these.

RECONCILIATION of the docs' "70": the frozen split's held-out partition is 78
conditions. The gate-1 respec's "49/70 held-out" is the SCORABLE subset used for
the human-vs-gold AGREEMENT calc (UNRESOLVED / unscorable held-out conditions
were dropped from that rate), NOT a different split. For tier-1 COVERAGE every
held-out condition has a quote and is testable, so the full 78 is the correct,
complete held-out denominator. The 70-scorable (held-out minus UNRESOLVED)
subset is reported alongside as a cross-check.

Run:  python -m src.engine.extraction.tier1_coverage_report
"""

from __future__ import annotations

import json
import os
from typing import Dict, List, Tuple

from .tier1_detectors import run_tier1

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_SPLIT = os.path.join(_ROOT, "docs", "replay-results", "corpus-v3-heldout-split-2026-07-05.json")
_AUDIT = os.path.join(_ROOT, "docs", "replay-results", "dri-audit-2026-07-05.json")
_FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "tier1_birth_fixtures.json")

_TRIPWIRE = 1.85  # phase-1-h1-preregistration §7 pinned overfit ratio ceiling


# --------------------------------------------------------------------------- #
# Materialization
# --------------------------------------------------------------------------- #


def materialize_sets() -> Tuple[List[dict], List[dict]]:
    """Return (design_143, heldout_78) as lists of audit rows (each with a
    verbatim `quote`), joined from the frozen split keys."""
    split = json.load(open(_SPLIT, encoding="utf-8"))
    audit = json.load(open(_AUDIT, encoding="utf-8"))
    by_key = {
        f"{r['video']}||{r['condition_id']}": r
        for r in audit["full_classification_table_first_pass"]
    }
    design = [by_key[k] for k in split["rules_design_keys"]]
    heldout = [by_key[k] for k in split["held_out_keys"]]
    # Integrity: disjoint + counts match the frozen file.
    assert not (set(split["rules_design_keys"]) & set(split["held_out_keys"]))
    assert len(design) == split["rules_design_count"] == 143, len(design)
    assert len(heldout) == split["held_out_count"] == 78, len(heldout)
    return design, heldout


# --------------------------------------------------------------------------- #
# Coverage
# --------------------------------------------------------------------------- #


def _fires_by_family(quote: str) -> Dict[str, bool]:
    res = run_tier1(quote)
    classes = {d.surface_class for d in res.detections}
    return {
        "imperative": "imperative" in classes,
        "conditional-action": "conditional-action" in classes,
        "exclusion-contrast": "exclusion-contrast" in classes,
        "any": res.fired,
    }


def coverage(rows: List[dict]) -> Dict[str, float]:
    n = len(rows)
    counts = {"imperative": 0, "conditional-action": 0, "exclusion-contrast": 0, "any": 0}
    for r in rows:
        fam = _fires_by_family(r["quote"])
        for k in counts:
            if fam[k]:
                counts[k] += 1
    return {
        k: {"fires": counts[k], "n": n, "coverage": round(counts[k] / n, 4)}
        for k in counts
    }


# --------------------------------------------------------------------------- #
# Birth gate (spec §3.2)
# --------------------------------------------------------------------------- #


def run_birth_gate() -> dict:
    fx = json.load(open(_FIXTURES, encoding="utf-8"))
    out = {"detectors": [], "all_pass": True}
    for det in fx["detectors"]:
        name = det["detector"]
        failures = []
        for p in det["positives"]:
            res = run_tier1(p["text"])
            fired = res.fired
            cls_ok = True
            anch_ok = True
            exp = p["expect"]
            if fired and "surface_class" in exp:
                cls_ok = any(d.surface_class == exp["surface_class"] for d in res.detections)
            if fired and "anchor_substring" in exp:
                anch_ok = any(exp["anchor_substring"] in d.quote_anchor for d in res.detections)
            if not (fired and cls_ok and anch_ok):
                failures.append({"id": p["id"], "kind": "positive_missed",
                                 "fired": fired, "cls_ok": cls_ok, "anchor_ok": anch_ok})
        for ng in det["negatives"]:
            res = run_tier1(ng["text"])
            if res.fired:
                failures.append({"id": ng["id"], "kind": "negative_fired",
                                 "surface_class": res.detections[0].surface_class,
                                 "anchor": res.detections[0].quote_anchor})
        passed = len(failures) == 0
        out["detectors"].append({
            "detector": name,
            "positives": len(det["positives"]),
            "negatives": len(det["negatives"]),
            "passed": passed,
            "failures": failures,
        })
        out["all_pass"] = out["all_pass"] and passed
    return out


def run_layer_reliability() -> dict:
    fx = json.load(open(_FIXTURES, encoding="utf-8"))
    ctl = fx["layer_reliability_controls"]
    gate_caught = []
    for g in ctl["gate_controls"]:
        res = run_tier1(g["text"])
        gate_caught.append({"id": g["id"], "fired": res.fired,
                            "surface_class": res.detections[0].surface_class if res.fired else None})
    desc_fired = []
    for d in ctl["descriptive_controls_must_be_silent"]:
        res = run_tier1(d["text"])
        if res.fired:
            desc_fired.append({"id": d["id"], "surface_class": res.detections[0].surface_class})
    caught = sum(1 for g in gate_caught if g["fired"])
    return {
        "gate_control_catch_rate": f"{caught}/{len(gate_caught)}",
        "gate_controls": gate_caught,
        "descriptive_controls_silent": len(desc_fired) == 0,
        "descriptive_false_fires": desc_fired,
    }


# --------------------------------------------------------------------------- #
# Precision spot-check (false-fire on narration negatives)
# --------------------------------------------------------------------------- #


def precision_spotcheck(heldout: List[dict]) -> dict:
    """False-fire rate on the held-out CONTEXTUAL conditions (the narration-class
    negatives). A tier-1 fire on a CONTEXTUAL condition is a candidate false fire
    (advisory precision signal per spec §4.2 -- NOT the tripwire)."""
    contextual = [r for r in heldout if r["classification"] == "CONTEXTUAL"]
    fires = [r for r in contextual if run_tier1(r["quote"]).fired]
    return {
        "heldout_contextual_n": len(contextual),
        "heldout_contextual_false_fires": len(fires),
        "heldout_false_fire_rate": round(len(fires) / len(contextual), 4) if contextual else None,
        "examples": [
            {"quote": r["quote"][:120],
             "surface_class": run_tier1(r["quote"]).detections[0].surface_class}
            for r in fires[:5]
        ],
    }


# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #


def build_report() -> dict:
    design, heldout = materialize_sets()
    cov_d = coverage(design)
    cov_h = coverage(heldout)

    # 70-scorable reconciliation subset (held-out minus UNRESOLVED).
    heldout_scorable = [r for r in heldout if r["classification"] != "UNRESOLVED"]
    cov_h70 = coverage(heldout_scorable)

    layer_cov_d = cov_d["any"]["coverage"]
    layer_cov_h = cov_h["any"]["coverage"]
    overfit_ratio = round(layer_cov_d / layer_cov_h, 3) if layer_cov_h > 0 else None

    per_family_ratio = {}
    for fam in ("imperative", "conditional-action", "exclusion-contrast"):
        dh = cov_d[fam]["coverage"]
        hh = cov_h[fam]["coverage"]
        per_family_ratio[fam] = round(dh / hh, 3) if hh > 0 else (None if dh == 0 else "inf")

    return {
        "materialization": {
            "design_n": len(design),
            "heldout_n": len(heldout),
            "heldout_scorable_n": len(heldout_scorable),
            "split_source": "docs/replay-results/corpus-v3-heldout-split-2026-07-05.json",
            "split_method": "sha256(condition_id) low-byte mod 10 < 3 -> held-out",
        },
        "birth_gate": run_birth_gate(),
        "layer_reliability": run_layer_reliability(),
        "coverage_design_143": cov_d,
        "coverage_heldout_78": cov_h,
        "coverage_heldout_70_scorable": cov_h70,
        "overfit": {
            "layer_coverage_design": layer_cov_d,
            "layer_coverage_heldout": layer_cov_h,
            "overfit_ratio": overfit_ratio,
            "tripwire": _TRIPWIRE,
            "verdict": ("PASS" if overfit_ratio is not None and overfit_ratio <= _TRIPWIRE
                        else "EXCEED"),
            "per_family_ratio": per_family_ratio,
        },
        "precision_spotcheck": precision_spotcheck(heldout),
    }


def main() -> None:
    rep = build_report()
    print(json.dumps(rep, indent=2))
    print("\n" + "=" * 68)
    bg = rep["birth_gate"]
    print(f"BIRTH GATE: {'ALL PASS' if bg['all_pass'] else 'FAILED'}")
    for d in bg["detectors"]:
        print(f"  {d['detector']:20s} {'PASS' if d['passed'] else 'FAIL'} "
              f"(+{d['positives']} / -{d['negatives']})"
              + ("" if d["passed"] else f"  failures={d['failures']}"))
    o = rep["overfit"]
    print(f"COVERAGE design_143 = {o['layer_coverage_design']:.4f} | "
          f"heldout_78 = {o['layer_coverage_heldout']:.4f}")
    print(f"OVERFIT RATIO = {o['overfit_ratio']} vs tripwire {o['tripwire']} -> {o['verdict']}")
    lr = rep["layer_reliability"]
    print(f"LAYER: gate-control catch {lr['gate_control_catch_rate']}, "
          f"descriptive-controls-silent={lr['descriptive_controls_silent']}")
    ps = rep["precision_spotcheck"]
    print(f"HELD-OUT false-fire on CONTEXTUAL: "
          f"{ps['heldout_contextual_false_fires']}/{ps['heldout_contextual_n']} "
          f"= {ps['heldout_false_fire_rate']}")


if __name__ == "__main__":
    main()
