<!-- PROMPT_VERSION: semantic-conflation-check-v1 (2026-07-15, path-(d) ruling) -->
# Semantic Conflation Check — the terminal read's anti-merge-silencing axis (prose format)

You judge ONE extracted trading strategy object. Answer ONE question, cross-vendor and independent of
however the object was tagged:

**Is this ONE coherent trade, or TWO OPPOSITE trades welded into a single object?**

## The test (pinned law — mirror-vs-fusion)
- **CONTEXT-SELECTED MIRROR → PASS.** One skeleton whose direction is chosen per instance by context
  (e.g. "buy a bullish fair-value-gap in an uptrend, sell a bearish one in a downtrend" — the SAME
  entry logic, the side picked by the setup you're in). A trader runs it long OR short depending on the
  chart, never both at once. This is faithful; it is NOT conflation. PASS.
- **CO-REQUIRED CONTRADICTION → REJECT.** One object whose conditions cannot be executed as a single
  coherent setup — two DIFFERENT, opposite-direction setups fused as if simultaneously required, or
  targets/logic that contradict (e.g. "target the outer bands (continuation)" AND "target the central
  VWAP (reversion)" in one object — you cannot do both in one trade). A bot handed this object could not
  execute it as one trade without contradiction. REJECT.

## The discriminator
Ask: could a single trade instance satisfy ALL of this object's conditions at once, coherently?
- YES (the opposite directions are ALTERNATIVES selected by context) → mirror → PASS.
- NO (the conditions are co-required and mutually exclusive / two setups welded) → fusion → REJECT.

Long+short content ALONE does not decide it — a mirror has both too. The question is co-requirement:
are the opposite elements ALTERNATIVES (pick one per instance = PASS) or SIMULTANEOUS REQUIREMENTS /
two-distinct-setups-fused (= REJECT)?

## Output — return ONLY this JSON
```json
{
  "strategy_name": "<name>",
  "verdict": "PASS" | "REJECT",
  "is_single_coherent_trade": true,
  "reasoning": "<one-paragraph: mirror-alternative vs co-required-contradiction, cite the object's own conditions>",
  "fused_pair": null
}
```
`verdict`="REJECT" iff you find a co-required contradiction (fused opposition); `fused_pair` then names
the two welded setups. Otherwise "PASS". A context-selected mirror is ALWAYS PASS — never punish
faithful direction:both. When genuinely uncertain whether opposite elements are alternatives or
co-required, default to reading the object's own words for whether a single instance could run all of it.

---
## v1.1 SCOPE (2026-07-15, applying the path-(d) definition correctly — IyF false-positive fix)
Judge the object's **CO-REQUIRED conditions** — entry_sequence, confluences, stop, targets — the things a
SINGLE trade instance must satisfy TOGETHER. A fusion = opposite-direction logic WELDED into those
co-required conditions such that one instance is self-contradictory (e.g. co-required targets that
contradict: "outer bands" AND "central VWAP").
A directionally-opposite entry that lives in a separate, explicitly-labeled `variants[]` slot (its own
variant with a direction tag) is an ALTERNATIVE, not a co-required condition — a trader picks one per
instance. Do NOT REJECT for a labeled variant's direction: that is the enumerator's opposition-split axis,
already ruled upstream, NOT this check's co-required-fusion question. REJECT only when the CO-REQUIRED
trade logic itself cannot execute as one coherent instance.
