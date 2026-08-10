"""Generate ACCEPT-5's DISPOSITION SEAL — which sealed tests were SKIPPED or XFAILED.

AUTHORITY: R-794 §6 lane `E`, defect `F-3`.

WHY A THIRD ARTIFACT, AND WHY IT IS NOT A LUXURY
------------------------------------------------
`ACCEPT-5` already holds two sealed artifacts and they answer two different
questions:

  acceptance-baseline-2026-08-09.json    WHICH TESTS WERE FAILING before S6
  acceptance-collection-seal-08062e12.json   WHICH TESTS EXISTED AND COLLECTED

Neither can see a test that goes `PASS → SKIP`. It is still collected, so the
collection seal is satisfied; it never failed, so it is not in the failure
baseline; and it produces no feeder disagreement. The gate reports `NEW=0` and
PASSES while a load-bearing assertion has silently stopped running.

    `A TEST THAT IS SKIPPED IS NOT A TEST THAT PASSED — AND A GATE THAT CANNOT
     TELL THEM APART IS A GATE THAT CAN BE TURNED OFF ONE DECORATOR AT A TIME.`

🛑 COUNTS ARE NOT ENOUGH, AND THAT IS THE WHOLE POINT OF SEALING MEMBERSHIP:
a BALANCED swap — one sealed test starts skipping while a previously-skipped one
starts passing — leaves the aggregate skip count identical. Only membership sees it.

WHY THIS RUNS THE POPULATION INSTEAD OF COLLECTING IT
-----------------------------------------------------
`generate_collection_seal.py` uses `--collect-only`, which is correct for its
question: existence is a collection-time property. A DISPOSITION is an
execution-time property — a test is not skipped until it is run and skips — so
this generator must actually execute the population at the pinned commit.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tree", type=Path, required=True,
                    help="worktree pinned at the sealed commit")
    ap.add_argument("--plugin-dir", type=Path, required=True,
                    help="isolated dir holding acceptance_pytest_plugin.py")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--scratch", type=Path, required=True,
                    help="where the plugin writes its raw run record")
    args = ap.parse_args()

    tree = args.tree.resolve()
    graded_sha = subprocess.run(
        ["git", "-C", str(tree), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True).stdout.strip()

    manifest_rel = "src/engine/tests/canonical_regression_population.txt"
    manifest_path = tree / manifest_rel
    members = [
        s.strip() for s in manifest_path.read_text(encoding="utf-8").splitlines()
        if s.strip() and not s.strip().startswith("#")
    ]

    raw = args.scratch.resolve()
    targets = [f"src/{m}" for m in members]
    # 🛑 NO `--collect-only`: a disposition is an execution-time fact.
    cmd = [sys.executable, "-m", "pytest", *targets,
           "-q", "--no-header", "-p", "no:cacheprovider",
           "-p", "acceptance_pytest_plugin", f"--acceptance-out={raw}"]

    env_note = f"PYTHONPATH={args.plugin_dir.resolve()}"
    env = dict(os.environ)
    env["PYTHONPATH"] = str(args.plugin_dir.resolve())
    env["PYTHONIOENCODING"] = "utf-8"

    proc = subprocess.run(cmd, cwd=tree, env=env, capture_output=True, text=True)
    if not raw.is_file():
        print("RUN FAILED — no run record written", file=sys.stderr)
        print(proc.stdout[-3000:], file=sys.stderr)
        print(proc.stderr[-3000:], file=sys.stderr)
        return 1

    rec = json.loads(raw.read_text(encoding="utf-8"))
    collected = sorted(rec["collected"])
    skipped = sorted(rec["skipped"])
    xfailed = sorted(rec["xfailed"])

    if not collected:
        print("REFUSING to seal an EMPTY collection — a vacuous seal passes every "
              "future check silently.", file=sys.stderr)
        return 1

    # A stray disposition outside the collected population would make the gate's
    # intersection rule unsatisfiable, and a seal nobody can satisfy gets deleted
    # rather than obeyed.
    strays = sorted((set(skipped) | set(xfailed)) - set(collected))
    if strays:
        print(f"REFUSING: {len(strays)} disposition(s) name tests that are not in the "
              f"collected population: {strays[:5]}", file=sys.stderr)
        return 1

    pytest_version = subprocess.run(
        [sys.executable, "-m", "pytest", "--version"],
        cwd=tree, capture_output=True, text=True).stdout.strip()

    artifact = {
        "artifact": "ACCEPT-5 SEALED DISPOSITIONS — which sealed tests were SKIPPED "
                    "or XFAILED when S6 was sealed",
        "authority": "R-794 §6 lane E, defect F-3; the PASS→SKIP invisibility first "
                     "recorded as F-3 in memory [accept5-join-keys]",
        "not_a_replacement_for": {
            "failure_baseline": "acceptance-baseline-2026-08-09.json — WHICH TESTS "
                                "WERE FAILING before S6",
            "collection_seal": "acceptance-collection-seal-08062e12.json — WHICH "
                               "TESTS EXISTED AND WERE COLLECTED at the seal",
            "why": "this one pins WHICH TESTS WERE NOT ACTUALLY RUN. Three "
                   "different questions; none may be edited into another.",
        },
        "graded_sha": graded_sha,
        "manifest_path": manifest_rel,
        "manifest_sha256": sha256_file(manifest_path),
        "manifest_members": len(members),
        "sealed_population": collected,
        "sealed_population_count": len(collected),
        "sealed_population_sha256": sha256_text("\n".join(collected)),
        "sealed_skipped": skipped,
        "sealed_skipped_count": len(skipped),
        "sealed_skipped_sha256": sha256_text("\n".join(skipped)),
        "sealed_xfailed": xfailed,
        "sealed_xfailed_count": len(xfailed),
        "sealed_xfailed_sha256": sha256_text("\n".join(xfailed)),
        "pytest_version": pytest_version,
        "python_version": rec.get("python"),
        "membership_rule": (
            "current_skipped ∩ sealed_population == sealed_skipped, and the same for "
            "xfail. Scoped to the sealed population so that NEWLY ADDED tests may "
            "legally skip without tripping the gate, while no SEALED test may change "
            "disposition in either direction. BY MEMBERSHIP, NEVER COUNTS — a "
            "balanced PASS↔SKIP swap preserves every count."
        ),
        "generation_invocation": " ".join(
            [f"cd <worktree pinned at {graded_sha}> &&", env_note,
             "python scripts/generate_disposition_seal.py --tree . "
             "--plugin-dir <dir> --out <out> --scratch <scratch>"]
        ),
        "generator": "scripts/generate_disposition_seal.py",
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")

    print(f"WROTE {args.out}")
    print(f"  graded_sha                {graded_sha}")
    print(f"  sealed_population_count   {artifact['sealed_population_count']}")
    print(f"  sealed_population_sha256  {artifact['sealed_population_sha256']}")
    print(f"  sealed_skipped_count      {artifact['sealed_skipped_count']}")
    print(f"  sealed_skipped_sha256     {artifact['sealed_skipped_sha256']}")
    print(f"  sealed_xfailed_count      {artifact['sealed_xfailed_count']}")
    print(f"  sealed_xfailed_sha256     {artifact['sealed_xfailed_sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
