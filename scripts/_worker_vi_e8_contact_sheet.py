"""AR-1393 — deterministic contact-sheet generator for the E8 full-video timeframe/symbol scan.

AR-1383A section 7 item 7 required either a committed deterministic generation manifest for the
contact sheets, or a lowered reproducibility claim. This is the manifest, as executable code.

WHY IT EXISTS: AR-1392's two sheets (`scan_timeframe_5s.png`, `scan_symbol_header_15s.png`) were
produced by an ad-hoc command that was never committed, so their sample timestamps, crop boxes and
tile layout could not be reproduced or audited from the repository. Those two sheets are retained
as historical evidence but are SUPERSEDED by `scan_legend_5s.png`, which this script emits.

WHAT IT PROVES: VI-E8-3's load-bearing absence claim -- the chart is never once set to the 4-hour
timeframe -- re-derived from the source media by a committed, rerunnable procedure.

ONE REGION, BOTH FIELDS: the TradingView chart legend line carries the symbol AND the active
timeframe in the same string ("New Zealand Dollar / U.S. Dollar - 15 - FXCM"). AR-1392 scanned them
as two separate sheets; cropping the whole legend answers both from one pass and keeps the
positive control (the mid-video symbol change) in the same artifact as the absence claim it
controls for.

PREREQUISITE: the source media, re-acquired with the command recorded in vi_findings.md:
    python -m yt_dlp -f 137 -o "hi.%(ext)s" "https://www.youtube.com/watch?v=E8Wg6tFPYjo"
Expected sha256 06af188d3a226ca05ba9000097ec7a603ca6ca36563ed12926bf62a0da3e2841, 35570757 bytes.
The script VALIDATES type, size, duration and hash before sampling, and refuses otherwise -- an
absence claim measured against unvalidated media is not evidence (AR-1383A section 9).

Run:  python scripts/_worker_vi_e8_contact_sheet.py [path-to-hi.mp4]
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image

FRAMES = ("docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/"
          "visual-intelligence-e8-round1/E8Wg6tFPYjo/frames")

# --- media validation contract (AR-1383A section 9) ---------------------------------------------
EXPECT_SHA256 = "06af188d3a226ca05ba9000097ec7a603ca6ca36563ed12926bf62a0da3e2841"
EXPECT_BYTES = 35570757
EXPECT_DURATION_S = 1177.60
DURATION_TOLERANCE_S = 0.5

# --- deterministic sampling manifest ------------------------------------------------------------
INTERVAL_S = 5.0
CROP = (100, 92, 700, 118)     # the chart legend line: symbol + active timeframe + venue
COLS = 4
OUT_NAME = "scan_legend_5s.png"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def probe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", path],
        capture_output=True, text=True, check=True).stdout
    return float(json.loads(out)["format"]["duration"])


def validate(path):
    print("MEDIA VALIDATION")
    if not path.lower().endswith(".mp4"):
        raise SystemExit(f"REFUSED: not an .mp4: {path}")
    size = os.path.getsize(path)
    print(f"  type      .mp4                                     OK")
    print(f"  size      {size} bytes (expected {EXPECT_BYTES})", end="  ")
    if size != EXPECT_BYTES:
        raise SystemExit("REFUSED: size mismatch")
    print("OK")
    dur = probe_duration(path)
    print(f"  duration  {dur:.2f}s (expected {EXPECT_DURATION_S:.2f}s)", end="  ")
    if abs(dur - EXPECT_DURATION_S) > DURATION_TOLERANCE_S:
        raise SystemExit("REFUSED: duration mismatch")
    print("OK")
    digest = sha256_file(path)
    print(f"  sha256    {digest}", end="  ")
    if digest != EXPECT_SHA256:
        raise SystemExit("REFUSED: hash mismatch")
    print("OK")
    return dur


def main():
    media = sys.argv[1] if len(sys.argv) > 1 else "hi.mp4"
    if not os.path.exists(media):
        raise SystemExit(
            f"REFUSED: media not found at {media}. Re-acquire it with the command in this "
            f"module's docstring; it is deliberately not committed.")

    duration = validate(media)

    stamps = []
    t = 0.0
    while t < duration:
        stamps.append(round(t, 3))
        t += INTERVAL_S
    print(f"\nSAMPLING  {len(stamps)} frames at {INTERVAL_S}s intervals, "
          f"t=0.000 .. {stamps[-1]:.3f}, crop {CROP}")

    tiles = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, ts in enumerate(stamps):
            png = os.path.join(tmp, f"f{i:04d}.png")
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{ts:.3f}",
                 "-i", media, "-frames:v", "1", png],
                check=True)
            tiles.append(Image.open(png).crop(CROP).copy())
            if (i + 1) % 40 == 0:
                print(f"    {i + 1}/{len(stamps)}")

    tw, th = tiles[0].size
    rows = (len(tiles) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * tw, rows * th), "white")
    for i, tile in enumerate(tiles):
        sheet.paste(tile, ((i % COLS) * tw, (i // COLS) * th))
    out = os.path.join(FRAMES, OUT_NAME)
    sheet.save(out)
    print(f"\nWROTE  {out}  {sheet.size}  ({len(tiles)} tiles, {COLS}x{rows})")
    print(f"       sha256 {sha256_file(out)}")
    print("\nREAD ORDER: left-to-right, top-to-bottom; tile i is t = i * "
          f"{INTERVAL_S}s. Every tile shows the active timeframe as part of the legend string.")


if __name__ == "__main__":
    main()
