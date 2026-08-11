"""Red-proof the RATIFY-1 population splitter's refusals.

Every guard in accept5_isolated_population.build() is asserted to BITE by
planting the exact violation it claims to catch. A guard that has never gone red
is not an instrument -- and the positive control (the unplanted arm) is required,
otherwise "always raises" is indistinguishable from "catches breakage".
"""
import sys
from pathlib import Path

REPO = Path(r"C:\Users\tonio\Projects\wt-h1-wave4-20260712")
sys.path.insert(0, str(REPO / "scripts"))

import accept5_isolated_population as pop      # noqa: E402
import acceptance_runner as runner             # noqa: E402
import population_successor as popsucc         # noqa: E402

results = []


def arm(name, patch, expect_raise, needle=""):
    saved_manifest = runner.read_manifest
    saved_required = popsucc.required_population
    patch()
    try:
        pop.build()
        raised, msg = False, ""
    except pop.PopulationError as e:
        raised, msg = True, str(e)
    except Exception as e:                       # noqa: BLE001
        raised, msg = True, f"{type(e).__name__}: {e}"
    finally:
        runner.read_manifest = saved_manifest
        popsucc.required_population = saved_required

    hit = (needle in msg) if needle else True
    ok = (raised == expect_raise) and hit
    results.append(ok)
    verdict = "OK" if ok else "*** UNEXPECTED ***"
    print(f"  {name:44s} raised={str(raised):5s} expect={str(expect_raise):5s} {verdict}")
    if raised:
        print(f"       -> {msg[:120]}")


print("=== POSITIVE CONTROL (nothing planted) — must NOT raise ===")
arm("unplanted", lambda: None, expect_raise=False)

print()
print("=== EACH GUARD, WITH ITS OWN VIOLATION PLANTED ===")


def plant_unresolvable_member():
    orig = runner.read_manifest
    runner.read_manifest = lambda p: orig(p) + ["engine/tests/PLANTED_no_such_file.py"]


arm("manifest member does not resolve", plant_unresolvable_member,
    expect_raise=True, needle="do not resolve")


def plant_chain_problem():
    popsucc.required_population = lambda repo: ([], ["PLANTED chain problem"])


arm("successor chain not derivable", plant_chain_problem,
    expect_raise=True, needle="could not be derived")


def plant_missing_supplemental_file():
    # Assembled at runtime, NEVER written as a repo-relative path literal:
    # scripts/system_inventory.py scans for exactly that shape, and a literal
    # here makes the generated map declare a fictional file ABSENT. The map is
    # what the prior-art check tells the next seat to trust, so a control must
    # not pollute it. (MEASURED: it did, on the first run of this file.)
    fake = "/".join(["src", "engine", "tests", "PLANTED_deleted_obligation.py"])
    popsucc.required_population = lambda repo: ([f"{fake}::test_x"], [])


arm("chain-required file deleted", plant_missing_supplemental_file,
    expect_raise=True, needle="no longer exist")

print()
print(f"=== VERDICT: {sum(results)}/{len(results)} arms behaved as required ===")
print("DISCRIMINATES" if all(results) else "*** GUARD SET IS NOT SOUND ***")
raise SystemExit(0 if all(results) else 1)
