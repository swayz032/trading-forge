from pathlib import Path


def _js() -> str:
    return Path("research/current_mnq_strategy_v2_4_replay_lab_v3_enhance.js").read_text()


def test_v3_desktop_enhancement_projects_drawings_focuses_recent_and_uses_ny_wall_clock():
    js = _js()
    assert "paintLayer(ov15, c15, l.trader_zones, null)" in js
    assert "paintLayer(ov5, c5, l.trader_zones, l.trader_tp_reaction_cluster)" in js
    assert "paintLayer(ov1, c1, l.trader_zones, l.trader_tp_reaction_cluster)" in js
    assert "focusRecent(c15, 72)" in js
    assert "focusRecent(c5, 84)" in js
    assert "focusRecent(c1, 60)" in js
    assert "Date.UTC" in js
    assert "09:47-04:00 is displayed as 09:47" in js
    assert "setData(false)" in js
    for forbidden in ("bot_action", "bot_relevant_zones", "bot_tp_reaction_cluster", "net_pnl"):
        assert forbidden not in js


def test_v3_one_scenario_has_one_final_trade_and_same_minute_wait_is_deduplicated():
    js = _js()
    assert "if (l.final_action) return;" in js
    assert "sameMinuteWait.force = currentForce" in js
    assert "l.decision_timeline.push({time: now, action: 'WAIT', force: currentForce})" in js
    assert "l.first_entry_time = now" in js
    assert "RESET DECISION" in js
    assert "l.decision_timeline = []" in js
    assert "document.querySelectorAll('[data-action],[data-force]')" in js
    assert "b.disabled = locked" in js
    assert "Replay ${l.reveal_count}/${cur().replay_1m.length} min" in js
