"""R3-1 PERMANENT RED — F-R2-1: the acceptance instrument scores a run that never happened.

WHAT THIS PROVES
    scripts/acceptance_runner.py:439 calls `subprocess.run(cmd, cwd=REPO)` as a BARE
    EXPRESSION STATEMENT. The return value is discarded: no `check=`, no binding, no
    `returncode` read. The very next statement (:443) is
    `json.loads(Path(run_json).read_text(...))`.

    So when pytest fails BEFORE it executes the governed population, no new artifacts are
    written, and the runner silently scores the PREVIOUS run's JSON/XML. The verdict it
    prints is a statement about the last time somebody measured the tree, not about the
    tree.

THE ORACLE IS STALE CONSUMPTION, NOT THE LITERAL WORD "PASS"  (R-803 SS1)
    An earlier draft of this contract asserted that the instrument emits `ACCEPTANCE: PASS`
    from stale evidence. That oracle was withdrawn because reaching `PASS` requires a
    NON-HERMETIC tree (one carrying a CRLF copy of the failure baseline, per F-ACCEPT5-8),
    and R-801 SS4 binds: this test becomes a gate input the day it lands, so it must itself
    satisfy R-799 SS5. A test that only reproduces on one working copy is the disease this
    lane exists to cure.

    Stale CONSUMPTION is the stronger claim anyway, and it is tree-independent:
      [a] the runner REPORTS a pytest exit status that DISAGREES with the real one
      [b] the artifact SHAs are UNCHANGED across the failed run
      [c] the runner's verdict output is BYTE-IDENTICAL to the prior good run
      [d] the real pytest process FAILED BEFORE executing the governed population   (R-804)

    "It printed PASS once" says the gate was wrong once. "Its output is byte-identical
    whether or not the tests ran" says the gate is not connected to the tree at all.

HERMETICITY  (R-799 SS5 permitted form [2]; STOP [12])
    Every input is either committed governed evidence or a fixture this test creates:
      - the manifest is written here, into tmp_path, with bytes this test controls
      - it names ONE committed governed member, resolved from the EXECUTING tree
      - no absolute paths, no home paths, no other-worktree paths, no network, no
        credentials, and nothing copied in from this machine
    It therefore reproduces on a conforming checkout, which is where it was verified.

NO RECURSION
    The fixture manifest deliberately does NOT name this file, so the inner runner never
    re-enters this test even if this file is later admitted to the canonical population.

RED/GREEN CONTRACT
    RED  today: the runner consumes the stale artifacts and never refuses.
    GREEN after the R-799 SS2 fresh-run protocol lands: the identical test reads
         "ACCEPTANCE INSTRUMENT REFUSED - PYTEST RUN INVALID".
    The [a]-[d] evidence is emitted in the failure message so a reader can see WHY it is
    red without re-deriving it.
"""

import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
RUNNER = REPO / "scripts" / "acceptance_runner.py"

# One COMMITTED governed member. Cheap to execute and, critically, NOT this file.
FIXTURE_MEMBER = "engine/tests/test_fvg_identity_dispatch.py"

# The env that makes pytest fail during argument parsing, i.e. before collection and
# therefore before any governed test can run.
BREAK_PYTEST = {"PYTEST_ADDOPTS": "--this-option-does-not-exist"}

REFUSAL = "ACCEPTANCE INSTRUMENT REFUSED - PYTEST RUN INVALID"


def _sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _verdict_block(stdout):
    """The runner's OWN output, which begins at its first `NOTE: ` line.

    Everything before that is the pytest child's stdout, inherited straight through. The
    runner never reads it, so including it would compare the CHILD's noise rather than the
    INSTRUMENT's report -- and the child does print a different error when it cannot start,
    which would mask the very identity this test exists to expose.
    """
    lines = stdout.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("NOTE: "):
            return "\n".join(lines[i:])
    return ""


def _run_runner(out_dir, manifest, extra_env=None):
    env = dict(os.environ)
    env.pop("PYTEST_ADDOPTS", None)  # never inherit a stray one into the control arm
    env.update(extra_env or {})
    return subprocess.run(
        [sys.executable, str(RUNNER), "--run",
         "--manifest", str(manifest), "--out-dir", str(out_dir)],
        cwd=REPO, env=env, capture_output=True, text=True, timeout=900,
    )


def test_acceptance_runner_refuses_when_pytest_could_not_run(tmp_path):
    """The gate must refuse an invalid pytest execution instead of scoring the last one."""
    assert RUNNER.is_file(), "runner not found at {}".format(RUNNER)
    assert (REPO / "src" / FIXTURE_MEMBER).is_file(), (
        "fixture member missing from the executing tree: {}".format(FIXTURE_MEMBER)
    )

    manifest = tmp_path / "fixture-manifest.txt"
    manifest.write_text(
        "# fixture manifest created by this test (R-799 SS5 permitted form [2])\n"
        + FIXTURE_MEMBER + "\n",
        encoding="utf-8",
    )
    out_dir = tmp_path / "out"

    # --- ARM 1: a real, valid run. Mints the artifacts that arm 2 must not reuse. -------
    good = _run_runner(out_dir, manifest)
    # Discover arm 1's artifacts wherever the runner chose to put them. Deliberately
    # NOT a hardcoded `out_dir/acceptance-run.json`: the fresh-run protocol writes into
    # a UNIQUE per-run subdirectory, and pinning the old flat path would make this test
    # fail for a reason that has nothing to do with the defect it exists to convict.
    # The ORACLE below is untouched by this; only the discovery is version-agnostic.
    found_json = sorted(out_dir.rglob("acceptance-run.json"))
    found_xml = sorted(out_dir.rglob("acceptance-run.xml"))
    assert found_json and found_xml, (
        "arm 1 produced no artifacts, so this test cannot measure staleness.\n"
        "stdout:\n" + good.stdout[-2000:]
    )
    run_json, run_xml = found_json[0], found_xml[0]
    sha_before = (_sha(run_json), _sha(run_xml))
    verdict_before = _verdict_block(good.stdout)
    assert verdict_before, "arm 1 emitted no runner verdict block"

    # --- [d] POSITIVE CONTROL: prove the pytest in arm 2 genuinely cannot run. ----------
    # Without this, "the runner reported the wrong exit" is also satisfied by a pytest that
    # ran fine -- a negative claim needs a positive witness that the path actually failed.
    ctl_env = dict(os.environ)
    ctl_env.update(BREAK_PYTEST)
    control = subprocess.run(
        [sys.executable, "-m", "pytest", "src/" + FIXTURE_MEMBER, "-q", "--no-header"],
        cwd=REPO, env=ctl_env, capture_output=True, text=True, timeout=900,
    )
    assert control.returncode not in (0, 1), (
        "[d] positive control FAILED: pytest was expected to fail before executing the "
        "governed population, but exited {}, which is a legitimate execution status. "
        "The rest of this test would be measuring nothing.".format(control.returncode)
    )

    # --- ARM 2: identical invocation, but pytest cannot start. -------------------------
    stale = _run_runner(out_dir, manifest, BREAK_PYTEST)
    sha_after = (_sha(run_json), _sha(run_xml))
    verdict_after = _verdict_block(stale.stdout)

    reported = re.search(r"\(pytest exit (\d+)\)", stale.stdout)

    evidence = "\n".join([
        "",
        "F-R2-1 EVIDENCE (why this test is red):",
        "  [a] runner REPORTED pytest exit : {}".format(
            reported.group(1) if reported else "<not reported>"),
        "      REAL subprocess exit         : {} (pytest failed before collection)".format(
            control.returncode),
        "  [b] artifact SHAs before         : {} / {}".format(
            sha_before[0][:16], sha_before[1][:16]),
        "      artifact SHAs after          : {} / {}".format(
            sha_after[0][:16], sha_after[1][:16]),
        "      unchanged                    : {}".format(sha_before == sha_after),
        "  [c] verdict output identical     : {} ({} lines)".format(
            verdict_before == verdict_after, len(verdict_before.splitlines())),
        "",
        "  A real run and no run at all are indistinguishable in this instrument's own",
        "  report. The cross-check between the plugin JSON and the JUnit XML cannot catch",
        "  it, because both feeders are stale for the same reason -- that is one path read",
        "  twice, not two paths.",
        "",
    ])

    assert REFUSAL in stale.stdout, (
        "The acceptance runner did NOT refuse an invalid pytest execution. It consumed the "
        "artifacts of the PREVIOUS run and issued a verdict about a run that never "
        "happened." + evidence
    )
