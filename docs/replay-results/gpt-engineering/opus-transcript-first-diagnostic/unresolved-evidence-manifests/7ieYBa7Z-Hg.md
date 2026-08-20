# Unresolved-evidence manifest — 7ieYBa7Z-Hg

Per AR-1378A §7 Lane C. Lists ONLY questions that remain after the known role/binding representation
defects (AR-1378A §4B/§4D) are removed from the round-2 candidate. This is preparation for a possible
Visual Intelligence evidence lane, NOT authorization to guess from images and NOT a re-run of blind
text-only reconstruction (explicitly disallowed by AR-1378A §4E/§7 Lane C until one of these questions
gets a new evidence channel or a new direct source fact).

Candidate inspected: `docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-2-fresh-opus/7ieYBa7Z-Hg/fresh_source_candidate.json`.
Transcript: `src/engine/extraction/fixtures/source-evidence/7ieYBa7Z-Hg.transcript.txt`.

## Source format (bears on visual plausibility below)

MEASURED: the transcript contains 12 chart-manipulation cues (`zoom` x5, `click` x2, `cursor`, `draw` x3,
`top right`) -- e.g. "I'm going to bring out the arrow tool here", "I call them mms". This is a live
chart-annotation screen recording, not a narrated-only listicle. Visual resolution is therefore
plausible in principle for questions that concern what a specific worked example shows on screen.

## 1. Stop vs. invalidation relationship per entry method

**What the text settles:** the transcript explicitly distinguishes the two concepts once --
`"Is your stop at the what caused the breakup structure or the whole POI? The whole POI. Okay. Because
so you do have a fairly large stop. That that that's my invalidation though. That's not the stop."` --
and separately gives a concrete, SMALLER stop for each of the two named entry methods: `"place my stop
behind the 70%"` (50-entry) and `"your stop is behind that bullish candle"` (candlestick-structure
entry). The top-level `stop` object in the candidate is currently bound to a THIRD, ambiguous quote --
`"your stop or your invalidation of the idea is behind the 4hour POI"` -- which the educator's own later
clarification says is invalidation, not stop.

**What remains open:** is there a genuine top-level/default stop independent of which entry method is
chosen (i.e. does "behind the 4H POI" ever function as an actual executable stop on some trades), or is
the executable stop ALWAYS one of the two method-conditional values, with "behind the 4H POI" being
invalidation-only language that should not populate a top-level `stop` field in the compiled schema at
all? The text alone does not settle whether a representation with `stop = null` at top level (invalidation
recorded separately, actual stop supplied only inside each variant) is correct, or whether some third,
still-undiscovered stop concept exists.

**Visual plausibility:** LOW-to-MEDIUM. The two method-conditional stops (70% level, behind the
qualifying candle) are already textually complete and don't need video. Whether "behind the 4H POI" is
ever independently used as an executable stop is a definitional/schema question, not something a chart
frame would settle by itself -- but a demonstrated trade where the stop is placed and it is NOT at 70%/the
candle low AND not at the whole POI would falsify the two-methods-only reading. Classify as: genuinely
ambiguous in text; visual demonstration COULD supply a counter-example but is not guaranteed to.

## 2. Conditional target selection where the text does not settle a concrete case

**What the text settles:** five target types are taught, each with its OWN stated triggering condition,
not as a flat unranked list: (a) the high price retraced from -- general; (b) a prominent wick to the
left -- "when there's a prominent wick to the left"; (c) the beginning of that wick -- same condition as
(b); (d) an intervening higher-timeframe POI -- "if it's going to a higher time frame POI between where
I'm getting in and where I expect price to go"; (e) the opposite end of the range -- "in the range case".
These conditions are largely mutually exclusive by scenario (range trade vs. non-range trade; wick
present vs. absent; intervening POI present vs. absent).

**What remains open:** the source never states what happens when TWO of these conditions are
simultaneously true in the same concrete trade -- e.g. a non-range trade that has BOTH a prominent wick
to the left AND an intervening higher-timeframe POI between entry and the retraced-from high. No priority
or combination rule is given for that overlap case.

**Visual plausibility:** MEDIUM. A worked example on screen showing both conditions present at once, and
which one the educator actually marks as the target, would resolve this directly -- this is exactly the
kind of on-chart labeling this video's format uses elsewhere (POI boxes, wick labels). Genuinely
resolvable by video if such a dual-condition example happens to appear in this video; otherwise absent
from THIS source and would need a different video from the same educator.

## 3. Short-side executable trigger/trailing mirror, if any

**What the text settles:** direction is asserted only at the framing level -- `"That can be whether
you're bullish, whether you're bearish."` -- with no separate quote walking through a short-side worked
example. Every concrete mechanical passage in the transcript is phrased in one consistent orientation:
the qualifying setup is "price making higher highs and higher lows trading to a supply" (a short-context
setup), while the cited trailing-stop mechanic is "green candle lows... as price is impulsing" (a
long-context mechanic, i.e. trailing a long position through an up-impulse). These two halves of the
same taught sequence point in different directions and the transcript never explicitly states how they
chain together, nor supplies the mirrored short-context equivalents (a demand-side swing count, a
red-candle-highs trail).

**What remains open:** does the educator ever demonstrate the fully mirrored short-side version of (a)
the swing-count precondition applied to a demand instead of a supply, and (b) the trailing rule applied
to a down-impulse (red candle highs) rather than an up-impulse (green candle lows)? The text gives the
general "any direction" framing for the swing count (`"So any direction whether it's counter trend
whether it's with the trend..."`) but never gives the trail-direction mirror in words.

**Visual plausibility:** MEDIUM-HIGH. This video is a live chart walkthrough with multiple worked
examples visible on screen; if a short trade is chart-annotated anywhere in the source video (even
without being narrated as explicitly as the long examples), the on-screen stop-trail markings would
settle this. This is the single item on this manifest most likely to be resolved by a visual pass rather
than staying genuinely absent, precisely because the video format already demonstrates trades visually
rather than only describing them.

## Disposition

None of the above three questions may be resolved by inventing an answer or by another blind text-only
Opus reconstruction round (AR-1378A explicitly forbids this until one of these gets a new evidence
channel or new direct source fact). All three are candidates for a future Visual Intelligence pass over
the source video; #3 is the strongest candidate for that lane. Absent new evidence, all three remain
`source_gaps` entries in any future candidate for this video, and 7ieYBa7Z-Hg stays rejected under its
current SHA per AR-1378A §4.
