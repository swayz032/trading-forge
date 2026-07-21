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
    "len(set(got.values())) == len(cases)": "DATA_SENSITIVE",
    "not got[flat].startswith('SAME_DIRECTION')": "DATA_SENSITIVE",
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
    "unexpected_disposition_keys == set()": "SOURCE_INVARIANT",
    "undispositioned == []": "SOURCE_INVARIANT",
    "OUT_PATH not in APPEND_ONLY_GUARDED": "SOURCE_INVARIANT",
    "before_hashes == after_hashes": "DATA_SENSITIVE",
    "gate['PASS']": "DATA_SENSITIVE",
    "head_check['all_match']": "DATA_SENSITIVE",
}


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
    rows, undispositioned = [], []
    used: collections.Counter = collections.Counter()
    for n in nodes:
        src = ast.unparse(n.test)
        keys = [k for k in ASSERT_DISPOSITIONS if k in src]
        if len(keys) != 1:
            undispositioned.append({"line": n.lineno, "test": src, "matching_keys": keys})
            continue
        used[keys[0]] += 1
        rows.append({"line": n.lineno, "disposition": ASSERT_DISPOSITIONS[keys[0]], "test": src})

    unexpected_disposition_keys = set(ASSERT_DISPOSITIONS) - set(used) | {
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
    return {
        "n_asserts_total": len(nodes),
        "n_DATA_SENSITIVE": by_disp["DATA_SENSITIVE"],
        "n_SOURCE_INVARIANT": by_disp["SOURCE_INVARIANT"],
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
# THE STANDARD PERTURBATION, AND THE GATE THAT RUNS ON IT.
# ======================================================================================

PERTURBATION_NAME = "ALL_WAIT_SESSION_ROWS_BIND"
PERTURBATION_DESCRIPTION = (
    "sfb.bind_condition is wrapped so every WAIT_SESSION condition that the real binder "
    "REFUSES comes back bindable=True / approximation=False / executed=True. This is the "
    "single largest live fact in the artifact -- 27 of 27 WAIT_SESSION rows are unbound -- so "
    "flipping it should move the session block, the unbound count, the coverage figures, the "
    "rate, the closure drift and every sentence that describes any of them. Anything that "
    "does NOT move under it, while quoting a number that DID, is a caption."
)


@contextmanager
def perturbed_binding(active: bool):
    """Install (or do not install) THE STANDARD PERTURBATION for the duration of a build.

    IT PATCHES THE HARNESS, NEVER THE ENGINE. src/engine/spec_family_bindings.py is not
    edited, imported differently, or reloaded; only this module's reference to the callable
    is swapped, and it is restored in a finally. The perturbed build is used ONLY to test
    the artifact's responsiveness -- it is never written anywhere.
    """
    if not active:
        yield
        return
    real = sfb.bind_condition

    def patched(condition, *a, **kw):
        b = real(condition, *a, **kw)
        if isinstance(condition, dict) and condition.get("type") == "WAIT_SESSION" and not b.bindable:
            return dataclasses.replace(
                b, bindable=True, approximation=False, executed=True,
                primitive="PERTURBATION__NOT_A_REAL_BINDING", reason=None,
            )
        return b

    sfb.bind_condition = patched
    try:
        yield
    finally:
        sfb.bind_condition = real


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
    base = dict(_leaves(art_base))
    pert = dict(_leaves(art_perturbed))
    shared = [k for k in base if k in pert]

    # WHICH MOVED NUMBERS A GIVEN SENTENCE IS ANSWERABLE FOR -- "the fields BESIDE it", which is
    # the law's own wording and not a convenience. Scoring every prose field against every moved
    # number in the artifact makes the gate fire on NUMERAL COLLISION: "n=1 is below the n>=2
    # floor" in the CEILING block would be convicted because some unrelated count elsewhere passed
    # through 1. Those are false REDs, and a gate that cries wolf gets read as noise and then
    # switched off -- which is how the next caption would survive. So a field is answerable for
    # the moved numbers inside ITS OWN CONTAINER's subtree: its siblings and their descendants.
    # This is strictly the scope in which a field could have been computed from what is beside it.
    moved_leaves: list[tuple[str, set[str]]] = []
    n_numeric_moved = 0
    for k in shared:
        a, b = base[k], pert[k]
        if isinstance(a, bool) or isinstance(b, bool):
            continue
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and a != b:
            n_numeric_moved += 1
            moved_leaves.append((k, _numeral_forms(a) | _numeral_forms(b)))
        elif isinstance(a, str) and isinstance(b, str) and a != b:
            # A value that only ever surfaces inside a string (a fraction like "6/161") still
            # counts as moved: take the numerals present on exactly one side.
            sym = set(_NUMERAL_RE.findall(a)) ^ set(_NUMERAL_RE.findall(b))
            if sym:
                moved_leaves.append((k, sym))
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
        "PERTURBATION": PERTURBATION_NAME,
        "perturbation_description": PERTURBATION_DESCRIPTION,
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
    "$.corpus_A.null_baseline.basis": {
        "provenance": {"155": "$.corpus_A.n_taught_conditions"},
        "why": (
            "Interpolated from the taught count, which is a property of the spec list and cannot "
            "move when only the binder's answers change."
        ),
    },
    "$.RECONCILIATION.census_vs_live_OUTSIDE_THIS_PIPELINE.ARMS_ARE_COMPARABLE": {
        "provenance": {"6": "$.CEILING.observed_de_approximated"},
        "why": (
            "Interpolated from the observed level/zone de-approximation count. The perturbation "
            "binds WAIT_SESSION rows concrete in BOTH arms, so it moves no level/zone flip."
        ),
    },
    "$.COVERAGE_OVER_GENUINELY_ALL_TAUGHT.the_defect_this_fixes": {
        "provenance": {
            "155": "$.COVERAGE_OVER_GENUINELY_ALL_TAUGHT.n_taught_entry_conditions",
            "6": "$.COVERAGE_OVER_GENUINELY_ALL_TAUGHT.n_taught_invalidations",
        },
        "why": (
            "Both interpolated from taught counts in the same block. Taught populations are "
            "properties of the corpus files and are invariant under a binder perturbation."
        ),
    },
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


def build_artifact(perturb: bool = False) -> dict:
    """Build the whole artifact. Called TWICE per run -- once real, once perturbed.

    R-203 s1: the artifact had to become a pure function of the measurements before the
    perturbation gate could exist at all. While this was `main()` with the write inlined,
    "regenerate under a changed binder and diff" was not something the file could do to
    itself, which is precisely why three captions had to be found by hand from outside.
    """
    with perturbed_binding(perturb):
        return _build_artifact_body()


def _build_artifact_body() -> dict:
    # ---------------------------------------------------------------- CORPUS B
    # The never-evaluated universe. Derived HERE from the corpus itself -- the 987 is
    # re-derived, never transcribed, by three paths that must agree.
    corpus_b = json.loads(CORPUS_B_PATH.read_text(encoding="utf-8"))
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
    specs_a = load_corpus_a()

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
    for key, (_bb, ba, kind, _fam) in a_before["binding_map"].items():
        nb, na, _k, _f = a_after["binding_map"][key]
        if kind is not None and na is True and nb:
            if kind == "swing":
                swing_still_true += 1
        if ba is True and na is False:
            slot = per_kind.setdefault(kind, {"n_flipped": 0, "condition_ids": []})
            slot["n_flipped"] += 1
            slot["condition_ids"].append(key)

    assert per_kind.get("swing", {}).get("n_flipped", 0) == 0, (
        "swing MUST NOT de-approximate -- n=1 is below the n>=2 floor (R-102 section 2)"
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
    graded_teachings = 17
    graded_mis_types = 9
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
    n_levelzone_rows = census["n"]
    assert n_levelzone_rows == 16, f"level/zone census drifted: expected 16 rows, got {n_levelzone_rows}"
    total_flipped = -sum(v["delta"] for v in fam_delta.values())
    assert total_flipped <= 6, f"CEILING BREACHED: {total_flipped} conditions de-approximated, ceiling is 6 of 16"

    # ------------------------------------------------- DUAL DENOMINATORS (carried)
    narration = json.loads(NARRATION_PATH.read_text(encoding="utf-8"))
    dual = narration["dual_denominators"]

    # ------------------------------------------------- ENFORCEMENT (Corpus B, read)
    enf = json.loads(ENFORCEMENT_PATH.read_text(encoding="utf-8"))
    inv = enf["invalidation_approximation_counts"]
    assert enf["never_evaluated_total"] == never_by_gap, (
        f"enforcement artifact says {enf['never_evaluated_total']} never-evaluated; I derive {never_by_gap}"
    )
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
            "denominator_is": "161 = all taught entry_conditions + all taught invalidations",
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
                    "section_6a_coverage over TAUGHT ENTRY CONDITIONS ONLY (155), which is a "
                    "NARROWER denominator than the 161 above. They are arm comparisons, not the "
                    "artifact's coverage answer, and they appear earlier in the file only because "
                    "the corpus blocks do."
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
            "Corpus A and Corpus B are different windows and are NEVER pooled. The 987/2694 are "
            "Corpus B figures only; Corpus A contains zero trigger-role conditions. A rate inherits "
            "its window: every rate below states its corpus, spec count, and condition count."
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
                    "reason": "routed-but-approximate; n=1 is below the n>=2 de-approximation floor. Never argued for.",
                    "accounting": (
                        "3 Corpus-A conditions classify as swing: 2 are bindable and remain approximation=True "
                        "(counted above); 1 is UNBOUND (a WAIT_SESSION row) and so sits outside the rate's "
                        "denominator entirely, inside the unbound count. 2 + 1 = 3, no swing row unaccounted."
                    ),
                    "classifier_scope_caveat": (
                        "classify_population_a_kind is applied here to EVERY Corpus-A condition for attribution. "
                        "The flip itself only reaches WAIT_STRUCTURE/VERIFY_STRUCTURE, so a swing classification "
                        "on a WAIT_SESSION or WAIT_CONFIRMATION row is an attribution label, NOT a claim that the "
                        "flip could have moved it. This population is BROADER than the frozen 16-row level/zone "
                        "census (which holds 1 swing row) -- different windows, not pooled."
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
                "supersedes": (
                    "921, which summed a curated 5-family list (WAIT_BIAS 42, FILTER 39, INVALIDATE 105, "
                    "ENABLE_ENTRY 480, ENTER 255) and omitted 66 conditions across 6 families "
                    "(WAIT_SESSION 18, WAIT_CONFIRMATION 21, WAIT_RETEST 15, WAIT_STRUCTURE 6, "
                    "VERIFY_STRUCTURE 3, EXIT_HINT 3). A correct sum over an incomplete enumeration is "
                    "still incomplete -- and it understated the denominator, so coverage read BETTER than truth."
                ),
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
                "population": "spec['invalidations'] bindable entries -- NOT the 105 INVALIDATE entry_conditions",
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
                "These are the corpus-wide WAIT_STRUCTURE NARRATION denominators, reproduced unmodified "
                "from narration-reclassification-FINAL.json. They are NOT the Corpus A (155) or Corpus B "
                "(6450) denominators and must not be substituted for either."
            ),
            "source": "docs/replay-results/h1-battery/narration-reclassification-FINAL.json",
        },
        "CEILING": {
            "n_level_zone_rows_total": n_levelzone_rows,
            "max_de_approximable": 6,
            "observed_de_approximated": total_flipped,
            "n_unresolvable_as_built": 9,
            "swing": "1 row, routed-but-approximate, n=1 below the n>=2 floor -- stays approximation=True",
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
                "name states its actual denominator. (b) The completed 161 denominator is reported "
                "here. Renaming alone would leave the complete figure unstated; completing alone "
                "would force a single enforcement arm to be picked silently -- see below."
            ),
            "n_taught_entry_conditions": a_after["n_taught"],
            "n_taught_invalidations": n_invalidations,
            "n_taught_ALL": a_after["n_taught"] + n_invalidations,
            "invalidations_binding_by_enforcement_arm": inval_arms,
            "entry_conditions_binding_by_enforcement_arm": {
                "MEASURED_AT": "level/zone flags ON (the AFTER arm the 161 numerators are built on)",
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
                "source": (
                    "docs/designs/spec-dual-denominator-remeasure-2026-07-20.md line 63 "
                    "('recovers up to 17 of 27'), resting on the graded genuine/mis-typed split of "
                    "the WAIT_SESSION rows recorded in ADVISOR-RULINGS.md."
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
                    "An earlier note recorded 26 corpus-wide WAIT_SESSION rows; this generator counts "
                    "27. That is not a discrepancy to be split or averaged -- it closes exactly, and "
                    "the terms are named so the closure can be checked instead of believed."
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
                    "The 27th is the former orphan-zone binder. The old resolver bound it to a zone "
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

    print(f"OK  wrote {OUT_PATH.relative_to(REPO_ROOT)}")
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
    print(f"OK  CAPTION GATE [{gate['PERTURBATION']}]: {gate['n_prose_fields_examined']} prose fields "
          f"vs {gate['n_numeric_leaves_that_moved']} moved numeric leaves -> "
          f"{gate['n_violations']} violations")
    print(f"OK  append-only: {len(head['rows'])} guarded artifacts byte-identical to HEAD "
          f"({head['all_match']})")


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv

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
    scope = sorted(p for p in H1.iterdir() if p.is_file() and p != OUT_PATH)
    before_hashes = {p.name: sha(p) for p in scope}

    art = build_artifact(perturb=False)

    # ============================================================== R-203 s1: THE GATE
    # Build the ENTIRE artifact a second time under THE STANDARD PERTURBATION and require every
    # prose field that quotes a moved number to have moved with it. This is the check the three
    # captions died to; it runs on every invocation, before anything is written.
    art_perturbed = build_artifact(perturb=True)
    gate = caption_gate(art, art_perturbed, NON_RESPONSIVE_PROSE_ALLOWLIST)

    if "--gate-selftest" in argv:
        # RED-PROOF OF THE GATE ITSELF, in-process: freeze one computed prose field back to the
        # literal it currently evaluates to -- exactly the D1 defect -- and confirm the gate
        # catches it. A gate nobody has watched fail is a gate nobody has tested.
        frozen = json.loads(json.dumps(art))
        frozen["SESSION_ATTRIBUTION"]["THE_HEADLINE"] = art["SESSION_ATTRIBUTION"]["THE_HEADLINE"]
        frozen_p = json.loads(json.dumps(art_perturbed))
        frozen_p["SESSION_ATTRIBUTION"]["THE_HEADLINE"] = art["SESSION_ATTRIBUTION"]["THE_HEADLINE"]
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
    assert gate["PASS"], (
        "R-203 s1 CAPTION GATE FAILED -- a prose field quoted a number the data moved and did not "
        "move with it:\n"
        + "\n".join(f"  {v['path']}  froze {v['frozen_numerals_that_moved']}\n    {v['text'][:240]}"
                    for v in gate["violations"])
        + ("\n  DEAD ALLOWLIST ENTRIES (suppress nothing, delete them): "
           + ", ".join(gate["allowlist_entries_that_fired_on_nothing"])
           if gate["allowlist_entries_that_fired_on_nothing"] else "")
    )

    head_check = verify_guarded_match_head(APPEND_ONLY_GUARDED, REPO_ROOT)
    art["APPEND_ONLY_VERIFICATION"] = head_check
    assert head_check["all_match"], (
        "APPEND-ONLY VIOLATED AGAINST HEAD: a guarded artifact differs from its committed bytes.\n"
        + "\n".join(f"  {r}" for r in head_check["rows"] if not r.get("match"))
        + "\n  'Clean because nothing has looked' is not clean -- git's stat cache had not been "
          "invalidated, so `git status` was answering from a stale mtime rather than the content."
    )

    # D7: EXPLICIT NEWLINE POLICY. write_text() without `newline` applies PLATFORM newline
    # translation, so the same measurement produced LF bytes on Linux and CRLF bytes on Windows.
    # A byte-reproducibility claim that only holds on one OS is not one, and this is the mechanism
    # that put CRLF into 30 of the 40 artifacts in this directory in the first place. Pinned here,
    # and pinned for git in this directory's .gitattributes, so both ends agree.
    OUT_PATH.write_text(json.dumps(art, indent=1), encoding="utf-8", newline="\n")

    after_hashes = {p.name: sha(p) for p in scope if p.exists()}
    assert before_hashes == after_hashes, (
        "APPEND-ONLY VIOLATED: a pre-existing artifact in this directory changed during this run:\n"
        + "\n".join(f"  {k}: {before_hashes.get(k)} -> {after_hashes.get(k)}" for k in before_hashes
                    if before_hashes.get(k) != after_hashes.get(k))
    )
    _summarise(art)


if __name__ == "__main__":
    main()
