"""Generate the ACCEPT-5 SEALED COLLECTION companion artifact.

`ACCEPT5-COLLECTION-BASELINE-1` (R-791 §4).

WHY THIS EXISTS, AND WHY IT IS NOT THE FAILURE BASELINE
    The immutable failure baseline answers *which failures existed before S6*.
    This artifact answers a DIFFERENT question: *which tests existed and were
    COLLECTED when S6 was sealed*.

    They cannot be merged. `R-791 §3 F-ACCEPT5-2` measured the gap they leave
    when only the first exists: a previously-GREEN sealed test that is renamed,
    deleted, or hidden behind a skip-producing import error is invisible to
    every failure-membership check — it is not in the baseline failures, it is
    not failing, and both feeders agree it is simply absent.

    `A TEST THAT STOPS BEING COLLECTED DOES NOT LOOK LIKE A REGRESSION —
     IT LOOKS LIKE A FIX.`

THE PINNED TREE IS NOT MODIFIED
    The recording plugin was authored after the sealed commit and does not
    exist there. Rather than copy it in (which would dirty the tree whose
    collection we are certifying), the plugin is placed in an isolated
    directory supplied on PYTHONPATH. The pinned tree stays byte-clean.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    # read_bytes, never read_text: read_text HIDES CRLF and would make the
    # digest depend on the checkout's line-ending policy.
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
    cmd = [sys.executable, "-m", "pytest", *targets,
           "--collect-only", "-q", "--no-header", "-p", "no:cacheprovider",
           "-p", "acceptance_pytest_plugin", f"--acceptance-out={raw}"]

    env_note = f"PYTHONPATH={args.plugin_dir.resolve()}"
    import os
    env = dict(os.environ)
    env["PYTHONPATH"] = str(args.plugin_dir.resolve())
    env["PYTHONIOENCODING"] = "utf-8"

    proc = subprocess.run(cmd, cwd=tree, env=env, capture_output=True, text=True)
    if not raw.is_file():
        print("COLLECTION FAILED — no run record written", file=sys.stderr)
        print(proc.stdout[-3000:], file=sys.stderr)
        print(proc.stderr[-3000:], file=sys.stderr)
        return 1

    rec = json.loads(raw.read_text(encoding="utf-8"))
    collected = sorted(rec["collected"])
    if not collected:
        print("REFUSING to seal an EMPTY collection — a vacuous seal passes "
              "every future check silently.", file=sys.stderr)
        return 1

    pytest_version = subprocess.run(
        [sys.executable, "-m", "pytest", "--version"],
        cwd=tree, capture_output=True, text=True).stdout.strip()

    artifact = {
        "artifact": "ACCEPT-5 SEALED COLLECTION — the node-ID population that "
                    "EXISTED AND WAS COLLECTED when S6 was sealed",
        "authority": "R-791 §4 (ACCEPT5-COLLECTION-BASELINE-1); closes "
                     "F-ACCEPT5-2 measured in R-791 §3",
        "not_a_replacement_for": {
            "file": "docs/replay-results/h1-battery/acceptance-baseline-2026-08-09.json",
            "why": "that artifact pins WHICH FAILURES existed before S6; this one "
                   "pins WHICH TESTS EXISTED AND WERE COLLECTED at the seal. "
                   "Different questions — neither may be edited into the other.",
        },
        "graded_sha": graded_sha,
        "manifest_path": manifest_rel,
        "manifest_sha256": sha256_file(manifest_path),
        "manifest_members": len(members),
        "collected_population": collected,
        "collected_count": len(collected),
        "collected_population_sha256": sha256_text("\n".join(collected)),
        "pytest_version": pytest_version,
        "python_version": rec.get("python"),
        "generation_invocation": " ".join(
            [f"cd <worktree pinned at {graded_sha}> &&", env_note,
             "python -m pytest <105 manifest members under src/>",
             "--collect-only -q --no-header -p no:cacheprovider",
             "-p acceptance_pytest_plugin --acceptance-out=<record.json>"]),
        "generator": "scripts/generate_collection_seal.py",
        "pinned_tree_was_modified": False,
        "pinned_tree_note": "the recording plugin was supplied on PYTHONPATH from an "
                            "isolated directory; the sealed worktree was not written to.",
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n",
                        encoding="utf-8")
    print(f"WROTE {args.out}")
    print(f"  graded_sha                   {graded_sha}")
    print(f"  manifest members             {len(members)}")
    print(f"  collected population         {len(collected)}")
    print(f"  collected_population_sha256  {artifact['collected_population_sha256']}")
    print(f"  pytest                       {pytest_version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
