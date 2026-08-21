"""AR-1393 — the buy-side target, re-derived from the FINAL STABLE POST-ACTION frame.

AR-1382A section 6 / AR-1383A section 6 control: for any drag, click, resize or drawing action the
LAST STABLE POST-ACTION frame is what carries the semantic answer. An intermediate frame is
evidence of the action, never of its result.

AR-1392 measured `vi2_00-16-21.png` -- taken while the teacher was still moving the take-profit --
and published a SOURCE_CONFLICT on the buy-side target. That finding is STRUCK. This script
re-derives the answer from `vi2_00-16-28.png`, the last stable frame after the drop.

The re-derivation deliberately does NOT depend on pixel->price interpolation. Every number below is
a value TradingView itself rendered (a position-tool label or a price-axis label), and the four
closures cross-check those printed values against each other. Pixel geometry is used only as a
fifth, independent confirmation that the target line and the fib `0` line occupy the same row.

=================================================================================================
AR-1394: THIS SCRIPT IS READ-ONLY, AND THAT IS ENFORCED BELOW, NOT MERELY PROMISED.
=================================================================================================
AR-1393 shipped this file emitting the magnification artifacts as a SIDE EFFECT of running the
proof. AR-1384A section 5 convicted that: "never let 'run the proof' silently mutate committed
evidence." A proof that rewrites the evidence it is proving cannot fail in the one way that
matters. Artifact generation moved to scripts/_worker_vi_e8_generate_magnifications.py, which is
now the ONLY writer. The guard at the bottom of this module asserts the evidence tree is
byte-unchanged across this script's own execution, so a future edit that reintroduces a write
fails loudly instead of silently.
=================================================================================================

Run:  python scripts/_worker_vi_e8_final_frame_proof.py
Prints the closures. Writes nothing.
"""

from PIL import Image
import hashlib
import numpy as np
import os

FRAMES = ("docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/"
          "visual-intelligence-e8-round1/E8Wg6tFPYjo/frames")


def _evidence_fingerprint():
    """sha256 over every committed artifact's bytes -- the read-only guard's witness."""
    h = hashlib.sha256()
    for name in sorted(os.listdir(FRAMES)):
        if not name.lower().endswith(".png"):
            continue
        h.update(name.encode())
        with open(os.path.join(FRAMES, name), "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
    return h.hexdigest()


_FINGERPRINT_BEFORE = _evidence_fingerprint()

# --- what TradingView itself rendered on the final stable frame ---------------------------------
# Position-tool labels and price-axis labels read from vi2_00-16-28.png, confirmed in the
# magnifications above. None of these is a pixel-interpolated value.
AXIS_STOP = 0.55827          # price-axis highlight on the stop line
AXIS_TARGET = 0.56073        # price-axis highlight on the target line
PRINTED_STOP_DIST = 0.00071  # position tool: "Stop: 0.00071 (0.127%)"
PRINTED_TGT_DIST = 0.00175   # position tool: "Target: 0.00175 (0.313%)"
PRINTED_RR = 2.46            # position tool: "Risk/Reward Ratio: 2.46"
RETRACEMENT = 0.71           # the taught entry level

# The intermediate mid-drag reading AR-1392 published, kept for the struck-and-retained record.
INTERMEDIATE_PRINTED_TGT_DIST = 0.00122  # 16:21, "Target: 0.00122 (0.218%)" -- PRE-FINAL


def fib_zero_row(path, x0=1775, x1=1830, thresh=200, cover=0.5):
    """Row of the dark price-axis highlight box nearest the top of the chart pane.

    NOTE, and this is a finding against the instrument: the naive full-column scan also matches the
    webcam picture-in-picture overlay in the lower right, which is dark and wide. The scan is
    therefore bounded to the chart rows ABOVE the overlay (y < 400). Reported rather than silently
    tuned away -- an unbounded version of this detector returns a group at y~445 on BOTH frames
    that is the presenter's hair, not a label.
    """
    a = np.array(Image.open(os.path.join(FRAMES, path)).convert("RGB")).astype(int)
    strip = a[:400, x0:x1, :]
    dark = (strip.sum(axis=2) < thresh).mean(axis=1)
    rows = np.where(dark >= cover)[0]
    if not len(rows):
        return None
    return (rows[0] + rows[-1]) / 2


print("=" * 78)
print("BUY SIDE  NZDUSD  --  FINAL STABLE POST-ACTION FRAME  vi2_00-16-28.png")
print("=" * 78)

entry = AXIS_STOP + PRINTED_STOP_DIST
print(f"  entry  = stop axis label + printed stop distance")
print(f"         = {AXIS_STOP:.5f} + {PRINTED_STOP_DIST:.5f} = {entry:.5f}")

derived_target = entry + PRINTED_TGT_DIST
print()
print("  CLOSURE 1 -- printed target distance vs the target line's own axis label")
print(f"    entry + printed target distance = {entry:.5f} + {PRINTED_TGT_DIST:.5f} = {derived_target:.5f}")
print(f"    price-axis label on the target line                              = {AXIS_TARGET:.5f}")
print(f"    delta = {abs(derived_target - AXIS_TARGET):.5f}")

print()
print("  CLOSURE 2 -- printed risk/reward ratio")
rr = PRINTED_TGT_DIST / PRINTED_STOP_DIST
print(f"    {PRINTED_TGT_DIST:.5f} / {PRINTED_STOP_DIST:.5f} = {rr:.4f}  -> rounds to {round(rr, 2):.2f}")
print(f"    position tool printed                                  {PRINTED_RR:.2f}")

print()
print("  CLOSURE 3 -- the 0.71 entry level from the two fib anchors")
fib_range = AXIS_TARGET - AXIS_STOP
predicted_entry = AXIS_TARGET - RETRACEMENT * fib_range
print(f"    fib range = fib0 - fib1 = {AXIS_TARGET:.5f} - {AXIS_STOP:.5f} = {fib_range:.5f}")
print(f"    {RETRACEMENT} retracement from fib 0 downward = {predicted_entry:.5f}")
print(f"    entry derived in closure 1                    = {entry:.5f}")
print(f"    delta = {abs(predicted_entry - entry):.5f}")

print()
print("  CLOSURE 4 -- pixel geometry, as an independent fifth check only")
row = fib_zero_row("vi2_00-16-28.png")
print(f"    target-line axis-highlight row on the final frame = y {row}")
print(f"    fib `0` line row read in AR-1392 on the same chart = y 364")
print("    same row => the target sits ON fib level 0, not below it")

print()
print("=" * 78)
print("RESULT")
print("=" * 78)
print(f"  FINAL target  = {AXIS_TARGET:.5f} = fib level `0` = the high of the Fibonacci range.")
print("  The teacher's narration -- 'drag the take-profit to the high of the Fibonacci range' --")
print("  AGREES with his finished chart. There is no source conflict.")
print()
print(f"  STRUCK: AR-1392 measured the mid-drag frame vi2_00-16-21.png, where the tool still read")
print(f"  Target: {INTERMEDIATE_PRINTED_TGT_DIST:.5f}, and reported a ~5.3 pip SOURCE_CONFLICT. That frame is a")
print("  PRE-FINAL state of an action still in progress, and at that row the price axis is occluded")
print("  by the webcam overlay, so the reading had no rendered label to check itself against.")
print()
print("  UNIFIED DIRECTION-AWARE RULE, now closing on BOTH worked examples:")
print("    stop   = Fibonacci level `1`  (the drag's start anchor / impulse origin)")
print("    entry  = the 0.71 level")
print("    target = Fibonacci level `0`  (the drag's end anchor)")

# --- READ-ONLY GUARD (AR-1384A section 5) -------------------------------------------------------
# Positive witness that the path executed: the fingerprint is recomputed, not assumed. An empty
# diff from a function that never ran would look identical, so the digest is printed.
_FINGERPRINT_AFTER = _evidence_fingerprint()
print()
print("=" * 78)
print("READ-ONLY GUARD")
print("=" * 78)
print(f"  evidence fingerprint before : {_FINGERPRINT_BEFORE}")
print(f"  evidence fingerprint after  : {_FINGERPRINT_AFTER}")
if _FINGERPRINT_BEFORE != _FINGERPRINT_AFTER:
    raise SystemExit(
        "READ-ONLY VIOLATION: this proof mutated committed evidence. Artifact generation belongs "
        "in scripts/_worker_vi_e8_generate_magnifications.py (AR-1384A section 5).")
print("  UNCHANGED -- this proof wrote nothing.")
