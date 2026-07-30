#!/usr/bin/env python3
"""absence-claim-control -- make an ABSENCE claim provable, or fail LOUD.

Minted by R-468 §5 (operator-ordered: "fix the false-positive problem too") after
SIX false-absence incidents in one night, all one shape:

    A SEARCH THAT CANNOT SUCCEED REPORTS FAILURE, AND FAILURE READS AS FACT.

An absence claim is inadmissible without all three:
  (a) POSITIVE CONTROL  -- the search is DEMONSTRATED to hit the target where it
      IS present, in the SAME invocation. Control must share the target's SHAPE.
  (b) ENUMERATED SURFACE -- every copy named, with the REPO of each. On this box
      one filename had 50 copies at 4 sizes across independent git repos:
      same-name-different-repo is the DEFAULT STATE, not an edge case.
  (c) DYNAMIC REACH -- capability searches must cover `await import(...)`,
      `require(...)` and aliased destructuring, not only static `^import`.

★ REPAIRED AFTER REJECTION (R-469 §5a). The first version FAILED AS THE CLASS IT
  EXISTS TO PREVENT: `CAPABILITY_FORMS` contained bare `await\\s+import\\(...\\)` and
  `require\\(...\\)` patterns that never referenced the requested capability, so ANY
  file containing ANY dynamic import "confirmed" ANY capability -- including the
  deliberately nonexistent `CapabilityThatDoesNotExist_7F3A91`, which returned
  EXIT 0 / CONTROL HIT. A guard against false ABSENCE that manufactures false
  PRESENCE is a NET NEGATIVE: it launders the exact error it was built to catch.
  EVERY pattern below is now BOUND TO THE REQUESTED BINDING NAME, and the
  nonexistent-capability case ships as a PERMANENT FIXTURE (`--self-test`) that
  must exit non-zero.

EXIT CODES
  0  search is CAPABLE (control hit). The absence result over the rest of the
     surface is admissible, and must be cited together with that surface.
  2  SEARCH INCAPABLE -- control was searched and MISSED. Absence INADMISSIBLE.
  3  SEARCH INCAPABLE -- control not inside the enumerated surface at all.
  4  usage / control file unreadable.
  5  --self-test: a fixture case did not produce its required exit code.

USAGE
  python absence_claim_control.py --capability writeFileSync \
      --control <path> --name "atomize-transcript.ts"
  python absence_claim_control.py --self-test          # the permanent fixtures
"""
from __future__ import annotations

import argparse
import fnmatch
import os
import pathlib
import re
import sys
import time

DEFAULT_ROOT = pathlib.Path(r"C:\Users\tonio\Projects")

# (c) DYNAMIC REACH -- every form BOUND TO {name}. There is deliberately no
# pattern here that can match without the requested name appearing, because that
# is precisely the false-green R-469 §5a rejected.
CAPABILITY_FORMS = [
    r"\b{name}\b",                                            # bare / destructured / property use
    r"import\s*\{{[^}}]*\b{name}\b[^}}]*\}}",                 # static named import
    r"\{{[^}}]*\b{name}\b[^}}]*\}}\s*=\s*await\s+import\(",   # dynamic destructured import
    r"\{{[^}}]*\b{name}\b[^}}]*\}}\s*=\s*require\(",          # CJS destructured require
    r"\b{name}\b\s*=\s*(?:await\s+import|require)\(",         # whole module bound to the name
    r"\b{name}\s*:\s*\w+",                                    # aliased destructuring source
]

PRUNE_DIRS = {
    "node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build",
    ".next", ".cache", ".pytest_cache", ".mypy_cache", "coverage", "target",
    ".turbo", ".parcel-cache",
}


def enumerate_repos(root: pathlib.Path) -> dict[pathlib.Path, str]:
    """(b) ENUMERATED SURFACE: map directories to their owning git repo."""
    repos: dict[pathlib.Path, str] = {}
    for depth in ("*/.git", "*/*/.git"):
        try:
            for git in root.glob(depth):
                p = git.parent
                repos[p.resolve()] = p.name if depth == "*/.git" else f"{p.parent.name}/{p.name}"
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


def collect_files(surfaces: list[pathlib.Path], name_glob: str) -> list[pathlib.Path]:
    """os.walk with in-place pruning. rglob('*') over a 47-repo root timed out and
    made the first version unrunnable -- A GUARD NOBODY CAN AFFORD TO RUN IS NOT A
    GUARD, and R-469 §5a found it STILL too slow. Runtime is now measured and
    printed on every run rather than asserted to be fixed."""
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


def build_patterns(raw_patterns: list[str], capability: str | None) -> list[re.Pattern[str]]:
    raw = list(raw_patterns)
    if capability:
        raw += [f.format(name=re.escape(capability)) for f in CAPABILITY_FORMS]
    return [re.compile(p, re.MULTILINE) for p in raw]


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


# DOCUMENTED RUNTIME BOUND (R-469 §5a: "bring the runtime under a documented
# bound"). MEASURED on this box: --name "atomize-transcript.ts" over 47 repos =
# 50 files, 2.5s. --self-test = 0.3s. The pathological path is an OMITTED --name,
# which collects and READS every file in every repo -- that is the run that timed
# out. A bound that fails LOUD is a bound; a run that hangs is not.
MAX_FILES = 20_000


def run_check(patterns: list[re.Pattern[str]], pattern_src: list[str], control: pathlib.Path,
              surfaces: list[pathlib.Path], name_glob: str, root: pathlib.Path,
              verbose: bool = True, max_files: int = MAX_FILES) -> int:
    t0 = time.monotonic()
    repos = enumerate_repos(root)
    files = collect_files(surfaces, name_glob)
    if len(files) > max_files:
        print("\n" + "!" * 74)
        print(f"REFUSING TO RUN -- exit 4: surface is {len(files)} files (bound {max_files}).")
        print("An unbounded surface is how this guard timed out and became unusable.")
        print("Narrow --name or --surface, or raise --max-files deliberately.")
        print("!" * 74)
        return 4
    hits = search(files, patterns)
    elapsed = time.monotonic() - t0

    if verbose:
        print("=" * 74)
        print("ABSENCE-CLAIM CONTROL  (R-468 §5, repaired per R-469 §5a)")
        print("=" * 74)
        print(f"patterns ({len(patterns)}) -- every one BOUND to the requested name:")
        for p in pattern_src:
            print(f"    {p}")
        print(f"control : {control}")
        print(f"surface : {len(files)} files matching {name_glob!r} under {[str(s) for s in surfaces]}")
        print(f"repos   : {len(repos)} enumerated under {root}")
        print(f"ELAPSED : {elapsed:.1f}s   (measured, not asserted)")
        if name_glob != "*":
            print(f"\n--- ENUMERATED SURFACE: every copy of {name_glob!r}, with owning repo ---")
            for p in sorted(files):
                mark = "HIT " if p.resolve() in hits else "  . "
                try:
                    size = p.stat().st_size
                except OSError:
                    size = -1
                print(f"  {mark}{size:>8}  [{owning_repo(p, repos)}]  {p}")
        print(f"\n--- RESULT: {len(hits)} of {len(files)} files matched ---")

    ctrl = control.resolve()
    if ctrl not in {f.resolve() for f in files}:
        if verbose:
            print("\n" + "!" * 74)
            print("SEARCH INCAPABLE -- exit 3")
            print("The POSITIVE CONTROL IS NOT INSIDE THE ENUMERATED SURFACE.")
            print("The search never looked where the thing is known to be, so its")
            print("absence result says NOTHING. Widen --surface to include the control.")
            print(f"  control: {ctrl}")
            print("!" * 74)
        return 3

    if ctrl not in hits:
        if verbose:
            print("\n" + "!" * 74)
            print("SEARCH INCAPABLE -- exit 2")
            print("The POSITIVE CONTROL was searched and NOT matched. The pattern")
            print("cannot find the thing even where it IS present, so ANY absence")
            print("conclusion drawn from it is INADMISSIBLE.")
            print("Likely cause: a STATIC pattern against a DYNAMIC reach")
            print("  (await import(...) / require(...) / aliased destructuring).")
            print("Use --capability NAME to cover those forms.")
            print(f"  control: {ctrl}")
            print("!" * 74)
        return 2

    if verbose:
        print("\n" + "-" * 74)
        print(f"CONTROL HIT ({hits[ctrl]} match(es)) -- the search is CAPABLE.")
        print("An absence over the remainder of the surface above is ADMISSIBLE,")
        print("and must be cited together with that surface.")
        print("-" * 74)
    return 0


# --- PERMANENT FIXTURES (R-469 §5a: the nonexistent-capability case must ship) --
PRODUCER = pathlib.Path(r"C:\Users\tonio\Projects\trading-forge\tf-deep-scan\scripts\atomize-transcript.ts")
CENSUS_LANE = pathlib.Path(r"C:\Users\tonio\Projects\wt-preflight-blockers-20260729")
NAME = "atomize-transcript.ts"

FIXTURES = [
    # (label, capability, extra patterns, surfaces, required_exit, why)
    ("A NONEXISTENT CAPABILITY must NOT green", "CapabilityThatDoesNotExist_7F3A91", [],
     [PRODUCER.parent.parent, CENSUS_LANE], 2,
     "R-469 §5a: the first version returned EXIT 0 here. A guard that confirms a "
     "capability which cannot exist launders the class it was built to catch."),
    ("B real capability, producer as control", "writeFileSync", [],
     [PRODUCER.parent.parent, CENSUS_LANE], 0,
     "the unmutated CONTROL -- without it, 'always red' is indistinguishable from 'discriminates'."),
    ("C static pattern vs DYNAMIC reach", None, [r"^import.*writeFileSync"],
     [PRODUCER.parent.parent, CENSUS_LANE], 2,
     "AR-461's blind instrument: the producer reaches fs via await import() in a CLI-flag branch."),
    ("D surface excludes the control", "writeFileSync", [],
     [CENSUS_LANE], 3,
     "AR-461's wrong object: searching one tree and concluding about the program."),
]


def self_test() -> int:
    print("=" * 74)
    print("PERMANENT FIXTURES -- each asserts a REQUIRED exit code")
    print("=" * 74)
    failures = []
    for label, cap, extra, surfaces, want, why in FIXTURES:
        src = list(extra) + ([f.format(name=re.escape(cap)) for f in CAPABILITY_FORMS] if cap else [])
        got = run_check(build_patterns(extra, cap), src, PRODUCER, surfaces, NAME,
                        DEFAULT_ROOT, verbose=False)
        ok = got == want
        print(f"\n[{'PASS' if ok else 'FAIL'}] {label}")
        print(f"       required exit {want}, got {got}")
        print(f"       why: {why}")
        if not ok:
            failures.append((label, want, got))
    print("\n" + "=" * 74)
    if failures:
        print(f"SELF-TEST FAILED -- {len(failures)} fixture(s) deviated:")
        for label, want, got in failures:
            print(f"  {label}: wanted {want}, got {got}")
        print("=" * 74)
        return 5
    print(f"SELF-TEST PASSED -- {len(FIXTURES)} fixtures, and they DISCRIMINATE:")
    print("  case B greens (capable) while A, C and D each fail LOUD for a")
    print("  DIFFERENT reason. A suite without its passing control cannot tell")
    print("  'catches breakage' from 'always red'.")
    print("=" * 74)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Prove a search is CAPABLE before believing its absence.")
    ap.add_argument("--pattern", action="append", default=[], help="regex to search (repeatable)")
    ap.add_argument("--capability", help="capability name; expands to name-BOUND static AND dynamic forms")
    ap.add_argument("--control", help="POSITIVE-CONTROL path that MUST hit")
    ap.add_argument("--root", default=str(DEFAULT_ROOT), help="root for repo enumeration")
    ap.add_argument("--name", default="*", help="filename glob to limit the surface")
    ap.add_argument("--surface", action="append", default=[], help="dir/file to search (default: --root)")
    ap.add_argument("--max-files", type=int, default=MAX_FILES, help="surface bound; refuses to run above it")
    ap.add_argument("--self-test", action="store_true", help="run the permanent fixtures")
    a = ap.parse_args()

    if a.self_test:
        return self_test()
    if not a.control:
        print("USAGE ERROR: --control is required (or use --self-test)", file=sys.stderr)
        return 4
    if not a.pattern and not a.capability:
        print("USAGE ERROR: give --pattern and/or --capability", file=sys.stderr)
        return 4

    try:
        patterns = build_patterns(a.pattern, a.capability)
    except re.error as exc:
        print(f"USAGE ERROR: bad regex: {exc}", file=sys.stderr)
        return 4

    src = list(a.pattern) + ([f.format(name=re.escape(a.capability)) for f in CAPABILITY_FORMS]
                             if a.capability else [])
    control = pathlib.Path(a.control)
    if not control.is_file():
        print(f"USAGE ERROR: control is not a readable file: {control}", file=sys.stderr)
        return 4

    root = pathlib.Path(a.root)
    surfaces = [pathlib.Path(s) for s in (a.surface or [str(root)])]
    return run_check(patterns, src, control, surfaces, a.name, root, max_files=a.max_files)


if __name__ == "__main__":
    sys.exit(main())
