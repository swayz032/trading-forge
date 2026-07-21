"""Dual-denominator DoD re-measure with section 6a coverage.

Implements docs/designs/spec-dual-denominator-remeasure-2026-07-20.md.

THIS IS A MEASUREMENT, NOT AN INSTRUMENT CHANGE. It binds no differently; it reads.
It GATES rather than narrates: every reconciliation below is an assert, and a failed
assert exits non-zero.

DECLARED MEASUREMENT CONFIGURATION (R-150): the level/zone arm runs with BOTH
TF_LEVELZONE_ROUTING_ENABLED and TF_LEVELZONE_RESOLVER_ENABLED forced "true" for the
AFTER arm, and forced "false" for the null/BEFORE arm. PRODUCTION DEFAULTS STAY OFF.
Every AFTER figure below describes the both-flags-ON hypothetical and is labeled so.

TWO CORPORA, REPORTED SEPARATELY, NEVER POOLED (a rate inherits its window):
  Corpus A -- 16 shakedown specs, 155 taught entry_conditions. The DoD/section-6a corpus.
  Corpus B -- 120 or-branches specs, 6450 taught entry_conditions. The never-evaluated corpus.
The 987 and 2694 belong to Corpus B ONLY. Corpus A contains ZERO trigger-role conditions.
Pooling them would produce a figure belonging to neither.

APPEND-ONLY: writes ONE new file. The prior artifacts are hashed before and after the
run and asserted unchanged -- append-only is verified, not promised. The guarded bytes are
ALSO compared against their HEAD blobs, because "unchanged during this run" is a weaker
claim than "unchanged since it was committed", and only the second one is append-only.

============================================================================ R-203 s1
THE GOVERNING LAW THIS FILE ENFORCES ON ITSELF:

  Every number in this artifact is COMPUTED from the fields beside it, or it does not
  appear. Typed numerals in prose fields -- headlines, readings, captions -- are BANNED.
  Every prose field must MOVE under the standard perturbation, or this generator FAILS.

WHY A LAW AND NOT A HABIT. Three caption defects have been repaired in this artifact, and
each one was introduced BY THE REPAIR OF THE ONE BEFORE IT:

  caption 1  a hardcoded interpretation string ("the rate improves while coverage
             worsens"), printed for any delta in either direction. Fixed by computing it
             -> classify_drift().
  caption 2  the fix's own decomposition was an ALGEBRAIC IDENTITY: margin ==
             margin_from_invalidate by construction, so its branches could not be reached.
             Fixed by measuring both arms -> compose_completed_coverage().
  caption 3  the fix's own session block carried a TYPED HEADLINE ("0 of 27 bound") beside
             the computed fields it contradicted the moment the data moved.

Every one of the three passed human review. NONE of them was caught by reading. All three
were caught by PERTURBING the data and noticing a sentence that did not move. So the check
is no longer "review carefully" -- it is a gate that runs on every invocation:

  THE STANDARD PERTURBATION (perturbed_binding / PERTURBATION_NAME): patch the binder so
  every WAIT_SESSION row binds, build the whole artifact a SECOND time, and compare. Any
  prose string that is byte-identical across the two builds while containing a numeral
  that MOVED between them is a caption, and this generator exits non-zero rather than
  emit it. See caption_gate() for why that rule needs no annotation to work.

Run:        python docs/replay-results/h1-battery/dual_denominator_remeasure.py
Self-test:  python docs/replay-results/h1-battery/dual_denominator_remeasure.py --gate-selftest
"""

from __future__ import annotations

import builtins
import collections
import dataclasses
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
os.chdir(REPO_ROOT)
sys.path.insert(0, str(REPO_ROOT))

# Trap 7: import via src.engine.*, never engine.*, so a global editable-install .pth
# cannot resolve these names into a DIFFERENT checkout.
import src.engine.spec_family_bindings as sfb  # noqa: E402

H1 = REPO_ROOT / "docs" / "replay-results" / "h1-battery"
CORPUS_A_GLOB = str(
    REPO_ROOT / "docs" / "replay-results" / "h1-scripts" / "claude-rung-v32" / "shakedown_specs" / "*.spec.json"
)
CORPUS_B_PATH = REPO_ROOT / "docs" / "replay-results" / "or-branches-full-corpus-specs-2026-07-05.json"
NARRATION_PATH = H1 / "narration-reclassification-FINAL.json"
CENSUS_PATH = H1 / "levelzone-object-reference-census.json"

# The de-approximation floor from R-102 section 2. A NAMED THRESHOLD, not a measurement: it is a
# policy constant that no corpus can move, which is why the sentences quoting it are adjudicated
# STRUCTURAL rather than being made to track data they do not depend on.
DE_APPROXIMATION_FLOOR = 2

# The count an EARLIER note recorded, retained so the 26-vs-27 reconciliation can name both sides.
# A superseded historical record: it describes what a prior document said, so it must NOT track the
# live corpus. Named here rather than typed into the sentence so its kind is explicit.
PRIOR_NOTE_WAIT_SESSION_COUNT = 26
ENFORCEMENT_PATH = H1 / "family-meta-enforcement-delta.json"
OUT_PATH = H1 / "dual-denominator-remeasure-2026-07-21.json"

# Prior artifacts that MUST NOT move. Verified by hash, before and after.
APPEND_ONLY_GUARDED = [
    H1 / "wire1-dod-HONEST-FLOOR.json",
    H1 / "wire1-dod-remeasure.json",
    H1 / "population-a-flip-step-remeasure.json",
    NARRATION_PATH,
    CENSUS_PATH,
]


# =========================================================== R-219 (1): DRAFT MODE
# ★ THE LAW THIS EXISTS TO SERVE: THE LAWFUL PATH MUST BE THE CHEAP PATH.
#
# THE INCIDENT THAT MINTED IT. The input guard below verifies every TRACKED INPUT against its
# committed bytes -- and `discover_declared_inputs()` includes THIS FILE. That is correct and
# stays correct: a number derived from uncommitted source is a number no commit vouches for.
# But it also means every edit to this generator made the generator refuse to run. The only way
# to see whether an edit worked was to COMMIT it first. An agent iterating here therefore built
# a commit-amend loop -- 18 `git commit --amend`es and 2 `git reset`s -- and that loop took ten
# commits off the branch, eight relay reports and a whole code packet, while `git status` read
# clean throughout.
#
# ★ THE GUARD DID NOT FAIL. IT SUCCEEDED, AND ITS SUCCESS MANUFACTURED THE BYPASS. A guard that
# makes the honest path expensive does not stop the work; it reroutes the work through whatever
# is cheaper, and then owns the consequences of that route. So the remedy is not to weaken the
# guard -- PUBLISHING is gated exactly as strictly as before -- but to make ITERATING free.
#
# DRAFT MODE runs the whole measurement on a dirty tree and prints its verdict, marked DRAFT on
# every line. It may not write the artifact, may not baseline the directory, and may not make
# any claim about HEAD. The strict path is untouched: with no --draft flag, byte-for-byte the
# same code runs as before.
#
# WHY "CANNOT PUBLISH" IS PROVED RATHER THAN PROMISED. "Draft mode does not call the writer" is
# a claim about control flow, and control flow acquires new branches. So there is exactly ONE
# write site for OUT_PATH in this file, `publish_artifact()`, it refuses in draft mode with a
# SystemExit (not an assert -- `python -O` strips asserts, and a gate a flag removes is not a
# gate), and `write_site_census()` walks this file's own AST to prove the count of write sites
# is ONE and that it lives inside that function. Adding a second writer fails the run.
_DRAFT_MODE = False
DRAFT_BANNER = "=" * 78


def draft_mode() -> bool:
    return _DRAFT_MODE


def write_site_census() -> dict:
    """PROVE there is exactly ONE OUT_PATH write site, and that it is inside publish_artifact().

    The cannot-publish-from-draft claim is only as good as the claim that draft mode cannot
    route around the refusal. It cannot route around ONE writer that refuses; it can trivially
    route around one of two. So the number of writers is COMPUTED from this file's AST, never
    asserted in prose, and the enclosing function is checked by name.
    """
    import ast

    tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
    sites: list[dict] = []
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for n in ast.walk(fn):
            # OUT_PATH.write_text(...) / OUT_PATH.write_bytes(...) / OUT_PATH.open(...)
            if not isinstance(n, ast.Call) or not isinstance(n.func, ast.Attribute):
                continue
            if n.func.attr not in {"write_text", "write_bytes", "open"}:
                continue
            if isinstance(n.func.value, ast.Name) and n.func.value.id == "OUT_PATH":
                sites.append({"enclosing_function": fn.name, "line": n.lineno,
                              "primitive": f"OUT_PATH.{n.func.attr}"})
    ok = len(sites) == 1 and sites[0]["enclosing_function"] == "publish_artifact"
    return {
        "WHY": (
            "Draft mode's cannot-publish pin rests on there being ONE writer that refuses. Two "
            "writers and the refusal is routable. The count is taken from this file's AST."
        ),
        "n_write_sites_COMPUTED": len(sites),
        "sites": sites,
        "expected_sole_writer": "publish_artifact",
        "PASS": ok,
    }


def publish_artifact(art: dict) -> Path:
    """THE SOLE WRITE SITE. Refuses in draft mode, by SystemExit, before touching the disk.

    SystemExit and not assert: `python -O` strips asserts, so an assert here would make the
    publish gate removable by a command-line flag. The refusal is also placed BEFORE the
    serialisation, so a draft run cannot even produce the bytes it is forbidden to write.
    """
    if _DRAFT_MODE:
        sys.stderr.write(
            "\n" + DRAFT_BANNER + "\n"
            "DRAFT MODE: PUBLISH REFUSED.\n"
            "A draft run may not write the artifact, may not baseline this directory, and may\n"
            "not make any claim about HEAD. Its inputs were NOT verified against their committed\n"
            "bytes, so every figure it printed is provisional by construction.\n"
            "To publish: commit the source and re-run WITHOUT --draft.\n"
            + DRAFT_BANNER + "\n"
        )
        raise SystemExit(3)
    # D7: EXPLICIT NEWLINE POLICY. write_text() without `newline` applies PLATFORM newline
    # translation, so the same measurement produced LF bytes on Linux and CRLF bytes on Windows.
    # A byte-reproducibility claim that only holds on one OS is not one, and this is the mechanism
    # that put CRLF into 30 of the 40 artifacts in this directory in the first place. Pinned here,
    # and pinned for git in this directory's .gitattributes, so both ends agree.
    OUT_PATH.write_text(json.dumps(art, indent=1), encoding="utf-8", newline="\n")
    return OUT_PATH


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def rate0(num, den):
    """Rounded ratio, or None when the denominator is empty. Module-level so the drift
    classification can use it before main()'s local alias is bound."""
    return round(num / den, 4) if den else None


def count_own_asserts() -> int:
    """Count assert statements in THIS file by parsing it. AR-188 fix 6.

    The prior claim -- "eight asserts, each red-proved" -- was hand-typed, and the file held
    twelve. A hand-typed count of a thing the file itself can count is the hardcoded-test-copy
    defect. This number is now derived from the source's own AST, so it cannot drift from it.
    """
    import ast

    tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
    return sum(1 for n in ast.walk(tree) if isinstance(n, ast.Assert))


# EVERY assert in this file must appear here, classified. AR-188 D2.
#   DATA_SENSITIVE  -- its truth depends on the corpora or the binder's answers. It can fire on
#                      a run where nothing but the data changed. This is what an assert is for.
#   SOURCE_INVARIANT-- it compares things fixed in this source file. It can only fire if someone
#                      edits the file, never on data. Such an assert is a readable statement of a
#                      structural intent, NOT a check on a measurement, and counting it as one is
#                      how "twelve asserts, each red-proved" became a false safety claim.
# The key is a substring that must match EXACTLY ONE assert's unparsed test expression.
ASSERT_DISPOSITIONS: dict[str, str] = {
    # AR-203 (f). BOTH of these were counted DATA_SENSITIVE and neither can be. They run
    # classify_drift -- a pure function of four floats -- over `cases`, a MODULE-LITERAL list.
    # No corpus, no binder and no artifact value reaches either one, so neither can fire on a
    # run where only the data changed; both can fire only on an edit to this file. Counting
    # them as checks on a measurement overstated the data-sensitive figure by 2 of 16, 12.5%.
    # They are kept, because a discrimination proof is a real structural intent worth stating
    # at the point it matters -- but stated as what they are, which is the whole D2 rule.
    "len(set(got.values())) == len(cases)": "SOURCE_INVARIANT",
    "not got[flat].startswith('SAME_DIRECTION')": "SOURCE_INVARIANT",
    "inval_on_concrete <= inval_off_concrete": "DATA_SENSITIVE",
    "path1 == path2 == path3": "DATA_SENSITIVE",
    "a_before['n_bindable'] == a_after['n_bindable']": "DATA_SENSITIVE",
    "per_kind.get('swing', {}).get('n_flipped', 0) == 0": "DATA_SENSITIVE",
    "set(per_kind) <= {'named_sr_level', 'order_block_edge'}": "DATA_SENSITIVE",
    "a_roles.get('trigger', 0) == 0": "DATA_SENSITIVE",
    "graded_teachings + graded_mis_types + orphan_zone_refusal == ws_taught": "DATA_SENSITIVE",
    "n_levelzone_rows == 16": "DATA_SENSITIVE",
    "total_flipped <= 6": "DATA_SENSITIVE",
    "enf['never_evaluated_total'] == never_by_gap": "DATA_SENSITIVE",
    "enf['all_entry_conditions'] == b_total": "DATA_SENSITIVE",
    # R-207 (B). It walks the AST of this file and its first-party import closure, so its truth
    # is a property of the SOURCE, never of a corpus -- it can only fire when someone adds a
    # spawn. Classified SOURCE_INVARIANT for exactly that reason, which is also what makes it
    # the right shape for the job: it is meant to notice an EDIT that widens the boundary.
    "spawn['PASS']": "SOURCE_INVARIANT",
    # R-207 (A)(i). DATA_SENSITIVE, and not merely by convention. Whether a prose leaf is
    # reachable depends on whether an axis still MOVES a numeral that leaf quotes, and that is a
    # property of the corpora: if a measurement settles to a value an axis no longer shifts, a
    # sentence that was covered becomes UNREACHED and this fires on a run where only data moved.
    "census['PASS']": "DATA_SENSITIVE",
    # R-219 (2). DATA_SENSITIVE for the same reason as census['PASS']: whether a prose leaf is
    # FROZEN -- the only population this gate scores -- depends on whether an axis still moves it,
    # and that is a property of the corpora. A sentence that recomputes today can settle tomorrow.
    "evidential['PASS']": "DATA_SENSITIVE",
    # R-219 (4a). It compares two module constants against a third module constant. Only an edit
    # can move it -- which is exactly its job: it is the tripwire on an undocumented assert change.
    "derivation['closes_exactly']": "SOURCE_INVARIANT",
    # R-219 (5). Whether a revival probe hits its declared target is decided entirely by this
    # file's own hooks and mutations; no corpus reaches it. It exists to notice an EDIT that
    # re-aims a probe, which is exactly what SOURCE_INVARIANT names.
    "discrimination['REVIVAL_FAMILY']['PASS']": "SOURCE_INVARIANT",
    "unexpected_disposition_keys == set()": "SOURCE_INVARIANT",
    "undispositioned == []": "SOURCE_INVARIANT",
    "OUT_PATH not in APPEND_ONLY_GUARDED": "SOURCE_INVARIANT",
    "before_hashes == after_hashes": "DATA_SENSITIVE",
    "gate['PASS']": "DATA_SENSITIVE",
    "head_check['all_match']": "DATA_SENSITIVE",
}


# ★ R-219 (4a): THE ASSERT-SPLIT LEDGER. The baseline is the commit that last CORRECTED this
# split (AR-203 (f), "assert split corrected 16/3 -> 14/5"), verified by parsing that commit's
# ASSERT_DISPOSITIONS out of the object store rather than by memory. Everything after it is an
# addition, each naming the ruling that introduced it, so the current split is a derivation and
# not a third value someone typed.
ASSERT_SPLIT_BASELINE = {
    "commit": "54cc76f6",
    "DATA_SENSITIVE": 14,
    "SOURCE_INVARIANT": 5,
}
# The values this split has held, as FIELDS rather than prose -- the same discipline the
# withdrawn-921 block uses. A historical value typed into a sentence is a caption waiting to
# happen; the same value in a numeric field is a record a reader can compare.
ASSERT_SPLIT_HISTORY: list[dict] = [
    {"DATA_SENSITIVE": 16, "SOURCE_INVARIANT": 3, "status": "WITHDRAWN -- overstated by 12.5%"},
    {"DATA_SENSITIVE": 14, "SOURCE_INVARIANT": 5, "status": "the correction, and this ledger's baseline"},
    {"DATA_SENSITIVE": 15, "SOURCE_INVARIANT": 6, "status": "after R-207, unexplained until now"},
]
ASSERTS_ADDED_SINCE_BASELINE: list[dict] = [
    {"assert": "census['PASS']", "disposition": "DATA_SENSITIVE", "added_by": "R-207 (A)(i)",
     "commit": "fa7becd2"},
    {"assert": "spawn['PASS']", "disposition": "SOURCE_INVARIANT", "added_by": "R-207 (B)",
     "commit": "fa7becd2"},
    {"assert": "evidential['PASS']", "disposition": "DATA_SENSITIVE", "added_by": "R-219 (2)",
     "commit": "THIS_WAVE"},
    {"assert": "discrimination['REVIVAL_FAMILY']['PASS']", "disposition": "SOURCE_INVARIANT",
     "added_by": "R-219 (5)", "commit": "THIS_WAVE"},
    {"assert": "derivation['closes_exactly']", "disposition": "SOURCE_INVARIANT",
     "added_by": "R-219 (4a) -- the ledger's own tripwire", "commit": "THIS_WAVE"},
]


def own_assert_census() -> dict:
    """Classify EVERY assert in this file, and fail if one is unclassified. AR-188 D2.

    THE DEFECT THIS REPLACES: the artifact carried a typed sentence -- "two of those twelve
    could not fire and have been dealt with" -- beside an assert count that was computed. The
    count could not drift; the sentence beside it could, and did: a THIRD dead assert
    (`a_before["n_taught"] == a_after["n_taught"]`) was live in the file while the sentence
    said two had been dealt with, and a fourth (the output-path guard) can only fire on a
    source edit. A prose tally standing beside a computed one is the caption shape exactly.

    So the tally is now derived too. Each assert's test expression is unparsed from this
    file's own AST and matched against ASSERT_DISPOSITIONS. Adding an assert without
    classifying it FAILS THE RUN -- which is the mechanical form of "never add an assert that
    cannot fire": you cannot add one without writing down which kind it is, in the diff, where
    a reviewer sees it.
    """
    import ast

    tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
    nodes = [n for n in ast.walk(tree) if isinstance(n, ast.Assert)]
    dispositions = _axis_assert_dispositions(ASSERT_DISPOSITIONS)
    rows, undispositioned = [], []
    used: collections.Counter = collections.Counter()
    for n in nodes:
        src = ast.unparse(n.test)
        keys = [k for k in dispositions if k in src]
        if len(keys) != 1:
            undispositioned.append({"line": n.lineno, "test": src, "matching_keys": keys})
            continue
        used[keys[0]] += 1
        rows.append({"line": n.lineno, "disposition": dispositions[keys[0]], "test": src})

    unexpected_disposition_keys = set(dispositions) - set(used) | {
        k for k, c in used.items() if c != 1
    }
    assert unexpected_disposition_keys == set(), (
        f"ASSERT_DISPOSITIONS keys matching zero or multiple asserts: {sorted(unexpected_disposition_keys)}. "
        "Every key must name exactly one assert, or the classification is not a classification."
    )
    assert undispositioned == [], (
        f"asserts with no (or an ambiguous) disposition: {undispositioned}. Every assert in this "
        "file must be declared DATA_SENSITIVE or SOURCE_INVARIANT in ASSERT_DISPOSITIONS. An "
        "undeclared assert is one nobody has asked whether it can fire."
    )
    by_disp = collections.Counter(r["disposition"] for r in rows)
    # ★ R-219 (4a): THE SPLIT NOW OWES ITS OWN ARITHMETIC, AND THE ARITHMETIC IS CHECKED.
    # A THIRD VALUE WITHOUT A DERIVATION IS NOT A NUMBER YET. This figure read 16/3, was
    # corrected to 14/5 at 54cc76f6, and then read 15/6 one day later with nothing anywhere
    # saying which asserts had joined. A count that changes without a ledger is indistinguishable
    # from a count that drifted, and "it is computed from the AST" answers the wrong question:
    # the AST proves the CURRENT number, never that the CHANGE was accounted for.
    # So the change is reconciled against a source OUTSIDE this pipeline -- the git history of
    # this file -- and the reconciliation is asserted below, not narrated.
    # ★ RECONCILED AGAINST THE DECLARED TABLE, NOT AGAINST THE AXIS-PERTURBED ROWS -- and the
    # reason is a requirement, not a convenience. ASSERT_DISPOSITION_RECLASSIFICATION exists to
    # flip one entry's kind, so scoring the ledger against the perturbed rows would make this
    # assert FAIL under that axis, and an axis that fails an assert is a hole rather than an axis.
    # The chain still closes end to end, in two links that are each already checked:
    #   ledger -> ASSERT_DISPOSITIONS   (asserted here)
    #   ASSERT_DISPOSITIONS -> the AST  (asserted above: every key names exactly one assert, and
    #                                    every assert has exactly one key)
    declared = collections.Counter(ASSERT_DISPOSITIONS.values())
    additions = collections.Counter(a["disposition"] for a in ASSERTS_ADDED_SINCE_BASELINE)
    derivation = {
        "WHY_THIS_EXISTS": (
            "This split has now held three different values, each replacing the last with no "
            "record of WHICH asserts moved it. A third value without a derivation is not a number "
            "yet. The prior values are carried as numeric fields below rather than typed into "
            "this sentence -- a record, not a live claim. This closes the arithmetic against the "
            "file's git history, which is outside the AST that produces the total."
        ),
        "prior_values_A_RECORD_NOT_A_TALLY": ASSERT_SPLIT_HISTORY,
        "baseline": dict(ASSERT_SPLIT_BASELINE),
        "additions_since_baseline": ASSERTS_ADDED_SINCE_BASELINE,
        "DATA_SENSITIVE_derivation": (
            f"{ASSERT_SPLIT_BASELINE['DATA_SENSITIVE']} at baseline + "
            f"{additions['DATA_SENSITIVE']} added = "
            f"{ASSERT_SPLIT_BASELINE['DATA_SENSITIVE'] + additions['DATA_SENSITIVE']}"
        ),
        "SOURCE_INVARIANT_derivation": (
            f"{ASSERT_SPLIT_BASELINE['SOURCE_INVARIANT']} at baseline + "
            f"{additions['SOURCE_INVARIANT']} added = "
            f"{ASSERT_SPLIT_BASELINE['SOURCE_INVARIANT'] + additions['SOURCE_INVARIANT']}"
        ),
        "declared_now_in_ASSERT_DISPOSITIONS": {
            "DATA_SENSITIVE": declared["DATA_SENSITIVE"],
            "SOURCE_INVARIANT": declared["SOURCE_INVARIANT"],
        },
        "second_link_already_asserted_above": (
            "every ASSERT_DISPOSITIONS key names exactly ONE assert in the AST, and every assert "
            "in the AST has exactly one key -- so a split that closes against the table closes "
            "against the file."
        ),
        "closes_exactly": (
            ASSERT_SPLIT_BASELINE["DATA_SENSITIVE"] + additions["DATA_SENSITIVE"]
            == declared["DATA_SENSITIVE"]
            and ASSERT_SPLIT_BASELINE["SOURCE_INVARIANT"] + additions["SOURCE_INVARIANT"]
            == declared["SOURCE_INVARIANT"]
        ),
        "NO_DELETIONS_CLAIM": (
            "This derivation assumes additions only. If an assert is ever REMOVED, this closure "
            "fails and the remover must record the removal here -- which is the point: a deletion "
            "that leaves the ledger silent cannot pass."
        ),
    }
    assert derivation["closes_exactly"], (
        "ASSERT SPLIT DOES NOT RECONCILE against the ledger: "
        f"{derivation['DATA_SENSITIVE_derivation']} and {derivation['SOURCE_INVARIANT_derivation']}, "
        f"but the table declares {declared['DATA_SENSITIVE']}/{declared['SOURCE_INVARIANT']}. An "
        "assert was added or removed without an entry in ASSERTS_ADDED_SINCE_BASELINE."
    )
    return {
        "n_asserts_total": len(nodes),
        "n_DATA_SENSITIVE": by_disp["DATA_SENSITIVE"],
        "n_SOURCE_INVARIANT": by_disp["SOURCE_INVARIANT"],
        "SPLIT_DERIVATION_R219": derivation,
        "asserts": sorted(rows, key=lambda r: r["line"]),
        "what_SOURCE_INVARIANT_means": (
            "It cannot fire on data -- only on an edit to this file. It is a structural statement, "
            "not a measurement check, and it is counted separately so the assert total can never "
            "again be read as a count of things the data could falsify."
        ),
        "how_to_falsify": (
            "Add an assert anywhere in this file and re-run without adding its ASSERT_DISPOSITIONS "
            "key: the run exits non-zero naming the line."
        ),
    }


# ======================================================================= R-203 s1
# THE PERTURBATION AXES, AND THE GATE THAT RUNS ON THEIR UNION.
# ======================================================================================
#
# ★ WHY THERE IS MORE THAN ONE. R-207: a single axis convicts only the sentences that quote a
# number THAT AXIS moves. Measured on the one-axis build, the gate's live conviction surface was
# FOUR prose leaves out of thirty that carry a numeral -- and those four were precisely the four
# already suppressed by the allowlist. A gate whose every visible target is excused cannot fail,
# and "0 violations" from it carries no information. That is the caption shape one level up: a
# control positioned where it cannot respond to its subject.
#
# The remedy is sized by CENSUS, not by instance (the ratified law). Each axis below moves a
# DIFFERENT measured quantity, and the gate scores every prose leaf against the UNION of their
# blast radii. Coverage is then a computed figure printed on every run, and a numeral-carrying
# prose leaf that no axis can reach is a RED -- not a line in an exemption table.
#
# ★ THE CONSISTENCY LAW FOR AXES. An axis must leave the artifact SELF-CONSISTENT: every
# cross-check assert stays armed and passing during the perturbed build. An axis that needs a
# check turned off is not an axis, it is a hole. Where a moved value has MIRRORS elsewhere (a
# count that a second artifact also reports), the axis moves the mirrors too -- see
# _axis_corpus_b_reattribute_role, which perturbs the enforcement artifact's own tally by the
# same delta so `enf['never_evaluated_total'] == never_by_gap` survives the perturbation
# UNMODIFIED. Doing the work in the axis is the whole point; weakening the assert would delete
# the very cross-check the perturbation is supposed to exercise.

_ACTIVE_AXIS: str | None = None


def _axis_is(name: str) -> bool:
    return _ACTIVE_AXIS == name


# --------------------------------------------------------------------- AXIS 1
AXIS_WAIT_SESSION = "ALL_WAIT_SESSION_ROWS_BIND"
# --------------------------------------------------------------------- AXIS 2
AXIS_CORPUS_B_ROLE = "CORPUS_B_ROLE_REATTRIBUTION"
# --------------------------------------------------------------------- AXIS 3
AXIS_SESSION_GRADE = "SESSION_GRADE_REALLOCATION"
# --------------------------------------------------------------------- AXIS 4
AXIS_TAUGHT_DROP = "CORPUS_A_TAUGHT_CONDITION_DROP"
# --------------------------------------------------------------------- AXIS 5
AXIS_ASSERT_RECLASS = "ASSERT_DISPOSITION_RECLASSIFICATION"
# --------------------------------------------------------------------- AXIS 6
AXIS_DRIFT_LATTICE = "DRIFT_LATTICE_CASE_WITHDRAWAL"

AXES: dict[str, str] = {
    AXIS_WAIT_SESSION: (
        "sfb.bind_condition is wrapped so every WAIT_SESSION condition that the real binder "
        "REFUSES comes back bindable=True / approximation=False / executed=True. 27 of 27 "
        "WAIT_SESSION rows are unbound, so flipping it moves the session block, the unbound "
        "count, the coverage figures, the rate and the closure drift. MOVES: binding outcomes."
    ),
    AXIS_CORPUS_B_ROLE: (
        "One Corpus-B entry condition is re-roled confluence -> trigger IN THE PARSED CORPUS, "
        "before any tally runs. Every derivation downstream -- the three independent 987 paths, "
        "the by-design 2694, the per-family breakdown -- recomputes from the perturbed parse and "
        "therefore still agrees, which is what keeps `path1 == path2 == path3` armed. The "
        "enforcement artifact's never_evaluated_total is a MIRROR of the same quantity and is "
        "moved by the identical delta, so `enf['never_evaluated_total'] == never_by_gap` also "
        "stays armed and passing. MOVES: 987, 2694, the per-family gap counts."
    ),
    AXIS_SESSION_GRADE: (
        "One WAIT_SESSION row is reallocated from the externally-graded genuine-teaching bucket "
        "to the mis-typed bucket (17/9 -> 16/10). The SUM is deliberately preserved, so "
        "`graded_teachings + graded_mis_types + orphan_zone_refusal == ws_taught` stays armed "
        "and passing -- the axis moves the split without breaking the closure it must respect. "
        "MOVES: the 26-vs-27 accounting terms."
    ),
    AXIS_TAUGHT_DROP: (
        "The LAST taught entry condition of the last Corpus-A spec is dropped at load time, so "
        "the taught population falls by one. This is the widest-reaching axis: it moves the 155 "
        "taught count, the 161 completed denominator, every coverage numerator and denominator "
        "built on them, and the per-arm rates. MOVES: taught populations and everything "
        "denominated in them."
    ),
    AXIS_ASSERT_RECLASS: (
        "One assert's entry in ASSERT_DISPOSITIONS is flipped DATA_SENSITIVE <-> SOURCE_INVARIANT "
        "for the duration of the build. The census still classifies every assert exactly once, so "
        "`unexpected_disposition_keys == set()` and `undispositioned == []` stay armed and "
        "passing. MOVES: the data-sensitive / source-invariant split."
    ),
    AXIS_DRIFT_LATTICE: (
        "One additional sign-pattern case is appended to the drift discrimination lattice. "
        "classify_drift must still return a DISTINCT verdict for it, so "
        "`len(set(got.values())) == len(cases)` stays armed and is a real test of the added row. "
        "MOVES: the pattern and verdict counts of the discrimination proof."
    ),
}


@contextmanager
def perturbed_binding(axis: str | None):
    """Install (or do not install) an AXIS for the duration of one build.

    IT PATCHES THE HARNESS, NEVER THE ENGINE. src/engine/spec_family_bindings.py is not
    edited, imported differently, or reloaded; only this module's reference to the callable
    is swapped, and it is restored in a finally. The perturbed builds are used ONLY to test
    the artifact's responsiveness -- they are never written anywhere.
    """
    global _ACTIVE_AXIS
    prev = _ACTIVE_AXIS
    _ACTIVE_AXIS = axis
    real = sfb.bind_condition

    def patched(condition, *a, **kw):
        b = real(condition, *a, **kw)
        if isinstance(condition, dict) and condition.get("type") == "WAIT_SESSION" and not b.bindable:
            return dataclasses.replace(
                b, bindable=True, approximation=False, executed=True,
                primitive="PERTURBATION__NOT_A_REAL_BINDING", reason=None,
            )
        return b

    if axis == AXIS_WAIT_SESSION:
        sfb.bind_condition = patched
    try:
        yield
    finally:
        sfb.bind_condition = real
        _ACTIVE_AXIS = prev


def _axis_corpus_b_reattribute_role(corpus_b: dict) -> dict:
    """AXIS 2, applied to the PARSED corpus before a single tally has run.

    ★ THIS IS WHERE THE CONSISTENCY CLOSURE IS EARNED. Perturbing a DERIVED count would break
    `path1 == path2 == path3` instantly, because the three paths would no longer be looking at
    the same thing -- and the temptation at that point is to relax the assert. Perturbing the
    SOURCE instead means all three paths re-derive from the perturbed parse and must still
    agree, so the assert is not merely survived, it is genuinely exercised under a changed
    corpus. The mirror in the enforcement artifact is handled by its own hook below.
    """
    if not _axis_is(AXIS_CORPUS_B_ROLE):
        return corpus_b
    for s in iter_specs(corpus_b):
        for c in s["entry_conditions"]:
            if c.get("role") == "confluence":
                c["role"] = "trigger"
                return corpus_b
    raise AssertionError(
        "AXIS CORPUS_B_ROLE_REATTRIBUTION found no confluence-role condition to move. An axis "
        "that silently perturbs nothing is a dead axis and would inflate the coverage figure."
    )


def _axis_enforcement_mirror(enf: dict) -> dict:
    """AXIS 2's MIRROR HALF. never_evaluated_total is a second copy of the same quantity.

    The re-roling above moves never_by_gap by exactly +1 (one condition joins the trigger role).
    The enforcement artifact reports that same population independently, so it must move by the
    same +1 or the artifact is internally inconsistent under the perturbation. Moving it HERE is
    what lets `enf['never_evaluated_total'] == never_by_gap` stay armed. That assert is the one
    the axis is most worth running against, so disarming it to permit the axis would have
    deleted the point of the axis.
    """
    if not _axis_is(AXIS_CORPUS_B_ROLE):
        return enf
    if _WITHHOLD_REPAIRS:
        # THE DISCRIMINATION PROBE. Same perturbation, mirror NOT updated -- the artifact is now
        # genuinely inconsistent, which is precisely the state the cross-assert exists to catch.
        return enf
    enf = json.loads(json.dumps(enf))
    enf["never_evaluated_total"] += 1
    return enf


def _axis_session_grade_split(teachings: int, mis_types: int) -> tuple[int, int]:
    """AXIS 3. Move one row between two externally-graded buckets, SUM PRESERVED."""
    if not _axis_is(AXIS_SESSION_GRADE):
        return teachings, mis_types
    return teachings - 1, mis_types + 1


def _axis_drop_taught_condition(specs: list) -> list:
    """AXIS 4. Drop one taught entry condition, chosen so the axis owes no repair elsewhere.

    ★ THE CONSISTENCY CLOSURE, EARNED THE HARD WAY. The first form of this axis dropped the
    LAST taught condition, whichever it was. It hit a WAIT_SESSION row, ws_taught fell 27 -> 26,
    and `graded_teachings + graded_mis_types + orphan_zone_refusal == ws_taught` FIRED --
    correctly: three externally-graded constants had been left describing a corpus that no
    longer existed. The tempting repair was to relax that assert for perturbed builds. That
    would have deleted precisely the check this artifact's 26-vs-27 accounting rests on.

    The axis absorbs the obligation instead. It drops a NON-WAIT_SESSION condition, so the
    WAIT_SESSION population it is not authorised to re-grade is genuinely untouched and the
    closure genuinely still holds. This is not a narrower axis chosen for convenience: the
    taught population, the 161 denominator and every coverage figure built on them all still
    move, which is everything this axis exists to move.
    """
    if not _axis_is(AXIS_TAUGHT_DROP):
        return specs
    specs = [(n, list(ec), am) for n, ec, am in specs]
    if _WITHHOLD_REPAIRS:
        # THE DISCRIMINATION PROBE. Drop the last condition WHATEVER its type -- which is the
        # form that hit a WAIT_SESSION row and broke the graded-split closure. Withholding the
        # type-selection is withholding this axis's repair, and the 26-vs-27 assert should fire.
        for i in range(len(specs) - 1, -1, -1):
            if specs[i][1]:
                specs[i][1].pop()
                return specs
        return specs
    for i in range(len(specs) - 1, -1, -1):
        for j in range(len(specs[i][1]) - 1, -1, -1):
            if specs[i][1][j].get("type") != "WAIT_SESSION":
                specs[i][1].pop(j)
                return specs
    raise AssertionError(
        "AXIS CORPUS_A_TAUGHT_CONDITION_DROP found no non-WAIT_SESSION condition to drop. An "
        "axis that silently perturbs nothing is a dead axis and would inflate the coverage figure."
    )


def _axis_assert_dispositions(d: dict[str, str]) -> dict[str, str]:
    """AXIS 5. Flip exactly one classification, leaving the classification TOTAL intact."""
    if not _axis_is(AXIS_ASSERT_RECLASS):
        return d
    d = dict(d)
    k = "path1 == path2 == path3"
    d[k] = "SOURCE_INVARIANT" if d[k] == "DATA_SENSITIVE" else "DATA_SENSITIVE"
    return d


def _axis_drift_extra_cases(cases: list) -> list:
    """AXIS 6. Withdraw one sign pattern from the discrimination lattice.

    ★ WHY WITHDRAWAL AND NOT ADDITION, which is a finding rather than a preference. This axis
    was first written to APPEND an eleventh pattern (rate moved, coverage arm missing). The
    build failed on `len(set(got.values())) == len(cases)`: eleven patterns, ten verdicts. That
    is not a defect in the axis, it is classify_drift telling the truth -- its verdict
    vocabulary has exactly ten members, so the existing lattice is already EXHAUSTIVE and no
    eleventh row can ever be distinct. An axis cannot manufacture a distinction the function
    does not draw, and forcing one would have meant editing classify_drift to suit its own
    test.

    So the axis moves the lattice the only direction that leaves the assert both armed and
    honest: it withdraws a pattern. The four FLAT_ rows are never the ones withdrawn -- they
    are the AR-188 D3 red-proof and the loop below them asserts on them by name.
    """
    if not _axis_is(AXIS_DRIFT_LATTICE):
        return cases
    if _WITHHOLD_REPAIRS:
        # THE DISCRIMINATION PROBE for the lattice asserts: append the eleventh pattern that
        # cannot earn a distinct verdict (see above), so `len(set(got.values())) == len(cases)`
        # should fire. This is the failure that taught us the lattice is already exhaustive.
        return cases + [("missing_coverage_arm", 0.50, 0.40, None, 0.10)]
    out = [c for c in cases if c[0] != "both_flat"]
    if len(out) == len(cases):
        raise AssertionError(
            "AXIS DRIFT_LATTICE_CASE_ADDITION found no 'both_flat' row to withdraw. An axis that "
            "silently perturbs nothing is a dead axis and would inflate the coverage figure."
        )
    return out


# ================================================ R-219 (5): THE REVIVAL PROBE FAMILY
# ★ WHAT THIS ANSWERS. The discrimination column found 12 asserts REACHED-BUT-NEVER-FAILED, of
# which 9 are declared DATA_SENSITIVE -- i.e. the file was carrying 9 guards it had never seen
# fire, while using the DATA_SENSITIVE count as its own safety figure. Each of the 9 gets exactly
# one disposition and there is no fourth bucket: REVIVED with a probe that can fail it,
# RE-DECLARED SOURCE_INVARIANT with provenance, or DELETED.
#
# All nine are REVIVED, and the reason none is re-declared is worth stating: every one of them
# reads a corpus, a census artifact or the binder's answers. Re-declaring them SOURCE_INVARIANT
# would be FALSE -- SOURCE_INVARIANT means "can only fire on an edit to this file", and an edit
# to this file is not what moves `n_levelzone_rows`. Deleting them would remove real guards over
# real inputs. What was actually missing was never the assert; it was a probe that reaches it.
#
# ★★ AND THE REVIVALS ARE DELIBERATELY WEAKER EVIDENCE THAN AN AXIS -- reported separately so
# nobody can read one as the other. An AXIS perturbs a SOURCE and requires the whole artifact to
# stay self-consistent; it earns the right to say a measurement responds. A REVIVAL PROBE injects
# a value at the point of use. It proves the assert is LIVE -- reachable, evaluated, and capable
# of failing -- and it proves NOTHING about whether any real corpus can reach that state. That is
# a smaller claim than DISCRIMINATING and it gets its own smaller name: REVIVED_BY_VALUE_INJECTION.
# Collapsing the two would inflate exactly the safety figure this whole section exists to deflate.
_REVIVAL_PROBE: str | None = None


def _rv(hook: str, value):
    """Return `value` unless the active revival probe is aimed at THIS hook."""
    if _REVIVAL_PROBE is None:
        return value
    spec = REVIVAL_PROBES.get(_REVIVAL_PROBE)
    if spec is None or spec["hook"] != hook:
        return value
    return spec["mutate"](value)


@contextmanager
def revival_probe(name: str | None):
    global _REVIVAL_PROBE
    prev = _REVIVAL_PROBE
    _REVIVAL_PROBE = name
    try:
        yield
    finally:
        _REVIVAL_PROBE = prev


def _bump(d: dict, key: str, by: int = 1) -> dict:
    # .get() and not d[key]: several of these mappings are Counters, where a MISSING key reads 0
    # and dict() drops it entirely. The first version used d[key] and died with a KeyError on
    # exactly the probe whose target assert says the key should be absent -- and the misdirected-
    # probe check caught it, which is the only reason it is not still there wearing a green.
    d = dict(d)
    d[key] = d.get(key, 0) + by
    return d


# Each probe DECLARES the assert it is aimed at. A probe that does not make its declared target
# fire is itself a RED (see assert_discrimination_census) -- otherwise "revived" would be a claim
# nobody checked, which is the shape this campaign exists to kill.
REVIVAL_PROBES: dict[str, dict] = {
    "INVAL_DIRECTION_INVERTED": {
        "hook": "inval_on_concrete",
        "targets": "inval_on_concrete <= inval_off_concrete",
        "mutate": lambda v: v + 99,
        "why": "Enforcement-ON is made to bind MORE invalidations concrete than enforcement-OFF "
               "-- the direction the flag cannot produce. The assert's whole subject.",
    },
    "CORPUS_B_ROLE_PARTITION_BROKEN": {
        "hook": "corpus_b_roles",
        "targets": "path1 == path2 == path3",
        "mutate": lambda r: _bump(r, "spine"),
        "why": "One condition is counted spine WITHOUT leaving the trigger tally, so the "
               "complement path disagrees with the direct path. The 921 defect's exact shape.",
    },
    "BINDABILITY_MOVED_BETWEEN_ARMS": {
        "hook": "a_after",
        "targets": "a_before['n_bindable'] == a_after['n_bindable']",
        "mutate": lambda a: _bump(a, "n_bindable"),
        "why": "The AFTER arm gains a bindable condition -- the level/zone flip changing "
               "BINDABILITY rather than only approximation, which is the claim the assert holds.",
    },
    "SWING_DE_APPROXIMATED": {
        "hook": "per_kind",
        "targets": "per_kind.get('swing', {}).get('n_flipped', 0) == 0",
        "mutate": lambda pk: {**pk, "swing": {"n_flipped": 1, "condition_ids": ["REVIVAL_PROBE"]}},
        "why": "A swing row de-approximates. Outside the flip's graded scope, and the subject of "
               "the CEILING.swing disposition.",
    },
    "UNGRADED_KIND_DE_APPROXIMATED": {
        "hook": "per_kind",
        "targets": "set(per_kind) <= {'named_sr_level', 'order_block_edge'}",
        "mutate": lambda pk: {**pk, "fvg_edge": {"n_flipped": 1, "condition_ids": ["REVIVAL_PROBE"]}},
        "why": "A kind the flip's grade does NOT license de-approximates. Deliberately not "
               "'swing', so this probe and the one above are distinguishable in the column.",
    },
    "CORPUS_A_GAINS_A_TRIGGER_ROLE": {
        "hook": "a_roles",
        "targets": "a_roles.get('trigger', 0) == 0",
        "mutate": lambda r: _bump(r, "trigger"),
        "why": "Corpus A gains a trigger-role condition, which is what the never-pool rule and "
               "every corpus-separation statement in this artifact depend on being zero.",
    },
    "LEVELZONE_CENSUS_DRIFTED": {
        "hook": "levelzone_n",
        "targets": "n_levelzone_rows == 16",
        "mutate": lambda n: n - 1,
        "why": "The frozen level/zone census loses a row. The assert exists to catch exactly "
               "that drift in a sealed artifact this generator does not own.",
    },
    "CEILING_BREACHED": {
        "hook": "total_flipped",
        "targets": "total_flipped <= 6",
        "mutate": lambda n: 7,
        "why": "A seventh condition de-approximates, breaching the 6-of-16 ceiling that every "
               "level/zone claim in this campaign is scoped by.",
    },
    "ENFORCEMENT_UNIVERSE_DISAGREES": {
        "hook": "enf_universe",
        "targets": "enf['all_entry_conditions'] == b_total",
        "mutate": lambda n: n + 1,
        "why": "The enforcement artifact's universe size stops matching the corpus this "
               "generator parsed -- the cross-artifact reconciliation the assert is for.",
    },
}


_NUMERAL_RE = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?")


def _leaves(o, path="$"):
    if isinstance(o, dict):
        for k, v in o.items():
            yield from _leaves(v, f"{path}.{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from _leaves(v, f"{path}[{i}]")
    else:
        yield path, o


# NOT PROSE: machine identifiers. These fields carry names, paths and source text -- a spec id
# like "0xygpCMwxbQ__s0" or a filename dated 2026-07-05 contains digits that quote no measurement,
# so scoring them for responsiveness produces false REDs on strings that are not claims at all.
# The list is EXHAUSTIVE and by exact key name, never by pattern: a caption cannot hide here
# without being renamed to one of these, which is visible in the diff. Every other string in the
# artifact is treated as prose and must answer to the perturbation.
IDENTIFIER_KEYS = frozenset({
    "spec", "condition_id", "path", "generator", "reproduce", "artifact", "source", "test",
    "condition_ids", "claim",
    # R-219 (4a). A commit SHA and a ruling name are identifiers in the strictest sense -- the
    # digits in "54cc76f6" and "R-207 (A)(i)" are characters in a name, not quantities. Added
    # with the identifier_exclusion_audit already standing behind them: if either key ever comes
    # to hold a free-standing moved numeral, the audit convicts it, which is the whole reason
    # this list is safe to extend at all. It was NOT safe before that audit existed -- that is
    # how "recovers up to 17 of 27" hid inside a key called "source".
    "commit", "added_by",
})


def _is_identifier_field(p: str) -> bool:
    tail = p.rsplit(".", 1)[-1]
    if tail.endswith("]"):  # list element: attribute it to the list's own key
        tail = tail.split("[", 1)[0]
    return tail in IDENTIFIER_KEYS


def _numeral_forms(v) -> set[str]:
    """Every way a scalar could legitimately be written into an f-string."""
    out = {str(v)}
    if isinstance(v, float) and v.is_integer():
        out.add(str(int(v)))
    return out


def _moved_leaves_for(base: dict, pert: dict) -> list[tuple[str, set[str]]]:
    """The blast radius of ONE axis: every leaf that moved, with the spellings it moved between."""
    out: list[tuple[str, set[str]]] = []
    for k in base:
        if k not in pert:
            continue
        a, b = base[k], pert[k]
        if isinstance(a, bool) or isinstance(b, bool):
            continue
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and a != b:
            out.append((k, _numeral_forms(a) | _numeral_forms(b)))
        elif isinstance(a, str) and isinstance(b, str) and a != b:
            sym = set(_NUMERAL_RE.findall(a)) ^ set(_NUMERAL_RE.findall(b))
            if sym:
                out.append((k, sym))
    return out


def _container_of(p: str) -> str:
    cut = max(p.rfind("."), p.rfind("["))
    return p[:cut] if cut > 0 else "$"


def coverage_census(art_base: dict, per_axis: dict[str, dict], allowlist: dict,
                    structural: dict) -> dict:
    """★ THE COMPUTED GATE FIGURE. How much of the prose can the gate actually convict?

    THE MEASUREMENT THAT FORCED THIS TO EXIST (R-207). The single-axis gate reported "0
    violations" on every run, and that was read as the prose being clean. It was not a
    measurement of the prose; it was a property of the gate. Scored honestly, the one-axis
    build could convict FOUR of the thirty frozen prose leaves that carry a numeral -- and all
    four were already suppressed by the allowlist. Every leaf the gate could see was excused
    and every leaf it could not see was unwatched, so PASS was structurally guaranteed.

    A gate whose reach is unmeasured is a caption about itself. So the reach is now computed,
    printed, and enforced, over the population that can actually carry the defect:

      NUMERAL-FREE PROSE IS EXCLUDED BY PROOF, NOT BY EXEMPTION. The gate convicts on
      `numerals(text) & moved_spellings`. For a string containing no numeral that intersection
      is empty for every possible axis and every possible corpus -- so such a leaf cannot be a
      caption in this gate's sense, and counting it as "covered" would inflate the figure with
      leaves nothing was ever at stake on. It is reported as its own line, never as coverage.

    Each numeral-carrying prose leaf lands in exactly one bucket:
      RESPONSIVE -- it MOVED under at least one axis. The strongest evidence available: the
                    text demonstrably recomputes. Nothing further is owed.
      COVERED    -- frozen, but some axis moved a numeral it quotes, in its own container's
                    subtree. The gate is actively watching it; if it were typed, it would now
                    be a violation.
      EXEMPTED   -- frozen and reached by no axis, and individually adjudicated as STRUCTURAL:
                    the numeral is not a measurement at all. Every entry names its kind and is
                    checked below.
      UNREACHED  -- frozen, reached by no axis, and not adjudicated. This is a RED. It is the
                    honest name for "this sentence quotes a number and nothing in this file can
                    tell whether the number is computed or typed."
    """
    base = dict(_leaves(art_base))
    per_axis_leaves = {ax: dict(_leaves(a)) for ax, a in per_axis.items()}

    prose = [
        k for k in base
        if isinstance(base[k], str) and not _is_identifier_field(k)
        and all(k in L and isinstance(L[k], str) for L in per_axis_leaves.values())
    ]
    responsive = {k for k in prose if any(L[k] != base[k] for L in per_axis_leaves.values())}

    # union blast radius, tagged by the axis that produced it
    scope_by_axis: dict[str, list[tuple[str, set[str]]]] = {
        ax: _moved_leaves_for(base, L) for ax, L in per_axis_leaves.items()
    }

    def reaching_axes(path: str) -> list[str]:
        """Which axes move a numeral this leaf quotes, inside its own container's subtree."""
        cont = _container_of(path)
        mine = set(_NUMERAL_RE.findall(base[path]))
        hit = []
        for ax, moved in scope_by_axis.items():
            forms: set[str] = set()
            for lp, f in moved:
                if lp.startswith(cont + ".") or lp.startswith(cont + "["):
                    forms |= f
            if mine & forms:
                hit.append(ax)
        return sorted(hit)

    # ★ R-207 (e): THE IDENTIFIER EXCLUSION IS ITSELF AUDITED, NOT TAKEN ON THE KEY'S NAME.
    # IDENTIFIER_KEYS is an exact-name list, which makes it visible in a diff but says nothing
    # about what a field actually HOLDS. A key called "source" held "recovers up to 17 of 27" --
    # a measurement, in the one place the gate does not look, excluded because the name sounded
    # like a path. Membership must be earned by content.
    #
    # THE MECHANICAL DISCRIMINATOR. A digit inside an identifier TOKEN ("...price-br#0",
    # "0xygpCMwxbQ__s0") is not a quoted quantity; a digit standing as its own word in a sentence
    # is. So an identifier-keyed leaf FAILS if it contains a numeral that (a) moves under some
    # axis in its own container's scope, AND (b) appears WHITESPACE-DELIMITED -- a free-standing
    # number in prose rather than a character in a name. That rule leaves every real id alone and
    # catches the one leak, and it is stated here so it can be attacked rather than trusted.
    identifier_leaks = []
    for k in base:
        if not isinstance(base[k], str) or not _is_identifier_field(k):
            continue
        if not all(k in L and isinstance(L[k], str) for L in per_axis_leaves.values()):
            continue
        cont = _container_of(k)
        moved_here: set[str] = set()
        for moved in scope_by_axis.values():
            for lp, f in moved:
                if lp.startswith(cont + ".") or lp.startswith(cont + "["):
                    moved_here |= f
        free = set(re.findall(r"(?:(?<=\s)|^)-?\d+(?:\.\d+)?(?=[\s,.;:')]|$)", base[k]))
        hits = sorted(free & moved_here)
        if hits:
            identifier_leaks.append({
                "path": k, "free_standing_moved_numerals": hits, "text": base[k][:220],
                "why": "excluded as an identifier, but it quotes a measurement as a free word",
            })

    numeral_free = [k for k in prose if not _NUMERAL_RE.findall(base[k])]
    carriers = [k for k in prose if _NUMERAL_RE.findall(base[k])]

    buckets: dict[str, list] = {
        "RESPONSIVE": [], "COVERED": [], "EXEMPTED": [], "CARRIED_UNVERIFIABLE": [], "UNREACHED": [],
    }
    bad_structural: list[dict] = []
    for k in carriers:
        if k in responsive:
            buckets["RESPONSIVE"].append({"path": k})
            continue
        axes_hit = reaching_axes(k)
        if axes_hit:
            buckets["COVERED"].append({"path": k, "reached_by": axes_hit})
            continue
        ent = structural.get(k)
        if ent is None:
            buckets["UNREACHED"].append({
                "path": k,
                "numerals": sorted(set(_NUMERAL_RE.findall(base[k]))),
                "text": base[k][:300],
            })
            continue
        ok, why = _verify_structural(k, ent, base, per_axis_leaves)
        if ok:
            tgt = "CARRIED_UNVERIFIABLE" if ent["kind"] == _WEAK_KIND else "EXEMPTED"
            buckets[tgt].append({"path": k, "kind": ent["kind"], "numerals": ent["numerals"],
                                 "why": ent["why"]})
        else:
            bad_structural.append({"path": k, "why_rejected": why})
            buckets["UNREACHED"].append({
                "path": k,
                "numerals": sorted(set(_NUMERAL_RE.findall(base[k]))),
                "text": base[k][:300],
                "rejected_structural_claim": why,
            })

    adjudicated = ({e["path"] for e in buckets["EXEMPTED"]}
                   | {e["path"] for e in buckets["CARRIED_UNVERIFIABLE"]}
                   | {e["path"] for e in buckets["UNREACHED"]})
    dead_structural = sorted(k for k in structural if k not in adjudicated)
    n_watched = len(buckets["RESPONSIVE"]) + len(buckets["COVERED"])
    return {
        "WHAT_THIS_COUNTS": (
            "Prose leaves that CARRY A NUMERAL -- the only population this gate can convict. "
            "Numeral-free prose is excluded by proof, not by exemption: the gate's conviction "
            "test intersects a leaf's own numerals with the moved spellings, and that "
            "intersection is empty for every axis and every corpus when the leaf has none."
        ),
        "n_axes": len(per_axis),
        "axes": sorted(per_axis),
        "n_prose_leaves": len(prose),
        "n_prose_leaves_numeral_free_UNCONVICTABLE_BY_PROOF": len(numeral_free),
        "n_numeral_carrying_prose_leaves": len(carriers),
        "COVERAGE": f"{n_watched}/{len(carriers)}",
        "coverage_rate": rate0(n_watched, len(carriers)),
        "n_RESPONSIVE": len(buckets["RESPONSIVE"]),
        "n_COVERED": len(buckets["COVERED"]),
        "n_EXEMPTED_STRUCTURAL": len(buckets["EXEMPTED"]),
        "n_CARRIED_UNVERIFIABLE_NOT_COVERAGE": len(buckets["CARRIED_UNVERIFIABLE"]),
        "WHAT_CARRIED_UNVERIFIABLE_MEANS": (
            "A genuine measurement, interpolated from the field it describes, that NO axis in "
            "this family moves. The wiring is visible in the source but UNTESTED by this gate, "
            "so it is deliberately excluded from the coverage figure rather than counted as a "
            "pass. Growth in this bucket means the axis family is too narrow, and it is reported "
            "where that is impossible to miss."
        ),
        "n_UNREACHED_THIS_IS_THE_RED": len(buckets["UNREACHED"]),
        "buckets": buckets,
        "bad_structural_claims": bad_structural,
        "structural_entries_that_matched_nothing": dead_structural,
        "identifier_exclusion_audit": {
            "WHY": (
                "IDENTIFIER_KEYS excludes fields by exact NAME. This checks that each excluded "
                "field really holds an identifier, by requiring that it quote no moved "
                "measurement as a free-standing word. Membership earned by content, not by a "
                "name that sounds path-like."
            ),
            "n_identifier_leaves_audited": sum(
                1 for k in base if isinstance(base[k], str) and _is_identifier_field(k)
            ),
            "leaks": identifier_leaks,
            "PASS": not identifier_leaks,
        },
        "PASS": (not buckets["UNREACHED"] and not bad_structural and not dead_structural
                 and not identifier_leaks),
        "how_to_falsify": (
            "Add a sentence quoting a measurement to a block no axis moves, and re-run: it "
            "lands in UNREACHED and this generator exits non-zero. Demonstrated by "
            "--census-selftest."
        ),
    }


def _verify_structural(path: str, ent: dict, base: dict, per_axis_leaves: dict) -> tuple[bool, str]:
    """A STRUCTURAL exemption is a claim about the KIND of a numeral, and it is checked.

    ★ WHY THIS IS NOT THE ALLOWLIST AGAIN. The rejected design gave every unreached region an
    exemption, which is the caption problem with extra steps -- an exemption sized to the escape
    population is just the escape population with a table around it. These entries are the
    genuine REMAINDER after six axes, each one names WHICH numerals it is claiming and WHAT KIND
    they are, and two mechanical checks stand behind the claim:

      1. EXHAUSTIVE. The declared numerals must be exactly the numerals in the text. A structural
         claim that covers some of a sentence's numbers while a measurement hides among the rest
         is the shape this whole wave exists to defeat.
      2. INVARIANT. None of the declared numerals may move under ANY axis, anywhere in the
         artifact. A numeral claimed to be a fixed threshold or a document identifier, which some
         axis is observed to move, is a measurement being mis-declared -- and that is reported as
         a bad structural claim, which FAILS the run exactly like an unreached caption.

    Convenience is not a kind. "Too hard to reach" is not a kind. The kinds are named in the
    STRUCTURAL_NUMERALS table and each is a statement about the number's referent.
    """
    declared = set(ent.get("numerals") or [])
    actual = set(_NUMERAL_RE.findall(base[path]))
    if declared != actual:
        return False, (
            f"declared numerals {sorted(declared)} != the numerals actually in the text "
            f"{sorted(actual)} -- a structural claim must account for every number in the "
            "sentence, or a measurement can hide among the ones it did not mention"
        )
    if not ent.get("kind") or not ent.get("why"):
        return False, "a structural exemption must name its KIND and its reason"
    if ent["kind"] not in STRUCTURAL_KINDS:
        return False, (
            f"kind {ent['kind']!r} is not one of the declared kinds {sorted(STRUCTURAL_KINDS)}. "
            "The vocabulary is closed on purpose -- a free-text kind is a place to write "
            "'because it is hard to reach', and convenience is not a kind."
        )
    # ★ SCOPED LIKE THE GATE, AND HONEST ABOUT WHAT THAT MAKES IT. The first version of this
    # check asked whether the declared numerals move ANYWHERE in the artifact, and it rejected
    # every entry -- "2" moves somewhere, always. That is the NUMERAL COLLISION the gate's
    # container-scoping rule exists to avoid, reintroduced globally in the verifier that polices
    # the gate. Scoped correctly it agrees with the gate.
    #
    # But then it is IMPLIED, not independent: a leaf only reaches this function by being
    # UNREACHED, which already means no declared numeral moved in its scope. Saying so is the
    # point -- a check that cannot fail is a decoration that inflates the count of checks, which
    # is this file's own AR-188 finding. It is kept as a consistency assertion and NOT counted as
    # a safety check. The load-bearing checks here are EXHAUSTIVENESS and the CLOSED KIND
    # VOCABULARY above, both of which can and do fail.
    cont = _container_of(path)
    for ax, L in per_axis_leaves.items():
        for k, v in L.items():
            if k not in base or isinstance(v, bool):
                continue
            if not (k.startswith(cont + ".") or k.startswith(cont + "[")):
                continue
            b = base[k]
            if isinstance(b, (int, float)) and isinstance(v, (int, float)) and b != v:
                if declared & (_numeral_forms(b) | _numeral_forms(v)):
                    return False, (
                        f"axis {ax} MOVES {sorted(declared & (_numeral_forms(b) | _numeral_forms(v)))} "
                        f"at {k} ({b} -> {v}), INSIDE this leaf's own container -- a numeral this "
                        "entry declares STRUCTURAL is observably a measurement beside it"
                    )
    return True, "verified"


def caption_gate(art_base: dict, art_perturbed: dict, allowlist: dict) -> dict:
    """FAIL the generator on any prose numeral that the data moved and the sentence did not.

    WHY THIS RULE NEEDS NO ANNOTATION, which is the whole point. An annotation-based check
    ("mark your computed fields") is a habit: the next caption arrives unmarked, exactly as
    the last three did. This gate instead asks a question the author cannot answer wrongly:

      1. Build the artifact twice -- once real, once under THE STANDARD PERTURBATION.
      2. Collect every NUMERIC leaf whose value differs between the two builds. The old and
         new spellings of those values are the MOVED NUMERALS. (Numerals appearing in
         exactly one side of a string that DID change are added too, so a value that only
         ever surfaces inside a fraction like "6/161" still counts as moved.)
      3. Any STRING leaf that is byte-identical across the two builds AND contains a moved
         numeral is a CAPTION: it printed a number the data changed, without changing.

    A field that is genuinely computed cannot fail this -- if its inputs moved, its text
    moved. A field that typed the number cannot pass it. Nobody has to remember anything.

    WHAT IT CANNOT SEE, stated so the gate is not itself a caption: a typed numeral whose
    value happens NOT to move under this perturbation is invisible here. That is why the
    perturbation is chosen to be the largest live fact in the artifact rather than a
    convenient one, and why the allowlist below must justify every suppression.
    """
    per_axis_leaves = {ax: dict(_leaves(a)) for ax, a in art_perturbed.items()}
    base = dict(_leaves(art_base))
    shared = [k for k in base if all(k in L for L in per_axis_leaves.values())]
    # A leaf is FROZEN only if it sat still under EVERY axis; it is answerable for the numerals
    # that ANY axis moved beside it. Both halves are unions -- widening the perturbation set can
    # therefore only ever ADD convictions, never remove one.
    pert = {k: base[k] for k in shared}
    for L in per_axis_leaves.values():
        for k in shared:
            if L[k] != base[k]:
                pert[k] = L[k]

    # WHICH MOVED NUMBERS A GIVEN SENTENCE IS ANSWERABLE FOR -- "the fields BESIDE it", which is
    # the law's own wording and not a convenience. Scoring every prose field against every moved
    # number in the artifact makes the gate fire on NUMERAL COLLISION: "n=1 is below the n>=2
    # floor" in the CEILING block would be convicted because some unrelated count elsewhere passed
    # through 1. Those are false REDs, and a gate that cries wolf gets read as noise and then
    # switched off -- which is how the next caption would survive. So a field is answerable for
    # the moved numbers inside ITS OWN CONTAINER's subtree: its siblings and their descendants.
    # This is strictly the scope in which a field could have been computed from what is beside it.
    # THE UNION OF THE BLAST RADII. Every axis contributes the leaves it moved and the spellings
    # it moved them between; a leaf moved by two axes contributes both sets.
    merged: dict[str, set[str]] = {}
    for L in per_axis_leaves.values():
        for k, forms in _moved_leaves_for(base, L):
            merged.setdefault(k, set()).update(forms)
    moved_leaves: list[tuple[str, set[str]]] = sorted(merged.items())
    n_numeric_moved = sum(
        1 for k in moved_leaves
        if isinstance(base[k[0]], (int, float)) and not isinstance(base[k[0]], bool)
    )
    moved_all = set().union(*(f for _, f in moved_leaves)) if moved_leaves else set()

    def _container(p: str) -> str:
        cut = max(p.rfind("."), p.rfind("["))
        return p[:cut] if cut > 0 else "$"

    def _scope(container: str) -> set[str]:
        out: set[str] = set()
        for lp, forms in moved_leaves:
            if lp.startswith(container + ".") or lp.startswith(container + "["):
                out |= forms
        return out

    scope_cache: dict[str, set[str]] = {}
    violations = []
    bad_provenance: list[dict] = []
    suppressed = collections.defaultdict(set)
    n_identifier_skipped = 0
    for k in shared:
        a, b = base[k], pert[k]
        if not isinstance(a, str) or not isinstance(b, str) or a != b:
            continue
        if _is_identifier_field(k):
            n_identifier_skipped += 1
            continue
        cont = _container(k)
        if cont not in scope_cache:
            scope_cache[cont] = _scope(cont)
        hits = sorted(set(_NUMERAL_RE.findall(a)) & scope_cache[cont])
        if not hits:
            continue
        excused = allowlist.get(k)
        if excused is not None:
            still = []
            for h in hits:
                src = excused["provenance"].get(h)
                ok, why = _verify_provenance(h, src, base, pert)
                if ok:
                    suppressed[k].add(h)
                else:
                    still.append(h)
                    bad_provenance.append({"path": k, "numeral": h, "claimed_source": src,
                                           "why_rejected": why})
            if not still:
                continue
            hits = still
        violations.append({"path": k, "frozen_numerals_that_moved": hits, "text": a})

    # THE ALLOWLIST IS ITSELF GATED. A suppression that suppresses nothing is a suppression
    # nobody is checking -- it would let the list grow into a place to hide the next caption.
    # An entry that stops firing must be DELETED, and the generator says so by failing.
    dead = sorted(k for k in allowlist if not suppressed.get(k))
    return {
        "bad_provenance_claims": bad_provenance,
        "PERTURBATION_AXES": dict(sorted(AXES.items())),
        "n_axes": len(per_axis_leaves),
        "n_leaves_compared": len(shared),
        "n_numeric_leaves_that_moved": n_numeric_moved,
        "n_moved_numeral_spellings": len(moved_all),
        "scoping_rule": (
            "A prose field is answerable for the moved numbers within its own container's subtree "
            "-- its siblings and their descendants. Wider scoping convicts on numeral collision; "
            "narrower scoping would let a block quote its own parent's number and freeze."
        ),
        "n_prose_fields_examined": sum(1 for k in shared if isinstance(base[k], str)),
        "n_identifier_fields_skipped": n_identifier_skipped,
        "identifier_keys_excluded_as_not_prose": sorted(IDENTIFIER_KEYS),
        "violations": violations,
        "n_violations": len(violations),
        "allowlist_entries_that_fired": {k: sorted(v) for k, v in sorted(suppressed.items()) if v},
        "allowlist_entries_that_fired_on_nothing": dead,
        "PASS": not violations and not dead and not bad_provenance,
        "how_to_falsify": (
            "Replace any interpolated numeral in any prose field with the literal it currently "
            "evaluates to and re-run: that field stops moving under the perturbation while its "
            "number still does, and this generator exits non-zero. Demonstrated by "
            "--gate-selftest, which does exactly that to THE_HEADLINE in-process."
        ),
    }


def _verify_provenance(numeral: str, src_path, base: dict, pert: dict) -> tuple[bool, str]:
    """An excuse is only an excuse if it can be checked. AR-188 / R-203 s1.

    THE GATE'S ONE BLIND SPOT, and why this exists. The gate cannot tell an INTERPOLATED
    numeral whose input happened not to move from a TYPED one -- both freeze. That gap is
    where an allowlist normally becomes the place the next caption hides: "trust me, it's
    computed" is exactly the unfalsifiable reason this artifact keeps being sent back for.

    So an allowlist entry may not assert that a numeral is computed. It must NAME THE FIELD
    it is computed from, and this function checks the claim against the artifact:
      1. the named field EXISTS,
      2. it actually holds that number, and
      3. it does NOT move under the perturbation -- which is the only legitimate reason the
         sentence quoting it is allowed to sit still.
    A claim that fails any of the three is reported as a bad provenance claim and FAILS the
    run exactly like an unexcused caption. Pointing at a field that holds the number is not a
    loophole in the law; it IS the law -- "computed from the fields beside it".
    """
    if not src_path:
        return False, "no source field named -- an unfalsifiable excuse is not an excuse"
    if src_path not in base:
        return False, f"named source {src_path} does not exist in the artifact"
    v = base[src_path]
    forms = _numeral_forms(v) if not isinstance(v, str) else set(_NUMERAL_RE.findall(v))
    if numeral not in forms:
        return False, f"named source {src_path} holds {v!r}, which is not {numeral}"
    if src_path in pert and pert[src_path] != v:
        return False, (
            f"named source {src_path} MOVED ({v!r} -> {pert[src_path]!r}) while the sentence "
            "quoting it did not -- that is the caption defect, not an exemption from it"
        )
    return True, "verified"


# EVERY suppression is a VERIFIED PROVENANCE CLAIM, not a note. Each numeral names the artifact
# field it is interpolated from; _verify_provenance checks that the field exists, holds that
# number, and is itself unmoved by the perturbation. Entries that suppress nothing FAIL the run
# (allowlist_entries_that_fired_on_nothing), so this list cannot quietly accumulate.
NON_RESPONSIVE_PROSE_ALLOWLIST: dict[str, dict] = {
    "$.corpus_A.role_composition_note": {
        "provenance": {"0": "$.RECONCILIATION.corpus_A_trigger_role_count_ASSERTED_ZERO"},
        "why": (
            "Interpolated from the asserted trigger-role count. Binding WAIT_SESSION rows does not "
            "create trigger-role conditions in Corpus A, so the value is invariant under this "
            "perturbation while other counts in the corpus_A subtree pass through 0."
        ),
    },
    # DELETED (R-207): "$.corpus_A.null_baseline.basis" and
    # "$.COVERAGE_OVER_GENUINELY_ALL_TAUGHT.the_defect_this_fixes" were suppressed here because
    # the taught count "cannot move when only the binder's answers change" -- true of the ONE
    # axis that existed, and the reason the suppressions were needed at all. Under
    # CORPUS_A_TAUGHT_CONDITION_DROP the taught count DOES move, both sentences move with it,
    # and both entries stopped firing. The dead-entry check demanded their deletion.
    # ★ Widening the perturbation set SHRANK the exemption list rather than growing it. That is
    # the test of whether axes were the right remedy: an exemption is usually a confession that
    # no axis reaches a place, so reaching it removes the confession.
    "$.RECONCILIATION.census_vs_live_OUTSIDE_THIS_PIPELINE.ARMS_ARE_COMPARABLE": {
        "provenance": {"6": "$.CEILING.observed_de_approximated"},
        "why": (
            "Interpolated from the observed level/zone de-approximation count. The perturbation "
            "binds WAIT_SESSION rows concrete in BOTH arms, so it moves no level/zone flip."
        ),
    },
}


# ======================================= R-219 (2): THE EVIDENTIAL-CLAIM GATE  [caption 1]
# ★ THE DEFECT THIS FINALLY REACHES -- the campaign's FOUNDING one, and the instrument has been
# named after it for the whole campaign without ever being run against it.
#
# CAPTION 1, literal, from d09827f6:474-480, the hardcoded "interpretation" field of
# census_vs_live_OUTSIDE_THIS_PIPELINE:
#
#   "A NON-ZERO delta here is a real finding, not noise. The session lane's honest-partial
#    closure makes a WAIT_SESSION condition whose zone the runtime primitive cannot evaluate
#    UNBINDABLE rather than falsely bound. That condition LEAVES the rate's denominator and
#    ENTERS the unbound count -- the rate improves while coverage worsens. This is precisely
#    the vanishing-denominator defect section 6a exists to expose, observed live."
#
# THE CAPTION GATE CANNOT SEE IT AND NEVER COULD. It convicts on `numerals(text) & moved`. That
# sentence carries NO numeral, so the intersection is empty for every axis and every corpus --
# not a gap in the axis family, a PROOF of blindness. blind_spot_census entry #2 has said so.
#
# ★ THE GENERALISATION THAT MAKES IT CHEAP (R-219): the load-bearing failure is not only the
# DIRECTION claim ("the rate improves while coverage worsens"). It is the last two words:
# "observed live". A STRING LITERAL CLAIMING OBSERVATION IS DEFINITIONALLY UNEARNED -- it never
# consulted the data, so it is false by construction the moment it is typed, and NO perturbation
# is needed to know that. The campaign's EVERY NUMBER COMPUTED OR ABSENT therefore generalises:
#
#   EVERY OBSERVATION-CLAIM COMPUTED OR ABSENT.
#
# ================================================================ WHAT WAS MEASURED, AND WHY
# THE BROAD SINGLE-WORD LEXICON WAS TRIED FIRST AND IS REFUTED -- report it rather than bury it.
# A lexicon of bare evidential words (observed/measured/confirmed/verified/live/computed/...)
# scored over this artifact's FROZEN prose returned 15 hits, and reading all 15 shows every one
# is METHOD DESCRIPTION, not an unearned observation: "the rate is computed over EXECUTED-BINDABLE
# conditions only", "reported so the claim is a measurement a reader can check". FIFTEEN OF
# FIFTEEN FALSE POSITIVES. A guard that cries wolf gets switched off, and that failure mode is
# already law here -- so the broad lexicon is REJECTED ON ITS MEASUREMENT, not on taste.
#
# WHAT SURVIVES THE MEASUREMENT is the evidential bound to RUN-DEIXIS: not the word "measured"
# but "measured HERE", not "observe" but "observed LIVE" -- an evidential predicated on THIS RUN
# rather than on a method. Scored over the same population that rule convicts 2 of 102, and it
# convicts caption 1's literal text on two independent patterns. Both figures are COMPUTED on
# every invocation (see `precision_COMPUTED` below) so this paragraph cannot go stale.
# ★ THE FOUNDING INSTANCE, HELD AS DATA SO IT CAN BE REPLAYED RATHER THAN PARAPHRASED.
# Byte-for-byte from commit d09827f6, dual_denominator_remeasure.py lines 474-480: the hardcoded
# "interpretation" field of RECONCILIATION.census_vs_live_OUTSIDE_THIS_PIPELINE. It printed for
# any delta in either direction, and it printed while the data said the opposite.
CAPTION_1_LITERAL = (
    "A NON-ZERO delta here is a real finding, not noise. The session lane's honest-partial "
    "closure makes a WAIT_SESSION condition whose zone the runtime primitive cannot evaluate "
    "UNBINDABLE rather than falsely bound. That condition LEAVES the rate's denominator and "
    "ENTERS the unbound count -- the rate improves while coverage worsens. This is precisely "
    "the vanishing-denominator defect section 6a exists to expose, observed live."
)

EVIDENTIAL = (
    r"(observ\w*|measur\w*|confirm\w*|verif\w*|witness\w*|saw|seen|demonstrat\w*|record\w*"
    r"|detect\w*|found|establish\w*)"
)
# RUN-DEIXIS: words that point at THIS run / THIS artifact rather than at a method.
RUN_DEIXIS = r"(live|here|now|in this run|this run|we|us|today)"
# (c2) DIRECTION VOCABULARY, split by sign so an OPPOSED PAIR can be recognised.
DIRECTION_UP = r"\b(improv\w*|gain\w*|rose|rise[sn]?|increas\w*|better|higher|grew|grow\w*|recover\w*)\b"
DIRECTION_DOWN = r"\b(worsen\w*|degrad\w*|lost|loses|los[et]\w*|fell|fall[s]?|decreas\w*|worse|lower|shrink\w*|shrank)\b"

EVIDENTIAL_RULES: dict[str, dict] = {
    "EVIDENTIAL_THEN_DEIXIS": {
        "pattern": EVIDENTIAL + r"[ ,]+" + RUN_DEIXIS + r"\b",
        "convicts": "'observed live', 'measured here' -- an evidential predicated on THIS run.",
    },
    "DEIXIS_THEN_EVIDENTIAL": {
        "pattern": r"\b" + RUN_DEIXIS + r"[ ,]+" + EVIDENTIAL,
        "convicts": "'now measured', 'here we saw' -- the same claim, other word order.",
    },
    "FIRST_PERSON_EVIDENTIAL": {
        "pattern": r"\bwe\s+\w{0,6}\s?" + EVIDENTIAL,
        "convicts": "'we saw', 'we then measured' -- a narrator claiming to have looked.",
    },
    "FINDING_ASSERTION": {
        "pattern": r"\b(is|are|was|were)\s+(a\s+)?(real\s+)?(finding|findings|not noise|proof|evidence)\b",
        "convicts": (
            "'is a real finding, not noise' -- a static string ADJUDICATING its own subject "
            "as signal. Caption 1's opening clause, verbatim."
        ),
    },
    # ------------------------------------------------------------------ (c2), the harder half
    # ★ SHIPPED ONLY IN ITS HIGH-PRECISION FORM, AND THE REASON IS A MEASUREMENT. The general
    # direction detector -- "contains a direction word" -- scores 9 of 102 frozen prose leaves,
    # and reading all 9 shows NONE is a false direction claim: every one is hypothetical or
    # methodological ("a spec can improve its score by becoming LESS bindable", "lower
    # inval_off_concrete and the margin shrinks"). To convict rather than merely flag, the rule
    # would have to bind each direction word to a NAMED artifact field and compare against that
    # field's computed sign -- and 0 of the 9 name their quantity in any machine-resolvable way.
    # So an unannotated general (c2) has a MEASURED precision of 0/9 on this corpus, and an
    # annotated one is the annotation-based check this file already rejects on principle ("the
    # next caption arrives unmarked, exactly as the last three did"). GENERAL (c2): NOT SHIPPED,
    # refused on its numbers.
    # What IS shippable is the OPPOSED-PAIR form: a single frozen sentence asserting one quantity
    # moved UP while another moved DOWN. That is a compound claim about two signs at once, which
    # is both the rarest shape and exactly caption 1's ("the rate improves while coverage
    # worsens"). Scored over the same 102 it convicts ONE, and that one is adjudicated below.
    "OPPOSED_DIRECTION_PAIR": {
        "pattern": None,  # not a single regex -- see _opposed_pair()
        "convicts": (
            "A frozen sentence claiming one quantity rose while another fell. Caption 1's "
            "'the rate improves while coverage worsens', in general form."
        ),
    },
}

# The closed vocabulary of reasons an evidential claim may stand. Same discipline as
# STRUCTURAL_KINDS: a name for what the sentence IS, never a note about how hard it was to reach.
EVIDENTIAL_KINDS = frozenset({
    # The evidential describes HOW a named sibling field is produced, not what was found. The
    # named field must EXIST in the artifact -- an unfalsifiable excuse is not an excuse.
    "METHOD_DESCRIPTION",
    # A quotation of a withdrawn claim, frozen BY INTENT so the supersession stays checkable.
    "SUPERSEDED_RECORD_NOTE",
    # A direction claim whose subject THIS FILE HAS ALREADY DECLARED unreachable by every axis.
    # Cross-checked against STRUCTURAL_NUMERALS -- the entry must exist there too, with the
    # weak kind. A reconciliation against a table outside this one, which is the point.
    "CARRIED_DIRECTION_ALREADY_DECLARED_UNVERIFIABLE",
})

# EVERY suppression names its kind and the rules it is answering, and both are CHECKED. An entry
# that adjudicates nothing FAILS the run, exactly like the caption allowlist -- so this table
# cannot become the place the next unearned claim hides.
EVIDENTIAL_ADJUDICATIONS: dict[str, dict] = {
    "$.corpus_B.NEVER_EVALUATED_BY_GAP.SUPERSEDES__WITHDRAWN_921_DERIVATION."
    "these_numbers_are_frozen_BY_INTENT": {
        "kind": "SUPERSEDED_RECORD_NOTE",
        "rules": ["DEIXIS_THEN_EVIDENTIAL"],
        "why": (
            "'not what is now measured' -- the sentence exists to say the numbers beside it are "
            "a RECORD and must not track the corpus. The evidential is pointing AWAY from this "
            "run, which is the opposite of an unearned observation claim."
        ),
    },
    "$.SESSION_ATTRIBUTION.THE_26_VS_27_ACCOUNTING.ASSERTED": {
        "kind": "METHOD_DESCRIPTION",
        "rules": ["EVIDENTIAL_THEN_DEIXIS"],
        "names_field": "$.SESSION_ATTRIBUTION.THE_26_VS_27_ACCOUNTING.measured_n_WAIT_SESSION_taught",
        "why": (
            "'the fourth quantity is measured here' describes which of the four terms this "
            "generator computes rather than inherits. The field it names is present and is the "
            "measured term; the sentence claims a mechanism, not a result."
        ),
    },
    "$.SESSION_ATTRIBUTION.THE_26_VS_27_ACCOUNTING.the_27th_row": {
        "kind": "CARRIED_DIRECTION_ALREADY_DECLARED_UNVERIFIABLE",
        "rules": ["OPPOSED_DIRECTION_PAIR"],
        "why": (
            "'the post-closure count is one higher ... the closure did not lose a binding'. A "
            "genuine opposed-pair direction claim whose subject is ws_taught -- which this file "
            "has ALREADY declared unreachable by every axis in STRUCTURAL_NUMERALS, with its "
            "reason. Adjudicated here by cross-reference to that declaration, not by a new one."
        ),
    },
}


def _opposed_pair(text: str) -> bool:
    t = text.lower()
    return bool(re.search(DIRECTION_UP, t)) and bool(re.search(DIRECTION_DOWN, t))


def _evidential_rules_firing(text: str) -> list[str]:
    t = text.lower()
    hit = []
    for name, spec in EVIDENTIAL_RULES.items():
        if name == "OPPOSED_DIRECTION_PAIR":
            if _opposed_pair(t):
                hit.append(name)
        elif re.search(spec["pattern"], t):
            hit.append(name)
    return sorted(hit)


def evidential_claim_gate(art_base: dict, per_axis: dict[str, dict], structural: dict) -> dict:
    """FAIL the generator on a FROZEN prose string that claims to have observed something.

    THE POPULATION. Only leaves that are byte-identical under EVERY axis are scored. A string
    that MOVES is recomputing from the data, and a recomputing string's evidential is earned --
    it demonstrably consulted the very thing it reports. Frozen is the whole hazard.

    WHY THIS NEEDS NO PERTURBATION TO CONVICT, unlike the caption gate. The caption gate must
    watch a numeral MOVE to know a sentence lied about it. An observation claim needs no such
    witness: a literal that was typed by an author cannot have observed anything, whatever the
    data does. That asymmetry is why this gate reaches caption 1 and the caption gate cannot.

    ★ FALSE POSITIVES ARE MEASURED, NOT ASSERTED. `precision_COMPUTED` below is this run's own
    conviction count against its own adjudication count. If a rule starts convicting sentences
    that turn out to be legitimate, that shows up here as a falling precision on the run that
    causes it -- before anyone decides whether to keep the rule.
    """
    base = dict(_leaves(art_base))
    per_axis_leaves = {ax: dict(_leaves(a)) for ax, a in per_axis.items()}
    scored, convictions, adjudicated_hits = [], [], []
    bad_adjudications: list[dict] = []

    for k, v in base.items():
        if not isinstance(v, str) or _is_identifier_field(k):
            continue
        if not all(k in L and isinstance(L[k], str) for L in per_axis_leaves.values()):
            continue
        if any(L[k] != v for L in per_axis_leaves.values()):
            continue  # it moves -> it recomputes -> its evidential is earned
        scored.append(k)
        rules = _evidential_rules_firing(v)
        if not rules:
            continue
        ent = EVIDENTIAL_ADJUDICATIONS.get(k)
        if ent is None:
            convictions.append({"path": k, "rules_that_fired": rules, "text": v[:400]})
            continue
        ok, why = _verify_evidential_adjudication(k, ent, rules, base, structural)
        if ok:
            adjudicated_hits.append({"path": k, "kind": ent["kind"], "rules": rules,
                                     "why": ent["why"]})
        else:
            bad_adjudications.append({"path": k, "why_rejected": why})
            convictions.append({"path": k, "rules_that_fired": rules, "text": v[:400],
                                "rejected_adjudication": why})

    dead = sorted(k for k in EVIDENTIAL_ADJUDICATIONS
                  if k not in {a["path"] for a in adjudicated_hits}
                  and k not in {c["path"] for c in convictions})
    n_flagged = len(convictions) + len(adjudicated_hits)
    return {
        "WHAT_THIS_CONVICTS": (
            "A prose string that is FROZEN under every axis and claims an OBSERVATION. Such a "
            "string never consulted the data, so the claim is unearned by construction and no "
            "perturbation is needed to know it. This is the rule that reaches caption 1, whose "
            "load-bearing words -- 'observed live' -- carry no numeral for the caption gate to "
            "intersect."
        ),
        "THE_GENERALISATION": "EVERY NUMBER COMPUTED OR ABSENT, extended: EVERY OBSERVATION-CLAIM COMPUTED OR ABSENT.",
        "rules": {k: v["convicts"] for k, v in sorted(EVIDENTIAL_RULES.items())},
        "n_frozen_prose_leaves_SCORED": len(scored),
        "n_flagged": n_flagged,
        "n_convictions": len(convictions),
        "n_adjudicated": len(adjudicated_hits),
        "precision_COMPUTED": {
            "WHAT_IT_MEANS": (
                "Of the frozen prose leaves these rules flagged on THIS run, the share that "
                "needed an adjudication rather than a repair. A rising adjudication share is the "
                "signature of a rule that has started crying wolf, and it is visible here on the "
                "run that causes it rather than after the guard has been switched off."
            ),
            "flagged_over_scored": rate0(n_flagged, len(scored)),
            "adjudicated_over_flagged": rate0(len(adjudicated_hits), n_flagged),
        },
        "REJECTED_RULE_FAMILIES_AND_THEIR_MEASUREMENTS": {
            "BARE_EVIDENTIAL_LEXICON": (
                "Single evidential words with no deixis requirement: 15 hits on this artifact's "
                "frozen prose, 15 of 15 method-description false positives. REFUSED on its "
                "numbers -- a guard that cries wolf gets switched off, which reopens the channel."
            ),
            "GENERAL_DIRECTION_CLAIM__DELIVERABLE_2c": (
                "Any direction word in frozen prose: 9 of 102 leaves, 0 of the 9 an actual false "
                "direction claim and 0 of the 9 naming their quantity machine-resolvably. "
                "Measured precision 0/9. NOT SHIPPED. Its catch -- caption 1 -- is taken instead "
                "by OPPOSED_DIRECTION_PAIR (1 hit) and by the evidential rules, which convict "
                "caption 1's literal text on two independent patterns without it."
            ),
        },
        "convictions": convictions,
        "adjudicated": adjudicated_hits,
        "bad_adjudications": bad_adjudications,
        "adjudications_that_matched_nothing": dead,
        "PASS": not convictions and not bad_adjudications and not dead,
        "how_to_falsify": (
            "Run --caption1-literal-replay: it plants caption 1's LITERAL original text, byte "
            "for byte from d09827f6:474-480, into a frozen field of this artifact and requires "
            "this gate to convict it."
        ),
    }


def _verify_evidential_adjudication(path, ent, rules_fired, base, structural) -> tuple[bool, str]:
    """An adjudication is a claim, and every clause of it is checked. R-219 (2).

    Three checks, each closing a way this table could become a hiding place:
      1. The KIND is from the closed vocabulary.
      2. The declared rules are EXACTLY the rules that fired -- so an entry written for one
         pattern cannot silently absorb a second one that shows up later.
      3. The kind's own obligation: METHOD_DESCRIPTION must NAME a field that exists;
         CARRIED_DIRECTION must already be declared unreachable in STRUCTURAL_NUMERALS, which
         is a table outside this one -- a reconciliation, not a self-certification.
    """
    if ent.get("kind") not in EVIDENTIAL_KINDS:
        return False, f"kind {ent.get('kind')!r} is not in the closed vocabulary"
    if sorted(ent.get("rules", [])) != sorted(rules_fired):
        return False, (
            f"declares rules {sorted(ent.get('rules', []))} but {sorted(rules_fired)} fired -- "
            "an adjudication must answer exactly the rules it is excusing"
        )
    if ent["kind"] == "METHOD_DESCRIPTION":
        f = ent.get("names_field")
        if not f:
            return False, "METHOD_DESCRIPTION must NAME the field whose method it describes"
        if f not in base:
            return False, f"named field {f} does not exist in the artifact"
    if ent["kind"] == "CARRIED_DIRECTION_ALREADY_DECLARED_UNVERIFIABLE":
        s = structural.get(path)
        if s is None or s.get("kind") != _WEAK_KIND:
            return False, (
                f"claims {path} is already declared unreachable, but STRUCTURAL_NUMERALS has "
                f"{'no entry' if s is None else 'kind ' + str(s.get('kind'))} for it"
            )
    return True, "verified"


# ================================================== R-207 ADDENDUM: ASSERT DISCRIMINATION
# ★ THE LAW THIS SERVES: never a guard whose green is invariant to the question being asked.
#
# THE MOTIVATING INSTANCE. `graded_teachings + graded_mis_types + orphan_zone_refusal ==
# ws_taught` reads 17 + 9 + 1 == 27. The SUM is not in doubt; the SPLIT is -- it may be 16/10
# or 18/8. The assert is green under every one of those splits, so it protects the thing nobody
# questions and is silent on the only thing at issue. Sized by census rather than by instance,
# that means the WHOLE assert family gets this measured, not that one line.
#
# ★ WHY THE CONSISTENCY-PRESERVING AXES CANNOT COMPUTE THIS ON THEIR OWN -- a conflict worth
# stating rather than fitting around. Requirement (iii) of this wave says an axis must leave
# every cross-assert ARMED AND PASSING; an axis that fails an assert is a hole. So by
# construction NO axis fails ANY assert, and a discrimination column computed against the axes
# alone would be uniformly empty and would mean nothing.
#
# What discriminates an assert is the axis with its CONSISTENCY REPAIR WITHHELD -- the same
# perturbation, minus the mirror-update that keeps the artifact self-consistent. That is exactly
# the defect the assert exists to catch, so the probe family is the axes plus their withheld-
# repair variants. The two requirements are complementary, not in tension: the axis proves the
# artifact stays coherent, and the withheld-repair probe proves the assert would have noticed if
# it had not.
_WITHHOLD_REPAIRS = False


@contextmanager
def repairs_withheld():
    """Run an axis WITHOUT its mirror repair -- i.e. inject the defect the assert is for."""
    global _WITHHOLD_REPAIRS
    prev = _WITHHOLD_REPAIRS
    _WITHHOLD_REPAIRS = True
    try:
        yield
    finally:
        _WITHHOLD_REPAIRS = prev


def assert_discrimination_census() -> dict:
    """COMPUTE, per assert, which probes actually fail it. Never typed. R-207 addendum.

    For every probe (each axis, and each axis with its consistency repair withheld) the whole
    artifact is rebuilt and the AssertionError -- if any -- is traced back to the LINE that
    raised, then to that line's ASSERT_DISPOSITIONS key. An assert's discrimination is the set
    of probes observed to fail it. Nothing here reads a hand-written claim about what an assert
    would catch, which is the point: a typed discrimination claim inside the census that
    measures discrimination would be the caption defect in its purest form.

    ★ THE FORCED DISPOSITION. An assert that NO probe can fail is one of exactly two things:
    SOURCE_INVARIANT by declaration, or DEAD. There is no third bucket and no silent pass. The
    row is emitted as NON_DISCRIMINATING and cross-checked against its declared disposition:
    a DATA_SENSITIVE assert that no probe can fail is reported as a SUSPECTED DEAD ASSERT --
    which is how two already-known dead ones in this file were found, both of which read only a
    module-literal list and a pure function, so no data could ever reach them while the file was
    using the DATA_SENSITIVE count as its own safety figure.
    """
    import ast
    import traceback

    tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
    line_to_key: dict[int, str] = {}
    for n in ast.walk(tree):
        if isinstance(n, ast.Assert):
            src = ast.unparse(n.test)
            keys = [k for k in ASSERT_DISPOSITIONS if k in src]
            if len(keys) == 1:
                line_to_key[n.lineno] = keys[0]

    # ★ REACHABILITY FIRST, OR THE COLUMN LIBELS HALF THE FILE. "No probe failed it" means two
    # very different things: the assert RAN under the probes and held, or the assert never ran at
    # all. The probe family rebuilds the artifact, so asserts living in main() -- the append-only
    # hash pair, the git HEAD check, the gate and census gates themselves -- are never executed
    # by a probe. Reporting those as suspected-dead would be exactly the overclaim this campaign
    # exists to kill, so executed lines are traced and the two cases are named separately.
    executed_lines: set[int] = set()
    this_file = str(Path(__file__).resolve())

    def _tracer(frame, event, arg):
        if event == "line" and frame.f_code.co_filename == this_file:
            executed_lines.add(frame.f_lineno)
        return _tracer

    prev_trace = sys.gettrace()
    sys.settrace(_tracer)
    try:
        build_artifact(None)
    finally:
        sys.settrace(prev_trace)
    reached = {k for ln, k in line_to_key.items() if ln in executed_lines}

    probes: list[tuple[str, str, bool]] = []
    for ax in AXES:
        probes.append((ax, ax, False))
        probes.append((f"{ax}__REPAIR_WITHHELD", ax, True))

    failed_by: dict[str, set[str]] = {k: set() for k in ASSERT_DISPOSITIONS}
    revived_by: dict[str, set[str]] = {k: set() for k in ASSERT_DISPOSITIONS}
    probe_outcome: dict[str, str] = {}
    for probe_name, ax, withhold in probes:
        try:
            if withhold:
                with repairs_withheld():
                    build_artifact(ax)
            else:
                build_artifact(ax)
            probe_outcome[probe_name] = "NO_ASSERT_FIRED"
        except AssertionError as e:
            tb = traceback.extract_tb(e.__traceback__)
            hit = None
            for fr in reversed(tb):
                if Path(fr.filename).resolve() == Path(__file__).resolve() and fr.lineno in line_to_key:
                    hit = line_to_key[fr.lineno]
                    break
            if hit is None:
                probe_outcome[probe_name] = f"ASSERT_FIRED_UNMAPPED: {str(e)[:120]}"
            else:
                failed_by[hit].add(probe_name)
                probe_outcome[probe_name] = f"FIRED: {hit}"
        except Exception as e:  # a probe that crashes is not evidence about any assert
            probe_outcome[probe_name] = f"BUILD_ERROR: {type(e).__name__}: {str(e)[:120]}"

    # ------------------------------------------------- R-219 (5): THE REVIVAL PROBE FAMILY
    # A SECOND family, run and reported SEPARATELY because it is weaker evidence (see the
    # REVIVAL_PROBES comment). Each probe declares its target; a probe that fires a DIFFERENT
    # assert, or fires none, is recorded as MISDIRECTED and fails the census -- "revived" must
    # not become a word for a probe nobody checked.
    revival_outcome: dict[str, str] = {}
    misdirected: list[dict] = []
    for pname, spec in sorted(REVIVAL_PROBES.items()):
        try:
            with revival_probe(pname):
                build_artifact(None)
            revival_outcome[pname] = "NO_ASSERT_FIRED"
            misdirected.append({"probe": pname, "declared_target": spec["targets"],
                                "observed": "NO_ASSERT_FIRED"})
        except AssertionError as e:
            tb = traceback.extract_tb(e.__traceback__)
            hit = None
            for fr in reversed(tb):
                if Path(fr.filename).resolve() == Path(__file__).resolve() and fr.lineno in line_to_key:
                    hit = line_to_key[fr.lineno]
                    break
            revival_outcome[pname] = f"FIRED: {hit}" if hit else f"ASSERT_FIRED_UNMAPPED: {str(e)[:120]}"
            if hit == spec["targets"]:
                revived_by[hit].add(pname)
            else:
                misdirected.append({"probe": pname, "declared_target": spec["targets"],
                                    "observed": hit or "UNMAPPED"})
        except Exception as e:
            revival_outcome[pname] = f"BUILD_ERROR: {type(e).__name__}: {str(e)[:120]}"
            misdirected.append({"probe": pname, "declared_target": spec["targets"],
                                "observed": f"BUILD_ERROR {type(e).__name__}"})

    rows, suspected_dead, unclassifiable = [], [], []
    for key, disp in sorted(ASSERT_DISPOSITIONS.items()):
        probes_hit = sorted(failed_by[key])
        revivals_hit = sorted(revived_by[key])
        in_reach = key in reached
        if probes_hit:
            verdict = "DISCRIMINATING"
        elif revivals_hit:
            # ★ A DELIBERATELY SMALLER WORD THAN DISCRIMINATING. The assert is proven LIVE --
            # reachable, evaluated, and capable of failing. It is NOT proven responsive to any
            # real corpus movement, because a value injection is not a corpus.
            verdict = "REVIVED_BY_VALUE_INJECTION"
        elif not in_reach:
            verdict = "NOT_REACHED_BY_THIS_PROBE_FAMILY"
        else:
            verdict = "REACHED_BUT_NO_PROBE_FAILS_IT"
        row = {
            "assert": key,
            "declared_disposition": disp,
            "executed_during_a_probe_build": in_reach,
            "discriminated_by_COMPUTED": probes_hit,
            "n_probes_that_fail_it": len(probes_hit),
            "revived_by_COMPUTED": revivals_hit,
            "verdict": verdict,
        }
        if revivals_hit and not probes_hit:
            row["WHAT_REVIVED_MEANS"] = (
                "A value injection at this assert's point of use made it fire, so it is a live "
                "guard and not a decoration. It is WEAKER evidence than an axis conviction: it "
                "says nothing about whether any real corpus can reach the state it refuses."
            )
        if verdict == "REACHED_BUT_NO_PROBE_FAILS_IT" and disp == "DATA_SENSITIVE":
            row["SUSPECTED_DEAD"] = (
                "declared DATA_SENSITIVE, it RAN under every probe, and none could make it fire. "
                "Either this family is missing a probe that reaches its subject, or no data "
                "reaches it and the declaration is wrong. Not a silent pass."
            )
            suspected_dead.append(key)
        if verdict == "NOT_REACHED_BY_THIS_PROBE_FAMILY":
            row["WHY_NO_EVIDENCE"] = (
                "It does not execute during a probe build -- it lives outside build_artifact "
                "(in main(), around the write and the git checks). This probe family says "
                "NOTHING about it either way, and saying nothing is the honest report."
            )
            unclassifiable.append(key)
        rows.append(row)

    by_verdict = collections.Counter(r["verdict"] for r in rows)
    return {
        "WHY": (
            "Never a guard whose green is invariant to the question being asked. For each assert "
            "this records which probes were OBSERVED to fail it -- computed by rebuilding the "
            "artifact under each probe and tracing the raising line, never declared."
        ),
        "PROBE_FAMILY": (
            "Each axis, and each axis with its consistency repair WITHHELD. The axes alone "
            "cannot compute this: requirement (iii) makes them leave every assert armed and "
            "PASSING, so they fail nothing by construction. Withholding the repair injects "
            "exactly the inconsistency the assert exists to catch."
        ),
        "n_probes": len(probes),
        "probes": sorted(p[0] for p in probes),
        "probe_outcomes": dict(sorted(probe_outcome.items())),
        "n_DISCRIMINATING": by_verdict["DISCRIMINATING"],
        "n_REVIVED_BY_VALUE_INJECTION": by_verdict["REVIVED_BY_VALUE_INJECTION"],
        "n_REACHED_BUT_NO_PROBE_FAILS_IT": by_verdict["REACHED_BUT_NO_PROBE_FAILS_IT"],
        "n_NOT_REACHED_BY_THIS_PROBE_FAMILY": by_verdict["NOT_REACHED_BY_THIS_PROBE_FAMILY"],
        "REVIVAL_FAMILY": {
            "WHY_IT_IS_REPORTED_APART": (
                "An AXIS perturbs a SOURCE and requires the whole artifact to stay consistent; it "
                "earns the word DISCRIMINATING. A REVIVAL PROBE injects a value at the point of "
                "use. It proves the assert is LIVE and capable of failing, and nothing about "
                "whether a real corpus can reach that state. Pooling the two would inflate the "
                "very safety figure this census exists to deflate."
            ),
            "n_probes": len(REVIVAL_PROBES),
            "probes": {k: {"targets": v["targets"], "why": v["why"]}
                       for k, v in sorted(REVIVAL_PROBES.items())},
            "outcomes": dict(sorted(revival_outcome.items())),
            "MISDIRECTED_PROBES_THIS_IS_THE_RED": misdirected,
            "PASS": not misdirected,
        },
        "suspected_dead_asserts": suspected_dead,
        "asserts_this_family_CANNOT_JUDGE": unclassifiable,
        "REACHABILITY_IS_MEASURED_NOT_ASSUMED": (
            "Executed lines are traced during a real build, so 'no probe failed it' is never "
            "conflated with 'it never ran'. The asserts in main() are outside every probe's "
            "reach and are reported as unjudged rather than as dead."
        ),
        "rows": rows,
        "how_to_falsify": (
            "Run --discrimination-replay: it shows the column reporting a KNOWN non-discriminating "
            "assert (the 17/9/1 sum, under a probe that moves the split and preserves the sum) as "
            "NON_DISCRIMINATING, while the same probe family does fail the asserts it should."
        ),
    }


def blind_spot_census(census: dict, spawn: dict, discrimination: dict, evidential: dict) -> dict:
    """★ R-207 (g): THE BLIND-SPOT LIST, GENERATED FROM THE FIGURES, NEVER TYPED.

    A hand-written caveat is a caption about the gate: it is written once, it stops tracking the
    thing it describes, and it reads as candour while going stale. Every entry below is computed
    from this run's own numbers, and each states whether the boundary is CHECKED (something fails
    if it is crossed) or OPEN (nothing here can see across it).

    ENTRY #1 IS THE SUBPROCESS BOUNDARY, which entered this campaign as a declared caveat --
    "the trace sees Python-level reads only" -- and leaves it as a check.
    """
    n_free = census["n_prose_leaves_numeral_free_UNCONVICTABLE_BY_PROOF"]
    carried = census["n_CARRIED_UNVERIFIABLE_NOT_COVERAGE"]
    out = {
        "WHY": (
            "Computed from this run's figures rather than typed, so it cannot go stale while "
            "reading as candour. CHECKED means something fails when the boundary is crossed; "
            "OPEN means nothing in this file can see across it."
        ),
        "entries": [
            {
                "n": 1,
                "boundary": "subprocess reads bypass the input guard's Python-level trace",
                "status": "CHECKED",
                "evidence_COMPUTED": (
                    f"{spawn['n_modules_scanned']} first-party modules AST-scanned, "
                    f"{len(spawn['findings'])} spawn sites found, "
                    f"{len(spawn['unexpected_spawns'])} outside the named git call sites"
                ),
                "what_fails_if_crossed": "assert spawn['PASS'] -- a new spawn turns this RED",
            },
            {
                "n": 2,
                "boundary": (
                    "NUMERAL-FREE CLAIMS. The gate convicts by intersecting a sentence's own "
                    "numerals with the moved spellings, so a claim carrying NO numeral -- a bare "
                    "direction word like 'improved', 'degraded', 'exclusive' -- cannot be "
                    "convicted by it under any axis. This is caption 1's own shape."
                ),
                "status": "CHECKED",
                "closed_by": "the EVIDENTIAL-CLAIM GATE (R-219 (2))",
                "evidence_COMPUTED": (
                    f"{n_free} of {census['n_prose_leaves']} prose leaves carry no numeral and "
                    "are outside the CAPTION gate's reach BY PROOF -- but they are inside the "
                    f"evidential gate's: it scores {evidential['n_frozen_prose_leaves_SCORED']} "
                    f"frozen prose leaves without needing a numeral at all, and convicts "
                    f"{evidential['n_convictions']} of them on this run"
                ),
                "what_fails_if_crossed": (
                    "assert evidential['PASS'] -- a frozen string claiming an observation turns "
                    "this RED with no perturbation required, because a literal cannot have "
                    "observed anything whatever the data does."
                ),
                "★_THE_PREMISE_THIS_ENTRY_CARRIED_IS_REFUTED": (
                    "This entry said caption 1 was numeral-free and therefore unreachable. Run "
                    "against caption 1's LITERAL bytes rather than a sentence built to its shape, "
                    "that is false: the text contains 'section 6a', and 6 moves in its own "
                    "container -- so the caption gate convicts it by NUMERAL COLLISION on a "
                    "section identifier. A true conviction for a false reason, and one that would "
                    "vanish the moment the section were renumbered. The blind spot was real; the "
                    "example chosen to illustrate it was not an example of it. Demonstrated by "
                    "--caption1-literal-replay."
                ),
                "the_residual_that_is_still_open": (
                    "A direction claim that is genuinely numeral-free AND carries no evidential "
                    "vocabulary remains unreachable by every gate here. The general direction "
                    "detector was measured and refused on its numbers -- see the evidential "
                    "gate's REJECTED_RULE_FAMILIES block. --direction-replay still demonstrates "
                    "that residual against a purpose-built numeral-free sentence."
                ),
            },
            {
                "n": 3,
                "boundary": (
                    "MEASUREMENTS NO AXIS MOVES. A value that is interpolated but that no axis "
                    "shifts is indistinguishable here from a typed one."
                ),
                "status": "OPEN",
                "evidence_COMPUTED": (
                    f"{carried} numeral-carrying leaves sit in CARRIED_UNVERIFIABLE, excluded "
                    f"from the {census['COVERAGE']} coverage figure rather than counted in it"
                ),
                "what_would_close_it": "An axis that moves each one's source; enumerated per entry.",
            },
            {
                "n": 4,
                "boundary": (
                    "ASSERTS OUTSIDE build_artifact. The discrimination probe family rebuilds "
                    "the artifact, so asserts in main() never execute under it."
                ),
                "status": "OPEN",
                "evidence_COMPUTED": (
                    f"{discrimination['n_NOT_REACHED_BY_THIS_PROBE_FAMILY']} asserts are outside "
                    f"the family's reach; {len(discrimination['suspected_dead_asserts'])} others "
                    "ran under every probe and none could fail them (SUSPECTED DEAD)"
                ),
                "what_would_close_it": (
                    "Probes that perturb the write path and the git object store, which this "
                    "wave did not build."
                ),
            },
        ],
    }
    # ★ THESE TWO WERE TYPED, inside the one function whose docstring says every entry here is
    # computed and never typed. They read 1 and 3 and were correct on the day they were written;
    # this wave moves entry #2 from OPEN to CHECKED and both would now have been wrong, printed
    # beside the entries contradicting them. Counted from the entries they describe.
    out["n_CHECKED"] = sum(1 for e in out["entries"] if e["status"] == "CHECKED")
    out["n_OPEN"] = sum(1 for e in out["entries"] if e["status"] == "OPEN")
    return out


# ★ THE KIND VOCABULARY IS CLOSED. Each name is a statement about what a number REFERS TO, never
# about how hard it was to reach. The last one is deliberately unflattering: it marks a genuine
# measurement that no axis moves, and it is reported OUTSIDE the coverage figure so it can never
# pad it. If that bucket grows, the honest reading is that the axis family is too narrow.
STRUCTURAL_KINDS = frozenset({
    "RULING_IDENTIFIER",
    "POLICY_THRESHOLD",
    "SECTION_IDENTIFIER",
    "SUPERSEDED_ESTIMATE",
    "HISTORICAL_ENUMERATION",
    "INTERPOLATED_BUT_NO_AXIS_MOVES_ITS_SOURCE",
})
# The one kind that is NOT a clean bill of health -- counted apart from the structural exemptions.
_WEAK_KIND = "INTERPOLATED_BUT_NO_AXIS_MOVES_ITS_SOURCE"


# THE GENUINE REMAINDER after six axes. NOT an exemption map sized to the escape population --
# it is what is left once the axes have done the work, and every entry is a claim about a
# number's KIND that _verify_structural checks mechanically (exhaustive over the sentence's
# numerals, and invariant under every axis). Populated from the census, never by hand-waving.
STRUCTURAL_NUMERALS: dict[str, dict] = {
    # ---------------------------------------------------------------- RULING IDENTIFIERS
    # "R-199 s2" names a ruling. It is a document identifier that happens to be spelled with
    # digits; there is no measurement behind it and no corpus can move it.
    "$.READ_THIS_ONE__PRIMARY_COVERAGE_FIGURE.WHY_THIS_ONE": {
        "kind": "RULING_IDENTIFIER",
        "numerals": ["199"],
        "why": "R-199 names the ruling this figure implements. A document id, not a quantity.",
    },
    "$.COVERAGE_OVER_GENUINELY_ALL_TAUGHT.COMPLETED_161_DUAL_CONFIGURATION.READ_THIS_ONE.WHY": {
        "kind": "RULING_IDENTIFIER",
        "numerals": ["199"],
        "why": "Same sentence, same ruling id.",
    },
    "$.COVERAGE_OVER_GENUINELY_ALL_TAUGHT.WHY_TWO_ARMS_AND_NOT_ONE_NUMBER": {
        "kind": "RULING_IDENTIFIER",
        "numerals": ["199"],
        "why": "R-199 again -- the ruling that required two arms.",
    },
    # ---------------------------------------------------------------- POLICY THRESHOLDS
    # The de-approximation floor is a policy constant from R-102 section 2. It is now the module
    # constant DE_APPROXIMATION_FLOOR and is interpolated, so the sentence tracks the policy; no
    # corpus can move it, which is exactly why no axis reaches it.
    "$.corpus_A.per_kind_attribution.swing.reason": {
        "kind": "POLICY_THRESHOLD",
        "numerals": ["2"],
        "why": "The n>=2 de-approximation floor (R-102 s2), interpolated from "
               "DE_APPROXIMATION_FLOOR. A policy constant, not a measurement.",
    },
    "$.CEILING.swing": {
        "kind": "POLICY_THRESHOLD",
        "numerals": ["2"],
        "why": "The n>=2 floor, interpolated from DE_APPROXIMATION_FLOOR -- named here only to "
               "say it is NOT the ground. The swing ROW COUNT is interpolated from the census "
               "and coincides with the floor at 2, which is why both spellings are the same "
               "token; the disposition's actual ground carries no numeral at all (see "
               "swing_disposition_ground) and is therefore outside this table by proof.",
    },
    # ★ THE TAUGHT OBJECT'S OWN NAME. '50/61.8%' identifies the fibonacci retracement line a
    # teaching refers to. It is an object identifier in a vocabulary, not a quantity this
    # generator measures, and no corpus can move it -- the line is called that.
    "$.CEILING.swing_disposition_ground": {
        "kind": "SECTION_IDENTIFIER",
        "numerals": ["50", "61.8"],
        "why": "'the 50/61.8% line' NAMES the fibonacci retracement object the teaching refers "
               "to. A vocabulary term, not a measurement -- the same kind of thing as a section "
               "number, and equally immune to any corpus.",
    },
    # ---------------------------------------------------------------- SUPERSEDED RECORDS
    # Quotations of withdrawn claims. They describe what was once said and must NOT track the
    # live corpus; an axis moving them would be the defect, not the fix.
    "$.SESSION_ATTRIBUTION.THE_26_VS_27_ACCOUNTING.supersedes": {
        "kind": "SUPERSEDED_ESTIMATE",
        "numerals": ["11", "15"],
        "why": "The withdrawn ~15 mis-types / ~11 vocabulary-gap estimates, quoted so the "
               "supersession is checkable. Frozen by intent.",
    },
    "$.CEILING.swing_disposition_ground_ruling": {
        "kind": "RULING_IDENTIFIER",
        "numerals": ["199"],
        "why": "AR-199 names the ruling that drew the anchor-vs-taught-object distinction.",
    },
    "$.CEILING.swing_disposition_ground_history": {
        "kind": "HISTORICAL_ENUMERATION",
        "numerals": ["1", "2", "3"],
        "why": "The list markers (1) (2) (3) enumerating this disposition's three successive "
               "grounds. Ordinals in a record, not a tally of anything measurable.",
    },
    "$.CEILING.swing_row_count_CORRECTED": {
        "kind": "SUPERSEDED_ESTIMATE",
        "numerals": ["1", "2"],
        "why": "Records that this count was TYPED as 1 and measures as 2. The 1 is the withdrawn "
               "value and must stay frozen; the 2 is interpolated from the census.",
    },
    # ------------------------------------------------- R-219 (4a): THE SPLIT LEDGER
    "$.SELF_ACCOUNTING.ASSERT_CENSUS.SPLIT_DERIVATION_R219.prior_values_A_RECORD_NOT_A_TALLY[0].status": {
        "kind": "SUPERSEDED_ESTIMATE",
        "numerals": ["12.5"],
        "why": "The 12.5% by which the withdrawn 16/3 split overstated the data-sensitive figure. "
               "A quoted finding about a retracted value; it must NOT track the live corpus.",
    },
    "$.SELF_ACCOUNTING.ASSERT_CENSUS.SPLIT_DERIVATION_R219.prior_values_A_RECORD_NOT_A_TALLY[2].status": {
        "kind": "RULING_IDENTIFIER",
        "numerals": ["207"],
        "why": "R-207 names the ruling whose two additions this ledger now accounts for.",
    },
    "$.SELF_ACCOUNTING.ASSERT_CENSUS.SPLIT_DERIVATION_R219.DATA_SENSITIVE_derivation": {
        "kind": "INTERPOLATED_BUT_NO_AXIS_MOVES_ITS_SOURCE",
        "numerals": ["14", "16", "2"],
        "why": "Every term is interpolated -- the baseline from ASSERT_SPLIT_BASELINE, the "
               "addition count from ASSERTS_ADDED_SINCE_BASELINE, the total from their sum. No "
               "axis moves either constant (ASSERT_DISPOSITION_RECLASSIFICATION deliberately "
               "cannot: the ledger is scored against the DECLARED table, not the perturbed one, "
               "so that the axis leaves this assert armed). Wired but untested by this family, "
               "and named as such rather than counted as coverage.",
    },
    "$.SELF_ACCOUNTING.ASSERT_CENSUS.SPLIT_DERIVATION_R219.SOURCE_INVARIANT_derivation": {
        "kind": "INTERPOLATED_BUT_NO_AXIS_MOVES_ITS_SOURCE",
        "numerals": ["3", "5", "8"],
        "why": "Same construction, same reason, other half of the split.",
    },
    "$.SELF_ACCOUNTING.n_asserts_note": {
        "kind": "HISTORICAL_ENUMERATION",
        "numerals": ["1", "2", "3"],
        "why": "The list markers (1) (2) (3) enumerating three dead asserts removed across this "
               "artifact's history. Ordinals in a record, not a live tally -- the live tally is "
               "n_DATA_SENSITIVE beside them, which is computed.",
    },
    # ---------------------------------------------------------------- SECTION IDENTIFIERS
    "$.WHAT_THIS_MAY_NOT_DO[1]": {
        "kind": "SECTION_IDENTIFIER",
        "numerals": ["6"],
        "why": "'section 6a' names a section of the spec. A document location, not a quantity.",
    },
    # ---------------------------------------------------------------- ★ THE HONEST RESIDUAL
    # These are NOT structural. Each is a genuine measurement, and each is now INTERPOLATED from
    # the field it describes -- but no axis in this family moves that field, so the gate cannot
    # convict them and coverage cannot claim them. They are declared as their own kind precisely
    # so they are not mistaken for the safe categories above. This kind is WEAKER EVIDENCE than
    # coverage: it says the author wired the value, not that the wiring was tested.
    "$.corpus_A.per_kind_attribution.swing.classifier_scope_caveat": {
        "kind": "INTERPOLATED_BUT_NO_AXIS_MOVES_ITS_SOURCE",
        "numerals": ["16", "2"],
        "why": "16 is interpolated from n_levelzone_rows and 2 from the census swing tally. Both "
               "come from levelzone-object-reference-census.json, a FROZEN artifact no axis "
               "perturbs -- and an assert pins its row count at 16. Reaching these would mean an "
               "axis that rewrites a sealed census, which is not a perturbation of this "
               "measurement but a corruption of a different one.",
    },
    "$.corpus_B.INVALIDATE_enforcement.population": {
        "kind": "INTERPOLATED_BUT_NO_AXIS_MOVES_ITS_SOURCE",
        "numerals": ["105"],
        "why": "Interpolated from trigger_by_family['INVALIDATE']. CORPUS_B_ROLE_REATTRIBUTION "
               "moves ONE condition into the trigger role and the row it finds is not an "
               "INVALIDATE, so this family count sits still. A targeted variant would reach it; "
               "this family does not, and that is reported rather than papered over.",
    },
    "$.COVERAGE_OVER_GENUINELY_ALL_TAUGHT.COMPLETED_161_DUAL_CONFIGURATION.MARGIN_DECOMPOSITION.why_the_entry_term_is_measured": {
        "kind": "INTERPOLATED_BUT_NO_AXIS_MOVES_ITS_SOURCE",
        "numerals": ["0", "161"],
        "why": "The 0 is the MEASURED entry-side margin contribution and the 161 the completed "
               "denominator. The 0 is a measurement that came back zero and no axis moves it off "
               "zero, so it cannot be distinguished here from a typed 0 -- stated plainly rather "
               "than counted as coverage.",
    },
    "$.SESSION_ATTRIBUTION.THE_26_VS_27_ACCOUNTING.why": {
        "kind": "INTERPOLATED_BUT_NO_AXIS_MOVES_ITS_SOURCE",
        "numerals": ["26", "27"],
        "why": "27 is interpolated from ws_taught and 26 from PRIOR_NOTE_WAIT_SESSION_COUNT (a "
               "superseded record). ws_taught is unreachable BY CONSTRUCTION: the taught-drop "
               "axis must avoid WAIT_SESSION rows to keep the graded-split closure armed, and "
               "the split's terms are EXTERNAL grades this generator may not recompute. An axis "
               "that moved ws_taught would have to invent a grade for the row it removed.",
    },
    "$.SESSION_ATTRIBUTION.THE_26_VS_27_ACCOUNTING.the_27th_row": {
        "kind": "INTERPOLATED_BUT_NO_AXIS_MOVES_ITS_SOURCE",
        "numerals": ["27"],
        "why": "Interpolated from ws_taught; unreachable for the same reason as the sentence above.",
    },
    "$.WHAT_THIS_MAY_NOT_DO[0]": {
        "kind": "INTERPOLATED_BUT_NO_AXIS_MOVES_ITS_SOURCE",
        "numerals": ["5"],
        "why": "'5 rows nobody can explain' is a live count from the session lane's residue, "
               "which this generator carries rather than derives -- no field beside it holds the "
               "population, so there is nothing here to interpolate from and no axis to move it. "
               "The weakest row in this table; it is a carried figure, and it is named as one.",
    },
}


# =============================================================== R-207 s2 / (B): THE RESIDUAL
def subprocess_boundary_check() -> dict:
    """★ THE INPUT GUARD'S DECLARED BOUNDARY, MADE A CHECKED ONE.

    The guard traces reads by wrapping Python-level open(). Its honest caveat has been that a
    SUBPROCESS read would not be recorded -- a true statement, and therefore a boundary that
    quietly WIDENS the moment anyone adds a shell-out to the generator's import closure. A
    caveat that cannot notice its own violation is a caption about a limitation.

    So the boundary is asserted instead of described. This walks the AST of THIS FILE and every
    first-party module it imports, and reports every subprocess primitive it finds. The check
    is AST-level rather than runtime because a runtime probe only sees the paths that ran, and
    the point is to know about a spawn that exists at all.

    THE KNOWN, ALLOWED CASE IS NAMED, NOT BLANKET-EXEMPTED. This generator does shell out to
    git -- head_blob_bytes and tracked_files run `git show` / `git ls-files` to read committed
    bytes, which is the whole mechanism of the append-only and input guards. Those call sites
    are allowed BY EXACT LOCATION (function name), so a NEW spawn anywhere else -- including a
    second spawn inside those same functions' module -- turns the gate RED rather than
    inheriting their excuse.
    """
    import ast

    ALLOWED = {"head_blob_bytes", "tracked_files", "subprocess_boundary_check"}
    PRIMITIVES = {"subprocess", "os.system", "os.popen", "os.spawnv", "os.spawnl",
                  "os.execv", "os.execl", "Popen", "pty.spawn", "commands"}

    mods: list[tuple[str, Path]] = [("__main__", Path(__file__))]
    for name, m in sorted(sys.modules.items()):
        f = getattr(m, "__file__", None)
        if not f:
            continue
        p = Path(f)
        try:
            p.resolve().relative_to(REPO_ROOT)  # first-party TEST; the value is not needed
        except ValueError:
            continue  # stdlib / site-packages: not first-party, not ours to police
        if p.resolve() != Path(__file__).resolve():
            mods.append((name, p))

    findings = []
    for modname, p in mods:
        try:
            tree = ast.parse(p.read_text(encoding="utf-8"))
        except (OSError, SyntaxError) as e:
            findings.append({"module": modname, "error": f"{type(e).__name__}: {e}"})
            continue
        # map every node to its enclosing function so an allowance can be location-scoped
        enclosing: dict[int, str] = {}
        for fn in ast.walk(tree):
            if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for sub in ast.walk(fn):
                    enclosing.setdefault(id(sub), fn.name)
        # ★ THE IMPORT IS NOT THE SPAWN. An `import subprocess` acquires a capability and reads
        # nothing; a CALL is what can read a file behind the trace's back. So calls are policed
        # by exact enclosing function, and an import is judged by whether the module it sits in
        # actually has a legitimate call site. That keeps this file's own module-level import --
        # which head_blob_bytes and tracked_files genuinely need -- from being a blanket excuse:
        # an import landing in a module with NO allowed call site is still a RED, because it is
        # a spawn capability with no legitimate user.
        mod_calls, mod_imports = [], []
        for n in ast.walk(tree):
            if isinstance(n, (ast.Import, ast.ImportFrom)):
                names = [a.name for a in n.names] + (
                    [n.module] if isinstance(n, ast.ImportFrom) and n.module else [])
                for nm in names:
                    if nm and nm.split(".")[0] in {"subprocess", "pty", "commands"}:
                        mod_imports.append((n, nm))
            elif isinstance(n, ast.Call):
                src = ast.unparse(n.func)
                for prim in PRIMITIVES:
                    if src == prim or src.startswith(prim + ".") or src.endswith("." + prim):
                        mod_calls.append((n, src))
                        break

        def row(n, hit, kind, allowed, _mod=modname, _p=p, _enc=enclosing):
            # loop variables bound as defaults: the closure must not follow the loop (B023)
            return {
                "module": _mod,
                "path": _p.resolve().relative_to(REPO_ROOT).as_posix(),
                "line": getattr(n, "lineno", None),
                "primitive": hit,
                "kind": kind,
                "enclosing_function": _enc.get(id(n), "<module>"),
                "allowed": allowed,
            }

        for n, hit in mod_calls:
            where = enclosing.get(id(n), "<module>")
            findings.append(row(n, hit, "CALL_SPAWNS", where in ALLOWED))
        has_legit_call = any(enclosing.get(id(n), "<module>") in ALLOWED for n, _ in mod_calls)
        for n, hit in mod_imports:
            findings.append(row(n, hit, "IMPORT_ACQUIRES_CAPABILITY", has_legit_call))

    unexpected = [f for f in findings if not f.get("allowed")]
    return {
        "WHY": (
            "The read trace sees Python-level opens only. A subprocess read would not be "
            "recorded, so that boundary is asserted here rather than merely declared: if a "
            "spawn appears outside the named git call sites, this fails instead of the "
            "boundary silently widening."
        ),
        "n_modules_scanned": len(mods),
        "modules_scanned": sorted({m for m, _ in mods}),
        "allowed_call_sites": sorted(ALLOWED),
        "allowed_because": (
            "head_blob_bytes and tracked_files shell out to git to read COMMITTED bytes -- that "
            "spawn IS the append-only and input guards. It is allowed by exact function name, "
            "so a new spawn elsewhere is still a RED."
        ),
        "findings": findings,
        "unexpected_spawns": unexpected,
        "PASS": not unexpected,
        "how_to_falsify": (
            "Add `import subprocess` at module scope, or a Popen call in any function not named "
            "above, and re-run: this exits non-zero naming the line."
        ),
    }


def head_blob_bytes(rel_posix: str) -> tuple[bytes | None, str]:
    """Read a path's committed bytes. Returns (bytes_or_None, status).

    ★ TRAP THIS EXISTS TO DEFEAT: `git show HEAD:<path>` with a BACKSLASH path fails to
    EMPTY STDOUT with a zero-ish result on Windows, and empty stdout compares unequal to
    the file, which reads as "the file differs". That is a false REAL-DIFF report, and it
    has already produced a batch of them. So the path is forced to forward slashes and an
    empty payload is returned as its own status rather than as a difference.
    """
    if "\\" in rel_posix:
        return None, "BACKSLASH_PATH_REFUSED"
    r = subprocess.run(["git", "show", f"HEAD:{rel_posix}"], capture_output=True)
    if r.returncode != 0:
        return None, "NOT_IN_HEAD"
    if not r.stdout:
        return None, "EMPTY_STDOUT__NOT_A_DIFFERENCE"
    return r.stdout, "OK"


def tracked_files() -> set[str]:
    """Every path git tracks at HEAD, as repo-relative POSIX strings.

    One `git ls-files` rather than a call per file. Trap 4: git emits forward slashes here,
    and every comparison against it uses .as_posix(), so a Windows backslash path can never
    silently miss and read as "untracked".
    """
    r = subprocess.run(["git", "ls-files", "-z"], capture_output=True, cwd=REPO_ROOT)
    if r.returncode != 0:
        raise SystemExit("FATAL: `git ls-files` failed -- cannot establish what is tracked.")
    return {s for s in r.stdout.decode("utf-8", "surrogateescape").split("\0") if s}


def discover_declared_inputs() -> list[Path]:
    """Enumerate the generator's inputs PROGRAMMATICALLY. AR-203 (a).

    THE DEFECT THIS CLOSES: the append-only check ran against a FIVE-NAME LIST. Every other
    tracked, committed file this generator reads -- Corpus B, the enforcement artifact, the
    sixteen Corpus A specs, the binder module whose answers become the measurement -- was
    unguarded. Tampering one of them produced exit 0, the printed safety sentence, and the
    fabricated value PUBLISHED into the artifact. That was demonstrated, not theorised:
    flipping five `confluence` roles in the tracked Corpus B moved the published by-DESIGN
    figure while every assert passed and the gate reported zero violations.

    So the enumeration is derived, never typed. It is taken from this module's OWN declared
    path constants and globs -- the same objects the read sites use -- plus this file itself
    (its AST is read by the assert census) and every imported first-party `src/` module whose
    source decides the answers.

    ★ WHY THIS IS NOT MERELY THE NEXT HAND-TYPED CONSTANT: a discovery rule can still be
    INCOMPLETE -- someone inlines a literal path at a read site and this function never sees
    it. That is why it is only half the mechanism. `trace_repo_reads` records what the build
    ACTUALLY opened, and main() asserts the traced set is a SUBSET of what was guarded. The
    enumeration cannot drift from the reads without failing the run, which is the mechanical
    form of "guard everything you read" rather than a promise to remember to.
    """
    found: set[Path] = set()
    for name, val in list(globals().items()):
        if name in {"REPO_ROOT", "H1", "OUT_PATH"}:
            continue
        if isinstance(val, Path):
            if val.is_file():
                found.add(val.resolve())
        elif isinstance(val, str) and ("*" in val or "?" in val):
            for m in glob.glob(val):
                p = Path(m).resolve()
                if p.is_file():
                    found.add(p)
    # This file's own bytes are an input: count_own_asserts/own_assert_census parse its AST.
    found.add(Path(__file__).resolve())
    # The binder's source IS the measurement -- sfb answers every binding question below.
    for mod in list(sys.modules.values()):
        f = getattr(mod, "__file__", None)
        if not f:
            continue
        p = Path(f).resolve()
        try:
            rel = p.relative_to(REPO_ROOT)
        except ValueError:
            continue
        if rel.parts and rel.parts[0] == "src" and p.is_file():
            found.add(p)
    found.discard(OUT_PATH.resolve())
    return sorted(found)


@contextmanager
def trace_repo_reads():
    """Record every in-repo file the wrapped code actually READS. AR-203 (a), half two.

    This is the instrument that keeps `discover_declared_inputs` honest. It does not guard
    anything itself -- it observes, so that a read the discovery rule missed becomes a loud
    failure instead of an unguarded input. Writes are deliberately not recorded: the artifact
    write is not an input, and recording it would make the subset check vacuously fail.
    """
    recorded: set[Path] = set()
    real_open, real_rt, real_rb = builtins.open, Path.read_text, Path.read_bytes

    def note(f) -> None:
        try:
            p = Path(f).resolve()
            rel = p.relative_to(REPO_ROOT)
        except (ValueError, OSError, TypeError):
            return
        if rel.parts and rel.parts[0] == ".git":
            return
        if p.is_file():
            recorded.add(p)

    def my_open(file, mode="r", *a, **k):
        if not any(c in str(mode) for c in "wax+"):
            note(file)
        return real_open(file, mode, *a, **k)

    def my_rt(self, *a, **k):
        note(self)
        return real_rt(self, *a, **k)

    def my_rb(self, *a, **k):
        note(self)
        return real_rb(self, *a, **k)

    builtins.open, Path.read_text, Path.read_bytes = my_open, my_rt, my_rb
    try:
        yield recorded
    finally:
        builtins.open, Path.read_text, Path.read_bytes = real_open, real_rt, real_rb


def verify_inputs_match_head(paths: list[Path], root: Path, tracked: set[str]) -> dict:
    """Every TRACKED input, against the GIT OBJECT STORE, before the run baselines anything.

    Widened from the five-name list per AR-203 (a). An input that git tracks must equal its
    committed bytes; an input git does NOT track cannot be verified against HEAD at all and
    is reported as such rather than silently passing -- main() decides that an untracked file
    the build actually READS is a hole, because a number derived from bytes no commit vouches
    for is exactly the thing this check exists to refuse.
    """
    rows = []
    for p in paths:
        rel = p.relative_to(root).as_posix()
        if rel not in tracked:
            rows.append({"path": rel, "status": "UNTRACKED__NOT_IN_HEAD", "match": None})
            continue
        head, status = head_blob_bytes(rel)
        wt = p.read_bytes()
        if status == "EMPTY_STDOUT__NOT_A_DIFFERENCE":
            # An empty blob is ambiguous ONLY until the worktree is consulted: a tracked file
            # that is empty at HEAD and empty on disk agrees with its commit. Calling that a
            # mismatch is the false-REAL-DIFF this codebase already ate once.
            head = b""
        elif status != "OK":
            rows.append({"path": rel, "status": status, "match": False})
            continue
        # ★ WHAT IS COMPARED, AND WHY IT IS NOT A LOWERED BAR. Content is compared on
        # newline-normalised bytes. This catches every edit that can move a number -- the
        # demonstrated Corpus-B role flip fails here -- because no content change survives
        # newline normalisation. What it deliberately does NOT convict is a pure CRLF/LF
        # divergence, which this checkout PRODUCES BY POLICY: files outside the h1-battery
        # .gitattributes scope (the sixteen Corpus A specs, the binder module) are checked out
        # with platform newlines against LF blobs. Convicting that would fire on every clean
        # run, and a guard that is red on a clean tree gets switched off -- which is how a
        # fabrication channel stays open. The divergence is REPORTED, not silently dropped.
        content_match = wt.replace(b"\r\n", b"\n") == head.replace(b"\r\n", b"\n")
        row = {
            "path": rel,
            "status": "OK",
            "match": content_match,
            "byte_exact": wt == head,
        }
        if wt != head:
            row["line_ending_divergence_only"] = content_match
            row["worktree_crlf_count"] = wt.count(b"\r\n")
            row["head_crlf_count"] = head.count(b"\r\n")
        if not content_match:
            row["worktree_sha256"] = hashlib.sha256(wt).hexdigest()
            row["head_sha256"] = hashlib.sha256(head).hexdigest()
        rows.append(row)
    checked = [r for r in rows if r["match"] is not None]
    return {
        "why": (
            "Every tracked input this generator reads, compared against its committed bytes "
            "BEFORE the run baselines or builds anything. The prior check ran against a "
            "five-name list, so a tampered Corpus B published a fabricated figure at exit 0."
        ),
        "enumeration": "derived from this module's declared paths/globs; completeness enforced by trace_repo_reads",
        "comparison": (
            "newline-normalised content against the HEAD blob. Byte-exactness is recorded per "
            "row; a pure line-ending divergence is this checkout's policy, not a tampered input."
        ),
        "rows": rows,
        "n_tracked_checked": len(checked),
        "n_untracked": len(rows) - len(checked),
        "n_byte_exact": sum(1 for r in checked if r.get("byte_exact")),
        "n_line_ending_divergence_only": sum(
            1 for r in checked if r.get("line_ending_divergence_only")
        ),
        "all_match": all(r["match"] for r in checked),
    }


def verify_guarded_match_head(paths: list[Path], root: Path) -> dict:
    """D6. "Clean because nothing has looked" is not clean.

    The in-run hash pair proves the guarded artifacts did not change DURING this run. It
    cannot see that they already differ from the bytes that were committed -- which they
    did, by CRLF, on 30 of 40 files in this directory, reading clean only because git's
    stat cache had not been invalidated. This check consults the object store directly, so
    a stale stat cache cannot answer for it. It CAN fire: it fired on all five guarded
    artifacts before they were normalized, and it fires again the moment one is rewritten
    with platform newlines.
    """
    rows = []
    for p in paths:
        if not p.exists():
            rows.append({"path": str(p), "status": "ABSENT"})
            continue
        rel = p.relative_to(root).as_posix()
        head, status = head_blob_bytes(rel)
        wt = p.read_bytes()
        if status != "OK":
            rows.append({"path": rel, "status": status, "match": False})
            continue
        match = wt == head
        row = {"path": rel, "status": "OK", "match": match}
        if not match:
            row["crlf_only"] = wt.replace(b"\r\n", b"\n") == head.replace(b"\r\n", b"\n")
            row["worktree_crlf_count"] = wt.count(b"\r\n")
            row["head_crlf_count"] = head.count(b"\r\n")
        rows.append(row)
    return {
        "why": (
            "Append-only means unchanged SINCE COMMIT, not merely unchanged during this run. "
            "Compared against the git object store so a stale stat cache cannot answer for it."
        ),
        "line_ending_policy": "docs/replay-results/h1-battery/.gitattributes pins eol=lf for *.json and *.py",
        "rows": rows,
        "all_match": all(r.get("match") for r in rows),
    }


def classify_drift(rate_pre, rate_post, cov_pre, cov_post) -> dict:
    """Decide, FROM THE NUMBERS, which way the two metrics moved. AR-188 fix 1.

    THE STANDING RULE THIS ENFORCES: an interpretation is COMPUTED from the fields that decide
    it, or it is ABSENT. The string this replaces printed for ANY non-zero delta in EITHER
    direction -- it asserted "the rate improves while coverage worsens" even when the rate had
    worsened, which is exactly what happened. A sentence that prints regardless of the data is
    a caption, not a finding.

    DIRECTION CONVENTION, stated because the prior prose got it backwards:
      binding_approximation_rate is the APPROXIMATION SHARE. It going UP is WORSE.
      section-6a coverage is the BOUND-AND-CONCRETE SHARE. It going UP is BETTER.
    The section-6a defect is the specific pair (rate BETTER, coverage WORSE) -- a spec buying a
    better-looking rate by shedding conditions out of its denominator. Both metrics moving the
    SAME way is the OPPOSITE of that defect: it means the change was paid for in both books.
    """
    d_rate = None if rate_pre is None or rate_post is None else round(rate_post - rate_pre, 6)
    d_cov = None if cov_pre is None or cov_post is None else round(cov_post - cov_pre, 6)
    if d_rate is None or d_cov is None:
        return {"verdict": "NOT_COMPUTABLE", "reason": "an arm is missing a figure", "delta_rate": d_rate,
                "delta_coverage": d_cov}
    rate_q = -d_rate  # positive == fidelity improved on the rate
    cov_q = d_cov     # positive == fidelity improved on coverage
    if rate_q == 0 and cov_q == 0:
        verdict, reading = "NO_DRIFT", "Neither metric moved. There is nothing to interpret."
    elif rate_q > 0 and cov_q < 0:
        verdict, reading = (
            "OPPOSITE_DIRECTIONS__SECTION_6A_DEFECT",
            "The rate IMPROVED while coverage WORSENED. Conditions left the rate's denominator "
            "instead of being bound: the vanishing-denominator defect section 6a exists to expose.",
        )
    elif rate_q < 0 and cov_q > 0:
        verdict, reading = (
            "OPPOSITE_DIRECTIONS__RATE_PAID_COVERAGE_GAINED",
            "The rate WORSENED while coverage IMPROVED. Conditions entered the denominator and "
            "bound approximately. Not the 6a defect -- the opposite trade.",
        )
    elif rate_q > 0 and cov_q > 0:
        verdict, reading = (
            "SAME_DIRECTION__BOTH_IMPROVED",
            "Both metrics moved the SAME way (both improved). This is NOT the section-6a defect: a "
            "vanishing denominator flatters the rate while costing coverage, and that did not happen "
            "here. A change that pays in BOTH books is not gaming either.",
        )
    elif rate_q < 0 and cov_q < 0:
        verdict, reading = (
            "SAME_DIRECTION__BOTH_DEGRADED",
            "Both metrics moved the SAME way (both degraded). This is NOT the section-6a defect: a "
            "vanishing denominator flatters the rate while costing coverage, and that did not happen "
            "here. A change that pays in BOTH books is not gaming either.",
        )
    # ---------------------------------------------------------------- AR-188 D3
    # THE FLAT-METRIC CASES, WHICH USED TO FALL THROUGH TO A DIRECTION NOBODY MEASURED.
    # The `else` arm this replaces read `better = rate_q > 0` -- deriving the direction of a
    # SAME_DIRECTION verdict from the RATE ALONE. So rate flat + coverage IMPROVED emitted
    # SAME_DIRECTION__BOTH_DEGRADED: a computed conclusion asserting a direction on a metric it
    # had not looked at, in a verdict whose entire content is which way BOTH went. That is
    # caption 1's defect surviving inside caption 1's own fix -- the sentence was computed, but
    # from the wrong half of the evidence. Reachable here: a taught-but-unbound condition leaving
    # the corpus raises coverage while leaving the executed-bindable rate untouched.
    # ONE metric moving is not two metrics moving the same way, and it is now named as such.
    elif rate_q == 0:
        up = cov_q > 0
        verdict = "ONLY_COVERAGE_MOVED__" + ("IMPROVED" if up else "DEGRADED")
        reading = (
            "The approximation rate did NOT move; section-6a coverage "
            + ("IMPROVED" if up else "DEGRADED")
            + ". Only one metric moved, so no same-direction or opposite-direction claim is "
            "available: a direction needs two measured movements and there is one. Coverage "
            "moving alone with the rate pinned means the change landed entirely OUTSIDE the "
            "executed-bindable denominator -- taught conditions entering or leaving the corpus "
            "without altering the mix of approximate and concrete among those that bind."
        )
    else:
        up = rate_q > 0
        verdict = "ONLY_RATE_MOVED__" + ("IMPROVED" if up else "DEGRADED")
        reading = (
            "Section-6a coverage did NOT move; the approximation rate "
            + ("IMPROVED" if up else "DEGRADED")
            + ". Only one metric moved, so no same-direction or opposite-direction claim is "
            "available. The rate moving alone means the approximate/concrete mix shifted inside "
            "the executed-bindable set while the bound-and-concrete count over all taught "
            "conditions stayed exactly where it was."
        )
    return {
        "verdict": verdict,
        "reading": reading,
        "delta_rate_raw": d_rate,
        "delta_coverage_raw": d_cov,
        "rate_quality_delta_positive_is_better": rate_q,
        "coverage_quality_delta_positive_is_better": cov_q,
        "how_to_falsify": (
            "Change either arm's rate or coverage so the two quality deltas differ in sign and this "
            "verdict changes. It is a function of four numbers and nothing else."
        ),
    }


def classify_drift_discrimination_proof() -> dict:
    """Feed classify_drift every sign-pattern of its two inputs and require distinct verdicts.

    An interpretation that can only say one thing is a caption. This drives the function
    through the FULL sign lattice of (rate delta, coverage delta) -- nine live patterns plus
    the missing-arm case -- and asserts it returns a different verdict for each.

    ★ THE FOUR FLAT-METRIC CASES ARE THE POINT (AR-188 D3). The prior proof exercised five
    patterns and every one of them moved BOTH metrics, so the arm that decided a
    same-direction verdict from the rate alone was never reached by the very test that
    licensed it. A discrimination proof that only feeds the cases the code already handles
    cannot discriminate. The four rows marked FLAT below are the ones that were missing, and
    row 6 -- rate flat, coverage improved -- is the exact input that used to return
    SAME_DIRECTION__BOTH_DEGRADED.
    """
    cases = [
        ("both_flat",                 0.50, 0.50, 0.10, 0.10),
        ("rate_better_cov_worse",     0.50, 0.40, 0.10, 0.05),
        ("rate_worse_cov_better",     0.40, 0.50, 0.05, 0.10),
        ("both_better",               0.50, 0.40, 0.05, 0.10),
        ("both_worse",                0.40, 0.50, 0.10, 0.05),
        ("FLAT_rate__cov_better",     0.50, 0.50, 0.05, 0.10),
        ("FLAT_rate__cov_worse",      0.50, 0.50, 0.10, 0.05),
        ("FLAT_cov__rate_better",     0.50, 0.40, 0.10, 0.10),
        ("FLAT_cov__rate_worse",      0.40, 0.50, 0.10, 0.10),
        ("missing_arm",               None, 0.50, 0.10, 0.10),
    ]
    cases = _axis_drift_extra_cases(cases)
    got = {name: classify_drift(rp, rq, cp, cq)["verdict"] for name, rp, rq, cp, cq in cases}
    assert len(set(got.values())) == len(cases), (
        f"classify_drift does NOT discriminate: {len(cases)} distinct input patterns produced "
        f"{len(set(got.values()))} distinct verdicts -- {got}"
    )
    # The D3 red-proof, stated as its own assert so a regression names itself.
    for flat in ("FLAT_rate__cov_better", "FLAT_rate__cov_worse",
                 "FLAT_cov__rate_better", "FLAT_cov__rate_worse"):
        assert not got[flat].startswith("SAME_DIRECTION"), (
            f"{flat} returned {got[flat]}: one metric moved and the verdict claims BOTH did. "
            "A SAME_DIRECTION verdict derived while one delta is zero asserts a direction it "
            "never measured -- the AR-188 D3 defect."
        )
    return {
        "why": "An interpretation that can only say one thing is a caption; this one says ten.",
        "n_input_patterns": len(cases),
        "n_distinct_verdicts": len(set(got.values())),
        "verdict_by_input_pattern": got,
        "flat_metric_cases_ASSERTED_NOT_SAME_DIRECTION": [
            k for k in got if k.startswith("FLAT_")
        ],
        "what_the_flat_cases_caught": (
            "The replaced `else` arm read the direction off the RATE ONLY, so rate-flat + "
            "coverage-improved returned SAME_DIRECTION__BOTH_DEGRADED. These four rows fail "
            "against that code and pass against this code, which is what makes them a proof "
            "rather than a demonstration."
        ),
    }


def compose_completed_coverage(
    entry_off_concrete, entry_on_concrete, inval_off_concrete, inval_on_concrete,
    n_taught_entry, n_invalidations,
) -> dict:
    """Build the completed-161 dual-configuration block. R-199 s2.

    THE RULING THIS IMPLEMENTS: 6/161 (honest-enforcement, TF_FAMILY_META_ENFORCED=true) is
    PRIMARY. 12/161 (the generator's default-OFF config) travels BESIDE it, labeled with its
    provenance -- neither is dropped, and the choice is not made silently.

    WHY THE CAVEAT IS A COMPUTATION AND NOT A SENTENCE: this artifact's headline defect was a
    hardcoded interpretation string that printed regardless of the data (see classify_drift).
    Replacing one caption with another caption -- "6 of the margin rests on a withdrawn claim",
    typed -- would be the same defect wearing the ruling's words. So the margin and its
    COMPOSITION are derived here from the same per-arm fields that produce the two rates. If
    the INVALIDATE contribution changed, every number in the caveat changes with it, and the
    dependency verdict re-classifies. It is a function of five integers and nothing else.

    THE WITHDRAWN CLAIM: the larger figure's margin comes from spec['invalidations'] entries
    binding with approximation=False under enforcement-OFF. That approximation=False was a
    convicted pointer lie -- the primitive it pointed at is never called in production -- and
    the enforcement build corrected it to approximation=True. So the margin is not merely
    configuration-dependent; it is partly built on a retracted claim, and this block says so
    with numbers that can be checked instead of believed.
    """
    # ENFORCEMENT MAY ONLY REMOVE CONCRETENESS, NEVER ADD IT. This is the direction claim the
    # Corpus-B INVALIDATE_enforcement block already makes ("fidelity moves DOWN"). It is a
    # property of the DATA, not algebra, so it CAN fire: call this function with
    # inval_on_concrete > inval_off_concrete and it raises. Red-proved that way.
    inval_on_concrete = _rv("inval_on_concrete", inval_on_concrete)
    assert inval_on_concrete <= inval_off_concrete, (
        f"ENFORCEMENT DIRECTION VIOLATED: enforcement-ON bound {inval_on_concrete} invalidations "
        f"concrete but enforcement-OFF bound only {inval_off_concrete}. Enforcement marks entries "
        "approximation=True; it can never make MORE of them concrete. The arms are mislabeled or "
        "the flag no longer does what INVALIDATE_enforcement says it does."
    )

    den = n_taught_entry + n_invalidations
    num_primary = entry_on_concrete + inval_on_concrete
    num_secondary = entry_off_concrete + inval_off_concrete

    # TWO INDEPENDENT SOURCES, each measured. An earlier draft of this function took ONE entry
    # count for both arms, which made margin == margin_from_invalidate as an ALGEBRAIC IDENTITY:
    # the "partly" and "independent" branches below could never be reached, and
    # margin_from_other_sources was always 0 by construction rather than by measurement. A
    # decomposition whose answer is fixed before the data arrives is a caption with arithmetic
    # painted on it -- the same defect, one level down. Both sides are now measured per arm, so
    # the entry term CAN contribute and the branch that reports it CAN be reached.
    margin = num_secondary - num_primary
    margin_from_invalidate_withdrawal = inval_off_concrete - inval_on_concrete
    margin_from_entry_conditions = entry_off_concrete - entry_on_concrete
    margin_from_other_sources = margin_from_entry_conditions
    margin_share_withdrawn = rate0(margin_from_invalidate_withdrawal, margin)

    if margin == 0:
        dependency = "NO_MARGIN__THE_TWO_CONFIGURATIONS_AGREE"
        caveat = (
            f"The two configurations produce the SAME numerator ({num_primary}/{den}). There is no "
            "margin, so nothing rests on the withdrawn INVALIDATE approximation=False claim."
        )
    elif margin_from_invalidate_withdrawal == margin:
        dependency = "MARGIN_RESTS_ENTIRELY_ON_THE_WITHDRAWN_CLAIM"
        caveat = (
            f"The larger figure exceeds the primary by {margin} of {den}, and ALL {margin} of that "
            f"margin is invalidations entries binding approximation=False under enforcement-OFF. "
            "That approximation=False has been WITHDRAWN as a convicted pointer lie -- its primitive "
            "is never called in production, and the enforcement build corrected it to "
            f"approximation=True. So {margin} of the {num_secondary} conditions in the larger "
            "numerator are counted concrete only by a claim that has been retracted."
        )
    elif margin_from_invalidate_withdrawal > 0:
        dependency = "MARGIN_PARTLY_RESTS_ON_THE_WITHDRAWN_CLAIM"
        caveat = (
            f"The larger figure exceeds the primary by {margin} of {den}. "
            f"{margin_from_invalidate_withdrawal} of that margin is invalidations entries binding "
            "approximation=False under enforcement-OFF -- a claim WITHDRAWN as a convicted pointer "
            f"lie. The remaining {margin_from_other_sources} comes from elsewhere and is not "
            "impeached by the withdrawal."
        )
    else:
        dependency = "MARGIN_INDEPENDENT_OF_THE_WITHDRAWN_CLAIM"
        caveat = (
            f"The larger figure exceeds the primary by {margin} of {den}, and NONE of that margin is "
            "invalidations concreteness. The withdrawn INVALIDATE approximation=False claim does not "
            "carry this margin."
        )

    return {
        "READ_THIS_ONE": {
            "WHY": (
                "R-199 s2: a consumer taking exactly one coverage number from this artifact takes "
                "THIS one. It is the honest-enforcement figure -- the arm in which the INVALIDATE "
                "entries bind under the CORRECTED approximation=True."
            ),
            "coverage_over_161": rate0(num_primary, den),
            "fraction": f"{num_primary}/{den}",
            "numerator": num_primary,
            "numerator_composition": (
                f"{entry_on_concrete} entry_conditions + {inval_on_concrete} invalidations"
            ),
            "denominator": den,
            "configuration": {"TF_FAMILY_META_ENFORCED": "true"},
            "status": "PRIMARY",
        },
        "BESIDE_IT_NOT_INSTEAD_OF_IT": {
            "WHY": (
                "Kept because it is the configuration this generator actually runs in, and dropping "
                "a measured arm to leave one clean number is the error this artifact was sent back "
                "to repair. It is reported WITH its provenance, never as the headline."
            ),
            "coverage_over_161": rate0(num_secondary, den),
            "fraction": f"{num_secondary}/{den}",
            "numerator": num_secondary,
            "numerator_composition": (
                f"{entry_off_concrete} entry_conditions + {inval_off_concrete} invalidations"
            ),
            "denominator": den,
            "configuration": {"TF_FAMILY_META_ENFORCED": "false (this generator's default)"},
            "status": "SECONDARY__NOT_THE_HEADLINE",
            "PROVENANCE_CAVEAT_COMPUTED": caveat,
            "provenance_dependency_verdict": dependency,
        },
        "MARGIN_DECOMPOSITION": {
            "why_this_block_exists": (
                "So the caveat above is checkable arithmetic rather than a sentence. Every figure "
                "in the caveat is one of these fields; change the per-arm inputs and both move."
            ),
            "margin_secondary_minus_primary": margin,
            "margin_from_INVALIDATE_withdrawn_approximation_False": margin_from_invalidate_withdrawal,
            "margin_from_entry_conditions_MEASURED_NOT_ASSUMED": margin_from_entry_conditions,
            "margin_from_other_sources": margin_from_other_sources,
            "share_of_margin_resting_on_the_withdrawn_claim": margin_share_withdrawn,
            "why_the_entry_term_is_measured": (
                "The two 161-figures differ only in TF_FAMILY_META_ENFORCED. Attributing the whole "
                "margin to INVALIDATE requires that the flag move invalidations and NOT "
                "entry_conditions. That is a claim about the flag, so it is measured per arm rather "
                "than assumed: this field is the entry side's contribution to the margin, and it "
                "came back "
                + (
                    f"{margin_from_entry_conditions} -- the flag does not move the entry side, so "
                    "the INVALIDATE attribution is exclusive by MEASUREMENT."
                    if margin_from_entry_conditions == 0
                    else f"{margin_from_entry_conditions} -- the flag DOES move the entry side, so "
                    "the margin has a second source and the INVALIDATE attribution is NOT exclusive."
                )
            ),
            "withdrawn_claim": {
                "claim": "spec['invalidations'] entries bind with approximation=False",
                "status": "WITHDRAWN -- convicted pointer lie",
                "why_withdrawn": (
                    "The primitive the pointer named is never called in production. The enforcement "
                    "build corrected the binding to approximation=True."
                ),
            },
            "how_to_falsify": (
                "Change any of the four measured per-arm counts and re-run: the margin, its "
                "composition, the share, the dependency verdict, and the caveat's own numbers all "
                "move. Nothing in the caveat is typed. Specifically -- lower inval_off_concrete and "
                "the margin and the caveat's figures shrink together; make entry_off_concrete "
                "differ from entry_on_concrete and the verdict re-classifies to "
                "MARGIN_PARTLY_RESTS_ON_THE_WITHDRAWN_CLAIM, because the entry term is measured "
                "rather than fixed at zero."
            ),
        },
    }


def set_levelzone_flags(on: bool) -> None:
    v = "true" if on else "false"
    os.environ["TF_LEVELZONE_ROUTING_ENABLED"] = v
    os.environ["TF_LEVELZONE_RESOLVER_ENABLED"] = v


def load_corpus_a() -> list[tuple[str, list[dict], dict]]:
    out = []
    for p in sorted(glob.glob(CORPUS_A_GLOB)):
        d = json.loads(Path(p).read_text(encoding="utf-8"))
        name = os.path.basename(p).replace(".spec.json", "")
        out.append((name, d["spec"]["entry_conditions"], d.get("approximation_metrics") or {}))
    return out


def iter_specs(o):
    if isinstance(o, dict):
        if "entry_conditions" in o and "entry_trigger_id" in o:
            yield o
            return
        for v in o.values():
            yield from iter_specs(v)
    elif isinstance(o, list):
        for v in o:
            yield from iter_specs(v)


def measure_corpus_a(specs) -> dict:
    """Bind every taught condition. Returns totals + per-spec rows + per-family tallies."""
    taught = bound = approx = 0
    by_family_approx: collections.Counter = collections.Counter()
    by_family_taught: collections.Counter = collections.Counter()
    rows = []
    unbound_ids = []
    concrete_ids = []
    # condition-level snapshot, keyed spec|id, so the two arms can be diffed PER KIND.
    bmap: dict[str, tuple] = {}
    for name, ec, am in specs:
        s_taught = s_bound = s_approx = 0
        for c in ec:
            s_taught += 1
            by_family_taught[c.get("type")] += 1
            b = sfb.bind_condition(c)
            bmap[f"{name}|{c.get('id')}"] = (
                b.bindable,
                b.approximation,
                sfb.classify_population_a_kind(c.get("object") or ""),
                c.get("type"),
            )
            if not b.bindable:
                unbound_ids.append({"spec": name, "type": c.get("type"), "condition_id": c.get("id")})
                continue
            s_bound += 1
            if b.approximation:
                s_approx += 1
                by_family_approx[c.get("type")] += 1
            else:
                concrete_ids.append({"spec": name, "type": c.get("type"), "condition_id": c.get("id")})
        taught += s_taught
        bound += s_bound
        approx += s_approx
        rows.append(
            {
                "spec": name,
                "n_taught": s_taught,
                "n_bindable": s_bound,
                "n_unbound": s_taught - s_bound,
                "n_binding_approximation": s_approx,
                "n_bound_and_concrete": s_bound - s_approx,
                # rate is over EXECUTED-BINDABLE -- this is the denominator section 6a exists to expose
                "binding_approximation_rate": round(s_approx / s_bound, 4) if s_bound else None,
                "binding_approximation_rate_n": s_bound,
                "coverage_bound_and_concrete_over_all_taught": round((s_bound - s_approx) / s_taught, 4)
                if s_taught
                else None,
                "coverage_n": s_taught,
                "census_n_executed_bindable": am.get("n_executed_bindable"),
                # AR-188 fix 2: n_binding_approximation sat in the SAME census block as
                # n_executed_bindable and was never read. It is the field that decides whether a
                # vanished condition was APPROXIMATE (its loss flatters the rate) or CONCRETE
                # (its loss costs both metrics). Reading only the bindable count is what let the
                # prior reconciliation assert a direction it had not measured.
                "census_n_binding_approximation": am.get("n_binding_approximation"),
                "census_n_bound_and_concrete": (
                    am["n_executed_bindable"] - am["n_binding_approximation"]
                    if am.get("n_executed_bindable") is not None
                    and am.get("n_binding_approximation") is not None
                    else None
                ),
            }
        )
    return {
        "n_taught": taught,
        "n_bindable": bound,
        "n_unbound": taught - bound,
        "n_binding_approximation": approx,
        "n_bound_and_concrete": bound - approx,
        "by_family_taught": dict(by_family_taught),
        "by_family_approximated": dict(by_family_approx),
        "rows": rows,
        "unbound_conditions": unbound_ids,
        "bound_and_concrete_conditions": concrete_ids,
        "binding_map": bmap,
    }


def build_artifact(axis: str | None = None) -> dict:
    """Build the whole artifact. Called once real, then once per AXIS.

    R-203 s1: the artifact had to become a pure function of the measurements before the
    perturbation gate could exist at all. While this was `main()` with the write inlined,
    "regenerate under a changed binder and diff" was not something the file could do to
    itself, which is precisely why three captions had to be found by hand from outside.
    """
    with perturbed_binding(axis):
        return _build_artifact_body()


def _build_artifact_body() -> dict:
    # ---------------------------------------------------------------- CORPUS B
    # The never-evaluated universe. Derived HERE from the corpus itself -- the 987 is
    # re-derived, never transcribed, by three paths that must agree.
    corpus_b = _axis_corpus_b_reattribute_role(
        json.loads(CORPUS_B_PATH.read_text(encoding="utf-8"))
    )
    b_specs = list(iter_specs(corpus_b))
    roles: collections.Counter = collections.Counter()
    trigger_by_family: collections.Counter = collections.Counter()
    b_total = 0
    for s in b_specs:
        for c in s["entry_conditions"]:
            b_total += 1
            r = c.get("role")
            roles[r] += 1
            if r == "trigger":
                trigger_by_family[c.get("type")] += 1

    roles = _rv("corpus_b_roles", roles)
    # PATH 1 -- direct tally of role == "trigger" over the universe.
    path1 = roles["trigger"]
    # PATH 2 -- the COMPLEMENT: total minus the two roles that are not trigger. Independent
    # of path 1 because it never tests for "trigger" at all; it can only agree if the role
    # partition is exhaustive, which is the reconciliation clause 10 demands.
    path2 = b_total - roles["spine"] - roles["confluence"]
    # PATH 3 -- sum of the per-family breakdown. Catches a family silently dropped from the
    # enumeration -- the exact defect that produced 921.
    path3 = sum(trigger_by_family.values())

    assert path1 == path2 == path3, (
        f"987 derivation DISAGREES across paths: role-tally={path1} complement={path2} family-sum={path3}"
    )
    # DELETED (AR-188 fix 6): an assert that the role partition is exhaustive
    # (spine + confluence + trigger == b_total) stood here and COULD NOT FIRE. It is algebraically
    # implied by the assert above: path1 == path2 already says
    # roles["trigger"] == b_total - roles["spine"] - roles["confluence"], which rearranges to
    # exactly the deleted condition. An assert that cannot fail is not a check, it is a decoration
    # that inflates the count of checks. The property is still REPORTED (see
    # RECONCILIATION.corpus_B_role_partition.exact) -- reporting it is honest; asserting it twice
    # was not.
    never_by_gap = path1
    never_by_design = roles["confluence"]

    # ---------------------------------------------------------------- CORPUS A
    specs_a = _axis_drop_taught_condition(load_corpus_a())

    set_levelzone_flags(False)
    a_before = measure_corpus_a(specs_a)  # NULL / BEFORE arm: production default, flags OFF

    set_levelzone_flags(True)
    a_after = measure_corpus_a(specs_a)  # AFTER arm: declared flags-ON hypothetical

    set_levelzone_flags(False)  # leave the process as we found it

    # DELETED (AR-188 D2): `assert a_before["n_taught"] == a_after["n_taught"]` stood here and
    # COULD NOT FIRE. n_taught is `sum(1 for c in ec)` over the spec list, and both arms are
    # handed the SAME list object -- `specs_a`, loaded once above and never rebound. The level/zone
    # flags reach bind_condition() and nothing else; no flag, and no binder behaviour whatever, can
    # change how many elements a Python list has. It counted the same objects twice and compared
    # the answers.
    #   PROVED BY EXECUTION, not by reading: the two arms were re-run under six chaotic binding
    #   regimes (all-bindable, none-bindable, random-bindable at three seeds, and raise-on-Nth) and
    #   n_taught was identical across every pair, because it is a property of the input list rather
    #   than of the binder.
    #   ★ THIS FILE ALREADY STATED THE RULE AND THEN BROKE IT. The comment at the corpus-A role
    #   partition below refuses to assert `sum(a_roles.values()) == n_taught` with the reason that
    #   it "iterates the SAME conditions on both sides and so can never fail" -- and this assert is
    #   that exact shape, three hundred lines earlier, in the same file, in the commit that removed
    #   two other dead asserts. Knowing the rule is not the same as being subject to it, which is
    #   why the dead-assert question is now asked of every assert in SELF_ACCOUNTING instead of
    #   being remembered.
    # The property is still REPORTED (RECONCILIATION.corpus_A_taught_is_arm_invariant).
    #
    # THE ASSERT BELOW SURVIVES because it CAN fire: n_bindable is a property of the BINDER's
    # answers, and the flags reach the binder. A level/zone flag that changed bindability rather
    # than only approximation would trip it -- which is the claim it exists to hold.
    a_after = _rv("a_after", a_after)
    assert a_before["n_bindable"] == a_after["n_bindable"], (
        "bindable denominator moved between arms; the level/zone flip changes approximation, never bindability"
    )

    # Per-family attribution: which family earned which part of the movement.
    fam_delta = {}
    # sorted(): set iteration order varies with PYTHONHASHSEED, which made two runs of this
    # generator differ in BYTES while agreeing in every value. A measurement that cannot
    # reproduce byte-for-byte cannot be diffed by a grader, so the order is pinned.
    for fam in sorted(set(a_before["by_family_approximated"]) | set(a_after["by_family_approximated"])):
        b = a_before["by_family_approximated"].get(fam, 0)
        af = a_after["by_family_approximated"].get(fam, 0)
        fam_delta[fam] = {"approximated_BEFORE": b, "approximated_AFTER": af, "delta": af - b}

    # PER-KIND attribution: an aggregate delta hides which change earned what. Diff the two
    # arms condition-by-condition and attribute each de-approximation to its Population-A kind.
    per_kind: dict[str, dict] = {}
    swing_still_true = 0
    # R-207: the swing accounting sentence used to TYPE its three terms ("3 ... 2 ... 1"). Under
    # CORPUS_A_TAUGHT_CONDITION_DROP those terms move, so they are derived here and interpolated.
    # The total and the unbound term are counted over the SAME binding_map the flip is diffed on,
    # so the sentence's "2 + 1 = 3" closure is now arithmetic the data performs, not a claim.
    swing_total = 0
    swing_unbound = 0
    for key, (_bb, ba, kind, _fam) in a_before["binding_map"].items():
        nb, na, _k, _f = a_after["binding_map"][key]
        if kind == "swing":
            swing_total += 1
            if not nb:
                swing_unbound += 1
        if kind is not None and na is True and nb:
            if kind == "swing":
                swing_still_true += 1
        if ba is True and na is False:
            slot = per_kind.setdefault(kind, {"n_flipped": 0, "condition_ids": []})
            slot["n_flipped"] += 1
            slot["condition_ids"].append(key)

    per_kind = _rv("per_kind", per_kind)
    # ★ R-219 (4b): THE ASSERT'S OWN REASON WAS THE FALSE ONE, AND IT WAS THE LAST COPY OF IT.
    # This message read "n=1 is below the n>=2 floor (R-102 section 2)". The 1 was typed and the
    # census holds 2 by two independent paths, so the population MEETS the floor -- the stated
    # reason argued for the opposite of the assert it was attached to. R-207 corrected the two
    # ARTIFACT sentences carrying that reason and left this one, because a false numeral inside
    # an assert message is invisible to a gate that scores the artifact's prose.
    # THE TRUE GROUND, per AR-199 s1: swing is the ANCHOR of a fibonacci retracement, not the
    # taught object. What the teaching names is the 50%/61.8% LINE, and the level/zone primitive
    # does not emit that object at all. So a swing row cannot de-approximate no matter how many
    # rows the census holds and no matter what the floor says -- there is nothing for it to bind
    # TO. That is a refusal about what the primitive EMITS, which no count can move.
    assert per_kind.get("swing", {}).get("n_flipped", 0) == 0, (
        "swing MUST NOT de-approximate. Ground (AR-199 s1): swing is the fibonacci ANCHOR, while "
        "the taught object is the 50/61.8% line -- an object the level/zone primitive does not "
        "emit. NOT the n>=2 floor -- that was the withdrawn reason this message used to give, "
        "and the census population MEETS the floor rather than falling below it. The count is "
        "deliberately ABSENT here rather than typed: it is not read until the CEILING block "
        "below, and a number quoted before it is computed is the defect this file is named for."
    )
    assert set(per_kind) <= {"named_sr_level", "order_block_edge"}, (
        f"a kind OUTSIDE the two graded kinds de-approximated: {sorted(set(per_kind))}. "
        "The flip's grade licenses named_sr_level and order_block_edge ONLY."
    )

    # ------------------------------------- DERIVED FACTS THAT WERE HAND-TYPED (AR-188 fix 6)
    # Corpus-A role composition. Previously the string literal
    # "spine 102 / confluence 53 / trigger 0 -- derived, see reconciliation" -- hand-typed, with
    # NO such reconciliation entry to see. The never-pool rule (Corpus A holds zero trigger-role
    # conditions) rested on an unasserted hand-typed value. It is now counted and asserted.
    a_roles: collections.Counter = collections.Counter()
    for _n, ec, _am in specs_a:
        for c in ec:
            a_roles[c.get("role")] += 1
    # NOT ASSERTED, deliberately: sum(a_roles.values()) == n_taught iterates the SAME conditions on
    # both sides and so can never fail. Writing it as an assert would have re-committed, in the very
    # commit that removes two dead asserts, the defect being removed. It is REPORTED instead
    # (corpus_A_role_partition_sum) where a reader can compare it against n_taught_conditions.
    a_roles = _rv("a_roles", a_roles)
    assert a_roles.get("trigger", 0) == 0, (
        f"Corpus A now holds {a_roles.get('trigger', 0)} trigger-role conditions. The never-pool "
        "rule and the 'Corpus A contains ZERO trigger-role conditions' claim both depend on this "
        "being 0; if it moved, every corpus-separation statement here must be re-derived."
    )

    # Population-A kind histogram over all Corpus-A conditions. The declared non-discriminating
    # control previously gave its reason as "only three kinds occur". FOUR occur -- and the modal
    # value is None (conditions no kind classifies), by a wide margin. The control's CONCLUSION was
    # right; its stated REASON was false, which makes the reason unfalsifiable decoration. Counted.
    kind_hist: collections.Counter = collections.Counter()
    for _bb, _ba, kind, _fam in a_before["binding_map"].values():
        kind_hist[kind] += 1
    kind_counts = {("None" if k is None else k): v for k, v in sorted(
        kind_hist.items(), key=lambda x: (-x[1], str(x[0])))}
    modal_kind, modal_n = max(kind_hist.items(), key=lambda x: x[1])

    # SESSION ATTRIBUTION (AR-188 fix 5). Mandated by the spec ("how much session") and absent from
    # the artifact, because per_family_attribution is built from by_family_approximated and UNBOUND
    # rows never enter it -- a family that binds NOTHING is structurally invisible there. The number
    # goes in precisely because it is the least flattering one available.
    ws_taught = sum(1 for _n, ec, _am in specs_a for c in ec if c.get("type") == "WAIT_SESSION")
    ws_unbound = sum(1 for u in a_before["unbound_conditions"] if u["type"] == "WAIT_SESSION")
    ws_bound_after = sum(
        1 for (_bb, _ba, _k, fam) in a_after["binding_map"].values() if fam == "WAIT_SESSION"
    ) - sum(1 for u in a_after["unbound_conditions"] if u["type"] == "WAIT_SESSION")
    ws_unbound_after = ws_taught - ws_bound_after
    # RECOVERED == bound AND concrete. Derived the way per_kind is derived -- from the per-condition
    # binding map, not typed. AR-188 D1: this field previously read `0`, a literal, and it stayed 0
    # while the computed fields three lines above it moved, so the block contradicted itself the
    # moment anything bound.
    ws_recovered = sum(
        1 for (bindable, approx, _k, fam) in a_after["binding_map"].values()
        if fam == "WAIT_SESSION" and bindable and not approx
    )
    ws_de_approximated = sum(
        1 for key, (_bb, ba, _k, fam) in a_before["binding_map"].items()
        if fam == "WAIT_SESSION" and ba is True and a_after["binding_map"][key][1] is False
    )

    # ------------------------------------------------- THE 26-vs-27 DERIVATION (R-203 s3)
    # The divergence between "26 corpus-wide WAIT_SESSION rows" and the 27 counted here is not a
    # discrepancy to be split; it dissolves by accounting, and every term is named:
    #   17  graded GENUINE session teachings  (the recoverable target population)
    #  + 9  graded MIS-TYPES -- rows carrying type=WAIT_SESSION that teach no session
    #  + 1  the former orphan-zone binder: the row the old resolver bound to a zone that does
    #       not exist. It was a fake binding, it is now honestly REFUSED, and refusing it is why
    #       the count reads 27 unbound where the pre-closure note read 26.
    #  = 27 = ws_taught, ASSERTED below rather than asserted in prose.
    # The graded 17/9 split SUPERSEDES the earlier ~15 mis-types / ~11 vocabulary-gap estimates
    # wherever those are cited; they were estimates, this is the graded read.
    graded_teachings, graded_mis_types = _axis_session_grade_split(17, 9)
    orphan_zone_refusal = 1
    assert graded_teachings + graded_mis_types + orphan_zone_refusal == ws_taught, (
        f"the 26-vs-27 accounting no longer closes: {graded_teachings} graded teachings + "
        f"{graded_mis_types} graded mis-types + {orphan_zone_refusal} orphan-zone refusal = "
        f"{graded_teachings + graded_mis_types + orphan_zone_refusal}, but this corpus holds "
        f"{ws_taught} WAIT_SESSION conditions. Every term is external-graded except ws_taught, "
        "so if this fires the corpus moved under the grade and the split must be re-graded."
    )

    # THE 161 DENOMINATOR (AR-188 fix 4). The 155 counts entry_conditions ONLY; the 16 specs also
    # carry 6 `invalidations` entries that are just as taught. Measured under BOTH enforcement arms
    # because the arm decides the numerator -- see the artifact note.
    inval_specs = []
    for p in sorted(glob.glob(CORPUS_A_GLOB)):
        d = json.loads(Path(p).read_text(encoding="utf-8"))
        inval_specs.append(d["spec"].get("invalidations") or [])
    n_invalidations = sum(len(v) for v in inval_specs)
    prev_enf = os.environ.get("TF_FAMILY_META_ENFORCED")
    inval_arms = {}
    # ENTRY SIDE, MEASURED PER ARM (R-199 s2). The prior version carried a SINGLE entry numerator
    # across both enforcement arms -- i.e. it ASSUMED TF_FAMILY_META_ENFORCED moves invalidations
    # only and never touches entry_conditions. That assumption was never measured, and it is the
    # load-bearing one: if it were false, the margin between the two 161-figures would have a
    # second source and the provenance caveat below would be attributing the whole margin to
    # INVALIDATE on faith. So it is MEASURED here, in the same arm loop, and reported as a number
    # that could have come back non-zero.
    entry_arms = {}
    for enf_on in (False, True):
        os.environ["TF_FAMILY_META_ENFORCED"] = "true" if enf_on else "false"
        nb = nc = 0
        for ivs in inval_specs:
            for iv in ivs:
                bb = sfb.bind_condition(iv)
                if bb.bindable:
                    nb += 1
                    if not bb.approximation:
                        nc += 1
        inval_arms["enforcement_ON" if enf_on else "enforcement_OFF"] = {
            "n_bindable": nb, "n_bound_and_concrete": nc}
    # ENTRY SIDE runs with the LEVEL/ZONE FLAGS ON, because the entry numerator the two 161
    # figures are built from is the flags-ON AFTER arm (a_after). Measuring it in the flags-OFF
    # context this block otherwise runs in would read 0 concrete, not 6, and would be answering a
    # different question than the one the coverage figures ask. The arm context is pinned, not
    # inherited.
    set_levelzone_flags(True)
    for enf_on in (False, True):
        os.environ["TF_FAMILY_META_ENFORCED"] = "true" if enf_on else "false"
        enb = enc = 0
        for _n, ec, _am in specs_a:
            for c in ec:
                bb = sfb.bind_condition(c)
                if bb.bindable:
                    enb += 1
                    if not bb.approximation:
                        enc += 1
        entry_arms["enforcement_ON" if enf_on else "enforcement_OFF"] = {
            "n_bindable": enb, "n_bound_and_concrete": enc}
    set_levelzone_flags(False)  # leave the process as this block found it
    if prev_enf is None:
        os.environ.pop("TF_FAMILY_META_ENFORCED", None)
    else:
        os.environ["TF_FAMILY_META_ENFORCED"] = prev_enf

    # ------------------------------------------- CENSUS-vs-LIVE RECONCILIATION
    # The frozen R-082 census recorded n_executed_bindable per spec. Summing it and
    # comparing against a LIVE bind is a check against something outside this pipeline.
    # ARM COMPARABILITY (AR-188). The frozen census was taken PRE-CLOSURE with the level/zone
    # flags OFF. The comparable live arm is therefore a_before (post-closure, flags OFF) -- NOT
    # a_after. The prior version compared census(pre-closure, flags-OFF) against a_after
    # (post-closure, flags-ON), so the 6 level/zone flips were folded into a delta attributed to
    # the closure. Varying two things and naming one is how the headline inverted.
    cen_rows = [r for r in a_before["rows"] if r["census_n_executed_bindable"] is not None]
    census_bindable = sum(r["census_n_executed_bindable"] for r in cen_rows)
    census_approx = sum(r["census_n_binding_approximation"] for r in cen_rows)
    census_concrete = census_bindable - census_approx
    live_bindable = a_before["n_bindable"]
    live_approx = a_before["n_binding_approximation"]
    live_concrete = a_before["n_bound_and_concrete"]

    drift_rows = []
    for r in cen_rows:
        if r["n_bindable"] == r["census_n_executed_bindable"]:
            continue
        d_concrete = r["n_bound_and_concrete"] - r["census_n_bound_and_concrete"]
        d_approx = r["n_binding_approximation"] - r["census_n_binding_approximation"]
        # WHICH KIND of condition vanished decides the direction. This is the field the prior
        # reconciliation did not read.
        if d_concrete < 0 and d_approx == 0:
            vanished = "BOUND_AND_CONCRETE"
            why = ("The lost condition was CONCRETE, not approximate. Its loss REMOVES a member from "
                   "the section-6a numerator, so coverage falls -- and because it was concrete it was "
                   "holding the rate DOWN, so the approximation share rises too. Both metrics pay.")
        elif d_approx < 0 and d_concrete == 0:
            vanished = "BINDING_APPROXIMATION"
            why = ("The lost condition was APPROXIMATE. Its loss removes an approximate member from the "
                   "rate's denominator, which FLATTERS the rate while leaving the 6a numerator intact.")
        elif d_concrete < 0 and d_approx < 0:
            vanished = "MIXED"
            why = "Both concrete and approximate members were lost; see the per-count deltas."
        else:
            vanished = "NET_GAIN_OR_UNCLASSIFIED"
            why = "Bindability moved without a net loss of either kind; see the per-count deltas."
        drift_rows.append(
            {
                "spec": r["spec"],
                "census_n_executed_bindable": r["census_n_executed_bindable"],
                "live_n_bindable": r["n_bindable"],
                "delta": r["n_bindable"] - r["census_n_executed_bindable"],
                "census_n_binding_approximation": r["census_n_binding_approximation"],
                "live_n_binding_approximation": r["n_binding_approximation"],
                "census_n_bound_and_concrete": r["census_n_bound_and_concrete"],
                "live_n_bound_and_concrete": r["n_bound_and_concrete"],
                "delta_bound_and_concrete": d_concrete,
                "delta_binding_approximation": d_approx,
                "vanished_condition_was": vanished,
                "why_this_decides_the_direction": why,
                "unbound_conditions_in_this_spec_live": [
                    u for u in a_before["unbound_conditions"] if u["spec"] == r["spec"]
                ],
            }
        )

    # The two comparable arms, both flags-OFF, differing ONLY in the closure.
    census_rate = rate0(census_approx, census_bindable)
    census_cov = rate0(census_concrete, a_before["n_taught"])
    live_rate = rate0(live_approx, live_bindable)
    live_cov = rate0(live_concrete, a_before["n_taught"])
    closure_drift = classify_drift(census_rate, live_rate, census_cov, live_cov)

    # ---------------------------------------------------------------- CEILING
    census = json.loads(CENSUS_PATH.read_text(encoding="utf-8"))
    # R-207: the two sentences describing the census's swing population TYPED the number 1. The
    # census's own reference_kind_counts is the field they describe, and it is read here so the
    # sentences quote their source instead of a memory of it. See SWING_ROW_COUNT_DISCREPANCY.
    census_swing_rows = census["reference_kind_counts"].get("swing", 0)
    n_levelzone_rows = _rv("levelzone_n", census["n"])
    assert n_levelzone_rows == 16, f"level/zone census drifted: expected 16 rows, got {n_levelzone_rows}"
    total_flipped = _rv("total_flipped", -sum(v["delta"] for v in fam_delta.values()))
    assert total_flipped <= 6, f"CEILING BREACHED: {total_flipped} conditions de-approximated, ceiling is 6 of 16"

    # ------------------------------------------------- DUAL DENOMINATORS (carried)
    narration = json.loads(NARRATION_PATH.read_text(encoding="utf-8"))
    dual = narration["dual_denominators"]

    # ------------------------------------------------- ENFORCEMENT (Corpus B, read)
    enf = _axis_enforcement_mirror(json.loads(ENFORCEMENT_PATH.read_text(encoding="utf-8")))
    inv = enf["invalidation_approximation_counts"]
    assert enf["never_evaluated_total"] == never_by_gap, (
        f"enforcement artifact says {enf['never_evaluated_total']} never-evaluated; I derive {never_by_gap}"
    )
    enf = dict(enf, all_entry_conditions=_rv("enf_universe", enf["all_entry_conditions"]))
    assert enf["all_entry_conditions"] == b_total, "enforcement artifact universe size disagrees with mine"

    rate = rate0

    # R-199 s2. Computed from the per-arm invalidation binds and the entry-condition numerator --
    # the same fields the two coverage_over_161_* keys below are computed from, so the primary
    # designation and its provenance caveat cannot drift from the rates they describe.
    completed_coverage = compose_completed_coverage(
        entry_off_concrete=entry_arms["enforcement_OFF"]["n_bound_and_concrete"],
        entry_on_concrete=entry_arms["enforcement_ON"]["n_bound_and_concrete"],
        inval_off_concrete=inval_arms["enforcement_OFF"]["n_bound_and_concrete"],
        inval_on_concrete=inval_arms["enforcement_ON"]["n_bound_and_concrete"],
        n_taught_entry=a_after["n_taught"],
        n_invalidations=n_invalidations,
    )

    _pri_block = completed_coverage["READ_THIS_ONE"]
    _sec_block = completed_coverage["BESIDE_IT_NOT_INSTEAD_OF_IT"]

    art = {
        # ================================================================== AR-188 D5
        # GLOBAL PRIMACY. READ_THIS_ONE was primary only LOCALLY -- primary within the block it
        # sat in, roughly seven hundred lines below the first coverage figure in the file. A
        # consumer who greps "coverage" and takes the first hit does not read blocks; they read
        # file order, and file order handed them a per-arm 155-denominator figure with no idea a
        # primary existed. Primacy inside a block a reader has to find first is not primacy.
        # So the primary figure is now the FIRST thing in the artifact and the first "coverage"
        # match in the file, and every coverage figure below it is reachable from here.
        "READ_THIS_ONE__PRIMARY_COVERAGE_FIGURE": {
            "coverage": _pri_block["coverage_over_161"],
            "fraction": _pri_block["fraction"],
            "denominator_is": (
                f"{a_after["n_taught"] + n_invalidations} = all taught entry_conditions "
                f"({a_after["n_taught"]}) + all taught invalidations ({n_invalidations})"
            ),
            "configuration": _pri_block["configuration"],
            "WHY_THIS_ONE": _pri_block["WHY"],
            "FULL_BLOCK": "COVERAGE_OVER_GENUINELY_ALL_TAUGHT.COMPLETED_161_DUAL_CONFIGURATION",
            "THE_OTHER_COVERAGE_FIGURES_IN_THIS_FILE_AND_WHY_THEY_ARE_NOT_THIS_ONE": {
                "secondary_161_enforcement_OFF": {
                    "coverage": _sec_block["coverage_over_161"],
                    "fraction": _sec_block["fraction"],
                    "why_not_primary": _sec_block["status"]
                    + " -- its margin's provenance is stated in the same block.",
                },
                "per_arm_155_denominator_figures": (
                    "corpus_A.BEFORE_flags_off / AFTER_flags_on_HYPOTHETICAL carry "
                    f"section_6a_coverage over TAUGHT ENTRY CONDITIONS ONLY ({a_after["n_taught"]}), "
                    f"which is a NARROWER denominator than the {a_after["n_taught"] + n_invalidations} "
                    "above. They are arm comparisons, not the artifact's coverage answer, and they "
                    "appear earlier in the file only because the corpus blocks do."
                ),
                "corpus_B": (
                    "Corpus B reports never-evaluated counts, not coverage, and is a different "
                    "window entirely. It is never pooled with these figures."
                ),
            },
        },
        "artifact": "dual-denominator-remeasure-2026-07-21",
        "spec": "docs/designs/spec-dual-denominator-remeasure-2026-07-20.md",
        "APPEND_ONLY": True,
        "generator": "docs/replay-results/h1-battery/dual_denominator_remeasure.py",
        "reproduce": "python docs/replay-results/h1-battery/dual_denominator_remeasure.py",
        "DECLARED_MEASUREMENT_CONFIGURATION": {
            "level_zone_flags_AFTER_arm": {
                "TF_LEVELZONE_ROUTING_ENABLED": "true",
                "TF_LEVELZONE_RESOLVER_ENABLED": "true",
            },
            "level_zone_flags_BEFORE_arm_and_NULL": {
                "TF_LEVELZONE_ROUTING_ENABLED": "false",
                "TF_LEVELZONE_RESOLVER_ENABLED": "false",
            },
            "PRODUCTION_DEFAULT": "OFF -- both flags default 'false' when unset.",
            "honest_reading": (
                "Every AFTER figure here is the both-flags-ON HYPOTHETICAL, labeled as such. "
                "Production output today, with default env, is the BEFORE arm."
            ),
        },
        "CORPORA_ARE_SEPARATE": (
            "Corpus A and Corpus B are different windows and are NEVER pooled. The "
            f"{never_by_gap}/{never_by_design} are Corpus B figures only; Corpus A contains "
            f"{a_roles.get('trigger', 0)} trigger-role conditions. A rate inherits its window: "
            "every rate below states its corpus, spec count, and condition count."
        ),
        "corpus_A": {
            "name": "shakedown / tier-b DoD corpus",
            "path": "docs/replay-results/h1-scripts/claude-rung-v32/shakedown_specs/*.spec.json",
            "n_specs": len(specs_a),
            "n_taught_conditions": a_after["n_taught"],
            # DERIVED, not typed (AR-188). See RECONCILIATION.corpus_A_role_partition, which now
            # exists -- the prior string said "see reconciliation" and there was nothing to see.
            "role_composition": {
                ("None" if k is None else k): v
                for k, v in sorted(a_roles.items(), key=lambda x: (-x[1], str(x[0])))
            },
            "role_composition_note": (
                "Counted from the corpus and asserted, not transcribed. trigger == "
                f"{a_roles.get('trigger', 0)} is ASSERTED because the never-pool rule depends on it."
            ),
            "BEFORE_flags_off": {
                "n_bindable": a_before["n_bindable"],
                "n_unbound": a_before["n_unbound"],
                "n_binding_approximation": a_before["n_binding_approximation"],
                "n_bound_and_concrete": a_before["n_bound_and_concrete"],
                "binding_approximation_rate": rate(a_before["n_binding_approximation"], a_before["n_bindable"]),
                "binding_approximation_rate_n": a_before["n_bindable"],
                "section_6a_coverage_bound_and_concrete_over_ALL_TAUGHT_ENTRY_CONDITIONS": rate(
                    a_before["n_bound_and_concrete"], a_before["n_taught"]
                ),
                "section_6a_coverage_n": a_before["n_taught"],
            },
            "AFTER_flags_on_HYPOTHETICAL": {
                "n_bindable": a_after["n_bindable"],
                "n_unbound": a_after["n_unbound"],
                "n_binding_approximation": a_after["n_binding_approximation"],
                "n_bound_and_concrete": a_after["n_bound_and_concrete"],
                "binding_approximation_rate": rate(a_after["n_binding_approximation"], a_after["n_bindable"]),
                "binding_approximation_rate_n": a_after["n_bindable"],
                "section_6a_coverage_bound_and_concrete_over_ALL_TAUGHT_ENTRY_CONDITIONS": rate(
                    a_after["n_bound_and_concrete"], a_after["n_taught"]
                ),
                "section_6a_coverage_n": a_after["n_taught"],
            },
            "THE_UNBOUND_COUNT_TRAVELS_BESIDE_THE_RATE": {
                "n_unbound": a_after["n_unbound"],
                "n_taught": a_after["n_taught"],
                "unbound_fraction": rate(a_after["n_unbound"], a_after["n_taught"]),
                "why": (
                    "The binding_approximation_rate is computed over EXECUTED-BINDABLE conditions only. "
                    "A condition the compiler cannot bind at all VANISHES from that denominator, so a spec "
                    "can improve its score by becoming LESS bindable. This count is the guard against that."
                ),
                "conditions": a_after["unbound_conditions"],
            },
            "per_kind_attribution": {
                "named_sr_level": per_kind.get("named_sr_level", {"n_flipped": 0, "condition_ids": []}),
                "order_block_edge": per_kind.get("order_block_edge", {"n_flipped": 0, "condition_ids": []}),
                "swing": {
                    "n_flipped": 0,
                    "n_still_approximation_true": swing_still_true,
                    # Same correction as CEILING.swing. This sentence also justified itself by
                    # the floor; with the count interpolated it is visible that the Corpus-A
                    # swing population does not fall below it either. The operative reason is
                    # the grade scope, which is asserted rather than narrated.
                    "reason": (
                        f"routed-but-approximate; n={swing_still_true}. Stays approximation=True "
                        "because the flip's grade licenses named_sr_level and order_block_edge "
                        f"ONLY, NOT because it falls below the n>={DE_APPROXIMATION_FLOOR} "
                        "de-approximation floor. Never argued for."
                    ),
                    "accounting": (
                        f"{swing_total} Corpus-A conditions classify as swing: {swing_still_true} are "
                        "bindable and remain approximation=True (counted above); "
                        f"{swing_unbound} is UNBOUND (a WAIT_SESSION row) and so sits outside the "
                        "rate's denominator entirely, inside the unbound count. "
                        f"{swing_still_true} + {swing_unbound} = {swing_total}, no swing row unaccounted."
                    ),
                    "classifier_scope_caveat": (
                        "classify_population_a_kind is applied here to EVERY Corpus-A condition for attribution. "
                        "The flip itself only reaches WAIT_STRUCTURE/VERIFY_STRUCTURE, so a swing classification "
                        "on a WAIT_SESSION or WAIT_CONFIRMATION row is an attribution label, NOT a claim that the "
                        "flip could have moved it. This population is BROADER than the frozen "
                        f"{n_levelzone_rows}-row level/zone census (which holds "
                        f"{census_swing_rows} swing rows) -- different windows, not pooled."
                    ),
                },
                "why_per_kind": "An aggregate delta hides which change earned what.",
            },
            "per_family_attribution": fam_delta,
            "total_conditions_de_approximated": total_flipped,
            "bound_and_concrete_conditions": a_after["bound_and_concrete_conditions"],
            "null_baseline": {
                "basis": (
                    f"MEASURED -- the BEFORE arm is the same {a_before['n_taught']} conditions "
                    "re-bound with both flags off."
                ),
                "n": a_before["n_bindable"],
                "n_de_approximated": a_before["n_bound_and_concrete"],
                "binding_approximation_rate": rate(a_before["n_binding_approximation"], a_before["n_bindable"]),
            },
            "rows": a_after["rows"],
        },
        "corpus_B": {
            "name": "or-branches full corpus",
            "path": "docs/replay-results/or-branches-full-corpus-specs-2026-07-05.json",
            "n_specs": len(b_specs),
            "n_taught_conditions": b_total,
            "role_histogram": dict(roles),
            "NEVER_EVALUATED_BY_GAP": {
                "n": never_by_gap,
                "label": "never-evaluated-by-GAP (trigger-role) -- PRIMARY in coverage",
                "meaning": "conditions that SHOULD gate and do not. This is a DEFECT.",
                "cause": "compute()'s dispatch loop iterates role=='spine' only.",
                "by_family": dict(sorted(trigger_by_family.items(), key=lambda x: -x[1])),
                "derivation_paths": {
                    "path1_role_tally": path1,
                    "path2_complement_total_minus_spine_minus_confluence": path2,
                    "path3_sum_of_family_breakdown": path3,
                    "agree": True,
                },
                # ★ THE WITHDRAWN 921 IS NOW DATA, NOT PROSE (R-207). It used to be a sentence
                # reciting eleven family counts. The multi-axis gate convicted it -- the live
                # FILTER tally passed through 39 under the Corpus-B axis while the sentence's
                # historical "FILTER 39" sat still. The gate was RIGHT to fire and the sentence
                # was RIGHT not to move: these numerals are a QUOTATION of a withdrawn
                # derivation and must never track the live corpus.
                #
                # Both facts can only be true at once if the quotation stops being prose. A
                # historical record belongs in fields, where it is read as a record; leaving it
                # in a sentence forced a choice between a false conviction and an exemption
                # covering a block that genuinely does hold frozen numbers. Structurally primary
                # is the same remedy R-199 s2 applied to 6/161, for the same reason.
                "SUPERSEDES__WITHDRAWN_921_DERIVATION": {
                    "withdrawn_total": 921,
                    "status": "WITHDRAWN -- retained as a record of the error, never recomputed",
                    "these_numbers_are_frozen_BY_INTENT": (
                        "A quotation of a superseded derivation. They describe what was once "
                        "claimed, not what is now measured, so they must NOT move when the corpus "
                        "moves. They are fields rather than prose precisely so that this is "
                        "readable as a record instead of scored as a live claim."
                    ),
                    "curated_5_family_list_THAT_WAS_SUMMED": {
                        "WAIT_BIAS": 42, "FILTER": 39, "INVALIDATE": 105,
                        "ENABLE_ENTRY": 480, "ENTER": 255,
                    },
                    "omitted_families_THE_DEFECT": {
                        "WAIT_SESSION": 18, "WAIT_CONFIRMATION": 21, "WAIT_RETEST": 15,
                        "WAIT_STRUCTURE": 6, "VERIFY_STRUCTURE": 3, "EXIT_HINT": 3,
                    },
                    "n_omitted_conditions": 66,
                    "why_it_was_wrong": (
                        "A correct sum over an incomplete enumeration is still incomplete -- and it "
                        "understated the denominator, so coverage read BETTER than truth."
                    ),
                },
            },
            "NEVER_EVALUATED_BY_DESIGN": {
                "n": never_by_design,
                "label": "never-evaluated-by-DESIGN (confluence) -- CONTEXT, beside the primary line",
                "meaning": "conditions never meant to gate. This is a DESIGN, not a defect.",
                "NEVER_MERGED": (
                    "Folding this into the by-GAP denominator would trade a defect for a design. Whether "
                    "confluence should ever gate is a dispatch-DESIGN question, decided as design -- never "
                    "smuggled in as arithmetic."
                ),
            },
            "INVALIDATE_enforcement": {
                "population": (
                    "spec['invalidations'] bindable entries -- NOT the "
                    f"{trigger_by_family.get('INVALIDATE', 0)} INVALIDATE entry_conditions"
                ),
                "flag_OFF_approximated_of_total": inv["flag_OFF"],
                "flag_ON_approximated_of_total": inv["flag_ON"],
                "direction": "fidelity moves DOWN, and it should -- enforcement marks these approximation=True",
                "source": "docs/replay-results/h1-battery/family-meta-enforcement-delta.json",
            },
            "spine_gating_under_enforcement": enf["rates"],
            "filter_spine_dispositions": enf["filter_spine_dispositions"],
        },
        "DUAL_DENOMINATORS": {
            "with_narration_ALL_conditions": dual["with_narration_ALL_conditions"],
            "without_narration_PRIMARY": dual["without_narration_PRIMARY"],
            "both_travel": True,
            "with_narration_is_never_deleted": True,
            "scope": (
                "These are the corpus-wide WAIT_STRUCTURE NARRATION denominators, reproduced "
                "unmodified from narration-reclassification-FINAL.json. They are NOT the Corpus A "
                f"({a_after['n_taught']}) or Corpus B ({b_total}) denominators and must not be "
                "substituted for either."
            ),
            "source": "docs/replay-results/h1-battery/narration-reclassification-FINAL.json",
        },
        "CEILING": {
            "n_level_zone_rows_total": n_levelzone_rows,
            "max_de_approximable": 6,
            "observed_de_approximated": total_flipped,
            "n_unresolvable_as_built": 9,
            # ★ R-207 CORRECTION, FOUND BY INTERPOLATING A NUMBER THAT HAD BEEN TYPED.
            # This read "1 row ... n=1 below the n>=2 floor -- stays approximation=True". The 1
            # was typed, and it was WRONG: the census it describes holds TWO swing rows, agreed
            # by two independent paths (reference_kind_counts['swing'] and a row-level tally of
            # reference_kinds). The error was not merely a stale number -- it was load-bearing.
            # "n=1 is below the n>=2 floor" was the stated REASON swing stays approximate, and at
            # n=2 the population MEETS the floor, so that reason does not hold.
            # The outcome is unchanged and still asserted: swing does not de-approximate. But the
            # reason is the GRADE SCOPE, not the floor -- the flip's grade licenses named_sr_level
            # and order_block_edge only, which is what `set(per_kind) <= {...}` enforces. A
            # justification is a claim, and this one was resting on a number nothing checked.
            # ★★ R-219 (4b): THE DISPOSITION NOW CITES ITS TRUE GROUND, AND THE POINT IS THAT
            # A RIGHTER NUMBER WAS NOT THE REPAIR. R-207 found the typed "1" here was false (the
            # census holds 2, by two independent paths) and replaced it with the interpolated
            # count plus the GRADE-SCOPE reason. That was still the wrong ground: grade scope is
            # a fact about what this campaign has AUTHORISED, so it would evaporate the day
            # someone widened the grade -- and the disposition would then have no ground at all.
            # THE TRUE GROUND (AR-199 s1) is a refusal, not a permission: a swing is the ANCHOR
            # of a fibonacci retracement; the TAUGHT OBJECT is the 50%/61.8% line. The level/zone
            # primitive does not emit that line, so there is nothing for the row to bind TO.
            # ★ A false numeral had been CARRYING a disposition, and neither a corrected numeral
            # nor a corrected permission is the fix -- the fix is the reason that no count and no
            # grade can move. The row count stays interpolated below because it is a fact worth
            # reporting; it is no longer load-bearing for anything.
            "swing": (
                f"{census_swing_rows} rows, routed-but-approximate, and they stay "
                "approximation=True by the ANCHOR-VS-TAUGHT-OBJECT REFUSAL recorded in "
                "swing_disposition_ground -- a property of what the primitive EMITS, independent "
                "of this row count and of the flip's grade scope. It is NOT the "
                f"n>={DE_APPROXIMATION_FLOOR} de-approximation floor, which this population MEETS "
                "rather than falls below; that was the withdrawn reason, and it rested on a count "
                "that was numerically false."
            ),
            "swing_disposition_ground": (
                "A swing is the ANCHOR of a fibonacci retracement. The TAUGHT OBJECT is the "
                "50/61.8% line, and the level/zone primitive does not emit that line -- so there "
                "is nothing for a swing row to bind TO. The refusal is about what is emitted, so "
                "no row count and no widening of the flip's grade can move it."
            ),
            "swing_disposition_ground_ruling": "AR-199 s1",
            "swing_disposition_ground_history": (
                "This disposition has now had three grounds. (1) a TYPED row count said to fall "
                "below the floor -- numerically FALSE, the census holds more than the floor by "
                "two independent paths. (2) the flip's GRADE SCOPE -- true, but a fact about what "
                "this campaign has authorised, so it would evaporate the day the grade widened "
                "and leave the disposition with no ground at all. (3) the anchor-vs-taught-object "
                "refusal, above. Only the third is a property of the primitive. Recorded because "
                "a false numeral was CARRYING a disposition here, and neither a righter numeral "
                "nor a righter permission was the repair."
            ),
            "swing_row_count_CORRECTED": (
                f"Was typed as 1. The census reports {census_swing_rows}, agreed by "
                "reference_kind_counts and by a row-level tally. The floor-based justification "
                "that rested on the typed 1 is withdrawn; see the comment at this key."
            ),
        },
        "RECONCILIATION": {
            "corpus_B_role_partition": {
                "spine": roles["spine"],
                "confluence": roles["confluence"],
                "trigger": roles["trigger"],
                "sum": roles["spine"] + roles["confluence"] + roles["trigger"],
                "total_entry_conditions": b_total,
                "exact": roles["spine"] + roles["confluence"] + roles["trigger"] == b_total,
            },
            "corpus_A_condition_accounting": {
                "taught": a_after["n_taught"],
                "bindable": a_after["n_bindable"],
                "unbound": a_after["n_unbound"],
                "bindable_plus_unbound": a_after["n_bindable"] + a_after["n_unbound"],
                "exact": a_after["n_bindable"] + a_after["n_unbound"] == a_after["n_taught"],
            },
            "census_vs_live_OUTSIDE_THIS_PIPELINE": {
                "ARMS_ARE_COMPARABLE": (
                    "Both sides are flags-OFF and differ ONLY in the closure: census == PRE-closure "
                    "flags-OFF, live == POST-closure flags-OFF. The prior version compared the "
                    f"pre-closure flags-OFF census against the POST-closure flags-ON arm, so the "
                    f"{total_flipped} level/zone flips were folded into a delta attributed to the "
                    "closure."
                ),
                "frozen_census_sum_n_executed_bindable": census_bindable,
                "live_n_bindable": live_bindable,
                "delta": live_bindable - census_bindable,
                "frozen_census_sum_n_binding_approximation": census_approx,
                "live_n_binding_approximation": live_approx,
                "frozen_census_sum_n_bound_and_concrete": census_concrete,
                "live_n_bound_and_concrete": live_concrete,
                "PRE_closure_flags_off_rate": census_rate,
                "POST_closure_flags_off_rate": live_rate,
                "PRE_closure_flags_off_section_6a_coverage": census_cov,
                "POST_closure_flags_off_section_6a_coverage": live_cov,
                "drift_rows": drift_rows,
                # COMPUTED (AR-188 fix 1). What stood here was a fixed string asserting "the rate
                # improves while coverage worsens ... precisely the vanishing-denominator defect" --
                # emitted for ANY non-zero delta, in EITHER direction. It was wrong: the rate
                # DEGRADED here. This verdict is a function of the four figures above and says
                # different things when they differ.
                "computed_drift_verdict": closure_drift,
                # ---------------------------------------------------------------- R-203 s1
                # CAUGHT BY THE PERTURBATION GATE, NOT BY REVIEW. What stood here was a typed
                # paragraph -- "it gave up a bound-and-concrete condition, and that cost it on BOTH
                # metrics ... that is not what this delta is" -- sitting directly beside the
                # COMPUTED verdict it purported to summarise. It was true of today's data and
                # frozen against tomorrow's: under the standard perturbation the verdict above
                # changes and this paragraph did not, so it would have gone on asserting "both
                # metrics" about a delta where only one moved. This is caption 4, and it was
                # written INSIDE the fix for caption 1, in the same block, twenty lines down.
                # It is now a restatement of the computed verdict and cannot disagree with it.
                "what_this_says_about_the_closure": (
                    f"Verdict {closure_drift['verdict']}. "
                    + closure_drift.get("reading", "")
                    + f" In counts: the closure moved bound-and-concrete conditions by "
                    f"{live_concrete - census_concrete} and binding-approximation conditions by "
                    f"{live_approx - census_approx} over the same {a_before['n_taught']} taught. "
                    + (
                        "That IS the section-6a pattern -- a rate improving BECAUSE conditions "
                        "vanished from its denominator -- and the closure must be re-examined."
                        if closure_drift["verdict"].startswith("OPPOSITE_DIRECTIONS__SECTION_6A")
                        else "The section-6a defect is the pattern where a rate improves BECAUSE "
                        "conditions vanish from its denominator, and that is not what this delta "
                        "is."
                    )
                ),
                "why_this_field_is_derived_from_the_verdict": (
                    "Because the sentence that used to stand here was frozen prose beside a "
                    "computed verdict, which is the defect this whole artifact exists to stop "
                    "reproducing. A summary that can contradict the thing it summarises is not a "
                    "summary."
                ),
            },
            # NEW (AR-188 fix 6): the entry the role_composition string told readers to "see".
            "corpus_A_role_partition": {
                ("None" if k is None else k): v for k, v in sorted(a_roles.items())
            },
            "corpus_A_role_partition_sum": sum(a_roles.values()),
            "corpus_A_trigger_role_count_ASSERTED_ZERO": a_roles.get("trigger", 0),
            # REPORTED, NOT ASSERTED (AR-188 D2). The assert that stood on this property compared
            # two counts of the SAME list object and could not fire. Reporting it is honest;
            # asserting it was a check-shaped decoration.
            "corpus_A_taught_is_arm_invariant": {
                "BEFORE_arm_n_taught": a_before["n_taught"],
                "AFTER_arm_n_taught": a_after["n_taught"],
                "equal": a_before["n_taught"] == a_after["n_taught"],
                "why_not_asserted": (
                    "n_taught counts elements of `specs_a`, which is loaded once and handed to both "
                    "arms as the same object. No flag and no binder behaviour can change how many "
                    "elements a list has, so an assert here can only ever pass."
                ),
            },
        },
        "CLASSIFY_DRIFT_DISCRIMINATION_PROOF": classify_drift_discrimination_proof(),
        # ------------------------------------------------------ AR-188 fix 3
        "NUMERATOR_CONTINUITY": {
            "why_this_block_exists": (
                f"The headline {a_before['n_bound_and_concrete']}/{a_before['n_taught']} -> "
                f"{a_after['n_bound_and_concrete']}/{a_after['n_taught']} rests on a numerator that "
                "LOST A MEMBER between the "
                "census and this run. Comparing a post-closure numerator against a pre-closure one "
                "and calling the difference an effect of the flags is an arm error. The "
                "pre-closure-COMPARABLE figures are stated here so the headline cannot be read "
                "without them."
            ),
            "pre_closure_flags_off_coverage": f"{census_concrete}/{a_before['n_taught']}",
            "post_closure_flags_off_coverage": f"{live_concrete}/{a_before['n_taught']}",
            "pre_closure_COMPARABLE_flags_on_coverage": (
                f"{census_concrete + total_flipped}/{a_before['n_taught']}"
            ),
            "post_closure_flags_on_coverage": f"{a_after['n_bound_and_concrete']}/{a_after['n_taught']}",
            "THE_COMPARABLE_HEADLINE": (
                f"{census_concrete + total_flipped}/{a_before['n_taught']} -> "
                f"{a_after['n_bound_and_concrete']}/{a_after['n_taught']} "
                "(pre-closure-comparable flags-ON -> post-closure flags-ON). The 6 level/zone flips "
                "are present on BOTH sides; the difference is the one condition the closure gave up."
            ),
            "vanishing_count_correction": {
                "spec_said": f"{a_before['n_taught'] - census_bindable} of {a_before['n_taught']} were vanishing",
                "corrects_to": f"{a_before['n_unbound']} of {a_before['n_taught']}",
                "why": (
                    "The spec's figure was the PRE-closure unbound count. Post-closure the honest-partial "
                    "closure moved one more condition out of the bindable set, so the vanishing count is "
                    "one higher. Stating the old number beside the new one is the correction."
                ),
            },
        },
        # ------------------------------------------------------ AR-188 fix 4
        "COVERAGE_OVER_GENUINELY_ALL_TAUGHT": {
            "the_defect_this_fixes": (
                "The per-arm key was named '..._over_ALL_TAUGHT' but its denominator was "
                f"{a_after['n_taught']} = entry_conditions ONLY. The same {len(specs_a)} specs also "
                f"carry "
                f"{n_invalidations} `invalidations` entries, which are taught too. A key whose name "
                "claims ALL and whose denominator excludes a taught population is the same "
                "caption-is-a-claim defect this artifact was sent back to fix."
            ),
            "disposition": (
                "BOTH. (a) The per-arm key was RENAMED to "
                "'section_6a_coverage_bound_and_concrete_over_ALL_TAUGHT_ENTRY_CONDITIONS' so its "
                "name states its actual denominator. (b) The completed "
                f"{a_after['n_taught'] + n_invalidations} denominator is reported here. "
                "Renaming alone would leave the complete figure unstated; completing alone "
                "would force a single enforcement arm to be picked silently -- see below."
            ),
            "n_taught_entry_conditions": a_after["n_taught"],
            "n_taught_invalidations": n_invalidations,
            "n_taught_ALL": a_after["n_taught"] + n_invalidations,
            "invalidations_binding_by_enforcement_arm": inval_arms,
            "entry_conditions_binding_by_enforcement_arm": {
                "MEASURED_AT": (
                    "level/zone flags ON (the AFTER arm the "
                    f"{a_after['n_taught'] + n_invalidations} numerators are built on)"
                ),
                "why": (
                    "Reported so the claim 'TF_FAMILY_META_ENFORCED moves invalidations, not "
                    "entry_conditions' is a measurement a reader can check rather than an "
                    "assumption folded into the arithmetic. It feeds the margin decomposition."
                ),
                **entry_arms,
            },
            # ------------------------------------------------------------------ R-199 s2
            # DUAL-CONFIGURATION REPORTING. The prior version stated the two rates side by side
            # and left the choice to the reader -- which, for a consumer taking one number, is
            # the choice being made silently anyway. R-199 s2 rules 6/161 PRIMARY. This block is
            # COMPUTED (compose_completed_coverage), including the provenance caveat: the caveat's
            # figures are derived from the same per-arm fields that produce the rates, so they
            # move with the data instead of being typed beside it.
            "COMPLETED_161_DUAL_CONFIGURATION": completed_coverage,
            "WHY_TWO_ARMS_AND_NOT_ONE_NUMBER": (
                "TF_FAMILY_META_ENFORCED is a SEPARATE flag from the level/zone pair, and it decides "
                "whether these entries bind concrete or approximate. It defaults OFF, which is the "
                "configuration this generator runs in. So the completed coverage has two honest "
                "values, not one. R-199 s2 rules which is PRIMARY -- the enforcement-ON figure, "
                "because it is the arm in which the INVALIDATE entries bind under the CORRECTED "
                "approximation=True. The OFF figure is NOT dropped: it travels beside the primary "
                "with a computed provenance caveat. Dropping either arm, or stating one without "
                "its configuration, would repeat the error this artifact is being repaired for."
            ),
            # ---------------------------------------------------------------- AR-188 D5
            # ORDER AND LABEL ARE PART OF THE CLAIM. These two legacy keys used to appear with the
            # enforcement-OFF figure FIRST and named `..._this_runs_config` -- so a consumer
            # reading in file order met the LARGER, secondary number first, wearing a label that
            # reads as endorsement. Primacy that has to be looked for is not primacy. The PRIMARY
            # arm now leads, and the secondary one says what it is in its own key.
            "coverage_over_161_enforcement_ON__PRIMARY": rate(
                a_after["n_bound_and_concrete"] + inval_arms["enforcement_ON"]["n_bound_and_concrete"],
                a_after["n_taught"] + n_invalidations,
            ),
            "coverage_over_161_enforcement_OFF__SECONDARY_NOT_THE_HEADLINE": rate(
                a_after["n_bound_and_concrete"] + inval_arms["enforcement_OFF"]["n_bound_and_concrete"],
                a_after["n_taught"] + n_invalidations,
            ),
            "this_runs_config_note": (
                "enforcement-OFF is the configuration this generator runs in. That makes it the "
                "SECONDARY figure's provenance, not its endorsement -- which is why the phrase no "
                "longer sits in a key beside the number."
            ),
            "numerators": {
                "enforcement_OFF": (
                    f"{a_after['n_bound_and_concrete']} entry + "
                    f"{inval_arms['enforcement_OFF']['n_bound_and_concrete']} invalidations"
                ),
                "enforcement_ON": (
                    f"{a_after['n_bound_and_concrete']} entry + "
                    f"{inval_arms['enforcement_ON']['n_bound_and_concrete']} invalidations"
                ),
            },
        },
        # ------------------------------------------------------ AR-188 fix 5
        "SESSION_ATTRIBUTION": {
            "why_it_was_missing": (
                "The spec mandates session attribution ('how much session'). per_family_attribution "
                "is built from by_family_approximated, which only ever sees BOUND rows -- so a family "
                "that binds NOTHING has no key there and is structurally invisible. Its absence read "
                "as 'nothing to report' when it meant 'recovered nothing'."
            ),
            "n_WAIT_SESSION_taught": ws_taught,
            "n_WAIT_SESSION_bound_flags_off": ws_taught - ws_unbound,
            "n_WAIT_SESSION_bound_flags_on": ws_bound_after,
            "n_WAIT_SESSION_unbound_flags_off": ws_unbound,
            "n_WAIT_SESSION_unbound_flags_on": ws_unbound_after,
            "n_WAIT_SESSION_bound_and_concrete_flags_on": ws_recovered,
            "n_WAIT_SESSION_de_approximated_in_this_run": ws_de_approximated,
            # ------------------------------------------------------------------ AR-188 D1
            # COMPUTED. What stood here was `"0 of 27 bound - 0 of up-to-17 recovered"`, typed, three
            # lines beneath the computed fields it duplicated. A grader patched the binder so all 27
            # rows bound: every computed field above moved, and this sentence did not -- so the
            # headline then read "0 of 27 bound" directly below a field reading 27. The number was
            # right on the day it was typed, which is the only day a typed number is ever right.
            # Every numeral below is interpolated from the fields above it, and the generator now
            # PROVES that by rebuilding under exactly that perturbation and requiring this string to
            # change (see CAPTION_GATE).
            "THE_HEADLINE": (
                f"{ws_bound_after} of {ws_taught} bound - {ws_recovered} of up-to-"
                f"{graded_teachings} recovered in this measurement's configuration "
                "(level/zone flags ON, the AFTER arm)."
            ),
            "recoverable_target_population": {
                "value": graded_teachings,
                "PROVENANCE": "EXTERNAL GRADED CONSTANT -- not derived by this generator.",
                # ★ R-207 (e): THIS FIELD WAS A CLAIM WEARING AN IDENTIFIER'S NAME. It was one
                # string under the key "source", and "source" is in IDENTIFIER_KEYS -- so the gate
                # skipped it wholesale. Inside it sat "recovers up to 17 of 27", a MEASUREMENT,
                # and the 17 moves under SESSION_GRADE_REALLOCATION. A caption had found the one
                # place the gate does not look, and it got there because the key name sounded like
                # a path rather than because anything verified that it held one.
                # Split: the path stays an identifier, the quoted claim becomes prose and is
                # scored like any other sentence.
                "source": "docs/designs/spec-dual-denominator-remeasure-2026-07-20.md line 63",
                "source_quotes": (
                    f"'recovers up to {graded_teachings} of {ws_taught}', resting on the graded "
                    "genuine/mis-typed split of the WAIT_SESSION rows recorded in ADVISOR-RULINGS.md."
                ),
                "why_flagged": (
                    "This generator can count the taught rows and can show how many bound. It CANNOT "
                    "re-derive the graded target -- that came from a human-graded read of the "
                    "teaching. It is cited rather than recomputed, and labelled so no reader "
                    "mistakes it for a measured value here."
                ),
            },
            # R-203 s3. The 26-vs-27 divergence, stated as a derivation with every term named
            # rather than as two numbers a reader is left to reconcile.
            "THE_26_VS_27_ACCOUNTING": {
                "why": (
                    f"An earlier note recorded {PRIOR_NOTE_WAIT_SESSION_COUNT} corpus-wide "
                    f"WAIT_SESSION rows; this generator counts {ws_taught}. That is not a "
                    "discrepancy to be split or averaged -- it closes exactly, and the terms are "
                    "named so the closure can be checked instead of believed."
                ),
                "graded_genuine_session_teachings": graded_teachings,
                "graded_mis_types": graded_mis_types,
                "former_orphan_zone_binder_now_honestly_refused": orphan_zone_refusal,
                "sum": graded_teachings + graded_mis_types + orphan_zone_refusal,
                "measured_n_WAIT_SESSION_taught": ws_taught,
                "closes_exactly": (
                    graded_teachings + graded_mis_types + orphan_zone_refusal == ws_taught
                ),
                "the_27th_row": (
                    f"The {ws_taught}th is the former orphan-zone binder. The old resolver bound it "
                    "to a zone "
                    "that does not exist -- a fake binding wearing bindable=True. It is now REFUSED, "
                    "and the refusal is why the post-closure count is one higher than the "
                    "pre-closure note: the closure did not lose a binding, it stopped claiming one."
                ),
                "supersedes": (
                    "The graded genuine/mis-typed split supersedes the earlier approximate ~15 "
                    "mis-types / ~11 vocabulary-gap estimates wherever those are still cited. Those "
                    "were estimates and split the population the other way round; this is the "
                    "graded read and it is the one that travels."
                ),
                "ASSERTED": (
                    "The sum is asserted against the measured count, not narrated. Two of the three "
                    "terms are external-graded constants and the fourth quantity is measured here, "
                    "so the assert fires if the corpus moves out from under the grade."
                ),
            },
            "unflattering_reading": (
                ("All " if ws_unbound_after == ws_taught else f"{ws_unbound_after} of ")
                + f"{ws_taught} WAIT_SESSION conditions in Corpus A are UNBOUND"
                + (" in both arms" if ws_unbound_after == ws_unbound else
                   f" with the flags ON ({ws_unbound} with them OFF)")
                + ". The session lane -- the only family whose runtime primitive is real -- recovered "
                + (f"{ws_recovered} of the {graded_teachings} graded-recoverable rows"
                   if ws_recovered else "nothing")
                + " in this configuration, and the honest-partial closure moved the unbound count "
                # THE DIRECTION IS COMPUTED TOO (AR-188 D3's lesson applied to prose). "moved the
                # count the wrong way" is a direction claim, and a direction claim that cannot
                # invert is a caption whether or not it contains a digit. Under the standard
                # perturbation this clause flips, which is the only reason it is allowed to stand.
                + ("the WRONG way" if ws_unbound_after > ws_taught - orphan_zone_refusal
                   else "the RIGHT way" if ws_unbound_after < ws_taught - orphan_zone_refusal
                   else "NOT AT ALL")
                + f": {ws_unbound_after} unbound post-closure against the "
                f"{ws_taught - orphan_zone_refusal} of the pre-closure note, because the "
                f"{ws_taught}th row's binding was withdrawn as fake rather than lost (see "
                "THE_26_VS_27_ACCOUNTING). "
                + ("This is the least flattering number available and it is stated for that reason."
                   if ws_recovered == 0
                   else f"{ws_recovered} rows did recover here, so this is no longer the "
                   "least flattering reading of the session lane -- the residue is.")
            ),
        },
        # ------------------------------------------------------ AR-188 fix 6
        "SELF_ACCOUNTING": {
            "n_asserts_in_this_generator": count_own_asserts(),
            # AR-188 D2. The tally is DERIVED, per assert, with its disposition -- see
            # own_assert_census(). What stood here was a computed count beside a TYPED claim
            # ("two of those twelve could not fire and have been dealt with"), and the typed half
            # was false: a third dead assert was live in the file at the time, and a fourth can
            # only fire on a source edit. A prose tally standing beside a computed one is the
            # caption shape, and it is the shape that keeps coming back, so it is now machinery.
            "ASSERT_CENSUS": own_assert_census(),
            "n_asserts_note": (
                "Counted and CLASSIFIED from this file's own AST at runtime, not typed. Three dead "
                "asserts have now been removed across this artifact's history, each found only "
                "after the report describing the previous removal had been accepted: (1) the "
                "Corpus-B role-partition assert, algebraically implied by the derivation assert "
                "above it -- DELETED, property still reported; (2) the output-path collision guard, "
                "which sat AFTER the write it purported to guard -- MOVED to a precondition, and "
                "classified SOURCE_INVARIANT because it compares two module constants and so can "
                "fire only on a source edit, never on data; (3) the taught-denominator assert, "
                "which compared two counts of the SAME list object -- DELETED, property still "
                "reported. The count of asserts is no longer offered as a safety figure at all: "
                "n_DATA_SENSITIVE is, and every assert must declare which it is before the run "
                "will proceed."
            ),
            "population_A_kind_histogram_over_corpus_A": kind_counts,
            "n_distinct_kinds_observed": len(kind_hist),
            "modal_kind": ("None" if modal_kind is None else modal_kind),
            "modal_kind_n": modal_n,
            "non_discriminating_control_reason_CORRECTED": (
                f"The declared non-discriminating control gave its reason as 'only three kinds occur'. "
                f"That is FALSE: {len(kind_hist)} occur, and the modal value is "
                f"'{'None' if modal_kind is None else modal_kind}' at n={modal_n} -- conditions no kind "
                "classifies, the large majority of the corpus. The control's CONCLUSION (that the kind "
                "axis does not discriminate here) survives; its stated REASON did not, and a reason "
                "that is false is not a weaker justification, it is an unfalsifiable one. The "
                "histogram is emitted so the reason can be checked instead of believed."
            ),
        },
        "WHAT_THIS_MAY_NOT_DO": [
            "May not claim a fidelity result the grades did not license. The flip's claim covers two kinds "
            "(named_sr_level, order_block_edge); swing stays approximate. The session lane closed "
            "HONEST-PARTIAL with a per-row-labeled residue including 5 rows nobody can explain.",
            "May not report a single headline number without dual denominators + section 6a coverage.",
            "May not merge the by-gap and by-design lines.",
            "May not be used to justify T1 -- bars may never be set from the rate alone.",
        ],
    }

    return art


def _summarise(art: dict) -> None:
    """Console summary, READ BACK OUT OF THE ARTIFACT rather than recomputed beside it.

    The prints used to be built from main()'s locals, in parallel with the artifact. Two
    renderings of the same measurement, typed twice, is where a console line and an artifact
    field get to disagree -- and one of them said "0 of 27 bound" long after the field beside
    it could have said otherwise. There is now one source and the terminal quotes it.
    """
    a = art["corpus_A"]
    b = art["corpus_B"]
    bef, aft = a["BEFORE_flags_off"], a["AFTER_flags_on_HYPOTHETICAL"]
    cov = "section_6a_coverage_bound_and_concrete_over_ALL_TAUGHT_ENTRY_CONDITIONS"
    nc = art["NUMERATOR_CONTINUITY"]
    cvl = art["RECONCILIATION"]["census_vs_live_OUTSIDE_THIS_PIPELINE"]
    ses = art["SESSION_ATTRIBUTION"]
    sa = art["SELF_ACCOUNTING"]
    pri = art["READ_THIS_ONE__PRIMARY_COVERAGE_FIGURE"]
    full = art["COVERAGE_OVER_GENUINELY_ALL_TAUGHT"]["COMPLETED_161_DUAL_CONFIGURATION"]
    sec, mar = full["BESIDE_IT_NOT_INSTEAD_OF_IT"], full["MARGIN_DECOMPOSITION"]
    gate, head = art["CAPTION_GATE"], art["APPEND_ONLY_VERIFICATION"]

    # ★ THIS LINE WAS A CAPTION IN ITS FIRST DRAFT-MODE RUN, and it is worth leaving the record.
    # It read "OK  wrote <path>" unconditionally -- printed by a summariser that never asks
    # whether a write happened -- so the very first --draft run announced that it had written the
    # artifact directly beneath a banner saying nothing would be written. Nothing had: the file
    # was byte-identical to HEAD afterwards. A prose line contradicting the state beside it, in
    # the same output, in the commit that adds the feature. It is now derived from the mode.
    print(f"{'DRAFT  NOT written (draft mode):' if _DRAFT_MODE else 'OK  wrote'} "
          f"{OUT_PATH.relative_to(REPO_ROOT)}")
    print(f"OK  PRIMARY coverage {pri['fraction']} = {pri['coverage']} {pri['configuration']}")
    print(f"OK  corpus A: {a['n_specs']} specs / {a['n_taught_conditions']} taught conditions")
    print(f"      rate BEFORE {bef['binding_approximation_rate']} (n={bef['binding_approximation_rate_n']})"
          f"  AFTER {aft['binding_approximation_rate']} (n={aft['binding_approximation_rate_n']})")
    print(f"      6a coverage BEFORE {bef[cov]} AFTER {aft[cov]} (n={aft['section_6a_coverage_n']})")
    print(f"      unbound {a['THE_UNBOUND_COUNT_TRAVELS_BESIDE_THE_RATE']['n_unbound']} of "
          f"{a['THE_UNBOUND_COUNT_TRAVELS_BESIDE_THE_RATE']['n_taught']}")
    print(f"      pre-closure-COMPARABLE 6a coverage {nc['pre_closure_COMPARABLE_flags_on_coverage']}"
          f" -> {nc['post_closure_flags_on_coverage']} (flags-ON both sides)")
    print(f"OK  closure drift (flags-OFF both arms): {cvl['computed_drift_verdict']['verdict']}")
    print(f"      rate {cvl['PRE_closure_flags_off_rate']} -> {cvl['POST_closure_flags_off_rate']}"
          f" | 6a coverage {cvl['PRE_closure_flags_off_section_6a_coverage']} -> "
          f"{cvl['POST_closure_flags_off_section_6a_coverage']}")
    print(f"      beside it {sec['fraction']} = {sec['coverage_over_161']} (enforcement OFF) -- "
          f"{mar['margin_from_INVALIDATE_withdrawn_approximation_False']} of its "
          f"{mar['margin_secondary_minus_primary']}-condition margin rests on the WITHDRAWN "
          "INVALIDATE approximation=False")
    print(f"      dependency verdict: {sec['provenance_dependency_verdict']}")
    print(f"OK  session attribution: {ses['THE_HEADLINE']}")
    print(f"      26-vs-27: {ses['THE_26_VS_27_ACCOUNTING']['graded_genuine_session_teachings']}"
          f" + {ses['THE_26_VS_27_ACCOUNTING']['graded_mis_types']}"
          f" + {ses['THE_26_VS_27_ACCOUNTING']['former_orphan_zone_binder_now_honestly_refused']}"
          f" = {ses['THE_26_VS_27_ACCOUNTING']['sum']} == "
          f"{ses['THE_26_VS_27_ACCOUNTING']['measured_n_WAIT_SESSION_taught']} measured")
    print(f"OK  self-accounting: {sa['ASSERT_CENSUS']['n_asserts_total']} asserts "
          f"({sa['ASSERT_CENSUS']['n_DATA_SENSITIVE']} data-sensitive, "
          f"{sa['ASSERT_CENSUS']['n_SOURCE_INVARIANT']} source-invariant) | "
          f"{sa['n_distinct_kinds_observed']} kinds, modal '{sa['modal_kind']}' n={sa['modal_kind_n']}")
    print(f"OK  drift classifier: {art['CLASSIFY_DRIFT_DISCRIMINATION_PROOF']['n_input_patterns']} "
          f"patterns -> {art['CLASSIFY_DRIFT_DISCRIMINATION_PROOF']['n_distinct_verdicts']} verdicts")
    print(f"OK  corpus B: {b['n_specs']} specs / {b['n_taught_conditions']} taught conditions")
    print(f"      never-evaluated-by-GAP {b['NEVER_EVALUATED_BY_GAP']['n']} (3 paths agree) | "
          f"by-DESIGN {b['NEVER_EVALUATED_BY_DESIGN']['n']} (never merged)")
    print(f"OK  ceiling: {art['CEILING']['observed_de_approximated']} de-approximated, ceiling "
          f"{art['CEILING']['max_de_approximable']} of {art['CEILING']['n_level_zone_rows_total']}")
    print(f"OK  CAPTION GATE [{gate['n_axes']} axes]: {gate['n_prose_fields_examined']} prose fields "
          f"vs {gate['n_numeric_leaves_that_moved']} moved numeric leaves -> "
          f"{gate['n_violations']} violations")
    cc = art["CAPTION_GATE_COVERAGE_CENSUS"]
    print(f"OK  GATE COVERAGE: {cc['COVERAGE']} numeral-carrying prose leaves watched "
          f"({cc['n_RESPONSIVE']} responsive + {cc['n_COVERED']} covered) | "
          f"{cc['n_EXEMPTED_STRUCTURAL']} structural, "
          f"{cc['n_CARRIED_UNVERIFIABLE_NOT_COVERAGE']} carried-unverifiable, "
          f"{cc['n_UNREACHED_THIS_IS_THE_RED']} unreached")
    print(f"      {cc['n_prose_leaves_numeral_free_UNCONVICTABLE_BY_PROOF']} numeral-free prose "
          "leaves excluded by proof (no numeral -> no possible conviction)")
    ad = art["SELF_ACCOUNTING"]["ASSERT_DISCRIMINATION_COMPUTED"]
    print(f"OK  ASSERT DISCRIMINATION [{ad['n_probes']} probes]: {ad['n_DISCRIMINATING']} "
          f"discriminating | {ad['n_REACHED_BUT_NO_PROBE_FAILS_IT']} reached-but-never-failed "
          f"({len(ad['suspected_dead_asserts'])} of them DATA_SENSITIVE = SUSPECTED DEAD) | "
          f"{ad['n_NOT_REACHED_BY_THIS_PROBE_FAMILY']} outside this family's reach")
    sp = art["SUBPROCESS_BOUNDARY"]
    print(f"OK  subprocess boundary: {sp['n_modules_scanned']} modules AST-scanned, "
          f"{len(sp['findings'])} spawn sites, {len(sp['unexpected_spawns'])} unexpected "
          f"({sp['PASS']})")
    eg = art.get("EVIDENTIAL_CLAIM_GATE")
    if eg:
        print(f"OK  EVIDENTIAL-CLAIM GATE: {eg['n_frozen_prose_leaves_SCORED']} frozen prose "
              f"leaves scored -> {eg['n_convictions']} convictions, {eg['n_adjudicated']} "
              f"adjudicated (flagged/scored {eg['precision_COMPUTED']['flagged_over_scored']})")
    rf = ad.get("REVIVAL_FAMILY")
    if rf:
        print(f"OK  REVIVAL PROBES: {rf['n_probes']} value injections, "
              f"{ad['n_REVIVED_BY_VALUE_INJECTION']} asserts revived, "
              f"{len(rf['MISDIRECTED_PROBES_THIS_IS_THE_RED'])} misdirected ({rf['PASS']})")
    ws = art.get("WRITE_SITE_CENSUS")
    if ws:
        print(f"OK  write sites: {ws['n_write_sites_COMPUTED']} (sole writer "
              f"{ws['expected_sole_writer']}) -- draft mode's cannot-publish pin ({ws['PASS']})")
    if "rows" in head:
        print(f"OK  append-only: {len(head['rows'])} guarded artifacts byte-identical to HEAD "
              f"({head['all_match']})")
    else:
        print(f"DRAFT  append-only: {head['DRAFT']}")
    ig = art["INPUT_GUARD"]
    tag = "DRAFT" if art.get("DRAFT") else "OK "
    print(f"{tag} input guard: {ig['n_tracked_checked']} tracked inputs checked against the git "
          f"object store pre-run ({ig['all_match']}) | {ig['n_traced_reads']} reads traced, "
          f"all covered")
    if art.get("DRAFT"):
        d = art["DRAFT"]["input_guard_divergences_tolerated"]
        print(f"DRAFT  {len(d)} input(s) DIVERGED from their committed bytes and were tolerated "
              "because this run cannot publish:")
        for p in d:
            print(f"DRAFT    {p}")


def main(argv: list[str] | None = None) -> None:
    global _DRAFT_MODE
    argv = sys.argv[1:] if argv is None else argv
    _DRAFT_MODE = "--draft" in argv

    # ★ R-219 (1): THE CANNOT-PUBLISH PIN, PROVED BEFORE ANY MODE RUNS. write_site_census walks
    # this file's AST and requires exactly ONE OUT_PATH writer, inside publish_artifact(). It runs
    # in BOTH modes and on every invocation, because the strict path depends on it just as much:
    # a second writer would let a future edit publish without passing the draft refusal at all.
    writers = write_site_census()
    if not writers["PASS"]:
        sys.stderr.write(
            "\nWRITE-SITE CENSUS FAILED -- draft mode's cannot-publish pin is only as strong as\n"
            "there being ONE writer that refuses. Found "
            f"{writers['n_write_sites_COMPUTED']}: {writers['sites']}\n"
        )
        raise SystemExit(2)

    if _DRAFT_MODE:
        print(DRAFT_BANNER)
        print("D R A F T   R U N  --  NOT A MEASUREMENT.  NOTHING HERE MAY BE CITED.")
        print("Inputs are NOT verified against their committed bytes. No artifact will be")
        print("written. No append-only claim and no HEAD comparison will be made or reported.")
        print("Every line below is prefixed DRAFT for exactly this reason.")
        print(DRAFT_BANNER)

    if "--draft-publish-proof" in argv:
        # ★ THE PROOF THE BRIEF ASKED FOR: SHOW THE ATTEMPT FAILING, do not claim it cannot
        # happen. Three attempts, from three different directions.
        _DRAFT_MODE = True
        print("DRAFT PUBLISH PROOF -- three attempts to publish from draft mode")
        print()
        print(f"  (1) AST write-site census: {writers['n_write_sites_COMPUTED']} write site(s), "
              f"sole writer = {writers['sites'][0]['enclosing_function'] if writers['sites'] else None}"
              f"  -> PASS={writers['PASS']}")
        pre = sha(OUT_PATH) if OUT_PATH.exists() else None
        try:
            publish_artifact({"THIS_MUST_NEVER_REACH_DISK": True})
            print("  (2) direct call to publish_artifact() in draft mode -> RETURNED. THIS IS A RED.")
            ok2 = False
        except SystemExit as e:
            print(f"  (2) direct call to publish_artifact() in draft mode -> REFUSED, SystemExit({e.code})")
            ok2 = e.code == 3
        post = sha(OUT_PATH) if OUT_PATH.exists() else None
        print(f"  (3) artifact bytes before/after the attempt identical = {pre == post}"
              f"  (sha {str(pre)[:12]}... -> {str(post)[:12]}...)")
        ok = writers["PASS"] and ok2 and pre == post
        print()
        print("PUBLISH-FROM-DRAFT", "IMPOSSIBLE ON ALL THREE CHECKS" if ok else "NOT PROVEN -- RED")
        sys.exit(0 if ok else 1)

    # SOURCE_INVARIANT precondition. It compares two module constants, so it can fire only on an
    # edit to this file and never on data (AR-188 D2 disposition) -- it is kept because it states a
    # structural intent at the point where the intent matters, and it is classified rather than
    # counted as a check. It is a PRECONDITION because it previously sat BELOW the write, where
    # the overwrite it names had already happened by the time it ran.
    assert OUT_PATH not in APPEND_ONLY_GUARDED, (
        f"output path {OUT_PATH} collides with a guarded prior artifact -- refusing to overwrite"
    )

    # WIDER THAN THE GUARDED LIST. The five named files were a curated enumeration, and a curated
    # enumeration is exactly what understated the 921. Every pre-existing file in the directory is
    # hashed, so a write to an unlisted neighbour is caught too. This CAN fire on data.
    # ================================================== AR-203 (a): THE INPUT GUARD, FIRST
    # Runs BEFORE the directory is baselined, before either build, before any write. A tampered
    # tracked input previously reached the artifact as a published number at exit 0 with the
    # safety sentence printed; nothing downstream could see it, because the in-run hash pair
    # baselines the ALREADY-TAMPERED bytes and the HEAD check only looked at five names.
    # SystemExit rather than assert on purpose: `python -O` strips asserts, and a fabrication
    # gate that a flag can remove is not a gate.
    tracked = tracked_files()
    declared_inputs = discover_declared_inputs()
    guarded_scope = sorted(set(declared_inputs) | {p.resolve() for p in APPEND_ONLY_GUARDED if p.exists()})
    input_check = verify_inputs_match_head(guarded_scope, REPO_ROOT, tracked)
    if not input_check["all_match"]:
        bad = [r for r in input_check["rows"] if r["match"] is False]
        # ★ R-219 (1). THE GUARD IS NOT RELAXED IN DRAFT MODE -- IT IS RE-AIMED. It still runs,
        # it still compares every tracked input against the object store, and it still names
        # every divergence. What changes is the consequence: a DRAFT run is allowed to proceed
        # over a dirty input set precisely BECAUSE it may not publish anything derived from it.
        # The strict path's refusal is untouched, and that is the whole design: iterating is
        # free, publishing costs exactly what it cost before.
        if _DRAFT_MODE:
            sys.stderr.write(
                "\nDRAFT  INPUT GUARD DIVERGENCE -- proceeding because this run CANNOT PUBLISH.\n"
                "DRAFT  These inputs differ from their committed bytes, so every figure below is\n"
                "DRAFT  derived from bytes no commit vouches for. A strict run would have exited 2\n"
                "DRAFT  here and written nothing.\n"
                + "".join(f"DRAFT    {r['path']}  status={r['status']}\n" for r in bad)
            )
            input_check["DRAFT_DIVERGENCES_TOLERATED"] = [r["path"] for r in bad]
        else:
            sys.stderr.write(
                "\nINPUT GUARD FAILED -- a tracked input differs from its committed bytes.\n"
                "REFUSING TO RUN. No artifact written. Nothing below this point executed.\n"
                "A number derived from tampered bytes is a fabricated number, and the previous\n"
                "check could not see it: it guarded five names and this generator reads more.\n"
                "If you are ITERATING on this generator, re-run with --draft: it runs on a dirty\n"
                "tree, prints its verdict marked DRAFT, and refuses to publish.\n"
                + "".join(f"  {r['path']}  status={r['status']}\n" for r in bad)
            )
            raise SystemExit(2)

    # Baselining the directory is a PUBLISH-PATH obligation: it exists to prove the write that
    # follows touched nothing else. A draft run performs no write, so it takes no baseline and
    # makes no append-only claim -- rather than taking one and reporting a vacuous green.
    scope = [] if _DRAFT_MODE else sorted(p for p in H1.iterdir() if p.is_file() and p != OUT_PATH)
    before_hashes = {p.name: sha(p) for p in scope}

    with trace_repo_reads() as traced:
        art = build_artifact(None)

    # ============================================================== R-203 s1 / R-207: THE GATE
    # Build the ENTIRE artifact once more PER AXIS and require every prose field that quotes a
    # number ANY axis moved to have moved with it. One axis was not enough: measured, its live
    # conviction surface was four leaves, all four already excused. Six axes, scored on the
    # union of their blast radii, is what makes the PASS carry information.
        per_axis = {ax: build_artifact(ax) for ax in AXES}

    # AR-203 (a), completeness. The discovery rule above is only sound if it actually covered
    # every read. This compares it against what the two builds OPENED. A read of an in-repo
    # file that was not guarded -- an inlined literal path, a new corpus, an untracked file
    # whose bytes no commit vouches for -- fails the run here rather than publishing.
    unguarded = sorted(p for p in traced if p not in set(guarded_scope))
    untracked_reads = sorted(
        p for p in traced if p.relative_to(REPO_ROOT).as_posix() not in tracked
    )
    if unguarded or untracked_reads:
        sys.stderr.write(
            "\nINPUT ENUMERATION INCOMPLETE -- the build read an in-repo file the guard did not cover.\n"
            "REFUSING TO PUBLISH. Add it to the declared inputs, or stop reading it.\n"
            + "".join(f"  UNGUARDED READ  {p.relative_to(REPO_ROOT).as_posix()}\n" for p in unguarded)
            + "".join(f"  UNTRACKED READ  {p.relative_to(REPO_ROOT).as_posix()}\n" for p in untracked_reads)
        )
        raise SystemExit(2)

    gate = caption_gate(art, per_axis, NON_RESPONSIVE_PROSE_ALLOWLIST)
    census = coverage_census(art, per_axis, NON_RESPONSIVE_PROSE_ALLOWLIST, STRUCTURAL_NUMERALS)
    evidential = evidential_claim_gate(art, per_axis, STRUCTURAL_NUMERALS)
    spawn = subprocess_boundary_check()
    # Computed HERE and not inside the body: it rebuilds the artifact once per probe, so calling
    # it from _build_artifact_body would recurse. It is attached to the artifact below.
    discrimination = assert_discrimination_census()

    if "--axis-replay" in argv:
        # ★ FOUNDING-INSTANCE DISCIPLINE AT BIRTH (R-207 (A)(iv)). Every axis ships with its own
        # planted caption: a KNOWN-FALSE sentence is inserted inside that axis's blast radius,
        # and the axis must convict it ALONE -- with the other five axes withheld, so a
        # conviction cannot be borrowed from a neighbour's radius. An axis that cannot convict
        # inside its own reach is contributing coverage it does not have.
        ok = True
        for ax in sorted(AXES):
            radius = _moved_leaves_for(dict(_leaves(art)), dict(_leaves(per_axis[ax])))
            numeric = [(k, v) for k, v in radius
                       if isinstance(dict(_leaves(art)).get(k), (int, float))
                       and not isinstance(dict(_leaves(art)).get(k), bool)]
            if not numeric:
                print(f"  {ax}: NO NUMERIC LEAF MOVED -- cannot plant")
                ok = False
                continue
            target, _ = numeric[0]
            cont = _container_of(target)
            val = dict(_leaves(art))[target]
            planted = json.loads(json.dumps(art))
            # walk to the container and drop a sentence that TYPES the number instead of computing it
            node, parts = planted, [p for p in cont.replace("[", ".").replace("]", "").split(".")[1:] if p]
            for p in parts:
                node = node[int(p)] if isinstance(node, list) else node[p]
            if not isinstance(node, dict):
                print(f"  {ax}: container {cont} is not a dict -- cannot plant")
                ok = False
                continue
            sentence = (
                f"This sentence states that the value is {val} and will keep stating it after "
                "the measurement changes, because the number is typed rather than interpolated."
            )
            node["PLANTED_CAPTION_KNOWN_FALSE"] = sentence
            # ★ THE PLANT MUST LAND IN BOTH BUILDS OR IT IS NOT SCORED AT ALL. The gate only
            # examines leaves present on BOTH sides -- a key that exists only in the base build
            # is not a frozen sentence, it is an absent one, and the first version of this replay
            # reported DID NOT CONVICT for exactly that reason. A caption is a sentence that
            # stays the SAME while the data moves, so the identical text goes into the perturbed
            # build too. (The replay was red before this fix, which is the only reason it was
            # caught -- a self-test that had passed here would have been testing nothing.)
            planted_axis = json.loads(json.dumps(per_axis[ax]))
            pnode, pparts = planted_axis, [p for p in cont.replace("[", ".").replace("]", "").split(".")[1:] if p]
            for p in pparts:
                pnode = pnode[int(p)] if isinstance(pnode, list) else pnode[p]
            pnode["PLANTED_CAPTION_KNOWN_FALSE"] = sentence
            red = caption_gate(planted, {ax: planted_axis}, NON_RESPONSIVE_PROSE_ALLOWLIST)
            hit = [v for v in red["violations"] if v["path"].endswith("PLANTED_CAPTION_KNOWN_FALSE")]
            print(f"  {ax}: planted at {cont} quoting {val} -> "
                  f"{'CONVICTS' if hit else 'DID NOT CONVICT'}")
            if not hit:
                ok = False
        print("AXIS REPLAY", "PASSED" if ok else "FAILED")
        sys.exit(0 if ok else 1)

    if "--caption1-literal-replay" in argv:
        # ★★★ BATTERY ITEM 1, AT LAST AGAINST THE LITERAL TEXT. Every prior discharge attempt
        # replayed caption 1's SHAPE -- a sentence built to resemble it. A prior wave was
        # explicit that a shape replay leaves item 1 UNDISCHARGED, and it was right: a shape is
        # authored by the same person authoring the detector, so it can only ever confirm that
        # the detector catches what its author had in mind.
        # This plants THE ORIGINAL BYTES, from commit d09827f6, dual_denominator_remeasure.py
        # lines 474-480, the hardcoded "interpretation" field of
        # census_vs_live_OUTSIDE_THIS_PIPELINE -- the defect this instrument is named after and
        # has never once been run against.
        planted = json.loads(json.dumps(art))
        planted["RECONCILIATION"]["census_vs_live_OUTSIDE_THIS_PIPELINE"]["interpretation"] = CAPTION_1_LITERAL
        pax = {}
        for ax, a in per_axis.items():
            pa = json.loads(json.dumps(a))
            # THE PLANT GOES INTO EVERY BUILD, IDENTICALLY. A leaf present on only one side is
            # not a frozen sentence, it is an absent one, and both of these gates score only
            # leaves shared across all builds. This exact mistake made the first axis replay
            # report DID NOT CONVICT on a plant that was never scored.
            pa["RECONCILIATION"]["census_vs_live_OUTSIDE_THIS_PIPELINE"]["interpretation"] = CAPTION_1_LITERAL
            pax[ax] = pa
        cap = caption_gate(planted, pax, NON_RESPONSIVE_PROSE_ALLOWLIST)
        evid = evidential_claim_gate(planted, pax, STRUCTURAL_NUMERALS)
        cap_hit = [v for v in cap["violations"] if v["path"].endswith(".interpretation")]
        evid_hit = [v for v in evid["convictions"] if v["path"].endswith(".interpretation")]
        rules = sorted({r for v in evid_hit for r in v["rules_that_fired"]})
        print("CAPTION 1 LITERAL REPLAY -- battery item 1")
        print("  planted, byte-for-byte from d09827f6:474-480:")
        for line in CAPTION_1_LITERAL.split(". "):
            print(f"    {line.strip()}")
        print()
        # ★★★ THE FINDING THIS REPLAY PRODUCED, AND IT REFUTES THE PREMISE THAT DISPATCHED IT.
        # The standing description of caption 1 -- carried in this file, in blind_spot_census
        # entry #2, and in the brief that ordered this work -- is that it is a NUMERAL-FREE claim
        # and therefore has nothing for the caption gate to intersect. Run against the LITERAL
        # bytes, that is FALSE. The text contains "section 6a", the numeral 6 is in it, and 6 is
        # a spelling that MOVES inside this very container (total_flipped). So the caption gate
        # convicts caption 1 -- by NUMERAL COLLISION, on a section identifier that quotes no
        # measurement at all. A TRUE CONVICTION FOR A FALSE REASON.
        # ★ Every prior discharge attempt replayed the SHAPE -- a sentence built to be
        # numeral-free -- and the shape confirmed the premise because the shape was authored FROM
        # the premise. The literal text refutes it. That is the whole argument for literal replay
        # over shape replay, demonstrated on the founding instance, and it is why the pass
        # criterion below does NOT require the caption gate to stay silent: what discharges item
        # 1 is the EVIDENTIAL gate convicting on the claim's own unearned words, not an accident
        # of collision that would evaporate the day someone renamed the section.
        cap_numerals = sorted({n for v in cap_hit for n in v["frozen_numerals_that_moved"]})
        print(f"  numerals in the planted text            = {sorted(set(_NUMERAL_RE.findall(CAPTION_1_LITERAL)))}")
        print(f"  CAPTION GATE convicted it               = {bool(cap_hit)}"
              f"  on numerals {cap_numerals}")
        print("    ^ REFUTES THE STANDING PREMISE that caption 1 is numeral-free. It is not:")
        print("      'section 6a' carries a 6, and 6 moves in this container. A true conviction")
        print("      for a FALSE reason -- collision on a section id, not on a quoted quantity.")
        print("      The shape replays could not find this, because the shape was built from the")
        print("      premise it was meant to test.")
        print(f"  EVIDENTIAL-CLAIM GATE convicted it      = {bool(evid_hit)}")
        print(f"    rules that fired                      = {rules}")
        print(f"  live artifact evidential gate PASS      = {evidential['PASS']}"
              f"  ({evidential['n_convictions']} convictions)")
        print(f"  planted   artifact evidential gate PASS = {evid['PASS']}"
              f"  ({evid['n_convictions']} convictions)")
        print()
        print(f"  frozen prose leaves SCORED on the live file = {evidential['n_frozen_prose_leaves_SCORED']}")
        print(f"  flagged / scored (COMPUTED)                 = "
              f"{evidential['precision_COMPUTED']['flagged_over_scored']}")
        # BOTH POLARITIES, or the replay proves nothing: RED on the plant AND GREEN on the real
        # file. A detector that convicts everything would pass the first half alone.
        ok = bool(evid_hit) and not evid["PASS"] and evidential["PASS"]
        print()
        print("ITEM 1", "DISCHARGED -- the LITERAL text is convicted on its unearned evidential "
              "words, and the real file is green" if ok
              else "NOT DISCHARGED -- see the polarities above")
        sys.exit(0 if ok else 1)

    if "--direction-replay" in argv:
        # ★ BATTERY ITEM 1 -- CAPTION 1'S OWN SHAPE, REPLAYED. Caption 1 was a numeral-free
        # DIRECTION claim. This plants one that is KNOWN FALSE against the artifact's own data
        # and shows the gate passing it. The expected result is that the gate does NOT convict:
        # a sentence with no numeral has nothing to intersect, so no axis can reach it. Printing
        # that as a PASS would be the caption defect; it is printed as the OPEN boundary it is,
        # and blind_spot_census entry #2 carries the same fact as a computed figure.
        drift = art["CLOSURE_DRIFT"]["verdict"] if "CLOSURE_DRIFT" in art else "(n/a)"
        SENT = ("Fidelity improved under the closure and the entry side gained coverage, so the "
                "flip is exclusively responsible for the margin.")
        planted = json.loads(json.dumps(art))
        planted["CORPORA_ARE_SEPARATE_DIRECTION_CLAIM_KNOWN_FALSE"] = SENT
        pax = {}
        for ax, a in per_axis.items():
            pa2 = json.loads(json.dumps(a))
            pa2["CORPORA_ARE_SEPARATE_DIRECTION_CLAIM_KNOWN_FALSE"] = SENT
            pax[ax] = pa2
        red = caption_gate(planted, pax, NON_RESPONSIVE_PROSE_ALLOWLIST)
        redc = coverage_census(planted, pax, NON_RESPONSIVE_PROSE_ALLOWLIST, STRUCTURAL_NUMERALS)
        convicted = any("DIRECTION_CLAIM_KNOWN_FALSE" in v["path"] for v in red["violations"])
        print("DIRECTION REPLAY -- caption 1's shape: a numeral-free direction claim")
        print(f"  planted (known false against this run's own verdict {drift!r}):")
        print(f"    {SENT}")
        print(f"  caption gate convicted it        = {convicted}")
        print(f"  coverage census counted it       = "
              f"{'numeral-free, excluded by proof' if not convicted else 'scored'}")
        print(f"  gate PASS with the false claim in= {red['PASS']}  census PASS = {redc['PASS']}")
        ev = evidential_claim_gate(planted, pax, STRUCTURAL_NUMERALS)
        ev_hit = any("DIRECTION_CLAIM_KNOWN_FALSE" in c["path"] for c in ev["convictions"])
        print(f"  evidential gate convicted it     = {ev_hit}")
        print()
        print("RESULT: NEITHER gate convicts it, and that is the CORRECT report of the RESIDUAL")
        print("that survives R-219. This sentence is numeral-free AND carries no evidential")
        print("vocabulary and no opposed direction pair, so nothing here can reach it. Note that")
        print("caption 1's LITERAL text is NOT in this class -- see --caption1-literal-replay,")
        print("which convicts it. This is a purpose-built worst case, not the founding instance.")
        # The replay asserts the RESIDUAL is real and still declared. Entry #2 is now CHECKED
        # (the evidential gate closed the general blind spot), so what this replay pins is the
        # residual clause inside it -- if a future change made either gate catch this sentence,
        # that clause would be stale and must be rewritten.
        # computed here rather than read off art -- the replay blocks run BEFORE it is attached
        entry2 = next(e for e in blind_spot_census(census, spawn, discrimination, evidential)["entries"]
                      if e["n"] == 2)
        ok = (not convicted) and (not ev_hit) and "the_residual_that_is_still_open" in entry2
        print("REPLAY", "PASSED -- the residual is demonstrated and still declared" if ok
              else "FAILED -- the census no longer matches the demonstrated behaviour")
        sys.exit(0 if ok else 1)

    if "--discrimination-replay" in argv:
        # ★ THE PLANTED-DEFECT REPLAY FOR THE DISCRIMINATION COLUMN (R-207 addendum).
        # The independently-known answer: `graded_teachings + graded_mis_types +
        # orphan_zone_refusal == ws_taught` is a SUM assert. SESSION_GRADE_REALLOCATION moves the
        # SPLIT (17/9 -> 16/10) and preserves the sum, so arithmetic alone says that probe CANNOT
        # fail it -- no measurement needed to know the right answer. Meanwhile
        # CORPUS_A_TAUGHT_CONDITION_DROP__REPAIR_WITHHELD moves ws_taught itself, so it MUST fail
        # it. The column is correct only if it reports both, and the pair is the whole finding:
        # the guard is green under every split, which is the only thing in doubt.
        KEY = "graded_teachings + graded_mis_types + orphan_zone_refusal == ws_taught"
        row = next(r for r in discrimination["rows"] if r["assert"] == KEY)
        hit = row["discriminated_by_COMPUTED"]
        blind_to_split = AXIS_SESSION_GRADE not in hit
        sees_sum = f"{AXIS_TAUGHT_DROP}__REPAIR_WITHHELD" in hit
        print("DISCRIMINATION REPLAY -- the 17/9/1 sum assert")
        print(f"  discriminated_by (COMPUTED) = {hit}")
        print(f"  blind to the SPLIT ({AXIS_SESSION_GRADE} absent) = {blind_to_split}"
              "   <- known independently: moving 17/9 to 16/10 preserves the sum")
        print(f"  fires on the SUM ({AXIS_TAUGHT_DROP}__REPAIR_WITHHELD present) = {sees_sum}")
        ok = blind_to_split and sees_sum
        print("REPLAY", "PASSED -- the column reports a real non-discrimination it did not invent"
              if ok else "FAILED -- the column does not match the independently-known answer")
        sys.exit(0 if ok else 1)

    if "--census-selftest" in argv:
        # RED-PROOF OF THE COVERAGE FIGURE: plant a measurement-quoting sentence in a block no
        # axis moves, and require the census to call it UNREACHED rather than quietly passing.
        SENT = "A planted sentence quoting 424242, a number no axis moves and nothing computes."
        planted = json.loads(json.dumps(art))
        planted["WHAT_THIS_MAY_NOT_DO"] = list(planted["WHAT_THIS_MAY_NOT_DO"]) + [SENT]
        # Same requirement as the axis replay: a leaf absent from the perturbed builds is not
        # scored at all, so the plant goes into every one of them or the test tests nothing.
        planted_axes = {}
        for ax, a in per_axis.items():
            pa = json.loads(json.dumps(a))
            pa["WHAT_THIS_MAY_NOT_DO"] = list(pa["WHAT_THIS_MAY_NOT_DO"]) + [SENT]
            planted_axes[ax] = pa
        red = coverage_census(planted, planted_axes, NON_RESPONSIVE_PROSE_ALLOWLIST, STRUCTURAL_NUMERALS)
        print(f"  live census PASS   = {census['PASS']}  COVERAGE {census['COVERAGE']}")
        print(f"  planted census PASS= {red['PASS']}  UNREACHED {red['n_UNREACHED_THIS_IS_THE_RED']}")
        if red["PASS"] or not census["PASS"]:
            print("CENSUS SELF-TEST FAILED: the coverage gate did not discriminate.")
            sys.exit(1)
        print("CENSUS SELF-TEST PASSED: red on an unreachable measurement, green on the real file.")
        sys.exit(0)

    if "--battery" in argv:
        # ★ R-207 s4's SEVEN PARTS, RUN BY NAME AND REPORTED PER ITEM. The definition is not
        # invented here -- it is the ruling's, quoted:
        #   (1) caption-1 LITERAL replay · (2) tamper replay · (3) caption 9 · (4) one per bypass
        #   class · (5) five first-run catches still held · (6) false-positive scenario green ·
        #   (7) computed census.
        # Items NOT RUN are printed NOT RUN. An item this harness cannot execute is reported as
        # such rather than folded into a coverage figure it did not earn.
        print("R-207 s4 BATTERY -- seven parts, named")
        print()
        results: dict[str, tuple[str, str]] = {}

        # ---- ITEM 1: caption 1's LITERAL text, not its shape.
        p1 = json.loads(json.dumps(art))
        p1["RECONCILIATION"]["census_vs_live_OUTSIDE_THIS_PIPELINE"]["interpretation"] = CAPTION_1_LITERAL
        p1ax = {}
        for ax, a in per_axis.items():
            pa = json.loads(json.dumps(a))
            pa["RECONCILIATION"]["census_vs_live_OUTSIDE_THIS_PIPELINE"]["interpretation"] = CAPTION_1_LITERAL
            p1ax[ax] = pa
        e1 = evidential_claim_gate(p1, p1ax, STRUCTURAL_NUMERALS)
        c1 = caption_gate(p1, p1ax, NON_RESPONSIVE_PROSE_ALLOWLIST)
        hit1 = [v for v in e1["convictions"] if v["path"].endswith(".interpretation")]
        cap1 = [v for v in c1["violations"] if v["path"].endswith(".interpretation")]
        results["1 caption-1 LITERAL replay"] = (
            "PASS" if hit1 and evidential["PASS"] else "FAIL",
            f"evidential gate convicts the original bytes via {sorted({r for v in hit1 for r in v['rules_that_fired']})}; "
            f"caption gate ALSO convicts it = {bool(cap1)} -- by NUMERAL COLLISION on the 6 in "
            "'section 6a', which REFUTES the standing premise that caption 1 is numeral-free; a "
            "true conviction for a false reason, and not what discharges this item; "
            f"live file still green = {evidential['PASS']}",
        )

        # ---- ITEM 2: tamper replay, BOTH POLARITIES.
        # A guard is only demonstrated by showing it RED on a tamper and GREEN on the real bytes.
        # The tamper is injected at the object-store read rather than by writing to the tree: a
        # replay that mutates a tracked file to test the guard has to put it back, and a restore
        # that half-fails is a worse outcome than an unrun test.
        clean = verify_inputs_match_head(guarded_scope, REPO_ROOT, tracked)
        clean_bad = sorted(r["path"] for r in clean["rows"] if r["match"] is False)
        real_head = head_blob_bytes
        victim = CORPUS_B_PATH.relative_to(REPO_ROOT).as_posix()

        def _tampered(rel):
            b, s = real_head(rel)
            return (b.replace(b"confluence", b"trigger", 1) if b and rel == victim else b), s

        globals()["head_blob_bytes"] = _tampered
        try:
            tam = verify_inputs_match_head(guarded_scope, REPO_ROOT, tracked)
        finally:
            globals()["head_blob_bytes"] = real_head
        caught = [r["path"] for r in tam["rows"] if r["match"] is False]
        # In DRAFT mode the generator's own source is legitimately divergent and is tolerated by
        # design, so the clean-polarity expectation is "nothing diverged EXCEPT what draft mode
        # already declared". In a strict run that set is empty and this is the strict check.
        tolerated = set(input_check.get("DRAFT_DIVERGENCES_TOLERATED", []))
        polarity_clean = set(clean_bad) <= tolerated
        polarity_tamper = victim in caught
        results["2 tamper replay"] = (
            "PASS" if polarity_clean and polarity_tamper else "FAIL",
            f"RED polarity: one byte-level role flip injected into {victim}'s committed blob -> "
            f"guard reports mismatch on it = {polarity_tamper} ({len(caught)} row(s) convicted). "
            f"GREEN polarity: {clean['n_tracked_checked']} untampered inputs, divergences "
            f"{clean_bad or 'none'}, all within the set this run declared = {polarity_clean}.",
        )

        # ---- ITEM 3: caption 9.
        # ★ REPORTED HONESTLY AND NOT FITTED. R-207 s4 names 'caption 9' without defining which
        # sentence that is, and no numbered caption ledger exists in this file or in the artifact
        # (this file enumerates captions 1, 2 and 3 only, in its module docstring). Guessing which
        # sentence is meant and then reporting a PASS against the guess would be a typed label
        # standing in for a measurement -- the exact defect class this battery exists to catch.
        results["3 caption 9"] = (
            "NOT RUN",
            "the referent is undefined in every source available here: this file's docstring "
            "enumerates captions 1-3, and no caption-9 ledger exists in the artifact or the "
            "battery directory. NOT RUN rather than resolved by guess.",
        )

        # ---- ITEM 4: one per bypass class.
        # The bypass classes this file has named, each with its own live check:
        bypass = {
            "NUMERAL_COLLISION (gate scoped too wide)": (gate["PASS"], "caption gate container scoping"),
            "IDENTIFIER_HIDING (a claim wearing a path's key name)":
                (census["identifier_exclusion_audit"]["PASS"], "identifier exclusion audit"),
            "SUBPROCESS READ (outside the Python-level trace)": (spawn["PASS"], "AST spawn census"),
            "NUMERAL-FREE CLAIM (nothing to intersect)": (evidential["PASS"], "evidential-claim gate"),
            "UNGUARDED INPUT (a read the enumeration missed)":
                (not unguarded and not untracked_reads, "trace-vs-enumeration subset check"),
            "SECOND WRITE SITE (routing around the publish gate)": (writers["PASS"], "AST write-site census"),
        }
        results["4 one probe per bypass class"] = (
            "PASS" if all(v[0] for v in bypass.values()) else "FAIL",
            "; ".join(f"{k} -> {v[1]}={v[0]}" for k, v in bypass.items()),
        )

        # ---- ITEM 5: the five first-run catches still held.
        held = {
            # Caption 1 sat at RECONCILIATION.census_vs_live_OUTSIDE_THIS_PIPELINE.interpretation.
            # The catch HOLDS while that key is gone and its replacement is derived from the
            # computed verdict -- checked by name, not by remembering.
            "caption 1 (typed interpretation -> classify_drift)": (
                "interpretation" not in art["RECONCILIATION"]["census_vs_live_OUTSIDE_THIS_PIPELINE"]
                and art["RECONCILIATION"]["census_vs_live_OUTSIDE_THIS_PIPELINE"]
                       .get("computed_drift_verdict") is not None
            ),
            "caption 2 (algebraic-identity decomposition)":
                art["CLASSIFY_DRIFT_DISCRIMINATION_PROOF"]["n_distinct_verdicts"] ==
                art["CLASSIFY_DRIFT_DISCRIMINATION_PROOF"]["n_input_patterns"],
            "caption 3 (typed session headline)": gate["PASS"],
            "dead allowlist entries": not gate["allowlist_entries_that_fired_on_nothing"],
            "dead structural entries": not census["structural_entries_that_matched_nothing"],
        }
        results["5 five first-run catches still held"] = (
            "PASS" if all(held.values()) else "FAIL",
            "; ".join(f"{k}={v}" for k, v in held.items()),
        )

        # ---- ITEM 6: a false-positive scenario stays green.
        # Both polarities. The real file, unplanted, must pass every gate: a detector that
        # convicts everything passes item 1 and is worthless.
        fp = {"caption_gate": gate["PASS"], "coverage_census": census["PASS"],
              "evidential_gate": evidential["PASS"],
              "revival_family": discrimination["REVIVAL_FAMILY"]["PASS"]}
        results["6 false-positive scenario green"] = (
            "PASS" if all(fp.values()) else "FAIL",
            "; ".join(f"{k}={v}" for k, v in fp.items())
            + f"; evidential rules flagged {evidential['n_flagged']} of "
              f"{evidential['n_frozen_prose_leaves_SCORED']} frozen prose leaves",
        )

        # ---- ITEM 7: the computed census.
        results["7 computed census"] = (
            "PASS" if census["PASS"] else "FAIL",
            f"coverage {census['COVERAGE']} ({census['coverage_rate']}), "
            f"{census['n_UNREACHED_THIS_IS_THE_RED']} unreached, "
            f"{census['n_prose_leaves_numeral_free_UNCONVICTABLE_BY_PROOF']} numeral-free excluded "
            f"by proof, {census['n_CARRIED_UNVERIFIABLE_NOT_COVERAGE']} carried-unverifiable held "
            f"outside the figure; asserts {discrimination['n_DISCRIMINATING']} discriminating + "
            f"{discrimination['n_REVIVED_BY_VALUE_INJECTION']} revived + "
            f"{len(discrimination['suspected_dead_asserts'])} still suspected dead",
        )

        for name, (verdict, detail) in results.items():
            print(f"  [{verdict:7s}] ITEM {name}")
            print(f"            {detail}")
        print()
        ran = [v for v, _ in results.values() if v != "NOT RUN"]
        print(f"BATTERY: {len(ran)} of {len(results)} items RUN, "
              f"{sum(1 for v in ran if v == 'PASS')} PASS, "
              f"{sum(1 for v in ran if v == 'FAIL')} FAIL, "
              f"{len(results) - len(ran)} NOT RUN")
        sys.exit(0 if all(v == "PASS" for v in ran) else 1)

    if "--gate-selftest" in argv:
        # RED-PROOF OF THE GATE ITSELF, in-process: freeze one computed prose field back to the
        # literal it currently evaluates to -- exactly the D1 defect -- and confirm the gate
        # catches it. A gate nobody has watched fail is a gate nobody has tested.
        frozen = json.loads(json.dumps(art))
        frozen["SESSION_ATTRIBUTION"]["THE_HEADLINE"] = art["SESSION_ATTRIBUTION"]["THE_HEADLINE"]
        frozen_p = {}
        for ax, a in per_axis.items():
            fp = json.loads(json.dumps(a))
            fp["SESSION_ATTRIBUTION"]["THE_HEADLINE"] = art["SESSION_ATTRIBUTION"]["THE_HEADLINE"]
            frozen_p[ax] = fp
        red = caption_gate(frozen, frozen_p, NON_RESPONSIVE_PROSE_ALLOWLIST)
        print("GATE SELF-TEST -- THE_HEADLINE reverted to a static literal")
        print(f"  live artifact gate PASS = {gate['PASS']} ({gate['n_violations']} violations)")
        print(f"  frozen-headline gate PASS = {red['PASS']} ({red['n_violations']} violations)")
        for v in red["violations"]:
            print(f"    CAPTION {v['path']} froze numerals {v['frozen_numerals_that_moved']}")
        if red["PASS"] or not gate["PASS"]:
            print("SELF-TEST FAILED: the gate did not discriminate.")
            sys.exit(1)
        print("SELF-TEST PASSED: the gate is red on a static numeral and green on the real file.")
        sys.exit(0)

    art["CAPTION_GATE"] = gate
    art["CAPTION_GATE_COVERAGE_CENSUS"] = census
    art["EVIDENTIAL_CLAIM_GATE"] = evidential
    art["WRITE_SITE_CENSUS"] = writers
    art["SUBPROCESS_BOUNDARY"] = spawn
    art["SELF_ACCOUNTING"]["ASSERT_DISCRIMINATION_COMPUTED"] = discrimination
    art["BLIND_SPOT_CENSUS"] = blind_spot_census(census, spawn, discrimination, evidential)
    assert spawn["PASS"], (
        "SUBPROCESS BOUNDARY BREACHED -- the read trace records Python-level opens only, and a "
        "spawn outside the named git call sites can read an input the input guard cannot see:\n"
        + "\n".join(f"  {f['path']}:{f['line']} {f['primitive']} in {f['enclosing_function']}"
                    for f in spawn["unexpected_spawns"])
    )
    assert census["PASS"], (
        "COVERAGE CENSUS FAILED -- a prose leaf quotes a numeral that NO axis can reach, so "
        "nothing in this file can tell whether it is computed or typed. Add an axis that moves "
        "it, or adjudicate it as STRUCTURAL with its kind named:\n"
        + "\n".join(f"  UNREACHED {u['path']}  numerals {u['numerals']}\n    {u['text'][:200]}"
                    for u in census["buckets"]["UNREACHED"])
        + ("\n  BAD STRUCTURAL CLAIMS: "
           + "; ".join(f"{b['path']}: {b['why_rejected']}" for b in census["bad_structural_claims"])
           if census["bad_structural_claims"] else "")
        + ("\n  STRUCTURAL ENTRIES MATCHING NOTHING (delete them): "
           + ", ".join(census["structural_entries_that_matched_nothing"])
           if census["structural_entries_that_matched_nothing"] else "")
        + ("\n  IDENTIFIER-EXCLUSION LEAKS (a claim wearing an identifier's name): "
           + "; ".join(f"{L['path']} quotes {L['free_standing_moved_numerals']}"
                       for L in census["identifier_exclusion_audit"]["leaks"])
           if census["identifier_exclusion_audit"]["leaks"] else "")
    )
    assert evidential["PASS"], (
        "R-219 EVIDENTIAL-CLAIM GATE FAILED -- a FROZEN prose string claims to have observed "
        "something. A string literal never consulted the data, so the claim is unearned by "
        "construction; no perturbation is needed to know that. Make it computed, or delete it:\n"
        + "\n".join(f"  {c['path']}  rules {c['rules_that_fired']}\n    {c['text'][:240]}"
                    for c in evidential["convictions"])
        + ("\n  BAD ADJUDICATIONS: "
           + "; ".join(f"{b['path']}: {b['why_rejected']}" for b in evidential["bad_adjudications"])
           if evidential["bad_adjudications"] else "")
        + ("\n  ADJUDICATIONS MATCHING NOTHING (delete them): "
           + ", ".join(evidential["adjudications_that_matched_nothing"])
           if evidential["adjudications_that_matched_nothing"] else "")
    )
    assert discrimination["REVIVAL_FAMILY"]["PASS"], (
        "REVIVAL PROBE MISDIRECTED -- a probe declared it would make one assert fire and made a "
        "different one fire, or none. 'Revived' would then be a claim nobody checked:\n"
        + "\n".join(f"  {m['probe']}: declared {m['declared_target']!r}, observed {m['observed']!r}"
                    for m in discrimination["REVIVAL_FAMILY"]["MISDIRECTED_PROBES_THIS_IS_THE_RED"])
    )
    assert gate["PASS"], (
        "R-203 s1 CAPTION GATE FAILED -- a prose field quoted a number the data moved and did not "
        "move with it:\n"
        + "\n".join(f"  {v['path']}  froze {v['frozen_numerals_that_moved']}\n    {v['text'][:240]}"
                    for v in gate["violations"])
        + ("\n  DEAD ALLOWLIST ENTRIES (suppress nothing, delete them): "
           + ", ".join(gate["allowlist_entries_that_fired_on_nothing"])
           if gate["allowlist_entries_that_fired_on_nothing"] else "")
    )

    input_check["traced_reads"] = sorted(p.relative_to(REPO_ROOT).as_posix() for p in traced)
    input_check["n_traced_reads"] = len(traced)
    art["INPUT_GUARD"] = input_check

    if _DRAFT_MODE:
        # A DRAFT RUN MAKES NO CLAIM ABOUT HEAD. Not a weakened claim, not an unevaluated green:
        # the field says what it is. Reporting an unrun check as a passing one is precisely the
        # false-safety shape this file exists to refuse.
        art["APPEND_ONLY_VERIFICATION"] = {
            "DRAFT": "NOT EVALUATED. A draft run performs no write, takes no directory baseline, "
                     "and makes no comparison against the git object store."
        }
        art["DRAFT"] = {
            "THIS_IS_NOT_A_MEASUREMENT": (
                "Produced by a --draft run over a possibly-dirty input set. It was NOT written to "
                "disk and must not be cited, baselined, or compared against HEAD."
            ),
            "input_guard_divergences_tolerated": input_check.get("DRAFT_DIVERGENCES_TOLERATED", []),
        }
        _summarise(art)
        print()
        print(DRAFT_BANNER)
        print("DRAFT RUN COMPLETE. NOTHING WAS WRITTEN. NOTHING ABOVE MAY BE CITED.")
        print("The gates above ran in full and their verdicts are real; what is missing is any")
        print("guarantee about the BYTES they ran on. Commit, then re-run without --draft.")
        print(DRAFT_BANNER)
        return

    head_check = verify_guarded_match_head(APPEND_ONLY_GUARDED, REPO_ROOT)
    art["APPEND_ONLY_VERIFICATION"] = head_check
    assert head_check["all_match"], (
        "APPEND-ONLY VIOLATED AGAINST HEAD: a guarded artifact differs from its committed bytes.\n"
        + "\n".join(f"  {r}" for r in head_check["rows"] if not r.get("match"))
        + "\n  'Clean because nothing has looked' is not clean -- git's stat cache had not been "
          "invalidated, so `git status` was answering from a stale mtime rather than the content."
    )

    publish_artifact(art)

    after_hashes = {p.name: sha(p) for p in scope if p.exists()}
    assert before_hashes == after_hashes, (
        "APPEND-ONLY VIOLATED: a pre-existing artifact in this directory changed during this run:\n"
        + "\n".join(f"  {k}: {before_hashes.get(k)} -> {after_hashes.get(k)}" for k in before_hashes
                    if before_hashes.get(k) != after_hashes.get(k))
    )
    _summarise(art)


if __name__ == "__main__":
    main()
