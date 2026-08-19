from pathlib import Path


def _js() -> str:
    return Path("research/current_mnq_strategy_v2_4_replay_lab_v3_enhance.js").read_text()


def test_v3_unifies_structure_and_tp_on_one_main_chart_with_zoomable_context():
    js = _js()
    assert "panel15.style.display = 'none'" in js
    assert "Main Structure / Key Zones + TP Reaction Cluster" in js
    assert "const main = mk('chartMain')" in js
    assert "paintLayer(ov5, main, l.trader_zones, l.trader_tp_reaction_cluster)" in js
    assert "paintLayer(ov1, c1, l.trader_zones, l.trader_tp_reaction_cluster)" in js
    assert "15m CONTEXT" in js
    assert "− ZOOM OUT" in js
    assert "+ ZOOM IN" in js
    assert "FIT ALL" in js
    assert "handleScroll: {mouseWheel: true" in js
    assert "handleScale: {axisPressedMouseMove: true, mouseWheel: true, pinch: true}" in js
    assert "cur().context_15m" in js
    assert "cur().context_5m" in js
    assert "focusRecent(main, mainTf === '15m' ? 112 : 96)" in js
    assert "focusRecent(c1, 60)" in js
    assert "Date.UTC" in js
    assert "09:47 rather than 13:47" in js
    for forbidden in ("bot_action", "bot_relevant_zones", "bot_tp_reaction_cluster", "net_pnl"):
        assert forbidden not in js


def test_v3_zone_capture_records_how_trader_found_the_level_on_same_main_chart():
    js = _js()
    assert "VISIBLE_REJECTION" in js
    assert "ZOOMED_OUT_HIGHER_LOWER" in js
    assert "MOVE_AWAY_REJECTION_ORIGIN" in js
    assert "source_method: zoneMethod.value" in js
    assert "marked_time: replayTime()" in js
    assert "marked_main_timeframe: mainTf" in js
    assert "drawZone.onclick = () => beginDraw('main-zone', ov5)" in js
    assert "drawTp.onclick = () => beginDraw('main-tp', ov5)" in js
    assert "main.series.coordinateToPrice" in js
    assert "If the next level is off-screen" in js
    assert "after price moves away hard" in js


def test_v3_price_drawings_reproject_after_zoom_pan_and_click_sets_exact_tp_level():
    js = _js()
    assert "const DRAW_TICK = 0.25" in js
    assert "function snapToTick(price)" in js
    assert "function scheduleOverlaySync()" in js
    assert "requestAnimationFrame(() =>" in js
    assert "main.chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleOverlaySync)" in js
    assert "panel5.addEventListener('wheel', scheduleOverlaySync" in js
    assert "panel5.addEventListener('pointermove', scheduleOverlaySync" in js
    assert "panel5.addEventListener('pointerup', scheduleOverlaySync" in js
    assert "function pointerY(e)" in js
    assert "e.clientY - r.top" in js
    assert "const dragPixels = Math.abs(endY - mainDragY)" in js
    assert "dragPixels <= 4" in js
    assert "TRADER_TP_LEVEL_CLICK" in js
    assert "TRADER_REACTION_CLUSTER_DRAG" in js
    assert "tp.lo === tp.hi" in js
    assert "exact TP level" in js
    assert "paintBand(ctx, d.w" in js
    assert "ctx.moveTo(0, Math.round(top) + 0.5)" in js


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
    assert "Replay ${l.reveal_count}/${cur().replay_1m.length} min · Main ${mainTf}" in js