#!/usr/bin/env python3
"""Confluence Recovery Rate — DIAGNOSTIC ONLY (2026-06-23).

Per operator guidance: do NOT change grading yet. Run strict vs effective side-by-side to test
whether SY2's 0-confluence failure is REPRESENTATIONAL (confluences encoded as steps) or a genuine
quality gap. Counts DISTINCT confluence CATEGORIES (families), not raw step matches, so a strategy
that references "optimum zone" 3 times scores 1 (not 3) — avoids inflating verbose strategies.

  strict_confluences    = len(explicit confluence_factors / confluences objects)
  effective_confluences = distinct categories present across explicit confluences + step text

Proof of representational defect: SY2/gdd lift on effective; rf_/Fqx/iU8/z3Qn stay unchanged.
"""
import json, re, glob, os

# Distinct confluence CATEGORIES (families). Each is one unit regardless of how many steps cite it.
CATEGORIES = {
    "fib_zone":        r"\bfib|fibonacci|optimum zone|0\.?25|0\.?50|0\.?75|25%|50%|75%|retrace",
    "liquidity_sweep": r"liquidity|sweep|stop run|stop hunt|raid",
    "premium_discount":r"premium|discount|equilibrium|dealing range|value area|fair value",
    "prior_level":     r"prior (day|daily|session|week).{0,12}(high|low)|pdh|pdl|pwh|pwl|naked poc|untouched",
    "rejection_wick":  r"rejection|reject|wick|pin bar|tail",
    "order_block":     r"order block|\bob\b|supply zone|demand zone|supply and demand",
    "vwap":            r"vwap",
    "moving_average":  r"moving average|\bema\b|\bsma\b|\bma\b|20 ?ma|200 ?ma|20 ?ema|200 ?ema",
    "structure":      r"\bbos\b|choch|\bmss\b|break of structure|market structure|structural",
    "volume_delta":    r"volume|delta|imbalance|footprint|bookmap|depth of market",
    "vp_node":         r"point of control|\bpoc\b|volume profile|\bhvn\b|\blvn\b|value area high|value area low|\bvah\b|\bval\b",
    "macd":            r"macd|signal line|histogram",
    "bollinger":       r"bollinger|standard deviation band|2 ?(std|sigma)|3 ?(std|sigma)",
    "regime_session":  r"killzone|session|new york|london|asian|regime|trend(ing)?",
}
COMPILED = {k: re.compile(v, re.I) for k, v in CATEGORIES.items()}

def categories_in(text: str) -> set:
    t = (text or "").lower()
    return {k for k, rx in COMPILED.items() if rx.search(t)}

def grade(path):
    d = json.load(open(path, encoding="utf-8"))
    vid = os.path.basename(path).replace(".result.json", "")
    ideas = d.get("ideas") or []
    if not ideas:
        return vid, None
    i0 = ideas[0]
    confl = i0.get("confluences") or []
    factors = i0.get("confluence_factors") or []
    strict = len([c for c in confl if (c.get("name") if isinstance(c, dict) else c)]) + len(factors)
    # effective = distinct categories across explicit confluences + every step's action+rationale
    cats = set()
    for c in confl:
        cats |= categories_in(c.get("name", "") + " " + c.get("description", "") if isinstance(c, dict) else str(c))
    for f in factors:
        cats |= categories_in(str(f))
    steps = i0.get("entry_sequence") or []
    step_cats = set()
    for s in steps:
        step_cats |= categories_in(str(s.get("action", "")) + " " + str(s.get("rationale", "")))
    effective = len(cats | step_cats)
    return vid, {
        "concept": i0.get("concept_name"),
        "steps": len(steps),
        "strict": strict,
        "effective": effective,
        "recovered_categories": sorted(cats | step_cats),
    }

print(f"{'video':<14} {'concept':<34} {'steps':>5} {'strict':>6} {'effective':>9}  recovered_categories")
print("-" * 120)
for p in sorted(glob.glob("tmp/validate5/*.result.json")):
    vid, r = grade(p)
    if r is None:
        print(f"{vid:<14} (no ideas)")
        continue
    print(f"{vid:<14} {str(r['concept'])[:34]:<34} {r['steps']:>5} {r['strict']:>6} {r['effective']:>9}  {','.join(r['recovered_categories'])}")
