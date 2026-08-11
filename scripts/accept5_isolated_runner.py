"""ACCEPT-5 RATIFY-1 Layer 1 — one pytest subprocess per governed file.

PROTOTYPE. The committed `acceptance_runner.py` is untouched and remains the
authority until obligations [A]-[J] are proven (R-821 §5).

WHAT THIS BUYS, AND IT IS THE ONLY REASON IT EXISTS
    `[MEASURED, AR-973/AR-975]` governed files write fakes into `sys.modules` at
    MODULE level -- during collection, before any fixture of any scope exists --
    and never remove them. In one shared interpreter that changes the outcomes of
    every test collected afterwards, in BOTH directions. One interpreter per file
    makes the escape impossible rather than merely unlikely: file A's fake dies
    with file A's process.

    THE FIX IS NOT TO REWRITE THE MOCKS. THEY ARE CORRECT AS LOCAL SCAFFOLDING;
    WHAT WAS WRONG IS THAT A SHARED INTERPRETER LET LOCAL SCAFFOLDING ESCAPE.

OBLIGATIONS IMPLEMENTED HERE
    [C] every child gets a UNIQUE run id, a UNIQUE artifact directory created
        with exist_ok=False, and its record is joined back on run_id and on the
        real subprocess exit status. No child may ever read another's artifacts,
        and no stale artifact can be scored.
    [D] ANY invalid child => ACCEPTANCE INSTRUMENT REFUSED, naming the file.
        There is no partial scoring: a population that did not fully execute
        cannot produce a verdict about the tree.
    [B] the aggregate must reconstruct the governed population exactly --
        duplicate node IDs across children, and collected-but-unexecuted nodes,
        are both reported as MEASURED counts.

WHAT IT DELIBERATELY DOES NOT DO
    It does not score PASS/REFUSED, does not touch any seal, and does not compare
    against the old baseline. `STOP [37]`: the oracle for this architecture is
    ORDER-INDEPENDENT EXACT NODE OUTCOMES, never agreement with the old `31`.
    Tuning a new instrument until it reproduces the contaminated answer would
    bake that answer into the oracle and call it a control.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import accept5_isolated_population as _pop     # noqa: E402
import acceptance_runner as _runner            # noqa: E402

REPO = _runner.REPO
REFUSED = "ACCEPTANCE INSTRUMENT REFUSED"


def _slug(path: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", path).strip("_")


def run_child(target_file, targets, run_root, *, layer2=True, blind=False, timeout=900):
    """Execute ONE governed file in its own interpreter and return its receipt."""
    run_id = uuid.uuid4().hex
    child_dir = run_root / _slug(target_file)
    # exist_ok=False is the point: a child that would reuse a directory is a
    # child that could score somebody else's artifacts.
    child_dir.mkdir(parents=True, exist_ok=False)
    out_json = child_dir / "acceptance-run.json"
    out_xml = child_dir / "acceptance-run.xml"

    cmd = [sys.executable, "-m", "pytest", *targets,
           "-q", "--no-header", "-p", "no:cacheprovider",
           "-p", "scripts.acceptance_pytest_plugin",
           "-p", "scripts.accept5_isolation_plugin",
           f"--acceptance-out={out_json}", f"--junitxml={out_xml}",
           f"--acceptance-run-id={run_id}"]
    if layer2:
        cmd.append("--accept5-layer2")
    if blind:
        cmd.append("--accept5-ownership-blind")

    started = time.time()
    try:
        proc = subprocess.run(cmd, cwd=REPO, capture_output=True,
                              encoding="utf-8", errors="replace", timeout=timeout)
        rc, stdout, stderr, timed_out = proc.returncode, proc.stdout, proc.stderr, False
    except subprocess.TimeoutExpired as exc:
        rc, stdout, stderr, timed_out = None, (exc.stdout or ""), (exc.stderr or ""), True
    elapsed = time.time() - started

    receipt = {
        "file": target_file, "targets": targets, "run_id": run_id,
        "child_dir": str(child_dir), "returncode": rc, "elapsed_s": round(elapsed, 2),
        "timed_out": timed_out, "problems": [], "outcomes": {}, "collected": [],
    }
    P = receipt["problems"]

    if timed_out:
        P.append(f"child for {target_file} exceeded {timeout}s and was killed")
        return receipt
    # 0 and 1 mean the file was collected AND executed.
    #
    # 5 ("no tests collected") is the one status the SHARED-interpreter model
    # could never produce and this one can: `[MEASURED]` two manifest members --
    # _a_packet_harness.py and _forensics_fixtures.py -- are HELPERS holding no
    # test functions. Run alongside 105 other files they are invisible; run
    # ALONE they are legitimately empty. Treating that as an invalid child would
    # make the isolated runner refuse a population the old one accepts, for a
    # reason that is an artifact of the split rather than a fact about the tree.
    #
    #   `A STATUS THAT ONLY THE NEW ARCHITECTURE CAN EMIT IS NOT AUTOMATICALLY A
    #    DEFECT -- BUT IT MUST BE DISCRIMINATED, NOT WAIVED.`
    #
    # So 5 is accepted ONLY on proof of genuine emptiness: the record was still
    # written and it reports ZERO collected. A collection ERROR exits 2/3/4, and
    # a file that collected something and then vanished would show n_collected>0
    # here and still be refused.
    if rc == 5:
        if out_json.is_file():
            try:
                _r = json.loads(out_json.read_text(encoding="utf-8"))
            except Exception:                                  # noqa: BLE001
                _r = None
            if _r is not None and int(_r.get("n_collected", -1)) == 0:
                receipt["empty_by_design"] = True
                receipt["collected_but_unexecuted"] = []
                return receipt
        P.append(f"pytest exited 5 for {target_file} but the child did not prove "
                 f"genuine emptiness (no record, or n_collected != 0)")
        return receipt
    if rc not in (0, 1):
        P.append(f"pytest exited {rc} for {target_file} (0=clean, 1=failures); "
                 f"not a valid execution status, so this child scored nothing")
        return receipt
    if not out_json.is_file():
        P.append(f"the plugin record was not written for {target_file}")
        return receipt
    try:
        rec = json.loads(out_json.read_text(encoding="utf-8"))
    except Exception as exc:                                  # noqa: BLE001
        P.append(f"the plugin record for {target_file} is unreadable: {exc!r}")
        return receipt
    if not out_xml.is_file():
        P.append(f"the JUnit XML was not written for {target_file}")
    # The joins that stop a stale or foreign record being read as this child's.
    if rec.get("run_id") != run_id:
        P.append(f"record for {target_file} carries run_id {rec.get('run_id')!r}, "
                 f"not the {run_id!r} this child minted")
    if int(rec.get("pytest_exitstatus", -1)) != rc:
        P.append(f"record for {target_file} says exit {rec.get('pytest_exitstatus')!r} "
                 f"but the subprocess really exited {rc}")

    # ---- READ THE RECORD'S REAL SCHEMA, NOT THE PLUGIN'S INTERNAL ATTRIBUTE ---
    # `[MEASURED]` the serialized record has NO "outcomes" key. The plugin keeps
    # one internally and writes five DISJOINT LISTS instead. My first version
    # read rec["outcomes"], silently got {}, and reported every node as
    # "collected but never executed" -- an instrument-shaped lie that accused
    # 39 healthy tests. `[i-measured]`: I read the neighbouring object (the
    # attribute) and assumed the serialized key.
    #
    #   `THE SCHEMA IS THE ARTIFACT ON DISK, NEVER THE VARIABLE THAT PRODUCED IT.`
    outcomes = {}
    for bucket in ("passed", "failed", "skipped", "xfailed", "xpassed"):
        key = "failures" if bucket == "failed" else bucket
        for nid in (rec.get(key) or []):
            outcomes[nid] = bucket
    receipt["outcomes"] = outcomes
    receipt["collected"] = list(rec.get("collected") or [])
    # Cross-check the reconstruction against the plugin's own totals, so a future
    # schema change cannot silently empty this map again.
    declared = sum(int(rec.get(f"n_{b}", 0)) for b in
                   ("passed", "failures", "skipped", "xfailed", "xpassed"))
    if declared != len(outcomes):
        P.append(f"outcome reconstruction for {target_file} disagrees with the "
                 f"record's own totals: rebuilt {len(outcomes)}, declared {declared}")
    # A node that was collected and never produced an outcome is invisible to
    # every failure list and reads as NEW=0. It is its own recorded fact.
    unexecuted = sorted(set(receipt["collected"]) - set(receipt["outcomes"]))
    receipt["collected_but_unexecuted"] = unexecuted
    if unexecuted:
        P.append(f"{len(unexecuted)} node(s) collected but never executed in "
                 f"{target_file}: {unexecuted[:3]}")
    receipt["layer2_witness"] = next(
        (ln.strip() for ln in stdout.splitlines() if "[ACCEPT5-LAYER2]" in ln), "")
    if layer2 and not receipt["layer2_witness"]:
        P.append(f"Layer 2 was requested for {target_file} but printed no witness "
                 f"line -- an unwitnessed boundary is indistinguishable from none")
    return receipt


def aggregate(receipts):
    """Merge child receipts into one node-outcome map, measuring [B] as it goes."""
    outcomes, owner, duplicates = {}, {}, []
    for r in receipts:
        for nid, o in r["outcomes"].items():
            if nid in outcomes:
                duplicates.append((nid, owner[nid], r["file"]))
            outcomes[nid] = o
            owner[nid] = r["file"]
    return {
        "outcomes": outcomes,
        "duplicates": duplicates,
        "n_nodes": len(outcomes),
        "collected_but_unexecuted": sorted(
            n for r in receipts for n in r.get("collected_but_unexecuted", [])),
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--limit", type=int, default=0,
                    help="Run only the first N children (prototype smoke arms).")
    ap.add_argument("--reverse", action="store_true",
                    help="[G] execute children in REVERSE canonical order.")
    ap.add_argument("--no-layer2", action="store_true")
    ap.add_argument("--ownership-blind", action="store_true")
    ap.add_argument("--child-timeout", type=int, default=900)
    args = ap.parse_args(argv)

    head = _runner._git_head()
    if head is None:
        print(f"{REFUSED} - TREE AUTHORITY UNAVAILABLE: git could not resolve HEAD, "
              f"so this run cannot name the commit it measured. Nothing was started.")
        return 2

    try:
        plan = _pop.build()
    except _pop.PopulationError as exc:
        print(f"{REFUSED} - POPULATION NOT DERIVABLE: {exc}")
        return 2

    files = sorted(plan["children"])
    if args.reverse:
        files.reverse()
    if args.limit:
        files = files[:args.limit]

    run_root = args.out_dir / f"isolated-{uuid.uuid4().hex[:12]}"
    run_root.mkdir(parents=True, exist_ok=False)
    print(f"HEAD {head} | children {len(files)}"
          f"{' (LIMITED SUBSET - NOT A POPULATION RESULT)' if args.limit else ''}"
          f" | order {'REVERSE' if args.reverse else 'canonical'}")
    print(f"artifacts {run_root}")

    receipts, t0 = [], time.time()
    for i, f in enumerate(files, 1):
        r = run_child(f, plan["children"][f], run_root,
                      layer2=not args.no_layer2, blind=args.ownership_blind,
                      timeout=args.child_timeout)
        receipts.append(r)
        flag = "!!" if r["problems"] else "  "
        print(f"{flag} [{i:3d}/{len(files)}] rc={str(r['returncode']):>4} "
              f"{r['elapsed_s']:6.1f}s nodes={len(r['outcomes']):4d} {f}")
    wall = time.time() - t0

    agg = aggregate(receipts)
    bad = [r for r in receipts if r["problems"]]

    summary = {
        "head": head, "run_root": str(run_root), "children": len(files),
        "wall_s": round(wall, 1), "nodes": agg["n_nodes"],
        "duplicate_nodes": len(agg["duplicates"]),
        "collected_but_unexecuted": len(agg["collected_but_unexecuted"]),
        "invalid_children": [r["file"] for r in bad],
        "limited_subset": bool(args.limit), "reverse": bool(args.reverse),
        "layer2": not args.no_layer2, "ownership_blind": bool(args.ownership_blind),
        "outcomes": agg["outcomes"],
    }
    (run_root / "aggregate.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")

    print()
    print(f"[B] nodes aggregated          : {agg['n_nodes']}")
    print(f"[B] duplicate node IDs        : {len(agg['duplicates'])}")
    print(f"[B] collected-but-unexecuted  : {len(agg['collected_but_unexecuted'])}")
    print(f"[H] wall clock (serial)       : {wall/60:.1f} min")
    print(f"[D] invalid children          : {len(bad)}")
    for r in bad:
        for p in r["problems"]:
            print(f"      {p}")
    if bad:
        # [D]: no partial scoring. A population that did not fully execute cannot
        # produce a verdict, and reporting the part that ran would read as one.
        print(f"{REFUSED} - CHILD EXECUTION INVALID: {len(bad)} child(ren) did not "
              f"produce valid evidence. Nothing was scored.")
        return 2
    print(f"aggregate written             : {run_root / 'aggregate.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
