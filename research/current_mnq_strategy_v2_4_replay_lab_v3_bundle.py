#!/usr/bin/env python3
"""Bundle the V3 trader replay into one self-contained HTML file.

Chat/file viewers do not reliably serve sibling JavaScript files next to an HTML
artifact. The trader-facing page must therefore inline both the pinned TradingView
Lightweight Charts runtime and our replay enhancement layer. Bot answers are never
read or embedded by this bundler.

The final trader page must also work when opened as a downloaded local HTML file
or inside an opaque/sandboxed document where the browser denies localStorage.
Denied localStorage used to abort the core script before event handlers were bound,
which made every visible button look normal but do nothing. The bundler patches the
core storage access to fail over to in-memory state instead of aborting the page.
It also refreshes the replay counter on every +1m/+5m/play step so a successful
button press is visibly obvious instead of looking frozen.
"""
from __future__ import annotations

from pathlib import Path

PACK = Path("research/_mnq_v24_replay_lab_v3/pack")
HTML = PACK / "review_v3.html"
LWC = PACK / "lightweight-charts.standalone.production.js"
ENHANCE = PACK / "replay_v3_enhance.js"

LWC_MARKER = '<script src="lightweight-charts.standalone.production.js"></script>'
ENHANCE_MARKER = '<script src="replay_v3_enhance.js"></script>'
VULNERABLE_STORAGE_READ = "let saved=JSON.parse(localStorage.getItem(storeKey)||'{}');"
SAFE_STORAGE_READ = (
    "let storageAvailable=true;let saved={};"
    "try{saved=JSON.parse(window.localStorage.getItem(storeKey)||'{}')}"
    "catch(e){storageAvailable=false;saved={};"
    "console.warn('REPLAY_STORAGE_DISABLED_USING_MEMORY',e)};"
)
VULNERABLE_STORAGE_SAVE = (
    "function save(){localStorage.setItem(storeKey,JSON.stringify({idx,labels}))}"
)
SAFE_STORAGE_SAVE = (
    "function save(){if(!storageAvailable)return;"
    "try{window.localStorage.setItem(storeKey,JSON.stringify({idx,labels}))}"
    "catch(e){storageAvailable=false;"
    "console.warn('REPLAY_STORAGE_DISABLED_USING_MEMORY',e)}}"
)
SAFE_STORAGE_MARKER = "REPLAY_STORAGE_DISABLED_USING_MEMORY"
ENHANCE_PROGRESS_OLD = "refreshMain(Boolean(fit));\n    renderClock();\n  };"
ENHANCE_PROGRESS_NEW = "refreshMain(Boolean(fit));\n    renderClock();\n    renderLabels();\n  };"
PROGRESS_MARKER = "renderClock();\n    renderLabels();"
UNIFIED_MARKERS = (
    "Main Structure / Key Zones + TP Reaction Cluster",
    "15m CONTEXT",
    "− ZOOM OUT",
    "MOVE_AWAY_REJECTION_ORIGIN",
    "drawZone.onclick = () => beginDraw('main-zone', ov5)",
    "drawTp.onclick = () => beginDraw('main-tp', ov5)",
)


def _patch_local_storage_fail_closed(html: str) -> str:
    if VULNERABLE_STORAGE_READ not in html:
        raise RuntimeError("REPLAY_V3_STORAGE_READ_MARKER_MISSING")
    if VULNERABLE_STORAGE_SAVE not in html:
        raise RuntimeError("REPLAY_V3_STORAGE_SAVE_MARKER_MISSING")
    html = html.replace(VULNERABLE_STORAGE_READ, SAFE_STORAGE_READ, 1)
    html = html.replace(VULNERABLE_STORAGE_SAVE, SAFE_STORAGE_SAVE, 1)
    if VULNERABLE_STORAGE_READ in html or VULNERABLE_STORAGE_SAVE in html:
        raise RuntimeError("REPLAY_V3_UNSAFE_STORAGE_ACCESS_REMAINS")
    return html


def _patch_visible_progress(enhance: str) -> str:
    if ENHANCE_PROGRESS_OLD not in enhance:
        raise RuntimeError("REPLAY_V3_PROGRESS_REFRESH_MARKER_MISSING")
    out = enhance.replace(ENHANCE_PROGRESS_OLD, ENHANCE_PROGRESS_NEW, 1)
    if PROGRESS_MARKER not in out:
        raise RuntimeError("REPLAY_V3_PROGRESS_REFRESH_NOT_PATCHED")
    return out


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

    html = _patch_local_storage_fail_closed(html)
    enhance = _patch_visible_progress(enhance)
    html = html.replace(LWC_MARKER, f"<script>\n{lwc}\n</script>", 1)
    html = html.replace(ENHANCE_MARKER, f"<script>\n{enhance}\n</script>", 1)

    if 'script src="lightweight-charts' in html or 'script src="replay_v3_enhance' in html:
        raise RuntimeError("REPLAY_V3_EXTERNAL_RUNTIME_DEPENDENCY_REMAINS")
    if SAFE_STORAGE_MARKER not in html:
        raise RuntimeError("REPLAY_V3_STORAGE_FALLBACK_NOT_BUNDLED")
    if PROGRESS_MARKER not in html:
        raise RuntimeError("REPLAY_V3_PROGRESS_REFRESH_NOT_BUNDLED")
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
