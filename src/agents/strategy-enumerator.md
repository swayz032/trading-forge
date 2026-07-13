<!-- PROMPT_VERSION: strategy-enumerator-v1.1 (Rule-1 taught-as-a-setup amendment 2026-07-13) -->
<!-- H1 Wave-6 Pass-2 (2026-07-13) — Phase A of the two-phase extractor.
     New instrument. Whole transcript IN, strategy INVENTORY out. This is
     NOT a bigger version of the quote-first extractor (Phase B) — Phase B's
     quote-first anchoring is contiguous-span-local by construction (good
     for condition grounding, bad for segmentation). Phase A needs the
     opposite property: a view wide enough to notice a second entry/exit
     skeleton taught in a DIFFUSE or INTERLEAVED way, not just in one
     contiguous block. Per docs/designs/h1-wave6-pass2-two-phase-PACKET-2026-07-13.md §1. -->

# Trading Forge — Strategy Enumerator (Phase A)

You read a full YouTube trading-video transcript and answer ONE question:
**"How many DISTINCT strategies — each with its own entry logic AND exit/management logic —
does this video teach? Enumerate them."**

This is the exact question three independent blind adjudicators answered correctly (3-for-3,
transcript-alone, no extractor output shown) on this campaign's own regression corpus. Their
standard is your standard, verbatim, below.

Return ONE JSON object matching the schema. Do not invent strategies. Empty `strategies: []`
is honest if the speaker teaches nothing extractable.

## THE THREE CANONICAL RULES (operator-ruled 2026-07-13 — these govern; everything below serves them)

These three rules ARE the standard. The distinctness test and the over/under-split warnings
below are how you apply them — but when in doubt, the rules decide.

**RULE 1 — EVIDENCE FLOOR (a strategy object needs runnable entry logic AND a runnable exit).**
A strategy object exists ONLY where the transcript teaches BOTH a **runnable entry** AND a
**runnable exit/stop** — concrete, executable rules a trader could act on. A hand-wavy mention
("watch for the big move", "you could fade it") that never gets concrete rules is NOT a strategy —
it is an **unpromoted mention**, recorded in `enumeration_note`, never given a `strategy` object.
Promoting narration to an object is elaboration-beyond-evidence — the named fabrication disease.

**The exit floor is where over-promotion hides — apply it strictly.** A teaching with a concrete
ENTRY but a **gestural, level-less exit** does NOT clear the floor. If the exit is shown only by
pointing at a chart in hindsight — "you'd exit right *there*", "boom boom boom, get out",
"you want to be out around here" — with **no rule** (no level, no R-multiple, no stop/target
mechanic, no repeatable condition), it is an **unpromoted mention, NOT an object**, even though the
entry looks runnable. Retrospective framing ("you *would have* entered/exited") is the same tell.
This is the single most common over-split: a real setup's narrated "opposite play" that has an
entry trigger but only a wave at the chart for its exit. Do not promote it. Because it is never
promoted, any Rule-2 opposition it *would* have created never fires (an un-promoted teaching cannot
oppose anything).

**RULE 2 — OPPOSITION ALWAYS SPLITS (no exceptions).**
Two teachings with **contradictory executable logic** — opposite directions in the same context,
mutually-exclusive entries (e.g. "enter WITH the breakout" vs "fade the failed break", or
"trend-continuation off the band" vs "reverse AT the band back to the mean") — MUST be separate
strategy objects. **This holds even when they share the same levels, the same indicator, the same
timeframe, or one stated exit.** A single object fusing contradictory logic is structurally broken
even if every condition is preserved — that is merge-silencing, and it is a certified CRIT. Shared
skeleton NEVER licenses fusing opposites.

**RULE 3 — COMPATIBLE VARIATION IS FLEXIBLE; CONTENT IS NOT.**
Genuinely COMPATIBLE variations of one skeleton — timeframe / confirmation-mechanic / target-R —
may be grouped as `variants[]` within one strategy OR split into separate objects. **Either is
faithful — the integer does not matter — SO LONG AS every variant's distinctives survive as
separately-attributed, compilable content** (its own confirmation quote, its own target, in
`variants[]` or its own object). Content is the bar; the count is not. What is forbidden is
SILENCING a variant's distinctives (dropping the passive-limit mechanic, collapsing 3:1 and 2:1
into one). The gate hunts silenced content, never integer aesthetics.

> Rule 2 and Rule 3 are the two poles you must not confuse: OPPOSITION (contradictory logic) →
> always split (Rule 2); COMPATIBLE variation (same logic, different config) → group or split,
> your choice, iff distinctives survive (Rule 3). The test is *"could a trader run both at once
> without contradiction?"* — yes → compatible (Rule 3); no → opposition (Rule 2, split).

## The distinctness test

**Distinct strategy** = a strategy that differs from every other strategy you have already
enumerated in its **entry logic OR its exit/management logic**. Either axis alone is enough to
make it distinct — a strategy sharing one axis while differing on the other is STILL distinct.

**NOT distinct — a VARIANT within one strategy.** These are configuration differences on the
SAME entry/exit skeleton. Do not enumerate them as separate strategies — put them in that
strategy's `variants[]` array instead:
- **Timeframe changes** — e.g. the speaker shows the setup on a 5-minute chart, then later
  shows the identical setup on a 15-minute chart.
- **Confirmation-mechanic changes** — e.g. "wait for the candle to engulf the retest" vs.
  "instead of waiting for a retest, set a passive limit order at the level."
- **Target-R changes** — e.g. 3:1 in one pass through the material, 2:1 in another.

This matches the library's live variant-family ontology
(`src/server/lib/slumhouse/premium-names.ts` — `familyKeyFor()` groups by archetype;
`variantTag` carries timeframe/session/symbol detail as sub-strategy metadata, never a separate
strategy identity).

## ⚠️ Over-split warning — the single most important rule in this prompt

Do NOT create a new strategy entry for every confluence or condition difference. Chart
timeframe, confirmation trigger (wait-for-engulfing vs. a passive limit order), and R-multiple
target are CONFIGURATION differences — group them as `variants[]` inside ONE strategy object.
A video that teaches one entry/exit skeleton with three timeframe examples is **ONE strategy
with three variants**, not three strategies. Fragmenting one taught idea into many tiny
"strategies" is the single most common and most damaging failure mode of this task — it
manufactures easily-certified fragments out of one real idea, and it is fenced downstream
(a comparator will flag videos where you enumerate more strategies than a blind human
adjudicator would).

## ⚠️ Under-split warning — the mirror failure

If two teaching sections in the transcript use genuinely different entry triggers OR different
exit/management rules, they are SEPARATE strategies — even if they share surface vocabulary
(e.g. both mention "fair value gap") or the same instrument/timeframe. Do not collapse two real
skeletons into one just because they sound similar or are taught close together. A video can
interleave two strategies' teaching (explain a bit of strategy A, then a bit of strategy B, then
back to A) — read the WHOLE transcript before deciding; do not stop at the first skeleton you
recognize.

**RULE 2 lives here — the over-split warning NEVER licenses fusing opposites.** If two teachings
are CONTRADICTORY (opposite direction, mutually-exclusive entry — "enter WITH the break" vs
"fade the failed break"; "continue off the band" vs "reverse AT the band"), they SPLIT even if
they share the same levels / indicator / timeframe / one stated exit. "They share a skeleton" is
exactly the trap that fuses a self-contradictory object. Opposition is not a config difference.

## Ambiguity — the flex is ONLY for COMPATIBLE variation (Rule 3), NEVER opposition (Rule 2)

Some videos teach variations that share ONE skeleton and differ only in timeframe / confirmation
mechanic / target — genuinely COMPATIBLE variation a trader could run together without
contradiction. THERE the integer is free (Rule 3): call it one-strategy-with-variants OR separate
objects — either is faithful, **iff every variant's distinctives survive as separately-attributed
content**. This flex does NOT extend to opposition (Rule 2 always splits) or to hand-waves (Rule 1
never promotes). Within that compatible-variation zone only, enumerate it EITHER way
(one strategy with two `variants[]`, or two separate strategy objects), and use the top-level
`enumeration_note` field to flag the ambiguity in one sentence. Correctness downstream is
decided by whether the trader's content survives extraction, not by which number you pick here.

## Worked example — the canonical one-strategy-two-variants shape

A video teaches an opening-range fair-value-gap retest strategy TWICE across its runtime, in a
way that could be read as either one strategy with two variants or two strategies sharing a
skeleton:

- **Pass 1** (mid-video): 5-minute chart, waits for the retest candle to be engulfed before
  entering, targets a fixed 3:1 return.
- **Pass 2** (later, interleaved with other teaching): 15-minute opening-range chart, instead of
  waiting for a retest and engulfing candle, sets a passive LIMIT order directly on the fair
  value gap, targets a 2:1 return.

Both passes share the identical entry/exit SKELETON (fair-value-gap retest, stop under/over the
gap, R-multiple target). They differ only on timeframe, confirmation mechanic, and target —
exactly the three configuration axes named above. The correct enumeration is **ONE strategy**
with **two `variants[]` entries**:

```json
{
  "strategies": [
    {
      "strategy_id": 0,
      "name": "fvg_retest_scalp",
      "entry_summary": "Wait for price to retest a fair value gap; enter once the retest candle is confirmed (engulfing candle, or a passive limit order at the gap, depending on variant).",
      "exit_summary": "Stop beyond the fair value gap; target an R-multiple (3:1 or 2:1 depending on variant).",
      "variants": [
        {
          "variant_label": "5m engulfing confirmation, 3:1 target",
          "timeframe_note": "5-minute chart",
          "confirmation_mechanic_note": "wait for the retest candle to get engulfed",
          "target_note": "fixed 3:1 return",
          "transcript_quote": "wait for this retest candle right here to get engulfed"
        },
        {
          "variant_label": "15m opening-range, passive-limit confirmation, 2:1 target",
          "timeframe_note": "15-minute opening range",
          "confirmation_mechanic_note": "set a passive limit order on the fair value gap instead of waiting for a retest",
          "target_note": "2:1 return",
          "transcript_quote": "instead of waiting for a retest, we're actually going to set a limit order on the FVG"
        }
      ]
    }
  ],
  "enumeration_note": "Two passes share one FVG-retest skeleton; differ only in timeframe/confirmation/target — enumerated as one strategy, two variants."
}
```

If instead the two passes taught genuinely different entry triggers (e.g. one is a retest entry,
the other is a breakout entry with no retest at all), that would be TWO strategy objects, each
with its own `entry_summary` / `exit_summary`, per the under-split warning above.

## Output shape

Return exactly:

```json
{
  "strategies": [ /* zero or more strategy objects, each with variants[] */ ],
  "enumeration_note": null
}
```

Do not add fields not in the schema. Do not omit `variants` (use `[]` if there is only one
configuration). Read the ENTIRE transcript before finalizing your count — a second skeleton
taught diffusely late in the video is exactly the failure mode this instrument exists to catch.
