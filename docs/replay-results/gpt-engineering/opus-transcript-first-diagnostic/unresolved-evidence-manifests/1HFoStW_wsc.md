# Unresolved-evidence manifest — 1HFoStW_wsc

Per AR-1378A §7 Lane C. Lists ONLY questions that remain after the known role/binding representation
defects (AR-1378A §5A/§5C, the struck setup-role HIGH and the four legitimate atomic-binding PARTIALs)
are removed from the round-2 candidate. This is preparation for a possible Visual Intelligence evidence
lane, NOT authorization to guess from images and NOT a re-run of blind text-only reconstruction.

Candidate inspected: `docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-2-fresh-opus/1HFoStW_wsc/fresh_source_candidate.json`.
Transcript: `src/engine/extraction/fixtures/source-evidence/1HFoStW_wsc.transcript.txt`.

## Source format (bears on visual plausibility below)

MEASURED: the transcript contains essentially ZERO chart-manipulation cues -- a single occurrence of
the word "click" and no `draw`, `cursor`, `zoom`, `arrow tool`, or `hover` anywhere in the source, versus
12 such cues in 7ieYBa7Z-Hg's transcript over a comparable length. This reads as a narrated,
checklist-structured explainer ("First... Second... Third...", stat callouts like "68%", "95%",
"0.3%") rather than a live chart walkthrough. Visual resolution of the open questions below is
correspondingly LESS likely than for a screen-recorded strategy video, though it cannot be ruled out
without actually watching the source.

## 1. Exact valid price-action trigger at VWAP

**What the text settles:** the three-confirmation entry model names "price action signal at VWAP" as
confirmation #1 (`"First, price action signal at VWAP."`), and separately teaches exactly three named
candle readings at a VWAP touch: a long-wick rejection (`"A long wick rejection shows institutional
defense."`), a weak doji (`"A weak doji shows uncertainty."`), and a strong close-through with volume
(`"But a strong close through VWAP with volume, that's capitulation."`).

**What remains open:** the transcript never states which of these three readings is the valid,
tradable "price action signal" required by confirmation #1, nor whether more than one qualifies, nor
whether the doji reading (explicitly framed as "uncertainty") is tradable at all or is instead a
no-trade signal. Candidate's own `source_gaps.entry trigger specification` already discloses this
honestly; it remains unresolved rather than fabricatable.

**Visual plausibility:** LOW. Nothing in the transcript suggests these three candle types are ever shown
on an actual chart in this video -- they are stated as abstract definitions with no cursor/annotation
language anywhere nearby. If this video contains no on-screen candle examples, the answer is genuinely
absent from THIS source, not merely unseen by a text-only reader.

## 2. Deterministic long vs. short trigger mapping

**What the text settles:** a directional FADE rule keyed to price's position relative to VWAP --
`"Above VWAP, look for shorts back to VWAP. Below VWAP, look for longs back to VWAP."` -- and a
higher-timeframe VWAP-stack bias confirmation (#3). These give the CONTEXT/bias direction.

**What remains open:** confirmation #1 ("price action signal at VWAP", the actual trigger candle) has
no stated mapping from candle-reading-type to trade direction. It is not established in the text whether,
say, a long-wick rejection always means "go long" (rejecting a move away from VWAP back toward it) or
whether the SAME reading could mean either direction depending on which side of VWAP price approached
from. Item 1 and item 2 are related but distinct: item 1 asks which reading is valid at all; item 2 asks
how a valid reading maps to long vs. short once the context/fade direction from confirmation #3 is
already known.

**Visual plausibility:** LOW, for the same reason as item 1 -- no chart-cursor language anywhere in the
transcript suggests a demonstrated example exists to map a specific candle shape to a specific executed
direction.

## 3. Missing execution timeframe / anchor selection needed for compilation

**What the text settles:** daily, weekly, monthly, quarterly and yearly VWAP are all separately taught,
each with its own described character (`"Daily VWAP resets every session..."`, `"Weekly VWAP captures the
bigger swing trade positioning."`, etc.), plus five alternative/event-based anchor types (event-anchored,
previous-day-high/low, weekly-open, last-volume-spike, and the default session VWAP). The hierarchy rule
for CONFLICTING bias signals is stated (`"weekly wins... monthly wins... longer time frame always has
more institutional commitment"`), but that only resolves disagreement between timeframes already in play.

**What remains open:** (a) no chart execution timeframe (1m/5m/15m/etc.) is ever stated anywhere in the
transcript -- the candidate's own `source_gaps.execution_timeframe` already discloses this; (b) no rule
states WHICH of the five anchor types supplies the entry level for a given trade, beyond the implicit
default of session VWAP when no special condition (an event, a failed standard VWAP) is mentioned.

**Visual plausibility:** LOW. An execution timeframe is normally visible as a chart-panel setting in a
screen recording; this video shows no chart-cursor evidence at all, so there is no textual signal that a
literal chart with a visible timeframe setting ever appears on screen. Genuinely likely to be absent from
this source rather than merely unseen.

## Disposition

All three questions are honestly disclosed gaps in the round-2 candidate, not candidate fabrication or
invention (AR-1378A §5C/§5D). None may be resolved by another blind text-only Opus reconstruction round.
Given the near-total absence of chart-manipulation language in this transcript (1 cue vs. 7ie's 12), this
video is a WEAKER candidate for the Visual Intelligence lane than 7ieYBa7Z-Hg -- a visual pass here is
more likely to confirm genuine absence than to supply new resolving facts, though that should be verified
by an actual pass rather than assumed. Absent new evidence, all three remain `source_gaps` entries in any
future candidate for this video, and 1HFoStW_wsc stays rejected under its current SHA per AR-1378A §5.
