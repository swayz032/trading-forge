"""ACCEPT-5 acceptance runner — `ACCEPT5-INSTRUMENT-1` (R-790 §6).

THE PROBLEM THIS REPLACES
    `ACCEPT-5` has never had a committed runner. Every execution in this
    campaign was a hand-built script authored per seat (AR-927 §3, measured with
    a positive control: `ordered_6b_reds` and the baseline filename are read by
    ZERO code). Rebuilds differ, and one rebuild reported 51 failures against
    pytest's own 31 — a 49-member FABRICATED REGRESSION against a clean commit
    (R-789 §6).

    `A GATE WITH NO COMMITTED INSTRUMENT IS NOT A GATE — IT IS A PROCEDURE EACH
     SEAT RE-AUTHORS.`

WHAT IT CHECKS  (R-790 §6 contract, numbered as ordered)
    1. reads the canonical population manifest
    2. reads the immutable baseline
    3. node IDs come THROUGH PYTEST ITSELF (acceptance_pytest_plugin), never a
       regex over human summary prose
    4. records expected / collected / executed / failures / skips / xfails
    5. FAILS when a baseline-named test leaves COLLECTION
    6. FAILS on a collected-but-unexecuted test with no allowed disposition
    7. compares failure membership by EXACT NODE ID
    8. verifies NEW / GONE by member identity
    9. reads `ordered_6b_reds` FROM the baseline, never retyped

    plus SELF-CHECK: a SECOND RECORDER (pytest's own junitxml) must agree with the
    plugin on failure membership and collection size. This is the arm that catches
    a corrupted result feeder — the class that produced the fake 49.

    ⚠️ SCOPE OF THAT CROSS-CHECK, STATED HONESTLY (R3-5 item C). The two recorders
    are NOT independent measurements. Both are pytest plugins in the SAME process,
    both subscribe to the SAME `pytest_runtest_logreport` hook, and both write at
    `pytest_sessionfinish`. They are two SINKS on ONE report stream, so they
    cross-check SERIALIZATION AND AGGREGATION — not execution.

    What it therefore CANNOT see is any failure UPSTREAM of both: the run never
    happening (F-R2-1 — both artifacts go stale for the same reason), reports
    suppressed before the hook fires, or the report stream itself being wrong.
    Agreement between them is evidence about recording, and nothing else.

      `BOTH SIDES OF A CHECK FROM THE SAME LAYER ⇒ AGREEMENT IS NOT EVIDENCE.`

USAGE
    python scripts/acceptance_runner.py --from-run run.json --junit run.xml
    python scripts/acceptance_runner.py --run --out-dir <dir>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path

# defusedxml over stdlib ElementTree: the junitxml is locally generated and so
# not an untrusted input today, but this file is a COMMITTED instrument that
# future seats will point at other people's artifacts.
try:
    from defusedxml import ElementTree as ET
except ImportError as _err:  # pragma: no cover - explicit, never a silent downgrade
    raise SystemExit(
        "acceptance_runner requires defusedxml (pip install defusedxml). "
        "Refusing to parse XML with the vulnerable stdlib parser."
    ) from _err

REPO = Path(__file__).resolve().parents[1]
MANIFEST = REPO / "src" / "engine" / "tests" / "canonical_regression_population.txt"
BASELINE = REPO / "docs" / "replay-results" / "h1-battery" / "acceptance-baseline-2026-08-09.json"
SEAL = REPO / "docs" / "replay-results" / "h1-battery" / "acceptance-collection-seal-08062e12.json"

# The single refusal string for an execution that produced no evidence about the tree.
# R-799 SS2 carries this wording verbatim and R-801 SS5 ruled it governs over the prose
# paraphrases elsewhere in the ledger: `A PARAPHRASE OF A SPEC IS NOT A SECOND SPEC.`
PYTEST_RUN_INVALID = "ACCEPTANCE INSTRUMENT REFUSED - PYTEST RUN INVALID"

# A DIFFERENT refusal, deliberately. ACCEPT5-TREE-AUTHORITY-1: pytest may have run
# perfectly and still leave us unable to say WHICH tree it measured. Reusing
# PYTEST_RUN_INVALID here would misclassify a healthy run as a broken one and would
# send the next reader hunting a pytest failure that never happened.
TREE_AUTHORITY_UNAVAILABLE = (
    "ACCEPTANCE INSTRUMENT REFUSED - TREE AUTHORITY UNAVAILABLE"
)

# The paths whose bytes DEFINE what pytest executes. Cleanliness is measured over these
# and ONLY these, BEFORE the run.
#
# `docs/` is deliberately EXCLUDED, and the exclusion is load-bearing rather than
# convenient: a governed member rewrites the tracked docs/wave25-exit-engine-ab-report.md
# during every acceptance run (ACCEPT5-TEST-SIDE-EFFECT-1, ruled output-only). A
# whole-tree cleanliness gate would therefore REFUSE EVERY AUTHORITATIVE RUN -- which is
# a new false RED wearing the words "fail closed", and exactly what red-proof R6 exists
# to prevent.
#
#   `AN AUTHORITY FIX IMPLEMENTED LITERALLY CAN RE-CREATE THE FALSE-RED CLASS IT WAS
#    MEANT TO GUARD.`
#
# Residue, named rather than waived: a tracked docs/ change cannot be seen by this join.
# That is correct only while no governed member reads docs/ as source.
# ACCEPT5-TREE-AUTHORITY-CONFIG-1 (R-807 SS4). The first version of this set was
# ("src", "scripts") and MEASURABLY missed three ways to change what pytest executes
# while the gate still reported CLEAN:
#
#   pyproject.toml            carries [tool.pytest.ini_options] -- testpaths,
#                             python_files, pythonpath. It does not accompany the run,
#                             it DEFINES which tests are collected and how they import.
#   an untracked conftest.py  pytest AUTO-LOADS it. No manifest names it, and the old
#                             --untracked-files=no could not see it at all.
#   tests/python              a DECLARED testpath (pyproject.toml:30) holding 26 tracked
#                             files that pytest executes, entirely outside the old set.
#
# That third one is the reason this list is the ruling's and not the obvious one:
#   `A HARD-CODED PATH LIST IS A SNAPSHOT OF A CONFIG THAT LIVES IN A FILE THE LIST IS
#    SUPPOSED TO GUARD.`
# It is self-defending at one remove -- editing `testpaths` now dirties pyproject.toml,
# which IS guarded -- and ACCEPT5-AUTHORITY-SURFACE-DERIVED-1 is banked to derive this
# surface from testpaths rather than hard-code it.
#
# `docs/` remains EXCLUDED for the reason in the block above: a governed member rewrites
# a tracked file there during every run, and guarding it would refuse every authoritative
# run. Paths that do not exist are fine -- the requirement is that CREATING one is seen.
AUTHORITY_SOURCE_PATHS = (
    "src", "scripts", "tests",
    "pyproject.toml", "pytest.ini", "tox.ini", "setup.cfg", "conftest.py",
    # --- R-811 §4: these two DECIDE WHAT PYTEST EXECUTES ------------------
    # The successor chain now contributes supplemental pytest targets, and the
    # seal anchors it. Both live under docs/, which this surface deliberately
    # ignores — so without these two exact paths an execution-authority input
    # would sit OUTSIDE the gate that exists to attest the tested bytes.
    # `A CLOSED DEFECT CLASS RE-OPENS THROUGH THE DOOR ITS OWN FIX BUILT.`
    # 🛑 TWO NAMED FILES, NOT the docs/ tree: a governed member rewrites
    # docs/wave25-exit-engine-ab-report.md during every run, so guarding docs/
    # would refuse every authoritative run (STOP [16]/[18]).
    "docs/replay-results/h1-battery/acceptance-population-successor.json",
    "docs/replay-results/h1-battery/acceptance-collection-seal-08062e12.json",
)


def _dirty_source_paths():
    """Working-tree changes under AUTHORITY_SOURCE_PATHS, or None if git cannot answer.

    UNTRACKED FILES COUNT. The previous version passed --untracked-files=no and excused
    it with "an untracked file is not executed unless the manifest names it" -- which is
    FALSE: pytest auto-loads conftest.py, and no manifest names it. That comment asserted
    a safety property pytest's own collection rules contradict, and it sat inside the
    function it was excusing.
    """
    try:
        proc = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=all", "--",
             *AUTHORITY_SOURCE_PATHS],
            cwd=REPO, capture_output=True, text=True, timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    return [ln for ln in proc.stdout.splitlines() if ln.strip()]


def _sha256_file(path):
    """SHA-256 of a file's raw bytes, or None if it is not readable."""
    try:
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    except OSError:
        return None


def _git_head():
    """The executing tree's HEAD, or None if git cannot answer.

    None is returned rather than raising so the CALLER decides what it means. On the
    authoritative --run path the caller REFUSES (TREE_AUTHORITY_UNAVAILABLE): a run that
    cannot name the commit it measured may not sign a verdict.

    An earlier version of this docstring told callers to "skip the HEAD-did-not-move join
    rather than fail it". That was the fail-open behaviour ACCEPT5-TREE-AUTHORITY-1
    removed, and the sentence outlived the code it described.
      `A DOCSTRING THAT SURVIVES THE BEHAVIOUR IT DESCRIBES IS THE NEXT READER'S FALSE
       PREMISE.`
    """
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO, capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout.strip() or None

# ---------------------------------------------------------------------------
# THE SEAL'S APPROVED IDENTITY, HELD IN THE RUNNER'S OWN CONTRACT (R-792 §5.2).
# The seal file carries its own digest, so validating it only against itself
# lets a re-checksummed seal AUTHORIZE ITSELF. These two constants are the
# out-of-band anchor that makes that impossible.
#   `A SEALED BASELINE THAT IS NOT VALIDATED BEFORE USE IS STILL MUTABLE AUTHORITY.`
# ---------------------------------------------------------------------------
SEAL_APPROVED_GRADED_SHA = "08062e12b3e2b59d44eada150c8d8b8653796c90"
SEAL_APPROVED_POP_SHA256 = "63d4b541caf7f0ade8628ac9e2f737ff6f7fdaeec3e12ea653b433e376b2c9b9"

# --- R3-2 / F-R2-2 (R-799 §4) ----------------------------------------------
# The seal ALSO records which manifest it was taken over — `manifest_path`,
# `manifest_sha256`, `manifest_members`. Until now nothing read them, so a seal
# could name any manifest and no check disagreed.
#
# 🛑 THESE PIN SEAL TIME AND ARE DELIBERATELY **NOT** COMPARED TO THE LIVE
# MANIFEST. `[MEASURED 2026-08-10]` the live manifest is 107 members /
# dc615e39…, against the seal's 105 / 2c728e35… — that drift is LEGITIMATE
# (lane L). Binding these to today's manifest would refuse every run, which is
# the false-RED shape R-806 §3 caught. Seal-time identity is pinned here; the
# LIVE manifest is governed by the successor chain instead.
SEAL_APPROVED_MANIFEST_PATH = "src/engine/tests/canonical_regression_population.txt"
SEAL_APPROVED_MANIFEST_SHA256 = (
    "2c728e35f3c60e70b32b7d0e7276ef3ba86aac76d7a7d342fe6fd7ea75e1fa03"
)
SEAL_APPROVED_MANIFEST_MEMBERS = 105

# ---------------------------------------------------------------------------
# F-2 (R-794 §6) — THE FAILURE BASELINE'S APPROVED IDENTITY, ALSO OUT-OF-BAND.
# The baseline DEFINES `NEW` and `GONE`; it is the most authoritative input this
# gate has, and until now it was the only one with no external anchor while the
# seal received one in the same commit. Git protects it operationally, but that
# is defence in depth, not the instrument checking its own authority file.
#   `AN INSTRUMENT THAT VALIDATES EVERY INPUT EXCEPT ITS MOST AUTHORITATIVE ONE
#    HAS AUDITED ITS WITNESSES AND TAKEN THE JUDGE'S WORD FOR IT.`
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# F-ACCEPT5-8 (R-796 §4, lane K-2) — THE DUAL ANCHOR, REPLACING THE RAW-BYTE SHA.
#
# The previous anchor hashed the file EXACTLY AS IT SAT ON DISK. `.gitattributes`
# declares this path `text eol=lf` and `core.autocrlf` is false, so a CONFORMING
# checkout gets LF — yet the approved constant was computed over a working copy
# carrying 66 CR bytes. It therefore PASSED IN EXACTLY ONE PLACE: the single
# non-conforming worktree that minted it, and refused the artifact git committed.
# `git status` cannot warn about this, because it compares NORMALIZED content,
# which matched the blob perfectly.
#
#   `AN ANCHOR PINNED TO A MATERIALIZATION ACCIDENT OF ONE WORKING COPY IS NOT
#    PINNING THE ARTIFACT — AND THE ONE TOOL THAT WOULD HAVE TOLD YOU IS BLIND
#    TO IT BY DESIGN.`
#
# TWO anchors, because neither alone is sufficient:
#   BLOB OID       — "is this the artifact git COMMITTED?" Normalized first, so it
#                    answers identically on every checkout. Alone it would bless a
#                    RE-COMMITTED mutation, whose new OID someone could paste here.
#   CANONICAL JSON — "did any semantic CONTENT change?" Line-ending immune, and it
#                    bites exactly the re-commit the OID would wave through.
#
# 🛑 NO `git` SUBPROCESS. The OID is computed in pure Python, so this still anchors
# inside a container, a tarball, or any export carrying no `.git` at all.
# 🛑 `git hash-object --no-filters` is FORBIDDEN (R-796 §9) and is not used here.
# MEASURED: the UNQUALIFIED form is the filter-applying SAFE one and `--no-filters`
# is the trap — the inverse of the caution that was circulating.
#   `A CAUTION THAT NAMES THE WRONG FLAG IS OBEYED AT THE WRONG FLAG.`
#
# Both constants were RECOMPUTED at source from both materializations before
# landing (R-796 §4 K-2 required a STOP had they disagreed; they agreed).
# ---------------------------------------------------------------------------
# R3-5 item B — DETERMINISTIC REFUSAL CODES. A caller must be able to branch on WHY
# authority was refused without parsing English prose, and a refusal that arrives as
# a traceback cannot be branched on at all.
BASELINE_UNREADABLE = "BASELINE_UNREADABLE"
BASELINE_UNPARSEABLE = "BASELINE_UNPARSEABLE"

BASELINE_APPROVED_BLOB_OID = "b71c164147201f7a42dcd1899402a56ae19a6f32"
BASELINE_APPROVED_CANONICAL_SHA256 = (
    "1b97e38ae1e9c15a3653e0adf8533b0f73b7c7a5c092296dd00c5079dd1a02d4"
)


def _lf_normalized(raw):
    """The content git stores for a `text eol=lf` path, however it checked out."""
    return raw.replace(b"\r\n", b"\n")


def _git_blob_oid(raw):
    """git's own object id for this content, computed without invoking git.

    The format is git's: the literal `blob`, a space, the byte length, a NUL, then
    the normalized content. sha1 here is not a security choice — it is git's object
    format, and reproducing the identity git already assigned is the entire point.
    """
    body = _lf_normalized(raw)
    header = b"blob " + str(len(body)).encode("ascii") + b"\x00"
    return hashlib.sha1(header + body).hexdigest()  # noqa: S324


def _canonical_sha256(parsed):
    """Content identity that survives any line-ending or key-order presentation."""
    canonical = json.dumps(
        parsed, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


BASELINE_APPROVED_MEASURED_AT_SHA = "f8273f418558ad9552486dfee2dc37d9401dd360"
BASELINE_APPROVED_FAILURE_COUNT = 33
BASELINE_APPROVED_FAILURE_MEMBERSHIP_SHA256 = (
    "576153e8a01b578b1c90d84c0cf7a121698a2e74e07e0d20773b3c83ed27e07d"
)


def validate_baseline_bytes(path: Path):
    """BASELINE PREFLIGHT (F-2) — the six-step chain, run BEFORE the baseline is used.

    Ordered deliberately: raw bytes FIRST, so a file that is not the approved file
    is refused before anything parses it and starts believing its contents. Each
    later step then anchors a DIFFERENT property, so a forger who repairs one
    still trips the next.

    Returns a list of refusal strings; empty means the baseline may be trusted.
    """
    probs = []

    # (0) READABILITY — missing, unreadable, or permission-denied. Previously this
    #     raised straight out of the preflight, so the gate died before printing a
    #     single refusal and never reached its own verdict line.
    try:
        raw = path.read_bytes()
    except OSError as exc:
        probs.append(
            f"{BASELINE_UNREADABLE}: the failure baseline could not be read at "
            f"{path}: {exc.__class__.__name__}: {exc}"
        )
        return probs

    # (1) COMMITTED IDENTITY — the whole file, before any interpretation, compared
    #     as git itself would identify it. Normalized, so this asks about the
    #     ARTIFACT and not about how one worktree happened to materialize it.
    oid = _git_blob_oid(raw)
    if oid != BASELINE_APPROVED_BLOB_OID:
        probs.append(
            "BASELINE INTEGRITY FAILURE: the failure baseline's git blob OID is "
            f"{oid}, not the approved {BASELINE_APPROVED_BLOB_OID}. This is compared "
            "over LF-NORMALIZED content, so a CRLF checkout is NOT the cause — the "
            "committed content itself differs."
        )

    # (2) it must parse at all.
    try:
        d = json.loads(raw)
    except Exception as exc:
        probs.append(
            f"{BASELINE_UNPARSEABLE}: the failure baseline does not parse: "
            f"{exc.__class__.__name__}: {exc}"
        )
        return probs

    # (2b) SEMANTIC IDENTITY — immune to line endings and key order, so it bites the
    #      re-committed mutation whose freshly-computed OID would look approved.
    canonical = _canonical_sha256(d)
    if canonical != BASELINE_APPROVED_CANONICAL_SHA256:
        probs.append(
            "BASELINE INTEGRITY FAILURE: the baseline's canonical-JSON SHA-256 is "
            f"{canonical}, not the approved {BASELINE_APPROVED_CANONICAL_SHA256}. "
            "Presentation is excluded from this digest, so the CONTENT changed."
        )

    # (3) measured_at_sha — read AND compared. It was previously read and discarded.
    if d.get("measured_at_sha") != BASELINE_APPROVED_MEASURED_AT_SHA:
        probs.append(
            "BASELINE INTEGRITY FAILURE: measured_at_sha is "
            f"{d.get('measured_at_sha')!r}, not the approved "
            f"{BASELINE_APPROVED_MEASURED_AT_SHA!r}."
        )

    failures = d.get("failures")
    if not isinstance(failures, list) or not failures:
        probs.append("BASELINE INTEGRITY FAILURE: `failures` is missing or empty.")
        return probs

    # (4) failure COUNT.
    if len(failures) != BASELINE_APPROVED_FAILURE_COUNT:
        probs.append(
            f"BASELINE INTEGRITY FAILURE: failure count {len(failures)} != approved "
            f"{BASELINE_APPROVED_FAILURE_COUNT}."
        )

    # (5) sorted failure-MEMBERSHIP digest. A count is satisfied by any swap;
    #     only a membership digest names the population.
    membership = hashlib.sha256("\n".join(sorted(failures)).encode("utf-8")).hexdigest()
    if membership != BASELINE_APPROVED_FAILURE_MEMBERSHIP_SHA256:
        probs.append(
            "BASELINE INTEGRITY FAILURE: the sorted failure-membership digest is "
            f"{membership}, not the approved {BASELINE_APPROVED_FAILURE_MEMBERSHIP_SHA256}. "
            "A baseline swapped member-for-member preserves the count and changes this."
        )

    # (6) the two authorized subtractions must actually BE members of the failure set.
    reds = d.get("ordered_6b_reds") or []
    strays = sorted(set(reds) - set(failures))
    if strays:
        probs.append(
            "BASELINE INTEGRITY FAILURE: ordered_6b_reds contains "
            f"{len(strays)} member(s) that are not baseline failures: {strays}. "
            "An authorized subtraction that was never in the set can only widen it."
        )
    return probs


# ---------------------------------------------------------------------------
# F-3 (R-794 §6) — THE SEALED DISPOSITIONS, WITH THEIR OWN OUT-OF-BAND ANCHOR.
# A test that goes PASS -> SKIP is still collected (collection seal satisfied),
# never failed (not in the failure baseline), and produces no feeder disagreement.
# All three existing checks are blind to it and the gate reports NEW=0.
#   `A TEST THAT IS SKIPPED IS NOT A TEST THAT PASSED — AND A GATE THAT CANNOT TELL
#    THEM APART CAN BE TURNED OFF ONE DECORATOR AT A TIME.`
# ⭐ sealed_population_sha256 below is BYTE-IDENTICAL to SEAL_APPROVED_POP_SHA256:
#    two generators, one using --collect-only and one executing the population,
#    independently reproduced the same 2392-member digest.
# ---------------------------------------------------------------------------
DISPOSITION_SEAL = (
    REPO / "docs" / "replay-results" / "h1-battery"
    / "acceptance-disposition-seal-08062e12.json"
)
DISPOSITION_APPROVED_GRADED_SHA = "08062e12b3e2b59d44eada150c8d8b8653796c90"
DISPOSITION_APPROVED_POP_SHA256 = (
    "63d4b541caf7f0ade8628ac9e2f737ff6f7fdaeec3e12ea653b433e376b2c9b9"
)
DISPOSITION_APPROVED_SKIPPED_SHA256 = (
    "ef6bcbeb9504cfb589aae7ce530b392c1b77a73f1e822a02bf6eaca3371e7ce0"
)
DISPOSITION_APPROVED_XFAILED_SHA256 = (
    "ec9e2d7d0b2cc0739fd4bdf07f6ea857735c2f57f851ef42fab0151f4be0f2bf"
)

# ---------------------------------------------------------------------------
# 🛑 AUTHORIZED DISPOSITION CHANGES — declared, never absorbed.
#
# R-794 §6 specifies exact equality: current_skipped ∩ sealed_population ==
# sealed_skipped. MEASURED: that rule REFUSES THE PRISTINE TREE, because the seal
# is taken at 08062e12 (before S6 activation) while HEAD is after it, and S6
# activation legitimately RE-ENABLED two tests that were skipped at the pin.
#
# The rule is not weakened to make the control pass — that would be exactly the
# forbidden move. Instead the two known changes are NAMED here, out-of-band, in the
# same shape the failure baseline already uses for `ordered_6b_reds`: an authorized
# subtraction is declared, and everything else still refuses.
#
#   `AN AUTHORIZED CHANGE IS ONE SOMEBODY NAMED IN ADVANCE. AN UNNAMED ONE IS A
#    REGRESSION WEARING THE SAME CLOTHES.`
#
# 🛑 Each member must actually BE in the seal's skipped set (enforced below), so
# this list cannot be padded with names that silently excuse future drift.
# ---------------------------------------------------------------------------
DISPOSITION_AUTHORIZED_UNSKIPPED = (
    "src/engine/tests/test_spec_family_bindings.py::"
    "test_s6_coverage_6a_re_derives_on_the_governed_population",
    "src/engine/tests/test_spec_family_bindings.py::"
    "test_s6_dead_17_denominator_stays_retired",
)
DISPOSITION_AUTHORIZED_UNXFAILED = ()


def validate_disposition_seal(seal):
    """DISPOSITION SEAL PREFLIGHT — anchored OUTSIDE the file, exactly like the seal.

    Returns a list of refusal strings; empty means it may be trusted.
    """
    probs = []
    if seal.get("graded_sha") != DISPOSITION_APPROVED_GRADED_SHA:
        probs.append(
            "DISPOSITION SEAL INTEGRITY FAILURE: graded_sha "
            f"{seal.get('graded_sha')!r} is not the approved "
            f"{DISPOSITION_APPROVED_GRADED_SHA!r}."
        )
    for key, count_key, approved in (
        ("sealed_population", "sealed_population_count", DISPOSITION_APPROVED_POP_SHA256),
        ("sealed_skipped", "sealed_skipped_count", DISPOSITION_APPROVED_SKIPPED_SHA256),
        ("sealed_xfailed", "sealed_xfailed_count", DISPOSITION_APPROVED_XFAILED_SHA256),
    ):
        members = seal.get(key)
        if members is None:
            probs.append(f"DISPOSITION SEAL INTEGRITY FAILURE: {key} is missing.")
            continue
        if seal.get(count_key) != len(members):
            probs.append(
                f"DISPOSITION SEAL INTEGRITY FAILURE: {count_key} "
                f"{seal.get(count_key)} != len({key}) {len(members)}."
            )
        if len(set(members)) != len(members):
            probs.append(
                f"DISPOSITION SEAL INTEGRITY FAILURE: {key} contains duplicate node IDs."
            )
        recomputed = hashlib.sha256(
            "\n".join(sorted(members)).encode("utf-8")
        ).hexdigest()
        # Against the EXTERNAL anchor, never the file's own stored digest — a seal
        # that recomputes its own digest cannot be allowed to authorize itself.
        if recomputed != approved:
            probs.append(
                f"DISPOSITION SEAL INTEGRITY FAILURE: {key} digest {recomputed} does "
                f"not match the approved hash pinned in this runner ({approved})."
            )
    return probs


def validate_seal(seal):
    """SEAL PREFLIGHT — run BEFORE the seal is used for anything (F-ACCEPT5-5).

    Returns a list of refusal strings; empty means the seal may be trusted.
    """
    probs = []
    pop = seal.get("collected_population")
    if not isinstance(pop, list) or not pop:
        return ["SEAL INTEGRITY FAILURE: collected_population is missing or empty — "
                "an empty seal would silently authorize every future run."]
    if seal.get("graded_sha") != SEAL_APPROVED_GRADED_SHA:
        probs.append(
            f"SEAL INTEGRITY FAILURE: graded_sha {seal.get('graded_sha')!r} is not the "
            f"approved sealed commit {SEAL_APPROVED_GRADED_SHA!r}.")
    if seal.get("collected_count") != len(pop):
        probs.append(
            f"SEAL INTEGRITY FAILURE: collected_count {seal.get('collected_count')} != "
            f"len(collected_population) {len(pop)}.")
    dupes = len(pop) - len(set(pop))
    if dupes:
        probs.append(f"SEAL INTEGRITY FAILURE: {dupes} duplicate node ID(s) in the sealed population.")
    recomputed = hashlib.sha256("\n".join(sorted(pop)).encode("utf-8")).hexdigest()
    if recomputed != seal.get("collected_population_sha256"):
        probs.append(
            "SEAL INTEGRITY FAILURE: the stored collected_population_sha256 does not match "
            "a recompute over the sorted population.")
    if recomputed != SEAL_APPROVED_POP_SHA256:
        probs.append(
            "SEAL INTEGRITY FAILURE: the sealed population does not match the approved hash "
            "pinned in this runner. A seal that recomputes its own digest cannot authorize itself.")

    # --- R3-2 / F-R2-2: the manifest identity fields are now BOUND ----------
    # The seal recorded which manifest it was taken over and nothing read it, so
    # a seal could name a different manifest, or none, and pass. These compare
    # against the runner's out-of-band pins — NOT against the live manifest,
    # which has legitimately moved on (see the pins' own note).
    for field, approved in (
        ("manifest_path", SEAL_APPROVED_MANIFEST_PATH),
        ("manifest_sha256", SEAL_APPROVED_MANIFEST_SHA256),
        ("manifest_members", SEAL_APPROVED_MANIFEST_MEMBERS),
    ):
        if field not in seal:
            probs.append(
                f"SEAL INTEGRITY FAILURE: {field} is absent from the seal. The seal must "
                f"name the manifest it was taken over; a seal that cannot say which "
                f"population it describes cannot anchor a successor chain.")
        elif seal.get(field) != approved:
            probs.append(
                f"SEAL INTEGRITY FAILURE: {field} is {seal.get(field)!r}, not the approved "
                f"seal-time value {approved!r} pinned in this runner.")
    return probs


# ---------------------------------------------------------------------------
# 1. the canonical population
# ---------------------------------------------------------------------------
def read_manifest(path: Path):
    """Membership rule: comments and blanks are NOT members.

    A raw line count reads 128 and is wrong; the members are the surviving
    lines, resolved under <repo>/src (the baseline states the join root, and
    joining to the repo root instead resolves 0 paths while a pathless pytest
    silently runs EVERYTHING).
    """
    members = []
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        members.append(s)
    return members


# ---------------------------------------------------------------------------
# 2. the immutable baseline  (+ 9. ordered_6b_reds read FROM it)
# ---------------------------------------------------------------------------
def read_baseline(path: Path):
    d = json.loads(path.read_text(encoding="utf-8"))
    return {
        "failures": set(d["failures"]),
        "ordered_6b_reds": list(d["ordered_6b_reds"]),   # (9) never retyped
        "population_members": d.get("population_members"),
        "measured_at_sha": d.get("measured_at_sha"),
        "totals": d.get("totals_at_baseline", {}),
    }


# ---------------------------------------------------------------------------
# SELF-CHECK: the second RECORDER of the same report stream
#
# R3-5 item C — traced to the implementation boundary. `acceptance_pytest_plugin`
# and pytest's builtin junitxml are separate implementations, but they are not
# separate MEASUREMENTS: same process, same `pytest_runtest_logreport` hook, same
# `pytest_sessionfinish` write point. Calling them "independent feeders" claimed a
# property this architecture does not have, so the wording is corrected rather than
# a second implementation invented to satisfy it (AR-1027 §4C forbids that).
# ---------------------------------------------------------------------------
FEEDER_CROSS_CHECK_SCOPE = (
    "two recorders of ONE pytest report stream (same process, same "
    "pytest_runtest_logreport hook): this cross-check covers SERIALIZATION and "
    "AGGREGATION, NOT execution. A fault upstream of both — the run not happening, "
    "reports suppressed before the hook fires — is invisible to it."
)
# ---------------------------------------------------------------------------
def read_junit(path: Path):
    """pytest's own junitxml — produced by pytest, not by our plugin.

    Independent of the plugin's bookkeeping, so a corrupted plugin record
    disagrees with it. Node id is rebuilt from classname+name, which is how
    junitxml encodes it.
    """
    root = ET.parse(path).getroot()
    cases, failures = [], set()
    for tc in root.iter("testcase"):
        nid = _junit_nodeid(tc)
        cases.append(nid)
        if tc.find("failure") is not None or tc.find("error") is not None:
            failures.add(nid)
    return cases, failures


def _junit_nodeid(tc) -> str:
    """Rebuild the EXACT pytest node id from a junitxml <testcase>.

    This pytest emits no `file` attribute, only a dotted `classname`:
        src.engine.tests.test_a_plus_gate_parity.TestAPlus_Gate_Wiring
    The trailing Capitalised segments are the class chain; the rest is the
    module path.

    An earlier version of this function collapsed the class chain and compared
    on (file, final test name). That is LOSSY — two same-named tests in
    different classes in one file collapse to one member, and the resulting
    silent -2 delta looked exactly like a real collection regression. The
    positive control caught it. Exact identity only, from here on.
    """
    name = tc.get("name") or ""
    file_attr = tc.get("file")
    cls = tc.get("classname") or ""
    if file_attr:
        parts = [p for p in cls.split(".") if p and p[0].isupper()]
        return "::".join([file_attr.replace("\\", "/"), *parts, name])
    segs = cls.split(".")
    chain = []
    while segs and segs[-1][:1].isupper():
        chain.insert(0, segs.pop())
    module = "/".join(segs) + ".py"
    return "::".join([module, *chain, name])


def _disposition_drift_line(label, newly, no_longer, missing_authorized):
    """The one line a reader scans to decide whether dispositions moved.

    Three departures are computed at this site and any of them refuses the gate:
    `newly`, `no_longer`, and `missing_authorized`. This line reported only the
    first two, so an AUTHORIZED change that never actually happened rendered as
    `+0 / -0` -- a clean-looking summary printed over a live refusal. Lane G hit
    exactly that: MISSING AUTHORIZED DISPOSITION CHANGE as its sole refusal, with
    `+0 / -0` displayed on both sibling arms.

    All three are now shown SEPARATELY. They are not summed: they mean different
    things, and a single total would restore the same ambiguity one level up.

      `A SUMMARY THAT OMITS ONE OF THE THINGS IT SUMMARIZES IS WRONG IN THE
       DIRECTION OF REASSURANCE.`
    """
    return (f"[DISP] sealed {label:<5} membership drift        : "
            f"+{len(newly)} / -{len(no_longer)} / "
            f"missing-authorized {len(missing_authorized)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-run", type=Path, help="plugin JSON record")
    ap.add_argument("--junit", type=Path, help="pytest junitxml from the SAME run")
    ap.add_argument("--run", action="store_true", help="execute the population now")
    ap.add_argument("--out-dir", type=Path, default=Path("."))
    ap.add_argument("--manifest", type=Path, default=MANIFEST)
    ap.add_argument("--baseline", type=Path, default=BASELINE)
    ap.add_argument("--seal", type=Path, default=SEAL,
                    help="ACCEPT5-COLLECTION-BASELINE-1 companion artifact")
    args = ap.parse_args()

    failures_of_the_gate = []   # every reason this gate refuses
    notes = []

    members = read_manifest(args.manifest)

    # --- F-2 BASELINE PREFLIGHT — BEFORE the baseline is used for anything ----
    # It defines NEW and GONE. Validating it after reading it would be auditing a
    # witness whose testimony you have already written down.
    baseline_problems = validate_baseline_bytes(args.baseline)
    print(f"[BASELINE] preflight problems            : {len(baseline_problems)}")
    for pr in baseline_problems:
        print(f"      {pr}")
    failures_of_the_gate.extend(baseline_problems)

    # R3-5 item B — FAIL CLOSED ON THE AUTHORITY FILE ITSELF.
    # Everything below this line PARSES the baseline and subscripts its keys. Running
    # any of it against a baseline the preflight has just refused is how a refusal
    # became a traceback: the verdict line was never reached, and a caller reading the
    # exit code could not tell a refused baseline from a broken instrument.
    #
    #   `A GATE THAT CRASHES INSTEAD OF REFUSING HAS NOT FAILED CLOSED -- IT HAS
    #    FAILED WITHOUT A VERDICT.`
    #
    # The verdict semantics are unchanged: these problems were already terminal, so
    # this reaches the same REFUSED/exit-1 outcome the gate always owed. Downstream
    # checks are skipped deliberately -- they can say nothing trustworthy about a
    # baseline whose identity was just rejected.
    if baseline_problems:
        print("=" * 72)
        print("ACCEPTANCE: REFUSED")
        for f in failures_of_the_gate:
            print(f"  - {f}")
        print("=" * 72)
        return 1

    base = read_baseline(args.baseline)
    seal = None
    if args.seal and Path(args.seal).is_file():
        seal = json.loads(Path(args.seal).read_text(encoding="utf-8"))

    # --- preflight: the baseline's own two assertions -----------------------
    resolved, missing = [], []
    for m in members:
        p = REPO / "src" / m
        (resolved if p.is_file() else missing).append(m)
    # CLASS RULE (F-ACCEPT5-6): every line this runner prints either GATES or is
    # prefixed NOTE:. `missing` gates; the two counts beside it are context.
    print(f"NOTE: [1] manifest members (comments stripped) : {len(members)}")
    print(f"NOTE:     resolved under <repo>/src            : {len(resolved)}")
    print(f"[1] manifest members that DO NOT RESOLVE : {len(missing)}")
    if missing:
        failures_of_the_gate.append(f"PREFLIGHT: {len(missing)} manifest members do not resolve: {missing[:5]}")

    print(f"NOTE: [2] baseline                             : {args.baseline.name}")
    print(f"NOTE:     baseline population_members          : {base['population_members']}")
    print(f"NOTE:     baseline failures (node IDs)         : {len(base['failures'])}")
    print(f"NOTE: [9] ordered_6b_reds READ FROM baseline   : {len(base['ordered_6b_reds'])}")
    for n in base["ordered_6b_reds"]:
        print(f"      - {n}")

    # POPULATION DRIFT is reported, never silently absorbed.
    if base["population_members"] is not None and base["population_members"] != len(members):
        notes.append(
            f"POPULATION DRIFT: baseline pinned {base['population_members']} members, "
            f"manifest now has {len(members)}. Failure membership is being compared "
            f"across DIFFERENT populations; treat NEW members accordingly."
        )

    # --- run or consume ------------------------------------------------------
    #
    # F-R2-1 REPAIR — the fresh-run protocol (R-799 SS2, carried verbatim).
    #
    # WHAT WAS WRONG: this block used to read
    #     subprocess.run(cmd, cwd=REPO)
    # as a BARE EXPRESSION STATEMENT, and the next statement parsed `run_json`
    # unconditionally. So a pytest that died before executing anything left the
    # PREVIOUS run's artifacts on disk and the runner scored those instead --
    # issuing a verdict about a run that never happened. The permanent RED for
    # this is src/engine/tests/test_accept5_stale_run_consumption.py (c31a30e3).
    #
    #   `A GATE THAT DOES NOT READ ITS OWN SUBPROCESS'S EXIT CODE IS NOT MEASURING
    #    THE TREE -- IT IS MEASURING THE LAST TIME SOMEBODY MEASURED THE TREE.`
    #
    # Note the exit-status policy carefully: exit 1 is LEGITIMATE here, because the
    # governed population intentionally contains historical failures. Blindly using
    # check=True would convert every genuinely failing member into an infrastructure
    # error, which is a new false RED rather than a fix (red-proof R6).
    if args.run:
        # (1) unique run identity, and (2) a unique output location for it.
        run_id = uuid.uuid4().hex
        run_dir = args.out_dir / f"run-{run_id}"
        run_dir.mkdir(parents=True, exist_ok=False)
        run_json = run_dir / "acceptance-run.json"
        run_xml = run_dir / "acceptance-run.xml"

        # (3) the artifacts of THIS run must not already exist.
        if run_json.exists() or run_xml.exists():
            print(f"{PYTEST_RUN_INVALID}: output artifacts already exist in the "
                  f"freshly minted run directory {run_dir}.")
            raise SystemExit(2)

        # (4) TREE AUTHORITY, measured BEFORE the run and FAIL-CLOSED
        #     (ACCEPT5-TREE-AUTHORITY-1, R-806 SS3).
        #
        # This join used to fail OPEN: `if pre_head is not None and ...` meant that when
        # git could not answer, the check was skipped entirely and an authoritative PASS
        # could be issued by a run that could not name the commit it tested.
        #
        #   `IF THE REFEREE CANNOT PROVE WHICH CLEAN TREE IT WATCHED, IT DOES NOT GET TO
        #    SIGN THE SCORECARD.`
        pre_head = _git_head()
        if pre_head is None:
            print(f"{TREE_AUTHORITY_UNAVAILABLE}: git could not resolve HEAD for "
                  f"{REPO}, so this run cannot name the commit it measured. pytest was "
                  f"not started; nothing was scored.")
            raise SystemExit(2)

        dirty = _dirty_source_paths()
        if dirty is None:
            print(f"{TREE_AUTHORITY_UNAVAILABLE}: git could not report the working-tree "
                  f"state of {'/, '.join(AUTHORITY_SOURCE_PATHS)}/, so this run cannot "
                  f"attest that the bytes it executed are the bytes at {pre_head}. "
                  f"pytest was not started; nothing was scored.")
            raise SystemExit(2)
        if dirty:
            listed = " | ".join(dirty[:10])
            print(f"{TREE_AUTHORITY_UNAVAILABLE}: {len(dirty)} tracked path(s) under "
                  f"{'/, '.join(AUTHORITY_SOURCE_PATHS)}/ differ from {pre_head}, so an "
                  f"authoritative verdict would describe a tree that is not any commit: "
                  f"{listed}. pytest was not started; nothing was scored.")
            raise SystemExit(2)
        # --- R-811 §2: SUPPLEMENTAL TARGETS FROM THE SUCCESSOR CHAIN --------
        # AUTHORITY A (the manifest) is a COMPUTED file population; AUTHORITY B
        # (the chain) is the post-seal EXACT node-ID population and may legally
        # hold node IDs outside A's import closure. The runner executes BOTH.
        # DERIVED here at run time, never cached and never hard-coded.
        manifest_targets = {f"src/{m}" for m in resolved}
        # 🛑 THE CHAIN GOVERNS THE **CANONICAL** POPULATION ONLY.
        # A caller-supplied --manifest is a DIFFERENT population by construction
        # (fixture runs build a one-member manifest in tmp_path). Injecting
        # chain targets there defeats the fixture's own scoping — MEASURED: it
        # broke test_accept5_stale_run_consumption's explicit NO-RECURSION
        # defence, whose docstring notes the fixture manifest deliberately does
        # not name that file "so the inner runner never re-enters this test even
        # if this file is later admitted to the canonical population". The arrow
        # bypassed the manifest and re-entered it.
        # This is a SCOPE, not an exemption: every canonical run still carries
        # the full chain obligation.
        canonical_run = args.manifest.resolve() == MANIFEST.resolve()
        supplemental, _chain_probs = [], []
        if not canonical_run:
            print("NOTE:     supplemental targets from the chain : SKIPPED "
                  "(non-canonical --manifest; the chain governs the canonical "
                  "population only)")
        try:
            import population_successor as _popsucc
            _required, _chain_probs = _popsucc.required_population(REPO)
        except Exception as exc:  # noqa: BLE001 - any failure here must REFUSE
            print(f"{TREE_AUTHORITY_UNAVAILABLE}: the successor chain could not be "
                  f"derived ({type(exc).__name__}: {exc}), so the set of tests this "
                  f"run must execute is unknown. pytest was not started.")
            raise SystemExit(2) from exc
        if _chain_probs and canonical_run:
            for pr in _chain_probs:
                print(f"      {pr}")
            print("ACCEPTANCE INSTRUMENT REFUSED - POPULATION CHAIN INVALID: the "
                  "required population could not be derived, so this run cannot know "
                  "what it was obliged to execute. pytest was not started.")
            raise SystemExit(2)

        # Only node IDs whose FILE is not already a manifest target — appending
        # all of them would double-collect and blow the Windows command line.
        if canonical_run:
            supplemental = sorted(
                n for n in _required if n.split("::")[0] not in manifest_targets
            )
        # Control I: a required node ID whose file is gone must name ITS OWN
        # layer. Left to pytest this is exit 4 -> "PYTEST RUN INVALID", which is
        # correct and illegible: it reads as broken infrastructure when the truth
        # is that a governed obligation was deleted.
        gone = sorted({n.split("::")[0] for n in supplemental
                       if not (REPO / n.split("::")[0]).is_file()})
        if gone:
            for g in gone:
                print(f"      REQUIRED SUPPLEMENTAL TARGET MISSING: {g}")
            print(f"ACCEPTANCE INSTRUMENT REFUSED - REQUIRED SUPPLEMENTAL TARGET "
                  f"MISSING: {len(gone)} file(s) carrying chain-required node IDs no "
                  f"longer exist. A governed obligation was deleted; this is not a "
                  f"pytest usage error. pytest was not started.")
            raise SystemExit(2)
        if canonical_run:
            print(f"NOTE:     supplemental targets from the chain : {len(supplemental)}")
            for n in supplemental:
                print(f"          + {n}")

        # A present FILE is not a present NODE ID. Renaming a governed test away
        # leaves the file intact, so the `gone` check above passes and pytest
        # then exits 4 -> "PYTEST RUN INVALID": correct, and illegible. It reads
        # as broken infrastructure when the truth is that a governed obligation
        # was renamed. Pre-flight the exact node IDs so the refusal names ITS
        # OWN layer. `A FAIL-CLOSED THAT NAMES THE WRONG LAYER COSTS THE NEXT
        # SEAT AN INVESTIGATION.`
        if supplemental:
            probe = subprocess.run(
                [sys.executable, "-m", "pytest", *supplemental,
                 "--collect-only", "-q", "--no-header", "-p", "no:cacheprovider"],
                cwd=REPO, capture_output=True,
                encoding="utf-8", errors="replace",
            )
            uncollected = [n for n in supplemental if n not in probe.stdout]
            if uncollected:
                for n in uncollected:
                    print(f"      REQUIRED COLLECTION MEMBER MISSING: {n}")
                print(f"ACCEPTANCE INSTRUMENT REFUSED - REQUIRED COLLECTION MEMBER "
                      f"MISSING: {len(uncollected)} chain-required node ID(s) are no "
                      f"longer collectable, though their files still exist. A governed "
                      f"obligation was renamed or removed; this is not a pytest usage "
                      f"error. pytest was not started for scoring.")
                raise SystemExit(2)

        cmd = [sys.executable, "-m", "pytest",
               *[f"src/{m}" for m in resolved], *supplemental,
               "-q", "--no-header", "-p", "no:cacheprovider",
               "-p", "scripts.acceptance_pytest_plugin",
               f"--acceptance-out={run_json}", f"--junitxml={run_xml}",
               f"--acceptance-run-id={run_id}"]
        pre_run_authority = {
            "run_id": run_id,
            "head": pre_head,
            "manifest": str(args.manifest),
            "runner_sha256": _sha256_file(Path(__file__)),
            "invocation_digest": hashlib.sha256(
                "\x00".join(cmd).encode("utf-8")).hexdigest(),
            "started_at": time.time(),
            "repo": str(REPO),
        }
        print(f"NOTE: [0] fresh run                            : {run_id} "
              f"(HEAD {pre_head or 'unknown'})")

        # ---- execute, and CAPTURE the result --------------------------------
        proc = subprocess.run(cmd, cwd=REPO)

        # Only 0 and 1 mean "the population was collected and executed". Everything
        # else -- 2 interrupted, 3 internal error, 4 usage error, 5 nothing
        # collected, or any crash -- means this run produced no evidence about the
        # tree, and membership must NOT be parsed afterwards.
        if proc.returncode not in (0, 1):
            print(f"{PYTEST_RUN_INVALID}: pytest exited {proc.returncode}, which is "
                  f"not a valid execution status (0=clean, 1=failures occurred). "
                  f"The governed population was not executed, so no verdict is "
                  f"possible. Run id {run_id}; nothing was scored.")
            raise SystemExit(2)

        # ---- post-run joins, ALL required BEFORE scoring begins --------------
        invalid = []
        if not run_json.is_file():
            invalid.append(f"the plugin record was not written to {run_json}")
        if not run_xml.is_file():
            invalid.append(f"the JUnit XML was not written to {run_xml}")
        if not invalid:
            _rec = json.loads(run_json.read_text(encoding="utf-8"))
            if int(_rec.get("pytest_exitstatus", -1)) != proc.returncode:
                invalid.append(
                    f"the plugin recorded pytest_exitstatus "
                    f"{_rec.get('pytest_exitstatus')!r} but the subprocess really "
                    f"exited {proc.returncode} - the record does not describe this run")
            if _rec.get("run_id") != run_id:
                invalid.append(
                    f"the plugin recorded run_id {_rec.get('run_id')!r}, not the "
                    f"requested {run_id!r} - this record belongs to a different run")
            if _rec.get("cwd") != pre_run_authority["repo"]:
                invalid.append(
                    f"the plugin ran in {_rec.get('cwd')!r}, not the repository "
                    f"{pre_run_authority['repo']!r} this invocation authorised")
        # pre_head is guaranteed non-None here: the fail-closed gate above refuses
        # otherwise, so this join no longer has a branch that silently skips itself.
        post_head = _git_head()
        if post_head != pre_head:
            invalid.append(
                f"HEAD moved during execution ({pre_head} -> {post_head}); the run "
                f"does not describe a single tree state")
        if invalid:
            print(f"{PYTEST_RUN_INVALID}: " + " | ".join(invalid))
            raise SystemExit(2)
    else:
        run_json, run_xml = args.from_run, args.junit

    rec = json.loads(Path(run_json).read_text(encoding="utf-8"))
    collected = set(rec["collected"])
    executed = set(rec["executed"])
    plugin_failures = set(rec["failures"])
    skipped = set(rec["skipped"])
    xfailed = set(rec["xfailed"])

    print(f"NOTE: [3] feeder                               : {rec['instrument']} "
          f"(pytest exit {rec['pytest_exitstatus']})")
    print(f"NOTE: [4] collected/executed/failed/skip/xfail : "
          f"{len(collected)}/{len(executed)}/{len(plugin_failures)}/{len(skipped)}/{len(xfailed)}")

    # --- SELF-CHECK against the second RECORDER (see FEEDER_CROSS_CHECK_SCOPE) ---
    if run_xml and Path(run_xml).is_file():
        j_cases, j_failures = read_junit(Path(run_xml))
        n_junit_cases = len(j_cases)
        j_cases = set(j_cases)
        only_plugin = plugin_failures - j_failures
        only_junit = j_failures - plugin_failures
        size_delta = len(collected) - n_junit_cases

        # --- F-1 (R-794 §6) — COLLECTION MEMBERSHIP, BOTH DIRECTIONS. ----------
        # `j_cases` was built here and then never read again: the only collection
        # comparison was on SIZE. A BALANCED edit — one member dropped, another
        # added — preserves the size and was completely invisible, while the
        # runner printed "feeders AGREE on membership and size".
        #   `COMPARE MEMBERS, NEVER COUNTS` was already this campaign's law for the
        #   FAILURE set; it was never applied to the COLLECTION set.
        only_plugin_collection = sorted(collected - j_cases)
        only_junit_collection = sorted(j_cases - collected)

        print(f"[SELF-CHECK] second recorder (junitxml) cases={n_junit_cases} "
              f"failures={len(j_failures)}")
        print(f"[SELF-CHECK] scope: {FEEDER_CROSS_CHECK_SCOPE}")
        if only_plugin or only_junit:
            failures_of_the_gate.append(
                "FEEDER DISAGREEMENT on failure membership — "
                f"plugin-only={sorted(only_plugin)[:5]} junit-only={sorted(only_junit)[:5]}"
            )
        if only_plugin_collection or only_junit_collection:
            failures_of_the_gate.append(
                "FEEDER DISAGREEMENT on collection membership — "
                f"ONLY_PLUGIN_COLLECTION={only_plugin_collection[:5]} "
                f"ONLY_JUNIT_COLLECTION={only_junit_collection[:5]}"
            )
        if abs(size_delta) > 0:
            failures_of_the_gate.append(
                f"FEEDER DISAGREEMENT on collection size — plugin={len(collected)} "
                f"junit={n_junit_cases} delta={size_delta}"
            )
        # 🛑 The success sentence may claim collection agreement ONLY when BOTH
        # membership directions are empty. `A CAPTION IS A CLAIM.`
        if not (
            only_plugin
            or only_junit
            or size_delta
            or only_plugin_collection
            or only_junit_collection
        ):
            print("             feeders AGREE on failure membership, collection "
                  "membership and size")
    else:
        failures_of_the_gate.append("SELF-CHECK IMPOSSIBLE: no junitxml second recorder supplied")

    # --- (5) collection presence of every baseline-named test ---------------
    base_norm = set(base["failures"])
    left_collection = sorted(base_norm - collected)
    print(f"[5] baseline-named tests missing from COLLECTION : {len(left_collection)}")
    if left_collection:
        for n in left_collection[:10]:
            print(f"      GONE FROM COLLECTION: {n}")
        failures_of_the_gate.append(
            f"COLLECTION PRESENCE: {len(left_collection)} baseline-named test(s) are no "
            f"longer collected. A test that stops being collected reads as NEW=0."
        )

    # --- (6) collected but not executed -------------------------------------
    unexecuted = collected - executed
    undisposed = sorted(unexecuted - skipped - xfailed)
    print(f"[6] collected-but-unexecuted             : {len(unexecuted)} "
          f"(without allowed disposition: {len(undisposed)})")
    if undisposed:
        for n in undisposed[:10]:
            print(f"      UNEXECUTED, NO DISPOSITION: {n}")
        failures_of_the_gate.append(
            f"{len(undisposed)} collected test(s) never executed and carry no "
            f"allowed disposition (skip/xfail)."
        )

    # --- (7)(8) failure membership by exact node ID -------------------------
    new = sorted(plugin_failures - base_norm)
    gone = sorted(base_norm - plugin_failures)
    print(f"[7/8] NEW failures (by node ID)          : {len(new)}")
    for n in new[:15]:
        print(f"      NEW:  {n}")
    print(f"[7/8] GONE failures (by node ID)         : {len(gone)}")
    for n in gone[:15]:
        print(f"      GONE: {n}")
    if new:
        failures_of_the_gate.append(f"{len(new)} NEW failure(s) not in the baseline.")

    # --- (R-791 §4.1) GONE IS ENFORCED, NOT MERELY PRINTED --------------------
    # F-ACCEPT5-1: `gone` was computed and printed and never reached the refusal
    # list, so a baseline red that went green, stayed collected and produced no
    # feeder disagreement let the gate PASS. The campaign criterion is
    # ADDITIONS FORBIDDEN, SUBTRACTIONS NAMED AND EXPLAINED — for S6 the only
    # authorized subtraction is the two ordered_6b_reds.
    authorized_gone = set(base["ordered_6b_reds"])
    unauthorized_gone = sorted(set(gone) - authorized_gone)
    print(f"[7/8] authorized GONE (ordered_6b_reds)  : {len(authorized_gone)}")
    print(f"[7/8] UNAUTHORIZED GONE                  : {len(unauthorized_gone)}")
    for n in unauthorized_gone[:15]:
        print(f"      UNAUTHORIZED GONE: {n}")
    if unauthorized_gone:
        failures_of_the_gate.append(
            f"UNAUTHORIZED GONE: {len(unauthorized_gone)} baseline failure(s) stopped "
            f"failing without authorization. Only the {len(authorized_gone)} "
            f"ordered_6b_reds may leave the failure set."
        )

    # --- (R-792 §5.1) THE OTHER SET DIRECTION ---------------------------------
    # F-ACCEPT5-4: enforcing only `gone ⊆ authorized` while the caption asserts
    # `gone == authorized` leaves the converse open. An authorized 6B red that
    # starts FAILING again shrinks `gone`, adds no NEW (it was already a
    # baseline failure), trips no feeder disagreement — and the gate PASSED.
    #   `A REPAIR THAT FIXES THE INSTANCE AND NOT THE CLASS RE-CREATES THE
    #    DEFECT IN THE SAME COMMIT.`
    missing_authorized_gone = sorted(authorized_gone - set(gone))
    print(f"[7/8] MISSING AUTHORIZED GONE            : {len(missing_authorized_gone)}")
    for n in missing_authorized_gone[:15]:
        print(f"      MISSING AUTHORIZED GONE: {n}")
    if missing_authorized_gone:
        failures_of_the_gate.append(
            f"MISSING AUTHORIZED GONE: {len(missing_authorized_gone)} authorized "
            f"ordered_6b_red(s) did NOT leave the failure set. The S6 result requires "
            f"GONE to EQUAL the authorized set, not merely be contained in it."
        )

    # --- (R-791 §4.3) THE SEALED COLLECTION MUST REMAIN COLLECTED -------------
    # F-ACCEPT5-2: protecting only baseline FAILURES leaves every previously
    # GREEN sealed test unguarded — rename it, delete it, or hide it behind a
    # skip-producing import error and no check notices.
    if seal is not None:
        # SEAL PREFLIGHT FIRST — the seal is not used for anything until it has
        # been validated against the runner's own out-of-band contract.
        seal_problems = validate_seal(seal)
        print(f"[SEAL] preflight problems                : {len(seal_problems)}")
        for pr in seal_problems:
            print(f"      {pr}")
        failures_of_the_gate.extend(seal_problems)

        sealed_pop = set(seal["collected_population"])

        # --- R3-2 / F-R2-2: guard the SUCCESSOR population, not just the root -
        # The root seal predates every test admitted since. Guarding only it
        # leaves each approved addition unprotected — exactly the hole R-799 §4
        # opened the chain to close. FAIL-CLOSED: a chain that cannot be read
        # refuses; it never falls back to the root seal, because falling back
        # would silently shrink the guarded set to the one that already passes.
        # Scoped exactly as the supplemental arrow is: the chain states what the
        # CANONICAL population must contain. Holding a fixture run to it would
        # report thousands of "missing" members that the fixture never claimed.
        required_pop = sealed_pop
        chain_problems = []
        if args.manifest.resolve() != MANIFEST.resolve():
            print("[CHAIN] non-canonical --manifest: chain obligation NOT applied")
        else:
            try:
                import population_successor as _popsucc
                required_pop, chain_problems = _popsucc.required_population(REPO)
            except Exception as exc:  # noqa: BLE001 - any failure here must REFUSE
                chain_problems = [
                    f"POPULATION CHAIN UNAVAILABLE: {type(exc).__name__}: {exc}. The "
                    f"successor chain could not be derived, so the required population "
                    f"is unknown and no authoritative verdict may be issued."
                ]
        print(f"[CHAIN] required population (seal+chain) : {len(required_pop)} node IDs")
        print(f"[CHAIN] chain problems                   : {len(chain_problems)}")
        for pr in chain_problems:
            print(f"      {pr}")
        failures_of_the_gate.extend(chain_problems)

        vanished = sorted(required_pop - collected)
        print(f"[SEAL] sealed collection @ {str(seal.get('graded_sha'))[:8]} : {len(sealed_pop)} node IDs")
        print(f"[SEAL] required members no longer collected : {len(vanished)}")
        for n in vanished[:15]:
            print(f"      REQUIRED COLLECTION MEMBER MISSING: {n}")
        if vanished:
            failures_of_the_gate.append(
                f"REQUIRED COLLECTION MEMBER MISSING: {len(vanished)} test(s) that the "
                f"root seal or an approved successor requires are no longer collected. "
                f"New tests may be added; no required test may silently vanish."
            )
    else:
        failures_of_the_gate.append(
            "NO SEALED COLLECTION SUPPLIED: --seal is required. Without it a "
            "previously-green sealed test can vanish unseen (F-ACCEPT5-2)."
        )

    # --- F-3: SEALED DISPOSITIONS — PASS→SKIP / PASS→XFAIL ------------------
    if DISPOSITION_SEAL.is_file():
        disp = json.loads(DISPOSITION_SEAL.read_text(encoding="utf-8"))
        disp_problems = validate_disposition_seal(disp)
        print(f"[DISP] preflight problems                : {len(disp_problems)}")
        for pr in disp_problems:
            print(f"      {pr}")
        failures_of_the_gate.extend(disp_problems)

        disp_pop = set(disp["sealed_population"])
        # 🛑 SCOPED TO THE SEALED POPULATION on purpose: a NEWLY ADDED test may
        # legally skip without tripping this gate, while no SEALED test may change
        # disposition in EITHER direction.
        for label, current, sealed_members, authorized in (
            ("SKIP", skipped, set(disp["sealed_skipped"]),
             set(DISPOSITION_AUTHORIZED_UNSKIPPED)),
            ("XFAIL", xfailed, set(disp["sealed_xfailed"]),
             set(DISPOSITION_AUTHORIZED_UNXFAILED)),
        ):
            # An authorization naming a test that was never in this disposition at
            # the seal cannot authorize anything — and left unchecked it would be a
            # blank cheque for future drift.
            phantom = sorted(authorized - sealed_members)
            if phantom:
                failures_of_the_gate.append(
                    f"AUTHORIZED {label} LIST IS INVALID: {len(phantom)} member(s) were "
                    f"never {label} at the seal: {phantom}. An authorization for a change "
                    f"that never existed can only widen what passes."
                )

            current_in_sealed = set(current) & disp_pop
            newly = sorted(current_in_sealed - sealed_members)

            # 🛑 F-ACCEPT5-7 (R-795 §2). `authorized` was subtracted in ONE direction
            # only, so an AUTHORIZED test that RETURNS to this disposition re-entered
            # `current_in_sealed` (leaving `no_longer`) and was in `sealed_members`
            # (so it never entered `newly`). NEITHER check fired and the gate PASSED
            # on a violated state. `observed ⊆ authorized` is not `observed ==`.
            #
            # This is `MISSING AUTHORIZED GONE` (:570) one dimension over: that mirror
            # was built for the FAILURE dimension by R-792 and the DISPOSITION
            # dimension, added later, copied the shape and not the lesson.
            observed_removed = sealed_members - current_in_sealed
            no_longer = sorted(observed_removed - authorized)
            missing_authorized = sorted(authorized - observed_removed)
            print(_disposition_drift_line(label, newly, no_longer, missing_authorized))
            # 🛑 THREE REFUSALS, BY MEMBERSHIP, NEVER COUNTS — and the caption now
            # matches the code. It previously said "BOTH DIRECTIONS" while the
            # authorized subset had exactly ONE, which is worse than no caption:
            # `A COMMENT THAT OVER-STATES A GUARD MAKES THE NEXT READER VERIFY THE
            #  CAPTION INSTEAD OF THE CODE.`
            #   newly              — a sealed test acquired this disposition
            #   no_longer          — an UNAUTHORIZED sealed test lost it
            #   missing_authorized — an AUTHORIZED change did NOT actually happen
            # A balanced swap leaves every aggregate count identical, so counts
            # cannot see any of the three.
            if missing_authorized:
                for n in missing_authorized[:10]:
                    print(f"      MISSING AUTHORIZED DISPOSITION CHANGE ({label}): {n}")
                failures_of_the_gate.append(
                    f"MISSING AUTHORIZED DISPOSITION CHANGE: {len(missing_authorized)} "
                    f"test(s) are authorized to have stopped being {label} but are "
                    f"{label} right now. An authorization is a statement that a change "
                    f"HAPPENED; if it did not, the authorization is hiding the reversal."
                )
            if newly:
                for n in newly[:10]:
                    print(f"      SEALED TEST NEWLY {label}: {n}")
                failures_of_the_gate.append(
                    f"SEALED DISPOSITION CHANGED: {len(newly)} sealed test(s) are now "
                    f"{label} that were RUNNING at the seal. A test that stops running "
                    f"reads as NEW=0 while its assertion no longer executes."
                )
            if no_longer:
                for n in no_longer[:10]:
                    print(f"      SEALED TEST NO LONGER {label}: {n}")
                failures_of_the_gate.append(
                    f"SEALED DISPOSITION CHANGED: {len(no_longer)} sealed test(s) are no "
                    f"longer {label} though they were at the seal. Re-enabling is likely "
                    f"good news, but it is a POPULATION CHANGE and must be declared, not "
                    f"absorbed."
                )
    else:
        failures_of_the_gate.append(
            "NO SEALED DISPOSITIONS SUPPLIED: the disposition seal is required. "
            "Without it a sealed test can go PASS->SKIP and the gate reads NEW=0 (F-3)."
        )

    # F-ACCEPT5-6, THE WORKED EXAMPLE: this block already computed "FAILING" —
    # which IS `MISSING AUTHORIZED GONE` — and then only printed it. The
    # judgement is now GATED above; what remains here is context, so it is
    # labelled NOTE: rather than left looking like an unenforced verdict.
    print("NOTE: [9] ordered_6b_reds live status (GATED above):")
    for n in base["ordered_6b_reds"]:
        nn = n
        state = ("FAILING" if nn in plugin_failures else
                 "NOT COLLECTED" if nn not in collected else
                 "COLLECTED BUT NOT FAILING")
        print(f"NOTE:       {state:<26} {nn}")

    # --- verdict -------------------------------------------------------------
    print()
    for n in notes:
        print(f"NOTE: {n}")
    print("=" * 72)
    if failures_of_the_gate:
        print("ACCEPTANCE: REFUSED")
        for f in failures_of_the_gate:
            print(f"  - {f}")
        print("=" * 72)
        return 1
    # R-799 SS2 ARCHITECTURAL SPLIT, ADOPTED.
    #
    # `--run` MAY issue an authoritative PASS, because it executed the population itself
    # and every join in the fresh-run protocol above held. `--from-run` MAY NOT: it
    # consumes a bundle it did not produce, so it can attest that the RECORDED evidence
    # would satisfy today's scoring, and nothing at all about whether a run happened.
    #
    #   `THE DEFECT IS NOT THAT OLD EVIDENCE MAY BE READ -- IT IS THAT OLD EVIDENCE MAY
    #    MASQUERADE AS A NEW RUN.`
    #
    # Emitting the same word for both is precisely how F-R2-1 stayed invisible.
    if not args.run:
        print("ACCEPTANCE: ADVISORY / FORENSIC - this previously recorded bundle would "
              "satisfy current scoring.")
        print("  This is NOT an authoritative PASS and may not be cited as sign-off "
              "evidence: --from-run did not execute anything, so it cannot attest that "
              "the run it is reading ever happened. Re-run with --run for a verdict "
              "carrying release authority.")
        print("=" * 72)
        return 0
    print("ACCEPTANCE: PASS — NEW=0; GONE matches the authorized set; "
          "sealed collection intact; both recorders of the report stream agree.")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
