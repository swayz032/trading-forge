"""R-NEWLINE: no artifact writer may emit PLATFORM-DEPENDENT BYTES.

★ THE DEFECT. Python TEXT MODE translates every `\\n` a writer emits into `os.linesep` --
CRLF on Windows, LF on Linux. `json.dump(out, open(p, "w", encoding="utf-8"), indent=2)`
therefore produces DIFFERENT BYTES and a DIFFERENT sha256 depending on the machine that ran
it, and every hash pin over that artifact fails across platforms. `ladder_recompute.py` was
certified "reproducible" while carrying exactly that write call.

★ WHY THIS IS A TEST AND NOT A ONE-LINE FIX. The instance fix would have left 58 sibling
write sites in the same repo emitting platform bytes. REMEDIES ARE SIZED BY CENSUS. The
census generator is `docs/replay-results/h1-battery/newline_writer_census.py`; this test
re-runs its detector so the class cannot silently reopen at the next generator someone writes.

★ THE VERDICT IS COMPUTED, NOT ASSUMED. An unpinned text handle is only a defect if the
writer actually emits a newline. `json.dump` WITHOUT `indent=` emits a single line and escapes
in-string newlines as the two characters `\\` `n`, so text mode has nothing to translate --
that site is INVARIANT and this test does not flag it. Verified against real bytes in
`test_the_platform_dependence_mechanism_is_real` below rather than argued from the docs.

DECLARED EXCLUSIONS (named, so they are visible rather than silent):
  * `src/engine/tests/` -- test files write temp fixtures, not tracked artifacts.
  * `tmp-n8n/` -- scratch directory.
  * TypeScript/JavaScript -- Node's `fs.write*` performs NO newline translation. The
    mechanism does not exist there. An exclusion BY MECHANISM, not by convenience.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
CENSUS_PY = REPO_ROOT / "docs" / "replay-results" / "h1-battery" / "newline_writer_census.py"

EXCLUDED_PREFIXES = ("src/engine/tests/", "tmp-n8n/")


def _census_module():
    if not CENSUS_PY.exists():
        pytest.skip(f"census generator absent: {CENSUS_PY}")
    spec = importlib.util.spec_from_file_location("_nl_census", CENSUS_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _scan_repo(mod) -> list[dict]:
    sites = []
    files = 0
    for p in sorted(REPO_ROOT.rglob("*.py")):
        if any(s in p.parts for s in mod.SKIP_DIRS):
            continue
        files += 1
        sites.extend(mod._scan(p, p.relative_to(REPO_ROOT).as_posix()))
    return files, sites


def test_the_platform_dependence_mechanism_is_real(tmp_path: Path):
    """★ RECONCILE THE AST VERDICT AGAINST REAL BYTES, outside the AST pipeline entirely.

    Both of the census's load-bearing claims are proven here by writing files and hashing
    them, not by citing behaviour: (a) an unpinned indented json.dump moves bytes, (b) an
    unpinned NON-indented one does not, even when the data contains a newline.
    """
    obj = {"a": [1, 2, 3], "b": {"c": "x\ny"}}
    unpinned = tmp_path / "unpinned.json"
    pinned = tmp_path / "pinned.json"
    flat = tmp_path / "flat.json"
    json.dump(obj, open(unpinned, "w", encoding="utf-8"), indent=2)
    json.dump(obj, open(pinned, "w", encoding="utf-8", newline="\n"), indent=2)
    json.dump(obj, open(flat, "w", encoding="utf-8"))

    ub, pb, fb = unpinned.read_bytes(), pinned.read_bytes(), flat.read_bytes()
    if os.linesep == "\n":
        pytest.skip("this platform's os.linesep is already LF; the divergence arm needs CRLF")
    assert b"\r" in ub and b"\r" not in pb, (
        f"on a platform with os.linesep={os.linesep!r} an UNPINNED indented json.dump must "
        f"emit CR and a PINNED one must not. unpinned CR={ub.count(bytes([13]))}, "
        f"pinned CR={pb.count(bytes([13]))}. If this fails the census's core premise is wrong."
    )
    assert hashlib.sha256(ub).hexdigest() != hashlib.sha256(pb).hexdigest(), (
        "unpinned and pinned writes produced the SAME sha256; the platform-dependence this "
        "whole rule addresses would not exist."
    )
    assert b"\r" not in fb, (
        "a NON-indented json.dump emitted CR. The census classifies such sites INVARIANT and "
        f"does not flag them; that classification would be wrong. bytes={fb!r}"
    )


def test_no_artifact_writer_emits_platform_dependent_bytes():
    """The census's remedy set must be empty outside the declared exclusions."""
    mod = _census_module()
    n_files, sites = _scan_repo(mod)
    assert n_files > 100, (
        f"only {n_files} python files walked; the detector is broken and an empty remedy set "
        "below would be a false green. Boundary: walker skips {mod.SKIP_DIRS}."
    )
    assert sites, "zero write sites discovered; a census of an empty set is a false green"

    movers = [s for s in sites if s["verdict"] == "PLATFORM_DEPENDENT_BYTES"
              and not s["file"].startswith(EXCLUDED_PREFIXES)]
    assert movers == [], (
        f"{len(movers)} artifact write site(s) emit platform-dependent bytes "
        f"(of {len(sites)} write sites examined across {n_files} python files; "
        f"declared exclusions = {EXCLUDED_PREFIXES}):\n"
        + "\n".join(f"    {s['file']}:{s['line']}  {s['writer_kind']}  {s.get('handle','')}"
                    for s in movers)
        + '\n\nEach must pass newline="\\n" to the open()/os.fdopen() call its bytes flow '
          "through. Without it the artifact's sha256 differs between Windows and Linux and "
          "any hash pin over it is platform-conditional. See "
          "docs/replay-results/h1-battery/newline_writer_census.py."
    )


def test_the_census_denominator_is_published_not_just_the_hits():
    """★ A census that reports only hits cannot be audited. The DENOMINATOR is the claim."""
    mod = _census_module()
    n_files, sites = _scan_repo(mod)
    verdicts = {s["verdict"] for s in sites}
    known = {"PLATFORM_DEPENDENT_BYTES", "INVARIANT_NO_NEWLINE_EMITTED", "UNPINNED_TEXT",
             "PINNED", "EXEMPT_BINARY", "DEPENDS_ON_HANDLE", "UNRESOLVED", "CSV_HANDLE_REVIEW",
             "PARSE_FAIL"}
    unknown = verdicts - known
    assert not unknown, (
        f"the detector emitted verdict(s) this rule does not know how to read: {unknown}. "
        "A new bucket must be classified deliberately, not absorbed silently -- an unread "
        "bucket is where a mover would hide."
    )
    assert n_files > 100 and len(sites) > 100, (
        f"denominator collapsed: {n_files} files / {len(sites)} write sites. The remedy-set "
        "check above is only as trustworthy as this population."
    )
