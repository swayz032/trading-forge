import os
import sys

sys.path.insert(0, os.getcwd())

from src.engine.extraction import evidence_relevance as er

primary = "That gives us an idea of the direction in which the market wants to go for the day."

rivals = [
    "At 9:30 AM ET, define the initial range by marking the high and low of the first 5-minute candle.",
    "Wait for the 1-minute candle to close outside of the 5-minute range (breakout).",
    "Wait for a fair value gap sequence to print outside the range.",
    "The fair value gap sequence is valid once its third candle has been printed.",
    "Enter the trade (long or short) on the closure of the third candle of the FVG sequence.",
    "The trade must be initiated at 9:30 AM ET New York time.",
    "The stop is placed at the bottom of the FVG candle, including the wick, to allow room for breathing.",
    "The strategy uses a fixed mechanical target based on a 2R risk-to-reward ratio.",
]

candidates = [
    "The direction of the 1-minute breakout out of the 9:30 five-minute range sets the trade direction: a break to the downside is taken short; a break to the upside is taken long.",
    "The direction of the breakout sets the trade direction.",
    "The breakout gives the direction the market wants to go for the day.",
    "The breakout gives an idea of the direction the market wants to go.",
    "The direction the market wants to go for the day determines the trade direction.",
]

for c in candidates:
    v = er.evaluate_evidence_relevance(c, primary, rival_conditions=rivals, floor=0.10)
    print(repr(c))
    print("  ", v)
