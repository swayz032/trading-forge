"""T3 red-proofs — `touch with mixed/doji control -> WAIT_OR_NO_TRADE`. S3 step 2.

THE TAUGHT CLAUSE, verbatim, `video_evidence.md:113` (Explicit refusals):

    "touch with mixed/doji control -> WAIT_OR_NO_TRADE"

restated at `video_evidence.md:82` and `engineer_onboarding.md:61`:

    "Directional control/defense/hold must confirm; a doji reclaim alone is not an A+ trade."

THE COMMITTED FORMALIZATION (`..._t3_formalization_2026_08_26.md`, committed at `abce4155`
BEFORE any census or guard number was read). T3 refuses iff, on the COMPLETED bar the story is
read on:

    MIXED                  = body < upper_wick AND body < lower_wick
    NO_DIRECTIONAL_CONTROL = close <= (high+low)/2 for a LONG   (mirrored for a SHORT)

OHLC against OHLC. No constant, no fraction, no threshold. Every decimal in this file is either
a FIXTURE PRICE or a citation of a RETIRED magnitude (`0.62`, `0.78`, `0.35`) named only to
identify what T3 replaces.

WHY THESE FIXTURES AND NOT OTHERS. Two of them are the ones that could REFUTE T3 rather than
confirm it, and they are here deliberately: the HAMMER and the ALGO-071 §5.3 clean thin-wick
rejection must PASS. A control gate that refuses the archetypal rejection candle would contradict
T5 and `_rejection_wick`, and no guard number could rescue it.

No PnL, realized outcome, winner/loser label or clean-edge result is read anywhere.
"""
from __future__ import annotations

import pandas as pd

from research import current_mnq_strategy_v2_4_derivation as D

TZ = "America/New_York"
LO, HI = 100.0, 102.0
#: Retired magnitudes, cited so the signatures still line up. T3 does not read them.
BODY, CLOSE_LOC, WICK = 0.62, 0.78, 0.35


def bars(rows):
    idx = pd.date_range("2026-04-09 10:00", periods=len(rows), freq="5min", tz=TZ)
    return pd.DataFrame(
        {"open": [r[0] for r in rows], "high": [r[1] for r in rows],
         "low": [r[2] for r in rows], "close": [r[3] for r in rows]}, index=idx)


AWAY = (110.0, 111.0, 109.0, 110.0)          # wholly above: gives a real approach
APPROACH = (109.0, 110.0, 103.0, 104.0)


def _story(control_bar, trigger=(103.2, 104.0, 103.1, 103.9)):
    """The story read on [AWAY, APPROACH, control_bar] with `control_bar` LAST COMPLETED."""
    return D.derive_story(bars([AWAY, APPROACH, control_bar, trigger]), "L",
                          LO, HI, BODY, CLOSE_LOC, WICK)


def _t3_refuses(bar, direction="L") -> bool:
    """The committed clause, evaluated directly on OHLC. Used to PIN the fixtures."""
    o, h, l, c = (float(x) for x in bar)
    body = abs(c - o)
    upper = h - max(o, c)
    lower = min(o, c) - l
    mixed = bool(body < upper and body < lower)
    mid = (h + l) / 2.0
    no_control = bool(c <= mid) if direction == "L" else bool(c >= mid)
    return bool(mixed or no_control)


# ─────────────────────────────────────────────────────────────────────────────────────────
# THE FIXTURES. Each is pinned against the committed clause BEFORE it is used, so a fixture
# that stopped matching its own description would fail loudly instead of quietly proving
# something else.
# ─────────────────────────────────────────────────────────────────────────────────────────

#: EVERY FIXTURE CLOSES BACK OUT OF THE BAND ON THE NEAR SIDE (close > hi for a long), so R2's
#: rejection rule and R2b's indecision rule BOTH pass them and the only thing left to decide
#: them is CONTROL QUALITY. My first draft did not do this: the bars closed INSIDE the band, so
#: R2b refused them outright and the tests would have 'proved' T3 while actually exercising R2b.
#: A fixture that is decided by a different clause proves nothing about this one.

#: DOJI control: closed out on the near side, but the body is dwarfed by BOTH wicks.
DOJI = (102.6, 104.0, 99.0, 102.5)

#: MIXED control: closed out on the near side, both wicks enormous, body negligible - the
#: taught `mixed_overlap_and_two_sided_wicks` picture.
MIXED = (102.4, 112.0, 92.0, 102.6)

#: HAMMER / pin: long lower wick, SMALL upper wick, decisive close out on the near side.
#: THE ARCHETYPAL REJECTION - it must PASS, and it is the fixture that refutes an over-strict
#: T3 (this is why `C2 = body < max(wick)` was rejected on teaching grounds).
HAMMER = (102.5, 103.0, 97.0, 102.8)

#: ALGO-071 §5.3 fixture 1 - the operator's own clean thin-wick rejection. Must PASS.
CLEAN_REJECTION = (101.6, 103.5, 101.5, 103.2)


def test_T3_fixtures_match_their_own_descriptions():
    """PIN THE FIXTURES FIRST. A fixture that drifts proves whatever it drifted into."""
    # ISOLATION: every fixture must close OUT of the band on the near side, so neither R2 nor
    # R2b decides it and CONTROL QUALITY is the only thing left. Asserted, not assumed.
    for name, bar in (("DOJI", DOJI), ("MIXED", MIXED),
                      ("HAMMER", HAMMER), ("CLEAN_REJECTION", CLEAN_REJECTION)):
        assert float(bar[3]) > HI, f"{name} must close OUT of the band, else R2b decides it"
        assert float(bar[2]) <= HI, f"{name} must have traded INTO the band"
    assert _t3_refuses(DOJI) is True, "DOJI fixture must be refused by the committed clause"
    assert _t3_refuses(MIXED) is True, "MIXED fixture must be refused by the committed clause"
    assert _t3_refuses(HAMMER) is False, "HAMMER must NOT be refused - it is the taught rejection"
    assert _t3_refuses(CLEAN_REJECTION) is False, "the §5.3 clean rejection must NOT be refused"


def test_T3_refuses_a_doji_control_touch():
    """RED-PROOF. `touch with mixed/doji control -> WAIT_OR_NO_TRADE` (video_evidence.md:113)."""
    s = _story(DOJI)
    assert s.complete is False, f"a doji-control touch must not complete the story: {s}"


def test_T3_refuses_a_mixed_control_touch():
    """RED-PROOF. The 'mixed' half of the same taught refusal."""
    s = _story(MIXED)
    assert s.complete is False, f"a mixed-control touch must not complete the story: {s}"


def test_T3_does_NOT_refuse_the_hammer():
    """THE REFUTING FIXTURE. A rejection wick is large BY DEFINITION.

    This is why `C2 = body < max(wick)` was rejected in the formalization on teaching grounds:
    it fires on exactly the shape `_rejection_wick` and T5 exist to ACCEPT. If T3 ever starts
    refusing this bar, T3 is wrong - no guard number can rescue it.
    """
    assert _t3_refuses(HAMMER) is False
    s = _story(HAMMER)
    assert s.complete is True, f"the archetypal rejection candle must survive T3: {s}"


def test_T3_does_NOT_refuse_the_ALGO_071_clean_rejection():
    """THE SECOND REFUTING FIXTURE — ALGO-071 §5.3 fixture 1, the operator's own definition."""
    assert _t3_refuses(CLEAN_REJECTION) is False
    s = _story(CLEAN_REJECTION)
    assert s.complete is True, f"the §5.3 clean rejection must survive T3: {s}"


def test_T3_introduces_no_magnitude():
    """The clause must be OHLC against OHLC. A constant here is the whole failure again."""
    import ast
    import inspect

    # F-2 (ALGO-100A): scan the AST, not text. A LINE scan reads only one physical line and
    # misses a fraction planted in the other branch; a TEXT scan reads comments and
    # docstrings, which is how this very test first failed - it found `body_frac` inside a
    # docstring CITING the retired magnitude and called it a new one. The distinction that
    # matters is executable code vs prose, and only a parser can draw it.
    tree = ast.parse(inspect.getsource(D))
    fn = next((n for n in ast.walk(tree)
               if isinstance(n, ast.FunctionDef) and n.name == "_t3_control"), None)
    if fn is None:
        return  # not landed yet; the behavioural red-proofs above carry the burden

    body = list(fn.body)
    if (body and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)):
        body = body[1:]          # drop the docstring: prose is not code

    names, numbers = set(), []
    for stmt in body:
        for node in ast.walk(stmt):
            if isinstance(node, ast.Name):
                names.add(node.id)
            elif isinstance(node, ast.Attribute):
                names.add(node.attr)
            elif isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
                if not isinstance(node.value, bool):
                    numbers.append(node.value)

    for token in ("body_frac", "close_loc", "reject_wick", "min_each", "max_body",
                  "range_ratio", "min_wick"):
        assert token not in names, f"T3 must introduce no magnitude; found {token!r} in code"

    # The ONLY numeric literal T3 may contain is the midpoint divisor. It is not a threshold:
    # it has no free parameter and no search range - `(high+low)/2` is the bar's own centre.
    assert set(numbers) <= {2, 2.0}, f"T3 must contain no numeric threshold; found {numbers}"


def test_T3_tie_convention_close_exactly_at_the_midpoint_REFUSES():
    """ALGO-100C: the tie must be STATED and TESTED, not left to the operator `<` vs `<=`.

    A close sitting exactly on the bar's own centre has resolved nothing - that is the
    definition of indecision, so it REFUSES. `_t3_control` uses a strict `>` for a long
    (mirrored `<` for a short), which is the same convention read from the other side.
    """
    # ISOLATION, again: every bar here must NOT be MIXED, or MIXED decides it and the tie
    # convention is never exercised. My first draft got this wrong the same way the DOJI
    # fixtures did - the bar was refused for a different reason and the test looked green
    # for the wrong clause. Each fixture asserts `not mixed` before asserting the verdict.
    def _mixed(bar):
        o, h, l, c = (float(x) for x in bar)
        return abs(c - o) < (h - max(o, c)) and abs(c - o) < (min(o, c) - l)

    # midpoint of [104, 100] is 102.0; the close sits EXACTLY there.
    exactly_mid_long = (100.5, 104.0, 100.0, 102.0)
    assert (exactly_mid_long[1] + exactly_mid_long[2]) / 2.0 == exactly_mid_long[3]
    assert not _mixed(exactly_mid_long), "must not be MIXED, or MIXED decides it"
    assert _t3_refuses(exactly_mid_long, "L") is True, "a close ON the midpoint decides nothing"

    exactly_mid_short = (103.5, 104.0, 100.0, 102.0)
    assert not _mixed(exactly_mid_short)
    assert _t3_refuses(exactly_mid_short, "S") is True, "mirrored for a short"

    # One tick the RIGHT side of the midpoint resolves it, so the convention is a
    # boundary rather than a blanket refusal.
    just_above = (100.5, 104.0, 100.0, 102.25)
    just_below = (103.5, 104.0, 100.0, 101.75)
    assert not _mixed(just_above) and not _mixed(just_below)
    assert _t3_refuses(just_above, "L") is False
    assert _t3_refuses(just_below, "S") is False


def test_F1_the_geometry_token_fires_exactly_when_progress_is_absent():
    """F-1 (ALGO-100A): the token must name a clause that can actually fire.

    After F1's removal `geometry` is out of the `confirmed` conjunction, so the risk is a
    refusal reason that labels nothing. It stays honest because `geometry` is `c > o`, which
    is `progress > 0` — the FIRST CONJUNCT of `efficient`, which does gate. This pins that
    equivalence at the executable level rather than asserting it in a comment.
    """
    from research import current_mnq_strategy_v2_4_force as F
    one = pd.DataFrame(
        {"open": [101.0, 99.5], "high": [101.2, 99.8],
         "low": [99.0, 98.0], "close": [99.5, 98.5]},
        index=pd.date_range("2026-04-09 10:00", periods=2, freq="1min", tz=TZ))
    start = pd.Timestamp("2026-04-09 10:00", tz=TZ)
    from research import current_mnq_strategy_v2_4_engine as eng
    snap = F.force_snapshot(one, start, 5, "L", start + pd.Timedelta(minutes=2), eng.Params())
    assert snap.directional_progress <= 0, "fixture must have NO directional progress"
    assert snap.partial_momentum_geometry is False
    assert snap.reason == "PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN", (
        f"the token must name the absent-progress clause, got {snap.reason}")


#: NOT mixed (body 3.5 >= lower wick 0.5), closes OUT of the band at 103 > hi, but BELOW its
#: own midpoint 104.5. So R2 calls it a rejection, R2b passes it, MIXED does not fire, and the
#: ONLY thing that can refuse it is the DIRECTIONAL half of T3.
NO_CONTROL_OUT = (99.5, 110.0, 99.0, 103.0)


def test_T3_refuses_a_bar_that_closed_out_but_took_NO_DIRECTIONAL_CONTROL():
    """The DIRECTIONAL half, isolated at the STORY level — against the production clause.

    A mutation battery found D4 (`directional = True`) and D5 (the tie flipped to `>=`) going
    0 RED: the tie test was asserting this file's own `_t3_refuses` reimplementation, so
    mutating the production predicate could not move it. A test that checks a copy of the code
    pins the copy. These assertions call `D._t3_control` and `D.derive_story` directly.
    """
    o, h, l, c = NO_CONTROL_OUT
    assert c > HI, "must close OUT of the band, else R2b decides it"
    assert not (abs(c - o) < (h - max(o, c)) and abs(c - o) < (min(o, c) - l)), \
        "must NOT be MIXED, else MIXED decides it and DIRECTIONAL is never exercised"
    assert c <= (h + l) / 2.0, "must close below its own midpoint"

    row = bars([NO_CONTROL_OUT]).iloc[0]
    assert D._t3_control(row, "L") is False, "production clause must refuse: no control taken"

    s = _story(NO_CONTROL_OUT)
    assert s.complete is False, f"a bar that took no directional control must refuse: {s}"


def test_T3_tie_convention_holds_in_the_PRODUCTION_clause():
    """The tie, asserted against `D._t3_control` rather than this file's local helper."""
    exactly_mid_long = (100.5, 104.0, 100.0, 102.0)
    exactly_mid_short = (103.5, 104.0, 100.0, 102.0)
    just_above = (100.5, 104.0, 100.0, 102.25)
    just_below = (103.5, 104.0, 100.0, 101.75)

    assert D._t3_control(bars([exactly_mid_long]).iloc[0], "L") is False, \
        "a close exactly ON the midpoint decided nothing — it must REFUSE"
    assert D._t3_control(bars([exactly_mid_short]).iloc[0], "S") is False
    assert D._t3_control(bars([just_above]).iloc[0], "L") is True
    assert D._t3_control(bars([just_below]).iloc[0], "S") is True
