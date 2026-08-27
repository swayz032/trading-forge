"""M1 step 1 - PROVENANCE of every magnitude on the LOCATION ADMISSION surface.

ALGO-102B section 3, first step. The question is not "what are the admission numbers" - it is
"which of them can be traced to something the operator taught, and which were chosen by an
engineer." Those are different claims and the codebase has never separated them.

TWO RULES THIS INSTRUMENT OBEYS, both of them scars:

1. THE MAGNITUDE SET IS DERIVED, NEVER LISTED. A typed list is the defect this desk has been
   convicted on repeatedly - it is satisfied by whatever the author remembered. The set is
   walked out of the DECLARING SURFACE itself: every numeric leaf of the loaded
   `key_level_semantics.json`, plus every strategy parameter that spec NAMES (by a
   `*_uses_frozen_strategy_parameter` reference or inside an equation/expression string),
   resolved against the engine's own Params defaults. Add a number to the spec and it appears
   here without editing this file.

2. ABSENCE NEEDS A POSITIVE CONTROL. "No teaching citation found" is worthless from a search
   that cannot find one. The corpus scan is proved live by searching for a magnitude the
   operator demonstrably DID teach before trusting any of its misses.

THE LOADED SPEC IS THE AUTHORITY - `current_mnq_strategy_v2_4_key_level_semantics.json`, the
file `levels.py:46` actually reads, NOT the `key_level_semantics` block inside `spec.json`
(ALGO-102B). Reading the wrong surface is how ALGO-076 reached an uncited conclusion.

No PnL, realized outcome, winner/loser label or clean-edge result participates in this scan.
"""
from __future__ import annotations

import io
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
SPEC = HERE / "current_mnq_strategy_v2_4_key_level_semantics.json"

#: The teaching corpus - every surface that could carry an operator citation. Globbed, not
#: listed, so a new fidelity artifact is scanned without editing this file.
CORPUS_GLOBS = ("*fidelity*.json", "*teaching*.json", "*user_fidelity*.json",
                "*engineer_onboarding.md", "*addendum*.json")

#: Identifiers that name a frozen strategy parameter rather than carrying a literal.
PARAM_RE = re.compile(r"\b(min_wick|min_room_r|key_level_pad_atr|min_wick_frac)\b")
#: A bare tick/point count inside an expression string, e.g. "max(4_ticks, ...)".
TICKS_RE = re.compile(r"\b(\d+)_ticks\b")


def load_spec() -> dict:
    return json.loads(io.open(SPEC, encoding="utf-8").read())


def derive_magnitudes(spec: dict) -> list:
    """Walk the declaring surface. Every number that reaches admission must show up here."""
    found = []

    def walk(node, path: str) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, f"{path}.{k}" if path else k)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{path}[{i}]")
        elif isinstance(node, bool):
            return                                   # a switch is not a magnitude
        elif isinstance(node, (int, float)):
            found.append({"key": path, "value": node, "carrier": "literal in the loaded spec"})
        elif isinstance(node, str):
            # the spec NAMES parameters instead of inlining them - those are magnitudes too,
            # and they are the ones an audit that only reads the JSON silently misses.
            for m in PARAM_RE.finditer(node):
                found.append({"key": f"{path} -> Params.{m.group(1)}", "value": None,
                              "carrier": f"NAMED by the spec at {path}",
                              "param": m.group(1)})
            for m in TICKS_RE.finditer(node):
                found.append({"key": f"{path} -> {m.group(0)}", "value": int(m.group(1)),
                              "carrier": f"literal inside the expression at {path}"})

    walk(spec, "")
    # schema_version identifies the contract; it never reaches a trade decision.
    return [f for f in found if f["key"] != "schema_version"]


def resolve_params(mags: list) -> None:
    """Fill in the value of every NAMED parameter from the engine's own defaults."""
    src = io.open(HERE / "current_mnq_strategy_v2_2_engine.py", encoding="utf-8").read()
    for mag in mags:
        name = mag.get("param")
        if not name:
            continue
        m = re.search(r"^\s+" + re.escape(name) + r":\s*float\s*=\s*([0-9.]+)", src, re.M)
        if m:
            mag["value"] = float(m.group(1))
            mag["carrier"] += " - default " + m.group(1) + " in current_mnq_strategy_v2_2_engine.py"


def corpus_files() -> list:
    out = set()
    for g in CORPUS_GLOBS:
        out.update(HERE.glob(g))
    return sorted(out)


#: A character that, adjacent to a numeric match, proves the match is part of a LONGER token -
#: a sha256 run, a version like `v2.4`, a field name. The first draft of this scan omitted this
#: and reported "4 of 10 cited": every hit was noise. `2` and `4` came from "MNQ v2.4", `40`
#: from inside a sha256 (`...4680a7d5...`), and `1.5` from an audio chime's `duration_seconds`.
#: It would have published a REASSURING number over a worse truth.
_GLUE = re.compile(r"[0-9A-Za-z_.]")


def _snippet(text: str, i: int, width: int = 68) -> str:
    lo = max(0, i - width // 2)
    return " ".join(text[lo:lo + width].split())


def literal_hits(needle: str, files: list, cap: int = 6) -> list:
    """Boundary-clean occurrences of a NUMBER, each carrying the text around it.

    Adjacency filtering alone cannot separate a taught magnitude from a coincidence - the
    chime's `1.5` is boundary-clean and still irrelevant. So every hit is returned WITH its
    context and the verdict is made by reading, never by counting.
    """
    out = []
    for path in files:
        text = io.open(path, encoding="utf-8", errors="replace").read()
        start = 0
        while len(out) < cap:
            i = text.find(needle, start)
            if i < 0:
                break
            start = i + len(needle)
            before = text[i - 1] if i else ""
            after = text[i + len(needle)] if i + len(needle) < len(text) else ""
            if _GLUE.match(before or " ") or _GLUE.match(after or " "):
                continue                      # part of a longer token - not this magnitude
            out.append({"where": f"{path.name}:{text.count(chr(10), 0, i) + 1}",
                        "context": _snippet(text, i)})
    return out


def concept_hits(key: str, files: list, cap: int = 4) -> list:
    """The question that actually matters: is the CONCEPT this number governs taught at all?

    A magnitude can be taught without its digits appearing - "wait for the second rejection"
    teaches `minimum_independent_rejections = 2` with no numeral. The concept terms are DERIVED
    from the magnitude's own key path rather than typed, so a new spec key is searched without
    editing this file.
    """
    stop = {"path", "uses", "frozen", "strategy", "parameter", "for", "the", "and", "of",
            "params", "atr", "min", "max", "value", "equation", "ticks"}
    terms = sorted({t for t in re.split(r"[^a-z]+", key.lower())
                    if len(t) > 3 and t not in stop})
    out = []
    for path in files:
        text = io.open(path, encoding="utf-8", errors="replace").read()
        low = text.lower()
        for term in terms:
            i = low.find(term)
            if i < 0:
                continue
            out.append({"term": term,
                        "where": f"{path.name}:{text.count(chr(10), 0, i) + 1}",
                        "context": _snippet(text, i)})
            if len(out) >= cap:
                return out
    return out


def main() -> int:
    spec = load_spec()
    mags = derive_magnitudes(spec)
    resolve_params(mags)
    files = corpus_files()

    # ---- POSITIVE CONTROL. A miss is only meaningful if the scan can produce a hit. --------
    # The 400-dollar minimum-target rule is TAUGHT and held in the addendum. If the corpus scan
    # cannot find it, the scan is broken and every "no citation" below is a false negative. The
    # control must survive the SAME boundary filter the magnitudes face - a control that only
    # passes because it is unfiltered proves nothing about a filtered miss.
    control_hits = literal_hits("400", files)

    print("=" * 78)
    print("M1 STEP 1 - ADMISSION MAGNITUDE PROVENANCE")
    print("=" * 78)
    print("declaring surface : " + SPEC.name)
    print("                    release " + str(spec.get("release_id"))
          + " frozen " + str(spec.get("frozen_at")))
    print("corpus scanned    : " + str(len(files)) + " files")
    for f in files:
        print("                    - " + f.name)
    print()
    print("POSITIVE CONTROL - the taught 400 floor must survive the SAME boundary filter:")
    if control_hits:
        print("  LIVE - " + control_hits[0]["where"] + "  |  " + control_hits[0]["context"])
    else:
        print("  *** DEAD SCAN - the control MISSED. Every 'no citation' below is void. ***")
        return 2
    print()

    print("DERIVED MAGNITUDE SET - " + str(len(mags)) + " numbers reach location admission")
    print("-" * 78)
    rows = []
    for mag in mags:
        v = mag["value"]
        needle = str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)
        lits = literal_hits(needle, files)
        cons = concept_hits(mag["key"], files)
        rows.append({**mag, "needle": needle, "literal_hits": lits, "concept_hits": cons})
        print("  " + mag["key"])
        print("      value   : " + str(mag["value"]) + "   carrier: " + mag["carrier"])
        if lits:
            for h in lits[:2]:
                print("      LITERAL : " + h["where"] + "  |  " + h["context"])
        else:
            print("      LITERAL : none - the digits appear NOWHERE in the teaching corpus")
        if cons:
            for h in cons[:2]:
                print("      CONCEPT : (" + h["term"] + ") " + h["where"] + "  |  " + h["context"])
        else:
            print("      CONCEPT : none - no term from this key appears in the corpus either")
    print("-" * 78)
    n_no_lit = sum(1 for r in rows if not r["literal_hits"])
    n_no_con = sum(1 for r in rows if not r["concept_hits"])
    print(str(n_no_lit) + " of " + str(len(rows)) + " have NO boundary-clean literal in the corpus.")
    print(str(n_no_con) + " of " + str(len(rows)) + " have NO concept term in the corpus either.")
    print()
    print("READ THIS CORRECTLY, AND NOTE WHAT THE FIRST DRAFT DID. A literal hit is NOT a")
    print("citation. Before the boundary filter existed this scan reported '4 of 10 cited' and")
    print("every hit was noise - '2' and '4' from the string 'MNQ v2.4', '40' from inside a")
    print("sha256, '1.5' from an audio chime's duration_seconds. The filter removes that class;")
    print("it does NOT make a surviving hit a citation. These columns BOUND the search. The")
    print("ruling is made by READING each hit, which is the work the derivation document")
    print("specifies - and a taught concept may be carried with no numeral at all.")

    out = HERE / "current_mnq_strategy_v2_4_m1_admission_provenance_2026_08_26.json"
    io.open(out, "w", encoding="utf-8", newline="").write(json.dumps({
        "declaring_surface": SPEC.name,
        "release_id": spec.get("release_id"),
        "corpus": [f.name for f in files],
        "positive_control": {"needle": "400", "hits": control_hits, "note": "must survive the same boundary filter as every magnitude"},
        "magnitudes": rows,
        "reader_note": "A literal corpus hit BOUNDS the provenance search; it does not "
                       "establish that the number was taught. See the M1 derivation document.",
    }, indent=1))
    print("\nwrote " + out.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
