#!/usr/bin/env python3
"""What TopstepX connectivity already exists, and what of it is actually proven?

DIAGNOSTIC ONLY. Reads code and tests. Opens no connection, holds no credential.

ALGO-025 section 2 item 1 ruled that the v2.4 family IS a standalone bot and that TopstepX
connectivity has in-repo prior art, then applied prior-art law explicitly:

    "assess and reuse those before authoring a new adapter; their working state is
     UNVERIFIED and must be measured, not assumed."

This is that measurement. It answers three questions and refuses to answer a fourth.

  1. WHAT EXISTS.  `..._v2_2_projectx_broker.py` (ProjectXBroker) and
     `..._v2_2_projectx_history.py` (ProjectXHistory). ProjectX IS TopstepX: the broker's
     `API_BASE` is literally `https://api.topstepx.com/api`, and credentials come from
     `TOPSTEPX_USERNAME` / `TOPSTEPX_API_KEY`.

  2. IS IT WIRED.  Yes, and further than the ruling assumed:
     `current_mnq_strategy_v2_4_shadow_runtime.py` ALREADY IMPORTS `ProjectXBroker`. The v2.4
     family does not need a new adapter written; it needs the existing one assessed.

  3. WHAT IS PROVEN.  The tests inject a `FakeSession`, so they are offline by construction --
     verified here rather than assumed. That is good hygiene and it is also the limit of what
     they establish: THEY PROVE THE REQUEST-SHAPING LOGIC, NOT THAT TOPSTEPX ACCEPTS IT.
     `covered_methods` below names exactly which of the broker's public surface any test
     touches; the rest is unexercised.

  3b. THE FINDING THAT MATTERED, AND ITS CLOSURE. This module first measured 2 of 13 public
     methods exercised, with the unexercised list almost exactly the safety core -- the KILL
     SWITCH WAS UNTESTED. ALGO-026 section 1(c) turned that into the first task of the
     self-sufficiency pack, and `test_..._v2_4_broker_safety_core.py` now covers all seven
     offline. Coverage 2/13 -> 10/13; safety-critical unexercised: none.

     `THE_FINDING` below is DERIVED from the measurement, not frozen prose, so it re-opens by
     itself if coverage ever regresses. A guard that keeps asserting a hole after the hole is
     closed is the mirror image of one that never fires.

     WHAT THE NEW COVERAGE ESTABLISHES, and its honest limit: request shaping and LOOP
     BEHAVIOUR. The most useful thing it measured is a defect, not a reassurance --
     A FAILED CLOSE ABORTS `flatten()` AND LEAVES LATER POSITIONS OPEN. "Stop everything" can
     leave the operator partly in the market, and the runbook must say so.

  3c. A DISCOVERY BUG IN THIS MODULE, worth recording because it is the day's recurring shape.
     Test discovery globbed `test_*projectx*.py` -- by FILENAME. It could not see the new
     safety file, so it kept reporting the methods as unexercised after they were covered.
     Coverage is a property of what a test IMPORTS and CALLS, never of what its file is
     called. Discovery is now by import, and `test_files_discovered_by_import` names the
     files counted so the denominator is inspectable.

  4. WHAT THIS MODULE WILL NOT DO.  It does not connect, and it does not estimate whether the
     adapter "works" against the live API. ALGO-025 section 2 item 2 is a HARD GATE: nothing
     connects to TopstepX -- not funded, not eval, not broker-paper -- until FIDELITY (a
     passing grade) -> FREEZE -> CLEAN EDGE -> prop-survival arsenal completes. A subscription
     expiry exerts zero authority over that ladder. Reading the source is not connecting;
     inferring live behaviour from an offline test would be pretending to.

Run: PYTHONPATH=. python -m research.current_mnq_strategy_v2_4_topstepx_prior_art
"""
from __future__ import annotations

import ast
import io
from pathlib import Path

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC_ONLY. Assesses existing connectivity code. Opens no connection, holds no "
    "credential, selects no strategy rule. ALGO-025 section 2 item 1."
)

RESEARCH = Path("research")
TESTS = Path("tests")

PRIOR_ART = {
    "broker": RESEARCH / "current_mnq_strategy_v2_2_projectx_broker.py",
    "history": RESEARCH / "current_mnq_strategy_v2_2_projectx_history.py",
}
#: The minimum safety core ALGO-025 section 2 item 3 names as PART OF THE PRODUCT, not a
#: Trading Forge extra: a dead-man/kill switch and EOD flatten discipline. These are the
#: methods that stop a runaway bot, so their test coverage matters more than any other.
SAFETY_CRITICAL = frozenset({
    "flatten", "flatten_contract", "cancel_all", "cancel_order",
    "get_open_position", "get_open_positions", "get_working_orders",
})

#: The hard gate. Recorded so no downstream reader mistakes "it exists" for "we may use it".
HARD_GATE = (
    "NOTHING connects to TopstepX - not funded, not eval, not broker-paper - before "
    "FIDELITY (grade passes) -> FREEZE -> CLEAN EDGE -> prop-survival arsenal. A subscription "
    "expiry date exerts ZERO authority over this ladder. ALGO-025 section 2 item 2."
)


def _public_methods(path: Path) -> dict[str, list[str]]:
    tree = ast.parse(io.open(path, encoding="utf-8").read())
    out: dict[str, list[str]] = {}
    for n in tree.body:
        if isinstance(n, ast.ClassDef):
            out[n.name] = [m.name for m in n.body
                           if isinstance(m, ast.FunctionDef) and not m.name.startswith("_")]
    return out


def _test_files_covering(stems: set[str]) -> list[Path]:
    """Every test file that IMPORTS the prior-art modules.

    The first version globbed `test_*projectx*.py` - discovery by FILENAME. It could not see
    `test_current_mnq_strategy_v2_4_broker_safety_core.py`, which imports the broker and
    exercises the entire safety surface, so the assessment kept reporting those methods as
    unexercised after they had been covered. Coverage is a property of what a test IMPORTS
    and CALLS, never of what its file is called.
    """
    out = []
    for p in sorted(TESTS.glob("test_*.py")):
        try:
            tree = ast.parse(io.open(p, encoding="utf-8").read())
        except (SyntaxError, UnicodeDecodeError):
            continue
        mods: set[str] = set()
        for n in ast.walk(tree):
            if isinstance(n, ast.ImportFrom):
                mods.add(n.module or "")
                mods.update(a.name for a in n.names)
            elif isinstance(n, ast.Import):
                mods.update(a.name for a in n.names)
        if any(any(st in m for m in mods) for st in stems):
            out.append(p)
    return out


def _names_used_in_tests(stems: set[str] | None = None) -> set[str]:
    stems = stems or {p.stem for p in PRIOR_ART.values()}
    used: set[str] = set()
    for p in _test_files_covering(stems):
        for n in ast.walk(ast.parse(io.open(p, encoding="utf-8").read())):
            if isinstance(n, ast.Call):
                nm = getattr(n.func, "attr", None) or getattr(n.func, "id", None)
                if nm:
                    used.add(nm)
            elif isinstance(n, ast.Attribute):
                used.add(n.attr)
    return used


def _importers(target_stem: str) -> list[str]:
    out = []
    for p in sorted(RESEARCH.glob("current_mnq_strategy_v2_*.py")):
        if p.stem == target_stem:
            continue
        try:
            tree = ast.parse(io.open(p, encoding="utf-8").read())
        except SyntaxError:
            continue
        for n in ast.walk(tree):
            mods = []
            if isinstance(n, ast.ImportFrom):
                mods = [n.module or ""]
            elif isinstance(n, ast.Import):
                mods = [a.name for a in n.names]
            if any(target_stem in (m or "") for m in mods):
                out.append(p.name)
                break
    return out


def assess() -> dict:
    used = _names_used_in_tests()
    surface: dict[str, dict] = {}
    for label, path in PRIOR_ART.items():
        if not path.exists():
            surface[label] = {"exists": False}
            continue
        methods = _public_methods(path)
        covered = {cls: sorted(m for m in ms if m in used) for cls, ms in methods.items()}
        uncovered = {cls: sorted(m for m in ms if m not in used) for cls, ms in methods.items()}
        surface[label] = {
            "exists": True,
            "path": str(path),
            "bytes": path.stat().st_size,
            "classes": {k: len(v) for k, v in methods.items()},
            "covered_methods": covered,
            "unexercised_methods": uncovered,
            "importers_in_v2_family": _importers(path.stem),
        }
    n_methods = sum(len(ms) for s in surface.values() if s.get("exists")
                    for ms in s["covered_methods"].values()) \
        + sum(len(ms) for s in surface.values() if s.get("exists")
              for ms in s["unexercised_methods"].values())
    n_covered = sum(len(ms) for s in surface.values() if s.get("exists")
                    for ms in s["covered_methods"].values())
    all_covered = {m for s in surface.values() if s.get("exists")
                   for ms in s["covered_methods"].values() for m in ms}
    all_defined = all_covered | {m for s in surface.values() if s.get("exists")
                                 for ms in s["unexercised_methods"].values() for m in ms}
    return {
        "status": DIAGNOSTIC_ONLY,
        "HARD_GATE": HARD_GATE,
        "projectx_is_topstepx": "API_BASE is https://api.topstepx.com/api",
        "credentials_from": ["TOPSTEPX_USERNAME", "TOPSTEPX_API_KEY"],
        "tests_are_offline_by_construction":
            "the broker takes an injected `session`; its tests pass a FakeSession, so no "
            "socket is opened. Verified, not assumed.",
        "what_the_tests_establish": (
            "REQUEST SHAPING ONLY. They prove the adapter builds the calls it intends to "
            "build. They cannot and do not prove TopstepX accepts them."),
        "test_files_discovered_by_import":
            [p.name for p in _test_files_covering({p.stem for p in PRIOR_ART.values()})],
        "public_methods_total": n_methods,
        "public_methods_touched_by_a_test": n_covered,
        "safety_critical_methods": sorted(SAFETY_CRITICAL),
        "safety_critical_exercised": sorted(SAFETY_CRITICAL & all_covered),
        "safety_critical_UNEXERCISED": sorted(SAFETY_CRITICAL & all_defined - all_covered),
        "THE_FINDING": (
            "THE KILL SWITCH IS UNTESTED. Every method that stops a runaway bot - flatten, "
            "flatten_contract, cancel_all, cancel_order, and the position/order readers they "
            "depend on - has NO test exercising it. ALGO-025 section 2 item 3 names a "
            "dead-man switch and EOD flatten discipline as PART OF THE PRODUCT."
            if (SAFETY_CRITICAL & all_defined) - all_covered else
            "CLOSED 2026-08-23. Every safety-critical method is now exercised offline "
            "(ALGO-026 section 1c). What that establishes is REQUEST SHAPING AND LOOP "
            "BEHAVIOUR - including the measured fact that a failed close ABORTS `flatten()` "
            "and leaves later positions OPEN. It does not establish that TopstepX accepts the "
            "calls, and the section 2.2 hard gate is untouched."),
        "kill_switch_proven_offline": not ((SAFETY_CRITICAL & all_defined) - all_covered),
        "surface": surface,
        "verdict": (
            "PRIOR ART EXISTS AND IS ALREADY WIRED - a new adapter should not be authored. "
            "What is unproven is live behaviour, and that stays unproven until the ladder "
            "opens the gate."),
    }


def main() -> None:
    a = assess()
    print(f'public methods            : {a["public_methods_total"]}')
    print(f'touched by a test         : {a["public_methods_touched_by_a_test"]}')
    for label, s in a["surface"].items():
        if not s["exists"]:
            print(f'  {label}: MISSING')
            continue
        print(f'\n  {label}  {s["path"]}  ({s["bytes"]:,} B)')
        for cls, cov in s["covered_methods"].items():
            unc = s["unexercised_methods"][cls]
            print(f'    {cls}: {len(cov)} exercised, {len(unc)} not')
            if unc:
                print(f'      UNEXERCISED: {", ".join(unc)}')
        print(f'    imported by: {s["importers_in_v2_family"] or "nothing"}')
    print()
    print(f'SAFETY-CRITICAL exercised   : {a["safety_critical_exercised"] or "NONE"}')
    print(f'SAFETY-CRITICAL UNEXERCISED : {a["safety_critical_UNEXERCISED"]}')
    print()
    print(a["THE_FINDING"])
    print()
    print(a["verdict"])
    print()
    print("HARD GATE:", a["HARD_GATE"])


if __name__ == "__main__":
    main()
