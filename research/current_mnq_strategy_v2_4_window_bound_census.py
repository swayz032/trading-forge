#!/usr/bin/env python3
"""Where does the 09:30 window bound actually live? DIAGNOSTIC ONLY. Changes nothing.

PREPARATION for the window amendment queued by ALGO-025 section 3 item 3, which orders:
"measure every place the 09:30 bound lives (kernel/entries/spec/gates -- code, not prose)".
The amendment itself is gated behind the re-dispatched grade and is NOT attempted here. This
is the measurement it will need, and it found a hazard worth having in hand first.

THE OPERATOR'S TEACHING, registered `OPERATOR_STATED` 2026-08-23:
    "also my trading is from 8am-12pm now its got setup that hapens before 9:3oam"
So the frozen 09:30 start is a SUPERSEDED-CANDIDATE. Widening it is a REAL semantic change.

    THE HAZARD: 09:30 IS NOT ONE CONSTANT. It is duplicated across dozens of code sites in
    four generations, and the sites do NOT all mean the same thing. A find-and-replace would
    silently change something nobody intended. The exact count is MEASURED by running this
    module, deliberately not asserted in prose where it would go stale.

FOUR DISTINCT ROLES, measured at source:

  ROLE 1  TRADING WINDOW START -- `core.TRADE_START`, the thing the teaching is about.
          Gates whether a 5m bucket may be considered at all:
              kernel.py:146   `if ts.time() < core.TRADE_START: continue`
              kernel.py:55    bucket_starts filtered to [TRADE_START, LAST_ENTRY]
              candidate_xray.py:124, replay_lab.py:169
          THIS is what an 8:00 amendment must move.

  ROLE 2  SESSION-OPEN ANCHOR FOR THE LOCATION MAP -- a hardcoded `09:30` literal, NOT a
          reference to TRADE_START:
              kernel.py:132   `open_ts = pd.Timestamp(f"{dte} 09:30", tz=core.TZ)`
              kernel.py:139   `build_entry_locations_v24(env, dte, open_ts, p)`
          The pre-open S/R map is frozen AS OF THE OPEN. Moving this changes WHICH ZONES
          EXIST, which changes every location, story and force downstream.
          *** MOVING ROLE 2 WITH ROLE 1 WOULD INVALIDATE EVERY NUMBER IN THE CAMPAIGN
              WITHOUT SAYING SO. *** Same literal in targets.py:256, candidate_xray.py:101,
          replay_lab.py:94, replay_lab_v3.py:140/175.

  ROLE 3  RUNTIME EXECUTION START -- independent literals in the live/shadow layers:
              automation_runtime.py:35  `START = time(9, 30)`
              shadow_runtime.py:26      `EXECUTION_START = time(9, 30)`
          Neither reads `core.TRADE_START`. They would silently disagree with an amended
          kernel until changed too.

  ROLE 4  DATA-PREP / RTH FILTERS -- session slicing that is not a strategy rule:
              clean_dataset_preflight.py:253/255/260, v2_2_engine.py:345/867/869,
              v2_3_engine.py:63, v2_3_oos.py:150, v2_3_shadow.py:24
          Some of these are RTH-to-16:00 filters that share only the 09:30 start; changing
          them is a data-coverage decision, not a window decision.

WHAT THIS MODULE ASSERTS: only that the roles are distinct and enumerable. It proposes no
amendment, edits nothing, and takes no view on what the new bound should be.

Run: PYTHONPATH=. python -m research.current_mnq_strategy_v2_4_window_bound_census
"""
from __future__ import annotations

import ast
import io
import re
from pathlib import Path

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC_ONLY. Enumerates where a constant lives and what each site means. Proposes no "
    "amendment, edits nothing, selects no strategy rule. ALGO-025 section 3 item 3."
)

RESEARCH = Path("research")
TIME_RE = re.compile(r"\b0?9:30\b")
CALL_RE = re.compile(r"time\(\s*9\s*,\s*30\s*\)")

ROLE_TRADING_WINDOW = "ROLE_1_TRADING_WINDOW_START"
ROLE_LOCATION_ANCHOR = "ROLE_2_SESSION_OPEN_ANCHOR_FOR_THE_LOCATION_MAP"
ROLE_RUNTIME_START = "ROLE_3_RUNTIME_EXECUTION_START"
ROLE_DATA_FILTER = "ROLE_4_DATA_PREP_OR_RTH_FILTER"
ROLE_UNCLASSIFIED = "UNCLASSIFIED_INSPECT_BY_HAND"

#: Only ROLE 1 is what the operator's 8:00 teaching is about.
ROLE_THE_AMENDMENT_TARGETS = ROLE_TRADING_WINDOW


def _classify(line: str, name: str | None) -> str:
    low = line.lower()
    if name and "trade_start" in name.lower():
        return ROLE_TRADING_WINDOW
    if "open_ts" in low or "start_floor" in low:
        return ROLE_LOCATION_ANCHOR
    if name and name.upper() in {"START", "EXECUTION_START", "COVERAGE_START"}:
        return ROLE_RUNTIME_START
    if any(k in low for k in ("raw1[", "raw5[", "one[", "local[", "rth", "index.time")):
        return ROLE_DATA_FILTER
    return ROLE_UNCLASSIFIED


def census(root: Path = RESEARCH) -> dict:
    sites: list[dict] = []
    for path in sorted(root.glob("current_mnq_strategy_v2*.py")):
        # A census that counts itself inflates its own finding.
        if path.name == Path(__file__).name:
            continue
        src = io.open(path, encoding="utf-8").read()
        try:
            tree = ast.parse(src)
        except SyntaxError:
            continue
        lines = src.splitlines()
        seen: set[int] = set()

        def add(lineno: int, name: str | None = None) -> None:
            if lineno in seen:
                return
            seen.add(lineno)
            text = lines[lineno - 1].strip()
            sites.append({"file": path.name, "line": lineno, "text": text[:120],
                          "role": _classify(text, name)})

        for n in ast.walk(tree):
            # `time(9, 30)` and `pd.Timestamp("09:30")` and f-strings carrying 09:30
            if isinstance(n, ast.Call):
                fn = getattr(n.func, "attr", None) or getattr(n.func, "id", None)
                if fn == "time":
                    a = [x.value for x in n.args if isinstance(x, ast.Constant)]
                    if a[:2] == [9, 30]:
                        add(n.lineno)
            if isinstance(n, ast.Constant) and isinstance(n.value, str) \
                    and TIME_RE.search(n.value):
                add(n.lineno)
            if isinstance(n, ast.Assign) and len(n.targets) == 1 \
                    and isinstance(n.targets[0], ast.Name):
                seg = ast.get_source_segment(src, n) or ""
                # `time(9, 30)` carries no "09:30" STRING, so the call form must be
                # matched too or the runtime starts (`START`, `EXECUTION_START`) lose
                # their variable name and fall through to UNCLASSIFIED - which is
                # exactly where they landed on the first run.
                if (TIME_RE.search(seg) or "TRADE_START" in seg
                        or CALL_RE.search(seg)):
                    seen.discard(n.lineno)
                    add(n.lineno, n.targets[0].id)

    # Docstrings and comments are prose, not code. Drop lines that are only prose.
    sites = [s for s in sites
             if not s["text"].lstrip().startswith(("#", '"""', "'''", '"', "'"))]

    by_role: dict[str, list[dict]] = {}
    for s in sites:
        by_role.setdefault(s["role"], []).append(s)

    return {
        "status": DIAGNOSTIC_ONLY,
        "total_code_sites": len(sites),
        "roles": {k: len(v) for k, v in sorted(by_role.items())},
        "the_amendment_targets_only": ROLE_THE_AMENDMENT_TARGETS,
        "hazard": (
            "09:30 is NOT one constant. The trading-window start and the session-open anchor "
            "for the LOCATION MAP are different roles sharing one literal. Moving the anchor "
            "with the window would change WHICH S/R ZONES EXIST and silently invalidate every "
            "number in the campaign. A find-and-replace is the wrong instrument."),
        "sites": sorted(sites, key=lambda s: (s["role"], s["file"], s["line"])),
    }


def main() -> None:
    c = census()
    print(f'code sites carrying 09:30 : {c["total_code_sites"]}')
    for role, n in c["roles"].items():
        mark = "  <- THE AMENDMENT TARGETS THIS" if role == ROLE_THE_AMENDMENT_TARGETS else ""
        print(f'  {role:52} {n}{mark}')
    print()
    for s in c["sites"]:
        print(f'  {s["role"][:6]} {s["file"]:52}:{s["line"]:<5} {s["text"][:70]}')
    print()
    print(c["hazard"])


if __name__ == "__main__":
    main()
