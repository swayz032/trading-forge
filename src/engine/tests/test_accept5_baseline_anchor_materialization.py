"""R3-5 item D / F-ACCEPT5-8 — the failure baseline's anchor must identify the
ARTIFACT, not the accident of how one working copy materialized it.

THE DEFECT THIS CONVICTS
    `validate_baseline_bytes()` step (1) hashed `path.read_bytes()` — the file
    exactly as it sat on disk. `.gitattributes` declares this path `text eol=lf`,
    so a CONFORMING checkout materializes LF; the approved constant was computed
    over a working copy carrying 66 CR bytes. The anchor therefore accepted
    exactly one materialization and refused the artifact git actually committed.

    `git status` cannot warn about this: it compares NORMALIZED content, which
    matched the blob perfectly. The one tool that would have caught it is blind
    to it by design.

      `AN ANCHOR PINNED TO A MATERIALIZATION ACCIDENT OF ONE WORKING COPY IS NOT
       PINNING THE ARTIFACT.`

WHY THIS TEST IS TREE-INDEPENDENT (R-799 §5; the trap that killed an earlier draft)
    It does not ask "does the local copy pass?" — that question has a different
    answer in each checkout. It builds BOTH materializations from the committed
    artifact and requires the anchor to answer IDENTICALLY for both.

    So before the repair it is RED on every checkout, merely on a different arm:
    non-conforming trees fail the LF arm, conforming trees fail the CRLF arm.
    It cannot go green by accident of where it ran.

THE DISCRIMINATING CONTROL IS THE POINT
    An anchor that accepted both line endings by going BLIND would satisfy the
    first test and be worse than the defect. So the second test mutates a field
    that NO other preflight step inspects — the artifact's description string,
    which is not the measured_at_sha, not the failure count, not the membership
    digest and not `ordered_6b_reds`. Only the identity anchor can catch it.

HERMETICITY
    Inputs are the committed governed baseline resolved from the EXECUTING tree
    plus copies this test writes into tmp_path. No absolute paths, no network,
    no other worktree, and the canonical evidence itself is never written to.
"""

import importlib.util
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
RUNNER = REPO / "scripts" / "acceptance_runner.py"
BASELINE = (
    REPO / "docs" / "replay-results" / "h1-battery"
    / "acceptance-baseline-2026-08-09.json"
)


def _load_runner():
    """Import the runner as a module without putting scripts/ on sys.path."""
    spec = importlib.util.spec_from_file_location("acceptance_runner_under_test", RUNNER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _both_materializations(raw: bytes):
    """The same artifact as a conforming checkout and as a CRLF checkout see it."""
    lf = raw.replace(b"\r\n", b"\n")
    crlf = lf.replace(b"\n", b"\r\n")
    return lf, crlf


def test_baseline_anchor_accepts_both_materializations(tmp_path):
    """LF and CRLF are the same artifact; the anchor must say so on both."""
    assert BASELINE.is_file(), "governed baseline not found at {}".format(BASELINE)
    mod = _load_runner()

    lf, crlf = _both_materializations(BASELINE.read_bytes())
    assert lf != crlf, "fixture is degenerate: the two forms are byte-identical"

    lf_path = tmp_path / "baseline_lf.json"
    lf_path.write_bytes(lf)
    crlf_path = tmp_path / "baseline_crlf.json"
    crlf_path.write_bytes(crlf)

    lf_probs = mod.validate_baseline_bytes(lf_path)
    crlf_probs = mod.validate_baseline_bytes(crlf_path)

    assert lf_probs == [], "LF materialization refused: {}".format(lf_probs)
    assert crlf_probs == [], "CRLF materialization refused: {}".format(crlf_probs)


def test_baseline_anchor_still_refuses_a_change_no_other_step_inspects(tmp_path):
    """The positive witness that the anchor did not simply go blind.

    `artifact` is a description string. It is not covered by measured_at_sha, the
    failure count, the membership digest, or the ordered_6b_reds check — so a
    refusal here can only have come from the identity anchor itself.
    """
    mod = _load_runner()
    lf, _ = _both_materializations(BASELINE.read_bytes())

    parsed = json.loads(lf)
    assert "artifact" in parsed, "fixture assumption broken: no `artifact` key"
    parsed["artifact"] = parsed["artifact"] + " (TAMPERED)"

    # Written LF, so a line-ending difference cannot be confused for the cause.
    tampered = tmp_path / "baseline_tampered.json"
    tampered.write_bytes(json.dumps(parsed, indent=1).encode("utf-8"))

    probs = mod.validate_baseline_bytes(tampered)

    assert probs, "a tampered baseline was accepted — the anchor is blind"
    assert any("BASELINE INTEGRITY FAILURE" in p for p in probs), (
        "refused, but not by an integrity anchor: {}".format(probs)
    )
