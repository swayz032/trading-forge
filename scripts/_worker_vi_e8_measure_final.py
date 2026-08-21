"""AR-1393 measurement helper: locate the price-axis highlight rows on the buy-side frames.

Used to establish the pixel rows for the FINAL stable post-drag frame (vi2_00-16-28.png) rather
than the intermediate mid-drag frame (vi2_00-16-21.png) that AR-1392 measured. Prints only;
writes nothing.
"""

from PIL import Image
import numpy as np
import sys

FRAMES = ("docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/"
          "visual-intelligence-e8-round1/E8Wg6tFPYjo/frames")


def axis_groups(path, x0=1775, x1=1830, thresh=200, cover=0.5):
    a = np.array(Image.open(path).convert("RGB")).astype(int)
    strip = a[:, x0:x1, :]
    dark = (strip.sum(axis=2) < thresh).mean(axis=1)
    rows = np.where(dark >= cover)[0]
    groups = []
    if len(rows):
        start = prev = rows[0]
        for r in rows[1:]:
            if r - prev > 3:
                groups.append((start, prev))
                start = r
            prev = r
        groups.append((start, prev))
    return groups


for name in ("vi2_00-16-28.png", "vi2_00-16-21.png"):
    p = f"{FRAMES}/{name}"
    g = axis_groups(p)
    print(f"{name}: dark axis-highlight row groups (y0,y1) -> centres")
    for a0, a1 in g:
        print(f"    {a0:4d}-{a1:4d}  centre {(a0 + a1) / 2:.1f}")
    print()
