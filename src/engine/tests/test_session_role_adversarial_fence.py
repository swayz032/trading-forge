"""ADVERSARIAL FENCE for the role-aware session resolver — authored SEALED.

WHY THIS FILE EXISTS
────────────────────
A prior fix wave claimed "FP 33.3% -> 0.0%". An independent grader authored 18
fresh inputs and measured FP 60% — WORSE than the 50% baseline. The wave's own
fence was untrustworthy for three reasons, each of which this file is built to
avoid reproducing:

  1. Its 20 "independent" filler rows were drawn from the battery the resolver
     was tuned against — i.e. training data.
        -> HERE: every one of the rows below was written by the fence author.
           `test_corpus_is_disjoint_from_every_tuning_source` PROVES the
           non-overlap by LOADING the three sources and comparing, rather than
           asserting it in a docstring.

  2. Its validating control COULD NOT FAIL: swapping the filler for pure junk
     reproduced the identical baseline, because every error came from 13
     hardcoded known-defect literals and the filler contributed zero.
        -> HERE: `test_fence_discriminates_a_broken_resolver` monkeypatches the
           resolver to always-bind and to always-refuse and REQUIRES the corpus
           to report wildly different FP/FN in each case. A corpus that reports
           the same numbers no matter what the resolver does is a caption, not a
           fence. That check is BLOCKING.

  3. Its provenance statement was factually wrong (claimed 20 battery-drawn; 3
     were hand-written).
        -> HERE: provenance is a single sentence — 100% author-original, 0 rows
           from any source — and it is machine-checked, not narrated.

SCORING BOUNDARY
────────────────
Everything is scored through `bind_condition()`, the PRODUCTION entry point —
never `classify_session_role()` directly. A resolver that behaves correctly in
isolation but is wired into the dispatch wrongly must still show up red here.

The role resolver is only consulted when TF_SESSION_ROLE_RESOLVER_ENABLED=true
AND `resolve_session_keyword()` has already missed. This harness measures BOTH
flag states, because "the defect disappears with the flag off" is a fact about
the flag, not about the resolver.

VERDICT VOCABULARY
──────────────────
  should_bind               bindable=True and session_zone == the expected zone
  should_recognize_unbound  bindable=False, reason=SESSION_TEACHING_UNBOUND_REASON
                            ("we saw real session teaching, we have no primitive
                             that computes it") — an honest refusal, not an error
  should_refuse             bindable=False, reason="no_recognized_session_keyword"
                            — the text is not session teaching at all

  AMBIGUOUS                 the author does not believe a binary verdict is
                            defensible. Reported SEPARATELY and EXCLUDED from
                            every scored rate. Not forced into a binary to pad n.

ZONE EXPECTATIONS ARE DERIVED FROM THE PUBLISHED WINDOW TABLE, NOT THE RESOLVER
──────────────────────────────────────────────────────────────────────────────
Minute-of-day windows (session_windows.py; mirrored in spec_family_bindings.py):
    london         [120, 300)                         02:00-05:00 ET
    ny_am          [420, 600)                         07:00-10:00 ET
    ny_pm          [810, 960)                         13:30-16:00 ET
    silver_bullet  [180,240) [600,660) [840,900)      03-04, 10-11, 14-15 ET
    macro_window   [590,610) [153,180) [243,270)
Greatest-overlap wins; ties break in the order ny_am, london, ny_pm,
silver_bullet, macro_window. Every `zone` below was computed BY HAND from that
table before the resolver was ever run against the row. Where the resolver
disagreed, the hand derivation was RE-DERIVED FROM THE TABLE — never replaced
with the resolver's answer. That direction of resolution is the whole point of
an adversarial fence.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pytest

from src.engine import spec_family_bindings as sfb
from src.engine.spec_family_bindings import (
    SESSION_TEACHING_UNBOUND_REASON,
    SessionRoleResult,
    bind_condition,
)

BIND = "should_bind"
UNBOUND = "should_recognize_unbound"
REFUSE = "should_refuse"
AMBIGUOUS = "AMBIGUOUS"

NOT_SESSION_REASON = "no_recognized_session_keyword"


# ─────────────────────────────────────────────────────────────────────────────
# THE CORPUS. 78 rows. Every literal below was written by the fence author.
#
#   text   · the literal object text fed to bind_condition()
#   expect · the author's verdict
#   zone   · expected killzone for `should_bind` rows (hand-derived, see header)
#   why    · one-line justification
#   pair   · near-miss pair id — minimally-different sentences that must split
#   subset · named probe group
# ─────────────────────────────────────────────────────────────────────────────

def _r(rid, text, expect, why, zone=None, pair=None, subset=None):
    return {
        "id": rid,
        "text": text,
        "expect": expect,
        "zone": zone,
        "why": why,
        "pair": pair,
        "subset": subset or "general",
    }


CORPUS: list[dict] = [
    # ── A. Meridiem clocks in ordinary non-market prose ──────────────────────
    # THE CURRENT LIVE DEFECT. A meridiem on a clock token is treated as
    # self-sufficient market context, so household scheduling binds real
    # killzone windows. Chores, appointments, meals, sport, travel, childcare,
    # TV. None of these are trading instructions by any reading.
    _r("A01", "garbage pickup is at 8 a.m. on Thursdays", REFUSE,
       "Municipal waste schedule; 'a.m.' is a clock, not market context.", subset="prose_clock"),
    _r("A02", "my dentist appointment is at 2:30 p.m.", REFUSE,
       "Medical appointment; no chart object, no instruction.", pair="P1", subset="prose_clock"),
    _r("A03", "the school bus comes by at 7:15 a.m. every weekday", REFUSE,
       "Childcare logistics; recurrence is a weekday pattern, not a session.", subset="prose_clock"),
    _r("A04", "we usually eat dinner around 6 p.m. when the kids are home", REFUSE,
       "Meal timing; 'around' signals approximation, not a delimited window.", subset="prose_clock"),
    _r("A05", "her flight lands at 11:40 p.m. so I will be up late", REFUSE,
       "Travel; the time governs a personal consequence, not a trade.", subset="prose_clock"),
    _r("A06", "soccer practice starts at 5pm on Tuesdays and Thursdays", REFUSE,
       "Youth sport; colon-less meridiem clock with zero market vocabulary.",
       pair="P2", subset="prose_clock"),
    _r("A07", "the pharmacy closes at 9pm so go before then", REFUSE,
       "Retail hours; 'closes' is a shop closing, not a session close.", subset="prose_clock"),
    _r("A08", "I set my alarm for 4:45 a.m. to get the workout in", REFUSE,
       "Personal routine; the hour is when the author wakes, not when price moves.",
       subset="prose_clock"),
    _r("A09", "the plumber said he would be here between 9 a.m. and 12 p.m.", REFUSE,
       "Service window; 'between X and Y' is a span but the subject is a tradesman.",
       subset="prose_clock"),
    _r("A10", "my daughter's recital is at 3 p.m. in the school auditorium", REFUSE,
       "Family event; the locative makes the non-market reading unambiguous.", subset="prose_clock"),
    _r("A11", "trash day pickup moved to 8am starting next month", REFUSE,
       "Chore reschedule; 'starting' governs a month, not a clock span.", subset="prose_clock"),
    _r("A12", "the dog gets fed at 6:30 a.m. and again at 6:30 p.m.", REFUSE,
       "Two clock tokens, both about a pet; multiplicity is not corroboration.",
       subset="prose_clock"),
    _r("A13", "the game kicks off at 1 p.m. eastern time on Sunday", REFUSE,
       "Sport with a real timezone phrase; timezone is ordinary English scheduling.",
       subset="prose_clock"),
    _r("A14", "our team standup is at 9:30 a.m. every day", REFUSE,
       "Office ritual that lands EXACTLY on the NYSE open minute — the hardest "
       "negative in the set, because the number itself is market-shaped.",
       subset="prose_clock"),
    _r("A15", "the season finale airs at 10 p.m. on Thursday", REFUSE,
       "TV schedule; 'airs' is broadcast vocabulary.", subset="prose_clock"),
    _r("A16", "I have a haircut booked for 11 a.m. on Saturday", REFUSE,
       "Appointment on a day the futures market is shut.", subset="prose_clock"),
    _r("A17", "the oil change appointment is at 2 p.m. downtown", REFUSE,
       "Errand; no instruction verb of any kind.", subset="prose_clock"),
    _r("A18", "we board the ferry at 7:20 a.m. sharp", REFUSE,
       "Travel; 'sharp' emphasises punctuality, still not a trading window.",
       subset="prose_clock"),
    _r("A19", "grandma calls every Sunday at 4 p.m. without fail", REFUSE,
       "Family call; weekly recurrence on a non-trading day.", subset="prose_clock"),
    _r("A20", "the coffee shop opens at 6am if you need somewhere to work", REFUSE,
       "'opens' + a clock, but the subject is a cafe — tests the open-verb fence.",
       subset="prose_clock"),
    _r("A21", "the halftime show ran past 9 p.m. and I fell asleep", REFUSE,
       "Past-tense narration; nothing is being instructed.", subset="prose_clock"),
    _r("A22", "hotel checkout is at 11 a.m. so pack the night before", REFUSE,
       "Travel logistics with an imperative — an imperative about luggage.",
       subset="prose_clock"),
    _r("A23", "my shift ends at 7 p.m. and I drive straight home", REFUSE,
       "Employment hours; 'ends' is a shift boundary.", subset="prose_clock"),
    _r("A24", "we tee off at 7:30 a.m. if the course is dry", REFUSE,
       "Golf; conditional clause makes it look instruction-shaped, it is not.",
       subset="prose_clock"),
    _r("A25", "the kids need to be at daycare by 8 a.m. sharp", REFUSE,
       "Childcare deadline; 'by' is a governing preposition on a clock numeral.",
       subset="prose_clock"),
    _r("A26", "the train to the city leaves at 6:12 a.m.", REFUSE,
       "Commute; an odd-minute departure no killzone table would ever emit.",
       subset="prose_clock"),
    _r("A27", "book club meets at 7 p.m. on the first Monday", REFUSE,
       "Social calendar.", subset="prose_clock"),
    _r("A28", "I take my medication at 10 a.m. and 10 p.m.", REFUSE,
       "Health routine; two anchors spanning the whole day.", subset="prose_clock"),
    _r("A29", "the deli stops serving breakfast at 11am", REFUSE,
       "Food service cutoff, colon-less form.", subset="prose_clock"),
    _r("A30", "he mows the lawn every Saturday at 9am and wakes the whole street", REFUSE,
       "Neighbourhood complaint; weekend chore.", subset="prose_clock"),

    # ── B. Timezone phrases in non-market prose ──────────────────────────────
    _r("B01", "the webinar runs from 14:00 to 15:30 eastern time", REFUSE,
       "Corporate training; a real span preposition + a real timezone, zero market "
       "content — the exact conjunction the tier-2 rule treats as corroboration.",
       pair="P6", subset="timezone_prose"),
    _r("B02", "the release notes say the maintenance window is 03:00 UTC minus 4", REFUSE,
       "Devops maintenance window; 'UTC minus 4' is tier-1 market context by the "
       "resolver's table but is here plainly a server schedule.", subset="timezone_prose"),
    _r("B03", "please submit your timesheet before 5 p.m. EST on Friday", REFUSE,
       "Payroll deadline carrying both a meridiem and a timezone.", subset="timezone_prose"),
    _r("B04", "my brother lives on EST so he is three hours ahead of me", REFUSE,
       "Timezone as geography; no clock token at all.", subset="timezone_prose"),
    _r("B05", "the server clock is set to UTC minus 4 for consistency", REFUSE,
       "Tier-1 phrase with no clock token — must not bind on the phrase alone.",
       subset="timezone_prose"),
    _r("B06", "conference talks are listed in eastern time on the schedule page", REFUSE,
       "Timezone as a display convention.", subset="timezone_prose"),

    # ── C. Session / bell / open words used as filler ────────────────────────
    _r("C01", "start a new session in the terminal before running the migration", REFUSE,
       "Shell session; boundary verb + session noun with no chart object.",
       pair="P5", subset="session_filler"),
    _r("C02", "he was saved by the bell in the last round", REFUSE,
       "Boxing idiom.", subset="session_filler"),
    _r("C03", "the opening of the book explains the whole thesis", REFUSE,
       "'opening' as a literary noun.", subset="session_filler"),
    _r("C04", "I open my journal every night and write three lines", REFUSE,
       "'open' as a physical verb on a notebook.", subset="session_filler"),
    _r("C05", "my therapy session runs long whenever we talk about my father", REFUSE,
       "Clinical session; possessive, no proper session name, no boundary verb.",
       subset="session_filler"),
    _r("C06", "the photographer booked a session for the family portraits", REFUSE,
       "Photo session.", subset="session_filler"),
    _r("C07", "we ring the bell every time someone closes a deal", REFUSE,
       "Sales-floor ritual; 'bell' + 'closes' together and still not a market open.",
       pair="P4", subset="session_filler"),
    _r("C08", "kill the tmux session before you reboot the box", REFUSE,
       "Terminal multiplexer; 'before' + 'session' with no market object.",
       subset="session_filler"),
    _r("C09", "the recording session starts at 8 p.m. in the studio", REFUSE,
       "Music studio booking carrying a boundary verb AND a meridiem clock.",
       pair="P3", subset="session_filler"),
    _r("C10", "the debugging session starts again after the charts finish rendering "
              "in the dashboard", REFUSE,
       "IDE session; the word 'charts' is present but refers to UI widgets — "
       "directly attacks the market-object conjunct as a safety mechanism.",
       subset="session_filler"),
    _r("C11", "the study session opens with a review of last week's notes", REFUSE,
       "Academic session with a boundary verb.", subset="session_filler"),
    _r("C12", "she rang the closing bell at the charity auction", REFUSE,
       "'closing bell' at a non-exchange event.", subset="session_filler"),

    # ── D. Keyword-matcher leak probe (NAMED SUBSET, reported separately) ────
    # These bypass the role resolver entirely: resolve_session_keyword() matches
    # them by bare phrase before classify_session_role() is ever consulted. They
    # are real false positives AT THE PRODUCTION BOUNDARY but belong to a
    # different mechanism than the role resolver. Scored in the headline AND
    # broken out, so the role-resolver-only picture stays visible.
    _r("D01", "we always take a long lunch on Fridays", REFUSE,
       "'lunch' is a bare SESSION_KEYWORDS entry; ordinary prose binds lunch_blackout.",
       subset="keyword_matcher_leak"),
    _r("D02", "the overnight flight was brutal and I barely slept", REFUSE,
       "'overnight' is a bare SESSION_KEYWORDS entry; travel prose binds overnight.",
       subset="keyword_matcher_leak"),

    # ── E. Genuine session teaching — TRUE POSITIVES, phrased unlike the battery
    _r("E01", "only take the setup after 8:30 a.m. once the range has formed", BIND,
       "Instruction gating entries on a clock time; 510 falls in ny_am [420,600).",
       zone="ny_am", subset="teaching_bind"),
    _r("E02", "wait for the 9:30 a.m. candle to close before entering", BIND,
       "The clock selects WHICH candle; 570 in ny_am.", zone="ny_am", subset="teaching_bind"),
    _r("E03", "my window is 2:00 a.m. to 4:00 a.m. on the euro pairs", BIND,
       "Explicit span 120-240; london [120,300) overlap 120 beats silver_bullet's 60.",
       zone="london", subset="teaching_bind"),
    _r("E04", "the first hour after the opening bell is where I take my trades", BIND,
       "Named NYSE-open anchor at 570 -> ny_am.", zone="ny_am", pair="P4", subset="teaching_bind"),
    _r("E05", "price usually reverses around 3 p.m. so I flatten before that", BIND,
       "900 sits in ny_pm [810,960); silver_bullet [840,900) excludes its endpoint.",
       zone="ny_pm", subset="teaching_bind"),
    _r("E06", "I only trade the two hours following the cash open", BIND,
       "'cash open' is a named NYSE anchor at 570 -> ny_am.", zone="ny_am",
       subset="teaching_bind"),
    _r("E07", "from 7:00 a.m. to 9:00 a.m. I am only watching, not trading", BIND,
       "Span 420-540 lies wholly inside ny_am.", zone="ny_am", subset="teaching_bind"),
    _r("E08", "I take one trade between 10:00 a.m. and 11:00 a.m. on the index futures", BIND,
       "Span 600-660 matches silver_bullet's second window exactly (60 min) and "
       "leaves ny_am at zero.", zone="silver_bullet", subset="teaching_bind"),
    _r("E09", "look for the sweep at 2:15 p.m. before the afternoon expansion", BIND,
       "855 sits in both ny_pm and silver_bullet; the documented tie-break "
       "prefers ny_pm.", zone="ny_pm", subset="teaching_bind"),
    _r("E10", "the 3:00 a.m. to 4:00 a.m. window gives me the London manipulation leg", BIND,
       "Span 180-240 ties london against silver_bullet at 60 min; tie-break "
       "prefers london.", zone="london", subset="teaching_bind"),
    _r("E11", "nothing matters until 14:30 EST when the afternoon drive begins", BIND,
       "24-hour token 870 governed by 'until'; ny_pm wins the tie over silver_bullet.",
       zone="ny_pm", subset="teaching_bind"),
    _r("E12", "the NYSE open is the only time I will take a market order", BIND,
       "Named exchange open at 570 -> ny_am.", zone="ny_am", subset="teaching_bind"),
    _r("E13", "I look for the reversal candle at 2:30 p.m. on the NQ chart", BIND,
       "Identical clock to A02 but with a chart object and a pattern noun; 870 -> ny_pm.",
       zone="ny_pm", pair="P1", subset="teaching_bind"),
    _r("E14", "I close every position at 3pm on Fridays", BIND,
       "Identical colon-less form to A06 but the object is a position; 900 -> ny_pm.",
       zone="ny_pm", pair="P2", subset="teaching_bind"),
    _r("E15", "the London session starts at 3 a.m. for me", BIND,
       "Named session phrase; resolves by keyword before the role resolver runs.",
       zone="london", pair="P3", subset="teaching_bind"),
    _r("E16", "the opening bell is when I start my clock", BIND,
       "Bare named anchor with no clock token at all -> 570 -> ny_am.",
       zone="ny_am", pair="P4", subset="teaching_bind"),
    _r("E17", "price runs from 14:00 to 15:30 EST into the highs", BIND,
       "Same span and timezone as B01 but the subject is price; 840-930 -> ny_pm.",
       zone="ny_pm", pair="P6", subset="teaching_bind"),
    _r("E18", "I scale out into 3:45 p.m. as the close approaches", BIND,
       "945 in ny_pm; silver_bullet's third window ends at 900.", zone="ny_pm",
       pair="P7", subset="teaching_bind"),
    _r("E19", "London killzone entries only", BIND,
       "Exact keyword phrase — control proving the pre-existing keyword path "
       "still binds and the role resolver did not shadow it.", zone="london",
       subset="teaching_bind"),
    _r("E20", "the silver bullet hour at 10 a.m. is my highest probability entry", BIND,
       "Exact keyword phrase; keyword path wins before any clock arithmetic.",
       zone="silver_bullet", subset="teaching_bind"),
    _r("E21", "do not touch it until 8am, then trade the first displacement leg", BIND,
       "Colon-less meridiem token governed by 'until'; 480 -> ny_am.",
       zone="ny_am", subset="teaching_bind"),

    # ── F. Genuine session teaching with NO computable window ────────────────
    # These are the honest-refusal class. Getting `should_refuse` here is a
    # DIFFERENT error than getting a bind: it means the resolver did not even
    # see that this is session vocabulary.
    _r("F01", "I stop trading at 11 a.m. because liquidity dries up", UNBOUND,
       "660 is the exclusive endpoint of both ny_am and silver_bullet — genuine "
       "teaching, no window contains it.", subset="teaching_unbound"),
    _r("F02", "avoid entries between 12 p.m. and 1 p.m. when volume thins out", UNBOUND,
       "Span 720-780 sits in the gap between ny_am and ny_pm.", subset="teaching_unbound"),
    _r("F03", "the European open often sets the high of the day", UNBOUND,
       "Real non-NYSE session teaching with no non-guessed minute constant.",
       subset="teaching_unbound"),
    _r("F04", "Tokyo close usually leads into the London move", UNBOUND,
       "Non-NYSE market boundary; 'London move' is not a keyword phrase.",
       subset="teaching_unbound"),
    _r("F05", "I mark the Asia high and use it as a draw on liquidity", UNBOUND,
       "Session-anchored LEVEL reference, not a time window — binding it would "
       "be a category error.", subset="teaching_unbound"),
    _r("F06", "the pre-market highs are my key level for the day", UNBOUND,
       "Same level/zone class; hyphenated form misses the keyword table.",
       subset="teaching_unbound"),
    _r("F07", "once the New York session is underway I look for the range expansion", UNBOUND,
       "Proper session name, but 'underway' names no computable boundary minute.",
       subset="teaching_unbound"),
    _r("F08", "I want a bullish engulfing before my trading session on the 15 minute chart", UNBOUND,
       "Pattern-plus-timing: the time reference selects the candle, but the "
       "session is unnamed so no window is computable.", subset="teaching_unbound"),
    _r("F09", "I am flat by 4 p.m. every single day without exception", UNBOUND,
       "960 is ny_pm's exclusive endpoint — real teaching, uncomputable minute.",
       pair="P7", subset="teaching_unbound"),
    _r("F10", "the new session starts and I mark the opening range on the chart", UNBOUND,
       "Generic session boundary + a real chart object; teaching, but no proper "
       "name and no clock, so nothing is computable.", pair="P5", subset="teaching_unbound"),
    _r("F11", "the Frankfurt open is what actually moves the DAX in the morning", UNBOUND,
       "Non-NYSE open; the resolver owns no Frankfurt constant.", subset="teaching_unbound"),
    _r("F12", "wait for the Asian session to finish before you judge the range", UNBOUND,
       "Proper session name; Asian hours map only to the orphan overnight zone.",
       subset="teaching_unbound"),

    # ── G. AMBIGUOUS — excluded from every scored rate, reported separately ──
    _r("G01", "I journal every morning before the open and again after the close", AMBIGUOUS,
       "'the open'/'the close' may be market boundaries or a personal routine; "
       "the sentence does not settle it.", subset="ambiguous"),
    _r("G02", "we do our review at 4:30 p.m. after the market closes", AMBIGUOUS,
       "Names the market but the activity is a review, not a trade — the clock "
       "may be incidental to the market reference.", subset="ambiguous"),
    _r("G03", "the 8 a.m. print is what everyone is watching", AMBIGUOUS,
       "'print' could be an economic release (session-relevant) or a tape print.",
       subset="ambiguous"),
    _r("G04", "my session starts when the coffee is done", AMBIGUOUS,
       "Trader's ritual framing; unclear whether the session is load-bearing.",
       subset="ambiguous"),
    _r("G05", "I check the charts at 6 a.m. before work", AMBIGUOUS,
       "A chart object and a clock, but the hour may just be when the author is "
       "awake rather than a condition on the setup.", subset="ambiguous"),
]


NEAR_MISS_PAIRS: dict[str, str] = {
    "P1": "A02 dentist at 2:30 p.m. (refuse) vs E13 reversal candle at 2:30 p.m. (bind ny_pm)",
    "P2": "A06 soccer at 5pm (refuse) vs E14 close positions at 3pm (bind ny_pm)",
    "P3": "C09 recording session starts at 8 p.m. (refuse) vs E15 London session at 3 a.m. (bind london)",
    "P4": "C07/E16 bell-as-ritual vs E04/E16 opening bell (bind ny_am)",
    "P5": "C01 terminal session, no chart object (refuse) vs F10 session + opening range (recognize)",
    "P6": "B01 webinar 14:00-15:30 eastern (refuse) vs E17 price 14:00-15:30 EST (bind ny_pm)",
    "P7": "A19 grandma at 4 p.m. (refuse) vs F09 flat by 4 p.m. (recognize) vs E18 3:45 p.m. (bind)",
}


# ─────────────────────────────────────────────────────────────────────────────
# Measurement harness
# ─────────────────────────────────────────────────────────────────────────────

def _bind(text: str):
    return bind_condition(
        {
            "id": "fence:" + re.sub(r"[^a-z0-9]+", "-", text.lower())[:48],
            "type": "WAIT_SESSION",
            "object": text,
            "role": "spine",
        }
    )


def actual_verdict(binding) -> tuple[str, str | None]:
    """Map a production ConditionBinding onto the fence's verdict vocabulary."""
    if binding.bindable:
        return BIND, binding.session_zone
    if binding.reason == SESSION_TEACHING_UNBOUND_REASON:
        return UNBOUND, None
    return REFUSE, None


SCORED = [r for r in CORPUS if r["expect"] != AMBIGUOUS]
AMBIGUOUS_ROWS = [r for r in CORPUS if r["expect"] == AMBIGUOUS]


def measure(rows=None) -> dict:
    """FP/FN over the scored rows, at the production boundary.

    FP  = expected should_refuse, but the resolver BOUND a killzone window.
          (This is the harmful error: a real window is now gating a strategy.)
    FP_soft = expected should_refuse, but the resolver claimed ANY recognition
          (bind or recognize-unbound). Recognition leak on ordinary prose.
    FN  = expected should_bind, but no window was bound.
    ZONE_MISMATCH = bound, but to a window other than the derived one.
    MISS_RECOGNITION = expected should_recognize_unbound, got should_refuse.
    """
    rows = SCORED if rows is None else rows
    out = {
        "n": len(rows),
        "n_refuse": 0, "fp": 0, "fp_soft": 0,
        "n_bind": 0, "fn": 0, "zone_mismatch": 0,
        "n_unbound": 0, "miss_recognition": 0, "over_bind_unbound": 0,
        "exact": 0, "detail": [],
    }
    for row in rows:
        b = _bind(row["text"])
        got, zone = actual_verdict(b)
        ok = False
        if row["expect"] == REFUSE:
            out["n_refuse"] += 1
            if got == BIND:
                out["fp"] += 1
                out["fp_soft"] += 1
            elif got == UNBOUND:
                out["fp_soft"] += 1
            else:
                ok = True
        elif row["expect"] == BIND:
            out["n_bind"] += 1
            if got != BIND:
                out["fn"] += 1
            elif zone != row["zone"]:
                out["zone_mismatch"] += 1
            else:
                ok = True
        else:  # UNBOUND
            out["n_unbound"] += 1
            if got == REFUSE:
                out["miss_recognition"] += 1
            elif got == BIND:
                out["over_bind_unbound"] += 1
            else:
                ok = True
        if ok:
            out["exact"] += 1
        out["detail"].append({**row, "got": got, "got_zone": zone, "ok": ok})

    out["fp_rate"] = round(100.0 * out["fp"] / out["n_refuse"], 1) if out["n_refuse"] else 0.0
    out["fp_soft_rate"] = round(100.0 * out["fp_soft"] / out["n_refuse"], 1) if out["n_refuse"] else 0.0
    out["fn_rate"] = round(100.0 * out["fn"] / out["n_bind"], 1) if out["n_bind"] else 0.0
    out["exact_rate"] = round(100.0 * out["exact"] / out["n"], 1) if out["n"] else 0.0
    return out


# ─────────────────────────────────────────────────────────────────────────────
# 1. PROVENANCE — proven programmatically, never narrated
# ─────────────────────────────────────────────────────────────────────────────

_REPO_ROOT = Path(__file__).resolve().parents[3]
_BLIND_GRADE = _REPO_ROOT / "docs/replay-results/h1-battery/session-ab-blind-grade-RESULT.json"
_BATTERY_SAMPLE = _REPO_ROOT / "docs/replay-results/h1-battery/session-ab-blind-grade-sample.json"
_SIBLING_TEST = Path(__file__).resolve().parent / "test_spec_family_bindings.py"


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _tuning_source_strings() -> dict[str, list[str]]:
    """Every string the resolver could have been tuned against."""
    src: dict[str, list[str]] = {}

    grade: list[str] = []
    if _BLIND_GRADE.exists():
        d = json.loads(_BLIND_GRADE.read_text(encoding="utf-8"))
        for row in d.get("rows", []):
            for key in ("quoted_span", "note", "condition_id"):
                if row.get(key):
                    grade.append(str(row[key]))
    src["session-ab-blind-grade-RESULT.json"] = grade

    battery: list[str] = []
    if _BATTERY_SAMPLE.exists():
        d = json.loads(_BATTERY_SAMPLE.read_text(encoding="utf-8"))
        for row in d.get("rows", []):
            if row.get("object"):
                battery.append(str(row["object"]))
    src["26-row battery (session-ab-blind-grade-sample.json)"] = battery

    lits: list[str] = []
    if _SIBLING_TEST.exists():
        body = _SIBLING_TEST.read_text(encoding="utf-8")
        lits = re.findall(r'"((?:[^"\\]|\\.){12,})"', body) + re.findall(r"'((?:[^'\\]|\\.){12,})'", body)
    src["test_spec_family_bindings.py"] = lits

    return src


def test_tuning_sources_are_actually_loaded():
    """A non-overlap proof against an EMPTY source set proves nothing. This is
    the control on the control: the two JSON artifacts must exist and be
    non-trivial, or the disjointness test below is vacuous."""
    src = _tuning_source_strings()
    assert _BLIND_GRADE.exists(), f"missing tuning source: {_BLIND_GRADE}"
    assert _BATTERY_SAMPLE.exists(), f"missing tuning source: {_BATTERY_SAMPLE}"
    assert len(src["session-ab-blind-grade-RESULT.json"]) >= 26
    assert len(src["26-row battery (session-ab-blind-grade-sample.json)"]) >= 26
    assert len(src["test_spec_family_bindings.py"]) >= 10


def test_corpus_is_disjoint_from_every_tuning_source():
    """PROVEN, not asserted in prose: no fence row is drawn from — or contained
    in — the blind-grade result, the 26-row battery, or the sibling test file."""
    src = _tuning_source_strings()
    flat = [(name, s) for name, lst in src.items() for s in lst]
    normed = [(name, _norm(s)) for name, s in flat]

    collisions = []
    for row in CORPUS:
        mine = _norm(row["text"])
        assert mine, f"{row['id']}: empty text"
        for name, other in normed:
            if not other:
                continue
            if mine == other or mine in other or (len(other) >= 20 and other in mine):
                collisions.append((row["id"], name, other[:90]))
    assert collisions == [], "fence rows overlap tuning sources: " + repr(collisions[:5])


def test_corpus_shape():
    assert len(CORPUS) >= 60, f"corpus too small: {len(CORPUS)}"
    assert len(SCORED) >= 60, f"scored corpus too small: {len(SCORED)}"
    assert len({r["id"] for r in CORPUS}) == len(CORPUS), "duplicate row ids"
    assert len({_norm(r["text"]) for r in CORPUS}) == len(CORPUS), "duplicate row texts"
    for r in CORPUS:
        assert r["expect"] in (BIND, UNBOUND, REFUSE, AMBIGUOUS), r
        assert r["why"], f"{r['id']} has no justification"
        if r["expect"] == BIND:
            assert r["zone"] in ("london", "ny_am", "ny_pm", "silver_bullet", "macro_window"), r
        else:
            assert r["zone"] is None, r
    # every named defect class is represented
    subsets = {r["subset"] for r in CORPUS}
    for required in ("prose_clock", "timezone_prose", "session_filler",
                     "teaching_bind", "teaching_unbound", "ambiguous",
                     "keyword_matcher_leak"):
        assert required in subsets, f"missing coverage class: {required}"
    # near-miss pairs must actually split
    for pid in NEAR_MISS_PAIRS:
        members = [r for r in CORPUS if r["pair"] == pid]
        assert len(members) >= 2, f"pair {pid} has <2 members"
        assert len({r["expect"] for r in members}) >= 2, \
            f"pair {pid} does not split — every member expects the same verdict"


# ─────────────────────────────────────────────────────────────────────────────
# 2. ★ SELF-DISCRIMINATION — BLOCKING. The check the prior wave lacked.
# ─────────────────────────────────────────────────────────────────────────────

def _always_bind(_text):
    return SessionRoleResult(recognized=True, zone="ny_am")


def _always_refuse(_text):
    return SessionRoleResult(recognized=False, zone=None)


def _always_recognize_never_bind(_text):
    return SessionRoleResult(recognized=True, zone=None)


@pytest.fixture
def role_resolver_on(monkeypatch):
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", "true")


def test_fence_discriminates_a_broken_resolver(monkeypatch, role_resolver_on):
    """If this corpus reports similar numbers whatever the resolver does, it is
    a caption, not a fence. Three deliberately broken resolvers must produce
    three materially different score vectors.

    NOTE this is measured through bind_condition(), so the ~4 rows that resolve
    via the pre-existing keyword table are UNAFFECTED by the monkeypatch — the
    separation below is therefore a floor, not a ceiling."""
    monkeypatch.setattr(sfb, "classify_session_role", _always_bind)
    hi = measure()

    monkeypatch.setattr(sfb, "classify_session_role", _always_refuse)
    lo = measure()

    monkeypatch.setattr(sfb, "classify_session_role", _always_recognize_never_bind)
    mid = measure()

    # An always-binding resolver must torch the negatives.
    assert hi["fp_rate"] >= 90.0, f"always-bind produced FP {hi['fp_rate']}% — corpus has too few real negatives"
    # An always-refusing resolver must torch the positives and produce no FPs
    # beyond the keyword-table leak it cannot influence.
    assert lo["fn_rate"] >= 75.0, f"always-refuse produced FN {lo['fn_rate']}% — corpus has too few real positives"
    assert lo["fp_rate"] <= 15.0, f"always-refuse still shows FP {lo['fp_rate']}% — those rows bypass the resolver"
    # The two extremes must be far apart on BOTH axes.
    assert hi["fp_rate"] - lo["fp_rate"] >= 75.0, "corpus cannot separate always-bind from always-refuse on FP"
    assert lo["fn_rate"] - hi["fn_rate"] >= 50.0, "corpus cannot separate always-refuse from always-bind on FN"
    # The recognize-but-never-bind resolver must sit between them on the soft
    # axis: no hard FPs it can cause, but maximal recognition leak.
    assert mid["fp_soft_rate"] >= 90.0, "corpus cannot detect a pure recognition leak"
    assert mid["fp_rate"] <= 15.0
    assert mid["fp_soft_rate"] - mid["fp_rate"] >= 60.0, \
        "corpus cannot tell a recognition leak apart from a binding leak"
    # Exact-match accuracy must move a lot across the three.
    spread = max(hi["exact_rate"], lo["exact_rate"], mid["exact_rate"]) - \
        min(hi["exact_rate"], lo["exact_rate"], mid["exact_rate"])
    assert spread >= 30.0, f"exact-match spread only {spread} pts across three broken resolvers"


def test_flag_off_is_a_distinct_regime(monkeypatch):
    """With the flag off the role resolver is never consulted at all. Any
    measurement that does not state its flag state is uninterpretable — this
    test exists so the harness can never silently report the wrong regime."""
    monkeypatch.delenv("TF_SESSION_ROLE_RESOLVER_ENABLED", raising=False)
    off = measure()
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", "true")
    on = measure()
    assert off != on, "flag ON and flag OFF produced identical results — the flag is not wired"
    assert off["fn_rate"] > on["fn_rate"], "flag OFF should bind strictly fewer genuine rows"


# ─────────────────────────────────────────────────────────────────────────────
# 3. THE MEASUREMENT ITSELF — itemised, honest, currently expected to be RED
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("row", SCORED, ids=[r["id"] for r in SCORED])
def test_row(row, role_resolver_on):
    """One test per scored row so failure is itemised rather than aggregated.

    This harness is a MEASUREMENT instrument. Rows that fail here are the live
    defect, not a broken test. Do not weaken an expectation to make it pass."""
    b = _bind(row["text"])
    got, zone = actual_verdict(b)
    if row["expect"] == BIND:
        assert got == BIND and zone == row["zone"], (
            f"{row['id']} expected bind/{row['zone']}, got {got}/{zone} :: {row['why']}"
        )
    elif row["expect"] == UNBOUND:
        assert got == UNBOUND, (
            f"{row['id']} expected recognized-but-unbound, got {got}/{zone} :: {row['why']}"
        )
    else:
        assert got == REFUSE, (
            f"{row['id']} expected refuse, got {got}/{zone} :: {row['why']}"
        )


def test_no_false_positive_on_ordinary_prose(role_resolver_on):
    """Aggregate headline gate. The prior wave claimed FP 0.0%; an independent
    author measured 60%. This is the number that claim must be re-made against."""
    m = measure()
    offenders = [d["id"] for d in m["detail"] if d["expect"] == REFUSE and d["got"] == BIND]
    assert m["fp"] == 0, (
        f"FP {m['fp']}/{m['n_refuse']} = {m['fp_rate']}% — ordinary prose bound real "
        f"killzone windows: {offenders}"
    )


def test_genuine_session_teaching_still_binds(role_resolver_on):
    m = measure()
    offenders = [d["id"] for d in m["detail"] if d["expect"] == BIND and d["got"] != BIND]
    wrong_zone = [(d["id"], d["zone"], d["got_zone"]) for d in m["detail"]
                  if d["expect"] == BIND and d["got"] == BIND and d["got_zone"] != d["zone"]]
    assert m["fn"] == 0, f"FN {m['fn']}/{m['n_bind']} = {m['fn_rate']}%: {offenders}"
    assert wrong_zone == [], f"bound to the wrong killzone: {wrong_zone}"


# ─────────────────────────────────────────────────────────────────────────────
# 4. Report
# ─────────────────────────────────────────────────────────────────────────────

def _report() -> str:
    lines: list[str] = []
    for flag in ("true", "false"):
        os.environ["TF_SESSION_ROLE_RESOLVER_ENABLED"] = flag
        m = measure()
        lines.append(f"\n=== TF_SESSION_ROLE_RESOLVER_ENABLED={flag} ===")
        lines.append(
            f"n={m['n']} scored ({len(AMBIGUOUS_ROWS)} AMBIGUOUS excluded)  "
            f"exact={m['exact']}/{m['n']} ({m['exact_rate']}%)"
        )
        lines.append(
            f"  FP  {m['fp']}/{m['n_refuse']} = {m['fp_rate']}%   "
            f"(soft/recognition-leak {m['fp_soft']}/{m['n_refuse']} = {m['fp_soft_rate']}%)"
        )
        lines.append(
            f"  FN  {m['fn']}/{m['n_bind']} = {m['fn_rate']}%   "
            f"zone_mismatch={m['zone_mismatch']}"
        )
        lines.append(
            f"  recognize-unbound rows: {m['n_unbound']}  "
            f"missed={m['miss_recognition']}  over-bound={m['over_bind_unbound']}"
        )
        leak = measure([r for r in SCORED if r["subset"] == "keyword_matcher_leak"])
        core = measure([r for r in SCORED if r["subset"] != "keyword_matcher_leak"])
        lines.append(
            f"  [keyword_matcher_leak subset, n={leak['n']}] FP {leak['fp']}/{leak['n_refuse']}"
        )
        lines.append(
            f"  [role-resolver only, leak subset removed] FP {core['fp']}/{core['n_refuse']} "
            f"= {core['fp_rate']}%  FN {core['fn']}/{core['n_bind']} = {core['fn_rate']}%"
        )
        lines.append("  --- failing rows ---")
        for d in m["detail"]:
            if not d["ok"]:
                exp = d["expect"] + (f"/{d['zone']}" if d["zone"] else "")
                gotd = d["got"] + (f"/{d['got_zone']}" if d["got_zone"] else "")
                lines.append(f"    {d['id']}  exp={exp:<28} got={gotd:<28} {d['text'][:64]!r}")
    lines.append("\n=== AMBIGUOUS (excluded from all rates) ===")
    os.environ["TF_SESSION_ROLE_RESOLVER_ENABLED"] = "true"
    for r in AMBIGUOUS_ROWS:
        got, zone = actual_verdict(_bind(r["text"]))
        lines.append(f"  {r['id']}  got={got}/{zone}  {r['text']!r}\n        {r['why']}")
    lines.append("\n=== NEAR-MISS PAIRS ===")
    for pid, desc in NEAR_MISS_PAIRS.items():
        lines.append(f"  {pid}: {desc}")
    return "\n".join(lines)


def test_emit_report(capsys):
    """Never fails. Prints the full disposition table under `pytest -s`."""
    with capsys.disabled():
        print(_report())


if __name__ == "__main__":
    print(_report())
