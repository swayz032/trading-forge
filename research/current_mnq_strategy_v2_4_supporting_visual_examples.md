# Current MNQ v2.4 — Supporting Visual Examples

Status: **SUPPORTING-ONLY / NON-AUTHORITATIVE / NO EDGE CERTIFICATION**

These notes capture the generic chart concepts visible in the user-supplied teaching screenshots from the current review session. The screenshots are not committed to the repository and are not promoted into the immutable trader-fidelity gold set because they are generic instructional examples rather than direct trader-labeled MNQ evidence.

They may be used to improve replay-lab presentation, disagreement taxonomy, and reviewer prompts. They may **not** change entry thresholds, stop distance, target distance, force thresholds, clean-edge gates, or any frozen strategy invariant by themselves.

## Visual concepts supported by the examples

1. **Support/resistance is a zone, not a single pixel-perfect line.** The examples repeatedly render horizontal reaction areas as bands around prior interaction prices.
2. **A useful level is associated with decisive displacement away from a swing high or swing low.** The instructional example explicitly calls for price to move away drastically from the swing area.
3. **Multiple independent rejections strengthen the visual importance of a level.** The examples show repeated reactions around the same horizontal area rather than relying on one incidental touch.
4. **The same area may act as both support and resistance after price crosses it.** The examples explicitly illustrate role reversal / flip behavior.
5. **Decision-relevant levels should be near enough to current price to matter.** Far-away historical extremes can remain context, but the replay grader should emphasize nearby actionable/reaction structure.
6. **Reaction zones can frame both breakout and rejection decisions.** The examples show price approaching a zone, rejecting it, or breaking through and then interacting with it again.

## Relationship to frozen MNQ v2.4 semantics

These generic examples are consistent with—but do not independently establish—the following already-frozen MNQ v2.4 ideas:

- entry-authorized key locations are represented as price areas rather than one exact line;
- established key-zone paths require repeated independent rejection evidence;
- a location may have support/resistance role history;
- replay grading should emphasize nearest decision-relevant zones rather than dozens of stale historical levels;
- price must still satisfy the full master equation, including candle story, sustained intra-candle force, room to first reaction, first-A-plus, and daily-bullet constraints;
- a visually strong level does **not** authorize a trade by itself.

## Separation from trader gold

The authoritative trader-fidelity set remains `current_mnq_strategy_v2_4_user_fidelity_gold.json`. Direct trader screenshots/videos and explicit trader labels outrank generic teaching examples whenever there is any tension.

The teaching examples are therefore classified as:

`GENERIC_VISUAL_SUPPORT -> REVIEW_PROMPT / UI / DISAGREEMENT_TAXONOMY ONLY`

and never as:

`GENERIC_VISUAL_SUPPORT -> NEW TRADING RULE OR EDGE CLAIM`.

## Replay-lab use

When reviewing Human-vs-Bot disagreements, these examples justify asking the human reviewer to mark:

- the nearest meaningful support/resistance **zone** rather than an exact line;
- whether the area has repeated rejection evidence;
- whether it has flipped support/resistance roles;
- whether price previously moved away decisively from the area;
- whether the zone is actually decision-relevant at the replay clock.

The bot answer remains governed by the executable v2.4 key-level, target, candle-story, and force modules. Generic examples cannot override a bot `NO_TRADE` or create an `ENTER` label.
