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
import hashlib
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
import population_successor as _popsucc        # noqa: E402

REPO = _runner.REPO
REFUSED = "ACCEPTANCE INSTRUMENT REFUSED"


def _slug(path: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", path).strip("_")


def _authority_surface_digest():
    """Cleanliness over the AUTHORITY'S OWN source surface, at one instant.

    C13, as AMENDED by R-829 §2/§4[1].

    ⚠️ MY FIRST VERSION DIGESTED THE WHOLE TRACKED TREE. That is the exact
    false-RED class R-807 §4 closed: a governed member rewrites the tracked
    docs/wave25-exit-engine-ab-report.md on EVERY acceptance run
    (ACCEPT5-TEST-SIDE-EFFECT-1, ruled OUTPUT-ONLY), so a whole-tree gate would
    REFUSE EVERY AUTHORITATIVE RUN -- "a new false RED wearing the words fail
    closed".

        AN AUTHORITY FIX IMPLEMENTED LITERALLY CAN RE-CREATE THE FALSE-RED
        CLASS IT WAS MEANT TO GUARD.

    So the surface is DERIVED BY IMPORT from acceptance_runner, never re-listed:
    the bytes that DECIDE WHAT PYTEST EXECUTES. Re-listing would fork the surface
    the day someone edits `testpaths` --
        A HARD-CODED PATH LIST IS A SNAPSHOT OF A CONFIG THAT LIVES IN A FILE
        THE LIST IS SUPPOSED TO GUARD.
    🛑 And NOTHING is exempted BY NAME here: docs/wave25-... is outside the
    surface for a ruled reason, not because this function excuses it. A by-name
    exemption is the allowlist shape that once excused 24 kill-switch assertions.

    UNTRACKED COUNTS, mirroring the authority: pytest auto-loads conftest.py and
    no manifest names it.
    """
    import hashlib as _h
    import subprocess as _sp
    paths = list(_runner.AUTHORITY_SOURCE_PATHS)      # IMPORTED, never re-listed
    parts = []
    for cmd in (["git", "status", "--porcelain", "--untracked-files=all", "--", *paths],
                ["git", "diff", "HEAD", "--", *paths]):
        try:
            out = _sp.run(cmd, cwd=str(REPO), capture_output=True, timeout=120)
        except Exception:                                      # noqa: BLE001
            return None
        if out.returncode != 0:
            return None
        parts.append(out.stdout or b"")
    return _h.sha256(b"\0".join(parts)).hexdigest()



_REQUIRED_BY_FILE = None


def _required_nodes_for(target_file):
    """Node IDs the POPULATION AUTHORITY requires from this file.

    R-823 §5: the exit-5 allowance must consult the SAME authority [A]/[B]
    already import -- never a hand-maintained EMPTY_HELPER_FILES list. A
    hardcoded roster is a second population registry wearing a helper's costume,
    and it would silently bless a file that stopped holding tests.
    """
    global _REQUIRED_BY_FILE
    if _REQUIRED_BY_FILE is None:
        required, problems = _popsucc.required_population(REPO)
        if problems:
            raise _pop.PopulationError(
                f"the successor chain could not be derived: {problems[:3]}")
        by_file = {}
        for nid in required:
            by_file.setdefault(nid.split("::")[0], set()).add(nid)
        _REQUIRED_BY_FILE = by_file
    return _REQUIRED_BY_FILE.get(target_file, set())


def run_child(*args, **kwargs):
    """Execute one governed child, then bind EVERY artifact it produced.

    R-828 §4 -- the CLASS repair for STOP C.

    `[MEASURED, R-828 §4]` `_run_child_inner` has EIGHT `return receipt` paths
    before the point where artifacts used to be hashed (:149 :184 :188 :191 :195
    :198 :203 :247). Every one produced a receipt with an EMPTY
    `artifact_sha256`, so those children's artifacts were UNBOUND and a tamper on
    them was undetectable -- exactly how control C2 came back GREEN.

        THE WORKER FOUND ONE DOOR AND CORRECTLY REFUSED TO FIX ONLY THAT DOOR.
        THERE ARE EIGHT. AN INSTANCE FIX WOULD HAVE LEFT SEVEN OPEN AND A GREEN
        C2 TO PROVE THEM SAFE.

    So the hashing is not placed on the paths at all. It is placed OUTSIDE the
    function that HAS the paths, where no `return` can skip it -- and it binds
    EVERY FILE PRESENT rather than three hardcoded labels, so an artifact nobody
    updated this code for is bound the day it appears.

    STOP F: this changes nothing a child REPORTS. It reads bytes and records
    digests; it does not touch outcomes, collected, problems or returncode.
    """
    receipt = _run_child_inner(*args, **kwargs)
    cd = Path(receipt.get("child_dir", ""))
    if cd.is_dir():
        for p in sorted(cd.iterdir()):
            if p.is_file():
                receipt["artifact_sha256"][p.name] = hashlib.sha256(
                    p.read_bytes()).hexdigest()
    return receipt


def _run_child_inner(target_file, targets, run_root, *, layer2=True, blind=False,
                     timeout=900, head_sha=None, ordinal=None, reverse_nodes=False):
    """Execute ONE governed file in its own interpreter and return its receipt."""
    run_id = uuid.uuid4().hex
    if head_sha is None:
        head_sha = _runner._git_head()
    child_dir = run_root / _slug(target_file)
    # exist_ok=False is the point: a child that would reuse a directory is a
    # child that could score somebody else's artifacts.
    child_dir.mkdir(parents=True, exist_ok=False)
    out_json = child_dir / "acceptance-run.json"
    out_xml = child_dir / "acceptance-run.xml"
    out_seq = child_dir / "node-sequence.json"

    cmd = [sys.executable, "-m", "pytest", *targets,
           "-q", "--no-header", "-p", "no:cacheprovider",
           "-p", "scripts.acceptance_pytest_plugin",
           "-p", "scripts.accept5_isolation_plugin",
           f"--acceptance-out={out_json}", f"--junitxml={out_xml}",
           f"--acceptance-run-id={run_id}",
           f"--accept5-node-sequence-out={out_seq}"]
    if layer2:
        cmd.append("--accept5-layer2")
    if blind:
        cmd.append("--accept5-ownership-blind")
    if reverse_nodes:
        cmd.append("--accept5-reverse-nodes")

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
        # R-822 §5[C]: the receipt binds the CHILD, not the parent. It must carry
        # the exact commit it measured -- a receipt that cannot name its own tree
        # is a claim about "some checkout", which is what R3 exists to remove.
        "head_sha": head_sha,
        # R-827 §8[4] / F-6: the child's own pin is now PERSISTED and compared,
        # not merely re-derived and dropped. And the EXECUTION ORDINAL is what
        # lets `reverse` be DERIVED at verification instead of believed.
        "ordinal": ordinal,
        "reverse_nodes": bool(reverse_nodes),
        "node_sequence": [],
        "child_dir": str(child_dir), "returncode": rc, "elapsed_s": round(elapsed, 2),
        "timed_out": timed_out, "problems": [], "outcomes": {}, "collected": [],
        # Artifact HASHES, not merely paths. A path proves a file was named; a
        # hash proves WHICH bytes were scored, and it survives the directory.
        "artifact_sha256": {},
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
            required_here = _required_nodes_for(target_file)
            if (_r is not None
                    and isinstance(_r.get("n_collected"), int)
                    and _r["n_collected"] == 0
                    and not required_here):
                # ALL of: record exists, it collected nothing, and the AUTHORITY
                # requires no node from this file. A file the authority expects
                # tests from is REFUSED on exit 5, and so is -k deselection
                # (n_collected > 0).
                receipt["empty_by_design"] = True
                receipt["collected_but_unexecuted"] = []
                return receipt
            if required_here:
                P.append(f"pytest exited 5 for {target_file} but the population "
                         f"authority requires {len(required_here)} node(s) from it")
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
    # R-823 §5: STRICT, FAIL-CLOSED. No `.get(field, [])` anywhere below.
    # The defect this replaces is the reason: reading a key the artifact does not
    # have returned {} and accused 39 healthy tests of never executing. A schema
    # that has drifted must REFUSE THE CHILD, never be silently reconstructed.
    #
    #   IF THE ARTIFACT CANNOT BE READ ON ITS OWN TERMS, THE ANSWER IS "REFUSE",
    #   NOT "ASSUME EMPTY".
    BUCKETS = {"passed": "passed", "failed": "failures", "skipped": "skipped",
               "xfailed": "xfailed", "xpassed": "xpassed"}
    schema_bad = False
    for field in (*BUCKETS.values(), "collected"):
        if field not in rec:
            P.append(f"record for {target_file} is missing required field {field!r} "
                     f"-- schema drift; refusing the child rather than defaulting")
            schema_bad = True
        elif not isinstance(rec[field], list):
            P.append(f"record for {target_file} has {field!r} of type "
                     f"{type(rec[field]).__name__}, expected list")
            schema_bad = True
    for field in [f"n_{b}" for b in (*BUCKETS.values(), "collected")]:
        if field not in rec or not isinstance(rec[field], int):
            P.append(f"record for {target_file} is missing or mistyped {field!r}")
            schema_bad = True
    if schema_bad:
        return receipt

    outcomes, seen_in = {}, {}
    for bucket, field in BUCKETS.items():
        for nid in rec[field]:
            if nid in seen_in:
                # Mutual disjointness: a node in two outcome lists means the
                # record cannot say what happened to it, so nothing may be scored.
                P.append(f"record for {target_file} lists {nid} in BOTH "
                         f"{seen_in[nid]!r} and {field!r} -- outcome lists must be "
                         f"mutually disjoint")
            seen_in[nid] = field
            outcomes[nid] = bucket
    receipt["outcomes"] = outcomes
    receipt["collected"] = list(rec["collected"])
    receipt["n_collected"] = rec["n_collected"]
    # The union must reconcile with the record's OWN declared totals.
    declared = sum(rec[f"n_{f}"] for f in BUCKETS.values())
    if declared != len(outcomes):
        P.append(f"outcome reconstruction for {target_file} disagrees with the "
                 f"record's own totals: rebuilt {len(outcomes)}, declared {declared}")
    if rec["n_collected"] != len(rec["collected"]):
        P.append(f"record for {target_file} declares n_collected="
                 f"{rec['n_collected']} but lists {len(rec['collected'])}")
    # A node that was collected and never produced an outcome is invisible to
    # every failure list and reads as NEW=0. It is its own recorded fact.
    unexecuted = sorted(set(receipt["collected"]) - set(receipt["outcomes"]))
    receipt["collected_but_unexecuted"] = unexecuted
    if unexecuted:
        P.append(f"{len(unexecuted)} node(s) collected but never executed in "
                 f"{target_file}: {unexecuted[:3]}")
    # ---- [G-NODE] WITNESS: the order the nodes ACTUALLY RAN ----------------
    # Read from the child's own artifact rather than re-derived from `collected`,
    # so a child that executed in an order other than the one it claims stays
    # detectable. Fail-closed like every other field here.
    if not out_seq.is_file():
        P.append(f"the node-sequence witness was not written for {target_file} "
                 f"-- [G-NODE] cannot be derived, so the child is refused")
    else:
        try:
            _seq = json.loads(out_seq.read_text(encoding="utf-8"))
            receipt["node_sequence"] = list(_seq["node_sequence"])
        except Exception as exc:                               # noqa: BLE001
            P.append(f"the node-sequence witness for {target_file} is unreadable "
                     f"or malformed: {exc!r}")

    # (Artifact hashing now happens in run_child(), OUTSIDE this function, so no
    # return path can skip it and no artifact goes unbound. R-828 §4.)
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
                    help="[G-FILE] execute children in REVERSE canonical order.")
    ap.add_argument("--reverse-nodes", action="store_true",
                    help="[G-NODE] reverse the node order WITHIN each child "
                         "(R-827 §2). Orthogonal to --reverse; the two axes "
                         "combine into the four final arms A/B/C/D.")
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

    tree_start = _authority_surface_digest()     # C13, R-828 §4a / R-829 §2
    receipts, t0 = [], time.time()
    for i, f in enumerate(files, 1):
        r = run_child(f, plan["children"][f], run_root,
                      layer2=not args.no_layer2, blind=args.ownership_blind,
                      timeout=args.child_timeout, head_sha=head, ordinal=i,
                      reverse_nodes=args.reverse_nodes)
        receipts.append(r)
        flag = "!!" if r["problems"] else "  "
        print(f"{flag} [{i:3d}/{len(files)}] rc={str(r['returncode']):>4} "
              f"{r['elapsed_s']:6.1f}s nodes={len(r['outcomes']):4d} {f}")
    wall = time.time() - t0

    agg = aggregate(receipts)
    bad = [r for r in receipts if r["problems"]]

    # ---- THE PROVENANCE CHAIN (R-827 §8[4], closing F-1) -------------------
    # Until now every one of these receipts -- run_id, per-child head,
    # artifact_sha256 -- was computed and then DISCARDED when main() returned.
    # `[MEASURED BY GRADED INSTRUMENT, F-1]` that is why a copied aggregate with
    # one flipped byte, sitting in a directory containing NO child artifacts at
    # all, certified 15/15 OK and exit 0.
    #
    #   THE PROVENANCE WAS NEVER MISSING FROM THE RUN. IT WAS MISSING FROM THE
    #   ARTIFACT, AND ONLY THE ARTIFACT SURVIVES TO BE COMPARED.
    #
    # LAYER 1: one receipt file per child, individually digest-addressable.
    receipts_dir = run_root / "receipts"
    receipts_dir.mkdir(parents=True, exist_ok=False)
    entries = []
    for r in receipts:
        rp = receipts_dir / f"{r['ordinal']:04d}-{_slug(r['file'])}.json"
        rp.write_text(json.dumps(r, indent=2, sort_keys=True), encoding="utf-8")
        entries.append({
            "ordinal": r["ordinal"], "target": r["file"],
            "receipt_sha256": hashlib.sha256(rp.read_bytes()).hexdigest(),
            "node_sequence_sha256": hashlib.sha256(
                json.dumps(r["node_sequence"]).encode("utf-8")).hexdigest(),
        })

    # LAYER 2: the ORDERED manifest. `entries` is a SEQUENCE, never sorted --
    # serialising it sorted would destroy the only witness to execution order.
    arm_end_head = _runner._git_head()
    tree_end = _authority_surface_digest()
    manifest = {
        "arm_start_head": head,
        "arm_end_head": arm_end_head,
        "arm_start_tree": tree_start,
        "arm_end_tree": tree_end,
        "population_digest": hashlib.sha256(
            json.dumps(sorted(plan["children"])).encode("utf-8")).hexdigest(),
        "reverse": bool(args.reverse),
        "reverse_nodes": bool(args.reverse_nodes),
        "entries": entries,
    }
    mpath = run_root / "manifest.json"
    mpath.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    summary = {
        "head": head, "run_root": str(run_root), "children": len(files),
        "wall_s": round(wall, 1), "nodes": agg["n_nodes"],
        "duplicate_nodes": len(agg["duplicates"]),
        "collected_but_unexecuted": len(agg["collected_but_unexecuted"]),
        "invalid_children": [r["file"] for r in bad],
        "limited_subset": bool(args.limit), "reverse": bool(args.reverse),
        "reverse_nodes": bool(args.reverse_nodes),
        "layer2": not args.no_layer2, "ownership_blind": bool(args.ownership_blind),
        # LAYER 3: the aggregate now NAMES its manifest by digest. Every claim
        # below it is recomputable; none of it has to be believed.
        "arm_start_head": head,
        "arm_end_head": arm_end_head,
        "manifest_sha256": hashlib.sha256(mpath.read_bytes()).hexdigest(),
        "outcomes": agg["outcomes"],
    }
    (run_root / "aggregate.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
    if arm_end_head != head:
        print(f"{REFUSED} - THE TREE MOVED MID-ARM: started {head}, ended "
              f"{arm_end_head}. This arm measured more than one commit.")
        return 2

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
