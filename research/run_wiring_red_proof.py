#!/usr/bin/env python3
"""RED-PROOF FOR THE WIRING ITSELF. ALGO-047 ordered the brain wired in; this proves it obeys.

THE GAP THIS EXISTS TO CLOSE. The §7 mutation campaign plants defects in the derivation layer
and proves the MACHINE's guards bite. It says nothing about whether the KERNEL obeys the
machine's verdict, and every one of these fakes would leave that campaign at 19/19:

    import the module and ignore `granted` · wire Route A and leave the breakout family on the
    old predicates · wire the 5m routes and leave BRK15 on its own copy · ask the machine but
    hand it the wrong frame · collapse Route D's two forms onto one label

So the mutations here are planted in `kernel.py` — the wiring — and each names the test that
must go RED. A test that stays green under its own mutation is reported as SURVIVED, which is
this harness failing, not passing.

SAME DISCIPLINE AS THE §7 CAMPAIGN, because it was earned the hard way: a positive witness that
the named test is GREEN first (a red-before proves nothing), a target that must be UNIQUE in the
file, a SHA256 check that the bytes actually changed (a silent no-op replace already cost this
campaign a cycle), the named test must go RED, then byte-exact restore verified by SHA256
against THIS RUN'S OWN starting bytes — never against git cleanliness, which answers a different
question and false-alarms on legitimate in-progress edits.

Run: PYTHONPATH=. python -m research.run_wiring_red_proof
"""
from __future__ import annotations

import ast
import hashlib
import io
import json
import os
import subprocess
import sys
from pathlib import Path

KERNEL = "research/current_mnq_strategy_v2_4_kernel.py"
T_WIRED = "tests/test_current_mnq_strategy_v2_4_entry_authority_is_wired.py"
T_INTEG = "tests/test_current_mnq_strategy_v2_4_integration.py"
OUT = Path("research/current_mnq_strategy_v2_4_wiring_red_proof_2026_08_23.json")

#: (id, what the fake looks like, find, replace, the test that MUST go red)
#: Every one is a way of LOOKING wired while not being wired.
ARMS = [
    ("W1", "Route A ignores the authority's verdict and grants on the plan gate alone",
     "                    if a.granted and plan_allows_v24(plan, direction, \"REV\", a.story, loc, p):",
     "                    if plan_allows_v24(plan, direction, \"REV\", a.story, loc, p):",
     f"{T_WIRED}::test_route_A_follows_the_authority"),

    ("W2", "the breakout family takes the first route asked, granted or not",
     "                        if a.granted:\n                            reason = REASON_BY_FORM[a.form]",
     "                        if True:\n                            reason = REASON_BY_FORM[a.form]",
     f"{T_WIRED}::test_the_breakout_family_refuses_when_every_route_refuses"),

    ("W3", "the BRK15 variant ignores the verdict, as its hand-rolled predecessor did",
     "    return snap if a.granted else None",
     "    return snap",
     f"{T_WIRED}::test_the_BRK15_variant_follows_the_authority"),

    ("W4", "the variant is asked as a plain Route B, losing the weak-break requirement",
     "        route=auth.ROUTE_B_BREAKOUT, variant=auth.VARIANT_BRK15,",
     "        route=auth.ROUTE_B_BREAKOUT, variant=None,",
     f"{T_WIRED}::test_the_BRK15_variant_is_asked_as_a_variant_of_route_B"),

    ("W5", "Route D's two forms collapse onto one label, mislabelling a real entry",
     "    brk.FORM_BREAK_RETEST: \"ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE\",",
     "    brk.FORM_BREAK_RETEST: \"PREBREAK_REPEAT_TEST_INTRA5_FORCE\",",
     f"{T_WIRED}::test_each_breakout_route_reaches_the_kernel_with_its_OWN_reason",),

    ("W6", "route precedence reverses, so the same inputs produce a different route's trade",
     "BREAKOUT_ROUTE_ORDER = (\n    auth.ROUTE_C_PREBREAK_DISPLACEMENT,\n"
     "    auth.ROUTE_D_PREBREAK_RETEST,\n    auth.ROUTE_B_BREAKOUT,\n)",
     "BREAKOUT_ROUTE_ORDER = (\n    auth.ROUTE_B_BREAKOUT,\n"
     "    auth.ROUTE_D_PREBREAK_RETEST,\n    auth.ROUTE_C_PREBREAK_DISPLACEMENT,\n)",
     f"{T_WIRED}::test_the_kernel_asks_the_routes_in_its_own_precedence"),

    ("W7", "the candidate carries a story the authority did not produce",
     "                            direction, \"REV\", loc, a.story, ts, decision_time,",
     "                            direction, \"REV\", loc, None, ts, decision_time,",
     f"{T_WIRED}::test_route_A_carries_the_DERIVED_story_as_its_evidence"),

    ("W8", "the forming bar is no longer last, so every route reads the wrong trigger",
     "    return pd.concat([prior, pd.DataFrame([trigger], index=[ts])])",
     "    return pd.concat([pd.DataFrame([trigger], index=[ts]), prior])",
     f"{T_WIRED}::test_the_authority_reads_completed_history_with_the_forming_bar_last"),

    ("W9", "the machine is asked for a verdict the kernel then overrides with force alone",
     "                    if a.granted and plan_allows_v24(plan, direction, \"REV\", a.story, loc, p):",
     "                    if force.confirmed and plan_allows_v24(plan, direction, \"REV\", a.story, loc, p):",
     f"{T_INTEG}::test_the_entry_authority_can_veto_even_when_live_force_is_present"),
]


def sha(p: str) -> str:
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def write(path: str, data: bytes, expect: str | None = None) -> None:
    """Write, flush to disk, then PROVE the file on disk is what we meant to write.

    MEASURED 2026-08-23: on one run of this harness the witness for arm W3 reported the named
    test as "already RED" while the identical command passed by hand seconds later, and the
    next full run killed all nine. The unproven-but-likely cause is this exact hop — a test
    process spawned against a file whose bytes had not fully landed reads a truncated or locked
    module and reports a collection error, which a bare returncode cannot tell apart from a
    real failure. So the bytes are fsynced and then re-read: a bad write becomes a HARD FAIL
    here instead of a mystery three lines later.
    """
    with io.open(path, "wb") as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    got = sha(path)
    if expect is not None and got != expect:
        raise SystemExit(f"HARD FAIL: {path} on disk is {got}, expected {expect}")
    try:
        ast.parse(io.open(path, encoding="utf-8").read())
    except SyntaxError as e:                      # a mutation may not produce invalid Python
        raise SystemExit(f"HARD FAIL: {path} does not parse after write: {e}")


def run(nodeid: str) -> tuple[bool, str]:
    """(passed, tail). The tail is kept so a surprising witness result is DIAGNOSABLE."""
    r = subprocess.run([sys.executable, "-m", "pytest", nodeid, "-q", "--no-header",
                        "-p", "no:cacheprovider"], capture_output=True, text=True)
    tail = "\n".join((r.stdout + r.stderr).strip().splitlines()[-6:])
    return r.returncode == 0, tail


def main() -> int:
    results, failures = [], []
    start = sha(KERNEL)

    for arm, desc, find, repl, test in ARMS:
        ok, tail = run(test)
        if not ok:
            print(f"  {arm:<4} ABORT - {test} is already RED; a kill proves nothing")
            print(f"       witness output:\n{tail}")
            failures.append(arm)
            results.append({"arm": arm, "description": desc, "outcome": "ABORT_ALREADY_RED",
                            "witness_output": tail})
            continue

        raw = io.open(KERNEL, "rb").read()
        before = sha(KERNEL)
        src = io.open(KERNEL, encoding="utf-8").read()
        n = src.count(find)
        if n != 1:
            print(f"  {arm:<4} TARGET NOT UNIQUE ({n})")
            failures.append(arm)
            results.append({"arm": arm, "description": desc,
                            "outcome": f"TARGET_NOT_UNIQUE_{n}"})
            continue
        try:
            write(KERNEL, src.replace(find, repl).encode("utf-8"))
            if sha(KERNEL) == before:
                print(f"  {arm:<4} SILENT NO-OP MUTATION")
                failures.append(arm)
                results.append({"arm": arm, "description": desc, "outcome": "SILENT_NO_OP"})
                continue
            passed, tail = run(test)
            killed = not passed
            print(f"  {arm:<4} {'KILLED  ' if killed else 'SURVIVED'}  {desc}")
            if not killed:
                failures.append(arm)
            results.append({"arm": arm, "description": desc, "test": test,
                            "outcome": "KILLED" if killed else "SURVIVED"})
        finally:
            write(KERNEL, raw, expect=before)

    if sha(KERNEL) != start:
        print("\nHARD FAIL: the kernel's bytes were not restored")
        return 1
    print("\nrestore verified by SHA256 against this run's own starting bytes")

    for _, _, _, _, test in ARMS:
        ok, tail = run(test)
        if not ok:
            print(f"HARD FAIL: {test} did not return GREEN after restore\n{tail}")
            return 1
    print("all named tests GREEN again after restore")

    OUT.write_text(json.dumps({
        "artifact": "WIRING_RED_PROOF",
        "authority": "ALGO-047 - wire the derivation layer and the state machine as the "
                     "kernel's entry authority",
        "produced": "2026-08-23",
        "question": "does the KERNEL obey the machine's verdict, or does it merely import it?",
        "why_the_section_7_campaign_does_not_answer_it": (
            "section 7 plants defects in the derivation layer and proves the MACHINE's guards "
            "bite. Every fake mutated here leaves that campaign at 19 of 19."),
        "mutated_file": KERNEL,
        "arms_run": len(ARMS),
        "killed": sum(1 for r in results if r["outcome"] == "KILLED"),
        "results": results,
        "restore": "byte-exact, SHA256 against this run's own starting bytes",
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this harness."),
    }, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {OUT}")
    print(f"  killed {sum(1 for r in results if r['outcome'] == 'KILLED')} of {len(ARMS)} "
          f"wiring mutations")

    if failures:
        print(f"\nRED-PROOF FAILED for arms: {failures}")
        return 1
    print("\nWIRING RED-PROOF PASSED: every fake was caught by a named test.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
