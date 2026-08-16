"""sVkm — STOP-A DIRECTION-BINDING PROBE (AR-1202 §7). READ-ONLY. ONE BOUNDED PROBE.

AR-1202 §5 rejected AR-1201's "opposite directions" phrasing: STOP-A's direction was
asserted from token proximity (`short tool`, `short`) rather than from an explicit
grammatical trade-direction statement. This probe answers that one question properly.

CONTRACT (AR-1202 §7), enforced here:
  1. extract the COMPLETE example scope containing STOP-A, from the nearest real
     example/setup boundary through entry/stop/target/outcome;
  2. find an EXPLICIT GRAMMATICAL trade-direction statement tied to THAT SAME example —
     `buy`/`sell`/`long`/`short` used as a trade declaration;
  3. 🛑 TOOL NAMES ARE NOT DIRECTION EVIDENCE. `short tool` / `long tool` are TradingView
     drawing instruments and are explicitly EXCLUDED, as are bare directional-bias words
     (`upside`/`downside`), which describe where price may go, not which trade was taken;
  4. if the transcript cannot bind direction, return exactly TRANSCRIPT_DIRECTION_UNRESOLVED
     and make NO inference.

No geometry decision. No source edit.

Run from repo root:
  python scripts/svkm_stopA_direction_probe.py --transcript <pinned.txt>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
GRADE_DIR = os.path.join(ROOT, "docs", "replay-results", "svkm-extraction-certified", "grade")
TRANSCRIPT_PIN = "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc"

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

STOP_A_MARKER = ("what I want you to do for the stop loss is we're just going to put it at "
                 "the bottom of the fair value candle")

# Real example / setup boundaries. Kept deliberately broad so the scope cannot be
# gerrymandered to exclude inconvenient text.
BOUNDARY_PATTERNS = [
    r"take a look at another example",
    r"another example",
    r"let's go ahead and take a look",
]

# EXPLICIT grammatical trade-direction declarations.
DIRECTION_PATTERNS = [
    (r"ready for a (buy|sell)", "explicit trade declaration"),
    (r"(going|go) (to )?(take|get) (a |an )?(long|short|buy|sell)", "explicit trade declaration"),
    (r"we (are|'re) (going )?(long|short)\b", "explicit trade declaration"),
    (r"(take|taking|took) (a |the )?(long|short|buy|sell)\b", "explicit trade declaration"),
    (r"this is a (long|short|buy|sell)\b", "explicit trade declaration"),
    (r"(a |our |the )(long|short|buy|sell) (trade|entry|position)\b", "explicit trade declaration"),
    (r"\bwe (buy|sell)\b", "explicit trade declaration"),
    (r"\b(buying|selling)\b", "explicit trade declaration"),
]

# Things that LOOK like direction but are not admissible evidence.
EXCLUDED_PATTERNS = [
    (r"(short|long) tool", "TOOL NAME — TradingView drawing instrument, not a trade declaration"),
    (r"\b(upside|downside)\b", "DIRECTIONAL BIAS — describes where price may go, not the trade taken"),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--transcript", required=True)
    args = ap.parse_args()

    t = open(args.transcript, encoding="utf-8", newline="").read()
    tsha = hashlib.sha256(t.encode("utf-8")).hexdigest()
    print(f"[stopA] transcript chars={len(t)} sha256={tsha}")
    if tsha != TRANSCRIPT_PIN:
        print("[stopA] ABORT: transcript differs from the pin — REFUSING.")
        return 2

    i = t.find(STOP_A_MARKER)
    if i < 0:
        print("[stopA] ABORT: STOP-A marker not found.")
        return 2
    print(f"[stopA] STOP-A at char {i}")

    bounds = sorted({m.start() for p in BOUNDARY_PATTERNS for m in re.finditer(p, t)})
    print(f"[stopA] example/setup boundary markers at: {bounds}")
    scope_start = max([b for b in bounds if b < i], default=0)
    scope_end = min([b for b in bounds if b > i], default=len(t))
    scope = t[scope_start:scope_end]
    print(f"[stopA] EXAMPLE SCOPE = [{scope_start}..{scope_end}]  ({len(scope)} chars)")

    excluded_hits = []
    for pat, why in EXCLUDED_PATTERNS:
        for m in re.finditer(pat, scope):
            excluded_hits.append({"match": m.group(0), "char": scope_start + m.start(), "excluded_because": why})

    direction_hits = []
    for pat, why in DIRECTION_PATTERNS:
        for m in re.finditer(pat, scope):
            a = max(0, m.start() - 120)
            b = min(len(scope), m.end() + 120)
            direction_hits.append({
                "match": m.group(0),
                "char": scope_start + m.start(),
                "kind": why,
                "context": scope[a:b],
            })
    direction_hits.sort(key=lambda d: d["char"])

    print(f"\n[stopA] EXCLUDED (inadmissible) hits in scope: {len(excluded_hits)}")
    for h in excluded_hits:
        print(f"    @{h['char']} {h['match']!r} — {h['excluded_because']}")

    print(f"\n[stopA] ADMISSIBLE explicit direction statements in scope: {len(direction_hits)}")
    for h in direction_hits:
        print(f"    @{h['char']} {h['match']!r}")
        print(f"       ...{h['context']}...")

    if direction_hits:
        verdict = "TRANSCRIPT_DIRECTION_BOUND"
        note = ("An explicit grammatical trade-direction statement exists inside STOP-A's own "
                "example scope. See admissible_direction_statements.")
    else:
        verdict = "TRANSCRIPT_DIRECTION_UNRESOLVED"
        note = ("No explicit grammatical trade-direction statement inside STOP-A's example scope. "
                "Only inadmissible tool-name / directional-bias tokens are present. Per AR-1202 §7 "
                "this triggers the Visual Intelligence micro-proof; NO inference is made here.")

    print(f"\n[stopA] VERDICT: {verdict}")
    print(f"[stopA] {note}")

    artifact = {
        "artifact": "svkm-stopA-direction-probe",
        "ruling": "AR-1202 §7",
        "transcript_sha256": tsha,
        "stop_a_char": i,
        "example_scope": [scope_start, scope_end],
        "boundary_markers": bounds,
        "admissible_direction_statements": direction_hits,
        "excluded_inadmissible_hits": excluded_hits,
        "verdict": verdict,
        "note": note,
        "worker_made_geometry_decision": False,
        "worker_inferred_direction": False,
    }
    os.makedirs(GRADE_DIR, exist_ok=True)
    path = os.path.join(GRADE_DIR, "stopA_direction_probe.json")
    tmp = path + f".{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(artifact, fh, indent=2, default=str)
    os.replace(tmp, path)
    print(f"[stopA] wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
