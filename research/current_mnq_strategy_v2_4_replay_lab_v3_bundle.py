#!/usr/bin/env python3
"""Bundle the V3 trader replay into one self-contained HTML file.

The page must work when opened as a downloaded local HTML file or inside an
opaque/sandboxed document. The bundler therefore inlines the chart/runtime JS,
falls back to in-memory state when localStorage is denied, binds the frozen MNQ
tick size, makes the chart overlays cover the full chart, and patches the trader
controls so every click has visible feedback. Bot answers are never read or
embedded by this bundler.
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
  function updateMainControlStatus(action) {
    const r = main.chart.timeScale().getVisibleLogicalRange();
    const bars = r ? Math.max(1, Math.round(r.to - r.from)) : 0;
    mainControlStatus.textContent = `MNQ_CONTROLS_READY · ${action} · ${mainTf.toUpperCase()}${bars ? ` · ${bars} BARS` : ''}`;
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
  main.chart.timeScale().subscribeVisibleLogicalRangeChange(() => updateMainControlStatus('VIEW'));
"""

DRAW_HANDLERS_OLD = """  drawZone.onclick = () => beginDraw('main-zone', ov5);
  drawTp.onclick = () => beginDraw('main-tp', ov5);
"""
DRAW_HANDLERS_NEW = """  function revealMainForDraw(mode) {
    beginDraw(mode, ov5);
    panel5.scrollIntoView({behavior: 'auto', block: 'center'});
    updateMainControlStatus(mode === 'main-zone' ? 'DRAW KEY ZONE' : 'DRAW TP');
  }
  drawZone.onclick = () => revealMainForDraw('main-zone');
  drawTp.onclick = () => revealMainForDraw('main-tp');
"""

FINAL_OLD = "  drawOverlays();\n})();"
FINAL_NEW = "  drawOverlays();\n  updateMainControlStatus('READY');\n})();"

CONTROL_READY_MARKER = "MNQ_CONTROLS_READY"
DRAW_READY_MARKER = "panel5.scrollIntoView({behavior: 'auto', block: 'center'})"
PROGRESS_MARKER = "renderClock();\n    renderLabels();\n    updateMainControlStatus('REPLAY');"
UNIFIED_MARKERS = (
    "Main Structure / Key Zones + TP Reaction Cluster",
    "15m CONTEXT",
    "− ZOOM OUT",
    "MOVE_AWAY_REJECTION_ORIGIN",
    "drawZone.onclick = () => revealMainForDraw('main-zone')",
    "drawTp.onclick = () => revealMainForDraw('main-tp')",
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
    html = html.replace(STORE_KEY_MARKER, SAFE_TICK_STORE_KEY, 1)
    html = html.replace(VULNERABLE_STORAGE_READ, SAFE_STORAGE_READ, 1)
    html = html.replace(VULNERABLE_STORAGE_SAVE, SAFE_STORAGE_SAVE, 1)
    html = html.replace(OVERLAY_STYLE_OLD, OVERLAY_STYLE_NEW, 1)
    if VULNERABLE_STORAGE_READ in html or VULNERABLE_STORAGE_SAVE in html:
        raise RuntimeError("REPLAY_V3_UNSAFE_STORAGE_ACCESS_REMAINS")
    if TICK_MARKER not in html:
        raise RuntimeError("REPLAY_V3_BROWSER_TICK_NOT_BOUND")
    if OVERLAY_STYLE_MARKER not in html:
        raise RuntimeError("REPLAY_V3_FULL_CHART_OVERLAY_NOT_BOUND")
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
    enhance = _replace_once(enhance, DRAW_HANDLERS_OLD, DRAW_HANDLERS_NEW, "REPLAY_V3_DRAW_HANDLERS")
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
    if DRAW_READY_MARKER not in html:
        raise RuntimeError("REPLAY_V3_DRAW_SCROLL_TO_MAIN_MISSING")
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
