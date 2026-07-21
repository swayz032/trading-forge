#!/usr/bin/env python3
"""WIRE-1 structure-family census, v2 (R-080 §5 prerequisite).

v1 (`wire1-structure-census.json`, commit 3db7fa88) shipped WITHOUT a generator and
double-counted 2 specs that exist in both packet2_dod_specs/ and shakedown_specs/,
reporting n=90 where the true distinct-condition count is n=78. It also persisted no
per-row concept label, so §1b's concept table (level/zone 27.8% etc.) was not
reproducible and the R-080 §5 blind-grade strata could not be drawn.

This generator fixes both: it dedupes by condition id and persists every label it
computes. Concept rules are authored from ICT/SMC vocabulary semantics, NOT tuned to
reproduce v1's percentages (anti-fit, per R-080 §4).

Concept labels here are a RECONSTRUCTION. v1's regexes are unrecoverable; these are not
"the original rules" and must not be presented as such.
"""

import glob
import hashlib
import json
import os
import re
from collections import Counter

SPEC_GLOBS = [
    "docs/replay-results/h1-scripts/claude-rung-v32/shakedown_specs/*.spec.json",
    "docs/replay-results/h1-scripts/claude-rung-v32/packet2_dod_specs/*.spec.json",
]
STRUCTURE_TYPES = {"WAIT_STRUCTURE", "VERIFY_STRUCTURE"}
OUT = "docs/replay-results/h1-battery/wire1-structure-census-v2.json"

# --- timeframe rules (semantics-first; carried forward from v1's stated intent) ---
# Numerals appear as digits OR words, with space/hyphen separators ("5m", "5-minute",
# "five minute"). v2's first draft required digits+space and misclassified 8 of v1's 11
# EXEC rows — caught by two-path comparison against v1 before this artifact shipped.
_H = r"(?:4|four|1|one|2|two)"
_M = r"(?:1|one|2|two|3|three|5|five|15|fifteen|30|thirty)"
HTF_RE = re.compile(
    rf"\b({_H}[-\s]*h(our)?s?\b|hourly|daily|day\s*chart|weekly|"
    r"htf|higher\s+time\s*frame)", re.I)
EXEC_RE = re.compile(
    rf"\b({_M}[-\s]*m(in(ute)?s?)?\b|ltf|lower\s+time\s*frame|execution\s+time\s*frame)", re.I)

# --- concept rules (multi-label; authored from ICT/SMC vocabulary) ---
CONCEPT_RES = [
    ("structure_event", re.compile(
        r"\b(break\s+of\s+structure|bos\b|change\s+of\s+character|choch\b|"
        r"market\s+structure\s+shift|mss\b|displacement|structure\s+(break|broken|shift))",
        re.I)),
    ("liquidity", re.compile(
        r"\b(liquidity|stop\s+(raid|hunt)|sweep|swept|raid(ed)?|equal\s+(highs?|lows?)|"
        r"buy[-\s]?side|sell[-\s]?side|fake\s*out)\b", re.I)),
    ("fvg_imbalance", re.compile(
        r"\b(fair\s+value\s+gap|fvg\b|imbalance|inefficienc(y|ies)|invers(e|ion)|gap)\b", re.I)),
    ("order_block", re.compile(r"\b(order\s+block|breaker|mitigation\s+block)\b", re.I)),
    ("level_zone", re.compile(
        r"\b(support|resistance|demand|supply|zone|level|previous\s+(day|high|low)|"
        r"high\s+of\s+(the\s+)?day|low\s+of\s+(the\s+)?day|pdh\b|pdl\b)\b", re.I)),
    ("pd_array", re.compile(r"\b(premium|discount|pd\s+array|equilibrium|ote\b)\b", re.I)),
    ("ma_indicator", re.compile(
        r"\b(moving\s+average|\bema\b|\bsma\b|\brsi\b|macd|vwap|bollinger)\b", re.I)),
]


def classify_tf(text):
    htf, exec_ = bool(HTF_RE.search(text)), bool(EXEC_RE.search(text))
    if htf and exec_:
        return "BOTH_TF_NAMED"
    if htf:
        return "HTF_TAUGHT"
    if exec_:
        return "EXEC_TAUGHT"
    return "TF_UNSPECIFIED"


def classify_concepts(text):
    return [name for name, rx in CONCEPT_RES if rx.search(text)]


def main():
    # Resolve specs by basename; assert byte-identity where a basename appears twice.
    by_name, collisions = {}, []
    for g in SPEC_GLOBS:
        for p in sorted(glob.glob(g)):
            name = os.path.basename(p)
            h = hashlib.sha256(open(p, "rb").read()).hexdigest()
            if name in by_name:
                collisions.append({"file": name, "kept": by_name[name][0], "dropped": p,
                                   "identical": by_name[name][1] == h})
                if by_name[name][1] != h:
                    raise SystemExit(f"FAIL-CLOSED: {name} differs across dirs — vintage ambiguous")
                continue
            by_name[name] = (p, h)

    rows, seen_ids = [], set()
    for name, (path, _) in sorted(by_name.items()):
        spec = json.load(open(path, encoding="utf-8"))
        for c in spec.get("spec", {}).get("entry_conditions", []):
            if c.get("type") not in STRUCTURE_TYPES:
                continue
            cid = c.get("id")
            if cid in seen_ids:      # defensive: id is the dedup key
                continue
            seen_ids.add(cid)
            obj = c.get("object", "")
            concepts = classify_concepts(obj)
            rows.append({
                "condition_id": cid,
                "file": name,
                "type": c["type"],
                "role": c.get("role"),
                "object": obj,
                "tf_class": classify_tf(obj),
                "concepts": concepts,
                "narration_candidate": not concepts,
            })

    out = {
        "artifact": "wire1-structure-family-census-v2",
        "supersedes": "wire1-structure-census.json (n=90, double-counted 2 specs, no generator)",
        "generator": "docs/replay-results/h1-battery/wire1_structure_census.py",
        "n_specs_scanned": len(by_name),
        "n_specs_with_structure_conditions": len({r["file"] for r in rows}),
        "n_occurrences": len(rows),
        "duplicate_spec_collisions": collisions,
        "concept_labels_are": "RECONSTRUCTION — v1 regexes unrecoverable; not the original rules",
        "tf_class_counts": dict(Counter(r["tf_class"] for r in rows)),
        "concept_counts": dict(Counter(c for r in rows for c in r["concepts"])),
        "narration_candidates": sum(1 for r in rows if r["narration_candidate"]),
        "rows": rows,
    }
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=2)

    n = len(rows)
    print(f"specs scanned {len(by_name)} | collisions dropped {len(collisions)} | occurrences {n}")
    for k, v in sorted(out["tf_class_counts"].items(), key=lambda kv: -kv[1]):
        print(f"  {k:<16} {v:>3}  {v/n*100:5.1f}%")
    print("  --- concepts (multi-label) ---")
    for k, v in sorted(out["concept_counts"].items(), key=lambda kv: -kv[1]):
        print(f"  {k:<16} {v:>3}  {v/n*100:5.1f}%")
    print(f"  {'narration_cand':<16} {out['narration_candidates']:>3}  "
          f"{out['narration_candidates']/n*100:5.1f}%")


if __name__ == "__main__":
    main()
