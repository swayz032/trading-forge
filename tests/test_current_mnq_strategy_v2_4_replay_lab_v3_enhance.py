from pathlib import Path


def test_v3_desktop_enhancement_projects_drawings_focuses_recent_and_uses_ny_wall_clock():
    js = Path("research/current_mnq_strategy_v2_4_replay_lab_v3_enhance.js").read_text()
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
