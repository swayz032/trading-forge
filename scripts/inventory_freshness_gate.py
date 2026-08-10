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
2. Otherwise ASK THE GENERATOR whether the map is stale, by running
   `system_inventory.py --check` and branching on its exit code.  Only when the
   checker says STALE do we regenerate and block.

WHY IT DELEGATES INSTEAD OF COMPARING BYTES  (R-780 STEP 0, 2026-08-09)
-----------------------------------------------------------------------
This gate previously regenerated the map and compared RAW BYTES before-vs-after.
That was a NON-TERMINATING DEADLOCK, measured over two full cycles in AR-909:

  * the map carries a provenance line `> Generated at commit <git rev-parse HEAD>`
  * so every remedy commit advances HEAD, which changes the stamp, which makes
    the next regeneration differ again -- forever.

`system_inventory.py` had ALREADY solved this for `--check`: its `content_only()`
helper strips the provenance line, and its docstring says why in as many words --
"HEAD advances on every commit ... would make --check fail permanently.  A
staleness check that always fires is worse than no check at all: it trains
readers to ignore it."  This gate reproduced the exact failure its own generator
had documented and avoided.

The repair is DELEGATION, not duplication.  We do NOT import or re-implement
`content_only()` here: fixing a divergence by copying the correct side preserves
the divergence, and the next non-semantic field added to the map would re-open
it.  THE GENERATOR DEFINES WHAT "FRESH" MEANS; THIS GATE ONLY DECIDES WHAT TO DO
ABOUT IT.

  --check exit 0     -> ALLOW the push.  The committed stamp may lag HEAD; that
                        is expected and is not staleness.
  --check exit 1     -> STALE.  Regenerate, then BLOCK with the remedy.
  --check other exit -> the CHECKER ITSELF failed.  BLOCK, surface its output,
                        and DO NOT regenerate on top of a checker reporting its
                        own defect.  A gate that cannot answer must not guess.

WHY IT NO LONGER WRITES UNCONDITIONALLY
---------------------------------------
The old shape ran the generator BEFORE deciding anything, so every armed push
rewrote the map on disk even when nothing was stale -- which is what left the
tree dirty.  On a SHARED TREE an unconditional write by a guard is a hazard in
its own right: another seat's commit can sweep it in.  We now write only on the
stale branch.

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

STALE_GUIDANCE = """
  PUSH BLOCKED - docs/designs/SYSTEM-INVENTORY.md was STALE.
  It has been REGENERATED on disk (not committed - this is a shared tree).

  Remedy:
    git commit -o docs/designs/SYSTEM-INVENTORY.md -m 'SYSTEM-INVENTORY: regenerate'
    git push

  Why: the map is what tells the next seat whether a thing is already built
  and wired. A stale map answers confidently about a tree that no longer
  exists, and an external reader once consumed a 6-day-old copy from GitHub.
"""


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


def _run_generator(*extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(GEN), *extra], cwd=REPO, capture_output=True, text=True
    )


def main() -> int:
    if not GEN.is_file():
        print(f"inventory-freshness: generator missing at {GEN}", file=sys.stderr)
        return 1

    if not _code_changed_vs_upstream():
        print("inventory-freshness: no src/ or scripts/ change in this push - skipped")
        return 0

    check = _run_generator("--check")

    if check.returncode == 0:
        print(
            "inventory-freshness: SYSTEM-INVENTORY.md describes the current tree "
            "(content compared; provenance stamp ignored) - push allowed"
        )
        return 0

    if check.returncode != 1:
        # The checker could not answer.  Do NOT regenerate over a tool that is
        # reporting its own defect, and do NOT read an unknown exit as "fresh".
        print(
            "\n"
            "  PUSH BLOCKED - the freshness CHECKER itself failed "
            f"(exit {check.returncode}).\n"
            "  The map was NOT regenerated: a gate that cannot answer must not guess.\n"
            "  Fix the checker, then push again.\n",
            file=sys.stderr,
        )
        if check.stdout:
            print(check.stdout[-2000:], file=sys.stderr)
        if check.stderr:
            print(check.stderr[-2000:], file=sys.stderr)
        return 1

    # exit 1 == genuinely stale.  Now, and only now, write.
    gen = _run_generator()
    if gen.returncode != 0:
        print("inventory-freshness: GENERATOR FAILED", file=sys.stderr)
        print(gen.stdout[-2000:], file=sys.stderr)
        print(gen.stderr[-2000:], file=sys.stderr)
        return 1

    print(STALE_GUIDANCE, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
