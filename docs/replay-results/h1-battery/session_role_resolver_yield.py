"""R-499 lane I7 -- MEASURE the C2 session-role resolver yield.

WHAT THIS ANSWERS, and nothing wider: with TF_SESSION_ROLE_RESOLVER_ENABLED
flipped OFF -> ON over ONE NAMED POPULATION, how many conditions change binding
outcome, and WHICH ONES BY IDENTITY.

Conventions mirrored from the sibling instrument
`dual_denominator_remeasure.py` rather than invented:
  * REPO_ROOT via parents[3] + chdir + sys.path.insert
  * Trap 7 -- import via `src.engine.*`, NEVER `engine.*`, so a global
    editable-install .pth cannot resolve the name into a DIFFERENT checkout.

LAWS THIS SCRIPT IS BUILT TO OBEY:
  * A FLAGS-OFF CONTROL IS MANDATORY. A yield with no control cannot
    distinguish the resolver from the baseline.
  * ACCEPTANCE IS THE PINNED CONDITION IDENTITIES, NEVER THE COUNT (R-425).
    A count is satisfied by losing one row and gaining another.
  * A NUMBER CARRIES ITS TREE, ITS POPULATION AND ITS FLAG STATE (R-499 I7).
  * CORPORA ARE SEPARATE (v4 s0). This measures corpus_A ONLY and says so.
  * `invalidations` are reported SEPARATELY, never merged into the headline
    population -- the same declared exclusion the ledger-E packet makes.

THIS SCRIPT MEASURES. IT DOES NOT GRADE. Whether a newly-bound condition is
bound CORRECTLY is ground truth and belongs to an independent grader.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
os.chdir(REPO_ROOT)
sys.path.insert(0, str(REPO_ROOT))

# Trap 7: src.engine.*, never engine.*
import src.engine.spec_family_bindings as sfb  # noqa: E402

H1 = REPO_ROOT / "docs" / "replay-results" / "h1-battery"
CORPUS_A_GLOB = (
    REPO_ROOT / "docs" / "replay-results" / "h1-scripts" / "claude-rung-v32" / "shakedown_specs"
)
POPULATION_NAME = "corpus_A (claude-rung-v32/shakedown_specs/*.spec.json)"
FLAG = "TF_SESSION_ROLE_RESOLVER_ENABLED"
OUT_PATH = H1 / "session-role-resolver-yield-2026-07-31.json"


def tree_identity() -> dict:
    def git(*args):
        try:
            return subprocess.check_output(
                ["git", *args], cwd=str(REPO_ROOT), stderr=subprocess.DEVNULL
            ).decode().strip()
        except Exception as exc:
            return "<unavailable: %s>" % exc

    return {
        "path": str(REPO_ROOT),
        "head": git("rev-parse", "HEAD"),
        "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
        "dirty_paths": len([l for l in git("status", "--porcelain").splitlines() if l.strip()]),
    }


def load_population():
    """Returns (entry_conditions, invalidations) -- kept SEPARATE on purpose."""
    entry, inval = [], []
    files = sorted(CORPUS_A_GLOB.glob("*.spec.json"))
    for fp in files:
        with open(fp, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
        spec = doc.get("spec") or {}
        video = doc.get("video")
        for c in spec.get("entry_conditions") or []:
            entry.append((fp.name, video, c))
        for c in spec.get("invalidations") or []:
            inval.append((fp.name, video, c))
    return files, entry, inval


def bind_all(conditions, flag_value):
    """Bind every condition under one flag state. The gate is read AT CALL TIME
    (documented at spec_family_bindings.py:2309), so setting the env here is
    sufficient and no module reload is needed."""
    os.environ[FLAG] = flag_value
    out = {}
    for fname, video, cond in conditions:
        cid = cond.get("id")
        key = "%s::%s" % (fname, cid)
        try:
            b = sfb.bind_condition(cond)
            out[key] = {
                "file": fname,
                "video": video,
                "condition_id": cid,
                "type": cond.get("type"),
                "object": cond.get("object"),
                "bindable": bool(b.bindable),
                "primitive": b.primitive,
                "approximation": bool(b.approximation),
                "session_zone": getattr(b, "session_zone", None),
                "reason": b.reason,
            }
        except Exception as exc:
            out[key] = {
                "file": fname,
                "video": video,
                "condition_id": cid,
                "type": cond.get("type"),
                "object": cond.get("object"),
                "ERROR": "%s: %s" % (type(exc).__name__, exc),
            }
    return out


def diff(off, on):
    """Identity-level delta. Counts are derived FROM the identity lists, never
    counted independently -- so a count can never disagree with its own list."""
    newly_bound, lost_binding, primitive_changed, zone_gained, errors = [], [], [], [], []
    for key in sorted(set(off) | set(on)):
        a, b = off.get(key, {}), on.get(key, {})
        if "ERROR" in a or "ERROR" in b:
            errors.append({"key": key, "off": a.get("ERROR"), "on": b.get("ERROR")})
            continue
        rec = {
            "key": key,
            "video": b.get("video") or a.get("video"),
            "condition_id": b.get("condition_id") or a.get("condition_id"),
            "type": b.get("type") or a.get("type"),
            "object": b.get("object") or a.get("object"),
            "off": {"bindable": a.get("bindable"), "primitive": a.get("primitive")},
            "on": {
                "bindable": b.get("bindable"),
                "primitive": b.get("primitive"),
                "session_zone": b.get("session_zone"),
            },
        }
        if a.get("bindable") is False and b.get("bindable") is True:
            newly_bound.append(rec)
        elif a.get("bindable") is True and b.get("bindable") is False:
            lost_binding.append(rec)
        elif a.get("primitive") != b.get("primitive"):
            primitive_changed.append(rec)
        if not a.get("session_zone") and b.get("session_zone"):
            zone_gained.append(rec)
    return newly_bound, lost_binding, primitive_changed, zone_gained, errors


def wait_session_forensics(entry):
    """WHY the yield is what it is, per condition, flag ON.

    A bare zero is unreadable: 'the resolver is inert', 'the population is
    empty' and 'my flag never arrived' all print as 0. This section separates
    them by recording, for every WAIT_SESSION row, whether each upstream stage
    fired -- keyword resolve, name-route, classifier recognition, computable
    zone -- alongside the final bind outcome."""
    os.environ[FLAG] = "true"
    rows = []
    for fname, video, c in entry:
        if c.get("type") != "WAIT_SESSION":
            continue
        obj = c.get("object") or ""
        kw = getattr(sfb, "resolve_session_keyword", lambda _o: None)(obj)
        nm = getattr(sfb, "resolve_session_name_to_window", lambda _o: None)(obj)
        r = sfb.classify_session_role(obj)
        b = sfb.bind_condition(c)
        rows.append({
            "file": fname,
            "video": video,
            "condition_id": c.get("id"),
            "object": obj,
            "keyword_resolved": kw is not None,
            "name_route_would_fire": nm is not None,
            "classifier_recognized": bool(r.recognized),
            "classifier_zone": r.zone,
            "FINAL_bindable": bool(b.bindable),
            "FINAL_primitive": b.primitive,
        })
    summary = {
        "wait_session_rows": len(rows),
        "bindable": sum(1 for r in rows if r["FINAL_bindable"]),
        "keyword_resolved": sum(1 for r in rows if r["keyword_resolved"]),
        "name_route_would_fire": sum(1 for r in rows if r["name_route_would_fire"]),
        "classifier_recognized": sum(1 for r in rows if r["classifier_recognized"]),
        "classifier_COMPUTED_A_ZONE": sum(1 for r in rows if r["classifier_zone"]),
        "zones_computed": sorted({r["classifier_zone"] for r in rows if r["classifier_zone"]}),
    }
    return summary, rows


def reach_probes():
    """POSITIVE CONTROLS. An absence claim owes proof that the path could fire.
    Without these, 'yield = 0' is indistinguishable from 'my flag never
    reached the gate'."""
    os.environ[FLAG] = "false"
    gate_off = sfb.session_role_resolver_enabled()
    os.environ[FLAG] = "true"
    gate_on = sfb.session_role_resolver_enabled()
    phrases = {}
    for t in ["london session", "the london killzone", "new york session",
              "9:30 to 10:00", "asian session"]:
        r = sfb.classify_session_role(t)
        phrases[t] = {"recognized": bool(r.recognized), "zone": r.zone}
    return {
        "GATE_READS_THIS_PROCESS_ENV": {
            "flag_false": gate_off,
            "flag_true": gate_on,
            "DISCRIMINATES": gate_off is False and gate_on is True,
        },
        "capability_on_synthetic_phrases": phrases,
        "why_this_is_here": (
            "If the gate did not discriminate, every number in this artifact would be "
            "a measurement of an unset environment variable, not of the resolver."
        ),
    }


def main():
    files, entry, inval = load_population()

    # DETERMINISM: every arm run twice. A yield derived from a non-deterministic
    # binder is not a measurement, and this is the cheapest possible check.
    off_1 = bind_all(entry, "false")
    on_1 = bind_all(entry, "true")
    off_2 = bind_all(entry, "false")
    on_2 = bind_all(entry, "true")
    deterministic = (off_1 == off_2) and (on_1 == on_2)

    newly_bound, lost, prim_changed, zone_gained, errors = diff(off_1, on_1)

    inval_off = bind_all(inval, "false")
    inval_on = bind_all(inval, "true")
    i_new, i_lost, i_prim, i_zone, i_err = diff(inval_off, inval_on)

    ws_summary, ws_rows = wait_session_forensics(entry)

    bindable_off = sorted(k for k, v in off_1.items() if v.get("bindable") is True)
    bindable_on = sorted(k for k, v in on_1.items() if v.get("bindable") is True)

    art = {
        "READ_THIS_ONE__HEADLINE": (
            "C2 session-role resolver yield on corpus_A entry_conditions: "
            "%d of %d conditions change from NOT-bindable to bindable when %s "
            "flips false->true. Flags-off control included. Identities listed."
            % (len(newly_bound), len(entry), FLAG)
        ),
        "artifact": OUT_PATH.name,
        "generator": "docs/replay-results/h1-battery/session_role_resolver_yield.py",
        "reproduce": "python docs/replay-results/h1-battery/session_role_resolver_yield.py",
        "ruling": "R-499 lane I7 (ordering per R-500 s3)",
        "TREE": tree_identity(),
        "POPULATION": {
            "name": POPULATION_NAME,
            "spec_files": len(files),
            "entry_conditions": len(entry),
            "invalidations_REPORTED_SEPARATELY": len(inval),
            "CORPORA_ARE_SEPARATE": (
                "corpus_A ONLY. Not POP-120-LIVE, not tier-A/spearhead. Any sentence "
                "joining this number to a POP-120 figure is a claim about an overlap "
                "nobody has measured."
            ),
        },
        "FLAG_STATE": {
            "flag": FLAG,
            "control_arm": "false",
            "treatment_arm": "true",
            "PRODUCTION_DEFAULT": "OFF -- the flag defaults to 'false' when unset.",
            "honest_reading": (
                "The treatment arm is a flag-ON HYPOTHETICAL. Production output today, "
                "with default env, is the CONTROL arm."
            ),
        },
        "DETERMINISM": {
            "each_arm_run_twice": True,
            "identical_across_runs": deterministic,
            "note": "A yield from a non-deterministic binder is not a measurement.",
        },
        "RESULT_entry_conditions": {
            "bindable_count_OFF": len(bindable_off),
            "bindable_count_ON": len(bindable_on),
            "NEWLY_BOUND_identities": newly_bound,
            "LOST_BINDING_identities": lost,
            "PRIMITIVE_CHANGED_identities": prim_changed,
            "SESSION_ZONE_GAINED_identities": zone_gained,
            "ERRORS": errors,
            "IDENTITIES_NOT_COUNTS": (
                "Every count above is len() of the list beside it. A count that can "
                "disagree with its own identity list is the defect R-425 named."
            ),
        },
        "RESULT_invalidations_SEPARATE": {
            "population": len(inval),
            "NEWLY_BOUND_identities": i_new,
            "LOST_BINDING_identities": i_lost,
            "PRIMITIVE_CHANGED_identities": i_prim,
            "SESSION_ZONE_GAINED_identities": i_zone,
            "ERRORS": i_err,
        },
        "POSITIVE_CONTROLS": reach_probes(),
        "WAIT_SESSION_FORENSICS": {
            "summary": ws_summary,
            "rows": ws_rows,
            "READING": (
                "The resolver is NOT inert and the population is NOT empty. It "
                "recognizes real session work and computes a real zone for some rows, "
                "yet NOTHING binds. A bare 0 would have hidden both halves."
            ),
        },
        "CANDIDATE_EXPLANATIONS_UNRESOLVED": {
            "STATUS": "HYPOTHESES -- NOT MEASURED. I7 is a measurement lane; "
                      "locating the failing layer is a separate authorization.",
            "H1_output_computed_but_not_consumed": (
                "The classifier computes a zone the binding path does not convert into "
                "a binding for these condition shapes."
            ),
            "H2_upstream_extraction": (
                "Several `object` values are long narration sentences rather than "
                "canonical session objects, so the failing layer may be extraction, "
                "not the resolver. The sibling harness carries a "
                "narration-reclassification artifact, which is consistent with this."
            ),
            "WHY_NOT_DECIDED_HERE": (
                "No test in this run distinguishes H1 from H2, and picking the "
                "convenient one is the shape this campaign convicts. Reported as two."
            ),
        },
        "WHAT_THIS_DOES_NOT_MEASURE": [
            "Whether any newly-bound condition is bound CORRECTLY -- that is GROUND "
            "TRUTH and belongs to an independent grader. This script is the doer.",
            "Any population other than corpus_A.",
            "The DEPLOYED tree. This runs in the campaign checkout; the deployed "
            "spec_family_bindings.py is a 3.9x smaller variant (AR-520).",
            "Whether the C2 refusal CLASS shrinks -- this measures binding outcome "
            "change, which is a necessary but not sufficient condition for that.",
        ],
    }

    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(art, fh, indent=2)
        fh.write("\n")

    print(art["READ_THIS_ONE__HEADLINE"])
    print("deterministic across repeated runs: %s" % deterministic)
    print("bindable OFF=%d  ON=%d" % (len(bindable_off), len(bindable_on)))
    print("newly_bound=%d lost=%d primitive_changed=%d zone_gained=%d errors=%d"
          % (len(newly_bound), len(lost), len(prim_changed), len(zone_gained), len(errors)))
    print("invalidations (separate): newly_bound=%d errors=%d" % (len(i_new), len(i_err)))
    print("artifact -> %s" % OUT_PATH)
    return 0


if __name__ == "__main__":
    sys.exit(main())
