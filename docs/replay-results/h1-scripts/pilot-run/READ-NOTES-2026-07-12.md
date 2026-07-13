# H1 Pilot — FINAL READ notes (all 16, read once) — 2026-07-12

Scope (Law 7): sealed-16 (`8e39ffe1`) · taxonomy `h1-pilot-2026-07-12` · extractor
`gemma4:e4b-it-qat:minimal-8field-pass-l:content-c37f24c1c01f3ad4` (tier-1 + tier-3, tier-2 retired) ·
anchor-locator (real gemma) · two blind control-gated raters. Read ONCE from the first valid complete
run. Verdicts in `FINAL-READ.json`; this file is the mechanism + robustness record.

## THE TWO VERDICTS (separate, per Addendum 7)
- **FIDELITY = MISS.** Certificate-grade videos = **0 / 16** (fraction 0.0) vs the ≥60% bar → §2 QUALITY MISS.
- **ECONOMICS = WITHIN CEILING.** Mean per-video-AGGREGATE adjudications = **13.94** ≤ ~15 (Addendum 8 §3:
  verdict on the MEAN). Annotation: 7/16 videos exceed 15 (max 20 = WEhmadJArQo), mean 8.92 per strategy.
- Net: **"economics YES, fidelity NO"** — the mirror image of the pre-written "fidelity yes / economics no"
  expectation. The fork is AFFORDABLE; it does not yet PRODUCE certificates at the required fidelity.

## MECHANISM (0/16 is real, not a join/rule artifact — verified)
Phase-1 totals: 25 strategies, 253 spine conditions; **224 anchored / 29 unanchored (88.5% grounded)**;
tier-1 classifies **4/253 (~1.6%)** → ~98% tier-3 load; `fallthrough_axis2_zero_content_overlap` = 0.
pilot_grade requires EVERY spine condition of a strategy to be anchored AND classified (tier1/3) AND
(for tier-3) two-rater-confirmed support AND live lints pass. Failure is dominated by two buckets:
1. **Unanchored** (29 conditions) — locator declined / no literal grounding.
2. **Support-downgrade** (Addendum 4, instrument's own): among the 220 anchored fallthrough targets, two
   blind raters judged support = **both-confirmed 165 (75.0%)**, **both-agree partial/denied 43 (19.5%)**,
   **contested 12 (5.5%)**. Role determinate-agreement was high (213/220 = 96.8%) — the miss is a
   SUPPORT (condition-faithfulness) miss, not a role miss.
With ~25% of anchored conditions non-confirmed and strategies carrying 6–22 conditions each, no strategy
is fully clean. Closest: `dV7chra4u4Q` s0 (18/21 ok; 2 unanchored + 1 unresolved).

## ROBUSTNESS to the conductor's contested-resolution rule (R2/R3)
The frozen read uses the pre-committed STRICT rule (contested role/support → downgrade): **0/16**.
Sensitivity — under the MOST LENIENT defensible reading (contested treated as PASS; only unanchored,
both-agree-denied/partial, or both-agree-cannot-determine block): exactly **1/16** (only `2DXQqwKSwJE` s0
becomes clean, spine 8). **Both readings are decisive misses vs 60%** — the verdict does NOT hinge on the
ambiguous contested rule. Recorded so the re-verifier can confirm the choice is immaterial to the outcome.

## RECORDED SIGNALS (never tuned; Addendum 4/5 pre-commitments)
- **Tier-1 absorption ~1.6%** — the Addendum-7 preview realized: traders narrate; tier-1 is
  prescriptive/low-recall; tier-2 dead → narration floods tier-3.
- **Paraphrase-drift / support-drift**: 25% of located anchors judged partial/denied — the extractor's
  paraphrased conditions frequently are not faithfully expressed by their best literal transcript span.
- **Axis-3 sampling audit** (the named residual, monitoring only): 3 tier-1 FIRES sampled, **all 3
  both-partial** (CLDEIsNpVRc, _LS6qcSlDCs, WEhmadJArQo) — even the rare tier-1-classified fires show
  grounding drift. Statistically visible, not mechanically gated (correct per Addendum 5).
- `fallthrough_axis2_zero_content_overlap` = 0 (F-1 short-symbol tax did not bite this set).
- **propose forced-abstain = 1** (NOT 0): one condition hit 3 empty gemma responses → honest UNANCHORED
  (fix (b) decline semantic). One of the 29 unanchored is this; the other 28 are genuine locator declines
  / non-literal proposals.

## §2 ROUTING (pre-written, not decided here)
FIDELITY MISS → iterate under the 2-pass budget; two passes short → the fidelity instrument itself falls
short at human-in-loop cost (deeper finding → H1 'not-yet' / source-agnostic reconsideration). ECONOMICS
within ceiling means the miss is NOT an affordability problem. Not an H2 falsification.
