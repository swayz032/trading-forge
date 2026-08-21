"""AR-1394 — THE ONLY WRITER of the E8 magnification artifacts.

AR-1384A section 5 convicted AR-1393's evidence workflow: the SEMANTIC PROOF script emitted
artifacts as a side effect, so "run the proof" silently rewrote committed evidence. Under a
different Pillow build that rewrite is not byte-identical, and the manifest then fails on five
files that nobody edited.

THE SPLIT, and it is the load-bearing half:

    _worker_vi_e8_final_frame_proof.py   READS. Writes nothing. Ever.
    _worker_vi_e8_generate_magnifications.py (this file)   WRITES. Nothing else does.

A proof that mutates the evidence it is proving cannot fail in the one way that matters, so it is
not a proof. That defect is real in EVERY environment; the byte divergence only made it visible.

ENCODER PORTABILITY: PNG bytes are not a stable identity across Pillow/zlib builds -- filter choice
and compression level may differ while the image is pixel-for-pixel identical. So the manifest
carries BOTH hashes per artifact (see _worker_vi_e8_hash_manifest.py):

    PIXELS  sha256 over the decoded RGB buffer + dimensions  -- content identity, PORTABLE
    BYTES   sha256 over the encoded file                     -- exact-file identity, LOCAL

The portable reproducibility claim is over PIXELS. Byte equality is recorded, never claimed
portable. AR-1393 proved idempotence in ONE environment and reported it as reproducibility; that
over-scoped claim is withdrawn.

PREREQUISITE: the source frames must already be committed. This script derives magnifications from
committed frames only -- it never touches the source media.

Run:  python scripts/_worker_vi_e8_generate_magnifications.py [--check]
      --check regenerates into memory and compares PIXEL hashes against what is on disk,
              WITHOUT writing. Exit 0 = reproducible, exit 1 = drift.
"""

import hashlib
import os
import sys

from PIL import Image

_DEFAULT_BASE = ("docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/"
                 "visual-intelligence-e8-round1/E8Wg6tFPYjo")

# AR-1385A section 4: the mutation controls must never write into the real evidence tree, so the
# evidence root is parameterized. TF_VI_E8_EVIDENCE_ROOT is TEST-ONLY -- it is read here and by
# _worker_vi_e8_hash_manifest.py so the regression harness can point both at a temporary copy.
# Unset (the normal case) resolves to the committed tree exactly as before.
BASE = os.environ.get("TF_VI_E8_EVIDENCE_ROOT", _DEFAULT_BASE)
FRAMES = os.path.join(BASE, "frames")

# (source frame, crop box l/t/r/b, integer scale, output name)
MAGNIFICATIONS = [
    ("vi2_00-16-21.png", (1100, 410, 1920, 480), 3, "zoom_vi2_pre_16-21_target.png"),
    ("vi2_00-16-24.png", (1100, 330, 1920, 480), 2, "zoom_vi2_during_16-24_drag.png"),
    ("vi2_00-16-28.png", (1150, 330, 1920, 400), 3, "zoom_vi2_post_16-28_target.png"),
    ("vi2_00-16-28.png", (1150, 600, 1920, 790), 2, "zoom_vi2_post_16-28_stop.png"),
    ("vi2_00-16-28.png", (1770, 340, 1850, 470), 8, "zoom_vi2_post_16-28_axis.png"),
    # AR-1394 / VI-E8-3A: the Currency Pros panel -- the 4H decision state rendered on the 15m
    # chart. These two are the primary evidence that computation ownership is EXTERNAL, not absent.
    ("vi3_00-02-30.png", (1600, 60, 1920, 270), 3, "zoom_vi3_cp_panel_premium.png"),
    ("vi3_00-12-42.png", (1600, 60, 1920, 270), 3, "zoom_vi3_cp_panel_discount.png"),
]


def pixel_sha256(im):
    """Encoder-independent identity: the decoded RGB buffer plus its dimensions."""
    rgb = im.convert("RGB")
    h = hashlib.sha256()
    h.update(f"{rgb.width}x{rgb.height}|".encode())
    h.update(rgb.tobytes())
    return h.hexdigest()


def render(src, box, scale):
    im = Image.open(os.path.join(FRAMES, src))
    w, h = box[2] - box[0], box[3] - box[1]
    return im.crop(box).resize((w * scale, h * scale), Image.LANCZOS)


def main():
    check_only = "--check" in sys.argv
    print(f"Pillow {Image.__version__ if hasattr(Image, '__version__') else 'unknown'}")
    print("MODE:", "CHECK (writes nothing)" if check_only else "GENERATE")
    print()

    drift = []
    for src, box, scale, out in MAGNIFICATIONS:
        rendered = render(src, box, scale)
        want = pixel_sha256(rendered)
        path = os.path.join(FRAMES, out)

        if check_only:
            if not os.path.exists(path):
                print(f"  MISSING  {out}")
                drift.append(out)
                continue
            have = pixel_sha256(Image.open(path))
            status = "OK" if have == want else "PIXEL DRIFT"
            print(f"  {status:<11} {out}")
            if have != want:
                print(f"              on disk  {have}")
                print(f"              rendered {want}")
                drift.append(out)
        else:
            rendered.save(path)
            print(f"  wrote {out:<34} from {src} {box} x{scale}")
            print(f"        pixels {want}")

    if check_only:
        print()
        if drift:
            print(f"NOT REPRODUCIBLE: {len(drift)} artifact(s) drifted -> {', '.join(drift)}")
            return 1
        print(f"REPRODUCIBLE: all {len(MAGNIFICATIONS)} magnifications match by decoded pixels.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
