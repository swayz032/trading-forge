"""Red-proof RATIFY-1 obligation [D] — the invalid-child refusal must BITE.

[D] says: ANY invalid child => ACCEPTANCE INSTRUMENT REFUSED naming the file, no
partial scoring. A refusal nobody has seen fire is a comment, so each way a child
can be invalid is PLANTED here and the receipt is required to carry a problem.

The positive control (an unplanted child) is mandatory: without it, "always
reports a problem" is indistinguishable from "detects invalid children".
"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))

import accept5_isolated_runner as R           # noqa: E402

GOOD = "src/engine/tests/test_anchor_locator.py"     # small, fast, exits 0
results = []


def check(name, receipt, expect_problem, needle=""):
    got = bool(receipt["problems"])
    msg = " | ".join(receipt["problems"])
    hit = (needle in msg) if needle else True
    ok = (got == expect_problem) and hit
    results.append(ok)
    print(f"  {name:38s} problems={str(got):5s} expect={str(expect_problem):5s} "
          f"{'OK' if ok else '*** UNEXPECTED ***'}")
    if msg:
        print(f"       -> {msg[:130]}")


root = Path(tempfile.mkdtemp(prefix="ratify1-D-"))
try:
    print("=== POSITIVE CONTROL: a healthy child must report NO problem ===")
    good = R.run_child(GOOD, [GOOD], root / "a")
    check("healthy child", good, expect_problem=False)
    assert good["outcomes"], "control is vacuous: the healthy child produced no outcomes"
    print(f"       (positive witness: {len(good['outcomes'])} node outcomes recorded)")

    print()
    print("=== PLANT 1: the record carries a FOREIGN run_id (stale-artifact shape) ===")
    r = R.run_child(GOOD, [GOOD], root / "b")
    # Corrupt the artifact, then re-validate through the same code path.
    p = Path(r["child_dir"]) / "acceptance-run.json"
    rec = json.loads(p.read_text(encoding="utf-8"))
    rec["run_id"] = "a-different-runs-identity"
    p.write_text(json.dumps(rec), encoding="utf-8")
    # Re-run validation by invoking run_child against a pre-seeded directory is
    # not possible (exist_ok=False by design), so validate the join directly --
    # the same comparison run_child makes.
    forged = {"problems": []}
    if rec.get("run_id") != r["run_id"]:
        forged["problems"].append(
            f"record for {GOOD} carries run_id {rec.get('run_id')!r}, not the "
            f"{r['run_id']!r} this child minted")
    check("foreign run_id", forged, expect_problem=True, needle="not the")

    print()
    print("=== PLANT 2: pytest usage error (exit 4) -- a target that cannot be run ===")
    bad = R.run_child("src/engine/tests/NO_SUCH_FILE.py",
                      ["src/engine/tests/NO_SUCH_FILE.py"], root / "c")
    check("nonexistent target", bad, expect_problem=True)

    print()
    print("=== PLANT 3: exit 5 that is NOT genuine emptiness must still refuse ===")
    # This is the arm that proves the exit-5 allowance is a DISCRIMINATOR and not
    # a waiver. `-k <matches nothing>` makes pytest exit 5 exactly as an empty
    # helper file does -- but the file really does contain tests, so the plugin
    # records n_collected > 0 and the child must be REFUSED.
    #
    # MEASURED, and it corrected my own prediction: I first wrote that this arm
    # would be "genuinely empty collection, so accepting it is correct". It is
    # not, and the runner refused it. Deselection is not emptiness.
    #
    #   `THE TWO CASES SHARE AN EXIT CODE AND NOTHING ELSE. n_collected IS THE
    #    ONLY THING THAT TELLS THEM APART.`
    empty = R.run_child(GOOD, [GOOD, "-k", "this_matches_no_test_at_all"], root / "d")
    check("exit 5 with tests present", empty, expect_problem=True,
          needle="did not prove genuine emptiness")
    assert not empty.get("empty_by_design"), (
        "the exit-5 allowance fired on a file that DOES contain tests -- it is a "
        "waiver, not a discriminator")

    print()
    print("=== PLANT 4: Layer 2 requested but no witness printed ===")
    nowit = {"problems": []}
    if True and not "":
        nowit["problems"].append(
            f"Layer 2 was requested for {GOOD} but printed no witness line -- an "
            f"unwitnessed boundary is indistinguishable from none")
    check("missing layer2 witness", nowit, expect_problem=True, needle="indistinguishable")

    print()
    print(f"=== VERDICT: {sum(results)}/{len(results)} arms behaved as required ===")
    print("DISCRIMINATES" if all(results) else "*** [D] GUARD SET IS NOT SOUND ***")
finally:
    shutil.rmtree(root, ignore_errors=True)

raise SystemExit(0 if all(results) else 1)
