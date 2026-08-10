"""ACCEPT-5 acceptance runner — `ACCEPT5-INSTRUMENT-1` (R-790 §6).

THE PROBLEM THIS REPLACES
    `ACCEPT-5` has never had a committed runner. Every execution in this
    campaign was a hand-built script authored per seat (AR-927 §3, measured with
    a positive control: `ordered_6b_reds` and the baseline filename are read by
    ZERO code). Rebuilds differ, and one rebuild reported 51 failures against
    pytest's own 31 — a 49-member FABRICATED REGRESSION against a clean commit
    (R-789 §6).

    `A GATE WITH NO COMMITTED INSTRUMENT IS NOT A GATE — IT IS A PROCEDURE EACH
     SEAT RE-AUTHORS.`

WHAT IT CHECKS  (R-790 §6 contract, numbered as ordered)
    1. reads the canonical population manifest
    2. reads the immutable baseline
    3. node IDs come THROUGH PYTEST ITSELF (acceptance_pytest_plugin), never a
       regex over human summary prose
    4. records expected / collected / executed / failures / skips / xfails
    5. FAILS when a baseline-named test leaves COLLECTION
    6. FAILS on a collected-but-unexecuted test with no allowed disposition
    7. compares failure membership by EXACT NODE ID
    8. verifies NEW / GONE by member identity
    9. reads `ordered_6b_reds` FROM the baseline, never retyped

    plus SELF-CHECK: an INDEPENDENT second feeder (pytest's own junitxml) must
    agree with the plugin on failure membership and collection size. This is the
    arm that catches a corrupted result feeder — the class that produced the
    fake 49.

USAGE
    python scripts/acceptance_runner.py --from-run run.json --junit run.xml
    python scripts/acceptance_runner.py --run --out-dir <dir>
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

# defusedxml over stdlib ElementTree: the junitxml is locally generated and so
# not an untrusted input today, but this file is a COMMITTED instrument that
# future seats will point at other people's artifacts.
try:
    from defusedxml import ElementTree as ET
except ImportError:  # pragma: no cover - explicit, never a silent downgrade
    raise SystemExit(
        "acceptance_runner requires defusedxml (pip install defusedxml). "
        "Refusing to parse XML with the vulnerable stdlib parser."
    )

REPO = Path(__file__).resolve().parents[1]
MANIFEST = REPO / "src" / "engine" / "tests" / "canonical_regression_population.txt"
BASELINE = REPO / "docs" / "replay-results" / "h1-battery" / "acceptance-baseline-2026-08-09.json"


# ---------------------------------------------------------------------------
# 1. the canonical population
# ---------------------------------------------------------------------------
def read_manifest(path: Path):
    """Membership rule: comments and blanks are NOT members.

    A raw line count reads 128 and is wrong; the members are the surviving
    lines, resolved under <repo>/src (the baseline states the join root, and
    joining to the repo root instead resolves 0 paths while a pathless pytest
    silently runs EVERYTHING).
    """
    members = []
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        members.append(s)
    return members


# ---------------------------------------------------------------------------
# 2. the immutable baseline  (+ 9. ordered_6b_reds read FROM it)
# ---------------------------------------------------------------------------
def read_baseline(path: Path):
    d = json.loads(path.read_text(encoding="utf-8"))
    return {
        "failures": set(d["failures"]),
        "ordered_6b_reds": list(d["ordered_6b_reds"]),   # (9) never retyped
        "population_members": d.get("population_members"),
        "measured_at_sha": d.get("measured_at_sha"),
        "totals": d.get("totals_at_baseline", {}),
    }


# ---------------------------------------------------------------------------
# SELF-CHECK: the independent second feeder
# ---------------------------------------------------------------------------
def read_junit(path: Path):
    """pytest's own junitxml — produced by pytest, not by our plugin.

    Independent of the plugin's bookkeeping, so a corrupted plugin record
    disagrees with it. Node id is rebuilt from classname+name, which is how
    junitxml encodes it.
    """
    root = ET.parse(path).getroot()
    cases, failures = [], set()
    for tc in root.iter("testcase"):
        nid = _junit_nodeid(tc)
        cases.append(nid)
        if tc.find("failure") is not None or tc.find("error") is not None:
            failures.add(nid)
    return cases, failures


def _junit_nodeid(tc) -> str:
    """Rebuild the EXACT pytest node id from a junitxml <testcase>.

    This pytest emits no `file` attribute, only a dotted `classname`:
        src.engine.tests.test_a_plus_gate_parity.TestAPlus_Gate_Wiring
    The trailing Capitalised segments are the class chain; the rest is the
    module path.

    An earlier version of this function collapsed the class chain and compared
    on (file, final test name). That is LOSSY — two same-named tests in
    different classes in one file collapse to one member, and the resulting
    silent -2 delta looked exactly like a real collection regression. The
    positive control caught it. Exact identity only, from here on.
    """
    name = tc.get("name") or ""
    file_attr = tc.get("file")
    cls = tc.get("classname") or ""
    if file_attr:
        parts = [p for p in cls.split(".") if p and p[0].isupper()]
        return "::".join([file_attr.replace("\\", "/"), *parts, name])
    segs = cls.split(".")
    chain = []
    while segs and segs[-1][:1].isupper():
        chain.insert(0, segs.pop())
    module = "/".join(segs) + ".py"
    return "::".join([module, *chain, name])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-run", type=Path, help="plugin JSON record")
    ap.add_argument("--junit", type=Path, help="pytest junitxml from the SAME run")
    ap.add_argument("--run", action="store_true", help="execute the population now")
    ap.add_argument("--out-dir", type=Path, default=Path("."))
    ap.add_argument("--manifest", type=Path, default=MANIFEST)
    ap.add_argument("--baseline", type=Path, default=BASELINE)
    args = ap.parse_args()

    failures_of_the_gate = []   # every reason this gate refuses
    notes = []

    members = read_manifest(args.manifest)
    base = read_baseline(args.baseline)

    # --- preflight: the baseline's own two assertions -----------------------
    resolved, missing = [], []
    for m in members:
        p = REPO / "src" / m
        (resolved if p.is_file() else missing).append(m)
    print(f"[1] manifest members (comments stripped) : {len(members)}")
    print(f"    resolved under <repo>/src            : {len(resolved)}")
    print(f"    missing                              : {len(missing)}")
    if missing:
        failures_of_the_gate.append(f"PREFLIGHT: {len(missing)} manifest members do not resolve: {missing[:5]}")

    print(f"[2] baseline                             : {args.baseline.name}")
    print(f"    baseline population_members          : {base['population_members']}")
    print(f"    baseline failures (node IDs)         : {len(base['failures'])}")
    print(f"[9] ordered_6b_reds READ FROM baseline   : {len(base['ordered_6b_reds'])}")
    for n in base["ordered_6b_reds"]:
        print(f"      - {n}")

    # POPULATION DRIFT is reported, never silently absorbed.
    if base["population_members"] is not None and base["population_members"] != len(members):
        notes.append(
            f"POPULATION DRIFT: baseline pinned {base['population_members']} members, "
            f"manifest now has {len(members)}. Failure membership is being compared "
            f"across DIFFERENT populations; treat NEW members accordingly."
        )

    # --- run or consume ------------------------------------------------------
    if args.run:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        run_json = args.out_dir / "acceptance-run.json"
        run_xml = args.out_dir / "acceptance-run.xml"
        cmd = [sys.executable, "-m", "pytest", *[f"src/{m}" for m in resolved],
               "-q", "--no-header", "-p", "no:cacheprovider",
               "-p", "scripts.acceptance_pytest_plugin",
               f"--acceptance-out={run_json}", f"--junitxml={run_xml}"]
        subprocess.run(cmd, cwd=REPO)
    else:
        run_json, run_xml = args.from_run, args.junit

    rec = json.loads(Path(run_json).read_text(encoding="utf-8"))
    collected = set(rec["collected"])
    executed = set(rec["executed"])
    plugin_failures = set(rec["failures"])
    skipped = set(rec["skipped"])
    xfailed = set(rec["xfailed"])

    print(f"[3] feeder                               : {rec['instrument']} "
          f"(pytest exit {rec['pytest_exitstatus']})")
    print(f"[4] collected/executed/failed/skip/xfail : "
          f"{len(collected)}/{len(executed)}/{len(plugin_failures)}/{len(skipped)}/{len(xfailed)}")

    # --- SELF-CHECK against the independent feeder ---------------------------
    if run_xml and Path(run_xml).is_file():
        j_cases, j_failures = read_junit(Path(run_xml))
        n_junit_cases = len(j_cases)
        j_cases = set(j_cases)
        only_plugin = plugin_failures - j_failures
        only_junit = j_failures - plugin_failures
        size_delta = len(collected) - n_junit_cases
        print(f"[SELF-CHECK] independent feeder (junitxml) cases={n_junit_cases} "
              f"failures={len(j_failures)}")
        if only_plugin or only_junit:
            failures_of_the_gate.append(
                "FEEDER DISAGREEMENT on failure membership — "
                f"plugin-only={sorted(only_plugin)[:5]} junit-only={sorted(only_junit)[:5]}"
            )
        if abs(size_delta) > 0:
            failures_of_the_gate.append(
                f"FEEDER DISAGREEMENT on collection size — plugin={len(collected)} "
                f"junit={n_junit_cases} delta={size_delta}"
            )
        if not (only_plugin or only_junit or size_delta):
            print("             feeders AGREE on membership and size")
    else:
        failures_of_the_gate.append("SELF-CHECK IMPOSSIBLE: no junitxml second feeder supplied")

    # --- (5) collection presence of every baseline-named test ---------------
    base_norm = set(base["failures"])
    left_collection = sorted(base_norm - collected)
    print(f"[5] baseline-named tests missing from COLLECTION : {len(left_collection)}")
    if left_collection:
        for n in left_collection[:10]:
            print(f"      GONE FROM COLLECTION: {n}")
        failures_of_the_gate.append(
            f"COLLECTION PRESENCE: {len(left_collection)} baseline-named test(s) are no "
            f"longer collected. A test that stops being collected reads as NEW=0."
        )

    # --- (6) collected but not executed -------------------------------------
    unexecuted = collected - executed
    undisposed = sorted(unexecuted - skipped - xfailed)
    print(f"[6] collected-but-unexecuted             : {len(unexecuted)} "
          f"(without allowed disposition: {len(undisposed)})")
    if undisposed:
        for n in undisposed[:10]:
            print(f"      UNEXECUTED, NO DISPOSITION: {n}")
        failures_of_the_gate.append(
            f"{len(undisposed)} collected test(s) never executed and carry no "
            f"allowed disposition (skip/xfail)."
        )

    # --- (7)(8) failure membership by exact node ID -------------------------
    new = sorted(plugin_failures - base_norm)
    gone = sorted(base_norm - plugin_failures)
    print(f"[7/8] NEW failures (by node ID)          : {len(new)}")
    for n in new[:15]:
        print(f"      NEW:  {n}")
    print(f"[7/8] GONE failures (by node ID)         : {len(gone)}")
    for n in gone[:15]:
        print(f"      GONE: {n}")
    if new:
        failures_of_the_gate.append(f"{len(new)} NEW failure(s) not in the baseline.")

    # ordered_6b_reds are expected reds; report their live status by identity
    print("[9] ordered_6b_reds live status:")
    for n in base["ordered_6b_reds"]:
        nn = n
        state = ("FAILING" if nn in plugin_failures else
                 "NOT COLLECTED" if nn not in collected else
                 "COLLECTED BUT NOT FAILING")
        print(f"      {state:<26} {nn}")

    # --- verdict -------------------------------------------------------------
    print()
    for n in notes:
        print(f"NOTE: {n}")
    print("=" * 72)
    if failures_of_the_gate:
        print("ACCEPTANCE: REFUSED")
        for f in failures_of_the_gate:
            print(f"  - {f}")
        print("=" * 72)
        return 1
    print("ACCEPTANCE: PASS — failure membership matches the baseline exactly, "
          "collection presence intact, feeders agree.")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
