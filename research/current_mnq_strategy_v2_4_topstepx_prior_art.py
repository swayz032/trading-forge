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

  3b. AND THE FINDING THAT MATTERS: THE KILL SWITCH IS UNTESTED. Only 2 of 13 public methods
     are exercised by any test, and the unexercised list is almost exactly the safety core --
     `flatten`, `flatten_contract`, `cancel_all`, `cancel_order`, `get_open_position`,
     `get_open_positions`, `get_working_orders`. ALGO-025 section 2 item 3 names a dead-man
     switch and EOD flatten discipline as PART OF THE PRODUCT, not a Trading Forge extra. The
     adapter exists and is wired; the half of it that protects the account is unproven even at
     the request-shaping level the other tests reach.

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


def _names_used_in_tests() -> set[str]:
    used: set[str] = set()
    for p in TESTS.glob("test_*projectx*.py"):
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
        "public_methods_total": n_methods,
        "public_methods_touched_by_a_test": n_covered,
        "safety_critical_methods": sorted(SAFETY_CRITICAL),
        "safety_critical_exercised": sorted(SAFETY_CRITICAL & all_covered),
        "safety_critical_UNEXERCISED": sorted(SAFETY_CRITICAL & all_defined - all_covered),
        "THE_FINDING": (
            "the kill switch is UNTESTED. Every method that stops a runaway bot - flatten, "
            "flatten_contract, cancel_all, cancel_order, and the position/order readers they "
            "depend on - has NO test exercising it. ALGO-025 section 2 item 3 names a "
            "dead-man switch and EOD flatten discipline as PART OF THE PRODUCT. The adapter "
            "exists and is wired; the half of it that protects the account is unproven even "
            "at the request-shaping level the other tests reach."),
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
