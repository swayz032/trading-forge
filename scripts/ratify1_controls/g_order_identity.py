"""RATIFY-1 obligation [G] — EXACT node-outcome identity under child reordering.

R-825 §6[4]/[5]. The oracle, and it is not negotiable:

    [G] PASSES ONLY IF EVERY GOVERNED NODE HAS THE SAME EXACT OUTCOME IN BOTH
    DIRECTIONS, compared BY EXACT NODE ID.

    NOT the same failure count. NOT the same pass count. NOT "still 31".
    `STOP [37]`: the old map is CONTAMINATED evidence and is never a target.
    ONE unexplained exact-node difference => [G] FAILS => STOP AND REPORT.

WHY THIS FILE EXISTS AT ALL, AND WHY IT IS AN ADAPTER RATHER THAN A NEW ORACLE
    `[MEASURED, AR-985 §4]` the comparison FUNCTION already existed and was
    already RATIFIED: `redproof_cross_file_isolation.py:50 diff(a, b)`, exact by
    node ID, ratified through [E] at R-823 §2. It is carried here UNCHANGED.
    What did not exist was a driver that applies it to two 108-child
    `aggregate.json` maps and reconciles them against the 2419-node authority.

    `A MISSING ADAPTER IS NOT A MISSING ORACLE.`

THE PRINT STATEMENT IS THE PART THAT COULD LIE
    The ratified [E] control prints `d[:6]`. At [E]'s scale that is a display
    choice; at [G]'s scale it is exactly the R-822 §6 Q4 hazard — "truncating or
    summarizing mismatches away" — which is the reason seat 27448 handed off.
    THIS FILE NEVER SLICES. Every difference is printed and, when an out-dir is
    given, persisted in full to disk. A count is reported beside them, never
    instead of them.

THE GUARD THAT MATTERS MOST
    Two FORWARD runs diffed against each other produce ZERO differences and read
    as a perfect pass. So the arms must PROVE they are opposed (`reverse` flags
    differ) and PROVE they measured the same tree (`head` matches) before any
    verdict is computed. A comparison that cannot fail is not evidence.

FAIL-CLOSED, per the [C] discipline (R-823 §5): a missing field REFUSES the arm.
No `.get(field, default)` reconstruction anywhere.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
if str(REPO / "scripts") not in sys.path:
    sys.path.insert(0, str(REPO / "scripts"))

REFUSED = "ACCEPTANCE INSTRUMENT REFUSED"

REQUIRED_FIELDS = ("outcomes", "children", "nodes", "wall_s", "reverse", "head",
                   "duplicate_nodes", "collected_but_unexecuted",
                   "invalid_children", "limited_subset")

CEILING_MIN = 10.0          # [H] pre-registered, R-825 §6[6]


def diff(a, b):
    """EXACT by node ID. Carried UNCHANGED from the ratified [E] control
    (redproof_cross_file_isolation.py:50). Absence is an outcome, not a skip."""
    keys = sorted(set(a) | set(b))
    return [(k, a.get(k, "<absent>"), b.get(k, "<absent>")) for k in keys
            if a.get(k) != b.get(k)]


def load_arm(path):
    """Load one aggregate.json FAIL-CLOSED. Schema drift refuses the arm."""
    p = Path(path)
    if not p.is_file():
        raise SystemExit(f"{REFUSED} - no aggregate at {p}")
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except Exception as exc:                                   # noqa: BLE001
        raise SystemExit(f"{REFUSED} - aggregate at {p} is unreadable: {exc!r}")
    for f in REQUIRED_FIELDS:
        if f not in d:
            raise SystemExit(f"{REFUSED} - aggregate at {p} is missing required "
                             f"field {f!r}; schema drift refuses the arm rather "
                             f"than defaulting it")
    if not isinstance(d["outcomes"], dict):
        raise SystemExit(f"{REFUSED} - aggregate at {p} has non-dict 'outcomes'")
    d["_path"] = str(p)
    return d


def _resolves_to_commit(sha):
    """Does this SHA name a real commit object in THIS repo?

    R-827 §8[4] / grade finding F-5. The old guard asserted only that the two
    arms AGREED on `head`. `[MEASURED BY GRADED INSTRUMENT]` setting BOTH arms to
    `deadbeefdeadbeef...` therefore yielded "OK both arms measured the SAME
    commit" and "[G] SATISFIED", exit 0.

        TWO ARMS AGREEING ON A COMMIT THAT DOES NOT EXIST AGREE ABOUT NOTHING.
    """
    import subprocess
    if not isinstance(sha, str) or not sha:
        return False
    try:
        out = subprocess.run(["git", "cat-file", "-t", sha], cwd=str(REPO),
                             capture_output=True, text=True, timeout=30)
    except Exception:                                          # noqa: BLE001
        return False
    return out.returncode == 0 and out.stdout.strip() == "commit"


def authority_nodes():
    """The governed population, from the SAME authority [A]/[B] import.
    Never a hand-maintained roster (R-823 §5)."""
    import population_successor as _popsucc
    required, problems = _popsucc.required_population(REPO)
    if problems:
        raise SystemExit(f"{REFUSED} - the successor chain could not be derived: "
                         f"{problems[:3]}")
    return set(required)


def _sha_bytes(p):
    import hashlib
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def verify_chain(tag, arm):
    """LAYER 4: recompute the provenance chain from BYTES. Returns verdicts.

    R-827 §8[4], closing F-1. `[MEASURED BY GRADED INSTRUMENT]` the old
    load_arm() opened ONLY aggregate.json, so a copied map with one flipped byte
    -- sitting in a directory containing no child artifacts at all -- certified
    15/15 OK, exit 0.

        A 0-DIFFERENCE RESULT PROVES THE TWO INPUTS AGREE; IT CARRIES NO TERM
        FOR WHETHER THEY ARE TWO INDEPENDENT PIECES OF EVIDENCE. THE CHAIN IS
        WHAT ADDS THAT TERM.

    Every check below RECOMPUTES a value and compares it to a stored one. No
    field is believed because it was written down, and there is deliberately no
    `provenance_verified` boolean to trust (R-827 §8[4]).
    """
    import hashlib
    import json as _json
    V = []
    root = Path(arm["_path"]).parent

    def add(name, ok, detail):
        V.append((f"{tag}: {name}", ok, detail))

    mpath = root / "manifest.json"
    if not mpath.is_file():
        add("provenance manifest EXISTS", False,
            f"no manifest.json beside {arm['_path']} -- an aggregate with no "
            f"chain cannot be distinguished from a forgery")
        return V
    add("provenance manifest EXISTS", True, str(mpath))

    if "manifest_sha256" not in arm:
        add("aggregate NAMES its manifest by digest", False,
            "aggregate has no 'manifest_sha256' -- pre-chain schema, REFUSED")
        return V
    got = _sha_bytes(mpath)
    add("manifest digest RECOMPUTES", got == arm["manifest_sha256"],
        f"stored={arm['manifest_sha256'][:12]} recomputed={got[:12]}")

    try:
        man = _json.loads(mpath.read_text(encoding="utf-8"))
    except Exception as exc:                                   # noqa: BLE001
        add("manifest is readable", False, repr(exc))
        return V

    entries = man.get("entries") or []
    add("children count == manifest entries",
        len(entries) == arm["children"],
        f"aggregate={arm['children']} manifest={len(entries)}")

    # Ordinals exactly 1..N, no gaps, no duplicates.
    ords = [e.get("ordinal") for e in entries]
    add("ordinals are exactly 1..N", ords == list(range(1, len(entries) + 1)),
        f"{len(ords)} ordinals, first={ords[:3]} last={ords[-3:] if ords else []}")

    # Every receipt recomputes from its own bytes, and every child artifact
    # recomputes from ITS bytes. This is the step that opens a child at all.
    bad_receipt, bad_artifact, missing, unbound = [], [], [], []
    heads, rebuilt, seqs, run_ids = set(), {}, {}, set()
    for e in entries:
        rp = root / "receipts" / f"{e['ordinal']:04d}-{_slug_like(e['target'])}.json"
        if not rp.is_file():
            missing.append(e["target"]); continue
        if _sha_bytes(rp) != e["receipt_sha256"]:
            bad_receipt.append(e["target"]); continue
        try:
            r = _json.loads(rp.read_text(encoding="utf-8"))
        except Exception:                                      # noqa: BLE001
            bad_receipt.append(e["target"]); continue
        heads.add(r.get("head_sha"))
        run_ids.add(r.get("run_id"))
        seqs[e["target"]] = list(r.get("node_sequence") or [])
        rebuilt.update(r.get("outcomes") or {})
        # RESOLVE CHILD ARTIFACTS RELATIVE TO *THIS* ARM, never via the absolute
        # child_dir the receipt recorded. `[MEASURED, C2]` following the recorded
        # path made the verifier read the ORIGINAL arm's untampered artifacts
        # while verifying a tampered COPY -- so C2 came back GREEN.
        #
        #   A VERIFIER THAT FOLLOWS A PATH THE ARTIFACT SUPPLIED IS VERIFYING
        #   WHATEVER THAT PATH POINTS AT, NOT THE THING IN FRONT OF IT.
        cd = root / _slug_like(e["target"])
        digests = r.get("artifact_sha256") or {}
        for label, digest in digests.items():
            ap = cd / label
            if not ap.is_file() or _sha_bytes(ap) != digest:
                bad_artifact.append(f"{e['target']}:{label}")
        # THE CLASS RULE (R-828 §4b): no file in a child directory may be
        # UNBOUND. Checking only the digests the receipt happens to list makes
        # the receipt the authority on its own completeness -- which is how the
        # empty_by_design children passed with an empty map and a tampered
        # artifact. The DIRECTORY is the authority; the receipt must cover it.
        if cd.is_dir():
            present = {p.name for p in cd.iterdir() if p.is_file()}
            for orphan in sorted(present - set(digests)):
                unbound.append(f"{e['target']}:{orphan}")

    add("every receipt PRESENT", not missing, f"{len(missing)} missing {missing[:3]}")
    add("every receipt digest RECOMPUTES", not bad_receipt,
        f"{len(bad_receipt)} mismatched {bad_receipt[:3]}")
    add("every child artifact digest RECOMPUTES", not bad_artifact,
        f"{len(bad_artifact)} mismatched {bad_artifact[:3]}")
    add("NO UNBOUND FILE in any child directory", not unbound,
        f"{len(unbound)} unbound {unbound[:3]}")

    # ---- C13 (R-828 §4a): the arm must not MUTATE the tree it measures -----
    # arm_start_head == arm_end_head binds COMMITS. A working-tree write moves
    # no commit, so the chain can prove an arm measured one COMMIT while the
    # measurement itself edited the TREE. AR-992 measured exactly that.
    ts, te = man.get("arm_start_tree"), man.get("arm_end_tree")
    if ts is None or te is None:
        add("C13 arm records its tracked-tree state", False,
            "manifest has no arm_start_tree/arm_end_tree -- pre-C13 schema")
    else:
        add("C13 tracked working tree UNCHANGED across the arm", ts == te,
            f"start={ts[:12]} end={te[:12]}"
            + ("" if ts == te else "  <- the arm MUTATED the tree it certifies"))

    # The aggregate's payload must be REBUILT from the receipts, not copied.
    add("outcomes REBUILD from the receipts", rebuilt == arm["outcomes"],
        f"rebuilt={len(rebuilt)} aggregate={len(arm['outcomes'])}")
    add("nodes count RECOMPUTES", len(rebuilt) == arm["nodes"],
        f"rebuilt={len(rebuilt)} declared={arm['nodes']}")

    # F-6: one pin for the whole arm, start to end, child by child.
    add("arm_start_head == arm_end_head",
        man.get("arm_start_head") == man.get("arm_end_head"),
        f"{man.get('arm_start_head')} -> {man.get('arm_end_head')}")
    add("every child measured the arm's pin",
        heads == {arm["head"]} if heads else False,
        f"distinct child heads={len(heads)} {sorted(heads)[:2]}")

    # `reverse` DERIVED from the observed ordinal sequence, never believed.
    targets = [e["target"] for e in entries]
    canonical = sorted(targets)
    derived_rev = (targets == list(reversed(canonical)))
    if targets == canonical:
        derived_rev = False
    add("reverse is DERIVED and matches the claim",
        derived_rev == bool(arm["reverse"]),
        f"claimed={arm['reverse']!r} derived={derived_rev!r}")

    arm["_node_sequences"] = seqs
    arm["_run_ids"] = run_ids
    return V


def _slug_like(p):
    """The runner's OWN _slug, imported -- never re-implemented.

    A second copy of a naming rule is a second registry: it agrees until the day
    it does not, and then the verifier cannot find receipts that exist.
    """
    import accept5_isolated_runner as _r
    return _r._slug(p)


def compare(fwd, rev, required, out_dir=None, mode="order", pin=None,
            chain=True, node_axis=None):
    """Return (verdicts, differences). Verdicts are (name, ok, detail).

    mode="order"   [G]: the arms must be OPPOSED -- canonical vs REVERSE.
    mode="repeat"  [I]: the arms must be the SAME direction, run twice at an
                        identical pin and environment.

    EACH MODE ASSERTS THE RELATIONSHIP *IT* NEEDS, and this is NOT a relaxation
    of [G]'s guard: a [G] pair handed to repeat mode FAILS, and a repeat pair
    handed to order mode FAILS. Both are red-proofed below.

        `A COMPARISON WHOSE ARMS ARE NOT IN THE CLAIMED RELATIONSHIP IS NOT
         EVIDENCE FOR THAT CLAIM -- IT IS TWO NUMBERS THAT HAPPEN TO MATCH.`
    """
    V = []

    # ---- ARM-RELATIONSHIP GUARD -------------------------------------------
    # Two same-direction runs diff to zero and would read as a perfect [G]
    # pass; two OPPOSED runs prove nothing about REPEATABILITY. Refuse first.
    if mode == "order":
        rel_ok = (fwd["reverse"] is False) and (rev["reverse"] is True)
        rel_name = "[G] arms genuinely OPPOSED (canonical vs REVERSE)"
    elif mode == "repeat":
        rel_ok = fwd["reverse"] == rev["reverse"]
        rel_name = "[I] arms are the SAME direction, run twice"
    else:
        raise SystemExit(f"{REFUSED} - unknown mode {mode!r}")
    V.append((rel_name, rel_ok,
              f"fwd.reverse={fwd['reverse']!r} rev.reverse={rev['reverse']!r}"))
    V.append(("both arms measured the SAME commit", fwd["head"] == rev["head"],
              f"{fwd['head']} vs {rev['head']}"))

    # ---- F-5 / F-6: ANCHOR THE PIN, DO NOT MERELY AGREE ON IT --------------
    # Agreement between arms is a relation between two claims. Neither of them
    # is bound to a commit that exists, nor to the commit being certified.
    for tag, arm in (("forward", fwd), ("reverse", rev)):
        V.append((f"{tag}: head RESOLVES to a real commit",
                  _resolves_to_commit(arm["head"]), f"{arm['head']}"))
    # Fail-closed: an unsupplied pin is a MISSING binding, never a waived one.
    V.append(("arms are bound to the CERTIFIED pin", pin is not None
              and fwd["head"] == pin and rev["head"] == pin,
              f"pin={pin!r} fwd={fwd['head']!r} rev={rev['head']!r}"
              + ("  <- NO --pin SUPPLIED; a certifying run must bind one"
                 if pin is None else "")))

    # ---- F-2: [H] IS A GATE, NOT A PRINTED LINE ----------------------------
    # The wall-clock check used to live only in report(); it never entered the
    # verdict list that the exit code folds, so a forged wall_s of 60x the
    # ceiling printed its own warning and returned 0.
    #
    #   A CHECK THAT PRINTS ITS OWN FAILURE AND EXITS ZERO IS NOT A GATE --
    #   IT IS A LOG LINE WITH AN OPINION.
    for tag, arm in (("forward", fwd), ("reverse", rev)):
        mins = arm["wall_s"] / 60.0
        V.append((f"{tag}: [H] wall clock <= {CEILING_MIN} min",
                  mins <= CEILING_MIN, f"{mins:.2f} min"))
    V.append(("arms are distinct artifacts", fwd["_path"] != rev["_path"],
              f"{fwd['_path']} vs {rev['_path']}"))
    V.append(("neither arm is a LIMITED SUBSET",
              (fwd["limited_subset"] is False) and (rev["limited_subset"] is False),
              f"fwd={fwd['limited_subset']!r} rev={rev['limited_subset']!r}"))

    # ---- PER-ARM INTEGRITY -------------------------------------------------
    for tag, arm in (("forward", fwd), ("reverse", rev)):
        V.append((f"{tag}: invalid children == 0", not arm["invalid_children"],
                  f"{len(arm['invalid_children'])} {arm['invalid_children'][:5]}"))
        V.append((f"{tag}: duplicate node IDs == 0", arm["duplicate_nodes"] == 0,
                  str(arm["duplicate_nodes"])))
        V.append((f"{tag}: collected-but-unexecuted == 0",
                  arm["collected_but_unexecuted"] == 0,
                  str(arm["collected_but_unexecuted"])))
        obs = set(arm["outcomes"])
        missing = sorted(required - obs)
        invented = sorted(obs - required)
        V.append((f"{tag}: missing required nodes == 0", not missing,
                  f"{len(missing)} {missing[:5]}"))
        V.append((f"{tag}: invented/unauthorized nodes == 0", not invented,
                  f"{len(invented)} {invented[:5]}"))

    # ---- LAYER 4: VERIFY THE CHAIN BEFORE COMPARING ANYTHING ---------------
    # VERIFY-BEFORE-COMPARE. A 0-difference result computed over unverified
    # inputs is exactly the false green F-1 describes, so the chain verdicts sit
    # in the SAME list the exit code folds.
    if chain:
        V.extend(verify_chain("forward", fwd))
        V.extend(verify_chain("reverse", rev))

        # ---- ARE THESE TWO RUNS AT ALL? ------------------------------------
        # `[MEASURED, C5]` comparing an arm against a COPY of itself passed:
        # the "distinct artifacts" guard only compares _path strings, and a copy
        # lives at a different path. Every child run_id is minted per execution,
        # so disjoint run_id sets is the cheapest proof of two real executions.
        #
        #   TWO FILES IN TWO DIRECTORIES ARE NOT TWO PIECES OF EVIDENCE.
        ra, rb = fwd.get("_run_ids") or set(), rev.get("_run_ids") or set()
        shared_ids = ra & rb
        V.append(("arms are two DISTINCT EXECUTIONS (run_ids disjoint)",
                  bool(ra) and bool(rb) and not shared_ids,
                  f"fwd={len(ra)} rev={len(rb)} shared={len(shared_ids)}"))

        # ---- [G-NODE] CROSS-ARM RELATIONSHIP -------------------------------
        # node_axis="same"    the pair must NOT vary intra-file order
        # node_axis="reverse" the pair MUST vary it, and each shared child's
        #                     executed sequence must be the EXACT reverse.
        # Derived from the recorded sequences; the arms' own reverse_nodes flag
        # is a claim checked against it, never the source of truth.
        if node_axis in ("same", "reverse"):
            a = fwd.get("_node_sequences") or {}
            b = rev.get("_node_sequences") or {}
            shared = sorted(set(a) & set(b))
            if not shared:
                V.append((f"[G-NODE] arms share children to compare ({node_axis})",
                          False, "no shared child node sequences recorded"))
            else:
                # A 0- or 1-node child satisfies BOTH `a == b` and
                # `a == reversed(b)`. Testing "is not the reverse" for the
                # "same" case would therefore flag every singleton child as a
                # violation, so each case asserts its OWN relation directly.
                if node_axis == "same":
                    bad = [t for t in shared if a[t] != b[t]]
                else:
                    bad = [t for t in shared if a[t] != list(reversed(b[t]))]
                V.append((f"[G-NODE] intra-file order is {node_axis.upper()} "
                          f"across the arms", not bad,
                          f"{len(shared)} shared children, {len(bad)} violating "
                          f"{bad[:3]}"))
                # ...and for a REVERSE pair the axis must have ACTUALLY varied.
                # Satisfying "a == reversed(b)" across nothing but singletons
                # would be a vacuous pass: the arms would be identical.
                if node_axis == "reverse":
                    varied = [t for t in shared if len(a[t]) >= 2 and a[t] != b[t]]
                    V.append(("[G-NODE] the node axis GENUINELY varied",
                              bool(varied),
                              f"{len(varied)} child(ren) with >=2 nodes actually "
                              f"reordered, of {len(shared)} shared"))
            V.append(("[G-NODE] arms' declared node axis matches the request",
                      (fwd.get("reverse_nodes") is not rev.get("reverse_nodes"))
                      is (node_axis == "reverse"),
                      f"fwd.reverse_nodes={fwd.get('reverse_nodes')!r} "
                      f"rev.reverse_nodes={rev.get('reverse_nodes')!r}"))

    # ---- THE ORACLE --------------------------------------------------------
    D = diff(fwd["outcomes"], rev["outcomes"])
    V.append((("[G] EXACT node-outcome identity forward vs reverse"
               if mode == "order" else
               "[I] EXACT node-outcome identity across repeats"), not D,
              f"{len(D)} differing node(s)"))

    if D and out_dir:
        p = Path(out_dir) / f"{'G' if mode == 'order' else 'I'}-DIFFERENCES.txt"
        p.write_text("".join(f"{k}\tforward={a}\treverse={b}\n" for k, a, b in D),
                     encoding="utf-8")
        print(f"  ALL {len(D)} differences persisted in full to {p}")
    return V, D


def report(fwd, rev, required, V, D, mode="order"):
    ob = "[G]" if mode == "order" else "[I]"
    a, b = (("forward", "reverse") if mode == "order" else ("run-1  ", "run-2  "))
    print()
    print(f"=== {ob} DENOMINATORS -- STOP [41]: THESE ARE DIFFERENT NUMBERS ===")
    print(f"  child targets (files)     {a} {fwd['children']:5d}   {b} {rev['children']:5d}")
    print(f"  governed nodes observed   {a} {fwd['nodes']:5d}   {b} {rev['nodes']:5d}")
    print(f"  governed nodes REQUIRED   {len(required)}  (population authority)")
    print()
    print(f"=== [H] SERIAL WALL CLOCK -- pre-registered ceiling {CEILING_MIN} min per arm ===")
    for tag, arm in ((a.strip(), fwd), (b.strip(), rev)):
        mins = arm["wall_s"] / 60.0
        note = "OK" if mins <= CEILING_MIN else "*** EXCEEDS CEILING -- STOP AND REPORT, DO NOT PARALLELIZE ***"
        print(f"  {tag:8s} {mins:6.2f} min   {note}")
    print()
    if D:
        print(f"=== {ob} DIFFERENCES -- ALL {len(D)}, NEVER SLICED ===")
        for nid, x, y in D:
            print(f"  {nid}\n      {a.strip()}={x}   {b.strip()}={y}")
        print()
    print(f"=== {ob} VERDICT ===")
    for name, ok, detail in V:
        print(f"  {'OK  ' if ok else 'FAIL'}  {name:52s} {detail}")
    allok = all(ok for _, ok, _ in V)
    print()
    if allok:
        print(f"{ob} SATISFIED - " + ("EXACT NODE-OUTCOME IDENTITY UNDER REORDERING"
                                      if mode == "order" else
                                      "EXACT NODE-OUTCOME IDENTITY ACROSS REPEATS "
                                      "AT AN IDENTICAL PIN"))
    else:
        print(f"*** {ob} NOT SATISFIED -- STOP AND REPORT. Do NOT repair while the "
              f"evidence is half-understood (R-825 sec6[5]). ***")
    return allok


# --------------------------------------------------------------------------
# RED-PROOF: this instrument must be shown able to go RED before it is trusted.
# A green check with no demonstrated path to red is not a check.
# --------------------------------------------------------------------------
def red_proof():
    BASE = {"f.py::a": "passed", "f.py::b": "failed", "f.py::c": "skipped"}
    req = set(BASE)
    seq = [0]

    # C12 / F-5's ROOT: these fixtures used to hardcode head="deadbeef", so the
    # controls that certify this comparator were themselves written against a
    # pin that resolves nowhere -- and the instrument was therefore never taught
    # to demand a real one.
    #
    #   A RED-PROOF FIXTURE IS A SPECIFICATION. WHATEVER IT NORMALIZES, THE
    #   INSTRUMENT WILL ACCEPT FOREVER.
    #
    # The default fixture pin is now this repo's real HEAD, and C12 below
    # asserts that it genuinely resolves rather than assuming it.
    import subprocess
    REAL_PIN = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(REPO),
                              capture_output=True, text=True).stdout.strip()

    def arm(outcomes, *, reverse, **kw):
        seq[0] += 1
        d = {"outcomes": dict(outcomes), "children": 2, "nodes": len(outcomes),
             "wall_s": 12.0, "reverse": reverse, "head": REAL_PIN,
             "duplicate_nodes": 0, "collected_but_unexecuted": 0,
             "invalid_children": [], "limited_subset": False,
             "_path": f"/synthetic/arm-{seq[0]}.json"}
        d.update(kw)
        return d

    cases = []

    # These synthetic cases exercise the ORACLE AND GUARD LOGIC, not the
    # provenance chain -- their arms are in-memory dicts with no run directory.
    # chain=False is therefore correct here AND IS NOT A WAIVER: the chain has
    # its own controls, built on a REAL chain the runner actually produced, in
    # red_proof_chain() below. C12's lesson is that a fixture normalizes
    # whatever it skips, so the skip is bounded and separately covered.
    def run(name, f, r, expect_pass, mode="order", pin=REAL_PIN, chain=False):
        V, _ = compare(f, r, req, mode=mode, pin=pin, chain=chain)
        ok = all(v for _, v, _ in V)
        cases.append((name, ok is expect_pass,
                      f"expected {'GREEN' if expect_pass else 'RED'}, "
                      f"got {'GREEN' if ok else 'RED'}"))

    # 1. POSITIVE CONTROL -- it must be able to pass, or every RED below is vacuous
    run("identical opposed maps => GREEN", arm(BASE, reverse=False),
        arm(BASE, reverse=True), True)
    # 2. the oracle itself: ONE flipped outcome
    flipped = dict(BASE, **{"f.py::b": "passed"})
    run("ONE flipped node outcome => RED", arm(BASE, reverse=False),
        arm(flipped, reverse=True), False)
    # 3. a node present in one arm only
    dropped = {k: v for k, v in BASE.items() if k != "f.py::c"}
    run("node absent in one arm => RED", arm(BASE, reverse=False),
        arm(dropped, reverse=True), False)
    # 4. a node the authority never authorized
    invented = dict(BASE, **{"f.py::ghost": "passed"})
    run("invented/unauthorized node => RED", arm(invented, reverse=False),
        arm(invented, reverse=True), False)
    # 5. THE GUARD: two FORWARD arms must never read as a pass
    run("two FORWARD arms (not opposed) => RED", arm(BASE, reverse=False),
        arm(BASE, reverse=False), False)
    # 6. arms measuring different trees
    run("arms on different commits => RED", arm(BASE, reverse=False),
        arm(BASE, reverse=True, head="cafe1234"), False)
    # 7. a subset may never produce a population verdict
    run("limited subset arm => RED", arm(BASE, reverse=False),
        arm(BASE, reverse=True, limited_subset=True), False)
    # 8. an invalid child anywhere invalidates the run
    run("invalid child present => RED", arm(BASE, reverse=False),
        arm(BASE, reverse=True, invalid_children=["x.py"]), False)
    # 9. duplicates and unexecuted nodes are their own recorded facts
    run("duplicate node IDs => RED", arm(BASE, reverse=False),
        arm(BASE, reverse=True, duplicate_nodes=3), False)
    run("collected-but-unexecuted => RED", arm(BASE, reverse=False),
        arm(BASE, reverse=True, collected_but_unexecuted=2), False)

    # ---- [I] REPEAT MODE, and the CROSS-MODE guard ------------------------
    # Each mode must reject the OTHER mode's pair, or "repeat" would be a
    # back door that launders a [G] pair into an [I] claim and vice versa.
    run("[I] two canonical repeats, identical => GREEN", arm(BASE, reverse=False),
        arm(BASE, reverse=False), True, mode="repeat")
    run("[I] repeats with ONE flipped outcome => RED", arm(BASE, reverse=False),
        arm(flipped, reverse=False), False, mode="repeat")
    run("[I] two REVERSE repeats, identical => GREEN", arm(BASE, reverse=True),
        arm(BASE, reverse=True), True, mode="repeat")
    run("[I] rejects an OPPOSED ([G]) pair => RED", arm(BASE, reverse=False),
        arm(BASE, reverse=True), False, mode="repeat")
    run("[G] rejects a SAME-DIRECTION ([I]) pair => RED", arm(BASE, reverse=False),
        arm(BASE, reverse=False), False, mode="order")

    # ---- C8..C12, ADDED UNDER R-827 §8[1] ---------------------------------
    # C8/C9 close F-2: the ceiling must have a demonstrated path to RED *and*
    # a positive arm, or it is satisfied by a gate that reds on everything.
    over = CEILING_MIN * 60.0 + 0.01
    run(f"C8  wall_s over the ceiling ({over:.2f}s) => RED",
        arm(BASE, reverse=False, wall_s=over), arm(BASE, reverse=True), False)
    run("C9  wall_s under the ceiling => GREEN", arm(BASE, reverse=False),
        arm(BASE, reverse=True), True)
    # The grader's exact F-2 attack, kept verbatim so the fixture names the
    # measurement it descends from.
    run("C8b the grader's forged wall_s=36000.0 (60x) => RED",
        arm(BASE, reverse=False, wall_s=36000.0), arm(BASE, reverse=True), False)
    # C10 closes F-5: BOTH arms agreeing on a commit that resolves nowhere.
    DEAD = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    run("C10 both arms on a NON-RESOLVING commit => RED",
        arm(BASE, reverse=False, head=DEAD), arm(BASE, reverse=True, head=DEAD),
        False, pin=DEAD)
    # ...and the same maps with a real, bound pin must still pass, or C10 would
    # be indistinguishable from "the comparator dislikes this fixture".
    run("C10b same maps with a REAL bound pin => GREEN", arm(BASE, reverse=False),
        arm(BASE, reverse=True), True)
    # C11: an arm whose head is real but is NOT the pin being certified.
    run("C11 arms not bound to the certified pin => RED", arm(BASE, reverse=False),
        arm(BASE, reverse=True), False, pin=DEAD)
    # Fail-closed: no pin supplied at all is a MISSING binding, not a waiver.
    run("C11b no --pin supplied => RED", arm(BASE, reverse=False),
        arm(BASE, reverse=True), False, pin=None)

    # C12: the control suite audits ITS OWN fixtures. This is the only case here
    # whose subject is the other cases, and it may not be dropped as meta --
    # F-5 existed precisely because nobody asserted this.
    # ---- C13's SURFACE ITSELF (R-829 §4[2]) --------------------------------
    # C13 compares a digest at arm start and arm end. That comparison is only
    # meaningful if the digest MOVES for an in-surface change and DOES NOT move
    # for the ruled out-of-surface one. Both directions, or the control is a
    # constant. Measured against the real repo, then restored.
    import accept5_isolated_runner as _air
    base = _air._authority_surface_digest()
    probe = REPO / "scripts" / "_c13_surface_probe.tmp"
    moved = out_moved = None
    try:
        probe.write_text("in-surface probe\n", encoding="utf-8")
        moved = _air._authority_surface_digest()
    finally:
        if probe.exists():
            probe.unlink()
    restored = _air._authority_surface_digest()
    cases.append(("C13a an IN-SURFACE change moves the digest => detectable",
                  base is not None and moved is not None and base != moved,
                  f"base={str(base)[:10]} withProbe={str(moved)[:10]}"))
    cases.append(("C13b the digest RESTORES when the change is reverted",
                  base == restored,
                  f"base={str(base)[:10]} restored={str(restored)[:10]}"))
    # And the ruled exclusion, asserted rather than assumed: the writer's target
    # is OUT of the surface, so a change to it must NOT move the digest. This is
    # what stops C13 becoming R-807 §4's false-RED-on-every-run.
    rep = REPO / "docs" / "wave25-exit-engine-ab-report.md"
    if rep.is_file():
        orig = rep.read_bytes()
        try:
            rep.write_bytes(orig + b"\n<!-- c13 out-of-surface probe -->\n")
            out_moved = _air._authority_surface_digest()
        finally:
            rep.write_bytes(orig)
        cases.append(("C13c an OUT-OF-SURFACE change (the ruled writer) does NOT move it",
                      out_moved == base,
                      f"base={str(base)[:10]} withDocsEdit={str(out_moved)[:10]}"))

    cases.append(("C12 the red-proof's OWN default pin RESOLVES",
                  _resolves_to_commit(REAL_PIN),
                  f"{REAL_PIN[:12]}... resolves="
                  f"{_resolves_to_commit(REAL_PIN)}"))

    print("=== [G]/[I] COMPARATOR RED-PROOF ===")
    print("    (oracle + guard logic; the CHAIN has its own controls -- "
          "--red-proof-chain)")
    for name, ok, detail in cases:
        print(f"  {'OK  ' if ok else 'FAIL'}  {name:40s} {detail}")
    allok = all(ok for _, ok, _ in cases)
    print()
    print("COMPARATOR DISCRIMINATES - demonstrated path to RED on every arm"
          if allok else "*** COMPARATOR NOT TRUSTWORTHY -- DO NOT RUN [G] ***")
    return allok


def red_proof_chain(workdir, a1, a2, a3):
    """C1..C7 on a REAL chain the runner actually produced.

    R-827 §8[5]. Synthetic dicts cannot exercise a chain, and a chain control
    written against a synthetic fixture would normalize exactly the absence it
    is supposed to detect (C12's lesson). So this TAMPERS COPIES of genuine
    full-population arms.

    ⚠️ WHY NOT `--limit`: the first version of this built its own cheap arms with
    `--limit 2`. That sets `limited_subset=True`, which the comparator correctly
    refuses -- so EVERY case went RED, the negatives "passed" for a reason that
    had nothing to do with the chain, and the positives failed.

        A NEGATIVE CONTROL THAT WOULD HAVE BEEN RED ANYWAY MEASURES NOTHING.
        THE POSITIVE ARM IS WHAT EXPOSED IT.

    So these run against the real arms, which are full-population by
    construction. Every negative is paired with a positive.

    a1 canonical . a2 an independent canonical REPEAT . a3 node-reversed.
    """
    import json as _json
    import shutil
    import subprocess
    W = Path(workdir)
    W.mkdir(parents=True, exist_ok=True)

    # THE PIN UNDER CERTIFICATION IS THE ARMS' OWN, NOT THE CURRENT HEAD.
    # The first version used `git rev-parse HEAD`, which had moved on past the
    # commit the arms measured -- so the pin-binding verdict failed for EVERY
    # case, all six negatives were red for a reason unrelated to what they test,
    # and once again the POSITIVE controls were the only thing that noticed.
    # Second time this exact shape appeared here; see 4.2b in the spec.
    PIN = load_arm(a1)["head"]

    req = authority_nodes()
    cases = []

    def run(name, f, r, expect_pass, mode="repeat", node_axis=None, pin=PIN):
        try:
            V, _ = compare(load_arm(f), load_arm(r), req, mode=mode, pin=pin,
                           chain=True, node_axis=node_axis)
            ok = all(v for _, v, _ in V)
            why = next((n for n, v, d in V if not v), "")
        except SystemExit as exc:
            ok, why = False, f"REFUSED: {exc}"
        cases.append((name, ok is expect_pass,
                      f"expected {'GREEN' if expect_pass else 'RED'}, got "
                      f"{'GREEN' if ok else 'RED'}"
                      + (f" [{why}]" if not ok else "")))

    def clone(src, tag):
        """Copy a whole arm directory so tampering never touches the original."""
        dst = W / tag
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(Path(src).parent, dst)
        return dst / "aggregate.json"

    def reseal(aggpath):
        """Re-stamp the aggregate's manifest_sha256 after editing the manifest.

        WITHOUT THIS, a manifest tamper reds on "manifest digest RECOMPUTES" --
        a TRUE verdict, but not the one the control is named for. A control that
        fires for a different reason than its name is the same disease as a
        control that would have fired anyway: it reports coverage it does not
        have. C6/C7/C13 therefore hand the verifier a perfectly-sealed chain and
        force it to catch the SEMANTIC defect.
        """
        agg = Path(aggpath)
        d = _json.loads(agg.read_text(encoding="utf-8"))
        d["manifest_sha256"] = _sha_bytes(agg.parent / "manifest.json")
        agg.write_text(_json.dumps(d, indent=2, sort_keys=True), encoding="utf-8")
        return aggpath

    def edit(p, fn):
        d = _json.loads(Path(p).read_text(encoding="utf-8"))
        fn(d)
        Path(p).write_text(_json.dumps(d, indent=2, sort_keys=True), encoding="utf-8")
        return p

    # The pin is taken from the arms, so it must be ANCHORED independently or
    # the binding check would be circular: an arm cannot vouch for its own pin.
    cases.append(("C10c the arms' pin RESOLVES to a real commit",
                  _resolves_to_commit(PIN), f"{PIN[:12]}..."))

    # ---- POSITIVE CONTROLS FIRST ------------------------------------------
    run("C4  genuine independent pair, full chain => GREEN", a1, a2, True,
        node_axis="same")
    run("C4b genuine [G-NODE] pair (nodes reversed) => GREEN", a1, a3, True,
        node_axis="reverse")

    # ---- C1: the grade's own attack, on a real chain ----------------------
    lone = W / "forged"
    lone.mkdir(exist_ok=True)
    shutil.copy(a1, lone / "aggregate.json")
    edit(lone / "aggregate.json", lambda d: d.update(reverse=True))
    run("C1  aggregate copied ALONE, reverse flipped => RED",
        a1, lone / "aggregate.json", False, mode="order")

    # ---- C2: a child artifact tampered after its receipt was minted -------
    c2 = clone(a2, "c2")
    victim = next(Path(c2).parent.glob("*/acceptance-run.xml"))
    victim.write_bytes(victim.read_bytes() + b"<!-- tampered -->")
    run("C2  child artifact tampered => RED", a1, c2, False, node_axis="same")

    # ---- C2b: the EXACT case that returned GREEN (R-828 §6[2]) ------------
    # Tamper an `empty_by_design` child specifically. Before the class repair
    # these children had NO digests at all, so this tamper was invisible; a
    # generic "tamper some child" arm would have kept passing over it.
    c2b = clone(a2, "c2b")
    empties = [p for p in (Path(c2b).parent / "receipts").glob("*.json")
               if _json.loads(p.read_text(encoding="utf-8")).get("empty_by_design")]
    if not empties:
        cases.append(("C2b empty_by_design child available to tamper", False,
                      "no empty_by_design child found -- control cannot run"))
    else:
        tgt = _json.loads(empties[0].read_text(encoding="utf-8"))["file"]
        cdir = Path(c2b).parent / _slug_like(tgt)
        victim = sorted(p for p in cdir.iterdir() if p.is_file())[0]
        victim.write_bytes(victim.read_bytes() + b"\n<!-- tampered -->")
        run(f"C2b tamper on an empty_by_design child ({victim.name}) => RED",
            a1, c2b, False, node_axis="same")

    # ---- C2c: an UNBOUND file in a child directory -------------------------
    # The class rule: the DIRECTORY is the authority on what must be bound, not
    # the receipt's own list. A stray artifact nobody hashed is a hole.
    c2c = clone(a2, "c2c")
    anychild = next(p for p in Path(c2c).parent.iterdir()
                    if p.is_dir() and p.name != "receipts")
    (anychild / "unbound-extra.txt").write_text("not covered by any digest",
                                                encoding="utf-8")
    run("C2c an UNBOUND file in a child directory => RED", a1, c2c, False,
        node_axis="same")

    # ---- C13: the arm mutated the tree it certifies ------------------------
    c13 = clone(a2, "c13")
    mp13 = Path(c13).parent / "manifest.json"
    m13 = _json.loads(mp13.read_text(encoding="utf-8"))
    m13["arm_end_tree"] = "f" * 64        # simulate a tracked-tree mutation
    mp13.write_text(_json.dumps(m13, indent=2), encoding="utf-8")
    reseal(c13)
    run("C13 tracked tree CHANGED across the arm => RED", a1, c13, False,
        node_axis="same")

    # ---- C3: a child that measured a different tree -----------------------
    c3 = clone(a2, "c3")
    edit(next((Path(c3).parent / "receipts").glob("*.json")),
         lambda d: d.update(head_sha="0" * 40))
    run("C3  child head differs from the arm pin => RED", a1, c3, False,
        node_axis="same")

    # ---- C5: an arm compared against ITSELF --------------------------------
    c5 = clone(a1, "c5")
    run("C5  arm compared against a copy of itself => RED", a1, c5, False,
        node_axis="same")

    # ---- C6: a receipt removed, children decremented to match --------------
    c6 = clone(a2, "c6")
    mp = Path(c6).parent / "manifest.json"
    man = _json.loads(mp.read_text(encoding="utf-8"))
    dropped = man["entries"].pop()
    mp.write_text(_json.dumps(man, indent=2), encoding="utf-8")
    (Path(c6).parent / "receipts" /
     f"{dropped['ordinal']:04d}-{_slug_like(dropped['target'])}.json").unlink()
    edit(c6, lambda d: d.update(children=len(man["entries"]),
                                manifest_sha256=_sha_bytes(mp)))
    run("C6  receipt removed + children decremented => RED", a1, c6, False,
        node_axis="same")

    # ---- C7: THE SHARPEST -- entries re-sorted, every digest still valid ---
    c7 = clone(a2, "c7")
    mp = Path(c7).parent / "manifest.json"
    man = _json.loads(mp.read_text(encoding="utf-8"))
    man["entries"] = list(reversed(man["entries"]))
    mp.write_text(_json.dumps(man, indent=2), encoding="utf-8")
    reseal(c7)
    run("C7  manifest entries RE-SORTED, all digests valid => RED",
        a1, c7, False, node_axis="same")

    print()
    print("=== PROVENANCE CHAIN RED-PROOF (C1-C7, real chain) ===")
    for name, ok, detail in cases:
        print(f"  {'OK  ' if ok else 'FAIL'}  {name:52s} {detail}")
    allok = all(ok for _, ok, _ in cases)
    print()
    print("CHAIN DISCRIMINATES - a forged or tampered arm cannot certify"
          if allok else "*** CHAIN NOT TRUSTWORTHY -- DO NOT RUN THE FINAL ARMS ***")
    return allok


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--forward", help="aggregate.json from the canonical-order arm")
    ap.add_argument("--reverse", help="aggregate.json from the REVERSE-order arm")
    ap.add_argument("--out-dir", default=None,
                    help="where to persist the FULL difference list, if any")
    ap.add_argument("--mode", choices=("order", "repeat"), default="order",
                    help="order = [G] canonical vs REVERSE; "
                         "repeat = [I] same direction twice at an identical pin "
                         "(--forward/--reverse are then run-1/run-2)")
    ap.add_argument("--pin", default=None,
                    help="The exact commit SHA being certified. Both arms' "
                         "'head' must EQUAL it and it must RESOLVE (F-5). "
                         "Fail-closed: omitting it FAILS a certifying run.")
    ap.add_argument("--node-axis", choices=("same", "reverse"), default=None,
                    help="[G-NODE]: 'reverse' = the arms MUST vary intra-file "
                         "node order (each shared child's executed sequence is "
                         "the exact reverse); 'same' = they must NOT.")
    ap.add_argument("--no-chain", action="store_true",
                    help="Skip provenance verification. FOR DIAGNOSIS ONLY -- a "
                         "certifying run must never use it (F-1).")
    ap.add_argument("--red-proof", action="store_true",
                    help="prove this comparator can go RED, then exit")
    ap.add_argument("--red-proof-chain", metavar="WORKDIR", default=None,
                    help="run C1-C7 against TAMPERED COPIES of real "
                         "full-population arms, then exit. Requires "
                         "--chain-a1/--chain-a2/--chain-a3.")
    ap.add_argument("--chain-a1", default=None, help="canonical arm aggregate")
    ap.add_argument("--chain-a2", default=None, help="independent canonical REPEAT")
    ap.add_argument("--chain-a3", default=None, help="node-reversed arm")
    args = ap.parse_args(argv)

    if args.red_proof:
        return 0 if red_proof() else 1
    if args.red_proof_chain:
        if not (args.chain_a1 and args.chain_a2 and args.chain_a3):
            ap.error("--red-proof-chain needs --chain-a1/--chain-a2/--chain-a3 "
                     "(real FULL-POPULATION arms; a --limit subset makes every "
                     "case red for the wrong reason)")
        return 0 if red_proof_chain(args.red_proof_chain, args.chain_a1,
                                    args.chain_a2, args.chain_a3) else 1
    if not (args.forward and args.reverse):
        ap.error("--forward and --reverse are required unless --red-proof")

    fwd, rev = load_arm(args.forward), load_arm(args.reverse)
    required = authority_nodes()
    V, D = compare(fwd, rev, required, out_dir=args.out_dir, mode=args.mode,
                   pin=args.pin, chain=not args.no_chain,
                   node_axis=args.node_axis)
    return 0 if report(fwd, rev, required, V, D, mode=args.mode) else 1


if __name__ == "__main__":
    raise SystemExit(main())
