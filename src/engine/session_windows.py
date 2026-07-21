"""session_windows.py — Python mirror of src/server/lib/killzone.ts (Band C, 2026-07-02).

WHY THIS FILE EXISTS (Ledger E parity discipline — same pattern as
firm_rules_version.py / firm-rules-version.ts and adaptive_exits.py /
adaptive-exit-engine.ts): the audited killzone primitive (5 ICT-canonical
session windows, DST-correct) lives ONLY in TypeScript
(`src/server/lib/killzone.ts`) because it currently only serves the live-paper
confluence-score.ts consumer. The Python backtest engine has NO killzone
primitive of its own — every archetype strategy that needs a session window
(silver_bullet.py, ict_scalp.py, etc.) re-derives its own ET-hour check
inline rather than sharing one.

Band C's spec-condition compiler needs a WAIT_SESSION binding for backtests.
Per the hard project rule "reuse beats rebuild," this module is a BYTE-FOR-BYTE
CONSTANT mirror of killzone.ts's 5 zones and boundary semantics — not a new
design. It is NOT flagged `approximation=True` in binding plans: it reproduces
the exact same audited windows the TS side already ships, so any two-sided
consumer computes identically.

Boundary semantics: [start, end) in ET wall-clock minutes-of-day —
start-inclusive, end-exclusive — identical to killzone.ts.

Parity is enforced by test_session_windows_parity.py, which walks a fixture
timestamp set through this module and (documented) asserts the same booleans
the TS `killzone.ts` fixtures produce for identical inputs (see that test file
for the exact fixture table mirrored from killzone.test.ts).
"""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

# ─── Named boundary constants (mirror killzone.ts lines 22-52 EXACTLY) ────────
LONDON_START_MIN = 2 * 60
LONDON_END_MIN = 5 * 60

NY_AM_START_MIN = 7 * 60
NY_AM_END_MIN = 10 * 60

NY_PM_START_MIN = 13 * 60 + 30
NY_PM_END_MIN = 16 * 60

SB_WINDOW_1_START = 3 * 60
SB_WINDOW_1_END = 4 * 60
SB_WINDOW_2_START = 10 * 60
SB_WINDOW_2_END = 11 * 60
SB_WINDOW_3_START = 14 * 60
SB_WINDOW_3_END = 15 * 60

MW_WINDOW_1_START = 9 * 60 + 50
MW_WINDOW_1_END = 10 * 60 + 10
MW_WINDOW_2_START = 2 * 60 + 33
MW_WINDOW_2_END = 3 * 60
MW_WINDOW_3_START = 4 * 60 + 3
MW_WINDOW_3_END = 4 * 60 + 30

ET_TIMEZONE = "America/New_York"

KILLZONE_NAMES: tuple[str, ...] = ("london", "ny_am", "ny_pm", "silver_bullet", "macro_window")

# W23F.N lunch blackout + PM taper reference windows (CLAUDE.md §13) — NOT part
# of the 5 canonical killzones, and (since the orphan-zone closure, see
# REFUSED_SESSION_KEYWORDS below) NOT reachable from the spec-vocabulary binding
# surface either. They remain here, unused by `_ZONE_CHECKS`, because THE BRIDGE
# IS NOT BURNED: if a future corpus ever teaches lunch-avoidance or a defensible
# overnight clock, covering those zones becomes a small demand-justified packet
# and these constants are what it would build on.
#
# ★ `OVERNIGHT_END_MIN` IS NOT A MINUTE-OF-DAY (it is 1860 = 24*60 + 420). Any
# predicate that compares it to `_to_et_minutes_of_day()`'s [0,1440) output
# silently drops more than half the intended window. That is one of the reasons
# `overnight` was refused rather than covered — see the refusal note below.
LUNCH_BLACKOUT_START_MIN = 11 * 60 + 30
LUNCH_BLACKOUT_END_MIN = 13 * 60 + 30
OVERNIGHT_START_MIN = 18 * 60          # Globex session open (18:00 ET)
OVERNIGHT_END_MIN = 24 * 60 + NY_AM_START_MIN  # wraps past midnight — handled specially


def _to_et_minutes_of_day(timestamp_utc: datetime) -> float | None:
    """Convert a UTC datetime to ET wall-clock minutes-of-day. None on invalid input.

    Mirrors killzone.ts::toEtMinutesOfDay — Intl.DateTimeFormat there,
    zoneinfo here. Both are IANA-tzdata-backed so DST transitions agree.
    """
    if timestamp_utc is None:
        return None
    try:
        if timestamp_utc.tzinfo is None:
            timestamp_utc = timestamp_utc.replace(tzinfo=UTC)
        et = timestamp_utc.astimezone(ZoneInfo(ET_TIMEZONE))
        return et.hour * 60 + et.minute + et.second / 60.0
    except Exception:  # noqa: BLE001 — never throws, mirrors TS contract
        return None


def _is_london(et_min: float) -> bool:
    return LONDON_START_MIN <= et_min < LONDON_END_MIN


def _is_ny_am(et_min: float) -> bool:
    return NY_AM_START_MIN <= et_min < NY_AM_END_MIN


def _is_ny_pm(et_min: float) -> bool:
    return NY_PM_START_MIN <= et_min < NY_PM_END_MIN


def _is_silver_bullet(et_min: float) -> bool:
    return (
        (SB_WINDOW_1_START <= et_min < SB_WINDOW_1_END)
        or (SB_WINDOW_2_START <= et_min < SB_WINDOW_2_END)
        or (SB_WINDOW_3_START <= et_min < SB_WINDOW_3_END)
    )


def _is_macro_window(et_min: float) -> bool:
    return (
        (MW_WINDOW_1_START <= et_min < MW_WINDOW_1_END)
        or (MW_WINDOW_2_START <= et_min < MW_WINDOW_2_END)
        or (MW_WINDOW_3_START <= et_min < MW_WINDOW_3_END)
    )


_ZONE_CHECKS = {
    "london": _is_london,
    "ny_am": _is_ny_am,
    "ny_pm": _is_ny_pm,
    "silver_bullet": _is_silver_bullet,
    "macro_window": _is_macro_window,
}


def is_in_killzone(timestamp_utc: datetime, zone: str) -> bool:
    """Mirrors killzone.ts::isInKillzone. Never raises; unknown zone -> False."""
    et_min = _to_et_minutes_of_day(timestamp_utc)
    if et_min is None:
        return False
    check = _ZONE_CHECKS.get(zone)
    return bool(check(et_min)) if check else False


def active_killzones(timestamp_utc: datetime) -> list[str]:
    """Mirrors killzone.ts::activeKillzones."""
    et_min = _to_et_minutes_of_day(timestamp_utc)
    if et_min is None:
        return []
    return [name for name in KILLZONE_NAMES if _ZONE_CHECKS[name](et_min)]


def is_in_any_killzone(timestamp_utc: datetime) -> bool:
    """Mirrors killzone.ts::isInAnyKillzone."""
    return len(active_killzones(timestamp_utc)) > 0


def is_in_lunch_blackout(timestamp_utc: datetime) -> bool:
    """W23F.N lunch dead-zone (11:30-13:30 ET) — CLAUDE.md §13 canonical window."""
    et_min = _to_et_minutes_of_day(timestamp_utc)
    if et_min is None:
        return False
    return LUNCH_BLACKOUT_START_MIN <= et_min < LUNCH_BLACKOUT_END_MIN


# ─── Keyword -> zone resolution (spec-vocabulary binding surface) ─────────────
#
# WAIT_SESSION condition `object` text is natural language ("pre market vwap
# analysis routine", "institutional participation", "information events").
# Deliberately narrow and conservative, matching spec-archetype-matcher.ts's
# philosophy: a miss is honest (unbindable), a false-positive silently binds
# the WRONG session window (dangerous). Only unambiguous session vocabulary
# gets an entry.
#
# ★ EVERY KEY OF THIS TABLE MUST BE A KEY OF `_ZONE_CHECKS`. That invariant is
# the whole point of the orphan-zone closure (packet-orphan-zone-closure-
# 2026-07-21.md) and is enforced at load time by
# family_meta_enforcement.verify_emit_subset_covered() pin (b2). A zone name
# this table can emit but `is_in_killzone` cannot check is an ALWAYS-FALSE gate
# wearing `bindable=True, approximation=False` — a value nothing can evaluate.
SESSION_KEYWORDS: dict[str, tuple[str, ...]] = {
    "london": ("london session", "london open", "london killzone"),
    "ny_am": ("ny am", "new york am", "new york morning", "ny morning", "ny open", "am session"),
    "ny_pm": ("ny pm", "new york pm", "new york afternoon", "ny afternoon", "pm session"),
    "silver_bullet": ("silver bullet",),
    "macro_window": ("macro window", "macro release"),
}

# ─── REFUSED session vocabulary (orphan-zone closure, Option A) ──────────────
#
# These phrases USED to resolve to `lunch_blackout` / `overnight`, which
# `_ZONE_CHECKS` never covered — so `is_in_killzone()` returned False for all
# 1,440 minutes of every day while the binding plan advertised
# `bindable=True, approximation=False, executed=True`.
#
# They are REFUSED, not silently deleted: `refused_session_zone()` still
# recognizes them and names WHY, so a reader (and §6a's unbound accounting)
# can tell "we saw this teaching and have no honest primitive for it" apart
# from "we never recognized it at all."
#
# WHY REFUSED RATHER THAN COVERED, on the data:
#   - Effective demand is ZERO. Over the 16-spec / 27-WAIT_SESSION corpus,
#     `lunch_blackout` binds 0 conditions and `overnight` binds exactly 1 —
#     `role=confluence`, proven never evaluated.
#   - `overnight`'s own keyword list bundles clocks that do not intersect
#     into one interval (Globex open, Asia session, and US pre-market are
#     three different windows), three conflicting definitions of "overnight"
#     already live in this repo, and OVERNIGHT_END_MIN is not a
#     minute-of-day. Picking one silently would be fabricated precision, and
#     fabricated precision PROBES CLEAN.
REFUSED_SESSION_KEYWORDS: dict[str, tuple[str, ...]] = {
    "lunch_blackout": ("lunch", "midday", "noon session"),
    "overnight": ("overnight", "globex", "asia session", "pre market", "premarket"),
}


def _phrase_hit(object_text: str, keywords: tuple[str, ...]) -> bool:
    norm = f" {object_text.strip().lower()} "
    return any(
        f" {kw} " in norm or norm.strip().startswith(kw) or norm.strip().endswith(kw)
        for kw in keywords
    )


def resolve_session_keyword(object_text: str) -> str | None:
    """Best-effort session-window resolution from a WAIT_SESSION condition's
    natural-language `object` field. Returns None (unbindable) on no match —
    never guesses. Mirrors the conservative-match philosophy of
    spec-archetype-matcher.ts::matchArchetype.

    Only ever returns a zone `_ZONE_CHECKS` can evaluate; see
    REFUSED_SESSION_KEYWORDS for the phrases deliberately NOT resolved.
    """
    if not object_text:
        return None
    for zone, keywords in SESSION_KEYWORDS.items():
        if _phrase_hit(object_text, keywords):
            return zone
    return None


def refused_session_zone(object_text: str) -> str | None:
    """The refused zone name a phrase WOULD have resolved to before the
    orphan-zone closure, or None. Never a binding — only a reason."""
    if not object_text:
        return None
    for zone, keywords in REFUSED_SESSION_KEYWORDS.items():
        if _phrase_hit(object_text, keywords):
            return zone
    return None
