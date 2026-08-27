#!/usr/bin/env python3
"""Normalize the copied V3 enhancer to the bundle transform contract.

The enhancer's shared paintBand helper replaced the older inline TP painter, but
the deterministic bundler still patches that inline marker to guarantee exact
zero-height TP lines. Re-expand only that TP call in the generated pack before
bundling so the existing bundle transform stays fail-closed and deterministic.
This touches generated pack content only; no strategy semantics change.
"""
from __future__ import annotations

from pathlib import Path

PACK = Path("research/_mnq_v24_replay_lab_v3/pack")
ENHANCE = PACK / "replay_v3_enhance.js"
READY = "MNQ_BUNDLE_COMPAT_TP_INLINE_READY"

CALL = "        paintBand(ctx, d.w, y1, y2, 'rgba(229,161,92,.17)', 'rgba(229,161,92,.94)');"
INLINE = """        const top = Math.min(y1, y2);
        const height = Math.abs(y2 - y1);
        ctx.fillStyle = 'rgba(229,161,92,.17)';
        ctx.strokeStyle = 'rgba(229,161,92,.94)';
        ctx.fillRect(0, top, d.w, height);
        ctx.strokeRect(0, top, d.w, height);"""


def main() -> None:
    text = ENHANCE.read_text(encoding="utf-8")
    if INLINE in text:
        print(READY)
        return
    if CALL not in text:
        raise RuntimeError("REPLAY_V3_BUNDLE_COMPAT_TP_CALL_MISSING")
    text = text.replace(CALL, INLINE, 1)
    ENHANCE.write_text(text, encoding="utf-8")
    print(READY)


if __name__ == "__main__":
    main()
