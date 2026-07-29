#!/usr/bin/env python3
"""absence-claim-control -- make an ABSENCE claim provable, or fail LOUD.

Minted by R-468 §5 (operator-ordered: "fix the false-positive problem too") after
SIX false-absence incidents in one night, all one shape:

    A SEARCH THAT CANNOT SUCCEED REPORTS FAILURE, AND FAILURE READS AS FACT.

R-459 already minted the *law*. The desk broke it hours later on the same
repository. So this is not a seventh law -- it is the executable positive control,
and its whole purpose is to EXIT NON-ZERO when the search was never capable of
finding the thing it reports missing.

An absence claim is inadmissible without all three:
  (a) POSITIVE CONTROL  -- the search is DEMONSTRATED to hit the target where it
      IS present, in the SAME invocation. Control must share the target's SHAPE.
  (b) ENUMERATED SURFACE -- every copy named, with the REPO of each. On this box
      one filename had 50 copies at 4 sizes across independent git repos:
      same-name-different-repo is the DEFAULT STATE, not an edge case.
  (c) DYNAMIC REACH -- capability searches must cover `await import(...)`,
      `require(...)`, aliased destructuring and string-built specifiers, not only
      static `^import`. That exact shape hid `writeFileSync` from AR-461.

EXIT CODES
  0  search is CAPABLE (control hit). The absence result over the rest of the
     surface is admissible, and the enumerated surface is printed with it.
  2  SEARCH INCAPABLE -- control MISSED. Any absence conclusion is INADMISSIBLE.
  3  SEARCH INCAPABLE -- control not inside the enumerated surface at all.
  4  usage / control file unreadable.

USAGE
  python absence_claim_control.py --pattern PAT --control PATH
      [--root DIR] [--name GLOB] [--surface DIR]... [--capability NAME]

  --capability NAME  expands to the static AND dynamic forms of a capability, so
                     a blind static scan cannot be spelled by accident.
"""
from __future__ import annotations

import argparse
import fnmatch
import os
import pathlib
import re
import subprocess
import sys

DEFAULT_ROOT = pathlib.Path(r"C:\Users\tonio\Projects")

# (c) DYNAMIC REACH -- the forms a capability can arrive through.
CAPABILITY_FORMS = [
    r"\b{name}\b",                                  # bare use / destructured
    r"import\s*\{{[^}}]*\b{name}\b[^}}]*\}}",       # static named import
    r"await\s+import\([^)]*\)",                     # dynamic import (any module)
    r"require\([^)]*\)",                            # CJS require
    r"\b{name}\s*:",                                # aliased destructuring target
]


def enumerate_repos(root: pathlib.Path) -> dict[pathlib.Path, str]:
    """(b) ENUMERATED SURFACE: map every directory to its owning git repo."""
    repos: dict[pathlib.Path, str] = {}
    try:
        for git in root.glob("*/.git"):
            repos[git.parent.resolve()] = git.parent.name
        for git in root.glob("*/*/.git"):
            repos[git.parent.resolve()] = f"{git.parent.parent.name}/{git.parent.name}"
    except OSError:
        pass
    return repos


def owning_repo(path: pathlib.Path, repos: dict[pathlib.Path, str]) -> str:
    best, best_len = "<NO REPO -- outside every git tree>", -1
    rp = path.resolve()
    for root, name in repos.items():
        try:
            rp.relative_to(root)
        except ValueError:
            continue
        if len(str(root)) > best_len:
            best, best_len = name, len(str(root))
    return best


PRUNE_DIRS = {"node_modules", ".git", ".venv", "__pycache__", "dist", "build", ".next", ".cache"}


def collect_files(surfaces: list[pathlib.Path], name_glob: str) -> list[pathlib.Path]:
    """(b) ENUMERATED SURFACE. os.walk with in-place pruning -- rglob('*') walks
    every blob under a 47-repo root and times out, which made the FIRST version of
    this guard unusable. A guard nobody can afford to run is not a guard."""
    out: list[pathlib.Path] = []
    for s in surfaces:
        if s.is_file():
            out.append(s)
            continue
        for dirpath, dirnames, filenames in os.walk(s):
            dirnames[:] = [d for d in dirnames if d not in PRUNE_DIRS]
            for fn in filenames:
                if name_glob == "*" or fnmatch.fnmatch(fn, name_glob):
                    out.append(pathlib.Path(dirpath) / fn)
    return out


def search(files: list[pathlib.Path], patterns: list[re.Pattern[str]]) -> dict[pathlib.Path, int]:
    hits: dict[pathlib.Path, int] = {}
    for p in files:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        n = sum(len(pat.findall(text)) for pat in patterns)
        if n:
            hits[p.resolve()] = n
    return hits


def main() -> int:
    ap = argparse.ArgumentParser(description="Prove a search is CAPABLE before believing its absence.")
    ap.add_argument("--pattern", action="append", default=[], help="regex to search (repeatable)")
    ap.add_argument("--capability", help="capability name; expands to static AND dynamic forms")
    ap.add_argument("--control", required=True, help="POSITIVE-CONTROL path that MUST hit")
    ap.add_argument("--root", default=str(DEFAULT_ROOT), help="root for repo enumeration")
    ap.add_argument("--name", default="*", help="filename glob to limit the surface")
    ap.add_argument("--surface", action="append", default=[], help="dir/file to search (default: --root)")
    a = ap.parse_args()

    if not a.pattern and not a.capability:
        print("USAGE ERROR: give --pattern and/or --capability", file=sys.stderr)
        return 4

    raw: list[str] = list(a.pattern)
    if a.capability:
        raw += [f.format(name=re.escape(a.capability)) for f in CAPABILITY_FORMS]
    try:
        patterns = [re.compile(p, re.MULTILINE) for p in raw]
    except re.error as exc:
        print(f"USAGE ERROR: bad regex: {exc}", file=sys.stderr)
        return 4

    control = pathlib.Path(a.control)
    if not control.is_file():
        print(f"USAGE ERROR: control is not a readable file: {control}", file=sys.stderr)
        return 4

    root = pathlib.Path(a.root)
    surfaces = [pathlib.Path(s) for s in (a.surface or [str(root)])]
    repos = enumerate_repos(root)
    files = collect_files(surfaces, a.name)
    hits = search(files, patterns)

    print("=" * 74)
    print("ABSENCE-CLAIM CONTROL  (R-468 §5)")
    print("=" * 74)
    print(f"patterns ({len(patterns)}):")
    for p in raw:
        print(f"    {p}")
    print(f"control : {control}")
    print(f"surface : {len(files)} files matching {a.name!r} under {[str(s) for s in surfaces]}")
    print(f"repos enumerated under root: {len(repos)}")

    # (b) the enumerated surface, with the repo of every copy -- printed ALWAYS,
    #     because an absence result is only readable beside its surface.
    if a.name != "*":
        print(f"\n--- ENUMERATED SURFACE: every copy of {a.name!r}, with owning repo ---")
        for p in sorted(files):
            mark = "HIT " if p.resolve() in hits else "  . "
            try:
                size = p.stat().st_size
            except OSError:
                size = -1
            print(f"  {mark}{size:>8}  [{owning_repo(p, repos)}]  {p}")

    print(f"\n--- RESULT: {len(hits)} of {len(files)} files matched ---")

    # (a) POSITIVE CONTROL -- the whole point. Checked LAST and loudest.
    ctrl = control.resolve()
    if ctrl not in {f.resolve() for f in files}:
        print("\n" + "!" * 74)
        print("SEARCH INCAPABLE -- exit 3")
        print("The POSITIVE CONTROL IS NOT INSIDE THE ENUMERATED SURFACE.")
        print("The search never looked where the thing is known to be, so its")
        print("absence result says NOTHING. Widen --surface to include the control.")
        print(f"  control: {ctrl}")
        print("!" * 74)
        return 3

    if ctrl not in hits:
        print("\n" + "!" * 74)
        print("SEARCH INCAPABLE -- exit 2")
        print("The POSITIVE CONTROL was searched and NOT matched. The pattern")
        print("cannot find the thing even where it IS present, so ANY absence")
        print("conclusion drawn from it is INADMISSIBLE.")
        print("Likely cause: a STATIC pattern against a DYNAMIC reach")
        print('  (await import(...) / require(...) / aliased destructuring).')
        print("Use --capability NAME to cover those forms.")
        print(f"  control: {ctrl}")
        print("!" * 74)
        return 2

    print("\n" + "-" * 74)
    print(f"CONTROL HIT ({hits[ctrl]} match(es)) -- the search is CAPABLE.")
    print("An absence over the remainder of the surface above is ADMISSIBLE,")
    print("and must be cited together with that surface.")
    print("-" * 74)
    return 0


if __name__ == "__main__":
    sys.exit(main())
