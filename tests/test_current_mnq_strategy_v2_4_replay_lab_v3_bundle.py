from pathlib import Path

from research.current_mnq_strategy_v2_4_replay_lab_v3_bundle import bundle


def test_v3_bundle_inlines_required_browser_runtimes_unified_controls_and_storage_fallback(tmp_path):
    html = tmp_path / "review_v3.html"
    lwc = tmp_path / "lightweight-charts.standalone.production.js"
    enhance = tmp_path / "replay_v3_enhance.js"
    html.write_text(
        '<html><head><script src="lightweight-charts.standalone.production.js"></script>'
        '<style>.overlay{position:absolute;inset:0;z-index:5;pointer-events:none}</style></head>'
        '<body><script>'
        "const storeKey='mnq-replay-v3:'+pack.pack_id;"
        "let saved=JSON.parse(localStorage.getItem(storeKey)||'{}');"
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
        "  panel5.appendChild(mainTools);\n"
        "  function setMainTf(tf) {\n"
        "    mainTf = tf;\n"
        "    document.getElementById('main5m').classList.toggle('active', tf === '5m');\n"
        "    document.getElementById('main15m').classList.toggle('active', tf === '15m');\n"
        "    refreshMain(false);\n"
        "    focusDecisionArea();\n"
        "  }\n"
        "  function zoomMain(multiplier) {\n"
        "    const scale = main.chart.timeScale();\n"
        "    const r = scale.getVisibleLogicalRange();\n"
        "    if (!r) {\n"
        "      scale.fitContent();\n"
        "      return;\n"
        "    }\n"
        "    const mid = (r.from + r.to) / 2;\n"
        "    const half = Math.max(4, (r.to - r.from) * multiplier / 2);\n"
        "    scale.setVisibleLogicalRange({from: mid - half, to: mid + half});\n"
        "  }\n"
        "  document.getElementById('main5m').onclick = () => setMainTf('5m');\n"
        "  document.getElementById('main15m').onclick = () => setMainTf('15m');\n"
        "  document.getElementById('mainZoomOut').onclick = () => zoomMain(1.55);\n"
        "  document.getElementById('mainZoomIn').onclick = () => zoomMain(0.68);\n"
        "  document.getElementById('mainFit').onclick = () => { main.chart.timeScale().fitContent(); drawOverlays(); };\n"
        "  drawZone.onclick = () => beginDraw('main-zone', ov5);\n"
        "  drawTp.onclick = () => beginDraw('main-tp', ov5);\n"
        "setData = function (fit) {\n"
        "    refreshMain(Boolean(fit));\n"
        "    renderClock();\n"
        "  };\n"
        "  drawOverlays();\n"
        "})();\n",
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
    assert "REPLAY_STORAGE_DISABLED_USING_MEMORY" in out
    assert "JSON.parse(localStorage.getItem(storeKey)" not in out
    assert "function save(){localStorage.setItem" not in out
    assert "try{saved=JSON.parse(window.localStorage.getItem(storeKey)||'{}')}" in out
    assert "if(!storageAvailable)return" in out
    assert "const TICK=0.25;" in out
    assert "width:100%;height:100%;z-index:5;pointer-events:none" in out
    assert "renderClock();\n    renderLabels();\n    updateMainControlStatus('REPLAY');" in out
    assert "MNQ_CONTROLS_READY" in out
    assert "updateMainControlStatus('TIMEFRAME')" in out
    assert "updateMainControlStatus(multiplier > 1 ? 'ZOOM OUT' : 'ZOOM IN')" in out
    assert "updateMainControlStatus('FIT ALL')" in out
    assert "subscribeVisibleLogicalRangeChange" in out
    assert "addEventListener('click', () => setMainTf('15m'))" in out
    assert "panel5.scrollIntoView({behavior: 'auto', block: 'center'})" in out
    assert "drawZone.onclick = () => revealMainForDraw('main-zone')" in out
    assert "drawTp.onclick = () => revealMainForDraw('main-tp')" in out


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
