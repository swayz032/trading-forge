#!/usr/bin/env python3
"""Bundle the V3 trader replay into one self-contained HTML file.

Chat/file viewers do not reliably serve sibling JavaScript files next to an HTML
artifact. The trader-facing page must therefore inline both the pinned TradingView
Lightweight Charts runtime and our replay enhancement layer. Bot answers are never
read or embedded by this bundler.
"""
from __future__ import annotations

from pathlib import Path

PACK = Path("research/_mnq_v24_replay_lab_v3/pack")
HTML = PACK / "review_v3.html"
LWC = PACK / "lightweight-charts.standalone.production.js"
ENHANCE = PACK / "replay_v3_enhance.js"

LWC_MARKER = '<script src="lightweight-charts.standalone.production.js"></script>'
ENHANCE_MARKER = '<script src="replay_v3_enhance.js"></script>'


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
    html = html.replace(LWC_MARKER, f"<script>\n{lwc}\n</script>", 1)
    html = html.replace(ENHANCE_MARKER, f"<script>\n{enhance}\n</script>", 1)
    if 'script src="lightweight-charts' in html or 'script src="replay_v3_enhance' in html:
        raise RuntimeError("REPLAY_V3_EXTERNAL_RUNTIME_DEPENDENCY_REMAINS")
    if "RESET DECISION" not in html or "if (l.final_action) return;" not in html:
        raise RuntimeError("REPLAY_V3_SINGLE_TRADE_INTERACTION_NOT_BUNDLED")
    html_path.write_text(html, encoding="utf-8")
    return html


def main() -> None:
    html = bundle()
    print(f"REPLAY_V3_STANDALONE_HTML_OK:{len(html)}")


if __name__ == "__main__":
    main()
