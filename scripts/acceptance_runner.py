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
import hashlib
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path

# defusedxml over stdlib ElementTree: the junitxml is locally generated and so
# not an untrusted input today, but this file is a COMMITTED instrument that
# future seats will point at other people's artifacts.
try:
    from defusedxml import ElementTree as ET
except ImportError as _err:  # pragma: no cover - explicit, never a silent downgrade
    raise SystemExit(
        "acceptance_runner requires defusedxml (pip install defusedxml). "
        "Refusing to parse XML with the vulnerable stdlib parser."
    ) from _err

REPO = Path(__file__).resolve().parents[1]
MANIFEST = REPO / "src" / "engine" / "tests" / "canonical_regression_population.txt"
BASELINE = REPO / "docs" / "replay-results" / "h1-battery" / "acceptance-baseline-2026-08-09.json"
SEAL = REPO / "docs" / "replay-results" / "h1-battery" / "acceptance-collection-seal-08062e12.json"

# The single refusal string for an execution that produced no evidence about the tree.
# R-799 SS2 carries this wording verbatim and R-801 SS5 ruled it governs over the prose
# paraphrases elsewhere in the ledger: `A PARAPHRASE OF A SPEC IS NOT A SECOND SPEC.`
PYTEST_RUN_INVALID = "ACCEPTANCE INSTRUMENT REFUSED - PYTEST RUN INVALID"


def _sha256_file(path):
    """SHA-256 of a file's raw bytes, or None if it is not readable."""
    try:
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    except OSError:
        return None


def _git_head():
    """The executing tree's HEAD, or None if git cannot answer.

    None is returned rather than raising: a tree without git history is a degraded
    environment, not an invalid pytest run, and conflating the two would convert a
    missing tool into a false refusal. Callers must therefore treat None as
    "unknown" and skip the HEAD-did-not-move join rather than fail it.
    """
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO, capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout.strip() or None

# ---------------------------------------------------------------------------
# THE SEAL'S APPROVED IDENTITY, HELD IN THE RUNNER'S OWN CONTRACT (R-792 §5.2).
# The seal file carries its own digest, so validating it only against itself
# lets a re-checksummed seal AUTHORIZE ITSELF. These two constants are the
# out-of-band anchor that makes that impossible.
#   `A SEALED BASELINE THAT IS NOT VALIDATED BEFORE USE IS STILL MUTABLE AUTHORITY.`
# ---------------------------------------------------------------------------
SEAL_APPROVED_GRADED_SHA = "08062e12b3e2b59d44eada150c8d8b8653796c90"
SEAL_APPROVED_POP_SHA256 = "63d4b541caf7f0ade8628ac9e2f737ff6f7fdaeec3e12ea653b433e376b2c9b9"

# ---------------------------------------------------------------------------
# F-2 (R-794 §6) — THE FAILURE BASELINE'S APPROVED IDENTITY, ALSO OUT-OF-BAND.
# The baseline DEFINES `NEW` and `GONE`; it is the most authoritative input this
# gate has, and until now it was the only one with no external anchor while the
# seal received one in the same commit. Git protects it operationally, but that
# is defence in depth, not the instrument checking its own authority file.
#   `AN INSTRUMENT THAT VALIDATES EVERY INPUT EXCEPT ITS MOST AUTHORITATIVE ONE
#    HAS AUDITED ITS WITNESSES AND TAKEN THE JUDGE'S WORD FOR IT.`
# ---------------------------------------------------------------------------
BASELINE_APPROVED_RAW_SHA256 = (
    "a9f70e2ed7ecc534f970ddd6c070aa0436c8605a134560b4b877d38c7d10d8fc"
)
BASELINE_APPROVED_MEASURED_AT_SHA = "f8273f418558ad9552486dfee2dc37d9401dd360"
BASELINE_APPROVED_FAILURE_COUNT = 33
BASELINE_APPROVED_FAILURE_MEMBERSHIP_SHA256 = (
    "576153e8a01b578b1c90d84c0cf7a121698a2e74e07e0d20773b3c83ed27e07d"
)


def validate_baseline_bytes(path: Path):
    """BASELINE PREFLIGHT (F-2) — the six-step chain, run BEFORE the baseline is used.

    Ordered deliberately: raw bytes FIRST, so a file that is not the approved file
    is refused before anything parses it and starts believing its contents. Each
    later step then anchors a DIFFERENT property, so a forger who repairs one
    still trips the next.

    Returns a list of refusal strings; empty means the baseline may be trusted.
    """
    probs = []

    # (1) raw bytes — the whole file, before any interpretation.
    raw = path.read_bytes()
    raw_sha = hashlib.sha256(raw).hexdigest()
    if raw_sha != BASELINE_APPROVED_RAW_SHA256:
        probs.append(
            "BASELINE INTEGRITY FAILURE: raw-byte SHA-256 of the failure baseline is "
            f"{raw_sha}, not the approved {BASELINE_APPROVED_RAW_SHA256}."
        )

    # (2) it must parse at all.
    try:
        d = json.loads(raw)
    except Exception as exc:
        probs.append(f"BASELINE INTEGRITY FAILURE: the baseline does not parse: {exc}")
        return probs

    # (3) measured_at_sha — read AND compared. It was previously read and discarded.
    if d.get("measured_at_sha") != BASELINE_APPROVED_MEASURED_AT_SHA:
        probs.append(
            "BASELINE INTEGRITY FAILURE: measured_at_sha is "
            f"{d.get('measured_at_sha')!r}, not the approved "
            f"{BASELINE_APPROVED_MEASURED_AT_SHA!r}."
        )

    failures = d.get("failures")
    if not isinstance(failures, list) or not failures:
        probs.append("BASELINE INTEGRITY FAILURE: `failures` is missing or empty.")
        return probs

    # (4) failure COUNT.
    if len(failures) != BASELINE_APPROVED_FAILURE_COUNT:
        probs.append(
            f"BASELINE INTEGRITY FAILURE: failure count {len(failures)} != approved "
            f"{BASELINE_APPROVED_FAILURE_COUNT}."
        )

    # (5) sorted failure-MEMBERSHIP digest. A count is satisfied by any swap;
    #     only a membership digest names the population.
    membership = hashlib.sha256("\n".join(sorted(failures)).encode("utf-8")).hexdigest()
    if membership != BASELINE_APPROVED_FAILURE_MEMBERSHIP_SHA256:
        probs.append(
            "BASELINE INTEGRITY FAILURE: the sorted failure-membership digest is "
            f"{membership}, not the approved {BASELINE_APPROVED_FAILURE_MEMBERSHIP_SHA256}. "
            "A baseline swapped member-for-member preserves the count and changes this."
        )

    # (6) the two authorized subtractions must actually BE members of the failure set.
    reds = d.get("ordered_6b_reds") or []
    strays = sorted(set(reds) - set(failures))
    if strays:
        probs.append(
            "BASELINE INTEGRITY FAILURE: ordered_6b_reds contains "
            f"{len(strays)} member(s) that are not baseline failures: {strays}. "
            "An authorized subtraction that was never in the set can only widen it."
        )
    return probs


# ---------------------------------------------------------------------------
# F-3 (R-794 §6) — THE SEALED DISPOSITIONS, WITH THEIR OWN OUT-OF-BAND ANCHOR.
# A test that goes PASS -> SKIP is still collected (collection seal satisfied),
# never failed (not in the failure baseline), and produces no feeder disagreement.
# All three existing checks are blind to it and the gate reports NEW=0.
#   `A TEST THAT IS SKIPPED IS NOT A TEST THAT PASSED — AND A GATE THAT CANNOT TELL
#    THEM APART CAN BE TURNED OFF ONE DECORATOR AT A TIME.`
# ⭐ sealed_population_sha256 below is BYTE-IDENTICAL to SEAL_APPROVED_POP_SHA256:
#    two generators, one using --collect-only and one executing the population,
#    independently reproduced the same 2392-member digest.
# ---------------------------------------------------------------------------
DISPOSITION_SEAL = (
    REPO / "docs" / "replay-results" / "h1-battery"
    / "acceptance-disposition-seal-08062e12.json"
)
DISPOSITION_APPROVED_GRADED_SHA = "08062e12b3e2b59d44eada150c8d8b8653796c90"
DISPOSITION_APPROVED_POP_SHA256 = (
    "63d4b541caf7f0ade8628ac9e2f737ff6f7fdaeec3e12ea653b433e376b2c9b9"
)
DISPOSITION_APPROVED_SKIPPED_SHA256 = (
    "ef6bcbeb9504cfb589aae7ce530b392c1b77a73f1e822a02bf6eaca3371e7ce0"
)
DISPOSITION_APPROVED_XFAILED_SHA256 = (
    "ec9e2d7d0b2cc0739fd4bdf07f6ea857735c2f57f851ef42fab0151f4be0f2bf"
)

# ---------------------------------------------------------------------------
# 🛑 AUTHORIZED DISPOSITION CHANGES — declared, never absorbed.
#
# R-794 §6 specifies exact equality: current_skipped ∩ sealed_population ==
# sealed_skipped. MEASURED: that rule REFUSES THE PRISTINE TREE, because the seal
# is taken at 08062e12 (before S6 activation) while HEAD is after it, and S6
# activation legitimately RE-ENABLED two tests that were skipped at the pin.
#
# The rule is not weakened to make the control pass — that would be exactly the
# forbidden move. Instead the two known changes are NAMED here, out-of-band, in the
# same shape the failure baseline already uses for `ordered_6b_reds`: an authorized
# subtraction is declared, and everything else still refuses.
#
#   `AN AUTHORIZED CHANGE IS ONE SOMEBODY NAMED IN ADVANCE. AN UNNAMED ONE IS A
#    REGRESSION WEARING THE SAME CLOTHES.`
#
# 🛑 Each member must actually BE in the seal's skipped set (enforced below), so
# this list cannot be padded with names that silently excuse future drift.
# ---------------------------------------------------------------------------
DISPOSITION_AUTHORIZED_UNSKIPPED = (
    "src/engine/tests/test_spec_family_bindings.py::"
    "test_s6_coverage_6a_re_derives_on_the_governed_population",
    "src/engine/tests/test_spec_family_bindings.py::"
    "test_s6_dead_17_denominator_stays_retired",
)
DISPOSITION_AUTHORIZED_UNXFAILED = ()


def validate_disposition_seal(seal):
    """DISPOSITION SEAL PREFLIGHT — anchored OUTSIDE the file, exactly like the seal.

    Returns a list of refusal strings; empty means it may be trusted.
    """
    probs = []
    if seal.get("graded_sha") != DISPOSITION_APPROVED_GRADED_SHA:
        probs.append(
            "DISPOSITION SEAL INTEGRITY FAILURE: graded_sha "
            f"{seal.get('graded_sha')!r} is not the approved "
            f"{DISPOSITION_APPROVED_GRADED_SHA!r}."
        )
    for key, count_key, approved in (
        ("sealed_population", "sealed_population_count", DISPOSITION_APPROVED_POP_SHA256),
        ("sealed_skipped", "sealed_skipped_count", DISPOSITION_APPROVED_SKIPPED_SHA256),
        ("sealed_xfailed", "sealed_xfailed_count", DISPOSITION_APPROVED_XFAILED_SHA256),
    ):
        members = seal.get(key)
        if members is None:
            probs.append(f"DISPOSITION SEAL INTEGRITY FAILURE: {key} is missing.")
            continue
        if seal.get(count_key) != len(members):
            probs.append(
                f"DISPOSITION SEAL INTEGRITY FAILURE: {count_key} "
                f"{seal.get(count_key)} != len({key}) {len(members)}."
            )
        if len(set(members)) != len(members):
            probs.append(
                f"DISPOSITION SEAL INTEGRITY FAILURE: {key} contains duplicate node IDs."
            )
        recomputed = hashlib.sha256(
            "\n".join(sorted(members)).encode("utf-8")
        ).hexdigest()
        # Against the EXTERNAL anchor, never the file's own stored digest — a seal
        # that recomputes its own digest cannot be allowed to authorize itself.
        if recomputed != approved:
            probs.append(
                f"DISPOSITION SEAL INTEGRITY FAILURE: {key} digest {recomputed} does "
                f"not match the approved hash pinned in this runner ({approved})."
            )
    return probs


def validate_seal(seal):
    """SEAL PREFLIGHT — run BEFORE the seal is used for anything (F-ACCEPT5-5).

    Returns a list of refusal strings; empty means the seal may be trusted.
    """
    probs = []
    pop = seal.get("collected_population")
    if not isinstance(pop, list) or not pop:
        return ["SEAL INTEGRITY FAILURE: collected_population is missing or empty — "
                "an empty seal would silently authorize every future run."]
    if seal.get("graded_sha") != SEAL_APPROVED_GRADED_SHA:
        probs.append(
            f"SEAL INTEGRITY FAILURE: graded_sha {seal.get('graded_sha')!r} is not the "
            f"approved sealed commit {SEAL_APPROVED_GRADED_SHA!r}.")
    if seal.get("collected_count") != len(pop):
        probs.append(
            f"SEAL INTEGRITY FAILURE: collected_count {seal.get('collected_count')} != "
            f"len(collected_population) {len(pop)}.")
    dupes = len(pop) - len(set(pop))
    if dupes:
        probs.append(f"SEAL INTEGRITY FAILURE: {dupes} duplicate node ID(s) in the sealed population.")
    recomputed = hashlib.sha256("\n".join(sorted(pop)).encode("utf-8")).hexdigest()
    if recomputed != seal.get("collected_population_sha256"):
        probs.append(
            "SEAL INTEGRITY FAILURE: the stored collected_population_sha256 does not match "
            "a recompute over the sorted population.")
    if recomputed != SEAL_APPROVED_POP_SHA256:
        probs.append(
            "SEAL INTEGRITY FAILURE: the sealed population does not match the approved hash "
            "pinned in this runner. A seal that recomputes its own digest cannot authorize itself.")
    return probs


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
    ap.add_argument("--seal", type=Path, default=SEAL,
                    help="ACCEPT5-COLLECTION-BASELINE-1 companion artifact")
    args = ap.parse_args()

    failures_of_the_gate = []   # every reason this gate refuses
    notes = []

    members = read_manifest(args.manifest)

    # --- F-2 BASELINE PREFLIGHT — BEFORE the baseline is used for anything ----
    # It defines NEW and GONE. Validating it after reading it would be auditing a
    # witness whose testimony you have already written down.
    baseline_problems = validate_baseline_bytes(args.baseline)
    print(f"[BASELINE] preflight problems            : {len(baseline_problems)}")
    for pr in baseline_problems:
        print(f"      {pr}")
    failures_of_the_gate.extend(baseline_problems)

    base = read_baseline(args.baseline)
    seal = None
    if args.seal and Path(args.seal).is_file():
        seal = json.loads(Path(args.seal).read_text(encoding="utf-8"))

    # --- preflight: the baseline's own two assertions -----------------------
    resolved, missing = [], []
    for m in members:
        p = REPO / "src" / m
        (resolved if p.is_file() else missing).append(m)
    # CLASS RULE (F-ACCEPT5-6): every line this runner prints either GATES or is
    # prefixed NOTE:. `missing` gates; the two counts beside it are context.
    print(f"NOTE: [1] manifest members (comments stripped) : {len(members)}")
    print(f"NOTE:     resolved under <repo>/src            : {len(resolved)}")
    print(f"[1] manifest members that DO NOT RESOLVE : {len(missing)}")
    if missing:
        failures_of_the_gate.append(f"PREFLIGHT: {len(missing)} manifest members do not resolve: {missing[:5]}")

    print(f"NOTE: [2] baseline                             : {args.baseline.name}")
    print(f"NOTE:     baseline population_members          : {base['population_members']}")
    print(f"NOTE:     baseline failures (node IDs)         : {len(base['failures'])}")
    print(f"NOTE: [9] ordered_6b_reds READ FROM baseline   : {len(base['ordered_6b_reds'])}")
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
    #
    # F-R2-1 REPAIR — the fresh-run protocol (R-799 SS2, carried verbatim).
    #
    # WHAT WAS WRONG: this block used to read
    #     subprocess.run(cmd, cwd=REPO)
    # as a BARE EXPRESSION STATEMENT, and the next statement parsed `run_json`
    # unconditionally. So a pytest that died before executing anything left the
    # PREVIOUS run's artifacts on disk and the runner scored those instead --
    # issuing a verdict about a run that never happened. The permanent RED for
    # this is src/engine/tests/test_accept5_stale_run_consumption.py (c31a30e3).
    #
    #   `A GATE THAT DOES NOT READ ITS OWN SUBPROCESS'S EXIT CODE IS NOT MEASURING
    #    THE TREE -- IT IS MEASURING THE LAST TIME SOMEBODY MEASURED THE TREE.`
    #
    # Note the exit-status policy carefully: exit 1 is LEGITIMATE here, because the
    # governed population intentionally contains historical failures. Blindly using
    # check=True would convert every genuinely failing member into an infrastructure
    # error, which is a new false RED rather than a fix (red-proof R6).
    if args.run:
        # (1) unique run identity, and (2) a unique output location for it.
        run_id = uuid.uuid4().hex
        run_dir = args.out_dir / f"run-{run_id}"
        run_dir.mkdir(parents=True, exist_ok=False)
        run_json = run_dir / "acceptance-run.json"
        run_xml = run_dir / "acceptance-run.xml"

        # (3) the artifacts of THIS run must not already exist.
        if run_json.exists() or run_xml.exists():
            print(f"{PYTEST_RUN_INVALID}: output artifacts already exist in the "
                  f"freshly minted run directory {run_dir}.")
            raise SystemExit(2)

        # (4) pre-run authority: what this run claims to be, recorded BEFORE it runs
        #     so nothing measured afterwards can quietly redefine it.
        pre_head = _git_head()
        cmd = [sys.executable, "-m", "pytest", *[f"src/{m}" for m in resolved],
               "-q", "--no-header", "-p", "no:cacheprovider",
               "-p", "scripts.acceptance_pytest_plugin",
               f"--acceptance-out={run_json}", f"--junitxml={run_xml}",
               f"--acceptance-run-id={run_id}"]
        pre_run_authority = {
            "run_id": run_id,
            "head": pre_head,
            "manifest": str(args.manifest),
            "runner_sha256": _sha256_file(Path(__file__)),
            "invocation_digest": hashlib.sha256(
                "\x00".join(cmd).encode("utf-8")).hexdigest(),
            "started_at": time.time(),
            "repo": str(REPO),
        }
        print(f"NOTE: [0] fresh run                            : {run_id} "
              f"(HEAD {pre_head or 'unknown'})")

        # ---- execute, and CAPTURE the result --------------------------------
        proc = subprocess.run(cmd, cwd=REPO)

        # Only 0 and 1 mean "the population was collected and executed". Everything
        # else -- 2 interrupted, 3 internal error, 4 usage error, 5 nothing
        # collected, or any crash -- means this run produced no evidence about the
        # tree, and membership must NOT be parsed afterwards.
        if proc.returncode not in (0, 1):
            print(f"{PYTEST_RUN_INVALID}: pytest exited {proc.returncode}, which is "
                  f"not a valid execution status (0=clean, 1=failures occurred). "
                  f"The governed population was not executed, so no verdict is "
                  f"possible. Run id {run_id}; nothing was scored.")
            raise SystemExit(2)

        # ---- post-run joins, ALL required BEFORE scoring begins --------------
        invalid = []
        if not run_json.is_file():
            invalid.append(f"the plugin record was not written to {run_json}")
        if not run_xml.is_file():
            invalid.append(f"the JUnit XML was not written to {run_xml}")
        if not invalid:
            _rec = json.loads(run_json.read_text(encoding="utf-8"))
            if int(_rec.get("pytest_exitstatus", -1)) != proc.returncode:
                invalid.append(
                    f"the plugin recorded pytest_exitstatus "
                    f"{_rec.get('pytest_exitstatus')!r} but the subprocess really "
                    f"exited {proc.returncode} - the record does not describe this run")
            if _rec.get("run_id") != run_id:
                invalid.append(
                    f"the plugin recorded run_id {_rec.get('run_id')!r}, not the "
                    f"requested {run_id!r} - this record belongs to a different run")
            if _rec.get("cwd") != pre_run_authority["repo"]:
                invalid.append(
                    f"the plugin ran in {_rec.get('cwd')!r}, not the repository "
                    f"{pre_run_authority['repo']!r} this invocation authorised")
        post_head = _git_head()
        if pre_head is not None and post_head != pre_head:
            invalid.append(
                f"HEAD moved during execution ({pre_head} -> {post_head}); the run "
                f"does not describe a single tree state")
        if invalid:
            print(f"{PYTEST_RUN_INVALID}: " + " | ".join(invalid))
            raise SystemExit(2)
    else:
        run_json, run_xml = args.from_run, args.junit

    rec = json.loads(Path(run_json).read_text(encoding="utf-8"))
    collected = set(rec["collected"])
    executed = set(rec["executed"])
    plugin_failures = set(rec["failures"])
    skipped = set(rec["skipped"])
    xfailed = set(rec["xfailed"])

    print(f"NOTE: [3] feeder                               : {rec['instrument']} "
          f"(pytest exit {rec['pytest_exitstatus']})")
    print(f"NOTE: [4] collected/executed/failed/skip/xfail : "
          f"{len(collected)}/{len(executed)}/{len(plugin_failures)}/{len(skipped)}/{len(xfailed)}")

    # --- SELF-CHECK against the independent feeder ---------------------------
    if run_xml and Path(run_xml).is_file():
        j_cases, j_failures = read_junit(Path(run_xml))
        n_junit_cases = len(j_cases)
        j_cases = set(j_cases)
        only_plugin = plugin_failures - j_failures
        only_junit = j_failures - plugin_failures
        size_delta = len(collected) - n_junit_cases

        # --- F-1 (R-794 §6) — COLLECTION MEMBERSHIP, BOTH DIRECTIONS. ----------
        # `j_cases` was built here and then never read again: the only collection
        # comparison was on SIZE. A BALANCED edit — one member dropped, another
        # added — preserves the size and was completely invisible, while the
        # runner printed "feeders AGREE on membership and size".
        #   `COMPARE MEMBERS, NEVER COUNTS` was already this campaign's law for the
        #   FAILURE set; it was never applied to the COLLECTION set.
        only_plugin_collection = sorted(collected - j_cases)
        only_junit_collection = sorted(j_cases - collected)

        print(f"[SELF-CHECK] independent feeder (junitxml) cases={n_junit_cases} "
              f"failures={len(j_failures)}")
        if only_plugin or only_junit:
            failures_of_the_gate.append(
                "FEEDER DISAGREEMENT on failure membership — "
                f"plugin-only={sorted(only_plugin)[:5]} junit-only={sorted(only_junit)[:5]}"
            )
        if only_plugin_collection or only_junit_collection:
            failures_of_the_gate.append(
                "FEEDER DISAGREEMENT on collection membership — "
                f"ONLY_PLUGIN_COLLECTION={only_plugin_collection[:5]} "
                f"ONLY_JUNIT_COLLECTION={only_junit_collection[:5]}"
            )
        if abs(size_delta) > 0:
            failures_of_the_gate.append(
                f"FEEDER DISAGREEMENT on collection size — plugin={len(collected)} "
                f"junit={n_junit_cases} delta={size_delta}"
            )
        # 🛑 The success sentence may claim collection agreement ONLY when BOTH
        # membership directions are empty. `A CAPTION IS A CLAIM.`
        if not (
            only_plugin
            or only_junit
            or size_delta
            or only_plugin_collection
            or only_junit_collection
        ):
            print("             feeders AGREE on failure membership, collection "
                  "membership and size")
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

    # --- (R-791 §4.1) GONE IS ENFORCED, NOT MERELY PRINTED --------------------
    # F-ACCEPT5-1: `gone` was computed and printed and never reached the refusal
    # list, so a baseline red that went green, stayed collected and produced no
    # feeder disagreement let the gate PASS. The campaign criterion is
    # ADDITIONS FORBIDDEN, SUBTRACTIONS NAMED AND EXPLAINED — for S6 the only
    # authorized subtraction is the two ordered_6b_reds.
    authorized_gone = set(base["ordered_6b_reds"])
    unauthorized_gone = sorted(set(gone) - authorized_gone)
    print(f"[7/8] authorized GONE (ordered_6b_reds)  : {len(authorized_gone)}")
    print(f"[7/8] UNAUTHORIZED GONE                  : {len(unauthorized_gone)}")
    for n in unauthorized_gone[:15]:
        print(f"      UNAUTHORIZED GONE: {n}")
    if unauthorized_gone:
        failures_of_the_gate.append(
            f"UNAUTHORIZED GONE: {len(unauthorized_gone)} baseline failure(s) stopped "
            f"failing without authorization. Only the {len(authorized_gone)} "
            f"ordered_6b_reds may leave the failure set."
        )

    # --- (R-792 §5.1) THE OTHER SET DIRECTION ---------------------------------
    # F-ACCEPT5-4: enforcing only `gone ⊆ authorized` while the caption asserts
    # `gone == authorized` leaves the converse open. An authorized 6B red that
    # starts FAILING again shrinks `gone`, adds no NEW (it was already a
    # baseline failure), trips no feeder disagreement — and the gate PASSED.
    #   `A REPAIR THAT FIXES THE INSTANCE AND NOT THE CLASS RE-CREATES THE
    #    DEFECT IN THE SAME COMMIT.`
    missing_authorized_gone = sorted(authorized_gone - set(gone))
    print(f"[7/8] MISSING AUTHORIZED GONE            : {len(missing_authorized_gone)}")
    for n in missing_authorized_gone[:15]:
        print(f"      MISSING AUTHORIZED GONE: {n}")
    if missing_authorized_gone:
        failures_of_the_gate.append(
            f"MISSING AUTHORIZED GONE: {len(missing_authorized_gone)} authorized "
            f"ordered_6b_red(s) did NOT leave the failure set. The S6 result requires "
            f"GONE to EQUAL the authorized set, not merely be contained in it."
        )

    # --- (R-791 §4.3) THE SEALED COLLECTION MUST REMAIN COLLECTED -------------
    # F-ACCEPT5-2: protecting only baseline FAILURES leaves every previously
    # GREEN sealed test unguarded — rename it, delete it, or hide it behind a
    # skip-producing import error and no check notices.
    if seal is not None:
        # SEAL PREFLIGHT FIRST — the seal is not used for anything until it has
        # been validated against the runner's own out-of-band contract.
        seal_problems = validate_seal(seal)
        print(f"[SEAL] preflight problems                : {len(seal_problems)}")
        for pr in seal_problems:
            print(f"      {pr}")
        failures_of_the_gate.extend(seal_problems)

        sealed_pop = set(seal["collected_population"])
        vanished = sorted(sealed_pop - collected)
        print(f"[SEAL] sealed collection @ {str(seal.get('graded_sha'))[:8]} : {len(sealed_pop)} node IDs")
        print(f"[SEAL] sealed members no longer collected : {len(vanished)}")
        for n in vanished[:15]:
            print(f"      SEALED COLLECTION MEMBER MISSING: {n}")
        if vanished:
            failures_of_the_gate.append(
                f"SEALED COLLECTION MEMBER MISSING: {len(vanished)} test(s) that were "
                f"collected at the sealed commit are no longer collected. New tests may "
                f"be added; no sealed test may silently vanish."
            )
    else:
        failures_of_the_gate.append(
            "NO SEALED COLLECTION SUPPLIED: --seal is required. Without it a "
            "previously-green sealed test can vanish unseen (F-ACCEPT5-2)."
        )

    # --- F-3: SEALED DISPOSITIONS — PASS→SKIP / PASS→XFAIL ------------------
    if DISPOSITION_SEAL.is_file():
        disp = json.loads(DISPOSITION_SEAL.read_text(encoding="utf-8"))
        disp_problems = validate_disposition_seal(disp)
        print(f"[DISP] preflight problems                : {len(disp_problems)}")
        for pr in disp_problems:
            print(f"      {pr}")
        failures_of_the_gate.extend(disp_problems)

        disp_pop = set(disp["sealed_population"])
        # 🛑 SCOPED TO THE SEALED POPULATION on purpose: a NEWLY ADDED test may
        # legally skip without tripping this gate, while no SEALED test may change
        # disposition in EITHER direction.
        for label, current, sealed_members, authorized in (
            ("SKIP", skipped, set(disp["sealed_skipped"]),
             set(DISPOSITION_AUTHORIZED_UNSKIPPED)),
            ("XFAIL", xfailed, set(disp["sealed_xfailed"]),
             set(DISPOSITION_AUTHORIZED_UNXFAILED)),
        ):
            # An authorization naming a test that was never in this disposition at
            # the seal cannot authorize anything — and left unchecked it would be a
            # blank cheque for future drift.
            phantom = sorted(authorized - sealed_members)
            if phantom:
                failures_of_the_gate.append(
                    f"AUTHORIZED {label} LIST IS INVALID: {len(phantom)} member(s) were "
                    f"never {label} at the seal: {phantom}. An authorization for a change "
                    f"that never existed can only widen what passes."
                )

            current_in_sealed = set(current) & disp_pop
            newly = sorted(current_in_sealed - sealed_members)

            # 🛑 F-ACCEPT5-7 (R-795 §2). `authorized` was subtracted in ONE direction
            # only, so an AUTHORIZED test that RETURNS to this disposition re-entered
            # `current_in_sealed` (leaving `no_longer`) and was in `sealed_members`
            # (so it never entered `newly`). NEITHER check fired and the gate PASSED
            # on a violated state. `observed ⊆ authorized` is not `observed ==`.
            #
            # This is `MISSING AUTHORIZED GONE` (:570) one dimension over: that mirror
            # was built for the FAILURE dimension by R-792 and the DISPOSITION
            # dimension, added later, copied the shape and not the lesson.
            observed_removed = sealed_members - current_in_sealed
            no_longer = sorted(observed_removed - authorized)
            missing_authorized = sorted(authorized - observed_removed)
            print(f"[DISP] sealed {label:<5} membership drift        : "
                  f"+{len(newly)} / -{len(no_longer)}")
            # 🛑 THREE REFUSALS, BY MEMBERSHIP, NEVER COUNTS — and the caption now
            # matches the code. It previously said "BOTH DIRECTIONS" while the
            # authorized subset had exactly ONE, which is worse than no caption:
            # `A COMMENT THAT OVER-STATES A GUARD MAKES THE NEXT READER VERIFY THE
            #  CAPTION INSTEAD OF THE CODE.`
            #   newly              — a sealed test acquired this disposition
            #   no_longer          — an UNAUTHORIZED sealed test lost it
            #   missing_authorized — an AUTHORIZED change did NOT actually happen
            # A balanced swap leaves every aggregate count identical, so counts
            # cannot see any of the three.
            if missing_authorized:
                for n in missing_authorized[:10]:
                    print(f"      MISSING AUTHORIZED DISPOSITION CHANGE ({label}): {n}")
                failures_of_the_gate.append(
                    f"MISSING AUTHORIZED DISPOSITION CHANGE: {len(missing_authorized)} "
                    f"test(s) are authorized to have stopped being {label} but are "
                    f"{label} right now. An authorization is a statement that a change "
                    f"HAPPENED; if it did not, the authorization is hiding the reversal."
                )
            if newly:
                for n in newly[:10]:
                    print(f"      SEALED TEST NEWLY {label}: {n}")
                failures_of_the_gate.append(
                    f"SEALED DISPOSITION CHANGED: {len(newly)} sealed test(s) are now "
                    f"{label} that were RUNNING at the seal. A test that stops running "
                    f"reads as NEW=0 while its assertion no longer executes."
                )
            if no_longer:
                for n in no_longer[:10]:
                    print(f"      SEALED TEST NO LONGER {label}: {n}")
                failures_of_the_gate.append(
                    f"SEALED DISPOSITION CHANGED: {len(no_longer)} sealed test(s) are no "
                    f"longer {label} though they were at the seal. Re-enabling is likely "
                    f"good news, but it is a POPULATION CHANGE and must be declared, not "
                    f"absorbed."
                )
    else:
        failures_of_the_gate.append(
            "NO SEALED DISPOSITIONS SUPPLIED: the disposition seal is required. "
            "Without it a sealed test can go PASS->SKIP and the gate reads NEW=0 (F-3)."
        )

    # F-ACCEPT5-6, THE WORKED EXAMPLE: this block already computed "FAILING" —
    # which IS `MISSING AUTHORIZED GONE` — and then only printed it. The
    # judgement is now GATED above; what remains here is context, so it is
    # labelled NOTE: rather than left looking like an unenforced verdict.
    print("NOTE: [9] ordered_6b_reds live status (GATED above):")
    for n in base["ordered_6b_reds"]:
        nn = n
        state = ("FAILING" if nn in plugin_failures else
                 "NOT COLLECTED" if nn not in collected else
                 "COLLECTED BUT NOT FAILING")
        print(f"NOTE:       {state:<26} {nn}")

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
    print("ACCEPTANCE: PASS — NEW=0; GONE matches the authorized set; "
          "sealed collection intact; feeders agree.")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
