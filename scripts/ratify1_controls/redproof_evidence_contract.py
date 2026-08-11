#!/usr/bin/env python
"""Controls A-J for the certification EVIDENCE CONTRACT (R-840 §5).

WHAT THIS EXISTS TO PROVE, IN ONE LINE:

    AN ABSENT CHECK AND A PASSING CHECK ARE THE SAME VALUE TO all(), AND THAT
    IS WHY A FORGED ARM CERTIFIED AT EXIT 0.

`[MEASURED BY GRADED INSTRUMENT, GRADE-RATIFY1-REPAIR-2026-08-11]` the
comparator's verdict list was built by APPENDING. `--no-chain` skipped the
block that appends the provenance, node-axis and run-identity verdicts; `all()`
over the shorter list was True; the instrument printed SATISFIED. The repair
makes completeness a PROPERTY (R-840 §3[B]) and makes the certifying path
singular (§3[A]), the verified surface authoritative (§3[C]) and [H] the
runner's (§3[D]).

★ THE CONTROL THAT MATTERS MOST IS C. A, B, D, F, G, H and I each attack ONE
route. C attacks the CLASS behind them: it removes a required proof outright
and demands a REFUSAL rather than a pass. Per R-840 §5 at least one control
removes an ENTIRE EVIDENCE LAYER, not a field -- that is C2.

⚠️ FIXTURE DISCLOSURE, STATED LOUDLY BECAUSE IT IS THE KIND OF THING THAT
LAUNDERS A RESULT: the five historical arms were produced BEFORE R-840, so
their manifests carry NO runner timing witness and they can never satisfy
VERIFIED/TIMING_AUTHORITY. To give D/F/G/H/I a clean baseline that isolates the
verdict under test, this harness CLONES an arm and INJECTS a synthetic timing
witness into the clone. That makes the clone behave like a repaired-runner arm
FOR THE COMPARATOR'S CONTRACT ONLY. It proves nothing about the runner's
minting of that witness -- control E does that, end to end, against the real
runner with an injected clock.

    A FIXTURE NORMALIZES WHATEVER IT SKIPS, SO THE SKIP IS NAMED HERE AND
    COVERED SOMEWHERE ELSE.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
for _p in (str(REPO / "scripts"), str(HERE)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import g_order_identity as G                                   # noqa: E402
import accept5_isolated_runner as RUNNER                       # noqa: E402


def _sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def _load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def _dump(p, d):
    Path(p).write_text(json.dumps(d, indent=2, sort_keys=True), encoding="utf-8")


def reseal(agg_path):
    """Re-stamp receipt digests -> manifest -> aggregate, in that order.

    THE ONLY DIRECTION THAT MATTERS. A tamper that leaves a broken digest reds
    on "digest RECOMPUTES" -- a true verdict, but not the one the control is
    named for, and a control that fires for the wrong reason reports coverage
    it does not have. Every case below hands the verifier a PERFECTLY SEALED
    chain and forces it to catch the SEMANTIC defect.
    """
    agg_path = Path(agg_path)
    root = agg_path.parent
    man_path = root / "manifest.json"
    man = _load(man_path)
    for e in man["entries"]:
        rp = root / "receipts" / f"{e['ordinal']:04d}-{RUNNER._slug(e['target'])}.json"
        if rp.is_file():
            e["receipt_sha256"] = _sha(rp)
    _dump(man_path, man)
    agg = _load(agg_path)
    agg["manifest_sha256"] = _sha(man_path)
    _dump(agg_path, agg)
    return str(agg_path)


def clone(src_agg, workdir, tag, *, inject_timing=True, wall_s=377.7):
    """Copy an arm directory whole, so no tamper can touch the original."""
    dst = Path(workdir) / tag
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(Path(src_agg).parent, dst)
    agg = dst / "aggregate.json"
    if inject_timing:
        man_path = dst / "manifest.json"
        man = _load(man_path)
        # SYNTHETIC -- see the module docstring. Marked in the artifact itself
        # so nobody downstream can mistake this clone for a real arm.
        man["timing"] = {
            "clock": "time.monotonic",
            "wall_s": wall_s,
            "ceiling_s": RUNNER.CEILING_S,
            "within_ceiling": bool(wall_s <= RUNNER.CEILING_S),
            "children": len(man.get("entries") or []),
            "_synthetic_fixture": "injected by redproof_evidence_contract.py",
        }
        _dump(man_path, man)
        reseal(agg)
    return str(agg)


def receipt_path(agg, ordinal_index=0):
    root = Path(agg).parent
    man = _load(root / "manifest.json")
    e = man["entries"][ordinal_index]
    return root / "receipts" / f"{e['ordinal']:04d}-{RUNNER._slug(e['target'])}.json"


# ==========================================================================
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--workdir", required=True)
    ap.add_argument("--arm-a", required=True, help="canonical full-population arm")
    ap.add_argument("--arm-b", required=True, help="an independent REPEAT of it")
    ap.add_argument("--skip-runner", action="store_true",
                    help="skip control E (which executes one real child)")
    args = ap.parse_args(argv)

    W = Path(args.workdir)
    W.mkdir(parents=True, exist_ok=True)
    cases = []

    def case(name, ok, detail):
        cases.append((name, bool(ok), detail))

    PIN = _load(args.arm_a)["head"]
    req = G.authority_nodes()

    def compare_and_report(fa, fb, *, chain=True, node_axis="same",
                           mode="repeat", pin=PIN, drop=None):
        """Run the REAL comparator path and return (satisfied, V, stdout)."""
        import io
        import contextlib
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                V, D = G.compare(G.load_arm(fa), G.load_arm(fb), req, mode=mode,
                                 pin=pin, chain=chain, node_axis=node_axis)
                if drop:
                    V = [v for v in V if v[0] != drop]
                sat = G.report(G.load_arm(fa), G.load_arm(fb), req, V, D,
                               mode=mode, node_axis=node_axis, certifying=chain)
            return sat, V, buf.getvalue()
        except SystemExit as exc:
            return None, [], buf.getvalue() + f"\nREFUSED: {exc}"

    def failing(V):
        return [pid for pid, _n, ok, _d in V if not ok]

    # ---------------------------------------------------------------- BASE
    # The clean, timing-injected baseline. Every negative below is a mutation
    # of THIS, so any verdict already red here is not evidence about the case.
    base_a = clone(args.arm_a, W, "base_a")
    base_b = clone(args.arm_b, W, "base_b")

    # ---- J: KNOWN-GOOD => GREEN ------------------------------------------
    # THE POSITIVE CONTROL, AND IT RUNS FIRST ON PURPOSE. Without it, every
    # RED below is vacuous -- a comparator that refuses everything would score
    # nine out of ten.
    sat_j, V_j, out_j = compare_and_report(base_a, base_b)
    case("J  known-good pair, full chain => GREEN (and CONTRACT COMPLETE)",
         sat_j is True and not failing(V_j) and "MISSING 0" in out_j,
         f"satisfied={sat_j} failing={failing(V_j)[:3]} "
         f"contract={'complete' if 'MISSING 0' in out_j else 'INCOMPLETE'}")

    # ---- A: no-chain + certifying => REFUSE BEFORE COMPARISON ------------
    # `[MEASURED BY GRADED INSTRUMENT, CRITICAL-1]` this exact invocation used
    # to print "[I] SATISFIED" at exit 0 over a forged arm.
    proc = subprocess.run(
        [sys.executable, str(HERE / "g_order_identity.py"),
         "--forward", base_a, "--reverse", base_b, "--mode", "repeat",
         "--pin", PIN, "--node-axis", "same", "--no-chain"],
        cwd=str(REPO), capture_output=True, text=True)
    blob = proc.stdout + proc.stderr
    case("A  --pin WITH --no-chain => REFUSED before comparison, no SATISFIED",
         proc.returncode != 0 and G.REFUSED in blob and "SATISFIED" not in proc.stdout,
         f"exit={proc.returncode} refused={G.REFUSED in blob} "
         f"satisfied_printed={'SATISFIED' in proc.stdout}")

    # ---- B: missing node-axis => REFUSE ----------------------------------
    proc = subprocess.run(
        [sys.executable, str(HERE / "g_order_identity.py"),
         "--forward", base_a, "--reverse", base_b, "--mode", "repeat",
         "--pin", PIN],
        cwd=str(REPO), capture_output=True, text=True)
    blob = proc.stdout + proc.stderr
    case("B  --pin WITHOUT --node-axis => REFUSED",
         proc.returncode != 0 and G.REFUSED in blob and "SATISFIED" not in proc.stdout,
         f"exit={proc.returncode} refused={G.REFUSED in blob}")

    # ---- C: THE CLASS CONTROL --------------------------------------------
    # C1 removes ONE required proof from a run that is otherwise perfect. The
    # old instrument could not tell this from a pass, because a check that
    # never appends cannot fail.
    victim = "forward/VERIFIED/COLLECTED_BUT_UNEXECUTED"
    sat_c1, V_c1, out_c1 = compare_and_report(base_a, base_b, drop=victim)
    case("C1 ONE required proof REMOVED from a clean run => REFUSED",
         sat_c1 is False and "INCOMPLETE CERTIFICATION EVIDENCE" in out_c1
         and victim in out_c1 and not failing(V_c1),
         f"satisfied={sat_c1} named_in_output={victim in out_c1} "
         f"every_remaining_verdict_passed={not failing(V_c1)}")

    # C2 removes an ENTIRE EVIDENCE LAYER (R-840 §5's explicit requirement):
    # the whole chain, exactly as --no-chain did.
    sat_c2, V_c2, out_c2 = compare_and_report(base_a, base_b, chain=False)
    miss_c2 = [ln for ln in out_c2.splitlines() if ln.strip().startswith("MISSING")]
    # Join on the CERTIFYING HEADLINE exactly ("[I] SATISFIED - ..."), not on
    # the bare word. My first version searched for "SATISFIED" and caught the
    # refusal's OWN explanatory sentence -- the harness accused the code.
    headline = "[I] SATISFIED - "
    case("C2 an ENTIRE EVIDENCE LAYER removed (chain off) => cannot certify",
         sat_c2 is False and headline not in out_c2 and len(miss_c2) > 20,
         f"satisfied={sat_c2} certifying_headline_printed={headline in out_c2} "
         f"missing_proofs={len(miss_c2)} (the chain's whole contribution)")

    # ---- D: downward runtime lie => RED ----------------------------------
    # The grade's T1, verbatim: aggregate says 1.0s, receipts encode ~377s.
    d_agg = clone(args.arm_a, W, "d_low")
    _d = _load(d_agg); _d["wall_s"] = 1.0; _dump(d_agg, _d)
    sat_d, V_d, _ = compare_and_report(d_agg, base_b)
    case("D  downward runtime lie (wall_s=1.0, receipts untouched) => RED",
         sat_d is False and "forward/VERIFIED/H_RECONCILES" in failing(V_d),
         f"satisfied={sat_d} caught_by={failing(V_d)}")

    # ---- F: RESEALED collected-but-unexecuted => RED ---------------------
    # THE DANGEROUS DIRECTION: the aggregate claims ZERO and the whole chain
    # revalidates. Only a rebuild from the RAW lists can see it. A node is
    # added to `collected` that has no outcome -- outcomes, the oracle and the
    # node counts are all left untouched, so this isolates the new verdict.
    f_agg = clone(args.arm_a, W, "f_cbu")
    rp = receipt_path(f_agg)
    _r = _load(rp); _r["collected"] = list(_r["collected"]) + ["ghost.py::never_ran"]
    _dump(rp, _r); reseal(f_agg)
    sat_f, V_f, _ = compare_and_report(f_agg, base_b)
    case("F  resealed collected-but-unexecuted (aggregate claims 0) => RED",
         sat_f is False
         and "forward/VERIFIED/COLLECTED_BUT_UNEXECUTED" in failing(V_f),
         f"satisfied={sat_f} caught_by={failing(V_f)} "
         f"UNIQUE={failing(V_f) == ['forward/VERIFIED/COLLECTED_BUT_UNEXECUTED']}")

    # ---- G: RESEALED invalid child => RED --------------------------------
    # returncode 3 is not a valid execution status. The receipt still declares
    # `problems: []`, which is exactly what the old rebuild read.
    g_agg = clone(args.arm_a, W, "g_invalid")
    rp = receipt_path(g_agg)
    _r = _load(rp); _r["returncode"] = 3; _r["problems"] = []
    _dump(rp, _r); reseal(g_agg)
    sat_g, V_g, _ = compare_and_report(g_agg, base_b)
    case("G  resealed invalid child (rc=3, problems=[]) => RED",
         sat_g is False and "forward/VERIFIED/INVALID_CHILDREN" in failing(V_g),
         f"satisfied={sat_g} caught_by={failing(V_g)} "
         f"UNIQUE={failing(V_g) == ['forward/VERIFIED/INVALID_CHILDREN']}")

    # ---- I: duplicate false clean => RED ---------------------------------
    # One node ID owned by two children, with the SAME outcome value, so the
    # rebuilt map and the node count are unchanged and only the duplicate
    # derivation can see it.
    i_agg = clone(args.arm_a, W, "i_dup")
    root = Path(i_agg).parent
    n_entries = len(_load(root / "manifest.json")["entries"])
    # PICK TWO CHILDREN THAT ACTUALLY OWN NODES. Index 0 is
    # _a_packet_harness.py -- an empty_by_design child with ZERO outcomes -- so
    # the first version of this control stole nothing and silently tested
    # nothing. A mutation that does not BITE is not evidence.
    donors = []
    for i in range(n_entries):
        rp_i = receipt_path(i_agg, i)
        if rp_i.is_file() and _load(rp_i).get("outcomes"):
            donors.append((i, rp_i))
        if len(donors) == 2:
            break
    stolen = None
    if len(donors) == 2:
        r0, r1 = donors[0][1], donors[1][1]
        _r0, _r1 = _load(r0), _load(r1)
        for nid, outcome in _r0["outcomes"].items():
            if nid not in _r1["outcomes"]:
                stolen, stolen_outcome = nid, outcome
                break
    if stolen is not None:
        _r1["outcomes"][stolen] = stolen_outcome
        _dump(r1, _r1)
        reseal(i_agg)
    sat_i, V_i, _ = compare_and_report(i_agg, base_b)
    case("I  duplicate node owned by two children, aggregate says 0 => RED",
         stolen is not None and sat_i is False
         and "forward/VERIFIED/DUPLICATE_NODES" in failing(V_i),
         f"stolen={stolen} satisfied={sat_i} caught_by={failing(V_i)} "
         f"UNIQUE={failing(V_i) == ['forward/VERIFIED/DUPLICATE_NODES']}")

    # ---- H: false full-population claim => RED ---------------------------
    # A governed child is dropped from the arm entirely and the aggregate
    # still declares limited_subset=False.
    h_agg = clone(args.arm_a, W, "h_subset")
    root = Path(h_agg).parent
    man = _load(root / "manifest.json")
    dropped = man["entries"].pop()
    man["entries"] = [dict(e, ordinal=i) for i, e in enumerate(man["entries"], 1)]
    _dump(root / "manifest.json", man)
    _h = _load(h_agg)
    _h["children"] = len(man["entries"])
    _h["limited_subset"] = False
    _dump(h_agg, _h)
    reseal(h_agg)
    sat_h, V_h, _ = compare_and_report(h_agg, base_b)
    case("H  governed child dropped, still claims full population => RED",
         sat_h is False and "forward/VERIFIED/NOT_LIMITED_SUBSET" in failing(V_h),
         f"dropped={dropped['target']} satisfied={sat_h} "
         f"caught_by={failing(V_h)[:4]}")

    # ---- E: injected clock > 600s => THE RUNNER REFUSES ------------------
    # END TO END against the REAL runner, with a fake monotonic clock. R-840
    # §5 is explicit: inject the clock, do NOT wait ten real minutes.
    if not args.skip_runner:
        # INJECT INTO THE RUNNER'S NAMESPACE ONLY -- never the global clock.
        #
        # `[MEASURED HERE]` the first version replaced time.monotonic globally.
        # subprocess computes its OWN timeout deadlines from time.monotonic, so
        # the +700s jump made `git rev-parse HEAD` look instantly timed out;
        # the runner refused with "TREE AUTHORITY UNAVAILABLE" and control E
        # scored a refusal it had not caused.
        #
        #   A CONTROL THAT GETS THE RIGHT EXIT CODE FOR THE WRONG REASON IS A
        #   FALSE GREEN WEARING A RED COAT.
        driver = W / "_clock_injection_driver.py"
        driver.write_text(
            "import sys, time as _t\n"
            "sys.path.insert(0, r'%s')\n"
            "import accept5_isolated_runner as R\n"
            "class _Clock:\n"
            "    n = 0\n"
            "    def monotonic(self):\n"
            "        _Clock.n += 1\n"
            "        # call 1 is the parent's t0; every later call jumps 700s\n"
            "        return _t.monotonic() + (700.0 if _Clock.n > 1 else 0.0)\n"
            "    def __getattr__(self, k):\n"
            "        return getattr(_t, k)\n"
            "R.time = _Clock()\n"
            "sys.exit(R.main(sys.argv[1:]))\n" % str(REPO / "scripts"),
            encoding="utf-8")
        for tag, use_driver, expect_refuse in (("E_pos", False, False),
                                               ("E_neg", True, True)):
            out_dir = W / tag
            cmd = ([sys.executable, str(driver)] if use_driver
                   else [sys.executable, str(REPO / "scripts" / "accept5_isolated_runner.py")])
            proc = subprocess.run(cmd + ["--out-dir", str(out_dir), "--limit", "1"],
                                  cwd=str(REPO), capture_output=True, text=True,
                                  timeout=900)
            blob = proc.stdout + proc.stderr
            refused = ("CEILING BREACHED AT SOURCE" in blob)
            if expect_refuse:
                case("E  runner clock injected > 600s => RUNNER REFUSES AT SOURCE",
                     refused and proc.returncode == 2,
                     f"exit={proc.returncode} refused={refused}")
            else:
                # THE POSITIVE ARM. Without it, E is satisfied by a runner that
                # refuses every arm, and it also proves the witness is MINTED.
                minted = None
                for m in out_dir.rglob("manifest.json"):
                    t = _load(m).get("timing")
                    minted = (isinstance(t, dict)
                              and t.get("clock") == "time.monotonic"
                              and t.get("within_ceiling") is True)
                    break
                case("E+ same runner, real clock => NOT refused, witness MINTED",
                     (not refused) and proc.returncode == 0 and minted is True,
                     f"exit={proc.returncode} refused={refused} witness={minted}")

    # ---------------------------------------------------------------- REPORT
    print("=== EVIDENCE-CONTRACT RED-PROOF (R-840 §5, controls A-J) ===")
    print(f"    {len(cases)} controls in this suite")
    for name, ok, detail in cases:
        print(f"  {'OK  ' if ok else 'FAIL'}  {name:62s} {detail}")
    allok = all(ok for _, ok, _ in cases)
    print()
    print(f"EVIDENCE CONTRACT DISCRIMINATES ({len(cases)} controls)" if allok
          else "*** EVIDENCE CONTRACT NOT TRUSTWORTHY -- DO NOT CERTIFY ***")
    return 0 if allok else 1


if __name__ == "__main__":
    raise SystemExit(main())
