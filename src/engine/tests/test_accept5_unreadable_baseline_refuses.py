"""R3-5 item B — an unreadable or unparseable baseline must produce a NAMED
refusal, not a traceback.

THE DEFECT THIS CONVICTS
    The baseline preflight already refuses a malformed baseline correctly: it
    returns its refusal strings and they are appended to the gate's failures.

    Then the very next statement reads the same file again, unconditionally:

        baseline_problems = validate_baseline_bytes(args.baseline)   # refuses
        ...
        base = read_baseline(args.baseline)                          # crashes

    `read_baseline` does a bare `json.loads(path.read_text())` and then subscripts
    `d["failures"]` and `d["ordered_6b_reds"]` directly. So the instrument that
    just decided the baseline is untrustworthy immediately tries to parse it, dies
    with a traceback, and NEVER REACHES ITS OWN VERDICT LINE.

    A missing or permission-denied baseline dies even earlier, at the unguarded
    `path.read_bytes()` inside the preflight itself -- before a single refusal is
    printed.

      `A GATE THAT CRASHES INSTEAD OF REFUSING HAS NOT FAILED CLOSED. IT HAS
       FAILED WITHOUT A VERDICT, AND A CALLER READING THE EXIT CODE CANNOT TELL
       THAT APART FROM THE INSTRUMENT BEING BROKEN.`

WHY THIS IS CHEAP TO TEST
    The baseline preflight runs BEFORE the `--run` pytest subprocess is launched,
    so both arms fail in well under a second and never execute the population.

WHAT "NAMED" BUYS
    A caller must be able to branch on WHY authority was refused without parsing
    English prose. Both arms therefore assert a stable code token, not a sentence.

HERMETICITY
    Every input is written by this test into tmp_path, plus one committed governed
    member named for the manifest. No absolute paths, no network, and the canonical
    baseline is read for the control arm but never written to.
"""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
RUNNER = REPO / "scripts" / "acceptance_runner.py"
BASELINE = (
    REPO / "docs" / "replay-results" / "h1-battery"
    / "acceptance-baseline-2026-08-09.json"
)

# One committed governed member, cheap to execute and NOT this file (no recursion).
FIXTURE_MEMBER = "engine/tests/test_fvg_identity_dispatch.py"

CODE_UNREADABLE = "BASELINE_UNREADABLE"
CODE_UNPARSEABLE = "BASELINE_UNPARSEABLE"


def _load_runner():
    spec = importlib.util.spec_from_file_location("acceptance_runner_under_test", RUNNER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run_with_baseline(tmp_path, baseline, name):
    manifest = tmp_path / "{}-manifest.txt".format(name)
    manifest.write_text(
        "# fixture manifest created by this test (R-799 SS5 permitted form [2])\n"
        + FIXTURE_MEMBER + "\n",
        encoding="utf-8",
    )
    env = dict(os.environ)
    env.pop("PYTEST_ADDOPTS", None)
    return subprocess.run(
        [sys.executable, str(RUNNER), "--run",
         "--manifest", str(manifest),
         "--out-dir", str(tmp_path / "{}-out".format(name)),
         "--baseline", str(baseline)],
        cwd=REPO, env=env, capture_output=True, text=True, timeout=900,
    )


def _assert_named_refusal(proc, code, arm):
    combined = proc.stdout + proc.stderr
    assert "Traceback (most recent call last)" not in combined, (
        "{}: the runner CRASHED instead of refusing.\n{}".format(arm, combined[-2000:])
    )
    assert "ACCEPTANCE: REFUSED" in proc.stdout, (
        "{}: no REFUSED verdict was emitted.\n{}".format(arm, combined[-2000:])
    )
    assert code in proc.stdout, (
        "{}: refused, but without the deterministic code {!r}.\n{}".format(
            arm, code, combined[-2000:])
    )
    assert proc.returncode == 1, (
        "{}: expected exit 1 for a refusal, got {}".format(arm, proc.returncode)
    )


def test_unparseable_baseline_is_a_named_refusal_not_a_crash(tmp_path):
    bad = tmp_path / "malformed-baseline.json"
    bad.write_bytes(b'{"failures": [ this is not json')
    _assert_named_refusal(
        _run_with_baseline(tmp_path, bad, "unparseable"),
        CODE_UNPARSEABLE, "unparseable arm",
    )


def test_missing_baseline_is_a_named_refusal_not_a_crash(tmp_path):
    missing = tmp_path / "no-such-baseline.json"
    assert not missing.exists()
    _assert_named_refusal(
        _run_with_baseline(tmp_path, missing, "missing"),
        CODE_UNREADABLE, "missing arm",
    )


def test_valid_baseline_is_behaviorally_unchanged():
    """The control: the governed baseline still passes preflight with zero refusals.

    Kept at function level deliberately. Driving the whole runner here would
    conflate this claim with every unrelated reason the gate can refuse on a given
    tree, and the claim under test is only that the valid path was not disturbed.
    """
    mod = _load_runner()
    assert mod.validate_baseline_bytes(BASELINE) == []
