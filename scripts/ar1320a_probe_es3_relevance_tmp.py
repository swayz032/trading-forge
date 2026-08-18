import os
import sys

sys.path.insert(0, os.getcwd())

from src.engine.extraction import evidence_relevance as er

cond = "Entering on the closure confirms the FVG structure."
primary = "my entry is going to be on the closure of that third candle"
secondary = (
    "in order for this fair value gap to be a valid fair value gap, the fair "
    "value gap has to actually be formed. And the way that happens is when "
    "the third candle of the sequence has been printed"
)
combined = primary + " " + secondary

rivals = [
    "At 9:30 AM ET, define the initial range by marking the high and low of the first 5-minute candle.",
    "Wait for the 1-minute candle to close outside of the established 5-minute range (breakout).",
    "Wait for a Fair Value Gap (FVG) sequence to form outside of the 5-minute range.",
    "Enter the trade (long or short) on the closure of the third candle of the FVG sequence.",
]

for name, q in [("primary alone", primary), ("secondary alone", secondary), ("combined", combined)]:
    v = er.evaluate_evidence_relevance(cond, q, rival_conditions=rivals, floor=0.10)
    print(name)
    print("  ", v)
