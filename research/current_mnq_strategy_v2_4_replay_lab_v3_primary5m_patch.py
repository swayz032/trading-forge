#!/usr/bin/env python3
"""Post-bundle trader-UX patch for the v2.4 fidelity calibration replay.

The trader enters from the 5-minute chart. The 1-minute chart is only a causal
intrabar diagnostic for the bot. This patch also renders active 15-minute FVG
context (known at replay start) on the main chart, including a dashed midpoint,
so the trader can place a TP at the FVG midpoint when it is the first meaningful
reaction. No bot answer, selected target, PnL, or future outcome is exposed.
"""
from __future__ import annotations

from pathlib import Path

PACK = Path("research/_mnq_v24_replay_lab_v3/pack")
HTML = PACK / "review_v3.html"
READY = "MNQ_5M_PRIMARY_ENTRY_FVG_CONTEXT_READY"

OLD_OVERLAYS = """  drawOverlays = function () {
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

NEW_OVERLAYS = r"""  function paintActive15mFvgContext(canvas, chartObj) {
    const fvgs = cur().context_15m_active_fvgs_at_replay_start || [];
    if (!fvgs.length) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    const width = rect.width;
    ctx.save();
    fvgs.forEach((f) => {
      const yHi = chartObj.series.priceToCoordinate(+f.hi);
      const yLo = chartObj.series.priceToCoordinate(+f.lo);
      const yMid = chartObj.series.priceToCoordinate(+f.mid);
      if (yHi == null || yLo == null || yMid == null) return;
      const top = Math.min(yHi, yLo);
      const height = Math.abs(yLo - yHi);
      ctx.fillStyle = 'rgba(116,104,235,.08)';
      ctx.strokeStyle = 'rgba(140,128,255,.62)';
      ctx.lineWidth = 1;
      if (height < 1.5) {
        ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(width, top); ctx.stroke();
      } else {
        ctx.fillRect(0, top, width, height);
        ctx.strokeRect(0, top, width, height);
      }
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = 'rgba(235,235,255,.86)';
      ctx.beginPath(); ctx.moveTo(0, yMid); ctx.lineTo(width, yMid); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(235,235,255,.92)';
      ctx.font = '11px system-ui,sans-serif';
      ctx.fillText('15m FVG MID', Math.max(8, width - 92), Math.max(12, yMid - 4));
    });
    ctx.restore();
  }

  drawOverlays = function () {
    const l = lab();
    const bullishTp = l.trader_tp_long || (l.final_action === 'ENTER_LONG' ? l.trader_tp_reaction_cluster : null);
    const bearishTp = l.trader_tp_short || (l.final_action === 'ENTER_SHORT' ? l.trader_tp_reaction_cluster : null);
    // ALL trader structure drawings belong on the 5m-primary main chart only.
    paintLayer(ov5, main, l.trader_zones, null);
    // Objective active 15m FVG context is market structure, not a bot answer.
    paintActive15mFvgContext(ov5, main);
    paintDirectionalTps(ov5, main, bullishTp, bearishTp);
    // The 1m panel is BOT CAUSAL DIAGNOSTIC ONLY. Never mirror zones or TP.
    const d1 = canvasSize(ov1);
    d1.x.clearRect(0, 0, d1.w, d1.h);
  };
"""


def _replace_once(text: str, old: str, new: str, code: str) -> str:
    if old not in text:
        raise RuntimeError(code + "_MARKER_MISSING")
    out = text.replace(old, new, 1)
    if new not in out:
        raise RuntimeError(code + "_NOT_PATCHED")
    return out


def patch_html(text: str) -> str:
    if READY in text:
        return text
    text = _replace_once(text, OLD_OVERLAYS, NEW_OVERLAYS, "PRIMARY5M_OVERLAYS")
    text = text.replace(
        "Main Structure / Key Zones + TP Reaction Cluster",
        "5m PRIMARY ENTRY / Key Zones + TP · 15m Context Toggle",
    )
    text = text.replace(
        "1m Live Force / Tug-of-War",
        "1m BOT CAUSAL RECONSTRUCTION — DIAGNOSTIC ONLY",
    )
    text = text.replace(
        "The bottom 1m chart is strictly entry timing / force",
        "The bottom 1m chart is bot causal reconstruction only",
    )
    text = text.replace(
        "The bottom chart is only for 1m force and exact entry timing.",
        "ENTER from the 5m chart. The bottom 1m panel is diagnostic only; it exists so the bot can reconstruct the still-forming 5m candle without hindsight.",
    )
    text = text.replace(
        "document.title = 'MNQ Replay Lab — Unified Main + 1m Entry';",
        "document.title = 'MNQ Replay Lab — 5m Primary Entry';",
    )
    marker = "  updateMainControlStatus('READY');\n})();"
    injected = (
        "  const primary5mBadge = document.createElement('div');\n"
        "  primary5mBadge.className = 'mainHint';\n"
        "  primary5mBadge.innerHTML = '<b>5m IS THE ENTRY CHART.</b> 15m = structure/FVG/TP context. 1m = bot causal diagnostic only. Purple bands are active 15m FVGs known at replay start; dashed white line = FVG midpoint.';\n"
        "  panel5.insertAdjacentElement('afterend', primary5mBadge);\n"
        f"  window.{READY} = true;\n"
        "  updateMainControlStatus('READY');\n})();"
    )
    text = _replace_once(text, marker, injected, "PRIMARY5M_READY")
    return text


def main() -> None:
    text = HTML.read_text(encoding="utf-8")
    text = patch_html(text)
    HTML.write_text(text, encoding="utf-8")
    print(READY)


if __name__ == "__main__":
    main()
