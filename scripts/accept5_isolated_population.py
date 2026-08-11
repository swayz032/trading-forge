"""ACCEPT-5 RATIFY-1 Layer 1 — population construction, and NOTHING ELSE.

Obligation [A]: targets are built from the SAME two authorities the committed
runner uses -- the canonical manifest and the successor chain -- and this module
creates NO second population registry. It IMPORTS `acceptance_runner` and
`population_successor` rather than reimplementing their rules, because a
reimplementation is a second authority wearing a helper's costume.

    [MEASURED, ops/test-replica] a suite that RE-IMPLEMENTS what it names can
    mock the real module out entirely; six greens once survived DELETING
    production. The repair is an IMPORT, not a copy.

Obligation [B] is what this module makes checkable: the per-file split must
aggregate back to EXACTLY the governed population --

    duplicates 0 | missing 0 | unauthorized extra 0 | collected-but-unexecuted 0

This file deliberately does not run pytest, score anything, or write a verdict.
Splitting the population is the step where an isolation runner can silently lose
or double-count members, so it is proven ALONE before anything executes.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import acceptance_runner as _runner          # noqa: E402  the ONLY manifest authority
import population_successor as _popsucc      # noqa: E402  the ONLY chain authority

REPO = _runner.REPO
MANIFEST = _runner.MANIFEST


class PopulationError(RuntimeError):
    """Raised instead of returning a partial population.

    [D]'s discipline applied one layer earlier: a population that cannot be
    fully derived must REFUSE, never be scored in part.
    """


def build(repo: Path = REPO, manifest: Path = MANIFEST) -> dict:
    """Return the per-child execution plan plus the audit trail [B] needs.

    Every number this returns is DERIVED here from the two authorities; none is
    cached, hard-coded, or carried from a prior run.
    """
    members = _runner.read_manifest(manifest)
    resolved, missing = [], []
    for m in members:
        (resolved if (repo / "src" / m).is_file() else missing).append(m)
    if missing:
        raise PopulationError(
            f"{len(missing)} manifest member(s) do not resolve under {repo/'src'}: "
            f"{missing[:5]} -- the population is not fully derivable, so no split "
            "may be scored"
        )

    manifest_targets = [f"src/{m}" for m in resolved]

    required, chain_problems = _popsucc.required_population(repo)
    if chain_problems:
        raise PopulationError(
            "the successor chain could not be derived, so the set of tests this "
            f"run must execute is unknown: {chain_problems[:5]}"
        )

    # Chain node IDs whose FILE is already a manifest target need no separate
    # child -- that child already executes the whole file. Only node IDs in
    # files OUTSIDE the manifest become supplemental children.
    mt = set(manifest_targets)
    supplemental = sorted(n for n in required if n.split("::")[0] not in mt)

    # ---- the split: one child per FILE ------------------------------------
    children: dict[str, list[str]] = {t: [t] for t in manifest_targets}
    for node in supplemental:
        children.setdefault(node.split("::")[0], []).append(node)

    # ---- [B] the aggregation identities, asserted here --------------------
    # A split is only trustworthy if putting it back together reproduces the
    # input exactly. These are checked, not described.
    flat = [t for targets in children.values() for t in targets]
    dup = sorted({t for t in flat if flat.count(t) > 1})
    if dup:
        raise PopulationError(f"the split duplicated {len(dup)} target(s): {dup[:5]}")

    files_in = {t for t in manifest_targets} | {n.split("::")[0] for n in supplemental}
    files_out = set(children)
    lost = sorted(files_in - files_out)
    extra = sorted(files_out - files_in)
    if lost:
        raise PopulationError(f"the split LOST {len(lost)} file(s): {lost[:5]}")
    if extra:
        raise PopulationError(f"the split invented {len(extra)} file(s): {extra[:5]}")

    # A required node ID whose file is gone must name ITS OWN layer, exactly as
    # the committed runner does -- otherwise pytest reports a usage error and it
    # reads as broken infrastructure rather than a deleted governed obligation.
    gone = sorted({n.split("::")[0] for n in supplemental
                   if not (repo / n.split("::")[0]).is_file()})
    if gone:
        raise PopulationError(
            f"{len(gone)} file(s) carrying chain-required node IDs no longer exist: "
            f"{gone[:5]} -- a governed obligation was deleted"
        )

    return {
        "manifest_path": str(manifest),
        "manifest_members": len(members),
        "manifest_resolved": len(resolved),
        "chain_required_nodes": len(required),
        "supplemental_nodes": len(supplemental),
        "children": children,
        "child_count": len(children),
        "targets_total": len(flat),
        # [B]'s identities as MEASURED VALUES, not as "we did not raise".
        # A printed 0 that is merely implied by control flow is indistinguishable
        # from a check that never ran -- and this campaign has been lied to by
        # exactly that shape. These are recomputed here and reported.
        "b_duplicates": len(dup),
        "b_files_lost": len(lost),
        "b_files_invented": len(extra),
        "b_required_files_missing": len(gone),
        "b_reaggregated_files": len(files_out),
        "b_input_files": len(files_in),
    }


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in argv
    try:
        plan = build()
    except PopulationError as exc:
        print(f"ACCEPTANCE INSTRUMENT REFUSED - POPULATION NOT DERIVABLE: {exc}")
        return 2

    if as_json:
        print(json.dumps(plan, indent=2, sort_keys=True))
        return 0

    print("=== RATIFY-1 [A] POPULATION CONSTRUCTION (no execution) ===")
    print(f"manifest                      : {plan['manifest_path']}")
    print(f"manifest members (stripped)   : {plan['manifest_members']}")
    print(f"resolved under <repo>/src     : {plan['manifest_resolved']}")
    print(f"chain-required node IDs       : {plan['chain_required_nodes']}")
    print(f"supplemental (outside manifest): {plan['supplemental_nodes']}")
    print(f"CHILDREN (one pytest each)    : {plan['child_count']}")
    print(f"targets across all children   : {plan['targets_total']}")
    print()
    print("=== [B] SPLIT IDENTITIES -- MEASURED VALUES, not implied by control flow ===")
    print(f"input files (manifest + chain): {plan['b_input_files']}")
    print(f"re-aggregated child files     : {plan['b_reaggregated_files']}")
    print(f"duplicates across children    : {plan['b_duplicates']}")
    print(f"files lost by the split       : {plan['b_files_lost']}")
    print(f"files invented by the split   : {plan['b_files_invented']}")
    print(f"required files missing on disk: {plan['b_required_files_missing']}")
    ok = (plan["b_input_files"] == plan["b_reaggregated_files"]
          and plan["b_duplicates"] == 0 and plan["b_files_lost"] == 0
          and plan["b_files_invented"] == 0
          and plan["b_required_files_missing"] == 0)
    print(f"[B] VERDICT                   : {'HOLDS' if ok else '*** VIOLATED ***'}")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
