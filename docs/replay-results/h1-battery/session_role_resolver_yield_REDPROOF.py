"""RED-PROOF for session_role_resolver_yield.py (R-503 lane I7, §5.H).

★★★★★ WHY THIS FILE EXISTS: the instrument ships 26 PASSING assertions.
`A GREEN CHECK WITH NO PATH TO RED IS NOT EVIDENCE` — a stop condition owes a
DISCRIMINATES fixture. This harness plants a defect per assertion class and
proves the assertion GOES RED, then proves the UNMUTATED control stays GREEN.
`A MUTATION SUITE WITHOUT THE UNMUTATED CONTROL CANNOT TELL "CATCHES BREAKAGE"
FROM "ALWAYS RED".`

Each mutation is chosen to be the SHARPEST one for the law it guards:

  M1  swaps ONE baseline identity for a fake, keeping the COUNT identical.
      This is R-425's defect exactly -- "a count is satisfied by losing one row
      and gaining another". The count assertions MUST stay green and only the
      IDENTITY assertion may go red. A mutation that reddens everything proves
      nothing about which check did the work.
  M2  moves a NON-family row's reason between arms -> the non-C2 movement
      hard stop must fire.
  M3  reports the binder as dirty -> the provenance intersection must fire.
  M4  makes the ON arm identical to the OFF arm -> the POSITIVE WITNESS must
      fire, proving the two empty-census assertions cannot pass vacuously.

The instrument writes its artifact to OUT_PATH; this harness REDIRECTS that to a
throwaway path so a mutated run can never overwrite the real artifact.
"""

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGET = HERE / "session_role_resolver_yield.py"


def load_instrument():
    """Fresh module object per run -- ASSERTIONS is module-level state and a
    reused import would accumulate results across mutations."""
    spec = importlib.util.spec_from_file_location("_sry_under_test", TARGET)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.OUT_PATH = Path(tempfile.gettempdir()) / "_redproof_discard.json"
    return mod


def run(mutate=None):
    mod = load_instrument()
    mod.ASSERTIONS.clear()
    if mutate:
        mutate(mod)
    rc = mod.main()
    return rc, {a["assertion"]: a["PASS"] for a in mod.ASSERTIONS}


# ── MUTATIONS ────────────────────────────────────────────────────────────────
def m1_swap_one_baseline_identity(mod):
    orig = mod.baseline_c2_population

    def patched():
        base, conds, keys = orig()
        keys = sorted(set(keys[:-1]) | {"ZZZ-FAKE.spec.json::WAIT_SESSION:not-a-real-row#0"})
        return base, conds, keys
    mod.baseline_c2_population = patched


def m2_move_a_non_family_row(mod):
    orig = mod.bind_all

    def patched(conditions, flag_value):
        out = orig(conditions, flag_value)
        if flag_value == "true":
            for k, v in out.items():
                if v.get("type") != mod.FAMILY_TYPE and "ERROR" not in v:
                    v["reason"] = "PLANTED_NON_FAMILY_MOVEMENT"
                    break
        return out
    mod.bind_all = patched


def m3_report_binder_dirty(mod):
    orig = mod.dirty_paths
    mod.dirty_paths = lambda: sorted(set(orig()) | {"src/engine/spec_family_bindings.py"})


def m4_make_arms_identical(mod):
    orig = mod.bind_all
    mod.bind_all = lambda conditions, flag_value: orig(conditions, "false")


def m5_pretend_capability_was_ported(mod):
    """Point the 'deployed' binder at the CAMPAIGN binder, so every capability
    symbol reads as PRESENT in deployed -- i.e. simulate the port having
    happened. The scope tripwire MUST fire, because that is precisely when the
    artifact's campaign-lane scope sentence becomes stale."""
    mod.DEPLOYED_BINDER = mod.REPO_ROOT / "src/engine/spec_family_bindings.py"


def m6_plant_a_deployed_only_symbol(mod):
    """Give the deployed binder a symbol the campaign lane does not have. The
    subset-or-equal assertion must fire -- a deployed-only symbol means a port
    would have to RECONCILE rather than merely ADD.

    ⚠️ THIS MUTATION SILENTLY STOPPED BITING ONCE. It patched `top_level_symbols`
    while the scope code was refactored to call `top_level_nodes`, so it became
    a no-op and the case reported exit=0 / reddened=0. It is fixed to patch the
    function the code ACTUALLY calls. `A MUTATION THAT NO LONGER BITES IS A
    PROOF THAT EVAPORATED WITHOUT ANYONE EDITING IT` -- and the only reason it
    was caught is that this harness FAILS LOUD when its target stays green.
    """
    orig = mod.top_level_nodes

    def patched(path):
        n = dict(orig(path))
        if str(path) == str(mod.DEPLOYED_BINDER):
            n["ZZZ_PLANTED_DEPLOYED_ONLY_SYMBOL"] = next(iter(n.values()))
        return n
    mod.top_level_nodes = patched
    mod.top_level_symbols = lambda p: set(patched(p))


def m7_make_symbol_sets_equal(mod):
    """Make the deployed symbol set EQUAL the campaign set. `dep <= camp` is
    satisfied by equality; `dep < camp` is NOT. This is the case the retired
    `STRICT_SUBSET` predicate silently absorbed."""
    orig = mod.top_level_nodes

    def patched(path):
        n = orig(path)
        if str(path) == str(mod.DEPLOYED_BINDER):
            return dict(orig(mod.REPO_ROOT / "src/engine/spec_family_bindings.py"))
        return n
    mod.top_level_nodes = patched
    mod.top_level_symbols = lambda p: set(patched(p))


CASES = [
    ("M1_baseline_identity_swapped_COUNT_PRESERVED", m1_swap_one_baseline_identity,
     "A_OFF_unbound_IDENTITIES_equal_baseline_identities__NOT_JUST_THE_COUNT",
     ["A_OFF_reproduces_pinned_baseline__n_unbound",
      "A_OFF_reproduces_pinned_baseline__n_bindable",
      "A_OFF_reproduces_pinned_baseline__bound_and_concrete"]),
    ("M2_non_family_row_moved", m2_move_a_non_family_row,
     "A_no_unexpected_movement_outside_the_WAIT_SESSION_family", []),
    ("M3_binder_reported_dirty", m3_report_binder_dirty,
     "PROVENANCE_source_closure_dirty_intersection_is_ZERO", []),
    ("M4_arms_made_identical", m4_make_arms_identical,
     "POSITIVE_WITNESS_the_arms_actually_moved_rows_INSIDE_the_family", []),
    # ⚠️ R-507 §6.3 -- M5's COLLATERAL-GREEN CLAIM IS WITHDRAWN. It previously
    #   asserted the strict-subset check STAYED GREEN under this mutation. It
    #   did -- but only because the old predicate passed on EQUALITY, and this
    #   mutation makes the two sets equal by pointing both at one file. The
    #   green was the DEFECT WEARING THE PROOF'S UNIFORM, not independence.
    #   Collateral contract is now EMPTY; whatever it reddens is REPORTED.
    ("M5_capability_pretended_PORTED", m5_pretend_capability_was_ported,
     "SCOPE_TRIPWIRE_capability_still_ABSENT_from_the_deployed_lane",
     []),
    ("M6_deployed_only_symbol_planted", m6_plant_a_deployed_only_symbol,
     "SCOPE_deployed_symbols_are_a_SUBSET_OR_EQUAL_of_campaign",
     []),
    # ★★★★★ R-507 §6.2 -- THE MUTATION THE OLD PREDICATE COULD NOT SEE.
    #   Equality satisfies subset-OR-equal and must NOT satisfy strict subset.
    #   The retired `STRICT_SUBSET` key passed here, which is precisely why
    #   M5's collateral-green was vacuous.
    ("M7_sets_made_EQUAL", m7_make_symbol_sets_equal,
     "SCOPE_deployed_symbols_are_a_STRICT_SUBSET_of_campaign",
     ["SCOPE_deployed_symbols_are_a_SUBSET_OR_EQUAL_of_campaign"]),
]


AUTHORITATIVE_ARTIFACT = HERE / "session-role-resolver-yield-2026-07-31.json"


def committed_text(repo_root: Path, rel: str):
    """★★★★★ R-509 §6.2 -- read the PUBLISHED TREE, not the author's desk.
    `GIT HASH-OBJECT OF A PATH HASHES THE WORKTREE; IT DOES NOT PROVE THE BLOB
    AT HEAD.` Returns None when the path is not in HEAD at all."""
    try:
        return subprocess.check_output(
            ["git", "show", "HEAD:%s" % rel], cwd=str(repo_root),
            stderr=subprocess.DEVNULL).decode("utf-8")
    except Exception:
        return None


def publication_consistency(published_path: Path, repo_root: Path = None,
                            read_mode: str = "committed") -> dict:
    """★★★★★ R-508 §5.5 -- IS THE PUBLISHED ARTIFACT WHAT THE CURRENT CODE
    PRODUCES? Runs the generator unmutated into a THROWAWAY path and compares
    its load-bearing digest against the artifact ON DISK.

    ⚠️★★★★★ R-508 §5.6(a) WAS OFFERED AS A `[HYPOTHESIS]` TO TEST, AND THE TEST
    CONFIRMS IT. A check placed INSIDE the generator cannot do this job: the
    generator WRITES the artifact and would then hash what it had just written,
    so the comparison is true by construction and stays true while the COMMITTED
    object rots. That is exactly how the stale artifact shipped -- the working
    file was never regenerated, so `git hash-object` of it matched the commit
    perfectly and the receipt pinned a stale object HONESTLY.
    ★★★ THE OBJECT UNDER TEST MUST THEREFORE BE THE FILE ON DISK, COMPARED
    AGAINST FRESHLY-GENERATED CONTENT THAT WAS WRITTEN SOMEWHERE ELSE. The
    desk's prediction is upheld; it is recorded here as TESTED, not obeyed.
    """
    mod = load_instrument()          # OUT_PATH already redirected to a temp file
    mod.ASSERTIONS.clear()
    mod.main()
    fresh = json.loads(Path(mod.OUT_PATH).read_text(encoding="utf-8"))
    repo_root = repo_root or HERE.parents[2]
    rel = str(published_path.resolve().relative_to(repo_root.resolve())).replace("\\", "/")

    if read_mode == "committed":
        raw = committed_text(repo_root, rel)
        if raw is None:
            return {"PUBLISHED_ARTIFACT_IS_CURRENT": False, "read_mode": read_mode,
                    "reason": "path is not present in HEAD", "path": rel}
    else:  # "worktree" -- the PRE-R-509 behaviour, retained ONLY so M9 can
           # demonstrate that it fails to detect a stale commit.
        if not published_path.exists():
            return {"PUBLISHED_ARTIFACT_IS_CURRENT": False, "read_mode": read_mode,
                    "reason": "published artifact does not exist", "path": str(published_path)}
        raw = published_path.read_text(encoding="utf-8")

    published = json.loads(raw)
    fd, pd = mod.artifact_content_digest(fresh), mod.artifact_content_digest(published)
    return {
        "PUBLISHED_ARTIFACT_IS_CURRENT": fd == pd,
        "read_mode": read_mode,
        "READ_THROUGH": ("git show HEAD:%s" % rel) if read_mode == "committed"
                        else ("worktree read of %s" % rel),
        "published_path": str(published_path),
        "fresh_digest": fd,
        "published_digest": pd,
        "published_n_pass": published.get("ASSERTIONS", {}).get("n_pass"),
        "fresh_n_pass": fresh.get("ASSERTIONS", {}).get("n_pass"),
        "published_deployed_head": published.get(
            "DEPLOYED_LANE_SCOPE__READ_BEFORE_QUOTING_ANY_NUMBER_HERE", {})
            .get("SNAPSHOT_RECORD", {}).get("deployed_repo_head"),
        "WHAT_RED_MEANS": (
            "The committed artifact is NOT what the current code produces. "
            "`CURRENT CODE GREEN / PUBLISHED RESULT STALE` -- regenerate and re-commit "
            "before quoting any number from it."
        ),
    }


def main():
    results = []

    # ── THE CONTROL. Without it, "the mutation went red" is unreadable. ──────
    rc, control = run()
    control_ok = rc == 0 and all(control.values())
    results.append({"case": "CONTROL_unmutated", "exit_code": rc,
                    "all_assertions_pass": all(control.values()),
                    "VERDICT": "GREEN" if control_ok else "UNEXPECTED-RED",
                    "OK": control_ok})
    print("[%s] CONTROL_unmutated -- exit=%d, %d/%d assertions pass"
          % ("OK " if control_ok else "BAD", rc,
             sum(control.values()), len(control)))

    for name, mutate, must_redden, must_stay_green in CASES:
        rc, got = run(mutate)
        reddened = got.get(must_redden) is False
        collateral = [k for k in must_stay_green if got.get(k) is not True]
        exited_nonzero = rc != 0
        ok = reddened and exited_nonzero and not collateral
        all_red = sorted(k for k, v in got.items() if v is False)
        results.append({
            "case": name,
            "assertion_that_must_go_RED": must_redden,
            "it_went_RED": reddened,
            "exit_code": rc,
            "exit_code_is_nonzero": exited_nonzero,
            "assertions_that_must_STAY_GREEN": must_stay_green,
            "collateral_failures": collateral,
            # ★ R-507 §6.3/§6.10 -- report EVERY assertion this mutation
            #   reddened, whether or not a contract was declared for it. A
            #   mutation's blast radius is evidence and must not be hidden by
            #   an empty collateral contract.
            "ALL_assertions_this_mutation_reddened": all_red,
            "n_reddened": len(all_red),
            "VERDICT": "DISCRIMINATES" if ok else "DOES-NOT-DISCRIMINATE",
            "OK": ok,
        })
        print("[%s] %-42s -> %-62s RED=%s exit=%d reddened=%d collateral=%s"
              % ("OK " if ok else "BAD", name, must_redden, reddened, rc,
                 len(all_red), collateral))

    # ── R-509 §6.3 -- M9: COMMITTED ARTIFACT STALE / WORKTREE FRESH ──────────
    #    Proves the failure the third external read predicted, in BOTH
    #    directions: the OLD worktree read cannot see it; the NEW committed
    #    read can. `A MUTATION THAT ONLY EVER PASSED IS NOT A RED-PROOF.`
    #    ⚠️ Fixture repo only -- the real artifact is never touched.
    m9 = {}
    fix = Path(tempfile.mkdtemp(prefix="_m9_fixture_"))
    try:
        rel = "docs/replay-results/h1-battery/session-role-resolver-yield-2026-07-31.json"
        (fix / rel).parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "init", "-q"], cwd=fix, check=True)
        subprocess.run(["git", "config", "user.email", "m9@fixture"], cwd=fix, check=True)
        subprocess.run(["git", "config", "user.name", "m9"], cwd=fix, check=True)

        # 1. COMMIT a deliberately STALE artifact.
        stale = json.loads(AUTHORITATIVE_ARTIFACT.read_text(encoding="utf-8"))
        stale["ASSERTIONS"]["n_pass"] = 1
        stale["ASSERTIONS"]["checks"] = stale["ASSERTIONS"]["checks"][:1]
        (fix / rel).write_text(json.dumps(stale, indent=2), encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=fix, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "stale artifact"], cwd=fix, check=True)

        # 2. Put the FRESH artifact in the WORKING TREE only -- never committed.
        shutil.copyfile(AUTHORITATIVE_ARTIFACT, fix / rel)

        old = publication_consistency(fix / rel, repo_root=fix, read_mode="worktree")
        new = publication_consistency(fix / rel, repo_root=fix, read_mode="committed")
        old_blind = old["PUBLISHED_ARTIFACT_IS_CURRENT"] is True     # fails to detect
        new_catches = new["PUBLISHED_ARTIFACT_IS_CURRENT"] is False  # detects
        m9_ok = old_blind and new_catches
        m9 = {
            "case": "M9_committed_artifact_STALE_worktree_FRESH",
            "fixture": str(fix),
            "PRE_R509_worktree_read": {
                "PUBLISHED_ARTIFACT_IS_CURRENT": old["PUBLISHED_ARTIFACT_IS_CURRENT"],
                "VERDICT": "GREEN -- BLIND to the stale commit (the defect)",
                "READ_THROUGH": old.get("READ_THROUGH")},
            "POST_R509_committed_read": {
                "PUBLISHED_ARTIFACT_IS_CURRENT": new["PUBLISHED_ARTIFACT_IS_CURRENT"],
                "VERDICT": "RED -- catches it", "READ_THROUGH": new.get("READ_THROUGH"),
                "committed_n_pass": new.get("published_n_pass"),
                "fresh_n_pass": new.get("fresh_n_pass")},
            "ALL_assertions_this_mutation_reddened": ["PUBLICATION_CONSISTENCY"] if new_catches
                                                     else [],
            "WHY_BOTH_DIRECTIONS": (
                "R-509 §6.3 requires M9 fail under the current implementation and pass only "
                "after the committed-tree fix. Both runs are executed here in one pass, so "
                "the fix's necessity is demonstrated rather than asserted."),
            "VERDICT": "DISCRIMINATES" if m9_ok else "DOES-NOT-DISCRIMINATE", "OK": m9_ok}
        results.append(m9)
        print("[%s] M9_committed_stale/worktree_fresh -> worktree-read GREEN(blind)=%s | "
              "committed-read RED(catches)=%s" % ("OK " if m9_ok else "BAD",
                                                  old_blind, new_catches))
    finally:
        shutil.rmtree(fix, ignore_errors=True)

    # ── R-509 §6.5 -- M10: the §4 BLIND SPOT. Alter a load-bearing identity
    #    block while leaving every assertion name, PASS value and summary
    #    metric untouched. Under option (a) this MUST go RED.
    m10_path = Path(tempfile.gettempdir()) / "_redproof_blindspot_artifact.json"
    doc = json.loads(AUTHORITATIVE_ARTIFACT.read_text(encoding="utf-8"))
    rows = doc["corpus_A"]["IDENTITY_REFUSAL_MAP"]["changed_rows"]
    rows[0]["object"] = "ZZZ SILENTLY ALTERED IDENTITY -- no count or assertion changed"
    m10_path.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    m10 = publication_consistency(m10_path, repo_root=None, read_mode="worktree")
    m10_ok = m10["PUBLISHED_ARTIFACT_IS_CURRENT"] is False
    results.append({
        "case": "M10_identity_block_silently_altered",
        "WHAT_WAS_PLANTED": "one IDENTITY_REFUSAL_MAP row's `object` text changed; every "
                            "assertion name, every PASS value, every count and every summary "
                            "metric left IDENTICAL -- the exact class the old allow-list digest "
                            "could not see.",
        "it_went_RED": m10_ok,
        "WHY_IT_MATTERS": "These are the 17 per-condition identities R-502 §4 required be IN "
                          "the artifact. A freshness guard that cannot see them would certify "
                          "a silently-changed deliverable as CURRENT.",
        "ALL_assertions_this_mutation_reddened": ["PUBLICATION_CONSISTENCY"] if m10_ok else [],
        "VERDICT": "DISCRIMINATES" if m10_ok else "DOES-NOT-DISCRIMINATE", "OK": m10_ok})
    print("[%s] M10_identity_block_silently_altered -> PUBLICATION_CONSISTENCY RED=%s"
          % ("OK " if m10_ok else "BAD", m10_ok))

    # ── R-508 §5.5 -- PUBLICATION CONSISTENCY, and §5.6(b) -- RED-PROOF IT ────
    live = publication_consistency(AUTHORITATIVE_ARTIFACT)
    live_ok = live["PUBLISHED_ARTIFACT_IS_CURRENT"] is True
    results.append({"case": "PUBLICATION_CONSISTENCY_live",
                    "PUBLISHED_ARTIFACT_IS_CURRENT": live_ok, "detail": live,
                    "VERDICT": "CURRENT" if live_ok else "STALE", "OK": live_ok})
    print("[%s] PUBLICATION_CONSISTENCY_live -- published artifact is current: %s"
          % ("OK " if live_ok else "BAD", live_ok))

    # M8: plant a STALE artifact and require the check to notice. The real
    # artifact is never touched -- the staled copy is written to a temp path.
    stale_path = Path(tempfile.gettempdir()) / "_redproof_stale_artifact.json"
    doc = json.loads(AUTHORITATIVE_ARTIFACT.read_text(encoding="utf-8"))
    doc["ASSERTIONS"]["n_pass"] = 33
    doc["ASSERTIONS"]["checks"] = doc["ASSERTIONS"]["checks"][:-1]
    doc["DEPLOYED_LANE_SCOPE__READ_BEFORE_QUOTING_ANY_NUMBER_HERE"]["SNAPSHOT_RECORD"][
        "deployed_repo_head"] = "<unavailable: Command 'git rev-parse HEAD' exit 128>"
    stale_path.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    m8 = publication_consistency(stale_path)
    m8_ok = m8["PUBLISHED_ARTIFACT_IS_CURRENT"] is False
    results.append({
        "case": "M8_stale_artifact_planted",
        "assertion_that_must_go_RED": "PUBLICATION_CONSISTENCY",
        "it_went_RED": m8_ok, "detail": m8,
        "WHAT_WAS_PLANTED": "n_pass 34->33, last assertion dropped, deployed_repo_head "
                            "replaced with the exact error string that shipped -- i.e. the "
                            "REAL defect reproduced, not a synthetic one.",
        "ALL_assertions_this_mutation_reddened": ["PUBLICATION_CONSISTENCY"] if m8_ok else [],
        "VERDICT": "DISCRIMINATES" if m8_ok else "DOES-NOT-DISCRIMINATE", "OK": m8_ok})
    print("[%s] M8_stale_artifact_planted    -> PUBLICATION_CONSISTENCY  RED=%s"
          % ("OK " if m8_ok else "BAD", m8_ok))

    all_ok = all(r["OK"] for r in results)
    import subprocess

    def git(*a):
        try:
            return subprocess.check_output(["git", *a], cwd=str(HERE.parents[2]),
                                           stderr=subprocess.DEVNULL).decode().strip()
        except Exception as exc:
            return "<unavailable: %s>" % exc

    n_control = len(control)
    out = {
        # ── R-507 §6.9 -- the header claim, corrected and NARROWED ───────────
        "WHAT_THIS_PROVES": (
            "The %d assertions in session_role_resolver_yield.py were run unmutated and all "
            "passed, and each assertion CLASS listed in ASSERTION_CLASSES_WITH_A_DEMONSTRATED_"
            "RED_PATH below has at least one mutation that reddens it. A guard that has never "
            "gone red is not an instrument." % n_control
        ),
        "⚠️_WHAT_THIS_DOES_NOT_PROVE": (
            "This is NOT universal coverage. Assertions outside the listed classes have NO "
            "demonstrated red path here and must not be read as red-proofed. An earlier "
            "version of this receipt claimed 'every assertion class' over a 26-assertion run "
            "and that claim was BOTH stale in its count AND wider than its evidence."
        ),
        "ASSERTION_CLASSES_WITH_A_DEMONSTRATED_RED_PATH": {
            "baseline_identity_join": "M1",
            "non_family_movement_hard_stop": "M2",
            "provenance_source_closure": "M3",
            "positive_witness_for_empty_censuses": "M4",
            "deployed_scope_capability_tripwire": "M5",
            "deployed_scope_subset_or_equal": "M6",
            "deployed_scope_STRICT_subset": "M7",
            "publication_consistency_published_vs_current_code": "M8",
        },
        "⚠️_R508_5_6a_HYPOTHESIS_TESTED_AND_UPHELD": (
            "R-508 §5.6(a) predicted that hashing the generator's own in-memory output would "
            "be self-satisfying. TESTED: it is. The generator writes the artifact and would "
            "hash what it just wrote, so the check is true by construction while the COMMITTED "
            "object rots -- which is precisely how the stale artifact shipped, with an HONEST "
            "receipt pinning it. The check therefore lives HERE, compares the file ON DISK "
            "against freshly-generated content written elsewhere, and M8 proves it can fail."
        ),
        "ASSERTION_CLASSES_WITHOUT_ONE": [
            "corpus/population size vs pinned baseline", "determinism", "invalidation counts",
            "count-equals-identity-list-length", "gate/held-flag controls",
            "shared-symbol body comparison", "deployed HEAD resolution",
        ],
        "M1_IS_THE_SHARP_ONE": (
            "M1 swaps one baseline identity while PRESERVING THE COUNT. The three count "
            "assertions stay GREEN and only the identity assertion goes RED -- which is "
            "R-425's defect ('a count is satisfied by losing one row and gaining another') "
            "reproduced and caught."
        ),
        "⚠️_M5_COLLATERAL_CLAIM_WITHDRAWN": (
            "R-507 §2. A previous receipt claimed M5 reddened the scope tripwire while the "
            "strict-subset assertion STAYED GREEN, and read that as proof the two checks were "
            "independent. That green was VACUOUS: M5 points both symbol sets at ONE file, and "
            "the then-current predicate tested subset-OR-EQUAL, which equality satisfies. "
            "`A COLLATERAL-GREEN THAT PASSES BECAUSE THE PREDICATE IS TOO WEAK TO NOTICE IS "
            "NOT EVIDENCE OF INDEPENDENCE -- IT IS THE DEFECT WEARING THE PROOF'S UNIFORM.` "
            "M5's collateral contract is now EMPTY and its full blast radius is reported in "
            "ALL_assertions_this_mutation_reddened. Independence of the subset-or-equal and "
            "STRICT-subset checks is re-derived from M6 and M7, which redden DIFFERENT ones."
        ),
        # ── R-507 §6.11 -- this receipt's own provenance ─────────────────────
        "PROVENANCE": {
            "head": git("rev-parse", "HEAD"),
            "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
            "harness_blob": git("hash-object", "--",
                                "docs/replay-results/h1-battery/"
                                "session_role_resolver_yield_REDPROOF.py"),
            "generator_blob": git("hash-object", "--",
                                  "docs/replay-results/h1-battery/"
                                  "session_role_resolver_yield.py"),
            "artifact_blob": git("hash-object", "--",
                                 "docs/replay-results/h1-battery/"
                                 "session-role-resolver-yield-2026-07-31.json"),
            "reproduce": ("python docs/replay-results/h1-battery/"
                          "session_role_resolver_yield_REDPROOF.py"),
            "NOTE": "Mutated runs write their artifact to a throwaway temp path, so no "
                    "mutation can overwrite the real artifact.",
        },
        "ALL_CASES_DISCRIMINATE": all_ok,
        "cases": results,
    }
    path = HERE / "session-role-resolver-yield-REDPROOF-2026-07-31.json"
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")
    print("\nALL CASES DISCRIMINATE: %s" % all_ok)
    print("receipt -> %s" % path)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
