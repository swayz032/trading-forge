from pathlib import Path
import re

PINE = Path(__file__).parents[1] / "pine" / "slumdawg_platform_parity_v0_9_trendline_family.pine"
SRC = PINE.read_text()


def test_identity_and_safety_gate():
    assert 'indicator("Slumdawg traders indicator"' in SRC
    assert 'const bool LIVE_DECISION_SUPPORT_APPROVED = false' in SRC
    assert 'PLATFORM_PARITY_ONLY' in SRC


def test_event_sourced_freeze_not_old_recapture_counter():
    assert 'boardFreezeTime = input.time(' in SRC
    assert 'confirm = true' in SRC
    assert 'freezeEvent = not boardInitialized' in SRC
    assert 'trendlineSet' not in SRC


def test_all_ten_line_visibility_controls_exist():
    for token in [
        'showDGreen', 'showDRed', 'show4HGreen', 'show4HRed', 'show1HGreen',
        'show1HRed', 'show15MGreen', 'show15MRed', 'show5MGreen', 'show5MRed'
    ]:
        assert f'bool {token} = input.bool(true' in SRC


def test_child_geometry_is_parent_b_to_child_a():
    assert 'int aT = pBT' in SRC
    assert 'float aP = pBP' in SRC
    assert 'f_child(' in SRC
    assert 'distinctPath' in SRC


def test_selective_repair_events_and_later_b_guard():
    for n in (1, 2, 3):
        assert f'repair{n}Enabled = input.bool(false' in SRC
        assert f'repair{n}Time = input.time(' in SRC
    assert 'minBExclusive' in SRC
    assert 'bool afterOld = na(minBExclusive)' in SRC
    assert '// SELECTIVE REPAIR EVENTS. Valid lines are never assigned inside this block.' in SRC


def test_violation_uses_each_source_timeframe_confirmed_close():
    for tf in ['"D"', '"240"', '"60"', '"15"', '"5"']:
        pat = rf'request\.security\(syminfo\.tickerid, {tf}, \[close\[1\], time_close\[1\]\], lookahead = barmerge\.lookahead_on\)'
        assert re.search(pat, SRC), tf
    assert 'violationCloses = input.int(2' in SRC
    assert 'nextViolated := true' in SRC


def test_tuple_outputs_are_declared_then_scalar_reassigned():
    assert '] :=' not in SRC
    assert '[nextDGBreach, nextDGViolated] = f_violation' in SRC
    assert 'dGBreach := nextDGBreach' in SRC


def test_d_w_lines_full_span_and_hidden_geometry_is_na():
    assert 'extend = extend.both' in SRC
    assert 'line.set_extend(id, fullSpan ? extend.both : extend.right)' in SRC
    assert 'line.set_xy1(id, na, na)' in SRC
    assert 'line.set_xy2(id, na, na)' in SRC


def test_no_timeframe_labels_are_attached_to_trendline_rays():
    assert 'f_sync_trend(line id, bool valid, bool visible, int aT, float aP, int bT, float bP, color c)' in SRC
    trend_fn = SRC.split('f_sync_trend(line id', 1)[1].split('bool goSet', 1)[0]
    assert 'label.' not in trend_fn
    assert 'D GREEN' not in trend_fn
    assert '5M GREEN' not in trend_fn


def test_violated_lines_stay_drawn_but_are_not_next_walls():
    assert 'violated lines stay visible but are not walls' in SRC
    assert 'not dRViolated' in SRC
    assert 'not dGViolated' in SRC
    draw = SRC.split('if barstate.islast', 1)[1].split('bool targetVisible', 1)[0]
    assert 'dGViolated' not in draw
    assert 'dRViolated' not in draw


def test_request_limits_have_headroom():
    assert SRC.count('request.security(') == 14
    assert 'Combined request tuple count remains under Pine' in SRC


def test_research_guards_are_explicit_not_certified():
    assert 'Research/calibration value. Not production-certified.' in SRC
    assert 'Slumdawg robustness layer, not attributed to the external trendline teaching.' in SRC
