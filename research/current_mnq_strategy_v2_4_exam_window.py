#!/usr/bin/env python3
"""The exam's trading window, as a RUN CONFIGURATION. ALGO-049 §2. Changes no semantics.

WHY THIS EXISTS. ALGO-049 WITHDREW the ALGO-043 revert: `core.TRADE_START` stays at the taught
08:00 and 08:00-12:00 is the UNCONDITIONAL deployment window. But the dual-window exam still
needs a 09:30 arm, because the frozen 5/8 baseline lives there and an arm that cannot be
compared to it is not a baseline. The ruling assigned the mechanics here: "parameterized window
for that arm only... STOP and publish first if that needs semantic entry-logic changes beyond
config plumbing". So this is plumbing — one context manager that rebinds ROLE 1 for the
duration of one arm and restores it — and NOT a parameter threaded through the entry path.

    ROLE 1 ONLY. `current_mnq_strategy_v2_4_window_bound_census.py` measured that 09:30 was
    never one constant: it lives in FOUR roles that do not mean the same thing.

  ROLE 1  the TRADING WINDOW START      -- what this module moves, and the only one.
  ROLE 2  the SESSION-OPEN ANCHOR       -- `open_ts = 09:30` freezes WHICH S/R ZONES EXIST.
          *** MOVING IT WITH ROLE 1 WOULD INVALIDATE EVERY NUMBER IN THE CAMPAIGN WITHOUT
              SAYING SO. *** It is a string literal in the kernel, so it cannot move by
              accident here — and `assert_role2_is_not_coupled_to_role1` turns the one edit
              that WOULD couple them into a red test rather than a silent catastrophe.
  ROLE 3  the RUNTIME execution start   -- live/shadow layers. Not the exam's business.
  ROLE 4  the DATA-PREP floor           -- already DERIVED from TRADE_START (v2_2_engine.py),
          which is why it moves with ROLE 1 automatically and correctly.

THE NO-OP THAT NEARLY SHIPPED, AND WHY THE ALIAS SWEEP IS DERIVED. ROLE 4 was once a SECOND
COPY of the literal. With ROLE 1 alone the window moved to a time with no bars in it: the
amendment would have changed NOTHING and reported zero deltas as if the new window had been
tested. Module-level copies are the same hazard — `replay_lab_v3` binds `TRADE_START` at IMPORT
time, so rebinding only `core` would leave it pointing at the old value. The aliases are
therefore DISCOVERED by a NAME+VALUE join over the loaded modules, never listed: a list is what
goes stale the next time someone adds a copy.

ORDERING IS LOAD-BEARING. `prepare()` filters the bars it returns by TRADE_START, so an arm
must build its env INSIDE the window, not before it. `run_window()` exists so that ordering is
expressed once instead of remembered.

Run nothing. This is a library.
"""
from __future__ import annotations

import io
from contextlib import contextmanager
from datetime import time as _time

from research import current_mnq_strategy_v2_3_engine as prod

core = prod.core

#: The names that carry ROLE 1 / its companion bound. A rebind must find every module-level
#: copy of these, or the arm silently half-moves.
WINDOW_NAMES = ("TRADE_START", "LAST_ENTRY")

#: The taught, committed window. ALGO-049 made it the standing deployment configuration.
DEPLOYMENT_WINDOW = (_time(8, 0), _time(12, 0))

#: The window the frozen 5/8 baseline was measured at. Comparability, not a candidate.
BASELINE_ARM_START = _time(9, 30)

KERNEL_SRC = "research/current_mnq_strategy_v2_4_kernel.py"

_ACTIVE: dict | None = None


def _alias_sites(original: dict) -> list[tuple[object, str]]:
    """Every loaded module attribute that is a COPY of a window bound.

    Joined on NAME **and** VALUE. Value alone would sweep up any unrelated constant that
    happens to equal 08:00; name alone would rebind a same-named constant that means something
    else in another generation of the engine (`v2_1_fidelity.TRADE_START` is 09:30 and belongs
    to a different pipeline). Both together identify a genuine alias of the bound being moved.
    """
    import sys

    sites: list[tuple[object, str]] = []
    for name, mod in list(sys.modules.items()):
        if not name.startswith("research.") or mod is None:
            continue
        for attr in WINDOW_NAMES:
            if getattr(mod, attr, None) == original[attr]:
                sites.append((mod, attr))
    return sites


def assert_role2_is_not_coupled_to_role1() -> None:
    """The session-open anchor must NOT read TRADE_START. Checked before every rebind.

    This is the one edit that would turn a harmless window arm into a silent re-write of every
    zone, location, story and force in the campaign. It is cheap to check and catastrophic to
    miss, so it is checked at the moment it would do the damage rather than trusted.
    """
    src = io.open(KERNEL_SRC, encoding="utf-8").read()
    for line in src.splitlines():
        if "open_ts" in line and "=" in line and "TRADE_START" in line:
            raise AssertionError(
                "ROLE 2 (the session-open anchor) now reads TRADE_START. Moving the trading "
                "window would move WHICH S/R ZONES EXIST and invalidate every number in the "
                f"campaign without saying so. Offending line: {line.strip()}")
    if 'f"{dte} 09:30"' not in src:
        raise AssertionError(
            "the 09:30 session-open anchor literal is gone from the kernel; ROLE 2 must stay "
            "a fixed anchor independent of the trading window")


@contextmanager
def trading_window(start, last_entry=None):
    """Run a block with ROLE 1 moved. Restores on the way out, including on exception.

    Nesting is REFUSED rather than stacked: two overlapping windows would make "which window
    produced this number" unanswerable, and an exam arm whose window is ambiguous is not
    evidence.
    """
    global _ACTIVE
    if _ACTIVE is not None:
        raise RuntimeError(
            f"a trading window is already active ({_ACTIVE['start']}-{_ACTIVE['last_entry']}); "
            "nesting would make the arm's window ambiguous")

    assert_role2_is_not_coupled_to_role1()

    original = {n: getattr(core, n) for n in WINDOW_NAMES}
    sites = _alias_sites(original)
    new = {"TRADE_START": start,
           "LAST_ENTRY": last_entry if last_entry is not None else original["LAST_ENTRY"]}

    _ACTIVE = {"start": new["TRADE_START"], "last_entry": new["LAST_ENTRY"],
               "alias_sites": [f"{m.__name__}.{a}" for m, a in sites]}
    try:
        for mod, attr in sites:
            setattr(mod, attr, new[attr])
        yield _ACTIVE
    finally:
        for mod, attr in sites:
            setattr(mod, attr, original[attr])
        _ACTIVE = None
        # The restore is VERIFIED, not assumed. A leaked window would silently re-label every
        # later measurement in the same process with a window it was not run at.
        leaked = {f"{m.__name__}.{a}": getattr(m, a)
                  for m, a in sites if getattr(m, a) != original[a]}
        if leaked:
            raise RuntimeError(f"WINDOW LEAKED, restore failed: {leaked}")


def run_window(start, build_env, arm, last_entry=None) -> dict:
    """Build the env AND run the arm inside the window, then report which window it ran at.

    `prepare()` filters bars by TRADE_START, so building the env outside the window and running
    the arm inside it would measure a 09:30 arm on 08:00 data - a half-moved window, which is
    the exact shape of the no-op this module's docstring records.
    """
    with trading_window(start, last_entry) as active:
        env = build_env()
        result = arm(env)
    return {
        "window_start": str(active["start"]),
        "window_last_entry": str(active["last_entry"]),
        "alias_sites_rebound": active["alias_sites"],
        "role2_anchor": "09:30 session-open anchor UNCHANGED (ROLE 1 moved alone)",
        "result": result,
    }


__all__ = ["BASELINE_ARM_START", "DEPLOYMENT_WINDOW", "WINDOW_NAMES",
           "assert_role2_is_not_coupled_to_role1", "run_window", "trading_window"]
