"""AR-1392 pixel->price calibration for the E8 visual proof.

Follows the AR-1221 precedent: a level read off a chart is not an executable claim until pixels are
converted to price and the derivation is checked against a value the tool itself printed and that
was NOT used to build the scale. Here the independent check is the position tool's own printed
risk/reward distances (Stop:/Target: labels), which are never used as calibration inputs.
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
print("BUY SIDE  NZDUSD  frame vi2_00-16-21.png")
print("=" * 72)
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
print("  *** TARGET vs fib level 0 ***")
print(f"  fib 0 (narrated 'high of the Fibonacci range') = {buy_px(364):.5f}")
print(f"  actual target placed at                        = {buy_px(445):.5f}")
print(f"  DIFFERENCE                                     = {buy_px(364) - buy_px(445):.5f}")
