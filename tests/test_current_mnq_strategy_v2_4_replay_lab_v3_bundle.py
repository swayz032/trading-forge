from pathlib import Path

from research.current_mnq_strategy_v2_4_replay_lab_v3_bundle import bundle


def test_v3_bundle_inlines_required_browser_runtimes_unified_controls_and_storage_fallback(tmp_path):
    html = tmp_path / "review_v3.html"
    lwc = tmp_path / "lightweight-charts.standalone.production.js"
    enhance = tmp_path / "replay_v3_enhance.js"
    html.write_text(
        '<html><head><script src="lightweight-charts.standalone.production.js"></script></head>'
        '<body><script>'
        "const storeKey='k';let saved=JSON.parse(localStorage.getItem(storeKey)||'{}');"
        "let idx=saved.idx||0;let labels=saved.labels||{};"
        "function save(){localStorage.setItem(storeKey,JSON.stringify({idx,labels}))}"
        '</script><script src="replay_v3_enhance.js"></script></body></html>',
        encoding="utf-8",
    )
    lwc.write_text("window.LightweightCharts={};", encoding="utf-8")
    enhance.write_text(
        "if (l.final_action) return; /* RESET DECISION */\n"
        "/* Main Structure / Key Zones + TP Reaction Cluster */\n"
        "/* 15m CONTEXT · − ZOOM OUT · MOVE_AWAY_REJECTION_ORIGIN */\n"
        "drawZone.onclick = () => beginDraw('main-zone', ov5);\n"
        "drawTp.onclick = () => beginDraw('main-tp', ov5);\n",
        encoding="utf-8",
    )
    out = bundle(html, lwc, enhance)
    assert 'src="lightweight-charts.standalone.production.js"' not in out
    assert 'src="replay_v3_enhance.js"' not in out
    assert "window.LightweightCharts={};" in out
    assert "RESET DECISION" in out
    assert "if (l.final_action) return;" in out
    assert "Main Structure / Key Zones + TP Reaction Cluster" in out
    assert "MOVE_AWAY_REJECTION_ORIGIN" in out
    assert "beginDraw('main-zone', ov5)" in out
    assert "beginDraw('main-tp', ov5)" in out
    assert "REPLAY_STORAGE_DISABLED_USING_MEMORY" in out
    assert "JSON.parse(localStorage.getItem(storeKey)" not in out
    assert "function save(){localStorage.setItem" not in out
    assert "try{saved=JSON.parse(window.localStorage.getItem(storeKey)||'{}')}" in out
    assert "if(!storageAvailable)return" in out


def test_v3_generator_explicitly_excludes_all_prior_v2_review_sessions():
    text = Path("research/current_mnq_strategy_v2_4_replay_lab_v3_generate.py").read_text()
    for session in (
        "2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26",
        "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02",
    ):
        assert session in text
    assert "PRIOR_V2_REVIEW_SESSIONS" in text
    assert "REPLAY_V3_PRIOR_SESSION_REUSE" in text
    assert '"prior_v2_session_overlap_count": 0' in text
