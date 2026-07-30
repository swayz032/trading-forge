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

★★★★★ AND THE SAME HOLE ONE BOUNDARY FURTHER OUT -- AN *EXCLUSION* (R-475 §1).
  The R-474 repair made the READ and the ENUMERATION fail closed, and shipped a
  built-in directory prune IN THE SAME COMMIT, annotated:
      `# DECLARED exclusion, printed with every run -- not a silent drop`
  IT PRINTED NOTHING. The name occurred exactly twice in the file: the
  declaration and the skip. So a caller who named a surface received a CERTIFIED
  verdict over a NARROWED one, with no disclosure that anything had been removed:
      ground truth   2 files under the named surface contained the token
      the tool       `1 PRESENT, 0 UNREADABLE, of 1` · ADMISSIBLE · exit 0,
                     the `node_modules` descendant appearing NOWHERE --
                     not excluded, not unreadable, not listed
  `A CAPTION IS A CLAIM`, and that one was the annotation on the very statement
  that falsified it.

    `AN EXCLUSION IS PART OF THE MEASUREMENT SURFACE. IF IT IS NEITHER
     ADJUDICATED NOR EMITTED, IT IS A SILENT OMISSION WEARING THE NAME
     "PRUNING".`
    `EVERY BOUNDARY THE CLAIM CROSSES MUST FAIL CLOSED, NOT ONLY THE LAST ONE
     YOU FIXED.`

  R-475 §3's PROPERTY, ENFORCED IN `collect_files` BELOW:
      NO PATH MAY LEAVE THE SURFACE WITHOUT APPEARING IN THE VERDICT.
  A directory may now leave in exactly TWO ways, and silence is not one of them:
      DECLARED    the caller asked, via `--exclude-dir` / `--exclude-standard`.
                  Every excluded path is EMITTED, and the certified proposition
                  is rewritten to "... MINUS these paths". ADMISSIBLE.
      UNDECLARED  a NAMED surface problem -> exit 8. INADMISSIBLE.
  THERE IS NO BUILT-IN AUTOMATIC PRUNE ANY MORE. That is the repair. The
  ergonomic route survives as an EXPLICIT CALLER ACT -- which is what keeps a
  realistic multi-repo query usable without letting it certify a surface it
  quietly shrank.

EXIT CODES
  0  pattern PRESENT at the control AND every surface member was readable
     -> the present/absent result over that surface, MINUS any exclusions the
        caller DECLARED and this tool EMITTED, is ADMISSIBLE
  2  the positive control does NOT contain the pattern -> the search is not
     demonstrated capable -> INADMISSIBLE
  3  the positive control is not inside the enumerated surface
  4  usage error, or the surface exceeded the runtime bound (refused BEFORE
     enumerating, so there is no silent-truncation-then-admissible path)
  5  --self-test: a fixture missed its PRE-REGISTERED exit code
  8  VERDICT UNAVAILABLE (fail closed): capability mode was requested (RETIRED),
     or some enumerated surface member could not be read, or a directory left
     the surface WITHOUT the caller having declared it.
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
# ★★★★★ R-474/R-475 called this `PRUNE_DIRS`, and under that name it was applied
# AUTOMATICALLY AND SILENTLY -- which is the defect R-475 §1 convicted. It is
# RENAMED because the old name asserted a behaviour that must no longer exist:
# nothing here is excluded unless the CALLER asks for it via `--exclude-standard`
# (this whole set) or `--exclude-dir NAME` (one name). `A CAPTION IS A CLAIM` and
# an identifier is a caption.
STANDARD_EXCLUDE_DIRS = {
    "node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build",
    ".next", ".cache", ".pytest_cache", ".mypy_cache", "coverage", "target",
    ".turbo", ".parcel-cache",
}
# DOCUMENTED RUNTIME BOUND (R-470 §2.7). MEASURED: --self-test well under 1s; a
# --name-limited query over 47 repos / 50 files ~2.5s. Refused BEFORE reading, so
# a breach can never become a truncated-but-admissible answer.
MAX_FILES = 20_000

PRESENT, ABSENT, UNREADABLE = "PRESENT", "ABSENT", "UNREADABLE"

# F-2 (graded NOT-SOUND): a hardcoded non-ASCII glyph in a printed line raised
# UnicodeEncodeError on the exit-0 path under cp1252 -- clean on PowerShell, fatal
# on cmd.exe, CI and scheduled runs, i.e. exactly the unattended context this
# campaign exists for. ★ A CRASH IS NOT A FAIL-CLOSED DENIAL: it destroys the exit
# code that carries the verdict, and while reproducing F-1 it masked run B's real
# exit 0 behind an exit 1, which would have read as "the guard denied the claim".
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
except Exception:  # pragma: no cover - older interpreters / redirected non-tty
    pass


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


def collect_files(surfaces: list[pathlib.Path], name_glob: str,
                  excluded_names: set[str],
                  ) -> tuple[list[pathlib.Path], list[tuple[pathlib.Path, str]],
                             list[pathlib.Path]]:
    """★★★★★ THE INVARIANT (R-474 §5 Item 1, EXTENDED BY R-475 §3), ordered as a
    PROPERTY and not as a list of shapes:

        EVERY MEMBER OF THE INTENDED SURFACE IS EITHER READ, OR REPORTED
        `UNREADABLE`, OR REMOVED BY AN EXCLUSION THE CALLER DECLARED AND THIS
        FUNCTION EMITTED. THERE IS NO FOURTH OUTCOME, AND SILENCE IS NOT ONE OF
        THE THREE.

    F-1, graded NOT-SOUND: this function walked with a bare `os.walk()`, whose
    default `onerror=None` SILENTLY SWALLOWS `PermissionError`, and a nonexistent
    path yields zero entries with no exception at all. So a dropped surface member
    never became `UNREADABLE` -- it never entered enumeration, and the fail-closed
    `try/except` downstream in `scan_file` only fires on files we actually OPEN.
    Typo one `--surface` name and a file containing a REAL occurrence vanished from
    the output while the tool printed "0 UNREADABLE", "every member participates in
    the verdict", ADMISSIBLE, exit 0.

        `A SURFACE IS NOT FAIL-CLOSED UNTIL ITS ENUMERATION IS.`
        `EVERY BOUNDARY THE CLAIM CROSSES MUST FAIL CLOSED, NOT ONLY THE LAST
         ONE YOU FIXED.`

    ★★★★★ AND THE EXCLUSION BOUNDARY (R-475 §1), which is where the R-474 repair
    itself leaked: a built-in prune removed directories with no emit anywhere in
    the file, under a comment claiming it was "printed with every run". A real
    occurrence under `node_modules` vanished and the tool certified `1 of 1`,
    ADMISSIBLE, exit 0, against a ground truth of 2.

        `AN EXCLUSION IS PART OF THE MEASUREMENT SURFACE.`

    So `excluded_names` is now CALLER-SUPPLIED and may be empty. A directory whose
    name is in it is EXCLUDED (returned, emitted, and written into the certified
    proposition). A directory that would otherwise be skipped for ANY reason the
    caller did NOT ask for becomes a PROBLEM and denies the claim.

    Returns (files, problems, excluded). ANY problem DENIES the claim; `excluded`
    NARROWS the certified proposition -- both are consumed by run_text_check.
    """
    out: list[pathlib.Path] = []
    problems: list[tuple[pathlib.Path, str]] = []
    excluded: list[pathlib.Path] = []

    for s in surfaces:
        if not s.exists():
            problems.append((s, "SURFACE DOES NOT EXIST -- a --surface argument that "
                                "resolves to nothing contributed zero files silently"))
            continue
        if s.is_file():
            out.append(s)
            continue
        if not s.is_dir():
            problems.append((s, "SURFACE IS NEITHER A FILE NOR A DIRECTORY"))
            continue

        def onerror(exc: OSError, _s: pathlib.Path = s) -> None:
            # os.walk's default is to DISCARD this. Capturing it is the whole fix.
            where = getattr(exc, "filename", None) or _s
            problems.append((pathlib.Path(where),
                             f"TRAVERSAL FAILED: {type(exc).__name__} -- directory could "
                             f"not be listed, so its members were never enumerated"))

        for dirpath, dirnames, filenames in os.walk(s, onerror=onerror):
            keep: list[str] = []
            for d in dirnames:
                dp = pathlib.Path(dirpath) / d
                if d in excluded_names:
                    # ★ THE ONLY ADMISSIBLE WAY OUT OF THE SURFACE: the caller
                    # asked for this name. Recorded so the verdict can EMIT the
                    # exact path and narrow the certified proposition to match.
                    # This is the line whose predecessor claimed to print and did
                    # not; the emit now lives in run_text_check and is fixtured.
                    excluded.append(dp)
                    continue
                if d in STANDARD_EXCLUDE_DIRS:
                    # UNDECLARED. The caller never asked, so this may not leave
                    # quietly -- it becomes a NAMED problem and denies the claim.
                    problems.append((dp,
                        "DIRECTORY IS IN THE STANDARD EXCLUDE LIST BUT THE CALLER NEVER "
                        "DECLARED IT -- its contents were never enumerated, so an absence "
                        "over this surface would be unsupported. Re-run with "
                        f"--exclude-dir {d} (or --exclude-standard) to make the exclusion "
                        "EXPLICIT; the verdict will then certify the surface MINUS this path."))
                    continue
                if dp.is_symlink():
                    # os.walk(followlinks=False) would skip this WITHOUT a word.
                    # "Not traversed for ANY reason" must deny the claim.
                    problems.append((dp, "DIRECTORY SYMLINK NOT TRAVERSED "
                                         "(os.walk followlinks=False) -- contents never enumerated"))
                    continue
                keep.append(d)
            dirnames[:] = keep
            for fn in filenames:
                if name_glob == "*" or fnmatch.fnmatch(fn, name_glob):
                    out.append(pathlib.Path(dirpath) / fn)
    return out, problems, excluded


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
                   max_files: int = MAX_FILES,
                   excluded_names: set[str] | None = None) -> int:
    # DEFAULT IS THE EMPTY SET, DELIBERATELY: an exclusion must be ASKED FOR.
    # A default-populated set here would reinstate exactly the silent narrowing
    # R-475 §1 convicted, one layer down from where it was found.
    excluded_names = set(excluded_names or ())
    t0 = time.monotonic()
    try:
        pats = [re.compile(p, re.MULTILINE) for p in patterns]
    except re.error as exc:
        # F-3a: this raised an unhandled re.error -> traceback, exit 1. A usage
        # error must return the DOCUMENTED usage code, not a stack trace.
        print(f"USAGE ERROR: invalid --pattern regex: {exc}", file=sys.stderr)
        return 4
    files, surface_problems, excluded_paths = collect_files(surfaces, name_glob, excluded_names)
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
    # Files we OPENED and could not decode, PLUS members that never reached
    # enumeration at all. Both deny the claim; only the first kind existed before.
    unreadable = [(p, results[p][2] or "decode failed") for p, v in results.items()
                  if v[0] == UNREADABLE] + surface_problems

    if verbose:
        print("=" * 74)
        print("ABSENCE-CLAIM CONTROL -- TEXT MODE (capability mode RETIRED, R-472 §1)")
        print("=" * 74)
        print("PROPOSITION CERTIFIED, AND IT IS THE ONLY ONE:")
        if excluded_paths:
            # R-475 §3: the REMOVAL IS PART OF THE PROPOSITION, not a footnote to it.
            print('  "this literal pattern was PRESENT / ABSENT over this enumerated')
            print(f'   surface MINUS the {len(excluded_paths)} explicitly excluded director'
                  f'{"y" if len(excluded_paths) == 1 else "ies"} listed below"')
        else:
            print('  "this literal pattern was PRESENT / ABSENT over this enumerated surface"')
        print("  NEVER proof that a capability or persistence path exists or does not.")
        for p in patterns:
            print(f"pattern : {p}")
        print(f"control : {control}")
        print(f"surface : {len(files)} files matching {name_glob!r}")
        print(f"repos   : {len(repos)} enumerated under {root}")
        print(f"ELAPSED : {elapsed:.1f}s   (measured, not asserted)")
        if excluded_paths:
            # ★★★★★ THE EMIT THE PREDECESSOR'S COMMENT PROMISED AND NEVER PERFORMED.
            # EVERY path, in full, NEVER truncated: a truncated list of omissions is
            # the same silent-omission defect wearing a "... and N more" hat.
            print(f"\n--- DECLARED EXCLUSIONS: {len(excluded_paths)} director"
                  f"{'y' if len(excluded_paths) == 1 else 'ies'} REMOVED FROM THE SURFACE ---")
            print(f"    caller declared: {' '.join('--exclude-dir ' + n for n in sorted(excluded_names))}")
            print("    every path below is OUTSIDE the certified proposition above.")
            for dp in sorted(excluded_paths):
                print(f"  EXCLUDED    {dp}")
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
            print(f"VERDICT UNAVAILABLE -- exit 8 (FAIL CLOSED): {len(unreadable)} intended")
            print("surface member(s) were NOT READ. Either the file could not be decoded,")
            print("or it never entered enumeration at all -- a --surface that resolves to")
            print("nothing, a directory that could not be listed, an untraversed symlink,")
            print("or a directory that left the surface WITHOUT THE CALLER DECLARING IT.")
            print("SURFACE-WIDE ABSENCE REQUIRES SURFACE-WIDE DECIDABILITY, and a member")
            print("that was never enumerated is the same hole as one that was never read.")
            # ★★★ EVERY denial, never a head-slice. This read `unreadable[:8]` while the
            # line above stated a count of 38 on a real query -- so the caller was told
            # HOW MANY members were lost and shown only eight of their IDENTITIES. The
            # count was disclosed and the paths were not, which is R-475 §1's defect
            # applied to the DENIAL list instead of the EXCLUSION list. Found in my own
            # change (AR-477), one boundary from the one I was sent to fix, and fixed in
            # the same wave rather than carried forward.
            for pp, why in unreadable:
                print(f"  DENIED BY: {pp}")
                print(f"            {why}")
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
        if excluded_paths:
            print(f"★ AND IT IS NARROWED: {len(excluded_paths)} declared exclusion(s) are listed")
            print("  above and are NOT covered. Citing this verdict without them overstates it.")
        print("★ It is NOT evidence about any capability or persistence path.")
        print("-" * 74)
    return 0


# ----------------------------------------------------- PERMANENT FIXTURES (R-472)
FIX = pathlib.Path(__file__).resolve().parent / "absence-fixtures"
SELF_SRC = pathlib.Path(__file__).resolve()
# The F-4 tree (R-475 §3(b)): a control in a READABLE SIBLING, and a REAL matching
# occurrence under a nested directory whose name is in STANDARD_EXCLUDE_DIRS.
PRUNED_CASE = FIX / "pruned_case"
PRUNED_DIR = PRUNED_CASE / "node_modules"

# ★★★★★ R-475 §2-1: THE BANNER USED TO CLAIM EVERY EXPECTATION WAS "PRE-REGISTERED
# IN AR-470". THAT WAS FALSE. The four F-1/F-3a fixtures DID NOT EXIST at AR-470 --
# their codes were pre-registered in R-474/AR-474, and the F-4 exclusion set in
# R-475/AR-476. A wrong source attribution on a pre-registration is the same species
# as a hand-copied expected value: it makes the provenance unfalsifiable.
# PROVENANCE IS THE EVIDENCE, NOT DECORATION -- so it is now the 5th field of every
# fixture and is PRINTED BESIDE EACH RESULT rather than asserted once in a header.
#
# Fixtures whose surface is the WHOLE fixture root now DECLARE the standard
# exclusions, because that root legitimately contains `pruned_case/node_modules`
# (the F-4 tree). ★ That is not a dodge: it is the caller-declared route this repair
# exists to provide, their pre-registered codes are unchanged, and `text_unreadable`
# is strictly IMPROVED by it -- undeclared it would exit 8 for TWO reasons at once,
# and a fixture that passes for an extra reason has stopped discriminating.
FIXTURES = [
    ("CAPABILITY MODE RETIRED (--module/--symbol)", "retired", 8,
     "R-472 §1: the CLI survives only so an OLD command line cannot silently mean "
     "something NEW. It must refuse, not answer.", "AR-470"),
    ("text: positive control CONTAINS the pattern", "text_pos", 0,
     "the passing control -- without it, 'always red' looks like 'discriminates'", "AR-470"),
    ("text: positive control LACKS the pattern", "text_neg", 2,
     "a control that cannot find the thing cannot license an absence", "AR-470"),
    ("text: an UNREADABLE surface member denies the claim", "text_unreadable", 8,
     "R-472 §0, the law that diagnosed four rounds: surface-wide absence requires "
     "surface-wide decidability, even when the CONTROL is fine", "AR-470"),
    ("text: control outside the surface", "text_offsurface", 3,
     "AR-461's wrong object", "AR-470"),
    ("text: surface exceeds the runtime bound", "text_bound", 4,
     "refused BEFORE reading, so a breach cannot become a truncated admissible answer",
     "AR-470"),
    # ---- F-1 (graded NOT-SOUND). The PAIR is the fixture; neither half alone is.
    ("F-1 A: honest two-surface run, real token in the 2nd surface", "f1_honest", 0,
     "THE CONTROL HALF. A guard that refuses everything is not a repair, so this must "
     "STAY green -- and it is what makes run B diagnostic rather than anecdotal",
     "R-474 §5 Item 1 / AR-474"),
    ("F-1 B: one --surface name typo'd, four characters apart", "f1_typo", 8,
     "the graded defect: the typo'd surface silently contributed zero files, a file "
     "holding a REAL occurrence vanished from the output, and the tool reported "
     "0 UNREADABLE / every-member-participates / ADMISSIBLE / exit 0",
     "R-474 §5 Item 1 / AR-474"),
    ("F-1 C: a --surface that does not exist at all", "f1_missing", 8,
     "the same hole reached by the simplest possible route", "R-474 §5 Item 1 / AR-474"),
    ("F-3a: invalid --pattern regex returns the usage code", "bad_regex", 4,
     "it raised an unhandled re.error -> traceback exit 1; a usage error owes the "
     "DOCUMENTED code, and exit 1 is indistinguishable from a crash mid-verdict",
     "R-474 §5 Item 1 / AR-474"),
    # ---- F-4 (R-475 §1). The TRIPLE is the fixture. The undeclared half proves the
    #      denial; the declared half proves the tool is still USABLE; the honest half
    #      proves the denial is not just "always red". Removing any one makes the
    #      other two uninterpretable.
    ("F-4 A: UNDECLARED exclusion hiding a REAL occurrence", "f4_undeclared", 8,
     "THE GRADED DEFECT ITSELF: a node_modules descendant holding a real match was "
     "pruned by a built-in list, and the tool printed '1 PRESENT, 0 UNREADABLE, of 1' "
     "· ADMISSIBLE · exit 0 against a ground truth of 2, under a header reading "
     "'every member participates in the verdict'. It must now DENY and NAME the path.",
     "R-475 §3(b) / AR-476"),
    ("F-4 B: the SAME tree with the exclusion DECLARED", "f4_declared", 0,
     "THE USABILITY HALF, and it is why a bare fail-closed rule was NOT adopted: the "
     "declared route must still return a verdict, with the exact excluded path emitted "
     "and the proposition narrowed. Without this, the repair retires the tool.",
     "R-475 §3(b) / AR-476"),
    ("F-4 C: honest tree with NO prunable member, nothing declared", "f4_honest", 0,
     "THE DISCRIMINATION HALF: proves F-4 A's exit 8 is caused by the EXCLUSION and "
     "not by the new code refusing everything it sees.",
     "R-475 §3(b) / AR-476"),
]


def self_test() -> int:
    print("=" * 74)
    print("PERMANENT FIXTURES -- every expectation PRE-REGISTERED BEFORE ANY RUN.")
    print("PROVENANCE IS PER FIXTURE AND PRINTED BELOW: the six original cases come")
    print("from AR-470, the four F-1/F-3a cases from R-474/AR-474, and the three F-4")
    print("exclusion cases from R-475/AR-476. ★ The old banner attributed ALL of them")
    print("to AR-470, which was false for four of ten -- R-475 §2-1.")
    print("=" * 74)
    # ★★★★★ PRECONDITION, AND IT EXISTS BECAUSE OF A NEAR-MISS WORTH RECORDING: the
    # F-4 tree's matching file lives under a directory literally named `node_modules`,
    # and `.gitignore:1` is `node_modules/`. A plain `git add` SKIPS IT SILENTLY, so
    # the "permanent" fixture would not survive a fresh checkout. It is force-added
    # (AR-477), and this check makes a missing tree say WHY instead of surfacing as a
    # bare "pre-registered 8, got 0" that a future session would have to re-derive.
    if not (PRUNED_DIR / "buried.ts").is_file():
        print("=" * 74)
        print("SELF-TEST CANNOT RUN -- exit 5: the F-4 fixture tree is MISSING.")
        print(f"  expected: {PRUNED_DIR / 'buried.ts'}")
        print("  This file sits under a directory named `node_modules`, which .gitignore")
        print("  excludes; it must be committed with `git add -f`. Its ABSENCE would make")
        print("  F-4 A return 0 instead of 8 -- i.e. the fixture tree going missing looks")
        print("  like the defect being absent, which is the one confusion a fixture for")
        print("  THIS defect class must never produce.")
        print("=" * 74)
        return 5
    failures = []
    for label, kind, want, why, source in FIXTURES:
        extra = ""
        if kind == "retired":
            got = run_capability_retired(verbose=False)
        elif kind == "text_pos":
            got = run_text_check([r"writeFileSync"], FIX / "genuine_static.ts", [FIX],
                                 "genuine_static.ts", DEFAULT_ROOT, verbose=False,
                                 excluded_names=STANDARD_EXCLUDE_DIRS)
        elif kind == "text_neg":
            got = run_text_check([r"ThisTokenAppearsNowhere_5B2C77"], FIX / "genuine_static.ts",
                                 [FIX], "genuine_static.ts", DEFAULT_ROOT, verbose=False,
                                 excluded_names=STANDARD_EXCLUDE_DIRS)
        elif kind == "text_unreadable":
            got = run_text_check([r"writeFileSync"], FIX / "genuine_static.ts", [FIX],
                                 "*.ts", DEFAULT_ROOT, verbose=False,
                                 excluded_names=STANDARD_EXCLUDE_DIRS)
        elif kind == "f4_undeclared":
            got = run_text_check([r"writeFileSync"], PRUNED_CASE / "control.ts", [PRUNED_CASE],
                                 "*.ts", DEFAULT_ROOT, verbose=False)
            # ★★★★★ AND THE CODE ALONE IS NOT THE REQUIREMENT. R-475 §3 demands the
            # EXACT EXCLUDED PATH in the verdict, so the fixture asserts the NAMING
            # too -- otherwise it would still pass if the path were dropped from the
            # message, which is the exact class of defect being repaired.
            _f, probs, _e = collect_files([PRUNED_CASE], "*.ts", set())
            if not any(p == PRUNED_DIR for p, _w in probs):
                got, extra = -1, f"PATH NOT NAMED: expected {PRUNED_DIR} among the problems"
            else:
                extra = f"names the exact path: {PRUNED_DIR}"
        elif kind == "f4_declared":
            got = run_text_check([r"writeFileSync"], PRUNED_CASE / "control.ts", [PRUNED_CASE],
                                 "*.ts", DEFAULT_ROOT, verbose=False,
                                 excluded_names={"node_modules"})
            _f, _p, exc = collect_files([PRUNED_CASE], "*.ts", {"node_modules"})
            if PRUNED_DIR not in exc:
                got, extra = -1, f"EXCLUDED PATH NOT EMITTED: expected {PRUNED_DIR}"
            else:
                extra = f"emits the exact excluded path: {PRUNED_DIR}"
        elif kind == "f4_honest":
            got = run_text_check([r"writeFileSync"], FIX / "visible" / "control.ts",
                                 [FIX / "visible"], "*.ts", DEFAULT_ROOT, verbose=False)
        elif kind == "text_offsurface":
            got = run_text_check([r"writeFileSync"], FIX / "genuine_static.ts",
                                 [FIX / "nonexistent"], "*.ts", DEFAULT_ROOT, verbose=False)
        elif kind == "text_bound":
            got = run_text_check([r"writeFileSync"], FIX / "genuine_static.ts", [FIX],
                                 "*.ts", DEFAULT_ROOT, verbose=False, max_files=1)
        elif kind == "f1_honest":
            got = run_text_check([r"writeFileSync"], FIX / "visible" / "control.ts",
                                 [FIX / "visible", FIX / "hidden"], "*.ts",
                                 DEFAULT_ROOT, verbose=False)
        elif kind == "f1_typo":
            # `hiddne` -- four transposed characters, the whole defect
            got = run_text_check([r"writeFileSync"], FIX / "visible" / "control.ts",
                                 [FIX / "visible", FIX / "hiddne"], "*.ts",
                                 DEFAULT_ROOT, verbose=False)
        elif kind == "f1_missing":
            got = run_text_check([r"writeFileSync"], FIX / "visible" / "control.ts",
                                 [FIX / "visible", FIX / "no_such_dir_9C41"], "*.ts",
                                 DEFAULT_ROOT, verbose=False)
        else:  # bad_regex
            got = run_text_check([r"writeFileSync("], FIX / "visible" / "control.ts",
                                 [FIX / "visible"], "*.ts", DEFAULT_ROOT, verbose=False)
        ok = got == want
        print(f"\n[{'PASS' if ok else 'FAIL'}] {label}")
        print(f"       PRE-REGISTERED {want}, got {got}")
        print(f"       pre-registered in: {source}")
        if extra:
            print(f"       path assertion: {extra}")
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
    print("3 control-off-surface · 4 bound-refused · 8 fail-closed (retired mode, an")
    print("unreadable surface member, and an UNDECLARED exclusion).")
    print("")
    print("★ THE HONEST COUNT OF CLOSURE PATHS, because 'three independent routes' was")
    print("  an overclaim once already (R-475 §2-2): the surface-does-not-exist branch")
    print("  serves BOTH the typo and the missing-surface fixtures, so those are TWO")
    print("  ROUTES THROUGH ONE BRANCH. The distinct enforcement mechanisms are:")
    print("     1  --surface resolves to nothing / is not a directory")
    print("     2  os.walk(onerror=...) traversal failure  [permission: EXECUTED, AR-475]")
    print("     3  UNDECLARED standard-exclude directory    [R-475 §1: EXECUTED, AR-476]")
    print("     4  untraversed directory symlink            [★ NOT EXECUTED, UNPROVEN]")
    print("     5  strict-UTF-8 decode failure in scan_file")
    print("  plus TWO positive controls (F-1 A, F-4 C), which are NOT closure paths and")
    print("  must never be counted as such. Four of the five mechanisms are executed;")
    print("  mechanism 4 has a handler that has never run -- see AR-475 §1 and R-475 §3(f).")
    print("")
    print("★★ WHAT THIS SUITE DOES NOT PROVE, and the record is in the rulings rather")
    print("   than in this banner: registered-fixture closure establishes nothing about")
    print("   UNREGISTERED shapes. Capability mode went green on its registered set in")
    print("   four consecutive rounds and was RETIRED anyway (R-472 §1); the F-1")
    print("   enumeration defect was found with every then-registered fixture passing")
    print("   (R-474 §1); and the exclusion defect this suite now covers was found the")
    print("   same way, one boundary further out, INSIDE the commit that fixed F-1")
    print("   (R-475 §1). Read this suite as 'these cases are pinned'. It is not a")
    print("   soundness verdict, and a soundness verdict is not this tool's to issue.")
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
    ap.add_argument("--exclude-dir", action="append", default=[], metavar="NAME",
                    help="DECLARE that directories with this NAME leave the surface. Their "
                         "EXACT paths are emitted and the certified proposition is narrowed "
                         "to 'surface MINUS these paths'. Repeatable. NOTHING is excluded "
                         "unless you ask: an undeclared skip denies the claim (exit 8).")
    ap.add_argument("--exclude-standard", action="store_true",
                    help=f"shorthand declaring all {len(STANDARD_EXCLUDE_DIRS)} standard "
                         "build/vendor directory names (node_modules, .git, .venv, ...). "
                         "Still fully emitted -- shorthand for TYPING, never for DISCLOSURE.")
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
    excluded_names = set(a.exclude_dir)
    if a.exclude_standard:
        excluded_names |= STANDARD_EXCLUDE_DIRS
    return run_text_check(a.pattern, control, surfaces, a.name, root, max_files=a.max_files,
                          excluded_names=excluded_names)


if __name__ == "__main__":
    sys.exit(main())
