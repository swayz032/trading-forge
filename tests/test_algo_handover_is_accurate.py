"""The handover must be TRUE on the day it is read, not the day it was written.

ALGO-026 section 1(d). After 2026-08-27 nobody can correct it. Every factual claim it makes
about the repository is checked here against the repository, so a claim that goes stale turns
this red instead of misleading GPT months later.
"""
from __future__ import annotations

import io
import json
import re
from pathlib import Path

import pytest

HANDOVER = Path("ALGO-GPT-HANDOVER.md")
RUNBOOK = Path("ALGO-RUNBOOK.md")


def _text():
    """Whitespace-normalised.

    Markdown wraps lines wherever it likes, so a phrase check against the raw text is hostage
    to where a paragraph happened to break - the first version of this file failed on
    "no output
received". The document was fine; the check was brittle.
    """
    assert HANDOVER.exists(), "ALGO-026 section 1(d) deliverable"
    import re
    return re.sub(r"\s+", " ", io.open(HANDOVER, encoding="utf-8").read())


def test_every_path_it_names_actually_exists():
    """A handover that points at files that are not there is worse than none.

    THE PATH SET IS DERIVED FROM THE DOCUMENT, not typed here. The typed version of this test
    listed FIVE paths and passed for as long as the handover pointed at three files that do not
    exist - `KILL-AND-HEARTBEAT.md`, `SELF-EXPLANATION-AUDIT.md` and `SEAT-HANDOFF-TEMPLATES.md`,
    all of which are named with an `ALGO-` prefix on disk. A cold reader following the map hit
    three dead ends and the suite stayed green.

    This is trap 10 in the very document under test - A HAND-MAINTAINED LIST CERTIFIES ONLY
    ITSELF; DERIVE POPULATIONS, NEVER TYPE THEM - and the guard was guilty of it.
    """
    text = _text()

    # These five must be MENTIONED - the floor stays, because a handover that stopped naming
    # the ground truth would otherwise pass this test by naming nothing at all.
    for rel in ("research/current_mnq_strategy_v2_4_spec.json",
                "research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json",
                "research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json",
                "scripts/publish_algo_report.sh",
                "ALGO-RUNBOOK.md"):
        assert rel in text, f"the handover should name {rel}"

    # ...and EVERY repo-path-looking token it names must resolve.
    named = set(re.findall(r"`([A-Za-z0-9_./-]+\.(?:md|json|py|sh))`", text))

    def is_a_real_path_claim(tok: str) -> bool:
        """Prose names a lot of things that are not paths. Check only what claims to be one."""
        if "*" in tok:
            return False                      # a glob, e.g. current_mnq_strategy_v2_4_*
        if "NNN" in tok or "YYYY" in tok:
            return False                      # a NAMING TEMPLATE, not a file
        if re.fullmatch(r"ALGO-\d+\.md", tok):
            return False                      # prose shorthand for a ruling; the real files
            # live in algo-reports/ under full descriptive names
        if "/" in tok:
            return True                       # an explicit repo path - always checked
        # A BARE BASENAME. Only `.md` is checked: prose legitimately says `force.py` and
        # `derivation.py` as shorthand for research/current_mnq_strategy_v2_4_*.py, but a bare
        # `.md` in this document is always a real root-level doc.
        #
        # THIS LINE READ `tok.startswith("ALGO-")` FOR ONE REVISION AND THE BATTERY CAUGHT IT:
        # the bug being fixed was `KILL-AND-HEARTBEAT.md` (no prefix - the prefix is what was
        # MISSING), so the filter excluded the exact case the guard exists for and D1 went
        # GREEN. A guard whose filter is written from the FIXED spelling cannot see the broken
        # one.
        return tok.endswith(".md")

    missing = sorted(t for t in named
                     if is_a_real_path_claim(t) and not Path(t).exists()
                     and not (Path("research") / t).exists())
    assert not missing, (
        f"the handover names {len(missing)} path(s) that do not exist: {missing}")

    # A derived population needs its own floor: if the extractor silently stopped matching,
    # `named` would be empty and this test would pass while checking nothing.
    assert len(named) >= 15, (
        f"only {len(named)} paths derived - the extractor probably broke, "
        "and a guard that checks nothing passes silently")


def test_the_headline_number_matches_the_scorecard():
    """It says 5/8. If the exam is re-run and that moves, this must be updated."""
    sc = json.load(io.open(
        "research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json",
        encoding="utf-8"))
    agreement = sc["aggregates"]["agreement_decided_cases"]
    assert agreement in _text(), (
        f"the handover's headline does not match the scorecard's {agreement!r}")


def test_the_selectivity_claims_match_the_measurement():
    from research import current_mnq_strategy_v2_4_bot_entry_rate as B
    m = B.measure()
    text = _text()
    assert f"{m['bot_traded_at_all_in_the_session']} of {m['sessions']}" in text.replace(
        "**", ""), "the entry-rate claim does not match the measurement"
    # The doc must describe the CURRENT bot. This used to assert `bot_never_declines is True`,
    # which was the measured defect; ALGO-047's wiring falsified it, so the check is now that
    # the document and the measurement AGREE about which world we are in — in both directions.
    never = m["bot_never_declines"]
    says_never = "never once genuinely decline." in text or "never genuinely\ndeclines" in text
    assert never == says_never, (
        f"the handover and the measurement disagree: bot_never_declines={never} but the "
        f"document {'claims' if says_never else 'does not claim'} it never declines")
    assert m["direction_agreement_when_both_entered"] in text


def test_it_states_the_channel_rule_that_protects_the_main_campaign():
    text = _text()
    assert "gpt-rulings-algo" in text and "never to" in text
    assert "refuses" in text, "the publish script REFUSES rather than warns - say so"


def test_it_carries_the_three_hard_rails():
    text = _text().lower()
    assert "never" in text and "edit the frozen labels" in text
    assert "not funded, not eval, not broker-paper" in text
    assert "rpnl" in text and "off limits" in text


def test_it_records_the_silent_grader_lesson():
    """The single most expensive wrong call of the campaign."""
    text = _text()
    assert "no output received" in text
    assert "never" in text and "failed" in text


def test_the_frozen_labels_file_it_points_at_is_committed():
    """The handover calls it committed. Prove it, or GPT inherits a file in Downloads."""
    import subprocess
    r = subprocess.run(
        ["git", "ls-files", "research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json"],
        capture_output=True, text=True)
    assert r.stdout.strip(), "the handover says the labels are committed and they are not"


def test_the_runbook_it_delegates_to_exists_and_is_not_empty():
    assert RUNBOOK.exists()
    assert len(io.open(RUNBOOK, encoding="utf-8").read()) > 4000


@pytest.mark.parametrize("lesson", [
    "Check the AST, never the text",
    "green check with no path to red",
    "hand-maintained list certifies only itself",
    "comparison is not an exoneration",
])
def test_the_hard_won_lessons_are_present(lesson):
    """These cost real retractions. Losing them at handover would waste that."""
    assert lesson.lower() in _text().lower(), lesson


# ─────────────────────────────────────────────────────────────────────────────────────────────
# THE FIVE SUNSET DOCUMENTS SHARE ONE STANDING-STATE HEADER. It carried a number that no
# measurement supported - "before the operator's own entry clock on 13 of 14 sessions" - in all
# five at once, for as long as they existed. 13 EXCEEDS THE 12 SESSIONS IN WHICH THE BOT TRADES
# AT ALL, which is impossible: a bullet cannot be spent in a session with no trade.
#
# Nothing checked it, because every guard pointed at the handover's *other* number ("12 of 14")
# and that one was right. A cold read found it. This test is the cold read, made permanent.
# ─────────────────────────────────────────────────────────────────────────────────────────────

SUNSET_DOCS = ("ALGO-GPT-HANDOVER.md", "ALGO-RUNBOOK.md", "ALGO-KILL-AND-HEARTBEAT.md",
               "ALGO-SEAT-HANDOFF-TEMPLATES.md", "ALGO-SELF-EXPLANATION-AUDIT.md")

ENTERED_STATES = {"ENTER_LONG", "ENTER_SHORT"}


def _early_bullet_facts():
    """Re-derive the standing-state numbers from the scorecard. Never typed."""
    import datetime as dt
    cases = json.load(io.open(
        "research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json",
        encoding="utf-8"))["cases"]
    traded = pre_window = comparable = bot_first = 0
    for c in cases:
        bf = c.get("budget_faithful") or {}
        bot_acted = bf.get("session_first_action") in ENTERED_STATES
        traded += bot_acted
        pre_window += bool(bf.get("bullet_spent_before_window"))
        he_entered = c.get("trader_state") in ENTERED_STATES
        bt, tt = bf.get("session_first_entry_time"), c.get("trader_decision_clock")
        if bot_acted and he_entered and bt and tt:
            comparable += 1
            bot_first += dt.datetime.fromisoformat(bt) < dt.datetime.fromisoformat(tt)
    return {"sessions": len(cases), "traded": traded, "pre_window": pre_window,
            "comparable": comparable, "bot_first": bot_first}


def test_no_sunset_doc_claims_more_early_bullets_than_sessions_with_a_trade():
    """The arithmetic that convicts the old number, stated as a property.

    A bullet cannot be spent in a session where the bot never traded, so any 'spends it early
    in N of 14' claim is bounded above by 'trades at all in M of 14'. The retracted claim
    violated this by one.
    """
    f = _early_bullet_facts()
    assert f["pre_window"] <= f["traded"], (
        f"pre-window bullets ({f['pre_window']}) exceed sessions with a trade ({f['traded']})")
    assert f["bot_first"] <= f["comparable"] <= f["traded"], f


def _standing_state_block(doc: str) -> str:
    """The leading blockquote only - NOT the whole file.

    Checking the whole file let a mutation delete the measured claim and stay green, because
    `**12 of 14**` also occurs in an unrelated sentence further down the runbook. A claim that
    can be satisfied by a coincidental match elsewhere is not being checked where it matters.
    """
    lines = io.open(doc, encoding="utf-8").read().splitlines()
    block, started = [], False
    for line in lines:
        if line.startswith(">"):
            started = True
            block.append(line)
        elif started and line.strip() == "":
            continue                      # blank lines inside the quote are fine
        elif started:
            break                         # first non-quote prose ends the standing state
    return "\n".join(block)


@pytest.mark.parametrize("doc", SUNSET_DOCS)
def test_every_sunset_doc_states_the_MEASURED_early_bullet_numbers(doc):
    """All five carry the same header; all five must carry the same measured numbers."""
    text = _standing_state_block(doc)
    assert len(text) > 400, f"{doc}: standing-state block not found or truncated"
    f = _early_bullet_facts()
    for claim in (f"**{f['traded']} of {f['sessions']}**",
                  f"**before the audited window even opens in {f['pre_window']} of {f['sessions']}**",
                  f"**{f['comparable']}** sessions where the bot traded",
                  f"precedes his clock in **{f['bot_first']}**"):
        assert claim in text, f"{doc} does not state the measured claim {claim!r}"


@pytest.mark.parametrize("doc", SUNSET_DOCS)
def test_no_sunset_doc_reasserts_the_retracted_early_bullet_number(doc):
    """`13 of 14` may appear ONLY inside the correction notice that retracts it."""
    for line in io.open(doc, encoding="utf-8").read().splitlines():
        if "13 of 14" in line:
            assert ("CORRECTED" in line or "No measurement supports" in line
                    or "superseded" in line or "entry clock on 13 of 14" in line), (
                f"{doc} reasserts the retracted number outside its retraction: {line.strip()!r}")
