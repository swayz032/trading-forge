"""THE JOIN GUARD — the five sunset documents must not rot apart.

ALGO-115, and it exists because of a specific failure. All five carried a byte-identical
standing-state header claiming the bot spends its bullet early "on 13 of 14 sessions". That
number was IMPOSSIBLE (a bullet cannot be spent in a session with no trade, and the bot trades
in 12), and it had ALREADY BEEN RETRACTED in a sixth document. It survived verbatim in five
headers because NOTHING JOINED THE COPIES.

    DUPLICATED PROSE HAS NO OWNER. A retraction lands in the copy the author was looking at.

After sunset the operator's stack is two things: these files and GPT. Nobody will be here to
notice that four of five agree and one drifted.

WHAT THIS GUARD DOES NOT COVER — stated plainly, because a guard that implies completeness is
worse than one that names its blind spot:

  * It joins the STANDING-STATE BLOCK (the leading blockquote) byte-for-byte, checks its figures
    against the measurement, and checks that EVERY repo path any of the five names resolves. It
    does NOT join the prose bodies — the queues, the trap lists, the command sections — which can
    still diverge without turning this red.
  * It checks that shared numbers AGREE and that the standing-state figures match the
    measurement. It does NOT check that unshared numbers are right; a wrong number appearing in
    exactly one document is invisible here.
  * `N of 14` is a SHAPE. A claim phrased another way ("twelve of fourteen", "86%") is not seen.
  * THE PATH CHECK COVERS `MNQ-STRATEGY-SPECIFICATION.md`; THE AGREEMENT JOIN DOES NOT, and that
    is deliberate rather than an oversight - see `PATH_CHECKED_DOCS`.
  * AND IN THAT DOCUMENT IT SEES LESS THAN IT LOOKS LIKE IT DOES. Its citations are written for
    a human as `[video_evidence.md:108]`, and the extractor only matches a path in BACKTICKS, so
    a bracketed citation is invisible to it. What is actually guarded there is the enumerated
    source list at the foot of the document. THE CITATIONS THEMSELVES ARE NOT PATH-CHECKED, and
    they were left readable on purpose: an artifact written for the operator is not reformatted
    to suit an instrument.
"""
from __future__ import annotations

import io
import json
import re
from pathlib import Path

import pytest

SUNSET_DOCS = ("ALGO-GPT-HANDOVER.md", "ALGO-RUNBOOK.md", "ALGO-KILL-AND-HEARTBEAT.md",
               "ALGO-SEAT-HANDOFF-TEMPLATES.md", "ALGO-SELF-EXPLANATION-AUDIT.md")

#: The path check covers ONE MORE DOCUMENT than the agreement join, and the difference is
#: deliberate (ALGO-133 §4). `MNQ-STRATEGY-SPECIFICATION.md` is the strategy written out for the
#: OPERATOR to read and correct. Its whole value is that every line points at something real, so
#: the path guard protects exactly what it is for. It is NOT joined for agreement: that join
#: needs a leading standing-state blockquote, and giving this document an ops header so an
#: instrument can parse it would corrupt an artifact written for him.
#:
#: ADD A DOCUMENT TO THE GUARD THAT PROTECTS WHAT IT IS FOR - NOT TO EVERY GUARD THAT HAPPENS
#: TO TAKE A LIST OF DOCUMENTS.
PATH_CHECKED_DOCS = SUNSET_DOCS + ("MNQ-STRATEGY-SPECIFICATION.md",)

ENTERED_STATES = {"ENTER_LONG", "ENTER_SHORT"}
SCORECARD = "research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json"


def _read(doc: str) -> str:
    p = Path(doc)
    assert p.exists(), f"{doc} is part of the sunset set and must exist"
    return io.open(p, encoding="utf-8").read()


def _standing_state_block(doc: str) -> str:
    """The leading blockquote, derived — not a typed copy of what it currently says."""
    block, started = [], False
    for line in _read(doc).splitlines():
        if line.startswith(">"):
            started = True
            block.append(line.rstrip())
        elif started and not line.strip():
            continue
        elif started:
            break
    return "\n".join(block)


def _measured_facts() -> dict:
    """The quantities the standing state is allowed to assert, re-derived from the scorecard."""
    import datetime as dt
    cases = json.load(io.open(SCORECARD, encoding="utf-8"))["cases"]
    traded = pre_window = comparable = bot_first = 0
    for c in cases:
        bf = c.get("budget_faithful") or {}
        acted = bf.get("session_first_action") in ENTERED_STATES
        traded += acted
        pre_window += bool(bf.get("bullet_spent_before_window"))
        bt, tt = bf.get("session_first_entry_time"), c.get("trader_decision_clock")
        if acted and c.get("trader_state") in ENTERED_STATES and bt and tt:
            comparable += 1
            bot_first += dt.datetime.fromisoformat(bt) < dt.datetime.fromisoformat(tt)
    return {"sessions": len(cases), "traded": traded, "pre_window": pre_window,
            "comparable": comparable, "bot_first": bot_first}


# ── THE JOIN ────────────────────────────────────────────────────────────────────────────────

def test_all_five_standing_state_blocks_are_BYTE_IDENTICAL():
    """The whole point. One block, five copies, and they must never diverge.

    Compared against the FIRST document rather than a stored constant: the guard has no opinion
    about what the block says, only that the five agree. That is what makes it survive an
    intentional rewrite of the standing state.
    """
    blocks = {doc: _standing_state_block(doc) for doc in SUNSET_DOCS}
    assert all(len(b) > 400 for b in blocks.values()), {
        d: len(b) for d, b in blocks.items()}
    reference = blocks[SUNSET_DOCS[0]]
    diverged = {d: b for d, b in blocks.items() if b != reference}
    assert not diverged, (
        "the standing-state block has DIVERGED in: " + ", ".join(sorted(diverged))
        + f" (reference is {SUNSET_DOCS[0]})")


def test_the_shared_standing_state_only_asserts_MEASURED_quantities():
    """Agreement is not enough — five identical copies of a wrong number is the failure we had."""
    f = _measured_facts()
    block = _standing_state_block(SUNSET_DOCS[0])
    for claim in (f"**{f['traded']} of {f['sessions']}**",
                  f"opens in {f['pre_window']} of {f['sessions']}**",
                  f"**{f['comparable']}** sessions where the bot traded",
                  f"precedes his clock in **{f['bot_first']}**"):
        assert claim in block, f"the standing state does not assert the measured {claim!r}"


def test_the_standing_state_numbers_are_ARITHMETICALLY_POSSIBLE():
    """The check that would have caught `13 of 14` with no ground truth at all.

    A bullet cannot be spent in a session where the bot never traded, so every 'spent early'
    count is bounded by the 'traded at all' count. One subtraction kills the retracted claim.
    """
    f = _measured_facts()
    assert f["pre_window"] <= f["traded"] <= f["sessions"], f
    assert f["bot_first"] <= f["comparable"] <= f["traded"], f


@pytest.mark.parametrize("doc", SUNSET_DOCS)
def test_no_sunset_doc_reasserts_the_retracted_13(doc):
    """`13 of 14` may appear ONLY inside the notice that retracts it."""
    for line in _read(doc).splitlines():
        if "13 of 14" in line:
            assert any(k in line for k in
                       ("CORRECTED", "No measurement supports", "superseded",
                        "entry clock on 13 of 14")), (
                f"{doc} reasserts the retracted number outside its retraction: {line.strip()!r}")


def _path_claims(doc: str) -> set:
    """Tokens in `doc` that genuinely claim to be a repo path.

    Bare `.py` basenames are excluded: the prose legitimately says `force.py` and
    `derivation.py` as shorthand for `research/current_mnq_strategy_v2_4_*.py`. A bare `.md` in
    these documents is always a real root-level doc, and anything with a `/` is an explicit path.
    """
    out = set()
    for tok in set(re.findall(r"`([A-Za-z0-9_./-]+\.(?:md|json|py|sh))`", _read(doc))):
        if "*" in tok or "NNN" in tok or "YYYY" in tok:
            continue
        if re.fullmatch(r"ALGO-\d+\.md", tok):
            continue                       # prose shorthand for a ruling, not a file
        if "/" in tok or tok.endswith(".md"):
            out.add(tok)
    return out


def _ladder_files():
    """Filenames on the rulings branch, or None if this clone cannot see it.

    Returns None rather than failing when the remote-tracking ref is absent (a fresh clone, or
    offline). A test that cannot check something must say so, not invent a verdict — but it
    also must not pass silently, so the caller skips only THIS class and still checks the rest.
    """
    import subprocess
    for ref in ("origin/external-advisor/gpt-rulings-algo", "FETCH_HEAD"):
        r = subprocess.run(["git", "ls-tree", "--name-only", "-r", ref, "--", "algo-reports/"],
                           capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return set(r.stdout.split())
    return None


def test_every_repo_path_named_in_ANY_sunset_doc_resolves():
    """A dead pointer copied into several files is the same rot in its other form.

    THIS CHECKS EVERY DOCUMENT, NOT ONLY THE PATHS THEY CURRENTLY SHARE, and the battery is why.
    The first version joined only paths appearing in >= 2 documents. Planting a broken pointer in
    ONE document then went GREEN — because breaking it there left it named in only one file, and
    a path named once was outside the join. **DIVERGENCE ITSELF REMOVED THE EVIDENCE FROM THE SET
    THE GUARD LOOKED AT.** A join defined over "what still agrees" cannot see the thing that
    stopped agreeing.
    """
    seen: dict[str, set] = {}
    for doc in PATH_CHECKED_DOCS:
        for tok in _path_claims(doc):
            seen.setdefault(tok, set()).add(doc)

    assert len(seen) >= 8, (
        f"only {len(seen)} paths derived across five documents - the extractor probably broke, "
        "and a guard that checks nothing passes silently")

    # `algo-reports/` lives on the RULINGS BRANCH, not in this working tree. Resolving those
    # against the tree reported a correct pointer as dead — the document even says "on the
    # ladder". They are resolved against the branch instead of excluded, because excluding a
    # class to make a test pass is how a guard stops guarding.
    ladder = _ladder_files()
    missing = []
    for tok, docs in sorted(seen.items()):
        where = f"{tok} (in {', '.join(sorted(docs))})"
        if tok.startswith("algo-reports/"):
            if ladder is not None and tok not in ladder:
                missing.append(where + " [not on the rulings branch]")
        elif not Path(tok).exists() and not (Path("research") / tok).exists():
            missing.append(where)
    assert not missing, "sunset docs name paths that do not exist: " + "; ".join(missing)
