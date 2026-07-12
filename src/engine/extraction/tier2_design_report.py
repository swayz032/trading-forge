"""H1 tier-2 discourse-pass DESIGN-POOL harness (pre-reg §4/§5/§7).

Analogous to tier1_coverage_report.py, but for the two-step discourse
classifier. Materializes the 112 DESIGN exemplars (quotes + consensus labels),
runs the birth gate (fixtures), then classifies the whole design pool grouped
by concept (each concept = one lesson = the cross-reference discourse) and emits
every number the pre-registration asks for:

  - birth-fixture pass, BOTH named classes, BOTH polarities (pre-reg §4)
  - PER-CLASS absorption counts -- the two named classes SEPARATELY, never
    blended (pre-reg §5): absorbed-correct / declined(cannot-determine) / wrong
  - economics from birth: per-item tokens, LLM-invocation rate, tier-3 routing
    rate (the cannot-determine rate IS the economics number, pre-reg §1/§5)
  - determinism envelope: deterministic-resolved count (EXACT on re-run) +
    optional LLM-margin re-run agreement band (--determinism)
  - two-path tally cross-check (pre-reg §8: standalone tally vs per-concept)

DATA DISCIPLINE (pre-reg §2): design_exemplars ONLY. The 77 sealed_eval items
are NEVER loaded here. The 78-held-out is SPENT and untouched.

Run:  python -m src.engine.extraction.tier2_design_report            (full, real Gemma)
      python -m src.engine.extraction.tier2_design_report --limit 12 (smoke)
      python -m src.engine.extraction.tier2_design_report --determinism
"""

from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from typing import Callable, Dict, List, Optional

from .tier2_discourse import (
    CLASS_BIAS,
    CLASS_WALKTHROUGH,
    class_of,
    classify_item,
    gemma_classify_call,
    is_rule_or_exclusion_frame,
    segment_frame,
)

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_SPLIT = os.path.join(_ROOT, "docs", "designs", "h1-tier2-quarantine-split-2026-07-12.json")
_PACKETS = os.path.join(_ROOT, "docs", "designs", "h1-wave1-shakedown-packets-2026-07-12.json")
_FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "tier2_birth_fixtures.json")

# Pre-registered target (pre-reg §5/§7 / shakedown §WAVE3ECON): >=85% per-class
# absorption on BOTH named classes. The interim eval (grader) is the gate; this
# harness reports the DESIGN-pool numbers the two design passes are tuned on.
_TARGET = 0.85


# --------------------------------------------------------------------------- #
# Materialization  (design_exemplars ONLY -- sealed_eval never loaded)
# --------------------------------------------------------------------------- #


def _load_quote_index() -> Dict[str, dict]:
    pk = json.load(open(_PACKETS, encoding="utf-8"))
    idx = {}
    for sec in pk["sections"]:
        for it in sec["items"]:
            idx[it["item_id"]] = {
                "concept_id": it.get("concept_id"),
                "condition_type": it.get("extracted_condition_type"),
                "quote": it["quote_anchor"]["verbatim"],
                "family": it.get("family"),
            }
    return idx


def materialize_design() -> List[dict]:
    split = json.load(open(_SPLIT, encoding="utf-8"))
    qidx = _load_quote_index()
    rows = []
    for e in split["design_exemplars"]:  # 112 labeled
        iid = e["item_id"]
        q = qidx[iid]
        rows.append({
            "item_id": iid,
            "concept_id": q["concept_id"] or e.get("concept_id"),
            "condition_type": q["condition_type"],
            "quote": q["quote"],
            "consensus_label": e["consensus_label"],
            "class": class_of(q["condition_type"]),
        })
    assert len(rows) == 112, len(rows)
    return rows


def materialize_ambiguous_reference() -> List[dict]:
    """17 A!=B ambiguous items -- DESIGN-REFERENCE-ONLY (no eval truth). Reported
    for distribution only, never scored for correctness."""
    split = json.load(open(_SPLIT, encoding="utf-8"))
    qidx = _load_quote_index()
    out = []
    for e in split.get("ambiguous_design_reference_only", []):
        iid = e["item_id"]
        q = qidx[iid]
        out.append({"item_id": iid, "concept_id": q["concept_id"],
                    "condition_type": q["condition_type"], "quote": q["quote"],
                    "class": class_of(q["condition_type"])})
    return out


# --------------------------------------------------------------------------- #
# Caching (within a design pass -- keeps token burn honest across iterations)
# --------------------------------------------------------------------------- #


class _CachedGemma:
    def __init__(self, cache_path: Optional[str]):
        self.cache_path = cache_path
        self.cache = {}
        if cache_path and os.path.exists(cache_path):
            self.cache = json.load(open(cache_path, encoding="utf-8"))

    def __call__(self, quote, frame, condition_type, sibling_rules, **kw):
        key = json.dumps([quote, frame, condition_type, sorted(sibling_rules)],
                         ensure_ascii=False)
        if key in self.cache:
            return self.cache[key]
        r = gemma_classify_call(quote, frame, condition_type, sibling_rules, **kw)
        self.cache[key] = r
        if self.cache_path:
            json.dump(self.cache, open(self.cache_path, "w", encoding="utf-8"))
        return r


# --------------------------------------------------------------------------- #
# Birth gate (fixtures, pre-reg §4)
# --------------------------------------------------------------------------- #


def _siblings_for(concept_id: str, exclude_id: str, design: List[dict]):
    sib = [r for r in design if r["concept_id"] == concept_id and r["item_id"] != exclude_id]
    return [s["quote"] for s in sib], [s["condition_type"] for s in sib]


def run_birth_gate(gemma_fn: Callable, design: List[dict]) -> dict:
    fx = json.load(open(_FIXTURES, encoding="utf-8"))
    out = {"classes": [], "all_pass": True}
    for cls in fx["classes"]:
        cls_out = {"class": cls["class"], "gate_fires": [], "context_silent": [], "passed": True}
        for polarity, expect_label in (("gate_fires", "gate-strength"),
                                       ("context_silent", "context")):
            for fxt in cls[polarity]:
                sibs, sib_cts = _siblings_for(fxt["concept_id"], fxt["id"], design)
                d = classify_item(fxt["quote"], fxt["condition_type"], sibs, sib_cts, gemma_fn)
                ok = d.label == expect_label
                if "expect_resolved_by" in fxt:
                    ok = ok and d.resolved_by == fxt["expect_resolved_by"]
                cls_out[polarity].append({
                    "id": fxt["id"], "expected": expect_label, "got": d.label,
                    "resolved_by": d.resolved_by, "ok": ok})
                cls_out["passed"] = cls_out["passed"] and ok
        out["classes"].append(cls_out)
        out["all_pass"] = out["all_pass"] and cls_out["passed"]

    # determinism controls (deterministic terminals -- must be exact)
    dc = fx["determinism_controls"]
    det = {"must_gate": [], "must_context": [], "passed": True}
    for c in dc["must_gate"]:
        d = classify_item(c["quote"], c["condition_type"], [], [], gemma_fn)
        ok = d.label == "gate-strength" and d.resolved_by.startswith("deterministic")
        det["must_gate"].append({"id": c["id"], "got": d.label, "resolved_by": d.resolved_by, "ok": ok})
        det["passed"] = det["passed"] and ok
    for c in dc["must_context"]:
        d = classify_item(c["quote"], c["condition_type"], [], [], gemma_fn)
        ok = d.label == "context" and d.resolved_by.startswith("deterministic")
        det["must_context"].append({"id": c["id"], "got": d.label, "resolved_by": d.resolved_by, "ok": ok})
        det["passed"] = det["passed"] and ok
    out["determinism_controls"] = det
    out["all_pass"] = out["all_pass"] and det["passed"]
    return out


# --------------------------------------------------------------------------- #
# Design-pool classification + per-class tabulation (pre-reg §5)
# --------------------------------------------------------------------------- #


def classify_design_pool(design: List[dict], gemma_fn: Callable,
                         limit: Optional[int] = None) -> Dict[str, "object"]:
    by_concept = defaultdict(list)
    for r in design:
        by_concept[r["concept_id"]].append(r)

    decisions = {}
    seen = 0
    for cid, rows in by_concept.items():
        texts = [r["quote"] for r in rows]
        cts = [r["condition_type"] for r in rows]
        for idx, r in enumerate(rows):
            if limit is not None and seen >= limit:
                break
            sibs = [t for j, t in enumerate(texts) if j != idx]
            sib_cts = [c for j, c in enumerate(cts) if j != idx]
            decisions[r["item_id"]] = classify_item(
                r["quote"], r["condition_type"], sibs, sib_cts, gemma_fn)
            seen += 1
        if limit is not None and seen >= limit:
            break
    return decisions


def tabulate_per_class(design: List[dict], decisions: Dict) -> dict:
    """PER-CLASS absorption -- the two named classes SEPARATELY (never blended,
    pre-reg §5). Two-path safe: this is the STANDALONE tally."""
    per = {CLASS_BIAS: _empty(), CLASS_WALKTHROUGH: _empty()}
    for r in design:
        if r["item_id"] not in decisions:
            continue
        d = decisions[r["item_id"]]
        b = per[r["class"]]
        b["n"] += 1
        if d.label == "cannot-determine":
            b["declined"] += 1
        elif d.label == r["consensus_label"]:
            b["absorbed_correct"] += 1
        else:
            b["absorbed_wrong"] += 1
            b["wrong_items"].append({"id": r["item_id"], "got": d.label,
                                     "truth": r["consensus_label"],
                                     "resolved_by": d.resolved_by})
    for b in per.values():
        n = b["n"] or 1
        b["absorption_rate"] = round(b["absorbed_correct"] / n, 4)
        b["routing_rate"] = round(b["declined"] / n, 4)
        b["wrong_rate"] = round(b["absorbed_wrong"] / n, 4)
        b["meets_target"] = b["absorption_rate"] >= _TARGET
    return per


def _empty():
    return {"n": 0, "absorbed_correct": 0, "declined": 0, "absorbed_wrong": 0,
            "wrong_items": []}


def economics(decisions: Dict) -> dict:
    n = len(decisions)
    llm = [d for d in decisions.values() if d.llm_invoked]
    det = [d for d in decisions.values() if not d.llm_invoked]
    tot_tokens = sum(d.total_tokens for d in decisions.values())
    routed = sum(1 for d in decisions.values() if d.routed_to_tier3)
    return {
        "n_items": n,
        "deterministic_resolved": len(det),
        "llm_margin_invoked": len(llm),
        "llm_invocation_rate": round(len(llm) / n, 4) if n else 0,
        "tier3_routing_rate_cannot_determine": round(routed / n, 4) if n else 0,
        "total_tokens": tot_tokens,
        "tokens_per_item_overall": round(tot_tokens / n, 1) if n else 0,
        "tokens_per_llm_item": round(tot_tokens / len(llm), 1) if llm else 0,
    }


def two_path_check(design: List[dict], decisions: Dict, per_class: dict) -> dict:
    """Path B: recount absorbed_correct straight from decisions and compare to
    the per-class tally's sum (pre-reg §8 two-path derivation)."""
    straight = 0
    for r in design:
        d = decisions.get(r["item_id"])
        if d and d.label == r["consensus_label"] and d.label != "cannot-determine":
            straight += 1
    tally = sum(b["absorbed_correct"] for b in per_class.values())
    return {"standalone_correct": straight, "per_class_sum_correct": tally,
            "agree": straight == tally}


# --------------------------------------------------------------------------- #
# Determinism envelope (pre-reg §4): segmentation EXACT; LLM-margin agreement.
# --------------------------------------------------------------------------- #


def segmentation_is_exact(design: List[dict]) -> dict:
    """Segmentation must be byte-identical on re-run (pure regex). Verify."""
    a = {r["item_id"]: segment_frame(r["quote"], r["condition_type"]) for r in design}
    b = {r["item_id"]: segment_frame(r["quote"], r["condition_type"]) for r in design}
    return {"exact": a == b, "n": len(a)}


def llm_margin_agreement(design: List[dict], limit: Optional[int] = None) -> dict:
    """Run the LLM margin twice (fresh, no cache) and measure label stability --
    the pre-stated agreement band is >=0.90 (temp 0.1 + grammar-constrained)."""
    by_concept = defaultdict(list)
    for r in design:
        by_concept[r["concept_id"]].append(r)
    runs = ([], [])
    seen = 0
    for cid, rows in by_concept.items():
        texts = [r["quote"] for r in rows]
        cts = [r["condition_type"] for r in rows]
        for idx, r in enumerate(rows):
            if limit is not None and seen >= limit:
                break
            sibs = [t for j, t in enumerate(texts) if j != idx]
            sib_cts = [c for j, c in enumerate(cts) if j != idx]
            d1 = classify_item(r["quote"], r["condition_type"], sibs, sib_cts, gemma_classify_call)
            if not d1.llm_invoked:
                continue  # deterministic -> exact by construction
            d2 = classify_item(r["quote"], r["condition_type"], sibs, sib_cts, gemma_classify_call)
            runs[0].append(d1.label)
            runs[1].append(d2.label)
            seen += 1
        if limit is not None and seen >= limit:
            break
    n = len(runs[0])
    agree = sum(1 for a, b in zip(*runs) if a == b)
    return {"llm_items_compared": n, "agreements": agree,
            "agreement_rate": round(agree / n, 4) if n else None,
            "pre_stated_band": ">=0.90"}


# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #


def build_report(limit: Optional[int], cache_path: Optional[str],
                 determinism: bool) -> dict:
    design = materialize_design()
    gemma = _CachedGemma(cache_path)

    birth = run_birth_gate(gemma, design)
    decisions = classify_design_pool(design, gemma, limit=limit)
    scored = [r for r in design if r["item_id"] in decisions]
    per_class = tabulate_per_class(scored, decisions)
    econ = economics(decisions)
    twopath = two_path_check(scored, decisions, per_class)
    seg = segmentation_is_exact(design)

    rep = {
        "scope": {
            "pool": "112 DESIGN exemplars (design_exemplars) -- sealed_eval NEVER opened; 78-held-out SPENT",
            "items_classified": len(decisions),
            "target_per_class_absorption": _TARGET,
            "model": "gemma4:e4b-it-qat (local, temp 0.1)",
        },
        "birth_gate": birth,
        "per_class_absorption": per_class,
        "economics": econ,
        "two_path_tally": twopath,
        "determinism_envelope": {
            "segmentation_exact": seg,
            "llm_margin_agreement": ("run --determinism to measure"
                                     if not determinism else None),
        },
    }
    if determinism:
        rep["determinism_envelope"]["llm_margin_agreement"] = llm_margin_agreement(design, limit=limit)
    return rep


def _print_summary(rep: dict) -> None:
    print("\n" + "=" * 72)
    bg = rep["birth_gate"]
    print(f"BIRTH GATE: {'ALL PASS' if bg['all_pass'] else 'FAILED'}")
    for c in bg["classes"]:
        print(f"  class {c['class']:22s} {'PASS' if c['passed'] else 'FAIL'}")
        for pol in ("gate_fires", "context_silent"):
            for f in c[pol]:
                mark = "ok" if f["ok"] else "XX"
                print(f"      [{mark}] {f['id']:8s} exp={f['expected']:13s} got={f['got']:15s} ({f['resolved_by']})")
    dcx = bg["determinism_controls"]
    print(f"  determinism_controls {'PASS' if dcx['passed'] else 'FAIL'}")
    print("-" * 72)
    print("PER-CLASS ABSORPTION (design pool):")
    for cls, b in rep["per_class_absorption"].items():
        print(f"  {cls:22s} n={b['n']:3d}  correct={b['absorbed_correct']:3d} "
              f"declined={b['declined']:3d} wrong={b['absorbed_wrong']:3d}  "
              f"absorption={b['absorption_rate']:.3f} routing={b['routing_rate']:.3f}  "
              f"target({_TARGET})={'MET' if b['meets_target'] else 'SHORT'}")
    e = rep["economics"]
    print("-" * 72)
    print(f"ECONOMICS: {e['deterministic_resolved']} det / {e['llm_margin_invoked']} llm "
          f"(llm rate {e['llm_invocation_rate']}), tier-3 routing (cannot-determine) "
          f"= {e['tier3_routing_rate_cannot_determine']}")
    print(f"           {e['total_tokens']} tokens, {e['tokens_per_item_overall']}/item overall, "
          f"{e['tokens_per_llm_item']}/llm-item")
    tp = rep["two_path_check"] if "two_path_check" in rep else rep["two_path_tally"]
    print(f"TWO-PATH TALLY: standalone={tp['standalone_correct']} "
          f"per-class-sum={tp['per_class_sum_correct']} agree={tp['agree']}")
    seg = rep["determinism_envelope"]["segmentation_exact"]
    print(f"SEGMENTATION EXACT ON RE-RUN: {seg['exact']} (n={seg['n']})")
    lma = rep["determinism_envelope"]["llm_margin_agreement"]
    if isinstance(lma, dict):
        print(f"LLM-MARGIN AGREEMENT: {lma['agreement_rate']} "
              f"({lma['agreements']}/{lma['llm_items_compared']}) band {lma['pre_stated_band']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="classify only first N (smoke)")
    ap.add_argument("--cache", type=str, default=None, help="path to LLM cache json")
    ap.add_argument("--determinism", action="store_true", help="measure LLM-margin agreement band")
    ap.add_argument("--json", action="store_true", help="dump full JSON report")
    args = ap.parse_args()
    rep = build_report(args.limit, args.cache, args.determinism)
    if args.json:
        print(json.dumps(rep, indent=2))
    _print_summary(rep)


if __name__ == "__main__":
    main()
