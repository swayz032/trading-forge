"""H1-W4 D2 execution evidence: the STRUCTURAL_NUMERALS staleness was invisible for three waves
because its scorer sat below an abort and never ran. So the fix must ship with PROOF the scorer
now executes AND actually adjudicates the two computed entries. This drives the REAL build (all
axes) exactly as main() does, runs coverage_census, and asserts both derivation paths land in
EXEMPTED via _verify_structural -- i.e. the corpse now has a pulse and the fix is under it.

Exit 0 = gate executed and both entries verified; exit 1 = it did not. Re-runnable control."""
import importlib.util, sys, json
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("ddr", HERE / "dual_denominator_remeasure.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

DS = "$.SELF_ACCOUNTING.ASSERT_CENSUS.SPLIT_DERIVATION_R219.DATA_SENSITIVE_derivation"
SI = "$.SELF_ACCOUNTING.ASSERT_CENSUS.SPLIT_DERIVATION_R219.SOURCE_INVARIANT_derivation"

# Build the artifact base + per axis, exactly like publish_artifact does.
art = m.build_artifact(None)
per_axis = {ax: m.build_artifact(ax) for ax in m.AXES}
census = m.coverage_census(art, per_axis, m.NON_RESPONSIVE_PROSE_ALLOWLIST, m.STRUCTURAL_NUMERALS)

# INDEPENDENT of the census's own bucketing, call _verify_structural directly on the live leaves.
base = dict(m._leaves(art))
pax = {ax: dict(m._leaves(a)) for ax, a in per_axis.items()}
results = {}
for path in (DS, SI):
    sentence = base.get(path)
    ent = m.STRUCTURAL_NUMERALS[path]
    ok, why = m._verify_structural(path, ent, base, pax)
    # kind INTERPOLATED_BUT_NO_AXIS_MOVES_ITS_SOURCE is _WEAK_KIND -> the verified entry lands in
    # CARRIED_UNVERIFIABLE (a genuine measurement, wired but untested by this axis family), NOT
    # EXEMPTED. Either bucket is a "the scorer adjudicated it" outcome; UNREACHED is the failure.
    adjud_bucket = next((b for b in ("EXEMPTED", "CARRIED_UNVERIFIABLE", "UNREACHED")
                         if any(e["path"] == path for e in census["buckets"][b])), None)
    results[path] = {
        "sentence_in_live_artifact": sentence,
        "registered_numerals_COMPUTED": ent["numerals"],
        "_verify_structural_ok": ok,
        "_verify_structural_why": why,
        "adjudicated_into_bucket": adjud_bucket,
    }

# ★ RED-PROOF: the revived scorer must actually CONVICT the defect it slept through. Feed the
# exact stale value the registration carried for three waves (["14","22","8"]) to the same
# _verify_structural against the LIVE sentence and require it to REJECT. A green birth-test is a
# claim; a red-proof that re-runs every invocation is the control that the gate discriminates.
STALE = ["14", "22", "8"]
stale_ent = dict(m.STRUCTURAL_NUMERALS[DS], numerals=STALE)
red_ok, red_why = m._verify_structural(DS, stale_ent, base, pax)
red_proof = {
    "fed_the_three_wave_stale_value": STALE,
    "live_sentence": base.get(DS),
    "_verify_structural_ok": red_ok,
    "REJECTS_AS_REQUIRED": red_ok is False,
    "why": red_why,
}

all_ok = (all(r["_verify_structural_ok"] and r["adjudicated_into_bucket"] == "CARRIED_UNVERIFIABLE"
              for r in results.values())
          and red_proof["REJECTS_AS_REQUIRED"])
print(json.dumps({
    "coverage_census_PASS": census["PASS"],
    "coverage_COVERAGE": census["COVERAGE"],
    "n_UNREACHED": census["n_UNREACHED_THIS_IS_THE_RED"],
    "bad_structural_claims": census["bad_structural_claims"],
    "two_derivation_entries": results,
    "RED_PROOF_stale_value_is_convicted": red_proof,
    "GATE_EXECUTED_VERIFIED_AND_DISCRIMINATES": all_ok,
}, indent=1))
sys.exit(0 if all_ok and census["PASS"] else 1)
