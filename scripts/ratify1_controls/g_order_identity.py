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


def authority_nodes():
    """The governed population, from the SAME authority [A]/[B] import.
    Never a hand-maintained roster (R-823 §5)."""
    import population_successor as _popsucc
    required, problems = _popsucc.required_population(REPO)
    if problems:
        raise SystemExit(f"{REFUSED} - the successor chain could not be derived: "
                         f"{problems[:3]}")
    return set(required)


def compare(fwd, rev, required, out_dir=None):
    """Return (verdicts, differences). Verdicts are (name, ok, detail)."""
    V = []

    # ---- ARMS-ARE-OPPOSED GUARD -------------------------------------------
    # Two forward runs diff to zero and read as a perfect pass. Refuse first.
    opposed = (fwd["reverse"] is False) and (rev["reverse"] is True)
    V.append(("arms genuinely OPPOSED (fwd=canonical, rev=REVERSE)", opposed,
              f"fwd.reverse={fwd['reverse']!r} rev.reverse={rev['reverse']!r}"))
    V.append(("both arms measured the SAME commit", fwd["head"] == rev["head"],
              f"{fwd['head']} vs {rev['head']}"))
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

    # ---- THE ORACLE --------------------------------------------------------
    D = diff(fwd["outcomes"], rev["outcomes"])
    V.append(("[G] EXACT node-outcome identity forward vs reverse", not D,
              f"{len(D)} differing node(s)"))

    if D and out_dir:
        p = Path(out_dir) / "G-DIFFERENCES.txt"
        p.write_text("".join(f"{k}\tforward={a}\treverse={b}\n" for k, a, b in D),
                     encoding="utf-8")
        print(f"  ALL {len(D)} differences persisted in full to {p}")
    return V, D


def report(fwd, rev, required, V, D):
    print()
    print("=== [G] DENOMINATORS -- STOP [41]: THESE ARE DIFFERENT NUMBERS ===")
    print(f"  child targets (files)     forward {fwd['children']:5d}   reverse {rev['children']:5d}")
    print(f"  governed nodes observed   forward {fwd['nodes']:5d}   reverse {rev['nodes']:5d}")
    print(f"  governed nodes REQUIRED   {len(required)}  (population authority)")
    print()
    print(f"=== [H] SERIAL WALL CLOCK -- pre-registered ceiling {CEILING_MIN} min per arm ===")
    for tag, arm in (("forward", fwd), ("reverse", rev)):
        mins = arm["wall_s"] / 60.0
        note = "OK" if mins <= CEILING_MIN else "*** EXCEEDS CEILING -- STOP AND REPORT, DO NOT PARALLELIZE ***"
        print(f"  {tag:8s} {mins:6.2f} min   {note}")
    print()
    if D:
        print(f"=== [G] DIFFERENCES -- ALL {len(D)}, NEVER SLICED ===")
        for k, a, b in D:
            print(f"  {k}\n      forward={a}   reverse={b}")
        print()
    print("=== [G] VERDICT ===")
    for name, ok, detail in V:
        print(f"  {'OK  ' if ok else 'FAIL'}  {name:52s} {detail}")
    allok = all(ok for _, ok, _ in V)
    print()
    print("[G] SATISFIED - EXACT NODE-OUTCOME IDENTITY UNDER REORDERING" if allok
          else "*** [G] NOT SATISFIED -- STOP AND REPORT. Do NOT repair while the "
               "ordered-pair evidence is half-understood (R-825 sec6[5]). ***")
    return allok


# --------------------------------------------------------------------------
# RED-PROOF: this instrument must be shown able to go RED before it is trusted.
# A green check with no demonstrated path to red is not a check.
# --------------------------------------------------------------------------
def red_proof():
    BASE = {"f.py::a": "passed", "f.py::b": "failed", "f.py::c": "skipped"}
    req = set(BASE)
    seq = [0]

    def arm(outcomes, *, reverse, **kw):
        seq[0] += 1
        d = {"outcomes": dict(outcomes), "children": 2, "nodes": len(outcomes),
             "wall_s": 12.0, "reverse": reverse, "head": "deadbeef",
             "duplicate_nodes": 0, "collected_but_unexecuted": 0,
             "invalid_children": [], "limited_subset": False,
             "_path": f"/synthetic/arm-{seq[0]}.json"}
        d.update(kw)
        return d

    cases = []

    def run(name, f, r, expect_pass):
        V, _ = compare(f, r, req)
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

    print("=== [G] COMPARATOR RED-PROOF ===")
    for name, ok, detail in cases:
        print(f"  {'OK  ' if ok else 'FAIL'}  {name:40s} {detail}")
    allok = all(ok for _, ok, _ in cases)
    print()
    print("COMPARATOR DISCRIMINATES - demonstrated path to RED on every arm"
          if allok else "*** COMPARATOR NOT TRUSTWORTHY -- DO NOT RUN [G] ***")
    return allok


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--forward", help="aggregate.json from the canonical-order arm")
    ap.add_argument("--reverse", help="aggregate.json from the REVERSE-order arm")
    ap.add_argument("--out-dir", default=None,
                    help="where to persist the FULL difference list, if any")
    ap.add_argument("--red-proof", action="store_true",
                    help="prove this comparator can go RED, then exit")
    args = ap.parse_args(argv)

    if args.red_proof:
        return 0 if red_proof() else 1
    if not (args.forward and args.reverse):
        ap.error("--forward and --reverse are required unless --red-proof")

    fwd, rev = load_arm(args.forward), load_arm(args.reverse)
    required = authority_nodes()
    V, D = compare(fwd, rev, required, out_dir=args.out_dir)
    return 0 if report(fwd, rev, required, V, D) else 1


if __name__ == "__main__":
    raise SystemExit(main())
