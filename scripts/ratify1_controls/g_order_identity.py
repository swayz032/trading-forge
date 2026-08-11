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


def compare(fwd, rev, required, out_dir=None, mode="order", pin=None):
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

    def run(name, f, r, expect_pass, mode="order", pin=REAL_PIN):
        V, _ = compare(f, r, req, mode=mode, pin=pin)
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
    cases.append(("C12 the red-proof's OWN default pin RESOLVES",
                  _resolves_to_commit(REAL_PIN),
                  f"{REAL_PIN[:12]}... resolves="
                  f"{_resolves_to_commit(REAL_PIN)}"))

    print("=== [G]/[I] COMPARATOR RED-PROOF ===")
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
    ap.add_argument("--mode", choices=("order", "repeat"), default="order",
                    help="order = [G] canonical vs REVERSE; "
                         "repeat = [I] same direction twice at an identical pin "
                         "(--forward/--reverse are then run-1/run-2)")
    ap.add_argument("--pin", default=None,
                    help="The exact commit SHA being certified. Both arms' "
                         "'head' must EQUAL it and it must RESOLVE (F-5). "
                         "Fail-closed: omitting it FAILS a certifying run.")
    ap.add_argument("--red-proof", action="store_true",
                    help="prove this comparator can go RED, then exit")
    args = ap.parse_args(argv)

    if args.red_proof:
        return 0 if red_proof() else 1
    if not (args.forward and args.reverse):
        ap.error("--forward and --reverse are required unless --red-proof")

    fwd, rev = load_arm(args.forward), load_arm(args.reverse)
    required = authority_nodes()
    V, D = compare(fwd, rev, required, out_dir=args.out_dir, mode=args.mode,
                   pin=args.pin)
    return 0 if report(fwd, rev, required, V, D, mode=args.mode) else 1


if __name__ == "__main__":
    raise SystemExit(main())
