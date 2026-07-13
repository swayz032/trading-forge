# Config-pass content-preservation verdict (2026-07-13) — locator CLEARS, content FAILS

5 Claude graders examined the excess-drop videos (drop > minimal-misses). SILENCED = distinct, transcript-taught content lost, uncovered by any surviving condition.

| Video | dropped | SILENCED | redundant/fabricated | what was silenced |
|-------|:--:|:--:|:--:|---|
| 0xygpCMwxbQ | 9 | **3** | 6 | Strategy-1 exit spec: 2 targets emptied + stop anchor nulled (core content) |
| dV7chra4u4Q | 7 | **2** | 5 | Bookmap order-flow confluence + A+-selectivity filter |
| ZF8uKPqAu8M | 12 | **1** | 11 | 1×-ATR minimum breakout-HEIGHT filter (distinct from range-size) |
| IyFioFkRgWo | 6 | **1** | 5 | 200-EMA deeper-support variant (settled content) |
| DLwVqcLRcfw | 2 | 0 | 2 | (short-flip gap pre-existing in BOTH prompts, not a rewrite regression) |
| **TOTAL** | 36 | **7** | 29 | |

## Diagnosis: two changes, opposite effects
- **VERBATIM MANDATE = the win.** Locator 10.8%→2.0% (5×). ~29/36 of the checked drops were legitimate (redundant mirror-pairs, correctly-abstained fabrications). Faithfulness of what IS extracted is dramatically better.
- **ABSTAIN/ELABORATION GUARD = over-corrected.** Silenced 7 real items across 4/5 videos — secondary confluences (Bookmap, A+, 1×-ATR height, 200-EMA) AND, worst, a whole strategy's EXIT spec (0xyg targets+stop nulled). Swung from gemma's over-invention to over-abstention.

## Verdict
Locator bar: CLEARS (2.0% ≤ 8%) — but PARTLY via denominator-shrinkage from silencing. Content-preservation: **FAILS** (7 distinct real items silenced, incl. core exit content). Per "content is the bar," the config pass does NOT cleanly clear.

## The ruling this forces (operator's, not doer's)
The defect is NARROW + NAMED (abstain too aggressive on secondary confluences + exit fields; verbatim mandate is sound), not a capability failure. Two paths:
- (a) Per "one pass, no second swing": content-preservation is a terminal-read precondition and it failed → the config pass is a MISS → ladder advances to the Claude extraction seat.
- (b) A SCOPED abstain-tuning fix (keep verbatim mandate; instruct "abstain ONLY when a field is genuinely absent — never null a taught exit/target/confluence") — but that is a "second swing" the rule forbade. The distinction (narrow-named-defect vs capability-failure) is one the pre-commitment did not anticipate.
Operator rules. Bar unmoved either way; sealed 12 pristine.
