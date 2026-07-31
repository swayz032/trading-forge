"""R-503 lane I7 -- MEASURE the C2 session-role resolver effect, COMPLETE contract.

WHAT THIS ANSWERS, and nothing wider: with TF_SESSION_ROLE_RESOLVER_ENABLED
flipped OFF -> ON over TWO SEPARATELY-REPORTED POPULATIONS, which conditions
change BINDING outcome and which change REFUSAL-REASON classification, BY
IDENTITY.

★★★★★ THE HEADLINE LAW THIS FILE IS BUILT AROUND (R-503 §1):
  `NEVER USE THE NAKED WORD "YIELD" WITHOUT NAMING WHICH FIELD MOVED.`
  This feature deliberately produces TWO outputs and one number cannot carry
  it. Every metric below names its FIELD, its NUMERATOR and its DENOMINATOR.
  The first version of this instrument diffed the BINDING fields only and
  reported `0`, which measured the one thing the redesign was built NOT to do
  (R-502 §4: `A ZERO ON THE WRONG FIELD IS NOT A NULL RESULT, IT IS A MISSED
  MEASUREMENT`). The `reason` field is now diffed as a first-class output.

Conventions mirrored from the sibling instrument `dual_denominator_remeasure.py`
rather than invented:
  * REPO_ROOT via parents[3] + chdir + sys.path.insert
  * Trap 7 -- import via `src.engine.*`, NEVER `engine.*`, so a global
    editable-install .pth cannot resolve the name into a DIFFERENT checkout.

LAWS THIS SCRIPT IS BUILT TO OBEY:
  * A FLAGS-OFF CONTROL IS MANDATORY.
  * ACCEPTANCE IS THE PINNED CONDITION IDENTITIES, NEVER THE COUNT (R-425).
    Every count in this artifact is `len()` of the list beside it.
  * A NUMBER CARRIES ITS TREE, ITS POPULATION AND ITS FLAG STATE.
  * CORPORA ARE SEPARATE (v4 §0). Corpus A and Corpus B are measured under
    identical controls and reported in SEPARATE blocks. NOTHING IS POOLED.
  * `A TEST THAT SELECTS ITS OWN DENOMINATOR CANNOT FAIL` (R-503 §5.B) -- the
    C2-eligible population for Corpus A comes from the PINNED BASELINE
    artifact, never from the treatment arm's own classifier output.
  * `A PINNED SHA BESIDE A DIRTY TREE IS A LABEL, NOT A PROVENANCE` (R-502 §4)
    -- §G builds a SOURCE-CLOSURE MANIFEST over the EXECUTED import closure and
    asserts the dirty-path intersection is ZERO.
  * A REASON CONSTANT IS READ FROM THE MODULE, NEVER HAND-TYPED. A hand-copied
    expected value is a fabricated safety claim.

THIS SCRIPT MEASURES. IT DOES NOT GRADE. Whether a refusal is the CORRECT
disposition for a condition is ground truth and belongs to an independent
grader. Every classification here is MECHANICAL -- derived from the binder's
own outputs and its own predicates.
"""

import hashlib
import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
os.chdir(REPO_ROOT)
sys.path.insert(0, str(REPO_ROOT))

# Trap 7: src.engine.*, never engine.*
import src.engine.spec_family_bindings as sfb  # noqa: E402

H1 = REPO_ROOT / "docs" / "replay-results" / "h1-battery"
CORPUS_A_DIR = (
    REPO_ROOT / "docs" / "replay-results" / "h1-scripts" / "claude-rung-v32" / "shakedown_specs"
)
CORPUS_B_PATH = REPO_ROOT / "docs" / "replay-results" / "or-branches-full-corpus-specs-2026-07-05.json"
PINNED_BASELINE_PATH = H1 / "dual-denominator-remeasure-2026-07-21.json"

FLAG = "TF_SESSION_ROLE_RESOLVER_ENABLED"
# The pinned baseline's BEFORE arm declares BOTH level-zone flags false. An OFF
# arm that differs from the baseline on ANY flag is not the baseline's arm, and
# comparing to it would be a join-key error. Held false in BOTH arms so the only
# variable in this experiment is FLAG.
HELD_FLAGS = {"TF_LEVELZONE_ROUTING_ENABLED": "false", "TF_LEVELZONE_RESOLVER_ENABLED": "false"}

OUT_PATH = H1 / "session-role-resolver-yield-2026-07-31.json"
ARTIFACT_REL = "docs/replay-results/h1-battery/session-role-resolver-yield-2026-07-31.json"
GENERATOR_REL = "docs/replay-results/h1-battery/session_role_resolver_yield.py"
"""The AUTHORITATIVE published path. Kept separate from OUT_PATH because the
red-proof harness redirects OUT_PATH to a throwaway file; publication claims
must always be about the real artifact, never about wherever a run wrote."""

FAMILY_TYPE = "WAIT_SESSION"

ASSERTIONS: list[dict] = []


def check(name: str, ok: bool, detail) -> bool:
    """Executable assertion. R-503 §5.H -- the pinned-baseline comparison is
    ENCODED AS AN ASSERTION IN THE ARTIFACT, not described in prose."""
    ASSERTIONS.append({"assertion": name, "PASS": bool(ok), "detail": detail})
    return bool(ok)


# ─────────────────────────────────────────────────────────────────────────────
# Reason constants -- READ FROM THE MODULE, never hand-typed
# ─────────────────────────────────────────────────────────────────────────────
R_TEACHING = sfb.SESSION_TEACHING_UNBOUND_REASON
R_WRAPPING = sfb.SESSION_WRAPPING_WINDOW_UNBOUND_REASON
R_ORPHAN_PREFIX = sfb.session_refusal_reason("").rstrip(":")  # "session_zone_refused_uncomputable_window"


def derive_unrecognized_reason() -> str:
    """The generic 'not even recognized' reason is a LITERAL in the binder, not
    an exported constant. Deriving it from a synthetic probe rather than typing
    it keeps this instrument honest if the literal ever changes."""
    probe = {"id": "WAIT_SESSION:zzz-instrument-probe-not-a-session#0",
             "type": FAMILY_TYPE, "role": "spine",
             "object": "zzzqqq not a session phrase at all zzzqqq"}
    os.environ[FLAG] = "true"
    return sfb.bind_condition(probe).reason


# ─────────────────────────────────────────────────────────────────────────────
# §G  PROVENANCE -- source-closure manifest
# ─────────────────────────────────────────────────────────────────────────────
def git(*args) -> str:
    try:
        return subprocess.check_output(
            ["git", *args], cwd=str(REPO_ROOT), stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception as exc:
        return "<unavailable: %s>" % exc


VOLATILE_EXCLUSIONS = [
    "TREE",
    # ⚠️ R-510 §6.4 REPLACES R-509 §6.4(a)'s blanket exclusion of the whole
    #    source-closure block. `A FULL-ARTIFACT DIGEST CANNOT EXCLUDE THE ENTIRE
    #    PROOF OF WHICH SOURCES RAN.` Only these individually-justified
    #    run-volatile VALUES are stripped; every path identity, blob pair,
    #    divergence list and intersection identity stays INSIDE the digest.
    "PROVENANCE_SOURCE_CLOSURE.head",
    "PROVENANCE_SOURCE_CLOSURE.tree_dirty_path_count",
    "PROVENANCE_SOURCE_CLOSURE.PRE_RUN_STATUS.dirty_path_count",
    "PROVENANCE_SOURCE_CLOSURE.POST_RUN_STATUS.dirty_path_count",
    "DEPLOYED_LANE_SCOPE__READ_BEFORE_QUOTING_ANY_NUMBER_HERE.SNAPSHOT_RECORD.generated_at_utc",
    "DEPLOYED_LANE_SCOPE__READ_BEFORE_QUOTING_ANY_NUMBER_HERE.SNAPSHOT_RECORD.campaign_commit",
    "ASSERTIONS.checks[name starts with 'PROVENANCE_' or 'PUBLICATION_'].detail",
    "PUBLICATION_PATHS",
    "DIGEST_COVERAGE.value",
    # The measurement HEAD again, under its named identity. Same value as
    # `campaign_commit`, same reason: committing the artifact advances it.
    "PUBLICATION_IDENTITIES.measurement_source_commit.value",
]
"""★★★★★ R-509 §6.4, OPTION (a) — THE COMPLETE, ENUMERATED, AUDITABLE EXCLUSION
LIST. Everything NOT on this list is inside `artifact_content_digest`.

WHY EACH ONE, because `AN EXCLUSION WITHOUT A REASON IS AN ALLOW-LIST`:
  * `TREE` — excluded WHOLE. It is provenance of this run and nothing else.
  * `PROVENANCE_SOURCE_CLOSURE` — ⚠️ **NOT excluded whole. FOUR named
    sub-paths only**: `.head`, `.tree_dirty_path_count`, and the two
    `*_RUN_STATUS.dirty_path_count` values. Every closure PATH IDENTITY, blob
    pair, divergence list and dirty-intersection identity stays INSIDE the
    digest — that is exactly what R-510 §6.4 changed, and M11 proves it by
    altering one closure path and going RED.
    ★ R-511 §3-3 — this bullet previously grouped the two blocks together and
    read as if the whole closure were dropped, while the enumerated list four
    lines above stripped only the four sub-paths. THE LIST WAS RIGHT AND THIS
    PROSE WAS WRONG, which is the more dangerous arrangement: the prose is what
    gets read. The shared reason below applies to the four VALUES, not to the
    blocks that contain them.
  * why those four values move at all: committing the artifact advances HEAD
    and changes the dirty-path count, so including them makes every correctly
    published artifact read as stale. `A FRESHNESS CHECK THAT CRIES WOLF ON
    EVERY COMMIT WILL BE SWITCHED OFF.`
  * the two SNAPSHOT_RECORD fields — a timestamp and the same HEAD.
  * `detail` of `PROVENANCE_*` assertions — these are DERIVED from
    `PROVENANCE_SOURCE_CLOSURE` (they carry dirty-path counts), so excluding
    the block while keeping its derivatives would be incoherent. ★ Their
    assertion NAME and PASS value are still covered; only the detail payload
    is not. ⚠️ THIS ENTRY IS MINE, added beyond R-509 §6.4's four named items
    because those four alone leave the dirty-count derivatives inside the
    digest — and I am NAMING it rather than widening the list silently.

★ EVERYTHING ELSE IS NOW COVERED, including the `11` top-level blocks and the
`30` assertion `detail` payloads that the previous allow-list could not see:
`IDENTITY_REFUSAL_MAP` (the 17 per-condition identities R-502 §4 demanded),
`ROUTE_PARTITION_*`, `NON_C2_MOVEMENT_CENSUS`, `DENOMINATORS`, `POPULATION`,
`DETERMINISM`, `INVALIDATIONS_SEPARATE`, `POSITIVE_CONTROLS`, the HEADLINE and
the honest-limits block.
"""


def _strip_volatile(art: dict) -> dict:
    """Deep copy minus exactly VOLATILE_EXCLUSIONS. Implemented as a STRIP so
    the function matches its own name -- the previous version was an ALLOW-LIST
    wearing a strip-list's docstring, which is R-509 §8.3's whole point:
    `AN ALLOW-LIST DESCRIBED IN STRIP-LIST LANGUAGE OVERSTATES ITS COVERAGE BY
    EVERYTHING IT NEVER MENTIONS.`"""
    doc = json.loads(json.dumps(art, default=str))
    doc.pop("TREE", None)
    # ★ R-510 §6.4 -- CANONICALISE the closure, never delete it. The path
    #   identities, blob pairs, divergence lists and intersection identities
    #   are the PROOF OF WHICH SOURCES RAN and stay inside the digest; only
    #   the measurement HEAD (which necessarily advances) and the unrelated
    #   whole-tree dirty totals come out.
    prov = doc.get("PROVENANCE_SOURCE_CLOSURE")
    if isinstance(prov, dict):
        prov.pop("head", None)
        prov.pop("tree_dirty_path_count", None)
        for k in ("PRE_RUN_STATUS", "POST_RUN_STATUS"):
            if isinstance(prov.get(k), dict):
                prov[k].pop("dirty_path_count", None)
    snap = doc.get("DEPLOYED_LANE_SCOPE__READ_BEFORE_QUOTING_ANY_NUMBER_HERE", {}) \
              .get("SNAPSHOT_RECORD")
    if isinstance(snap, dict):
        snap.pop("generated_at_utc", None)
        snap.pop("campaign_commit", None)
    for c in doc.get("ASSERTIONS", {}).get("checks", []):
        if str(c.get("assertion", "")).startswith(("PROVENANCE_", "PUBLICATION_")):
            # Their details are worktree-vs-HEAD BLOB PAIRS -- provenance of the
            # run, not measured content. Leaving them in couples the artifact's
            # freshness to every edit of the HARNESS, which would report a
            # correct artifact as stale whenever the test rig changed.
            c.pop("detail", None)
    # PUBLICATION_PATHS holds worktree-vs-HEAD blob pairs, which necessarily
    # differ between a pre-commit and a post-commit run of identical content.
    doc.pop("PUBLICATION_PATHS", None)
    # A digest cannot contain itself.
    if isinstance(doc.get("DIGEST_COVERAGE"), dict):
        doc["DIGEST_COVERAGE"].pop("value", None)
    ident = doc.get("PUBLICATION_IDENTITIES")
    if isinstance(ident, dict) and isinstance(ident.get("measurement_source_commit"), dict):
        ident["measurement_source_commit"].pop("value", None)
    return doc


def artifact_content_digest(art: dict) -> str:
    """★ R-509 §6.4(a). Canonicalised FULL artifact minus VOLATILE_EXCLUSIONS.
    The name states what it compares; the exclusions are enumerated above."""
    return hashlib.sha256(
        json.dumps(_strip_volatile(art), sort_keys=True, default=str).encode("utf-8")).hexdigest()


# ★★★★★ R-511 §3-2/§6.5 -- `stable_digest` IS DELETED, NOT REPAIRED.
#   It was DEAD: zero executable call sites tree-wide (measured, with
#   `artifact_content_digest` as the positive control -- the same query finds
#   that one's real callers). Its docstring still described the R-509 §6.4(a)
#   behaviour that R-510 §6.4 REVERSED, claiming PROVENANCE_SOURCE_CLOSURE was
#   stripped when the closure is now INSIDE the digest.
#   It is also the function R-509 §4 convicted by name, so a reader auditing the
#   freshness guard landed on the convicted name and read a false answer about
#   code nobody ran. `A DEAD FUNCTION WITH A LIVE NAME IS A DOCUMENTATION
#   SURFACE` -- and the repair for a documentation surface that lies is deletion,
#   not better prose. THE LIVE DIGEST IS `artifact_content_digest` ABOVE.


def git_at(repo: Path, *args) -> str:
    """git in ANOTHER tree -- the deployed lane is a separate checkout."""
    try:
        return subprocess.check_output(
            ["git", *args], cwd=str(repo), stderr=subprocess.DEVNULL).decode().strip()
    except Exception as exc:
        return "<unavailable: %s>" % exc


def _now_utc() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def dirty_paths() -> list[str]:
    out = []
    for line in git("status", "--porcelain").splitlines():
        if not line.strip():
            continue
        p = line[3:].strip().strip('"')
        if " -> " in p:  # rename
            p = p.split(" -> ", 1)[1]
        out.append(p.replace("\\", "/"))
    return sorted(set(out))


def blob_pair(rel: str) -> dict:
    """Worktree bytes vs the blob at HEAD. Equality here is what turns a pinned
    SHA into a PROVENANCE instead of a label."""
    work = git("hash-object", "--", rel)
    head = git("rev-parse", "HEAD:%s" % rel)
    return {"path": rel, "worktree_blob": work, "head_blob": head, "IDENTICAL": work == head}


def source_closure_manifest(head: str, dirty: list[str], dirty_pre: list[str]) -> dict:
    """The EXECUTED import closure -- taken from sys.modules AFTER the binder is
    imported and the corpora are loaded, so it is what actually ran, not a
    static parse that could miss a dynamic import."""
    src_files = set()
    for mod in list(sys.modules.values()):
        f = getattr(mod, "__file__", None)
        if not f:
            continue
        try:
            p = Path(f).resolve()
        except Exception:
            continue
        try:
            rel = p.relative_to(REPO_ROOT)
        except ValueError:
            continue  # stdlib / site-packages -- outside the tree, not ours to pin
        relstr = str(rel).replace("\\", "/")
        # ★★★★★ THE TEST HARNESS IS NOT A MEASUREMENT SOURCE. When the RED-PROOF
        #   imports this generator, the harness sits in sys.modules and would
        #   join the closure -- making `closure_size` and `manifest` depend on
        #   WHICH ENTRY POINT invoked the run (21 standalone, 22 under the
        #   harness). That is an invocation artifact, not a source fact, and it
        #   made a correctly-published artifact read as stale once the closure
        #   entered the content digest. `A TEST RIG MUST NOT ENTER THE SOURCE
        #   CLOSURE OF THE THING IT TESTS.`
        if relstr.endswith("session_role_resolver_yield_REDPROOF.py"):
            continue
        src_files.add(relstr)

    # ★★★★★ THE GENERATOR ALWAYS COUNTS ITSELF, however it was loaded. Run
    #   standalone it appears in sys.modules as `__main__`; imported by the
    #   RED-PROOF via importlib.util.module_from_spec it is NOT registered in
    #   sys.modules at all, so the closure came to 22 one way and 21 the other
    #   and a correctly-published artifact read as stale. The generator is
    #   unquestionably a measurement source; asserting that directly removes
    #   the dependence on the entry point entirely.
    src_files.add(GENERATOR_REL)

    population_files = {str(Path(p).relative_to(REPO_ROOT)).replace("\\", "/")
                        for p in sorted(CORPUS_A_DIR.glob("*.spec.json"))}
    population_files.add(str(CORPUS_B_PATH.relative_to(REPO_ROOT)).replace("\\", "/"))
    population_files.add(str(PINNED_BASELINE_PATH.relative_to(REPO_ROOT)).replace("\\", "/"))

    closure = sorted(src_files | population_files)
    manifest = [blob_pair(rel) for rel in closure]
    divergent = [m for m in manifest if not m["IDENTICAL"]]
    intersection = sorted(set(closure) & set(dirty))

    return {
        "WHY_THIS_EXISTS": (
            "R-502 §4: `A PINNED SHA BESIDE A DIRTY TREE IS A LABEL, NOT A PROVENANCE.` "
            "Deterministic repeated execution proves repeatability INSIDE the checkout; "
            "it does NOT prove the binder that ran equals the named commit. This manifest "
            "does, by comparing worktree bytes to the HEAD blob for every file in the "
            "EXECUTED source+population closure."
        ),
        "head": head,
        "closure_size": len(closure),
        "binder_blob": blob_pair("src/engine/spec_family_bindings.py"),
        "generator_blob": blob_pair(
            "docs/replay-results/h1-battery/session_role_resolver_yield.py"),
        "pinned_baseline_blob": blob_pair(
            str(PINNED_BASELINE_PATH.relative_to(REPO_ROOT)).replace("\\", "/")),
        "corpus_A_file_count": len([p for p in population_files if "shakedown_specs" in p]),
        "corpus_B_blob": blob_pair(str(CORPUS_B_PATH.relative_to(REPO_ROOT)).replace("\\", "/")),
        "tree_dirty_path_count": len(dirty),
        "PRE_RUN_STATUS": {"dirty_path_count": len(dirty_pre),
                           "intersection_with_closure": sorted(set(closure) & set(dirty_pre))},
        "POST_RUN_STATUS": {"dirty_path_count": len(dirty),
                            "intersection_with_closure": intersection},
        "PRE_AND_POST_AGREE": sorted(set(closure) & set(dirty_pre)) == intersection,
        "WHY_PRE_AND_POST": (
            "R-503 §5.G requires BOTH. If the closure was clean before the run and dirty "
            "after, the run itself mutated a source it was measuring -- which no single "
            "post-run snapshot can detect."
        ),
        "DIRTY_INTERSECTION_WITH_CLOSURE": intersection,
        "DIVERGENT_FROM_HEAD_BLOB": divergent,
        "manifest": manifest,
        "NOTE_ON_THE_GENERATOR_ITSELF": (
            "The generator is expected to diverge on the run that CREATES a new version of "
            "it -- it is the instrument, not an input to the measurement. It is listed "
            "explicitly so the divergence is visible rather than hidden, and it is EXCLUDED "
            "from the measurement-closure assertion by name, never silently."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# R-506 §5 -- THE DEPLOYED-LANE SCOPE SENTENCE, MEASURED RATHER THAN TYPED
# ─────────────────────────────────────────────────────────────────────────────
DEPLOYED_BINDER = Path(
    r"C:/Users/tonio/Projects/trading-forge/runtime-production/src/engine/spec_family_bindings.py")

# The symbols that MAKE the capability this artifact measures. If any of these
# ever appears in the deployed binder, the capability has been PORTED and every
# scope sentence in this artifact is stale -- so the assertion below is a
# TRIPWIRE that self-destructs when the state it describes stops being true.
CAPABILITY_SYMBOLS = [
    "session_role_resolver_enabled", "classify_session_role",
    "SESSION_TEACHING_UNBOUND_REASON", "resolve_session_name_to_window",
    "SESSION_WRAPPING_WINDOW_UNBOUND_REASON", "SessionRoleResult",
]


def top_level_nodes(path: Path) -> dict:
    """name -> AST node for every top-level definition/binding."""
    import ast
    out = {}
    for n in ast.parse(path.read_text(encoding="utf-8")).body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out[n.name] = n
        elif isinstance(n, ast.Assign):
            for t in n.targets:
                if isinstance(t, ast.Name):
                    out[t.id] = n
        elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name):
            out[n.target.id] = n
    return out


def top_level_symbols(path: Path) -> set:
    return set(top_level_nodes(path))


def body_hash(node) -> str:
    """★ R-507 §6.7 -- structural hash of a symbol's BODY. `ast.dump` with
    default `include_attributes=False` ignores formatting, comments and line
    numbers, so this compares STRUCTURE AND LITERALS, not whitespace.
    ⚠️ IT IS STILL NOT A SEMANTIC PROOF: two structurally different bodies can
    behave identically, and identical structure with a different imported
    callee behind the same name can behave differently. It is strictly stronger
    than comparing NAMES, which is all the previous version did."""
    import ast
    return hashlib.sha256(ast.dump(node).encode("utf-8")).hexdigest()


def deployed_lane_scope() -> dict:
    """★★★★★ R-506 §5: `MEASURED != MEASURED-WHERE-IT-RUNS`. No number in this
    artifact may be stated about production without this block beside it. It is
    COMPUTED so it cannot drift out of agreement with the tree it describes --
    a hand-typed scope sentence is the first thing to go stale after a port."""
    if not DEPLOYED_BINDER.exists():
        return {"STATUS": "DEPLOYED_TREE_UNREACHABLE_FROM_THIS_MACHINE",
                "PATH": str(DEPLOYED_BINDER),
                "SCOPE_SENTENCE": "The deployed lane could not be read, so NOTHING here may "
                                  "be stated about production AT ALL. Fail-closed.",
                "capability_absent_from_deployed": None}
    camp_path = REPO_ROOT / "src/engine/spec_family_bindings.py"
    camp_nodes, dep_nodes = top_level_nodes(camp_path), top_level_nodes(DEPLOYED_BINDER)
    camp, dep = set(camp_nodes), set(dep_nodes)
    present = sorted(s for s in CAPABILITY_SYMBOLS if s in dep)

    # ★ R-507 §6.7 -- compare the SHARED symbols' BODIES, not just their names.
    shared = sorted(camp & dep)
    differing = [s for s in shared if body_hash(camp_nodes[s]) != body_hash(dep_nodes[s])]

    # parents[0]=engine, [1]=src, [2]=<repo root>. An earlier [3] walked one
    # level too far and returned exit 128 -- caught only because the value was
    # PRINTED rather than trusted. `AN UNREAD FIELD IS AN UNTESTED FIELD.`
    dep_repo = DEPLOYED_BINDER.parents[2]
    dep_head = git_at(dep_repo, "rev-parse", "HEAD")
    return {
        "STATUS": "MEASURED",
        # ── R-507 §6.4/§6.5 -- the snapshot record every scope claim binds to ──
        "SNAPSHOT_RECORD": {
            "generated_at_utc": _now_utc(),
            "campaign_commit": git("rev-parse", "HEAD"),
            "campaign_binder_blob": git("hash-object", "--", "src/engine/spec_family_bindings.py"),
            "generator_blob": git(
                "hash-object", "--", "docs/replay-results/h1-battery/session_role_resolver_yield.py"),
            "deployed_path": str(DEPLOYED_BINDER),
            "deployed_repo_root": str(dep_repo),
            "deployed_repo_head": dep_head,
            "deployed_repo_head_RESOLVED": not dep_head.startswith("<unavailable"),
            "deployed_binder_sha256": hashlib.sha256(DEPLOYED_BINDER.read_bytes()).hexdigest(),
            "WHY": "R-507 §6.4/§6.5 -- the deployed binder lives in a DIFFERENT git tree, so it "
                   "cannot join this run's source closure by HEAD-blob comparison. It is hashed "
                   "SEPARATELY here and that hash is what every deployed-scope claim binds to.",
        },
        "campaign_bytes": camp_path.stat().st_size,
        "deployed_bytes": DEPLOYED_BINDER.stat().st_size,
        "campaign_top_level_symbols": len(camp),
        "deployed_top_level_symbols": len(dep),
        "in_campaign_ABSENT_from_deployed": len(camp - dep),
        "in_deployed_ABSENT_from_campaign": len(dep - camp),
        # ── R-507 §6.1 -- TWO explicit predicates. The old single key was named
        #    STRICT_SUBSET and tested `dep <= camp`, which PASSES ON EQUALITY.
        #    `A SUBSET TEST THAT PASSES EQUALITY IS NOT A STRICT-SUBSET TEST.`
        "DEPLOYED_IS_SUBSET_OR_EQUAL": dep <= camp,
        "DEPLOYED_IS_STRICT_SUBSET": dep < camp,
        "STRICT_SUBSET_REQUIRES_BOTH": {
            "zero_deployed_only": len(dep - camp) == 0,
            "at_least_one_campaign_only": len(camp - dep) >= 1,
            "NOTE": "The retired `STRICT_SUBSET` key tested only the first of these.",
        },
        # ── R-507 §6.7 -- shared-symbol body comparison ───────────────────────
        "SHARED_SYMBOL_BODY_COMPARISON": {
            "shared_symbol_count": len(shared),
            "bodies_DIFFERING": differing,
            "n_bodies_differing": len(differing),
            "METHOD": "sha256 over ast.dump(node) with include_attributes=False -- structure "
                      "and literals, independent of formatting, comments and line numbers.",
            "⚠️_WHAT_THIS_STILL_DOES_NOT_PROVE": (
                "Structural equality is NOT behavioural equality: a shared name whose body "
                "calls a DIFFERENT underlying implementation hashes identically. This is "
                "strictly stronger than the name-only comparison it replaces and is NOT a "
                "semantic parity proof. `ZERO DEPLOYED-ONLY SYMBOL NAMES DOES NOT PROVE ZERO "
                "DEPLOYED-SIDE SEMANTIC DIVERGENCE` (R-507 §4)."
            ),
        },
        "capability_symbols_checked": CAPABILITY_SYMBOLS,
        "capability_symbols_PRESENT_in_deployed": present,
        "capability_absent_from_deployed": present == [],
        # ── R-507 §6.6 + §6.12 -- the narrow claim, and the cadence truth ─────
        "★_SCOPE_SENTENCE": (
            "EVERY NUMBER IN THIS ARTIFACT IS A CAMPAIGN-LANE FACT. NARROW, MEASURED CLAIM: "
            "the SIX named top-level symbols in `capability_symbols_checked` are ABSENT from "
            "the deployed binder's TOP-LEVEL symbol table. THIS IS NOT AN ENGINE-WIDE "
            "CAPABILITY-ABSENCE PROOF -- imported aliases, renamed or nested implementations, "
            "tuple-bound names and shared bodies are NOT covered, and no repo-wide "
            "import/alias/call-path audit has been run. `MEASURED != MEASURED-WHERE-IT-RUNS`: "
            "no figure here may be stated about production without this block beside it."
        ),
        "★_STATIC_SNAPSHOT_NOTICE": (
            "This artifact is a static snapshot and does not auto-update; rerun is required "
            "after any deployed-binder change. NO CI JOB OR SCHEDULER REGENERATES THIS FILE "
            "[MEASURED, R-507 §3]."
        ),
        "★_THE_TRIPWIRE_IS_RERUN_TIME_ONLY": (
            "The scope assertion fires only when a human reruns this generator. "
            "`A RERUN-TIME GUARD IS NOT A LIVE INVALIDATION MECHANISM.` An earlier version of "
            "this file claimed the tripwire 'self-destructs' when the capability is ported; "
            "THAT CLAIM IS WITHDRAWN -- nothing reruns it automatically, so the artifact can "
            "go stale silently and the guard will not say so."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Population loading -- CORPORA ARE SEPARATE
# ─────────────────────────────────────────────────────────────────────────────
def load_corpus_a():
    entry, inval, files = [], [], sorted(CORPUS_A_DIR.glob("*.spec.json"))
    for fp in files:
        with open(fp, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
        spec = doc.get("spec") or {}
        for c in spec.get("entry_conditions") or []:
            entry.append((fp.name, doc.get("video"), c))
        for c in spec.get("invalidations") or []:
            inval.append((fp.name, doc.get("video"), c))
    return [f.name for f in files], entry, inval


def load_corpus_b():
    with open(CORPUS_B_PATH, "r", encoding="utf-8") as fh:
        doc = json.load(fh)
    entry, inval = [], []
    for sid, rec in doc.items():
        spec = rec.get("spec") or {}
        for c in spec.get("entry_conditions") or []:
            entry.append((sid, rec.get("name"), c))
        for c in spec.get("invalidations") or []:
            inval.append((sid, rec.get("name"), c))
    return sorted(doc.keys()), entry, inval


def bind_all(conditions, flag_value):
    """Bind every condition under one flag state. The gate is read AT CALL TIME,
    so setting the env here is sufficient and no module reload is needed. The
    HELD flags are re-asserted every arm so a stray mutation cannot drift them."""
    os.environ[FLAG] = flag_value
    for k, v in HELD_FLAGS.items():
        os.environ[k] = v
    out = {}
    for owner, label, cond in conditions:
        cid = cond.get("id")
        key = "%s::%s" % (owner, cid)
        try:
            b = sfb.bind_condition(cond)
            bindable = bool(b.bindable)
            approximation = bool(b.approximation)
            out[key] = {
                "owner": owner, "label": label, "condition_id": cid,
                "type": cond.get("type"), "object": cond.get("object"),
                "bindable": bindable,
                "approximation": approximation,
                # ★ R-503 §5.A -- defined ONCE, here, and never re-derived in prose.
                "bound_and_concrete": bindable and not approximation,
                "primitive": b.primitive,
                "session_zone": getattr(b, "session_zone", None),
                "reason": b.reason,
            }
        except Exception as exc:
            out[key] = {"owner": owner, "label": label, "condition_id": cid,
                        "type": cond.get("type"), "object": cond.get("object"),
                        "ERROR": "%s: %s" % (type(exc).__name__, exc)}
    return out


# ─────────────────────────────────────────────────────────────────────────────
# §C  IDENTITY-LEVEL REFUSAL MAP  +  §D  ROUTE PARTITION
# ─────────────────────────────────────────────────────────────────────────────
def route_of(rec: dict, unrecognized_reason: str) -> str:
    """MECHANICAL route classification, derived from the binder's OWN outputs
    plus its OWN predicate -- never from a hand-written precedence model.

    The binder's order (spec_family_bindings.py :2500-2637, read at the
    executable line) is: exact-phrase/name route -> ORPHAN-ZONE refusal ->
    [gate] computed-zone refusal -> wrapping-window refusal ->
    recognized-without-zone refusal -> fall-through unrecognized. The orphan
    refusal fires BEFORE the gate, which is why an orphan row is invariant to
    the flag -- that is the §3 reconciliation's mechanism.
    """
    if "ERROR" in rec:
        return "ERROR"
    if rec.get("bindable"):
        if rec.get("primitive") == sfb.SESSION_NAME_ROUTE_PRIMITIVE:
            return "exact_name_route_bind"
        return "bound_by_other_route"
    reason = rec.get("reason")
    if reason is None:
        return "unbound_no_reason"
    if reason.startswith(R_ORPHAN_PREFIX):
        return "orphan_zone_refusal"
    if reason == R_WRAPPING:
        return "wrapping_window_refusal"
    if reason == R_TEACHING:
        # Only the computed-zone branch and the recognized-without-zone branch
        # emit this reason. The classifier's own zone output separates them.
        zone = sfb.classify_session_role(rec.get("object") or "").zone
        return "computed_zone_deliberate_refusal" if zone is not None \
            else "recognized_without_zone_refusal"
    if reason == unrecognized_reason:
        return "fully_unrecognized"
    return "other_refusal:%s" % reason


def identity_refusal_map(off, on, unrecognized_reason):
    """★ R-503 §5.C -- per CHANGED row, every field the ruling names.
    COUNTS ARE DERIVED FROM THESE LISTS, never asserted beside them."""
    rows = []
    os.environ[FLAG] = "true"
    for key in sorted(set(off) | set(on)):
        a, b = off.get(key, {}), on.get(key, {})
        if "ERROR" in a or "ERROR" in b:
            continue
        if a.get("reason") == b.get("reason") and a.get("bindable") == b.get("bindable") \
                and a.get("primitive") == b.get("primitive") \
                and a.get("session_zone") == b.get("session_zone"):
            continue
        cls = sfb.classify_session_role(b.get("object") or "")
        rows.append({
            "key": key,
            "file_or_strategy": b.get("owner"),
            "video_or_name": b.get("label"),
            "condition_id": b.get("condition_id"),
            "type": b.get("type"),
            "object": b.get("object"),
            "OFF": {"bindable": a.get("bindable"), "primitive": a.get("primitive"),
                    "approximation": a.get("approximation"),
                    "bound_and_concrete": a.get("bound_and_concrete"),
                    "session_zone": a.get("session_zone"), "reason": a.get("reason"),
                    "route": route_of(a, unrecognized_reason)},
            "ON": {"bindable": b.get("bindable"), "primitive": b.get("primitive"),
                   "approximation": b.get("approximation"),
                   "bound_and_concrete": b.get("bound_and_concrete"),
                   "session_zone": b.get("session_zone"), "reason": b.get("reason"),
                   "route": route_of(b, unrecognized_reason)},
            "classifier_recognized": bool(cls.recognized),
            "classifier_candidate_zone": cls.zone,
            "classifier_refusal": cls.refusal,
            "FINAL_DISPOSITION": route_of(b, unrecognized_reason),
        })
    return rows


def route_partition(arm, unrecognized_reason, family_only=True):
    """★ R-503 §5.D. Buckets hold IDENTITIES; the histogram is len() of each."""
    buckets: dict[str, list] = {}
    for key, rec in sorted(arm.items()):
        if family_only and rec.get("type") != FAMILY_TYPE:
            continue
        buckets.setdefault(route_of(rec, unrecognized_reason), []).append(key)
    return {
        "histogram": {k: len(v) for k, v in sorted(buckets.items())},
        "identities": {k: v for k, v in sorted(buckets.items())},
    }


# ─────────────────────────────────────────────────────────────────────────────
# §B  DENOMINATORS  (three, one of them baseline-sourced)
# ─────────────────────────────────────────────────────────────────────────────
def baseline_c2_population():
    """★★★★★ R-503 §5.B -- the C2-eligible population for Corpus A is SELECTED
    FROM THE PINNED BASELINE, never from the ON arm's own recognition result.
    `A TEST THAT SELECTS ITS OWN DENOMINATOR CANNOT FAIL.`

    The baseline lists unbound conditions as {spec, type, condition_id}; this
    instrument keys on `<filename>::<condition_id>`. THE JOIN KEY IS THE CLAIM,
    so the join is built explicitly and its success is ASSERTED, never assumed.
    """
    with open(PINNED_BASELINE_PATH, "r", encoding="utf-8") as fh:
        base = json.load(fh)
    conds = base["corpus_A"]["THE_UNBOUND_COUNT_TRAVELS_BESIDE_THE_RATE"]["conditions"]
    keys = ["%s.spec.json::%s" % (c["spec"], c["condition_id"]) for c in conds]
    return base, conds, sorted(set(keys))


# ─────────────────────────────────────────────────────────────────────────────
# per-corpus measurement
# ─────────────────────────────────────────────────────────────────────────────
def measure(corpus_name, owners, entry, inval, unrecognized_reason,
            c2_keys, c2_provenance):
    off_1 = bind_all(entry, "false")
    on_1 = bind_all(entry, "true")
    off_2 = bind_all(entry, "false")
    on_2 = bind_all(entry, "true")
    deterministic = (off_1 == off_2) and (on_1 == on_2)

    inval_off = bind_all(inval, "false")
    inval_on = bind_all(inval, "true")

    changed = identity_refusal_map(off_1, on_1, unrecognized_reason)
    binding_moves = [r for r in changed
                     if r["OFF"]["bound_and_concrete"] != r["ON"]["bound_and_concrete"]]
    reason_moves = [r for r in changed if r["OFF"]["reason"] != r["ON"]["reason"]]

    family_keys = sorted(k for k, v in off_1.items() if v.get("type") == FAMILY_TYPE)
    c2_keys_present = sorted(set(c2_keys) & set(off_1)) if c2_keys is not None else None
    c2_keys_missing = sorted(set(c2_keys) - set(off_1)) if c2_keys is not None else None

    def within(rows, keyset):
        return [r for r in rows if keyset is None or r["key"] in keyset]

    fam = set(family_keys)
    c2s = set(c2_keys_present) if c2_keys_present is not None else None

    # ── §F NON-C2 MOVEMENT CENSUS, BY IDENTITY ────────────────────────────────
    non_c2_moved = [r for r in changed if c2s is None or r["key"] not in c2s]
    non_family_moved = [r for r in changed if r["key"] not in fam]

    inval_changed = identity_refusal_map(inval_off, inval_on, unrecognized_reason)

    block = {
        "POPULATION": {
            "name": corpus_name,
            "owners": len(owners),
            "entry_conditions": len(entry),
            "invalidations_REPORTED_SEPARATELY": len(inval),
            "CORPORA_ARE_SEPARATE": (
                "Measured under identical OFF/ON controls and reported in its own block. "
                "NOTHING IS POOLED WITH ANY OTHER CORPUS. Each result keeps its own tree, "
                "population, flag state and denominators."
            ),
        },
        "DETERMINISM": {"each_arm_run_twice": True, "identical_across_runs": deterministic},
        # ── §A METRIC DEFINITIONS ────────────────────────────────────────────
        "METRICS": {
            "binding_movement": {
                "FIELD_THAT_MOVED": "bound_and_concrete ( = bindable AND NOT approximation )",
                "binding_yield_numerator": len(binding_moves),
                "binding_yield_numerator_IS": "len(identities whose bound_and_concrete changed)",
                "denominators": {
                    "global_entry_condition": len(entry),
                    "%s_family" % FAMILY_TYPE: len(family_keys),
                    "C2_eligible_baseline_defined": (
                        len(c2_keys_present) if c2_keys_present is not None else None),
                },
                "identities": binding_moves,
            },
            "diagnostic_reason_movement": {
                "FIELD_THAT_MOVED": "reason (the refusal classification)",
                "diagnostic_reason_yield_numerator": len(reason_moves),
                "diagnostic_reason_yield_numerator_IS":
                    "len(identities whose refusal reason changed)",
                "denominators": {
                    "global_entry_condition": len(entry),
                    "%s_family" % FAMILY_TYPE: len(family_keys),
                    "C2_eligible_baseline_defined": (
                        len(c2_keys_present) if c2_keys_present is not None else None),
                },
                "numerator_restricted_to_C2_eligible": (
                    len(within(reason_moves, c2s)) if c2s is not None else None),
                "transition_classes": dict(Counter(
                    "%s -> %s" % (r["OFF"]["reason"], r["ON"]["reason"]) for r in reason_moves)),
                "identities": reason_moves,
            },
            "THE_BANNED_WORD": (
                "The naked word 'yield' is BANNED in this artifact (R-503 §1). Every metric "
                "above names the FIELD that moved. A single number cannot carry a feature "
                "that deliberately produces two outputs -- a safety property PRESERVED "
                "(binding) and a diagnostic property ADDED (reason)."
            ),
        },
        # ── §B DENOMINATORS ─────────────────────────────────────────────────
        "DENOMINATORS": {
            "global_entry_condition": {"n": len(entry), "definition":
                                       "every entry_condition in the corpus, all types"},
            "%s_family" % FAMILY_TYPE: {"n": len(family_keys), "definition":
                                        "entry_conditions of type %s" % FAMILY_TYPE},
            "C2_eligible": {
                "n": len(c2_keys_present) if c2_keys_present is not None else None,
                "PROVENANCE": c2_provenance,
                "declared_keys": len(c2_keys) if c2_keys is not None else None,
                "keys_not_found_in_this_population": c2_keys_missing,
                "JOIN_KEY_IS_THE_CLAIM": (
                    "Baseline rows are {spec, condition_id}; this instrument keys on "
                    "'<file>::<condition_id>'. The join is built explicitly and asserted."
                ),
            },
        },
        # ── §C IDENTITY-LEVEL REFUSAL MAP ────────────────────────────────────
        "IDENTITY_REFUSAL_MAP": {
            "changed_rows": changed,
            "n_changed": len(changed),
            "COUNTS_ARE_DERIVED": "Every count is len() of the list beside it.",
        },
        # ── §D ROUTE PARTITION ──────────────────────────────────────────────
        "ROUTE_PARTITION_%s_family" % FAMILY_TYPE: {
            "OFF_arm": route_partition(off_1, unrecognized_reason),
            "ON_arm": route_partition(on_1, unrecognized_reason),
            "ROUTES_ARE_MECHANICAL": (
                "Each row's route is derived from the binder's OWN reason output plus its "
                "OWN classifier predicate, in the binder's OWN precedence order. No route "
                "is assigned by judgment."
            ),
        },
        # ── §F NON-C2 MOVEMENT CENSUS ───────────────────────────────────────
        "NON_C2_MOVEMENT_CENSUS": {
            "moved_outside_C2_eligible": non_c2_moved,
            "n_moved_outside_C2_eligible": len(non_c2_moved),
            "moved_outside_%s_family" % FAMILY_TYPE: non_family_moved,
            "n_moved_outside_family": len(non_family_moved),
            "HARD_STOP_RULE": (
                "R-503 §5.F: an unexpected movement outside the family is a HARD STOP. "
                "Proven BY IDENTITY -- an empty list here is accompanied by the positive "
                "control that the arms ran and did move rows INSIDE the family."
            ),
        },
        "INVALIDATIONS_SEPARATE": {
            "population": len(inval),
            "changed_rows": inval_changed,
            "n_changed": len(inval_changed),
            "WHY_SEPARATE": (
                "Declared exclusion, same as the ledger-E packet. Invalidations are never "
                "merged into the entry-condition denominators or headline."
            ),
        },
        "_off": off_1, "_on": on_1, "_family_keys": family_keys,
        "_c2_present": c2_keys_present, "_deterministic": deterministic,
        "_reason_moves": reason_moves, "_binding_moves": binding_moves,
    }
    return block


def reconcile_18_17_9(on_arm, off_arm, unrecognized_reason, family_keys):
    """★★★★★ R-503 §3 -- `DO NOT EXPLAIN A COUNT DISCREPANCY FROM AGGREGATE
    COUNTS. NAME THE ROW.` A one-row discrepancy explained by arithmetic is a
    story; explained by naming the row it is a measurement."""
    os.environ[FLAG] = "true"
    recognized, with_zone, without_zone = [], [], []
    for key in family_keys:
        rec = on_arm[key]
        cls = sfb.classify_session_role(rec.get("object") or "")
        if not cls.recognized:
            continue
        row = {"key": key, "object": rec.get("object"),
               "classifier_zone": cls.zone,
               "OFF_reason": off_arm[key].get("reason"),
               "ON_reason": rec.get("reason"),
               "reason_changed": off_arm[key].get("reason") != rec.get("reason"),
               "OFF_route": route_of(off_arm[key], unrecognized_reason),
               "ON_route": route_of(rec, unrecognized_reason)}
        recognized.append(row)
        (with_zone if cls.zone is not None else without_zone).append(row)

    unchanged = [r for r in recognized if not r["reason_changed"]]
    changed = [r for r in recognized if r["reason_changed"]]
    return {
        "THE_QUESTION": (
            "AR-524 reported 18 recognized / 17 reason transitions / 9 computed zones / "
            "0 bindings. R-503 §3 requires the partition proven by IDENTITY, not arithmetic."
        ),
        "n_classifier_recognized": len(recognized),
        "n_reason_changed": len(changed),
        "n_reason_UNCHANGED": len(unchanged),
        "THE_ROWS_THAT_DID_NOT_CHANGE": unchanged,
        "n_classifier_computed_a_zone": len(with_zone),
        "n_recognized_without_zone": len(without_zone),
        "changed_rows_WITH_computed_zone": [r["key"] for r in changed if r["classifier_zone"]],
        "changed_rows_WITHOUT_computed_zone": [r["key"] for r in changed if not r["classifier_zone"]],
        "MECHANISM": (
            "The orphan-zone refusal (refused_session_zone) fires ABOVE the resolver gate in "
            "spec_family_bindings.py, so a row it catches is INVARIANT to the flag no matter "
            "what the classifier would have said about it. That is why a recognized row with "
            "a computed zone can still show NO reason transition: it never reaches the gate."
        ),
        "UNEXPECTED_UNRECOGNISED_MOVEMENT": (
            "Rows that changed reason while the classifier does NOT recognize them -- "
            "R-503 §3's last required answer."
        ),
    }


def main():
    dirty_pre = dirty_paths()  # ★ R-503 §5.G -- PRE-run status, captured before anything runs
    unrecognized_reason = derive_unrecognized_reason()

    a_owners, a_entry, a_inval = load_corpus_a()
    b_owners, b_entry, b_inval = load_corpus_b()

    base, base_conds, base_keys = baseline_c2_population()

    A = measure("corpus_A (claude-rung-v32/shakedown_specs/*.spec.json)",
                a_owners, a_entry, a_inval, unrecognized_reason, base_keys,
                "PINNED BASELINE dual-denominator-remeasure-2026-07-21.json -> "
                "corpus_A.THE_UNBOUND_COUNT_TRAVELS_BESIDE_THE_RATE.conditions. "
                "Measured under the BEFORE (flags-off) arm. NOT derived from this run's "
                "treatment classifier.")

    # ★ Corpus B: the pinned baseline carries NO per-condition unbound list for
    # corpus B, so a baseline-defined C2 denominator DOES NOT EXIST for it. The
    # honest result is to say so, not to substitute the treatment arm's own
    # recognition. The OFF CONTROL arm is used instead and LABELLED as weaker
    # provenance -- and §H asserts that on corpus A, where BOTH are available,
    # the OFF-arm-derived population EQUALS the baseline-derived one, which is
    # the two-path evidence that the surrogate is sound.
    b_off_probe = bind_all(b_entry, "false")
    b_c2_keys = sorted(k for k, v in b_off_probe.items()
                       if v.get("type") == FAMILY_TYPE and not v.get("bindable"))
    B = measure("corpus_B (or-branches-full-corpus-specs-2026-07-05.json)",
                b_owners, b_entry, b_inval, unrecognized_reason, b_c2_keys,
                "⚠️ NOT BASELINE-DEFINED. The pinned baseline's corpus_B block carries "
                "n_specs/n_taught_conditions but NO per-condition unbound list, so a "
                "baseline-sourced C2 population DOES NOT EXIST for corpus B. Derived "
                "instead from THIS RUN's OFF CONTROL ARM (never the ON treatment arm). "
                "WEAKER PROVENANCE THAN CORPUS A'S, AND SAID SO. The corpus-A cross-check "
                "in ASSERTIONS shows the two methods agree where both are available.")

    a_off, a_on = A.pop("_off"), A.pop("_on")
    b_off, b_on = B.pop("_off"), B.pop("_on")
    a_family = A.pop("_family_keys")
    b_family = B.pop("_family_keys")

    recon = reconcile_18_17_9(a_on, a_off, unrecognized_reason, a_family)
    # the last required §3 answer, measured rather than asserted
    os.environ[FLAG] = "true"
    unexpected = [r["key"] for r in A["IDENTITY_REFUSAL_MAP"]["changed_rows"]
                  if not sfb.classify_session_role(r["object"] or "").recognized]
    recon["UNRECOGNISED_ROWS_THAT_CHANGED_REASON"] = unexpected
    recon["n_UNRECOGNISED_ROWS_THAT_CHANGED_REASON"] = len(unexpected)

    # ── POSITIVE CONTROLS ────────────────────────────────────────────────────
    os.environ[FLAG] = "false"
    gate_off = sfb.session_role_resolver_enabled()
    os.environ[FLAG] = "true"
    gate_on = sfb.session_role_resolver_enabled()
    for k, v in HELD_FLAGS.items():
        os.environ[k] = v
    held = {"TF_LEVELZONE_ROUTING_ENABLED": sfb.levelzone_routing_enabled(),
            "TF_LEVELZONE_RESOLVER_ENABLED": sfb.levelzone_resolver_enabled()}
    phrases = {}
    for t in ["london session", "the london killzone", "new york session",
              "9:30 to 10:00", "asian session"]:
        r = sfb.classify_session_role(t)
        phrases[t] = {"recognized": bool(r.recognized), "zone": r.zone}

    controls = {
        "GATE_READS_THIS_PROCESS_ENV": {
            "flag_false": gate_off, "flag_true": gate_on,
            "DISCRIMINATES": gate_off is False and gate_on is True},
        "HELD_FLAGS_MATCH_THE_PINNED_BASELINE_BEFORE_ARM": {
            "declared_by_baseline": base["DECLARED_MEASUREMENT_CONFIGURATION"]
                                        ["level_zone_flags_BEFORE_arm_and_NULL"],
            "read_from_this_process": held,
            "WHY": (
                "An OFF arm that differs from the baseline on ANY flag is not the baseline's "
                "arm, and comparing to it would be a join-key error. Held false in BOTH arms "
                "so the ONLY variable in this experiment is %s." % FLAG)},
        "unrecognized_reason_DERIVED_NOT_TYPED": unrecognized_reason,
        "capability_on_synthetic_phrases": phrases,
        "why_this_is_here": (
            "A bare zero is unreadable: 'the resolver is inert', 'the population is empty' "
            "and 'my flag never arrived' all print as 0."),
    }

    # ── §G PROVENANCE (built AFTER everything ran, so the closure is the one
    #     that actually executed) ────────────────────────────────────────────
    head = git("rev-parse", "HEAD")
    dirty = dirty_paths()
    prov = source_closure_manifest(head, dirty, dirty_pre)

    # ── §H EXECUTABLE ASSERTIONS ─────────────────────────────────────────────
    ba = base["corpus_A"]["BEFORE_flags_off"]
    off_bac = sorted(k for k, v in a_off.items() if v.get("bound_and_concrete"))
    off_bindable = sorted(k for k, v in a_off.items() if v.get("bindable"))
    off_unbound_family = sorted(k for k, v in a_off.items() if not v.get("bindable"))

    check("A_OFF_reproduces_pinned_baseline__bound_and_concrete",
          len(off_bac) == ba["n_bound_and_concrete"],
          {"measured": len(off_bac), "baseline": ba["n_bound_and_concrete"],
           "field": "bound_and_concrete = bindable AND NOT approximation"})
    check("A_OFF_reproduces_pinned_baseline__n_bindable",
          len(off_bindable) == ba["n_bindable"],
          {"measured": len(off_bindable), "baseline": ba["n_bindable"]})
    check("A_OFF_reproduces_pinned_baseline__n_unbound",
          len(off_unbound_family) == ba["n_unbound"],
          {"measured": len(off_unbound_family), "baseline": ba["n_unbound"]})
    check("A_OFF_unbound_IDENTITIES_equal_baseline_identities__NOT_JUST_THE_COUNT",
          set(off_unbound_family) == set(base_keys),
          {"measured_not_in_baseline": sorted(set(off_unbound_family) - set(base_keys)),
           "baseline_not_in_measured": sorted(set(base_keys) - set(off_unbound_family)),
           "WHY": "R-425 -- a count is satisfied by losing one row and gaining another."})
    check("A_baseline_join_key_resolved_every_declared_row",
          A["DENOMINATORS"]["C2_eligible"]["keys_not_found_in_this_population"] == [],
          A["DENOMINATORS"]["C2_eligible"]["keys_not_found_in_this_population"])
    check("A_population_size_matches_pinned_baseline",
          len(a_entry) == base["corpus_A"]["n_taught_conditions"],
          {"measured": len(a_entry), "baseline": base["corpus_A"]["n_taught_conditions"]})
    check("B_population_size_matches_pinned_baseline",
          len(b_entry) == base["corpus_B"]["n_taught_conditions"],
          {"measured": len(b_entry), "baseline": base["corpus_B"]["n_taught_conditions"]})
    check("B_spec_count_matches_pinned_baseline",
          len(b_owners) == base["corpus_B"]["n_specs"],
          {"measured": len(b_owners), "baseline": base["corpus_B"]["n_specs"]})

    # two-path evidence that the OFF-arm surrogate used for corpus B is sound
    a_off_derived_c2 = sorted(k for k, v in a_off.items()
                              if v.get("type") == FAMILY_TYPE and not v.get("bindable"))
    check("C2_population_TWO_PATH__off_arm_derivation_equals_baseline_derivation_on_corpus_A",
          set(a_off_derived_c2) == set(base_keys),
          {"only_in_off_arm": sorted(set(a_off_derived_c2) - set(base_keys)),
           "only_in_baseline": sorted(set(base_keys) - set(a_off_derived_c2)),
           "WHY": "corpus B has no baseline list; this is the evidence its surrogate is sound."})

    # ★★★ R-507 §6.8 -- EQUAL COUNTS ARE NOT IDENTITY. Both are 27 on corpus A;
    #   that is exactly the coincidence R-425 warns about. Assert the SETS.
    a_family_set = set(k for k, v in a_off.items() if v.get("type") == FAMILY_TYPE)
    check("A_C2_eligible_set_IDENTICAL_to_WAIT_SESSION_family_set__NOT_JUST_EQUAL_COUNTS",
          set(base_keys) == a_family_set,
          {"in_C2_not_in_family": sorted(set(base_keys) - a_family_set),
           "in_family_not_in_C2": sorted(a_family_set - set(base_keys)),
           "WHY": "THE JOIN KEY IS THE CLAIM. Both populations are 27 on corpus A and equal "
                  "counts prove nothing about membership."})
    check("gate_control_DISCRIMINATES", controls["GATE_READS_THIS_PROCESS_ENV"]["DISCRIMINATES"],
          controls["GATE_READS_THIS_PROCESS_ENV"])
    check("held_levelzone_flags_equal_baseline_BEFORE_arm",
          held["TF_LEVELZONE_ROUTING_ENABLED"] is False
          and held["TF_LEVELZONE_RESOLVER_ENABLED"] is False, held)
    check("A_repeated_runs_deterministic", A.pop("_deterministic"), "each arm run twice")
    check("B_repeated_runs_deterministic", B.pop("_deterministic"), "each arm run twice")

    check("corpora_reported_SEPARATELY_nothing_pooled",
          A["POPULATION"]["entry_conditions"] != B["POPULATION"]["entry_conditions"]
          and "corpus_A" in A["POPULATION"]["name"] and "corpus_B" in B["POPULATION"]["name"],
          {"A": A["POPULATION"]["entry_conditions"], "B": B["POPULATION"]["entry_conditions"],
           "note": "No field in this artifact sums or averages across the two blocks."})
    check("A_invalidations_count_equals_loaded_population",
          A["INVALIDATIONS_SEPARATE"]["population"] == len(a_inval),
          {"artifact": A["INVALIDATIONS_SEPARATE"]["population"], "loaded": len(a_inval),
           "NOTE": "R-502 §4 -- AR-522 prose said 16; the artifact said 6. The ARTIFACT "
                   "was right. This assertion makes the prose unable to drift again."})
    check("B_invalidations_count_equals_loaded_population",
          B["INVALIDATIONS_SEPARATE"]["population"] == len(b_inval),
          {"artifact": B["INVALIDATIONS_SEPARATE"]["population"], "loaded": len(b_inval)})

    a_rm = A.pop("_reason_moves"); a_bm = A.pop("_binding_moves")
    b_rm = B.pop("_reason_moves"); b_bm = B.pop("_binding_moves")
    check("A_reason_change_COUNT_equals_identity_list_LENGTH",
          A["METRICS"]["diagnostic_reason_movement"]["diagnostic_reason_yield_numerator"]
          == len(a_rm) == len(A["METRICS"]["diagnostic_reason_movement"]["identities"]),
          {"numerator": A["METRICS"]["diagnostic_reason_movement"]
           ["diagnostic_reason_yield_numerator"], "list_len": len(a_rm)})
    check("B_reason_change_COUNT_equals_identity_list_LENGTH",
          B["METRICS"]["diagnostic_reason_movement"]["diagnostic_reason_yield_numerator"]
          == len(b_rm) == len(B["METRICS"]["diagnostic_reason_movement"]["identities"]),
          {"numerator": B["METRICS"]["diagnostic_reason_movement"]
           ["diagnostic_reason_yield_numerator"], "list_len": len(b_rm)})
    check("A_binding_change_COUNT_equals_identity_list_LENGTH",
          A["METRICS"]["binding_movement"]["binding_yield_numerator"] == len(a_bm),
          {"numerator": A["METRICS"]["binding_movement"]["binding_yield_numerator"],
           "list_len": len(a_bm)})
    check("B_binding_change_COUNT_equals_identity_list_LENGTH",
          B["METRICS"]["binding_movement"]["binding_yield_numerator"] == len(b_bm),
          {"numerator": B["METRICS"]["binding_movement"]["binding_yield_numerator"],
           "list_len": len(b_bm)})

    check("A_no_unexpected_movement_outside_the_%s_family" % FAMILY_TYPE,
          A["NON_C2_MOVEMENT_CENSUS"]["n_moved_outside_family"] == 0,
          A["NON_C2_MOVEMENT_CENSUS"]["moved_outside_%s_family" % FAMILY_TYPE])
    check("B_no_unexpected_movement_outside_the_%s_family" % FAMILY_TYPE,
          B["NON_C2_MOVEMENT_CENSUS"]["n_moved_outside_family"] == 0,
          B["NON_C2_MOVEMENT_CENSUS"]["moved_outside_%s_family" % FAMILY_TYPE])
    # ★ POSITIVE WITNESS for the two negative assertions above -- an empty
    #   census is satisfied by an experiment that never ran.
    check("POSITIVE_WITNESS_the_arms_actually_moved_rows_INSIDE_the_family",
          len(a_rm) > 0,
          {"corpus_A_reason_moves": len(a_rm),
           "WHY": "A negative assertion needs a positive witness that the path RAN. "
                  "'nothing moved outside the family' is satisfied by a run that moved "
                  "nothing at all."})

    # §G assertions -- the generator is excluded BY NAME, never silently
    gen_rel = "docs/replay-results/h1-battery/session_role_resolver_yield.py"
    measurement_closure_divergent = [m for m in prov["DIVERGENT_FROM_HEAD_BLOB"]
                                     if m["path"] != gen_rel]
    measurement_closure_dirty = [p for p in prov["DIRTY_INTERSECTION_WITH_CLOSURE"]
                                 if p != gen_rel]
    prov["MEASUREMENT_CLOSURE_DIVERGENT_EXCLUDING_GENERATOR"] = measurement_closure_divergent
    prov["MEASUREMENT_CLOSURE_DIRTY_EXCLUDING_GENERATOR"] = measurement_closure_dirty
    check("PROVENANCE_source_closure_dirty_intersection_is_ZERO",
          len(measurement_closure_dirty) == 0,
          {"intersection": measurement_closure_dirty,
           "tree_dirty_paths_total": len(dirty),
           "closure_size": prov["closure_size"],
           "WHY": "R-503 §5.G -- a relevant intersection is a STOP. The tree carries "
                  "unrelated dirty paths; what matters is whether ANY of them is in the "
                  "executed source+population closure."})
    check("PROVENANCE_every_closure_file_equals_its_HEAD_blob",
          len(measurement_closure_divergent) == 0,
          measurement_closure_divergent)
    check("PROVENANCE_binder_worktree_bytes_equal_HEAD_blob", prov["binder_blob"]["IDENTICAL"],
          prov["binder_blob"])
    # ★ R-509 §6.1 -- generator and harness are INPUTS to this run, so their
    #   committed-vs-worktree pair CAN be asserted here without self-reference.
    _gen_pair = blob_pair("docs/replay-results/h1-battery/session_role_resolver_yield.py")
    _harness_pair = blob_pair(
        "docs/replay-results/h1-battery/session_role_resolver_yield_REDPROOF.py")
    check("PUBLICATION_generator_worktree_blob_equals_HEAD_blob",
          _gen_pair["IDENTICAL"], _gen_pair)
    check("PUBLICATION_harness_worktree_blob_equals_HEAD_blob",
          _harness_pair["IDENTICAL"], _harness_pair)
    # ★★★★★ THE RAW CHECK -- NO BY-NAME EXCLUSION. Without this, an edited-but-
    #   uncommitted generator (or an uncommitted TEST HARNESS that pulls itself
    #   into the executed closure) would ride through on the excluded list. A
    #   by-name exclusion that nothing re-checks IS the allow-list defect this
    #   campaign already convicted once for excusing 24 kill-switch assertions.
    check("PROVENANCE_RAW_closure_INCLUDING_generator_and_any_harness_is_clean",
          len(prov["DIVERGENT_FROM_HEAD_BLOB"]) == 0
          and len(prov["DIRTY_INTERSECTION_WITH_CLOSURE"]) == 0,
          {"divergent": [m["path"] for m in prov["DIVERGENT_FROM_HEAD_BLOB"]],
           "dirty_in_closure": prov["DIRTY_INTERSECTION_WITH_CLOSURE"],
           "WHY": "The SHIPPED artifact must be produced from a fully committed closure. "
                  "Running an uncommitted instrument is allowed -- it just cannot be "
                  "reported as a provenance-clean result."})
    check("PROVENANCE_pre_and_post_run_status_agree", prov["PRE_AND_POST_AGREE"],
          {"pre": prov["PRE_RUN_STATUS"], "post": prov["POST_RUN_STATUS"]})

    # ★★★★★ R-506 §5 TRIPWIRE. RED means the capability was PORTED and every
    #   scope sentence in this artifact is stale. It is SUPPOSED to fail then.
    scope = deployed_lane_scope()
    check("SCOPE_TRIPWIRE_capability_still_ABSENT_from_the_deployed_lane",
          scope.get("capability_absent_from_deployed") is True,
          {"status": scope.get("STATUS"),
           "capability_symbols_present_in_deployed":
               scope.get("capability_symbols_PRESENT_in_deployed"),
           "MEANING_OF_RED": "The capability now EXISTS in the deployed engine. This artifact's "
                             "campaign-lane scope sentence is STALE and must be re-stated "
                             "before any figure here is quoted."})
    # ★★★★★ R-507 §6.1 -- TWO predicates, because the retired single one was
    #   named STRICT_SUBSET and tested subset-OR-EQUAL. The artifact's numbers
    #   were right and the guard was still wrong: `A GUARD THAT HAPPENS TO BE
    #   TRUE TODAY IS NOT A GUARD; IT IS A COINCIDENCE WITH AN ASSERTION AROUND IT.`
    check("SCOPE_deployed_symbols_are_a_SUBSET_OR_EQUAL_of_campaign",
          scope.get("DEPLOYED_IS_SUBSET_OR_EQUAL") is True,
          {"in_deployed_absent_from_campaign": scope.get("in_deployed_ABSENT_from_campaign"),
           "MEANS": "no deployed-only top-level symbol; a non-zero value means a port would "
                    "have to RECONCILE, not merely ADD."})
    check("SCOPE_deployed_symbols_are_a_STRICT_SUBSET_of_campaign",
          scope.get("DEPLOYED_IS_STRICT_SUBSET") is True,
          {"requires_both": scope.get("STRICT_SUBSET_REQUIRES_BOTH"),
           "WHY_SEPARATE": "dep < camp requires BOTH zero deployed-only AND at least one "
                           "campaign-only. Equality satisfies subset-or-equal and must NOT "
                           "satisfy this one -- mutation M7 proves it does not."})
    check("SCOPE_snapshot_record_deployed_HEAD_actually_RESOLVED",
          scope.get("SNAPSHOT_RECORD", {}).get("deployed_repo_head_RESOLVED") is True,
          {"head": scope.get("SNAPSHOT_RECORD", {}).get("deployed_repo_head"),
           "root": scope.get("SNAPSHOT_RECORD", {}).get("deployed_repo_root"),
           "WHY": "The first version silently recorded '<unavailable: exit 128>' as the "
                  "deployed HEAD. A provenance field holding an ERROR STRING is worse than "
                  "an absent one -- it LOOKS populated. Asserted so it cannot recur."})
    check("SCOPE_shared_symbol_bodies_compared_not_just_names",
          scope.get("SHARED_SYMBOL_BODY_COMPARISON", {}).get("shared_symbol_count", 0) > 0,
          {"comparison": scope.get("SHARED_SYMBOL_BODY_COMPARISON"),
           "WHY": "R-507 §6.7 -- 'purely additive / nothing to reconcile' phrasing may not be "
                  "used until shared BODIES are compared, not just shared NAMES. This is the "
                  "positive witness that the comparison actually ran; the DIFFERING list is "
                  "the result and is reported whatever its size."})

    # ── ★★★★★ R-511 §6.6 -- RESOLVE THE PREFIX-KEYED EXCLUSION AND ASSERT IT ─
    #    Computed from the ASSERTIONS actually produced by this run, never typed.
    #    ⚠️ The assertion added just below is named `DIGEST_...` deliberately: a
    #    `PROVENANCE_`/`PUBLICATION_` name would join the very set it counts and
    #    make the tripwire fire on itself.
    PREFIX_EXCLUDED_NAMES = sorted(
        a["assertion"] for a in ASSERTIONS
        if a["assertion"].startswith("PROVENANCE_") or a["assertion"].startswith("PUBLICATION_"))
    EXPECTED_PREFIX_EXCLUDED = 7   # R-511 §6.6, re-measured at the desk 07:55
    check("DIGEST_prefix_exclusion_resolves_to_the_EXPECTED_set",
          len(PREFIX_EXCLUDED_NAMES) == EXPECTED_PREFIX_EXCLUDED,
          {"resolved_count": len(PREFIX_EXCLUDED_NAMES),
           "expected": EXPECTED_PREFIX_EXCLUDED,
           "resolved_names": PREFIX_EXCLUDED_NAMES,
           "WHY": "R-511 §6.6 -- the digest excludes these assertions' `detail` payloads by a "
                  "PREFIX RULE, and a rule grows silently the instant someone names an eighth "
                  "check. This turns that growth into a RED. If it fires, do not widen the "
                  "number: decide whether the new check's detail BELONGS outside the digest.",
           "WHAT_IS_STILL_COVERED": "the NAME and PASS value of every one of them."})

    all_pass = all(a["PASS"] for a in ASSERTIONS)

    art = {
        "READ_THIS_ONE__HEADLINE": (
            "C2 session-role resolver, %s OFF->ON. TWO FIELDS MOVE AND BOTH ARE REPORTED. "
            "corpus_A: binding movement (bound_and_concrete) %d of %d global / %d of %d %s / "
            "%d of %d C2-eligible; diagnostic refusal-reason movement %d of %d global / "
            "%d of %d %s / %d of %d C2-eligible. corpus_B REPORTED SEPARATELY, NEVER POOLED: "
            "binding movement %d of %d global; diagnostic refusal-reason movement %d of %d "
            "global. NEITHER NUMBER IS A HEADLINE ON ITS OWN."
            % (FLAG,
               A["METRICS"]["binding_movement"]["binding_yield_numerator"], len(a_entry),
               A["METRICS"]["binding_movement"]["binding_yield_numerator"], len(a_family),
               FAMILY_TYPE,
               A["METRICS"]["binding_movement"]["binding_yield_numerator"],
               len(A["DENOMINATORS"]["C2_eligible"]["n"] and base_keys or base_keys),
               A["METRICS"]["diagnostic_reason_movement"]["diagnostic_reason_yield_numerator"],
               len(a_entry),
               A["METRICS"]["diagnostic_reason_movement"]["diagnostic_reason_yield_numerator"],
               len(a_family), FAMILY_TYPE,
               A["METRICS"]["diagnostic_reason_movement"]
               ["numerator_restricted_to_C2_eligible"], len(base_keys),
               B["METRICS"]["binding_movement"]["binding_yield_numerator"], len(b_entry),
               B["METRICS"]["diagnostic_reason_movement"]["diagnostic_reason_yield_numerator"],
               len(b_entry))),
        "TWO_METRICS_NOT_ONE": (
            "R-503 §1. A zero on BINDING is not a null result -- it measures the safety "
            "property the redesign intentionally PRESERVED. The reason movement measures the "
            "diagnostic property it intentionally ADDED. Two true numbers; either one alone "
            "is a lie of omission. This artifact installs NEITHER as a naked headline."
        ),
        # ★ The AUTHORITATIVE name, not OUT_PATH.name -- under the red-proof
        #   harness OUT_PATH is a temp file, and recording its name made the
        #   content digest differ for a reason that has nothing to do with
        #   freshness. `A TEST RIG'S PATH MUST NOT LEAK INTO THE MEASURED
        #   CONTENT.`
        "artifact": ARTIFACT_REL.rsplit("/", 1)[-1],
        "generator": "docs/replay-results/h1-battery/session_role_resolver_yield.py",
        "reproduce": "python docs/replay-results/h1-battery/session_role_resolver_yield.py",
        "ruling": "R-503 §5 items A-H + §3 reconciliation (supersedes R-502 §4, R-501 §6)",
        "TREE": {"path": str(REPO_ROOT), "head": head,
                 "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
                 "dirty_paths": len(dirty)},
        "FLAG_STATE": {
            "flag": FLAG, "control_arm": "false", "treatment_arm": "true",
            "held_constant": HELD_FLAGS,
            "PRODUCTION_DEFAULT": "OFF -- the flag defaults to 'false' when unset.",
            "honest_reading": (
                "The treatment arm is a flag-ON HYPOTHETICAL. Production output today, with "
                "default env, is the CONTROL arm."),
        },
        "ASSERTIONS": {"ALL_PASS": all_pass,
                       "n_pass": sum(1 for a in ASSERTIONS if a["PASS"]),
                       "n_fail": sum(1 for a in ASSERTIONS if not a["PASS"]),
                       "checks": ASSERTIONS,
                       "EXIT_CODE_CONTRACT":
                           "This generator exits NON-ZERO if any assertion fails. A green "
                           "artifact that cannot go red is not an instrument."},
        # ── R-509 §6.1 -- the OUTPUT paths finally carry the pair every INPUT
        #    already carried. `A DISCIPLINE APPLIED TO EVERY INPUT AND NOT TO
        #    THE OUTPUT READS AS A DISCIPLINE APPLIED EVERYWHERE.`
        "PUBLICATION_PATHS": {
            # ★ ARTIFACT_REL, not OUT_PATH: the red-proof harness redirects
            #   OUT_PATH to a throwaway temp file, and the PUBLICATION path is
            #   the authoritative artifact regardless of where a test run
            #   writes. Deriving it from OUT_PATH crashed under the harness.
            "artifact": blob_pair(ARTIFACT_REL),
            "generator": blob_pair(
                "docs/replay-results/h1-battery/session_role_resolver_yield.py"),
            "harness": blob_pair(
                "docs/replay-results/h1-battery/session_role_resolver_yield_REDPROOF.py"),
            "⚠️_THE_ARTIFACT_PAIR_DESCRIBES_THE_PRE_RUN_STATE": (
                "It is computed BEFORE this run overwrites the artifact, so it reports on the "
                "PREVIOUS published object and this run is about to make the path dirty. "
                "IT IS THEREFORE RECORDED AS DATA AND **NOT** ASSERTED HERE -- asserting it "
                "would claim 'the artifact is committed' in the same breath as replacing it, "
                "which is the caption-falsifies-its-own-line defect this lane keeps producing. "
                "THE REAL PUBLICATION ASSERTION LIVES IN THE HARNESS (R-509 §6.2), which runs "
                "AFTER the commit and reads the COMMITTED blob. The generator and harness "
                "pairs ARE asserted below -- they are inputs to this run, not its output."
            ),
        },
        # ── R-510 §6.5 -- the three publication identities, BY NAME ──────────
        "PUBLICATION_IDENTITIES": {
            "measurement_source_commit": {
                "value": head,
                "definition": "HEAD of the campaign tree at the moment this measurement RAN. "
                              "The sources that produced these numbers are this commit's."},
            "artifact_publication_commit": {
                "value": None,
                "definition": "The commit in which THIS artifact is published. It cannot be "
                              "known while the artifact is being written -- the commit does "
                              "not exist yet.",
                "STATUS": "[NOT SELF-CERTIFIABLE FROM INSIDE THE ARTIFACT] -- R-510 §6.5. "
                          "The harness reports it post-commit via `git log -1 -- <artifact>`; "
                          "an external read or CI certifies it."},
            "receipt_measurement_commit": {
                "value": None,
                "definition": "HEAD when the RED-PROOF receipt was produced. Recorded in the "
                              "receipt, not here -- this object cannot observe a later run."},
            "WHY_THREE": (
                "They are three DIFFERENT commits and conflating any two is how a stale "
                "publication hides: the sources can be current while the published object "
                "is old, and the receipt can be newer than both."),
        },
        "DIGEST_COVERAGE": {
            "digest_name": "artifact_content_digest",
            "method": "R-509 §6.4 OPTION (a) -- canonicalised FULL artifact minus an "
                      "ENUMERATED volatile list. Everything not listed is covered.",
            "VOLATILE_EXCLUSIONS": VOLATILE_EXCLUSIONS,
            # ★★★★★ R-511 §6.6 -- THE ONE PREFIX-KEYED EXCLUSION, RESOLVED.
            #   `ASSERTIONS.checks[name starts with 'PROVENANCE_' or
            #   'PUBLICATION_'].detail` is a RULE, not an enumeration, and a rule
            #   grows silently the instant someone names an eighth check. The
            #   resolved membership is recorded here BY NAME and its count is
            #   ASSERTED below, so an eighth member is VISIBLE instead of silent.
            "PREFIX_EXCLUSION_RESOLVED": {
                "rule": "ASSERTIONS.checks[name starts with 'PROVENANCE_' or "
                        "'PUBLICATION_'].detail",
                "resolved_names": PREFIX_EXCLUDED_NAMES,
                "resolved_count": len(PREFIX_EXCLUDED_NAMES),
                "total_assertions": len(ASSERTIONS),
                "WHAT_IS_STILL_COVERED": "each of these assertions' NAME and PASS value. "
                                         "Only the `detail` payload is outside the digest.",
                "WHY_IT_IS_ASSERTED": "R-511 §6.6 -- `A PREFIX RULE GROWS SILENTLY THE "
                                      "INSTANT SOMEONE NAMES AN EIGHTH CHECK.` The count "
                                      "assertion turns that growth into a RED.",
            },
            "value": None,  # filled after the dict is complete -- it hashes itself out
        },
        "DEPLOYED_LANE_SCOPE__READ_BEFORE_QUOTING_ANY_NUMBER_HERE": scope,
        "RECONCILIATION_18_17_9": recon,
        "corpus_A": A,
        "corpus_B": B,
        "POSITIVE_CONTROLS": controls,
        "PROVENANCE_SOURCE_CLOSURE": prov,
        "WHAT_THIS_DOES_NOT_MEASURE": [
            "Whether a refusal is the CORRECT disposition for a condition -- that is GROUND "
            "TRUTH and belongs to an independent grader. This script is the doer.",
            "Any population other than corpus_A and corpus_B, each reported separately.",
            "The DEPLOYED tree -- and the reason is now MEASURED, not estimated: see "
            "DEPLOYED_LANE_SCOPE__READ_BEFORE_QUOTING_ANY_NUMBER_HERE. The capability does "
            "not exist as code there, so the flag has nothing to gate. R-506 §5.",
            "Whether the C2 refusal CLASS shrinks downstream -- this measures binding and "
            "reason movement, necessary but not sufficient for that.",
            "A baseline-sourced C2 denominator for corpus B -- the pinned baseline carries "
            "no per-condition unbound list for it. Stated, not substituted.",
        ],
    }

    art["DIGEST_COVERAGE"]["value"] = artifact_content_digest(art)

    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(art, fh, indent=2)
        fh.write("\n")

    print(art["READ_THIS_ONE__HEADLINE"])
    print()
    for a in ASSERTIONS:
        print("  [%s] %s" % ("PASS" if a["PASS"] else "FAIL", a["assertion"]))
    print("\nassertions: %d pass / %d fail" % (
        sum(1 for a in ASSERTIONS if a["PASS"]), sum(1 for a in ASSERTIONS if not a["PASS"])))
    print("artifact -> %s" % OUT_PATH)
    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
