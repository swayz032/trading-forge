"""RED-PROOF for session_role_resolver_yield.py (R-503 lane I7, §5.H).

★★★★★ WHY THIS FILE EXISTS: the instrument ships a set of PASSING assertions
(the count is COMPUTED and printed at runtime -- it is deliberately not written
here, because this caption said `26` long after the real number was `30`, and
R-510 §6.6 ordered the stale caption removed rather than merely updated).
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


MUTATION_REASONS = {
    "M1_baseline_identity_swapped_COUNT_PRESERVED":
        "One baseline key is replaced by a fake while the COUNT is preserved, so the three "
        "count assertions stay green and only set-membership comparisons fail: the baseline "
        "identity join, the C2/WAIT_SESSION set identity, the two-path derivation, and the "
        "join-key resolution. RED comes from set difference, not from any count.",
    "M2_non_family_row_moved":
        "A non-WAIT_SESSION row's `reason` is forced to differ between arms, so it appears in "
        "the changed-rows map while sitting outside the family key set. RED comes from the "
        "non-family movement census being non-empty on BOTH corpora.",
    "M3_binder_reported_dirty":
        "`dirty_paths()` is patched to include the binder, so the binder path intersects the "
        "executed source closure. RED comes from a non-empty dirty/closure intersection, and "
        "the RAW closure check reddens with it because the same path is in both.",
    "M4_arms_made_identical":
        "Both arms are bound with the flag OFF, so no row moves anywhere. RED comes from the "
        "POSITIVE WITNESS -- it exists precisely so the two empty-census assertions cannot "
        "pass vacuously, and here it proves they would have.",
    "M5_capability_pretended_PORTED":
        "DEPLOYED_BINDER is pointed at the campaign binder, so every capability symbol reads "
        "as present in the deployed lane AND the two symbol sets become equal. RED comes from "
        "the scope tripwire (capability present) and from strict-subset (equality is not "
        "strict). It reddens BOTH, which is what falsified AR-528's independence claim.",
    "M6_deployed_only_symbol_planted":
        "A symbol the campaign lane lacks is added to the deployed node table. RED comes from "
        "subset-or-equal (a deployed-only symbol exists) and from strict-subset, which "
        "requires zero deployed-only. The scope tripwire stays GREEN -- no capability symbol "
        "was added -- which is what separates the tripwire from the subset checks.",
    "M7_sets_made_EQUAL":
        "The deployed node table is replaced by the campaign one, making the sets EQUAL. RED "
        "comes from strict-subset ONLY (equality fails `dep < camp`) while subset-or-equal "
        "stays GREEN. This is the case the retired `STRICT_SUBSET` predicate silently absorbed.",
}

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
REPO = HERE.parents[2]
_B = "docs/replay-results/h1-battery/"
ARTIFACT_REL = _B + "session-role-resolver-yield-2026-07-31.json"
GENERATOR_REL = _B + "session_role_resolver_yield.py"
HARNESS_REL = _B + "session_role_resolver_yield_REDPROOF.py"
RECEIPT_REL = _B + "session-role-resolver-yield-REDPROOF-2026-07-31.json"

# ★★★★★ R-511 §6.1 -- THE MEMBERSHIP SET IS ONE NAMED CONSTANT, ON PURPOSE.
#   Everything that scores publication cleanliness reads THIS tuple, so the set
#   cannot drift between the scored case and the receipt block, and widening it
#   is a one-line change rather than an edit in three places.
#   ⚠️ RECEIPT_REL is DELIBERATELY NOT A MEMBER YET. Whether it belongs here is
#   exactly what M13 was built to answer, and R-511 §6.8 forbids widening
#   anything before that mutation has spoken:
#   `A REMEDY DESIGNED BEFORE ITS DIAGNOSIS IS A GUESS WITH A COMMIT MESSAGE.`
PUBLICATION_PATH_SET = (ARTIFACT_REL, GENERATOR_REL, HARNESS_REL)


def pubblob(rel: str, repo_root: Path = None) -> dict:
    """★ R-510 §6.3 -- worktree blob AND committed blob for a publication path.
    `GIT HASH-OBJECT OF A PATH HASHES THE WORKTREE; IT DOES NOT PROVE THE BLOB
    AT HEAD` -- so both are taken and their equality is the claim.

    ★ R-511 §6.2 -- `repo_root` exists so M12/M13 can ask this question of a
    FIXTURE repo. It defaults to the real tree, so every existing caller is
    unchanged."""
    root = REPO if repo_root is None else repo_root

    def g(*a):
        try:
            return subprocess.check_output(["git", *a], cwd=str(root),
                                           stderr=subprocess.DEVNULL).decode().strip()
        except Exception as exc:
            return "<unavailable: %s>" % exc
    work, head = g("hash-object", "--", rel), g("rev-parse", "HEAD:%s" % rel)
    return {"path": rel, "worktree_blob": work, "head_blob": head, "IDENTICAL": work == head}


def digest_attributed(res: dict) -> bool:
    """★★★★★ R-512 §6.4 -- IS THIS RED ATTRIBUTABLE TO A DIGEST COMPARISON?

    `publication_consistency` has THREE early returns that yield
    `PUBLISHED_ARTIFACT_IS_CURRENT: False` WITHOUT COMPUTING ANY DIGEST --
    "path is outside the repo", "path is not present in HEAD", and "published
    artifact does not exist" (which fires in ANY read_mode). A case that scores
    the bare colour cannot tell those apart from a real mismatch.

    THIS IS THE R-510 §2 FIX SWEPT ACROSS THE CLASS. It was applied to M8 alone
    and never propagated; R-512 §3 found M10 and M11 still scoring a bare colour
    two rulings later. `WHEN THE SAME SHAPE CONVICTS THREE TIMES, THE DEFECT IS
    NO LONGER THE INSTANCE -- IT IS THAT NOBODY SWEPT.`
    """
    return ("fresh_digest" in res and "published_digest" in res
            and res["fresh_digest"] != res["published_digest"])


def m13_acceptance(void: bool, control_fired: bool, stale_in_fact: bool,
                   reader_red: bool, reddened_by: list) -> bool:
    """★★★★★ R-512 §6.1 -- M13's VERDICT, AS A PURE PREDICATE SO IT CAN BE
    FALSIFIED ON DEMAND.

    The previous verdict omitted `reader_red` entirely: deleting the receipt
    reader outright left m13_ok True, because fixture validity, the stale-receipt
    fact and the positive control were all still satisfied. AR-535 then captioned
    the case "its own red-proof" -- a claim its own verdict did not enforce.
    `A RED RESULT RECORDED BESIDE OK IS NOT LOAD-BEARING UNLESS OK REQUIRES IT.`

    Extracted as a function precisely so item 5 can re-evaluate it with the
    reader suppressed and PROVE it goes False, rather than asserting it does.
    """
    return (not void and control_fired and stale_in_fact and reader_red is True
            and reddened_by == ["RECEIPT_records_the_CURRENT_publication_blobs"])


def publication_pairs(repo_root: Path = None) -> dict:
    """★★★★★ R-511 §6.1 -- compute the publication pairs ONCE.

    `A BOOLEAN WRITTEN INTO A RECEIPT AFTER ALL_OK IS DECIDED IS A NOTE, NOT A
    GATE.` The previous receipt computed these 74 lines AFTER the verdict, so a
    dirty artifact could never change the exit code. The values are now produced
    here, SCORED as a case, and the same dict is what the receipt reports --
    so the gate and the record cannot disagree."""
    pairs = {rel: pubblob(rel, repo_root) for rel in PUBLICATION_PATH_SET}
    return {"pairs": pairs, "ALL_IDENTICAL": all(p["IDENTICAL"] for p in pairs.values())}


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
    its load-bearing digest against the PUBLISHED artifact.

    ★ R-511 §3-1 -- this docstring used to say "the artifact ON DISK", which was
    the PRE-R-509 behaviour and is now false in the default mode: `committed`
    reads `git show HEAD:<path>` and never touches the working file. "ON DISK"
    is exactly the thing this function was changed to STOP doing. Only the
    retained `worktree` mode -- kept solely so M9 can demonstrate the old
    blindness -- reads the file on disk.

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
    # A worktree-mode target may legitimately live outside the repo (M10 uses a
    # temp fixture), so the relative path is best-effort and only load-bearing
    # for the committed-tree read.
    try:
        rel = str(published_path.resolve().relative_to(repo_root.resolve())).replace("\\", "/")
    except ValueError:
        if read_mode == "committed":
            return {"PUBLISHED_ARTIFACT_IS_CURRENT": False, "read_mode": read_mode,
                    "reason": "path is outside the repo, so it has no committed blob",
                    "path": str(published_path)}
        rel = str(published_path)

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
    HISTORY = []   # R-512 §6.3 -- recorded evidence, NEVER scored in all_ok

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
        # ★★★★★ R-510 §6.2 -- PUBLISH THE REASON, NOT ONLY THE COLOUR.
        #   `A MUTATION IS SCORED ON ITS COLOUR, NEVER ON ITS REASON` is how M8
        #   rotted into a path error while printing an unchanged line.
        reason = MUTATION_REASONS.get(name, "[REASON NOT RECORDED -- defect]")
        # These mutations act on the GENERATOR (binder, arms, rows, symbol
        # tables). None of them touches `published_path`, so the R-509 §6.2
        # reader change cannot affect them -- asserted, not assumed.
        touches_publication = "PUBLICATION_CONSISTENCY" in all_red
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
            "WHY_IT_REDDENED": reason,
            "RE_VALIDATED_AGAINST_THE_COMMITTED_TREE_READER": {
                "acts_on": "the GENERATOR (binder / arms / rows / symbol tables)",
                "touches_publication_path": touches_publication,
                "CONCLUSION": ("unaffected by the R-509 §6.2 reader change -- it never reads "
                               "`published_path`" if not touches_publication else
                               "⚠️ REDDENS A PUBLICATION ASSERTION -- re-examine"),
            },
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
    # ★★★★★ R-512 §6.4 SWEEP -- colour ALONE is not a verdict. This is the
    #   M8 attribution conjunct, applied to the class rather than the instance.
    m10_attributed = digest_attributed(m10)
    m10_ok = m10["PUBLISHED_ARTIFACT_IS_CURRENT"] is False and m10_attributed
    results.append({
        "case": "M10_identity_block_silently_altered",
        "WHAT_WAS_PLANTED": "one IDENTITY_REFUSAL_MAP row's `object` text changed; every "
                            "assertion name, every PASS value, every count and every summary "
                            "metric left IDENTICAL -- the exact class the old allow-list digest "
                            "could not see.",
        "it_went_RED": m10["PUBLISHED_ARTIFACT_IS_CURRENT"] is False,
        "RED_ATTRIBUTABLE_TO_DIGEST_MISMATCH": m10_attributed,
        "ATTRIBUTION_EVIDENCE": {
            "fresh_digest": m10.get("fresh_digest"),
            "published_digest": m10.get("published_digest"),
            "⚠️_WHY_BOTH_ARE_PUBLISHED": "a boolean is a SUMMARY of the comparison. "
                "Publishing both digests lets a reader re-derive the attribution by "
                "key instead of trusting the flag."},
        "⚠️_WHY_ATTRIBUTION_IS_REQUIRED": (
            "R-512 §6.4. publication_consistency can return NOT-CURRENT from three digest-free "
            "early returns (path outside the repo / absent from HEAD / file does not exist). "
            "Scoring the bare colour cannot distinguish those from a real mismatch -- which is "
            "M8's convicted defect, and it was live here for two rulings after M8 was fixed."),
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

    # ⚠️★★★★★ R-510 §6.1 -- M8 REBUILT IN A GIT FIXTURE.
    #   The previous M8 wrote its stale copy to a TEMP path and called
    #   committed-mode consistency on it. After R-509 §6.2 that path is outside
    #   any repo, so the reader returned "no committed blob" and the case went
    #   RED **WITHOUT EVER READING WHAT IT PLANTED** -- while the printed line
    #   stayed `RED=True`, character for character.
    #   `A TEST THAT TURNS RED BEFORE READING THE MUTATION HAS NOT TESTED THE
    #   MUTATION.` M8 now commits the stale shape INSIDE a fixture repo so the
    #   red is forced to come from a DIGEST MISMATCH, and the case asserts it.
    m8_fix = Path(tempfile.mkdtemp(prefix="_m8_fixture_"))
    try:
        rel = "docs/replay-results/h1-battery/session-role-resolver-yield-2026-07-31.json"
        (m8_fix / rel).parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "init", "-q"], cwd=m8_fix, check=True)
        subprocess.run(["git", "config", "user.email", "m8@fixture"], cwd=m8_fix, check=True)
        subprocess.run(["git", "config", "user.name", "m8"], cwd=m8_fix, check=True)

        # ★ R-511 §6.3 -- the plant derives from the COMMITTED artifact, not the
        #   worktree file. Same species as the receipt's measurement_source_commit:
        #   a stale-detection test seeded from an uncommitted desk state is
        #   describing the desk, not the publication.
        doc = json.loads(committed_text(REPO, ARTIFACT_REL)
                         or AUTHORITATIVE_ARTIFACT.read_text(encoding="utf-8"))
        # ★★★★★ R-511 §6.4 -- THE PLANT IS NOW INTERNALLY CONSISTENT.
        #   It previously set n_pass=33 while dropping only ONE check, leaving 35
        #   records beside a count of 33 -- an object no real run could produce,
        #   captioned as "the REAL AR-529 defect". Both halves are fixed: the
        #   count and the records now agree, and the caption below no longer
        #   claims to BE the AR-529 object.
        doc["ASSERTIONS"]["checks"] = doc["ASSERTIONS"]["checks"][:33]
        doc["ASSERTIONS"]["n_pass"] = 33
        doc["ASSERTIONS"]["n_fail"] = 0
        doc["DEPLOYED_LANE_SCOPE__READ_BEFORE_QUOTING_ANY_NUMBER_HERE"]["SNAPSHOT_RECORD"][
            "deployed_repo_head"] = "<unavailable: Command 'git rev-parse HEAD' exit 128>"
        (m8_fix / rel).write_text(json.dumps(doc, indent=2), encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=m8_fix, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "AR-529 stale shape"],
                       cwd=m8_fix, check=True)

        m8 = publication_consistency(m8_fix / rel, repo_root=m8_fix, read_mode="committed")
        # ★ THE RED MUST BE ATTRIBUTABLE TO THE COMPARISON, NOT A SHORT-CIRCUIT.
        compared = ("fresh_digest" in m8 and "published_digest" in m8
                    and m8["fresh_digest"] != m8["published_digest"])
        read_the_plant = m8.get("published_n_pass") == 33
        m8_ok = (m8["PUBLISHED_ARTIFACT_IS_CURRENT"] is False and compared and read_the_plant)
        results.append({
            "case": "M8_stale_artifact_COMMITTED_in_fixture",
            "assertion_that_must_go_RED": "PUBLICATION_CONSISTENCY",
            "it_went_RED": m8["PUBLISHED_ARTIFACT_IS_CURRENT"] is False,
            "RED_ATTRIBUTABLE_TO_DIGEST_MISMATCH": compared,
            "IT_ACTUALLY_READ_THE_PLANTED_CONTENT": read_the_plant,
            "planted_values_read_back": {
                "published_n_pass": m8.get("published_n_pass"),
                "published_deployed_head": m8.get("published_deployed_head")},
            "detail": m8,
            "WHAT_WAS_PLANTED": (
                "A stale shape MODELLED ON AR-529 and committed inside the fixture repo: the "
                "live artifact's %d assertions truncated to 33 with n_pass=33 and n_fail=0, "
                "plus the exact deployed_repo_head error string that shipped."
                % len(json.loads(committed_text(REPO, ARTIFACT_REL)
                                 or AUTHORITATIVE_ARTIFACT.read_text(encoding='utf-8'))
                      ["ASSERTIONS"]["checks"])),
            "⚠️_IT_IS_NOT_THE_AR_529_OBJECT_ITSELF": (
                "R-511 §2 and §6.4. The previous caption said `n_pass 34->33 ... the REAL "
                "AR-529 defect` and was stale at BOTH ends: the source artifact was at 36, "
                "not 34, and dropping one check left 35 records beside a count of 33 -- an "
                "internally inconsistent object no run could produce. The word EXACT is "
                "withdrawn. `A TEST THAT CALLS A 35-ROW OBJECT THE EXACT 33-ROW OBJECT IS "
                "OVERCAPTIONED.` The count is now derived from the committed artifact at "
                "runtime rather than typed, so it cannot go stale again. WHAT IS UNAFFECTED: "
                "the committed-reader detection this case exists to prove -- the mismatch is "
                "real, is attributable to the digest, and reads the planted content back."),
            "ALL_assertions_this_mutation_reddened": ["PUBLICATION_CONSISTENCY"] if m8_ok else [],
            "VERDICT": "DISCRIMINATES" if m8_ok else "DOES-NOT-DISCRIMINATE", "OK": m8_ok})
        print("[%s] M8_stale_COMMITTED_in_fixture -> RED=%s from_digest_mismatch=%s "
              "read_planted_n_pass=%s" % ("OK " if m8_ok else "BAD",
                                          m8["PUBLISHED_ARTIFACT_IS_CURRENT"] is False,
                                          compared, m8.get("published_n_pass")))
    finally:
        shutil.rmtree(m8_fix, ignore_errors=True)

    # ★ R-510 §6.1 -- the out-of-repo path is a SEPARATE, LEGITIMATE test and
    #   MUST NOT count as the stale-content proof. Named so it can never be
    #   mistaken for one again.
    unpub = Path(tempfile.gettempdir()) / "_redproof_unpublishable.json"
    unpub.write_text(AUTHORITATIVE_ARTIFACT.read_text(encoding="utf-8"), encoding="utf-8")
    m8b = publication_consistency(unpub, repo_root=None, read_mode="committed")
    m8b_ok = (m8b["PUBLISHED_ARTIFACT_IS_CURRENT"] is False
              and "no committed blob" in str(m8b.get("reason", "")))
    results.append({
        "case": "M8b_unpublishable_path",
        "WHAT_IT_TESTS": "a path with NO committed blob must FAIL CLOSED, not silently pass.",
        "⚠️_WHAT_IT_IS_NOT": "This is NOT evidence that stale CONTENT is detected. It reddens "
                             "before reading anything, which is exactly why the old M8 was a "
                             "false discrimination. M8 (fixture) is the content proof.",
        "it_failed_closed": m8b_ok, "detail": m8b,
        "VERDICT": "FAILS-CLOSED" if m8b_ok else "DOES-NOT-FAIL-CLOSED", "OK": m8b_ok})
    print("[%s] M8b_unpublishable_path       -> fails closed=%s (NOT a stale-content proof)"
          % ("OK " if m8b_ok else "BAD", m8b_ok))

    # ── R-510 §6.4 -- M11: the source-closure identity must be INSIDE the digest
    m11_path = Path(tempfile.gettempdir()) / "_redproof_closure_altered.json"
    doc = json.loads(AUTHORITATIVE_ARTIFACT.read_text(encoding="utf-8"))
    doc["PROVENANCE_SOURCE_CLOSURE"]["manifest"][0]["path"] = "ZZZ/altered/closure/path.py"
    m11_path.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    m11 = publication_consistency(m11_path, repo_root=None, read_mode="worktree")
    # ★★★★★ R-512 §6.4 SWEEP -- same conjunct, same reason.
    m11_attributed = digest_attributed(m11)
    m11_ok = m11["PUBLISHED_ARTIFACT_IS_CURRENT"] is False and m11_attributed
    results.append({
        "case": "M11_source_closure_identity_altered",
        "WHAT_WAS_PLANTED": "one closure manifest PATH changed; assertion names, PASS values, "
                            "campaign metrics and identity maps all left IDENTICAL.",
        "it_went_RED": m11["PUBLISHED_ARTIFACT_IS_CURRENT"] is False,
        "RED_ATTRIBUTABLE_TO_DIGEST_MISMATCH": m11_attributed,
        "ATTRIBUTION_EVIDENCE": {
            "fresh_digest": m11.get("fresh_digest"),
            "published_digest": m11.get("published_digest"),
            "⚠️_WHY_BOTH_ARE_PUBLISHED": "a boolean is a SUMMARY of the comparison. "
                "Publishing both digests lets a reader re-derive the attribution by "
                "key instead of trusting the flag."},
        "⚠️_WHY_ATTRIBUTION_IS_REQUIRED": (
            "R-512 §6.4 -- same conjunct, same reason as M10. `A TEST THAT TURNS RED BEFORE "
            "READING THE MUTATION HAS NOT TESTED THE MUTATION.`"),
        "WHY_IT_MATTERS": "R-510 §6.4 -- `A FULL-ARTIFACT DIGEST CANNOT EXCLUDE THE ENTIRE "
                          "PROOF OF WHICH SOURCES RAN.` The previous digest dropped the whole "
                          "closure block, so this alteration would have been certified CURRENT.",
        "ALL_assertions_this_mutation_reddened": ["PUBLICATION_CONSISTENCY"] if m11_ok else [],
        "VERDICT": "DISCRIMINATES" if m11_ok else "DOES-NOT-DISCRIMINATE", "OK": m11_ok})
    print("[%s] M11_source_closure_identity_altered -> PUBLICATION_CONSISTENCY RED=%s"
          % ("OK " if m11_ok else "BAD", m11_ok))

    # ── ★★★★★ R-511 §6.2 -- M12: DIRTY WORKTREE / CURRENT COMMIT ────────────
    #    The two questions this lane kept conflating, separated and proved
    #    separate: `COMMITTED-CONTENT CURRENTNESS AND WORKTREE CLEANLINESS ARE
    #    TWO DIFFERENT ASSERTIONS.` The committed object stays sound (so
    #    publication_consistency must stay GREEN) while the desk is dirty (so
    #    the new pair gate must go RED). A mutation that reddened both would
    #    prove nothing about which check did the work.
    def _fixture(paths, prefix):
        fix = Path(tempfile.mkdtemp(prefix=prefix))
        for rel, src in paths:
            (fix / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, fix / rel)
        subprocess.run(["git", "init", "-q"], cwd=fix, check=True)
        subprocess.run(["git", "config", "user.email", "fixture@local"], cwd=fix, check=True)
        subprocess.run(["git", "config", "user.name", "fixture"], cwd=fix, check=True)
        subprocess.run(["git", "add", "-A"], cwd=fix, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "fixture"], cwd=fix, check=True)
        return fix

    SELF = Path(__file__).resolve()
    RECEIPT_PATH = HERE / "session-role-resolver-yield-REDPROOF-2026-07-31.json"
    m12fix = _fixture(((ARTIFACT_REL, AUTHORITATIVE_ARTIFACT),
                       (GENERATOR_REL, TARGET),
                       (HARNESS_REL, SELF)), "_m12_fixture_")

    before = publication_pairs(m12fix)
    doc = json.loads((m12fix / ARTIFACT_REL).read_text(encoding="utf-8"))
    doc["__M12_WORKTREE_ONLY_EDIT__"] = "present in the working file, absent from HEAD"
    (m12fix / ARTIFACT_REL).write_text(json.dumps(doc, indent=2), encoding="utf-8")
    after = publication_pairs(m12fix)
    pc12 = publication_consistency(m12fix / ARTIFACT_REL, repo_root=m12fix,
                                   read_mode="committed")

    m12_started_clean = before["ALL_IDENTICAL"] is True
    m12_artifact_red = after["pairs"][ARTIFACT_REL]["IDENTICAL"] is False
    m12_others_green = (after["pairs"][GENERATOR_REL]["IDENTICAL"] is True
                        and after["pairs"][HARNESS_REL]["IDENTICAL"] is True)
    m12_commit_still_current = pc12["PUBLISHED_ARTIFACT_IS_CURRENT"] is True
    m12_ok = (m12_started_clean and m12_artifact_red and m12_others_green
              and m12_commit_still_current)
    results.append({
        "case": "M12_artifact_worktree_DIRTY_commit_CURRENT",
        "fixture": str(m12fix),
        "WHAT_WAS_MUTATED": "ONE key added to the artifact's WORKING FILE only. Nothing was "
                            "committed after the fixture's initial commit, so HEAD still "
                            "holds the real, current artifact.",
        "BEFORE_the_edit__all_pairs_identical": m12_started_clean,
        "artifact_pair_went_RED": m12_artifact_red,
        "generator_and_harness_pairs_STAYED_GREEN": m12_others_green,
        "publication_consistency_STAYED_GREEN": m12_commit_still_current,
        "committed_read_through": pc12.get("READ_THROUGH"),
        # ⚠️★★★★★ THE CONFOUND THAT BIT ON THIS CASE'S FIRST RUN, MADE VISIBLE
        #   INSTEAD OF LEFT TO BE RE-DERIVED. The fixture isolates the PUBLISHED
        #   path but NOT generation: publication_consistency regenerates from the
        #   REAL generator against the REAL tree. With an uncommitted edit
        #   anywhere in the publication set, the fresh artifact carries a FAILED
        #   assertion (n_pass 35/1) while the committed object carries 36/36, so
        #   this sub-assertion reddens for a reason that has nothing to do with
        #   M12's mutation. `A FIXTURE THAT ISOLATES THE OBJECT BUT NOT ITS
        #   PRODUCER IS NOT HERMETIC.` These two numbers name the cause on sight.
        "CONFOUND_WATCH__fresh_n_pass": pc12.get("fresh_n_pass"),
        "CONFOUND_WATCH__published_n_pass": pc12.get("published_n_pass"),
        "CONFOUND_WATCH__IF_THESE_DIFFER": (
            "the real tree was DIRTY when this ran, this sub-assertion is UNREADABLE, and "
            "the case's DOES-NOT-DISCRIMINATE verdict is about the tree, not the mutation. "
            "The scored publication-pair case above exits 1 in that state by design."),
        "WHY_IT_REDDENED": (
            "`git hash-object` of the working file no longer equals `git rev-parse HEAD:<path>`. "
            "It reddened for DIRTINESS, and publication_consistency stayed green for "
            "CURRENTNESS -- the two assertions discriminated in opposite directions on the "
            "same mutation, which is the whole point of the case."),
        "WHY_IT_MATTERS": (
            "R-511 §6.2 -- `THE RECEIPT MUST REFUSE A DIRTY DESK EVEN WHEN THE COMMITTED "
            "OBJECT IS SOUND.` Before this ruling the pair booleans were computed after the "
            "verdict, so this exact state exited 0."),
        "VERDICT": "DISCRIMINATES" if m12_ok else "DOES-NOT-DISCRIMINATE",
        "OK": m12_ok,
    })
    print("[%s] M12_artifact_worktree_DIRTY_commit_CURRENT -> pair RED=%s | "
          "consistency GREEN=%s | others green=%s"
          % ("OK " if m12_ok else "BAD", m12_artifact_red, m12_commit_still_current,
             m12_others_green))

    # ── ⚠️★★★★★ R-511 §6.8 -- M13: IS THE RECEIPT COVERED BY ANYTHING? ──────
    #    PRE-REGISTERED IN AR-534 §2 BEFORE THIS CODE EXISTED. The prediction on
    #    record is that NOTHING reddens, because the receipt has zero executable
    #    consumers. Both outcomes were bound in advance.
    #
    #    ⚠️ THE FALSE PASS THIS CASE IS BUILT TO EXCLUDE: an UNCOMMITTED harness
    #    edit reddens the harness pair -- that is the DIRTY-TREE assertion
    #    firing, NOT the receipt being read. Scoring that colour would repeat
    #    M8's defect one ruling later: `A TEST THAT TURNS RED BEFORE READING THE
    #    MUTATION HAS NOT TESTED THE MUTATION.` So M13 COMMITS its harness
    #    change, and the run is VOID if the harness pair is not GREEN when the
    #    verdict is taken.
    m13fix = _fixture(((ARTIFACT_REL, AUTHORITATIVE_ARTIFACT),
                       (GENERATOR_REL, TARGET),
                       (HARNESS_REL, SELF),
                       (RECEIPT_REL, RECEIPT_PATH)), "_m13_fixture_")

    committed_receipt = json.loads(committed_text(m13fix, RECEIPT_REL) or "{}")
    receipt_harness_blob = committed_receipt.get("PROVENANCE", {}).get("harness_blob")

    hp = m13fix / HARNESS_REL
    hp.write_text(hp.read_text(encoding="utf-8")
                  + "\n# M13: the harness changed AFTER the receipt was committed.\n",
                  encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=m13fix, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "harness changed after receipt"],
                   cwd=m13fix, check=True)

    m13_pairs = publication_pairs(m13fix)
    m13_pc = publication_consistency(m13fix / ARTIFACT_REL, repo_root=m13fix,
                                     read_mode="committed")
    harness_head_now = m13_pairs["pairs"][HARNESS_REL]["head_blob"]
    receipt_is_stale_in_fact = (receipt_harness_blob is not None
                                and receipt_harness_blob != harness_head_now)

    reddened_by = []
    if m13_pairs["ALL_IDENTICAL"] is not True:
        reddened_by.append("PUBLICATION_PATHS_worktree_equal_committed")
    if m13_pc["PUBLISHED_ARTIFACT_IS_CURRENT"] is not True:
        reddened_by.append("PUBLICATION_CONSISTENCY")
    # ★★★★★ THE REMEDY, EVALUATED AGAINST THIS FIXTURE -- which makes M13 its
    #   own red-proof: the case that PROVED the receipt uncovered is the case
    #   that now proves the reader catches it. Same fixture, same mutation.
    m13_rec_prov = json.loads(committed_text(m13fix, RECEIPT_REL) or "{}").get("PROVENANCE", {})
    m13_reader_red = any(
        m13_rec_prov.get("%s_blob" % label) != m13_pairs["pairs"][rel]["head_blob"]
        for label, rel in (("harness", HARNESS_REL), ("generator", GENERATOR_REL),
                           ("artifact", ARTIFACT_REL)))
    if m13_reader_red:
        reddened_by.append("RECEIPT_records_the_CURRENT_publication_blobs")

    # ⚠️★★★★★ THE SECOND VOID CONDITION, AND IT ALREADY FIRED ONCE.
    #   On M13's first run PUBLICATION_CONSISTENCY reddened and the case reported
    #   ALREADY-COVERED -- refuting the pre-registered prediction. It was a
    #   CONFOUND: the real tree was dirty, so the regenerated artifact carried a
    #   failed assertion the committed fixture object did not, and the digests
    #   differed for a reason with nothing to do with the receipt. Had the
    #   prediction been "something reddens", that colour would have CONFIRMED it
    #   and the finding would have been closed wrongly.
    #   `A COLOUR THAT MATCHES YOUR PREDICTION IS THE MOST DANGEROUS COLOUR
    #   THERE IS` -- here the mismatch is the only thing that forced the check.
    # ★★★★★ R-512 §6.2 -- THE GUARD IS NO LONGER COUNT-ONLY.
    #   `EQUAL ASSERTION COUNTS DO NOT PROVE AN UNCONFOUNDED ARTIFACT`: an
    #   identity, a route partition, a closure blob or a deployed-scope value can
    #   move with n_pass unchanged. M13 varies ONLY receipt staleness, so ANY
    #   non-green control state is a confound -- not merely a count mismatch.
    #   The counts are retained BELOW as diagnostics; they are no longer the
    #   validity predicate.
    m13_generation_confounded = (
        m13_pc.get("PUBLISHED_ARTIFACT_IS_CURRENT") is not True
        or m13_pc.get("fresh_digest") != m13_pc.get("published_digest"))

    # THE VOID GUARD -- the pre-registered invalidation condition.
    m13_void = (m13_pairs["pairs"][HARNESS_REL]["IDENTICAL"] is not True
                or m13_generation_confounded)

    # POSITIVE CONTROL: the SAME enumeration, over a deliberately DIRTY harness
    # worktree, MUST redden -- otherwise "nothing reddened" is an unreadable
    # null from a query that can never return anything.
    hp.write_text(hp.read_text(encoding="utf-8") + "\n# uncommitted control edit\n",
                  encoding="utf-8")
    control_pairs = publication_pairs(m13fix)
    control_fired = control_pairs["ALL_IDENTICAL"] is False
    subprocess.run(["git", "checkout", "--", "."], cwd=m13fix, check=False)

    # ── ★★★★★ R-512 §6.1/§6.3/§6.5 -- VERDICT CONTRACT, REPAIRED ───────────
    #    Item 3: HISTORY is split from CURRENT ACCEPTANCE. The pre-remedy
    #    finding is EVIDENCE and is NOT scored in all_ok; the red-proof of the
    #    reader IS scored and requires its target to fire.
    m13_ok = m13_acceptance(m13_void, control_fired, receipt_is_stale_in_fact,
                            m13_reader_red, reddened_by)

    # ★★★★★ ITEM 5 -- PROVE THE VERDICT IS LOAD-BEARING, IN THE ARTIFACT, EVERY
    #   RUN. Re-evaluate the SAME predicate with the reader result SUPPRESSED and
    #   everything else held: fixture validity, the stale-receipt fact and the
    #   positive control all unchanged. It MUST come out False. This is not a
    #   one-off probe -- a verdict whose falsifiability is asserted in prose is
    #   the exact shape R-512 §1 convicted.
    m13_ok_if_reader_suppressed = m13_acceptance(
        m13_void, control_fired, receipt_is_stale_in_fact,
        False, [r for r in reddened_by
                if r != "RECEIPT_records_the_CURRENT_publication_blobs"])
    m13_verdict_is_load_bearing = (m13_ok is True and m13_ok_if_reader_suppressed is False)

    HISTORY.append({
        "case": "M13_HISTORY_receipt_was_uncovered",
        "⚠️_NOT_SCORED": (
            "R-512 §6.3 -- this is RECORDED EVIDENCE, deliberately absent from all_ok and the "
            "exit code. It is history, and history must not be able to pass or fail a run."),
        "WHAT_WAS_FOUND": (
            "At commit 8e0cbbf4, from a clean tree, with both void guards clear and the "
            "positive control firing, RECEIPT_IS_COVERED_BY was EMPTY: the committed receipt "
            "was stale in fact and NOTHING anywhere reddened."),
        "PRE_REGISTERED_IN": "AR-534 §2, written and independently witnessed by the desk at "
                             "08:30:45 (commit 50209273) BEFORE the code existed.",
        "PREDICTION_ON_RECORD": "NOTHING will redden -- the receipt had zero executable "
                                "consumers (filename census: generator 0, harness 1 = its "
                                "own write). The prediction HELD.",
        "WHY_IT_IS_KEPT": (
            "`A DEFECT THAT LEAVES NO TRACE ONCE FIXED IS A DEFECT THE NEXT READER WILL "
            "RE-INTRODUCE.` The remedy makes the live case green; without this record the "
            "reason the reader exists disappears from the artifact."),
        "LAW": "`A RECEIPT NOBODY READS IS A DECORATION.`",
    })

    results.append({
        "case": "M13_READER_catches_committed_stale_receipt",
        "fixture": str(m13fix),
        "WHAT_WAS_MUTATED": "The HARNESS was changed AND COMMITTED after the receipt was "
                            "committed, so the receipt describes a harness that no longer "
                            "exists, while every publication path is clean.",
        "⚠️_WHAT_OK_REQUIRES_NOW": (
            "R-512 §6.1. ALL of: fixture not void · positive control fired · receipt stale in "
            "fact · THE READER ACTUALLY REDDENED · and RECEIPT_IS_COVERED_BY is EXACTLY the "
            "reader. An empty coverage list is a FAILURE, and an extra unrelated red is a "
            "failure too, never supporting evidence. The previous verdict omitted the reader "
            "entirely: deleting the reader outright left OK=True."),
        "receipt_records_harness_blob": receipt_harness_blob,
        "harness_blob_at_HEAD_now": harness_head_now,
        "RECEIPT_IS_STALE_IN_FACT": receipt_is_stale_in_fact,
        "READER_REDDENED": m13_reader_red,
        "RECEIPT_IS_COVERED_BY": reddened_by,
        "VOID_GUARD__harness_pair_green_at_verdict":
            m13_pairs["pairs"][HARNESS_REL]["IDENTICAL"] is True,
        "VOID_GUARD__generation_not_confounded": not m13_generation_confounded,
        "CONFOUND_DIAGNOSTICS": {
            "⚠️_NOT_THE_VALIDITY_PREDICATE": "R-512 §6.2 -- counts are diagnostics only; the "
                                             "guard above tests the full control state.",
            "fresh_n_pass": m13_pc.get("fresh_n_pass"),
            "published_n_pass": m13_pc.get("published_n_pass"),
            "control_publication_consistency_is_CURRENT":
                m13_pc.get("PUBLISHED_ARTIFACT_IS_CURRENT"),
        },
        "POSITIVE_CONTROL__dirty_harness_does_redden": control_fired,
        "★_VERDICT_FALSIFIABILITY": {
            "OK_as_evaluated": m13_ok,
            "OK_if_the_reader_result_were_SUPPRESSED": m13_ok_if_reader_suppressed,
            "VERDICT_IS_LOAD_BEARING": m13_verdict_is_load_bearing,
            "WHAT_THIS_PROVES": (
                "The same acceptance predicate, re-run with only the reader result removed "
                "and every other input held, comes out FALSE. `A RED RESULT RECORDED BESIDE "
                "OK IS NOT LOAD-BEARING UNLESS OK REQUIRES IT` -- this is that requirement, "
                "demonstrated rather than claimed, on every run."),
        },
        "HISTORY_IS_RECORDED_SEPARATELY": "M13_HISTORY_receipt_was_uncovered, in "
                                          "UNSCORED_HISTORY -- see R-512 §6.3.",
        "VERDICT": ("VOID -- dirty or confounded tree" if m13_void else
                    ("DISCRIMINATES" if m13_ok else "DOES-NOT-DISCRIMINATE")),
        "OK": m13_ok and m13_verdict_is_load_bearing,
    })
    print("[%s] M13_READER_catches_committed_stale_receipt -> reader_red=%s | covered_by=%s "
          "| suppressed_gives=%s | void=%s"
          % ("OK " if (m13_ok and m13_verdict_is_load_bearing) else "BAD", m13_reader_red,
             reddened_by or "NOTHING", m13_ok_if_reader_suppressed, m13_void))

    # ── ★★★★★ R-511 §6.1 -- THE PUBLICATION PAIRS, SCORED AS A REAL CASE ────
    #    THIS BLOCK MUST STAY ABOVE `all_ok`. Its whole defect was position:
    #    the identical expression 74 lines lower was a NOTE, because the verdict
    #    had already been taken. `THE ORDER OF COMPUTATION IS PART OF THE
    #    ASSERTION.` Computed once here and reused verbatim by the receipt.
    PUB = publication_pairs()
    pub_ok = PUB["ALL_IDENTICAL"]
    results.append({
        "case": "PUBLICATION_PATHS_worktree_equal_committed",
        "MEMBERSHIP_SET": list(PUBLICATION_PATH_SET),
        "pairs": PUB["pairs"],
        "WHAT_IT_ASSERTS": (
            "Every publication path's WORKING FILE is byte-identical to its committed blob "
            "at HEAD, so this receipt describes what is actually published rather than an "
            "uncommitted desk state."),
        "WHY_IT_IS_A_CASE_AND_NOT_A_NOTE": (
            "R-511 §1. This was computed AFTER `all_ok` and scored nowhere -- it could not "
            "reach the verdict or the exit code. `A BOOLEAN WRITTEN INTO A RECEIPT AFTER "
            "ALL_OK IS DECIDED IS A NOTE, NOT A GATE.`"),
        "⚠️_WHAT_IT_DOES_NOT_ASSERT": (
            "That the COMMITTED artifact is CURRENT -- that is publication_consistency's "
            "job, and M12 proves the two are different questions: a committed object can be "
            "sound while the desk is dirty. `COMMITTED-CONTENT CURRENTNESS AND WORKTREE "
            "CLEANLINESS ARE TWO DIFFERENT ASSERTIONS.`"),
        "VERDICT": "CLEAN" if pub_ok else "DIRTY -- a publication path differs from HEAD",
        "OK": pub_ok,
    })
    print("[%s] PUBLICATION_PATHS_worktree_equal_committed -> ALL_IDENTICAL=%s%s"
          % ("OK " if pub_ok else "BAD", pub_ok,
             "" if pub_ok else "  DIRTY: %s" % [r for r, p in PUB["pairs"].items()
                                                if not p["IDENTICAL"]]))

    # ── ⚠️★★★★★ R-511 §6.8 REMEDY -- THE RECEIPT'S FIRST EXECUTABLE READER ──
    #    M13 answered: the receipt was UNCOVERED. `A RECEIPT NOBODY READS IS A
    #    DECORATION.` This is the reader whose absence M13 proved, and it must
    #    stay ABOVE `all_ok` for the same reason the pair case does.
    #
    #    ⚠️ R-511 §6.8 proposed TWO remedies and I am implementing ONE, with the
    #    reason MEASURED rather than argued. Adding RECEIPT_REL to
    #    PUBLICATION_PATH_SET (worktree == HEAD) CANNOT WORK: the receipt records
    #    `PROVENANCE.head` and `receipt_measurement_commit`, both = HEAD at run
    #    time, so COMMITTING the receipt advances HEAD and the next run writes a
    #    different file. That gate would be RED forever for a structural reason
    #    -- the permanently-red failure R-511 §4 rejected for CI, rebuilt here.
    #    THIS reader converges instead: committing the receipt does not change
    #    the harness, generator or artifact blobs it records, so it goes GREEN on
    #    the next run and stays there until one of them actually changes.
    receipt_raw = committed_text(REPO, RECEIPT_REL)
    if receipt_raw is None:
        rec_ok, rec_detail = False, {"reason": "the receipt is not present in HEAD at all"}
    else:
        rec_prov = json.loads(receipt_raw).get("PROVENANCE", {})
        rec_detail = {}
        for label, rel in (("harness", HARNESS_REL), ("generator", GENERATOR_REL),
                           ("artifact", ARTIFACT_REL)):
            recorded = rec_prov.get("%s_blob" % label)
            current = PUB["pairs"][rel]["head_blob"]
            rec_detail[label] = {"recorded_in_committed_receipt": recorded,
                                 "at_HEAD_now": current, "MATCHES": recorded == current}
        rec_ok = all(v["MATCHES"] for v in rec_detail.values())
    results.append({
        "case": "RECEIPT_records_the_CURRENT_publication_blobs",
        "WHAT_IT_ASSERTS": (
            "The COMMITTED receipt describes the harness, generator and artifact that are at "
            "HEAD right now -- so it is a proof about what is published, not a souvenir of a "
            "tree that no longer exists."),
        "WHY_IT_EXISTS": (
            "R-511 §6.8 + M13. The receipt had ZERO executable consumers: its filename "
            "appeared 0 times in the generator and once in the harness, and that once was its "
            "own write. M13 committed a harness change on top of a committed receipt, left "
            "every assertion green, and NOTHING reddened. This is the reader that closes it."),
        "⚠️_MEANING_OF_RED": (
            "The committed receipt was produced by code that has since changed. Re-run the "
            "harness and commit the regenerated receipt -- do NOT reason from the old one. "
            "This is EXPECTED and self-clearing in the window between committing code and "
            "committing the receipt that describes it."),
        "⚠️_WHY_THE_RECEIPT_IS_NOT_IN_PUBLICATION_PATH_SET": (
            "MEASURED, not argued: the receipt records PROVENANCE.head and "
            "receipt_measurement_commit, both = HEAD at run time. Committing it advances HEAD, "
            "so the next run necessarily writes a different file and a worktree==HEAD gate on "
            "it could never go green. `A GATE THAT CAN NEVER BE GREEN TRAINS EVERY READER TO "
            "IGNORE IT` -- R-511 §4's own reason for refusing the hosted CI design."),
        "detail": rec_detail,
        "VERDICT": "CURRENT" if rec_ok else "STALE -- the committed receipt describes older code",
        "OK": rec_ok,
    })
    print("[%s] RECEIPT_records_the_CURRENT_publication_blobs -> %s"
          % ("OK " if rec_ok else "BAD",
             "CURRENT" if rec_ok else "STALE: %s"
             % [k for k, v in rec_detail.items() if not v.get("MATCHES")]))

    # ── ★★★★★ R-512 §6.4 -- THE PER-CASE ATTRIBUTION CENSUS ────────────────
    #    `A HARNESS THAT CANNOT SAY WHICH OF ITS VERDICTS ARE ATTRIBUTED CANNOT
    #    BE AUDITED FOR THIS DEFECT AGAIN.` For every case: does its OK predicate
    #    require (i) a colour, (ii) an attributable CAUSE, (iii) its specific
    #    target?
    #    ⚠️ This table is hand-authored -- it describes predicates, which no
    #    machine can read off a result dict. So it is made NON-DRIFTING instead:
    #    the scored case below fails if the census and the actual case list ever
    #    disagree, which is the only way a hand-authored table stays honest.
    census = {
        "CONTROL_unmutated": ("colour+target",
                              "requires exit 0 AND every assertion green -- no cause to "
                              "attribute, because nothing was mutated."),
        "M9_committed_artifact_STALE_worktree_FRESH": (
            "target, BOTH DIRECTIONS",
            "requires the OLD reader to be BLIND and the NEW one to CATCH. A one-direction "
            "pass is not accepted."),
        "M10_identity_block_silently_altered": (
            "colour+cause", "R-512 §6.4 SWEEP -- now requires digest attribution, not the "
                            "bare NOT-CURRENT colour."),
        "M11_source_closure_identity_altered": (
            "colour+cause", "R-512 §6.4 SWEEP -- same conjunct, added in the same wave."),
        "M8_stale_artifact_COMMITTED_in_fixture": (
            "colour+cause+target",
            "the original attributed case (R-510 §6.1): RED, attributable to a digest "
            "mismatch, AND it read the planted n_pass back."),
        "M8b_unpublishable_path": (
            "colour", "DELIBERATE. This case exists to prove the fail-closed PATH behaviour; "
                      "it is explicitly NOT a stale-content proof and says so in its record."),
        "PUBLICATION_CONSISTENCY_live": (
            "colour", "a live status observation, not a mutation."),
        "M12_artifact_worktree_DIRTY_commit_CURRENT": (
            "colour+cause+target",
            "requires the artifact pair RED, the other two pairs GREEN, consistency GREEN and "
            "a clean starting fixture -- it discriminates in both directions."),
        "M13_READER_catches_committed_stale_receipt": (
            "colour+cause+target+FALSIFIABILITY",
            "R-512 §6.1 -- requires the reader itself to redden, the coverage list to be "
            "EXACTLY the reader, and the same predicate to come out FALSE when the reader "
            "result is suppressed."),
        "PUBLICATION_PATHS_worktree_equal_committed": (
            "colour+target", "every publication path's worktree blob must equal its HEAD blob; "
                             "red-proofed by M12 and by live dirty-tree runs."),
        "RECEIPT_records_the_CURRENT_publication_blobs": (
            "colour+target", "the committed receipt's three recorded blobs must equal HEAD; "
                             "red-proofed live at e5a0e695 and green at f5350c09."),
        "ATTRIBUTION_CENSUS_covers_every_scored_case": (
            "target", "self-referential by necessity: it asserts its own coverage."),
    }
    for name, _m, _r, _g in CASES:
        census[name] = ("colour+target",
                        "generator mutation: requires the NAMED assertion to redden, a "
                        "non-zero exit, and no collateral contract breach.")
    scored = {r["case"] for r in results} | {"ATTRIBUTION_CENSUS_covers_every_scored_case"}
    missing, extra = sorted(scored - set(census)), sorted(set(census) - scored)
    census_ok = not missing and not extra
    results.append({
        "case": "ATTRIBUTION_CENSUS_covers_every_scored_case",
        "WHAT_IT_ASSERTS": "every scored case has a census entry and the census names no case "
                           "that does not exist.",
        "WHY": ("R-512 §6.4. The census is hand-authored because it describes PREDICATES, "
                "which cannot be read off a result dict. A hand-authored table drifts -- so "
                "drift is made a RED here rather than left to a future reader to notice."),
        "cases_missing_from_census": missing,
        "census_entries_with_no_case": extra,
        "VERDICT": "COVERED" if census_ok else "DRIFTED",
        "OK": census_ok,
    })
    print("[%s] ATTRIBUTION_CENSUS_covers_every_scored_case -> missing=%s extra=%s"
          % ("OK " if census_ok else "BAD", missing, extra))

    all_ok = all(r["OK"] for r in results)
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
        # ── R-507 §6.11 + R-510 §6.3/§6.5 -- this receipt's own provenance ───
        "PROVENANCE": {
            "head": git("rev-parse", "HEAD"),
            "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
            # ★ R-510 §6.3 -- blobs come from HEAD:<path>, with the worktree
            #   value kept beside them and the pair ASSERTED equal.
            #   ★★★★★ R-511 §6.1 -- AND THAT ASSERTION IS NOW REAL. Until this
            #   ruling the comment below said "a dirty publication path is RED"
            #   while the boolean was computed after the verdict and scored
            #   nowhere; AR-532 §3 published that caption and R-511 §1 convicted
            #   it. The gate is the SCORED CASE
            #   `PUBLICATION_PATHS_worktree_equal_committed` in `cases`, and
            #   these fields are the SAME dict it was scored from -- reported
            #   here, decided there. `A PASTED HEAD-BLOB COMPARISON IS NOT AN
            #   EXECUTABLE HEAD-BLOB ASSERTION.`
            "harness_blob": PUB["pairs"][HARNESS_REL]["head_blob"],
            "generator_blob": PUB["pairs"][GENERATOR_REL]["head_blob"],
            "artifact_blob": PUB["pairs"][ARTIFACT_REL]["head_blob"],
            "PUBLICATION_PATH_BLOBS": {
                "artifact": PUB["pairs"][ARTIFACT_REL],
                "generator": PUB["pairs"][GENERATOR_REL],
                "harness": PUB["pairs"][HARNESS_REL],
                "⚠️_NOT_A_GATE_HERE__SCORED_AS_A_CASE": (
                    "This block is a RECORD. The GATE is the case named "
                    "`PUBLICATION_PATHS_worktree_equal_committed`, computed BEFORE `all_ok` "
                    "and carried into ALL_CASES_DISCRIMINATE and the exit code. Both read the "
                    "same computed dict, so the record and the gate cannot disagree -- which "
                    "is why the old `ALL_CLEAN` key is gone rather than merely re-worded."),
                "MEANING_OF_A_FALSE_PAIR": "a publication path is DIRTY -- the receipt would "
                                           "be describing something other than what is "
                                           "committed, and the run now exits non-zero.",
            },
            # ── R-510 §6.5 -- the three identities, by name ──────────────────
            "PUBLICATION_IDENTITIES": {
                "measurement_source_commit": {
                    # ★★★ R-511 §6.3 -- read from the COMMITTED artifact via
                    #   `git show HEAD:<path>`, not from the working file. The
                    #   receipt describes what is PUBLISHED; sourcing this from
                    #   the worktree let an uncommitted desk edit put a value in
                    #   the receipt that no published object ever carried.
                    "value": (json.loads(committed_text(REPO, ARTIFACT_REL) or "{}")
                              .get("PUBLICATION_IDENTITIES", {})
                              .get("measurement_source_commit", {}).get("value")),
                    "definition": "HEAD of the campaign tree when the MEASUREMENT ran; taken "
                                  "from the COMMITTED artifact (`git show HEAD:<path>`), not "
                                  "from the working file and not re-derived here.",
                    "read_through": "git show HEAD:%s" % ARTIFACT_REL},
                "artifact_publication_commit": {
                    "value": git("log", "-1", "--format=%H", "--", ARTIFACT_REL),
                    "definition": "The commit that last published the artifact. Knowable here "
                                  "because the artifact is already committed."},
                "receipt_measurement_commit": {
                    "value": git("rev-parse", "HEAD"),
                    "definition": "HEAD when THIS receipt was produced."},
                "⚠️_NOT_SELF_CERTIFIABLE": (
                    "This receipt cannot name its OWN publication commit -- that commit does "
                    "not exist until the receipt is committed. R-510 §6.5 leaves it to the "
                    "external read or CI, and it is deliberately absent rather than guessed."),
            },
            "reproduce": ("python docs/replay-results/h1-battery/"
                          "session_role_resolver_yield_REDPROOF.py"),
            "NOTE": "Mutated runs write their artifact to a throwaway temp path, so no "
                    "mutation can overwrite the real artifact.",
        },
        "ALL_CASES_DISCRIMINATE": all_ok,
        # ★★★★★ R-512 §6.4 -- the attribution census, IN the receipt.
        "ATTRIBUTION_CENSUS": {
            "⚠️_HOW_TO_READ": ("per case: what its OK predicate REQUIRES. `colour` = a red/green "
                              "flag only · `cause` = the red must be attributable (a digest "
                              "mismatch, not a digest-free early return) · `target` = the "
                              "specific thing under test must be what reddened."),
            "LAW": ("`A HARNESS THAT CANNOT SAY WHICH OF ITS VERDICTS ARE ATTRIBUTED CANNOT BE "
                    "AUDITED FOR THIS DEFECT AGAIN.` R-512 §6.4."),
            "cases": {k: {"OK_requires": v[0], "note": v[1]} for k, v in sorted(census.items())},
        },
        "UNSCORED_HISTORY": HISTORY,
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
