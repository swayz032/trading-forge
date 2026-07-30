#!/usr/bin/env python3
"""absence-claim-control -- certify ONE proposition about a literal pattern, or fail.

Minted R-468 §5. Rebuilt R-470 §2. Repaired R-471 §4. **CAPABILITY MODE RETIRED at
R-472 §1.** This file is now deliberately SMALL, and the shrinking is the fix.

    A SEARCH THAT CANNOT SUCCEED REPORTS FAILURE, AND FAILURE READS AS FACT.

★★★★★ WHY CAPABILITY MODE IS GONE (R-472 §1). Four rounds. Each round closed every
  named shape, its own fixture suite went green, and a new unnamed shape appeared:
      round 1  any dynamic import counted for any capability
      round 2  a bare textual occurrence -- including in a COMMENT -- counted
      round 3  comment-provenance ANDed with stripped-code "usage"
      round 4  parameter/catch/destructured shadowing; `typeof` type positions
  A Python regex analyser was being asked to reproduce JS/TS parsing, lexical
  scope, binding resolution, shadowing, type erasure and executable-reference
  analysis. THAT STATE SPACE IS NOT REASONABLY ENUMERABLE WITH FIXTURES, and
  `17/17` proves seventeen registered shapes and nothing else.

★★★★★ AND THE DEFECT THAT DIAGNOSED ALL FOUR ROUNDS AT ONCE (R-472 §0) -- the one
  no additional fixture would have found, because it was the wrong QUANTIFIER:
      the guard's fail-closed behaviour was scoped to its CONTROL, never to its
      CLAIM. A surface of two files -- one UNDECIDABLE, one ENGAGED -- returned
      "absence over the remainder is ADMISSIBLE", exit 0. It licensed an absence
      claim over a file it had explicitly declared it could not read.

    `A FAIL-CLOSED CLASSIFIER IS NOT FAIL-CLOSED WHEN ONLY ITS CONTROL MUST BE
     DECIDABLE. SURFACE-WIDE ABSENCE REQUIRES SURFACE-WIDE DECIDABILITY.`

  That law is now enforced structurally below: EVERY enumerated surface member
  PARTICIPATES IN THE FINAL VERDICT. One unreadable member is enough to deny the
  claim, because an absence over a file you could not read is not an absence.

★★★★★ THE ONE PROPOSITION THIS TOOL MAY NOW CERTIFY:
      "This literal pattern was PRESENT / ABSENT over this explicitly
       enumerated surface."
  IT MAY NEVER BE CITED AS PROOF THAT A CAPABILITY OR A PERSISTENCE PATH EXISTS
  OR DOES NOT EXIST. The question that started this lane -- "does the atomizer
  persist?" -- is answered by POSITIVE producer evidence at `dc8a150:229`
  (`const { writeFileSync } = await import("fs")` inside the `--emit-spec`
  branch), not by any absence tool.

★ The RIGHT instrument for capability questions is purpose-built on the TypeScript
  compiler API with its symbol/type checker. It is NOT AUTHORIZED (R-472 §2) and
  Gate A does not need it. Recording the correct answer without building it is the
  discipline; building it now would be the fifth round wearing a better hat.

EXIT CODES
  0  pattern PRESENT at the control AND every surface member was readable
     -> the present/absent result over that surface is ADMISSIBLE
  2  the positive control does NOT contain the pattern -> the search is not
     demonstrated capable -> INADMISSIBLE
  3  the positive control is not inside the enumerated surface
  4  usage error, or the surface exceeded the runtime bound (refused BEFORE
     enumerating, so there is no silent-truncation-then-admissible path)
  5  --self-test: a fixture missed its PRE-REGISTERED exit code
  8  VERDICT UNAVAILABLE (fail closed): capability mode was requested (RETIRED),
     or some enumerated surface member could not be read.
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
PRUNE_DIRS = {
    "node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build",
    ".next", ".cache", ".pytest_cache", ".mypy_cache", "coverage", "target",
    ".turbo", ".parcel-cache",
}
# DOCUMENTED RUNTIME BOUND (R-470 §2.7). MEASURED: --self-test well under 1s; a
# --name-limited query over 47 repos / 50 files ~2.5s. Refused BEFORE reading, so
# a breach can never become a truncated-but-admissible answer.
MAX_FILES = 20_000

PRESENT, ABSENT, UNREADABLE = "PRESENT", "ABSENT", "UNREADABLE"


def enumerate_repos(root: pathlib.Path) -> dict[pathlib.Path, str]:
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


def scan_file(p: pathlib.Path, pats: list[re.Pattern[str]]) -> tuple[str, int, str]:
    """STRICT decode on purpose: a file we cannot decode is a file we cannot
    search, and an absence over it would be unsupported. errors='replace' would
    have manufactured a searchable text and hidden that."""
    try:
        text = p.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return UNREADABLE, 0, f"{type(exc).__name__}"
    n = sum(len(x.findall(text)) for x in pats)
    return (PRESENT if n else ABSENT), n, ""


def run_text_check(patterns: list[str], control: pathlib.Path, surfaces: list[pathlib.Path],
                   name_glob: str, root: pathlib.Path, *, verbose: bool = True,
                   max_files: int = MAX_FILES) -> int:
    t0 = time.monotonic()
    pats = [re.compile(p, re.MULTILINE) for p in patterns]
    files = collect_files(surfaces, name_glob)
    if len(files) > max_files:
        if verbose:
            print("\n" + "!" * 74)
            print(f"REFUSING TO RUN -- exit 4: surface is {len(files)} files (bound {max_files}).")
            print("Refused BEFORE reading anything, so this can never become a")
            print("truncated-but-admissible answer. Narrow --name/--surface.")
            print("!" * 74)
        return 4

    repos = enumerate_repos(root)
    results = {p.resolve(): scan_file(p, pats) for p in files}
    elapsed = time.monotonic() - t0

    n_present = sum(1 for v in results.values() if v[0] == PRESENT)
    unreadable = [p for p, v in results.items() if v[0] == UNREADABLE]

    if verbose:
        print("=" * 74)
        print("ABSENCE-CLAIM CONTROL -- TEXT MODE (capability mode RETIRED, R-472 §1)")
        print("=" * 74)
        print("PROPOSITION CERTIFIED, AND IT IS THE ONLY ONE:")
        print('  "this literal pattern was PRESENT / ABSENT over this enumerated surface"')
        print("  NEVER proof that a capability or persistence path exists or does not.")
        for p in patterns:
            print(f"pattern : {p}")
        print(f"control : {control}")
        print(f"surface : {len(files)} files matching {name_glob!r}")
        print(f"repos   : {len(repos)} enumerated under {root}")
        print(f"ELAPSED : {elapsed:.1f}s   (measured, not asserted)")
        if name_glob != "*" and len(files) <= 80:
            print(f"\n--- ENUMERATED SURFACE (every member participates in the verdict) ---")
            for p in sorted(files):
                st, n, note = results[p.resolve()]
                tag = {PRESENT: f"PRESENT({n})", ABSENT: "   .    ", UNREADABLE: "UNREADABLE"}[st]
                print(f"  {tag:>12}  [{owning_repo(p, repos)}]  {p}"
                      + (f"   <-- {note}" if note else ""))
        print(f"\n--- RESULT: {n_present} PRESENT, {len(unreadable)} UNREADABLE, of {len(files)} ---")

    ctrl = control.resolve()
    if ctrl not in results:
        if verbose:
            print("\n" + "!" * 74)
            print("SEARCH INCAPABLE -- exit 3: the POSITIVE CONTROL IS NOT IN THE SURFACE.")
            print(f"  control: {ctrl}")
            print("!" * 74)
        return 3

    # §0's LAW, ENFORCED ON THE CLAIM AND NOT ONLY ON THE CONTROL.
    if unreadable:
        if verbose:
            print("\n" + "!" * 74)
            print(f"VERDICT UNAVAILABLE -- exit 8 (FAIL CLOSED): {len(unreadable)} enumerated")
            print("surface member(s) could not be read. SURFACE-WIDE ABSENCE REQUIRES")
            print("SURFACE-WIDE DECIDABILITY -- an absence over a file that was never")
            print("read is not an absence. This is the defect that diagnosed four rounds.")
            for p in unreadable[:5]:
                print(f"  unreadable: {p}")
            print("!" * 74)
        return 8

    if results[ctrl][0] != PRESENT:
        if verbose:
            print("\n" + "!" * 74)
            print("SEARCH INCAPABLE -- exit 2: the POSITIVE CONTROL does NOT contain the")
            print("pattern, so the search is not demonstrated capable of finding it even")
            print("where it is supposed to be. ANY absence conclusion is INADMISSIBLE.")
            print(f"  control: {ctrl}")
            print("!" * 74)
        return 2

    if verbose:
        print("\n" + "-" * 74)
        print(f"CONTROL PRESENT ({results[ctrl][1]} match(es)) and ALL {len(files)} surface")
        print("members were readable. The PRESENT/ABSENT result over the surface above")
        print("is ADMISSIBLE, and must be cited together with that surface.")
        print("★ It is NOT evidence about any capability or persistence path.")
        print("-" * 74)
    return 0


# ----------------------------------------------------- PERMANENT FIXTURES (R-472)
FIX = pathlib.Path(__file__).resolve().parent / "absence-fixtures"
SELF_SRC = pathlib.Path(__file__).resolve()

# codes PRE-REGISTERED in AR-470 before any run
FIXTURES = [
    ("CAPABILITY MODE RETIRED (--module/--symbol)", "retired", 8,
     "R-472 §1: the CLI survives only so an OLD command line cannot silently mean "
     "something NEW. It must refuse, not answer."),
    ("text: positive control CONTAINS the pattern", "text_pos", 0,
     "the passing control -- without it, 'always red' looks like 'discriminates'"),
    ("text: positive control LACKS the pattern", "text_neg", 2,
     "a control that cannot find the thing cannot license an absence"),
    ("text: an UNREADABLE surface member denies the claim", "text_unreadable", 8,
     "R-472 §0, the law that diagnosed four rounds: surface-wide absence requires "
     "surface-wide decidability, even when the CONTROL is fine"),
    ("text: control outside the surface", "text_offsurface", 3,
     "AR-461's wrong object"),
    ("text: surface exceeds the runtime bound", "text_bound", 4,
     "refused BEFORE reading, so a breach cannot become a truncated admissible answer"),
]


def self_test() -> int:
    print("=" * 74)
    print("PERMANENT FIXTURES -- exit codes PRE-REGISTERED in AR-470 before any run")
    print("=" * 74)
    failures = []
    for label, kind, want, why in FIXTURES:
        if kind == "retired":
            got = run_capability_retired(verbose=False)
        elif kind == "text_pos":
            got = run_text_check([r"writeFileSync"], FIX / "genuine_static.ts", [FIX],
                                 "genuine_static.ts", DEFAULT_ROOT, verbose=False)
        elif kind == "text_neg":
            got = run_text_check([r"ThisTokenAppearsNowhere_5B2C77"], FIX / "genuine_static.ts",
                                 [FIX], "genuine_static.ts", DEFAULT_ROOT, verbose=False)
        elif kind == "text_unreadable":
            got = run_text_check([r"writeFileSync"], FIX / "genuine_static.ts", [FIX],
                                 "*.ts", DEFAULT_ROOT, verbose=False)
        elif kind == "text_offsurface":
            got = run_text_check([r"writeFileSync"], FIX / "genuine_static.ts",
                                 [FIX / "nonexistent"], "*.ts", DEFAULT_ROOT, verbose=False)
        else:  # text_bound
            got = run_text_check([r"writeFileSync"], FIX / "genuine_static.ts", [FIX],
                                 "*.ts", DEFAULT_ROOT, verbose=False, max_files=1)
        ok = got == want
        print(f"\n[{'PASS' if ok else 'FAIL'}] {label}")
        print(f"       PRE-REGISTERED {want}, got {got}")
        print(f"       why: {why}")
        if not ok:
            failures.append((label, want, got))
    print("\n" + "=" * 74)
    if failures:
        print(f"SELF-TEST FAILED -- {len(failures)} fixture(s) missed their pre-registered code:")
        for label, want, got in failures:
            print(f"  {label}: pre-registered {want}, got {got}")
        print("=" * 74)
        return 5
    print(f"SELF-TEST PASSED -- {len(FIXTURES)} fixtures at their PRE-REGISTERED codes,")
    print("discriminating across FIVE outcomes: 0 admissible · 2 control-cannot-find ·")
    print("3 control-off-surface · 4 bound-refused · 8 fail-closed (retired mode, and")
    print("an unreadable surface member). The suite is small because the TOOL is small;")
    print("the retirement is the repair, not the fixtures.")
    print("=" * 74)
    return 0


def run_capability_retired(verbose: bool = True) -> int:
    if verbose:
        print("\n" + "!" * 74)
        print("VERDICT UNAVAILABLE -- exit 8: CAPABILITY MODE IS RETIRED (R-472 §1).")
        print("This tool no longer issues capability or persistence verdicts. Four rounds")
        print("of regex-based binding analysis each closed every named shape, went green,")
        print("and then failed on a new unnamed one; and its fail-closed behaviour was")
        print("scoped to the control rather than to the claim.")
        print("Use POSITIVE evidence for capability questions, or a purpose-built")
        print("instrument on the TypeScript compiler API (correct tool, NOT authorized).")
        print("--pattern still certifies literal text presence/absence over a surface.")
        print("!" * 74)
    return 8


def main() -> int:
    ap = argparse.ArgumentParser(description="Certify ONE proposition about a literal pattern, or fail.")
    ap.add_argument("--pattern", action="append", default=[])
    ap.add_argument("--module", help="RETIRED (R-472 §1): always returns exit 8")
    ap.add_argument("--symbol", help="RETIRED (R-472 §1): always returns exit 8")
    ap.add_argument("--control")
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    ap.add_argument("--name", default="*")
    ap.add_argument("--surface", action="append", default=[])
    ap.add_argument("--max-files", type=int, default=MAX_FILES)
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()

    if a.self_test:
        return self_test()
    # RETIRED MODE IS CHECKED FIRST, before any usage validation, so that an old
    # command line can never be answered as though it meant something new.
    if a.module or a.symbol:
        return run_capability_retired()
    if not a.control:
        print("USAGE ERROR: --control is required (or --self-test)", file=sys.stderr)
        return 4
    if not a.pattern:
        print("USAGE ERROR: --pattern is required (capability mode is retired)", file=sys.stderr)
        return 4
    control = pathlib.Path(a.control)
    if not control.is_file():
        print(f"USAGE ERROR: control is not a readable file: {control}", file=sys.stderr)
        return 4
    root = pathlib.Path(a.root)
    surfaces = [pathlib.Path(s) for s in (a.surface or [str(root)])]
    return run_text_check(a.pattern, control, surfaces, a.name, root, max_files=a.max_files)


if __name__ == "__main__":
    sys.exit(main())
