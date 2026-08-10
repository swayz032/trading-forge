#!/usr/bin/env python3
"""PRE-PUSH freshness gate for docs/designs/SYSTEM-INVENTORY.md.

WHY PRE-PUSH AND NOT PRE-COMMIT
-------------------------------
`.pre-commit-config.yaml` states an explicit design constraint: "All hooks must
complete in < 5 seconds total on a typical commit."  [MEASURED 2026-08-09] the
generator takes ~13s, so a commit-stage hook would blow that budget by ~3x on
exactly the commits that matter (code commits).  PUSH is also the moment the map
becomes visible to other readers -- including the external reviewer, who reads it
from GitHub and once read a 6-day-stale copy.  So push is both the affordable
moment and the correct one.

WHAT IT DOES
------------
1. If the push contains no changes under src/ or scripts/, do nothing (exit 0).
   A docs-only push (e.g. a ruling) cannot change code reachability.
2. Otherwise regenerate the map.  If the regeneration changed the committed file,
   FAIL the push with a one-line remedy.  The file has already been refreshed on
   disk, so the remedy is `git add` + commit + push again.

WHY IT FAILS RATHER THAN AUTO-COMMITTING
----------------------------------------
This tree is SHARED with a sibling seat.  Auto-committing or amending from a hook
would violate the campaign's shared-tree invariant (never amend a commit you did
not author) and could capture another seat's unstaged work.  Failing loudly with
a remedy is the honest move: `A HANDOFF THAT FAILS LOUDLY BEATS ONE THAT SILENTLY
DROPS.`

ENABLE WITH:  pre-commit install --hook-type pre-push
(Adding the hook to .pre-commit-config.yaml alone is INERT until that runs.)
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MAP = REPO / "docs" / "designs" / "SYSTEM-INVENTORY.md"
GEN = REPO / "scripts" / "system_inventory.py"
WATCHED = ("src/", "scripts/")


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=REPO, capture_output=True, text=True
    ).stdout


def _code_changed_vs_upstream() -> bool:
    """True if anything under a WATCHED prefix differs from the upstream tip.

    Falls back to True (run the gate) when upstream cannot be resolved -- a gate
    that silently skips because it could not answer is a gate with no path to red.
    """
    upstream = _git("rev-parse", "--abbrev-ref", "@{u}").strip()
    if not upstream:
        return True
    names = _git("diff", "--name-only", f"{upstream}..HEAD").splitlines()
    return any(n.startswith(WATCHED) for n in names)


def main() -> int:
    if not GEN.is_file():
        print(f"inventory-freshness: generator missing at {GEN}", file=sys.stderr)
        return 1

    if not _code_changed_vs_upstream():
        print("inventory-freshness: no src/ or scripts/ change in this push - skipped")
        return 0

    before = MAP.read_bytes() if MAP.is_file() else b""
    proc = subprocess.run(
        [sys.executable, str(GEN)], cwd=REPO, capture_output=True, text=True
    )
    if proc.returncode != 0:
        print("inventory-freshness: GENERATOR FAILED", file=sys.stderr)
        print(proc.stdout[-2000:], file=sys.stderr)
        print(proc.stderr[-2000:], file=sys.stderr)
        return 1

    after = MAP.read_bytes() if MAP.is_file() else b""
    if after == before:
        print("inventory-freshness: SYSTEM-INVENTORY.md already current - push allowed")
        return 0

    print(
        "\n"
        "  PUSH BLOCKED - docs/designs/SYSTEM-INVENTORY.md was STALE.\n"
        "  It has been REGENERATED on disk (not committed - this is a shared tree).\n"
        "\n"
        "  Remedy:\n"
        "    git commit -o docs/designs/SYSTEM-INVENTORY.md -m 'SYSTEM-INVENTORY: regenerate'\n"
        "    git push\n"
        "\n"
        "  Why: the map is what tells the next seat whether a thing is already built\n"
        "  and wired. A stale map answers confidently about a tree that no longer\n"
        "  exists, and an external reader once consumed a 6-day-old copy from GitHub.\n",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
