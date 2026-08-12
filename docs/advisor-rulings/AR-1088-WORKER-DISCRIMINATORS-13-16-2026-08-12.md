# AR-1088 (worker) — DISCRIMINATORS 13 AND 16 CLOSE AS TESTS, AND I NAME THE THREE THAT DID NOT

**Governing:** AR-1082 §5.6 / AR-1079 §10 · **Pin:** `1e1e872c` (pushed)

## 1. TWO MORE CLOSED, BOTH AS REAL TESTS

**13 — the taught `r_multiple` is CONSUMED, not a house constant.** The artifact is the only thing that changes between the two arms: `spec.source_risk.target.r_multiple` `2 → 3` on the SAME frame moves the executable target `134.0 → 141.5` while entry and stop stay identical. **A hard-coded 2R satisfied every other assertion in this file until now** — the source teaches 2R, which is exactly what made it the most plausible thing to get wrong invisibly.

**16 — a pre-entry touch inside the decision candle cannot exit the trade.** Until now this held STRUCTURALLY (the exit scan starts at `entry_idx + 1`) with no test, which I named to the grader as a weakness. Opening that scan to the entry bar would have been silent. It is now RED under exactly that mutation.

## 2. MY FIRST 16 FIXTURE WAS GEOMETRICALLY IMPOSSIBLE

I pushed bar 8's low below the stop and got **zero trades** — because a bullish FVG at bar 8 REQUIRES `low[8] > high[6]`. **Lowering the decision candle's low destroys the gap that makes it the decision candle.**

★ `A MUTATION THAT DESTROYS ITS OWN SUBJECT IS NOT A DISCRIMINATOR.`

Solved rather than guessed: `high[6] < low[8] < low[7]` with `high[6] > ORH` satisfies all three constraints at once, and keeps the stop and risk **identical** to the canonical fixture so the two runs stay comparable. The reasoning is in the test, not in this report, because that is where the next reader will be.

## 3. WHAT IS STILL NOT A COMMITTED TEST — NAMED, NOT IMPLIED

- **11, 14, 15 are ABLATION-SHAPED.** "Reintroduce the house ceiling / Style-C partials / the +1 roll" all ask for production code to be mutated, which a committed test cannot do to itself. They are covered by the ablation matrices in `4936aae8` and this commit — **evidence, not guards.**
- **12** needs a frame where the taught anchor is absent, which this geometry cannot produce without destroying the event that needs it. Open.

★ `AN ABLATION IS EVIDENCE; IT IS NOT A GUARD.`

**PROOF:** 17 green in the file, 90 across the four source suites. Two ablations, each killing **exactly** its own test.

## 4. STATUS

AR-1082 §5 step 6 moves from PARTIAL to **PARTIAL-NAMED**: 13 and 16 closed as tests; 11, 14, 15 covered by ablation only; 12 open.

Unchanged and unstarted, still awaiting your ruling: **F-2** (the `Exit Timestamp` prop-sim false positive — my recommendation for the next unit) · **F-4** (97.5% signal-to-trade collapse) · **F-3** (the vertical route does not discriminate the warmup rebase) · the unsorted-frame contiguity hypothesis.

**Pin `1e1e872c`.**
