#!/usr/bin/env python3
"""LINE-ENDING-REWRITE TRIPWIRE.

WHAT IT DETECTS: a change whose diff is enormous because the file's LINE ENDINGS were
rewritten, while the actual content delta is tiny. The founding instance turned a 12-line
edit into a 2,862-line diff and was caught only because a receipt's arithmetic refused to
reconcile -- no hash pin covered those files. This makes the catch structural.

HOW IT DETECTS IT -- and why this is not a heuristic. For every changed file it measures
churn TWICE:

    churn     = insertions + deletions            (git diff --numstat)
    churn_cr  = insertions + deletions            (git diff --numstat --ignore-cr-at-eol)

`--ignore-cr-at-eol` is git's own comparison that treats two lines differing ONLY by a
trailing CR as equal. So `churn_cr` is the content delta with the line-ending noise removed,
and `churn / churn_cr` is the inflation factor. A genuine change has ratio ~1. A line-ending
rewrite has a ratio in the tens or hundreds.

★ THE OBVIOUS SIMPLER TEST DOES NOT WORK, AND THIS WAS MEASURED, NOT ASSUMED. "Flag files
where churn_cr == 0" (a PURE line-ending rewrite, no content change) finds ZERO of the four
real instances in this repo's history. Every real instance carried a small genuine edit
alongside the rewrite -- 12, 17, 9 and 270 real lines. That is exactly what makes the class
dangerous: the real edit is what the reviewer is looking at, and the rewrite is the noise it
hides in. The test has to be a RATIO.

═══════════════════════════════════════════════════════════════════════════════════════════
THRESHOLD PROVENANCE -- COMPUTED over this repo, not chosen from an impression.
  Population: all 1,815 commits on this branch; 11,983 changed-file entries;
              8,878 entries with churn >= 20.

  The four line-ending events in the whole history, and every entry above 1.11x:
       238.50x  50d28edb  churn 2862  churn_cr  12   src/engine/spec_condition_compiler.py
        88.18x  50d28edb  churn 1499  churn_cr  17   src/engine/tests/test_levelzone_...py
        79.00x  6fd36843  churn  711  churn_cr   9   src/server/lib/spec-timeframe-recovery.ts
         6.93x  6850b6ab  churn 1870  churn_cr 270   docs/replay-results/h1-battery/dual-...json

  Every other eligible entry -- all 8,874 of them -- sits at or below 1.11x:
       p50 1.0000   p90 1.0000   p99 1.0091   p99.9 1.0741   worst genuine 1.11x

  So the band (1.11x, 6.93x) is EMPTY. Any threshold inside it scores 4/4 detection and 0
  false positives over the entire history. RATIO_FIRE = 2.5 sits near its geometric centre
  (sqrt(1.11 * 6.93) = 2.77): 2.25x of headroom above the worst genuine change, 2.77x of
  margin below the weakest true positive.

  ★ AND THIS IS WHY THE PRIOR ATTEMPT FAILED. A previous wave shipped a `>= 8` floor from an
  impression. Measured against the same history, `>= 8` detects 3 of 4 -- it sits ABOVE the
  6.93x event and misses it. The number was not merely unjustified; it was wrong, and the
  data says so.

  MIN_CHURN = 20 exists so a 3-line file cannot produce a large ratio from one CR. All four
  true positives have churn in the hundreds or thousands, so this floor costs no detection.
═══════════════════════════════════════════════════════════════════════════════════════════

USAGE
  python scripts/check_line_ending_rewrite.py                 # check HEAD
  python scripts/check_line_ending_rewrite.py --staged        # pre-commit use
  python scripts/check_line_ending_rewrite.py --range A..B    # check a range
  python scripts/check_line_ending_rewrite.py --audit         # report CRLF blobs in the tree
  python scripts/check_line_ending_rewrite.py --selftest      # RED-PROOF, see below

EXIT CODES
  0  no line-ending rewrite detected
  2  GUARD REFUSED -- a rewrite was detected, or the guard could not run. Never exit 1:
     that reads as a crash, and a guard verdict is not a crash.

This file contains NO `assert` used as a gate. `python -O` strips asserts; a gate that
vanishes under a flag is not a gate.
"""

from __future__ import annotations

import os
import subprocess
import sys

# --- CALIBRATION. Every one of these is justified in the provenance block above. --------- #
RATIO_FIRE = 2.5     # worst genuine 1.11x | weakest true positive 6.93x | band empty between
MIN_CHURN = 20       # below this a single CR can dominate the ratio

GATE_BOUNDARIES: dict[str, str] = {
    "LINE_ENDING_REWRITE": (
        "Compares each changed file's diff churn against its churn under "
        "`--ignore-cr-at-eol`, and fires when the ratio is >= 2.5 on a file with at least 20 "
        "lines of churn. IT SEES ONLY CR-AT-END-OF-LINE INFLATION. It does NOT detect a "
        "whole-file rewrite caused by re-indentation, encoding changes (UTF-8 <-> UTF-16), "
        "trailing-whitespace sweeps, or a reformatter -- those change the content git "
        "compares, so their churn_cr is genuinely large and this gate stays silent. It also "
        "says NOTHING about whether the surviving content delta is CORRECT. "
        "★ AND IT IS STRUCTURALLY BLIND TO A FILE ADDED CRLF FROM SCRATCH: an added file is "
        "all insertions, so there is no before-side to compare and the ratio is 1.00x. This "
        "is not hypothetical -- commit 6fd36843 ADDED three CRLF artifacts that this gate "
        "scores 1.00x, and they are still CRLF in the object store today. `--audit` is the "
        "complement that covers this gap: it scans blobs AT REST rather than diffs, so a file "
        "born CRLF is caught there or nowhere."
    ),
    "GIT_AVAILABLE": (
        "Confirms git ran and returned a parseable --numstat. It cannot tell whether the "
        "revision range you named is the one you meant."
    ),
    "SELFTEST_RED_PROOF": (
        "Proves the detector FIRES on a synthetic CRLF rewrite and STAYS SILENT on a genuine "
        "large change, using two throwaway commits in a scratch repository. It exercises this "
        "file's own threshold constants. It cannot prove the threshold generalizes to a "
        "repository whose genuine-change distribution differs from the one it was calibrated "
        "on -- recalibrate before reusing it elsewhere."
    ),
}


def refuse(gate: str, message: str) -> None:
    """A guard REFUSES. Never `assert` (-O strips it); never exit 1 (reads as a crash)."""
    boundary = GATE_BOUNDARIES.get(gate, "(no boundary declared -- that is itself a defect)")
    sys.stderr.write(
        f"\n{'=' * 78}\nGUARD REFUSED: {gate}\n{'=' * 78}\n{message}\n\n"
        f"  WHAT THIS GATE DOES NOT COVER (printed beside every verdict, red or green):\n"
        f"    {boundary}\n\n"
        "REFUSING. Exit 2 -- this is a guard verdict, not a crash.\n"
    )
    raise SystemExit(2)


def _git(args: list[str], cwd: str) -> tuple[int, str]:
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True,
                       errors="replace")
    return p.returncode, p.stdout


def _numstat(diff_args: list[str], extra: list[str], cwd: str) -> dict[str, int]:
    """path -> churn (insertions + deletions). Binary files report '-' and are skipped."""
    rc, out = _git(["diff", "--numstat", *extra, *diff_args], cwd)
    if rc != 0:
        refuse("GIT_AVAILABLE",
               f"`git diff --numstat {' '.join(extra + diff_args)}` exited {rc} in {cwd}.")
    churn: dict[str, int] = {}
    for line in out.split("\n"):
        parts = line.split("\t")
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            churn[parts[2]] = int(parts[0]) + int(parts[1])
    return churn


def scan(diff_args: list[str], cwd: str) -> list[tuple[str, int, int, float]]:
    """Return [(path, churn, churn_cr, ratio)] for files over MIN_CHURN, worst first."""
    plain = _numstat(diff_args, [], cwd)
    ig = _numstat(diff_args, ["--ignore-cr-at-eol"], cwd)
    rows = []
    for path, churn in plain.items():
        if churn < MIN_CHURN:
            continue
        churn_cr = ig.get(path, churn)
        rows.append((path, churn, churn_cr, churn / max(churn_cr, 1)))
    rows.sort(key=lambda r: -r[3])
    return rows


def report(rows, label: str) -> int:
    fired = [r for r in rows if r[3] >= RATIO_FIRE]
    print(f"=== LINE-ENDING-REWRITE TRIPWIRE === {label}")
    print(f"  threshold: ratio >= {RATIO_FIRE} on churn >= {MIN_CHURN} lines")
    print(f"  files over the churn floor: {len(rows)}")
    for path, churn, churn_cr, ratio in rows[:5]:
        mark = "FIRE" if ratio >= RATIO_FIRE else "ok  "
        print(f"    [{mark}] {ratio:>8.2f}x  churn {churn:>6}  content-churn {churn_cr:>6}"
              f"   {path}")
    print(f"  GATE LINE_ENDING_REWRITE: {'REFUSE' if fired else 'PASS'}")
    print(f"    boundary: {GATE_BOUNDARIES['LINE_ENDING_REWRITE']}")
    if fired:
        detail = "\n".join(
            f"    {p}\n      diff churn {c} lines, but only {c2} lines differ once a trailing "
            f"CR is ignored ({r:.1f}x inflation).\n"
            f"      {c - c2} lines changed by LINE ENDING ONLY."
            for p, c, c2, r in fired)
        refuse("LINE_ENDING_REWRITE",
               f"{len(fired)} file(s) carry a line-ending rewrite:\n{detail}\n\n"
               "  A line-ending rewrite makes a diff unreviewable and destroys blame. Rewrite "
               "the file with an explicit newline policy (Python: open(..., newline='\\n')) "
               "and re-commit, or declare the path in .gitattributes.")
    return 0


def audit(cwd: str) -> int:
    """Report blobs stored CRLF -- the standing debt the .gitattributes exemptions name."""
    rc, out = _git(["ls-files", "--eol"], cwd)
    if rc != 0:
        refuse("GIT_AVAILABLE", f"`git ls-files --eol` exited {rc}.")
    crlf = [ln.split("\t")[-1] for ln in out.split("\n") if ln.startswith("i/crlf")]
    print("=== CRLF BLOBS IN THE OBJECT STORE (deferred normalization unit) ===")
    for p in crlf:
        print(f"    {p}")
    print(f"  total: {len(crlf)}")
    print("  These are EXEMPTED in .gitattributes so they do not report as permanently")
    print("  modified. Normalizing them is a separate change with its own review.")
    print(f"  GATE LINE_ENDING_REWRITE: ADVISORY (audit mode does not refuse)")
    print(f"    boundary: {GATE_BOUNDARIES['LINE_ENDING_REWRITE']}")
    return 0


def selftest() -> int:
    """RED-PROOF. A tripwire that has never fired is not a tripwire.

    Builds a scratch repo and commits (1) a synthetic CRLF rewrite carrying a small genuine
    edit -- the real-world shape -- and (2) a genuinely large change. Asserts nothing; it
    CHECKS and refuses.
    """
    import shutil
    import tempfile

    tmp = tempfile.mkdtemp(prefix="eol-redproof-")
    try:
        for a in (["init", "-q"], ["config", "user.email", "t@t"],
                  ["config", "user.name", "t"], ["config", "core.autocrlf", "false"]):
            _git(a, tmp)
        # A file with no .gitattributes governing it, so nothing normalizes behind our back.
        with open(os.path.join(tmp, ".gitattributes"), "wb") as f:
            f.write(b"* -text\n")
        body = [f"line {i} of the original file" for i in range(400)]
        p = os.path.join(tmp, "subject.txt")
        with open(p, "wb") as f:
            f.write(("\n".join(body) + "\n").encode())
        _git(["add", "-A"], tmp)
        _git(["commit", "-qm", "base"], tmp)

        # --- ARM 1: CRLF rewrite + a 12-line genuine edit (the real-world shape). --------- #
        arm1 = list(body)
        for i in range(12):
            arm1[i * 30] = f"line {i * 30} EDITED"
        with open(p, "wb") as f:
            f.write(("\r\n".join(arm1) + "\r\n").encode())
        _git(["add", "-A"], tmp)
        _git(["commit", "-qm", "crlf rewrite carrying a 12-line edit"], tmp)
        crlf_rows = scan(["HEAD~1", "HEAD"], tmp)

        # --- ARM 2: a genuinely large change, line endings untouched. -------------------- #
        arm2 = [f"completely rewritten content line {i}" for i in range(400)]
        with open(p, "wb") as f:
            f.write(("\r\n".join(arm2) + "\r\n").encode())
        _git(["add", "-A"], tmp)
        _git(["commit", "-qm", "genuine large change"], tmp)
        genuine_rows = scan(["HEAD~1", "HEAD"], tmp)

        print("=== RED-PROOF: does the tripwire actually fire? ===")
        print(f"  threshold: ratio >= {RATIO_FIRE} on churn >= {MIN_CHURN}")
        print("\n  ARM 1 -- synthetic CRLF rewrite carrying a 12-line genuine edit:")
        for path, c, c2, r in crlf_rows:
            print(f"    {r:>8.2f}x  churn {c:>6}  content-churn {c2:>6}   {path}")
        print("\n  ARM 2 -- genuine large change, line endings untouched:")
        for path, c, c2, r in genuine_rows:
            print(f"    {r:>8.2f}x  churn {c:>6}  content-churn {c2:>6}   {path}")

        arm1_fires = any(r >= RATIO_FIRE for _, _, _, r in crlf_rows)
        arm2_quiet = all(r < RATIO_FIRE for _, _, _, r in genuine_rows)
        print(f"\n  ARM 1 FIRES : {arm1_fires}   (required True)")
        print(f"  ARM 2 QUIET : {arm2_quiet}   (required True)")
        if not (arm1_fires and arm2_quiet and crlf_rows and genuine_rows):
            refuse("SELFTEST_RED_PROOF",
                   f"red-proof failed: arm1_fires={arm1_fires} arm2_quiet={arm2_quiet} "
                   f"arm1_rows={len(crlf_rows)} arm2_rows={len(genuine_rows)}. The tripwire "
                   "does not do what this file claims it does.")
        print("  GATE SELFTEST_RED_PROOF: PASS")
        print(f"    boundary: {GATE_BOUNDARIES['SELFTEST_RED_PROOF']}")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    cwd = os.getcwd()
    if "--selftest" in argv:
        return selftest()
    if "--audit" in argv:
        return audit(cwd)
    if "--staged" in argv:
        return report(scan(["--cached"], cwd), "staged changes")
    for i, a in enumerate(argv):
        if a == "--range" and i + 1 < len(argv):
            rng = argv[i + 1]
            return report(scan([rng], cwd), f"range {rng}")
    return report(scan(["HEAD~1", "HEAD"], cwd), "HEAD")


if __name__ == "__main__":
    raise SystemExit(main())
