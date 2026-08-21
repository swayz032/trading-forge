"""Diagnostic probe (AR-1391): print snippet text in each candidate window for manual
verification/tightening. Disposable."""

import json


def fmt_ts(seconds):
    m = int(seconds // 60)
    s = seconds - m * 60
    return f"{m}:{s:05.2f}"


with open("scripts/_worker_vi_e8_timedtext_raw.json", encoding="utf-8") as f:
    snippets = json.load(f)

WINDOWS = {
    "VI-E8-1 (wide)": (209, 241),
    "VI-E8-2": (490, 500),
    "VI-E8-3-EX1": (73, 86),
    "VI-E8-3-EX2": (380, 390),
}

for label, (i0, i1) in WINDOWS.items():
    print("=====", label, "=====")
    for i in range(i0, i1 + 1):
        s = snippets[i]
        print(f"  [{i}] {fmt_ts(s['start'])}  {s['text']}")
    print()
