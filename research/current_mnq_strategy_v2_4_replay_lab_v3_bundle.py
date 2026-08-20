#!/usr/bin/env python3
"""Bundle the V3 trader replay into one self-contained HTML file.

The page must work when opened as a downloaded local HTML file or inside an
opaque/sandboxed document. The bundler therefore inlines the chart/runtime JS,
falls back to in-memory state when localStorage is denied, binds the frozen MNQ
tick size, keeps drawing overlays non-intercepting, and patches marking to use
Lightweight Charts native click coordinates. It also captures two pre-entry TP
plans (bullish and bearish) so the trader can map both directions before price
chooses one. Bot answers are never read or embedded by this bundler.
"""
from __future__ import annotations

from pathlib import Path

PACK = Path("research/_mnq_v24_replay_lab_v3/pack")
HTML = PACK / "review_v3.html"
LWC = PACK / "lightweight-charts.standalone.production.js"
ENHANCE = PACK / "replay_v3_enhance.js"

LWC_MARKER = '<script src="lightweight-charts.standalone.production.js"></script>'
ENHANCE_MARKER = '<script src="replay_v3_enhance.js"></script>'
STORE_KEY_MARKER = "const storeKey='mnq-replay-v3:'+pack.pack_id;"
SAFE_TICK_STORE_KEY = "const TICK=0.25;const storeKey='mnq-replay-v3:'+pack.pack_id;"
TICK_MARKER = "const TICK=0.25;"
OVERLAY_STYLE_OLD = ".overlay{position:absolute;inset:0;z-index:5;pointer-events:none}"
OVERLAY_STYLE_NEW = ".overlay{position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none}"
OVERLAY_DRAW_STYLE_OLD = ".overlay.draw{pointer-events:auto;cursor:crosshair}"
OVERLAY_DRAW_STYLE_NEW = ".overlay.draw{pointer-events:none;cursor:crosshair}"
OVERLAY_STYLE_MARKER = "width:100%;height:100%;z-index:5;pointer-events:none"
VULNERABLE_STORAGE_READ = "let saved=JSON.parse(localStorage.getItem(storeKey)||'{}');"
SAFE_STORAGE_READ = (
    "let storageAvailable=true;let saved={};"
    "try{saved=JSON.parse(window.localStorage.getItem(storeKey)||'{}')}"
    "catch(e){storageAvailable=false;saved={};"
    "console.warn('REPLAY_STORAGE_DISABLED_USING_MEMORY',e)};"
)
VULNERABLE_STORAGE_SAVE = "function save(){localStorage.setItem(storeKey,JSON.stringify({idx,labels}))}"
SAFE_STORAGE_SAVE = (
    "function save(){if(!storageAvailable)return;"
    "try{window.localStorage.setItem(storeKey,JSON.stringify({idx,labels}))}"
    "catch(e){storageAvailable=false;"
    "console.warn('REPLAY_STORAGE_DISABLED_USING_MEMORY',e)}}"
)
SAFE_STORAGE_MARKER = "REPLAY_STORAGE_DISABLED_USING_MEMORY"

ENHANCE_PROGRESS_OLD = "refreshMain(Boolean(fit));\n    renderClock();\n  };"
ENHANCE_PROGRESS_NEW = (
    "refreshMain(Boolean(fit));\n"
    "    renderClock();\n"
    "    renderLabels();\n"
    "    updateMainControlStatus('REPLAY');\n"
    "  };"
)

CONTROL_INSERT_OLD = "  panel5.appendChild(mainTools);\n"
CONTROL_INSERT_NEW = """  panel5.appendChild(mainTools);
  const mainControlStatus = document.createElement('span');
  mainControlStatus.id = 'mainControlStatus';
  mainControlStatus.style.cssText = 'padding:5px 8px;border:1px solid #4f6a55;border-radius:6px;background:#102018;color:#8ed09f;font:700 11px ui-monospace,monospace;white-space:nowrap';
  mainControlStatus.textContent = 'MNQ_CONTROLS_READY · READY · 5M';
  mainTools.appendChild(mainControlStatus);

  // The trader plans both directional targets BEFORE the entry is known.
  drawTp.textContent = 'DRAW BULLISH TP';
  drawTp.title = 'Mark the target you would use if price gives the long setup.';
  const drawTpShort = document.createElement('button');
  drawTpShort.id = 'drawTpShort';
  drawTpShort.textContent = 'DRAW BEARISH TP';
  drawTpShort.title = 'Mark the target you would use if price gives the short setup.';
  drawTp.insertAdjacentElement('afterend', drawTpShort);
  clearTp.textContent = 'CLEAR BOTH TPS';
  clearTp.onclick = () => {
    const l = lab();
    l.trader_tp_long = null;
    l.trader_tp_short = null;
    l.trader_tp_reaction_cluster = null;
    save();
    renderLabels();
    updateMainControlStatus('TPS CLEARED');
  };

  function updateMainControlStatus(action) {
    const r = main.chart.timeScale().getVisibleLogicalRange();
    const bars = r ? Math.max(1, Math.round(r.to - r.from)) : 0;
    mainControlStatus.textContent = `MNQ_CONTROLS_READY · ${action} · ${mainTf.toUpperCase()}${bars ? ` · ${bars} BARS` : ''}`;
  }

  function paintDirectionalTps(canvas, chartObj, bullishTp, bearishTp) {
    const d = canvasSize(canvas);
    const ctx = d.x;
    const paintOne = (tp, fill, stroke) => {
      if (!tp) return;
      const y1 = chartObj.series.priceToCoordinate(tp.hi);
      const y2 = chartObj.series.priceToCoordinate(tp.lo);
      if (y1 == null || y2 == null) return;
      paintBand(ctx, d.w, y1, y2, fill, stroke);
    };
    paintOne(bullishTp, 'rgba(72,181,104,.13)', 'rgba(94,205,128,.95)');
    paintOne(bearishTp, 'rgba(216,95,104,.13)', 'rgba(230,110,118,.95)');
  }
"""

SET_MAIN_TF_OLD = """  function setMainTf(tf) {
    mainTf = tf;
    document.getElementById('main5m').classList.toggle('active', tf === '5m');
    document.getElementById('main15m').classList.toggle('active', tf === '15m');
    refreshMain(false);
    focusDecisionArea();
  }
"""
SET_MAIN_TF_NEW = """  function setMainTf(tf) {
    mainTf = tf;
    document.getElementById('main5m').classList.toggle('active', tf === '5m');
    document.getElementById('main15m').classList.toggle('active', tf === '15m');
    refreshMain(false);
    focusDecisionArea();
    renderLabels();
    updateMainControlStatus('TIMEFRAME');
  }
"""

ZOOM_MAIN_OLD = """  function zoomMain(multiplier) {
    const scale = main.chart.timeScale();
    const r = scale.getVisibleLogicalRange();
    if (!r) {
      scale.fitContent();
      return;
    }
    const mid = (r.from + r.to) / 2;
    const half = Math.max(4, (r.to - r.from) * multiplier / 2);
    scale.setVisibleLogicalRange({from: mid - half, to: mid + half});
  }
"""
ZOOM_MAIN_NEW = """  function zoomMain(multiplier) {
    const scale = main.chart.timeScale();
    const r = scale.getVisibleLogicalRange();
    if (!r) {
      scale.fitContent();
      renderLabels();
      updateMainControlStatus('FIT');
      return;
    }
    const mid = (r.from + r.to) / 2;
    const half = Math.max(4, (r.to - r.from) * multiplier / 2);
    scale.setVisibleLogicalRange({from: mid - half, to: mid + half});
    renderLabels();
    updateMainControlStatus(multiplier > 1 ? 'ZOOM OUT' : 'ZOOM IN');
  }
"""

HANDLERS_OLD = """  document.getElementById('main5m').onclick = () => setMainTf('5m');
  document.getElementById('main15m').onclick = () => setMainTf('15m');
  document.getElementById('mainZoomOut').onclick = () => zoomMain(1.55);
  document.getElementById('mainZoomIn').onclick = () => zoomMain(0.68);
  document.getElementById('mainFit').onclick = () => { main.chart.timeScale().fitContent(); drawOverlays(); };
"""
HANDLERS_NEW = """  document.getElementById('main5m').addEventListener('click', () => setMainTf('5m'));
  document.getElementById('main15m').addEventListener('click', () => setMainTf('15m'));
  document.getElementById('mainZoomOut').addEventListener('click', () => zoomMain(1.55));
  document.getElementById('mainZoomIn').addEventListener('click', () => zoomMain(0.68));
  document.getElementById('mainFit').addEventListener('click', () => {
    main.chart.timeScale().fitContent();
    drawOverlays();
    renderLabels();
    updateMainControlStatus('FIT ALL');
  });
  main.chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    updateMainControlStatus('VIEW');
    drawOverlays();
  });
"""

DIRECTIONAL_OVERLAYS_OLD = """  drawOverlays = function () {
    const l = lab();
    paintLayer(ov5, main, l.trader_zones, l.trader_tp_reaction_cluster);
    paintLayer(ov1, c1, l.trader_zones, l.trader_tp_reaction_cluster);
  };
"""
DIRECTIONAL_OVERLAYS_NEW = """  drawOverlays = function () {
    const l = lab();
    const bullishTp = l.trader_tp_long || (l.final_action === 'ENTER_LONG' ? l.trader_tp_reaction_cluster : null);
    const bearishTp = l.trader_tp_short || (l.final_action === 'ENTER_SHORT' ? l.trader_tp_reaction_cluster : null);
    // ALL structure drawings belong on the main chart only.
    paintLayer(ov5, main, l.trader_zones, null);
    paintDirectionalTps(ov5, main, bullishTp, bearishTp);
    // The bottom 1m chart is strictly entry timing / force. Never mirror zones or TP.
    const d1 = canvasSize(ov1);
    d1.x.clearRect(0, 0, d1.w, d1.h);
  };
"""

DRAW_HANDLERS_OLD = """  drawZone.onclick = () => beginDraw('main-zone', ov5);
  drawTp.onclick = () => beginDraw('main-tp', ov5);
"""
DRAW_HANDLERS_NEW = """  let nativeMarkMode = null;
  let pendingZoneEdge = null;
  function roundToTick(v) {
    return Math.round(v / TICK) * TICK;
  }
  function armNativeMark(mode) {
    nativeMarkMode = mode;
    pendingZoneEdge = null;
    drawMode = null;
    mainDragY = null;
    ov5.classList.remove('draw');
    const label = mode === 'zone'
      ? 'CLICK KEY ZONE EDGE 1'
      : mode === 'tp-long' ? 'CLICK BULLISH TP LEVEL' : 'CLICK BEARISH TP LEVEL';
    updateMainControlStatus(label);
  }
  drawZone.onclick = () => armNativeMark('zone');
  drawTp.onclick = () => armNativeMark('tp-long');
  drawTpShort.onclick = () => armNativeMark('tp-short');
  main.chart.subscribeClick((param) => {
    if (!nativeMarkMode || !param || !param.point) return;
    const raw = main.series.coordinateToPrice(param.point.y);
    if (raw == null || !Number.isFinite(+raw)) return;
    const price = roundToTick(+raw);
    if (nativeMarkMode === 'tp-long' || nativeMarkMode === 'tp-short') {
      const side = nativeMarkMode === 'tp-long' ? 'BULLISH' : 'BEARISH';
      const field = nativeMarkMode === 'tp-long' ? 'trader_tp_long' : 'trader_tp_short';
      lab()[field] = {
        lo: price, hi: price,
        planned_direction: side,
        source_method: 'TRADER_REACTION_CLUSTER_EXACT_LEVEL',
        marked_time: replayTime(),
        marked_main_timeframe: mainTf,
      };
      nativeMarkMode = null;
      save();
      renderLabels();
      updateMainControlStatus(`${side} TP SET ${price.toFixed(2)}`);
      return;
    }
    if (pendingZoneEdge == null) {
      pendingZoneEdge = price;
      updateMainControlStatus(`KEY EDGE 1 ${price.toFixed(2)} · CLICK EDGE 2`);
      return;
    }
    let lo = Math.min(pendingZoneEdge, price);
    let hi = Math.max(pendingZoneEdge, price);
    if (hi - lo < TICK) hi = lo + TICK;
    lab().trader_zones.push({
      lo, hi,
      role: zoneRole.value,
      source_method: zoneMethod.value,
      marked_time: replayTime(),
      marked_main_timeframe: mainTf,
    });
    pendingZoneEdge = null;
    nativeMarkMode = null;
    save();
    renderLabels();
    updateMainControlStatus(`KEY ZONE SET ${lo.toFixed(2)}-${hi.toFixed(2)}`);
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') drawOverlays();
  }, 50);
"""

ENTRY_TP_BIND_OLD = """      l.final_action = action;
      l.first_entry_time = now;
"""
ENTRY_TP_BIND_NEW = """      l.final_action = action;
      // Preserve BOTH pre-entry plans, but bind the chosen direction into the
      // legacy grading field so existing fidelity math compares the correct TP.
      l.trader_tp_reaction_cluster = action === 'ENTER_LONG'
        ? (l.trader_tp_long || null)
        : (l.trader_tp_short || null);
      l.first_entry_time = now;
"""

TP_STATUS_OLD = """    if (l.trader_tp_reaction_cluster) {
      const tp = l.trader_tp_reaction_cluster;
      tpStatus.textContent = tp.lo === tp.hi
        ? `${tp.lo.toFixed(2)} · exact TP level`
        : `${tp.lo.toFixed(2)} – ${tp.hi.toFixed(2)} · reaction area`;
    }
"""
TP_STATUS_NEW = """    const fmtTp = (tp) => !tp ? 'not marked' : (tp.lo === tp.hi
      ? `${tp.lo.toFixed(2)}`
      : `${tp.lo.toFixed(2)}-${tp.hi.toFixed(2)}`);
    tpStatus.innerHTML = `<b style="color:#70c18b">Bullish TP:</b> ${fmtTp(l.trader_tp_long)} &nbsp; · &nbsp; <b style="color:#df6b72">Bearish TP:</b> ${fmtTp(l.trader_tp_short)}`;
"""

TP_PAINT_OLD = """        const top = Math.min(y1, y2);
        const height = Math.abs(y2 - y1);
        ctx.fillStyle = 'rgba(229,161,92,.17)';
        ctx.strokeStyle = 'rgba(229,161,92,.94)';
        ctx.fillRect(0, top, d.w, height);
        ctx.strokeRect(0, top, d.w, height);
"""
TP_PAINT_NEW = """        const top = Math.min(y1, y2);
        const height = Math.abs(y2 - y1);
        ctx.fillStyle = 'rgba(229,161,92,.17)';
        ctx.strokeStyle = 'rgba(229,161,92,.94)';
        if (height < 1) {
          ctx.beginPath();
          ctx.moveTo(0, y1);
          ctx.lineTo(d.w, y1);
          ctx.stroke();
        } else {
          ctx.fillRect(0, top, d.w, height);
          ctx.strokeRect(0, top, d.w, height);
        }
"""

ZONE_HELP_OLD = "  zoneHelp.textContent = 'Choose how you found the level, then draw it on the big main chart.';"
ZONE_HELP_NEW = "  zoneHelp.textContent = 'Key zone: click one edge, then the other. Before replay direction is known, mark BOTH targets: Bullish TP for a long setup and Bearish TP for a short setup.';"

FINAL_OLD = "  drawOverlays();\n})();"
FINAL_NEW = "  drawOverlays();\n  updateMainControlStatus('READY');\n})();"

CONTROL_READY_MARKER = "MNQ_CONTROLS_READY"
NATIVE_MARK_MARKER = "main.chart.subscribeClick((param) =>"
TP_LONG_MARKER = "CLICK BULLISH TP LEVEL"
TP_SHORT_MARKER = "CLICK BEARISH TP LEVEL"
ZONE_CLICK_MARKER = "CLICK KEY ZONE EDGE 1"
DUAL_TP_MARKER = "trader_tp_long"
ENTRY_CHART_CLEAN_MARKER = "The bottom 1m chart is strictly entry timing / force"
PROGRESS_MARKER = "renderClock();\n    renderLabels();\n    updateMainControlStatus('REPLAY');"
UNIFIED_MARKERS = (
    "Main Structure / Key Zones + TP Reaction Cluster",
    "15m CONTEXT",
    "− ZOOM OUT",
    "MOVE_AWAY_REJECTION_ORIGIN",
    "drawZone.onclick = () => armNativeMark('zone')",
    "drawTp.onclick = () => armNativeMark('tp-long')",
    "drawTpShort.onclick = () => armNativeMark('tp-short')",
)


def _patch_browser_runtime(html: str) -> str:
    if STORE_KEY_MARKER not in html:
        raise RuntimeError("REPLAY_V3_STORE_KEY_MARKER_MISSING")
    if VULNERABLE_STORAGE_READ not in html:
        raise RuntimeError("REPLAY_V3_STORAGE_READ_MARKER_MISSING")
    if VULNERABLE_STORAGE_SAVE not in html:
        raise RuntimeError("REPLAY_V3_STORAGE_SAVE_MARKER_MISSING")
    if OVERLAY_STYLE_OLD not in html:
        raise RuntimeError("REPLAY_V3_OVERLAY_STYLE_MARKER_MISSING")
    if OVERLAY_DRAW_STYLE_OLD not in html:
        raise RuntimeError("REPLAY_V3_OVERLAY_DRAW_STYLE_MARKER_MISSING")
    html = html.replace(STORE_KEY_MARKER, SAFE_TICK_STORE_KEY, 1)
    html = html.replace(VULNERABLE_STORAGE_READ, SAFE_STORAGE_READ, 1)
    html = html.replace(VULNERABLE_STORAGE_SAVE, SAFE_STORAGE_SAVE, 1)
    html = html.replace(OVERLAY_STYLE_OLD, OVERLAY_STYLE_NEW, 1)
    html = html.replace(OVERLAY_DRAW_STYLE_OLD, OVERLAY_DRAW_STYLE_NEW, 1)
    if VULNERABLE_STORAGE_READ in html or VULNERABLE_STORAGE_SAVE in html:
        raise RuntimeError("REPLAY_V3_UNSAFE_STORAGE_ACCESS_REMAINS")
    if TICK_MARKER not in html:
        raise RuntimeError("REPLAY_V3_BROWSER_TICK_NOT_BOUND")
    if OVERLAY_STYLE_MARKER not in html:
        raise RuntimeError("REPLAY_V3_FULL_CHART_OVERLAY_NOT_BOUND")
    if OVERLAY_DRAW_STYLE_OLD in html:
        raise RuntimeError("REPLAY_V3_POINTER_CAPTURE_OVERLAY_REMAINS")
    return html


def _replace_once(text: str, old: str, new: str, code: str) -> str:
    if old not in text:
        raise RuntimeError(code + "_MARKER_MISSING")
    out = text.replace(old, new, 1)
    if new not in out:
        raise RuntimeError(code + "_NOT_PATCHED")
    return out


def _patch_enhance_runtime(enhance: str) -> str:
    enhance = _replace_once(enhance, CONTROL_INSERT_OLD, CONTROL_INSERT_NEW, "REPLAY_V3_CONTROL_STATUS")
    enhance = _replace_once(enhance, SET_MAIN_TF_OLD, SET_MAIN_TF_NEW, "REPLAY_V3_TIMEFRAME_CONTROL")
    enhance = _replace_once(enhance, ZOOM_MAIN_OLD, ZOOM_MAIN_NEW, "REPLAY_V3_ZOOM_CONTROL")
    enhance = _replace_once(enhance, HANDLERS_OLD, HANDLERS_NEW, "REPLAY_V3_CONTROL_HANDLERS")
    enhance = _replace_once(enhance, DIRECTIONAL_OVERLAYS_OLD, DIRECTIONAL_OVERLAYS_NEW, "REPLAY_V3_DIRECTIONAL_TP_OVERLAYS")
    enhance = _replace_once(enhance, DRAW_HANDLERS_OLD, DRAW_HANDLERS_NEW, "REPLAY_V3_NATIVE_MARKING")
    enhance = _replace_once(enhance, ENTRY_TP_BIND_OLD, ENTRY_TP_BIND_NEW, "REPLAY_V3_DIRECTIONAL_TP_BIND")
    enhance = _replace_once(enhance, TP_STATUS_OLD, TP_STATUS_NEW, "REPLAY_V3_DIRECTIONAL_TP_STATUS")
    enhance = _replace_once(enhance, TP_PAINT_OLD, TP_PAINT_NEW, "REPLAY_V3_TP_EXACT_LINE")
    enhance = _replace_once(enhance, ZONE_HELP_OLD, ZONE_HELP_NEW, "REPLAY_V3_MARK_HELP")
    enhance = _replace_once(enhance, ENHANCE_PROGRESS_OLD, ENHANCE_PROGRESS_NEW, "REPLAY_V3_PROGRESS_REFRESH")
    enhance = _replace_once(enhance, FINAL_OLD, FINAL_NEW, "REPLAY_V3_CONTROL_READY")
    return enhance


def bundle(html_path: Path = HTML, lwc_path: Path = LWC, enhance_path: Path = ENHANCE) -> str:
    html = html_path.read_text(encoding="utf-8")
    lwc = lwc_path.read_text(encoding="utf-8")
    enhance = enhance_path.read_text(encoding="utf-8")
    if LWC_MARKER not in html:
        raise RuntimeError("REPLAY_V3_LWC_SCRIPT_MARKER_MISSING")
    if ENHANCE_MARKER not in html:
        raise RuntimeError("REPLAY_V3_ENHANCE_SCRIPT_MARKER_MISSING")
    for name, js in (("LWC", lwc), ("ENHANCE", enhance)):
        if not js.strip():
            raise RuntimeError(f"REPLAY_V3_{name}_SCRIPT_EMPTY")
        if "</script>" in js.lower():
            raise RuntimeError(f"REPLAY_V3_{name}_SCRIPT_UNSAFE_CLOSE_TAG")

    html = _patch_browser_runtime(html)
    enhance = _patch_enhance_runtime(enhance)
    html = html.replace(LWC_MARKER, f"<script>\n{lwc}\n</script>", 1)
    html = html.replace(ENHANCE_MARKER, f"<script>\n{enhance}\n</script>", 1)

    if 'script src="lightweight-charts' in html or 'script src="replay_v3_enhance' in html:
        raise RuntimeError("REPLAY_V3_EXTERNAL_RUNTIME_DEPENDENCY_REMAINS")
    if SAFE_STORAGE_MARKER not in html:
        raise RuntimeError("REPLAY_V3_STORAGE_FALLBACK_NOT_BUNDLED")
    if TICK_MARKER not in html:
        raise RuntimeError("REPLAY_V3_BROWSER_TICK_NOT_BUNDLED")
    if OVERLAY_STYLE_MARKER not in html:
        raise RuntimeError("REPLAY_V3_FULL_CHART_OVERLAY_NOT_BUNDLED")
    if PROGRESS_MARKER not in html:
        raise RuntimeError("REPLAY_V3_PROGRESS_REFRESH_NOT_BUNDLED")
    if CONTROL_READY_MARKER not in html:
        raise RuntimeError("REPLAY_V3_VISIBLE_CONTROL_READY_MARKER_MISSING")
    if ENTRY_CHART_CLEAN_MARKER not in html:
        raise RuntimeError("REPLAY_V3_ENTRY_CHART_STRUCTURE_OVERLAY_NOT_REMOVED")
    if (
        NATIVE_MARK_MARKER not in html or TP_LONG_MARKER not in html
        or TP_SHORT_MARKER not in html or ZONE_CLICK_MARKER not in html
        or DUAL_TP_MARKER not in html
    ):
        raise RuntimeError("REPLAY_V3_NATIVE_DUAL_TP_MARKING_NOT_BUNDLED")
    if "RESET DECISION" not in html or "if (l.final_action) return;" not in html:
        raise RuntimeError("REPLAY_V3_SINGLE_TRADE_INTERACTION_NOT_BUNDLED")
    missing = [marker for marker in UNIFIED_MARKERS if marker not in html]
    if missing:
        raise RuntimeError("REPLAY_V3_UNIFIED_MAIN_CHART_NOT_BUNDLED:" + "|".join(missing))
    html_path.write_text(html, encoding="utf-8")
    return html


def main() -> None:
    html = bundle()
    print(f"REPLAY_V3_STANDALONE_HTML_OK:{len(html)}")


if __name__ == "__main__":
    main()
