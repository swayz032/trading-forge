"""AR-1392 pixel->price calibration for the E8 visual proof.

Follows the AR-1221 precedent: a level read off a chart is not an executable claim until pixels are
converted to price and the derivation is checked against a value the tool itself printed and that
was NOT used to build the scale. Here the independent check is the position tool's own printed
risk/reward distances (Stop:/Target: labels), which are never used as calibration inputs.

===============================================================================================
AR-1393 CORRECTION -- READ BEFORE TRUSTING THE BUY-SIDE TARGET BLOCK BELOW.
===============================================================================================
The buy-side section of this script calibrates `vi2_00-16-21.png`, which is an INTERMEDIATE frame
captured while the teacher was still dragging the take-profit. Its arithmetic is correct and its
scale is sound; what it is NOT is the finished instruction. AR-1392 read the semantic answer off
it and published a buy-side target `SOURCE_CONFLICT`. AR-1383A section 5 struck that finding, and
AR-1393 re-derived the target from the last stable post-action frame, `vi2_00-16-28.png`, where the
target reads 0.56073 -- exactly Fibonacci level `0`, exactly as narrated. There is no conflict.

LAW (AR-1383A section 6): for any drag, click, resize or drawing action, the LAST STABLE
POST-ACTION frame carries the semantic answer. An intermediate frame is evidence that the action
occurred; it can never control the conclusion about the action's result.

The final-frame derivation lives in `scripts/_worker_vi_e8_final_frame_proof.py`. THAT script is
authoritative for the buy-side target. This one is retained unedited in its numbers (strike-and-
retain, not delete) so the record shows what was measured and why it misled, and its buy-side
TARGET block below is annotated in place as superseded.
===============================================================================================
"""

# --- inputs: y pixel positions read from the 1920x1080 frames, and price-axis anchors ---------

def line(p0, y0, p1, y1):
    """Return (price_at_y, per_px) for a linear price axis through two (price, y) anchors."""
    per_px = (p0 - p1) / (y1 - y0)
    return (lambda y: p0 - (y - y0) * per_px), per_px


print("=" * 72)
print("SELL SIDE  GBPAUD  frame vi1_00-07-48.png")
print("=" * 72)
# price-axis anchors: the two highlighted axis labels that sit on the fib 1 and fib 0 lines
sell_px, sell_per = line(2.02682, 316, 2.01851, 794)
print(f"  scale: {sell_per:.8f} price/px")
for name, y in [("fib 1 (top)", 316), ("0.75", 435), ("0.71 = ENTRY", 455), ("fib 0 (bottom)", 794)]:
    print(f"  {name:<18} y={y:<5} price={sell_px(y):.5f}")
entry_s = sell_px(455)
print(f"  derived STOP distance   = {abs(sell_px(316) - entry_s):.5f}   tool printed 0.00241")
print(f"  derived TARGET distance = {abs(entry_s - sell_px(794)):.5f}   tool printed 0.00590")
rng_s = sell_px(316) - sell_px(794)
print(f"  fib range = {rng_s:.5f}; 0.71 from level0 upward = {sell_px(794) + 0.71 * rng_s:.5f}")

print()
print("=" * 72)
print("BUY SIDE  NZDUSD  frame vi2_00-16-21.png   <-- INTERMEDIATE, MID-DRAG")
print("=" * 72)
print("  *** AR-1393: this frame is a PRE-FINAL state. The entry/stop readings below hold and")
print("  *** are corroborated on the final frame; the TARGET reading does NOT. See")
print("  *** scripts/_worker_vi_e8_final_frame_proof.py for the authoritative target.")
# price-axis anchors: two ordinary axis gridline labels, chosen independently of the fib/tool
buy_px, buy_per = line(0.56220, 139, 0.55840, 719)
print(f"  scale: {buy_per:.8f} price/px")
for name, y in [("fib 0 (top)", 364), ("TARGET", 445), ("0.71 = ENTRY", 631),
                ("0.75", 645), ("fib 1 (bottom) = STOP", 740)]:
    print(f"  {name:<22} y={y:<5} price={buy_px(y):.5f}")
entry_b = buy_px(631)
print(f"  derived STOP distance   = {abs(entry_b - buy_px(740)):.5f}   tool printed 0.00071")
print(f"  derived TARGET distance = {abs(buy_px(445) - entry_b):.5f}   tool printed 0.00122")
rng_b = buy_px(364) - buy_px(740)
print(f"  fib range = {rng_b:.5f}")
print(f"  0.71 predicted from fib0 downward = {buy_px(364) - 0.71 * rng_b:.5f}  (observed entry {entry_b:.5f})")
print()
print("  *** TARGET vs fib level 0 -- STRUCK BY AR-1383A section 5, RETAINED ***")
print(f"  fib 0 (narrated 'high of the Fibonacci range') = {buy_px(364):.5f}")
print(f"  target position AT THIS MID-DRAG INSTANT       = {buy_px(445):.5f}")
print(f"  difference at this instant                     = {buy_px(364) - buy_px(445):.5f}")
print()
print("  AR-1392 published that difference as a SOURCE_CONFLICT. IT IS NOT ONE. The teacher was")
print("  still moving the take-profit at 16:21; by 16:28 he has dropped it on fib 0 and the tool")
print("  prints Target: 0.00175, which closes exactly onto the 0.56073 axis label. Two further")
print("  reasons this frame was the wrong one to conclude from:")
print("    1. at this row the price axis is OCCLUDED by the webcam overlay, so there was no")
print("       TradingView-rendered label to check the interpolated reading against;")
print("    2. vi2_00-16-24.png shows the cursor still gripping the target handle -- the action")
print("       was visibly in progress in an already-committed frame.")
print("  Run scripts/_worker_vi_e8_final_frame_proof.py for the corrected derivation.")
