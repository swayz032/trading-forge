"""ACCEPT-5 population succession — R3-2 / F-R2-2 (authority R-799 §4).

The root collection seal (`08062e12`) is IMMUTABLE. It pins the node-ID
population that existed when `S6` was sealed. It is never amended, never
regenerated, and never re-sealed to make today's state fit.

The governed population legitimately GROWS. This module records that growth as
an append-only chain of successors, so the required population is DERIVED
rather than asserted:

    required = sealed  +  every approved addition  -  only explicitly
                                                      authorized removals

Per R-799 §4 each successor entry records:
    parent_population_sha256 · graded_sha · added_node_ids ·
    explicitly_authorized_removed_node_ids · resulting_population_sha256 ·
    current_manifest_identity

TWO THINGS THIS MODULE REFUSES TO DO
------------------------------------
1. It never hand-copies a hash. Every digest it writes is COMPUTED at record
   time from the bytes it describes, and the recorder returns the recompute so
   the caller can print it beside the record (STOP [22], R-809 §8).
2. It never admits a candidate whose external inputs fall outside R-799 §5's
   three permitted forms. The outcome is the named refusal
   `SUCCESSOR MEMBER NOT HERMETIC - REFUSE ADMISSION` (adopted into R3-2 by
   R-801). A silent skip is the exact defect R-799 §5 closed.

THE SCANNER NOMINATES, THE STANDARD CLASSIFIES (R-801). `scan_hermeticity`
returns SITES, not verdicts about intent; admission is fail-closed on any
surviving site, and every site is named so a human adjudicates rather than
guesses.

WHY THE MANIFEST FIELDS ARE NOT COMPARED TO THE LIVE MANIFEST
------------------------------------------------------------
`[MEASURED 2026-08-10]` the seal records `manifest_members 105` /
`manifest_sha256 2c728e35...`, while the manifest on disk is `107` members /
`dc615e39...`. That drift is LEGITIMATE (lane L added two files). Binding the
seal's manifest identity to today's manifest would therefore refuse every run —
the same false-RED shape R-806 §3 caught. The seal's fields are validated
against PINS (they describe seal time, immutably); the LIVE manifest is
validated against the chain's tip.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

REFUSAL_NOT_HERMETIC = "SUCCESSOR MEMBER NOT HERMETIC - REFUSE ADMISSION"

SEAL_REL = "docs/replay-results/h1-battery/acceptance-collection-seal-08062e12.json"
CHAIN_REL = "docs/replay-results/h1-battery/acceptance-population-successor.json"
MANIFEST_REL = "src/engine/tests/canonical_regression_population.txt"


# ---------------------------------------------------------------------------
# digests — always computed, never accepted from a caller
# ---------------------------------------------------------------------------
def population_sha256(node_ids) -> str:
    """The seal's own digest rule: sha256 over the sorted node IDs, LF-joined.

    Must match `generate_collection_seal.py` and `validate_seal()` exactly; a
    third spelling of this rule would be a third instrument.
    """
    return hashlib.sha256("\n".join(sorted(node_ids)).encode("utf-8")).hexdigest()


def sha256_file(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def manifest_members(path) -> list:
    """Membership rule, identical to the runner's: comments and blanks are NOT
    members. A raw line count over-reads and has done so before."""
    return [
        s.strip()
        for s in Path(path).read_text(encoding="utf-8").splitlines()
        if s.strip() and not s.strip().startswith("#")
    ]


def manifest_identity(tree) -> dict:
    """Computed at record time. Never carried across a repair."""
    mp = Path(tree) / MANIFEST_REL
    return {
        "manifest_path": MANIFEST_REL,
        "manifest_sha256": sha256_file(mp),
        "manifest_members": len(manifest_members(mp)),
    }


# ---------------------------------------------------------------------------
# hermeticity — the admission precondition (R-799 §5 forms, R-801 outcome)
# ---------------------------------------------------------------------------
# Each pattern names an external input that is NOT one of the three permitted
# forms. Permitted, and therefore deliberately absent from this list: `tmp_path`
# fixtures the test creates, `Path(__file__).resolve().parents[...]` anchoring,
# and committed governed members referenced relatively.
NON_HERMETIC_PATTERNS = [
    # The drive letter must not be preceded by another letter. Without that
    # lookbehind this pattern matched `"stdout:\n"` (`t:` + `\`) and REFUSED the
    # permanent RED — a false RED caught by the negative control below, not by
    # reading the regex. `A CONTROL MUST DISCRIMINATE.`
    (r"(?<![A-Za-z])[A-Za-z]:[\\/]", "absolute Windows path"),
    (r"(?<!\w)/(?:home|Users|mnt|opt)/", "absolute POSIX path"),
    (r"expanduser|Path\s*\.\s*home\s*\(", "home directory"),
    (r"os\s*\.\s*getcwd|Path\s*\.\s*cwd\s*\(", "cwd assumption"),
    (r"trading-forge[\\/]trading-forge", "other-worktree path"),
    (r"\b(?:requests|httpx|urllib|aiohttp|socket|boto3)\b", "network or cloud client"),
    (r"SAMPLES_DIR", "machine-local sample corpus"),
    # `git log` is reachable in shell form AND in argv-list form
    # (`["git","log"]`) — the list form slipped through an adjacency-only
    # pattern and was caught by the positive control.
    (
        r"rev-list|--since=|git\s+log|git[\"']\s*,\s*[\"']log",
        "git-history dependency",
    ),
]


def scan_hermeticity(path) -> dict:
    """Return {'blocking': [...], 'advisory': [...]} — SITES, not a verdict.

    A site inside a FULL-LINE comment is ADVISORY (prose describing the rule);
    anything on an executable line is BLOCKING. Nothing is dropped: advisory
    sites are still reported, because a silent exemption is how a scanner
    becomes a rubber stamp. A docstring asserting hermeticity is a CLAIM with an
    evidence grade (R-807 §2), not a pass.
    """
    blocking, advisory = [], []
    for lineno, raw in enumerate(
        Path(path).read_text(encoding="utf-8").splitlines(), start=1
    ):
        stripped = raw.strip()
        is_prose = stripped.startswith("#")
        for pattern, label in NON_HERMETIC_PATTERNS:
            if re.search(pattern, raw):
                site = {"line": lineno, "kind": label, "text": stripped[:120]}
                (advisory if is_prose else blocking).append(site)
    return {"blocking": blocking, "advisory": advisory}


def admit_or_refuse(path):
    """Fail-closed admission check. Returns (admitted: bool, lines: list[str])."""
    sites = scan_hermeticity(path)
    lines = []
    for s in sites["advisory"]:
        lines.append(
            f"  ADVISORY (prose, not an input) line {s['line']}: {s['kind']}"
        )
    if not sites["blocking"]:
        return True, lines
    lines = [
        REFUSAL_NOT_HERMETIC,
        f"  candidate : {Path(path).as_posix()}",
        f"  reason    : {len(sites['blocking'])} external input(s) outside "
        f"R-799 SS5's three permitted forms",
    ] + lines
    for s in sites["blocking"]:
        lines.append(f"    line {s['line']:>5}  {s['kind']}: {s['text']}")
    lines.append(
        "  Admission is REFUSED. Do not skip this check and do not admit with a "
        "promise to fix it later - a silent skip is the defect R-799 SS5 closed."
    )
    return False, lines


# ---------------------------------------------------------------------------
# the chain
# ---------------------------------------------------------------------------
def load_seal(tree) -> dict:
    return json.loads((Path(tree) / SEAL_REL).read_text(encoding="utf-8"))


def load_chain(tree):
    p = Path(tree) / CHAIN_REL
    if not p.is_file():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def required_population(tree):
    """Derive the required population from the root seal + the chain.

    Returns (population: set, problems: list[str]). A non-empty `problems` means
    the chain does not reconcile and NOTHING may be authorized from it.
    """
    probs = []
    seal = load_seal(tree)
    pop = set(seal["collected_population"])

    recomputed_root = population_sha256(pop)
    if recomputed_root != seal.get("collected_population_sha256"):
        probs.append(
            "POPULATION CHAIN FAILURE: the root seal's own population digest does "
            "not recompute; the chain cannot be anchored."
        )
        return pop, probs

    chain = load_chain(tree)
    if chain is None:
        return pop, probs

    parent = recomputed_root
    for i, entry in enumerate(chain.get("successors", [])):
        if entry.get("parent_population_sha256") != parent:
            probs.append(
                f"POPULATION CHAIN FAILURE: successor[{i}] declares parent "
                f"{entry.get('parent_population_sha256')!r} but the chain is at "
                f"{parent!r}. The chain is broken or re-ordered."
            )
            return pop, probs

        added = set(entry.get("added_node_ids", []))
        removed = set(entry.get("explicitly_authorized_removed_node_ids", []))

        collision = added & pop
        if collision:
            probs.append(
                f"POPULATION CHAIN FAILURE: successor[{i}] adds {len(collision)} "
                f"node ID(s) already in the population, e.g. {sorted(collision)[0]!r}."
            )
            return pop, probs
        absent = removed - pop
        if absent:
            probs.append(
                f"POPULATION CHAIN FAILURE: successor[{i}] removes {len(absent)} "
                f"node ID(s) not in the population, e.g. {sorted(absent)[0]!r}."
            )
            return pop, probs

        pop = (pop | added) - removed
        recomputed = population_sha256(pop)
        if recomputed != entry.get("resulting_population_sha256"):
            probs.append(
                f"POPULATION CHAIN FAILURE: successor[{i}]'s recorded "
                f"resulting_population_sha256 does not recompute from its own "
                f"additions and removals. A recorded digest that cannot be "
                f"re-derived is a fabricated safety claim."
            )
            return pop, probs
        parent = recomputed

    return pop, probs


# ---------------------------------------------------------------------------
# recording — additions are DERIVED by diff, never accepted as an assertion
# ---------------------------------------------------------------------------
def record_successor(
    tree,
    collected,
    graded_sha,
    entry_kind,
    authority,
    note,
    authorized_removals=(),
):
    """Append one successor derived from an OBSERVED collection.

    `collected` is the node-ID set a real collection produced. The additions and
    removals are computed by diffing it against the chain tip — the caller does
    not get to assert them. Every digest is computed here, from the bytes being
    described, and returned so the caller can print the recompute beside the
    record (STOP [22]).

    Removals are FAIL-CLOSED: any node ID that disappears must be named in
    `authorized_removals`, or this refuses. `[23]` — the assertion is over
    MEMBERSHIP, never a total, because a count cannot express "may grow, must
    not silently shrink".
    """
    tree = Path(tree)
    current, probs = required_population(tree)
    if probs:
        return None, probs

    collected = set(collected)
    added = sorted(collected - current)
    disappeared = sorted(current - collected)
    authorized = set(authorized_removals)

    unauthorized = [n for n in disappeared if n not in authorized]
    if unauthorized:
        return None, [
            "POPULATION SHRANK WITHOUT AUTHORIZATION - REFUSE.",
            f"  {len(unauthorized)} node ID(s) present in the required population "
            f"are absent from this collection and are not explicitly authorized "
            f"for removal:",
            *[f"    {n}" for n in unauthorized[:20]],
            "  A test cannot be important enough to prove a lane and simultaneously "
            "unimportant enough that its later disappearance does not matter "
            "(R-799 SS4).",
        ]

    resulting = (current | set(added)) - authorized
    entry = {
        "entry_kind": entry_kind,
        "authority": authority,
        "note": note,
        "parent_population_sha256": population_sha256(current),
        "graded_sha": graded_sha,
        "added_node_ids": added,
        "explicitly_authorized_removed_node_ids": sorted(authorized),
        "resulting_population_sha256": population_sha256(resulting),
        "current_manifest_identity": manifest_identity(tree),
    }

    chain = load_chain(tree) or {
        "artifact": "ACCEPT-5 POPULATION SUCCESSOR CHAIN",
        "authority": "R-799 SS4 (F-R2-2); built in R3-2",
        "root_seal": SEAL_REL,
        "rule": "required = root sealed population + every approved addition - "
                "only explicitly authorized removals",
        "immutable": "The root seal is never amended, regenerated or re-sealed. "
                     "'Regenerate the current population' is re-sealing under "
                     "another name.",
        "successors": [],
    }
    chain["successors"].append(entry)
    (tree / CHAIN_REL).write_text(
        json.dumps(chain, indent=2) + "\n", encoding="utf-8", newline="\n"
    )

    # STOP [22]: re-derive from what was just WRITTEN, not from memory.
    reread, reprobs = required_population(tree)
    recompute = {
        "resulting_population_sha256_recomputed_from_disk": population_sha256(reread),
        "population_size_recomputed_from_disk": len(reread),
        "chain_file_sha256": sha256_file(tree / CHAIN_REL),
        "reconciles": not reprobs,
    }
    return {"entry": entry, "recompute": recompute}, reprobs


def _read_node_ids(path):
    return [
        s.strip()
        for s in Path(path).read_text(encoding="utf-8").splitlines()
        if "::" in s
    ]


def main(argv=None):
    import argparse
    import subprocess

    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    v = sub.add_parser("verify", help="derive and print the required population")
    v.add_argument("--tree", default=".")

    h = sub.add_parser("hermeticity", help="run the admission precondition")
    h.add_argument("--tree", default=".")
    h.add_argument("candidate")

    r = sub.add_parser("record", help="append a successor derived from a collection")
    r.add_argument("--tree", default=".")
    r.add_argument("--collected", required=True,
                   help="file of observed node IDs, one per line")
    r.add_argument("--kind", required=True)
    r.add_argument("--authority", required=True)
    r.add_argument("--note", required=True)
    r.add_argument("--authorize-removal", action="append", default=[])

    a = ap.parse_args(argv)
    tree = Path(a.tree).resolve()

    if a.cmd == "verify":
        pop, probs = required_population(tree)
        print(f"required population : {len(pop)} node IDs")
        print(f"population sha256   : {population_sha256(pop)}")
        ident = manifest_identity(tree)
        for k, val in ident.items():
            print(f"{k:20}: {val}")
        for p in probs:
            print(p)
        return 1 if probs else 0

    if a.cmd == "hermeticity":
        ok, lines = admit_or_refuse(Path(a.candidate))
        for line in lines:
            print(line)
        print(f"ADMISSION: {'PERMITTED' if ok else 'REFUSED'}")
        return 0 if ok else 1

    graded = subprocess.run(
        ["git", "-C", str(tree), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True).stdout.strip()
    result, probs = record_successor(
        tree,
        _read_node_ids(a.collected),
        graded_sha=graded,
        entry_kind=a.kind,
        authority=a.authority,
        note=a.note,
        authorized_removals=a.authorize_removal,
    )
    if result is None:
        for p in probs:
            print(p)
        return 1
    e, rc = result["entry"], result["recompute"]
    print(f"RECORDED successor  kind={e['entry_kind']}  graded_sha={e['graded_sha']}")
    print(f"  parent_population_sha256    : {e['parent_population_sha256']}")
    print(f"  added_node_ids              : {len(e['added_node_ids'])}")
    for n in e["added_node_ids"]:
        print(f"      + {n}")
    print(f"  authorized removals         : {e['explicitly_authorized_removed_node_ids']}")
    print(f"  resulting_population_sha256 : {e['resulting_population_sha256']}")
    print(f"  current_manifest_identity   : {e['current_manifest_identity']}")
    print("  --- STOP [22] RECOMPUTE, re-derived from the file just written ---")
    for k, val in rc.items():
        print(f"  {k:44}: {val}")
    if e["resulting_population_sha256"] != rc[
            "resulting_population_sha256_recomputed_from_disk"]:
        print("  *** RECORDED DIGEST != RECOMPUTE FROM DISK ***")
        return 1
    for p in probs:
        print(p)
    return 1 if probs else 0


if __name__ == "__main__":
    raise SystemExit(main())
